// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Test} from "forge-std/Test.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {RobinhoodChainAddresses as A} from "../../src/Addresses.sol";
import {PopFeeEscrow} from "../../src/PopFeeEscrow.sol";
import {PopGraduationExecutor} from "../../src/PopGraduationExecutor.sol";
import {PopHook} from "../../src/PopHook.sol";
import {PopLaunchDeployer} from "../../src/PopLaunchDeployer.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {PopLocker} from "../../src/PopLocker.sol";
import {PopQuoteRegistry} from "../../src/PopQuoteRegistry.sol";
import {PopRewardTokenDeployer} from "../../src/PopRewardTokenDeployer.sol";
import {PopSwapRouter} from "../../src/PopSwapRouter.sol";
import {
    IPonsV1LaunchFactory,
    IUniswapV3FactoryLike,
    PonsV1QuoteAdapter
} from "../../src/adapters/PonsV1QuoteAdapter.sol";
import {CashbackConfig, CashbackMode, IPopFeeEscrow, IPopQuoteRegistry, LaunchPhase} from "../../src/interfaces/IPop.sol";

interface IWETHFork {
    function deposit() external payable;
}

/// @notice End-to-end tests against a Robinhood Chain mainnet fork: the real
/// Pons v1 factories (graduation proof + TWAP for $PONS), the real canonical
/// Uniswap V4 PoolManager/PositionManager/Permit2, the real WETH, and a live
/// $POP v2 launch whose curve trades in real WETH and whose bond executes a
/// real WETH -> PONS market buy on the real Pons V3 pool.
/// Run with: RUN_FORK_TESTS=true ROBINHOOD_RPC_URL=... forge test --match-path "test/fork/*"
contract RobinhoodForkTest is Test {
    PonsV1QuoteAdapter internal adapter;
    PopQuoteRegistry internal registry;
    PopLaunchFactory internal factory;
    PopHook internal hook;
    PopLocker internal locker;
    PopFeeEscrow internal escrow;
    PopGraduationExecutor internal executor;
    PopSwapRouter internal router;

    address internal timelock = makeAddr("timelock");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal whale = makeAddr("whale");

    /// @dev The block this suite is pinned to. Its *state* is long pruned from
    /// the public endpoint, so the run is served from the RPC cache committed
    /// under `test/fork/cache/` (or a fresh archive endpoint). Re-pin and
    /// regenerate the cache together with `script/warm-fork-cache.sh`.
    uint256 internal constant PINNED_FORK_BLOCK = 51091865;

    bool internal forkEnabled;

    modifier onFork() {
        if (!forkEnabled) return;
        _;
    }

    function setUp() public {
        forkEnabled = vm.envOr("RUN_FORK_TESTS", false);
        if (!forkEnabled) return;
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com"));
        uint256 forkBlock = vm.envOr("FORK_BLOCK", PINNED_FORK_BLOCK);
        if (forkBlock == 0) {
            vm.createSelectFork(rpc);
        } else {
            vm.createSelectFork(rpc, forkBlock);
        }

        adapter = new PonsV1QuoteAdapter(
            IPonsV1LaunchFactory(A.PONS_V1_FACTORY),
            IPonsV1LaunchFactory(A.PONS_V1_LEGACY_FACTORY),
            IUniswapV3FactoryLike(A.UNISWAP_V3_FACTORY),
            A.WETH
        );

        escrow = new PopFeeEscrow();
        locker = new PopLocker(timelock, A.UNISWAP_V4_POSITION_MANAGER);

        address hookAddr = address(
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG)
                ^ (0x9999 << 144)
        );
        deployCodeTo(
            "PopHook.sol:PopHook",
            abi.encode(
                A.UNISWAP_V4_POOL_MANAGER,
                address(escrow),
                treasury,
                timelock,
                uint256(5_000),
                uint256(100),
                uint256(300)
            ),
            hookAddr
        );
        hook = PopHook(hookAddr);

        registry = new PopQuoteRegistry(timelock, 25 ether, 4.2 ether);
        vm.prank(timelock);
        registry.addAdapter(adapter);

        factory = new PopLaunchFactory(
            timelock,
            IPoolManager(A.UNISWAP_V4_POOL_MANAGER),
            IPositionManager(A.UNISWAP_V4_POSITION_MANAGER),
            IAllowanceTransfer(A.PERMIT2),
            locker,
            hook,
            IPopFeeEscrow(address(escrow)),
            IPopQuoteRegistry(address(registry)),
            A.WETH,
            0.0005 ether
        );
        executor = new PopGraduationExecutor(
            IPositionManager(A.UNISWAP_V4_POSITION_MANAGER), IAllowanceTransfer(A.PERMIT2), locker, address(factory)
        );
        PopLaunchDeployer launchDeployer =
            new PopLaunchDeployer(address(factory), new PopRewardTokenDeployer(address(factory)));

        vm.startPrank(timelock);
        factory.setGraduationExecutor(executor);
        factory.setLaunchDeployer(launchDeployer);
        factory.addLaunchConfig(
            PopLaunchFactory.LaunchConfig({supply: 1_000_000_000 ether, poolFee: 0, tickSpacing: 200, enabled: true})
        );
        factory.setLaunchEnabled(true);
        hook.setFactory(address(factory));
        locker.setFactory(address(factory));
        vm.stopPrank();

        router = new PopSwapRouter(factory);

        vm.deal(creator, 2 ether);
        vm.deal(whale, 50 ether);
    }

    function test_adapter_provesRealPonsGraduation() public onFork {
        (bool graduated, uint256 ethPrincipal) = adapter.verify(A.PONS);
        assertTrue(graduated);
        assertGt(ethPrincipal, 25 ether);
        (address pool,) = adapter.conversionPool(A.PONS);
        assertTrue(pool != address(0), "real conversion pool");
    }

    function test_registry_listsRealPonsWithEthEconomics() public onFork {
        registry.listQuote(A.PONS, 0);
        (uint256 phantomEth, uint256 thresholdEth) = registry.ethLaunchEconomics(A.PONS);
        assertEq(thresholdEth, 4.2 ether);
        assertEq(phantomEth, 1.68 ether);
        (address pool, uint256 twap) = registry.bondConversion(A.PONS);
        assertTrue(pool != address(0));
        assertGt(twap, 0);
    }

    function test_fullLaunch_ethCurve_realBondIntoRealPons() public onFork {
        registry.listQuote(A.PONS, 0);

        vm.prank(creator);
        address t = factory.launchToken{value: 0.0005 ether}(
            PopLaunchFactory.TokenParams({
                name: "Pop Fork V2",
                symbol: "POPF",
                logo: "",
                description: "",
                socials: PopLaunchToken.Socials("", "", "", "", ""),
                creatorFeeRecipient: address(0),
                creatorFeeBps: 100,
                cashback: CashbackConfig(CashbackMode.QuoteBurn, 5_000),
                expectedEconomics: bytes32(0),
                salt: bytes32("fork-v2")
            }),
            0,
            A.PONS,
            0
        );

        // A third-party bot router trades the curve with real WETH from
        // block one.
        vm.warp(block.timestamp + 61);
        vm.startPrank(whale);
        PoolSwapTest botRouter = new PoolSwapTest(IPoolManager(A.UNISWAP_V4_POOL_MANAGER));
        IWETHFork(A.WETH).deposit{value: 20 ether}();
        IERC20(A.WETH).approve(address(botRouter), type(uint256).max);
        PoolKey memory curveKey = factory.curvePoolKey(t);
        bool zeroForOne = A.WETH < t;
        botRouter.swap(
            curveKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(10 ether),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        assertGt(IERC20(t).balanceOf(whale), 0, "bot bought the curve");
        assertTrue(factory.isBondReady(t), "10 ETH filled the 4.2 ETH curve");

        // Bond: burns the curve position, market-buys real PONS on the real
        // V3 pool, seeds the locked token/PONS pool.
        uint256 positionId = IPositionManager(A.UNISWAP_V4_POSITION_MANAGER).nextTokenId();
        factory.bond(t, 0);

        assertEq(uint8(factory.getLaunchedToken(t).phase), uint8(LaunchPhase.Bonded));
        assertEq(IERC721(A.UNISWAP_V4_POSITION_MANAGER).ownerOf(positionId), address(locker));
        assertTrue(locker.isLocked(t));
        (uint160 sqrtPrice,,,) =
            StateLibrary.getSlot0(IPoolManager(A.UNISWAP_V4_POOL_MANAGER), factory.bondedPoolKey(t).toId());
        assertGt(sqrtPrice, 0, "bonded PONS pool live");

        // Post-bond: an ETH buy through the convenience router routes via
        // the real V3 pool into the real V4 bonded pool.
        vm.prank(whale);
        uint256 out = router.buyWithEth{value: 0.5 ether}(t, 0, block.timestamp);
        assertGt(out, 0, "post-bond ETH buy");
    }
}

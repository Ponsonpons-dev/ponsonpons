// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Test} from "forge-std/Test.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {RobinhoodChainAddresses as A} from "../../src/Addresses.sol";
import {PopBondingCurve} from "../../src/PopBondingCurve.sol";
import {PopFeeEscrow} from "../../src/PopFeeEscrow.sol";
import {PopGraduationExecutor} from "../../src/PopGraduationExecutor.sol";
import {PopHook} from "../../src/PopHook.sol";
import {PopLaunchDeployer} from "../../src/PopLaunchDeployer.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {PopLocker} from "../../src/PopLocker.sol";
import {PopQuoteRegistry} from "../../src/PopQuoteRegistry.sol";
import {PopRewardTokenDeployer} from "../../src/PopRewardTokenDeployer.sol";
import {
    IPonsV1LaunchFactory,
    IUniswapV3FactoryLike,
    PonsV1QuoteAdapter
} from "../../src/adapters/PonsV1QuoteAdapter.sol";
import {
    CashbackConfig,
    CashbackMode,
    GraduationPhase,
    IPopFeeEscrow,
    IPopQuoteRegistry
} from "../../src/interfaces/IPop.sol";

/// @notice End-to-end tests against a Robinhood Chain mainnet fork: the real
/// Pons v1 factories (graduation proof + TWAP for $PONS), the real canonical
/// Uniswap V4 PoolManager/PositionManager/Permit2, and a live $POP launch
/// quoted in real $PONS from curve to locked V4 position.
/// Run with: ROBINHOOD_RPC_URL=... forge test --match-path "test/fork/*"
contract RobinhoodForkTest is Test {
    PonsV1QuoteAdapter internal adapter;
    PopQuoteRegistry internal registry;
    PopLaunchFactory internal factory;
    PopHook internal hook;
    PopLocker internal locker;
    PopFeeEscrow internal escrow;
    PopGraduationExecutor internal executor;

    address internal timelock = makeAddr("timelock");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal whale = makeAddr("whale");

    /// @dev The block this suite is pinned to. Its *state* is long pruned from
    /// the public endpoint, Robinhood Chain keeps only a few thousand blocks
    /// of it, minutes at Orbit block times, so the run is served from the RPC
    /// cache committed under `test/fork/cache/`. Re-pin and regenerate that
    /// cache together with `script/warm-fork-cache.sh`; the two must match.
    /// Override with FORK_BLOCK, or FORK_BLOCK=0 to fork from the head (which
    /// needs an archive endpoint or a very fresh block).
    uint256 internal constant PINNED_FORK_BLOCK = 51091865;

    bool internal forkEnabled;

    modifier onFork() {
        if (!forkEnabled) return;
        _;
    }

    function setUp() public {
        // Opt-in: fork tests hit mainnet RPC and are not part of the default
        // suite. Enable with RUN_FORK_TESTS=true (plus ROBINHOOD_RPC_URL to
        // override the public endpoint).
        forkEnabled = vm.envOr("RUN_FORK_TESTS", false);
        if (!forkEnabled) return;
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com"));
        // Pinning makes a run reproducible for auditors, and it is required
        // against the public endpoint, which refuses state queries at its own
        // head block. State for the pin comes from the committed RPC cache.
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
            PopLaunchFactory.LaunchConfig({
                supply: 1_000_000_000 ether, curveFeeBps: 100, poolFee: 0, tickSpacing: 200, enabled: true
            })
        );
        factory.setLaunchEnabled(true);
        hook.setFactory(address(factory));
        locker.setFactory(address(factory));
        vm.stopPrank();

        vm.deal(creator, 1 ether);
    }

    function test_adapter_provesRealPonsGraduation() public onFork {
        (bool graduated, uint256 ethPrincipal) = adapter.verify(A.PONS);
        assertTrue(graduated);
        // $PONS held ~414 WETH of locked principal at discovery time; allow
        // wide drift but require it comfortably above the listing floor.
        assertGt(ethPrincipal, 25 ether);

        // A random address is not a Pons token.
        assertFalse(_verifyReverts(A.PONS));
        assertTrue(_verifyReverts(address(0xdead)));
    }

    function _verifyReverts(address token) internal view returns (bool reverted) {
        try adapter.verify(token) returns (bool, uint256) {
            return false;
        } catch {
            return true;
        }
    }

    function test_registry_listsRealPonsWithSaneEconomics() public onFork {
        registry.listQuote(A.PONS, 0);
        (uint256 phantom, uint256 threshold, uint8 decimals) = registry.getLaunchEconomics(A.PONS);
        assertEq(decimals, 18);
        assertEq(phantom, threshold * 2 / 5);

        // Sanity: the threshold should be 4.2 ETH worth of PONS. At
        // discovery, PONS traded around 4e-6 ETH, implying a threshold on
        // the order of 1M PONS. Accept two orders of magnitude either way,
        // the assertion is against nonsense (0 or astronomic), not price.
        assertGt(threshold, 10_000 ether);
        assertLt(threshold, 1_000_000_000 ether);
    }

    function test_fullLaunch_onRealV4_withRealPons() public onFork {
        registry.listQuote(A.PONS, 0);
        (, uint256 threshold,) = registry.getLaunchEconomics(A.PONS);

        address[] memory noExemptions;
        vm.prank(creator);
        (address t, address c) = factory.launchToken{value: 0.0005 ether}(
            PopLaunchFactory.TokenParams({
                name: "Pop Fork Test",
                symbol: "POPF",
                logo: "",
                description: "",
                socials: PopLaunchToken.Socials("", "", "", "", ""),
                creatorFeeRecipient: address(0),
                creatorFeeBps: 100,
                cashback: CashbackConfig(CashbackMode.QuoteBurn, 5_000),
                expectedEconomics: bytes32(0),
                salt: bytes32("fork")
            }),
            0,
            A.PONS,
            0,
            0,
            noExemptions
        );
        PopBondingCurve curve = PopBondingCurve(c);

        // Fund a whale with real PONS via storage and buy the curve out.
        vm.warp(block.timestamp + 61);
        uint256 offered = threshold * 3;
        deal(A.PONS, whale, offered);
        vm.startPrank(whale);
        IERC20(A.PONS).approve(c, offered);
        curve.buy(offered, 0, whale, block.timestamp);
        vm.stopPrank();

        assertTrue(curve.graduated());
        assertEq(uint8(factory.getLaunchedToken(t).phase), uint8(GraduationPhase.Swept));

        // Seed the pool on the REAL canonical PoolManager and lock the
        // position in our locker.
        uint256 positionId = factory.createGraduatedPool(t);
        assertEq(uint8(factory.getLaunchedToken(t).phase), uint8(GraduationPhase.PoolCreated));
        assertEq(IERC721(A.UNISWAP_V4_POSITION_MANAGER).ownerOf(positionId), address(locker));
        assertTrue(locker.isLocked(t));
        assertGt(locker.lockedTokenSupply(t), 0);
    }
}

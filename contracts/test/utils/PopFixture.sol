// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";

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
import {CashbackConfig, CashbackMode, IPopFeeEscrow, IPopQuoteRegistry} from "../../src/interfaces/IPop.sol";

import {MockERC20} from "../mocks/MockERC20.sol";
import {MockQuoteAdapter} from "../mocks/MockQuoteAdapter.sol";
import {MockV3ConversionPool, MockWETH} from "../mocks/MockWethAndV3.sol";

/// @notice Deploys the full $POP v2 stack against a real local Uniswap V4
/// (PoolManager + PositionManager + Permit2), a mock WETH, and a mock
/// fixed-rate V3 conversion pool for the bond's WETH -> quote market buy.
/// Provides launch/trade helpers shared by the unit tests. Trading runs
/// through PopSwapRouter, the same path the site uses; router-independence
/// is exercised separately with the stock v4 PoolSwapTest router.
contract PopFixture is Test, DeployPermit2 {
    // Stand-in for the timelocked owner on mainnet; unit tests exercise the
    // same onlyOwner surface.
    address internal timelock = makeAddr("timelock");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    uint16 internal constant PROTOCOL_SHARE_BPS = 5_000; // 50%, matching production (the hook's cap)
    uint256 internal constant HOOK_FEE_BPS = 100; // 1%
    uint256 internal constant MAX_IMPACT_BPS = 300; // 3%
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant LAUNCH_FEE = 0.0005 ether;
    // ETH-denominated curve economics: bond threshold 4.2 ETH (registry
    // target), phantom 1.68 ETH (2/5 ratio).
    uint256 internal constant EXPECTED_THRESHOLD_ETH = 4.2 ether;
    uint256 internal constant EXPECTED_PHANTOM_ETH = 1.68 ether;
    // 1 ETH = 100,000 PONS at the mock conversion rate and TWAP.
    uint256 internal constant QUOTE_PER_ETH = 100_000 ether;

    PoolManager internal poolManager;
    PositionManager internal positionManager;
    IAllowanceTransfer internal permit2;
    PopFeeEscrow internal escrow;
    PopLocker internal locker;
    PopHook internal hook;
    MockQuoteAdapter internal adapter;
    PopQuoteRegistry internal registry;
    PopLaunchFactory internal factory;
    PopGraduationExecutor internal executor;
    PopLaunchDeployer internal launchDeployer;
    PopSwapRouter internal router;
    MockERC20 internal quote;
    MockWETH internal weth;
    MockV3ConversionPool internal conversionPool;

    function setUp() public virtual {
        poolManager = new PoolManager(address(0));
        permit2 = IAllowanceTransfer(deployPermit2());
        positionManager = new PositionManager(
            IPoolManager(address(poolManager)), permit2, 300_000, IPositionDescriptor(address(0)), IWETH9(address(0))
        );

        escrow = new PopFeeEscrow();
        locker = new PopLocker(timelock, address(positionManager));
        weth = new MockWETH();

        // The hook must live at an address whose low bits encode its
        // permissions; deployCodeTo runs the constructor at that address.
        address hookAddr = address(
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG)
                ^ (0x4444 << 144)
        );
        deployCodeTo(
            "PopHook.sol:PopHook",
            abi.encode(
                address(poolManager),
                address(escrow),
                treasury,
                timelock,
                uint256(PROTOCOL_SHARE_BPS),
                HOOK_FEE_BPS,
                MAX_IMPACT_BPS
            ),
            hookAddr
        );
        hook = PopHook(hookAddr);

        adapter = new MockQuoteAdapter(address(weth));
        registry = new PopQuoteRegistry(timelock, 25 ether, EXPECTED_THRESHOLD_ETH);
        vm.prank(timelock);
        registry.addAdapter(adapter);

        quote = new MockERC20("Pons", "PONS", 18);
        conversionPool = new MockV3ConversionPool(address(weth), address(quote), QUOTE_PER_ETH);
        // Deep quote inventory for conversions.
        quote.mint(address(conversionPool), 100_000_000 ether);
        adapter.set(address(quote), true, 400 ether, QUOTE_PER_ETH);
        adapter.setPool(address(quote), address(conversionPool));
        registry.listQuote(address(quote), 0);

        factory = new PopLaunchFactory(
            timelock,
            IPoolManager(address(poolManager)),
            IPositionManager(address(positionManager)),
            permit2,
            locker,
            hook,
            IPopFeeEscrow(address(escrow)),
            IPopQuoteRegistry(address(registry)),
            address(weth),
            LAUNCH_FEE
        );
        executor =
            new PopGraduationExecutor(IPositionManager(address(positionManager)), permit2, locker, address(factory));
        launchDeployer = new PopLaunchDeployer(address(factory), new PopRewardTokenDeployer(address(factory)));

        vm.startPrank(timelock);
        factory.setGraduationExecutor(executor);
        factory.setLaunchDeployer(launchDeployer);
        factory.addLaunchConfig(
            PopLaunchFactory.LaunchConfig({supply: SUPPLY, poolFee: 0, tickSpacing: 200, enabled: true})
        );
        factory.setLaunchEnabled(true);
        hook.setFactory(address(factory));
        locker.setFactory(address(factory));
        vm.stopPrank();

        router = new PopSwapRouter(factory);

        vm.deal(creator, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function defaultParams(string memory symbol_, CashbackConfig memory cashback, uint16 creatorFeeBps)
        internal
        pure
        returns (PopLaunchFactory.TokenParams memory)
    {
        return PopLaunchFactory.TokenParams({
            name: string.concat(symbol_, " Token"),
            symbol: symbol_,
            logo: "ipfs://logo",
            description: "a pop launch",
            socials: PopLaunchToken.Socials("", "", "", "", ""),
            creatorFeeRecipient: address(0),
            creatorFeeBps: creatorFeeBps,
            cashback: cashback,
            expectedEconomics: bytes32(0),
            salt: keccak256(bytes(symbol_))
        });
    }

    function launch(CashbackConfig memory cashback, uint16 creatorFeeBps) internal returns (PopLaunchToken token) {
        vm.prank(creator);
        address t =
            factory.launchToken{value: LAUNCH_FEE}(defaultParams("TEST", cashback, creatorFeeBps), 0, address(quote), 0);
        return PopLaunchToken(t);
    }

    function launchPlain() internal returns (PopLaunchToken token) {
        return launch(CashbackConfig(CashbackMode.None, 0), 0);
    }

    /// @dev Buys as `buyer` with plain ETH through the site's router.
    function buyAs(address buyer, address token, uint256 ethIn) internal returns (uint256 tokensOut) {
        vm.prank(buyer);
        tokensOut = router.buyWithEth{value: ethIn}(token, 0, block.timestamp);
    }

    function sellAs(address seller, address token, uint256 tokensIn) internal returns (uint256 ethOut) {
        vm.startPrank(seller);
        PopLaunchToken(token).approve(address(router), tokensIn);
        ethOut = router.sellForEth(token, tokensIn, 0, block.timestamp);
        vm.stopPrank();
    }

    function skipSnipeWindow() internal {
        vm.warp(block.timestamp + 61);
    }

    /// @dev Buys the curve range out entirely so the launch turns bond-ready
    /// (the router refunds whatever the range cannot absorb), then bonds it.
    function buyOutAndBond(address buyer, address token) internal {
        skipSnipeWindow();
        vm.deal(buyer, 100 ether);
        buyAs(buyer, token, 20 ether);
        factory.bond(token, 0);
    }

    /// @dev Fills the curve without bonding.
    function buyOut(address buyer, address token) internal {
        skipSnipeWindow();
        vm.deal(buyer, 100 ether);
        buyAs(buyer, token, 20 ether);
    }

    function curveKeyFor(address token) internal view returns (PoolKey memory) {
        return factory.curvePoolKey(token);
    }

    function bondedKeyFor(address token) internal view returns (PoolKey memory) {
        return factory.bondedPoolKey(token);
    }
}

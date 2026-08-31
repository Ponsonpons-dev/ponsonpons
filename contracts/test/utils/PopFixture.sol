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
import {CashbackConfig, CashbackMode, IPopFeeEscrow, IPopQuoteRegistry} from "../../src/interfaces/IPop.sol";

import {MockERC20} from "../mocks/MockERC20.sol";
import {MockQuoteAdapter} from "../mocks/MockQuoteAdapter.sol";

/// @notice Deploys the full $POP stack against a real local Uniswap V4
/// (PoolManager + PositionManager + Permit2) with a mock quote registry
/// adapter, and provides launch/trade helpers shared by the unit tests.
contract PopFixture is Test, DeployPermit2 {
    // Stand-in for the 48h TimelockController that owns everything on
    // mainnet; unit tests exercise the same onlyOwner surface.
    address internal timelock = makeAddr("timelock");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    uint16 internal constant PROTOCOL_SHARE_BPS = 3_000; // 30%
    uint256 internal constant HOOK_FEE_BPS = 100; // 1%
    uint256 internal constant MAX_IMPACT_BPS = 300; // 3%
    uint256 internal constant CURVE_FEE_BPS = 100; // 1%
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant LAUNCH_FEE = 0.0005 ether;
    // 1 ETH = 100,000 PONS at the mock TWAP → threshold 420,000 PONS,
    // phantom 168,000 PONS (targetEth 4.2, ratio 2/5).
    uint256 internal constant QUOTE_PER_ETH = 100_000 ether;
    uint256 internal constant EXPECTED_THRESHOLD = 420_000 ether;
    uint256 internal constant EXPECTED_PHANTOM = 168_000 ether;

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
    MockERC20 internal quote;

    function setUp() public virtual {
        poolManager = new PoolManager(address(0));
        permit2 = IAllowanceTransfer(deployPermit2());
        positionManager = new PositionManager(
            IPoolManager(address(poolManager)), permit2, 300_000, IPositionDescriptor(address(0)), IWETH9(address(0))
        );

        escrow = new PopFeeEscrow();
        locker = new PopLocker(timelock, address(positionManager));

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

        adapter = new MockQuoteAdapter();
        registry = new PopQuoteRegistry(timelock, 25 ether, 4.2 ether);
        vm.prank(timelock);
        registry.addAdapter(adapter);

        quote = new MockERC20("Pons", "PONS", 18);
        adapter.set(address(quote), true, 400 ether, QUOTE_PER_ETH);
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
            LAUNCH_FEE
        );
        executor =
            new PopGraduationExecutor(IPositionManager(address(positionManager)), permit2, locker, address(factory));
        launchDeployer = new PopLaunchDeployer(address(factory), new PopRewardTokenDeployer(address(factory)));

        vm.startPrank(timelock);
        factory.setGraduationExecutor(executor);
        factory.setLaunchDeployer(launchDeployer);
        factory.addLaunchConfig(
            PopLaunchFactory.LaunchConfig({
                supply: SUPPLY, curveFeeBps: CURVE_FEE_BPS, poolFee: 0, tickSpacing: 200, enabled: true
            })
        );
        factory.setLaunchEnabled(true);
        hook.setFactory(address(factory));
        locker.setFactory(address(factory));
        vm.stopPrank();

        vm.deal(creator, 10 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function defaultParams(string memory symbol_, CashbackConfig memory cashback, uint16 creatorFeeBps)
        internal
        view
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

    function launch(CashbackConfig memory cashback, uint16 creatorFeeBps)
        internal
        returns (PopLaunchToken token, PopBondingCurve curve)
    {
        address[] memory noExemptions;
        vm.prank(creator);
        (address t, address c) = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("TEST", cashback, creatorFeeBps), 0, address(quote), 0, 0, noExemptions
        );
        return (PopLaunchToken(t), PopBondingCurve(c));
    }

    function launchPlain() internal returns (PopLaunchToken token, PopBondingCurve curve) {
        return launch(CashbackConfig(CashbackMode.None, 0), 0);
    }

    /// @dev Buys as `buyer`, minting them quote first and skipping past the
    /// snipe-tax window unless the test wants it.
    function buyAs(address buyer, PopBondingCurve curve, uint256 quoteIn) internal returns (uint256 tokensOut) {
        quote.mint(buyer, quoteIn);
        vm.startPrank(buyer);
        quote.approve(address(curve), quoteIn);
        tokensOut = curve.buy(quoteIn, 0, buyer, block.timestamp);
        vm.stopPrank();
    }

    function sellAs(address seller, PopBondingCurve curve, uint256 tokensIn) internal returns (uint256 quoteOut) {
        vm.startPrank(seller);
        PopLaunchToken(curve.token()).approve(address(curve), tokensIn);
        quoteOut = curve.sell(tokensIn, 0, seller, block.timestamp);
        vm.stopPrank();
    }

    function skipSnipeWindow() internal {
        vm.warp(block.timestamp + 61);
    }

    /// @dev Buys the whole sellable allocation in one oversized trade so the
    /// curve graduates (auto-graduation fires inside the crossing buy).
    function buyOut(address buyer, PopBondingCurve curve) internal {
        skipSnipeWindow();
        // Grossly oversized; the curve clamps to the sellable allocation and
        // refunds the rest.
        buyAs(buyer, curve, EXPECTED_THRESHOLD * 3);
    }

    function poolKeyFor(address token) internal view returns (PoolKey memory) {
        (Currency c0, Currency c1) = address(quote) < token
            ? (Currency.wrap(address(quote)), Currency.wrap(token))
            : (Currency.wrap(token), Currency.wrap(address(quote)));
        return PoolKey({currency0: c0, currency1: c1, fee: 0, tickSpacing: 200, hooks: IHooks(address(hook))});
    }
}

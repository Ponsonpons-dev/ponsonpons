// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PopBondingCurve} from "../../src/PopBondingCurve.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {CashbackConfig, CashbackMode, GraduationPhase} from "../../src/interfaces/IPop.sol";
import {PopCurveMath} from "../../src/libraries/PopCurveMath.sol";
import {DeferredReentrantQuote, ReentrantQuote, SelectiveBlocklistQuote} from "../mocks/Attackers.sol";
import {FeeOnTransferERC20, MockERC20} from "../mocks/MockERC20.sol";
import {PopFixture} from "../utils/PopFixture.sol";

/// @notice Pre-audit hardening suite: the adversarial quote-token classes a
/// permissionless registry could admit, the launch paths that move value
/// between the factory and a curve, and the arithmetic edges.
contract AuditHardeningTest is PopFixture {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address[] internal noExemptions;

    /// @dev Lists `token` as a quote at the fixture's standard TWAP and
    /// launches against it, returning the pair.
    function _launchOn(MockERC20 quoteToken, uint256 quotePerEth, string memory sym)
        internal
        returns (PopLaunchToken token, PopBondingCurve curve)
    {
        adapter.set(address(quoteToken), true, 400 ether, quotePerEth);
        registry.listQuote(address(quoteToken), 0);
        vm.prank(creator);
        (address t, address c) = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams(sym, CashbackConfig(CashbackMode.QuoteBurn, 5_000), 100),
            0,
            address(quoteToken),
            0,
            0,
            noExemptions
        );
        return (PopLaunchToken(t), PopBondingCurve(c));
    }

    // -----------------------------------------------------------------
    // Hostile quote tokens
    // -----------------------------------------------------------------

    /// @notice A quote that calls back into `buy` from inside its own
    /// transfer cannot open a second position against the same reserves:
    /// the curve's guard rejects the inner call while the outer one settles
    /// normally.
    function test_reentrantQuote_innerBuyIsRejected() public {
        ReentrantQuote hostile = new ReentrantQuote();
        (, PopBondingCurve curve) = _launchOn(hostile, QUOTE_PER_ETH, "REENT");
        skipSnipeWindow();

        hostile.mint(alice, 10_000 ether);
        hostile.arm(address(curve), abi.encodeCall(PopBondingCurve.buy, (1 ether, 0, alice, type(uint256).max)));

        vm.startPrank(alice);
        hostile.approve(address(curve), type(uint256).max);
        uint256 tokensOut = curve.buy(1_000 ether, 0, alice, block.timestamp);
        vm.stopPrank();

        assertTrue(hostile.didReenter(), "callback never fired: test is not exercising the guard");
        assertTrue(hostile.reentryReverted(), "reentrant buy was NOT rejected");
        // The outer trade settled exactly once.
        assertEq(curve.trackedQuote(), 1_000 ether);
        assertGt(tokensOut, 0);
        assertEq(IERC20(curve.token()).balanceOf(alice), tokensOut);
    }

    /// @notice The same callback aimed at `sell` is rejected too, so a
    /// hostile quote cannot unwind a position mid-buy.
    function test_reentrantQuote_innerSellIsRejected() public {
        ReentrantQuote hostile = new ReentrantQuote();
        (, PopBondingCurve curve) = _launchOn(hostile, QUOTE_PER_ETH, "REENT2");
        skipSnipeWindow();

        hostile.mint(alice, 10_000 ether);
        hostile.arm(address(curve), abi.encodeCall(PopBondingCurve.sell, (1 ether, 0, alice, type(uint256).max)));

        vm.startPrank(alice);
        hostile.approve(address(curve), type(uint256).max);
        curve.buy(1_000 ether, 0, alice, block.timestamp);
        vm.stopPrank();

        assertTrue(hostile.didReenter());
        assertTrue(hostile.reentryReverted(), "reentrant sell was NOT rejected");
        assertEq(curve.trackedQuote(), 1_000 ether);
    }

    /// @notice The one path where `nonReentrant` is deliberately absent.
    /// `graduate` is not guarded so it stays callable from inside `buy`'s own
    /// guarded scope, which means the permissionless `factory.graduate` retry
    /// runs with no lock held. Only the `graduated` flag, set *before* the
    /// sweep that hands control to the quote token, closes that window.
    ///
    /// Blocklisting the escrow makes the in-line graduation fail so the retry
    /// path is reached. The attacker is then funded with launch tokens and an
    /// allowance so its reentrant `sell` would otherwise go through: the flag
    /// has to be the thing that stops it, not a missing balance.
    ///
    /// Mutation note: this still passes with `graduated = true` moved after
    /// the sweep, and that is not a weakness in the test. Graduation only
    /// happens on a *full* curve, and a full curve already rejects sells via
    /// the `readyToGraduate()` disjunct in `sell`'s own guard. The flag is
    /// redundant cover on top of a structurally closed window.
    function test_reentrantQuote_duringUnguardedGraduationIsRejected() public {
        DeferredReentrantQuote hostile = new DeferredReentrantQuote();
        (PopLaunchToken token, PopBondingCurve curve) = _launchOn(hostile, QUOTE_PER_ETH, "DEFR");
        skipSnipeWindow();

        // The in-line graduation on the crossing buy reverts inside the fee
        // sweep, so the curve fills but does not graduate.
        hostile.setDenied(address(escrow), true);
        hostile.mint(alice, 10_000_000 ether);
        vm.startPrank(alice);
        hostile.approve(address(curve), type(uint256).max);
        buyOut(alice, curve);
        vm.stopPrank();

        assertFalse(curve.graduated(), "setup failed: curve graduated in-line");
        assertTrue(curve.readyToGraduate(), "setup failed: curve is not full");

        // Arm the attacker with a sell that is fully funded and approved, so
        // nothing incidental can reject it.
        uint256 stake = IERC20(address(token)).balanceOf(alice) / 4;
        assertGt(stake, 0);
        vm.prank(alice);
        IERC20(address(token)).transfer(address(hostile), stake);
        vm.prank(address(hostile));
        IERC20(address(token)).approve(address(curve), type(uint256).max);

        uint256 reservesBefore = curve.trackedQuote();
        uint256 attackerQuoteBefore = hostile.balanceOf(address(hostile));

        hostile.setDenied(address(escrow), false);
        hostile.arm(
            address(curve), abi.encodeCall(PopBondingCurve.sell, (stake, 0, address(hostile), type(uint256).max))
        );

        factory.graduate(address(token));

        assertTrue(hostile.didReenter(), "callback never fired: test is not exercising the window");
        assertTrue(hostile.reentryReverted(), "reentrant sell during graduation was NOT rejected");
        // The attacker drained nothing and the reserves were handed over once.
        assertEq(hostile.balanceOf(address(hostile)), attackerQuoteBefore, "attacker extracted quote");
        assertTrue(curve.graduated());
        assertEq(curve.trackedQuote(), 0);
        assertGt(reservesBefore, 0);
    }

    /// @notice The same window, aimed at `buy`, where the flag really is the
    /// only defence. `buy` is `nonReentrant`, but the standalone
    /// `factory.graduate` retry holds no lock, so the guard never fires; and
    /// unlike `sell` there is no `readyToGraduate()` disjunct. What stops it
    /// is `buy`'s second `graduated` check, placed after `_receiveQuote`
    /// precisely because the quote token gets control during the transfer.
    /// The attacker is funded and approved, so no missing balance or
    /// allowance can be what rejects it.
    ///
    /// Mutation note: like the sell variant, this survives moving
    /// `graduated = true` after the sweep. a full curve has no sellable
    /// tokens left, so the buy cannot draw anything out even with the flag
    /// unset. Three independent things close this window (fullness, the
    /// flag, and the post-`_receiveQuote` re-check); these tests pin the
    /// observable behaviour rather than any one of them.
    function test_reentrantQuote_innerBuyDuringUnguardedGraduationIsRejected() public {
        DeferredReentrantQuote hostile = new DeferredReentrantQuote();
        (PopLaunchToken token, PopBondingCurve curve) = _launchOn(hostile, QUOTE_PER_ETH, "DEFR2");
        skipSnipeWindow();

        hostile.setDenied(address(escrow), true);
        hostile.mint(alice, 10_000_000 ether);
        vm.startPrank(alice);
        hostile.approve(address(curve), type(uint256).max);
        buyOut(alice, curve);
        vm.stopPrank();
        assertFalse(curve.graduated(), "setup failed: curve graduated in-line");

        // Fund and approve the attacker so its reentrant buy is otherwise valid.
        hostile.mint(address(hostile), 1_000 ether);
        vm.prank(address(hostile));
        hostile.approve(address(curve), type(uint256).max);

        uint256 attackerTokensBefore = IERC20(address(token)).balanceOf(address(hostile));

        hostile.setDenied(address(escrow), false);
        hostile.arm(
            address(curve), abi.encodeCall(PopBondingCurve.buy, (100 ether, 0, address(hostile), type(uint256).max))
        );

        factory.graduate(address(token));

        assertTrue(hostile.didReenter(), "callback never fired: test is not exercising the window");
        assertTrue(hostile.reentryReverted(), "reentrant buy during graduation was NOT rejected");
        assertEq(
            IERC20(address(token)).balanceOf(address(hostile)),
            attackerTokensBefore,
            "attacker minted launch tokens out of a graduating curve"
        );
        assertEq(curve.trackedQuote(), 0);
    }

    /// @notice A quote that under-delivers is credited only for what
    /// arrived, so the curve can never promise reserves it does not hold.
    function test_feeOnTransferQuote_creditsObservedDeltaOnly() public {
        FeeOnTransferERC20 fot = new FeeOnTransferERC20(1_000); // 10% skim
        (, PopBondingCurve curve) = _launchOn(fot, QUOTE_PER_ETH, "FOT");
        skipSnipeWindow();

        fot.mint(alice, 10_000 ether);
        vm.startPrank(alice);
        fot.approve(address(curve), type(uint256).max);
        curve.buy(1_000 ether, 0, alice, block.timestamp);
        vm.stopPrank();

        // 10% never arrived; the curve tracked the 900 it actually received.
        assertEq(curve.trackedQuote(), 900 ether);
        assertGe(fot.balanceOf(address(curve)), curve.trackedQuote());
    }

    /// @notice A quote that starts blocklisting the escrow after listing
    /// wedges the ordinary sweep, and the timelocked, fixed-recipient
    /// rescue is what unwedges it, paying only the protocol and creator.
    function test_blocklistedEscrow_rescuePaysFixedRecipients() public {
        SelectiveBlocklistQuote deny = new SelectiveBlocklistQuote();
        (, PopBondingCurve curve) = _launchOn(deny, QUOTE_PER_ETH, "DENY");
        skipSnipeWindow();

        deny.mint(alice, 10_000 ether);
        vm.startPrank(alice);
        deny.approve(address(curve), type(uint256).max);
        curve.buy(1_000 ether, 0, alice, block.timestamp);
        vm.stopPrank();

        // The asset turns hostile toward the escrow.
        deny.setDenied(address(escrow), true);
        vm.expectRevert();
        curve.sweepFees();

        uint256 protocolBefore = deny.balanceOf(treasury);
        uint256 creatorBefore = deny.balanceOf(creator);
        // Resolve the token before the prank: an argument-side call would
        // otherwise consume it and send the rescue from the test contract.
        address launchToken = curve.token();
        vm.prank(timelock);
        factory.rescueCurveFees(launchToken);

        // Paid directly, split unchanged, and the burn slice folded into the
        // creator rather than attempted against a blockable dead address.
        assertGt(deny.balanceOf(treasury), protocolBefore);
        assertGt(deny.balanceOf(creator), creatorBefore);
        assertEq(curve.pendingProtocolFees(), 0);
        assertEq(curve.pendingCreatorFees(), 0);
        assertEq(curve.pendingCashback(), 0);
        // With the buckets cleared, graduation is reachable again.
        assertEq(deny.balanceOf(DEAD), 0);
    }

    // -----------------------------------------------------------------
    // Dev buy value routing
    // -----------------------------------------------------------------

    /// @notice An oversized dev buy is clamped by the curve, and the
    /// unspent quote is returned to the creator instead of being stranded
    /// in the factory.
    function test_devBuy_clampedRefundReachesCreator() public {
        uint256 offered = EXPECTED_THRESHOLD * 3;
        quote.mint(creator, offered);

        vm.startPrank(creator);
        quote.approve(address(factory), offered);
        (address t,) = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("BIGDEV", CashbackConfig(CashbackMode.None, 0), 0),
            0,
            address(quote),
            offered,
            0,
            noExemptions
        );
        vm.stopPrank();

        // The factory kept nothing: every unspent unit went back to the
        // creator, and the launch bought out its own curve.
        assertEq(quote.balanceOf(address(factory)), 0, "quote stranded in factory");
        assertGt(quote.balanceOf(creator), 0, "refund never reached the creator");
        assertGt(PopLaunchToken(t).balanceOf(creator), 0);
    }

    /// @notice The refund is measured as a delta, so a dev buy cannot reach
    /// the reserves of a different launch sitting in the factory between
    /// graduation phases.
    function test_devBuy_cannotTouchOtherLaunchesSweptReserves() public {
        // Launch A buys out and sweeps into the factory (phase Swept).
        (PopLaunchToken tokenA, PopBondingCurve curveA) = launchPlain();
        buyOut(alice, curveA);
        assertEq(uint8(factory.getLaunchedToken(address(tokenA)).phase), uint8(GraduationPhase.Swept));
        uint256 sweptHeld = quote.balanceOf(address(factory));
        assertGt(sweptHeld, 0, "launch A left nothing in the factory");

        // Launch B runs an oversized dev buy in the same quote.
        uint256 offered = EXPECTED_THRESHOLD * 3;
        quote.mint(bob, offered);
        vm.startPrank(bob);
        quote.approve(address(factory), offered);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("SECOND", CashbackConfig(CashbackMode.None, 0), 0),
            0,
            address(quote),
            offered,
            0,
            noExemptions
        );
        vm.stopPrank();

        // Launch A's swept reserves are untouched, so it can still seed.
        assertEq(quote.balanceOf(address(factory)), sweptHeld, "launch A reserves were raided");
        factory.createGraduatedPool(address(tokenA));
        assertEq(uint8(factory.getLaunchedToken(address(tokenA)).phase), uint8(GraduationPhase.PoolCreated));
    }

    // -----------------------------------------------------------------
    // Coarse-decimal quotes
    // -----------------------------------------------------------------

    /// @notice A 6-decimal quote prices, trades, and graduates on the same
    /// curve shape as an 18-decimal one, the ratio, not the scale, fixes
    /// the economics.
    function test_sixDecimalQuote_fullLifecycle() public {
        MockERC20 usd = new MockERC20("USDish", "USD6", 6);
        // 4,200 units of quote per ETH → threshold 17,640e6.
        (PopLaunchToken token, PopBondingCurve curve) = _launchOn(usd, 4_200e6, "SIX");

        (uint256 phantom, uint256 threshold,) = registry.getLaunchEconomics(address(usd));
        assertEq(threshold, 17_640e6);
        assertEq(phantom, threshold * 2 / 5);
        // Same reserved fraction (2/7 of supply) as any other quote.
        assertEq(curve.reservedTokens(), SUPPLY * phantom / (phantom + threshold));

        skipSnipeWindow();
        uint256 offered = threshold * 3;
        usd.mint(alice, offered);
        vm.startPrank(alice);
        usd.approve(address(curve), offered);
        curve.buy(offered, 0, alice, block.timestamp);
        vm.stopPrank();

        assertTrue(curve.graduated());
        factory.createGraduatedPool(address(token));
        assertTrue(locker.isLocked(address(token)));
        assertGt(usd.balanceOf(DEAD), 0, "quote burn never fired on a 6-decimal quote");
    }

    /// @notice An 8-decimal quote (the cbBTC shape) behaves identically.
    function test_eightDecimalQuote_graduates() public {
        MockERC20 btc = new MockERC20("BTCish", "BTC8", 8);
        (PopLaunchToken token, PopBondingCurve curve) = _launchOn(btc, 0.05e8, "EIGHT");

        (, uint256 threshold,) = registry.getLaunchEconomics(address(btc));
        assertEq(threshold, 21_000_000); // 4.2 * 0.05e8

        skipSnipeWindow();
        btc.mint(alice, threshold * 3);
        vm.startPrank(alice);
        btc.approve(address(curve), type(uint256).max);
        curve.buy(threshold * 3, 0, alice, block.timestamp);
        vm.stopPrank();

        assertTrue(curve.graduated());
        factory.createGraduatedPool(address(token));
        assertTrue(locker.isLocked(address(token)));
    }

    // -----------------------------------------------------------------
    // Snipe tax boundaries
    // -----------------------------------------------------------------

    function test_snipeTax_decayBoundaries() public {
        (, PopBondingCurve curve) = launchPlain();
        uint256 start = curve.launchedAt();
        uint256 window = curve.snipeTaxSeconds();

        // Second zero is the full rate; the window's final second is zero;
        // one second past it stays zero forever.
        assertEq(curve.currentSnipeTaxBps(alice), 9_900);
        vm.warp(start + window - 1);
        assertLt(curve.currentSnipeTaxBps(alice), 9_900);
        vm.warp(start + window);
        assertEq(curve.currentSnipeTaxBps(alice), 0);
        vm.warp(start + window + 10_000);
        assertEq(curve.currentSnipeTaxBps(alice), 0);
        // Decay is monotonic across the window.
        uint256 previous = type(uint256).max;
        for (uint256 t = 0; t < window; ++t) {
            vm.warp(start + t);
            uint256 bps = curve.currentSnipeTaxBps(alice);
            assertLe(bps, previous);
            previous = bps;
        }
    }

    /// @notice Even at the peak tax a buyer receives tokens and the curve
    /// stays solvent. the tax is punitive, never confiscatory.
    function test_snipeTax_peakStillNetsTheBuyer() public {
        (, PopBondingCurve curve) = launchPlain();
        assertEq(curve.currentSnipeTaxBps(alice), 9_900);
        uint256 tokensOut = buyAs(alice, curve, 1_000 ether);
        assertGt(tokensOut, 0, "a taxed buy must still deliver tokens");
        assertGe(quote.balanceOf(address(curve)), curve.trackedQuote());
    }

    // -----------------------------------------------------------------
    // Curve arithmetic
    // -----------------------------------------------------------------

    /// @notice Buying then immediately selling the same tokens can never
    /// return more quote than went in: the fees are a strict loss to the
    /// round-tripper.
    function testFuzz_roundTripNeverProfits(uint96 spendRaw) public {
        uint256 spend = uint256(spendRaw) % 50_000 ether;
        vm.assume(spend > 1e12);
        (PopLaunchToken token, PopBondingCurve curve) = launchPlain();
        skipSnipeWindow();

        uint256 tokensOut = buyAs(alice, curve, spend);
        vm.assume(tokensOut > 0);
        uint256 back = sellAs(alice, curve, tokensOut);
        assertLt(back, spend, "round trip returned more than it cost");
        assertEq(token.balanceOf(alice), 0);
        assertGe(quote.balanceOf(address(curve)), curve.trackedQuote());
    }

    /// @notice Splitting a buy into two halves is never better than doing it
    /// at once (no free value from order slicing beyond rounding dust).
    function testFuzz_splittingBuysGivesNoEdge(uint96 spendRaw) public {
        uint256 spend = 2 * (uint256(spendRaw) % 10_000 ether);
        vm.assume(spend > 1e15);

        uint256 snapshot = vm.snapshotState();
        (, PopBondingCurve curveA) = launchPlain();
        skipSnipeWindow();
        uint256 whole = buyAs(alice, curveA, spend);
        vm.revertToState(snapshot);

        (, PopBondingCurve curveB) = launchPlain();
        skipSnipeWindow();
        uint256 half = buyAs(bob, curveB, spend / 2) + buyAs(bob, curveB, spend / 2);

        // Allow a few wei of rounding either way; the point is no material edge.
        assertLe(half, whole + 1e6, "splitting a buy extracted value");
    }

    /// @notice getAmountOut is monotonic in the input and never returns more
    /// than the output reserve.
    function testFuzz_curveMathBounds(uint128 amountIn, uint128 reserveIn, uint128 reserveOut) public pure {
        vm.assume(amountIn > 0 && reserveIn > 1e6 && reserveOut > 1e6);
        uint256 out = PopCurveMath.quoteAmountOut(amountIn, reserveIn, reserveOut, 100);
        assertLt(out, reserveOut, "curve drained its own reserve");
        uint256 outMore = PopCurveMath.quoteAmountOut(uint256(amountIn) + 1, reserveIn, reserveOut, 100);
        assertGe(outMore, out, "output is not monotonic in input");
    }
}

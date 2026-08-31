// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PopBondingCurve} from "../../src/PopBondingCurve.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {CashbackConfig, CashbackMode, GraduationPhase} from "../../src/interfaces/IPop.sol";
import {PopFixture} from "../utils/PopFixture.sol";

contract BondingCurveTest is PopFixture {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function test_initialState() public {
        (PopLaunchToken token, PopBondingCurve curve) = launchPlain();

        assertEq(curve.launchSupply(), SUPPLY);
        assertEq(curve.trackedTokens(), SUPPLY);
        assertEq(token.balanceOf(address(curve)), SUPPLY);
        assertEq(curve.phantomQuote(), EXPECTED_PHANTOM);
        assertEq(curve.graduationThreshold(), EXPECTED_THRESHOLD);
        // reserved = S * phantom / (phantom + threshold) = S * 2/7
        assertEq(curve.reservedTokens(), SUPPLY * EXPECTED_PHANTOM / (EXPECTED_PHANTOM + EXPECTED_THRESHOLD));
        assertFalse(curve.readyToGraduate());
        (uint256 quoteReserve, uint256 tokenReserve) = curve.getReserves();
        assertEq(quoteReserve, EXPECTED_PHANTOM);
        assertEq(tokenReserve, SUPPLY);
    }

    function test_buy_feeSplit_noneMode() public {
        (, PopBondingCurve curve) = launch(CashbackConfig(CashbackMode.None, 0), 200);
        skipSnipeWindow();

        uint256 spend = 1_000 ether;
        buyAs(alice, curve, spend);

        uint256 fee = spend * CURVE_FEE_BPS / 10_000; // 10
        uint256 creatorFee = spend * 200 / 10_000; // 20
        uint256 protocolPart = fee * PROTOCOL_SHARE_BPS / 10_000; // 3
        assertEq(curve.pendingProtocolFees(), protocolPart);
        assertEq(curve.pendingCreatorFees(), fee - protocolPart + creatorFee);
        assertEq(curve.pendingCashback(), 0);
        assertEq(curve.trackedQuote(), spend);
        assertEq(quote.balanceOf(address(curve)), spend);
    }

    function test_buy_traderRebate_creditsEscrowInstantly() public {
        (, PopBondingCurve curve) = launch(CashbackConfig(CashbackMode.TraderRebate, 5_000), 200);
        skipSnipeWindow();

        uint256 spend = 1_000 ether;
        buyAs(alice, curve, spend);

        uint256 fee = spend * CURVE_FEE_BPS / 10_000;
        uint256 creatorFee = spend * 200 / 10_000;
        uint256 protocolPart = fee * PROTOCOL_SHARE_BPS / 10_000;
        uint256 creatorTake = fee - protocolPart + creatorFee;
        uint256 rebate = creatorTake * 5_000 / 10_000;

        assertEq(escrow.balanceOfToken(alice, address(quote)), rebate);
        assertEq(curve.pendingCreatorFees(), creatorTake - rebate);
        assertEq(curve.trackedQuote(), spend - rebate);

        // The rebate is immediately claimable.
        vm.prank(alice);
        escrow.claimToken(address(quote));
        assertEq(quote.balanceOf(alice), rebate);
    }

    function test_buy_quoteBurn_earmarksAndSweepBurns() public {
        (, PopBondingCurve curve) = launch(CashbackConfig(CashbackMode.QuoteBurn, 5_000), 200);
        skipSnipeWindow();

        uint256 spend = 1_000 ether;
        buyAs(alice, curve, spend);

        uint256 fee = spend * CURVE_FEE_BPS / 10_000;
        uint256 creatorFee = spend * 200 / 10_000;
        uint256 protocolPart = fee * PROTOCOL_SHARE_BPS / 10_000;
        uint256 creatorTake = fee - protocolPart + creatorFee;
        uint256 burn = creatorTake * 5_000 / 10_000;
        assertEq(curve.pendingCashback(), burn);

        uint256 deadBefore = quote.balanceOf(DEAD);
        curve.sweepFees(); // permissionless, no prank needed
        assertEq(quote.balanceOf(DEAD), deadBefore + burn);
        assertEq(curve.pendingCashback(), 0);
        assertEq(escrow.balanceOfToken(treasury, address(quote)), protocolPart);
        assertEq(escrow.balanceOfToken(creator, address(quote)), creatorTake - burn);
    }

    function test_snipeTax_chargesNonExemptAndDecays() public {
        (, PopBondingCurve curve) = launchPlain();

        // Launch second: 99% tax for a random buyer.
        assertEq(curve.currentSnipeTaxBps(alice), 9_900);
        // The creator was exempted during the launch transaction.
        assertEq(curve.currentSnipeTaxBps(creator), 0);

        uint256 spend = 100 ether;
        uint256 tokensSniped = buyAs(alice, curve, spend);

        // After the window an identical spend buys far more.
        skipSnipeWindow();
        uint256 tokensClean = buyAs(bob, curve, spend);
        assertGt(tokensClean, tokensSniped * 10);

        // The tax landed in the fee buckets, not in the void.
        assertGt(curve.pendingProtocolFees() + curve.pendingCreatorFees(), spend * 90 / 100 * 3 / 10);

        // Fully decayed.
        assertEq(curve.currentSnipeTaxBps(alice), 0);
    }

    function test_roundTrip_cannotExtractMoreThanDepositedMinusFees() public {
        (PopLaunchToken token, PopBondingCurve curve) = launchPlain();
        skipSnipeWindow();

        uint256 spend = 10_000 ether;
        uint256 tokensOut = buyAs(alice, curve, spend);
        assertEq(token.balanceOf(alice), tokensOut);

        uint256 quoteBack = sellAs(alice, curve, tokensOut);
        assertLt(quoteBack, spend);
        // Exactly the fees stayed behind (1% each way plus rounding).
        assertGt(quoteBack, spend * 97 / 100);
        // Curve solvency: physical balance covers tracked + pending.
        assertGe(quote.balanceOf(address(curve)), curve.trackedQuote());
    }

    function test_finalBuy_partialFillRefunds() public {
        (PopLaunchToken token, PopBondingCurve curve) = launchPlain();
        skipSnipeWindow();

        uint256 sellable = curve.sellableTokens();
        uint256 offered = EXPECTED_THRESHOLD * 3;
        quote.mint(alice, offered);
        vm.startPrank(alice);
        quote.approve(address(curve), offered);
        uint256 balanceBefore = quote.balanceOf(alice);
        uint256 tokensOut = curve.buy(offered, 0, alice, block.timestamp);
        vm.stopPrank();

        assertEq(tokensOut, sellable);
        assertEq(token.balanceOf(alice), sellable);
        // A meaningful refund came back, the curve charged only for the
        // clamped fill.
        assertGt(quote.balanceOf(alice), balanceBefore - offered);
        assertEq(curve.sellableTokens(), 0);

        // Auto-graduation fired inside the crossing buy: the curve is
        // graduated and the launch is Swept.
        assertTrue(curve.graduated());
        assertEq(uint8(factory.getLaunchedToken(address(token)).phase), uint8(GraduationPhase.Swept));

        // The real quote collected is (close to) the threshold: the fees
        // were swept out during graduation, leaving the seed amount with the
        // factory.
        assertEq(curve.trackedQuote(), 0);
    }

    function test_donations_cannotMovePriceOrGraduate() public {
        (PopLaunchToken token, PopBondingCurve curve) = launchPlain();
        skipSnipeWindow();

        (uint256 q0, uint256 t0) = curve.getReserves();
        quote.mint(address(curve), EXPECTED_THRESHOLD * 2); // massive donation
        buyAs(alice, curve, 10 ether);
        vm.prank(alice);
        token.transfer(address(curve), 1); // token donation too

        (uint256 q1, uint256 t1) = curve.getReserves();
        // Reserves moved only by the trade (net of its fee), not by
        // donations.
        assertEq(q1, q0 + 10 ether - (10 ether * CURVE_FEE_BPS / 10_000));
        assertLt(t0 - t1, SUPPLY);
        assertFalse(curve.readyToGraduate());
    }

    function test_deadline_and_slippage_revert() public {
        (, PopBondingCurve curve) = launchPlain();
        skipSnipeWindow();

        quote.mint(alice, 100 ether);
        vm.startPrank(alice);
        quote.approve(address(curve), 100 ether);
        vm.expectRevert(
            abi.encodeWithSelector(PopBondingCurve.DeadlineExpired.selector, block.timestamp - 1, block.timestamp)
        );
        curve.buy(100 ether, 0, alice, block.timestamp - 1);

        vm.expectRevert();
        curve.buy(100 ether, type(uint256).max, alice, block.timestamp);
        vm.stopPrank();
    }

    function test_sellClosedAfterGraduation() public {
        (PopLaunchToken token, PopBondingCurve curve) = launchPlain();
        buyOut(alice, curve);
        assertTrue(curve.graduated());

        vm.startPrank(alice);
        token.approve(address(curve), 1 ether);
        vm.expectRevert(PopBondingCurve.CurveGraduated.selector);
        curve.sell(1 ether, 0, alice, block.timestamp);
        vm.expectRevert(PopBondingCurve.CurveGraduated.selector);
        curve.buy(1 ether, 0, alice, block.timestamp);
        vm.stopPrank();
    }

    function test_sweep_isPermissionless_rescueIsNot() public {
        (, PopBondingCurve curve) = launch(CashbackConfig(CashbackMode.QuoteBurn, 5_000), 0);
        skipSnipeWindow();
        buyAs(alice, curve, 1_000 ether);

        vm.prank(bob); // anyone
        curve.sweepFees();

        // Direct rescue is factory-gated…
        vm.expectRevert(PopBondingCurve.NotFactory.selector);
        curve.rescueFees();

        // …and the factory gates it on the timelocked owner.
        buyAs(alice, curve, 100 ether);
        address token = curve.token();
        vm.expectRevert();
        factory.rescueCurveFees(token);
        vm.prank(timelock);
        factory.rescueCurveFees(token);
    }

    function test_creatorFeeRecipient_selfServiceOnly() public {
        (PopLaunchToken token, PopBondingCurve curve) = launchPlain();

        // Not the recipient, not even the timelocked owner.
        vm.prank(timelock);
        vm.expectRevert(PopLaunchFactory.NotCreatorFeeRecipient.selector);
        factory.transferCreatorFeeRecipient(address(token), bob);

        vm.prank(creator);
        factory.transferCreatorFeeRecipient(address(token), bob);
        assertEq(curve.creatorFeeRecipient(), bob);
        assertEq(factory.getLaunchedToken(address(token)).creatorFeeRecipient, bob);

        // The old recipient lost the power with the handoff.
        vm.prank(creator);
        vm.expectRevert();
        factory.transferCreatorFeeRecipient(address(token), creator);
    }

    function test_devBuy_exemptFromSnipeTax() public {
        address[] memory noExemptions;
        uint256 devSpend = 1_000 ether;
        quote.mint(creator, devSpend);
        vm.startPrank(creator);
        quote.approve(address(factory), devSpend);
        (address t,) = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("DEV", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), devSpend, 0, noExemptions
        );
        vm.stopPrank();

        // The dev buy landed in the launch second but paid no snipe tax:
        // the creator's tokens reflect the untaxed price.
        PopBondingCurve curve = PopBondingCurve(factory.getLaunchedToken(t).curve);
        uint256 fee = devSpend * CURVE_FEE_BPS / 10_000;
        assertEq(curve.pendingProtocolFees() + curve.pendingCreatorFees(), fee);
        assertGt(PopLaunchToken(t).balanceOf(creator), 0);
    }
}

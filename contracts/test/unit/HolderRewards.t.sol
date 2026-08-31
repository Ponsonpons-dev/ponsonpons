// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PopBondingCurve} from "../../src/PopBondingCurve.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopRewardToken} from "../../src/PopRewardToken.sol";
import {CashbackConfig, CashbackMode, GraduationPhase} from "../../src/interfaces/IPop.sol";
import {PopFixture} from "../utils/PopFixture.sol";

/// @notice The HolderRewards cashback mode: a launch token that pays its own
/// holders in the quote asset, pro-rata and without an operator.
contract HolderRewardsTest is PopFixture {
    address[] internal noExemptions;
    address internal carol = makeAddr("carol");

    function _launchRewards(uint16 shareBps, uint16 creatorFeeBps)
        internal
        returns (PopRewardToken token, PopBondingCurve curve)
    {
        vm.prank(creator);
        (address t, address c) = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("REWARD", CashbackConfig(CashbackMode.HolderRewards, shareBps), creatorFeeBps),
            0,
            address(quote),
            0,
            0,
            noExemptions
        );
        return (PopRewardToken(t), PopBondingCurve(c));
    }

    // -----------------------------------------------------------------
    // Wiring and eligibility
    // -----------------------------------------------------------------

    function test_deploysRewardTokenVariantWithCorrectExclusions() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(5_000, 100);

        assertEq(address(token.rewardAsset()), address(quote));
        assertEq(token.curve(), address(curve));
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(curve)), SUPPLY);

        // The whole supply sits on an excluded curve, so nothing is eligible
        // yet and the pool's own float can never dilute real holders.
        assertEq(token.totalEligible(), 0);
        assertTrue(token.excluded(address(curve)));
        assertTrue(token.excluded(address(factory)));
        assertTrue(token.excluded(address(executor)));
        assertTrue(token.excluded(address(locker)));
        assertTrue(token.excluded(address(poolManager)));
        assertTrue(token.excluded(0x000000000000000000000000000000000000dEaD));
        assertTrue(token.excluded(address(token)));
        // A normal holder is not.
        assertFalse(token.excluded(alice));
    }

    function test_otherModesStillGetTheInertToken() public {
        // A non-rewards launch must not pay the transfer-hook cost or carry
        // any hook at all.
        (, PopBondingCurve curve) = launch(CashbackConfig(CashbackMode.QuoteBurn, 5_000), 0);
        (bool ok,) = curve.token().call(abi.encodeWithSignature("rewardAsset()"));
        assertFalse(ok, "non-rewards launch deployed the reward token variant");
    }

    function test_buyingMakesSupplyEligible() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(5_000, 100);
        skipSnipeWindow();

        uint256 got = buyAs(alice, curve, 1_000 ether);
        assertEq(token.balanceOf(alice), got);
        assertEq(token.totalEligible(), got);

        uint256 got2 = buyAs(bob, curve, 500 ether);
        assertEq(token.totalEligible(), got + got2);
    }

    // -----------------------------------------------------------------
    // Distribution
    // -----------------------------------------------------------------

    function test_rewardsSplitProRataAndAreClaimable() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);
        skipSnipeWindow();

        // Alice ends up with roughly 3x Bob's balance; the split must track
        // actual balances, not spend.
        uint256 aliceTokens = buyAs(alice, curve, 3_000 ether);
        uint256 bobTokens = buyAs(bob, curve, 1_000 ether);
        uint256 eligible = aliceTokens + bobTokens;
        assertEq(token.totalEligible(), eligible);

        uint256 pushed = curve.pendingCashback();
        assertGt(pushed, 0);
        curve.sweepFees(); // permissionless
        assertEq(curve.pendingCashback(), 0);
        assertEq(quote.balanceOf(address(token)), pushed);

        uint256 aliceOwed = token.claimable(alice);
        uint256 bobOwed = token.claimable(bob);
        // Shares track balances to within accumulator rounding.
        assertApproxEqRel(aliceOwed * bobTokens, bobOwed * aliceTokens, 0.0001e18);
        // Nothing is conjured: the pot covers what it owes.
        assertLe(aliceOwed + bobOwed, pushed);
        assertApproxEqRel(aliceOwed + bobOwed, pushed, 0.0001e18);

        vm.prank(alice);
        uint256 claimed = token.claim();
        assertEq(claimed, aliceOwed);
        assertEq(quote.balanceOf(alice), claimed);
        assertEq(token.claimable(alice), 0);

        vm.prank(bob);
        token.claim();
        assertEq(quote.balanceOf(bob), bobOwed);
    }

    function test_excludedHoldersEarnNothing() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);
        skipSnipeWindow();
        buyAs(alice, curve, 2_000 ether);
        curve.sweepFees();

        // The curve holds the majority of supply and is excluded.
        assertGt(token.balanceOf(address(curve)), token.balanceOf(alice));
        assertEq(token.claimable(address(curve)), 0);
        assertEq(token.claimable(address(locker)), 0);
        // Which means the one real holder takes essentially the whole pot.
        assertApproxEqRel(token.claimable(alice), quote.balanceOf(address(token)), 0.0001e18);
    }

    /// @notice Rewards are earned for the period a holder actually held: a
    /// late buyer cannot claim a share of a distribution that predates them.
    function test_lateBuyerDoesNotShareEarlierRewards() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);
        skipSnipeWindow();

        buyAs(alice, curve, 2_000 ether);
        curve.sweepFees();
        uint256 aliceOwedBefore = token.claimable(alice);
        assertGt(aliceOwedBefore, 0);

        // Bob arrives only now.
        buyAs(bob, curve, 2_000 ether);
        assertEq(token.claimable(bob), 0, "late buyer captured an earlier distribution");
        // Alice keeps what she already earned.
        assertGe(token.claimable(alice), aliceOwedBefore);

        // A second distribution is shared between them.
        curve.sweepFees();
        assertGt(token.claimable(bob), 0);
    }

    /// @notice Selling settles what was earned: a holder who exits keeps the
    /// rewards accrued while they held, and earns nothing afterwards.
    function test_sellingSettlesAndStopsAccrual() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);
        skipSnipeWindow();

        uint256 aliceTokens = buyAs(alice, curve, 2_000 ether);
        buyAs(bob, curve, 2_000 ether);
        curve.sweepFees();
        uint256 earned = token.claimable(alice);
        assertGt(earned, 0);

        sellAs(alice, curve, aliceTokens);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.claimable(alice), earned, "exit dropped already-earned rewards");

        // Further distributions pass her by.
        curve.sweepFees();
        assertEq(token.claimable(alice), earned);
        assertGt(token.claimable(bob), 0);

        vm.prank(alice);
        assertEq(token.claim(), earned);
    }

    /// @notice A plain wallet-to-wallet transfer moves future rewards with
    /// the balance but leaves accrued rewards with whoever earned them.
    function test_transferMovesFutureRewardsOnly() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);
        skipSnipeWindow();

        uint256 aliceTokens = buyAs(alice, curve, 2_000 ether);
        buyAs(bob, curve, 2_000 ether);
        curve.sweepFees();
        uint256 aliceEarned = token.claimable(alice);
        assertGt(aliceEarned, 0);

        vm.prank(alice);
        token.transfer(carol, aliceTokens);

        assertEq(token.claimable(alice), aliceEarned, "transfer stole accrued rewards");
        assertEq(token.claimable(carol), 0, "recipient inherited unearned rewards");

        // A further trade funds the next distribution; carol now holds the
        // balance that earns it.
        buyAs(bob, curve, 500 ether);
        curve.sweepFees();
        assertGt(token.claimable(carol), 0, "recipient earns nothing after receiving");
        assertEq(token.claimable(alice), aliceEarned);
    }

    // -----------------------------------------------------------------
    // Funding edges
    // -----------------------------------------------------------------

    /// @notice Rewards arriving while nothing is eligible are buffered, not
    /// lost, and reach the first real holders.
    function test_rewardsBeforeAnyHolderAreBufferedNotLost() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);

        // Donate straight into the token while the curve holds everything.
        quote.mint(address(token), 100 ether);
        token.sync();
        assertEq(token.rewardPerTokenAcc(), 0);
        assertEq(token.reservedRewards(), 0);

        skipSnipeWindow();
        buyAs(alice, curve, 1_000 ether);
        token.sync();
        // The buffered donation is now apportioned to the only holder.
        assertApproxEqRel(token.claimable(alice), 100 ether, 0.0001e18);
    }

    /// @notice Anyone can top up the pot with a plain transfer; a creator or
    /// community can fund holders without the protocol's involvement.
    function test_anyoneCanDonateRewards() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 0);
        skipSnipeWindow();
        buyAs(alice, curve, 1_000 ether);

        quote.mint(bob, 50 ether);
        vm.prank(bob);
        quote.transfer(address(token), 50 ether);
        token.sync();

        assertApproxEqRel(token.claimable(alice), 50 ether, 0.001e18);
    }

    function test_claimRevertsWithNothingOwed() public {
        (PopRewardToken token,) = _launchRewards(10_000, 200);
        vm.prank(alice);
        vm.expectRevert(PopRewardToken.NothingToClaim.selector);
        token.claim();
    }

    /// @notice The pot is never over-committed: the sum of every claim can
    /// never exceed what was actually contributed.
    function test_solvency_claimsNeverExceedFunding() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);
        skipSnipeWindow();

        buyAs(alice, curve, 1_500 ether);
        buyAs(bob, curve, 900 ether);
        curve.sweepFees();
        buyAs(carol, curve, 2_100 ether);
        curve.sweepFees();
        sellAs(bob, curve, token.balanceOf(bob) / 2);
        curve.sweepFees();

        uint256 funded = quote.balanceOf(address(token));
        uint256 owed = token.claimable(alice) + token.claimable(bob) + token.claimable(carol);
        assertLe(owed, funded, "token owes more than it holds");

        vm.prank(alice);
        token.claim();
        vm.prank(bob);
        token.claim();
        vm.prank(carol);
        token.claim();
        // Whatever remains is unapportioned dust, never a deficit.
        assertGe(quote.balanceOf(address(token)), 0);
        assertLe(
            quote.balanceOf(address(token)),
            funded / 1_000 + 1_000,
            "an implausible share of the pot was left unclaimable"
        );
    }

    // -----------------------------------------------------------------
    // Graduation
    // -----------------------------------------------------------------

    /// @notice Rewards survive graduation: the pool's float is excluded, the
    /// hook keeps pushing, and holders keep claiming.
    function test_rewardsContinueAfterGraduation() public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);
        skipSnipeWindow();
        buyAs(alice, curve, 2_000 ether);
        uint256 earnedOnCurve = token.claimable(alice);

        buyOut(bob, curve);
        assertTrue(curve.graduated());
        factory.createGraduatedPool(address(token));
        assertEq(uint8(factory.getLaunchedToken(address(token)).phase), uint8(GraduationPhase.PoolCreated));

        // Alice kept everything she earned pre-graduation, and the pool's own
        // liquidity does not dilute her.
        assertGe(token.claimable(alice), earnedOnCurve);
        assertEq(token.claimable(address(poolManager)), 0);
        assertEq(token.claimable(address(locker)), 0);

        vm.prank(alice);
        assertGt(token.claim(), 0);
    }

    // -----------------------------------------------------------------
    // Fuzz
    // -----------------------------------------------------------------

    /// @notice Across randomized trading, the token never promises more than
    /// it holds.
    function testFuzz_neverOwesMoreThanItHolds(uint96 a, uint96 b, uint96 c) public {
        (PopRewardToken token, PopBondingCurve curve) = _launchRewards(10_000, 200);
        skipSnipeWindow();

        uint256 spendA = 1e15 + (uint256(a) % 5_000 ether);
        uint256 spendB = 1e15 + (uint256(b) % 5_000 ether);
        uint256 spendC = 1e15 + (uint256(c) % 5_000 ether);

        buyAs(alice, curve, spendA);
        buyAs(bob, curve, spendB);
        curve.sweepFees();
        buyAs(carol, curve, spendC);
        curve.sweepFees();

        uint256 owed = token.claimable(alice) + token.claimable(bob) + token.claimable(carol);
        assertLe(owed, quote.balanceOf(address(token)));
    }
}

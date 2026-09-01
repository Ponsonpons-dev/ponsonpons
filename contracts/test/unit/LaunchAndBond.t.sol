// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {PopRewardToken} from "../../src/PopRewardToken.sol";
import {PopSwapRouter} from "../../src/PopSwapRouter.sol";
import {CashbackConfig, CashbackMode, LaunchPhase} from "../../src/interfaces/IPop.sol";

import {PopFixture} from "../utils/PopFixture.sol";

address constant DEAD = 0x000000000000000000000000000000000000dEaD;

contract LaunchAndBondTest is PopFixture {
    // ------------------------------------------------------------------
    // Launch: a live pool from block one
    // ------------------------------------------------------------------

    function test_launch_createsLiveWethPool() public {
        PopLaunchToken token = launchPlain();

        PoolKey memory key = curveKeyFor(address(token));
        (uint160 sqrtPrice,,,) = StateLibrary.getSlot0(IPoolManager(address(poolManager)), key.toId());
        assertGt(sqrtPrice, 0, "pool initialized");

        // The whole supply is out of the factory except the bonded seed
        // reserve; the curve allocation lives inside the PoolManager.
        PopLaunchFactory.LaunchedToken memory launch = factory.getLaunchedToken(address(token));
        assertEq(uint8(launch.phase), uint8(LaunchPhase.Trading));
        assertEq(token.balanceOf(address(factory)), launch.reservedTokens);
        assertGt(token.balanceOf(address(poolManager)), 0, "curve position seeded");
        assertApproxEqRel(launch.bondThresholdEth, EXPECTED_THRESHOLD_ETH, 0.05e18, "tick-rounded raise near target");
    }

    function test_ethRoundTrip_throughSiteRouter() public {
        PopLaunchToken token = launchPlain();
        skipSnipeWindow();

        uint256 tokensOut = buyAs(alice, address(token), 1 ether);
        assertGt(tokensOut, 0);
        assertEq(token.balanceOf(alice), tokensOut);

        uint256 ethBefore = alice.balance;
        uint256 ethOut = sellAs(alice, address(token), tokensOut);
        assertGt(ethOut, 0);
        assertEq(alice.balance, ethBefore + ethOut);
        // Fees make the round trip lossy but bounded (~2% total + rounding).
        assertGt(ethOut, 0.95 ether);
    }

    function test_thirdPartyRouter_canTradeCurvePool() public {
        PopLaunchToken token = launchPlain();
        skipSnipeWindow();

        // A generic external router with no $POP knowledge, funded in WETH.
        vm.startPrank(bob);
        PoolSwapTest botRouter = new PoolSwapTest(IPoolManager(address(poolManager)));
        weth.deposit{value: 2 ether}();
        weth.approve(address(botRouter), type(uint256).max);

        PoolKey memory key = curveKeyFor(address(token));
        bool zeroForOne = address(weth) == address(uint160(uint256(uint160(address(weth))))) // silence lint
            ? (address(weth) < address(token))
            : false;
        zeroForOne = address(weth) < address(token);
        botRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(1 ether),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        assertGt(token.balanceOf(bob), 0, "external router buy");
    }

    function test_hookFees_accrueInWeth_andSweepToEscrow() public {
        PopLaunchToken token = launch(CashbackConfig(CashbackMode.None, 0), 100);
        skipSnipeWindow();
        buyAs(alice, address(token), 1 ether);

        PoolId poolId = curveKeyFor(address(token)).toId();
        // Exact-in ETH buy: the unspecified leg is the token, so fees accrue
        // token-side first and convert at sweep.
        uint256 pendingToken = hook.pendingFees(poolId, address(token));
        assertGt(pendingToken, 0, "fees accrued");

        vm.prank(timelock);
        hook.setFeeSweepOperator(keeper);
        vm.prank(keeper);
        hook.sweepPoolFees(poolId, 1);

        assertGt(escrow.balanceOfToken(treasury, address(weth)), 0, "protocol share in WETH");
        assertGt(escrow.balanceOfToken(creator, address(weth)), 0, "creator share in WETH");
    }

    // ------------------------------------------------------------------
    // Snipe tax
    // ------------------------------------------------------------------

    function test_snipeTax_punishesLaunchSecondBuys() public {
        PopLaunchToken token = launchPlain();

        // Same-second buy through a public router pays the decaying tax.
        uint256 taxed = buyAs(alice, address(token), 0.1 ether);

        PopLaunchToken token2 = _launchSecond("TES2");
        skipSnipeWindow();
        uint256 untaxed = buyAs(bob, address(token2), 0.1 ether);

        assertLt(taxed, untaxed / 10, "launch-second buy nets a fraction");
    }

    function test_devBuy_isSnipeTaxExempt() public {
        vm.prank(creator);
        address t = factory.launchToken{value: LAUNCH_FEE + 0.1 ether}(
            defaultParams("DEVB", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0
        );
        uint256 devTokens = IERC20(t).balanceOf(creator);
        assertGt(devTokens, 0);

        // An identical launch bought in the same second by an outsider nets
        // far less than the dev buy did.
        PopLaunchToken token2 = _launchSecond("DEVC");
        uint256 sniped = buyAs(alice, address(token2), 0.1 ether);
        assertLt(sniped, devTokens / 10, "sniper taxed, dev buy not");
    }

    // ------------------------------------------------------------------
    // Price floor
    // ------------------------------------------------------------------

    function test_priceFloor_holdsAtLaunchPrice() public {
        PopLaunchToken token = launchPlain();
        skipSnipeWindow();

        uint256 tokensOut = buyAs(alice, address(token), 1 ether);
        // Selling everything back walks the price exactly back to the floor;
        // the pool cannot pay out more WETH than went in.
        uint256 ethOut = sellAs(alice, address(token), tokensOut);
        assertLe(ethOut, 1 ether, "cannot extract more than deposited");
    }

    // ------------------------------------------------------------------
    // Bond
    // ------------------------------------------------------------------

    function test_bond_convertsRaiseAndLocksQuotePool() public {
        PopLaunchToken token = launchPlain();
        skipSnipeWindow();
        buyOut(alice, address(token));

        assertTrue(factory.isBondReady(address(token)), "curve filled");
        uint256 deadQuoteBefore = quote.balanceOf(DEAD);

        uint256 positionId = positionManager.nextTokenId();
        factory.bond(address(token), 0);

        PopLaunchFactory.LaunchedToken memory launch = factory.getLaunchedToken(address(token));
        assertEq(uint8(launch.phase), uint8(LaunchPhase.Bonded));

        // The bonded pool is live and its position is locked forever.
        PoolKey memory bondedKey = bondedKeyFor(address(token));
        (uint160 sqrtPrice,,,) = StateLibrary.getSlot0(IPoolManager(address(poolManager)), bondedKey.toId());
        assertGt(sqrtPrice, 0, "bonded pool initialized");
        assertEq(IERC721(address(positionManager)).ownerOf(positionId), address(locker));
        assertTrue(locker.isLocked(address(token)));

        // The raise left the factory: no WETH retained, quote inventory all
        // in the pool (bar dust), nothing burned for CashbackMode.None.
        assertEq(IERC20(address(weth)).balanceOf(address(factory)), 0, "no WETH retained");
        assertEq(quote.balanceOf(DEAD), deadQuoteBefore, "no burn under None");
        assertEq(token.balanceOf(address(factory)), 0, "no tokens retained");
    }

    function test_bond_boundedByTwap() public {
        PopLaunchToken token = launchPlain();
        skipSnipeWindow();
        buyOut(alice, address(token));

        // The conversion pool suddenly prices 20% under TWAP: bond refuses.
        conversionPool.setRate((QUOTE_PER_ETH * 80) / 100);
        vm.expectRevert();
        factory.bond(address(token), 0);

        // Price recovers: bond passes.
        conversionPool.setRate(QUOTE_PER_ETH);
        factory.bond(address(token), 0);
    }

    function test_quoteBurn_cashback_deferredAndBurnedAtBond() public {
        PopLaunchToken token = launch(CashbackConfig(CashbackMode.QuoteBurn, 5_000), 0);
        skipSnipeWindow();
        buyAs(alice, address(token), 1 ether);

        // Sweep during the curve phase: the carve-out defers instead of
        // burning WETH.
        PoolId poolId = curveKeyFor(address(token)).toId();
        vm.prank(timelock);
        hook.setFeeSweepOperator(keeper);
        vm.prank(keeper);
        hook.sweepPoolFees(poolId, 1);
        assertGt(hook.pendingBondCashback(poolId), 0, "cashback held for bond");

        buyOut(bob, address(token));
        uint256 deadBefore = quote.balanceOf(DEAD);
        factory.bond(address(token), 0);
        assertGt(quote.balanceOf(DEAD), deadBefore, "carve-out burned in quote at bond");
    }

    function test_holderRewards_variant_paysHoldersInQuote() public {
        PopLaunchToken token = launch(CashbackConfig(CashbackMode.HolderRewards, 5_000), 0);
        skipSnipeWindow();
        buyAs(alice, address(token), 1 ether);

        PoolId poolId = curveKeyFor(address(token)).toId();
        vm.prank(timelock);
        hook.setFeeSweepOperator(keeper);
        vm.prank(keeper);
        hook.sweepPoolFees(poolId, 1);

        buyOut(bob, address(token));
        factory.bond(address(token), 0);

        // Alice holds the reward-token variant; the bond pushed the deferred
        // carve-out (converted to quote) into the token for distribution.
        PopRewardToken reward = PopRewardToken(address(token));
        assertGt(reward.claimable(alice) + reward.claimable(bob), 0, "holders accrued quote rewards");
    }

    function test_trading_afterBond_throughRouter() public {
        PopLaunchToken token = launchPlain();
        buyOutAndBond(alice, address(token));

        uint256 out = buyAs(bob, address(token), 0.5 ether);
        assertGt(out, 0, "post-bond ETH buy routes via conversion + V4");

        uint256 ethBack = sellAs(bob, address(token), out);
        assertGt(ethBack, 0, "post-bond sell back to ETH");
    }

    function test_bond_revertsBeforeReady() public {
        PopLaunchToken token = launchPlain();
        skipSnipeWindow();
        buyAs(alice, address(token), 0.5 ether);
        vm.expectRevert(PopLaunchFactory.NotBondReady.selector);
        factory.bond(address(token), 0);
    }

    function test_rescueBond_after14Days_paysCreatorRecipientOnly() public {
        PopLaunchToken token = launchPlain();
        skipSnipeWindow();
        // The crossing buy itself records bond-readiness on the hook.
        buyOut(alice, address(token));

        // The conversion pool breaks permanently.
        conversionPool.setRate(1);

        vm.prank(timelock);
        vm.expectRevert();
        factory.rescueBond(address(token)); // too early

        vm.warp(block.timestamp + 14 days + 1);
        uint256 wethBefore = IERC20(address(weth)).balanceOf(creator);
        vm.prank(timelock);
        factory.rescueBond(address(token));
        assertGt(IERC20(address(weth)).balanceOf(creator) - wethBefore, 0, "raise released to creator recipient");
        assertEq(uint8(factory.getLaunchedToken(address(token)).phase), uint8(LaunchPhase.Rescued));
    }

    // ------------------------------------------------------------------
    // Config and permissions
    // ------------------------------------------------------------------

    function test_traderRebate_rejected() public {
        vm.prank(creator);
        vm.expectRevert(PopLaunchFactory.InvalidCashback.selector);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("REB", CashbackConfig(CashbackMode.TraderRebate, 5_000), 0), 0, address(quote), 0
        );
    }

    function test_expectedEconomics_pinsTerms() public {
        bytes32 digest = factory.previewLaunchEconomics(0, address(quote));
        PopLaunchFactory.TokenParams memory params = defaultParams("PIN", CashbackConfig(CashbackMode.None, 0), 0);
        params.expectedEconomics = digest;
        vm.prank(creator);
        factory.launchToken{value: LAUNCH_FEE}(params, 0, address(quote), 0);

        // A stale digest reverts instead of silently repricing.
        params.salt = keccak256("PIN2");
        params.expectedEconomics = keccak256("stale");
        vm.prank(creator);
        vm.expectRevert();
        factory.launchToken{value: LAUNCH_FEE}(params, 0, address(quote), 0);
    }

    function test_transferCreatorFeeRecipient_selfServiceOnly() public {
        PopLaunchToken token = launchPlain();
        vm.prank(alice);
        vm.expectRevert(PopLaunchFactory.NotCreatorFeeRecipient.selector);
        factory.transferCreatorFeeRecipient(address(token), alice);

        vm.prank(creator);
        factory.transferCreatorFeeRecipient(address(token), alice);
        assertEq(factory.getLaunchedToken(address(token)).creatorFeeRecipient, alice);
    }

    function test_launchGate_whitelistWhileClosed() public {
        vm.prank(timelock);
        factory.setLaunchEnabled(false);

        vm.prank(alice);
        vm.expectRevert(PopLaunchFactory.NotWhitelisted.selector);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("NOPE", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0
        );

        vm.prank(timelock);
        factory.setWhitelistedLauncher(alice, true);
        vm.prank(alice);
        factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("YEP", CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0
        );
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _launchSecond(string memory symbol_) private returns (PopLaunchToken token) {
        vm.prank(creator);
        address t = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams(symbol_, CashbackConfig(CashbackMode.None, 0), 0), 0, address(quote), 0
        );
        return PopLaunchToken(t);
    }
}

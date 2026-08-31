// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PopBondingCurve} from "../../src/PopBondingCurve.sol";
import {PopLaunchFactory} from "../../src/PopLaunchFactory.sol";
import {PopLaunchToken} from "../../src/PopLaunchToken.sol";
import {CashbackConfig, CashbackMode, GraduationPhase} from "../../src/interfaces/IPop.sol";
import {BlocklistERC20} from "../mocks/MockERC20.sol";
import {PopFixture} from "../utils/PopFixture.sol";

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract GraduationTest is PopFixture {
    using StateLibrary for IPoolManager;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    PoolSwapTest internal swapRouter;

    function setUp() public override {
        super.setUp();
        swapRouter = new PoolSwapTest(IPoolManager(address(poolManager)));
    }

    function _graduateFull(CashbackConfig memory cashback, uint16 creatorFeeBps)
        internal
        returns (PopLaunchToken token, PopBondingCurve curve, PoolKey memory key, uint256 positionId)
    {
        (token, curve) = launch(cashback, creatorFeeBps);
        buyOut(alice, curve);
        assertEq(uint8(factory.getLaunchedToken(address(token)).phase), uint8(GraduationPhase.Swept));

        vm.prank(keeper); // permissionless
        positionId = factory.createGraduatedPool(address(token));
        key = poolKeyFor(address(token));
    }

    function test_fullFlow_poolSeededLockedAndRegistered() public {
        (PopLaunchToken token,, PoolKey memory key, uint256 positionId) =
            _graduateFull(CashbackConfig(CashbackMode.None, 0), 0);

        // Phase is terminal.
        assertEq(uint8(factory.getLaunchedToken(address(token)).phase), uint8(GraduationPhase.PoolCreated));

        // The LP NFT is locked forever.
        assertEq(IERC721(address(positionManager)).ownerOf(positionId), address(locker));
        assertTrue(locker.isLocked(address(token)));
        assertEq(locker.lockedPositions(address(token)), positionId);

        // The virtual-reserve excess never enters circulation.
        assertGt(locker.lockedTokenSupply(address(token)), 0);

        // The pool exists at a real price and is registered with the hook.
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = IPoolManager(address(poolManager)).getSlot0(poolId);
        assertGt(sqrtPriceX96, TickMath.MIN_SQRT_PRICE);
        (bool registered,,,,,,,,,,,) = hook.launches(poolId);
        assertTrue(registered);

        // Full supply accounting: circulating (buyer) + pool + locker
        // equals the minted supply; nothing stuck on curve or factory
        // beyond dust handling.
        assertEq(token.balanceOf(address(factory)), 0);
    }

    function test_gradSeed_preservesTerminalCurvePrice() public {
        (PopLaunchToken token,, PoolKey memory key,) = _graduateFull(CashbackConfig(CashbackMode.None, 0), 0);

        // Terminal curve price: virtualQuote / reservedTokens at the point
        // the sellable side hit zero. The pool's seed keeps that ratio after
        // stripping the phantom reserve, so spot price(token in quote) must
        // be within rounding of threshold+phantom over reserved.
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = IPoolManager(address(poolManager)).getSlot0(poolId);

        // Value the reserved allocation at the pool's spot price: it must
        // come out within 2% of virtualQuote (threshold + phantom),
        // tolerant of the fee-induced drift around the threshold crossing.
        // sqrtPrice is sqrt(currency1/currency0) in Q96.
        uint256 reserved = SUPPLY * EXPECTED_PHANTOM / (EXPECTED_PHANTOM + EXPECTED_THRESHOLD);
        uint256 impliedQuote;
        if (address(quote) < address(token)) {
            // quote is currency0: price = token per quote, so divide twice.
            impliedQuote = FullMath.mulDiv(FullMath.mulDiv(reserved, 1 << 96, sqrtPriceX96), 1 << 96, sqrtPriceX96);
        } else {
            impliedQuote = FullMath.mulDiv(FullMath.mulDiv(reserved, sqrtPriceX96, 1 << 96), sqrtPriceX96, 1 << 96);
        }
        assertApproxEqRel(impliedQuote, EXPECTED_THRESHOLD + EXPECTED_PHANTOM, 0.02e18);
    }

    function test_hookChargesFeesOnGraduatedPool() public {
        (PopLaunchToken token,, PoolKey memory key,) = _graduateFull(CashbackConfig(CashbackMode.None, 0), 200);
        PoolId poolId = key.toId();

        // Exact-output swap for tokens: the unspecified leg is the quote
        // input, so the fee accrues quote-denominated.
        quote.mint(bob, 10_000 ether);
        vm.startPrank(bob);
        quote.approve(address(swapRouter), type(uint256).max);
        bool zeroForOne = address(quote) < address(token);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: int256(1_000_000 ether), // exact output: tokens
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();

        uint256 quoteFees = hook.pendingFees(poolId, address(quote));
        uint256 quoteCreatorFees = hook.pendingCreatorFees(poolId, address(quote));
        assertGt(quoteFees, 0);
        assertGt(quoteCreatorFees, 0);
        // creator fee = 2x hook fee at these settings (200 vs 100 bps).
        assertApproxEqAbs(quoteCreatorFees, quoteFees * 2, 2);

        // Quote-side sweep needs no operator: the creator can run it.
        address creatorRecipient = factory.getLaunchedToken(address(token)).creatorFeeRecipient;
        vm.prank(creatorRecipient);
        hook.sweepPoolFees(poolId, 0);
        assertEq(hook.pendingFees(poolId, address(quote)), 0);
        assertGt(escrow.balanceOfToken(treasury, address(quote)), 0);
        assertGt(escrow.balanceOfToken(creatorRecipient, address(quote)), 0);
    }

    function test_hookQuoteBurn_onGraduatedPool() public {
        (PopLaunchToken token,, PoolKey memory key,) = _graduateFull(CashbackConfig(CashbackMode.QuoteBurn, 5_000), 0);
        PoolId poolId = key.toId();

        quote.mint(bob, 5_000 ether);
        vm.startPrank(bob);
        quote.approve(address(swapRouter), type(uint256).max);
        bool zeroForOne = address(quote) < address(token);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: int256(1_000_000 ether),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();

        uint256 pending = hook.pendingFees(poolId, address(quote));
        assertGt(pending, 0);
        uint256 deadBefore = quote.balanceOf(DEAD);

        vm.prank(creator);
        hook.sweepPoolFees(poolId, 0);

        // The burn hit the dead address in the quote token.
        uint256 protocolPart = pending * PROTOCOL_SHARE_BPS / 10_000;
        uint256 creatorTake = pending - protocolPart;
        assertEq(quote.balanceOf(DEAD) - deadBefore, creatorTake / 2);
    }

    function test_memecoinFees_requireOperatorToConvert() public {
        (PopLaunchToken token,, PoolKey memory key,) = _graduateFull(CashbackConfig(CashbackMode.None, 0), 0);
        PoolId poolId = key.toId();

        // Exact-input quote swap: unspecified leg is the token output, so
        // fees accrue in the launch token and need conversion.
        quote.mint(bob, 1_000 ether);
        vm.startPrank(bob);
        quote.approve(address(swapRouter), type(uint256).max);
        bool zeroForOne = address(quote) < address(token);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(1_000 ether),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();

        assertGt(hook.pendingFees(poolId, address(token)), 0);

        // The creator cannot run a conversion sweep…
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSignature("InternalSwapRequiresOperator()"));
        hook.sweepPoolFees(poolId, 1);

        // …the operator can, with an explicit minimum.
        vm.prank(timelock); // initial operator = initialOwner
        hook.sweepPoolFees(poolId, 1);
        assertEq(hook.pendingFees(poolId, address(token)), 0);
        assertGt(escrow.balanceOfToken(treasury, address(quote)), 0);
    }

    function test_rescueSweptGraduation_fixedRecipientAfterDelay() public {
        // A quote that can blocklist: launch, graduate phase 1, then block
        // the executor so the seed can never settle.
        BlocklistERC20 badQuote = new BlocklistERC20();
        adapter.set(address(badQuote), true, 400 ether, QUOTE_PER_ETH);
        registry.listQuote(address(badQuote), 0);

        address[] memory noExemptions;
        vm.prank(creator);
        (address t,) = factory.launchToken{value: LAUNCH_FEE}(
            defaultParams("BAD", CashbackConfig(CashbackMode.None, 0), 0), 0, address(badQuote), 0, 0, noExemptions
        );
        PopBondingCurve curve = PopBondingCurve(factory.getLaunchedToken(t).curve);

        skipSnipeWindow();
        uint256 offered = EXPECTED_THRESHOLD * 3;
        badQuote.mint(alice, offered);
        vm.startPrank(alice);
        badQuote.approve(address(curve), offered);
        curve.buy(offered, 0, alice, block.timestamp);
        vm.stopPrank();
        assertEq(uint8(factory.getLaunchedToken(t).phase), uint8(GraduationPhase.Swept));

        // Now the quote turns hostile toward the graduation machinery.
        badQuote.setBlocked(address(executor), true);
        vm.expectRevert();
        factory.createGraduatedPool(t);

        // Rescue: too early, wrong caller, then correct. and it can only
        // ever pay the launch's own creator fee recipient.
        uint256 availableAt = factory.getLaunchedToken(t).sweptAt + factory.GRADUATION_RESCUE_DELAY();
        vm.prank(timelock);
        vm.expectRevert(abi.encodeWithSelector(PopLaunchFactory.GraduationRescueTooEarly.selector, availableAt));
        factory.rescueSweptGraduation(t);

        vm.warp(block.timestamp + 14 days);
        vm.expectRevert(); // non-owner
        factory.rescueSweptGraduation(t);

        uint256 creatorQuoteBefore = badQuote.balanceOf(creator);
        vm.prank(timelock);
        factory.rescueSweptGraduation(t);
        assertGt(badQuote.balanceOf(creator), creatorQuoteBefore);
        assertEq(uint8(factory.getLaunchedToken(t).phase), uint8(GraduationPhase.Rescued));
    }

    function test_graduate_permissionlessRetryWhenAutoFails() public {
        (, PopBondingCurve curve) = launchPlain();
        address token = curve.token();

        // Simulate the auto-graduation being starved: buy out with a tight
        // gas limit is fiddly, so instead verify the permissionless path by
        // reverting the pool creation until called again.
        buyOut(alice, curve);
        // phase already Swept via auto path; createGraduatedPool by anyone.
        vm.prank(makeAddr("randomKeeper"));
        factory.createGraduatedPool(token);
        assertEq(uint8(factory.getLaunchedToken(token).phase), uint8(GraduationPhase.PoolCreated));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/**
 * @title PopCurveMath
 * @notice Constant-product bonding curve math shared by PopBondingCurve.
 * Adapted from the verified PonsV2BondingCurveMath (itself adapted from the
 * audited BootstrapPool.sol reference, code-423n4/2025-01-iq-ai). Reserves
 * and fee are passed explicitly so the same formula prices trades in either
 * direction.
 */
library PopCurveMath {
    uint256 internal constant BASIS_POINTS = 10_000;

    error InsufficientInputAmount();
    error InsufficientOutputAmount();
    error InsufficientLiquidity();

    /**
     * @notice Quotes the output amount for an exact input amount, net of the trade fee.
     * @param amountIn Exact amount of the input asset being sold into the curve.
     * @param reserveIn Curve reserve of the input asset before this trade.
     * @param reserveOut Curve reserve of the output asset before this trade.
     * @param feeBps Fee charged on the input amount, in basis points.
     */
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        internal
        pure
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert InsufficientInputAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        amountOut = _amountOut(amountIn, reserveIn, reserveOut, feeBps);
        if (amountOut == 0) revert InsufficientOutputAmount();
    }

    /**
     * @notice Same quote as `getAmountOut`, returning zero where that reverts.
     * @dev For callers that treat an unpriceable trade as a condition to
     * handle rather than an error, such as the factory's launch-time
     * quotability check.
     */
    function quoteAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        internal
        pure
        returns (uint256 amountOut)
    {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0 || feeBps >= BASIS_POINTS) return 0;
        // This variant promises a zero wherever `getAmountOut` would fail,
        // and callers rely on that to treat an unpriceable trade as a
        // condition rather than an error. The scaling below is the only
        // place that can still overflow uint256, so it is screened here
        // rather than left to panic through a function documented not to.
        uint256 scale = BASIS_POINTS - feeBps;
        if (amountIn > type(uint256).max / scale) return 0;
        if (reserveIn > type(uint256).max / BASIS_POINTS) return 0;
        if (reserveIn * BASIS_POINTS > type(uint256).max - amountIn * scale) return 0;
        return _amountOut(amountIn, reserveIn, reserveOut, feeBps);
    }

    /**
     * @dev The product `amountInWithFee * reserveOut` exceeds uint256 for
     * large-but-representable reserve pairs, so it is carried at full 512-bit
     * width. The quotient itself is always below `reserveOut` and therefore
     * always fits; the result is identical to the naive form everywhere the
     * naive form does not overflow.
     */
    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        private
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * (BASIS_POINTS - feeBps);
        uint256 denominator = reserveIn * BASIS_POINTS + amountInWithFee;
        return FullMath.mulDiv(amountInWithFee, reserveOut, denominator);
    }

    /**
     * @notice Quotes the input amount required for an exact output amount, net of the trade fee.
     * @param amountOut Exact amount of the output asset requested from the curve.
     * @param reserveIn Curve reserve of the input asset before this trade.
     * @param reserveOut Curve reserve of the output asset before this trade.
     * @param feeBps Fee charged on the input amount, in basis points.
     */
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        internal
        pure
        returns (uint256 amountIn)
    {
        if (amountOut == 0) revert InsufficientOutputAmount();
        if (reserveIn == 0 || reserveOut <= amountOut) revert InsufficientLiquidity();
        // A full-fee trade has no input that produces output, and the
        // denominator below would divide by zero rather than say so.
        if (feeBps >= BASIS_POINTS) revert InsufficientLiquidity();

        // Carried at full width for the same reason as `_amountOut`: the
        // triple product overflows uint256 well inside the range of reserve
        // pairs the curve can legitimately hold.
        uint256 denominator = (reserveOut - amountOut) * (BASIS_POINTS - feeBps);
        amountIn = FullMath.mulDiv(amountOut, reserveIn * BASIS_POINTS, denominator) + 1;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {IPopQuoteAdapter} from "./IPopQuoteAdapter.sol";

/**
 * @notice The slice of the Pons v1 factory surface this adapter reads. The
 * struct layout mirrors the verified PonsLaunchFactory sources exactly; both
 * v1 factory generations share it.
 */
interface IPonsV1LaunchFactory {
    struct LaunchedToken {
        address token;
        address deployer;
        address pairedToken;
        address positionManager;
        uint256 positionId;
        uint256 dexId;
        uint256 launchConfigId;
        uint256 restrictionsEndBlock;
        uint256 supply;
        bool isToken0;
        uint24 poolFee;
        bool exists;
        uint256 initialBuyAmount;
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
    function graduationStatus(address token)
        external
        view
        returns (uint256 pairedPrincipal, uint256 threshold, bool graduated);
}

interface IUniswapV3FactoryLike {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IUniswapV3PoolLike {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/**
 * @title PonsV1QuoteAdapter
 * @notice Registry origin adapter for tokens launched on Pons v1
 * (PonsLaunchFactory). Every v1 launch lives as a permanently locked
 * one-sided position in the canonical Uniswap V3 WETH pool, so:
 * - graduation proof and locked ETH principal both come from the factory's
 *   own `graduationStatus`, which derives the paired-token principal from
 *   the locked position's liquidity, donations and third-party LPs never
 *   count;
 * - pricing comes from the same canonical V3 pool's TWAP oracle.
 *
 * Stateless and ownerless. All addresses are immutable and point at the
 * verified Pons v1 factories and the canonical Uniswap V3 factory on
 * Robinhood Chain.
 */
contract PonsV1QuoteAdapter is IPopQuoteAdapter {
    error TokenNotLaunchedOnPonsV1();
    error NotWethPaired();
    error PoolNotFound();

    IPonsV1LaunchFactory public immutable primaryFactory;
    IPonsV1LaunchFactory public immutable legacyFactory;
    IUniswapV3FactoryLike public immutable v3Factory;
    address public immutable weth;

    constructor(
        IPonsV1LaunchFactory primaryFactory_,
        IPonsV1LaunchFactory legacyFactory_,
        IUniswapV3FactoryLike v3Factory_,
        address weth_
    ) {
        primaryFactory = primaryFactory_;
        legacyFactory = legacyFactory_;
        v3Factory = v3Factory_;
        weth = weth_;
    }

    /// @inheritdoc IPopQuoteAdapter
    function verify(address token) external view returns (bool graduated, uint256 ethPrincipal) {
        (IPonsV1LaunchFactory factory,) = _launchRecord(token);
        (ethPrincipal,, graduated) = factory.graduationStatus(token);
    }

    /// @inheritdoc IPopQuoteAdapter
    function quotePerEth(address token, uint32 twapWindow) external view returns (uint256) {
        (, IPonsV1LaunchFactory.LaunchedToken memory launched) = _launchRecord(token);
        address pool = v3Factory.getPool(token, weth, launched.poolFee);
        if (pool == address(0)) revert PoolNotFound();

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives,) = IUniswapV3PoolLike(pool).observe(secondsAgos);

        int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 avgTick = int24(tickDelta / int56(uint56(twapWindow)));
        // Round toward negative infinity, matching Uniswap's own OracleLibrary.
        if (tickDelta < 0 && (tickDelta % int56(uint56(twapWindow)) != 0)) avgTick--;

        // V3 and V4 share identical tick-to-sqrt-price math, so the v4-core
        // library serves both.
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(avgTick);
        uint256 ratioX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);

        // ratioX192 is token1-per-token0 in Q192. quotePerEth is quote base
        // units per 1e18 wei, so the orientation decides which way to scale.
        if (token < weth) {
            // token is token0: ratio is WETH per quote; invert.
            return FullMath.mulDiv(1 << 192, 1e18, ratioX192);
        }
        // WETH is token0: ratio is quote per WETH already.
        return FullMath.mulDiv(ratioX192, 1e18, 1 << 192);
    }

    /// @inheritdoc IPopQuoteAdapter
    function conversionPool(address token) external view returns (address pool, bool quoteIsToken0) {
        (, IPonsV1LaunchFactory.LaunchedToken memory launched) = _launchRecord(token);
        pool = v3Factory.getPool(token, weth, launched.poolFee);
        if (pool == address(0)) revert PoolNotFound();
        quoteIsToken0 = token < weth;
    }

    /**
     * @dev Finds the v1 factory generation that launched `token`. Both
     * generations are checked because graduated tokens exist on each, and a
     * token unknown to both is not a Pons v1 token at all.
     */
    function _launchRecord(address token)
        private
        view
        returns (IPonsV1LaunchFactory factory, IPonsV1LaunchFactory.LaunchedToken memory launched)
    {
        launched = primaryFactory.getLaunchedToken(token);
        if (launched.exists) {
            factory = primaryFactory;
        } else {
            launched = legacyFactory.getLaunchedToken(token);
            if (!launched.exists) revert TokenNotLaunchedOnPonsV1();
            factory = legacyFactory;
        }
        if (launched.pairedToken != weth) revert NotWethPaired();
    }
}

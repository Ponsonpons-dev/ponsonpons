// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {PopLaunchFactory} from "./PopLaunchFactory.sol";
import {IPopQuoteRegistry, LaunchPhase} from "./interfaces/IPop.sol";

interface IWETHRouter {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IUniswapV3PoolSwap {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/**
 * @title PopSwapRouter
 * @notice Convenience router for $POP launches: one call in, tokens out,
 * paid in plain ETH, whatever phase the launch is in.
 * - Pre-bond: wraps the ETH and swaps the launch's live WETH curve pool.
 * - Post-bond: wraps the ETH, market-buys the launch's quote token on its
 *   origin V3 pool, then swaps the bonded token/quote V4 pool.
 * Selling mirrors both routes and hands back ETH.
 *
 * Fully stateless and permissionless: it holds no funds between calls, has
 * no owner, and every pool it touches is derived on-chain from the factory
 * and registry. Trading bots that do not want to integrate Uniswap V4
 * routing directly can integrate these two functions instead.
 */
contract PopSwapRouter is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error DeadlineExpired();
    error ZeroAmount();
    error SlippageExceeded(uint256 actual, uint256 minimum);
    error NotPoolManager();
    error NotConversionPool();
    error EthTransferFailed();
    error LaunchNotTradeable();

    IPoolManager public immutable poolManager;
    PopLaunchFactory public immutable factory;
    IPopQuoteRegistry public immutable quoteRegistry;
    address public immutable weth;

    address private _conversionPoolInFlight;

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    constructor(PopLaunchFactory factory_) {
        factory = factory_;
        poolManager = factory_.poolManager();
        quoteRegistry = factory_.quoteRegistry();
        weth = factory_.weth();
    }

    receive() external payable {
        // Only the WETH contract sends ETH here (on withdraw).
    }

    /**
     * @notice Buys `token` with the ETH sent, routing by the launch's phase.
     * @return tokensOut Launch tokens delivered to the caller.
     */
    function buyWithEth(address token, uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        checkDeadline(deadline)
        returns (uint256 tokensOut)
    {
        if (msg.value == 0) revert ZeroAmount();
        IWETHRouter(weth).deposit{value: msg.value}();

        (PoolKey memory key, bool bonded) = _tradeKey(token);
        uint256 amountIn = msg.value;
        Currency inCurrency = Currency.wrap(weth);
        if (bonded) {
            address quote = factory.getLaunchedToken(token).quoteToken;
            amountIn = _v3Swap(quote, true, amountIn);
            inCurrency = Currency.wrap(quote);
        }

        tokensOut = _v4SwapExactIn(key, inCurrency, Currency.wrap(token), amountIn, msg.sender);
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        // A partial fill (the curve range's edge was hit) leaves unconsumed
        // input with this router; hand it straight back.
        _refundResidual(Currency.unwrap(inCurrency));
    }

    /**
     * @notice Sells `tokenIn` launch tokens for ETH, routing by the launch's
     * phase. Approve this router for the launch token first.
     * @return ethOut Wei delivered to the caller.
     */
    function sellForEth(address token, uint256 tokenIn, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        checkDeadline(deadline)
        returns (uint256 ethOut)
    {
        if (tokenIn == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenIn);

        (PoolKey memory key, bool bonded) = _tradeKey(token);
        Currency outCurrency = Currency.wrap(weth);
        if (bonded) outCurrency = Currency.wrap(factory.getLaunchedToken(token).quoteToken);

        uint256 outAmount = _v4SwapExactIn(key, Currency.wrap(token), outCurrency, tokenIn, address(this));
        if (bonded) {
            outAmount = _v3Swap(Currency.unwrap(outCurrency), false, outAmount);
        }

        IWETHRouter(weth).withdraw(outAmount);
        ethOut = outAmount;
        if (ethOut < minEthOut) revert SlippageExceeded(ethOut, minEthOut);
        (bool sent,) = payable(msg.sender).call{value: ethOut}("");
        if (!sent) revert EthTransferFailed();

        // A partial fill (a curve sell that reached the launch-price floor)
        // leaves unconsumed launch tokens here; hand them straight back.
        _refundResidual(token);
    }

    /**
     * @dev Returns any balance of `tokenAddr` this router is left holding to
     * the caller. WETH residue is unwrapped back to ETH first.
     */
    function _refundResidual(address tokenAddr) private {
        uint256 residue = IERC20(tokenAddr).balanceOf(address(this));
        if (residue == 0) return;
        if (tokenAddr == weth) {
            IWETHRouter(weth).withdraw(residue);
            (bool sent,) = payable(msg.sender).call{value: residue}("");
            if (!sent) revert EthTransferFailed();
        } else {
            IERC20(tokenAddr).safeTransfer(msg.sender, residue);
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _tradeKey(address token) private view returns (PoolKey memory key, bool bonded) {
        LaunchPhase phase = factory.getLaunchedToken(token).phase;
        if (phase == LaunchPhase.Trading) {
            return (factory.curvePoolKey(token), false);
        }
        if (phase == LaunchPhase.Bonded) {
            return (factory.bondedPoolKey(token), true);
        }
        revert LaunchNotTradeable();
    }

    /**
     * @dev Exact-input swap on the quote's origin V3 pool. `wethIn` true
     * converts WETH held by this router into the quote; false converts the
     * quote into WETH. Returns the output amount.
     */
    function _v3Swap(address quote, bool wethIn, uint256 amountIn) private returns (uint256 amountOut) {
        (address pool,) = quoteRegistry.bondConversion(quote);
        address tokenOut = wethIn ? quote : weth;
        bool zeroForOne = wethIn ? weth < quote : quote < weth;
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        _conversionPoolInFlight = pool;
        IUniswapV3PoolSwap(pool).swap(
            address(this),
            zeroForOne,
            SafeCast.toInt256(amountIn),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            abi.encode(wethIn ? weth : quote)
        );
        _conversionPoolInFlight = address(0);
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != _conversionPoolInFlight) revert NotConversionPool();
        address payToken = abi.decode(data, (address));
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(payToken).safeTransfer(msg.sender, owed);
    }

    function _v4SwapExactIn(
        PoolKey memory key,
        Currency inCurrency,
        Currency outCurrency,
        uint256 amountIn,
        address recipient
    ) private returns (uint256 amountOut) {
        bytes memory result =
            poolManager.unlock(abi.encode(key, inCurrency, outCurrency, amountIn, recipient));
        amountOut = abi.decode(result, (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, Currency inCurrency, Currency outCurrency, uint256 amountIn, address recipient) =
            abi.decode(data, (PoolKey, Currency, Currency, uint256, address));

        bool zeroForOne = Currency.unwrap(key.currency0) == Currency.unwrap(inCurrency);
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -SafeCast.toInt256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        int128 outDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 amountOut = outDelta > 0 ? uint256(uint128(outDelta)) : 0;
        if (amountOut != 0) poolManager.take(outCurrency, recipient, amountOut);

        // Pay the input leg (and any residual, e.g. a partial fill's unspent
        // input never arises with exact-in, but settle defensively).
        _settleCurrency(key.currency0);
        _settleCurrency(key.currency1);
        return abi.encode(amountOut);
    }

    function _settleCurrency(Currency currency) private {
        int256 delta = TransientStateLibrary.currencyDelta(poolManager, address(this), currency);
        if (delta < 0) {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), uint256(-delta));
            poolManager.settle();
        } else if (delta > 0) {
            poolManager.take(currency, address(this), uint256(delta));
        }
    }
}

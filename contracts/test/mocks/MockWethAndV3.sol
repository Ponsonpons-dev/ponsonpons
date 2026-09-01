// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice Minimal WETH9 stand-in for unit tests.
contract MockWETH is ERC20 {
    error EthSendFailed();

    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert EthSendFailed();
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

interface IV3SwapCallbackLike {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/**
 * @notice Fixed-rate stand-in for a quote token's canonical V3 WETH pool:
 * executes exact-input swaps at exactly `quotePerEth` with no price impact
 * (so the TWAP-bounded conversions in the factory and splitter pass), pays
 * from its own inventory, and collects the input through the standard V3
 * callback. Deliberately price-static: manipulation scenarios are exercised
 * by re-pricing the pool between calls via `setRate`.
 */
contract MockV3ConversionPool {
    error CallbackUnderpaid();

    address public immutable weth;
    address public immutable quote;
    uint256 public quotePerEth; // quote base units per 1e18 wei

    constructor(address weth_, address quote_, uint256 quotePerEth_) {
        weth = weth_;
        quote = quote_;
        quotePerEth = quotePerEth_;
    }

    function setRate(uint256 quotePerEth_) external {
        quotePerEth = quotePerEth_;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "exact-in only");
        uint256 amountIn = uint256(amountSpecified);

        address token0 = weth < quote ? weth : quote;
        address tokenIn = zeroForOne ? token0 : (token0 == weth ? quote : weth);
        bool wethIn = tokenIn == weth;
        uint256 amountOut = wethIn
            ? FullMath.mulDiv(amountIn, quotePerEth, 1e18)
            : FullMath.mulDiv(amountIn, 1e18, quotePerEth);
        address tokenOut = wethIn ? quote : weth;

        IERC20(tokenOut).transfer(recipient, amountOut);

        int256 inDelta = int256(amountIn);
        int256 outDelta = -int256(amountOut);
        (amount0, amount1) = zeroForOne ? (inDelta, outDelta) : (outDelta, inDelta);

        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));
        IV3SwapCallbackLike(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        if (IERC20(tokenIn).balanceOf(address(this)) < balanceBefore + amountIn) revert CallbackUnderpaid();
    }
}

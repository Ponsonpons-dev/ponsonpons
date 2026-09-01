// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPopQuoteAdapter} from "../../src/adapters/IPopQuoteAdapter.sol";

/// @notice Test stand-in for an origin adapter: graduation state, locked
/// principal, TWAP price, and the conversion pool are all settable per
/// token.
contract MockQuoteAdapter is IPopQuoteAdapter {
    error NoPool();

    struct Config {
        bool graduated;
        uint256 ethPrincipal;
        uint256 quotePerEth;
        address pool;
    }

    address public immutable weth;

    mapping(address => Config) public configs;

    constructor(address weth_) {
        weth = weth_;
    }

    function set(address token, bool graduated, uint256 ethPrincipal, uint256 quotePerEth_) external {
        Config storage c = configs[token];
        c.graduated = graduated;
        c.ethPrincipal = ethPrincipal;
        c.quotePerEth = quotePerEth_;
    }

    function setPool(address token, address pool) external {
        configs[token].pool = pool;
    }

    function verify(address token) external view returns (bool graduated, uint256 ethPrincipal) {
        Config memory c = configs[token];
        return (c.graduated, c.ethPrincipal);
    }

    function quotePerEth(address token, uint32) external view returns (uint256) {
        return configs[token].quotePerEth;
    }

    function conversionPool(address token) external view returns (address pool, bool quoteIsToken0) {
        pool = configs[token].pool;
        if (pool == address(0)) revert NoPool();
        quoteIsToken0 = token < weth;
    }
}

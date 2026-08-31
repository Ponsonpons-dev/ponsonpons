// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPopQuoteAdapter} from "../../src/adapters/IPopQuoteAdapter.sol";

/// @notice Test stand-in for an origin adapter: graduation state, locked
/// principal, and TWAP price are all settable per token.
contract MockQuoteAdapter is IPopQuoteAdapter {
    struct Config {
        bool graduated;
        uint256 ethPrincipal;
        uint256 quotePerEth;
    }

    mapping(address => Config) public configs;

    function set(address token, bool graduated, uint256 ethPrincipal, uint256 quotePerEth_) external {
        configs[token] = Config(graduated, ethPrincipal, quotePerEth_);
    }

    function verify(address token) external view returns (bool graduated, uint256 ethPrincipal) {
        Config memory c = configs[token];
        return (c.graduated, c.ethPrincipal);
    }

    function quotePerEth(address token, uint32) external view returns (uint256) {
        return configs[token].quotePerEth;
    }
}

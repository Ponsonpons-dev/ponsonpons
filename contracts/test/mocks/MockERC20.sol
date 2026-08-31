// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Freely mintable ERC-20 with configurable decimals, standing in
/// for a graduated Pons quote token in unit tests.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Quote token that skims a fee on every transfer, for testing the
/// fee-on-transfer defenses.
contract FeeOnTransferERC20 is MockERC20 {
    uint256 public feeBps;

    constructor(uint256 feeBps_) MockERC20("FeeToken", "FEE", 18) {
        feeBps = feeBps_;
    }

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps != 0) {
            uint256 skim = (value * feeBps) / 10_000;
            super._update(from, address(0xFEE), skim);
            value -= skim;
        }
        super._update(from, to, value);
    }
}

/// @notice Quote token that can blocklist recipients, for testing the
/// rescue paths.
contract BlocklistERC20 is MockERC20 {
    mapping(address => bool) public blocked;

    constructor() MockERC20("BlockToken", "BLK", 18) {}

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to] && !blocked[from], "BLOCKED");
        super._update(from, to, value);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockERC20} from "./MockERC20.sol";

/**
 * @notice Quote token that calls back into an arbitrary target from inside
 * its own transfer path, standing in for the ERC-777 / callback-token class
 * a permissionless quote registry could eventually admit. Used to prove the
 * curve's reentrancy guards and its post-transferFrom `graduated` re-check
 * actually hold.
 */
contract ReentrantQuote is MockERC20 {
    address public target;
    bytes public payload;
    bool public armed;
    bool public didReenter;
    bool public reentryReverted;

    constructor() MockERC20("Reentrant", "REENT", 18) {}

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (!armed || target == address(0)) return;
        // Fire once, and only on a real transfer, so the callback lands in
        // the middle of the victim's own accounting.
        armed = false;
        didReenter = true;
        (bool ok,) = target.call(payload);
        reentryReverted = !ok;
    }
}

/**
 * @notice Quote token that refuses to send to one address, modelling an
 * upgradeable asset that starts blocklisting the escrow (or the dead
 * address) after it has already been listed. Drives the constrained rescue
 * paths.
 */
contract SelectiveBlocklistQuote is MockERC20 {
    mapping(address => bool) public denied;

    constructor() MockERC20("Denylist", "DENY", 18) {}

    function setDenied(address account, bool value) external {
        denied[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!denied[to], "DENIED_RECIPIENT");
        super._update(from, to, value);
    }
}

/**
 * @notice Both attacks at once: it can fail a transfer to one address, and
 * it can call back into a target from inside its own transfer path.
 *
 * The combination is what reaches `PopBondingCurve.graduate`'s *unguarded*
 * path. Graduation normally rides inside `buy`'s `nonReentrant` scope, where
 * the guard is what stops reentry. Denying the escrow makes that in-line
 * attempt revert, so the curve fills without graduating and the permissionless
 * `factory.graduate` retry runs with no guard held at all, leaving the
 * `graduated` flag, set before the sweep, as the only thing closing the
 * window. This drives exactly that sequence.
 */
contract DeferredReentrantQuote is MockERC20 {
    mapping(address => bool) public denied;
    address public target;
    bytes public payload;
    bool public armed;
    bool public didReenter;
    bool public reentryReverted;

    constructor() MockERC20("Deferred", "DEFR", 18) {}

    function setDenied(address account, bool value) external {
        denied[account] = value;
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!denied[to], "DENIED_RECIPIENT");
        super._update(from, to, value);
        if (!armed || target == address(0)) return;
        armed = false;
        didReenter = true;
        (bool ok,) = target.call(payload);
        reentryReverted = !ok;
    }
}

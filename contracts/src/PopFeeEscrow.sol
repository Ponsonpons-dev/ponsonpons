// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPopFeeEscrow} from "./interfaces/IPop.sol";

/**
 * @title PopFeeEscrow
 * @notice Pull-payment ledger for every quote-token revenue stream on $POP:
 * protocol fees, creator fees, and trader rebates. Curves and the hook credit
 * balances here instead of transferring to recipients directly, so a
 * reverting, gas-griefing, or blocklisted recipient can never wedge trading,
 * a fee sweep, or graduation.
 *
 * Crediting is permissionless because the caller funds the credit: the tokens
 * are pulled from `msg.sender` in the same call. Balances are recorded from
 * the observed balance delta, so a quote asset that under-delivers credits
 * only what actually arrived and can never mint claims on other recipients'
 * funds. The contract has no owner and no rescue path: every token it holds
 * is somebody's claimable balance.
 */
contract PopFeeEscrow is IPopFeeEscrow, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error NothingToClaim();

    event Credited(address indexed recipient, address indexed token, address indexed funder, uint256 amount);
    event Claimed(address indexed recipient, address indexed token, uint256 amount);

    mapping(address recipient => mapping(address token => uint256 amount)) private _balances;

    /**
     * @notice Credits `recipient` with `amount` of `token`, pulled from the
     * caller. Returns the amount actually credited, which is the observed
     * balance delta rather than the requested amount.
     */
    function creditToken(address recipient, address token, uint256 amount)
        external
        nonReentrant
        returns (uint256 credited)
    {
        if (recipient == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) return 0;

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        credited = IERC20(token).balanceOf(address(this)) - balanceBefore;

        _balances[recipient][token] += credited;
        emit Credited(recipient, token, msg.sender, credited);
    }

    /**
     * @notice Claims the caller's entire balance of `token`.
     */
    function claimToken(address token) external returns (uint256 amount) {
        return _claim(token, _balances[msg.sender][token]);
    }

    /**
     * @notice Claims `amount` of the caller's balance of `token`.
     */
    function claimToken(address token, uint256 amount) external returns (uint256) {
        return _claim(token, amount);
    }

    /**
     * @notice Claimable balance of `token` held for `recipient`.
     */
    function balanceOfToken(address recipient, address token) external view returns (uint256) {
        return _balances[recipient][token];
    }

    function _claim(address token, uint256 amount) private nonReentrant returns (uint256) {
        if (amount == 0) revert NothingToClaim();
        // Reverts on underflow when the caller asks for more than they hold.
        _balances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, token, amount);
        return amount;
    }
}

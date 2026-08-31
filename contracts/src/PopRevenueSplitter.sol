// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPopFeeEscrow} from "./interfaces/IPop.sol";

/// @dev The one function the splitter needs from the $POP token: distribute
/// whatever reward-asset balance the token holds to its holders, pro rata.
interface IPopHolderSync {
    function sync() external;
}

/**
 * @title PopRevenueSplitter
 * @notice The protocol's fee recipient. Every launch snapshots the protocol
 * fee recipient at creation, so with this contract wired in from genesis,
 * the protocol's share of every trade on every token accrues here instead of
 * to a wallet, and anyone can split it:
 *
 *   - `holderShareBps` of the reward asset (PONS) goes to the $POP token
 *     contract and is distributed pro rata to every $POP holder by the
 *     token's own `sync()`. No staking, no snapshots, no claims portal.
 *   - The remainder, plus any non-reward asset and the ETH launch fees,
 *     goes to the owner.
 *
 * The holder share starts at 15% and is owner-adjustable in either
 * direction with no timelock; the docs say so in as many words. What the
 * owner cannot do is take custody of the holder share retroactively: a
 * distribution that has happened is on-chain history, and the split only
 * applies to revenue not yet distributed.
 *
 * `popToken` is set once, after $POP launches (this contract must exist
 * before the token it pays, so the wiring is necessarily two-step). Until it
 * is set, everything goes to the owner.
 */
contract PopRevenueSplitter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error InvalidBps();
    error AlreadySet();
    error NothingToDistribute();
    error EthSendFailed();

    event HolderShareUpdated(uint16 holderShareBps);
    event PopTokenSet(address popToken);
    event Distributed(address indexed asset, uint256 toHolders, uint256 toOwner);
    event DistributedEth(uint256 toOwner);

    uint16 private constant BASIS_POINTS = 10_000;

    IPopFeeEscrow public immutable feeEscrow;
    /// @notice The asset holder distributions are paid in ($PONS, the $POP
    /// launch's quote token, which is what the token's `sync()` distributes).
    IERC20 public immutable rewardAsset;

    /// @notice The $POP token contract. Zero until `setPopToken`.
    address public popToken;
    /// @notice Share of claimed reward-asset revenue routed to $POP holders.
    uint16 public holderShareBps;

    constructor(address owner_, IPopFeeEscrow feeEscrow_, IERC20 rewardAsset_, uint16 holderShareBps_) Ownable(owner_) {
        if (address(feeEscrow_) == address(0) || address(rewardAsset_) == address(0)) revert ZeroAddress();
        if (holderShareBps_ > BASIS_POINTS) revert InvalidBps();
        feeEscrow = feeEscrow_;
        rewardAsset = rewardAsset_;
        holderShareBps = holderShareBps_;
        emit HolderShareUpdated(holderShareBps_);
    }

    /// @notice Points the splitter at the launched $POP token. Once.
    function setPopToken(address popToken_) external onlyOwner {
        if (popToken_ == address(0)) revert ZeroAddress();
        if (popToken != address(0)) revert AlreadySet();
        popToken = popToken_;
        emit PopTokenSet(popToken_);
    }

    /// @notice Adjusts the holder share for revenue not yet distributed.
    function setHolderShareBps(uint16 holderShareBps_) external onlyOwner {
        if (holderShareBps_ > BASIS_POINTS) revert InvalidBps();
        holderShareBps = holderShareBps_;
        emit HolderShareUpdated(holderShareBps_);
    }

    /**
     * @notice Claims this contract's accrued balance of `asset` from the fee
     * escrow and splits it. Permissionless: the destinations are fixed by the
     * configuration, so the caller only chooses the timing.
     */
    function distribute(IERC20 asset) external nonReentrant {
        if (feeEscrow.balanceOfToken(address(this), address(asset)) != 0) {
            feeEscrow.claimToken(address(asset));
        }
        uint256 balance = asset.balanceOf(address(this));
        if (balance == 0) revert NothingToDistribute();

        uint256 toHolders = 0;
        if (asset == rewardAsset && popToken != address(0)) {
            toHolders = (balance * holderShareBps) / BASIS_POINTS;
            if (toHolders != 0) {
                asset.safeTransfer(popToken, toHolders);
                IPopHolderSync(popToken).sync();
            }
        }
        uint256 toOwner = balance - toHolders;
        if (toOwner != 0) asset.safeTransfer(owner(), toOwner);
        emit Distributed(address(asset), toHolders, toOwner);
    }

    /// @notice Forwards accumulated ETH (launch-fee sweeps) to the owner.
    function distributeEth() external nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToDistribute();
        (bool ok,) = owner().call{value: balance}("");
        if (!ok) revert EthSendFailed();
        emit DistributedEth(balance);
    }

    receive() external payable {}
}

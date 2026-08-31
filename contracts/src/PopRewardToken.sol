// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PopRewardToken
 * @notice The launch token used by the `HolderRewards` cashback mode: a
 * fixed-supply ERC-20 that also distributes quote-token rewards pro-rata to
 * whoever holds it, continuously and without an operator.
 *
 * It is the one launch-token variant that is not a completely inert ERC-20,
 * and the trade is deliberate and disclosed at creation: rewards can only be
 * apportioned by balance-time, and balance-time can only be measured where
 * balances move. So this token carries a transfer hook. It still has **no
 * owner, no mint, no burn, no pause, no blacklist, and no transfer
 * restriction of any kind**. the hook only ever does accounting, and can
 * neither block a transfer nor change the amount moved. Launches using any
 * other cashback mode get `PopLaunchToken`, which has no hook at all.
 *
 * ## Distribution
 *
 * A standard cumulative-reward accumulator. `rewardPerTokenAcc` tracks
 * reward-asset units owed per eligible token, scaled by `PRECISION`; each
 * account carries the accumulator value it was last settled at, so its owed
 * balance is `balance * (acc - paid)`. Settlement happens on every transfer
 * touching an account, and on claim.
 *
 * ## Eligibility
 *
 * Contracts that structurally hold supply cannot claim, so rewards routed to
 * them would be burnt in place. The excluded set, the bonding curve, the
 * factory and its graduation executor, the locker, the V4 PoolManager, the
 * dead address, and this contract, is fixed at construction and can never
 * be changed by anyone. Excluded balances are removed from `totalEligible`,
 * so the pool's own float does not dilute real holders.
 *
 * ## Funding
 *
 * `sync()` is permissionless and takes no arguments: it credits whatever
 * reward asset has arrived since the last call. The curve and the hook push
 * their holder-reward carve-out with a plain transfer, and anyone, a
 * creator, a community member, an airdropper, can top the pot up the same
 * way. Rewards arriving while nothing is eligible stay buffered, uncounted,
 * until eligible supply exists; rounding dust likewise stays for the next
 * distribution rather than being stranded.
 */
contract PopRewardToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    /// @dev Wide enough that a 6-decimal reward asset spread across an
    /// 18-decimal supply still resolves per-token amounts far below one wei
    /// of reward. Bounded so `newRewards * PRECISION` cannot overflow for
    /// any reward balance a real asset can express.
    uint256 private constant PRECISION = 1e36;

    error ZeroAddress();
    error NothingToClaim();

    event RewardsAdded(uint256 amount, uint256 totalEligible);
    event RewardsBuffered(uint256 amount);
    event RewardsClaimed(address indexed account, uint256 amount);

    address public immutable deployer;
    address public immutable launchFactory;
    address public immutable curve;
    /// @notice The quote token this launch trades in; the asset holders earn.
    IERC20 public immutable rewardAsset;

    string public logo;
    string public description;

    Socials private _socials;

    uint256 public rewardPerTokenAcc;
    /// @notice Supply held by accounts that can actually claim.
    uint256 public totalEligible;
    /// @notice Reward asset already attributed to holders. The difference
    /// between this and the live balance is what `sync()` distributes.
    uint256 public reservedRewards;

    mapping(address account => bool) public excluded;
    mapping(address account => uint256) public accPaid;
    mapping(address account => uint256) public accrued;

    /**
     * @param excluded_ Addresses that structurally hold supply and must not
     * accrue. Fixed forever at construction.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        string memory logo_,
        string memory description_,
        Socials memory socials_,
        address deployer_,
        address curve_,
        address launchFactory_,
        address rewardAsset_,
        uint256 supply_,
        address[] memory excluded_
    ) ERC20(name_, symbol_) {
        if (deployer_ == address(0) || curve_ == address(0) || launchFactory_ == address(0)) {
            revert ZeroAddress();
        }
        if (rewardAsset_ == address(0)) revert ZeroAddress();

        deployer = deployer_;
        launchFactory = launchFactory_;
        curve = curve_;
        rewardAsset = IERC20(rewardAsset_);
        logo = logo_;
        description = description_;
        _socials = socials_;

        // Populated before the mint below, so the initial supply lands in an
        // already-excluded curve and `totalEligible` correctly starts at zero.
        excluded[address(this)] = true;
        for (uint256 i = 0; i < excluded_.length; ++i) {
            if (excluded_[i] != address(0)) excluded[excluded_[i]] = true;
        }

        _mint(curve_, supply_);
    }

    // ------------------------------------------------------------------
    // Rewards
    // ------------------------------------------------------------------

    /**
     * @notice Credits any reward asset that has arrived since the last call.
     * Permissionless and self-measuring, so a fee-on-transfer reward asset
     * is counted for what actually landed, and a direct donation to this
     * contract reaches holders exactly like a protocol-routed reward.
     */
    function sync() public {
        uint256 balance = rewardAsset.balanceOf(address(this));
        uint256 reserved = reservedRewards;
        if (balance <= reserved) return;
        uint256 pending = balance - reserved;

        uint256 eligible = totalEligible;
        if (eligible == 0) {
            // Nothing can be apportioned yet. The amount stays unreserved and
            // is folded into the first distribution that has holders.
            emit RewardsBuffered(pending);
            return;
        }

        uint256 perToken = (pending * PRECISION) / eligible;
        if (perToken == 0) {
            // Too small to move the per-token rate at all. Left unreserved so
            // it folds into the next distribution rather than being set aside
            // against claims it can never create.
            emit RewardsBuffered(pending);
            return;
        }
        rewardPerTokenAcc += perToken;
        // The whole inflow is reserved, not just the part this rate
        // represents. A holder settles against the *combined* accumulator
        // delta since they last moved, and a combined floor is never smaller
        // than the sum of the per-distribution floors, so reserving the
        // floors would let claims drift a wei above what was set aside and
        // strand the last claimant. Reserving the inflow keeps the pot a
        // strict upper bound on what can ever be claimed from it; the
        // rounding remainder simply stays in the contract.
        reservedRewards = balance;

        emit RewardsAdded(pending, eligible);
    }

    /**
     * @notice Reward asset claimable by `account` right now, including
     * rewards already sitting in this contract but not yet synced.
     */
    function claimable(address account) external view returns (uint256) {
        if (excluded[account]) return 0;

        uint256 acc = rewardPerTokenAcc;
        uint256 eligible = totalEligible;
        if (eligible != 0) {
            uint256 balance = rewardAsset.balanceOf(address(this));
            if (balance > reservedRewards) {
                acc += ((balance - reservedRewards) * PRECISION) / eligible;
            }
        }
        return accrued[account] + (balanceOf(account) * (acc - accPaid[account])) / PRECISION;
    }

    /**
     * @notice Pays the caller everything they have earned.
     */
    function claim() external nonReentrant returns (uint256 amount) {
        sync();
        _settle(msg.sender);

        amount = accrued[msg.sender];
        if (amount == 0) revert NothingToClaim();
        accrued[msg.sender] = 0;
        reservedRewards -= amount;

        rewardAsset.safeTransfer(msg.sender, amount);
        emit RewardsClaimed(msg.sender, amount);
    }

    /**
     * @dev Books whatever `account` has earned at the current accumulator and
     * marks it settled. Excluded accounts accrue nothing but still take the
     * marker, so they never bank a claim from a period they were exempt for.
     */
    function _settle(address account) private {
        if (account == address(0)) return;
        uint256 acc = rewardPerTokenAcc;
        if (!excluded[account]) {
            accrued[account] += (balanceOf(account) * (acc - accPaid[account])) / PRECISION;
        }
        accPaid[account] = acc;
    }

    /**
     * @dev Accounting only: settles both sides at the pre-transfer balances,
     * moves the tokens, then re-bases `totalEligible` for any crossing
     * between the eligible and excluded sets. It can neither revert on a
     * valid transfer nor alter the amount moved.
     */
    function _update(address from, address to, uint256 value) internal override {
        // Fold in anything that arrived since the last touch, so both sides
        // are settled against an accumulator that already reflects it.
        sync();
        _settle(from);
        _settle(to);

        super._update(from, to, value);

        if (value == 0) return;
        bool fromEligible = from != address(0) && !excluded[from];
        bool toEligible = to != address(0) && !excluded[to];
        if (fromEligible == toEligible) return;
        if (toEligible) {
            totalEligible += value;
        } else {
            totalEligible -= value;
        }
    }

    // ------------------------------------------------------------------
    // Metadata (identical surface to PopLaunchToken)
    // ------------------------------------------------------------------

    function socials()
        external
        view
        returns (
            string memory twitter,
            string memory telegram,
            string memory discord,
            string memory website,
            string memory farcaster
        )
    {
        Socials memory values = _socials;
        return (values.twitter, values.telegram, values.discord, values.website, values.farcaster);
    }

    function getTokenInfo()
        external
        view
        returns (
            address tokenDeployer,
            string memory tokenLogo,
            string memory tokenDescription,
            Socials memory tokenSocials
        )
    {
        return (deployer, logo, description, _socials);
    }
}

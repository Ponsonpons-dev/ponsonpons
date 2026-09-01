// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {IPopFeeEscrow, IPopQuoteRegistry} from "./interfaces/IPop.sol";

/// @dev The one function the splitter needs from the $POP token: distribute
/// whatever reward-asset balance the token holds to its holders, pro rata.
interface IPopHolderSync {
    function sync() external;
}

interface IUniswapV3PoolSplitterSwap {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
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
 * Curve-phase revenue accrues in WETH; `convertAndDistribute` market-buys
 * the reward asset with it (bounded by the origin pool's TWAP) so the
 * holder share applies to that revenue too, another public PONS buy each
 * time it runs.
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
    error NotConversionPool();
    error ConversionSlippage(uint256 actual, uint256 minimum);

    event HolderShareUpdated(uint16 holderShareBps);
    event PopTokenSet(address popToken);
    event Distributed(address indexed asset, uint256 toHolders, uint256 toOwner);
    event DistributedEth(uint256 toOwner);
    event WethConverted(uint256 wethIn, uint256 rewardOut);

    uint16 private constant BASIS_POINTS = 10_000;
    // Worst execution the WETH conversion accepts against the reward
    // asset's 30-minute TWAP; retryable, so manipulation delays rather than
    // repricing.
    uint256 private constant MAX_CONVERSION_SLIPPAGE_BPS = 500;

    IPopFeeEscrow public immutable feeEscrow;
    /// @notice The asset holder distributions are paid in ($PONS, the asset
    /// $POP's bonded pool trades in, which is what the token's `sync()`
    /// distributes).
    IERC20 public immutable rewardAsset;
    IPopQuoteRegistry public immutable quoteRegistry;
    address public immutable weth;

    /// @notice The $POP token contract. Zero until `setPopToken`.
    address public popToken;
    /// @notice Share of claimed reward-asset revenue routed to $POP holders.
    uint16 public holderShareBps;

    address private _conversionPoolInFlight;

    constructor(
        address owner_,
        IPopFeeEscrow feeEscrow_,
        IERC20 rewardAsset_,
        uint16 holderShareBps_,
        IPopQuoteRegistry quoteRegistry_,
        address weth_
    ) Ownable(owner_) {
        if (address(feeEscrow_) == address(0) || address(rewardAsset_) == address(0)) revert ZeroAddress();
        if (address(quoteRegistry_) == address(0) || weth_ == address(0)) revert ZeroAddress();
        if (holderShareBps_ > BASIS_POINTS) revert InvalidBps();
        feeEscrow = feeEscrow_;
        rewardAsset = rewardAsset_;
        quoteRegistry = quoteRegistry_;
        weth = weth_;
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
        _split(asset, balance);
    }

    /**
     * @notice Claims accrued WETH revenue (the curve phase's protocol
     * share), market-buys the reward asset with it on the reward asset's
     * canonical origin pool, and splits the proceeds like any reward-asset
     * revenue. Bounded by the origin pool's TWAP less the slippage
     * allowance, plus the caller's own floor.
     */
    function convertAndDistribute(uint256 minRewardOut) external nonReentrant {
        if (feeEscrow.balanceOfToken(address(this), weth) != 0) {
            feeEscrow.claimToken(weth);
        }
        uint256 wethBalance = IERC20(weth).balanceOf(address(this));
        if (wethBalance == 0) revert NothingToDistribute();

        (address pool, uint256 quotePerEthTwap) = quoteRegistry.bondConversion(address(rewardAsset));
        uint256 twapFloor = FullMath.mulDiv(
            FullMath.mulDiv(wethBalance, quotePerEthTwap, 1e18),
            BASIS_POINTS - MAX_CONVERSION_SLIPPAGE_BPS,
            BASIS_POINTS
        );
        uint256 floor = minRewardOut > twapFloor ? minRewardOut : twapFloor;

        bool zeroForOne = weth < address(rewardAsset);
        uint256 balanceBefore = rewardAsset.balanceOf(address(this));
        _conversionPoolInFlight = pool;
        IUniswapV3PoolSplitterSwap(pool).swap(
            address(this),
            zeroForOne,
            SafeCast.toInt256(wethBalance),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            ""
        );
        _conversionPoolInFlight = address(0);
        uint256 rewardOut = rewardAsset.balanceOf(address(this)) - balanceBefore;
        if (rewardOut < floor) revert ConversionSlippage(rewardOut, floor);
        emit WethConverted(wethBalance, rewardOut);

        _split(rewardAsset, rewardAsset.balanceOf(address(this)));
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != _conversionPoolInFlight) revert NotConversionPool();
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(weth).safeTransfer(msg.sender, owed);
    }

    function _split(IERC20 asset, uint256 balance) private {
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

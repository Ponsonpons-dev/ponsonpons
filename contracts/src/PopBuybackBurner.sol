// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {IPopFeeEscrow, IPopQuoteRegistry} from "./interfaces/IPop.sol";

interface IUniswapV3PoolBurnerSwap {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/**
 * @title PopBuybackBurner
 * @notice $POP's creator fee recipient. The creator revenue stream (in the
 * quote asset, $PONS) is split at an immutable ratio the moment it is
 * distributed: `burnShareBps` stays here as buyback budget, the rest goes to
 * the owner. A keeper then cranks `buyAndBurn`, which market-buys $POP
 * through its own graduated pool and sends every token bought to the dead
 * address.
 *
 * Custody, spelled out: nothing that enters this contract can reach the
 * keeper, and the buyback budget can only ever leave as burned $POP. The
 * keeper chooses timing and slippage bounds; the owner chooses the keeper.
 * The split ratio is a constructor constant, so "25% of $POP's creator fees
 * buy and burn $POP" is checkable, not a promise.
 *
 * The pool is set once after $POP graduates (this contract must exist before
 * the launch that names it as recipient, so wiring is necessarily two-step).
 */
contract PopBuybackBurner is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error InvalidBps();
    error AlreadySet();
    error PoolNotSet();
    error QuoteNotInPool();
    error NotKeeper();
    error NotPoolManager();
    error NothingToDistribute();
    error DeadlineExpired();
    error TooLittleOut(uint256 amountOut, uint256 minOut);
    error InsufficientBudget(uint256 budget, uint256 requested);
    error NotConversionPool();
    error ConversionSlippage(uint256 actual, uint256 minimum);

    event KeeperUpdated(address keeper);
    event PoolSet(address popToken);
    event Distributed(uint256 toOwner, uint256 toBuyback);
    event BoughtAndBurned(uint256 quoteIn, uint256 popBurned);
    event WethConverted(uint256 wethIn, uint256 quoteOut);

    uint16 private constant BASIS_POINTS = 10_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    // Worst execution the WETH conversion accepts against the quote's
    // 30-minute TWAP; retryable, so manipulation delays rather than
    // repricing.
    uint256 private constant MAX_CONVERSION_SLIPPAGE_BPS = 500;

    IPoolManager public immutable poolManager;
    IPopFeeEscrow public immutable feeEscrow;
    /// @notice The asset creator fees settle in ($PONS).
    IERC20 public immutable quoteAsset;
    IPopQuoteRegistry public immutable quoteRegistry;
    /// @notice Curve-phase creator fees arrive in WETH before conversion.
    address public immutable weth;
    /// @notice Share of distributed creator fees retained as buyback budget.
    uint16 public immutable burnShareBps;

    /// @notice Allowed to crank `buyAndBurn`. Timing power only.
    address public keeper;
    /// @notice $POP's graduated pool. Set once.
    PoolKey public poolKey;
    /// @notice The $POP token, derived from the pool key. Zero until set.
    address public popToken;

    address private _conversionPoolInFlight;

    constructor(
        address owner_,
        IPoolManager poolManager_,
        IPopFeeEscrow feeEscrow_,
        IERC20 quoteAsset_,
        address keeper_,
        uint16 burnShareBps_,
        IPopQuoteRegistry quoteRegistry_,
        address weth_
    ) Ownable(owner_) {
        if (
            address(poolManager_) == address(0) || address(feeEscrow_) == address(0)
                || address(quoteAsset_) == address(0)
        ) revert ZeroAddress();
        if (address(quoteRegistry_) == address(0) || weth_ == address(0)) revert ZeroAddress();
        if (burnShareBps_ > BASIS_POINTS) revert InvalidBps();
        poolManager = poolManager_;
        feeEscrow = feeEscrow_;
        quoteAsset = quoteAsset_;
        quoteRegistry = quoteRegistry_;
        weth = weth_;
        keeper = keeper_;
        burnShareBps = burnShareBps_;
        emit KeeperUpdated(keeper_);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    /// @notice Points the burner at $POP's graduated pool. Once. One side of
    /// the pool must be the quote asset; the other is $POP by construction.
    function setPool(PoolKey calldata key) external onlyOwner {
        if (popToken != address(0)) revert AlreadySet();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        address pop;
        if (c0 == address(quoteAsset)) pop = c1;
        else if (c1 == address(quoteAsset)) pop = c0;
        else revert QuoteNotInPool();
        if (pop == address(0)) revert ZeroAddress();
        poolKey = key;
        popToken = pop;
        emit PoolSet(pop);
    }

    /**
     * @notice Claims accrued creator fees from the escrow and splits them:
     * the owner share leaves now, the burn share stays as buyback budget.
     * Permissionless; only newly claimed revenue is split, so the retained
     * budget is never split twice.
     */
    function distribute() external nonReentrant {
        uint256 claimed = feeEscrow.balanceOfToken(address(this), address(quoteAsset)) != 0
            ? feeEscrow.claimToken(address(quoteAsset))
            : 0;
        if (claimed == 0) revert NothingToDistribute();
        _split(claimed);
    }

    /**
     * @notice Claims accrued WETH creator fees ($POP's curve phase),
     * market-buys the quote asset with them on the quote's canonical origin
     * pool (bounded by TWAP and the caller's floor), and splits the proceeds
     * like any distributed revenue.
     */
    function convertAndDistribute(uint256 minQuoteOut) external nonReentrant {
        if (feeEscrow.balanceOfToken(address(this), weth) != 0) {
            feeEscrow.claimToken(weth);
        }
        uint256 wethBalance = IERC20(weth).balanceOf(address(this));
        if (wethBalance == 0) revert NothingToDistribute();

        (address pool, uint256 quotePerEthTwap) = quoteRegistry.bondConversion(address(quoteAsset));
        uint256 twapFloor = FullMath.mulDiv(
            FullMath.mulDiv(wethBalance, quotePerEthTwap, 1e18),
            BASIS_POINTS - MAX_CONVERSION_SLIPPAGE_BPS,
            BASIS_POINTS
        );
        uint256 floor = minQuoteOut > twapFloor ? minQuoteOut : twapFloor;

        bool zeroForOne = weth < address(quoteAsset);
        uint256 balanceBefore = quoteAsset.balanceOf(address(this));
        _conversionPoolInFlight = pool;
        IUniswapV3PoolBurnerSwap(pool).swap(
            address(this),
            zeroForOne,
            SafeCast.toInt256(wethBalance),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            ""
        );
        _conversionPoolInFlight = address(0);
        uint256 quoteOut = quoteAsset.balanceOf(address(this)) - balanceBefore;
        if (quoteOut < floor) revert ConversionSlippage(quoteOut, floor);
        emit WethConverted(wethBalance, quoteOut);
        _split(quoteOut);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != _conversionPoolInFlight) revert NotConversionPool();
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(weth).safeTransfer(msg.sender, owed);
    }

    function _split(uint256 claimed) private {
        uint256 toOwner = (claimed * (BASIS_POINTS - burnShareBps)) / BASIS_POINTS;
        if (toOwner != 0) quoteAsset.safeTransfer(owner(), toOwner);
        emit Distributed(toOwner, claimed - toOwner);
    }

    /// @notice Quote balance available to buy and burn with.
    function buybackBudget() external view returns (uint256) {
        return quoteAsset.balanceOf(address(this));
    }

    /**
     * @notice Swaps `quoteIn` of the buyback budget for $POP through the
     * graduated pool and sends the entire output to the dead address.
     * @dev Keeper-only so a hostile cranker cannot time it against the pool,
     * but the keeper's power ends at timing: output can only go to DEAD, and
     * `minOut` bounds the price it may accept.
     */
    function buyAndBurn(uint256 quoteIn, uint256 minOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 popBurned)
    {
        if (msg.sender != keeper) revert NotKeeper();
        if (popToken == address(0)) revert PoolNotSet();
        if (block.timestamp > deadline) revert DeadlineExpired();
        uint256 budget = quoteAsset.balanceOf(address(this));
        if (quoteIn == 0 || quoteIn > budget) revert InsufficientBudget(budget, quoteIn);

        popBurned = abi.decode(poolManager.unlock(abi.encode(quoteIn)), (uint256));
        if (popBurned < minOut) revert TooLittleOut(popBurned, minOut);
        emit BoughtAndBurned(quoteIn, popBurned);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        uint256 quoteIn = abi.decode(data, (uint256));

        bool zeroForOne = Currency.unwrap(poolKey.currency0) == address(quoteAsset);
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(quoteIn), // exact input
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // Pay the quote side in, take every $POP bought straight to DEAD.
        int128 popDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 popOut = uint256(uint128(popDelta)); // positive: owed to us
        Currency quoteCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
        Currency popCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

        poolManager.sync(quoteCurrency);
        quoteAsset.safeTransfer(address(poolManager), quoteIn);
        poolManager.settle();
        poolManager.take(popCurrency, DEAD, popOut);

        return abi.encode(popOut);
    }
}

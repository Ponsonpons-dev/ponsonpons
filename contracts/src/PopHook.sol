// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {
    CashbackConfig,
    CashbackMode,
    FeePolicySnapshot,
    IPopFeeEscrow,
    IPopFeePolicy,
    IPopRewardSink
} from "./interfaces/IPop.sol";
import {BaseHook} from "./vendor/BaseHook.sol";

/**
 * @title PopHook
 * @notice Singleton Uniswap V4 hook shared by every graduated $POP pool.
 * Takes a fee cut on every swap via `afterSwap` (Flaunch-style Internal Swap
 * Pool), and whenever that cut lands in the launch token, converts it back
 * to the pool's quote token against the pool's own liquidity before it is
 * ever distributed. The same protocol / creator / quote-burn split that
 * governs PopBondingCurve's pre-graduation fee sweep lives here, so both
 * phases behave identically. Adapted from the verified PonsV2MemeHook.
 *
 * Differences from the Pons reference, by design:
 * - The fee policy terms (protocol share, hook fee, price-impact bound) are
 *   constructor immutables. there are no setters, so the policy on the
 *   /proof page is the policy forever. Only the protocol fee recipient and
 *   the sweep operator rotate, both behind the timelocked owner, and the
 *   recipient is still snapshotted per launch.
 * - No buyback-into-vest: the QuoteBurn cashback mode sends the quote token
 *   to the dead address after the protocol split, needing no extra swap.
 * - The TraderRebate mode is curve-only: after graduation the swap router
 *   obscures the human trader, so that share reverts to the creator
 *   (disclosed at launch creation).
 * - Both pool currencies are always ERC-20s; there is no native branch.
 */
contract PopHook is BaseHook, IUnlockCallback, IPopFeePolicy, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct LaunchInfo {
        bool registered;
        bool memecoinIsCurrency0;
        address memecoin;
        address quoteToken;
        address creator;
        address protocolFeeRecipient;
        // Creator-chosen at launch on PopLaunchFactory, snapshotted here at
        // registerPool time. Charged the same way hookFeeBps is, but paid to
        // the creator (minus their own cashback carve-out).
        uint16 creatorFeeBps;
        uint16 protocolFeeShareBps;
        uint16 hookFeeBps;
        uint16 maxInternalPriceImpactBps;
        CashbackMode cashbackMode;
        uint16 cashbackShareBps;
    }

    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant MAX_PROTOCOL_FEE_SHARE_BPS = 5_000;
    uint256 private constant MAX_HOOK_FEE_BPS = 1_000;
    // Mirrors PopBondingCurve's own ceiling, so a graduated pool can never
    // charge more per trade than the curve it graduated from.
    uint256 private constant MAX_TOTAL_TRADE_FEE_BPS = 2_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    error NotFactory();
    error AlreadySet();
    error OwnershipCannotBeRenounced();
    error ZeroAddress();
    error InvalidBps();
    error AlreadyRegistered();
    error UnknownPool();
    error InvalidPoolKey();
    error NotFeeSweepOperator();
    error InternalSwapRequiresOperator();
    error SlippageExceeded(uint256 actual, uint256 minimum);
    error MinimumOutputRequired();
    error InexactQuoteTransfer(address token, uint256 expected, uint256 received);
    error NothingToRescue();

    event FactorySet(address factory);
    event PoolRegistered(PoolId indexed poolId, address memecoin, address quoteToken, address creator);
    event CreatorFeeRecipientUpdated(
        PoolId indexed poolId, address indexed previousRecipient, address indexed newRecipient
    );
    // Reported separately because the two accrue to different ledgers: the
    // fee splits across protocol, cashback and creator on sweep, while the
    // creator fee is paid to the creator (minus the cashback carve-out).
    event HookFeeCollected(PoolId indexed poolId, address currency, uint256 feeAmount, uint256 creatorFeeAmount);
    event PoolFeesSwept(PoolId indexed poolId, uint256 protocolAmount, uint256 creatorAmount, uint256 cashbackAmount);
    event PoolFeesRescued(
        PoolId indexed poolId, address indexed quoteToken, uint256 protocolAmount, uint256 creatorAmount
    );
    event PoolConversionSkipped(PoolId indexed poolId, uint256 retainedMemecoin);
    event PoolQuoteBurned(PoolId indexed poolId, uint256 amount);
    event PoolHolderRewardsPushed(PoolId indexed poolId, uint256 amount);
    event ProtocolFeeRecipientUpdated(address recipient);
    event FeeSweepOperatorUpdated(address operator);

    IPopFeeEscrow public immutable feeEscrow;
    // Policy terms are immutable: what the protocol charges and how far an
    // internal conversion may move a pool's price are fixed at deployment,
    // for every pool this hook will ever govern. A different policy is a new
    // hook and a new factory version; existing pools keep this one forever.
    uint256 public immutable protocolFeeShareBps;
    uint256 public immutable hookFeeBps;
    uint256 public immutable maxInternalPriceImpactBps;

    address public factory;
    address public protocolFeeRecipient;
    address public feeSweepOperator;

    mapping(PoolId => LaunchInfo) public launches;
    mapping(PoolId => PoolKey) private _poolKeys;
    // Pending fee buckets per currency (the launch token or the quote
    // token). The creator fee is tracked separately from the base fee so it
    // never enters the protocol split; both convert to the quote token in
    // one internal swap at sweep time when they accrued in the launch token.
    mapping(PoolId => mapping(address currency => uint256 amount)) public pendingFees;
    mapping(PoolId => mapping(address currency => uint256 amount)) public pendingCreatorFees;

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    /**
     * @param poolManager_ The canonical Uniswap V4 pool manager.
     * @param feeEscrow_ Shared claimable balance ledger, also used by every bonding curve.
     * @param protocolFeeRecipient_ Escrow key credited with the protocol's share.
     * @param initialOwner_ Timelocked protocol owner; can only rotate the recipient and sweep operator.
     * @param protocolFeeShareBps_ Protocol's share of the base fee, immutable.
     * @param hookFeeBps_ Base fee charged on every swap's unspecified leg, immutable.
     * @param maxInternalPriceImpactBps_ Price-movement ceiling for internal conversions, immutable.
     */
    constructor(
        IPoolManager poolManager_,
        IPopFeeEscrow feeEscrow_,
        address protocolFeeRecipient_,
        address initialOwner_,
        uint256 protocolFeeShareBps_,
        uint256 hookFeeBps_,
        uint256 maxInternalPriceImpactBps_
    ) BaseHook(poolManager_) Ownable(initialOwner_) {
        if (address(poolManager_) == address(0) || address(feeEscrow_) == address(0)) {
            revert ZeroAddress();
        }
        if (protocolFeeRecipient_ == address(0)) revert ZeroAddress();
        if (protocolFeeShareBps_ > MAX_PROTOCOL_FEE_SHARE_BPS) revert InvalidBps();
        if (hookFeeBps_ > MAX_HOOK_FEE_BPS) revert InvalidBps();
        if (maxInternalPriceImpactBps_ == 0 || maxInternalPriceImpactBps_ >= BASIS_POINTS) revert InvalidBps();

        feeEscrow = feeEscrow_;
        protocolFeeRecipient = protocolFeeRecipient_;
        protocolFeeShareBps = protocolFeeShareBps_;
        hookFeeBps = hookFeeBps_;
        maxInternalPriceImpactBps = maxInternalPriceImpactBps_;
        feeSweepOperator = initialOwner_;
    }

    /**
     * @notice Only `beforeInitialize` (factory gating) and `afterSwap` (fee
     * collection) are enabled.
     */
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ---------------------------------------------------------------------
    // Owner-only configuration (timelocked)
    // ---------------------------------------------------------------------

    /**
     * @notice One-time wiring of the factory, set after both are deployed
     * since the factory needs this hook's mined address to build pool keys.
     */
    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /**
     * @notice Permanently disabled. An ownerless hook could never rotate the
     * fee sweep operator, so accrued fees on every graduated pool would stay
     * stranded. Ownership can still be transferred to a new owner.
     */
    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    /**
     * @notice Changes where future launches' protocol share is credited.
     * Pools already registered keep the recipient they snapshotted.
     */
    function setProtocolFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        protocolFeeRecipient = recipient;
        emit ProtocolFeeRecipientUpdated(recipient);
    }

    /**
     * @notice Sets the trusted operator that executes fee conversions with
     * explicit minimum outputs, preventing arbitrary callers from triggering
     * predictable swaps against a manipulated spot price.
     */
    function setFeeSweepOperator(address operator) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        feeSweepOperator = operator;
        emit FeeSweepOperatorUpdated(operator);
    }

    /**
     * @notice Returns the policy terms new launches snapshot immutably.
     */
    function currentFeePolicy() external view override returns (FeePolicySnapshot memory) {
        return FeePolicySnapshot({
            protocolFeeRecipient: protocolFeeRecipient,
            protocolFeeShareBps: uint16(protocolFeeShareBps),
            hookFeeBps: uint16(hookFeeBps),
            maxInternalPriceImpactBps: uint16(maxInternalPriceImpactBps)
        });
    }

    // ---------------------------------------------------------------------
    // Factory wiring
    // ---------------------------------------------------------------------

    /**
     * @notice Registers a pool with fee terms frozen at launch by the factory.
     */
    function registerPool(
        PoolKey calldata key,
        address memecoin,
        address creator,
        uint16 creatorFeeBps,
        CashbackConfig calldata cashback,
        FeePolicySnapshot calldata policy
    ) external onlyFactory {
        PoolId poolId = key.toId();
        if (launches[poolId].registered) revert AlreadyRegistered();
        if (creator == address(0)) revert ZeroAddress();
        // Terms frozen here govern the pool for life, so each is held to the
        // same ceiling the hook's own constructor enforces.
        if (
            policy.protocolFeeRecipient == address(0) || policy.protocolFeeShareBps > MAX_PROTOCOL_FEE_SHARE_BPS
                || policy.hookFeeBps > MAX_HOOK_FEE_BPS || policy.maxInternalPriceImpactBps == 0
                || policy.maxInternalPriceImpactBps >= BASIS_POINTS || cashback.shareBps > BASIS_POINTS
        ) {
            revert InvalidBps();
        }
        // A pool taking more than the whole unspecified leg would flip the
        // swapper's output delta negative.
        if (uint256(creatorFeeBps) + policy.hookFeeBps > MAX_TOTAL_TRADE_FEE_BPS) revert InvalidBps();

        // The factory builds the key correctly today, but these two facts
        // are what every later fee credit and swap direction is derived
        // from. A memecoin that is neither currency would silently designate
        // the wrong side as quote and route fees to a slot nothing reads.
        if (address(key.hooks) != address(this)) revert InvalidPoolKey();
        bool memecoinIsCurrency0 = Currency.unwrap(key.currency0) == memecoin;
        if (!memecoinIsCurrency0 && Currency.unwrap(key.currency1) != memecoin) revert InvalidPoolKey();

        address quoteToken = memecoinIsCurrency0 ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);

        launches[poolId] = LaunchInfo({
            registered: true,
            memecoinIsCurrency0: memecoinIsCurrency0,
            memecoin: memecoin,
            quoteToken: quoteToken,
            creator: creator,
            protocolFeeRecipient: policy.protocolFeeRecipient,
            creatorFeeBps: creatorFeeBps,
            protocolFeeShareBps: policy.protocolFeeShareBps,
            hookFeeBps: policy.hookFeeBps,
            maxInternalPriceImpactBps: policy.maxInternalPriceImpactBps,
            cashbackMode: cashback.mode,
            cashbackShareBps: cashback.shareBps
        });
        _poolKeys[poolId] = key;

        emit PoolRegistered(poolId, memecoin, quoteToken, creator);
    }

    /**
     * @notice Updates who receives this pool's creator fee share. Restricted
     * to the factory, which authenticates the current creator recipient
     * before forwarding here; there is no protocol-side override.
     */
    function setCreatorFeeRecipient(PoolId poolId, address newRecipient) external onlyFactory {
        LaunchInfo storage info = launches[poolId];
        if (!info.registered) revert UnknownPool();
        if (newRecipient == address(0)) revert ZeroAddress();

        emit CreatorFeeRecipientUpdated(poolId, info.creator, newRecipient);
        info.creator = newRecipient;
    }

    // ---------------------------------------------------------------------
    // IHooks: only beforeInitialize and afterSwap are enabled. BaseHook
    // supplies the externally reachable callbacks, each already restricted
    // to the pool manager, and reverts HookNotImplemented for every
    // permission getHookPermissions() leaves off.
    // ---------------------------------------------------------------------

    /**
     * @dev Registration is what binds a pool id to its memecoin, quote
     * asset, and fee recipients, and every later fee credit is derived from
     * that record. Restricting initialization to the factory keeps a pool
     * bearing this hook from existing without one.
     */
    function _beforeInitialize(address sender, PoolKey calldata, uint160) internal view override returns (bytes4) {
        if (sender != factory) revert NotFactory();
        return IHooks.beforeInitialize.selector;
    }

    /**
     * @notice Takes `hookFeeBps` plus this pool's `creatorFeeBps` of the
     * swap's unspecified currency straight out of the pool manager's
     * flash-accounting ledger in a single `take`, crediting the two cuts to
     * separate pending balances. If either cut lands in the launch token, it
     * is left untouched here and only converted to the quote token later, in
     * a batched `sweepPoolFees` call, rather than on every single swap.
     */
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        // The conversion leg swaps against this same pool, but it is never
        // taxed here: v4-core skips a pool's hooks when the hook itself is
        // the caller.
        PoolId poolId = key.toId();
        LaunchInfo memory info = launches[poolId];
        if (!info.registered) return (IHooks.afterSwap.selector, 0);
        if (info.hookFeeBps == 0 && info.creatorFeeBps == 0) return (IHooks.afterSwap.selector, 0);

        bool specifiedIsCurrency0 = (params.amountSpecified < 0) == params.zeroForOne;
        (Currency feeCurrency, int128 unspecifiedAmount) =
            specifiedIsCurrency0 ? (key.currency1, delta.amount1()) : (key.currency0, delta.amount0());
        if (unspecifiedAmount < 0) unspecifiedAmount = -unspecifiedAmount;
        if (unspecifiedAmount == 0) return (IHooks.afterSwap.selector, 0);

        uint256 unspecified = uint256(uint128(unspecifiedAmount));
        uint256 feeAmount = (unspecified * info.hookFeeBps) / BASIS_POINTS;
        uint256 creatorFeeAmount = (unspecified * info.creatorFeeBps) / BASIS_POINTS;
        uint256 totalAmount = feeAmount + creatorFeeAmount;
        if (totalAmount == 0) return (IHooks.afterSwap.selector, 0);

        address feeCurrencyAddr = Currency.unwrap(feeCurrency);
        _takeExact(feeCurrency, feeCurrencyAddr, totalAmount);
        if (feeAmount != 0) pendingFees[poolId][feeCurrencyAddr] += feeAmount;
        if (creatorFeeAmount != 0) pendingCreatorFees[poolId][feeCurrencyAddr] += creatorFeeAmount;

        emit HookFeeCollected(poolId, feeCurrencyAddr, feeAmount, creatorFeeAmount);
        return (IHooks.afterSwap.selector, int128(uint128(totalAmount)));
    }

    // ---------------------------------------------------------------------
    // Fee sweep: ISP conversion, quote burn, and distribution
    // ---------------------------------------------------------------------

    /**
     * @notice Converts any pending launch-token-denominated fee into the
     * pool's quote token against the pool's own liquidity, then splits the
     * combined quote total into protocol / creator, burning the launch's
     * QuoteBurn carve-out, exactly mirroring the bonding curve's own sweep.
     * The trusted sweep operator is required whenever the sweep would
     * execute an internal conversion; the creator may distribute
     * already-quoted fees when no swap is needed.
     * @dev The cashback carve-out is derived at sweep time rather than
     * bucketed at accrual: the mode and share are immutable from launch, so
     * there is no toggle that could reroute value already accrued, the
     * proportional split of the aggregate is identical to per-swap
     * bucketing. The TraderRebate mode is inert here (curve-only); its share
     * stays with the creator, as disclosed at launch creation.
     */
    function sweepPoolFees(PoolId poolId, uint256 minConversionQuoteOut) external nonReentrant {
        LaunchInfo memory info = launches[poolId];
        if (!info.registered) revert UnknownPool();
        bool isOperator = msg.sender == feeSweepOperator;
        if (!isOperator && msg.sender != info.creator) revert NotFeeSweepOperator();
        if (!isOperator && _requiresTrustedOperator(poolId, info)) revert InternalSwapRequiresOperator();

        (uint256 convertedFeeQuote, uint256 convertedCreatorQuote, bool converted) =
            _convertPendingMemecoin(poolId, info, minConversionQuoteOut);
        // Only a conversion that actually executed is subject to the
        // caller's minimum. Enforcing it when there was nothing to convert,
        // or when the swap filled nothing and the pending amount was
        // restored for a later retry, would block the quote-denominated legs
        // of the sweep over a conversion that never happened.
        uint256 conversionQuoteOut = convertedFeeQuote + convertedCreatorQuote;
        if (converted && conversionQuoteOut < minConversionQuoteOut) {
            revert SlippageExceeded(conversionQuoteOut, minConversionQuoteOut);
        }

        uint256 totalQuote = pendingFees[poolId][info.quoteToken] + convertedFeeQuote;
        uint256 creatorFeeQuote = pendingCreatorFees[poolId][info.quoteToken] + convertedCreatorQuote;
        if (totalQuote == 0 && creatorFeeQuote == 0) return;
        pendingFees[poolId][info.quoteToken] = 0;
        pendingCreatorFees[poolId][info.quoteToken] = 0;

        _distribute(poolId, info, totalQuote, creatorFeeQuote);
    }

    /**
     * @notice Owner-only escape hatch for a pool's pending fees when they
     * can no longer reach the protocol and creator through the normal
     * exact-delivery path, for example an approved quote token that later
     * turns out to be fee-on-transfer, rebasing, or otherwise unable to move
     * its exact nominal amount. `sweepPoolFees` would revert indefinitely in
     * that case, since `_payOut` enforces exact delivery into the fee
     * escrow. This bypasses the escrow and the conversion swap entirely and
     * pays the protocol and creator their regular split with a direct
     * transfer instead. Recipients are fixed, the timelocked owner chooses
     * when this runs, never where the money goes.
     *
     * The pool's launch-token fees are rescued too, because their only
     * ordinary exit is the conversion swap. The QuoteBurn carve-out is
     * folded into the creator payout rather than burned: the dead address is
     * as blockable as the escrow, so attempting the burn could reproduce the
     * failure this path exists to route around.
     */
    function rescuePoolFees(PoolId poolId)
        external
        onlyOwner
        nonReentrant
        returns (uint256 protocolAmount, uint256 creatorAmount)
    {
        LaunchInfo memory info = launches[poolId];
        if (!info.registered) revert UnknownPool();

        (protocolAmount, creatorAmount) = _rescueCurrency(poolId, info, info.quoteToken);
        (uint256 memecoinProtocol, uint256 memecoinCreator) = _rescueCurrency(poolId, info, info.memecoin);
        if (protocolAmount == 0 && creatorAmount == 0 && memecoinProtocol == 0 && memecoinCreator == 0) {
            revert NothingToRescue();
        }
    }

    /**
     * @dev Zeroes one currency's pending buckets for a pool and pays the
     * protocol and creator their regular split directly, bypassing the
     * escrow. Returns zero for both legs when there is nothing pending, so
     * the caller can tell whether any currency had a balance to rescue.
     */
    function _rescueCurrency(PoolId poolId, LaunchInfo memory info, address currency)
        private
        returns (uint256 protocolAmount, uint256 creatorAmount)
    {
        uint256 total = pendingFees[poolId][currency];
        uint256 creatorFee = pendingCreatorFees[poolId][currency];
        if (total == 0 && creatorFee == 0) return (0, 0);

        pendingFees[poolId][currency] = 0;
        pendingCreatorFees[poolId][currency] = 0;

        protocolAmount = (total * info.protocolFeeShareBps) / BASIS_POINTS;
        creatorAmount = total - protocolAmount + creatorFee;

        if (protocolAmount != 0) IERC20(currency).safeTransfer(info.protocolFeeRecipient, protocolAmount);
        if (creatorAmount != 0) IERC20(currency).safeTransfer(info.creator, creatorAmount);

        emit PoolFeesRescued(poolId, currency, protocolAmount, creatorAmount);
    }

    /**
     * @dev Limits price-sensitive pool interactions to the protocol's sweep
     * operator. A creator can distribute direct quote balances, but cannot
     * select a permissive minimum around a manipulable spot price for
     * inventory shared with the protocol.
     */
    function _requiresTrustedOperator(PoolId poolId, LaunchInfo memory info) private view returns (bool) {
        return pendingFees[poolId][info.memecoin] != 0 || pendingCreatorFees[poolId][info.memecoin] != 0;
    }

    /**
     * @dev Converts base-fee and creator-fee launch-token inventory in one
     * swap so the sweep receives one aggregate price boundary. Partial input
     * and output are allocated proportionally back to their separate
     * accounting buckets.
     */
    function _convertPendingMemecoin(PoolId poolId, LaunchInfo memory info, uint256 minConversionQuoteOut)
        private
        returns (uint256 feeQuoteOut, uint256 creatorQuoteOut, bool converted)
    {
        uint256 feePending = pendingFees[poolId][info.memecoin];
        uint256 creatorPending = pendingCreatorFees[poolId][info.memecoin];
        uint256 totalPending = feePending + creatorPending;
        if (totalPending == 0) return (0, 0, false);
        if (minConversionQuoteOut == 0) revert MinimumOutputRequired();

        pendingFees[poolId][info.memecoin] = 0;
        pendingCreatorFees[poolId][info.memecoin] = 0;
        (uint256 consumed, uint256 quoteOut) = _executeInternalSwap(poolId, true, totalPending);
        if (consumed == 0) {
            pendingFees[poolId][info.memecoin] += feePending;
            pendingCreatorFees[poolId][info.memecoin] += creatorPending;
            emit PoolConversionSkipped(poolId, totalPending);
            return (0, 0, false);
        }
        converted = true;

        uint256 feeConsumed = FullMath.mulDiv(consumed, feePending, totalPending);
        uint256 creatorConsumed = consumed - feeConsumed;
        feeQuoteOut = FullMath.mulDiv(quoteOut, feeConsumed, consumed);
        creatorQuoteOut = quoteOut - feeQuoteOut;

        pendingFees[poolId][info.memecoin] += feePending - feeConsumed;
        pendingCreatorFees[poolId][info.memecoin] += creatorPending - creatorConsumed;
    }

    /**
     * @dev Splits `totalQuote` into protocol / creator, then carves the
     * launch's immutable cashback share out of the creator's take. Under
     * QuoteBurn that carve-out is transferred to the dead address; under
     * TraderRebate (curve-only) and None it stays with the creator.
     */
    function _distribute(PoolId poolId, LaunchInfo memory info, uint256 totalQuote, uint256 creatorFeeQuote) private {
        uint256 protocolAmount = (totalQuote * info.protocolFeeShareBps) / BASIS_POINTS;
        uint256 creatorTake = totalQuote - protocolAmount + creatorFeeQuote;

        // TraderRebate is curve-only, after graduation the router stands
        // between the hook and the human, so that share reverts to the
        // creator, as disclosed at launch creation.
        bool settlesCashback =
            info.cashbackMode == CashbackMode.QuoteBurn || info.cashbackMode == CashbackMode.HolderRewards;
        uint256 cashbackAmount;
        if (settlesCashback && creatorTake != 0) {
            cashbackAmount = (creatorTake * info.cashbackShareBps) / BASIS_POINTS;
        }
        uint256 creatorAmount = creatorTake - cashbackAmount;

        if (cashbackAmount != 0) {
            if (info.cashbackMode == CashbackMode.QuoteBurn) {
                IERC20(info.quoteToken).safeTransfer(DEAD, cashbackAmount);
                emit PoolQuoteBurned(poolId, cashbackAmount);
            } else {
                // The launch token distributes to its own holders; `sync()`
                // is permissionless and measures the delta itself.
                IERC20(info.quoteToken).safeTransfer(info.memecoin, cashbackAmount);
                IPopRewardSink(info.memecoin).sync();
                emit PoolHolderRewardsPushed(poolId, cashbackAmount);
            }
        }
        _payOut(info.creator, info.quoteToken, creatorAmount);
        _payOut(info.protocolFeeRecipient, info.quoteToken, protocolAmount);

        emit PoolFeesSwept(poolId, protocolAmount, creatorAmount, cashbackAmount);
    }

    function _payOut(address recipient, address quoteToken, uint256 amount) private {
        if (amount == 0) return;
        uint256 balanceBefore = IERC20(quoteToken).balanceOf(address(feeEscrow));
        IERC20(quoteToken).forceApprove(address(feeEscrow), amount);
        feeEscrow.creditToken(recipient, quoteToken, amount);
        uint256 received = IERC20(quoteToken).balanceOf(address(feeEscrow)) - balanceBefore;
        if (received != amount) revert InexactQuoteTransfer(quoteToken, amount, received);
    }

    /**
     * @dev Opens a standalone unlock context to run one exact-input internal
     * swap, bounded by a price-impact ceiling measured against the pool's
     * live price.
     *
     * That ceiling limits how far this swap moves the price, not where the
     * price started. A front-run that depresses spot first shifts the whole
     * band down with it, so the bound is slippage control rather than
     * manipulation resistance. What actually caps the loss on a sandwich is
     * the caller's `minConversionQuoteOut`, which is why every
     * price-sensitive sweep is gated to the sweep operator. Treat the
     * minimum as the real defense and size it off an independent price.
     */
    function _executeInternalSwap(PoolId poolId, bool memecoinIn, uint256 amountIn)
        private
        returns (uint256 amountInConsumed, uint256 amountOut)
    {
        bytes memory result = poolManager.unlock(abi.encode(poolId, memecoinIn, amountIn));
        (amountInConsumed, amountOut) = abi.decode(result, (uint256, uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolId poolId, bool memecoinIn, uint256 amountIn) = abi.decode(data, (PoolId, bool, uint256));

        LaunchInfo memory info = launches[poolId];
        PoolKey memory key = _poolKeys[poolId];
        bool zeroForOne = memecoinIn ? info.memecoinIsCurrency0 : !info.memecoinIsCurrency0;

        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, poolId);
        uint160 sqrtPriceLimitX96 = _priceLimit(sqrtPriceX96, zeroForOne, info.maxInternalPriceImpactBps);

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -SafeCast.toInt256(amountIn),
                sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            ""
        );

        _settleCurrency(key.currency0, delta.amount0());
        _settleCurrency(key.currency1, delta.amount1());

        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 amountInConsumed = inputDelta < 0 ? SafeCast.toUint256(-int256(inputDelta)) : 0;
        uint256 amountOut = outputDelta > 0 ? SafeCast.toUint256(int256(outputDelta)) : 0;
        return abi.encode(amountInConsumed, amountOut);
    }

    function _settleCurrency(Currency currency, int128 amount) private {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            address token = Currency.unwrap(currency);
            uint256 balanceBefore = IERC20(token).balanceOf(address(poolManager));
            poolManager.sync(currency);
            IERC20(token).safeTransfer(address(poolManager), owed);
            uint256 received = IERC20(token).balanceOf(address(poolManager)) - balanceBefore;
            if (received != owed) revert InexactQuoteTransfer(token, owed, received);
            poolManager.settle();
        } else if (amount > 0) {
            _takeExact(currency, Currency.unwrap(currency), uint256(uint128(amount)));
        }
    }

    /**
     * @dev Records only assets that reached the hook in full. Uniswap V4's
     * flash accounting requires exact ERC-20 transfers, so transfer-tax
     * quote assets fail atomically instead of creating an underfunded fee
     * balance.
     */
    function _takeExact(Currency currency, address token, uint256 amount) private {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        poolManager.take(currency, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert InexactQuoteTransfer(token, amount, received);
    }

    /**
     * @dev Bounds the pool's sqrt-price movement for batched internal swaps.
     * For a constant-product pool this matches the bonding curve's
     * `amountIn / (reserve + amountIn)` reserve-movement bound.
     */
    function _priceLimit(uint160 sqrtPriceX96, bool zeroForOne, uint256 maxPriceImpactBps)
        private
        pure
        returns (uint160)
    {
        uint256 factor = BASIS_POINTS - maxPriceImpactBps;
        if (zeroForOne) {
            uint256 limit = (uint256(sqrtPriceX96) * factor) / BASIS_POINTS;
            // forge-lint: disable-next-line(unsafe-typecast)
            return limit <= TickMath.MIN_SQRT_PRICE ? TickMath.MIN_SQRT_PRICE + 1 : uint160(limit);
        } else {
            uint256 limit = (uint256(sqrtPriceX96) * BASIS_POINTS) / factor;
            // Casting is safe: this branch only returns when limit < MAX_SQRT_PRICE < type(uint160).max.
            // forge-lint: disable-next-line(unsafe-typecast)
            return limit >= TickMath.MAX_SQRT_PRICE ? TickMath.MAX_SQRT_PRICE - 1 : uint160(limit);
        }
    }
}

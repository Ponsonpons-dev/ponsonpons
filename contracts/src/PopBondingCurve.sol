// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {
    CashbackConfig,
    CashbackMode,
    IPopFeeEscrow,
    IPopLaunchFactoryGraduation,
    IPopRewardSink,
    IPopSnipeTax
} from "./interfaces/IPop.sol";
import {PopCurveMath} from "./libraries/PopCurveMath.sol";

/**
 * @title PopBondingCurve
 * @notice Constant-product bonding curve for one $POP launch, adapted from
 * the verified PonsV2BondingCurve (itself adapted from BootstrapPool.sol,
 * code-423n4/2025-01-iq-ai). The curve trades against the same graduated
 * Pons quote token its Uniswap V4 pool will use. Collecting the eventual
 * pool asset from the very first trade is what lets graduation seed the pool
 * directly, with no swap and therefore no price oracle anywhere in the
 * system.
 *
 * Every trade fee is charged against the quote leg regardless of trade
 * direction, so the curve never accrues fees denominated in the launch
 * token: protocol and creator revenue is quote-denominated from the first
 * trade. Because the creator's cashback mode is immutable from launch and
 * the quote-burn leg is a plain transfer (the fees already are the quote
 * token), the fee sweep here needs no swap, no price floor, and no trusted
 * operator: it is fully permissionless.
 *
 * Differences from the Pons reference, by design:
 * - The quote asset is always an ERC-20 (a graduated Pons token); there is
 *   no native-ETH launch mode.
 * - Fees split at accrual into explicit protocol / creator / burn buckets,
 *   and the TraderRebate mode credits the trade's recipient through the fee
 *   escrow in the same transaction.
 * - There is no buyback-into-vest: the QuoteBurn mode sends quote tokens to
 *   the dead address instead, making the quote token deflationary.
 * - The creator fee recipient can only ever be changed by the creator
 *   themselves (through the factory); no protocol override exists.
 */
contract PopBondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant MAX_TOTAL_TRADE_FEE_BPS = 2_000; // 20%
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    error CurveGraduated();
    error ZeroAmount();
    error ZeroAddress();
    error SlippageExceeded(uint256 actual, uint256 minimum);
    error DeadlineExpired(uint256 deadline, uint256 nowTimestamp);
    error NotFactory();
    error AlreadyGraduated();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidLaunchEconomics();
    error NotReadyToGraduate();
    error InvalidFeePolicy();

    // `fee` and `creatorFee` are reported separately because they fund
    // different parties: the fee splits between protocol and creator (with
    // the cashback carve-out), while the creator fee is the creator's own
    // surcharge. `rebate` is the slice credited back to the recipient under
    // the TraderRebate mode.
    event CurveBuy(
        address indexed buyer,
        address indexed recipient,
        uint256 quoteIn,
        uint256 tokensOut,
        uint256 fee,
        uint256 creatorFee,
        uint256 rebate
    );
    event CurveBuyRefunded(address indexed buyer, uint256 refund);
    event CurveSell(
        address indexed seller,
        address indexed recipient,
        uint256 tokensIn,
        uint256 quoteOut,
        uint256 fee,
        uint256 creatorFee,
        uint256 rebate
    );
    event FeesSwept(uint256 protocolAmount, uint256 creatorAmount, uint256 cashbackAmount);
    event FeesRescued(
        address indexed protocolRecipient,
        address indexed creatorRecipient,
        uint256 protocolAmount,
        uint256 creatorAmount
    );
    event QuoteBurned(uint256 amount);
    event HolderRewardsPushed(uint256 amount);
    event CurveCompleted(address recipient, uint256 quoteOut, uint256 tokenOut);
    event Initialized(address token);
    event CreatorFeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event AutoGraduationFailed(address indexed token, uint256 gasRemaining);
    event SnipeTaxExempted(address indexed account);
    // Separate from CurveBuy so indexers can tell an ordinary fee from a
    // launch-window penalty and surface which wallets sniped the launch.
    event SnipeTaxCharged(address indexed recipient, uint256 amount);

    // Not immutable: the token's constructor needs this curve's real address,
    // so the factory deploys the curve first, then the token, then wires the
    // token here via `initialize()`. Set exactly once, guarded by onlyFactory.
    address public token;
    // Quote asset for both curve trading and the graduated pool. Always an
    // ERC-20 approved by the quote registry at launch time.
    address public immutable quoteToken;
    // Not immutable: the creator can hand off future fee sweeps to a new
    // address via `setCreatorFeeRecipient`, gated through `onlyFactory`.
    // There is deliberately no protocol-side override.
    address public creatorFeeRecipient;
    address public immutable factory;
    IPopFeeEscrow public immutable feeEscrow;
    // Frozen when the launch is created. Protocol policy updates affect
    // future launches but cannot redirect an active curve's protocol share.
    address public immutable protocolFeeRecipient;
    uint16 public immutable protocolFeeShareBps;
    // Creator-chosen at launch, immutable for the launch's life. The share
    // is carved out of the creator's take, so toggling games are impossible
    // and the sweep can derive every split from the buckets alone.
    CashbackMode public immutable cashbackMode;
    uint16 public immutable cashbackShareBps;
    // Virtual quote reserve seeded at deploy, denominated in the quote
    // asset's own decimals.
    uint256 public immutable phantomQuote;
    uint256 public immutable feeBps;
    // Creator-chosen at launch, capped by the factory (0-2%). Layered on top
    // of the base trade fee, not part of the protocol split, and paid to the
    // creator (minus their own cashback carve-out).
    uint256 public immutable creatorFeeBps;
    uint256 public immutable graduationThreshold;

    // Pending fee buckets, all quote-denominated and all slices of
    // `trackedQuote`. Split at accrual rather than at sweep so the sweep is
    // pure bookkeeping and permissionless.
    uint256 public pendingProtocolFees;
    uint256 public pendingCreatorFees;
    uint256 public pendingCashback;

    // Net real quote asset held from curve trading: buys add their value,
    // sell payouts, rebates, and swept fees subtract theirs. Tracked
    // explicitly instead of reading a live balance, so a forced transfer in
    // (an ERC-20 airdrop) can neither inflate curve pricing nor push a
    // launch past its graduation threshold with no tokens actually sold.
    uint256 public trackedQuote;
    // Launch tokens this curve holds as tradeable reserve: set to the minted
    // allocation at initialize, reduced by buys, increased by sells. Tracked
    // for the same donation-resistance reason as the quote side.
    uint256 public trackedTokens;
    bool public graduated;
    // Token balance the curve will never sell below, set once at initialize
    // and handed to the graduated pool intact. Everything above it is the
    // sellable allocation, and graduation is exactly its exhaustion.
    uint256 public reservedTokens;
    // Total supply this launch was created with, snapshotted at initialize
    // and exposed for off-chain consumers.
    uint256 public launchSupply;
    // Timestamp trading opened, anchoring the snipe tax decay. Set once at
    // initialize, which the factory calls in the launch transaction itself.
    uint256 public launchedAt;
    // Anti-snipe tax terms, snapshotted from the factory at initialize like
    // the rest of this launch's economics. Frozen rather than read live so a
    // factory retune can never change the terms of a launch whose window is
    // already open. A zero starting tax disables the mechanism permanently.
    uint256 public snipeTaxStartBps;
    uint256 public snipeTaxSeconds;
    // Wallets the creator declared at launch, exempt from the snipe tax so a
    // team's own bundled buys are not eaten by the launch window's anti-bot
    // pricing. Written only by the factory during the launch transaction.
    mapping(address account => bool exempt) public snipeTaxExempt;

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier onlyInitialized() {
        if (token == address(0)) revert NotInitialized();
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
        _;
    }

    /**
     * @param quoteToken_ Registry-approved graduated Pons token this launch trades and graduates in.
     * @param creatorFeeRecipient_ Initial creator fee recipient.
     * @param factory_ PopLaunchFactory address, the only caller allowed through `onlyFactory`.
     * @param protocolFeeRecipient_ Protocol revenue recipient, frozen for this launch.
     * @param protocolFeeShareBps_ Protocol's share of the base fee, frozen for this launch.
     * @param cashback_ Creator-chosen cashback routing, immutable for this launch.
     * @param feeEscrow_ Shared claimable balance ledger for all quote-denominated revenue.
     * @param phantomQuote_ Virtual quote reserve seeded at deploy, never physically held.
     * @param feeBps_ Base trade fee in basis points, always charged on the quote leg.
     * @param creatorFeeBps_ Additional creator-chosen trade fee, layered on top of feeBps_.
     * @param graduationThreshold_ Real quote reserve required before graduation unlocks.
     */
    constructor(
        address quoteToken_,
        address creatorFeeRecipient_,
        address factory_,
        address protocolFeeRecipient_,
        uint16 protocolFeeShareBps_,
        CashbackConfig memory cashback_,
        IPopFeeEscrow feeEscrow_,
        uint256 phantomQuote_,
        uint256 feeBps_,
        uint256 creatorFeeBps_,
        uint256 graduationThreshold_
    ) {
        if (quoteToken_ == address(0) || creatorFeeRecipient_ == address(0) || factory_ == address(0)) {
            revert ZeroAddress();
        }
        if (address(feeEscrow_) == address(0) || protocolFeeRecipient_ == address(0)) revert ZeroAddress();
        if (protocolFeeShareBps_ > BASIS_POINTS || cashback_.shareBps > BASIS_POINTS) revert InvalidFeePolicy();
        // The factory applies the same ceiling before deploying, but the curve
        // defends its own invariant rather than inheriting it: a combined fee
        // at or above the whole trade would break the quote accounting.
        if (feeBps_ + creatorFeeBps_ > MAX_TOTAL_TRADE_FEE_BPS) revert InvalidFeePolicy();
        if (phantomQuote_ == 0 || graduationThreshold_ == 0) revert InvalidLaunchEconomics();

        quoteToken = quoteToken_;
        creatorFeeRecipient = creatorFeeRecipient_;
        // Passed explicitly rather than read from msg.sender: PopLaunchFactory
        // deploys this curve indirectly through PopLaunchDeployer to keep its
        // own bytecode under EIP-170's size limit.
        factory = factory_;
        feeEscrow = feeEscrow_;
        protocolFeeRecipient = protocolFeeRecipient_;
        protocolFeeShareBps = protocolFeeShareBps_;
        cashbackMode = cashback_.mode;
        cashbackShareBps = cashback_.shareBps;
        phantomQuote = phantomQuote_;
        feeBps = feeBps_;
        creatorFeeBps = creatorFeeBps_;
        graduationThreshold = graduationThreshold_;
    }

    /**
     * @notice Wires the launch token this curve dispenses. Called once by the
     * factory immediately after deploying the token with this curve's (now
     * known) address, before either contract is reachable by anyone else.
     *
     * @dev Also fixes the pool's token allocation. Holding
     * `phantomQuote * supply` constant, the curve reaches a real quote
     * reserve of `graduationThreshold` exactly when its token balance falls
     * to `supply * phantomQuote / (phantomQuote + threshold)`. Reserving that
     * balance therefore does not change where a launch graduates, it only
     * stops the curve selling through it: the quote threshold and the token
     * allocation are the same point, so the graduated pool is seeded with
     * the same amounts at the same price on every launch.
     */
    function initialize(address token_) external onlyFactory {
        if (token != address(0)) revert AlreadyInitialized();
        if (token_ == address(0)) revert ZeroAddress();
        token = token_;

        uint256 supply = IERC20(token_).totalSupply();
        uint256 reserved = Math.mulDiv(supply, phantomQuote, phantomQuote + graduationThreshold);
        // A launch whose allocation rounds away has nothing to seed its pool
        // with, and its final buy would revert against an empty token side.
        // Rejecting the config here fails at launch rather than at graduation.
        if (reserved == 0 || reserved >= supply) revert InvalidLaunchEconomics();
        reservedTokens = reserved;
        launchSupply = supply;
        launchedAt = block.timestamp;
        snipeTaxStartBps = IPopSnipeTax(factory).snipeTaxStartBps();
        snipeTaxSeconds = IPopSnipeTax(factory).snipeTaxSeconds();
        // The allocation the curve actually received, which is the whole
        // supply: the token mints to this curve in its own constructor.
        trackedTokens = IERC20(token_).balanceOf(address(this));

        emit Initialized(token_);
    }

    /**
     * @notice Tokens still available to buy before the curve graduates.
     */
    function sellableTokens() public view returns (uint256) {
        uint256 tracked = trackedTokens;
        return tracked > reservedTokens ? tracked - reservedTokens : 0;
    }

    /**
     * @notice Snipe tax `recipient` would pay on a buy landing right now, in
     * basis points of the quote leg. Starts at this launch's frozen
     * `snipeTaxStartBps` in the launch second and decays exponentially to
     * zero across `snipeTaxSeconds`. Exempt wallets and a disabled tax both
     * read as zero.
     * @dev The decay is fourteen successive halvings spread evenly across
     * the window, done with right shifts so it stays in integer arithmetic.
     * Fourteen because 2^14 exceeds the maximum 9,900 starting tax, so the
     * tax always reaches zero inside the window.
     */
    function currentSnipeTaxBps(address recipient) public view returns (uint256) {
        if (snipeTaxExempt[recipient]) return 0;
        uint256 startBps = snipeTaxStartBps;
        if (startBps == 0) return 0;
        uint256 elapsed = block.timestamp - launchedAt;
        uint256 window = snipeTaxSeconds;
        if (elapsed >= window) return 0;
        return startBps >> ((elapsed * 14) / window);
    }

    /**
     * @notice Marks `account` as exempt from the snipe tax. Called by the
     * factory during the launch transaction for the creator, their fee
     * recipient, and any bundle wallets the creator declared.
     */
    function exemptFromSnipeTax(address account) external onlyFactory {
        snipeTaxExempt[account] = true;
        emit SnipeTaxExempted(account);
    }

    /**
     * @notice Updates who receives creator fees from future sweeps.
     * Restricted to the factory, which authenticates the current creator
     * recipient before forwarding here, so this contract only needs to trust
     * one caller. There is no protocol-side override: lost creator keys mean
     * lost future creator fees, by design.
     */
    function setCreatorFeeRecipient(address newRecipient) external onlyFactory {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit CreatorFeeRecipientUpdated(creatorFeeRecipient, newRecipient);
        creatorFeeRecipient = newRecipient;
    }

    /**
     * @notice Returns the curve's current tradeable reserves, excluding fees pending sweep.
     */
    function getReserves() public view returns (uint256 quoteReserve_, uint256 tokenReserve_) {
        quoteReserve_ = phantomQuote + trackedQuote - _pendingTotal();
        tokenReserve_ = trackedTokens;
    }

    /**
     * @notice Tradeable quote reserve only, matching IPopBondingCurve.
     */
    function quoteReserve() external view returns (uint256 quoteReserve_) {
        (quoteReserve_,) = getReserves();
    }

    /**
     * @notice Returns physically held tradeable quote asset, excluding
     * virtual liquidity and balances already earmarked as fees.
     */
    function realQuoteReserve() public view returns (uint256) {
        return trackedQuote - _pendingTotal();
    }

    /**
     * @notice Tradeable token reserve only, matching IPopBondingCurve.
     */
    function tokenReserve() external view returns (uint256 tokenReserve_) {
        (, tokenReserve_) = getReserves();
    }

    function _pendingTotal() private view returns (uint256) {
        return pendingProtocolFees + pendingCreatorFees + pendingCashback;
    }

    /**
     * @notice True once the curve's sellable allocation has been bought out.
     * @dev Equivalent to the real quote reserve reaching
     * `graduationThreshold`, since the reserved balance is derived from that
     * same point. Expressed against the token side because that is the one a
     * buy cannot overshoot: the quote side is a floor a large trade could
     * sail past, while the token side is a hard stop the curve refuses to
     * cross.
     */
    function readyToGraduate() public view returns (bool) {
        if (graduated) return false;
        return sellableTokens() == 0;
    }

    /**
     * @notice Buys the launch token with this launch's quote asset. The fee
     * is always taken from the quote leg, so this curve never holds a fee
     * denominated in the launch token.
     * @dev The credited amount is the observed balance delta rather than the
     * requested amount, so a fee-on-transfer quote asset cannot make the
     * curve promise reserves it never received.
     *
     * A buy that would take the curve past its reserved allocation is filled
     * only up to that allocation, charged for what it actually received, and
     * refunded the difference. It is deliberately not rejected: the last buy
     * of a launch is the one most likely to be sized against a state someone
     * else has already moved, and reverting would let anyone grief it by
     * slipping a small buy in ahead.
     *
     * Buys landing in the opening seconds of a launch additionally pay the
     * decaying snipe tax (see `currentSnipeTaxBps`) unless the recipient was
     * exempted at launch. The tax comes off the quote leg before pricing, so
     * a sniper's spend mostly accrues as fees instead of buying tokens, and
     * it decays to nothing within seconds for ordinary buyers.
     *
     * Partial fills reinterpret `minTokensOut` as a bound on price rather
     * than on quantity, since a caller who spends less than they offered
     * cannot expect the whole quantity they asked for. When nothing is
     * clamped it reduces exactly to `tokensOut >= minTokensOut`.
     */
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient, uint256 deadline)
        external
        nonReentrant
        onlyInitialized
        checkDeadline(deadline)
        returns (uint256 tokensOut)
    {
        if (graduated) revert CurveGraduated();
        if (recipient == address(0)) revert ZeroAddress();

        uint256 received = _receiveQuote(quoteIn);
        if (received == 0) revert ZeroAmount();
        // graduate() is deliberately not nonReentrant and the factory's
        // trigger is permissionless, so a quote asset that yields control
        // during transferFrom could drain this curve between the check above
        // and the reserve reads below. Re-checking here rather than relying
        // on the downstream arithmetic to happen to revert.
        if (graduated) revert CurveGraduated();

        uint256 quoteReserveBefore = phantomQuote + trackedQuote - _pendingTotal();
        uint256 tokenReserveBefore = trackedTokens;

        // The snipe tax rides the quote leg like the base and creator fees,
        // but is bounded so the combined take always nets the buyer at least
        // 1% of their spend and the gross-up below never divides by zero. It
        // deliberately ignores MAX_TOTAL_TRADE_FEE_BPS: a 99% take in the
        // launch second is the entire point.
        uint256 snipeTaxBps = currentSnipeTaxBps(recipient);
        if (snipeTaxBps != 0) {
            uint256 maxSnipeTaxBps = BASIS_POINTS - feeBps - creatorFeeBps - 100;
            if (snipeTaxBps > maxSnipeTaxBps) snipeTaxBps = maxSnipeTaxBps;
        }

        uint256 spent = received;
        uint256 fee = (spent * feeBps) / BASIS_POINTS;
        uint256 creatorFee = (spent * creatorFeeBps) / BASIS_POINTS;
        uint256 snipeTax = (spent * snipeTaxBps) / BASIS_POINTS;
        tokensOut =
            PopCurveMath.getAmountOut(spent - fee - creatorFee - snipeTax, quoteReserveBefore, tokenReserveBefore, 0);

        uint256 sellable = tokenReserveBefore > reservedTokens ? tokenReserveBefore - reservedTokens : 0;
        if (sellable == 0) revert CurveGraduated();

        if (tokensOut > sellable) {
            tokensOut = sellable;
            // Price the clamped fill from the token side, then gross the
            // result back up so the fee legs still come out of the input.
            uint256 net = PopCurveMath.getAmountIn(sellable, quoteReserveBefore, tokenReserveBefore, 0);
            spent = Math.min(
                Math.mulDiv(net, BASIS_POINTS, BASIS_POINTS - feeBps - creatorFeeBps - snipeTaxBps, Math.Rounding.Ceil),
                received
            );
            fee = (spent * feeBps) / BASIS_POINTS;
            creatorFee = (spent * creatorFeeBps) / BASIS_POINTS;
            snipeTax = (spent * snipeTaxBps) / BASIS_POINTS;
        }

        // Price bound rather than quantity bound, so a partial fill honours
        // the caller's terms instead of failing them. Identical to
        // `tokensOut >= minTokensOut` whenever `spent == received`.
        if (spent * minTokensOut > received * tokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        trackedQuote += spent;
        trackedTokens -= tokensOut;
        // The snipe tax joins the base fee bucket, so it splits between
        // protocol, creator, and cashback under the launch's frozen policy.
        uint256 rebate = _accrueFees(fee + snipeTax, creatorFee, recipient);
        IERC20(token).safeTransfer(recipient, tokensOut);

        uint256 refund = received - spent;
        if (refund != 0) {
            emit CurveBuyRefunded(msg.sender, refund);
            IERC20(quoteToken).safeTransfer(msg.sender, refund);
        }

        if (snipeTax != 0) emit SnipeTaxCharged(recipient, snipeTax);
        emit CurveBuy(msg.sender, recipient, spent, tokensOut, fee + snipeTax, creatorFee, rebate);
        _tryAutoGraduate();
    }

    /**
     * @notice Sells the launch token back to the curve for the quote asset.
     * The fee is taken from the quote output, so it is always
     * quote-denominated here too.
     * @dev Closed once the sellable allocation is exhausted, not merely once
     * `graduated` is set: `_tryAutoGraduate` swallows a failed graduation so
     * a problem there cannot take the crossing buy down with it, which
     * leaves a window where the curve is ready but the flag is still false.
     * A sell landing in that window would put tokens back on the curve and
     * take quote off it, and the pool would then be seeded deeper and
     * cheaper than the reserved allocation fixes it at.
     *
     * This cannot strand a holder: graduation is permissionless, so anyone
     * blocked here can settle the launch themselves in the same transaction
     * and trade the V4 pool instead.
     */
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient, uint256 deadline)
        external
        nonReentrant
        onlyInitialized
        checkDeadline(deadline)
        returns (uint256 quoteOut)
    {
        if (graduated || readyToGraduate()) revert CurveGraduated();
        if (tokensIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        (uint256 quoteReserveBefore, uint256 tokenReserveBefore) = getReserves();
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);

        uint256 grossQuoteOut = PopCurveMath.getAmountOut(tokensIn, tokenReserveBefore, quoteReserveBefore, 0);
        uint256 fee = (grossQuoteOut * feeBps) / BASIS_POINTS;
        uint256 creatorFee = (grossQuoteOut * creatorFeeBps) / BASIS_POINTS;
        quoteOut = grossQuoteOut - fee - creatorFee;
        if (quoteOut < minQuoteOut) revert SlippageExceeded(quoteOut, minQuoteOut);

        trackedQuote -= quoteOut;
        trackedTokens += tokensIn;
        uint256 rebate = _accrueFees(fee, creatorFee, recipient);
        IERC20(quoteToken).safeTransfer(recipient, quoteOut);

        emit CurveSell(msg.sender, recipient, tokensIn, quoteOut, fee, creatorFee, rebate);
    }

    /**
     * @notice Distributes pending quote fees to the protocol and creator via
     * the escrow, and burns the pending QuoteBurn slice. Fully
     * permissionless: no leg of the sweep prices anything, so there is
     * nothing a hostile caller could execute at a bad price.
     * @dev Reverts once graduated rather than silently no-op'ing.
     * `graduate()` already drains every bucket to zero before setting the
     * flag, and trading is halted afterward so they can never refill, but
     * making the guard explicit keeps that invariant self-evident.
     */
    function sweepFees() external nonReentrant {
        if (graduated) revert AlreadyGraduated();
        _sweepFees();
    }

    /**
     * @notice Sweeps fees, halts trading, and hands the remaining tradeable
     * reserves to the factory so it can seed the graduated Uniswap V4 pool.
     * Because the curve already holds the pool's quote asset, the factory
     * receives exactly what it needs to seed with, and no conversion step
     * sits between the two. Restricted to the factory; deliberately not
     * `nonReentrant` since it may be invoked from within `buy()`'s own
     * reentrancy-guarded scope.
     */
    function graduate(address recipient) external onlyFactory returns (uint256 quoteOut, uint256 tokenOut) {
        if (graduated) revert AlreadyGraduated();
        if (recipient == address(0)) revert ZeroAddress();
        if (!readyToGraduate()) revert NotReadyToGraduate();

        // Halt trading before the sweep, not after. The sweep pays the
        // escrow, and a quote asset with a transfer callback could re-enter
        // buy() or sell() from inside that payment. This function is
        // deliberately not nonReentrant so it stays callable from within
        // buy()'s own guarded scope, so the flag is the only thing closing
        // that window.
        graduated = true;

        _sweepFees();

        // Hand over only the tracked trading reserves. Any quote asset or
        // launch token force-sent to this curve is deliberately left
        // stranded here rather than folded into the graduated pool's seed,
        // so a donation cannot move the price the pool opens at.
        quoteOut = trackedQuote;
        trackedQuote = 0;
        tokenOut = trackedTokens;
        trackedTokens = 0;

        if (quoteOut != 0) {
            IERC20(quoteToken).safeTransfer(recipient, quoteOut);
        }
        if (tokenOut != 0) {
            IERC20(token).safeTransfer(recipient, tokenOut);
        }

        emit CurveCompleted(recipient, quoteOut, tokenOut);
    }

    /**
     * @dev Pulls `amount` of the quote asset from the caller and returns the
     * amount actually received, so a fee-on-transfer quote asset is credited
     * for what arrived, not what was asked for.
     */
    function _receiveQuote(uint256 amount) private returns (uint256) {
        if (amount == 0) return 0;
        IERC20 quote = IERC20(quoteToken);
        uint256 balanceBefore = quote.balanceOf(address(this));
        quote.safeTransferFrom(msg.sender, address(this), amount);
        return quote.balanceOf(address(this)) - balanceBefore;
    }

    /**
     * @dev Credits `amount` of the quote asset to `recipient`'s claimable
     * escrow balance and removes it from the tracked reserve.
     */
    function _creditQuote(address recipient, uint256 amount) private {
        IERC20(quoteToken).forceApprove(address(feeEscrow), amount);
        feeEscrow.creditToken(recipient, quoteToken, amount);
        trackedQuote -= amount;
    }

    /**
     * @dev Attempts to graduate the instant a buy crosses the threshold, so
     * the crossing trade itself triggers the migration atomically. Wrapped
     * in try/catch: if graduation reverts for any reason the underlying buy
     * must still succeed, and graduation stays permissionlessly retryable
     * via the factory.
     *
     * A failure is announced rather than swallowed silently. The crossing
     * buyer sets their own gas limit and can starve this call under the
     * 63/64 rule, so the event is what lets a keeper notice a launch sitting
     * ready but ungraduated.
     */
    function _tryAutoGraduate() private {
        if (readyToGraduate()) {
            try IPopLaunchFactoryGraduation(factory).graduate(token) {}
            catch {
                emit AutoGraduationFailed(token, gasleft());
            }
        }
    }

    /**
     * @dev Books one trade's fee legs. `fee` (base fee plus any snipe tax)
     * splits protocol-first; the creator's take is their remainder plus the
     * whole creator fee; the cashback carve-out comes off that take:
     * - TraderRebate: credited to the trade's recipient through the escrow
     *   immediately, in this same transaction.
     * - QuoteBurn: earmarked and burned on the next sweep.
     * Returns the rebate paid, for event reporting.
     */
    function _accrueFees(uint256 fee, uint256 creatorFee, address recipient) private returns (uint256 rebate) {
        uint256 protocolPart = (fee * protocolFeeShareBps) / BASIS_POINTS;
        uint256 creatorTake = fee - protocolPart + creatorFee;

        uint256 cashbackPart;
        if (cashbackMode != CashbackMode.None && creatorTake != 0) {
            cashbackPart = (creatorTake * cashbackShareBps) / BASIS_POINTS;
        }

        pendingProtocolFees += protocolPart;
        pendingCreatorFees += creatorTake - cashbackPart;

        if (cashbackPart != 0) {
            if (cashbackMode == CashbackMode.TraderRebate) {
                // Paid in the same transaction: the trader is right here, and
                // deferring it would mean tracking who earned what.
                rebate = cashbackPart;
                _creditQuote(recipient, rebate);
            } else {
                // QuoteBurn and HolderRewards both settle in batch at sweep
                // time; the immutable mode decides which, so one bucket
                // serves both without any risk of a toggle re-routing value.
                pendingCashback += cashbackPart;
            }
        }
    }

    /**
     * @dev Pays the protocol and creator buckets through the escrow and
     * settles the cashback bucket under this launch's immutable mode. Every
     * payout reduces `trackedQuote`, so the tradeable reserve the pool is
     * later seeded from never counts fees.
     */
    function _sweepFees() private {
        uint256 protocolAmount = pendingProtocolFees;
        uint256 creatorAmount = pendingCreatorFees;
        uint256 cashbackAmount = pendingCashback;
        if (protocolAmount == 0 && creatorAmount == 0 && cashbackAmount == 0) return;

        pendingProtocolFees = 0;
        pendingCreatorFees = 0;
        pendingCashback = 0;

        if (protocolAmount != 0) _creditQuote(protocolFeeRecipient, protocolAmount);
        if (creatorAmount != 0) _creditQuote(creatorFeeRecipient, creatorAmount);
        if (cashbackAmount != 0) {
            trackedQuote -= cashbackAmount;
            if (cashbackMode == CashbackMode.QuoteBurn) {
                IERC20(quoteToken).safeTransfer(DEAD, cashbackAmount);
                emit QuoteBurned(cashbackAmount);
            } else {
                // HolderRewards: the launch token is its own distributor.
                // The transfer alone is enough, `sync()` is permissionless
                // and self-measuring. but crediting it here means holders
                // see the reward immediately rather than at the next
                // transfer that happens to touch the token.
                IERC20(quoteToken).safeTransfer(token, cashbackAmount);
                IPopRewardSink(token).sync();
                emit HolderRewardsPushed(cashbackAmount);
            }
        }

        emit FeesSwept(protocolAmount, creatorAmount, cashbackAmount);
    }

    /**
     * @notice Pays this curve's pending fees straight to the protocol and
     * creator recipients, bypassing the escrow. Restricted to the factory,
     * which gates it on the timelocked protocol owner.
     *
     * @dev Exists because an ordinary sweep routes every payout through
     * PopFeeEscrow, and a permissioned quote asset can stop delivering to
     * that one address while still permitting transfers between traders and
     * this curve. Trading then continues normally, but the fees are
     * unreachable, and graduation is unreachable with them: `graduate`
     * sweeps before it hands over the reserves, and fees accrue from the
     * first trade. The launch would be stuck on its curve forever.
     *
     * The pending cashback slice is folded into the creator payout rather
     * than settled under its mode: the motivating scenario is a quote asset
     * selectively blocklisting addresses, and the dead address (QuoteBurn)
     * or the reward token (HolderRewards) is as blockable as the escrow, so
     * attempting either could reproduce the failure this path exists to
     * route around. Recipients are fixed, the protocol owner chooses when
     * this runs, never where the money goes.
     */
    function rescueFees() external onlyFactory returns (uint256 protocolAmount, uint256 creatorAmount) {
        protocolAmount = pendingProtocolFees;
        creatorAmount = pendingCreatorFees + pendingCashback;
        if (protocolAmount == 0 && creatorAmount == 0) revert ZeroAmount();

        pendingProtocolFees = 0;
        pendingCreatorFees = 0;
        pendingCashback = 0;
        trackedQuote -= protocolAmount + creatorAmount;

        if (protocolAmount != 0) IERC20(quoteToken).safeTransfer(protocolFeeRecipient, protocolAmount);
        if (creatorAmount != 0) IERC20(quoteToken).safeTransfer(creatorFeeRecipient, creatorAmount);

        emit FeesRescued(protocolFeeRecipient, creatorFeeRecipient, protocolAmount, creatorAmount);
    }
}

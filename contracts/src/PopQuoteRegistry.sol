// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

import {IPopQuoteAdapter} from "./adapters/IPopQuoteAdapter.sol";
import {IPopQuoteRegistry} from "./interfaces/IPop.sol";

/**
 * @title PopQuoteRegistry
 * @notice The allowlist of quote tokens $POP launches may be denominated in,
 * and the source of each quote's curve economics. Listing is permissionless
 * and rule-based, the registry, not an admin, decides what qualifies:
 *
 * 1. The token must verify as a **graduated Pons token** through one of the
 *    registry's origin adapters (on-chain proof against the verified Pons
 *    factories, no oracle, no signature, no committee).
 * 2. The **permanently locked ETH-side liquidity** backing it must clear
 *    `minEthTvl`. Only locked positions count, so the floor cannot be faked
 *    with removable liquidity or donations. The floor is enforced *live* at
 *    every launch, not just at listing: a quote whose locked liquidity
 *    collapses simply stops hosting new launches, with no admin action and
 *    no effect on launches already trading.
 *
 * Each quote's curve economics (phantom reserve and graduation threshold,
 * in the quote's own base units) are derived from an ETH-denominated target
 * through the origin pool's TWAP, at listing and on permissionless,
 * rate-limited, deviation-clamped re-pegs. Launches snapshot these figures
 * at creation, so a re-peg never touches a live curve.
 *
 * The timelocked owner can: append origin adapters (additive only), pause
 * new launches per quote, and retune the floor/target for future listings
 * and re-pegs. It cannot delist a quote, touch a live launch, or bypass the
 * listing rules.
 */
contract PopQuoteRegistry is IPopQuoteRegistry, Ownable2Step {
    uint256 private constant BASIS_POINTS = 10_000;
    // phantom = threshold * 2 / 5, the ratio every Pons launch config uses
    // (1.68 / 4.2). Together with the threshold this fixes what fraction of
    // supply reaches the graduated pool, identically across quote assets.
    uint256 private constant PHANTOM_NUMERATOR = 2;
    uint256 private constant PHANTOM_DENOMINATOR = 5;
    uint8 private constant MIN_QUOTE_DECIMALS = 6;
    uint8 private constant MAX_QUOTE_DECIMALS = 18;
    uint32 public constant TWAP_WINDOW = 1800;
    // A re-peg may at most halve or double the stored threshold, and only
    // once per cooldown, so a manipulated TWAP moves future-launch economics
    // slowly and boundedly rather than arbitrarily.
    uint256 public constant REPEG_COOLDOWN = 1 days;

    error ZeroAddress();
    error OwnershipCannotBeRenounced();
    error InvalidAdapter();
    error UnknownAdapter();
    error AlreadyListed();
    error NotListed();
    error QuotePaused();
    error NotGraduated();
    error InsufficientLockedLiquidity(uint256 principal, uint256 floor);
    error UnsupportedDecimals(uint8 decimals);
    error InvalidEconomics();
    error RepegCooldownActive(uint256 availableAt);
    error InvalidTarget();

    event AdapterAdded(uint256 indexed adapterId, address adapter);
    event QuoteListed(
        address indexed quote,
        uint256 indexed adapterId,
        address indexed lister,
        uint256 phantomQuote,
        uint256 graduationThreshold
    );
    event QuoteRepegged(address indexed quote, uint256 phantomQuote, uint256 graduationThreshold);
    event QuotePausedUpdated(address indexed quote, bool paused);
    event MinEthTvlUpdated(uint256 minEthTvl);
    event GraduationTargetEthUpdated(uint256 targetEth);

    struct QuoteInfo {
        bool listed;
        bool paused;
        uint8 decimals;
        uint64 adapterId;
        uint256 phantomQuote;
        uint256 graduationThreshold;
        uint256 lastPegAt;
    }

    // Minimum permanently locked ETH-side principal a quote must hold, in
    // wei. Checked at listing and live at every launch.
    uint256 public minEthTvl;
    // ETH value the graduation threshold targets, converted into each
    // quote's own units through its origin pool's TWAP.
    uint256 public graduationTargetEth;

    IPopQuoteAdapter[] public adapters;
    mapping(address quote => QuoteInfo info) public quotes;

    constructor(address initialOwner, uint256 minEthTvl_, uint256 graduationTargetEth_) Ownable(initialOwner) {
        if (minEthTvl_ == 0 || graduationTargetEth_ == 0) revert InvalidTarget();
        minEthTvl = minEthTvl_;
        graduationTargetEth = graduationTargetEth_;
    }

    /**
     * @notice Permanently disabled. An ownerless registry could never add
     * the Pons v2 origin adapter or retune the liquidity floor, and the
     * owner's powers here never touch a live launch anyway.
     */
    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    // ---------------------------------------------------------------------
    // Owner configuration (timelocked; none of it affects live launches)
    // ---------------------------------------------------------------------

    /**
     * @notice Appends an origin adapter. Append-only: existing adapters can
     * never be replaced or removed, so quotes listed through one keep their
     * verification path forever. This is how Pons v2 pools and, later,
     * stock-token origins arrive without touching anything already listed.
     */
    function addAdapter(IPopQuoteAdapter adapter) external onlyOwner returns (uint256 adapterId) {
        if (address(adapter) == address(0)) revert InvalidAdapter();
        adapterId = adapters.length;
        adapters.push(adapter);
        emit AdapterAdded(adapterId, address(adapter));
    }

    /**
     * @notice Pauses or unpauses new launches quoted in `quote`. Never
     * affects existing curves or pools: their economics were snapshotted at
     * launch and their trading paths never consult the registry again.
     */
    function setQuotePaused(address quote, bool paused) external onlyOwner {
        if (!quotes[quote].listed) revert NotListed();
        quotes[quote].paused = paused;
        emit QuotePausedUpdated(quote, paused);
    }

    /**
     * @notice Retunes the locked-liquidity floor for future listings and
     * launches.
     */
    function setMinEthTvl(uint256 minEthTvl_) external onlyOwner {
        if (minEthTvl_ == 0) revert InvalidTarget();
        minEthTvl = minEthTvl_;
        emit MinEthTvlUpdated(minEthTvl_);
    }

    /**
     * @notice Retunes the ETH-denominated graduation target future listings
     * and re-pegs derive quote thresholds from.
     */
    function setGraduationTargetEth(uint256 targetEth) external onlyOwner {
        if (targetEth == 0) revert InvalidTarget();
        graduationTargetEth = targetEth;
        emit GraduationTargetEthUpdated(targetEth);
    }

    // ---------------------------------------------------------------------
    // Permissionless listing and re-pegging
    // ---------------------------------------------------------------------

    /**
     * @notice Lists a graduated Pons token as a quote asset. Permissionless:
     * anyone may list any token that satisfies the rules.
     */
    function listQuote(address quote, uint256 adapterId) external {
        if (quote == address(0)) revert ZeroAddress();
        if (quotes[quote].listed) revert AlreadyListed();
        if (adapterId >= adapters.length) revert UnknownAdapter();

        uint8 decimals = IERC20Metadata(quote).decimals();
        // Curve fees are integer basis points of the quote leg, so on a
        // coarse asset every trade below BASIS_POINTS / feeBps base units
        // rounds its fee to zero. Six decimals is the floor at which that
        // band is dust.
        if (decimals < MIN_QUOTE_DECIMALS || decimals > MAX_QUOTE_DECIMALS) revert UnsupportedDecimals(decimals);

        IPopQuoteAdapter adapter = adapters[adapterId];
        _requireQualified(adapter, quote);

        (uint256 phantomQuote, uint256 graduationThreshold) = _deriveEconomics(adapter, quote);
        quotes[quote] = QuoteInfo({
            listed: true,
            paused: false,
            decimals: decimals,
            adapterId: uint64(adapterId),
            phantomQuote: phantomQuote,
            graduationThreshold: graduationThreshold,
            lastPegAt: block.timestamp
        });

        emit QuoteListed(quote, adapterId, msg.sender, phantomQuote, graduationThreshold);
    }

    /**
     * @notice Refreshes a quote's peg to the current TWAP so its graduation
     * threshold tracks the configured ETH target as the quote's own price
     * moves. Permissionless, rate-limited, and clamped: one call per
     * cooldown, moving the threshold by at most 2x in either direction, so
     * TWAP manipulation buys bounded drift on *future* launches only.
     */
    function repegQuote(address quote) external {
        QuoteInfo storage info = quotes[quote];
        if (!info.listed) revert NotListed();
        uint256 availableAt = info.lastPegAt + REPEG_COOLDOWN;
        if (block.timestamp < availableAt) revert RepegCooldownActive(availableAt);

        IPopQuoteAdapter adapter = adapters[info.adapterId];
        (uint256 phantomQuote, uint256 graduationThreshold) = _deriveEconomics(adapter, quote);

        uint256 previous = info.graduationThreshold;
        uint256 floor = previous / 2;
        uint256 ceiling = previous * 2;
        if (graduationThreshold < floor) graduationThreshold = floor;
        if (graduationThreshold > ceiling) graduationThreshold = ceiling;
        phantomQuote = (graduationThreshold * PHANTOM_NUMERATOR) / PHANTOM_DENOMINATOR;
        if (phantomQuote == 0 || graduationThreshold == 0) revert InvalidEconomics();

        info.phantomQuote = phantomQuote;
        info.graduationThreshold = graduationThreshold;
        info.lastPegAt = block.timestamp;

        emit QuoteRepegged(quote, phantomQuote, graduationThreshold);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IPopQuoteRegistry
    function ethLaunchEconomics(address quote)
        external
        view
        returns (uint256 phantomEth, uint256 bondThresholdEth)
    {
        QuoteInfo memory info = quotes[quote];
        if (!info.listed) revert NotListed();
        if (info.paused) revert QuotePaused();
        // The liquidity floor and graduation proof are enforced live, at
        // every launch: a quote whose locked backing collapsed, or whose
        // origin somehow stopped reporting it graduated, stops hosting new
        // launches immediately and permissionlessly.
        _requireQualified(adapters[info.adapterId], quote);
        bondThresholdEth = graduationTargetEth;
        phantomEth = (bondThresholdEth * PHANTOM_NUMERATOR) / PHANTOM_DENOMINATOR;
        if (phantomEth == 0) revert InvalidEconomics();
    }

    /// @inheritdoc IPopQuoteRegistry
    function bondConversion(address quote) external view returns (address pool, uint256 quotePerEthTwap) {
        QuoteInfo memory info = quotes[quote];
        if (!info.listed) revert NotListed();
        IPopQuoteAdapter adapter = adapters[info.adapterId];
        (pool,) = adapter.conversionPool(quote);
        quotePerEthTwap = adapter.quotePerEth(quote, TWAP_WINDOW);
        if (quotePerEthTwap == 0) revert InvalidEconomics();
    }

    /**
     * @notice Quote-denominated economics kept for off-chain reference and
     * historical tooling; the launch path itself now prices its curve in ETH
     * via `ethLaunchEconomics`.
     */
    function getLaunchEconomics(address quote)
        external
        view
        returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals)
    {
        QuoteInfo memory info = quotes[quote];
        if (!info.listed) revert NotListed();
        if (info.paused) revert QuotePaused();
        // The liquidity floor and graduation proof are enforced live, at
        // every launch: a quote whose locked backing collapsed, or whose
        // origin somehow stopped reporting it graduated, stops hosting new
        // launches immediately and permissionlessly.
        _requireQualified(adapters[info.adapterId], quote);
        // An upgradeable quote asset could change its reported decimals
        // after listing; every curve prices against the stored figure for
        // its whole life, so a drifted report must fail the launch rather
        // than misprice it.
        uint8 reported = IERC20Metadata(quote).decimals();
        if (reported != info.decimals) revert UnsupportedDecimals(reported);
        return (info.phantomQuote, info.graduationThreshold, info.decimals);
    }

    /// @inheritdoc IPopQuoteRegistry
    function isListed(address quote) external view returns (bool) {
        return quotes[quote].listed;
    }

    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    /**
     * @dev Graduation proof plus the locked-liquidity floor, shared by
     * listing and the live per-launch check.
     */
    function _requireQualified(IPopQuoteAdapter adapter, address quote) private view {
        (bool graduated, uint256 ethPrincipal) = adapter.verify(quote);
        if (!graduated) revert NotGraduated();
        if (ethPrincipal < minEthTvl) revert InsufficientLockedLiquidity(ethPrincipal, minEthTvl);
    }

    /**
     * @dev Converts the ETH-denominated graduation target into this quote's
     * own units via the origin pool's TWAP, and derives the phantom reserve
     * at the fixed ratio.
     */
    function _deriveEconomics(IPopQuoteAdapter adapter, address quote)
        private
        view
        returns (uint256 phantomQuote, uint256 graduationThreshold)
    {
        uint256 quotePerEth = adapter.quotePerEth(quote, TWAP_WINDOW);
        if (quotePerEth == 0) revert InvalidEconomics();
        graduationThreshold = FullMath.mulDiv(graduationTargetEth, quotePerEth, 1e18);
        phantomQuote = (graduationThreshold * PHANTOM_NUMERATOR) / PHANTOM_DENOMINATOR;
        if (phantomQuote == 0 || graduationThreshold == 0) revert InvalidEconomics();
    }
}

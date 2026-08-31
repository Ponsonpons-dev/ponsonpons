// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @notice Shared $POP launchpad interfaces and types.
 *
 * $POP ("Pons on Pons") launches new tokens on a constant-product bonding
 * curve quoted in a graduated Pons token, then graduates each curve into a
 * permanently locked, full-range Uniswap V4 position. The mechanics are
 * adapted from the verified PonsV2 launchpad sources (MIT,
 * 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e on Robinhood Chain), with the
 * admin powers that could touch user value removed and a creator-configurable
 * fee/cashback matrix added. Uniswap V4 core and periphery types are imported
 * directly from the vendored packages by the contracts that need them.
 */

/**
 * @notice Creator-chosen fee routing for one launch, immutable from creation.
 * The share is carved out of the creator's take (their slice of the base fee
 * plus their whole creator fee), so the total fee charged to traders never
 * changes with the mode.
 * - None: the creator keeps their whole take.
 * - TraderRebate: `shareBps` of the creator take on each curve trade is
 *   credited back to that trade's recipient in the quote token, in the same
 *   transaction. Applies on the bonding curve only; after graduation the
 *   swap router obscures the human trader, so the share reverts to the
 *   creator (disclosed at creation).
 * - QuoteBurn: `shareBps` of the creator take is sent to the dead address in
 *   the quote token, both before and after graduation. Launching on a quote
 *   token makes that token deflationary; no swap, oracle, or operator is
 *   involved because the fees are already quote-denominated.
 * - HolderRewards: `shareBps` of the creator take is pushed to the launch
 *   token itself, which distributes it pro-rata to holders continuously and
 *   without an operator. Applies before and after graduation. This is the
 *   one mode that changes the launch token: it deploys `PopRewardToken`
 *   (accounting-only transfer hook, still no owner or transfer restriction)
 *   rather than the inert `PopLaunchToken`.
 */
enum CashbackMode {
    None,
    TraderRebate,
    QuoteBurn,
    HolderRewards
}

struct CashbackConfig {
    CashbackMode mode;
    uint16 shareBps;
}

/**
 * @notice Protocol fee terms frozen for one launch when its curve is created
 * and carried into its graduated pool at registration. On $POP the share,
 * hook fee, and price-impact bound are hook constructor immutables; only the
 * recipient can change (behind the protocol timelock), and even that is
 * snapshotted per launch.
 */
struct FeePolicySnapshot {
    address protocolFeeRecipient;
    uint16 protocolFeeShareBps;
    uint16 hookFeeBps;
    uint16 maxInternalPriceImpactBps;
}

/**
 * @notice Claimable balance ledger shared by every $POP bonding curve and the
 * hook. Crediting requires the caller to fund the credit via `transferFrom`,
 * so it is safe to leave open. Pull-payment keeps a reverting or blocklisted
 * recipient from wedging trading, sweeps, or graduation.
 */
interface IPopFeeEscrow {
    function creditToken(address recipient, address token, uint256 amount) external returns (uint256 credited);
    function claimToken(address token) external returns (uint256 amount);
    function claimToken(address token, uint256 amount) external returns (uint256);
    function balanceOfToken(address recipient, address token) external view returns (uint256);
}

/**
 * @notice Live protocol fee policy read from the hook. The policy terms are
 * hook immutables; the recipient and sweep operator are the only rotatable
 * pieces, and the recipient is still snapshotted per launch.
 */
interface IPopFeePolicy {
    function protocolFeeRecipient() external view returns (address);
    function protocolFeeShareBps() external view returns (uint256);
    function maxInternalPriceImpactBps() external view returns (uint256);
    function feeSweepOperator() external view returns (address);
    function currentFeePolicy() external view returns (FeePolicySnapshot memory);
}

/**
 * @notice Anti-snipe tax terms each bonding curve snapshots from the factory
 * when it initializes, inside its own launch transaction. A curve already
 * trading keeps the terms it launched under, so a factory retune (behind the
 * protocol timelock) can never reprice an open launch window.
 */
interface IPopSnipeTax {
    function snipeTaxStartBps() external view returns (uint256);
    function snipeTaxSeconds() external view returns (uint256);
}

/**
 * @notice Registry of quote tokens new launches may be denominated in.
 * Listing is permissionless and rule-based: the token must be a graduated
 * Pons token (verified on-chain through an origin adapter) whose permanently
 * locked ETH-side pool liquidity clears the registry's floor.
 */
interface IPopQuoteRegistry {
    /**
     * @notice Curve economics for launches quoted in `quote`, in the quote
     * token's own base units. Reverts unless the quote is listed and not
     * paused for new launches.
     */
    function getLaunchEconomics(address quote)
        external
        view
        returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals);

    function isListed(address quote) external view returns (bool);
}

/**
 * @notice Graduation proceeds in two permissionless phases so the
 * slippage-free but state-heavy pool seed is never bundled with the
 * threshold-crossing trade:
 * - NotGraduated: still trading on the bonding curve.
 * - Swept: the curve has been drained (fees swept, trading halted, quote and
 *   remaining token supply pulled into the factory); still needs a V4 pool.
 * - PoolCreated: the V4 pool exists, its full-range position is locked, and
 *   the hook is registered for it. Terminal.
 * - Rescued: the swept reserves were released to the launch's creator fee
 *   recipient because the quote asset stopped being able to deliver an exact
 *   transfer, which no retry of the seed step could ever satisfy. Terminal.
 */
enum GraduationPhase {
    NotGraduated,
    Swept,
    PoolCreated,
    Rescued
}

/**
 * @notice Record kept by PopLaunchFactory for every launch, readable by the
 * locker, the hook, and off-chain indexers.
 */
interface IPopLaunchFactory {
    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address quoteToken;
        uint256 graduationThreshold;
        // Snapshotted from the launch config at launch time, so a later
        // config edit can never change the pool a token graduates into.
        uint24 poolFee;
        int24 tickSpacing;
        // Creator-chosen at launch, capped by MAX_CREATOR_FEE_BPS; an
        // additional trade fee charged the same way the base fee is, paid
        // entirely to the creator (minus their chosen cashback share).
        uint16 creatorFeeBps;
        CashbackConfig cashback;
        GraduationPhase phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
}

/**
 * @notice Narrow surface the curve needs from the factory to trigger
 * graduation the instant a buy crosses the threshold.
 */
interface IPopLaunchFactoryGraduation {
    function graduate(address token) external;
}

/**
 * @notice Narrow surface the factory needs from a bonding curve.
 */
interface IPopBondingCurve {
    function token() external view returns (address);
    function quoteToken() external view returns (address);
    function graduationThreshold() external view returns (uint256);
    function graduated() external view returns (bool);
    function quoteReserve() external view returns (uint256);
    function realQuoteReserve() external view returns (uint256);
    function tokenReserve() external view returns (uint256);
    function readyToGraduate() external view returns (bool);
    function sweepFees() external;
    function graduate(address recipient) external returns (uint256 quoteOut, uint256 tokenOut);
}

/**
 * @notice The launch-token surface the `HolderRewards` mode pushes into.
 * Implemented by `PopRewardToken`, which distributes whatever reward asset
 * it holds to its own holders. `sync()` is permissionless and takes no
 * amount: it credits the balance delta since the last call, so a caller can
 * never misreport what it sent.
 */
interface IPopRewardSink {
    function sync() external;
}

/**
 * @notice Minimal ERC-721 receiver signature used by PopLocker to accept the
 * graduated Uniswap V4 position NFT.
 */
interface IERC721ReceiverLike {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

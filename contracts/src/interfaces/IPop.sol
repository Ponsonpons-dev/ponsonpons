// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @notice Shared $POP launchpad interfaces and types.
 *
 * $POP ("Pons on Pons") launches new tokens straight into a live Uniswap V4
 * pool quoted in WETH: the bonding curve is a single-sided concentrated
 * liquidity position laid over the curve's price range, so every launch is
 * tradeable by any V4-capable router from its first block. When the curve
 * range fills (the bond threshold in ETH is raised), the raised WETH is
 * converted into the launch's chosen graduated Pons quote token in one
 * market buy, and the launch is re-seeded as a permanently locked full-range
 * token/quote position. The mechanics are adapted from the verified PonsV2
 * launchpad sources (MIT, 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e on
 * Robinhood Chain), with the admin powers that could touch user value
 * removed and a creator-configurable fee/cashback matrix added.
 */

/**
 * @notice Creator-chosen fee routing for one launch, immutable from creation.
 * The share is carved out of the creator's take (their slice of the base fee
 * plus their whole creator fee), so the total fee charged to traders never
 * changes with the mode.
 * - None: the creator keeps their whole take.
 * - TraderRebate: retired in v2. The launchpad's whole life now happens
 *   behind swap routers that obscure the human trader, so the rebate could
 *   never reach its target. Launch attempts with this mode are rejected.
 * - QuoteBurn: `shareBps` of the creator take is sent to the dead address in
 *   the launch's bond quote token. During the ETH curve phase the carve-out
 *   accrues in WETH and is converted alongside the bond's own conversion, so
 *   the burn is always quote-denominated.
 * - HolderRewards: `shareBps` of the creator take is pushed to the launch
 *   token itself, which distributes it pro-rata to holders continuously and
 *   without an operator. Curve-phase accruals convert at bond time like
 *   QuoteBurn's. This is the one mode that changes the launch token: it
 *   deploys `PopRewardToken` (accounting-only transfer hook, still no owner
 *   or transfer restriction) rather than the inert `PopLaunchToken`.
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
 * @notice Protocol fee terms frozen for one launch when its curve pool is
 * created and carried into its bonded pool at registration. On $POP the
 * share, hook fee, and price-impact bound are hook constructor immutables;
 * only the recipient can change (behind the protocol timelock), and even
 * that is snapshotted per launch.
 */
struct FeePolicySnapshot {
    address protocolFeeRecipient;
    uint16 protocolFeeShareBps;
    uint16 hookFeeBps;
    uint16 maxInternalPriceImpactBps;
}

/**
 * @notice Anti-snipe tax terms one launch snapshots from the factory inside
 * its own launch transaction, enforced by the hook on the curve pool. A
 * launch already trading keeps the terms it launched under.
 */
struct SnipeTaxTerms {
    uint16 startBps;
    uint32 windowSeconds;
    uint64 launchedAt;
}

/**
 * @notice Claimable balance ledger shared by the hook and the factory.
 * Crediting requires the caller to fund the credit via `transferFrom`, so it
 * is safe to leave open. Pull-payment keeps a reverting or blocklisted
 * recipient from wedging trading, sweeps, or bonding.
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
 * @notice Anti-snipe tax terms the factory quotes to new launches.
 */
interface IPopSnipeTax {
    function snipeTaxStartBps() external view returns (uint256);
    function snipeTaxSeconds() external view returns (uint256);
}

/**
 * @notice Registry of quote tokens launches may bond into. Listing is
 * permissionless and rule-based: the token must be a graduated Pons token
 * (verified on-chain through an origin adapter) whose permanently locked
 * ETH-side pool liquidity clears the registry's floor.
 */
interface IPopQuoteRegistry {
    /**
     * @notice ETH-denominated curve economics for new launches bonding into
     * `quote`: the phantom (virtual) ETH reserve fixing the launch price and
     * the ETH raise that triggers the bond. Reverts unless the quote is
     * listed, unpaused, and still clears the locked-liquidity floor live.
     */
    function ethLaunchEconomics(address quote)
        external
        view
        returns (uint256 phantomEth, uint256 bondThresholdEth);

    /**
     * @notice Everything the bond conversion needs to market-buy `quote`
     * with the curve's raised WETH: the origin's canonical V3 WETH pool and
     * the current TWAP (quote base units per 1e18 wei), for bounding the
     * execution.
     */
    function bondConversion(address quote) external view returns (address pool, uint256 quotePerEthTwap);

    function isListed(address quote) external view returns (bool);
}

/**
 * @notice Lifecycle of one launch:
 * - Trading: live on its WETH curve pool. When the curve range fills, the
 *   hook records bond-readiness and anyone may execute the bond.
 * - Bonded: the raised WETH has been converted to the bond quote and the
 *   token/quote pool is live with its position locked forever. Terminal.
 * - Rescued: the bond could never complete (the quote asset stopped being
 *   able to deliver exact transfers, or its origin pool disappeared), so
 *   after the delay the curve proceeds were released to the launch's
 *   creator fee recipient. Terminal.
 */
enum LaunchPhase {
    Trading,
    Bonded,
    Rescued
}

/**
 * @notice Record kept by PopLaunchFactory for every launch, readable by the
 * locker, the hook, and off-chain indexers.
 */
interface IPopLaunchFactory {
    struct LaunchedToken {
        address token;
        address deployer;
        address creatorFeeRecipient;
        // The bond target: the graduated Pons token the launch's raised WETH
        // converts into and its bonded pool is quoted in.
        address quoteToken;
        // Snapshotted from the launch config at launch time, so a later
        // config edit can never change the pools a token trades in.
        uint24 poolFee;
        int24 tickSpacing;
        // Creator-chosen at launch, capped by MAX_CREATOR_FEE_BPS; an
        // additional trade fee charged the same way the base fee is, paid
        // entirely to the creator (minus their chosen cashback share).
        uint16 creatorFeeBps;
        CashbackConfig cashback;
        LaunchPhase phase;
        // ETH curve terms, tick-rounded at launch. bondThresholdEth is the
        // WETH the fully-bought curve position returns, derived from the
        // rounded ticks rather than the config's nominal target.
        uint256 phantomEth;
        uint256 bondThresholdEth;
        int24 curveTickLower;
        int24 curveTickUpper;
        uint128 curveLiquidity;
        // Token supply held back from the curve for the bonded pool's seed.
        uint256 reservedTokens;
        uint256 bondedAt;
        bool exists;
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
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
 * bonded Uniswap V4 position NFT.
 */
interface IERC721ReceiverLike {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

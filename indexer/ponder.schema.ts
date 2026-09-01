import { index, onchainTable, primaryKey } from "ponder";

/**
 * $POP v2 indexer schema. Amounts are raw bigints in each asset's own base
 * units; prices are paired-currency-per-token scaled by 1e18. USD/ETH
 * conversion happens at the API/frontend layer via the registry's TWAP data
 * (see repeg table), never here.
 *
 * Denomination: a launch trades in two currencies over its life. Its curve
 * pool is quoted in WETH; its bonded pool is quoted in the launch's bond
 * quote token. Rows that carry money therefore carry `denom`:
 *   0 = ETH/WETH (curve-phase rows), 1 = bond quote token (bonded rows).
 * The "Quote"-named price/amount fields (priceQuoteWad, quoteAmount,
 * volumeQuote on trades/candles, lastPriceQuoteWad on launch) keep their v1
 * names but are denominated per the row's denom; a launch's
 * lastPriceQuoteWad follows its phase (WETH-denominated while Trading,
 * quote-denominated once Bonded).
 */

export const quote = onchainTable("quote", (t) => ({
  address: t.hex().primaryKey(),
  symbol: t.text(),
  name: t.text(),
  decimals: t.integer().notNull(),
  adapterId: t.bigint().notNull(),
  listedAt: t.bigint().notNull(),
  listedBy: t.hex().notNull(),
  paused: t.boolean().notNull().default(false),
  phantomQuote: t.bigint().notNull(),
  graduationThreshold: t.bigint().notNull(),
  lastPegAt: t.bigint().notNull(),
  // Leaderboard aggregates (the quote-community pitch), all denominated in
  // the quote token itself. Curve-phase activity is WETH-denominated and
  // lives on the launch (volumeEth, creatorFeesEth), never here.
  launchCount: t.integer().notNull().default(0),
  // v1 name kept: counts launches that bonded into this quote.
  graduatedCount: t.integer().notNull().default(0),
  totalBurned: t.bigint().notNull().default(0n),
  totalHolderRewards: t.bigint().notNull().default(0n),
  totalVolume: t.bigint().notNull().default(0n),
  totalCreatorFees: t.bigint().notNull().default(0n),
  totalProtocolFees: t.bigint().notNull().default(0n),
}));

export const launch = onchainTable(
  "launch",
  (t) => ({
    token: t.hex().primaryKey(),
    deployer: t.hex().notNull(),
    creatorFeeRecipient: t.hex().notNull(),
    // The bond target: the graduated Pons token the raise converts into.
    quoteToken: t.hex().notNull(),
    name: t.text().notNull(),
    symbol: t.text().notNull(),
    logo: t.text().notNull(),
    description: t.text().notNull(),
    twitter: t.text().notNull().default(""),
    telegram: t.text().notNull().default(""),
    discord: t.text().notNull().default(""),
    website: t.text().notNull().default(""),
    farcaster: t.text().notNull().default(""),
    supply: t.bigint().notNull(),
    // ETH curve terms (v1's phantomQuote/graduationThreshold, now
    // ETH-denominated because every curve is quoted in WETH).
    phantomEth: t.bigint().notNull(),
    bondThresholdEth: t.bigint().notNull(),
    reservedTokens: t.bigint().notNull(),
    creatorFeeBps: t.integer().notNull(),
    cashbackMode: t.integer().notNull(), // 0 None, 2 QuoteBurn, 3 HolderRewards (1 TraderRebate retired)
    cashbackShareBps: t.integer().notNull(),
    // 0 Trading, 1 Bonded, 2 Rescued
    phase: t.integer().notNull().default(0),
    createdAt: t.bigint().notNull(),
    createdAtBlock: t.bigint().notNull(),
    // V4 pool ids: the WETH curve pool lives from launch; the token/quote
    // bonded pool exists once the launch bonds. poolId keeps the v1 name as
    // an alias of bondedPoolId (v1's poolId was the graduated pool).
    curvePoolId: t.hex().notNull(),
    bondedPoolId: t.hex(),
    poolId: t.hex(),
    positionId: t.bigint(),
    // Set by the hook when the curve range fills; cleared never (a bonded
    // launch simply moves to phase 1).
    bondReady: t.boolean().notNull().default(false),
    bondedAt: t.bigint(),
    // v1 name kept as an alias of bondedAt.
    graduatedAt: t.bigint(),
    // From LaunchBonded: WETH converted and quote bought by the bond.
    ethConverted: t.bigint(),
    quoteBought: t.bigint(),
    lockedSupplyExcess: t.bigint().notNull().default(0n),
    // Live trading state. lastPriceQuoteWad is paired-currency per token
    // * 1e18, denominated per phase (see header).
    lastPriceQuoteWad: t.bigint().notNull().default(0n),
    volumeEth: t.bigint().notNull().default(0n), // curve-phase volume (WETH)
    volumeQuote: t.bigint().notNull().default(0n), // bonded-phase volume (quote)
    tradeCount: t.integer().notNull().default(0),
    burnedQuote: t.bigint().notNull().default(0n),
    holderRewardsQuote: t.bigint().notNull().default(0n),
    creatorFeesQuote: t.bigint().notNull().default(0n),
    // Creator's curve-phase fee sweeps, WETH-denominated.
    creatorFeesEth: t.bigint().notNull().default(0n),
  }),
  (table) => ({
    quoteIdx: index().on(table.quoteToken),
    deployerIdx: index().on(table.deployer),
    curvePoolIdx: index().on(table.curvePoolId),
    bondedPoolIdx: index().on(table.bondedPoolId),
    createdIdx: index().on(table.createdAt),
  }),
);

export const trade = onchainTable(
  "trade",
  (t) => ({
    id: t.text().primaryKey(), // txHash-logIndex
    token: t.hex().notNull(),
    trader: t.hex().notNull(),
    recipient: t.hex().notNull(),
    isBuy: t.boolean().notNull(),
    // "curve" (WETH curve pool) or "pool" (bonded quote pool)
    venue: t.text().notNull(),
    denom: t.integer().notNull(), // 0 ETH, 1 quote
    quoteAmount: t.bigint().notNull(), // in the row's denom currency
    tokenAmount: t.bigint().notNull(),
    priceQuoteWad: t.bigint().notNull(), // denom currency per token * 1e18
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    tokenIdx: index().on(table.token, table.timestamp),
    traderIdx: index().on(table.trader),
  }),
);

export const candle = onchainTable(
  "candle",
  (t) => ({
    token: t.hex().notNull(),
    // Part of the PK so curve (ETH) and bonded (quote) series never mix in
    // one bucket; the frontend charts one denom at a time.
    denom: t.integer().notNull(), // 0 ETH, 1 quote
    interval: t.integer().notNull(), // seconds: 60, 900, 3600, 86400
    bucketStart: t.bigint().notNull(),
    open: t.bigint().notNull(),
    high: t.bigint().notNull(),
    low: t.bigint().notNull(),
    close: t.bigint().notNull(),
    volumeQuote: t.bigint().notNull(), // in the row's denom currency
    trades: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.token, table.denom, table.interval, table.bucketStart] }),
  }),
);

export const burn = onchainTable(
  "burn",
  (t) => ({
    id: t.text().primaryKey(),
    token: t.hex().notNull(),
    quoteToken: t.hex().notNull(),
    amount: t.bigint().notNull(), // always quote-denominated
    source: t.text().notNull(), // "pool" | "bond"
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    quoteIdx: index().on(table.quoteToken, table.timestamp),
  }),
);

/** Quote pushed to a HolderRewards launch token for its holders. */
export const holderReward = onchainTable(
  "holder_reward",
  (t) => ({
    id: t.text().primaryKey(),
    token: t.hex().notNull(),
    quoteToken: t.hex().notNull(),
    amount: t.bigint().notNull(), // always quote-denominated
    source: t.text().notNull(), // "pool" | "bond"
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    tokenIdx: index().on(table.token, table.timestamp),
  }),
);

export const creatorStat = onchainTable(
  "creator_stat",
  (t) => ({
    creator: t.hex().notNull(),
    quoteToken: t.hex().notNull(),
    feesEarned: t.bigint().notNull().default(0n),
    burnsFunded: t.bigint().notNull().default(0n),
    launches: t.integer().notNull().default(0),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.creator, table.quoteToken] }),
  }),
);

/**
 * Fast PK lookup from a V4 pool id to its launch. `paired` is the pool's
 * non-launch currency (WETH for the curve pool, the bond quote for the
 * bonded pool), taken from PoolRegistered's quoteToken field; the Swap
 * handler needs it for currency ordering and price denomination.
 */
export const poolRef = onchainTable("pool_ref", (t) => ({
  poolId: t.hex().primaryKey(),
  token: t.hex().notNull(),
  denom: t.integer().notNull(), // 0 curve/ETH, 1 bonded/quote
  paired: t.hex().notNull(),
}));

/**
 * Token-keyed pool registry. Needed because the curve pool's PoolRegistered
 * lands before TokenLaunched in the launch transaction, so the launch row
 * cannot receive its curvePoolId directly; TokenLaunched reads it here.
 */
export const launchPools = onchainTable("launch_pools", (t) => ({
  token: t.hex().primaryKey(),
  curvePoolId: t.hex().notNull(),
  bondedPoolId: t.hex(),
}));

export const repeg = onchainTable("repeg", (t) => ({
  id: t.text().primaryKey(),
  quoteToken: t.hex().notNull(),
  phantomQuote: t.bigint().notNull(),
  graduationThreshold: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

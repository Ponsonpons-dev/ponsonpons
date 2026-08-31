import { index, onchainTable, primaryKey } from "ponder";

/**
 * $POP indexer schema. Amounts are raw bigints in each asset's own base
 * units; prices are quote-per-token scaled by 1e18 so 6/8/18-decimal quotes
 * share one representation. USD/ETH conversion happens at the API/frontend
 * layer via the registry's TWAP data (see repeg table), never here.
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
  // Leaderboard aggregates (the quote-community pitch).
  launchCount: t.integer().notNull().default(0),
  graduatedCount: t.integer().notNull().default(0),
  totalBurned: t.bigint().notNull().default(0n),
  totalHolderRewards: t.bigint().notNull().default(0n),
  totalVolume: t.bigint().notNull().default(0n),
  totalCreatorFees: t.bigint().notNull().default(0n),
  totalProtocolFees: t.bigint().notNull().default(0n),
  totalRebates: t.bigint().notNull().default(0n),
}));

export const launch = onchainTable(
  "launch",
  (t) => ({
    token: t.hex().primaryKey(),
    curve: t.hex().notNull(),
    deployer: t.hex().notNull(),
    creatorFeeRecipient: t.hex().notNull(),
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
    phantomQuote: t.bigint().notNull(),
    graduationThreshold: t.bigint().notNull(),
    reservedTokens: t.bigint().notNull(),
    creatorFeeBps: t.integer().notNull(),
    cashbackMode: t.integer().notNull(), // 0 None, 1 TraderRebate, 2 QuoteBurn
    cashbackShareBps: t.integer().notNull(),
    // 0 NotGraduated, 1 Swept, 2 PoolCreated, 3 Rescued
    phase: t.integer().notNull().default(0),
    createdAt: t.bigint().notNull(),
    createdAtBlock: t.bigint().notNull(),
    sweptAt: t.bigint(),
    graduatedAt: t.bigint(),
    poolId: t.hex(),
    positionId: t.bigint(),
    lockedSupplyExcess: t.bigint().notNull().default(0n),
    // Live trading state.
    lastPriceQuoteWad: t.bigint().notNull().default(0n), // quote per token * 1e18
    realQuoteReserve: t.bigint().notNull().default(0n),
    tokensSold: t.bigint().notNull().default(0n),
    curveProgressBps: t.integer().notNull().default(0),
    volumeQuote: t.bigint().notNull().default(0n),
    tradeCount: t.integer().notNull().default(0),
    holderCount: t.integer().notNull().default(0),
    burnedQuote: t.bigint().notNull().default(0n),
    holderRewardsQuote: t.bigint().notNull().default(0n),
    creatorFeesQuote: t.bigint().notNull().default(0n),
    rebatesQuote: t.bigint().notNull().default(0n),
  }),
  (table) => ({
    quoteIdx: index().on(table.quoteToken),
    deployerIdx: index().on(table.deployer),
    curveIdx: index().on(table.curve),
    poolIdx: index().on(table.poolId),
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
    // "curve" or "pool"
    venue: t.text().notNull(),
    quoteAmount: t.bigint().notNull(),
    tokenAmount: t.bigint().notNull(),
    fee: t.bigint().notNull().default(0n),
    creatorFee: t.bigint().notNull().default(0n),
    rebate: t.bigint().notNull().default(0n),
    priceQuoteWad: t.bigint().notNull(),
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
    interval: t.integer().notNull(), // seconds: 60, 900, 3600, 86400
    bucketStart: t.bigint().notNull(),
    open: t.bigint().notNull(),
    high: t.bigint().notNull(),
    low: t.bigint().notNull(),
    close: t.bigint().notNull(),
    volumeQuote: t.bigint().notNull(),
    trades: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.token, table.interval, table.bucketStart] }),
  }),
);

export const holder = onchainTable(
  "holder",
  (t) => ({
    token: t.hex().notNull(),
    account: t.hex().notNull(),
    balance: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.token, table.account] }),
    tokenBalanceIdx: index().on(table.token, table.balance),
  }),
);

export const burn = onchainTable(
  "burn",
  (t) => ({
    id: t.text().primaryKey(),
    token: t.hex().notNull(),
    quoteToken: t.hex().notNull(),
    amount: t.bigint().notNull(),
    source: t.text().notNull(), // "curve" | "pool"
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
    amount: t.bigint().notNull(),
    source: t.text().notNull(), // "curve" | "pool"
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
    rebatesFunded: t.bigint().notNull().default(0n),
    burnsFunded: t.bigint().notNull().default(0n),
    launches: t.integer().notNull().default(0),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.creator, table.quoteToken] }),
  }),
);

/** Fast PK lookups from a curve address or V4 pool id to its launch token. */
export const curveRef = onchainTable("curve_ref", (t) => ({
  curve: t.hex().primaryKey(),
  token: t.hex().notNull(),
}));

export const poolRef = onchainTable("pool_ref", (t) => ({
  poolId: t.hex().primaryKey(),
  token: t.hex().notNull(),
}));

export const repeg = onchainTable("repeg", (t) => ({
  id: t.text().primaryKey(),
  quoteToken: t.hex().notNull(),
  phantomQuote: t.bigint().notNull(),
  graduationThreshold: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

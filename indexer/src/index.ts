import { ponder } from "ponder:registry";
import {
  burn,
  candle,
  creatorStat,
  holderReward,
  launch,
  launchPools,
  poolRef,
  quote,
  repeg,
  trade,
} from "ponder:schema";

import { PopLaunchFactoryAbi } from "../abis/PopLaunchFactory";
import { PopLaunchTokenAbi } from "../abis/PopLaunchToken";

const WAD = 10n ** 18n;
const Q192 = 1n << 192n;
const CANDLE_INTERVALS = [60, 900, 3600, 86400] as const;

// Row denominations (see ponder.schema.ts header).
const DENOM_ETH = 0;
const DENOM_QUOTE = 1;

// CashbackMode values (TraderRebate = 1 is retired in v2).
const CASHBACK_QUOTE_BURN = 2;
const CASHBACK_HOLDER_REWARDS = 3;

const eventId = (e: { transaction: { hash: string }; log: { logIndex: number } }) =>
  `${e.transaction.hash}-${e.log.logIndex}`;

const priceWad = (quoteAmount: bigint, tokenAmount: bigint) =>
  tokenAmount === 0n ? 0n : (quoteAmount * WAD) / tokenAmount;

async function updateCandles(
  db: any,
  token: `0x${string}`,
  denom: number,
  timestamp: bigint,
  price: bigint,
  quoteVolume: bigint,
) {
  for (const interval of CANDLE_INTERVALS) {
    const bucketStart = (timestamp / BigInt(interval)) * BigInt(interval);
    await db
      .insert(candle)
      .values({
        token,
        denom,
        interval,
        bucketStart,
        open: price,
        high: price,
        low: price,
        close: price,
        volumeQuote: quoteVolume,
        trades: 1,
      })
      .onConflictDoUpdate((row: typeof candle.$inferSelect) => ({
        high: price > row.high ? price : row.high,
        low: price < row.low ? price : row.low,
        close: price,
        volumeQuote: row.volumeQuote + quoteVolume,
        trades: row.trades + 1,
      }));
  }
}

async function bumpCreatorStat(
  db: any,
  creator: `0x${string}`,
  quoteToken: `0x${string}`,
  delta: Partial<{ feesEarned: bigint; burnsFunded: bigint; launches: number }>,
) {
  await db
    .insert(creatorStat)
    .values({
      creator,
      quoteToken,
      feesEarned: delta.feesEarned ?? 0n,
      burnsFunded: delta.burnsFunded ?? 0n,
      launches: delta.launches ?? 0,
    })
    .onConflictDoUpdate((row: typeof creatorStat.$inferSelect) => ({
      feesEarned: row.feesEarned + (delta.feesEarned ?? 0n),
      burnsFunded: row.burnsFunded + (delta.burnsFunded ?? 0n),
      launches: row.launches + (delta.launches ?? 0),
    }));
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

ponder.on("PopQuoteRegistry:QuoteListed", async ({ event, context }) => {
  const [symbol, name] = await Promise.all([
    context.client
      .readContract({
        abi: PopLaunchTokenAbi,
        address: event.args.quote,
        functionName: "symbol",
      })
      .catch(() => null),
    context.client
      .readContract({ abi: PopLaunchTokenAbi, address: event.args.quote, functionName: "name" })
      .catch(() => null),
  ]);
  const decimals = await context.client.readContract({
    abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" }],
    address: event.args.quote,
    functionName: "decimals",
  });

  await context.db.insert(quote).values({
    address: event.args.quote,
    symbol,
    name,
    decimals: Number(decimals),
    adapterId: event.args.adapterId,
    listedAt: event.block.timestamp,
    listedBy: event.args.lister,
    phantomQuote: event.args.phantomQuote,
    graduationThreshold: event.args.graduationThreshold,
    lastPegAt: event.block.timestamp,
  });
});

ponder.on("PopQuoteRegistry:QuoteRepegged", async ({ event, context }) => {
  await context.db.update(quote, { address: event.args.quote }).set({
    phantomQuote: event.args.phantomQuote,
    graduationThreshold: event.args.graduationThreshold,
    lastPegAt: event.block.timestamp,
  });
  await context.db.insert(repeg).values({
    id: eventId(event),
    quoteToken: event.args.quote,
    phantomQuote: event.args.phantomQuote,
    graduationThreshold: event.args.graduationThreshold,
    timestamp: event.block.timestamp,
  });
});

ponder.on("PopQuoteRegistry:QuotePausedUpdated", async ({ event, context }) => {
  await context.db.update(quote, { address: event.args.quote }).set({ paused: event.args.paused });
});

// ---------------------------------------------------------------------------
// Launches
// ---------------------------------------------------------------------------

ponder.on("PopLaunchFactory:TokenLaunched", async ({ event, context }) => {
  const { token, deployer, quoteToken } = event.args;

  const [record, tokenInfo, socials, supply] = await Promise.all([
    context.client.readContract({
      abi: PopLaunchFactoryAbi,
      address: event.log.address,
      functionName: "getLaunchedToken",
      args: [token],
    }),
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "getTokenInfo" }),
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "socials" }),
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "totalSupply" }),
  ]);
  const [name, symbol] = await Promise.all([
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "name" }),
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "symbol" }),
  ]);

  // The hook registered the curve pool earlier in this same transaction, so
  // the mapping is guaranteed to exist by the time TokenLaunched lands.
  const pools = await context.db.find(launchPools, { token });

  await context.db.insert(launch).values({
    token,
    deployer,
    creatorFeeRecipient: record.creatorFeeRecipient,
    quoteToken,
    name,
    symbol,
    logo: tokenInfo[1],
    description: tokenInfo[2],
    twitter: socials[0],
    telegram: socials[1],
    discord: socials[2],
    website: socials[3],
    farcaster: socials[4],
    supply,
    phantomEth: record.phantomEth,
    // The record's threshold is the tick-rounded raise the curve actually
    // collects (same value the event carries).
    bondThresholdEth: record.bondThresholdEth,
    reservedTokens: record.reservedTokens,
    creatorFeeBps: Number(record.creatorFeeBps),
    cashbackMode: Number(record.cashback.mode),
    cashbackShareBps: Number(record.cashback.shareBps),
    createdAt: event.block.timestamp,
    createdAtBlock: event.block.number,
    curvePoolId: pools!.curvePoolId,
    // Opening spot price of the virgin curve, WETH per token.
    lastPriceQuoteWad: priceWad(record.phantomEth, supply),
  });
  await context.db
    .update(quote, { address: quoteToken })
    .set((row) => ({ launchCount: row.launchCount + 1 }));
  await bumpCreatorStat(context.db, deployer, quoteToken, { launches: 1 });
});

// The dev buy is a real swap on the curve pool, so its trade row already
// comes from PoolManager:Swap (attributed to the factory as sender); no
// separate handler for DevBuyExecuted.

// ---------------------------------------------------------------------------
// Pool registration (hook)
// ---------------------------------------------------------------------------

ponder.on("PopHook:PoolRegistered", async ({ event, context }) => {
  const { poolId, memecoin, quoteToken } = event.args;
  const pools = await context.db.find(launchPools, { token: memecoin });

  if (!pools) {
    // First registration: the WETH curve pool, emitted before TokenLaunched
    // in the launch transaction. quoteToken here is WETH.
    await context.db.insert(launchPools).values({ token: memecoin, curvePoolId: poolId });
    await context.db
      .insert(poolRef)
      .values({ poolId, token: memecoin, denom: DENOM_ETH, paired: quoteToken });
    return;
  }

  // Second registration: the bonded token/quote pool, emitted during bond()
  // while the launch row already exists.
  await context.db.update(launchPools, { token: memecoin }).set({ bondedPoolId: poolId });
  await context.db
    .insert(poolRef)
    .values({ poolId, token: memecoin, denom: DENOM_QUOTE, paired: quoteToken });
  await context.db
    .update(launch, { token: memecoin })
    .set({ bondedPoolId: poolId, poolId });
});

// ---------------------------------------------------------------------------
// Trading: every trade is a PoolManager swap on a registered pool
// ---------------------------------------------------------------------------

ponder.on("PoolManager:Swap", async ({ event, context }) => {
  const ref = await context.db.find(poolRef, { poolId: event.args.id });
  if (!ref) return; // not a $POP pool
  const row = await context.db.find(launch, { token: ref.token });
  if (!row) return;

  const pairedIsCurrency0 = BigInt(ref.paired) < BigInt(ref.token);
  const sqrt = event.args.sqrtPriceX96;
  const priceX192 = sqrt * sqrt;
  const price = pairedIsCurrency0 ? (Q192 * WAD) / priceX192 : (priceX192 * WAD) / Q192;

  const amount0 = event.args.amount0;
  const amount1 = event.args.amount1;
  const pairedDelta = pairedIsCurrency0 ? amount0 : amount1;
  const tokenDelta = pairedIsCurrency0 ? amount1 : amount0;
  const pairedVolume = pairedDelta < 0n ? -pairedDelta : pairedDelta;
  const tokenVolume = tokenDelta < 0n ? -tokenDelta : tokenDelta;
  // The swapper receiving tokens (positive token delta) is a buy.
  const isBuy = tokenDelta > 0n;

  // Launch-level price/volume only while the pool is the launch's live
  // venue: the curve pool during Trading, the bonded pool after. A stray
  // swap on a retired curve pool still records a trade but never clobbers
  // the bonded price.
  if (ref.denom === DENOM_ETH && row.phase === 0) {
    await context.db.update(launch, { token: ref.token }).set((l) => ({
      lastPriceQuoteWad: price,
      volumeEth: l.volumeEth + pairedVolume,
      tradeCount: l.tradeCount + 1,
    }));
  } else if (ref.denom === DENOM_QUOTE) {
    await context.db.update(launch, { token: ref.token }).set((l) => ({
      lastPriceQuoteWad: price,
      volumeQuote: l.volumeQuote + pairedVolume,
      tradeCount: l.tradeCount + 1,
    }));
    await context.db
      .update(quote, { address: row.quoteToken })
      .set((q) => ({ totalVolume: q.totalVolume + pairedVolume }));
  }

  await context.db.insert(trade).values({
    id: eventId(event),
    token: ref.token,
    trader: event.args.sender,
    recipient: event.args.sender,
    isBuy,
    venue: ref.denom === DENOM_ETH ? "curve" : "pool",
    denom: ref.denom,
    quoteAmount: pairedVolume,
    tokenAmount: tokenVolume,
    priceQuoteWad: price,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
  });
  await updateCandles(context.db, ref.token, ref.denom, event.block.timestamp, price, pairedVolume);
});

// ---------------------------------------------------------------------------
// Bond lifecycle
// ---------------------------------------------------------------------------

ponder.on("PopHook:BondReady", async ({ event, context }) => {
  const ref = await context.db.find(poolRef, { poolId: event.args.poolId });
  if (!ref) return;
  await context.db.update(launch, { token: ref.token }).set({ bondReady: true });
});

ponder.on("PopLaunchFactory:LaunchBonded", async ({ event, context }) => {
  const row = await context.db.update(launch, { token: event.args.token }).set({
    phase: 1,
    bondedAt: event.block.timestamp,
    graduatedAt: event.block.timestamp,
    positionId: event.args.positionId,
    ethConverted: event.args.ethConverted,
    quoteBought: event.args.quoteBought,
  });
  await context.db
    .update(quote, { address: row.quoteToken })
    .set((q) => ({ graduatedCount: q.graduatedCount + 1 }));
});

ponder.on("PopLaunchFactory:LaunchBondRescued", async ({ event, context }) => {
  await context.db.update(launch, { token: event.args.token }).set({ phase: 2 });
});

ponder.on("PopLaunchFactory:BondTokensPermanentlyLocked", async ({ event, context }) => {
  await context.db
    .update(launch, { token: event.args.token })
    .set({ lockedSupplyExcess: event.args.amount });
});

// The bond converts the curve phase's accrued WETH cashback carve-out into
// the quote and settles it per the launch's immutable mode.
ponder.on("PopLaunchFactory:BondCashbackSettled", async ({ event, context }) => {
  const { token, mode, quoteAmount } = event.args;
  if (quoteAmount === 0n) return;
  const row = await context.db.find(launch, { token });
  if (!row) return;

  if (Number(mode) === CASHBACK_QUOTE_BURN) {
    await context.db
      .update(launch, { token })
      .set((l) => ({ burnedQuote: l.burnedQuote + quoteAmount }));
    await context.db.insert(burn).values({
      id: eventId(event),
      token,
      quoteToken: row.quoteToken,
      amount: quoteAmount,
      source: "bond",
      timestamp: event.block.timestamp,
    });
    await context.db
      .update(quote, { address: row.quoteToken })
      .set((q) => ({ totalBurned: q.totalBurned + quoteAmount }));
    await bumpCreatorStat(context.db, row.creatorFeeRecipient, row.quoteToken, {
      burnsFunded: quoteAmount,
    });
  } else if (Number(mode) === CASHBACK_HOLDER_REWARDS) {
    await context.db
      .update(launch, { token })
      .set((l) => ({ holderRewardsQuote: l.holderRewardsQuote + quoteAmount }));
    await context.db.insert(holderReward).values({
      id: eventId(event),
      token,
      quoteToken: row.quoteToken,
      amount: quoteAmount,
      source: "bond",
      timestamp: event.block.timestamp,
    });
    await context.db
      .update(quote, { address: row.quoteToken })
      .set((q) => ({ totalHolderRewards: q.totalHolderRewards + quoteAmount }));
  } else {
    // Retired-mode fallback: the settlement goes to the creator recipient.
    await context.db
      .update(launch, { token })
      .set((l) => ({ creatorFeesQuote: l.creatorFeesQuote + quoteAmount }));
    await bumpCreatorStat(context.db, row.creatorFeeRecipient, row.quoteToken, {
      feesEarned: quoteAmount,
    });
  }
});

ponder.on("PopLaunchFactory:CreatorFeeRecipientUpdated", async ({ event, context }) => {
  await context.db
    .update(launch, { token: event.args.token })
    .set({ creatorFeeRecipient: event.args.newRecipient });
});

// ---------------------------------------------------------------------------
// Hook fee flows. SnipeTaxCharged, BondCashbackAccrued (WETH accrual, whose
// settled quote value arrives via BondCashbackSettled) and CurvePoolRetired
// are deliberately not indexed.
// ---------------------------------------------------------------------------

ponder.on("PopHook:PoolQuoteBurned", async ({ event, context }) => {
  const ref = await context.db.find(poolRef, { poolId: event.args.poolId });
  if (!ref) return;
  const row = await context.db
    .update(launch, { token: ref.token })
    .set((l) => ({ burnedQuote: l.burnedQuote + event.args.amount }));
  await context.db.insert(burn).values({
    id: eventId(event),
    token: ref.token,
    quoteToken: row.quoteToken,
    amount: event.args.amount,
    source: "pool",
    timestamp: event.block.timestamp,
  });
  await context.db
    .update(quote, { address: row.quoteToken })
    .set((q) => ({ totalBurned: q.totalBurned + event.args.amount }));
  await bumpCreatorStat(context.db, row.creatorFeeRecipient, row.quoteToken, {
    burnsFunded: event.args.amount,
  });
});

ponder.on("PopHook:PoolHolderRewardsPushed", async ({ event, context }) => {
  const ref = await context.db.find(poolRef, { poolId: event.args.poolId });
  if (!ref) return;
  const row = await context.db
    .update(launch, { token: ref.token })
    .set((l) => ({ holderRewardsQuote: l.holderRewardsQuote + event.args.amount }));
  await context.db.insert(holderReward).values({
    id: eventId(event),
    token: ref.token,
    quoteToken: row.quoteToken,
    amount: event.args.amount,
    source: "pool",
    timestamp: event.block.timestamp,
  });
  await context.db
    .update(quote, { address: row.quoteToken })
    .set((q) => ({ totalHolderRewards: q.totalHolderRewards + event.args.amount }));
});

ponder.on("PopHook:PoolFeesSwept", async ({ event, context }) => {
  const ref = await context.db.find(poolRef, { poolId: event.args.poolId });
  if (!ref) return;
  const { protocolAmount, creatorAmount } = event.args;

  if (ref.denom === DENOM_ETH) {
    // Curve-pool sweeps are WETH-denominated; they never enter the
    // quote-denominated aggregates.
    await context.db
      .update(launch, { token: ref.token })
      .set((l) => ({ creatorFeesEth: l.creatorFeesEth + creatorAmount }));
    return;
  }

  const row = await context.db
    .update(launch, { token: ref.token })
    .set((l) => ({ creatorFeesQuote: l.creatorFeesQuote + creatorAmount }));
  await context.db.update(quote, { address: row.quoteToken }).set((q) => ({
    totalCreatorFees: q.totalCreatorFees + creatorAmount,
    totalProtocolFees: q.totalProtocolFees + protocolAmount,
  }));
  await bumpCreatorStat(context.db, row.creatorFeeRecipient, row.quoteToken, {
    feesEarned: creatorAmount,
  });
});

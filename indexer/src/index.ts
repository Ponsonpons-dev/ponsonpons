import { ponder } from "ponder:registry";
import {
  burn,
  candle,
  creatorStat,
  curveRef,
  holder,
  holderReward,
  launch,
  poolRef,
  quote,
  repeg,
  trade,
} from "ponder:schema";

import { PopBondingCurveAbi } from "../abis/PopBondingCurve";
import { PopLaunchFactoryAbi } from "../abis/PopLaunchFactory";
import { PopLaunchTokenAbi } from "../abis/PopLaunchToken";

const WAD = 10n ** 18n;
const Q192 = 1n << 192n;
const CANDLE_INTERVALS = [60, 900, 3600, 86400] as const;
const ZERO = "0x0000000000000000000000000000000000000000";

const eventId = (e: { transaction: { hash: string }; log: { logIndex: number } }) =>
  `${e.transaction.hash}-${e.log.logIndex}`;

const priceWad = (quoteAmount: bigint, tokenAmount: bigint) =>
  tokenAmount === 0n ? 0n : (quoteAmount * WAD) / tokenAmount;

async function updateCandles(
  db: any,
  token: `0x${string}`,
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
  delta: Partial<{ feesEarned: bigint; rebatesFunded: bigint; burnsFunded: bigint; launches: number }>,
) {
  await db
    .insert(creatorStat)
    .values({
      creator,
      quoteToken,
      feesEarned: delta.feesEarned ?? 0n,
      rebatesFunded: delta.rebatesFunded ?? 0n,
      burnsFunded: delta.burnsFunded ?? 0n,
      launches: delta.launches ?? 0,
    })
    .onConflictDoUpdate((row: typeof creatorStat.$inferSelect) => ({
      feesEarned: row.feesEarned + (delta.feesEarned ?? 0n),
      rebatesFunded: row.rebatesFunded + (delta.rebatesFunded ?? 0n),
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
  const { token, curve, deployer, quoteToken, graduationThreshold } = event.args;

  const [record, tokenInfo, socials, supply, phantomQuote, reservedTokens] = await Promise.all([
    context.client.readContract({
      abi: PopLaunchFactoryAbi,
      address: event.log.address,
      functionName: "getLaunchedToken",
      args: [token],
    }),
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "getTokenInfo" }),
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "socials" }),
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "totalSupply" }),
    context.client.readContract({ abi: PopBondingCurveAbi, address: curve, functionName: "phantomQuote" }),
    context.client.readContract({ abi: PopBondingCurveAbi, address: curve, functionName: "reservedTokens" }),
  ]);
  const [name, symbol] = await Promise.all([
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "name" }),
    context.client.readContract({ abi: PopLaunchTokenAbi, address: token, functionName: "symbol" }),
  ]);

  await context.db.insert(launch).values({
    token,
    curve,
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
    phantomQuote,
    graduationThreshold,
    reservedTokens,
    creatorFeeBps: Number(record.creatorFeeBps),
    cashbackMode: Number(record.cashback.mode),
    cashbackShareBps: Number(record.cashback.shareBps),
    createdAt: event.block.timestamp,
    createdAtBlock: event.block.number,
    // Opening spot price of the virgin curve: phantom / supply.
    lastPriceQuoteWad: priceWad(phantomQuote, supply),
  });
  await context.db.insert(curveRef).values({ curve, token });
  await context.db
    .update(quote, { address: quoteToken })
    .set((row) => ({ launchCount: row.launchCount + 1 }));
  await bumpCreatorStat(context.db, deployer, quoteToken, { launches: 1 });
});

// ---------------------------------------------------------------------------
// Curve trading
// ---------------------------------------------------------------------------

ponder.on("PopBondingCurve:CurveBuy", async ({ event, context }) => {
  const ref = await context.db.find(curveRef, { curve: event.log.address });
  if (!ref) return;
  const { quoteIn, tokensOut, fee, creatorFee, rebate } = event.args;
  const price = priceWad(quoteIn, tokensOut);
  const reserveDelta = quoteIn - fee - creatorFee;

  const row = await context.db.update(launch, { token: ref.token }).set((l) => {
    const realQuoteReserve = l.realQuoteReserve + reserveDelta;
    return {
      lastPriceQuoteWad: price,
      realQuoteReserve,
      tokensSold: l.tokensSold + tokensOut,
      curveProgressBps: Number(
        l.graduationThreshold === 0n
          ? 0n
          : (realQuoteReserve * 10000n) / l.graduationThreshold > 10000n
            ? 10000n
            : (realQuoteReserve * 10000n) / l.graduationThreshold,
      ),
      volumeQuote: l.volumeQuote + quoteIn,
      tradeCount: l.tradeCount + 1,
      rebatesQuote: l.rebatesQuote + rebate,
    };
  });

  await context.db.insert(trade).values({
    id: eventId(event),
    token: ref.token,
    trader: event.args.buyer,
    recipient: event.args.recipient,
    isBuy: true,
    venue: "curve",
    quoteAmount: quoteIn,
    tokenAmount: tokensOut,
    fee,
    creatorFee,
    rebate,
    priceQuoteWad: price,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
  });
  await updateCandles(context.db, ref.token, event.block.timestamp, price, quoteIn);
  await context.db
    .update(quote, { address: row.quoteToken })
    .set((q) => ({ totalVolume: q.totalVolume + quoteIn, totalRebates: q.totalRebates + rebate }));
});

ponder.on("PopBondingCurve:CurveSell", async ({ event, context }) => {
  const ref = await context.db.find(curveRef, { curve: event.log.address });
  if (!ref) return;
  const { tokensIn, quoteOut, fee, creatorFee, rebate } = event.args;
  const gross = quoteOut + fee + creatorFee;
  const price = priceWad(gross, tokensIn);

  const row = await context.db.update(launch, { token: ref.token }).set((l) => {
    const realQuoteReserve = l.realQuoteReserve - gross;
    return {
      lastPriceQuoteWad: price,
      realQuoteReserve,
      tokensSold: l.tokensSold - tokensIn,
      curveProgressBps: Number(
        l.graduationThreshold === 0n
          ? 0n
          : realQuoteReserve <= 0n
            ? 0n
            : (realQuoteReserve * 10000n) / l.graduationThreshold,
      ),
      volumeQuote: l.volumeQuote + gross,
      tradeCount: l.tradeCount + 1,
      rebatesQuote: l.rebatesQuote + rebate,
    };
  });

  await context.db.insert(trade).values({
    id: eventId(event),
    token: ref.token,
    trader: event.args.seller,
    recipient: event.args.recipient,
    isBuy: false,
    venue: "curve",
    quoteAmount: quoteOut,
    tokenAmount: tokensIn,
    fee,
    creatorFee,
    rebate,
    priceQuoteWad: price,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
  });
  await updateCandles(context.db, ref.token, event.block.timestamp, price, gross);
  await context.db
    .update(quote, { address: row.quoteToken })
    .set((q) => ({ totalVolume: q.totalVolume + gross, totalRebates: q.totalRebates + rebate }));
});

ponder.on("PopBondingCurve:QuoteBurned", async ({ event, context }) => {
  const ref = await context.db.find(curveRef, { curve: event.log.address });
  if (!ref) return;
  const row = await context.db
    .update(launch, { token: ref.token })
    .set((l) => ({ burnedQuote: l.burnedQuote + event.args.amount }));
  await context.db.insert(burn).values({
    id: eventId(event),
    token: ref.token,
    quoteToken: row.quoteToken,
    amount: event.args.amount,
    source: "curve",
    timestamp: event.block.timestamp,
  });
  await context.db
    .update(quote, { address: row.quoteToken })
    .set((q) => ({ totalBurned: q.totalBurned + event.args.amount }));
  await bumpCreatorStat(context.db, row.creatorFeeRecipient, row.quoteToken, {
    burnsFunded: event.args.amount,
  });
});

ponder.on("PopBondingCurve:HolderRewardsPushed", async ({ event, context }) => {
  const ref = await context.db.find(curveRef, { curve: event.log.address });
  if (!ref) return;
  const row = await context.db
    .update(launch, { token: ref.token })
    .set((l) => ({ holderRewardsQuote: l.holderRewardsQuote + event.args.amount }));
  await context.db.insert(holderReward).values({
    id: eventId(event),
    token: ref.token,
    quoteToken: row.quoteToken,
    amount: event.args.amount,
    source: "curve",
    timestamp: event.block.timestamp,
  });
  await context.db
    .update(quote, { address: row.quoteToken })
    .set((q) => ({ totalHolderRewards: q.totalHolderRewards + event.args.amount }));
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

ponder.on("PopBondingCurve:FeesSwept", async ({ event, context }) => {
  const ref = await context.db.find(curveRef, { curve: event.log.address });
  if (!ref) return;
  const { protocolAmount, creatorAmount } = event.args;
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

// ---------------------------------------------------------------------------
// Graduation lifecycle
// ---------------------------------------------------------------------------

ponder.on("PopLaunchFactory:LaunchSwept", async ({ event, context }) => {
  await context.db.update(launch, { token: event.args.token }).set({
    phase: 1,
    sweptAt: event.block.timestamp,
    curveProgressBps: 10000,
  });
});

ponder.on("PopLaunchFactory:PoolGraduated", async ({ event, context }) => {
  await context.db.update(launch, { token: event.args.token }).set({
    phase: 2,
    graduatedAt: event.block.timestamp,
    positionId: event.args.positionId,
  });
  const row = await context.db.find(launch, { token: event.args.token });
  if (row) {
    await context.db
      .update(quote, { address: row.quoteToken })
      .set((q) => ({ graduatedCount: q.graduatedCount + 1 }));
  }
});

ponder.on("PopLaunchFactory:GraduationTokensPermanentlyLocked", async ({ event, context }) => {
  await context.db
    .update(launch, { token: event.args.token })
    .set({ lockedSupplyExcess: event.args.amount });
});

ponder.on("PopLaunchFactory:LaunchGraduationRescued", async ({ event, context }) => {
  await context.db.update(launch, { token: event.args.token }).set({ phase: 3 });
});

ponder.on("PopLaunchFactory:CreatorFeeRecipientUpdated", async ({ event, context }) => {
  await context.db
    .update(launch, { token: event.args.token })
    .set({ creatorFeeRecipient: event.args.newRecipient });
});

ponder.on("PopHook:PoolRegistered", async ({ event, context }) => {
  await context.db.update(launch, { token: event.args.memecoin }).set({ poolId: event.args.poolId });
  await context.db.insert(poolRef).values({ poolId: event.args.poolId, token: event.args.memecoin });
});

// ---------------------------------------------------------------------------
// Post-graduation pool activity
// ---------------------------------------------------------------------------

ponder.on("PoolManager:Swap", async ({ event, context }) => {
  const ref = await context.db.find(poolRef, { poolId: event.args.id });
  if (!ref) return; // not a $POP pool
  const row = await context.db.find(launch, { token: ref.token });
  if (!row) return;

  const quoteIsCurrency0 = BigInt(row.quoteToken) < BigInt(ref.token);
  const sqrt = event.args.sqrtPriceX96;
  const priceX192 = sqrt * sqrt;
  const price = quoteIsCurrency0 ? (Q192 * WAD) / priceX192 : (priceX192 * WAD) / Q192;

  const amount0 = event.args.amount0;
  const amount1 = event.args.amount1;
  const quoteDelta = quoteIsCurrency0 ? amount0 : amount1;
  const tokenDelta = quoteIsCurrency0 ? amount1 : amount0;
  const quoteVolume = quoteDelta < 0n ? -quoteDelta : quoteDelta;
  const tokenVolume = tokenDelta < 0n ? -tokenDelta : tokenDelta;
  // The swapper receiving tokens (positive token delta) is a buy.
  const isBuy = tokenDelta > 0n;

  await context.db.update(launch, { token: ref.token }).set((l) => ({
    lastPriceQuoteWad: price,
    volumeQuote: l.volumeQuote + quoteVolume,
    tradeCount: l.tradeCount + 1,
  }));
  await context.db.insert(trade).values({
    id: eventId(event),
    token: ref.token,
    trader: event.args.sender,
    recipient: event.args.sender,
    isBuy,
    venue: "pool",
    quoteAmount: quoteVolume,
    tokenAmount: tokenVolume,
    priceQuoteWad: price,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
  });
  await updateCandles(context.db, ref.token, event.block.timestamp, price, quoteVolume);
  await context.db
    .update(quote, { address: row.quoteToken })
    .set((q) => ({ totalVolume: q.totalVolume + quoteVolume }));
});

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

ponder.on("PopHook:PoolFeesSwept", async ({ event, context }) => {
  const ref = await context.db.find(poolRef, { poolId: event.args.poolId });
  if (!ref) return;
  const { protocolAmount, creatorAmount } = event.args;
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

// ---------------------------------------------------------------------------
// Holder tracking (launch token transfers)
// ---------------------------------------------------------------------------

ponder.on("PopLaunchToken:Transfer", async ({ event, context }) => {
  const token = event.log.address;
  const { from, to, value } = event.args;
  if (value === 0n) return;
  let holderDelta = 0;

  if (from !== ZERO) {
    const updated = await context.db
      .update(holder, { token, account: from })
      .set((h) => ({ balance: h.balance - value }));
    if (updated.balance === 0n) holderDelta -= 1;
  }
  if (to !== ZERO) {
    const existing = await context.db.find(holder, { token, account: to });
    if (!existing || existing.balance === 0n) holderDelta += 1;
    await context.db
      .insert(holder)
      .values({ token, account: to, balance: value })
      .onConflictDoUpdate((h) => ({ balance: h.balance + value }));
  }

  if (holderDelta !== 0) {
    await context.db
      .update(launch, { token })
      .set((l) => ({ holderCount: l.holderCount + holderDelta }))
      .catch(() => {});
  }
});

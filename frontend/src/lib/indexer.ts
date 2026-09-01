/** Typed fetch layer over the Phase 2 Ponder indexer. */

const BASE = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:42069";

export interface Quote {
  address: `0x${string}`;
  symbol: string | null;
  name: string | null;
  decimals: number;
  paused: boolean;
  phantomQuote: string;
  graduationThreshold: string;
  launchCount: number;
  graduatedCount: number;
  totalBurned: string;
  totalHolderRewards: string;
  totalVolume: string;
  totalCreatorFees: string;
  totalProtocolFees: string;
}

/**
 * One launch. Money fields follow the launch's phase: pre-bond the venue is
 * the WETH curve pool (lastPriceQuoteWad is WETH per token; volumeEth and
 * creatorFeesEth accrue), post-bond the venue is the bonded quote pool
 * (lastPriceQuoteWad is quote per token; volumeQuote and the quote
 * aggregates accrue). phase: 0 Trading, 1 Bonded, 2 Rescued.
 */
export interface Launch {
  token: `0x${string}`;
  deployer: `0x${string}`;
  creatorFeeRecipient: `0x${string}`;
  quoteToken: `0x${string}`;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  twitter: string;
  telegram: string;
  discord: string;
  website: string;
  farcaster: string;
  supply: string;
  phantomEth: string;
  bondThresholdEth: string;
  creatorFeeBps: number;
  cashbackMode: number;
  cashbackShareBps: number;
  phase: number;
  createdAt: string;
  bondedAt: string | null;
  bondReady: boolean;
  curvePoolId: `0x${string}`;
  bondedPoolId: `0x${string}` | null;
  positionId: string | null;
  lockedSupplyExcess: string;
  ethConverted: string | null;
  quoteBought: string | null;
  lastPriceQuoteWad: string;
  volumeEth: string;
  volumeQuote: string;
  tradeCount: number;
  burnedQuote: string;
  holderRewardsQuote: string;
  creatorFeesQuote: string;
  creatorFeesEth: string;
}

/** denom: 0 = ETH/WETH, 1 = the launch's bond quote token. */
export interface Trade {
  id: string;
  token: `0x${string}`;
  trader: `0x${string}`;
  isBuy: boolean;
  venue: "curve" | "pool";
  denom: number;
  quoteAmount: string;
  tokenAmount: string;
  priceQuoteWad: string;
  timestamp: string;
  txHash: `0x${string}`;
}

export interface Candle {
  bucketStart: string;
  denom: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeQuote: string;
}

/**
 * Curve progress toward the bond, derived from the last trade price against
 * the launch's ETH terms. The curve is constant-product with a phantom
 * reserve, so the ETH raised at price p is sqrt(p * phantom * supply) -
 * phantom. Display-only; floating point is fine here.
 */
export function curveProgress(launch: Launch): { raisedEth: number; thresholdEth: number; bps: number } {
  const thresholdEth = Number(launch.bondThresholdEth) / 1e18;
  if (launch.phase !== 0) return { raisedEth: thresholdEth, thresholdEth, bps: 10_000 };
  const p = Number(launch.lastPriceQuoteWad) / 1e18;
  const phantom = Number(launch.phantomEth) / 1e18;
  const supply = Number(launch.supply) / 1e18;
  const raised = Math.max(0, Math.sqrt(Math.max(0, p * phantom * supply)) - phantom);
  const clamped = Math.min(raised, thresholdEth);
  const bps = thresholdEth > 0 ? Math.round((clamped / thresholdEth) * 10_000) : 0;
  return { raisedEth: clamped, thresholdEth, bps: launch.bondReady ? 10_000 : Math.min(bps, 9_999) };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`indexer ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`indexer graphql ${res.status}`);
  const body = (await res.json()) as { data: T; errors?: unknown[] };
  if (body.errors?.length) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

const LAUNCH_FIELDS = `token deployer creatorFeeRecipient quoteToken name symbol logo description
twitter telegram discord website farcaster supply phantomEth bondThresholdEth creatorFeeBps cashbackMode
cashbackShareBps phase createdAt bondedAt bondReady curvePoolId bondedPoolId positionId lockedSupplyExcess
ethConverted quoteBought lastPriceQuoteWad volumeEth volumeQuote tradeCount burnedQuote holderRewardsQuote
creatorFeesQuote creatorFeesEth`;

export const indexer = {
  quotes: () => get<Quote[]>("/quotes"),

  quote: async (address: string) => {
    const data = await gql<{ quote: Quote | null }>(
      `query($a: String!){ quote(address:$a){ address symbol name decimals paused phantomQuote graduationThreshold launchCount graduatedCount totalBurned totalHolderRewards totalVolume totalCreatorFees totalProtocolFees } }`,
      { a: address.toLowerCase() },
    );
    return data.quote;
  },

  launch: async (token: string) => {
    const data = await gql<{ launch: Launch | null }>(
      `query($t: String!){ launch(token:$t){ ${LAUNCH_FIELDS} } }`,
      { t: token.toLowerCase() },
    );
    return data.launch;
  },

  launches: async (opts: { quote?: string; deployer?: string; limit?: number } = {}) => {
    const where = [
      opts.quote ? `quoteToken: "${opts.quote.toLowerCase()}"` : "",
      opts.deployer ? `deployer: "${opts.deployer.toLowerCase()}"` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const data = await gql<{ launchs: { items: Launch[] } }>(
      `query{ launchs(${where ? `where:{${where}}, ` : ""}orderBy:"createdAt", orderDirection:"desc", limit:${opts.limit ?? 50}){ items{ ${LAUNCH_FIELDS} } } }`,
    );
    return data.launchs.items;
  },

  trending: async (limit = 12) => {
    const data = await gql<{ launchs: { items: Launch[] } }>(
      `query{ launchs(orderBy:"volumeEth", orderDirection:"desc", limit:${limit}, where:{phase: 0}){ items{ ${LAUNCH_FIELDS} } } }`,
    );
    return data.launchs.items;
  },

  recentlyBonded: async (limit = 8) => {
    const data = await gql<{ launchs: { items: Launch[] } }>(
      `query{ launchs(orderBy:"bondedAt", orderDirection:"desc", limit:${limit}, where:{phase: 1}){ items{ ${LAUNCH_FIELDS} } } }`,
    );
    return data.launchs.items;
  },

  trades: (token: string) => get<Trade[]>(`/launches/${token.toLowerCase()}/trades`),
  candles: (token: string, interval: number) =>
    get<Candle[]>(`/launches/${token.toLowerCase()}/candles/${interval}`),

  creatorStats: async (creator: string) => {
    const data = await gql<{ creatorStats: { items: Array<{ quoteToken: `0x${string}`; feesEarned: string; burnsFunded: string; launches: number }> } }>(
      `query($c: String!){ creatorStats(where:{creator:$c}){ items{ quoteToken feesEarned burnsFunded launches } } }`,
      { c: creator.toLowerCase() },
    );
    return data.creatorStats.items;
  },
};

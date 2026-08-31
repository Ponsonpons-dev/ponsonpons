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
  totalRebates: string;
}

export interface Launch {
  token: `0x${string}`;
  curve: `0x${string}`;
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
  graduationThreshold: string;
  creatorFeeBps: number;
  cashbackMode: number;
  cashbackShareBps: number;
  phase: number;
  createdAt: string;
  graduatedAt: string | null;
  poolId: `0x${string}` | null;
  positionId: string | null;
  lockedSupplyExcess: string;
  lastPriceQuoteWad: string;
  realQuoteReserve: string;
  curveProgressBps: number;
  volumeQuote: string;
  tradeCount: number;
  holderCount: number;
  burnedQuote: string;
  holderRewardsQuote: string;
  creatorFeesQuote: string;
  rebatesQuote: string;
}

export interface Trade {
  id: string;
  token: `0x${string}`;
  trader: `0x${string}`;
  isBuy: boolean;
  venue: "curve" | "pool";
  quoteAmount: string;
  tokenAmount: string;
  rebate: string;
  priceQuoteWad: string;
  timestamp: string;
  txHash: `0x${string}`;
}

export interface Candle {
  bucketStart: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeQuote: string;
}

export interface Holder {
  account: `0x${string}`;
  balance: string;
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

const LAUNCH_FIELDS = `token curve deployer creatorFeeRecipient quoteToken name symbol logo description
twitter telegram discord website farcaster supply graduationThreshold creatorFeeBps cashbackMode
cashbackShareBps phase createdAt graduatedAt poolId positionId lockedSupplyExcess lastPriceQuoteWad
realQuoteReserve curveProgressBps volumeQuote tradeCount holderCount burnedQuote holderRewardsQuote creatorFeesQuote rebatesQuote`;

export const indexer = {
  quotes: () => get<Quote[]>("/quotes"),

  quote: async (address: string) => {
    const data = await gql<{ quote: Quote | null }>(
      `query($a: String!){ quote(address:$a){ address symbol name decimals paused phantomQuote graduationThreshold launchCount graduatedCount totalBurned totalHolderRewards totalVolume totalCreatorFees totalProtocolFees totalRebates } }`,
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
      `query{ launchs(orderBy:"volumeQuote", orderDirection:"desc", limit:${limit}, where:{phase: 0}){ items{ ${LAUNCH_FIELDS} } } }`,
    );
    return data.launchs.items;
  },

  recentlyGraduated: async (limit = 8) => {
    const data = await gql<{ launchs: { items: Launch[] } }>(
      `query{ launchs(orderBy:"graduatedAt", orderDirection:"desc", limit:${limit}, where:{phase: 2}){ items{ ${LAUNCH_FIELDS} } } }`,
    );
    return data.launchs.items;
  },

  trades: (token: string) => get<Trade[]>(`/launches/${token.toLowerCase()}/trades`),
  candles: (token: string, interval: number) =>
    get<Candle[]>(`/launches/${token.toLowerCase()}/candles/${interval}`),
  holders: (token: string) => get<Holder[]>(`/launches/${token.toLowerCase()}/holders`),

  creatorStats: async (creator: string) => {
    const data = await gql<{ creatorStats: { items: Array<{ quoteToken: `0x${string}`; feesEarned: string; rebatesFunded: string; burnsFunded: string; launches: number }> } }>(
      `query($c: String!){ creatorStats(where:{creator:$c}){ items{ quoteToken feesEarned rebatesFunded burnsFunded launches } } }`,
      { c: creator.toLowerCase() },
    );
    return data.creatorStats.items;
  },
};

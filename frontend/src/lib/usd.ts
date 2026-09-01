"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Live USD rates for the site's two denominations: ETH (curve phase) and the
 * bond quote tokens (bonded phase). ETH comes from Coinbase's public spot
 * endpoint; quote tokens from DexScreener, using their most liquid Robinhood
 * Chain pair. Rates refresh every minute and are conveniences for display
 * only, so a missing rate must degrade to the underlying denomination, never
 * block rendering.
 */

async function fetchEthUsd(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
    const body = await res.json();
    const v = Number(body?.data?.amount);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

async function fetchTokenUsd(token: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
    const body = await res.json();
    const pairs = (body?.pairs ?? []).filter(
      (p: { chainId?: string; baseToken?: { address?: string } }) =>
        p.chainId === "robinhood" && p.baseToken?.address?.toLowerCase() === token.toLowerCase(),
    );
    if (!pairs.length) return null;
    pairs.sort(
      (a: { liquidity?: { usd?: number } }, b: { liquidity?: { usd?: number } }) =>
        (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    );
    const v = Number(pairs[0].priceUsd);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** USD per whole ETH, and per whole unit of each requested quote token. */
export function useUsdRates(quoteTokens: string[] = []) {
  const key = [...new Set(quoteTokens.map((t) => t.toLowerCase()))].sort();
  const q = useQuery({
    queryKey: ["usd-rates", key],
    queryFn: async () => {
      const [eth, ...quotes] = await Promise.all([fetchEthUsd(), ...key.map(fetchTokenUsd)]);
      const byToken: Record<string, number | null> = {};
      key.forEach((t, i) => (byToken[t] = quotes[i]));
      return { ethUsd: eth, quoteUsd: byToken };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return {
    ethUsd: q.data?.ethUsd ?? null,
    quoteUsd: (token: string | undefined) => (token ? (q.data?.quoteUsd[token.toLowerCase()] ?? null) : null),
  };
}

/** $1.23M style compact USD, from an amount in whole units times its rate. */
export function fmtUsd(wholeAmount: number | null, usdRate: number | null): string | null {
  if (wholeAmount === null || usdRate === null || !Number.isFinite(wholeAmount)) return null;
  const v = wholeAmount * usdRate;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v > 0) return `$${v.toPrecision(3)}`;
  return "$0";
}

/** Whole-unit number from a raw bigint/string amount. Display use only. */
export function toWhole(raw: bigint | string | undefined, decimals = 18): number | null {
  if (raw === undefined) return null;
  try {
    return Number(BigInt(raw)) / 10 ** decimals;
  } catch {
    return null;
  }
}

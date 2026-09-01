import { formatUnits } from "viem";

/** Compact display for token amounts: 1.23M, 45.6K, 0.0012. */
export function fmtAmount(raw: bigint | string | undefined, decimals = 18, digits = 4): string {
  if (raw === undefined) return "…";
  const v = Number(formatUnits(BigInt(raw), decimals));
  if (v === 0) return "0";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: digits });
  return v.toPrecision(3);
}

/** Price stored as quote-per-token scaled 1e18. */
export function fmtPrice(priceWad: bigint | string | undefined, quoteDecimals = 18): string {
  if (priceWad === undefined) return "…";
  // priceWad = quoteBaseUnits per 1 whole token * 1e18 / 1e18... it is
  // (quoteAmount * 1e18) / tokenAmount with both in base units, so whole
  // token price in whole quote = priceWad * 10^(18-quoteDecimals) / 1e18.
  const v = Number(BigInt(priceWad)) / 1e18 / 10 ** (quoteDecimals - 18);
  if (v === 0) return "0";
  if (v >= 0.01) return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return v.toExponential(2);
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function timeAgo(ts: bigint | string | number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const CASHBACK_LABEL = ["No cashback", "Trader rebate", "Quote burn", "Holder rewards"] as const;
export const PHASE_LABEL = ["Trading in ETH", "Bonded", "Rescued"] as const;

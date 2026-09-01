/**
 * Filtering model for Ponscope: three live columns of launches, each
 * with its own independent filter set, the way Photon's Memescope works.
 *
 * Filtering is deliberately client-side over one shared fetch: every column
 * draws from the same launch list, so changing a filter is instant and costs
 * the indexer nothing. The trade-off is that a column can only ever show what
 * that fetch covered, which is why `SCOPE_FETCH_LIMIT` is generous.
 */
import { curveProgress } from "./indexer.ts";
import type { Launch } from "./indexer";

export const SCOPE_FETCH_LIMIT = 200;
/** The Graduated column is sourced separately so it stays correct at volume. */
export const SCOPE_GRADUATED_LIMIT = 60;

export type ColumnKey = "fresh" | "filling" | "graduated";

export interface Filters {
  /** Free text over name and symbol. */
  q: string;
  /** Quote token addresses to include. Empty means "any". */
  quotes: string[];
  /** Cashback modes to include (0-3). Empty means "any". */
  modes: number[];
  minProgress: number | null;
  maxProgress: number | null;
  minTrades: number | null;
  minVolume: number | null;
  /** Age bounds in minutes. */
  maxAgeMin: number | null;
  minAgeMin: number | null;
  /** Hide launches whose creator has no cashback configured. */
  cashbackOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  quotes: [],
  modes: [],
  minProgress: null,
  maxProgress: null,
  minTrades: null,
  minVolume: null,
  maxAgeMin: null,
  minAgeMin: null,
  cashbackOnly: false,
};

export const COLUMNS: Array<{
  key: ColumnKey;
  title: string;
  hint: string;
  /** Filters applied before the user's own, defining what the column *is*. */
  defaults: Partial<Filters>;
}> = [
  {
    key: "fresh",
    title: "Fresh",
    hint: "just created",
    defaults: { maxAgeMin: 1440 },
  },
  {
    key: "filling",
    title: "Filling",
    hint: "closing on graduation",
    defaults: { minProgress: 50 },
  },
  {
    key: "graduated",
    title: "Graduated",
    hint: "liquidity locked",
    defaults: {},
  },
];

export function defaultsFor(key: ColumnKey): Filters {
  const col = COLUMNS.find((c) => c.key === key);
  return { ...EMPTY_FILTERS, ...(col?.defaults ?? {}) };
}

/** How many of a column's filters differ from its baseline; drives the badge. */
export function activeCount(key: ColumnKey, f: Filters): number {
  const base = defaultsFor(key);
  let n = 0;
  if (f.q.trim()) n++;
  if (f.quotes.length) n++;
  if (f.modes.length) n++;
  if (f.cashbackOnly !== base.cashbackOnly) n++;
  for (const k of ["minProgress", "maxProgress", "minTrades", "minVolume", "maxAgeMin", "minAgeMin"] as const) {
    if (f[k] !== base[k]) n++;
  }
  return n;
}

const toNum = (raw: string, decimals: number) => {
  try {
    return Number(BigInt(raw)) / 10 ** decimals;
  } catch {
    return 0;
  }
};

export function matches(
  launch: Launch,
  f: Filters,
  now: number,
  quoteDecimals: (addr: string) => number,
  /**
   * USD per whole unit of the launch's denomination. Volume is displayed in
   * dollars everywhere, so the bound is read in dollars too; without a rate
   * it falls back to the native ledger so the filter still works offline.
   */
  usdRate?: (l: Launch) => number | null,
): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !`${launch.name} ${launch.symbol}`.toLowerCase().includes(q)) return false;

  if (f.quotes.length && !f.quotes.includes(launch.quoteToken.toLowerCase())) return false;
  if (f.modes.length && !f.modes.includes(launch.cashbackMode)) return false;
  if (f.cashbackOnly && launch.cashbackMode === 0) return false;

  const progress = curveProgress(launch).bps / 100;
  if (f.minProgress !== null && progress < f.minProgress) return false;
  if (f.maxProgress !== null && progress > f.maxProgress) return false;

  if (f.minTrades !== null && launch.tradeCount < f.minTrades) return false;

  if (f.minVolume !== null) {
    // Curve-phase volume accrues in ETH, bonded-phase in the quote; filter
    // whichever ledger the launch is actually trading on.
    const vol = launch.phase === 0
      ? toNum(launch.volumeEth, 18)
      : toNum(launch.volumeQuote, quoteDecimals(launch.quoteToken));
    const rate = usdRate?.(launch) ?? null;
    if ((rate === null ? vol : vol * rate) < f.minVolume) return false;
  }

  const ageMin = (now - Number(launch.createdAt)) / 60;
  if (f.maxAgeMin !== null && ageMin > f.maxAgeMin) return false;
  if (f.minAgeMin !== null && ageMin < f.minAgeMin) return false;

  return true;
}

/** Column membership and ordering, before user filters. */
export function selectColumn(key: ColumnKey, launches: Launch[]): Launch[] {
  switch (key) {
    case "fresh":
      return launches
        .filter((l) => l.phase === 0)
        .slice()
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    case "filling":
      // Nearly-full curves first; that is the whole point of the column.
      return launches
        .filter((l) => l.phase === 0)
        .slice()
        .sort((a, b) => curveProgress(b).bps - curveProgress(a).bps);
    case "graduated":
      return launches
        .filter((l) => l.phase === 1)
        .slice()
        .sort((a, b) => Number(b.bondedAt ?? b.createdAt) - Number(a.bondedAt ?? a.createdAt));
  }
}

const KEY = "pop:scope-filters:v1";

export function loadFilters(): Partial<Record<ColumnKey, Filters>> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<ColumnKey, Filters>>) : {};
  } catch {
    return {};
  }
}

export function saveFilters(all: Record<ColumnKey, Filters>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode; filters just do not persist */
  }
}

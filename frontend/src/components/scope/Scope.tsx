"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { FilterPanel } from "./FilterPanel";
import { CASHBACK_ICON, CASHBACK_TONE } from "@/components/icons";
import { ProgressBar, TokenTile } from "@/components/ui";
import { CASHBACK_LABEL, fmtAmount, timeAgo } from "@/lib/format";
import type { Launch, Quote } from "@/lib/indexer";
import { curveProgress, indexer } from "@/lib/indexer";
import type { ColumnKey, Filters } from "@/lib/scope";
import { fmtUsd, toWhole, useUsdRates } from "@/lib/usd";
import {
  COLUMNS,
  SCOPE_FETCH_LIMIT,
  SCOPE_GRADUATED_LIMIT,
  activeCount,
  defaultsFor,
  loadFilters,
  matches,
  saveFilters,
  selectColumn,
} from "@/lib/scope";

function FilterGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden className={className}>
      <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
    </svg>
  );
}

function Row({ launch, quote, usdRate }: { launch: Launch; quote?: Quote; usdRate: number | null }) {
  // Curve-phase launches trade and denominate in ETH; the quote token only
  // becomes the pair (and the denomination) once the launch bonds. usdRate is
  // dollars per whole unit of that denomination.
  const bonded = launch.phase !== 0;
  const decimals = bonded ? (quote?.decimals ?? 18) : 18;
  const denomSymbol = bonded ? quote?.symbol : "ETH";
  const volume = bonded ? launch.volumeQuote : launch.volumeEth;
  // Market cap reads far better than a 1.4e-8 price on a card this small.
  let marketCap: bigint | undefined;
  try {
    marketCap = (BigInt(launch.lastPriceQuoteWad) * BigInt(launch.supply)) / 10n ** 36n;
  } catch {
    marketCap = undefined;
  }
  const mcUsd = fmtUsd(marketCap === undefined ? null : Number(marketCap), usdRate);
  const volUsd = fmtUsd(toWhole(volume, decimals), usdRate);
  const Icon = CASHBACK_ICON[launch.cashbackMode];
  const tone = CASHBACK_TONE[launch.cashbackMode] ?? "text-dim";
  const live = launch.phase === 0;

  return (
    <Link
      href={`/token/${launch.token}`}
      className="block border-b border-edge px-3 py-2.5 transition-colors last:border-b-0 hover:bg-ink/[0.04]"
    >
      <div className="flex items-start gap-2.5">
        <div className="w-9 shrink-0">
          <TokenTile logo={launch.logo} symbol={launch.symbol} seed={launch.token} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate font-display text-[13.5px] font-medium tracking-[-0.02em] text-ink">
              {launch.name}
            </span>
            <span className="shrink-0 text-[11px] text-dim/70">${launch.symbol}</span>
            <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-dim/60">
              {timeAgo(launch.createdAt)}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] tabular-nums">
            {denomSymbol && <span className="text-dim/70">{bonded ? `$${denomSymbol}` : denomSymbol}</span>}
            <span className="text-pop">MC {mcUsd ?? `${fmtAmount(marketCap, 0, 1)} ${denomSymbol ?? ""}`}</span>
            <span className="text-dim">{launch.tradeCount} trades</span>
            <span className="text-dim">{volUsd ?? `${fmtAmount(volume, decimals)} ${denomSymbol ?? ""}`} vol</span>
            {Icon && (
              <span className={`flex items-center gap-1 ${tone}`} title={CASHBACK_LABEL[launch.cashbackMode]}>
                <Icon className="h-3 w-3" />
              </span>
            )}
          </div>

          {live && (
            <div className="mt-1.5 flex items-center gap-2">
              <ProgressBar bps={curveProgress(launch).bps} />
              <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-dim">
                {(curveProgress(launch).bps / 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function Column({
  columnKey,
  title,
  hint,
  launches,
  quotes,
  quoteFor,
  rateFor,
  filters,
  onFilters,
  loading,
}: {
  columnKey: ColumnKey;
  title: string;
  hint: string;
  launches: Launch[];
  quotes: Quote[];
  quoteFor: (l: Launch) => Quote | undefined;
  rateFor: (l: Launch) => number | null;
  filters: Filters;
  onFilters: (f: Filters) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = activeCount(columnKey, filters);

  return (
    <section className="flex min-h-0 flex-col rounded-[16px] border border-edge bg-surface/50">
      <header className="relative flex items-center gap-2 border-b border-edge px-3 py-2.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pop shadow-[0_0_6px_rgb(20_216_44_/_0.8)]" />
        <h2 className="font-display text-[14px] font-medium tracking-[-0.02em] text-ink">{title}</h2>
        <span className="truncate text-[11px] text-dim/60">{hint}</span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-dim/60">{launches.length}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`Filters for ${title}`}
          aria-expanded={open}
          className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
            active
              ? "border-pop/40 bg-pop/10 text-pop"
              : "border-edge text-dim hover:text-ink"
          }`}
        >
          <FilterGlyph />
          {active > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-pop px-1 text-[9px] font-bold text-black">
              {active}
            </span>
          )}
        </button>

        {open && (
          <FilterPanel
            columnKey={columnKey}
            filters={filters}
            quotes={quotes}
            onChange={onFilters}
            onClose={() => setOpen(false)}
          />
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto lg:max-h-[calc(100vh-15rem)]">
        {loading ? (
          <div className="space-y-2 p-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-[10px] bg-ink/[0.04]" />
            ))}
          </div>
        ) : launches.length ? (
          launches.map((l) => <Row key={l.token} launch={l} quote={quoteFor(l)} usdRate={rateFor(l)} />)
        ) : (
          <p className="px-4 py-10 text-center text-[12.5px] leading-relaxed text-dim/70">
            {active > 0 ? "Nothing matches these filters." : "Nothing here yet."}
          </p>
        )}
      </div>
    </section>
  );
}

export function Scope() {
  const quotesQ = useQuery({ queryKey: ["quotes"], queryFn: indexer.quotes });
  // Two fetches, not one. `launches` is ordered by creation, so on a busy
  // chain the most recent N can contain no graduated tokens at all, and the
  // Graduated column would sit empty while graduations were happening. Pulling
  // that column's source separately keeps it correct at any volume.
  const launchesQ = useQuery({
    queryKey: ["scope-launches"],
    queryFn: () => indexer.launches({ limit: SCOPE_FETCH_LIMIT }),
    refetchInterval: 5_000,
  });
  const graduatedQ = useQuery({
    queryKey: ["scope-graduated"],
    queryFn: () => indexer.recentlyBonded(SCOPE_GRADUATED_LIMIT),
    refetchInterval: 5_000,
  });

  const [filters, setFilters] = useState<Record<ColumnKey, Filters>>({
    fresh: defaultsFor("fresh"),
    filling: defaultsFor("filling"),
    graduated: defaultsFor("graduated"),
  });
  const [hydrated, setHydrated] = useState(false);
  const [mobileTab, setMobileTab] = useState<ColumnKey>("fresh");

  useEffect(() => {
    const saved = loadFilters();
    setFilters((cur) => ({
      fresh: { ...cur.fresh, ...(saved.fresh ?? {}) },
      filling: { ...cur.filling, ...(saved.filling ?? {}) },
      graduated: { ...cur.graduated, ...(saved.graduated ?? {}) },
    }));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveFilters(filters);
  }, [filters, hydrated]);

  const quotes = quotesQ.data ?? [];
  const quoteMap = useMemo(
    () => new Map(quotes.map((q) => [q.address.toLowerCase(), q])),
    [quotes],
  );
  const quoteFor = (l: Launch) => quoteMap.get(l.quoteToken.toLowerCase());
  const quoteDecimals = (addr: string) => quoteMap.get(addr.toLowerCase())?.decimals ?? 18;
  const rates = useUsdRates(quotes.map((q) => q.address));
  const rateFor = (l: Launch) => (l.phase === 0 ? rates.ethUsd : rates.quoteUsd(l.quoteToken));

  // One clock for the whole board so every column agrees on "now".
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(t);
  }, []);

  const columns = useMemo(() => {
    // Dedupe on token: a recently graduated launch can appear in both fetches.
    const byToken = new Map<string, Launch>();
    for (const l of [...(launchesQ.data ?? []), ...(graduatedQ.data ?? [])]) {
      byToken.set(l.token.toLowerCase(), l);
    }
    const all = [...byToken.values()];
    return COLUMNS.map((c) => ({
      ...c,
      launches: selectColumn(c.key, all).filter((l) => matches(l, filters[c.key], now, quoteDecimals, rateFor)),
    }));
    // quoteDecimals is derived from quoteMap; listing it would rebuild every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchesQ.data, graduatedQ.data, filters, now, quoteMap, rates.ethUsd]);

  const loading = launchesQ.isLoading && graduatedQ.isLoading;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Ponscope</div>
          <h1 className="mt-2.5 font-display text-[26px] font-semibold tracking-[-0.03em] text-ink sm:text-[30px]">
            Every launch, as it happens
          </h1>
          <p className="mt-2 max-w-[58ch] text-[13.5px] leading-relaxed text-dim">
            Three live columns, each filtered independently. Your filters are remembered on this device.
          </p>
        </div>
        <span className="flex items-center gap-2 text-[11.5px] text-dim/70">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pop" />
          updating every 5s
        </span>
      </div>

      {/* Mobile: one column at a time. */}
      <div className="flex gap-1.5 overflow-x-auto lg:hidden [&::-webkit-scrollbar]:hidden">
        {columns.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setMobileTab(c.key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              mobileTab === c.key
                ? "border-pop/35 bg-pop/10 text-pop"
                : "border-edge bg-ink/[0.03] text-dim"
            }`}
          >
            {c.title}
            <span className="ml-1.5 tabular-nums opacity-60">{c.launches.length}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {columns.map((c) => (
          <div key={c.key} className={mobileTab === c.key ? "block" : "hidden lg:block"}>
            <Column
              columnKey={c.key}
              title={c.title}
              hint={c.hint}
              launches={c.launches}
              quotes={quotes}
              quoteFor={quoteFor}
              rateFor={rateFor}
              filters={filters[c.key]}
              onFilters={(f) => setFilters((cur) => ({ ...cur, [c.key]: f }))}
              loading={loading}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

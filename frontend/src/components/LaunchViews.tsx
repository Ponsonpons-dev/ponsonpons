"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CASHBACK_ICON, CASHBACK_TONE } from "./icons";
import { ProgressBar, TokenTile } from "./ui";
import { CASHBACK_LABEL, PHASE_LABEL, fmtAmount, timeAgo } from "@/lib/format";
import { fmtUsd, toWhole, useLaunchUsd, useUsdRates } from "@/lib/usd";
import { curveProgress } from "@/lib/indexer";
import type { Launch } from "@/lib/indexer";

export type View = "grid" | "list";

const STORAGE_KEY = "pop:view";

/**
 * Remembers the reader's choice across visits. Reads on mount rather than
 * during render so the server and first client paint agree, then swaps.
 */
export function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>("grid");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {
      /* private mode or blocked storage; the default is fine */
    }
  }, []);

  const choose = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* non-fatal */
    }
  };

  return [view, choose];
}

function GridIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <rect x="2" y="2" width="5.2" height="5.2" rx="1.4" />
      <rect x="8.8" y="2" width="5.2" height="5.2" rx="1.4" />
      <rect x="2" y="8.8" width="5.2" height="5.2" rx="1.4" />
      <rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.4" />
    </svg>
  );
}

function ListIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <rect x="2" y="3" width="12" height="2" rx="1" />
      <rect x="2" y="7" width="12" height="2" rx="1" />
      <rect x="2" y="11" width="12" height="2" rx="1" />
    </svg>
  );
}

export function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="flex items-center gap-0.5 rounded-full border border-edge bg-ink/[0.035] p-0.5"
    >
      {(
        [
          ["grid", GridIcon, "Grid view"],
          ["list", ListIcon, "List view"],
        ] as const
      ).map(([key, Icon, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-label={label}
          aria-pressed={view === key}
          className={`flex h-7 w-8 items-center justify-center rounded-full transition-colors ${
            view === key ? "bg-ink/[0.1] text-ink" : "text-dim hover:text-ink"
          }`}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

function Row({
  launch,
  quoteSymbol,
  quoteDecimals,
}: {
  launch: Launch;
  quoteSymbol?: string;
  quoteDecimals: number;
}) {
  const live = launch.phase === 0;
  const Icon = CASHBACK_ICON[launch.cashbackMode];
  const tone = CASHBACK_TONE[launch.cashbackMode] ?? "text-dim";
  const { mcUsd } = useLaunchUsd(launch, quoteDecimals);

  return (
    <Link
      href={`/token/${launch.token}`}
      className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 transition-colors hover:bg-ink/[0.035] sm:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:gap-4 sm:px-4"
    >
      <div className="w-9 sm:w-10">
        <TokenTile logo={launch.logo} symbol={launch.symbol} seed={launch.token} />
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-display text-[14px] font-medium tracking-[-0.02em] text-ink">
            {launch.name}
          </span>
          <span className="shrink-0 text-[11.5px] text-dim/80">${launch.symbol}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] sm:hidden">
          <span className="tabular-nums text-pop">{mcUsd ?? "…"}</span>
          {quoteSymbol && <span className="text-dim/70">${quoteSymbol}</span>}
          <span className={`flex items-center gap-1 ${tone}`}>
            {Icon && <Icon className="h-3 w-3" />}
          </span>
        </div>
      </div>

      {/* Desktop-only columns. */}
      <div className="hidden text-[12.5px] text-dim sm:block">{quoteSymbol ? `$${quoteSymbol}` : ""}</div>

      <div className="hidden sm:block">
        {live ? (
          <div className="flex items-center gap-2">
            <ProgressBar bps={curveProgress(launch).bps} />
            <span className="w-11 shrink-0 text-right text-[12px] tabular-nums text-dim">
              {(curveProgress(launch).bps / 100).toFixed(0)}%
            </span>
          </div>
        ) : (
          <span className="text-[12.5px] text-pop">{PHASE_LABEL[launch.phase]}</span>
        )}
      </div>

      <div className="hidden text-[12.5px] tabular-nums text-ink sm:block">
        {mcUsd ?? "…"}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className={`hidden items-center gap-1.5 text-[11.5px] sm:flex ${tone}`}>
          {Icon && <Icon className="h-3 w-3" />}
          <span className="hidden lg:inline">{CASHBACK_LABEL[launch.cashbackMode]}</span>
        </span>
        <span className="w-9 text-right text-[11px] tabular-nums text-dim/60">
          {timeAgo(launch.createdAt)}
        </span>
      </div>
    </Link>
  );
}

export function LaunchList({
  launches,
  quoteFor,
}: {
  launches: Launch[];
  quoteFor: (l: Launch) => { symbol?: string | null; decimals?: number } | undefined;
}) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-edge">
      <div className="hidden grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-4 border-b border-edge px-4 py-2.5 text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim/70 sm:grid">
        <span />
        <span>Token</span>
        <span>Quote</span>
        <span>Curve</span>
        <span>Mcap</span>
        <span className="w-9 text-right">Age</span>
      </div>
      <div className="divide-y divide-edge">
        {launches.map((l) => {
          const q = quoteFor(l);
          return (
            <Row
              key={l.token}
              launch={l}
              quoteSymbol={q?.symbol ?? undefined}
              quoteDecimals={q?.decimals ?? 18}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Compact quote-token row, for the list view of the quote section. */
export function QuoteList({
  quotes,
}: {
  quotes: Array<{
    address: string;
    symbol: string | null;
    name: string | null;
    decimals: number;
    launchCount: number;
    graduatedCount: number;
    totalVolume: string;
    totalBurned: string;
  }>;
}) {
  const rates = useUsdRates(quotes.map((q) => q.address));
  return (
    <div className="overflow-hidden rounded-[16px] border border-edge">
      <div className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] gap-4 border-b border-edge px-4 py-2.5 text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim/70 sm:grid">
        <span>Quote token</span>
        <span className="text-right">Launches</span>
        <span className="text-right">Graduated</span>
        <span className="text-right">Volume</span>
        <span className="text-right">Burned</span>
      </div>
      <div className="divide-y divide-edge">
        {quotes.map((q) => (
          <Link
            key={q.address}
            href={`/quote/${q.address}`}
            className="grid grid-cols-2 items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-ink/[0.035] sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]"
          >
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <div className="truncate font-display text-[14px] font-medium tracking-[-0.02em] text-ink">
                {q.name ?? q.symbol ?? "Unknown"}
              </div>
              <div className="text-[11.5px] text-dim/80">${q.symbol ?? "?"}</div>
            </div>
            <div className="text-[12.5px] tabular-nums text-ink sm:text-right">
              <span className="mr-1.5 text-[10px] uppercase tracking-[0.14em] text-dim/70 sm:hidden">
                Launches
              </span>
              {q.launchCount}
            </div>
            <div className="text-right text-[12.5px] tabular-nums text-ink sm:text-right">
              <span className="mr-1.5 text-[10px] uppercase tracking-[0.14em] text-dim/70 sm:hidden">
                Grad
              </span>
              {q.graduatedCount}
            </div>
            <div className="text-[12.5px] tabular-nums text-pop sm:text-right">
              <span className="mr-1.5 text-[10px] uppercase tracking-[0.14em] text-dim/70 sm:hidden">
                Volume
              </span>
              {fmtUsd(toWhole(q.totalVolume, q.decimals), rates.quoteUsd(q.address)) ?? fmtAmount(q.totalVolume, q.decimals)}
            </div>
            <div className="text-right text-[12.5px] tabular-nums text-burn">
              <span className="mr-1.5 text-[10px] uppercase tracking-[0.14em] text-dim/70 sm:hidden">
                Burned
              </span>
              {fmtAmount(q.totalBurned, q.decimals)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

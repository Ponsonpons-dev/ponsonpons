"use client";

import Link from "next/link";

import { CASHBACK_ICON, CASHBACK_TONE } from "./icons";
import { ProgressBar, TokenLogo, TokenTile } from "./ui";
import { CASHBACK_LABEL, PHASE_LABEL, fmtAmount, fmtPrice, timeAgo } from "@/lib/format";
import type { Launch, Quote } from "@/lib/indexer";

/** Label above value, in the wide-tracked caps used across the site. */
function Metric({
  label,
  value,
  align = "left",
  accent,
}: {
  label: string;
  value: React.ReactNode;
  align?: "left" | "right";
  accent?: string;
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim/70">{label}</div>
      <div className={`mt-1 text-[13px] font-semibold tabular-nums tracking-[-0.01em] ${accent ?? "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

export function QuoteCard({ quote }: { quote: Quote }) {
  const rewards = Number(quote.totalHolderRewards) > 0;
  return (
    <Link
      href={`/quote/${quote.address}`}
      className="card block p-4 transition-colors hover:border-pop/25 hover:bg-hover/40"
    >
      <div className="flex items-center gap-2.5">
        <TokenLogo logo="" symbol={quote.symbol ?? "?"} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-medium tracking-[-0.02em] text-ink">
            {quote.name ?? quote.symbol ?? "Unknown"}
          </div>
          <div className="text-[12px] text-dim/80">${quote.symbol ?? "?"}</div>
        </div>
        {quote.paused && <span className="pill shrink-0">paused</span>}
      </div>

      <hr className="rule my-3.5" />

      <div className="grid grid-cols-2 gap-y-3">
        <Metric label="Launches" value={quote.launchCount} />
        <Metric label="Graduated" value={quote.graduatedCount} align="right" />
        <Metric label="Volume" value={fmtAmount(quote.totalVolume, quote.decimals)} accent="text-pop" />
        <Metric
          label="Burned"
          value={fmtAmount(quote.totalBurned, quote.decimals)}
          align="right"
          accent="text-burn"
        />
      </div>

      {rewards && (
        <div className="mt-3 border-t border-edge pt-3">
          <Metric
            label="Paid to holders"
            value={`${fmtAmount(quote.totalHolderRewards, quote.decimals)} ${quote.symbol ?? ""}`}
            accent="text-pop"
          />
        </div>
      )}
    </Link>
  );
}

export function LaunchCard({
  launch,
  quoteSymbol,
  quoteDecimals = 18,
}: {
  launch: Launch;
  quoteSymbol?: string;
  quoteDecimals?: number;
}) {
  const live = launch.phase === 0;
  const Icon = CASHBACK_ICON[launch.cashbackMode];
  const tone = CASHBACK_TONE[launch.cashbackMode] ?? "text-dim";

  return (
    <Link
      href={`/token/${launch.token}`}
      className="card block p-2.5 transition-colors hover:border-pop/25 hover:bg-hover/40 sm:p-3"
    >
      <div className="relative">
        <TokenTile logo={launch.logo} symbol={launch.symbol} seed={launch.token} />
        {quoteSymbol && (
          <span className="pill absolute bottom-2 right-2 border-transparent bg-bg/75 font-medium text-ink backdrop-blur-md">
            ${quoteSymbol}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <div className="truncate font-display text-[14.5px] font-medium tracking-[-0.02em] text-ink">
          {launch.name}
        </div>
        <div className="shrink-0 text-[11.5px] text-dim/80">${launch.symbol}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Price" value={fmtPrice(launch.lastPriceQuoteWad, quoteDecimals)} accent="text-pop" />
        <Metric
          label={live ? "Curve" : "Status"}
          value={live ? `${(launch.curveProgressBps / 100).toFixed(1)}%` : PHASE_LABEL[launch.phase]}
          align="right"
          accent={live ? "text-ink" : "text-pop"}
        />
      </div>

      {live && (
        <div className="mt-3">
          <ProgressBar bps={launch.curveProgressBps} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
        <span className={`flex min-w-0 items-center gap-1.5 ${tone}`}>
          {Icon && <Icon className="h-3 w-3 shrink-0" />}
          <span className="truncate">{CASHBACK_LABEL[launch.cashbackMode]}</span>
        </span>
        <span className="shrink-0 tabular-nums text-dim/60">{timeAgo(launch.createdAt)}</span>
      </div>
    </Link>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

import { indexer } from "@/lib/indexer";

const INTERVALS = [
  { label: "1m", value: 60 },
  { label: "15m", value: 900 },
  { label: "1h", value: 3600 },
  { label: "1d", value: 86400 },
] as const;

/** OHLC chart in quote terms, fed by the indexer's candles. */
export function PriceChart({ token, quoteDecimals }: { token: string; quoteDecimals: number }) {
  const [interval, setInterval_] = useState(900);
  const container = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ["candles", token, interval],
    queryFn: () => indexer.candles(token, interval),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b93a7",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1a1e29" },
        horzLines: { color: "#1a1e29" },
      },
      rightPriceScale: { borderColor: "#232837" },
      timeScale: { borderColor: "#232837", timeVisible: true, secondsVisible: false },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#f87171",
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#f87171",
      priceFormat: { type: "price", precision: 10, minMove: 1e-10 },
    });

    const scale = 1e18 * 10 ** (quoteDecimals - 18);
    const rows = (data ?? [])
      .slice()
      .reverse()
      .map((c) => ({
        time: Number(c.bucketStart) as UTCTimestamp,
        open: Number(c.open) / scale,
        high: Number(c.high) / scale,
        low: Number(c.low) / scale,
        close: Number(c.close) / scale,
      }));
    // The pool prints one absurd tick whenever a swap runs into its price
    // limit (the graduation crossing does this), and a single 1e38 candle
    // flattens the whole axis. Anything four orders of magnitude off the
    // median close is that artifact, not a trade worth charting.
    const closes = rows.map((r) => r.close).filter((v) => v > 0).sort((a, b) => a - b);
    const median = closes[Math.floor(closes.length / 2)] ?? 0;
    const sane = median > 0 ? rows.filter((r) => r.high <= median * 1e4 && r.low >= median / 1e4) : rows;
    series.setData(sane.length ? sane : rows);
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [data, quoteDecimals]);

  return (
    <div className="card p-3">
      <div className="mb-2 flex justify-end gap-1">
        {INTERVALS.map((i) => (
          <button
            key={i.value}
            onClick={() => setInterval_(i.value)}
            className={`rounded px-2 py-0.5 text-xs ${
              interval === i.value ? "bg-pop text-black" : "bg-hover text-dim hover:text-ink"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>
      <div ref={container} className="h-72 w-full sm:h-96" />
      {!data?.length && (
        <div className="pointer-events-none -mt-48 pb-40 text-center text-sm text-dim">No trades yet</div>
      )}
    </div>
  );
}

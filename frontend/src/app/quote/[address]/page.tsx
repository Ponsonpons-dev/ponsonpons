"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";

import { LaunchCard } from "@/components/cards";
import { AddressLink, BackLink, EmptyState, Skeleton, Stat } from "@/components/ui";
import { fmtAmount } from "@/lib/format";
import { indexer } from "@/lib/indexer";
import { useTokenUsdValue } from "@/lib/usd";

export default function QuotePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const quoteQ = useQuery({ queryKey: ["quote", address], queryFn: () => indexer.quote(address) });
  const launchesQ = useQuery({
    queryKey: ["launches", "quote", address],
    queryFn: () => indexer.launches({ quote: address, limit: 100 }),
  });
  const volUsd = useTokenUsdValue(address, quoteQ.data?.totalVolume, quoteQ.data?.decimals ?? 18);

  if (quoteQ.isLoading) return <Skeleton className="h-64" />;
  const quote = quoteQ.data;
  if (!quote) return <EmptyState>Quote token not found.</EmptyState>;

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/">all quotes</BackLink>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-[-0.8px]">
          ${quote.symbol} <span className="text-base font-normal text-dim">{quote.name}</span>
        </h1>
        <div className="mt-1 text-xs text-dim">
          <AddressLink address={quote.address} /> · graduates at{" "}
          {fmtAmount(quote.graduationThreshold, quote.decimals)} {quote.symbol} collected
          {quote.paused && <span className="ml-2 text-down">(new launches paused)</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Launches" value={quote.launchCount} />
        <Stat label="Graduated" value={quote.graduatedCount} />
        <Stat label="Volume" value={volUsd ?? `${fmtAmount(quote.totalVolume, quote.decimals)} ${quote.symbol}`} />
        <Stat
          label="Burned forever"
          value={`${fmtAmount(quote.totalBurned, quote.decimals)} ${quote.symbol}`}
          accent="text-burn"
        />
        <Stat
          label="Paid to holders"
          value={`${fmtAmount(quote.totalHolderRewards, quote.decimals)} ${quote.symbol}`}
          accent="text-up"
        />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">Launched on ${quote.symbol}</h2>
        {launchesQ.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {launchesQ.data.map((l) => (
              <LaunchCard key={l.token} launch={l} quoteSymbol={quote.symbol ?? undefined} quoteDecimals={quote.decimals} />
            ))}
          </div>
        ) : (
          <EmptyState>Nothing launched on ${quote.symbol} yet. Be the first and start the burn.</EmptyState>
        )}
      </section>
    </div>
  );
}

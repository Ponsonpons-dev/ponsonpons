"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";

import { CreatorPanel } from "@/components/CreatorPanel";
import { PriceChart } from "@/components/PriceChart";
import { RewardsPanel } from "@/components/RewardsPanel";
import { TradePanel } from "@/components/TradePanel";
import { TrustPanel } from "@/components/TrustPanel";
import { AddressLink, EmptyState, ProgressBar, Skeleton, Stat, TokenLogo } from "@/components/ui";
import { explorerTx } from "@/lib/addresses";
import { CASHBACK_LABEL, PHASE_LABEL, fmtAmount, fmtPrice, shortAddr, timeAgo } from "@/lib/format";
import { curveProgress, indexer } from "@/lib/indexer";

export default function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);

  const launchQ = useQuery({ queryKey: ["launch", address], queryFn: () => indexer.launch(address) });
  const launch = launchQ.data;
  const quoteQ = useQuery({
    queryKey: ["quote", launch?.quoteToken],
    queryFn: () => indexer.quote(launch!.quoteToken),
    enabled: !!launch,
  });
  const tradesQ = useQuery({
    queryKey: ["trades", address],
    queryFn: () => indexer.trades(address),
    refetchInterval: 4_000,
  });

  if (launchQ.isLoading) return <Skeleton className="h-96" />;
  if (!launch) return <EmptyState>Token not found. Is the indexer synced?</EmptyState>;

  const quote = quoteQ.data ?? null;
  const qd = quote?.decimals ?? 18;
  const qs = quote?.symbol ?? "quote";
  // Pre-bond the venue is the ETH curve pool, so prices and volume are in
  // ETH; post-bond they are in the bond quote.
  const live = launch?.phase === 0;
  const dd = live ? 18 : qd;
  const ds = live ? "ETH" : qs;
  // Market cap in quote terms = price * supply.
  const mcQuote = (BigInt(launch.lastPriceQuoteWad) * BigInt(launch.supply)) / 10n ** 18n;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TokenLogo logo={launch.logo} symbol={launch.symbol} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-extrabold tracking-[-0.6px]">
            {launch.name} <span className="text-dim">${launch.symbol}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
            <span>
              quoted in{" "}
              <Link href={`/quote/${launch.quoteToken}`} className="text-pop hover:underline">
                ${qs}
              </Link>
            </span>
            <span>· by <AddressLink address={launch.deployer} /></span>
            <span>· {timeAgo(launch.createdAt)} ago</span>
            <span className={launch.cashbackMode === 2 ? "text-burn" : ""}>
              · {CASHBACK_LABEL[launch.cashbackMode]}
              {launch.cashbackMode !== 0 ? ` (${launch.cashbackShareBps / 100}%)` : ""}
            </span>
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          {launch.website && (
            <a className="btn-ghost px-2 py-1" href={launch.website} target="_blank" rel="noreferrer">
              web
            </a>
          )}
          {launch.twitter && (
            <a className="btn-ghost px-2 py-1" href={launch.twitter} target="_blank" rel="noreferrer">
              𝕏
            </a>
          )}
          {launch.telegram && (
            <a className="btn-ghost px-2 py-1" href={launch.telegram} target="_blank" rel="noreferrer">
              tg
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label={`Price (${ds})`} value={fmtPrice(launch.lastPriceQuoteWad, dd)} />
        <Stat label={`MC (${ds})`} value={fmtAmount(mcQuote, dd)} />
        <Stat label="Trades" value={launch.tradeCount} />
        <Stat
          label={live ? "Volume (ETH)" : `Volume (${qs})`}
          value={fmtAmount(live ? launch.volumeEth : launch.volumeQuote, dd)}
        />
        {launch.cashbackMode === 3 ? (
          <Stat
            label={`Rewards (${qs})`}
            value={fmtAmount(launch.holderRewardsQuote, qd)}
            accent="text-up"
          />
        ) : (
          <Stat
            label={`Burned (${qs})`}
            value={fmtAmount(launch.burnedQuote, qd)}
            accent="text-burn"
          />
        )}
      </div>

      {launch.phase === 0 && (
        <div className="card p-3">
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-dim">Curve progress toward the bond</span>
            <span className="font-semibold">{(curveProgress(launch).bps / 100).toFixed(1)}%</span>
          </div>
          <ProgressBar bps={curveProgress(launch).bps} />
          <div className="mt-1 text-[11px] text-dim">
            {curveProgress(launch).raisedEth.toFixed(3)} / {curveProgress(launch).thresholdEth.toFixed(2)} ETH
            raised. At 100% the whole raise market-buys {qs} and the pair moves to it, locked forever.
          </div>
        </div>
      )}
      {launch.phase !== 0 && (
        <div className="card border-up/40 p-3 text-sm font-semibold text-up">
          {PHASE_LABEL[launch.phase]}
          {launch.phase === 2 && ". Trading live on Uniswap V4, liquidity locked forever."}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-2">
          <PriceChart token={launch.token} quoteDecimals={qd} />

          <section className="card p-4">
            <h2 className="mb-2 text-sm font-bold">Trades</h2>
            {tradesQ.data?.length ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-dim">
                    <tr>
                      <th className="pb-1">side</th>
                      <th>{qs}</th>
                      <th>{launch.symbol}</th>
                      <th>trader</th>
                      <th className="text-right">age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradesQ.data.map((t) => (
                      <tr key={t.id} className="border-t border-edge/50">
                        <td className={`py-1 font-semibold ${t.isBuy ? "text-up" : "text-down"}`}>
                          {t.isBuy ? "buy" : "sell"}
                          {t.venue === "pool" ? " (pool)" : ""}
                        </td>
                        <td>{fmtAmount(t.quoteAmount, qd)}</td>
                        <td>{fmtAmount(t.tokenAmount, 18)}</td>
                        <td>
                          <AddressLink address={t.trader} />
                        </td>
                        <td className="text-right">
                          <a
                            href={explorerTx(t.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-dim hover:text-ink"
                          >
                            {timeAgo(t.timestamp)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-dim">No trades yet.</div>
            )}
          </section>
        </div>

        <div className="order-1 space-y-4 lg:order-2">
          <TradePanel launch={launch} quoteInfo={quote} />
          {launch.cashbackMode === 3 && <RewardsPanel launch={launch} quoteInfo={quote} />}
          <CreatorPanel launch={launch} quoteInfo={quote} />
          <TrustPanel launch={launch} />

        </div>
      </div>
    </div>
  );
}

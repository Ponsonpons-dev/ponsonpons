"use client";

import { useQuery } from "@tanstack/react-query";

import { Landing } from "@/components/Landing";
import { LaunchList, QuoteList, ViewToggle, useView } from "@/components/LaunchViews";
import { LaunchCard, QuoteCard } from "@/components/cards";
import { EmptyState, Skeleton } from "@/components/ui";
import { indexer } from "@/lib/indexer";

function SectionHead({
  eyebrow,
  title,
  hint,
  id,
  action,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  id?: string;
  action?: React.ReactNode;
}) {
  return (
    <div id={id} className="mb-6 scroll-mt-28">
      <div className="eyebrow">{eyebrow}</div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-[22px] font-semibold tracking-[-0.03em] text-ink sm:text-[26px]">
            {title}
          </h2>
          {hint && <span className="text-[13px] text-dim/80">{hint}</span>}
        </div>
        {action}
      </div>
    </div>
  );
}

export default function HomePage() {
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: indexer.quotes });
  const trending = useQuery({ queryKey: ["trending"], queryFn: () => indexer.trending() });
  const graduated = useQuery({ queryKey: ["graduated"], queryFn: () => indexer.recentlyGraduated() });

  const [view, setView] = useView();
  const quoteMeta = new Map(quotes.data?.map((q) => [q.address.toLowerCase(), q]) ?? []);
  const quoteFor = (l: { quoteToken: string }) => quoteMeta.get(l.quoteToken.toLowerCase());
  const totals = quotes.data?.reduce(
    (acc, q) => ({ launches: acc.launches + q.launchCount, graduated: acc.graduated + q.graduatedCount }),
    { launches: 0, graduated: 0 },
  );

  return (
    <div className="space-y-20 sm:space-y-24">
      <Landing
        quoteCount={quotes.data?.length}
        launchCount={totals?.launches}
        graduatedCount={totals?.graduated}
      />

      <section>
        <SectionHead
          id="explore"
          eyebrow="Quote tokens"
          title="What you can launch on"
          hint="graduated on Pons, used as the pair here"
          action={<ViewToggle view={view} onChange={setView} />}
        />
        {quotes.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : quotes.data?.length ? (
          view === "grid" ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {quotes.data.map((q) => (
                <QuoteCard key={q.address} quote={q} />
              ))}
            </div>
          ) : (
            <QuoteList quotes={quotes.data} />
          )
        ) : (
          <EmptyState>
            No quote tokens listed yet. Listing is permissionless. Any graduated Pons token with enough
            locked liquidity qualifies.
          </EmptyState>
        )}
      </section>

      <section>
        <SectionHead
          eyebrow="Live"
          title="Trending launches"
          hint="most traded in the last 24 hours"
          action={<ViewToggle view={view} onChange={setView} />}
        />
        {trending.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-[264px]" />
            ))}
          </div>
        ) : trending.data?.length ? (
          view === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {trending.data.slice(0, 8).map((l) => {
                const q = quoteFor(l);
                return (
                  <LaunchCard
                    key={l.token}
                    launch={l}
                    quoteSymbol={q?.symbol ?? undefined}
                    quoteDecimals={q?.decimals ?? 18}
                  />
                );
              })}
            </div>
          ) : (
            <LaunchList launches={trending.data} quoteFor={quoteFor} />
          )
        ) : (
          <EmptyState>No live launches yet. Be the first.</EmptyState>
        )}
      </section>

      <section>
        <SectionHead
          eyebrow="Settled"
          title="Graduated recently"
          hint="liquidity locked, position held forever"
          action={<ViewToggle view={view} onChange={setView} />}
        />
        {graduated.data?.length ? (
          view === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {graduated.data.map((l) => {
                const q = quoteFor(l);
                return (
                  <LaunchCard
                    key={l.token}
                    launch={l}
                    quoteSymbol={q?.symbol ?? undefined}
                    quoteDecimals={q?.decimals ?? 18}
                  />
                );
              })}
            </div>
          ) : (
            <LaunchList launches={graduated.data} quoteFor={quoteFor} />
          )
        ) : (
          <EmptyState>Nothing has graduated yet.</EmptyState>
        )}
      </section>
    </div>
  );
}

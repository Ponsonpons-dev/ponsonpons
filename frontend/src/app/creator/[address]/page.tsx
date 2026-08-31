"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { PopFeeEscrowAbi } from "@/abis/PopFeeEscrow";
import { LaunchCard } from "@/components/cards";
import { AddressLink, EmptyState, Stat } from "@/components/ui";
import { ADDRESSES } from "@/lib/addresses";
import { fmtAmount } from "@/lib/format";
import { indexer } from "@/lib/indexer";

function ClaimRow({ quoteToken, symbol, decimals }: { quoteToken: `0x${string}`; symbol: string; decimals: number }) {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: claimable, refetch } = useReadContract({
    abi: PopFeeEscrowAbi,
    address: ADDRESSES.feeEscrow,
    functionName: "balanceOfToken",
    args: account ? [account, quoteToken] : undefined,
    query: { enabled: !!account, refetchInterval: 10_000 },
  });
  if (!claimable) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span>
        {fmtAmount(claimable, decimals)} {symbol} claimable
      </span>
      <button
        className="btn-pop px-3 py-1 text-xs"
        onClick={async () => {
          const hash = await writeContractAsync({
            abi: PopFeeEscrowAbi,
            address: ADDRESSES.feeEscrow,
            functionName: "claimToken",
            args: [quoteToken],
          });
          await publicClient?.waitForTransactionReceipt({ hash });
          await refetch();
        }}
      >
        Claim
      </button>
    </div>
  );
}

export default function CreatorPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { address: account } = useAccount();
  const isSelf = account?.toLowerCase() === address.toLowerCase();

  const statsQ = useQuery({ queryKey: ["creatorStats", address], queryFn: () => indexer.creatorStats(address) });
  const launchesQ = useQuery({
    queryKey: ["launches", "creator", address],
    queryFn: () => indexer.launches({ deployer: address, limit: 100 }),
  });
  const quotesQ = useQuery({ queryKey: ["quotes"], queryFn: indexer.quotes });
  const quoteMeta = new Map(quotesQ.data?.map((q) => [q.address.toLowerCase(), q]) ?? []);

  const totals = statsQ.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Creator</h1>
        <AddressLink address={address} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Launches" value={launchesQ.data?.length ?? "…"} />
        {totals.slice(0, 3).map((s) => {
          const q = quoteMeta.get(s.quoteToken.toLowerCase());
          return (
            <Stat
              key={s.quoteToken}
              label={`Fees earned (${q?.symbol ?? "?"})`}
              value={fmtAmount(s.feesEarned, q?.decimals ?? 18)}
            />
          );
        })}
      </div>

      {isSelf && (
        <section className="card border-pop/30 p-4">
          <h2 className="mb-2 text-sm font-bold text-pop">Your claimable fees</h2>
          <div className="space-y-2">
            {(quotesQ.data ?? []).map((q) => (
              <ClaimRow
                key={q.address}
                quoteToken={q.address}
                symbol={q.symbol ?? "?"}
                decimals={q.decimals}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold">Launches</h2>
        {launchesQ.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {launchesQ.data.map((l) => {
              const q = quoteMeta.get(l.quoteToken.toLowerCase());
              return (
                <LaunchCard key={l.token} launch={l} quoteSymbol={q?.symbol ?? undefined} quoteDecimals={q?.decimals ?? 18} />
              );
            })}
          </div>
        ) : (
          <EmptyState>No launches from this address.</EmptyState>
        )}
      </section>
    </div>
  );
}

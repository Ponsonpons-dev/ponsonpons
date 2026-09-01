"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { PopRewardTokenAbi } from "@/abis/PopRewardToken";
import { feeOverrides } from "@/lib/fees";
import { fmtAmount } from "@/lib/format";
import type { Launch, Quote } from "@/lib/indexer";

/**
 * Holder-rewards claim panel. Only rendered for launches that chose the
 * HolderRewards cashback mode, where the launch token itself distributes the
 * quote asset to whoever holds it.
 */
export function RewardsPanel({ launch, quoteInfo }: { launch: Launch; quoteInfo: Quote | null }) {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qd = quoteInfo?.decimals ?? 18;
  const qs = quoteInfo?.symbol ?? "quote";

  const { data: claimable, refetch } = useReadContract({
    abi: PopRewardTokenAbi,
    address: launch.token,
    functionName: "claimable",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 6_000 },
  });
  const { data: totalEligible } = useReadContract({
    abi: PopRewardTokenAbi,
    address: launch.token,
    functionName: "totalEligible",
    query: { refetchInterval: 15_000 },
  });

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        abi: PopRewardTokenAbi,
        address: launch.token,
        functionName: "claim",
        ...(await feeOverrides(publicClient, "claim")),
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetch();
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 160) ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-up/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold text-up">Holder rewards</span>
        <span className="text-[11px] text-dim">{launch.cashbackShareBps / 100}% of creator take</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-dim">
        Every trade pays {qs} to everyone holding ${launch.symbol}, pro-rata and continuously, on the
        curve and in the pool. Nothing to stake, no operator, no snapshot: just hold and claim.
      </p>

      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-dim">Distributed so far</span>
          <span className="font-semibold">
            {fmtAmount(launch.holderRewardsQuote, qd)} {qs}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-dim">Earning supply</span>
          <span>{fmtAmount(totalEligible, 18)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-dim">Your claimable</span>
          <span className="font-semibold text-up">
            {fmtAmount(claimable, qd)} {qs}
          </span>
        </div>
      </div>

      <button
        className="btn mt-3 w-full bg-up font-bold text-black"
        disabled={busy || !account || !claimable}
        onClick={claim}
      >
        {busy ? "Claiming…" : account ? "Claim rewards" : "Connect wallet"}
      </button>
      {error && <div className="mt-2 break-words text-xs text-down">{error}</div>}
    </div>
  );
}

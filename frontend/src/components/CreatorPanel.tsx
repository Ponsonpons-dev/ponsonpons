"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { PopFeeEscrowAbi } from "@/abis/PopFeeEscrow";
import { PopLaunchFactoryAbi } from "@/abis/PopLaunchFactory";
import { ADDRESSES } from "@/lib/addresses";
import { feeOverrides } from "@/lib/fees";
import { fmtAmount } from "@/lib/format";
import type { Launch, Quote } from "@/lib/indexer";

/** Visible only to the launch's current creator fee recipient. */
export function CreatorPanel({ launch, quoteInfo }: { launch: Launch; quoteInfo: Quote | null }) {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [newRecipient, setNewRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreator = account?.toLowerCase() === launch.creatorFeeRecipient.toLowerCase();

  const { data: claimable, refetch } = useReadContract({
    abi: PopFeeEscrowAbi,
    address: ADDRESSES.feeEscrow,
    functionName: "balanceOfToken",
    args: account ? [account, launch.quoteToken] : undefined,
    query: { enabled: isCreator, refetchInterval: 8_000 },
  });
  // Curve-phase creator fees accrue in WETH; bonded-phase fees in the quote.
  const { data: claimableWeth, refetch: refetchWeth } = useReadContract({
    abi: PopFeeEscrowAbi,
    address: ADDRESSES.feeEscrow,
    functionName: "balanceOfToken",
    args: account ? [account, ADDRESSES.weth] : undefined,
    query: { enabled: isCreator, refetchInterval: 8_000 },
  });

  if (!isCreator) return null;

  async function act(fn: () => Promise<`0x${string}`>) {
    setBusy(true);
    setError(null);
    try {
      const hash = await fn();
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetch();
      await refetchWeth();
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 160) ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-pop/30 p-4">
      <div className="mb-2 text-sm font-bold text-pop">Creator panel</div>
      <div className="space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-dim">Claimable curve-phase fees (ETH)</span>
          <span className="font-semibold">{fmtAmount(claimableWeth, 18)} WETH</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-dim">Claimable bonded-phase fees</span>
          <span className="font-semibold">
            {fmtAmount(claimable, quoteInfo?.decimals ?? 18)} {quoteInfo?.symbol}
          </span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="btn-pop"
          disabled={busy || !claimableWeth}
          onClick={() =>
            act(async () =>
              writeContractAsync({
                abi: PopFeeEscrowAbi,
                address: ADDRESSES.feeEscrow,
                functionName: "claimToken",
                args: [ADDRESSES.weth],
                ...(await feeOverrides(publicClient)),
              }),
            )
          }
        >
          {busy ? "Working…" : "Claim WETH"}
        </button>
        <button
          className="btn-pop"
          disabled={busy || !claimable}
          onClick={() =>
            act(async () =>
              writeContractAsync({
                abi: PopFeeEscrowAbi,
                address: ADDRESSES.feeEscrow,
                functionName: "claimToken",
                args: [launch.quoteToken],
                ...(await feeOverrides(publicClient)),
              }),
            )
          }
        >
          {busy ? "Working…" : `Claim ${quoteInfo?.symbol ?? "quote"}`}
        </button>
      </div>

      <div className="mt-4 border-t border-edge pt-3">
        <label className="label">Transfer fee recipient (irreversible, no recovery exists)</label>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="0x…"
            value={newRecipient}
            onChange={(e) => setNewRecipient(e.target.value)}
          />
          <button
            className="btn-ghost shrink-0"
            disabled={busy || !isAddress(newRecipient)}
            onClick={() =>
              act(async () =>
                writeContractAsync({
                  abi: PopLaunchFactoryAbi,
                  address: ADDRESSES.launchFactory,
                  functionName: "transferCreatorFeeRecipient",
                  args: [launch.token, newRecipient as `0x${string}`],
                  ...(await feeOverrides(publicClient)),
                }),
              )
            }
          >
            Transfer
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-down">{error}</div>}
    </div>
  );
}

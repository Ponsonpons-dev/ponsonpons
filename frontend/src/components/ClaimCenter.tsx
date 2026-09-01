"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";

import { PopFeeEscrowAbi } from "@/abis/PopFeeEscrow";
import { ADDRESSES } from "@/lib/addresses";
import { feeOverrides } from "@/lib/fees";
import { fmtAmount } from "@/lib/format";
import { indexer } from "@/lib/indexer";
import { fmtUsd, toWhole, useUsdRates } from "@/lib/usd";

/**
 * Header badge that lights up whenever the connected wallet has anything
 * claimable in the fee escrow, across every asset fees can arrive in: WETH
 * from curve-phase trading plus each listed quote token. Opens into a panel
 * whose Claim all walks the nonzero assets in sequence (the escrow pays only
 * msg.sender, one asset per transaction), so a creator discovers their fees
 * instead of having to know which token page to visit.
 */
export function ClaimCenter() {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const quotesQ = useQuery({ queryKey: ["quotes"], queryFn: indexer.quotes });
  const assets: Array<{ address: `0x${string}`; symbol: string; decimals: number }> = [
    { address: ADDRESSES.weth, symbol: "WETH", decimals: 18 },
    ...(quotesQ.data ?? [])
      .filter((q) => q.address.toLowerCase() !== ADDRESSES.weth.toLowerCase())
      .map((q) => ({
        address: q.address as `0x${string}`,
        symbol: q.symbol ?? "?",
        decimals: q.decimals ?? 18,
      })),
  ];

  const balances = useReadContracts({
    contracts: assets.map((a) => ({
      abi: PopFeeEscrowAbi,
      address: ADDRESSES.feeEscrow,
      functionName: "balanceOfToken" as const,
      args: [account ?? "0x0000000000000000000000000000000000000000", a.address] as const,
    })),
    query: { enabled: !!account, refetchInterval: 12_000 },
  });

  const rates = useUsdRates(assets.map((a) => a.address));
  const rows = assets
    .map((a, i) => ({ ...a, amount: (balances.data?.[i]?.result as bigint | undefined) ?? 0n }))
    .filter((r) => r.amount > 0n);

  const totalUsd = rows.reduce((acc, r) => {
    const rate =
      r.address.toLowerCase() === ADDRESSES.weth.toLowerCase() ? rates.ethUsd : rates.quoteUsd(r.address);
    const w = toWhole(r.amount, r.decimals);
    return w !== null && rate !== null ? acc + w * rate : acc;
  }, 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!account || rows.length === 0) return null;

  async function claimAll() {
    setBusy(true);
    setError(null);
    try {
      for (const r of rows) {
        const hash = await writeContractAsync({
          abi: PopFeeEscrowAbi,
          address: ADDRESSES.feeEscrow,
          functionName: "claimToken",
          args: [r.address],
          ...(await feeOverrides(publicClient, "claim")),
        });
        await publicClient?.waitForTransactionReceipt({ hash });
      }
      await balances.refetch();
      setOpen(false);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 140) ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-9 items-center gap-1.5 rounded-full border border-pop/40 bg-pop/10 px-3 text-[12.5px] font-semibold text-pop transition-colors hover:bg-pop/15"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-pop shadow-[0_0_6px_rgb(20_216_44_/_0.8)]" />
        {totalUsd > 0 ? fmtUsd(totalUsd, 1) : "Fees"}
        <span className="hidden sm:inline">claimable</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Claimable fees"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[min(280px,calc(100vw-2rem))] rounded-[16px] border border-edge bg-raised/95 p-4 shadow-[0_20px_60px_rgb(0_0_0_/_0.6)] backdrop-blur-xl"
        >
          <div className="mb-2 text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim/70">
            Your unclaimed fees
          </div>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.address} className="flex items-baseline justify-between text-[13px]">
                <span className="text-dim">{r.symbol}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {fmtAmount(r.amount, r.decimals)}
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="btn-pop mt-3 w-full" disabled={busy} onClick={claimAll}>
            {busy ? "Claiming…" : rows.length > 1 ? `Claim all (${rows.length} transactions)` : "Claim"}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-dim/70">
            Paid straight to your wallet from the fee escrow. One signature per asset.
          </p>
          {error && <div className="mt-2 text-[11.5px] text-down">{error}</div>}
        </div>
      )}
    </div>
  );
}

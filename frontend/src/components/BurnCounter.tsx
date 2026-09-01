"use client";

import { useReadContract } from "wagmi";

import { PopBuybackBurnerAbi } from "@/abis/PopBuybackBurner";
import { PopLaunchTokenAbi } from "@/abis/PopLaunchToken";
import { ADDRESSES } from "@/lib/addresses";
import { fmtAmount } from "@/lib/format";
import { fmtUsd, toWhole, useUsdRates } from "@/lib/usd";

const DEAD = "0x000000000000000000000000000000000000dEaD" as const;

/**
 * Tokens destroyed forever, read straight from the dead address rather than
 * from any protocol counter: the buyback sends every $POP it buys there, so
 * this balance is the burn total no matter what else changes.
 */
export function BurnCounter({ token, symbol }: { token?: `0x${string}`; symbol?: string }) {
  // Without an explicit token, report the platform's own: the burner knows it.
  const { data: popToken } = useReadContract({
    abi: PopBuybackBurnerAbi,
    address: ADDRESSES.buybackBurner,
    functionName: "popToken",
    query: { enabled: !token },
  });
  const target = token ?? (popToken as `0x${string}` | undefined);

  const { data: burned } = useReadContract({
    abi: PopLaunchTokenAbi,
    address: target,
    functionName: "balanceOf",
    args: [DEAD],
    query: { enabled: !!target, refetchInterval: 15_000 },
  });

  const rates = useUsdRates(target ? [target] : []);
  if (!target) return null;

  const usd = fmtUsd(toWhole(burned as bigint | undefined, 18), rates.quoteUsd(target));
  const label = symbol ?? "POP";

  return (
    <div className="card border-burn/25 bg-burn/[0.04] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <div className="eyebrow text-burn/80">{label} burned forever</div>
          <div className="mt-1 font-display text-[26px] font-semibold tabular-nums tracking-[-0.03em] text-burn sm:text-[32px]">
            {fmtAmount(burned as bigint | undefined, 18)} {label}
          </div>
        </div>
        {usd && <div className="text-[15px] font-semibold tabular-nums text-burn/80">{usd}</div>}
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
        Bought on the open market with creator fees and sent to the dead address. Supply that can never
        come back.
      </p>
    </div>
  );
}

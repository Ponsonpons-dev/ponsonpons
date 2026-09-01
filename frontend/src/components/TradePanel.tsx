"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, maxUint256, parseUnits } from "viem";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { PopSwapRouterAbi } from "@/abis/PopSwapRouter";
import { ADDRESSES, explorerTx } from "@/lib/addresses";
import { feeOverrides } from "@/lib/fees";
import { fmtAmount } from "@/lib/format";
import type { Launch, Quote } from "@/lib/indexer";

const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Buy/sell panel: plain ETH in, plain ETH out, whatever phase the launch is
 * in. Both phases route through PopSwapRouter (the same public entry point
 * bots use), which trades the WETH curve pool pre-bond and routes through
 * the quote conversion into the bonded pool afterwards. Buys need no
 * approvals at all; sells approve the launch token to the router,
 * exact-amount by default. The expected output is a live simulation of the
 * exact call about to be sent, so the preview can never use different math
 * than the trade.
 */
export function TradePanel({ launch, quoteInfo }: { launch: Launch; quoteInfo: Quote | null }) {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [unlimitedApproval, setUnlimitedApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [expectedOut, setExpectedOut] = useState<bigint>(0n);

  const bonded = launch.phase === 1;
  const quoteSymbol = quoteInfo?.symbol ?? "quote";

  const parsedAmount = useMemo(() => {
    try {
      return amount ? parseUnits(amount, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  const { data: ethBalance } = useBalance({
    address: account,
    query: { enabled: !!account, refetchInterval: 5_000 },
  });
  const { data: tokenBalance } = useReadContract({
    abi: erc20Abi,
    address: launch.token,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 5_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: launch.token,
    functionName: "allowance",
    args: account ? [account, ADDRESSES.swapRouter] : undefined,
    query: { enabled: !!account, refetchInterval: 5_000 },
  });

  const balance = side === "buy" ? ethBalance?.value : tokenBalance;
  const needsApproval =
    side === "sell" && allowance !== undefined && parsedAmount > 0n && allowance < parsedAmount;

  // Live preview: simulate the exact router call. A sell preview needs the
  // allowance in place; until then the preview shows zero and the approve
  // button leads.
  useEffect(() => {
    let cancelled = false;
    async function quoteIt() {
      if (!publicClient || parsedAmount === 0n) {
        setExpectedOut(0n);
        return;
      }
      try {
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
        const sim =
          side === "buy"
            ? await publicClient.simulateContract({
                abi: PopSwapRouterAbi,
                address: ADDRESSES.swapRouter,
                functionName: "buyWithEth",
                args: [launch.token, 0n, deadline],
                value: parsedAmount,
                account,
              })
            : await publicClient.simulateContract({
                abi: PopSwapRouterAbi,
                address: ADDRESSES.swapRouter,
                functionName: "sellForEth",
                args: [launch.token, parsedAmount, 0n, deadline],
                account,
              });
        if (!cancelled) setExpectedOut(sim.result as bigint);
      } catch {
        if (!cancelled) setExpectedOut(0n);
      }
    }
    quoteIt();
    const t = setInterval(quoteIt, 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [publicClient, parsedAmount, side, launch.token, account, allowance]);

  const minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10_000n;

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    setError(null);
    setPendingLabel(label);
    try {
      const hash = await fn();
      setTxHash(hash);
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetchAllowance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.split("\n")[0]?.slice(0, 200) ?? "Transaction failed");
    } finally {
      setPendingLabel(null);
    }
  }

  const approve = () =>
    run("Approving…", async () =>
      writeContractAsync({
        abi: erc20Abi,
        address: launch.token,
        functionName: "approve",
        args: [ADDRESSES.swapRouter, unlimitedApproval ? maxUint256 : parsedAmount],
        ...(await feeOverrides(publicClient, "trade")),
      }),
    );

  const trade = () =>
    run(side === "buy" ? "Buying…" : "Selling…", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const bounded = minOut > 0n ? minOut : 0n;
      if (side === "buy") {
        return writeContractAsync({
          abi: PopSwapRouterAbi,
          address: ADDRESSES.swapRouter,
          functionName: "buyWithEth",
          args: [launch.token, bounded, deadline],
          value: parsedAmount,
          ...(await feeOverrides(publicClient, "trade")),
        });
      }
      return writeContractAsync({
        abi: PopSwapRouterAbi,
        address: ADDRESSES.swapRouter,
        functionName: "sellForEth",
        args: [launch.token, parsedAmount, bounded, deadline],
        ...(await feeOverrides(publicClient, "trade")),
      });
    });

  return (
    <div className="card p-4">
      {bonded && (
        <div className="mb-3 rounded-lg bg-up/10 px-3 py-2 text-[11px] leading-relaxed text-dim">
          Bonded: this token now trades against {quoteSymbol} in its locked pool. ETH buys route
          through {quoteSymbol} automatically, every one a {quoteSymbol} market buy.
        </div>
      )}
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-field bg-bg p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`rounded-[9px] py-2 text-[13.5px] font-bold capitalize transition-colors ${
              side === s
                ? s === "buy"
                  ? "bg-pop text-black"
                  : "bg-down text-black"
                : "text-dim hover:bg-ink/[0.05] hover:text-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="label">
        {side === "buy" ? "Spend (ETH)" : `Sell (${launch.symbol})`}
        {balance !== undefined && (
          <button className="float-right text-pop" onClick={() => setAmount(formatUnits(balance, 18))}>
            max {fmtAmount(balance, 18)}
          </button>
        )}
      </label>
      <input
        className="input"
        inputMode="decimal"
        placeholder="0.0"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
      />

      <div className="mt-3 space-y-1 text-xs text-dim">
        <div className="flex justify-between">
          <span>Expected</span>
          <span className="text-ink">
            {fmtAmount(expectedOut, 18)} {side === "buy" ? launch.symbol : "ETH"}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Min after slippage</span>
          <span>{fmtAmount(minOut > 0n ? minOut : 0n, 18)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Slippage</span>
          <span className="flex gap-1">
            {[50, 100, 300].map((bps) => (
              <button
                key={bps}
                onClick={() => setSlippageBps(bps)}
                className={`rounded px-1.5 py-0.5 ${slippageBps === bps ? "bg-pop text-black" : "bg-hover"}`}
              >
                {bps / 100}%
              </button>
            ))}
          </span>
        </div>
      </div>

      {needsApproval ? (
        <>
          <button className="btn-pop mt-4 w-full" disabled={!!pendingLabel || !account} onClick={approve}>
            {pendingLabel ?? `Approve ${launch.symbol}`}
          </button>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-dim">
            <input
              type="checkbox"
              checked={unlimitedApproval}
              onChange={(e) => setUnlimitedApproval(e.target.checked)}
            />
            Unlimited approval (default is exact amount)
          </label>
        </>
      ) : (
        <button
          className={`btn mt-4 w-full font-bold ${side === "buy" ? "bg-up text-black" : "bg-down text-black"}`}
          disabled={!!pendingLabel || !account || parsedAmount === 0n}
          onClick={trade}
        >
          {pendingLabel ?? (account ? `${side === "buy" ? "Buy" : "Sell"} ${launch.symbol}` : "Connect wallet")}
        </button>
      )}

      {error && <div className="mt-2 break-words rounded-lg bg-down/10 p-2 text-xs text-down">{error}</div>}
      {txHash && receipt.data?.status === "success" && (
        <a
          href={explorerTx(txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-center text-xs text-up hover:underline"
        >
          Confirmed ↗
        </a>
      )}
    </div>
  );
}

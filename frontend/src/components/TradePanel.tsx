"use client";

import { useMemo, useState } from "react";
import { formatUnits, maxUint256, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { PopBondingCurveAbi } from "@/abis/PopBondingCurve";
import { PopLaunchTokenAbi } from "@/abis/PopLaunchToken";
import { explorerTx } from "@/lib/addresses";
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
 * Buy/sell panel against the bonding curve. Approvals are exact-amount by
 * default; "unlimited" is an explicit opt-in, never the default. Every
 * trade carries a deadline and a minOut derived from the on-chain quote and
 * the user's slippage setting.
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

  const quoteDecimals = quoteInfo?.decimals ?? 18;
  const quoteSymbol = quoteInfo?.symbol ?? "QUOTE";
  const graduated = launch.phase !== 0;

  const inToken = side === "buy" ? launch.quoteToken : launch.token;
  const inDecimals = side === "buy" ? quoteDecimals : 18;
  const parsedAmount = useMemo(() => {
    try {
      return amount ? parseUnits(amount, inDecimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amount, inDecimals]);

  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: inToken,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 5_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: inToken,
    functionName: "allowance",
    args: account ? [account, launch.curve] : undefined,
    query: { enabled: !!account, refetchInterval: 5_000 },
  });

  // Live on-chain quote for the expected output.
  const { data: reserves } = useReadContract({
    abi: PopBondingCurveAbi,
    address: launch.curve,
    functionName: "getReserves",
    query: { refetchInterval: 4_000, enabled: !graduated },
  });
  const { data: sellable } = useReadContract({
    abi: PopBondingCurveAbi,
    address: launch.curve,
    functionName: "sellableTokens",
    query: { refetchInterval: 4_000, enabled: !graduated },
  });
  const expectedOut = useMemo(() => {
    if (!reserves || parsedAmount === 0n) return 0n;
    const [quoteReserve, tokenReserve] = reserves;
    const feeBps = 100n + BigInt(launch.creatorFeeBps); // base fee + creator fee on the quote leg
    if (side === "buy") {
      const net = parsedAmount - (parsedAmount * feeBps) / 10_000n;
      return (net * tokenReserve) / (quoteReserve + net);
    }
    const gross = (parsedAmount * quoteReserve) / (tokenReserve + parsedAmount);
    return gross - (gross * feeBps) / 10_000n;
  }, [reserves, parsedAmount, side, launch.creatorFeeBps]);

  const minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10_000n;
  const needsApproval = allowance !== undefined && parsedAmount > 0n && allowance < parsedAmount;

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
    run("Approving…", () =>
      writeContractAsync({
        abi: erc20Abi,
        address: inToken,
        functionName: "approve",
        args: [launch.curve, unlimitedApproval ? maxUint256 : parsedAmount],
      }),
    );

  const trade = () =>
    run(side === "buy" ? "Buying…" : "Selling…", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      // A buy that completes the curve triggers graduation inside the same
      // transaction, wrapped in try/catch. Wallet gas estimates do not cover
      // that branch, so give crossing buys generous headroom to keep the
      // atomic graduation from being gas-starved (it stays permissionlessly
      // retryable either way).
      let gas: bigint | undefined;
      if (side === "buy" && sellable !== undefined && sellable > 0n && expectedOut >= (sellable * 95n) / 100n) {
        gas = 2_500_000n;
      }
      return writeContractAsync({
        abi: PopBondingCurveAbi,
        address: launch.curve,
        functionName: side,
        args: [parsedAmount, minOut < 0n ? 0n : minOut, account!, deadline],
        gas,
      });
    });

  if (graduated) {
    return (
      <div className="card p-4 text-sm text-dim">
        This token has graduated. Trade it on the Uniswap V4 pool. The curve is closed forever and its
        liquidity is locked.
      </div>
    );
  }

  return (
    <div className="card p-4">
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
        {side === "buy" ? `Spend (${quoteSymbol})` : `Sell (${launch.symbol})`}
        {balance !== undefined && (
          <button
            className="float-right text-pop"
            onClick={() => setAmount(formatUnits(balance, inDecimals))}
          >
            max {fmtAmount(balance, inDecimals)}
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
            {fmtAmount(expectedOut, side === "buy" ? 18 : quoteDecimals)}{" "}
            {side === "buy" ? launch.symbol : quoteSymbol}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Min after slippage</span>
          <span>{fmtAmount(minOut > 0n ? minOut : 0n, side === "buy" ? 18 : quoteDecimals)}</span>
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
            {pendingLabel ?? `Approve ${side === "buy" ? quoteSymbol : launch.symbol}`}
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

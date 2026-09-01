"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { decodeEventLog, keccak256, parseUnits, toHex, zeroAddress } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";

import { PopLaunchFactoryAbi } from "@/abis/PopLaunchFactory";
import { FeeFlowDiagram } from "@/components/FeeFlowDiagram";
import { ImageDrop } from "@/components/ImageDrop";
import { ADDRESSES } from "@/lib/addresses";
import { feeOverrides } from "@/lib/fees";
import { fmtAmount } from "@/lib/format";
import { indexer } from "@/lib/indexer";
import { FactoryRefsAbi, LaunchDeployerAbi } from "@/abis/vanityFragments";
import {
  VANITY_SUFFIX,
  mineVanitySalt,
  randomSeed,
  type LaunchInputs,
} from "@/lib/vanity";

export default function CreatePage() {
  const router = useRouter();
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const quotesQ = useQuery({ queryKey: ["quotes"], queryFn: indexer.quotes });
  const quotes = (quotesQ.data ?? []).filter((q) => !q.paused);

  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    logo: "",
    twitter: "",
    telegram: "",
    website: "",
    quote: "",
    creatorFeeBps: 0,
    cashbackMode: 2,
    cashbackShareBps: 5000,
    devBuy: "",
  });
  const set = (k: keyof typeof form) => (v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const quote = quotes.find((q) => q.address === form.quote) ?? quotes[0];
  const quoteAddress = (quote?.address ?? zeroAddress) as `0x${string}`;

  const { data: launchFee } = useReadContract({
    abi: PopLaunchFactoryAbi,
    address: ADDRESSES.launchFactory,
    functionName: "launchFee",
  });
  // Pin the exact economics being quoted so an owner retune or registry
  // re-peg landing before our tx reverts it instead of repricing it.
  const { data: economicsPin } = useReadContract({
    abi: PopLaunchFactoryAbi,
    address: ADDRESSES.launchFactory,
    functionName: "previewLaunchEconomics",
    args: [0n, quoteAddress],
    query: { enabled: !!quote, refetchInterval: 15_000 },
  });

  // Dev buys are plain ETH now: they ride the launch transaction's value.
  const devBuyAmount = useMemo(() => {
    try {
      return form.devBuy ? parseUnits(form.devBuy, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [form.devBuy]);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      name: form.name,
      symbol: form.symbol,
      logo: form.logo,
      description: form.description,
      socials: {
        twitter: form.twitter,
        telegram: form.telegram,
        discord: "",
        website: form.website,
        farcaster: "",
      },
      creatorFeeRecipient: zeroAddress,
      creatorFeeBps: form.creatorFeeBps,
      cashback: {
        mode: form.cashbackMode,
        shareBps: form.cashbackMode === 0 ? 0 : form.cashbackShareBps,
      },
      expectedEconomics: (economicsPin ?? toHex(0n, { size: 32 })) as `0x${string}`,
      salt: keccak256(toHex(`${form.symbol}-${Date.now()}`)),
    }),
    [form, economicsPin],
  );

  /**
   * Grinds a salt so the token lands at an address ending 0x909, then has
   * the deployer contract confirm the prediction before it is trusted.
   * Every failure path falls back to a random salt: the launch never blocks
   * on the vanity address, it just loses the suffix.
   */
  async function mineFor909(): Promise<{ seed: `0x${string}`; token: string } | null> {
    if (!account || !publicClient || !quote) return null;
    const factoryRead = { address: ADDRESSES.launchFactory, abi: FactoryRefsAbi } as const;
    const [config, launchDeployer, hookAddr, locker, poolManager] = await Promise.all([
      publicClient.readContract({ ...factoryRead, functionName: "getLaunchConfig", args: [0n] }),
      publicClient.readContract({ ...factoryRead, functionName: "launchDeployer" }),
      publicClient.readContract({ ...factoryRead, functionName: "hook" }),
      publicClient.readContract({ ...factoryRead, functionName: "locker" }),
      publicClient.readContract({ ...factoryRead, functionName: "poolManager" }),
    ]);
    const rewardTokenDeployer = await publicClient.readContract({
      address: launchDeployer,
      abi: LaunchDeployerAbi,
      functionName: "rewardTokenDeployer",
    });

    const inputs: LaunchInputs = {
      name: form.name,
      symbol: form.symbol,
      logo: form.logo,
      description: form.description,
      socials: {
        twitter: form.twitter,
        telegram: form.telegram,
        discord: "",
        website: form.website,
        farcaster: "",
      },
      originalDeployer: account,
      cashback: {
        mode: form.cashbackMode,
        shareBps: form.cashbackMode === 0 ? 0 : form.cashbackShareBps,
      },
      quoteToken: quoteAddress,
      supply: config.supply,
      launchDeployer,
      rewardTokenDeployer,
      factory: ADDRESSES.launchFactory,
      hook: hookAddr,
      locker,
      poolManager,
    };

    const mined = await mineVanitySalt(inputs, {
      onProgress: (n) => setStatus(`Mining your …${VANITY_SUFFIX} address (${n.toLocaleString()} tried)…`),
    });
    if (!mined) return null;

    // The deployer contract is the authority; a mismatch means our local
    // math drifted from the chain, so the mined salt is discarded.
    const confirmedToken = await publicClient.readContract({
      address: launchDeployer,
      abi: LaunchDeployerAbi,
      functionName: "predictLaunchAddress",
      args: [
        {
          quoteToken: inputs.quoteToken,
          originalDeployer: inputs.originalDeployer,
          cashback: { mode: inputs.cashback.mode, shareBps: inputs.cashback.shareBps },
          supply: inputs.supply,
          salt: mined.seed,
          name: inputs.name,
          symbol: inputs.symbol,
          logo: inputs.logo,
          description: inputs.description,
          socials: inputs.socials,
        },
      ],
    });
    if (confirmedToken.toLowerCase() !== mined.token.toLowerCase()) return null;
    return { seed: mined.seed, token: confirmedToken };
  }

  async function launch() {
    if (!account || !publicClient || !quote) return;
    setError(null);
    try {
      setStatus(`Mining your …${VANITY_SUFFIX} address…`);
      let salt: `0x${string}` = randomSeed();
      try {
        const mined = await mineFor909();
        if (mined) salt = mined.seed;
      } catch {
        /* vanity is cosmetic; the launch proceeds on a random salt */
      }
      setStatus("Simulating launch…");
      // The dev buy is plain ETH riding the launch transaction's value on
      // top of the launch fee. No token approvals anywhere.
      const { request } = await publicClient.simulateContract({
        abi: PopLaunchFactoryAbi,
        address: ADDRESSES.launchFactory,
        functionName: "launchToken",
        args: [{ ...params, salt }, 0n, quoteAddress, 0n],
        value: (launchFee ?? 0n) + devBuyAmount,
        account,
        ...(await feeOverrides(publicClient, "launch")),
      });

      setStatus("Confirm in wallet…");
      const hash = await writeContractAsync(request);
      setStatus("Launching…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      let tokenAddress: string | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: PopLaunchFactoryAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === "TokenLaunched") {
            tokenAddress = (decoded.args as { token: string }).token;
            break;
          }
        } catch {
          /* other contracts' logs */
        }
      }
      setStatus("Launched! Redirecting…");
      router.push(tokenAddress ? `/token/${tokenAddress}` : "/");
    } catch (e) {
      setStatus(null);
      setError((e instanceof Error ? e.message : String(e)).split("\n").slice(0, 3).join(" ").slice(0, 300));
    }
  }

  const valid = form.name && form.symbol && quote && account;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Launch a token</h1>
      <p className="mt-1 text-sm text-dim">
        Your token trades in plain ETH from its first block, on a real Uniswap pool any wallet or bot
        can reach. When the curve fills, the whole raise market-buys your chosen Pons quote token and
        the pair moves to it, liquidity locked forever. Fee settings are immutable once launched.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input className="input" maxLength={64} value={form.name} onChange={(e) => set("name")(e.target.value)} />
        </div>
        <div>
          <label className="label">Ticker</label>
          <input
            className="input uppercase"
            maxLength={16}
            value={form.symbol}
            onChange={(e) => set("symbol")(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <textarea
            className="input min-h-20"
            maxLength={2048}
            value={form.description}
            onChange={(e) => set("description")(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Image</label>
          <ImageDrop value={form.logo} onChange={set("logo")} />
        </div>
        <div>
          <label className="label">Twitter / X</label>
          <input className="input" value={form.twitter} onChange={(e) => set("twitter")(e.target.value)} />
        </div>
        <div>
          <label className="label">Telegram</label>
          <input className="input" value={form.telegram} onChange={(e) => set("telegram")(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Website</label>
          <input className="input" value={form.website} onChange={(e) => set("website")(e.target.value)} />
        </div>
      </div>

      <h2 className="mt-8 text-lg font-bold">Quote token</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {quotes.map((q) => (
          <button
            key={q.address}
            onClick={() => set("quote")(q.address)}
            className={`card p-3.5 text-left transition-colors ${
              quote?.address === q.address ? "border-pop/60 bg-pop/[0.06]" : "hover:bg-hover"
            }`}
          >
            <div className="font-bold">${q.symbol}</div>
            <div className="mt-1 text-[11px] text-dim">
              {q.launchCount} launches · {fmtAmount(q.totalBurned, q.decimals)} burned
            </div>
            <div className="text-[11px] text-dim">curve in ETH · bonds into ${q.symbol}</div>
          </button>
        ))}
        {!quotes.length && (
          <div className="card p-3 text-xs text-dim sm:col-span-3">
            No quotes listed yet (or the indexer is offline).
          </div>
        )}
      </div>

      <h2 className="mt-8 text-lg font-bold">Fees & cashback</h2>
      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="label">
              Your creator fee: {(form.creatorFeeBps / 100).toFixed(2)}% (max 2%)
            </label>
            <input
              type="range"
              min={0}
              max={200}
              step={25}
              value={form.creatorFeeBps}
              onChange={(e) => set("creatorFeeBps")(Number(e.target.value))}
              className="w-full accent-pop"
            />
          </div>
          <div>
            <label className="label">Cashback mode</label>
            <div className="grid grid-cols-3 gap-1 rounded-field border border-edge bg-input p-1 text-[12.5px]">
              {[
                { label: "None", mode: 0 },
                { label: "Quote burn", mode: 2 },
                { label: "Holder rewards", mode: 3 },
              ].map(({ label, mode }) => (
                <button
                  key={label}
                  onClick={() => set("cashbackMode")(mode)}
                  className={`truncate rounded-[9px] px-2 py-2 font-semibold transition-colors ${
                    form.cashbackMode === mode
                      ? "bg-pop text-black"
                      : "text-dim hover:bg-ink/[0.05] hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {form.cashbackMode !== 0 && (
            <div>
              <label className="label">
                Share of your take routed to{" "}
                {form.cashbackMode === 3 ? "your holders" : "the burn"}:{" "}
                {form.cashbackShareBps / 100}%
              </label>
              <input
                type="range"
                min={500}
                max={10000}
                step={500}
                value={form.cashbackShareBps}
                onChange={(e) => set("cashbackShareBps")(Number(e.target.value))}
                className="w-full accent-pop"
              />
              {form.cashbackShareBps === 10000 && (
                <p className="mt-2 rounded-[10px] border border-burn/30 bg-burn/[0.06] px-3 py-2 text-[12px] leading-relaxed text-burn">
                  At 100%, your entire share of the base fee goes to{" "}
                  {form.cashbackMode === 3 ? "your holders" : "the burn"}
                  {form.creatorFeeBps === 0
                    ? ", and with a 0% creator fee you earn nothing from this token, ever. These settings cannot be changed after launch."
                    : `, so your only income is the ${(form.creatorFeeBps / 100).toFixed(2)}% creator fee. This cannot be changed after launch.`}
                </p>
              )}
            </div>
          )}
          <div>
            <label className="label">Dev buy (ETH, optional, snipe-tax exempt)</label>
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.0"
              value={form.devBuy}
              onChange={(e) => set("devBuy")(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </div>
        </div>
        <FeeFlowDiagram
          creatorFeeBps={form.creatorFeeBps}
          cashbackMode={form.cashbackMode}
          cashbackShareBps={form.cashbackShareBps}
        />
      </div>

      <div className="card mt-6 p-4 text-xs text-dim">
        <div className="flex justify-between">
          <span>Launch fee</span>
          <span className="text-ink">{launchFee !== undefined ? `${Number(launchFee) / 1e18} ETH` : "…"}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>Economics pin</span>
          <span className="font-mono">{economicsPin ? `${economicsPin.slice(0, 10)}…` : "…"}</span>
        </div>
        <p className="mt-2 leading-relaxed">
          The launch is simulated before you sign, and the exact curve economics you see are pinned into
          the transaction. If anything changes underneath you it reverts, instead of launching on
          different terms.
        </p>
      </div>

      <button className="btn-pop mt-4 w-full py-3 text-base" disabled={!valid || !!status} onClick={launch}>
        {status ?? (account ? `Launch $${form.symbol || "…"}` : "Connect wallet to launch")}
      </button>
      {error && <div className="mt-2 break-words rounded-lg bg-down/10 p-3 text-xs text-down">{error}</div>}
    </div>
  );
}

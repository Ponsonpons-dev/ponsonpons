import Image from "next/image";
import Link from "next/link";

import { fmtUsd } from "@/lib/usd";

import { ArrowRight, Check, Droplet, Flame, Lock } from "./icons";

const STEPS = [
  {
    n: "01",
    title: "Launch on a real pool",
    body: "One transaction creates your token and a live Uniswap V4 pool quoted in ETH. The bonding curve is that pool, so any wallet or bot that can swap Uniswap can trade it from its first block, with nothing launchpad-specific to integrate.",
  },
  {
    n: "02",
    title: "Pick a community",
    body: "Choose which graduated Pons token your raise buys when the curve fills. Buyers spend plain ETH; the quote you pick is what your launch bonds into, what your pool pairs with, and what your fees arrive in after.",
  },
  {
    n: "03",
    title: "Bond into locked liquidity",
    body: "At 4.2 ETH the curve closes and the entire raise market-buys your quote token in one public swap. A new pool seeds at the curve's final price, and the position is minted straight into a contract with no way out.",
  },
];

const MODES = [
  {
    icon: Flame,
    tone: "text-burn",
    ring: "group-hover:border-burn/30",
    name: "Quote burn",
    line: "Sends part of every fee to the dead address.",
    body: "Your volume permanently shrinks the supply of the token your launch bonds into. The community whose token your raise bought gets deflation in exchange.",
  },
  {
    icon: Droplet,
    tone: "text-pop",
    ring: "group-hover:border-pop/30",
    name: "Holder rewards",
    line: "Pays part of every fee to everyone holding your token.",
    body: "Pro-rata, continuously, before and after the bond. Nothing to stake, no snapshot to be present for, no operator who could stop paying.",
  },
  {
    icon: Check,
    tone: "text-ink",
    ring: "group-hover:border-edge",
    name: "None",
    line: "Keeps your whole take with you.",
    body: "Cashback is optional and zero is the default. Whatever you choose is disclosed on the token page before anyone trades, and can never be changed after.",
  },
];

const GUARANTEES = [
  {
    title: "Liquidity locked, not time-locked",
    body: "The locker contract has no withdraw function, no transfer, no arbitrary call. This is not a long delay. There is no exit in the code at all.",
  },
  {
    title: "Fee terms frozen at launch",
    body: "Nobody can change a live launch's fees, threshold or cashback afterwards. Not the creator, not the protocol, not the owner. The terms are snapshotted into the contract at creation.",
  },
  {
    title: "No admin over your revenue",
    body: "There is no override anywhere that can redirect a creator's fees. We removed the one the reference implementation ships with.",
  },
  {
    title: "Rules, not gatekeepers",
    body: "Quote tokens qualify by on-chain proof and a liquidity floor. Anyone can list one. Nobody, including us, can delist one.",
  },
];

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 sm:items-start">
      <div className="font-display text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[30px]">
        {value}
      </div>
      <div className="eyebrow">{label}</div>
    </div>
  );
}

export function Landing({
  quoteCount,
  launchCount,
  graduatedCount,
  totals,
  ponsUsd,
  ethUsd,
}: {
  quoteCount?: number;
  launchCount?: number;
  graduatedCount?: number;
  /** Protocol-wide sums, refreshed live; undefined until the first fetch. */
  totals?: {
    quoteBought: bigint;
    ethConverted: bigint;
    burned: bigint;
    holderRewards: bigint;
  };
  ponsUsd?: number | null;
  ethUsd?: number | null;
}) {
  const whole = (v?: bigint) => (v === undefined ? null : Number(v) / 1e18);
  const usdOr = (v?: bigint, rate?: number | null, unit = "PONS") => {
    const w = whole(v);
    if (w === null) return "…";
    return fmtUsd(w, rate ?? null) ?? `${w.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
  };
  return (
    <div className="space-y-20 sm:space-y-28">
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative pt-2 sm:pt-6">
        {/* A single light source behind the mark. No box, no hard edges. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-8%] -z-10 h-[480px] w-[min(1100px,100vw)] -translate-x-1/2 md:left-[26%] md:w-[900px]"
          style={{
            background:
              "radial-gradient(46% 46% at 50% 46%, rgb(20 216 44 / 0.20), transparent 70%)," +
              "radial-gradient(64% 60% at 46% 44%, rgb(122 148 104 / 0.16), transparent 72%)",
          }}
        />

        <div className="grid items-center gap-5 sm:gap-12 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="mx-auto w-[164px] sm:w-[240px] md:mx-0 md:w-full md:max-w-[340px]">
            <Image
              src="/logo-mark.png"
              alt="$POP"
              width={420}
              height={420}
              priority
              className="w-full drop-shadow-[0_18px_60px_rgb(20_216_44_/_0.30)]"
            />
          </div>

          <div className="text-center md:text-left">
            <div className="eyebrow">Pons on Pons</div>
            <h1 className="mt-4 font-display text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[46px] lg:text-[56px]">
              The launchpad where
              <br className="hidden sm:block" /> Pons coins are the{" "}
              <span className="text-pop [text-shadow:0_0_44px_rgb(20_216_44_/_0.5)]">liquidity</span>.
            </h1>
            <p className="mx-auto mt-5 max-w-[46ch] text-[14.5px] leading-relaxed text-dim md:mx-0">
              Launch a token on a plain ETH curve that is a real Uniswap pool from block one. When it
              fills, the entire raise market-buys a graduated Pons token and becomes locked liquidity
              paired with it.
            </p>

            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center md:justify-start">
              <Link href="/create" className="btn-pop px-6 py-3 text-[14px]">
                Launch a token
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="#explore" className="btn-ghost px-6 py-3 text-[14px]">
                See what&apos;s live
              </Link>
            </div>
          </div>
        </div>

        <hr className="rule mt-14 sm:mt-16" />
        <div className="grid grid-cols-3 gap-4 py-7">
          <Stat value={quoteCount ?? "…"} label="Quote tokens" />
          <Stat value={launchCount ?? "…"} label="Launches" />
          <Stat value={graduatedCount ?? "…"} label="Bonded" />
        </div>
        <hr className="rule" />
        {/* Live protocol totals: what graduations have actually bought and
            what the cashback modes have actually paid out or destroyed. */}
        <div className="grid grid-cols-2 gap-4 py-7 sm:grid-cols-4">
          <Stat value={usdOr(totals?.quoteBought, ponsUsd)} label="Pons bought" />
          <Stat value={usdOr(totals?.ethConverted, ethUsd, "ETH")} label="Raised into liquidity" />
          <Stat value={usdOr(totals?.burned, ponsUsd)} label="Burned forever" />
          <Stat value={usdOr(totals?.holderRewards, ponsUsd)} label="Paid to holders" />
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section>
        <div className="eyebrow">How it works</div>
        <h2 className="mt-3 max-w-[20ch] font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[32px]">
          Three steps, then it leaves your hands.
        </h2>

        <div className="mt-8 divide-y divide-edge border-y border-edge">
          {STEPS.map((s) => (
            <div key={s.n} className="grid gap-2 py-6 sm:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)] sm:gap-6">
              <div className="font-display text-[13px] font-semibold tabular-nums text-pop sm:pt-1">{s.n}</div>
              <div className="font-display text-[17px] font-medium tracking-[-0.02em] text-ink">{s.title}</div>
              <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-dim">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cashback modes ─────────────────────────────────────────────── */}
      <section>
        <div className="eyebrow">The difference</div>
        <h2 className="mt-3 max-w-[24ch] font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[32px]">
          Your volume can be worth something to the community your token bonds into.
        </h2>
        <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-dim">
          Every bond is a large public market buy of the quote token, and cashback keeps it going after:
          during the ETH phase the carve-out accrues in WETH and converts at the bond, and from then on
          it is already the quote token. Pick a mode at creation; it is permanent.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {MODES.map((m) => (
            <div key={m.name} className={`card group p-5 transition-colors ${m.ring}`}>
              <m.icon className={`h-5 w-5 ${m.tone}`} />
              <div className="mt-4 font-display text-[16px] font-medium tracking-[-0.02em] text-ink">
                {m.name}
              </div>
              <div className={`mt-1 text-[13px] ${m.tone}`}>{m.line}</div>
              <p className="mt-3 text-[13px] leading-relaxed text-dim">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Closing band ───────────────────────────────────────────────── */}
      {/*
        Composed rather than using banner.jpg directly: the artwork has the
        wordmark and tagline baked in, which would double up with the type
        here. This rebuilds its composition (mark on the left, haze behind,
        reflective floor) so it also reflows instead of cropping on mobile.
      */}
      <section className="relative overflow-hidden rounded-[24px] border border-edge">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(46% 78% at 20% 42%, rgb(122 148 104 / 0.34), transparent 70%)," +
              "radial-gradient(30% 55% at 22% 50%, rgb(20 216 44 / 0.16), transparent 72%)," +
              "linear-gradient(100deg, rgb(24 44 30) 0%, rgb(12 24 16) 46%, rgb(7 14 9) 100%)",
          }}
        />
        {/* The floor line from the banner. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgb(20 216 44 / 0.35) 22%, rgb(190 225 190 / 0.16) 50%, transparent)",
          }}
        />

        <div className="relative grid items-center gap-6 px-6 py-9 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-10 sm:px-10 sm:py-12">
          <Image
            src="/logo-mark.png"
            alt=""
            width={200}
            height={200}
            className="mx-auto w-[104px] drop-shadow-[0_10px_36px_rgb(20_216_44_/_0.35)] sm:mx-0 sm:w-[132px]"
          />
          <div className="text-center sm:text-left">
            <div className="eyebrow">Ready when you are</div>
            <h2 className="mt-3 font-display text-[24px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[30px]">
              Pick a community. Give it a reason to care.
            </h2>
            <p className="mx-auto mt-3 max-w-[52ch] text-[13.5px] leading-relaxed text-dim sm:mx-0">
              A flat launch fee in ETH, a 1% base fee on trades, and terms that are yours to set once and
              nobody&apos;s to change after.
            </p>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-start">
              <Link href="/create" className="btn-pop px-6 py-3 text-[14px]">
                Launch a token
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/docs" className="btn-ghost px-6 py-3 text-[14px]">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust ──────────────────────────────────────────────────────── */}
      <section className="panel overflow-hidden p-6 sm:p-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Trust</div>
            <h2 className="mt-3 max-w-[22ch] font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[32px]">
              Built so you don&apos;t have to trust us.
            </h2>
          </div>
          <Link href="/docs/proof" className="btn-ghost">
            <Lock className="h-3.5 w-3.5" />
            See the proof
          </Link>
        </div>

        <div className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2">
          {GUARANTEES.map((g) => (
            <div key={g.title} className="flex gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-pop" />
              <div>
                <div className="text-[14px] font-medium tracking-[-0.01em] text-ink">{g.title}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{g.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

"use client";

import { Check } from "@/components/icons";
import { AddressLink } from "@/components/ui";
import { ADDRESSES } from "@/lib/addresses";

const CONTRACTS: Array<{ name: string; address: `0x${string}`; note: string }> = [
  { name: "PopLaunchFactory", address: ADDRESSES.launchFactory, note: "launch + graduation orchestration" },
  { name: "PopQuoteRegistry", address: ADDRESSES.quoteRegistry, note: "permissionless quote allowlist" },
  { name: "PopHook", address: ADDRESSES.hook, note: "V4 fee hook; policy immutable in bytecode" },
  { name: "PopLocker", address: ADDRESSES.locker, note: "holds every LP NFT forever; no withdraw function" },
  { name: "PopFeeEscrow", address: ADDRESSES.feeEscrow, note: "pull-payment revenue ledger; no owner" },
  { name: "Timelock (48h)", address: ADDRESSES.timelock, note: "owner of factory/hook/registry/locker" },
  { name: "Protocol multisig", address: ADDRESSES.multisig, note: "proposer + executor on the timelock" },
  { name: "Uniswap V4 PoolManager (canonical)", address: ADDRESSES.poolManager, note: "not ours, Uniswap's" },
  { name: "Uniswap V4 PositionManager (canonical)", address: ADDRESSES.positionManager, note: "not ours, Uniswap's" },
];

const CLAIMS: Array<{ claim: string; how: string }> = [
  {
    claim: "Nobody can touch locked liquidity. Not us, not the timelock, not anyone.",
    how: "PopLocker has no withdraw, transfer, or arbitrary-call function. Read the verified source. Every graduated position NFT is minted directly to it.",
  },
  {
    claim: "Nobody can redirect a creator's fees.",
    how: "There is no admin override of a launch's creator fee recipient anywhere in the code. Only the current recipient can transfer it. Lost keys mean lost future fees. That is the price of this guarantee, and we say it out loud.",
  },
  {
    claim: "Fee terms can never change on a live launch.",
    how: "Every launch snapshots its economics at creation; the hook's fee policy is a constructor immutable. The registry's re-pegs and the timelock's config changes apply to future launches only.",
  },
  {
    claim: "The quote allowlist is rules, not opinions.",
    how: "Anyone can list any graduated Pons token whose permanently locked ETH liquidity clears the floor, proven on-chain against the verified Pons factories. There is no delist function; a quote that loses its backing simply stops hosting new launches, automatically.",
  },
  {
    claim: "Launch tokens are inert.",
    how: "Plain fixed-supply ERC-20: no owner, no mint, no blacklist, no pause, no transfer hooks. Anti-snipe protection is a decaying tax on the curve, not token-level control.",
  },
  {
    claim: "Graduation cannot be front-run, griefed, or captured.",
    how: "The crossing buy itself triggers graduation; both phases are permissionless and retryable; the pool seeds at the curve's terminal price with no swap and no oracle; donations to the curve are ignored by construction.",
  },
  {
    claim: "The only owner powers are config-for-future-launches and constrained rescues.",
    how: "Everything is owned by a 48h timelock. The two rescue paths (for quote tokens that turn hostile after listing) pay only fixed recipients, the launch's own creator and the protocol treasury. The reserve rescue unlocks only after 14 days during which anyone can still complete the graduation permissionlessly.",
  },
  {
    claim: "No proxies. No upgrades. Anywhere.",
    how: "Every contract is immutable once deployed. A v2 is a new deployment; v1 launches run forever on v1.",
  },
];

export default function ProofPage() {
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow">Reference</div>
        <h1 className="mt-3 font-display text-[30px] font-semibold tracking-[-0.03em] text-ink">
          Proof, not <span className="text-pop">promises</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-dim">
          Every claim below is verifiable in the contracts themselves; sources are verified on Sourcify
          and the explorer. This page exists because the launchpad we forked our mechanics from keeps
          admin powers we refuse to hold. Ours are listed exhaustively; what is not listed does not
          exist.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">The claims</h2>
        <div className="space-y-3">
          {CLAIMS.map((c) => (
            <div key={c.claim} className="card p-4">
              <div className="flex items-start gap-2 text-sm font-medium text-ink">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-pop" />
                {c.claim}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-dim">{c.how}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Every contract</h2>
        <div className="card divide-y divide-edge">
          {CONTRACTS.map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-sm font-semibold">{c.name}</div>
                <div className="text-[11px] text-dim">{c.note}</div>
              </div>
              <AddressLink address={c.address} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-dim">
          Per-launch curve and token addresses are on each token page's trust panel, all deployed by the
          factory via CREATE2 and verified from the same source tree.
        </p>
      </section>

      <section className="card p-4 text-xs leading-relaxed text-dim">
        <div className="mb-1 text-sm font-bold text-ink">Audit status</div>
        External audit pending. This section links the report when it lands. Until then: the bonding
        curve, graduation, and hook mechanics are adapted from the verified, battle-tested PonsV2
        sources (86,000+ launches on Robinhood Chain), with the trust model rebuilt as described above.
        The full diff against the reference is documented in the repository.
      </section>
    </div>
  );
}

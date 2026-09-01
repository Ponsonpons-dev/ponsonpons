"use client";

import { Check } from "@/components/icons";
import { AddressLink } from "@/components/ui";
import { ADDRESSES, GOVERNANCE } from "@/lib/addresses";

const CONTRACTS: Array<{ name: string; address: `0x${string}`; note: string }> = [
  {
    name: "PopLaunchFactory",
    address: ADDRESSES.launchFactory,
    note: "launches, holds each curve position until its bond, executes bonds",
  },
  { name: "PopQuoteRegistry", address: ADDRESSES.quoteRegistry, note: "permissionless quote allowlist" },
  { name: "PopHook", address: ADDRESSES.hook, note: "V4 fee hook + snipe tax; policy immutable in bytecode" },
  { name: "PopLocker", address: ADDRESSES.locker, note: "holds every bonded LP NFT forever; no withdraw function" },
  { name: "PopFeeEscrow", address: ADDRESSES.feeEscrow, note: "pull-payment revenue ledger; no owner" },
  {
    name: "PopSwapRouter",
    address: ADDRESSES.swapRouter,
    note: "stateless ETH-in/ETH-out convenience router; holds nothing between calls",
  },
  {
    name: "PopRevenueSplitter",
    address: ADDRESSES.revenueSplitter,
    note: "protocol fee recipient; holder share currently 0% (see the claim below)",
  },
  {
    name: "PopBuybackBurner",
    address: ADDRESSES.buybackBurner,
    note: "$POP creator-fee recipient; 25% buys and burns $POP (ratio immutable)",
  },
  ...(GOVERNANCE === "timelock"
    ? ([
        { name: "Timelock (48h)", address: ADDRESSES.timelock, note: "owner of factory/hook/registry/locker" },
        {
          name: "Protocol owner",
          address: ADDRESSES.protocolOwner,
          note: "proposer + executor on the timelock; receives protocol fees",
        },
      ] as const)
    : ([
        {
          name: "Protocol owner",
          address: ADDRESSES.protocolOwner,
          note: "owns factory/hook/registry/locker directly; receives protocol fees",
        },
      ] as const)),
  { name: "Uniswap V4 PoolManager (canonical)", address: ADDRESSES.poolManager, note: "not ours, Uniswap's" },
  { name: "Uniswap V4 PositionManager (canonical)", address: ADDRESSES.positionManager, note: "not ours, Uniswap's" },
];

const CLAIMS: Array<{ claim: string; how: string }> = [
  {
    claim: "Nobody can touch locked liquidity. Not us, not the owner, not anyone.",
    how: "PopLocker has no withdraw, transfer, or arbitrary-call function. Read the verified source. Every bonded position NFT is minted directly to it.",
  },
  {
    claim: "Nobody can redirect a creator's fees.",
    how: "There is no admin override of a launch's creator fee recipient anywhere in the code. Only the current recipient can transfer it. Lost keys mean lost future fees. That is the price of this guarantee, and we say it out loud.",
  },
  {
    claim: "Fee terms can never change on a live launch.",
    how: "Every launch snapshots its economics at creation; the hook's fee policy is a constructor immutable. The owner's config changes apply to future launches only, never to a launch already live.",
  },
  {
    claim: "Pre-bond, the curve's funds have exactly two exits, and neither is a person's wallet.",
    how: "The factory holds each launch's curve position. Its only paths are bond(), which converts the whole raise into the quote and seeds the locked pool, and a rescue that opens only after a launch has been bond-ready and stuck for 14 days, paying only the launch's own creator fee recipient. During that whole window anyone can still bond it permissionlessly. There is no withdraw-to-anyone function; read the verified source.",
  },
  {
    claim: "The quote allowlist is rules, not opinions.",
    how: "Anyone can list any graduated Pons token whose permanently locked ETH liquidity clears the floor, proven on-chain against the verified Pons factories. There is no delist function; a quote that loses its backing simply stops hosting new launches, automatically.",
  },
  {
    claim: "Launch tokens are inert.",
    how: "Plain fixed-supply ERC-20: no owner, no mint, no blacklist, no pause, no transfer hooks. Anti-snipe protection is a decaying launch-window tax enforced by the hook, not token-level control.",
  },
  {
    claim: "Bonding cannot be front-run, griefed, or captured.",
    how: "Bond-readiness is a price fact recorded by the hook; the bond itself is permissionless, atomic, and retryable. The raise's conversion into the quote is bounded by the quote's own 30-minute TWAP, so a manipulated pool delays a bond rather than repricing it, and the new pool seeds at the curve's terminal price. Every bond is a public market buy of the quote token with the entire raise, visible on-chain.",
  },
  {
    claim: "The only owner powers are config-for-future-launches and constrained rescues.",
    how:
      (GOVERNANCE === "timelock"
        ? "Everything is owned by a 48h timelock, so any change is visible on-chain for two days before it can take effect. "
        : "The four ownable contracts are owned directly by the protocol owner, a single key, and its changes take effect immediately with no delay. That is the weakest part of this deployment and we would rather say so than imply a timelock we did not deploy. ") +
      "What that owner can reach is narrow and worth reading literally: launch configs and the snipe-tax window for FUTURE launches, the $POP holder revenue share on the splitter, and constrained rescue paths for launches or fee balances that get stuck. Every rescue pays only fixed recipients, the launch's own creator recipient or the protocol's, so there is no address the owner can name. The bond rescue unlocks only after a launch has been bond-ready for 14 days, during which anyone can still bond it permissionlessly. It cannot touch locked liquidity, cannot redirect a creator's fees, and cannot change the terms of a launch that already exists.",
  },
  {
    claim: "$POP burns by code. The holder revenue share does not exist, and here is why.",
    how: "$POP's creator fees accrue to the buyback burner, whose 25% burn ratio is a constructor constant: that slice can only ever leave the contract as $POP sent to the dead address, and $POP's creator fee recipient has been transferred to that burner permanently. The other 75% goes to the protocol. Separately, this page previously claimed 15% of protocol revenue was paid to $POP holders. It is not, and it cannot be: the splitter pays holders by sending $PONS to the token contract and calling sync(), a function only the holder-rewards token variant has, and $POP was launched in quote-burn mode. Every distribution reverted until the share was set to 0%. The splitter's one-time pointer to the platform token is already spent on $POP, so restoring a holder share would require a new splitter, which we are not promising. Past distributions still cannot be clawed back; there simply were none.",
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
          Each token's own address is on its token page's trust panel, deployed by the factory via
          CREATE2 and verified from the same source tree; its pools live inside the canonical
          PoolManager.
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

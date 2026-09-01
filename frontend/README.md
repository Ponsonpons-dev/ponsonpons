# $POP frontend

Next.js 15 (App Router) + wagmi v2/viem + RainbowKit + Tailwind v4 +
lightweight-charts, dark theme by default, mobile-first.

## Pages

- `/`: quote-token cards (launches, graduations, **burned** totals),
  trending launches, recently graduated.
- `/create`: full launch flow: metadata, quote picker, creator fee slider,
  cashback mode with a **live fee-flow diagram**, optional snipe-exempt dev
  buy. The launch is simulated before signing and the quoted economics are
  **pinned into the transaction** (`expectedEconomics`), so a re-peg or
  config change landing first reverts instead of repricing.
- `/token/[address]`: OHLC chart (indexer candles), buy/sell panel with
  live on-chain quotes, slippage + deadline on every trade, curve progress,
  unified curve+pool trades feed, holders, creator panel (claim via escrow,
  transfer recipient), and the **Trust panel** with explorer proof.
- `/quote/[address]`: everything launched on one quote + burn/rebate totals.
- `/creator/[address]`: launches, per-quote earnings, claim buttons.
- `/proof`: the anti-rug pitch: every claim, every contract, every owner
  power, exhaustively, with explorer links. Linked prominently in the nav.

## Deploying

The Vercel project is linked to this repository with **root directory
`frontend`**; every push builds. Production tracks `main`, other branches get
preview URLs.

Set these in Project → Settings → Environment Variables. The site builds and
renders without them, addresses fall back to the zero address and data
sections show empty states, so a deploy is never blocked on them, but nothing
will be functional until they point at a real deployment:

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_INDEXER_URL` | Public URL of the Phase 2 Ponder app. Without it the site falls back to `localhost` and every list is empty. |
| `NEXT_PUBLIC_LAUNCH_FACTORY` … `NEXT_PUBLIC_PROTOCOL_OWNER` | From `contracts/deployments/4663.json` once the stack is actually deployed. |
| `NEXT_PUBLIC_REVENUE_SPLITTER` / `NEXT_PUBLIC_BUYBACK_BURNER` | Revenue periphery from the same deployments file; the proof page links them. |
| `NEXT_PUBLIC_SWAP_ROUTER` | PopSwapRouter from the deployments file. Every buy and sell on the site goes through it, ETH in, ETH out, both phases. |
| `NEXT_PUBLIC_GOVERNANCE` | `timelock` or `direct`, matching how the stack was deployed. Drives what `/docs/proof` claims. |
| `NEXT_PUBLIC_WALLETCONNECT_ID` | WalletConnect Cloud project id. Injected wallets work without it; WalletConnect does not. |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin, used for OG/Twitter card URLs. |
| `PINATA_JWT` | Server-side only, never `NEXT_PUBLIC`. Pinata API JWT used by `/api/upload` to pin launch images to IPFS. Without it the create page's image upload refuses with a clear message instead of pretending. |

Two things that only break on a *clean* install, both fixed here and worth
knowing if you touch dependencies: RainbowKit peers on wagmi v2 (v3 aborts
`npm install` with ERESOLVE), and `@coinbase/cdp-sdk` imports its optional
`@x402/*` peers unconditionally, which `next.config.mjs` stubs out.

## Design system

Sampled from the brand mark and banner, not invented: the logo's chrome rim is
`#10d827`, its fill is pearl `#f0f0f0`, and the banner's ground runs from a
hazy sage `#657a56` down to forest `#0a1a0e`. All tokens live in
`src/app/globals.css`.

| Token | Value | Used for |
| --- | --- | --- |
| `--ground-rgb` | `7 14 9` | page ground |
| `--surface-rgb` / `--raised-rgb` | `12 23 16` / `18 32 25` | cards, nested cards |
| `--input-rgb` | `10 20 14` | fields, inset controls |
| `--pearl-rgb` | `237 242 234` | display type, glass fill |
| `--sage-rgb` | `140 164 135` | body copy, labels |
| `--emerald-rgb` | `20 216 44` | value: prices, actions, live state |
| `--emerald-ink-rgb` | `3 22 8` | text *on* emerald |

Three rules hold the surface together, break them and it stops looking like
one system:

1. **Surfaces are glass.** A lit top rim (`inset 0 1px 0` pearl), a soft
   internal gradient, a dark base. Never a flat fill with a grey border. Use
   `.card` (16px) and `.panel` (24px) rather than rolling your own.
2. **Emerald means value.** Prices, primary actions, live/positive state. It is
   not a decorative accent, and nothing else on the page should glow.
3. **Depth is haze and rim light**, never drop shadows. The page ground itself
   carries a fixed radial haze (`body::before`).

Also:

- **`.eyebrow`**: wide-tracked caps, lifted from the banner's "PONS ON PONS"
  line. It is the one recurring typographic gesture; use it above every
  section heading.
- **Outfit** for display (`font-display`), **Inter** for UI and body.
- **No emoji in the UI.** They render differently on every platform and read as
  decoration rather than type. `src/components/icons.tsx` holds a uniform
  16px / 1.5-stroke `currentColor` set; add to it rather than reaching for a
  glyph.
- Text hierarchy is `text-ink` → `text-dim` → `text-dim/70`, not extra greys.

## Wallet-safety posture

- **Exact-amount approvals by default everywhere.** Unlimited approval is a
  visible opt-in checkbox on the trade panel and never used in the create
  flow.
- Every state-changing call is simulated first; failures surface as readable
  errors, not silent reverts.
- All amounts are computed from on-chain reads at click time, not cached
  indexer state.

## Run

```bash
cp .env.example .env.local   # addresses + indexer URL + WalletConnect id
npm install
npm run dev
```

Deploys anywhere Next 15 runs (Vercel intended). Data comes from the Phase 2
indexer (`NEXT_PUBLIC_INDEXER_URL`), live updates via 4-5s polling,
upgrade path to `@ponder/client` SSE live queries is wired in the indexer
already.

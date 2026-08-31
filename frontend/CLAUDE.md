# $POP frontend, working rules

Next.js 15 App Router · TypeScript · wagmi v2 + viem · RainbowKit · Tailwind v4
· lightweight-charts. Read `README.md` for what each page does.

## Before writing UI

Commit to the aesthetic below before writing code. This is a memecoin launchpad
built on a glass-and-emerald brand, not a generic dashboard, if a change would
look at home in any SaaS admin panel, it is wrong for this site.

## Design tokens, never hardcode a colour

Everything lives in `src/app/globals.css`. Use the Tailwind tokens
(`bg-surface`, `text-dim`, `border-edge`, `text-pop`), never raw hex, and never
`text-white/50`: that was cleaned out once already.

| Token | Value | Used for |
| --- | --- | --- |
| `--ground-rgb` | `7 14 9` | page ground |
| `--surface-rgb` / `--raised-rgb` | `12 23 16` / `18 32 25` | cards, nested cards |
| `--input-rgb` | `10 20 14` | fields, inset controls |
| `--pearl-rgb` | `237 242 234` | display type, glass fill (`text-ink`) |
| `--sage-rgb` | `140 164 135` | body copy, labels (`text-dim`) |
| `--emerald-rgb` | `20 216 44` | value only (`text-pop`) |
| `--emerald-ink-rgb` | `3 22 8` | text *on* emerald |
| `--gold-rgb` / `--ember-rgb` | `217 164 65` / `255 107 107` | burn / down |

Sampled from the brand mark and banner. the logo's chrome rim is `#10d827`,
its fill is pearl `#f0f0f0`, the banner's ground runs sage `#657a56` → forest
`#0a1a0e`. Don't invent new ones; extend the file if something is genuinely
missing.

## Five rules that keep it coherent

1. **Surfaces are glass.** Lit top rim, soft internal gradient, dark base. Use
   `.card` (16px radius) and `.panel` (24px). Never a flat fill with a grey border.
2. **Emerald means value**: prices, primary actions, live/positive state. It is
   not decoration. Nothing else on a page should glow.
3. **Depth is haze and rim light**, never drop shadows.
4. **`.eyebrow` above every section heading**: wide-tracked caps, lifted from
   the banner's "PONS ON PONS" line. It's the one recurring typographic gesture.
5. **Hierarchy is `text-ink` → `text-dim` → `text-dim/70`.** Not extra greys.

Type: `font-display` (Outfit) for headings and numerals, Inter for everything
else. Headings carry negative tracking (`tracking-[-0.03em]`).

## Hard nevers

- **No emoji in the UI.** They render differently on every platform and read as
  decoration, not type. `src/components/icons.tsx` is the 16px / 1.5-stroke /
  `currentColor` set, extend it rather than reaching for a glyph.
- **No placeholder or lorem content**, and no invented numbers. Every figure on
  screen comes from the indexer or a contract read. There is no fixture data in
  `src/` and there must not be.
- **No unlimited token approvals by default.** Exact-amount always; "unlimited"
  is an explicit opt-in checkbox. This is a wallet-safety promise the site makes
  in writing.
- **No new wallet UI from a library.** `ConnectButtonSlot` renders RainbowKit's
  behaviour in our own chrome; keep it that way.

## Dependencies, two live traps

- **RainbowKit peers on wagmi v2.** Bumping wagmi to v3 aborts a clean
  `npm install` with ERESOLVE and makes the project undeployable. Local
  `node_modules` will not tell you; a fresh install will.
- **`@coinbase/cdp-sdk`** (transitive, via `@wagmi/connectors` →
  `@base-org/account`) imports its *optional* `@x402/*` peers unconditionally.
  `next.config.mjs` stubs them with `IgnorePlugin`. Don't remove that.

After touching dependencies, verify the way the platform does:
`npm install` into an empty dir from `package.json` + lockfile, then a build
from a clean `.next`.

## Before saying a UI change is done

1. `npm run build`: it typechecks and catches unresolved imports.
2. `npm test`: pure logic (filters, formatting) has real assertions; add to them.
3. **Look at it.** Serve the production build and screenshot at **390px and
   1280px**. Mobile is not an afterthought here: check that the primary action
   on a page is reachable without scrolling past three screens of stats, that
   nothing overflows horizontally, and that tap targets are ≥ 36px.
4. Check the five things that read as sloppy: spacing consistency, contrast,
   hover/focus states, empty **and** loading states, dead links.

## Deploying

Vercel project `ponsonpons`, root directory `frontend`, auto-deploys on push.
`README.md` lists the environment variables and what degrades without each.

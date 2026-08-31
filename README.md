# $POP · Pons on Pons

The launchpad where Pons coins are the liquidity.

A token launched here is priced in an existing **graduated Pons token** rather
than in ETH. Buyers spend that token, fees are collected in it, and when the
curve fills, the pool it graduates into is paired with it. Because every fee is
already denominated in the quote token, a creator can route part of their own
revenue straight back to that community with no swap, no oracle and no operator
holding funds: burn it, rebate it to traders, or pay it continuously to
everyone holding the new token.

Built on **Robinhood Chain** (Arbitrum Orbit, chain ID 4663), graduating into
**Uniswap V4** pools whose positions are minted directly into a locker with no
withdrawal function of any kind.

## Layout

| Directory | What it is |
| --- | --- |
| `contracts/` | Foundry project. Factory, bonding curve, launch tokens, V4 fee hook, locker, quote registry, fee escrow, graduation executor and guard. |
| `indexer/` | Ponder app. Launches, trades, OHLC candles, holders, burns, rewards, per-quote leaderboards. |
| `frontend/` | Next.js 15 app. Explore, Ponscope, create flow, token pages, docs and proof. |
| `ops/` | Keeper for permissionless `graduate()` and fee sweeps. |
| `docs/` | Architecture, audit scope and reviewer's guide, deployment runbook. |

Each directory has its own README. `frontend/CLAUDE.md` holds the design system
and the conventions the UI is built to.

## Design in one paragraph

The curve collects the same asset the graduated pool will be paired with, so
graduation needs no swap, no router, no oracle and no slippage parameter: the
curve simply hands its reserves over. A launch's fee terms are snapshotted at
creation and are immutable for its lifetime. Nothing is upgradeable, there are
no proxies, and there is no admin path that can redirect a creator's revenue or
touch locked liquidity. The full inventory of powers that *do* exist is
published on the site's proof page and in `docs/AUDIT.md`.

## Mainnet deployment (Robinhood Chain, chain id 4663)

Deployed 2026-08-31 at blocks 51,204,736 to 51,204,738; every contract is
Sourcify-verified (exact match) and browsable on Blockscout. The canonical
record is `contracts/deployments/4663.json`.

| Contract | Address |
| --- | --- |
| PopLaunchFactory | [`0xbAF9157f94799Bf2Eb02E5b1639a993cb0aA99C3`](https://robinhoodchain.blockscout.com/address/0xbAF9157f94799Bf2Eb02E5b1639a993cb0aA99C3) |
| PopHook | [`0x2Fa0028536e203678e554904eD394B0a9e032044`](https://robinhoodchain.blockscout.com/address/0x2Fa0028536e203678e554904eD394B0a9e032044) |
| PopLocker | [`0xe0037Af63DB9E59986aE2E7eFCA420E2888221CB`](https://robinhoodchain.blockscout.com/address/0xe0037Af63DB9E59986aE2E7eFCA420E2888221CB) |
| PopQuoteRegistry | [`0x9af8cdd6Fa4411a0945438f00B612419C842c3Ce`](https://robinhoodchain.blockscout.com/address/0x9af8cdd6Fa4411a0945438f00B612419C842c3Ce) |
| PopFeeEscrow | [`0x518cA30368D8388C3C36602Ae6d82701a43AF348`](https://robinhoodchain.blockscout.com/address/0x518cA30368D8388C3C36602Ae6d82701a43AF348) |
| PopRevenueSplitter | [`0x1472f17555733c6C7e9988CA2691E5b80875df34`](https://robinhoodchain.blockscout.com/address/0x1472f17555733c6C7e9988CA2691E5b80875df34) |
| PopBuybackBurner | [`0x006048ff745c69d45dfbB1b1635a1A20108b381E`](https://robinhoodchain.blockscout.com/address/0x006048ff745c69d45dfbB1b1635a1A20108b381E) |
| PonsV1QuoteAdapter | [`0xFB4322AaCF13E820B2A7A6E82b21876089c205Fc`](https://robinhoodchain.blockscout.com/address/0xFB4322AaCF13E820B2A7A6E82b21876089c205Fc) |
| PopGraduationExecutor | [`0xb48176a3059F5B3930D9f0c136F27584B2CfD786`](https://robinhoodchain.blockscout.com/address/0xb48176a3059F5B3930D9f0c136F27584B2CfD786) |
| PopGraduationGuard | [`0x8EfD6524ffE795F40D0B474dAE502c080501e57E`](https://robinhoodchain.blockscout.com/address/0x8EfD6524ffE795F40D0B474dAE502c080501e57E) |
| PopLaunchDeployer | [`0x6a0156a38A35FAe9548C13486a8Ed39279D050d0`](https://robinhoodchain.blockscout.com/address/0x6a0156a38A35FAe9548C13486a8Ed39279D050d0) |
| PopRewardTokenDeployer | [`0x06A21DE436d64fA47633d034DCBB1c557BD74bF5`](https://robinhoodchain.blockscout.com/address/0x06A21DE436d64fA47633d034DCBB1c557BD74bF5) |

Governance: direct, no timelock. Protocol owner
`0x16F4681314ddfE307c13584BEA336008419886C5` owns factory, hook, locker and
registry; protocol fees flow to the revenue splitter from genesis. $PONS is
listed as the first quote. Launching is currently disabled (whitelist only)
ahead of the public opening.

## Status

Contracts are complete and tested: 85 unit, invariant and adversarial tests,
plus a fork suite that replays real Robinhood Chain mainnet state from a
committed RPC cache, so it reproduces byte-identically with no archive
provider. **An external audit has not yet been done.** Treat the contracts as
unaudited until `docs/AUDIT.md` links a report.

Deployed to mainnet on 2026-08-31 (addresses above). `docs/DEPLOYMENT.md`
is the runbook that was executed; governance shipped as direct ownership,
and the site reads that from the deployment record rather than assuming.

## Quick start

```bash
# contracts
cd contracts && forge build && forge test

# indexer (needs Postgres and an RPC endpoint)
cd indexer && cp .env.example .env && npm install && npm run dev

# frontend
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

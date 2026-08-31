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

## Status

Contracts are complete and tested: 74 unit, invariant and adversarial tests,
plus a fork suite that replays real Robinhood Chain mainnet state from a
committed RPC cache, so it reproduces byte-identically with no archive
provider. **An external audit has not yet been done.** Treat the contracts as
unaudited until `docs/AUDIT.md` links a report.

Not yet deployed to mainnet. `docs/DEPLOYMENT.md` is the runbook. Governance
is chosen at deploy time: a 48h timelock (default) or direct ownership by a
single protocol owner. The site reads which one shipped and describes it
rather than assuming, so pick deliberately.

## Quick start

```bash
# contracts
cd contracts && forge build && forge test

# indexer (needs Postgres and an RPC endpoint)
cd indexer && cp .env.example .env && npm install && npm run dev

# frontend
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

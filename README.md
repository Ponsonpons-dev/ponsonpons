# $POP · Pons on Pons

The launchpad where Pons coins are the liquidity.

Every launch is a live **Uniswap V4 pool from its first block**, quoted in
WETH: the bonding curve is a single-sided liquidity position over the curve's
price range, so anyone, and any trading bot that can swap Uniswap V4, buys
with plain ETH and zero launchpad-specific integration. When the curve fills
(4.2 ETH raised), anyone may **bond** it: the entire raise market-buys the
creator's chosen **graduated Pons token** on its canonical pool, and the
launch re-seeds as a token/quote pool whose position mints directly into a
locker with no withdrawal function of any kind. Every bond is a public market
buy of the quote token, and a creator can route part of their own revenue
straight back to that community: burn it, or pay it continuously to everyone
holding the new token.

Built on **Robinhood Chain** (Arbitrum Orbit, chain ID 4663).

## Layout

| Directory | What it is |
| --- | --- |
| `contracts/` | Foundry project. Factory (launches, curve positions, bonds), launch tokens, V4 fee hook with snipe tax, swap router, locker, quote registry, fee escrow, revenue splitter, buyback burner. |
| `indexer/` | Ponder app. Launches, trades, OHLC candles, holders, burns, rewards, per-quote leaderboards. |
| `frontend/` | Next.js 15 app. Explore, Ponscope, create flow, token pages, docs and proof. |
| `ops/` | Keeper for permissionless `bond()` cranks and fee sweeps. |
| `docs/` | Architecture, audit scope and reviewer's guide, deployment runbook. |

Each directory has its own README. `frontend/CLAUDE.md` holds the design system
and the conventions the UI is built to.

## Design in one paragraph

The curve is not a custom contract, it is liquidity inside the canonical
PoolManager, so the launchpad's entire market surface is standard Uniswap V4.
The bond's one conversion, WETH into the quote, is bounded by the quote's own
30-minute TWAP and is permissionless and retryable. A launch's fee terms are
snapshotted at creation and are immutable for its lifetime. Nothing is upgradeable, there are
no proxies, and there is no admin path that can redirect a creator's revenue or
touch locked liquidity. The full inventory of powers that *do* exist is
published on the site's proof page and in `docs/AUDIT.md`.

## Mainnet deployment (Robinhood Chain, chain id 4663)

v2 deployed 2026-09-01 at blocks 51,319,197 to 51,319,199; every contract is
Sourcify-verified (exact match) and browsable on Blockscout. The canonical
record is `contracts/deployments/4663.json`. (The superseded v1 deployment,
2026-08-31 at 51,204,736+, is preserved in git history; it was never opened to
the public.)

| Contract | Address |
| --- | --- |
| PopLaunchFactory | [`0x461523A203fAea6520089A620b9321e5bd37b440`](https://robinhoodchain.blockscout.com/address/0x461523A203fAea6520089A620b9321e5bd37b440) |
| PopHook | [`0xf91f859e21dC93da086f38e0105ad96C05d22044`](https://robinhoodchain.blockscout.com/address/0xf91f859e21dC93da086f38e0105ad96C05d22044) |
| PopLocker | [`0x600e30D180feDdbce84959aA901fAA04293E5095`](https://robinhoodchain.blockscout.com/address/0x600e30D180feDdbce84959aA901fAA04293E5095) |
| PopQuoteRegistry | [`0xA2E250374beb184E501671bB83E6f18dCd4f966D`](https://robinhoodchain.blockscout.com/address/0xA2E250374beb184E501671bB83E6f18dCd4f966D) |
| PopFeeEscrow | [`0xA9197Df4295b19c5260da5E5d3336F4576DFD5ff`](https://robinhoodchain.blockscout.com/address/0xA9197Df4295b19c5260da5E5d3336F4576DFD5ff) |
| PopRevenueSplitter | [`0x90f4f16BA23121dA8B30f5BcdEd3a0eC433ec417`](https://robinhoodchain.blockscout.com/address/0x90f4f16BA23121dA8B30f5BcdEd3a0eC433ec417) |
| PopBuybackBurner | [`0xBFB11CAa7e5C7578Dd265261e8d17dAb291A9e81`](https://robinhoodchain.blockscout.com/address/0xBFB11CAa7e5C7578Dd265261e8d17dAb291A9e81) |
| PonsV1QuoteAdapter | [`0xd30E3184a65f99D82521b818988b03b38227A593`](https://robinhoodchain.blockscout.com/address/0xd30E3184a65f99D82521b818988b03b38227A593) |
| PopGraduationExecutor | [`0xbEd4ec31fa4213c8475508484D8dC5F73A46BbbB`](https://robinhoodchain.blockscout.com/address/0xbEd4ec31fa4213c8475508484D8dC5F73A46BbbB) |
| PopGraduationGuard | [`0xF0f08119bA5DEf927Ea4C02cb4c7df68595FCCcE`](https://robinhoodchain.blockscout.com/address/0xF0f08119bA5DEf927Ea4C02cb4c7df68595FCCcE) |
| PopLaunchDeployer | [`0x1CC8AAdaE43E33f8d9470e22E8b3133d2ca72200`](https://robinhoodchain.blockscout.com/address/0x1CC8AAdaE43E33f8d9470e22E8b3133d2ca72200) |
| PopRewardTokenDeployer | [`0xC0b9D6B70C55344C41DF422459FEBbB762d46d1D`](https://robinhoodchain.blockscout.com/address/0xC0b9D6B70C55344C41DF422459FEBbB762d46d1D) |
| PopSwapRouter | [`0x82470185056Dfb311D2CFFf50e8Aa3861ceB88d9`](https://robinhoodchain.blockscout.com/address/0x82470185056Dfb311D2CFFf50e8Aa3861ceB88d9) |

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

v2 deployed to mainnet on 2026-09-01 (addresses above). `docs/DEPLOYMENT.md`
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

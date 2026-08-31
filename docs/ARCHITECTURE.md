# Quote-Token Launchpad on Robinhood Chain, Architecture (Phase 0)

Status: **Phase 0 discovery output, awaiting AK review before any contract code is written.**
Date: 2026-08-31. All on-chain data read live from Robinhood Chain mainnet (block ~50,435,000).

---

## 1. Executive summary & key discoveries

The brief asked us to study "the Pons Factory contract `0x95f722469abb6b38d004bf7e02ee2a10c4246ab8`"
and build the same core mechanic, new tokens launching on a bonding curve quoted in a graduated
Pons token. Discovery turned up several facts that materially change the plan:

1. **`0x95f7…46ab8` is not a factory. it is the $PF ("Pons Factory") ERC-20 token**, itself a
   launch created *on* the Pons v2 launchpad (native-ETH quote, graduated, phase = PoolCreated).
   The real contracts sit elsewhere and are verified. We recovered the full verified sources.

2. **Pons has two on-chain generations with completely different mechanics:**
   - **Pons v1** (`PonsLaunchFactory` `0xA5aA…1feB`, legacy `0x0c37…77a4`): *no bonding curve at
     all*. It mints the whole 1B supply into a **one-sided Uniswap V3 position** (WETH pair, 1%
     fee tier), locks the LP NFT in a locker immediately, and "graduation" is only a milestone,
     WETH principal in the locked position ≥ 4.2 WETH. Nothing migrates.
   - **Pons v2** (`PonsV2LaunchFactory` `0x7ed5…EC7e`, verified 0.8.35, ~86,000 launches): a real
     **constant-product virtual-reserve bonding curve** ("phantom quote" = pump.fun-style), which
     graduates into a **permanently locked full-range Uniswap V4 position** governed by a custom
     hook (`PonsV2MemeHook`). This is the mechanic the brief describes.

3. **Pons v2 already supports ERC-20 quote tokens, including tokenized stocks.** Its
   `approvedPairTokens` allowlist contains ~28 assets: native ETH (50k launches), **SPCX, NVDA,
   SPY, TSLA, AAPL, GOOGL, MSFT, META, AMZN, QQQ, GME, DJT, RDDT, COIN, MSTR, PLTR, HOOD-adjacent
   stocks…**, plus **USDG, cbBTC, GLD, HIMS, BB**. The brief's "v2 roadmap: stock-token quotes"
   is Pons v2's *present*. What Pons v2 does **not** allow as quotes are its own graduated meme
   tokens ($PONS etc.).

4. **pons-factory.fun (the $PF project) fills exactly that gap**, "launch with any ETH-paired
   graduated pons token". and it does so by running **additional deployments of the same
   PonsV2LaunchFactory bytecode** under different owners (e.g. `0xCb16…1C5d` has $PONS approved
   as a quote token). The code is MIT-licensed and verified, so this is legitimate reuse, and
   it's what AK's brief effectively asks us to build, but *immutable, rug-minimized, with
   creator-configurable fee/cashback options, and a production frontend*.

5. **The curve, fee, anti-snipe and graduation design in Pons v2 is very strong** (details in §4;
   it is adapted from the audited `BootstrapPool.sol`, code-423n4/2025-01-iq-ai). Our design
   should adapt its mechanics rather than reinvent them, then *remove/timelock the admin powers*
   (§5 lists all of them) and add the brief's fee/cashback matrix.

Recommendation in one line: **build "Pons v2 minus admin powers, plus fee options", quoted in
graduated Pons tokens, graduating into permanently locked full-range Uniswap V4 positions on the
canonical Robinhood Chain PoolManager**, with a `QuoteRegistry` that verifies graduation
on-chain against *both* Pons generations. §7 explains why V4 over the brief's assumed V3.

---

## 2. Robinhood Chain facts (verified live)

| Item | Value | Verified how |
|---|---|---|
| Chain ID (mainnet) | **4663** (`0x1237`) | `eth_chainId` against RPC |
| RPC (mainnet) | `https://rpc.mainnet.chain.robinhood.com` | used for all reads |
| Alt RPC | `https://robinhood.drpc.org` (free tier: 10k-block `eth_getLogs` limit) | tested |
| Explorer | `https://robinhoodchain.blockscout.com` (Blockscout; **Cloudflare-challenged for bots**: use Sourcify or a browser session for automation) | tested |
| Testnet | chain ID 46630, `https://rpc.testnet.chain.robinhood.com`, **none of the Pons contracts exist there** | `eth_getCode` = empty |
| Stack | Arbitrum Orbit L2, ETH gas token, ~4-10 blocks/s | docs + observed block rate |
| Verification | **Sourcify has exact matches** for Pons contracts (chain 4663 supported) | fetched full sources |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (18 dec) | Pons v1 pair token, symbol read on-chain |
| USDG (stable) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Pons v2 approved quote; deep WETH/USDG pools (~$6.3M + $2.9M) |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | code present |

### Canonical Uniswap deployments (chain 4663)

| Contract | Address | Note |
|---|---|---|
| UniswapV3Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | canonical (Uniswap docs), *same one Pons v1 uses; they do NOT run their own V3* |
| V3 NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` | canonical |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` | canonical |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` | canonical |
| UniversalRouter | `0x8876789976decbfcbbbe364623c63652db8c0904` | canonical |
| **V4 PoolManager** | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | canonical, *same one Pons v2 uses* |
| **V4 PositionManager** | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` | read from Pons v2 factory immutables |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | canonical cross-chain address |

All of the above go into a single `chains.ts` / `Addresses.sol` config in Phase 1.

---

## 3. Pons v1 (`PonsLaunchFactory`: what the "graduated tokens" came from)

Verified sources recovered from Sourcify (Solidity 0.8.30). Files: `PonsLaunchFactory.sol`,
`PonsLauncherToken.sol`, `PonsLaunchLocker.sol` (+ tick/liquidity math libs).

**Mechanic**: one transaction (`launchToken`):
1. CREATE2-deploys a fixed-supply ERC-20 (1B, 18 dec) that mints everything to the factory.
2. Creates/initializes the canonical **V3 pool** (token/WETH, fee 10000 = 1%, tick spacing 200)
   at `initialTick = −204200` (≈ 1.36e-9 WETH/token starting price).
3. Mints a **one-sided** position: all 1B tokens from `initialTick` → max usable tick. Zero WETH.
4. Transfers the LP NFT to `PonsLaunchLocker` and registers it. **Liquidity is locked from
   block one; there is no migration step, ever.**
5. Optional atomic dev buy through SwapRouter02 with `msg.value − launchFee`.

**Anti-snipe**: token-level `_update` hook, active only `restrictionBlocks = 2` blocks: launch
block buys revert entirely (except the atomic dev buy), then max-wallet 5% / cumulative-buy
5.5% caps on pool→user transfers. Afterwards the token is a plain ERC-20 (no owner, no
blacklist, no pause, no fee-on-transfer).

**Graduation** = `graduationStatus(token)`: computes WETH principal inside the locked position
from `slot0` + position liquidity; graduated ⇔ principal ≥ threshold (**4.2 WETH** in the only
launch config). It is a *badge*, not a state transition.

**Fees**: 0.0005 ETH launch fee; LP fees accrue to the locked NFT; `PonsLaunchLocker.collectFees`
splits both assets **30% protocol / 70% creator** (share snapshotted per launch). Creator can
redirect their share (`setFeeRedirect`). Locker has no withdraw/transfer for principal.

**Live config/owner facts**: owner of factory & locker = Gnosis **Safe v1.4.1, 2-of-3**
(`0x263ed295dAFaE1d9AAdD6E56c4B6F9f38eE019Dd`); `launchEnabled = false` (v1 is closed to the
public now, v2 replaced it); protocol fee recipient = the same Safe.

---

## 4. Pons v2 (`PonsV2LaunchFactory`: the mechanic we're adapting)

Verified 0.8.35 sources from Sourcify. Deployed stack (all mainnet, all wired 1:1):

| Contract | Address | Role |
|---|---|---|
| PonsV2LaunchFactory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` | launch + graduation orchestration |
| PonsV2LaunchDeployer | `0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42` | CREATE2 deploys curve+token (EIP-170 relief) |
| PonsV2MemeHook | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` | V4 hook: post-grad fees + live fee policy |
| PonsV2LaunchLocker | `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952` | holds graduated V4 LP NFTs forever |
| PonsV2FeeEscrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` | pull-payment ledger (ETH + ERC-20) |
| PonsV2BuybackVault | `0x42df2a798f82289E177311362e8f5ccC45c1219c` | 5-year vest for bought-back tokens |
| PonsV2GraduationExecutor | `0xC7819B64A1dAECD7eC19856d026cb14EfBd89046` | Permit2 + PositionManager mint encoding |
| PonsV2GraduationGuard | `0xf5695117b99B6f6401e67d4195BD653628176C6C` | preflight: "would V4 mint this seed?" |
| Owner (everything) | `0x263ed295dAFa…19Dd`, Safe 1.4.1, **2-of-3** | threshold read on-chain |
| feeSweepOperator | `0x49BbF2b70955Fb3a106e084D4BFDa92d334573d2` | keeper for sweeps w/ buyback minOut |

### 4.1 Curve formula (constant-product with virtual quote reserve)

Per launch, one clone-like `PonsV2BondingCurve` holds the entire minted supply `S` and trades it
against the quote asset (native ETH or an approved ERC-20):

- Virtual reserves: `quoteReserve = phantomQuote + trackedQuote − pendingFees − pendingTax`,
  `tokenReserve = trackedTokens` (both *tracked*, never `balanceOf`: donations can't move price
  or trigger graduation).
- Swap math: plain x·y=k with fee on the input/output quote leg
  (`amountOut = (in·(10000−fee)·Rout) / (Rin·10000 + in·(10000−fee))`).
- **Every fee is charged on the quote leg in both directions**: the protocol never holds
  memecoin-denominated fees before graduation.
- **Reserved allocation**: at initialize, `reserved = S · phantom / (phantom + threshold)`.
  The curve will never sell below `reserved`. Selling exactly down to it *is* graduation,
  quote-side threshold and token-side exhaustion are the same point, so the graduated pool's
  seed price is deterministic no matter how the curve was traded.
- Final buy is **partially filled + refunded** (not reverted), with `minTokensOut` reinterpreted
  as a *price* bound. the last buy can't be griefed by a tiny front-run.
- ERC-20 quotes are credited by **observed balance delta** (fee-on-transfer defense), and a
  re-entrancy re-check guards against quote tokens with transfer callbacks.

Live economics (config 0 + per-asset `pairTokenEconomics`, all at ratio threshold:phantom = 2.5):

| Quote | phantomQuote | graduationThreshold |
|---|---|---|
| native ETH | 1.68 ETH | 4.2 ETH |
| GLD (18 dec) | ≈9.976 GLD | ≈24.94 GLD |
| cbBTC (8 dec) | 0.052739 cbBTC | 0.13184752 cbBTC |
| HIMS / BB / stocks / USDG | per-asset, same 2.5 ratio | sized off-chain to ≈ the ETH target |

Derived (S = 1B, phantom 1.68, threshold 4.2): reserved = 28.57% of supply; **71.43% sold on the
curve**; pool seed = 20.41% of supply + all 4.2 quote (minus swept fees); **8.16% of supply is
permanently locked** (the virtual-reserve remainder that can't enter the pool without lowering
its opening price); terminal price ≈ 2.06e-8 quote/token → graduation FDV ≈ 20.6 quote units
(≈ $85k for ETH quote at $4,100).

### 4.2 Fee model

Two layers, both frozen per launch at creation (`FeePolicySnapshot`):

- **Base curve fee** `curveFeeBps`: live value **1%**, hard cap 10%. Split:
  **30% protocol** (`protocolFeeShareBps = 3000`, cap 50%) / 70% creator.
- **Creator tax** `creatorTaxBps`: creator-chosen 0-10% (owner-tunable ceiling, hard cap 10%);
  combined fee capped at 20%. Paid **100% to creator**, never split.
- **Buyback-and-lock** (creator opt-in, default per launch): `buybackBurnBps = 50%` *of the
  creator's slice* buys the **launch token** off the curve's own reserve (price-impact-bounded,
  3%) and locks it in `PonsV2BuybackVault`: a **5-year linear vest to the creator, with 30%
  of each release to the protocol**. Note: this buys back the *meme token*, not the quote,
  different from the brief's quote-buyback-and-burn flywheel (§7.5).
- **Anti-snipe tax** (replaces v1's block caps): starts at **99%** of the quote leg in the launch
  second, decays exponentially (14 halvings across the window, currently **3 s**) to zero.
  Creator + fee recipient + up to 32 declared bundle wallets are exempt. Snipe tax proceeds join
  the base-fee split. This monetizes snipers instead of blocking them.
- **Post-graduation**: the V4 pool's core LP fee is **0**; `PonsV2MemeHook.afterSwap` charges
  `hookFeeBps` (**1%**) + the launch's creator tax, accumulates them, converts meme-side fees to
  quote via bounded internal swaps, and distributes through the same
  protocol/creator/buyback-and-lock split via the escrow. Creator revenue therefore continues
  for the life of the pool.
- All payouts go through **`PonsV2FeeEscrow`** (pull-payment) so a reverting recipient can't
  wedge trading or graduation.
- Launch fee: 0.0005 ETH flat.

### 4.3 Graduation (two permissionless phases + guard)

1. `graduate(token)`: callable by **anyone**, and attempted automatically inside the crossing
   buy (`try/catch` + `AutoGraduationFailed` event so a gas-starved attempt is visible to
   keepers). Preflight (`GraduationGuard.assertSeedable`) proves V4 would mint the seed *before*
   anything irreversible. Sweeps fees, halts trading, moves reserves into the factory
   (`Swept` phase, quote credited by balance-delta).
2. `createGraduatedPool(token)`: permissionless, retryable. Locks the virtual-reserve token
   excess in the locker, initializes the V4 pool at `sqrtPrice = √(amount1/amount0)` (the curve's
   terminal price), mints a **full-range** position via the executor **directly to the locker**,
   registers the pool + frozen policy with the hook.
3. Because the curve already trades in the pool's quote asset, graduation needs **no swap, no
   router, no oracle, no slippage parameter**. this is the single most important design idea to
   copy.

Phases: `NotGraduated → Swept → PoolCreated` (terminal) with `Rescued` as a 7-day-delayed escape
for quote assets that turn hostile (blocklist/fee-on-transfer upgrades), see §5.

### 4.4 Locker

`PonsV2LaunchLocker` holds every graduated position NFT forever: no withdraw, no transfer, no
arbitrary call; `onERC721Received` only accepts the canonical PositionManager. (In V4, fees live
in the PoolManager and are collected by the hook, so the locker needs no `collectFees` at all.)
It also permanently holds each launch's virtual-reserve token excess (`lockTokenSupply`).

### 4.5 Launch token

`PonsV2LauncherToken`: fixed-supply ERC-20 + **ERC20Burnable**, mints 100% to the curve in its
constructor, stores logo/description/socials on-chain, exposes `curve()`/`launchFactory()`.
No owner, no pause, no blacklist, no transfer hooks at all (the snipe tax made v1's token-level
restrictions unnecessary). This matches the brief's `LaunchToken` almost exactly.

---

## 5. Admin power inventory (what we must NOT copy, or must timelock)

> **Status note.** This section records the Phase 0 design intent. As shipped,
> the timelock is a deploy-time option (`USE_TIMELOCK`, default on) rather
> than a guarantee. Where this document says a power sits "behind the 48h
> timelock", read it as "behind the timelock when deployed with one, and
> immediate otherwise". `docs/AUDIT.md` §8 and `docs/DEPLOYMENT.md` describe
> both models; the frontend states whichever actually shipped.

Owner of everything is the same 2-of-3 Safe. Powers, classified:

**A. Cannot touch user funds or liquidity (config-only, future launches only)**: acceptable,
ours go behind a 48h timelock:
- add/update launch configs; open/close public launching; whitelist launchers; launch fee
- approve/remove quote tokens + set their curve economics (removal only blocks *new* launches)
- max creator tax ceiling; snipe tax start/window (snapshotted per launch)
- hook fee policy: `hookFeeBps`, `protocolFeeShareBps`, `buybackBurnBps`, price-impact bound,
  protocol fee recipient, `feeSweepOperator` rotation (snapshotted per launch except operator)
- one-time wiring (executor/deployer/factory/vault); rotatable `launchForwarder`
- `renounceOwnership` is disabled on every contract (deliberate. an ownerless factory could
  never approve quotes again)

**B. Touches user-adjacent value. the powers our design must eliminate or further constrain:**
1. **Creator-fee-recipient override** (`setCreatorFeeRecipient`, owner, 3-day timelock + 3-day
   execution window, *documented as a standing power, not just lost-key recovery*; the creator's
   own transfer does NOT cancel a pending override). The owner can redirect any launch's future
   creator fees and the buyback vest.
2. **`rescueSweptGraduation`**: after 7 days stuck in `Swept` (and only while the guard says the
   seed is unmintable and nobody could complete it permissionlessly), owner sends the launch's
   entire reserves **to an arbitrary recipient**. Exists for hostile-quote-asset rescue;
   arbitrary-recipient is the dangerous part.
3. **`forceSweptGraduation`**: owner can push a *genuinely unseedable* ready curve into `Swept`
   (reverts if a healthy seed exists). Feeds power 2.
4. **`rescueCurveFees` / `rescuePoolFees`**: pays pending fees directly to the *fixed* protocol
   + creator recipients, bypassing escrow (for quotes that blocklist the escrow). Recipients are
   not owner-choosable, low risk, worth keeping.

**C. Structural trust notes**: no proxies anywhere (all logic immutable once deployed); policies
snapshotted per launch so retunes never reprice live launches; locked liquidity is unreachable
by anyone including the owner. The genuinely rug-relevant surface is B.1 + B.2.

---

## 6. Graduated Pons tokens, initial quote-token allowlist candidates

12 graduated tokens confirmed on-chain by sweeping `graduationStatus` over 1,724 v1 launches
(both v1 factories), plus 3 recovered via DexScreener that sit in block ranges the public RPC
couldn't serve logs for (the Phase 2 indexer will confirm them on-chain). pons-factory.fun
advertises "15 graduated pons tokens", matching 12 + 3.

| Symbol | Token | WETH principal in locked V3 pool | USD liq (DexScreener) |
|---|---|---|---|
| **PONS** | `0x39dBED3a2bd333467115dE45665cC57F813C4571` | **414.5 WETH** | ~$3.78M |
| DELTA | `0xe8ffd7e24187F72afB08d75B1bb13088A989a791` | (gap-range; pool `0xD64F…5F94`) | ~$1.68M |
| HMM | `0x7FE995a80075dF3Dc8Ae11A9b82c7FE4202CD87f` | (gap-range; pool `0x2b0D…0E9e`) | ~$860k |
| PONGO | `0xedAee44320107CAa714BaAEc486261A87F27022d` | 45.2 WETH | ~$243k |
| wire | `0x8ECEA3d0E648DB646d824AA51EedeB16aC3d6878` | 26.7 WETH |, |
| LINK (meme) | `0xe6864e4630D4d7A0cAd2E61f6BC2C0dcAD777712` | 21.7 WETH |, |
| NASDANQ | `0x51Fb76BE80ab6daAa345D818f4E06441816b4fEa` | (gap-range; pool `0xdB1b…65EC`) | ~$211k |
| PONSHOOD | `0x432C99bBD9dc1d9040087598d7Cf40502d7cC20b` | 9.7 WETH |, |
| TROLL | `0xa206753eb19D8E3F9Ae3313ADb467BdC2a7a4d90` | 9.2 WETH |, |
| TEST | `0xF4EaeC43E22251547FbD2cb2F153E041C3AA4ea6` | 7.7 WETH |, |
| PONSTAR | `0xA737dF5De18E3AA6b0bf8C2e9846Ed699F6f2AEB` | 7.5 WETH |, |
| OZZY | `0xd3cA926df830941D22C6d8aA83f7Bd0A7031480D` | 7.4 WETH |, |
| TAMPONS | `0xC9E7C34fa156a235e8B8601171a543bc9c84a1B9` | 6.6 WETH |, |
| BRODIE | `0x45F82AC5d507e988f7406935da8eEfe495a360e0` | 4.75 WETH |, |
| NOTHING | `0xB13896E409e35c14C29628f0B61804C00C18705e` | 4.6 WETH |, |

Graduation threshold was 4.2 WETH for every launch, so several of these barely cleared it. A
minimum-TVL gate on the allowlist matters: at, say, **≥ 25 WETH**, only PONS, DELTA(≈410 WETH
eq.), HMM, PONGO, wire and NASDANQ(≈52 WETH eq.) would qualify today.

Note: newly graduating tokens now come out of **v2** (V4 pools, native-ETH quote). The registry
must verify graduation against *both* generations (§7.2).

---

## 7. Our design

Working name pending (open decision). Contracts in Foundry, Solidity ^0.8.26+, canonical
Uniswap V4 on Robinhood Chain, no proxies, no upgradeability, NatSpec everywhere.

### 7.1 V4, not V3, recommendation with reasons

The brief assumed V3. I recommend **V4 with a minimal immutable hook**, as Pons v2 does:

- **Fees stay quote-denominated post-graduation.** In V3, LP fees accrue in *both* pool tokens;
  the brief's cashback/buyback modes are all quote-denominated, so a V3 locker would have to
  either pay two-asset fees (v1 does this, clumsy) or swap meme→quote at collect time (oracle
  + slippage surface). A V4 `afterSwap` hook charges the fee on the quote leg directly.
- **Same proven pattern as the reference.** We adapt verified, battle-tested (86k launches)
  code rather than translating the mechanic to a different AMM.
- **Zero-fee core pool + hook fee** means the entire trading fee is programmable, the
  cashback matrix (§7.4) is implementable at all only in the hook model.
- Cost: hooks are audit-sensitive. Mitigation: our hook is *append-only accounting* (afterSwap
  fee take + distribution), no beforeSwap price manipulation, no dynamic-fee games; and we keep
  Pons's GraduationGuard/executor separation.

If AK prefers V3 for audit simplicity, the fallback design is v1-style `Locker.collectFees`
with a two-asset `FeeSplitter` and no trader-cashback mode (it's impractical in V3), say so
and we'll spec it, but V4 is the better fit for the brief's fee features.

### 7.2 QuoteRegistry (the genuinely new contract)

Permissionless allowlist of quote tokens. `addQuoteToken(token, origin)` succeeds iff:

1. **Graduation proof, on-chain, per origin:**
   - `PONS_V1`: `PonsLaunchFactory(v1 or legacy).graduationStatus(token).graduated == true`
     (verified against both v1 factory addresses, hardcoded).
   - `PONS_V2`: `PonsV2LaunchFactory.getLaunchedToken(token).phase == PoolCreated &&
     pairToken == address(0)` (ETH-quoted launches only, per the brief).
2. **Liquidity floor:** ETH-side principal in the token's canonical locked pool ≥
   `minEthTvl`: read on-chain the same way v1's `graduationStatus` does for V3 (slot0 +
   position math on the locked NFT), and via `StateView`/position reads for v2's V4 pools.
   Only the *locked* position counts (can't be faked with removable liquidity or donations).
3. **Sanity:** decimals ∈ [6,18]; token has code; not already listed.

Registry stores per-quote curve economics derived at listing time: the USD-target graduation
threshold is converted to quote units via the quote/WETH pool TWAP (V3 `observe` for v1-origin,
V4 oracle-less spot+TWAP via `StateView` history for v2-origin, Phase 1 will pin this down;
worst case we require a keeper-supplied price with on-chain bounds). Each *launch* then
snapshots these figures, so later re-pegs never touch live curves.

Governance surface (all behind the 48h timelock, none affecting live launches or pools):
`minEthTvl`, pause-new-launches-per-quote (never pause trading/graduation), re-peg cadence.
**No admin removal of a quote token, no admin add bypassing the checks.** The `origin` enum is
extensible (add `EXTERNAL_ERC20` or `STOCK_TOKEN` adapters in a v2 registry without touching
launches, registry is consulted only at launch time, so replacing it is additive).

### 7.3 Launch stack (adapted from Pons v2, deltas marked ★)

- **`LaunchFactory`**: as Pons v2's, minus §5.B powers: ★ no creator-fee-recipient override at
  all (creator self-service transfer only; lost keys are lost, document it), ★ no
  `forceSweptGraduation`, ★ `rescueSweptGraduation` pays **only to the launch's
  creatorFeeRecipient** (never arbitrary) after 14 days, ★ quote approval comes from
  `QuoteRegistry` instead of owner calls, ★ owner functions behind 48h timelock + public Safe.
  Keeps: economics digest pin (`expectedEconomics`), CREATE2 vanity salts, launch-forwarder for
  atomic launch-and-buy, per-launch policy snapshots, launch fee.
- **`LaunchToken`**: Pons v2's token minus `ERC20Burnable` (brief says plain; burnable is
  harmless but plain is plainer). Fixed 1B, mints to curve, metadata on-chain.
- **`BondingCurve`**: Pons v2's curve nearly verbatim (tracked reserves, quote-leg fees,
  balance-delta credit, partial final fill, snipe tax, escrow payouts), ★ fee split extended
  per §7.4, ★ `deadline` param added to buy/sell (brief), ★ `permit`/Permit2 support for quote
  approvals.
- **`FeeSplitter` logic**: per-launch immutable config (see §7.4). Lives inside curve + hook
  as Pons does (a separate splitter contract per launch adds calls without adding safety), but
  the *config struct* is one shared library so curve and hook provably split identically.
- **`Graduator`**: Pons v2's two-phase graduate/createGraduatedPool + guard + executor,
  permissionless + auto-attempt, unchanged in substance.
- **`Locker`**: Pons v2's (no withdraw, no transfer, no owner post-wiring) + holds virtual-
  reserve excess. Post-graduation fees flow from the hook, not the locker.
- **`Hook`**: afterSwap quote-leg fee + distribution with the same price-impact-bounded
  internal conversion; ★ fee policy is **constructor-immutable** except protocol fee recipient
  (timelocked), no owner retunes at all; per-launch snapshots still apply.
- **Escrow**: pull-payment ledger, as Pons v2. Non-negotiable given hostile-token history.

### 7.4 Fee & cashback matrix (the brief's product surface)

Per trade on curve and (via hook) on the graduated pool, all on the quote leg:

- Protocol fee: fixed at launch from global policy (open decision; Pons charges 1% × 30% share
  ⇒ 0.30% effective protocol take + launch fee).
- Creator fee: **0-2%** creator-chosen (brief). this is Pons's `creatorTaxBps` with a 200bps
  ceiling instead of 1000.
- Cashback mode (creator picks ≤1; % carved from the *creator's* share so the total stays
  capped):
  1. **Trader cashback**: rebate X% of the fee to the trade's recipient in quote, credited via
     escrow in the same transaction. (New, no Pons equivalent.)
  2. **Holder rewards**: accumulate quote in escrow, claimable pro-rata. Accumulator design
     (Merkle drops need an operator; accumulator is trustless but must handle transfers,
     simplest correct version: snapshot-free "claim streams to current holders" is *not*
     trustless; recommend **staking-free accumulator keyed on balance at claim with
     per-account checkpoints**, Phase 1 spike, or drop to Merkle-with-permissionless-root
     from indexer data. Flagged as the one genuinely hard sub-problem.)
  3. **Quote buyback-and-burn**: buy the **quote token** (curve: against own reserve pre-grad
     is impossible for quote, it buys via the quote's own ETH pool; post-grad: hook swaps
     fee-quote → quote is identity, so it simply transfers to `0xdead`). ★ Key deviation from
     Pons (they buy the *launch* token into a 5y vest). Pre-graduation, "burn" needs no swap at
     all. the fee already *is* the quote token; we just send it to `0xdead`. This makes the
     flywheel trivially safe: **no swap, no oracle, no operator**: strictly simpler than
     Pons's buyback. (Post-grad identical.) This is the mode that makes $PONS communities
     promote us.
- Snipe guard: adopt Pons v2's decaying snipe tax (better than the brief's per-wallet caps,
  monetizes rather than blocks, no token-level transfer hooks) + optional creator-declared
  launch delay. Bundle-wallet exemptions capped at 32.
- Creator can `transferCreatorFeeRecipient` (self-service only). Nothing else is mutable.

### 7.5 Keeper & liveness

`feeSweepOperator`-style keeper only needed for sweeps that execute swaps; quote-burn mode
needs none. Graduation auto-fires on the crossing buy with permissionless retry;
`AutoGraduationFailed` event drives the Phase 4 keeper. All keeper functions are permissionless
or safe-if-hostile.

### 7.6 Trust model / proof page claims

Everything the `/proof` page will assert, by construction: no proxies; liquidity locker with no
exit functions; fee terms frozen per launch; quote allowlist permissionless + rule-based; the
only timelocked owner powers are (a) protocol fee recipient, (b) registry TVL floor / pause of
*new* launches per quote, (c) global defaults for *future* launches; owner cannot touch any
live curve, pool, position, or anyone's fees. Explicit list of the Pons powers we removed
(§5.B) as the competitive pitch.

---

## 8. Phase 1 plan (contracts)

- Foundry repo: `contracts/` (factory, curve, token, hook, locker, registry, escrow, guard,
  executor, timelock wiring), `Addresses.sol` per-chain config, `deployments/<chainId>.json`.
- Tests: unit per contract; invariants, (i) quote extracted ≤ quote deposited − fees for any
  trade sequence, (ii) graduation always locks 100% of position + excess supply, (iii) locker
  can never release principal, (iv) fee splits sum exactly, (v) tracked reserves ≥ payouts;
  fuzz across 6/8/18-decimal quotes and fee-on-transfer/reverting/reentrant quote mocks;
  **fork tests against Robinhood mainnet using $PONS as the live quote** (registry proof reads,
  real V4 PoolManager graduation end-to-end).
- CI: `forge fmt --check`, `forge test`, Slither, gas snapshot. NatSpec complete; no assembly
  beyond CREATE2 helper.
- Testnet problem: Pons doesn't exist on testnet 46630 → primary integration target is a
  **mainnet fork**; testnet gets a mock-registry deployment for frontend integration.

## 9. Phases 2-4 (unchanged from brief, notes)

- Indexer: Ponder against factory/curve/hook/locker/registry events; it also backfills the
  full Pons v1+v2 history (the public RPC's `eth_getLogs` is weak. the indexer needs an
  archive-grade endpoint, e.g. Chainstack; budget item).
- Frontend: as brief. `Trust panel` gets real content from §7.6. Charts from indexer OHLC.
- Ops: keeper for retryable graduations + sweeps; Sentry; monitoring on `AutoGraduationFailed`,
  `Swept`-phase age, registry adds.

---

## 10. Open decisions for AK (blocking Phase 1)

Carried from the brief:
1. **Name/brand.**
2. **Protocol fee**: proposal: 1% curve/hook fee with 30% protocol share (match Pons pricing;
   competitive parity) + 0.0005 ETH launch fee. Recipient multisig address needed (fresh 2-of-3
   Safe like Pons, or existing?).
3. **Min ETH TVL for quote listing**: proposal: 25 WETH locked-position principal (≈$100k;
   today admits ~6 tokens, see §6).
4. **Default graduation target in USD**, Pons's is ≈ $17k of quote collected (4.2 ETH); brief
   implies USD-pegged per quote. Proposal: $17k equivalent, set per-quote at listing/re-peg.
5. **Non-Pons ERC-20 quotes in v1?**: recommendation: **no**; registry `origin` enum makes it
   additive later. (Note Pons v2 itself already serves the stock/USDG-quote market, our
   differentiation is precisely the graduated-meme-quote niche + immutability.)
6. **Stock-token quotes v2**: registry design (§7.2) already accommodates it.

New, from discovery:
7. **V4 + immutable hook vs V3 + locker-split** (§7.1), I recommend V4; need sign-off since
   the brief assumed V3.
8. **Buyback semantics**: brief's quote-burn (recommended; simpler and the community pitch) vs
   Pons's own-token-buyback-into-5y-vest, vs offering both as cashback modes.
9. **Creator fee ceiling 2% (brief) vs Pons's 10% tax ceiling**: keep 2%? (Recommend yes,
   trader-friendlier than Pons, a marketing point.)
10. **Lost-key policy**: we removed the owner's creator-fee-recipient override (§7.3). Accept
    "lost keys = lost creator fees" for true immutability? (Recommend yes, state it on /proof.)
11. **Holder-rewards mode mechanism** (§7.4.2): checkpoint accumulator (more contract risk) vs
    permissionless Merkle from indexer (small trust in root publisher) vs drop the mode in v1.
    Recommend: ship trader-cashback + quote-burn in v1, hold holder-rewards for v1.1.
12. **pons-factory.fun overlap**: they already run "$PONS-quoted launches" via redeployed Pons
    factories (unverified instances, owner EOAs, no timelocks). Our immutable/rug-proof angle
    is the differentiator, confirm you're comfortable competing head-on (their $PF token
    launched 2026-08-25 and their site is live).

---

## Appendix: research provenance

- Sources: Sourcify exact-match verified sources for `PonsLaunchFactory` (v1),
  `PonsLaunchLocker` (v1), `PonsV2LaunchFactory` + full v2 suite (13 contracts, listed §4);
  local copies under the research scratchpad, ABIs extracted.
- On-chain sweeps: 1,724 v1 launches enumerated (both factories; 3 RPC gap ranges noted),
  graduationStatus swept for all; 86,138 v2 launches counted with quote-token distribution;
  pair-approval event history; hook fee policy, factory configs, Safe owners/threshold read
  live.
- Docs: Mobula almanac (Pons integration), Uniswap deployment docs (V3/V4 canonical addresses),
  Chainstack Robinhood tooling, pons-factory.fun frontend, DexScreener API for pool liquidity.

---

## Addendum: decisions locked with AK (2026-08-31)

1. **Name: $POP, "Pons on Pons"** (contracts prefixed `Pop*`).
2. **Uniswap V4 + immutable-policy hook** (§7.1 recommendation accepted).
3. **v1 cashback modes: QuoteBurn + TraderRebate**; holder-rewards deferred.
4. **Recommended economics accepted**: 1% base fee / 30% protocol share,
   0.0005 ETH launch fee, 2% creator fee cap, 25 WETH listing floor,
   4.2 ETH graduation target (TWAP-converted per quote).
5. **No creator-key recovery**: the protocol override was removed entirely;
   creators self-transfer only. Stated on /proof.
6. **Constrained rescues kept**: fixed-recipient, time-delayed
   (`rescueCurveFees`, `rescueSweptGraduation` → creator only after 14 days,
   `rescuePoolFees`), all behind the 48h timelock.

Implementation status: contracts + 45-test suite + mainnet-fork E2E (real
$PONS, real canonical V4) in `contracts/`; Ponder indexer in `indexer/`;
Next.js frontend in `frontend/`. Outstanding for mainnet: multisig address,
timelock `acceptOwnership` execution, audit, indexer/frontend deployment.

---

## Addendum 2: HolderRewards mode shipped (v1.1)

The third cashback mode, deferred at §10.11 as "the one genuinely hard
sub-problem", is implemented. The resolution to the design question posed
there:

**Neither Merkle-with-an-operator nor a staking vault.** A Merkle drop needs
someone trusted to publish roots; a staking vault means only stakers earn,
which is not "holder rewards" and fragments the float. Instead the launch
token *is* the distributor, using a standard cumulative-reward accumulator
(`rewardPerTokenAcc` / per-account settled marker).

The cost is honest and confined: rewards can only be apportioned by
balance-time, balance-time can only be measured where balances move, so this
one token variant carries a transfer hook. It is accounting-only. it cannot
block a transfer or change the amount. and the token still has no owner,
mint, burn, pause, or blacklist. Every other cashback mode continues to
deploy the completely inert `PopLaunchToken`, so the "nothing but an ERC-20"
claim stays true where it was true before, and the difference is disclosed
in the create flow, on the token page, and on `/proof`.

Design points worth carrying into review:

- **Eligibility is an immutable set.** The curve, factory, executor, locker,
  V4 PoolManager, dead address and the token itself are excluded at
  construction and can never be changed, so structurally-held supply cannot
  absorb rewards that nobody could claim, and the pool's own float does not
  dilute real holders.
- **Funding is permissionless and self-measuring.** `sync()` takes no
  amount; it credits the balance delta since the last call. The curve and
  hook push with a plain transfer, and anybody, creator, community,
  airdropper, can top up the same way.
- **Nothing is stranded and nothing is over-committed.** Inflows arriving
  before any holder exists are buffered and reach the first real holders;
  the pot is a strict upper bound on the sum of all claims (see AUDIT.md §5
  for the reserving bug the solvency fuzz caught here before ship).

Sizing note: the reward token could not be inlined into `PopLaunchDeployer`
without breaking EIP-170, so it deploys through `PopRewardTokenDeployer`,
which authorizes callers by reading the factory's one-time-wired
`launchDeployer` (a direct binding would have been circular).

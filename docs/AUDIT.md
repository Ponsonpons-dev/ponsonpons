# $POP, audit scope & reviewer's guide

Prepared 2026-08-31. Commit: see `git log` on
`claude/quote-token-launchpad-robinhood-5c0j4b`.

$POP is a token launchpad on Robinhood Chain (chain id 4663). Tokens launch
on a constant-product bonding curve **denominated in an existing graduated
Pons token** (e.g. $PONS) and graduate into a permanently locked,
full-range Uniswap V4 position.

The mechanics are adapted from the **verified, MIT-licensed PonsV2
launchpad** (`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`, ~86,000 launches
on this chain), itself adapted from the audited `BootstrapPool.sol`
(code-423n4/2025-01-iq-ai). The trust model was rebuilt; §4 is the
line-by-line diff and is the most useful section for a reviewer.

---

## 1. Scope

**In scope** (`contracts/src/`, ~2,600 nSLOC):

| Contract | nSLOC | Risk |
|---|---|---|
| `PopBondingCurve.sol` | ~420 | **Critical**: holds all pre-graduation user funds |
| `PopLaunchFactory.sol` | ~560 | **Critical**: orchestrates graduation, moves reserves |
| `PopHook.sol` | ~420 | **Critical**, V4 hook, flash-accounting, holds pool fees |
| `PopQuoteRegistry.sol` | ~200 | High, decides what may be a quote asset |
| `PopGraduationExecutor.sol` | ~120 | High, Permit2 + mint encoding |
| `PopLocker.sol` | ~90 | High, custody of all locked liquidity |
| `PopFeeEscrow.sol` | ~70 | Medium, pull-payment ledger |
| `PopGraduationGuard.sol` | ~80 | Medium, seed preflight |
| `PopLaunchDeployer.sol` | ~130 | Medium, CREATE2 |
| `PopLaunchToken.sol` | ~60 | Low, plain fixed-supply ERC-20 |
| `PopRewardToken.sol` | ~180 | **High**, HolderRewards variant: holds and apportions the reward pot |
| `PopRewardTokenDeployer.sol` | ~60 | Low, CREATE2 for the above |
| `libraries/PopCurveMath.sol` | ~60 | **Critical**: pricing |
| `libraries/PopGraduationMath.sol` | ~40 | High, seed price |
| `adapters/PonsV1QuoteAdapter.sol` | ~90 | High, graduation proof + TWAP |

**Out of scope**: `lib/` (OpenZeppelin, Uniswap v4-core/v4-periphery,
Permit2), `src/vendor/BaseHook.sol` (verbatim from v4-periphery), the
canonical Uniswap V4 deployment, the Pons v1 factories we read from, the
indexer, and the frontend.

**Trusted external assumptions**: the canonical V4 PoolManager and
PositionManager behave per spec; Permit2 is the canonical deployment; the
Pons v1 factories' `graduationStatus` is honest (they are immutable,
verified, and hold the liquidity they report on).

---

## 2. System model in one page

A launch has two lifetimes.

**On the curve.** The factory CREATE2-deploys a `PopBondingCurve` and a
`PopLaunchToken` whose entire supply mints to the curve. The curve prices
with `x*y=k` against a *virtual* quote reserve (`phantomQuote`) plus the
real quote it has collected. Fees are always charged on the **quote leg**,
in both directions, so the curve never holds fees denominated in the launch
token. Reserves are **tracked in storage, never read from balances**, so
donations cannot move price or force graduation.

The curve reserves `supply * phantom / (phantom + threshold)` tokens it
will never sell. Selling down to exactly that floor *is* graduation, the
quote-side threshold and the token-side floor are the same point, which is
what makes the graduated pool's opening price deterministic regardless of
how the curve was traded.

**Graduation** is two permissionless phases. `graduate()` sweeps fees,
halts trading, and pulls reserves into the factory (`Swept`).
`createGraduatedPool()` locks the virtual-reserve token remainder,
initializes the V4 pool at the curve's terminal price, mints a full-range
position **directly to the locker**, and registers the pool with the hook
(`PoolCreated`). The crossing buy attempts phase 1 atomically in a
`try/catch`; both phases stay retryable by anyone forever.

Because the curve already holds the pool's quote asset, graduation performs
**no swap, needs no router, and consults no oracle**. This is the single
most important safety property in the design and is inherited from the
reference.

**In the pool.** `PopHook.afterSwap` takes the fee from the swap's
unspecified leg and splits it exactly as the curve did. Fees landing in the
launch token are converted to quote in a batched, price-impact-bounded
internal swap gated to the sweep operator; quote-denominated fees need no
operator at all.

---

## 3. Invariants (all covered by tests; see §6)

1. **Curve solvency**, `quoteBalance(curve) >= trackedQuote` and
   `trackedQuote >= pendingProtocol + pendingCreator + pendingCashback`, always.
2. **No value extraction**: traders as a class cannot withdraw more quote
   than they deposited; a buy/sell round trip is always a strict loss.
3. **Reserved allocation is never breached** pre-graduation.
4. **Donations are inert**: forced transfers of either asset change no
   price, no progress, and never enter the pool seed.
5. **100% of graduated liquidity is locked**: the position NFT mints to
   `PopLocker`, which has no withdraw, transfer, or arbitrary-call path.
6. **Supply that misses the pool never circulates**: the virtual-reserve
   remainder and post-mint dust both route to the locker.
7. **Frozen terms**: a live launch's fee split, thresholds, and pool
   parameters cannot be changed by anyone, including the owner. This is
   structural, not governance: the terms are snapshotted into the launch at
   creation and the hook's fee policy is a constructor immutable.
8. **Fee conservation**: protocol + creator + cashback equals fees charged,
   to within integer rounding.
9. **Reward-pot solvency** (HolderRewards), the sum of every holder's
   claimable balance never exceeds the reward asset the token actually
   holds, across any sequence of trades, transfers, exits and donations.

---

## 4. Diff versus the PonsV2 reference (read this first)

Where behavior is identical, the reference's own reasoning carries over.
These are the deliberate departures:

| # | Change | Rationale | Risk introduced |
|---|---|---|---|
| 1 | **No protocol override of a creator's fee recipient.** The reference has a 3-day-timelocked owner power to redirect any launch's creator fees; it is deleted here. | It is the largest rug-adjacent power in the reference and is documented there as a standing power, not merely lost-key recovery. | Lost creator keys = permanently lost future creator fees. Accepted and disclosed on `/proof`. |
| 2 | **No `forceSweptGraduation`.** | Existed to feed the owner's arbitrary-recipient rescue. | A launch whose seed the guard permanently refuses has no owner-driven exit. Mitigated by the guard running *before* the irreversible sweep. |
| 3 | **`rescueSweptGraduation` pays only the launch's own creator fee recipient**, after 14 days (reference: arbitrary recipient, 7 days). | The owner should choose *when* value moves, never *where*. | Creator must distribute off-chain to holders. Only reachable when a quote asset has become undeliverable, during which anyone can still seed permissionlessly and end the window forever. |
| 4 | **Hook fee policy is constructor-immutable** (share, hook fee, price-impact bound). The reference has owner setters for all three. | Makes the `/proof` claim total: the policy is the bytecode. | A policy change requires a new hook + factory version. Intended. |
| 5 | **Quote allowlist is permissionless and rule-based** (`PopQuoteRegistry`) rather than an owner-curated `approvedPairTokens` mapping. | Removes discretion over who may launch. | Admits any token that clears an on-chain graduation proof + locked-liquidity floor, hence the hostile-quote testing in §6. |
| 6 | **Liquidity floor and graduation proof are re-checked live at every launch**, not only at listing. | A quote that loses its backing stops hosting new launches automatically, with no admin action. | Adds external reads to the launch path; they are view calls into immutable contracts. |
| 7 | **Buyback replaced by quote burn.** The reference buys the *launch* token and vests it 5 years (30% of releases to the protocol). Here, the carve-out is the *quote* token sent to `0xdead`. | Pre-graduation the fee already *is* the quote token, so the burn is a transfer: no swap, no oracle, no operator, no vesting contract. Strictly less machinery. | None identified; it deletes an entire contract and the curve's internal-swap path. |
| 8 | **Curve fee sweeps are fully permissionless.** The reference gates sweeps that would execute a buyback swap. | With no swap in the sweep, there is no price to manipulate. | None identified. |
| 9 | **New: trader rebate mode**: a share of the creator's take credited to the trade's recipient in the same transaction. | Product feature. | Rebate is paid through the escrow inside the trade; reviewed for reentrancy (§6). Curve-phase only, disclosed at creation. |
| 9b | **New: holder rewards mode**: a share of the creator's take pushed to the launch token, which pays it out to its own holders pro-rata via a cumulative accumulator. | Product feature; the only trustless way to reward holders without an operator publishing snapshots or a staking contract fragmenting the float. | **This is the one mode that changes the launch token.** Rewards can only be apportioned by balance-time, which can only be measured where balances move, so `PopRewardToken` carries a transfer hook. The hook is accounting-only: it cannot block a transfer, cannot change the amount, and the token still has no owner, mint, burn, pause, or blacklist. Launches on every other mode get the inert `PopLaunchToken`. Reviewed in §6; the eligibility set is fixed at construction. |
| 10 | **Creator fee capped at 2%** (reference: 10%). | Trader-friendlier positioning. | None. |
| 11 | **ERC-20 quotes only**: no native-ETH launch mode. | Every branch handling `address(0)` as a currency is deleted. | None; reduces surface. |
| 12 | **`deadline` on `buy`/`sell`.** | The reference has none. | None. |
| 13 | **Ownership is deploy-time selectable**: a 48h `TimelockController` (default) or the protocol owner directly (`USE_TIMELOCK=false`). | The reference is owned by a 2-of-3 Safe with no timelock. pons-factory.fun, which runs the same quote-token model, is owned by a single EOA. | Under `direct`, owner actions land immediately with no public notice window. The frontend reads the deployed model from `NEXT_PUBLIC_GOVERNANCE` and states it explicitly rather than claiming a timelock. |

---

## 5. Issues found and fixed during pre-audit hardening

Disclosed for completeness; all are fixed in the reviewed tree.

1. **Stranded dev-buy refund** (`PopLaunchFactory.launchToken`). An
   oversized atomic dev buy is clamped by the curve, which refunds the
   remainder to its caller. the factory. The refund was never forwarded,
   so it sat in the factory. Because the factory legitimately custodies
   *other* launches' swept reserves in the same asset, a naive
   `balanceOf` sweep would have let one launch drain another. Fixed by
   measuring the refund as a **balance delta across the buy** and
   forwarding only that. Regression tests:
   `test_devBuy_clampedRefundReachesCreator`,
   `test_devBuy_cannotTouchOtherLaunchesSweptReserves`.

2. **`PopCurveMath.quoteAmountOut` could panic.** It is documented as the
   non-reverting variant, callers (the factory's launch-time quotability
   check) treat an unpriceable trade as a condition, not an error, but the
   input scaling could overflow uint256 and panic. Fixed with explicit
   pre-screens that return 0.

3. **Intermediate overflow in curve pricing.** `amountInWithFee *
   reserveOut` (and the triple product in `getAmountIn`) overflow uint256
   for large-but-representable reserve pairs. Fixed by carrying them at
   512-bit width via `FullMath.mulDiv`. Results are identical wherever the
   naive form did not overflow; this was verified by the full suite and by
   re-running the mainnet-fork lifecycle. Deployed size *decreased*.

4. **Reward accounting could over-commit the pot** (`PopRewardToken`, found by the solvency fuzz before the mode ever shipped). The distributor originally reserved each distribution's *floored* per-token value. But a holder settles against the **combined** accumulator delta since they last moved, and a combined floor is never smaller than the sum of per-distribution floors, so the sum of claims could drift a wei above what had been set aside, and the last claimant's `claim()` reverted on underflow. Fixed by reserving the whole inflow rather than the floored product, which makes the pot a strict upper bound on everything claimable from it. Regression tests: `test_solvency_claimsNeverExceedFunding`, `testFuzz_neverOwesMoreThanItHolds`.

5. **Crossing-buy gas starvation** (frontend, not a contract defect). A
   wallet's gas estimate does not price the `try/catch` graduation branch,
   so the buy that completes a curve routinely leaves it ungraduated,
   observed on the mainnet-fork dry run. The permissionless retry and the
   keeper are the designed backstop; the UI additionally floors gas on
   crossing buys.

---

## 6. Test coverage map

72 tests, all passing (`forge test`), plus 3 fork tests green against real
Robinhood mainnet state.

| Area | Where |
|---|---|
| Curve pricing, fee split per cashback mode, snipe tax, partial fills, donations, deadlines | `test/unit/BondingCurve.t.sol` |
| Full graduation, seed price preservation, locker custody, hook fees, quote burn in-pool, operator gating, hostile-quote rescue | `test/unit/Graduation.t.sol` |
| Permissionless listing rules, live liquidity floor, re-peg cooldown/clamp, decimals drift, owner surface | `test/unit/QuoteRegistry.t.sol` |
| Launch gating, fee caps, cashback validation, economics pin, CREATE2 salt namespacing, owner surface | `test/unit/LaunchFactory.t.sol` |
| Escrow credit/claim, fee-on-transfer delta crediting | `test/unit/FeeEscrow.t.sol` |
| **Reentrant quote tokens, blocklisting quotes, 6- and 8-decimal quotes, dev-buy value routing, snipe-tax boundaries, curve-math fuzz** | `test/unit/AuditHardening.t.sol` |
| **Holder rewards: eligibility set, pro-rata splits, late buyers, exits, transfers, buffered pre-holder inflows, donations, graduation continuity, solvency fuzz** | `test/unit/HolderRewards.t.sol` |
| Solvency / no-extraction / reserved-floor invariants under randomized trading, sweeps, and donations | `test/invariant/CurveInvariant.t.sol` |
| Real Pons graduation proof, real TWAP economics, full lifecycle on canonical V4 | `test/fork/RobinhoodFork.t.sol` |

Reproducing the fork suite, no endpoint, credentials, or archive provider
required, and byte-identical for every reviewer:

```bash
cd ponsonpons
cp -r contracts/test/fork/cache/4663 ~/.foundry/cache/rpc/
cd contracts && RUN_FORK_TESTS=true node script/fork-cache-server.mjs -- \
  forge test --match-path "test/fork/*" -vv
```

The real mainnet state these tests read is committed at
`test/fork/cache/4663/<block>` (Foundry's own RPC cache format) and replayed
from disk. This is not a convenience: the public endpoint refuses state queries
at its own head *and* keeps state for only a few thousand blocks behind it,
minutes at Orbit block times, so there is no pinned block a reviewer could
otherwise read tomorrow, and archive access to chain 4663 is a paid product.
`script/fork-cache-server.mjs` serves the three handshake calls
`vm.createSelectFork` makes before it will consult that cache; anything beyond
the cache errors loudly rather than reaching for the network, so a reviewer can
be confident the run touched nothing live. `script/warm-fork-cache.sh`
regenerates the fixture against a live endpoint if you want to re-pin.

---

## 7. Known accepted risks

- **Lost creator keys are unrecoverable** (§4.1). Deliberate.
- **A quote token that turns hostile after listing** can wedge a launch's
  fees or its pool seed. Bounded by the two constrained rescue paths;
  cannot touch locked liquidity or any other launch.
- **TWAP-derived quote economics.** Listing and re-peg read a 30-minute
  V3 TWAP. Manipulation is bounded by the once-per-day cooldown and the
  2x clamp, and affects only *future* launches, never a live curve, which
  snapshots its economics at creation.
- **The hook's `maxInternalPriceImpactBps` is slippage control, not
  manipulation resistance.** The operator's explicit `minConversionQuoteOut`
  is the real defense; this is inherited from the reference and documented
  at the call site.
- **HolderRewards costs gas on every transfer** of that launch's token (two accumulator settles plus an eligibility re-base, roughly 30-40k). It is opt-in per launch and disclosed in the create flow.
- **Rounding dust in the reward pot** is reserved but may never be claimable, and simply stays in the token contract. Bounded by one wei per holder per settlement.
- **Griefing the graduation gas** costs the griefer nothing but delays
  nothing meaningfully: anyone can finish it.

---

## 8. Deployment and governance

See `docs/DEPLOYMENT.md`: the full runbook, executed end-to-end on a
mainnet fork including the timelock handover.

**Governance is chosen at deploy time**, and reviewers should confirm which
model a given deployment actually used rather than assuming:

- `USE_TIMELOCK=true` (default): a 48h `TimelockController` owns the four
  ownable contracts, with `PROTOCOL_OWNER` as sole proposer and executor.
- `USE_TIMELOCK=false`: `PROTOCOL_OWNER` owns them directly and its changes
  take effect immediately, with no notice window.

`deployments/<chainId>.json` records this as `governance: "timelock" |
"direct"`; a zero `timelock` address means direct ownership. The frontend
reads the same fact from `NEXT_PUBLIC_GOVERNANCE` so `/docs/proof` describes
the deployment that exists.

In both models the deployment is **not complete** until `acceptOwnership()`
has landed on the factory, hook, locker, and registry; until then the
deployer EOA retains ownership. Under the timelock model those four calls
must be executed *through* it.

Worth stating for a reviewer weighing the direct model: the guarantees this
protocol actually rests on do not depend on governance at all. Locked
liquidity, frozen launch terms, the absent creator-fee override, and
permissionless quote listing with no delist function are enforced by code
that does not exist, not by an owner choosing not to call it. What direct
ownership costs is the notice period on the narrow set of
config-for-future-launches and constrained-rescue powers in §7.

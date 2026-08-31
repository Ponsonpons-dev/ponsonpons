# $POP mainnet deployment runbook

Every step below was executed end-to-end on an Anvil fork of Robinhood
Chain mainnet (block ~50,500,000) on 2026-08-31, including the timelock
governance handover and a complete launch lifecycle against real $PONS and
the real canonical Uniswap V4 PoolManager. The fork transcript's key
results are recorded at the bottom.

## Choose a governance model first

The script supports two, and the choice changes what the site is allowed to
claim. Set `NEXT_PUBLIC_GOVERNANCE` on the frontend to match, or /proof and
the trust docs will describe a deployment that does not exist.

| | `USE_TIMELOCK=true` (default) | `USE_TIMELOCK=false` |
| --- | --- | --- |
| Owner of the four ownable contracts | 48h `TimelockController` | `PROTOCOL_OWNER` directly |
| Owner changes take effect | after 48h, publicly visible first | immediately |
| Frontend `NEXT_PUBLIC_GOVERNANCE` | `timelock` | `direct` |

Direct ownership is the weaker model and the site says so in as many words.
It is also what pons-factory.fun runs (a single EOA owns their factory and
locker), so it is not unusual on this chain; base Pons uses a 2-of-3 Safe
with no timelock. Whichever you pick, the guarantees that actually matter,
locked liquidity, frozen fee terms, no creator-fee override, permissionless
quote listing, hold in both, because they are enforced by absent code rather
than by governance.

## Prerequisites

1. **Protocol owner**: the address that receives protocol fees and owns the
   four ownable contracts (directly, or as proposer/executor on the
   timelock). A Safe is strongly preferred; Safe v1.4.1 is deployed on
   Robinhood Chain (factory `0x4e1DCf7A...ec67`), so creating one is a
   single factory call.
2. **Deployer EOA** with ~0.02 ETH on chain 4663 (fork estimate: 0.0125
   ETH gas at 0.46 gwei).
3. **Archive-grade RPC** (the public endpoint Cloudflare-challenges heavy
   clients; a Chainstack endpoint or the throttling proxy in
   `ops/`-adjacent tooling works).

## Step 1, deploy

```bash
cd contracts

# With the 48h timelock (default):
PROTOCOL_OWNER=0x<safe> forge script script/Deploy.s.sol \
  --rpc-url $RPC --broadcast --private-key $DEPLOYER_KEY \
  --verify --verifier sourcify

# Or owned directly, no timelock:
PROTOCOL_OWNER=0x<addr> USE_TIMELOCK=false forge script script/Deploy.s.sol \
  --rpc-url $RPC --broadcast --private-key $DEPLOYER_KEY \
  --verify --verifier sourcify
```

What the script does, in order: deploys the 48h `TimelockController` when
`USE_TIMELOCK` is left on (`PROTOCOL_OWNER` as sole proposer+executor,
self-administered) and skips it otherwise, `PopFeeEscrow`
(ownerless), `PopLocker`, mines and CREATE2-deploys `PopHook` at an
address carrying its permission bits, deploys the `PonsV1QuoteAdapter` +
`PopQuoteRegistry`, the factory + executor + deployer, wires everything,
adds launch config 0 (1B supply / 1% fee / tick spacing 200), **lists
$PONS** through the permissionless path, transfers ownership of
factory/hook/locker/registry to the timelock, or straight to
`PROTOCOL_OWNER` (two-step either way), and writes `deployments/4663.json`.
That file records `governance` as `timelock` or `direct`, and a zero
`timelock` address means ownership is direct.

Note: the factory deploys with `launchEnabled = false` (whitelist-only).
This is deliberate, see step 3.

## Step 2, governance handover

Ownership transfer is two-step in both models: the new owner must call
`acceptOwnership()` on factory, hook, locker and registry. **The deployment
is not finished until all four land.**

Without a timelock, that is four direct calls from `PROTOCOL_OWNER`:

```bash
for c in $FACTORY $HOOK $LOCKER $REGISTRY; do
  cast send $c "acceptOwnership()" --rpc-url $RPC --private-key $OWNER_KEY
done
```

With a timelock, the calls must be **executed by the timelock**, which
means: schedule, wait 48h, execute. For each of factory, hook, locker,
registry (addresses from `deployments/4663.json`):

```
schedule(target, 0, 0x79ba5097 /* acceptOwnership() */, 0x0, 0x0, 172800)
# … 48h later …
execute(target, 0, 0x79ba5097, 0x0, 0x0)
```

Until all four accepts execute, the deployer EOA remains owner, treat the
deployment as incomplete and do not announce. The /proof page should link
all four execute transactions.

Verified on fork: all four schedules + executes succeed; `owner()` of each
contract reads the timelock afterward.

## Step 3, go live

Public launching is the multisig's first timelocked action, which doubles
as a 48-hour public notice:

```
schedule(factory, 0, setLaunchEnabled(true), 0x0, 0x0, 172800)  → execute
```

(Optionally whitelist a few creators immediately via
`setWhitelistedLauncher` for a soft-launch during the notice window,
also timelocked.)

## Step 4, services

- `indexer/`: fill `.env` from `deployments/4663.json` (+
  `POP_START_BLOCK` = factory deploy block), `docker compose up -d`.
- `frontend/`: fill `.env.local` (addresses, indexer URL, WalletConnect
  id), deploy to Vercel.
- `ops/keeper.mjs`: run under pm2/systemd with a funded keeper key.
- List more quotes any time, permissionless: `registry.listQuote(token, 0)`
  for any graduated Pons v1 token above the 25-WETH locked floor
  ($DELTA, $HMM, … candidates in docs/ARCHITECTURE.md §6).

## Fork dry-run results (2026-08-31)

- Deploy: 27.2M gas total; hook mined to a valid flags address; $PONS
  listed with live-TWAP economics **threshold 33,197.7 PONS / phantom
  13,279.1 PONS** (exactly 2.5 ratio, ≈4.2 ETH at the real V3 TWAP).
- Governance: 4× acceptOwnership + setLaunchEnabled all through
  schedule→48h→execute.
- Launch lifecycle: SMOKE launched quoted in real $PONS (QuoteBurn 50%,
  1% creator fee) → 100k-PONS buyout partially filled to exactly the
  sellable allocation → **auto-graduation was gas-starved by the wallet's
  estimate (expected; the crossing buyer's estimate doesn't price the
  try/catch branch)** → permissionless `graduate` + `createGraduatedPool`
  completed it, which is precisely the keeper's job → position #1264549
  minted by the canonical PositionManager **owned by PopLocker**, 81.63M
  SMOKE (8.163% of supply, matching the closed-form derivation) locked
  forever, and **287.94 real $PONS burned to 0xdead**.
- Frontend follow-up shipped: crossing buys get a 2.5M gas floor so
  atomic graduation usually succeeds in the buy itself.

# $POP, Pons on Pons

Non-custodial launchpad on Robinhood Chain (chain id 4663). New tokens launch
on a constant-product bonding curve **quoted in a graduated Pons token**
(e.g. $PONS) and graduate into a **permanently locked, full-range Uniswap V4
position** governed by an immutable-policy hook. Mechanics adapted from the
verified PonsV2 launchpad sources (MIT); trust model rebuilt around
"no owner function can touch user value." See `../docs/ARCHITECTURE.md` for
the full Phase 0 discovery and design rationale.

## Contracts

| Contract | Role |
|---|---|
| `PopQuoteRegistry` | Permissionless, rule-based quote-token allowlist: on-chain graduation proof via origin adapters + a locked-ETH-liquidity floor enforced live at every launch. TWAP-derived curve economics per quote, with rate-limited, clamped, permissionless re-pegs. No delist function exists. |
| `adapters/PonsV1QuoteAdapter` | Proves a token graduated on Pons v1 and reads its locked WETH principal + V3 TWAP. Stateless, ownerless. |
| `PopLaunchFactory` | Deploys curve+token per launch (CREATE2, vanity-minable), snapshots all economics, orchestrates two-phase permissionless graduation. Owner configures **future launches only**; rescue paths are time-delayed and fixed-recipient. |
| `PopBondingCurve` | Virtual-reserve constant-product curve, ERC-20 quote, quote-denominated fees, decaying snipe tax, partial final fill, donation-proof tracked reserves. Fee sweep is fully permissionless (no swaps: burn is a transfer, rebate is instant). |
| `PopLaunchToken` | Plain fixed-supply ERC-20. No owner, no mint, no hooks, nothing. |
| `PopRewardToken` | The HolderRewards variant: same fixed supply, plus a cumulative-accumulator distributor that pays quote to holders. Permissionless `sync()`, immutable exclusion set, pull-payment `claim()`. |
| `PopHook` | Shared V4 hook: afterSwap fee on the unspecified leg, split identically to the curve. Fee policy is **constructor-immutable**; only the recipient/operator rotate, and only by the owner. |
| `PopGraduationGuard` / `PopGraduationExecutor` / `PopLaunchDeployer` | Seed preflight, Permit2+PositionManager mint encoding, CREATE2 deployment, split out for EIP-170 headroom, mirroring the reference architecture. |
| `PopLocker` | Holds every graduated LP NFT and the virtual-reserve supply excess forever. No withdraw, no transfer, no arbitrary call. |
| `PopFeeEscrow` | Pull-payment ledger for all revenue (protocol, creator, trader rebates). Ownerless. |

## Fee matrix (per launch, immutable from creation)

- Base curve/hook fee: 1% of every trade's quote leg → 50% protocol / 50% creator (protocol share at the hook's hard cap).
- Creator fee: 0-2%, creator-chosen, all to creator.
- Cashback mode (carved from the creator's take, so trader cost never changes):
  - **QuoteBurn**: that share of the quote token goes to `0xdead`, pre- and post-graduation. No swap, no oracle, no operator.
  - **TraderRebate**: that share is credited back to the trade's recipient in the same transaction (curve phase only; reverts to creator post-graduation, disclosed at creation).
  - **HolderRewards**: that share is pushed to the launch token, which pays it pro-rata to its holders continuously, before and after graduation. No staking, no snapshots, no operator. This is the only mode that changes the launch token: it deploys `PopRewardToken` (accounting-only transfer hook, still no owner/mint/pause/blacklist) instead of the inert `PopLaunchToken`.
- Anti-snipe: 99% → 0 exponential-decay tax over the launch window (snapshotted per launch), creator + declared bundle wallets exempt.

## Build & test

```bash
forge build
forge test                      # unit + invariant suites (local real V4)

# fork suite, offline, no endpoint needed (see below)
cp -r test/fork/cache/4663 ~/.foundry/cache/rpc/
RUN_FORK_TESTS=true node script/fork-cache-server.mjs -- \
  forge test --match-path "test/fork/*"
```

The fork suite runs the whole lifecycle against Robinhood Chain mainnet:
real Pons v1 factories (graduation proof + TWAP for $PONS), real canonical
V4 PoolManager/PositionManager/Permit2, real $PONS as quote.

### Why it replays from a committed cache

Robinhood Chain's public endpoint keeps **state** for only a few thousand
blocks (minutes, at Orbit block times) and refuses state queries at its own
head. So there is no block you can pin the suite to and still read: the window
closes before the run is even reproducible, and archive access to chain 4663
means a paid provider.

Foundry's on-disk RPC cache solves it. The state the suite touches at
`PINNED_FORK_BLOCK` is committed under `test/fork/cache/<chainId>/<block>`, so
the run replays real mainnet state indefinitely. `vm.createSelectFork` still
insists on three live calls before it will consult that cache, `eth_chainId`,
`eth_gasPrice`, and the pinned header, and `script/fork-cache-server.mjs`
serves those from `test/fork/cache/handshake.json`. Net result: the suite is
hermetic, runs in ~30ms, needs no archive provider or secret, and works on fork
PRs. It is wired into CI exactly as above.

Any request beyond the cache fails loudly with the fix in the error message
rather than silently reaching for the network.

### Re-pinning

Change what the fork tests read and the cache no longer covers them. Regenerate
it. this is the one step that needs a live endpoint and a recent block:

```bash
./script/warm-fork-cache.sh     # ROBINHOOD_RPC_URL=... to override the public RPC
```

It re-pins to `head - 64`, rewrites both fixtures and `PINNED_FORK_BLOCK`, then
verifies the offline replay. Commit all three together, they only work as a set.

To run against a live chain instead (needs an archive endpoint, or a block
minutes old), set `FORK_BLOCK` explicitly, or `FORK_BLOCK=0` to fork from head.
Note the public RPC Cloudflare-challenges Foundry's client, so that path also
wants a local forwarding proxy.

## Deploy

```bash
PROTOCOL_OWNER=0x... forge script script/Deploy.s.sol \
  --rpc-url $ROBINHOOD_RPC_URL --broadcast --verify --verifier sourcify
```

Deploys the stack, mines the hook address, wires everything, lists $PONS,
writes `deployments/4663.json`, and two-step-transfers ownership of
factory/hook/locker/registry to a fresh 48h `TimelockController`
(`PROTOCOL_OWNER` as proposer+executor), or straight to `PROTOCOL_OWNER`
when run with `USE_TIMELOCK=false`. **The new owner must then execute the
four `acceptOwnership()` calls** (through the timelock, if there is one);
the `/proof` page links
those transactions.

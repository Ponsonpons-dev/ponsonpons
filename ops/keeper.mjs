#!/usr/bin/env node
/**
 * $POP keeper: the only off-chain job the protocol wants (never needs,
 * every call here is permissionless and safe for anyone to run).
 *
 * It watches every launch the indexer still shows as Trading and calls
 * `bond(token, 0)` the moment the curve pins at its bond tick. The
 * conversion's price floor is the on-chain 30-minute TWAP bound, so a
 * zero caller minimum is safe. Bond windows last seconds (bots trade
 * curves right up to the line), so readiness is checked on a fast cadence
 * while the launch list refreshes on a slower one.
 *
 * It also sweeps every known pool on a slower cadence so creator fees land
 * in the claimable escrow on their own. That half only works when this
 * wallet holds the hook's `feeSweepOperator` role: converting launch-token
 * fees means an internal swap whose price floor the caller supplies, so the
 * hook restricts it to that one address. Without the role the sweeps are
 * simply skipped and the bond watcher still runs.
 *
 * The revenue splitter's and burner's `distribute`/`convertAndDistribute`
 * cranks are permissionless and can be added here later.
 *
 * Env: KEEPER_PRIVATE_KEY (required), RPC_URL, FACTORY, HOOK, INDEXER_URL,
 *      CHECK_MS (2000), LIST_MS (30000), SWEEP_MS (900000, 0 disables),
 *      SWEEP_SLIPPAGE_BPS (700).
 */
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatEther,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const factoryAbi = parseAbi([
  "function isBondReady(address token) view returns (bool)",
  "function bond(address token, uint256 minQuoteOut) returns (uint256)",
  "function curvePoolKey(address token) view returns ((address,address,uint24,int24,address))",
  "function bondedPoolKey(address token) view returns ((address,address,uint24,int24,address))",
]);

const hookAbi = parseAbi([
  "function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut)",
  "error SlippageExceeded(uint256 actual, uint256 minimum)",
]);

const RPC_URL = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.FACTORY ?? "0x461523A203fAea6520089A620b9321e5bd37b440";
const HOOK = process.env.HOOK ?? "0xf91f859e21dC93da086f38e0105ad96C05d22044";
const INDEXER = process.env.INDEXER_URL ?? "http://localhost:42069";
const CHECK_MS = Number(process.env.CHECK_MS ?? 2_000);
const LIST_MS = Number(process.env.LIST_MS ?? 30_000);
/** How often every known pool is swept so creators can just claim. 0 disables. */
const SWEEP_MS = Number(process.env.SWEEP_MS ?? 900_000);
/** Slippage room below the simulated conversion output, in basis points. */
const SWEEP_SLIPPAGE_BPS = BigInt(process.env.SWEEP_SLIPPAGE_BPS ?? 700);
const LOW_BALANCE = 5_000_000_000_000_000n; // 0.005 ETH

if (!process.env.KEEPER_PRIVATE_KEY) {
  console.error("KEEPER_PRIVATE_KEY is required");
  process.exit(1);
}

const chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const account = privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

let tokens = [];
/** Graduated launches keep earning, so they stay in the sweep rotation. */
let bondedTokens = [];
const inFlight = new Set();

async function refreshLaunches() {
  try {
    const res = await fetch(`${INDEXER}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query { trading: launchs(where: {phase: 0}, limit: 1000) { items { token } } bonded: launchs(where: {phase: 1}, limit: 1000) { items { token } } }`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json();
    const trading = body.data?.trading?.items;
    const bonded = body.data?.bonded?.items;
    if (trading) tokens = trading.map((i) => i.token);
    if (bonded) bondedTokens = bonded.map((i) => i.token);
  } catch (err) {
    console.error(`indexer unreachable: ${err.message}`);
  }
}

/** Wallets on this chain quote the bare base fee; give bond txs real headroom. */
async function fees() {
  const block = await publicClient.getBlock();
  const base = block.baseFeePerGas ?? 500_000_000n;
  // The explicit gas limit matters: estimating with fee caps but no gas makes
  // this chain's node check affordability against the block gas cap, which
  // rejects any sanely funded wallet with "exceeds the balance".
  return { gas: 3_000_000n, maxFeePerGas: base * 3n + 10_000_000n, maxPriorityFeePerGas: 10_000_000n };
}

async function bond(token) {
  if (inFlight.has(token)) return;
  inFlight.add(token);
  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: FACTORY,
      abi: factoryAbi,
      functionName: "bond",
      args: [token, 0n],
      ...(await fees()),
    });
    const hash = await wallet.writeContract(request);
    log(`bond(${token}) sent: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status === "success") {
      log(`BONDED ${token} in block ${receipt.blockNumber}`);
      tokens = tokens.filter((t) => t !== token);
    } else {
      log(`bond(${token}) reverted on chain, will retry while ready`);
    }
  } catch (err) {
    // NotBondReady between simulate and send is normal (a bot sold); the
    // fast loop retries as long as the curve is pinned.
    console.error(`bond(${token}) attempt failed: ${err.shortMessage ?? err.message}`);
  } finally {
    inFlight.delete(token);
  }
}

async function checkAll() {
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const ready = await publicClient.readContract({
          address: FACTORY,
          abi: factoryAbi,
          functionName: "isBondReady",
          args: [token],
        });
        if (ready) await bond(token);
      } catch (err) {
        console.error(`isBondReady(${token}) failed: ${err.shortMessage ?? err.message}`);
      }
    }),
  );
}

/**
 * Sweeping moves fees out of the hook's per-pool buckets and into the escrow
 * every creator can claim from. Whenever a pool holds launch-token fees the
 * sweep has to convert them, and the hook only lets its trusted operator do
 * that (the caller sets the price floor), so without this crank a creator's
 * Claim button stays empty until someone with the operator key acts. The floor
 * comes from simulating the sweep with an unreachable minimum: the revert
 * carries the real output, which is then discounted by SWEEP_SLIPPAGE_BPS.
 */
async function sweepPool(poolId) {
  let quoted = 0n;
  try {
    await publicClient.simulateContract({
      account,
      address: HOOK,
      abi: hookAbi,
      functionName: "sweepPoolFees",
      args: [poolId, 2n ** 255n],
    });
    // No conversion was needed, so any floor is satisfied.
  } catch (err) {
    const slip = [err, err?.cause, err?.cause?.cause].find((e) => e?.data?.errorName === "SlippageExceeded");
    if (slip) quoted = slip.data.args[0];
    else return; // nothing pending, or the pool cannot convert right now
  }
  const minOut = (quoted * (10_000n - SWEEP_SLIPPAGE_BPS)) / 10_000n;
  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: HOOK,
      abi: hookAbi,
      functionName: "sweepPoolFees",
      args: [poolId, minOut],
      ...(await fees()),
    });
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    log(`swept ${poolId} (min ${minOut}): ${hash}`);
  } catch (err) {
    console.error(`sweep(${poolId}) failed: ${err.shortMessage ?? err.message}`);
  }
}

async function sweepAll() {
  for (const token of [...tokens, ...bondedTokens]) {
    for (const fn of ["curvePoolKey", "bondedPoolKey"]) {
      try {
        const key = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: fn, args: [token] });
        await sweepPool(poolIdOf(key));
      } catch {
        /* a launch has no bonded pool until it graduates */
      }
    }
  }
}

function poolIdOf(key) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [key[0], key[1], key[2], key[3], key[4]],
    ),
  );
}

async function balanceWatch() {
  try {
    const bal = await publicClient.getBalance({ address: account.address });
    if (bal < LOW_BALANCE) {
      console.error(`LOW GAS: keeper ${account.address} holds ${formatEther(bal)} ETH, top it up`);
    }
  } catch {
    /* transient RPC failure; next hourly check reports */
  }
}

log(`keeper up: factory ${FACTORY}, wallet ${account.address}, check every ${CHECK_MS}ms`);
await refreshLaunches();
await balanceWatch();
setInterval(refreshLaunches, LIST_MS);
setInterval(checkAll, CHECK_MS);
setInterval(balanceWatch, 3_600_000);
if (SWEEP_MS > 0) {
  await sweepAll();
  setInterval(sweepAll, SWEEP_MS);
}

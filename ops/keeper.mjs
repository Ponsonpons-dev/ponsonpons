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
 * Hook fee sweeps (`sweepPoolFees`) are operator-gated whenever a
 * conversion is involved and belong to the feeSweepOperator wallet; wire
 * that separately once revenue justifies it. The revenue splitter's and
 * burner's `distribute`/`convertAndDistribute` cranks are also
 * permissionless and can be added here later.
 *
 * Env: KEEPER_PRIVATE_KEY (required), RPC_URL, FACTORY, INDEXER_URL,
 *      CHECK_MS (2000), LIST_MS (30000).
 */
import { createPublicClient, createWalletClient, formatEther, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const factoryAbi = parseAbi([
  "function isBondReady(address token) view returns (bool)",
  "function bond(address token, uint256 minQuoteOut) returns (uint256)",
]);

const RPC_URL = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.FACTORY ?? "0x461523A203fAea6520089A620b9321e5bd37b440";
const INDEXER = process.env.INDEXER_URL ?? "http://localhost:42069";
const CHECK_MS = Number(process.env.CHECK_MS ?? 2_000);
const LIST_MS = Number(process.env.LIST_MS ?? 30_000);
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
const inFlight = new Set();

async function refreshLaunches() {
  try {
    const res = await fetch(`${INDEXER}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query { launchs(where: {phase: 0}, limit: 1000) { items { token } } }`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json();
    const items = body.data?.launchs?.items;
    if (items) tokens = items.map((i) => i.token);
  } catch (err) {
    console.error(`indexer unreachable: ${err.message}`);
  }
}

/** Wallets on this chain quote the bare base fee; give bond txs real headroom. */
async function fees() {
  const block = await publicClient.getBlock();
  const base = block.baseFeePerGas ?? 500_000_000n;
  return { maxFeePerGas: base * 3n + 10_000_000n, maxPriorityFeePerGas: 10_000_000n };
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

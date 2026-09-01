#!/usr/bin/env node
/**
 * $POP keeper: the only off-chain job the protocol wants (never needs,
 * every call here is permissionless and safe for anyone to run).
 *
 * Each tick it:
 *  1. finds launches whose ETH curve has filled (`isBondReady`) and calls
 *     `bond(token, 0)`; the conversion's price floor is the on-chain
 *     30-minute TWAP bound, so a zero caller minimum is safe;
 *  2. re-checks launches the indexer still shows as Trading in case a
 *     BondReady event was missed.
 *
 * Hook fee sweeps (`sweepPoolFees`) are operator-gated whenever a
 * conversion is involved and belong to the feeSweepOperator wallet; wire
 * that separately once revenue justifies it. The revenue splitter's and
 * burner's `distribute`/`convertAndDistribute` cranks are also
 * permissionless and can be added here later.
 *
 * Env: RPC_URL, KEEPER_PRIVATE_KEY, FACTORY, INDEXER_URL, INTERVAL_MS
 *      (60000).
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const factoryAbi = parseAbi([
  "function isBondReady(address token) view returns (bool)",
  "function bond(address token, uint256 minQuoteOut) returns (uint256)",
]);

const RPC_URL = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.FACTORY;
const INDEXER = process.env.INDEXER_URL ?? "http://localhost:42069";
const INTERVAL = Number(process.env.INTERVAL_MS ?? 60_000);

if (!FACTORY || !process.env.KEEPER_PRIVATE_KEY) {
  console.error("FACTORY and KEEPER_PRIVATE_KEY are required");
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

async function tradingLaunches() {
  const res = await fetch(`${INDEXER}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query { launchs(where: {phase: 0}, limit: 1000) { items { token } } }`,
    }),
  });
  const body = await res.json();
  return body.data?.launchs?.items ?? [];
}

async function send(label, functionName, args) {
  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: FACTORY,
      abi: factoryAbi,
      functionName,
      args,
    });
    const hash = await wallet.writeContract(request);
    console.log(`${new Date().toISOString()} ${label}: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  } catch (err) {
    console.error(`${new Date().toISOString()} ${label} failed: ${err.shortMessage ?? err.message}`);
  }
}

async function tick() {
  let launches;
  try {
    launches = await tradingLaunches();
  } catch (err) {
    console.error(`indexer unreachable: ${err.message}`);
    return;
  }

  for (const l of launches) {
    try {
      const ready = await publicClient.readContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "isBondReady",
        args: [l.token],
      });
      if (ready) await send(`bond(${l.token})`, "bond", [l.token, 0n]);
    } catch (err) {
      console.error(`isBondReady(${l.token}) failed: ${err.shortMessage ?? err.message}`);
    }
  }
}

console.log(`keeper up: factory ${FACTORY}, every ${INTERVAL}ms`);
await tick();
setInterval(tick, INTERVAL);

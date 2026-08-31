#!/usr/bin/env node
/**
 * $POP keeper: the only off-chain job the protocol wants (never needs,
 * every call here is permissionless and safe for anyone to run).
 *
 * Each tick it:
 *  1. finds launches stuck in Swept (graduation phase 1 done, pool not yet
 *     seeded, e.g. the crossing buyer starved the auto-graduation of gas)
 *     and calls `createGraduatedPool`;
 *  2. finds curves that are readyToGraduate but not yet swept (auto-grad
 *     reverted entirely) and calls `graduate`;
 *  3. sweeps curve fee buckets past a threshold so burns and escrow credits
 *     land regularly (sweepFees is permissionless, no operator needed on
 *     the curve).
 *
 * Hook conversion sweeps (meme-side fees → quote) are operator-gated with a
 * price floor and belong to the feeSweepOperator wallet; wire that
 * separately once revenue justifies it.
 *
 * Env: RPC_URL, KEEPER_PRIVATE_KEY, FACTORY, INDEXER_URL,
 *      SWEEP_MIN_QUOTE (default 0 = sweep anything), INTERVAL_MS (60000).
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const factoryAbi = parseAbi([
  "function graduate(address token)",
  "function createGraduatedPool(address token) returns (uint256)",
  "function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address quoteToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorFeeBps,(uint8 mode,uint16 shareBps) cashback,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);
const curveAbi = parseAbi([
  "function readyToGraduate() view returns (bool)",
  "function graduated() view returns (bool)",
  "function sweepFees()",
  "function pendingProtocolFees() view returns (uint256)",
  "function pendingCreatorFees() view returns (uint256)",
  "function pendingBurn() view returns (uint256)",
]);

const RPC_URL = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.FACTORY;
const INDEXER = process.env.INDEXER_URL ?? "http://localhost:42069";
const SWEEP_MIN = BigInt(process.env.SWEEP_MIN_QUOTE ?? "0");
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

async function activeLaunches() {
  const res = await fetch(`${INDEXER}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query { launchs(where: {phase_lt: 2}, limit: 1000) { items { token curve phase } } }`,
    }),
  });
  const body = await res.json();
  return body.data?.launchs?.items ?? [];
}

async function send(label, target, abi, functionName, args) {
  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: target,
      abi,
      functionName,
      args,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[keeper] ${label}: ${receipt.status} ${hash}`);
  } catch (e) {
    console.error(`[keeper] ${label} failed: ${(e.shortMessage ?? e.message ?? e).slice(0, 160)}`);
  }
}

async function tick() {
  const launches = await activeLaunches().catch((e) => {
    console.error("[keeper] indexer unreachable:", e.message);
    return [];
  });

  for (const l of launches) {
    if (l.phase === 1) {
      await send(`seed pool ${l.token}`, FACTORY, factoryAbi, "createGraduatedPool", [l.token]);
      continue;
    }

    const [ready, graduated] = await Promise.all([
      publicClient.readContract({ address: l.curve, abi: curveAbi, functionName: "readyToGraduate" }),
      publicClient.readContract({ address: l.curve, abi: curveAbi, functionName: "graduated" }),
    ]);
    if (ready && !graduated) {
      await send(`graduate ${l.token}`, FACTORY, factoryAbi, "graduate", [l.token]);
      continue;
    }

    if (!graduated) {
      const [p, c, b] = await Promise.all(
        ["pendingProtocolFees", "pendingCreatorFees", "pendingBurn"].map((fn) =>
          publicClient.readContract({ address: l.curve, abi: curveAbi, functionName: fn }),
        ),
      );
      if (p + c + b > SWEEP_MIN) {
        await send(`sweep ${l.token}`, l.curve, curveAbi, "sweepFees", []);
      }
    }
  }
}

console.log(`[keeper] running as ${account.address} against ${FACTORY}, every ${INTERVAL}ms`);
for (;;) {
  await tick();
  await new Promise((r) => setTimeout(r, INTERVAL));
}

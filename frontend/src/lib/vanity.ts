/**
 * The ...909 vanity miner: every token launched through the create flow lands
 * at an address ending in 0x909.
 *
 * How: the token's address is CREATE2-derived from the creator's salt, so the
 * browser grinds salts until the predicted address matches. The prediction
 * mirrors PopLaunchDeployer exactly, using the same creation bytecode the
 * factory deploys (exported from the build by
 * contracts/script/export-vanity-artifacts.py). With the bonding curve now
 * living inside the launch's own V4 pool there is no second contract to
 * derive, so the initcode hash is constant per launch and each candidate is
 * a single CREATE2 hash.
 *
 * Two guard rails make drift inert rather than dangerous:
 *  - the create page verifies the winning salt against the deployer's own
 *    `predictLaunchAddress` before launching, and falls back to a random
 *    salt on mismatch;
 *  - the launch's economics pin means a launch lands exactly as predicted or
 *    reverts, never somewhere else.
 *
 * vanity.test.ts replays a fixture written by the deployer contract itself
 * (contracts/test/unit/VanityFixture.t.sol), so the two implementations are
 * cross-checked on every test run.
 */
import { concat, encodeAbiParameters, getCreate2Address, keccak256, toHex } from "viem";

import { LAUNCH_TOKEN_CREATION, REWARD_TOKEN_CREATION } from "../abis/initcode.ts";

export const VANITY_SUFFIX = "909";

const DEAD = "0x000000000000000000000000000000000000dEaD" as const;

export type Address = `0x${string}`;

export type LaunchInputs = {
  // Creator-controlled.
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
  originalDeployer: Address;
  cashback: { mode: number; shareBps: number };
  // Protocol state, read from chain at mining time. The economics pin in the
  // launch transaction guarantees these are still live when it lands.
  quoteToken: Address;
  supply: bigint;
  // Deployment topology.
  launchDeployer: Address;
  rewardTokenDeployer: Address;
  factory: Address;
  hook: Address;
  locker: Address;
  poolManager: Address;
};

const SOCIALS_ABI = {
  type: "tuple",
  components: [
    { type: "string" },
    { type: "string" },
    { type: "string" },
    { type: "string" },
    { type: "string" },
  ],
} as const;

function socialsValue(s: LaunchInputs["socials"]) {
  return [s.twitter, s.telegram, s.discord, s.website, s.farcaster] as const;
}

/** keccak256(abi.encode(originalDeployer, seed)), the deployer's salt space. */
export function launchSalt(originalDeployer: Address, seed: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [originalDeployer, seed]),
  );
}

/**
 * The token's creation-code hash, constant across salts for fixed inputs,
 * plus which contract CREATE2-deploys it.
 */
export function tokenInit(i: LaunchInputs): { hash: `0x${string}`; create2Deployer: Address } {
  const rewards = i.cashback.mode === 3;
  const args = rewards
    ? encodeAbiParameters(
        [
          { type: "string" },
          { type: "string" },
          { type: "string" },
          { type: "string" },
          SOCIALS_ABI,
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
          { type: "address[]" },
        ],
        [
          i.name,
          i.symbol,
          i.logo,
          i.description,
          socialsValue(i.socials),
          i.originalDeployer,
          i.factory,
          i.factory,
          i.quoteToken,
          i.supply,
          [i.factory, i.hook, i.locker, i.poolManager, DEAD],
        ],
      )
    : encodeAbiParameters(
        [
          { type: "string" },
          { type: "string" },
          { type: "string" },
          { type: "string" },
          SOCIALS_ABI,
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
        ],
        [
          i.name,
          i.symbol,
          i.logo,
          i.description,
          socialsValue(i.socials),
          i.originalDeployer,
          i.factory,
          i.factory,
          i.supply,
        ],
      );

  const creation = rewards ? REWARD_TOKEN_CREATION : LAUNCH_TOKEN_CREATION;
  return {
    hash: keccak256(concat([creation, args])),
    create2Deployer: rewards ? i.rewardTokenDeployer : i.launchDeployer,
  };
}

/** Predicts the token address for one seed, exactly as the deployer would. */
export function predict(
  i: LaunchInputs,
  init: { hash: `0x${string}`; create2Deployer: Address },
  seed: `0x${string}`,
): { salt: `0x${string}`; token: Address } {
  const salt = launchSalt(i.originalDeployer, seed);
  const token = getCreate2Address({ from: init.create2Deployer, salt, bytecodeHash: init.hash });
  return { salt, token };
}

export type MineResult = {
  seed: `0x${string}`;
  salt: `0x${string}`;
  token: Address;
  iterations: number;
};

/**
 * Grinds seeds until the predicted token address ends in `suffix`. Async so
 * the caller can keep the UI alive; yields to the event loop between chunks.
 */
export async function mineVanitySalt(
  i: LaunchInputs,
  opts: {
    suffix?: string;
    maxIterations?: number;
    onProgress?: (done: number) => void;
    entropy?: `0x${string}`;
  } = {},
): Promise<MineResult | null> {
  const suffix = (opts.suffix ?? VANITY_SUFFIX).toLowerCase();
  const maxIterations = opts.maxIterations ?? 200_000;
  const init = tokenInit(i);
  const base = opts.entropy ?? toHex(crypto.getRandomValues(new Uint8Array(32)));

  for (let n = 0; n < maxIterations; n++) {
    const seed = keccak256(concat([base, toHex(n, { size: 8 })]));
    const candidate = predict(i, init, seed);
    if (candidate.token.toLowerCase().endsWith(suffix)) {
      return { seed, ...candidate, iterations: n + 1 };
    }
    if (n % 500 === 499) {
      opts.onProgress?.(n + 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return null;
}

/** A cryptographically random seed for the no-vanity fallback. */
export function randomSeed(): `0x${string}` {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * The ...909 vanity miner: every token launched through the create flow lands
 * at an address ending in 0x909.
 *
 * How: the token's address is CREATE2-derived from the creator's salt, so the
 * browser grinds salts until the predicted address matches. The prediction
 * mirrors PopLaunchDeployer exactly, curve first (its address is a token
 * constructor argument), then the token, using the same creation bytecode the
 * factory deploys (exported from the build by
 * contracts/script/export-vanity-artifacts.py).
 *
 * Two guard rails make drift inert rather than dangerous:
 *  - the create page verifies the winning salt against the deployer's own
 *    `predictLaunchAddresses` before launching, and falls back to a random
 *    salt on mismatch;
 *  - the launch's economics pin means a launch lands exactly as predicted or
 *    reverts, never somewhere else.
 *
 * vanity.test.ts replays a fixture written by the deployer contract itself
 * (contracts/test/unit/VanityFixture.t.sol), so the two implementations are
 * cross-checked on every test run.
 */
import {
  concat,
  encodeAbiParameters,
  getCreate2Address,
  hexToBytes,
  keccak256,
  toBytes,
  toHex,
} from "viem";

import {
  BONDING_CURVE_CREATION,
  LAUNCH_TOKEN_CREATION,
  REWARD_TOKEN_CREATION,
} from "../abis/initcode.ts";

export const VANITY_SUFFIX = "909";

const DEAD = "0x000000000000000000000000000000000000dEaD" as const;
// Placed where the curve address goes while building the token template, then
// located by scanning for its 32-byte-padded form. Never a real address.
const SENTINEL = "0xc0ffee00c0ffee00c0ffee00c0ffee00c0ffee00" as const;

export type Address = `0x${string}`;

export type LaunchInputs = {
  // Creator-controlled.
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
  creatorFeeRecipient: Address; // resolved: zero replaced by the launcher
  originalDeployer: Address;
  creatorFeeBps: number;
  cashback: { mode: number; shareBps: number };
  // Protocol state, read from chain at mining time. The economics pin in the
  // launch transaction guarantees these are still live when it lands.
  quoteToken: Address;
  protocolFeeRecipient: Address;
  protocolFeeShareBps: number;
  feeEscrow: Address;
  phantomQuote: bigint;
  curveFeeBps: bigint;
  graduationThreshold: bigint;
  supply: bigint;
  // Deployment topology.
  launchDeployer: Address;
  rewardTokenDeployer: Address;
  factory: Address;
  graduationExecutor: Address;
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

const CASHBACK_ABI = { type: "tuple", components: [{ type: "uint8" }, { type: "uint16" }] } as const;

function socialsValue(s: LaunchInputs["socials"]) {
  return [s.twitter, s.telegram, s.discord, s.website, s.farcaster] as const;
}

/** keccak256(abi.encode(originalDeployer, seed)), the deployer's salt space. */
export function launchSalt(originalDeployer: Address, seed: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [originalDeployer, seed]),
  );
}

/** The curve's creation code hash; constant across salts for fixed inputs. */
export function curveInitHash(i: LaunchInputs): `0x${string}` {
  const args = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint16" },
      CASHBACK_ABI,
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [
      i.quoteToken,
      i.creatorFeeRecipient,
      i.factory,
      i.protocolFeeRecipient,
      i.protocolFeeShareBps,
      [i.cashback.mode, i.cashback.shareBps],
      i.feeEscrow,
      i.phantomQuote,
      i.curveFeeBps,
      BigInt(i.creatorFeeBps),
      i.graduationThreshold,
    ],
  );
  return keccak256(concat([BONDING_CURVE_CREATION, args]));
}

type TokenTemplate = {
  bytes: Uint8Array;
  curveOffsets: number[];
  create2Deployer: Address;
};

/**
 * Builds the token initcode once with a sentinel where the curve address
 * goes, and records every 32-byte-aligned slot holding it. Per-candidate
 * mining then patches those slots and rehashes, which is what makes the
 * grind cheap enough for the browser.
 */
export function tokenTemplate(i: LaunchInputs): TokenTemplate {
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
          SENTINEL,
          i.factory,
          i.quoteToken,
          i.supply,
          [SENTINEL, i.factory, i.graduationExecutor, i.locker, i.poolManager, DEAD],
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
          SENTINEL,
          i.factory,
          i.supply,
        ],
      );

  const code = hexToBytes(rewards ? REWARD_TOKEN_CREATION : LAUNCH_TOKEN_CREATION);
  const argBytes = hexToBytes(args);
  const bytes = new Uint8Array(code.length + argBytes.length);
  bytes.set(code);
  bytes.set(argBytes, code.length);

  // The sentinel appears as the low 20 bytes of a zero-padded word.
  const padded = hexToBytes(("0x" + "00".repeat(12) + SENTINEL.slice(2)) as `0x${string}`);
  const curveOffsets: number[] = [];
  for (let o = code.length; o + 32 <= bytes.length; o += 32) {
    let match = true;
    for (let j = 0; j < 32; j++) {
      if (bytes[o + j] !== padded[j]) {
        match = false;
        break;
      }
    }
    if (match) curveOffsets.push(o + 12);
  }
  if (curveOffsets.length !== (rewards ? 2 : 1)) {
    throw new Error(`vanity: expected ${rewards ? 2 : 1} curve slots, found ${curveOffsets.length}`);
  }
  return { bytes, curveOffsets, create2Deployer: rewards ? i.rewardTokenDeployer : i.launchDeployer };
}

/** Predicts (curve, token) for one seed, exactly as the deployer would. */
export function predict(
  i: LaunchInputs,
  template: TokenTemplate,
  curveHash: `0x${string}`,
  seed: `0x${string}`,
): { salt: `0x${string}`; curve: Address; token: Address } {
  const salt = launchSalt(i.originalDeployer, seed);
  const curve = getCreate2Address({ from: i.launchDeployer, salt, bytecodeHash: curveHash });
  const curveBytes = hexToBytes(curve);
  for (const o of template.curveOffsets) template.bytes.set(curveBytes, o);
  const token = getCreate2Address({
    from: template.create2Deployer,
    salt,
    bytecodeHash: keccak256(template.bytes),
  });
  return { salt, curve, token };
}

export type MineResult = {
  seed: `0x${string}`;
  salt: `0x${string}`;
  token: Address;
  curve: Address;
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
  const maxIterations = opts.maxIterations ?? 40_000;
  const template = tokenTemplate(i);
  const curveHash = curveInitHash(i);
  const base = opts.entropy ?? toHex(crypto.getRandomValues(new Uint8Array(32)));

  for (let n = 0; n < maxIterations; n++) {
    const seed = keccak256(concat([base, toHex(n, { size: 8 })]));
    const candidate = predict(i, template, curveHash, seed);
    if (candidate.token.toLowerCase().endsWith(suffix)) {
      return { seed, ...candidate, iterations: n + 1 };
    }
    if ((n & 0xff) === 0xff) {
      opts.onProgress?.(n + 1);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return null;
}

/** Non-mined fallback salt, used when mining or verification fails. */
export function randomSeed(): `0x${string}` {
  return keccak256(toBytes(`${Date.now()}-${Math.random()}`));
}

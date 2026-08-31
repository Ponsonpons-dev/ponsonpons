/**
 * Cross-implementation tests for the ...909 vanity miner.
 *
 * The fixture (vanity.fixture.json) is written by the deployer contract
 * itself in contracts/test/unit/VanityFixture.t.sol: the same inputs were
 * fed to `predictLaunchAddresses` on-chain-side, and this suite must derive
 * identical addresses from the exported creation bytecode. A mismatch means
 * the TypeScript derivation drifted from the contract and mining would be
 * inert (never wrong: the create page verifies before launching).
 *
 * Runs on Node's test runner:  npm run test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { curveInitHash, mineVanitySalt, predict, tokenTemplate, type LaunchInputs } from "./vanity.ts";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "vanity.fixture.json"), "utf8"));

function inputs(mode: number, shareBps: number): LaunchInputs {
  return {
    name: "Vanity Fixture",
    symbol: "VAN",
    logo: "ipfs://bafyfixture",
    description: "cross-implementation vanity fixture",
    socials: { twitter: "x.com/pop", telegram: "", discord: "", website: "ponsonpons.com", farcaster: "" },
    creatorFeeRecipient: fixture.creator,
    originalDeployer: fixture.creator,
    creatorFeeBps: fixture.creatorFeeBps,
    cashback: { mode, shareBps },
    quoteToken: fixture.quote,
    protocolFeeRecipient: fixture.protocolFeeRecipient,
    protocolFeeShareBps: fixture.protocolFeeShareBps,
    feeEscrow: fixture.feeEscrow,
    phantomQuote: BigInt(fixture.phantomQuote),
    curveFeeBps: BigInt(fixture.curveFeeBps),
    graduationThreshold: BigInt(fixture.graduationThreshold),
    supply: BigInt(fixture.supply),
    launchDeployer: fixture.launchDeployer,
    rewardTokenDeployer: fixture.rewardTokenDeployer,
    factory: fixture.factory,
    graduationExecutor: fixture.graduationExecutor,
    locker: fixture.locker,
    poolManager: fixture.poolManager,
  };
}

test("plain-token derivation matches the deployer contract exactly", () => {
  const i = inputs(0, 0);
  const p = predict(i, tokenTemplate(i), curveInitHash(i), fixture.salt);
  assert.equal(p.curve, fixture.expectedPlainCurve);
  assert.equal(p.token, fixture.expectedPlainToken);
});

test("reward-token derivation matches the deployer contract exactly", () => {
  const i = inputs(3, 5000);
  const p = predict(i, tokenTemplate(i), curveInitHash(i), fixture.salt);
  assert.equal(p.curve, fixture.expectedRewardCurve);
  assert.equal(p.token, fixture.expectedRewardToken);
});

test("mining finds a salt whose token address carries the suffix", async () => {
  const i = inputs(0, 0);
  // One hex nibble keeps the expected search at ~16 tries; the math is
  // identical for the production three-nibble suffix.
  const r = await mineVanitySalt(i, { suffix: "9", maxIterations: 2_000, entropy: `0x${"11".repeat(32)}` });
  assert.ok(r, "found within budget");
  assert.ok(r.token.toLowerCase().endsWith("9"), r.token);
  // The result must reproduce: same seed, same address.
  const again = predict(i, tokenTemplate(i), curveInitHash(i), r.seed);
  assert.equal(again.token, r.token);
});

test("mining respects the iteration budget", async () => {
  const i = inputs(0, 0);
  const r = await mineVanitySalt(i, {
    suffix: "0123456789abcdef",
    maxIterations: 32,
    entropy: `0x${"22".repeat(32)}`,
  });
  assert.equal(r, null);
});

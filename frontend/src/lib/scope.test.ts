/**
 * Tests for Ponscope's filter logic.
 *
 * Runs on Node's built-in test runner with type stripping, so no test framework
 * dependency:  npm run test
 *
 * These exist because filter UI is easy to fake: controls that look right and
 * change nothing. Every assertion below drives the same `matches`/`selectColumn`
 * the board calls, so a control that stopped filtering would fail here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Launch } from "./indexer.ts";
import {
  EMPTY_FILTERS,
  activeCount,
  defaultsFor,
  matches,
  selectColumn,
  type Filters,
} from "./scope.ts";

const NOW = 1_800_000_000;
const wad = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString();

function launch(over: Partial<Launch> = {}): Launch {
  return {
    token: "0xtoken" as `0x${string}`,
    curve: "0xcurve" as `0x${string}`,
    deployer: "0xdev" as `0x${string}`,
    creatorFeeRecipient: "0xdev" as `0x${string}`,
    quoteToken: "0xAAAA" as `0x${string}`,
    name: "Tampons",
    symbol: "TAM",
    logo: "",
    description: "",
    twitter: "",
    telegram: "",
    discord: "",
    website: "",
    farcaster: "",
    supply: wad(1e9),
    graduationThreshold: wad(4200),
    creatorFeeBps: 100,
    cashbackMode: 2,
    cashbackShareBps: 5000,
    phase: 0,
    createdAt: String(NOW - 600), // 10 minutes old
    graduatedAt: null,
    poolId: null,
    positionId: null,
    lockedSupplyExcess: "0",
    lastPriceQuoteWad: wad(0.000008),
    realQuoteReserve: wad(3500),
    curveProgressBps: 8420,
    volumeQuote: wad(90_000),
    tradeCount: 400,
    holderCount: 201,
    burnedQuote: wad(450),
    holderRewardsQuote: "0",
    creatorFeesQuote: wad(800),
    rebatesQuote: "0",
    ...over,
  };
}

const dec = () => 18;
const f = (over: Partial<Filters> = {}): Filters => ({ ...EMPTY_FILTERS, ...over });

test("no filters lets everything through", () => {
  assert.equal(matches(launch(), f(), NOW, dec), true);
});

test("text search covers both name and ticker, case-insensitively", () => {
  assert.equal(matches(launch(), f({ q: "tamp" }), NOW, dec), true);
  assert.equal(matches(launch(), f({ q: "TAM" }), NOW, dec), true);
  assert.equal(matches(launch(), f({ q: "  tampons " }), NOW, dec), true);
  assert.equal(matches(launch(), f({ q: "bons" }), NOW, dec), false);
});

test("quote filter matches regardless of address casing", () => {
  assert.equal(matches(launch(), f({ quotes: ["0xaaaa"] }), NOW, dec), true);
  assert.equal(matches(launch(), f({ quotes: ["0xbbbb"] }), NOW, dec), false);
  // Empty means "any", not "none".
  assert.equal(matches(launch(), f({ quotes: [] }), NOW, dec), true);
});

test("cashback mode filter selects the listed modes only", () => {
  assert.equal(matches(launch({ cashbackMode: 2 }), f({ modes: [2, 3] }), NOW, dec), true);
  assert.equal(matches(launch({ cashbackMode: 1 }), f({ modes: [2, 3] }), NOW, dec), false);
});

test("cashbackOnly drops mode 0 and keeps the rest", () => {
  assert.equal(matches(launch({ cashbackMode: 0 }), f({ cashbackOnly: true }), NOW, dec), false);
  assert.equal(matches(launch({ cashbackMode: 1 }), f({ cashbackOnly: true }), NOW, dec), true);
});

test("curve bounds are inclusive and compare in percent, not bps", () => {
  const l = launch({ curveProgressBps: 8420 }); // 84.2%
  assert.equal(matches(l, f({ minProgress: 84 }), NOW, dec), true);
  assert.equal(matches(l, f({ minProgress: 85 }), NOW, dec), false);
  assert.equal(matches(l, f({ maxProgress: 84.2 }), NOW, dec), true);
  assert.equal(matches(l, f({ maxProgress: 84 }), NOW, dec), false);
  assert.equal(matches(l, f({ minProgress: 50, maxProgress: 90 }), NOW, dec), true);
});

test("holder and volume floors compare against real values", () => {
  assert.equal(matches(launch({ holderCount: 201 }), f({ minHolders: 201 }), NOW, dec), true);
  assert.equal(matches(launch({ holderCount: 200 }), f({ minHolders: 201 }), NOW, dec), false);
  // volumeQuote is 90,000 once scaled down by the quote's decimals.
  assert.equal(matches(launch(), f({ minVolume: 90_000 }), NOW, dec), true);
  assert.equal(matches(launch(), f({ minVolume: 90_001 }), NOW, dec), false);
});

test("volume floor respects the quote token's decimals", () => {
  // Same raw integer, read as a 6-decimal quote, is a far larger number.
  const sixDec = () => 6;
  const l = launch({ volumeQuote: (10n ** 12n * 5n).toString() }); // 5e12 raw
  assert.equal(matches(l, f({ minVolume: 1_000_000 }), NOW, sixDec), true);
  assert.equal(matches(l, f({ minVolume: 1_000_000 }), NOW, dec), false);
});

test("age bounds are in minutes and both directions work", () => {
  const l = launch({ createdAt: String(NOW - 3600) }); // 60 minutes old
  assert.equal(matches(l, f({ maxAgeMin: 90 }), NOW, dec), true);
  assert.equal(matches(l, f({ maxAgeMin: 30 }), NOW, dec), false);
  assert.equal(matches(l, f({ minAgeMin: 30 }), NOW, dec), true);
  assert.equal(matches(l, f({ minAgeMin: 90 }), NOW, dec), false);
});

test("filters compose: every clause must pass", () => {
  const l = launch({ cashbackMode: 2, holderCount: 201, curveProgressBps: 8420 });
  assert.equal(matches(l, f({ modes: [2], minHolders: 100, minProgress: 80 }), NOW, dec), true);
  // One failing clause is enough to reject.
  assert.equal(matches(l, f({ modes: [2], minHolders: 100, minProgress: 90 }), NOW, dec), false);
});

test("a malformed amount is treated as zero rather than throwing", () => {
  const l = launch({ volumeQuote: "not-a-number" });
  assert.equal(matches(l, f({ minVolume: 1 }), NOW, dec), false);
  assert.equal(matches(l, f(), NOW, dec), true);
});

test("columns select the right launches and order them meaningfully", () => {
  const all: Launch[] = [
    launch({ token: "0x1" as `0x${string}`, phase: 0, curveProgressBps: 1000, createdAt: String(NOW - 100) }),
    launch({ token: "0x2" as `0x${string}`, phase: 0, curveProgressBps: 9000, createdAt: String(NOW - 900) }),
    launch({ token: "0x3" as `0x${string}`, phase: 2, graduatedAt: String(NOW - 50) }),
    launch({ token: "0x4" as `0x${string}`, phase: 2, graduatedAt: String(NOW - 500) }),
  ];

  // Fresh: live only, newest first.
  assert.deepEqual(
    selectColumn("fresh", all).map((l) => l.token),
    ["0x1", "0x2"],
  );
  // Filling: live only, fullest curve first.
  assert.deepEqual(
    selectColumn("filling", all).map((l) => l.token),
    ["0x2", "0x1"],
  );
  // Graduated: settled only, most recently graduated first.
  assert.deepEqual(
    selectColumn("graduated", all).map((l) => l.token),
    ["0x3", "0x4"],
  );
});

test("selectColumn does not mutate the array it is given", () => {
  const all = [
    launch({ token: "0x1" as `0x${string}`, curveProgressBps: 100 }),
    launch({ token: "0x2" as `0x${string}`, curveProgressBps: 9000 }),
  ];
  const order = all.map((l) => l.token);
  selectColumn("filling", all);
  assert.deepEqual(all.map((l) => l.token), order);
});

test("the badge counts only what differs from the column's own baseline", () => {
  // Fresh ships with a 24h age bound; that alone is not "user filtered".
  assert.equal(activeCount("fresh", defaultsFor("fresh")), 0);
  assert.equal(activeCount("fresh", { ...defaultsFor("fresh"), q: "pons" }), 1);
  assert.equal(activeCount("fresh", { ...defaultsFor("fresh"), maxAgeMin: 60 }), 1);
  // Filling ships with a 50% floor.
  assert.equal(activeCount("filling", defaultsFor("filling")), 0);
  assert.equal(activeCount("filling", { ...defaultsFor("filling"), minProgress: 90, modes: [2] }), 2);
});

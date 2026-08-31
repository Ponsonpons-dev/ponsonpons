#!/usr/bin/env node
/**
 * Offline JSON-RPC stub for the pinned fork suite.
 *
 * `vm.createSelectFork` contacts the endpoint for exactly three things before
 * it will consult Foundry's on-disk state cache: eth_chainId, eth_gasPrice,
 * and the pinned block's header. All three are captured in
 * test/fork/cache/handshake.json, so this serves them from disk and the run
 * needs no network at all, no archive provider, no rate limits, and no
 * Cloudflare challenge on a CI runner.
 *
 * Everything else (balances, code, storage) comes from the state cache in
 * test/fork/cache/<chainId>/<block>, which `warm-fork-cache.sh` regenerates.
 * A request for any other method means that cache no longer covers the suite;
 * this answers with an error saying so rather than silently reaching out.
 *
 *   node script/fork-cache-server.mjs                    # serve until killed
 *   node script/fork-cache-server.mjs -- forge test ...  # serve, run, exit
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "test", "fork", "cache", "handshake.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const PORT = Number(process.env.FORK_CACHE_PORT ?? 8545);
const MISS = -32000;

/** Answer one JSON-RPC request from the fixture, or explain why we can't. */
function handle({ id, method, params }) {
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const miss = (why) => ({ jsonrpc: "2.0", id, error: { code: MISS, message: why } });

  switch (method) {
    case "eth_chainId":
      return reply(fixture.eth_chainId);
    case "eth_gasPrice":
      return reply(fixture.eth_gasPrice);
    case "eth_getBlockByNumber": {
      const tag = params?.[0];
      const block = fixture.eth_getBlockByNumber[tag];
      if (block) return reply(block);
      return miss(
        `fork cache holds only block ${fixture.block} (${Object.keys(fixture.eth_getBlockByNumber).join(", ")}), ` +
          `not ${tag}. Re-pin with script/warm-fork-cache.sh, or unset ROBINHOOD_RPC_URL to use a live endpoint.`,
      );
    }
    default:
      return miss(
        `${method} is not served offline: the committed state cache no longer covers this suite. ` +
          `Re-warm it with script/warm-fork-cache.sh (it needs a live endpoint and a recent block).`,
      );
  }
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let out;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      out = Array.isArray(body) ? body.map(handle) : handle(body);
    } catch (err) {
      out = { jsonrpc: "2.0", id: null, error: { code: -32700, message: `parse error: ${err.message}` } };
    }
    const payload = Buffer.from(JSON.stringify(out));
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": payload.length });
    res.end(payload);
  });
});

const dashdash = process.argv.indexOf("--");
const command = dashdash === -1 ? [] : process.argv.slice(dashdash + 1);

server.listen(PORT, "127.0.0.1", () => {
  if (command.length === 0) {
    console.error(`fork cache server on http://127.0.0.1:${PORT} (block ${fixture.block})`);
    return;
  }
  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: { ...process.env, ROBINHOOD_RPC_URL: `http://127.0.0.1:${PORT}` },
  });
  child.on("exit", (code, signal) => {
    server.close();
    process.exit(signal ? 1 : (code ?? 1));
  });
});

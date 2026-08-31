#!/usr/bin/env bash
#
# Re-pin the fork suite to a fresh block and regenerate the committed RPC cache.
#
# Why this exists: Robinhood Chain's public endpoint keeps state for only a few
# thousand blocks (minutes, at Orbit block times) so a pinned fork block goes
# unservable almost immediately. Foundry's on-disk RPC cache fixes that: warm it
# once against a block whose state is still live, commit it, and the suite
# replays forever without an archive provider.
#
# Run this when the fork tests change (a new contract read means a cache miss),
# or when you want the suite pinned to more recent chain state. It needs a live
# endpoint; ROBINHOOD_RPC_URL overrides the public one.
#
#   ./script/warm-fork-cache.sh
#
# It rewrites: test/fork/cache/<chainId>/<block>, test/fork/cache/handshake.json,
# and PINNED_FORK_BLOCK in test/fork/RobinhoodFork.t.sol. Commit all three.
set -euo pipefail

cd "$(dirname "$0")/.."

RPC="${ROBINHOOD_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
CHAIN_ID_DEC=4663
# State lives for ~1-8k blocks; stay well inside it so the warm-up run itself
# does not outlive the window while it is fetching.
OFFSET="${FORK_BLOCK_OFFSET:-64}"

CACHE_DIR="test/fork/cache"
FOUNDRY_RPC_CACHE="${HOME}/.foundry/cache/rpc/${CHAIN_ID_DEC}"
TEST_FILE="test/fork/RobinhoodFork.t.sol"

command -v cast >/dev/null || { echo "cast not on PATH (install Foundry)" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }

head_block=$(cast block-number --rpc-url "$RPC")
pin=$((head_block - OFFSET))
echo "head ${head_block}, pinning ${pin} (offset ${OFFSET})"

# Start from nothing so the committed cache contains exactly what this suite
# touches, no stale entries from earlier pins riding along.
rm -rf "${FOUNDRY_RPC_CACHE}"

echo "warming state cache (this one run does hit the network)…"
RUN_FORK_TESTS=true ROBINHOOD_RPC_URL="$RPC" FORK_BLOCK="$pin" \
  forge test --match-path "test/fork/*" -vv

[ -f "${FOUNDRY_RPC_CACHE}/${pin}" ] || {
  echo "no cache written at ${FOUNDRY_RPC_CACHE}/${pin}, is rpc_storage_caching disabled?" >&2
  exit 1
}

rm -rf "${CACHE_DIR}/${CHAIN_ID_DEC}"
mkdir -p "${CACHE_DIR}/${CHAIN_ID_DEC}"
cp "${FOUNDRY_RPC_CACHE}/${pin}" "${CACHE_DIR}/${CHAIN_ID_DEC}/${pin}"

echo "capturing handshake fixture…"
RPC="$RPC" PIN="$pin" python3 - <<'PY'
import json, os, urllib.request

rpc, pin = os.environ["RPC"], int(os.environ["PIN"])
tag = hex(pin)
headers = {
    "Content-Type": "application/json",
    # The public endpoint sits behind Cloudflare and 403s default UA strings.
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
}


def call(method, params):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    with urllib.request.urlopen(urllib.request.Request(rpc, data=payload, headers=headers), timeout=30) as r:
        body = json.load(r)
    if "error" in body:
        raise SystemExit(f"{method} failed: {body['error']}")
    return body["result"]


fixture = {
    "block": pin,
    "eth_chainId": call("eth_chainId", []),
    "eth_gasPrice": call("eth_gasPrice", []),
    "eth_getBlockByNumber": {tag: call("eth_getBlockByNumber", [tag, False])},
}
with open("test/fork/cache/handshake.json", "w") as f:
    json.dump(fixture, f, indent=1, sort_keys=True)
    f.write("\n")
PY

echo "re-pinning ${TEST_FILE}…"
sed -i.bak -E "s/(PINNED_FORK_BLOCK = )[0-9_]+;/\1${pin};/" "$TEST_FILE"
rm -f "${TEST_FILE}.bak"
grep -q "PINNED_FORK_BLOCK = ${pin};" "$TEST_FILE" || {
  echo "failed to update PINNED_FORK_BLOCK in ${TEST_FILE}" >&2
  exit 1
}

echo "verifying offline replay…"
node script/fork-cache-server.mjs -- \
  env RUN_FORK_TESTS=true forge test --match-path "test/fork/*" -vv

cat <<EOF

done. pinned block ${pin}. commit:
  ${CACHE_DIR}/${CHAIN_ID_DEC}/${pin}
  ${CACHE_DIR}/handshake.json
  ${TEST_FILE}
EOF

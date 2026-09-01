import { createConfig } from "ponder";

import { PopFeeEscrowAbi } from "./abis/PopFeeEscrow";
import { PopHookAbi } from "./abis/PopHook";
import { PopLaunchFactoryAbi } from "./abis/PopLaunchFactory";
import { PopQuoteRegistryAbi } from "./abis/PopQuoteRegistry";
import { poolManagerSwapAbi } from "./abis/poolManager";

/**
 * $POP v2 indexer configuration.
 *
 * Deployment addresses come from contracts/deployments/<chainId>.json via
 * env (see .env.example). v2 has no per-launch contracts to discover: every
 * launch trades on the canonical PoolManager from block one (its WETH
 * "curve pool", then its locked token/quote "bonded pool" after the bond),
 * so the only dynamic mapping is poolId -> launch, learned from the hook's
 * PoolRegistered events. POP_SWAP_ROUTER is a pure periphery contract and
 * is deliberately not indexed.
 */
const FACTORY = process.env.POP_LAUNCH_FACTORY as `0x${string}`;
const HOOK = process.env.POP_HOOK as `0x${string}`;
const REGISTRY = process.env.POP_QUOTE_REGISTRY as `0x${string}`;
const ESCROW = process.env.POP_FEE_ESCROW as `0x${string}`;
const POOL_MANAGER = (process.env.UNISWAP_V4_POOL_MANAGER ??
  "0x8366a39CC670B4001A1121B8F6A443A643e40951") as `0x${string}`;
const START_BLOCK = Number(process.env.POP_START_BLOCK ?? 0);

export default createConfig({
  chains: {
    robinhood: {
      id: 4663,
      rpc: process.env.PONDER_RPC_URL_4663 ?? "https://rpc.mainnet.chain.robinhood.com",
      // The public endpoint rate-limits aggressively; an archive-grade
      // endpoint (e.g. Chainstack) is strongly recommended for backfills.
      maxRequestsPerSecond: Number(process.env.PONDER_RPS ?? 10),
    },
  },
  contracts: {
    PopLaunchFactory: {
      chain: "robinhood",
      abi: PopLaunchFactoryAbi,
      address: FACTORY,
      startBlock: START_BLOCK,
    },
    PopHook: {
      chain: "robinhood",
      abi: PopHookAbi,
      address: HOOK,
      startBlock: START_BLOCK,
    },
    PopQuoteRegistry: {
      chain: "robinhood",
      abi: PopQuoteRegistryAbi,
      address: REGISTRY,
      startBlock: START_BLOCK,
    },
    PopFeeEscrow: {
      chain: "robinhood",
      abi: PopFeeEscrowAbi,
      address: ESCROW,
      startBlock: START_BLOCK,
    },
    // The canonical PoolManager emits Swap for every V4 pool; handlers
    // filter to pool ids registered to $POP launches (curve or bonded).
    PoolManager: {
      chain: "robinhood",
      abi: poolManagerSwapAbi,
      address: POOL_MANAGER,
      startBlock: START_BLOCK,
    },
  },
});

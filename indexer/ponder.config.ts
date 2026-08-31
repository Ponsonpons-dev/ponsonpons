import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";

import { PopBondingCurveAbi } from "./abis/PopBondingCurve";
import { PopFeeEscrowAbi } from "./abis/PopFeeEscrow";
import { PopHookAbi } from "./abis/PopHook";
import { PopLaunchFactoryAbi } from "./abis/PopLaunchFactory";
import { PopLaunchTokenAbi } from "./abis/PopLaunchToken";
import { PopLockerAbi } from "./abis/PopLocker";
import { PopQuoteRegistryAbi } from "./abis/PopQuoteRegistry";
import { poolManagerSwapAbi } from "./abis/poolManager";

/**
 * $POP indexer configuration.
 *
 * Deployment addresses come from contracts/deployments/<chainId>.json via
 * env (see .env.example). Curves and launch tokens are discovered
 * dynamically from the factory's TokenLaunched event.
 */
const FACTORY = process.env.POP_LAUNCH_FACTORY as `0x${string}`;
const HOOK = process.env.POP_HOOK as `0x${string}`;
const LOCKER = process.env.POP_LOCKER as `0x${string}`;
const REGISTRY = process.env.POP_QUOTE_REGISTRY as `0x${string}`;
const ESCROW = process.env.POP_FEE_ESCROW as `0x${string}`;
const POOL_MANAGER = (process.env.UNISWAP_V4_POOL_MANAGER ??
  "0x8366a39CC670B4001A1121B8F6A443A643e40951") as `0x${string}`;
const START_BLOCK = Number(process.env.POP_START_BLOCK ?? 0);

const tokenLaunched = getAbiItem({ abi: PopLaunchFactoryAbi, name: "TokenLaunched" });

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
    PopBondingCurve: {
      chain: "robinhood",
      abi: PopBondingCurveAbi,
      address: factory({
        address: FACTORY,
        event: tokenLaunched,
        parameter: "curve",
      }),
      startBlock: START_BLOCK,
    },
    PopLaunchToken: {
      chain: "robinhood",
      abi: PopLaunchTokenAbi,
      address: factory({
        address: FACTORY,
        event: tokenLaunched,
        parameter: "token",
      }),
      startBlock: START_BLOCK,
    },
    PopHook: {
      chain: "robinhood",
      abi: PopHookAbi,
      address: HOOK,
      startBlock: START_BLOCK,
    },
    PopLocker: {
      chain: "robinhood",
      abi: PopLockerAbi,
      address: LOCKER,
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
    // filter to pool ids of graduated $POP launches for post-graduation
    // price/volume tracking.
    PoolManager: {
      chain: "robinhood",
      abi: poolManagerSwapAbi,
      address: POOL_MANAGER,
      startBlock: START_BLOCK,
    },
  },
});

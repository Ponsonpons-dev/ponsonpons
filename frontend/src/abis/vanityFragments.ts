/**
 * Minimal ABI fragments the ...909 vanity miner reads with. Everything the
 * miner needs is derivable from the factory plus the env addresses, so no
 * extra configuration is required.
 */

export const FactoryRefsAbi = [
  {
    type: "function",
    name: "getLaunchConfig",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "supply", type: "uint256" },
          { name: "curveFeeBps", type: "uint256" },
          { name: "poolFee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
  },
  { type: "function", name: "launchDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "graduationExecutor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "locker", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const HookPolicyAbi = [
  {
    type: "function",
    name: "currentFeePolicy",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "protocolFeeRecipient", type: "address" },
          { name: "protocolFeeShareBps", type: "uint16" },
          { name: "hookFeeBps", type: "uint16" },
          { name: "maxInternalPriceImpactBps", type: "uint16" },
        ],
      },
    ],
  },
] as const;

export const RegistryEconomicsAbi = [
  {
    type: "function",
    name: "getLaunchEconomics",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { name: "phantomQuote", type: "uint256" },
      { name: "graduationThreshold", type: "uint256" },
      { name: "decimals", type: "uint8" },
    ],
  },
] as const;

const LAUNCH_DEPLOYMENT_COMPONENTS = [
  { name: "quoteToken", type: "address" },
  { name: "creatorFeeRecipient", type: "address" },
  { name: "originalDeployer", type: "address" },
  { name: "protocolFeeRecipient", type: "address" },
  { name: "protocolFeeShareBps", type: "uint16" },
  {
    name: "cashback",
    type: "tuple",
    components: [
      { name: "mode", type: "uint8" },
      { name: "shareBps", type: "uint16" },
    ],
  },
  { name: "feeEscrow", type: "address" },
  { name: "phantomQuote", type: "uint256" },
  { name: "curveFeeBps", type: "uint256" },
  { name: "creatorFeeBps", type: "uint256" },
  { name: "graduationThreshold", type: "uint256" },
  { name: "supply", type: "uint256" },
  { name: "salt", type: "bytes32" },
  { name: "name", type: "string" },
  { name: "symbol", type: "string" },
  { name: "logo", type: "string" },
  { name: "description", type: "string" },
  {
    name: "socials",
    type: "tuple",
    components: [
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "discord", type: "string" },
      { name: "website", type: "string" },
      { name: "farcaster", type: "string" },
    ],
  },
] as const;

export const LaunchDeployerAbi = [
  { type: "function", name: "rewardTokenDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "predictLaunchAddresses",
    stateMutability: "view",
    inputs: [{ name: "params", type: "tuple", components: LAUNCH_DEPLOYMENT_COMPONENTS }],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
    ],
  },
] as const;

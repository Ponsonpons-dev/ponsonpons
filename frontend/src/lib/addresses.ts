const addr = (v: string | undefined): `0x${string}` =>
  (v && v.startsWith("0x") ? v : "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const ADDRESSES = {
  launchFactory: addr(process.env.NEXT_PUBLIC_LAUNCH_FACTORY),
  quoteRegistry: addr(process.env.NEXT_PUBLIC_QUOTE_REGISTRY),
  feeEscrow: addr(process.env.NEXT_PUBLIC_FEE_ESCROW),
  hook: addr(process.env.NEXT_PUBLIC_HOOK),
  locker: addr(process.env.NEXT_PUBLIC_LOCKER),
  timelock: addr(process.env.NEXT_PUBLIC_TIMELOCK),
  protocolOwner: addr(process.env.NEXT_PUBLIC_PROTOCOL_OWNER),
  revenueSplitter: addr(process.env.NEXT_PUBLIC_REVENUE_SPLITTER),
  buybackBurner: addr(process.env.NEXT_PUBLIC_BUYBACK_BURNER),
  swapRouter: addr(process.env.NEXT_PUBLIC_SWAP_ROUTER),
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951" as `0x${string}`,
  positionManager: "0x58daec3116aae6D93017bAAea7749052E8a04fA7" as `0x${string}`,
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as `0x${string}`,
} as const;

/**
 * Which governance actually shipped, from the deploy script's record.
 * "timelock": a 48h TimelockController owns the contracts and the protocol
 * owner proposes and executes on it.
 * "direct": the protocol owner owns them outright and its changes land
 * immediately.
 *
 * The site reads this rather than hardcoding a model, so /proof and the trust
 * docs can never describe governance the deployment does not have.
 */
export type Governance = "timelock" | "direct";
export const GOVERNANCE: Governance =
  process.env.NEXT_PUBLIC_GOVERNANCE === "timelock" ? "timelock" : "direct";

export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://robinhoodchain.blockscout.com";

export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;

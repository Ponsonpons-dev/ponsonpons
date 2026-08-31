const addr = (v: string | undefined): `0x${string}` =>
  (v && v.startsWith("0x") ? v : "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const ADDRESSES = {
  launchFactory: addr(process.env.NEXT_PUBLIC_LAUNCH_FACTORY),
  quoteRegistry: addr(process.env.NEXT_PUBLIC_QUOTE_REGISTRY),
  feeEscrow: addr(process.env.NEXT_PUBLIC_FEE_ESCROW),
  hook: addr(process.env.NEXT_PUBLIC_HOOK),
  locker: addr(process.env.NEXT_PUBLIC_LOCKER),
  timelock: addr(process.env.NEXT_PUBLIC_TIMELOCK),
  multisig: addr(process.env.NEXT_PUBLIC_MULTISIG),
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951" as `0x${string}`,
  positionManager: "0x58daec3116aae6D93017bAAea7749052E8a04fA7" as `0x${string}`,
} as const;

export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://robinhoodchain.blockscout.com";

export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;

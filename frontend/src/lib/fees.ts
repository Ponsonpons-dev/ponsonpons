import type { PublicClient } from "viem";

/**
 * Gas limits the site attaches to its own transactions, sized from the
 * heaviest observed run of each (a launch deploys the token, opens the pool,
 * seeds the curve and executes the dev buy in roughly 2.5M).
 *
 * These exist because of the fee overrides below, not despite them. Robinhood
 * Chain advertises a block gas limit of 2^50, and a node asked to estimate a
 * transaction carrying fee caps but no gas limit first checks the sender can
 * afford `blockGasLimit * maxFeePerGas`, which works out to over a million
 * ETH. Every wallet that estimates that way (Rabby and Phantom among them)
 * therefore rejects with "total cost exceeds the balance of the account".
 * Supplying the gas limit ourselves skips estimation, so the affordability
 * check runs against the real number instead.
 *
 * Overestimating is free: unused gas is never charged, it only reserves
 * headroom inside the wallet's own balance check for the moment of signing.
 */
export const GAS_LIMITS = {
  launch: 6_000_000n,
  trade: 2_000_000n,
  claim: 400_000n,
  default: 1_000_000n,
} as const;

export type GasKind = keyof typeof GAS_LIMITS;

/**
 * Fee overrides attached to every transaction the site sends.
 *
 * Robinhood Chain's base fee moves between a wallet's estimate and actual
 * inclusion, and wallets without dedicated fee logic for this chain
 * (MetaMask and Phantom both) quote the current base fee with almost no
 * headroom. The result is "max fee per gas less than block base fee"
 * rejections that surface to users as broken-looking transactions, or as
 * Phantom's generic signing-error screen. So the site prices every
 * transaction itself: three times the current base fee plus a token tip.
 * Only the real base fee is ever charged; the headroom is refunded, so it
 * costs users nothing.
 */
export async function feeOverrides(
  client: PublicClient | undefined,
  kind: GasKind = "default",
): Promise<{ gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> {
  const gas = GAS_LIMITS[kind];
  if (!client) return { gas };
  try {
    const block = await client.getBlock();
    const base = block.baseFeePerGas;
    if (!base || base <= 0n) return { gas };
    const maxPriorityFeePerGas = 10_000_000n; // 0.01 gwei; the sequencer ignores tips anyway
    return { gas, maxFeePerGas: base * 3n + maxPriorityFeePerGas, maxPriorityFeePerGas };
  } catch {
    // Fall back to the wallet's own fee estimate rather than blocking the
    // send, but keep the gas limit: it is what makes estimation unnecessary.
    return { gas };
  }
}

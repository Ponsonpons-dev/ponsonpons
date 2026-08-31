import type { PublicClient } from "viem";

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
): Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> {
  if (!client) return {};
  try {
    const block = await client.getBlock();
    const base = block.baseFeePerGas;
    if (!base || base <= 0n) return {};
    const maxPriorityFeePerGas = 10_000_000n; // 0.01 gwei; the sequencer ignores tips anyway
    return { maxFeePerGas: base * 3n + maxPriorityFeePerGas, maxPriorityFeePerGas };
  } catch {
    // Fall back to the wallet's own estimate rather than blocking the send.
    return {};
  }
}

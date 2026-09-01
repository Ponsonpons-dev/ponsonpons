"use client";

import Link from "next/link";

import { AddressLink } from "@/components/ui";
import { ADDRESSES } from "@/lib/addresses";

const INDEXER = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:42069";

export default function DevelopersDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Developers</h1>
      <p className="mt-2">
        Everything below is public and permissionless. You do not need an API key, an allowlist, or our
        cooperation to build on any of it.
      </p>

      <h2>Chain</h2>
      <table>
        <tbody>
          <tr>
            <td>Network</td>
            <td>Robinhood Chain (Arbitrum Orbit L2)</td>
          </tr>
          <tr>
            <td>Chain ID</td>
            <td>
              <code>4663</code>
            </td>
          </tr>
          <tr>
            <td>RPC</td>
            <td>
              <code>https://rpc.mainnet.chain.robinhood.com</code>
            </td>
          </tr>
          <tr>
            <td>Gas token</td>
            <td>ETH</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-dim">
        The public endpoint rate-limits heavy clients and keeps only a few thousand blocks of history,
        use an archive provider for indexing or fork testing.
      </p>

      <h2>Contracts</h2>
      <table>
        <tbody>
          <tr>
            <td>PopLaunchFactory</td>
            <td>
              <AddressLink address={ADDRESSES.launchFactory} />
            </td>
          </tr>
          <tr>
            <td>PopQuoteRegistry</td>
            <td>
              <AddressLink address={ADDRESSES.quoteRegistry} />
            </td>
          </tr>
          <tr>
            <td>PopHook</td>
            <td>
              <AddressLink address={ADDRESSES.hook} />
            </td>
          </tr>
          <tr>
            <td>PopLocker</td>
            <td>
              <AddressLink address={ADDRESSES.locker} />
            </td>
          </tr>
          <tr>
            <td>PopFeeEscrow</td>
            <td>
              <AddressLink address={ADDRESSES.feeEscrow} />
            </td>
          </tr>
          <tr>
            <td>PopSwapRouter</td>
            <td>
              <AddressLink address={ADDRESSES.swapRouter} />
            </td>
          </tr>
          <tr>
            <td>Uniswap V4 PoolManager</td>
            <td>
              <AddressLink address={ADDRESSES.poolManager} />
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Per-launch token addresses come from the factory&apos;s <code>TokenLaunched</code> event, or{" "}
        <code>getLaunchedToken(token)</code>. Sources are verified. See{" "}
        <Link href="/docs/proof">/proof</Link>.
      </p>

      <h2>Trading a launch (bots start here)</h2>
      <p>
        Every launch is a standard Uniswap V4 pool on the canonical PoolManager from its first block,
        quoted in WETH, fee <code>0</code>, tick spacing <code>200</code>, hooks = PopHook, currencies
        sorted by address. If your stack can swap Uniswap V4, you can trade every launch with no
        integration beyond the pool key. After the bond, the pair is the launch&apos;s quote token
        instead of WETH.
      </p>
      <pre>
        <code>{`// Pool keys, straight from the factory
factory.curvePoolKey(token)   -> PoolKey   // WETH pair, live from launch
factory.bondedPoolKey(token)  -> PoolKey   // quote pair, live after the bond

// Or skip V4 plumbing entirely: the router is one call, ETH in / ETH out,
// and routes the right pool (and the quote conversion, post-bond) itself.
router.buyWithEth(token, minTokensOut, deadline) payable -> tokensOut
router.sellForEth(token, tokenIn, minEthOut, deadline)   -> ethOut  // approve token first

// Full launch record: creator, quote, phase (0 Trading, 1 Bonded), fee terms
factory.getLaunchedToken(token) -> LaunchedToken

// Holder rewards (only on HolderRewards launches)
rewardToken.claimable(account) -> uint256
rewardToken.claim()
rewardToken.sync()             // permissionless; credits any new inflow`}</code>
      </pre>
      <p className="text-xs text-dim">
        The launch-window snipe tax (99% decaying to 0 over ~3 seconds) is charged by the hook on
        every route, so sniping the launch second is unprofitable by design, whatever router you use.
      </p>

      <h2>Anyone-can-call functions</h2>
      <p>These are not privileged. If you run a keeper or a bot, these are yours to call:</p>
      <ul>
        <li>
          <code>factory.isBondReady(token)</code>: true once the curve range has filled.
        </li>
        <li>
          <code>factory.bond(token, minQuoteOut)</code>: convert the raise into the quote (bounded by
          the quote&apos;s 30-minute TWAP on top of your own floor) and seed the locked pool. Atomic
          and retryable forever.
        </li>
        <li>
          <code>hook.sweepPoolFees(poolId, minOut)</code>: settle a pool&apos;s pending fees, burns
          and rewards (the conversion-bearing sweeps are operator-gated; quote-side sweeps are open to
          the creator).
        </li>
        <li>
          <code>registry.listQuote(token, adapterId)</code>: list any qualifying quote token.
        </li>
        <li>
          <code>registry.repegQuote(token)</code>: refresh a quote&apos;s peg (once per day, clamped).
        </li>
        <li>
          <code>rewardToken.sync()</code>: credit rewards that have arrived.
        </li>
      </ul>

      <h2>Indexer API</h2>
      <p>
        A Ponder indexer serves the data this site runs on. It is read-only and open.
      </p>
      <pre>
        <code>{`GET  ${INDEXER}/quotes
GET  ${INDEXER}/launches/<token>/trades
GET  ${INDEXER}/launches/<token>/candles/<60|900|3600|86400>
POST ${INDEXER}/graphql          # full schema
     ${INDEXER}/sql/*            # @ponder/client live queries (SSE)`}</code>
      </pre>
      <p>
        Prices are stored as quote-per-token scaled by 1e18. Rows carry a <code>denom</code> field: 0
        means WETH (the curve phase), 1 means the launch&apos;s bond quote. USD conversion is
        deliberately left to the consumer rather than baked into the data.
      </p>

      <h2>Events worth indexing</h2>
      <pre>
        <code>{`PopLaunchFactory:      TokenLaunched, LaunchBonded, DevBuyExecuted,
                       BondTokensPermanentlyLocked,
                       CreatorFeeRecipientUpdated, LaunchBondRescued
PopHook:               PoolRegistered, HookFeeCollected, SnipeTaxCharged,
                       BondReady, PoolFeesSwept, PoolQuoteBurned,
                       PoolHolderRewardsPushed
Uniswap V4 PoolManager: Swap (filter by the launch's pool ids)
PopQuoteRegistry:      QuoteListed, QuoteRepegged, QuotePausedUpdated
PopLocker:             PositionLocked, TokenSupplyLocked`}</code>
      </pre>
      <p className="text-xs text-dim">
        <code>BondReady</code> is the one to alert on: the curve has filled and{" "}
        <code>bond(token, minQuoteOut)</code> is waiting for its first caller. The first
        PoolRegistered for a token is its WETH curve pool; the second (at the bond) is its quote pool.
      </p>
    </>
  );
}

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
            <td>Uniswap V4 PoolManager</td>
            <td>
              <AddressLink address={ADDRESSES.poolManager} />
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Per-launch curve and token addresses come from the factory&apos;s <code>TokenLaunched</code>{" "}
        event, or <code>getLaunchedToken(token)</code>. Sources are verified. See{" "}
        <Link href="/docs/proof">/proof</Link>.
      </p>

      <h2>Reading a launch on-chain</h2>
      <pre>
        <code>{`// Full launch record: curve, creator, quote, phase, fee terms
factory.getLaunchedToken(token) -> LaunchedToken

// Live curve state
curve.getReserves()        -> (quoteReserve, tokenReserve)
curve.realQuoteReserve()   -> progress toward graduationThreshold
curve.sellableTokens()     -> 0 once ready to graduate
curve.readyToGraduate()    -> bool

// Trading (quote is an ERC-20: approve the curve first)
curve.buy(quoteIn, minTokensOut, recipient, deadline)
curve.sell(tokensIn, minQuoteOut, recipient, deadline)

// Holder rewards (only on HolderRewards launches)
rewardToken.claimable(account) -> uint256
rewardToken.claim()
rewardToken.sync()             // permissionless; credits any new inflow`}</code>
      </pre>

      <h2>Anyone-can-call functions</h2>
      <p>These are not privileged. If you run a keeper or a bot, these are yours to call:</p>
      <ul>
        <li>
          <code>factory.graduate(token)</code>: drain a filled curve.
        </li>
        <li>
          <code>factory.createGraduatedPool(token)</code>: seed and lock the pool. Retryable forever.
        </li>
        <li>
          <code>curve.sweepFees()</code>: settle pending fees, burns and rewards.
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
GET  ${INDEXER}/launches/<token>/holders
POST ${INDEXER}/graphql          # full schema
     ${INDEXER}/sql/*            # @ponder/client live queries (SSE)`}</code>
      </pre>
      <p>
        Prices are stored as quote-per-token scaled by 1e18, so 6-, 8- and 18-decimal quotes share one
        representation. ETH and USD conversion is deliberately left to the consumer rather than baked
        into the data.
      </p>

      <h2>Events worth indexing</h2>
      <pre>
        <code>{`PopLaunchFactory: TokenLaunched, LaunchSwept, PoolGraduated,
                  CreatorFeeRecipientUpdated
PopBondingCurve:  CurveBuy, CurveSell, FeesSwept, QuoteBurned,
                  HolderRewardsPushed, SnipeTaxCharged,
                  AutoGraduationFailed
PopHook:          PoolRegistered, HookFeeCollected, PoolFeesSwept,
                  PoolQuoteBurned, PoolHolderRewardsPushed
PopQuoteRegistry: QuoteListed, QuoteRepegged, QuotePausedUpdated
PopLocker:        PositionLocked, TokenSupplyLocked`}</code>
      </pre>
      <p className="text-xs text-dim">
        <code>AutoGraduationFailed</code> is the one to alert on: it means a curve filled but the
        crossing buy ran out of gas before graduating, and someone should call{" "}
        <code>graduate()</code>.
      </p>
    </>
  );
}

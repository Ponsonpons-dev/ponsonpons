import Link from "next/link";

export default function TradingDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Buy &amp; sell</h1>
      <p className="mt-2">
        A launch has two trading venues in its life: the ETH curve while it is filling, and a
        token/quote pool after it bonds. Both are real Uniswap V4 pools, and the token page trades
        whichever one is live, always in plain ETH.
      </p>

      <h2>On the curve</h2>
      <p>
        The curve is a live Uniswap V4 pool quoted in WETH, with the entire curve allocation sitting as
        a single liquidity position over the curve&apos;s price range. In plain terms: the price starts
        low and rises smoothly as people buy, with no order book and no counterparty needed. Selling
        moves the price back down the same way.
      </p>
      <p>
        You buy with plain ETH. The site routes through the swap router&apos;s <code>buyWithEth</code>{" "}
        and <code>sellForEth</code>; any wallet or bot that can swap Uniswap V4 can also trade the pool
        directly, with no launchpad-specific integration. See{" "}
        <Link href="/docs/developers">developers</Link>.
      </p>

      <h3>Approvals</h3>
      <p>
        Buying needs no approval at all; you send ETH. Selling requests an{" "}
        <strong>exact-amount approval by default</strong>: permission for precisely the trade you are
        making, and nothing more. &quot;Unlimited&quot; is an explicit checkbox, never the default. This
        costs a little more gas and is worth it.
      </p>

      <h3>Slippage and deadlines</h3>
      <p>
        Every trade carries a minimum-output bound and a deadline. If the price moves against you beyond
        your tolerance, or your transaction sits unconfirmed too long, it reverts rather than filling at
        a price you did not agree to.
      </p>

      <h3>Filling the curve</h3>
      <p>
        When buys push the price to the top of the curve&apos;s range and the raise reaches its 4.2 ETH
        threshold, the curve is done. The <Link href="/docs/graduation">bond</Link> itself is a
        separate, permissionless step: anyone can call it, a keeper does within seconds, and nothing is
        ever stuck waiting on us.
      </p>

      <h2>After the bond</h2>
      <p>
        Once a launch bonds, the token trades in a Uniswap V4 pool paired with its quote token, with
        permanently locked liquidity. The token page still trades in plain ETH: the swap router converts
        through the quote&apos;s pool automatically, in the same transaction. You can also trade the
        bonded pool directly anywhere that routes V4.
      </p>
      <p>
        Fees still work the same: the pool charges the same total, split the same way, including the
        creator&apos;s cashback mode, now denominated in the quote token.
      </p>

      <h2>What you pay</h2>
      <p>
        Every trade pays a <strong>1% base fee</strong> plus whatever the creator chose (0 to 2%), taken
        by the hook in both directions. That is the whole cost. There is no separate pool fee stacked on
        top, because the pool&apos;s own fee tier is set to zero and the hook charges instead.
      </p>
      <p>
        If the creator picked quote burn, your trades permanently shrink the quote token&apos;s supply.
        If they picked holder rewards, you earn continuously for as long as you hold. See{" "}
        <Link href="/docs/fees">fees &amp; cashback</Link>.
      </p>

      <h2>Reading the curve progress bar</h2>
      <p>
        The bar on each token page shows how much of the 4.2 ETH bond threshold has been raised. At
        100%, the launch is ready to bond, and anyone can finish it. It only moves on real trades
        through the pool.
      </p>
    </>
  );
}

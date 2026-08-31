import Link from "next/link";

export default function TradingDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Buy &amp; sell</h1>
      <p className="mt-2">
        A launch has two trading venues in its life: the bonding curve while it is filling, and a normal
        Uniswap V4 pool afterwards. The token page trades whichever one is live.
      </p>

      <h2>On the curve</h2>
      <p>
        The curve is a constant-product market maker seeded with a <em>virtual</em> quote reserve. In
        plain terms: the price starts low and rises smoothly as people buy, with no order book and no
        counterparty needed. Selling back to the curve moves the price down the same way.
      </p>
      <p>
        You buy with the launch&apos;s quote token, so you need some of it first; the token page tells
        you which one. You will approve the curve to spend it, then trade.
      </p>

      <h3>Approvals</h3>
      <p>
        $POP requests an <strong>exact-amount approval by default</strong>: permission for precisely
        the trade you are making, and nothing more. &quot;Unlimited&quot; is an explicit checkbox, never
        the default. This costs a little more gas and is worth it.
      </p>

      <h3>Slippage and deadlines</h3>
      <p>
        Every trade carries a minimum-output bound and a deadline. If the price moves against you beyond
        your tolerance, or your transaction sits unconfirmed too long, it reverts rather than filling at
        a price you did not agree to.
      </p>

      <h3>The last buy on a curve</h3>
      <p>
        The buy that fills a curve is special. Rather than reverting because you asked for more tokens
        than remain, the curve <strong>fills what it can, charges you only for that, and refunds the
        rest</strong> in the same transaction. This is deliberate: the final buy is the one most likely
        to be sized against a state someone else just changed, and reverting would let anyone grief it
        by slipping a tiny buy in first.
      </p>
      <p>
        That same transaction usually triggers <Link href="/docs/graduation">graduation</Link>. Because
        wallets do not price that step when estimating gas, the app gives crossing buys extra headroom,
        and if it still falls short, anyone can finish graduation afterwards. Nothing is stuck either
        way.
      </p>

      <h2>After graduation</h2>
      <p>
        Once a launch graduates, its curve closes permanently and the token trades in a Uniswap V4 pool
        with permanently locked liquidity. You can trade it anywhere that routes V4; the token page
        links the pool.
      </p>
      <p>
        Fees still work the same: the pool charges the same total, split the same way, including the
        creator&apos;s cashback mode.
      </p>

      <h2>What you pay</h2>
      <p>
        Every trade pays a <strong>1% base fee</strong> plus whatever the creator chose (0 to 2%), charged
        on the quote side of the trade in both directions. That is the whole cost. There is no separate
        pool fee stacked on top, because the pool&apos;s own fee tier is set to zero and the hook charges
        instead.
      </p>
      <p>
        If the creator picked the trader-rebate mode, part of that comes straight back to you on each
        trade. If they picked holder rewards, you earn continuously for as long as you hold. See{" "}
        <Link href="/docs/fees">fees &amp; cashback</Link>.
      </p>

      <h2>Reading the curve progress bar</h2>
      <p>
        The bar on each token page shows how much of the graduation threshold has been collected. At
        100%, the pool seeds itself and locks. It only moves on real trades; donations sent directly to
        the curve are ignored by construction and cannot push a launch over the line.
      </p>
    </>
  );
}

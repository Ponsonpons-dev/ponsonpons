import Link from "next/link";

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Why would I launch here instead of on a normal ETH launchpad?",
    a: (
      <>
        Because a launch here comes with a built-in audience and zero buying friction. Your curve
        trades in plain ETH on a real Uniswap pool from its first block, so anyone, and any trading
        bot, can buy it immediately. And when it bonds, the entire raise market-buys a community&apos;s
        token and your pair moves to it, so with quote burn or holder rewards your existence is
        measurably good for that community, which gives them a reason to care that you exist.
      </>
    ),
  },
  {
    q: "Do I need $PONS to buy a token here?",
    a: (
      <>
        No. You buy with plain ETH, always. Before the bond you are trading the token&apos;s ETH pool
        directly; after the bond the site&apos;s router converts your ETH through the quote token
        automatically in the same transaction. The quote token (often $PONS) is what the launch bonds
        into, not what you need in your wallet.
      </>
    ),
  },
  {
    q: "Can I trade launches with my bot (GMGN, Maestro, a custom sniper)?",
    a: (
      <>
        Yes, that is the point of the design. Every launch is a standard Uniswap V4 pool on the
        canonical PoolManager from its first block, quoted in WETH, so anything that can swap Uniswap
        V4 on Robinhood Chain can trade it with no launchpad-specific integration. Bot developers who
        want a one-call ABI can use the swap router instead; see{" "}
        <Link href="/docs/developers">developers</Link>.
      </>
    ),
  },
  {
    q: "Can the team rug the liquidity?",
    a: (
      <>
        No. The liquidity position is minted directly into a contract that has no withdrawal, transfer,
        or arbitrary-call function. Not a timelock. There is no exit in the code. See{" "}
        <Link href="/docs/trust">trust &amp; security</Link>.
      </>
    ),
  },
  {
    q: "Can a creator change the fees after I buy?",
    a: (
      <>
        No. Fee percentage, cashback mode and share are frozen when the token is created. The only thing
        a creator can change is which address <em>their own</em> fees are paid to.
      </>
    ),
  },
  {
    q: "What is the anti-snipe tax and will it hit me?",
    a: (
      <>
        For the first few seconds after a launch, buys pay a tax that starts near 100% and decays to
        zero, enforced by the pool&apos;s hook whatever router the buy comes through. It is aimed at
        bots that front-run the announcement. If you are a human clicking buy after seeing a post, it
        will be long over. The proceeds are not burned; they flow into the normal fee split.
      </>
    ),
  },
  {
    q: "What happens if nobody bonds a full curve?",
    a: (
      <>
        Anyone can bond it, at any time, forever: <code>bond()</code> is a permissionless function. A
        keeper does it automatically within seconds, but nothing depends on the keeper existing. Until
        the bond lands, buys stop at the curve&apos;s ceiling and sells keep working normally.
      </>
    ),
  },
  {
    q: "How do I get my creator fees?",
    a: (
      <>
        They accumulate as a claimable balance: in WETH while your token trades on its ETH curve, in
        the quote token after it bonds. Claim either from your token&apos;s page or your creator
        dashboard at <code>/creator/&lt;your address&gt;</code>. No vesting, no deadline.
      </>
    ),
  },
  {
    q: "I hold a token with holder rewards. How do I get paid?",
    a: (
      <>
        Just hold it. Rewards accrue as people trade (curve-phase carve-outs convert to the quote at
        the bond, pool-phase rewards flow at each sweep), and you claim from the token page whenever
        you like. There is nothing to stake and no snapshot to be present for. If you sell, you keep
        everything you earned while holding.
      </>
    ),
  },
  {
    q: "Can I get my token listed as a quote token?",
    a: (
      <>
        If it graduated on Pons and its locked liquidity clears the floor, yes, and you do not need
        our permission. Listing is a permissionless function anyone can call. See{" "}
        <Link href="/docs/quotes">quote tokens</Link>.
      </>
    ),
  },
  {
    q: "Why does the holder-rewards token have a transfer hook when you say tokens are inert?",
    a: (
      <>
        Because rewards have to be split by how much you held and for how long, and that can only be
        measured where balances move. It is the one mode that needs it, the hook does accounting only
        (it cannot block a transfer or change an amount), and the token still has no owner, mint, pause
        or blacklist. Every other mode deploys the completely inert token. We flag it in the create
        flow rather than hiding it.
      </>
    ),
  },
  {
    q: "Is this audited?",
    a: (
      <>
        Not yet. An audit is pending and will be linked on <Link href="/docs/proof">/proof</Link>. There is a
        substantial test suite including adversarial and fork tests against the live chain, and three
        real bugs it caught are disclosed publicly. Until the audit lands, treat it as unaudited code.
      </>
    ),
  },
  {
    q: "What do you take?",
    a: (
      <>
        50% of the 1% base fee, which is 0.5% of each trade, plus a small flat ETH fee at launch. That share is at the hard cap coded into the hook, so it can never rise. We take
        nothing from the creator&apos;s own fee, nothing from cashback, and nothing from liquidity.
      </>
    ),
  },
  {
    q: "Why hold $POP?",
    a: (
      <>
        Because 25% of $POP&apos;s own creator fees buy $POP on its pool and send it to the dead
        address, a ratio that is immutable in the burner&apos;s bytecode, and $POP&apos;s creator fee
        has been permanently routed to that burner. Every $POP trade therefore funds a burn.
        <br />
        <br />
        <strong>What this page used to say, and why it no longer does.</strong> The splitter can pay a
        share of protocol revenue to holders of the platform token, and we described that as 15% to
        $POP holders. It cannot be paid: the payout works by sending $PONS to the token contract and
        calling <code>sync()</code>, which exists only on the holder-rewards token variant, and $POP
        was launched in quote-burn mode. Distributions reverted until the share was set to 0%. The
        splitter&apos;s pointer to the platform token is one-time and already spent, so a holder share
        for $POP would require deploying a new splitter, and we are not promising one. Hold $POP for
        the burn, not for a revenue share.
      </>
    ),
  },
];

export default function FaqDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">FAQ</h1>
      <div className="mt-4 space-y-5">
        {FAQS.map((item) => (
          <div key={item.q}>
            <h3 className="!mt-0 text-ink">{item.q}</h3>
            <p>{item.a}</p>
          </div>
        ))}
      </div>
    </>
  );
}

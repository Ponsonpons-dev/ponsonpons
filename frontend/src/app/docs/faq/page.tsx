import Link from "next/link";

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Why would I launch here instead of on a normal ETH launchpad?",
    a: (
      <>
        Because a launch here comes with a built-in audience. Your token is priced in a community&apos;s
        token, and with quote burn or holder rewards your trading volume is measurably good for that
        community, which gives them a reason to care that you exist. On an ETH pad you are one of
        hundreds of tokens competing for the same attention with nothing to offer in return.
      </>
    ),
  },
  {
    q: "Do I need $PONS to buy a token here?",
    a: (
      <>
        You need whatever quote token that specific launch chose, often $PONS, sometimes another
        graduated token. The token page names it. You can get it on any DEX that trades it on Robinhood
        Chain.
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
        zero. It is aimed at bots that front-run the announcement. If you are a human clicking buy after
        seeing a post, it will be long over. The proceeds are not burned; they flow into the normal fee
        split.
      </>
    ),
  },
  {
    q: "What happens if nobody finishes graduating a token?",
    a: (
      <>
        Anyone can finish it, at any time, forever. A keeper does it automatically within seconds, but
        the function is permissionless precisely so that nothing depends on the keeper existing.
      </>
    ),
  },
  {
    q: "How do I get my creator fees?",
    a: (
      <>
        They accumulate as a claimable balance. Claim them from your token&apos;s page or your creator
        dashboard at <code>/creator/&lt;your address&gt;</code>. No vesting, no deadline.
      </>
    ),
  },
  {
    q: "I hold a token with holder rewards. How do I get paid?",
    a: (
      <>
        Just hold it. Rewards accrue continuously as people trade, and you claim from the token page
        whenever you like. There is nothing to stake and no snapshot to be present for. If you sell, you
        keep everything you earned while holding.
      </>
    ),
  },
  {
    q: "Can I get my token listed as a quote token?",
    a: (
      <>
        If it graduated on Pons and its locked liquidity clears the floor, yes, and you do not need our
        permission. Listing is a permissionless function anyone can call. See{" "}
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
        30% of the 1% base fee, which is 0.3% of each trade, plus a small flat ETH fee at launch. We take
        nothing from the creator&apos;s own fee, nothing from cashback, and nothing from liquidity.
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

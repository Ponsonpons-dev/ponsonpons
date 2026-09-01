import Link from "next/link";

export default function QuotesDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Quote tokens</h1>
      <p className="mt-2">
        A quote token is what a launch bonds into: the token the entire ETH raise market-buys when the
        curve fills, the token the bonded pool is paired with, and the token fees arrive in from then
        on. Choosing one is the most consequential decision a creator makes after the token itself.
      </p>

      <h2>What qualifies</h2>
      <p>
        Listing a quote token is <strong>permissionless</strong>. There is no application, no committee,
        and no admin approval. A token is listable when it satisfies two rules that the registry checks
        on-chain:
      </p>
      <ol>
        <li>
          <strong>It graduated on Pons.</strong> Verified by reading the Pons launchpad contracts
          directly, not a label we apply, not an oracle, not a signature. The token either has a
          graduated record in those immutable contracts or it does not.
        </li>
        <li>
          <strong>Its permanently locked liquidity clears a floor of 25 ETH.</strong> Measured from the
          locked position itself, so it cannot be faked with liquidity that can be pulled, or with
          donations.
        </li>
      </ol>
      <p>
        Anyone can call the listing function for any token that passes. If you want a quote listed, you
        do not need us.
      </p>

      <h2>The floor is checked continuously, not once</h2>
      <p>
        The liquidity requirement is re-verified at <em>every launch</em>, not just at listing time. If a
        quote token&apos;s locked backing falls below the floor, it simply stops accepting new launches
        automatically, with nobody pressing anything. If it recovers, launches resume. Tokens already
        trading are completely unaffected either way: their economics were fixed at creation.
      </p>
      <p>
        This is why there is <strong>no delisting function</strong> in the registry. There does not need
        to be one: the rule enforces itself, and an admin who could delist could also be pressured into
        delisting.
      </p>

      <h2>How the bond conversion is priced</h2>
      <p>
        Every launch raises the same amount, 4.2 ETH, regardless of which quote it bonds into, so no
        conversion is needed while a curve is filling. The conversion happens once, at the bond, when
        the entire raise market-buys the quote token on its own locked pool.
      </p>
      <p>Two guards keep that buy honest:</p>
      <ul>
        <li>
          <strong>A TWAP bound</strong>: the buy is checked against the quote&apos;s 30-minute
          time-weighted average price from the same pool.
        </li>
        <li>
          <strong>A slippage cap</strong>: it may fill at most 5% worse than that average, or the bond
          reverts and can be retried.
        </li>
      </ul>
      <p>
        And critically: every launch snapshots its own economics when it is created, so a curve that is
        already trading can never be repriced underneath its buyers.
      </p>

      <h2>Picking one as a creator</h2>
      <p>
        Bigger is not automatically better. What you actually want is a community that will care that
        you launched on them, because with{" "}
        <Link href="/docs/fees">quote burn or holder rewards</Link>, your launch is measurably good for
        them, and that is a real reason for them to pay attention.
      </p>
      <p>
        Each quote page shows launches hosted, bonds, volume, total burned, and total paid out to
        holders. Those numbers are the honest signal.
      </p>

      <h2>Roadmap: other origins</h2>
      <p>
        The registry verifies quotes through pluggable <em>origin adapters</em>. Today there is one, for
        Pons v1 tokens. Adding another (Pons v2 pools, or tokenized-stock quotes) is an additive
        change: new adapters are appended, never swapped in, so quotes already listed keep the exact
        verification path they were listed under, forever.
      </p>
    </>
  );
}

import Link from "next/link";

export default function DocsIndex() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">What $POP is</h1>
      <p className="mt-2">
        $POP is a token launchpad on Robinhood Chain. It works the way you would expect a launchpad to
        work, a bonding curve that fills up and then a real liquidity pool, with two differences that
        drive everything else.
      </p>

      <h2>1. Launches are priced in a token, not in ETH</h2>
      <p>
        On most launchpads a new token trades against ETH. On $POP it trades against an existing{" "}
        <strong>graduated Pons token</strong>: $PONS, or any other token that already made it through
        the Pons launchpad and has real, permanently locked liquidity behind it.
      </p>
      <p>
        Buyers spend that token. Fees are collected in that token. When the launch graduates, the pool
        it creates is paired with that token. So a launch is not just <em>listed</em> next to a
        community. It is economically wired into it.
      </p>

      <h2>2. That wiring can be pointed back at the quote token</h2>
      <p>
        Because every fee is already denominated in the quote token, a creator can route part of their
        own revenue somewhere useful without any swapping, pricing, or trusted operator:
      </p>
      <ul>
        <li>
          <strong>Burn it</strong>: send it to the dead address, making the quote token deflationary
          for as long as your token trades.
        </li>
        <li>
          <strong>Rebate it</strong>: give it back to the people who just traded.
        </li>
        <li>
          <strong>Pay holders</strong>: distribute it continuously to everyone holding your token.
        </li>
      </ul>
      <p>
        This is the flywheel: launching on $PONS gives $PONS holders a reason to care about your launch,
        because your launch is measurably good for them. See{" "}
        <Link href="/docs/fees">fees &amp; cashback</Link>.
      </p>

      <h2>The part that should make you comfortable</h2>
      <p>
        Launchpads are a category with a trust problem, so $POP is built to remove the trust rather than
        ask for it:
      </p>
      <ul>
        <li>Liquidity is locked forever, in a contract with no withdrawal function of any kind.</li>
        <li>
          A launch&apos;s fee terms are frozen at creation. Nobody, including us, can change them
          afterwards.
        </li>
        <li>
          Nobody can redirect a creator&apos;s revenue. There is no admin override, not even a
          timelocked one.
        </li>
        <li>Launch tokens have no owner, no mint function, no blacklist, and no pause.</li>
        <li>
          What quote tokens are allowed is decided by <em>rules checked on-chain</em>, not by us.
        </li>
      </ul>
      <p>
        The full list of every power that does exist is on <Link href="/docs/proof">/proof</Link>, with
        explorer links for each. <Link href="/docs/trust">Trust &amp; security</Link> explains the
        reasoning.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/docs/launching">Launch a token</Link>: the create flow, step by step.
        </li>
        <li>
          <Link href="/docs/trading">Buy &amp; sell</Link>: how the curve prices trades.
        </li>
        <li>
          <Link href="/docs/graduation">Graduation</Link>: what happens when a curve fills.
        </li>
        <li>
          <Link href="/docs/developers">Developers</Link>: addresses, ABIs, and the indexer API.
        </li>
      </ul>
    </>
  );
}

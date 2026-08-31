import Link from "next/link";

export default function PonscopeDoc() {
  return (
    <>
      <div className="eyebrow">Using $POP</div>
      <h1 className="mt-3 font-display text-[30px] font-semibold tracking-[-0.03em] text-ink">Ponscope</h1>
      <p className="mt-3">
        <Link href="/ponscope">Ponscope</Link> is the live board: every launch on the protocol, in three
        columns, each filtered independently. It refreshes every five seconds, so it is the fastest way to
        watch launches while they are still on the curve.
      </p>

      <h2>The three columns</h2>
      <table>
        <tbody>
          <tr>
            <td>
              <strong>Fresh</strong>
            </td>
            <td>
              Live launches, newest first. Ships with a 24-hour age bound, so it stays a feed of what is
              actually new rather than a list of everything ever created.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Filling</strong>
            </td>
            <td>
              Live launches ordered by how close the curve is to its threshold, fullest first. Ships with
              a 50% floor. This is where you watch for imminent graduations.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Graduated</strong>
            </td>
            <td>
              Launches that have completed and seeded their locked Uniswap V4 pool, most recent first.
              Sourced separately from the other two so it stays complete no matter how busy the chain is.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Filters</h2>
      <p>
        Each column has its own filter set, reached by the funnel button in its header, with a badge showing how many
        filters you have changed from that column&apos;s baseline. Every filter is applied to live indexer
        data, and combining them narrows the result: a launch has to satisfy all of them to show.
      </p>
      <ul>
        <li>
          <strong>Search</strong>: matches the token name or its ticker, case-insensitively.
        </li>
        <li>
          <strong>Quote token</strong>: restrict to launches priced in specific quotes. Selecting none
          means any.
        </li>
        <li>
          <strong>Cashback</strong>: filter by what a launch gives back: nothing, trader rebate, quote
          burn, or holder rewards.
        </li>
        <li>
          <strong>Curve min / max</strong>: bonding-curve progress in percent. Use it to find launches in
          a specific band, e.g. 80 to 99% for ones about to graduate.
        </li>
        <li>
          <strong>Min holders</strong>: filter out launches nobody is in yet.
        </li>
        <li>
          <strong>Min volume</strong>: denominated in each launch&apos;s own quote token, and read at that
          token&apos;s decimals, so a 6-decimal quote compares correctly against an 18-decimal one.
        </li>
        <li>
          <strong>Newer than / older than</strong>: age bounds in minutes, in either direction.
        </li>
        <li>
          <strong>Only launches that give something back</strong>: hides launches with no cashback
          configured.
        </li>
      </ul>
      <p>
        Filters are stored in your browser, per column, and survive a reload. They are yours alone;
        nothing about them is sent anywhere. <em>Reset</em> returns a column to its baseline.
      </p>

      <h2>What the rows show</h2>
      <p>
        Each row carries the quote token it is priced in, the current price, holder count, cumulative
        volume, an icon for its cashback mode, and, for anything still on the curve, a progress bar
        toward graduation. Age is measured from creation.
      </p>
      <p className="text-xs text-dim">
        Ponscope reads the same public indexer as the rest of the site, so anything you can see here you can
        query yourself. See <Link href="/docs/developers">developers</Link>.
      </p>
    </>
  );
}

import Link from "next/link";

export default function FeesDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Fees &amp; cashback</h1>
      <p className="mt-2">
        Every trade pays a fee on its quote leg, in both directions. The total is the same before and
        after graduation, and it is fixed for the life of a launch.
      </p>

      <h2>The split</h2>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Rate</th>
            <th>Goes to</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Base fee</td>
            <td>1% of the trade</td>
            <td>30% protocol, 70% creator</td>
          </tr>
          <tr>
            <td>Creator fee</td>
            <td>0 to 2%, creator&apos;s choice</td>
            <td>100% creator</td>
          </tr>
          <tr>
            <td>Cashback carve-out</td>
            <td>0 to 100% of the creator&apos;s combined take</td>
            <td>Depends on mode (below)</td>
          </tr>
        </tbody>
      </table>
      <p>
        The cashback share comes out of the <strong>creator&apos;s</strong> money, never out of an extra
        charge to traders. A launch with 100% cashback and one with 0% cost a trader exactly the same.
      </p>
      <p>
        There is also a flat ETH launch fee paid once at creation, and an anti-snipe tax that applies
        only in the opening seconds (it flows into the same split, so it funds the creator and their
        cashback mode rather than disappearing).
      </p>

      <h2>The four cashback modes</h2>

      <h3>None</h3>
      <p>The creator keeps their whole take. Simple, and the right default if you are unsure.</p>

      <h3>Trader rebate</h3>
      <p>
        A share of the creator&apos;s take is credited back to whoever made the trade, in the quote
        token, in the same transaction. It lands as a claimable balance you withdraw whenever.
      </p>
      <p>
        <strong>Caveat worth knowing:</strong> this only runs while the token is on its curve. After
        graduation, trades arrive through a router, so the contract can no longer tell who the human
        trader was, that share reverts to the creator. This is disclosed at creation and shown on the
        token page rather than buried.
      </p>

      <h3>Quote burn</h3>
      <p>
        A share is sent to the dead address, in the quote token, permanently reducing its supply. Runs
        before and after graduation, for the life of the token.
      </p>
      <p>
        This mode needs no swap, no price oracle and no operator, because the fee is <em>already</em> the
        quote token, so burning it is a single transfer. It is the cleanest of the modes mechanically, and
        the one that gives a quote token&apos;s community a direct reason to want your launch to
        succeed.
      </p>

      <h3>Holder rewards</h3>
      <p>
        A share is distributed continuously to everyone holding your token, pro-rata by balance, in the
        quote token. No staking, no snapshots, no claim windows, no operator publishing anything. Hold
        the token, accrue rewards, claim whenever.
      </p>
      <p>
        <strong>The tradeoff to understand:</strong> rewards can only be split by how much you held and
        for how long, and that can only be measured where balances move. So this mode, and{" "}
        <em>only</em> this mode, deploys a launch token with a transfer hook. That hook does accounting
        and nothing else: it cannot block a transfer, cannot change an amount, and the token still has
        no owner, no mint, no burn, no pause and no blacklist. Every other mode deploys the completely
        inert token. Transfers of a rewards token cost somewhat more gas.
      </p>
      <p>
        Contracts that structurally hold supply (the bonding curve, the pool, the locker) are excluded
        from earning, so rewards go to real holders instead of being stranded in machinery. That
        exclusion list is fixed when the token is created and can never be edited.
      </p>
      <p>
        Anyone can add to the reward pot by sending the quote token to the launch token address. A
        creator, a treasury, or a community member can fund holders directly.
      </p>

      <h2>Claiming</h2>
      <p>
        All revenue (protocol, creator, and trader rebates) lands in a pull-payment escrow. Holder
        rewards accrue on the token itself. In both cases you claim on your own schedule; nothing is
        pushed to you, which is what stops a hostile or broken recipient from being able to wedge
        trading for everybody else.
      </p>
      <p>
        Creators claim from the token page or from{" "}
        <code>/creator/&lt;your address&gt;</code>. Holders of a rewards token claim from the token
        page.
      </p>

      <h2>Changing your mind</h2>
      <p>
        You cannot. Fee percentage, cashback mode and share are immutable from creation. That is the
        point of them: they are the deal you offered your traders, and you should not be able to change
        it after they have bought. The one exception is the <em>address</em> your creator fees are paid
        to, which only you can update. See <Link href="/docs/trust">trust &amp; security</Link>.
      </p>
    </>
  );
}

import Link from "next/link";

import { GOVERNANCE } from "@/lib/addresses";

export default function TrustDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Trust &amp; security</h1>
      <p className="mt-2">
        The honest framing: launchpads are a category where the operator usually <em>can</em> take your
        money and is asking you to believe they will not. $POP is built to make most of those questions
        unanswerable rather than answered.
      </p>
      <p>
        This page explains the reasoning. <Link href="/docs/proof">/proof</Link> has the exhaustive list with
        explorer links for every contract and every power.
      </p>

      <h2>What nobody can do, including us</h2>
      <ul>
        <li>
          <strong>Touch locked liquidity.</strong> The locker has no withdraw, transfer, or
          arbitrary-call function. This is not a long timelock; there is no code path out at all.
        </li>
        <li>
          <strong>Redirect a creator&apos;s fees.</strong> There is no admin override anywhere in the
          system. Only the current recipient can hand off their own stream.
        </li>
        <li>
          <strong>Change a live launch&apos;s terms.</strong> Fee split, cashback mode, thresholds and
          pool parameters are snapshotted at creation. Later protocol changes apply only to launches
          created afterwards.
        </li>
        <li>
          <strong>Mint, pause, freeze or blacklist a launch token.</strong> Those functions do not
          exist.
        </li>
        <li>
          <strong>Delist a quote token</strong>, or list one that does not satisfy the on-chain rules.
        </li>
      </ul>

      <h2>What the protocol owner can do</h2>
      {GOVERNANCE === "timelock" ? (
        <p>
          Ownership sits behind a <strong>48-hour timelock</strong>, so every action is publicly visible
          for two days before it can execute. The complete list:
        </p>
      ) : (
        <p>
          Ownership is held <strong>directly by a single key</strong>, with no timelock, so the actions
          below take effect the moment they are sent. We are telling you this plainly because it is the
          weakest part of the deployment, and because the list itself is short by construction rather
          than by promise. The complete list:
        </p>
      )}
      <ul>
        <li>Configure terms for <em>future</em> launches (fee recipient, launch fee, launch config, snipe window).</li>
        <li>
          Add a new quote-origin adapter (append-only, never replacing an existing one, so listed quotes
          keep their verification path forever).
        </li>
        <li>
          Pause <em>new launches</em> on a specific quote token. Never pauses trading, never affects an
          existing launch or pool.
        </li>
        <li>
          Run narrowly-scoped rescue paths for launches or fee balances that get stuck. Every rescue
          pays <strong>fixed recipients</strong>: the launch&apos;s own creator recipient or the
          protocol&apos;s. The bond rescue only unlocks after a launch has been bond-ready for 14 days,
          during which anyone can still bond it. The owner chooses <em>when</em>, never <em>where</em>.
        </li>
        <li>Rotate the fee-sweep operator, which can only trigger fee conversions with a price floor.</li>
        <li>
          <strong>Adjust the $POP holder revenue share</strong> on the protocol&apos;s splitter, in
          either direction (it starts at 15% and <em>can be adjusted later on</em>). The owner can also
          point the splitter at the $POP token once, and choose the buyback burner&apos;s keeper. What
          the owner cannot do: claw back a distribution that already happened, or change the
          burner&apos;s 25% burn ratio, which is immutable.
        </li>
      </ul>
      <p>That is the whole surface. Anything not on that list does not exist in the code.</p>

      <h2>The deliberate tradeoff: lost keys</h2>
      <p>
        Because no admin can redirect a creator&apos;s fee stream, <strong>a creator who loses their key
        loses their future fees</strong>. Permanently. We could add a recovery path; the launchpad this
        design borrows its mechanics from has one. But that same path is by construction the power to
        take any creator&apos;s revenue and give it to someone else.
      </p>
      <p>
        We think the guarantee is worth more than the safety net, and that you deserve to be told about
        it rather than discovering it later. Nothing about it affects traders, holders, or liquidity.
      </p>

      <h2>Where the code comes from</h2>
      <p>
        The in-pool bonding curve, bonding, and hook mechanics follow the same pattern as the
        verified, MIT-licensed PonsV2 launchpad, which has processed tens of thousands of launches on
        this chain and is itself derived from an audited codebase. We did not invent the risky parts
        from scratch.
      </p>
      <p>
        What we changed is the trust model, and every departure is documented with its rationale{" "}
        <em>and the risk it introduces</em> in the audit scope document in the repository, including
        the ones that cut against us.
      </p>

      <h2>Audit status</h2>
      <p>
        <strong>An external audit is pending.</strong> Until it lands and is linked on{" "}
        <Link href="/docs/proof">/proof</Link>, treat this as unaudited code and size your positions
        accordingly. What exists today: a full test suite including adversarial cases (reentrant quote
        tokens, blocklisting quotes, fee-on-transfer quotes, 6- and 8-decimal quotes), property-based
        and end-to-end tests against a fork of the live chain, including a real WETH to PONS bond
        conversion on the real Pons pool and the real Uniswap deployment.
      </p>
      <p>
        Three real bugs were found and fixed by that suite before any of this shipped; they are
        disclosed in the audit document rather than quietly patched.
      </p>

      <h2>Risks that remain</h2>
      <ul>
        <li>
          <strong>Smart contract risk.</strong> Unaudited code. This is the big one.
        </li>
        <li>
          <strong>Quote token risk.</strong> Your launch inherits the quote token&apos;s fate. If it
          collapses, your launch&apos;s denomination collapses with it.
        </li>
        <li>
          <strong>Market risk.</strong> Locked liquidity guarantees a market exists, not that it is
          liquid at any particular price. Most tokens on any launchpad go to zero.
        </li>
        <li>
          <strong>Creator risk.</strong> Immutable fee terms mean a creator cannot rug the mechanics,
          they say nothing about whether the creator will keep building.
        </li>
      </ul>
    </>
  );
}

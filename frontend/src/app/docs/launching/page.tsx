import Link from "next/link";

export default function LaunchingDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Launch a token</h1>
      <p className="mt-2">
        Launching costs a flat fee in ETH for gas-token reasons, and nothing else. Everything you choose
        in this form is permanent, so it is worth understanding before you sign.
      </p>

      <h2>1. Identity</h2>
      <p>
        Name, ticker, description, image and socials are stored <strong>on-chain</strong>, in the token
        contract itself, not in our database. If this site disappeared, your token&apos;s metadata would
        still be readable by anyone. Images are referenced by URL; use an IPFS link (Pinata,
        web3.storage) if you want the image to be as durable as the rest.
      </p>

      <h2>2. Quote token</h2>
      <p>
        Pick which graduated Pons token your launch trades against. This choice decides who your natural
        audience is: buyers need that token to buy yours, and your fees flow in it.
      </p>
      <p>
        Each quote shows how many launches it has hosted and how much of it has been burned by those
        launches. Picking a quote with an active community is usually worth more than picking the
        largest one. See <Link href="/docs/quotes">quote tokens</Link>.
      </p>

      <h2>3. Your fee</h2>
      <p>
        You can charge <strong>0% to 2%</strong> on every trade, forever, on the curve and on the pool
        after graduation. This is on top of the protocol&apos;s 1% base fee, and it is yours.
      </p>
      <p>
        There is no vesting, no cliff, and no claim deadline. Fees accumulate to a claimable balance you
        withdraw whenever you like, from the token page or your{" "}
        <Link href="/docs/fees">creator dashboard</Link>.
      </p>

      <h2>4. Cashback mode</h2>
      <p>
        Optionally route part of <em>your</em> take somewhere else. This never increases what traders
        pay; it only changes where your share goes. The four options and their tradeoffs are covered in{" "}
        <Link href="/docs/fees">fees &amp; cashback</Link>. The create form draws a live diagram of the
        split as you move the sliders.
      </p>

      <h2>5. Dev buy (optional)</h2>
      <p>
        You can buy your own token in the same transaction that creates it. Your address, your fee
        recipient, and any bundle wallets you declare are <strong>exempt from the anti-snipe tax</strong>
        , so your opening buy clears at the honest price while bots in the same window do not.
      </p>
      <p>
        If your dev buy is larger than the curve can fill, the excess is returned to you in the same
        transaction, so you are never charged for tokens you did not receive.
      </p>

      <h2>What happens when you sign</h2>
      <ol>
        <li>The launch is simulated first. If it would fail, you see why instead of losing gas.</li>
        <li>
          The exact economics you were quoted are <strong>pinned into the transaction</strong>. If
          anything moved between quoting and confirming, the launch reverts rather than proceeding on
          different terms.
        </li>
        <li>Your token and its bonding curve are deployed, and trading opens immediately.</li>
      </ol>

      <h2>Anti-snipe window</h2>
      <p>
        For the first few seconds, buys pay a tax that starts near 100% and decays to zero. Sniping bots
        that front-run your announcement pay most of their spend as fees, which flow to you and your
        cashback mode, while a human buying a minute later pays nothing extra. Exempt wallets (yours,
        plus up to 32 you declare) never pay it.
      </p>

      <h2>Things you cannot change later</h2>
      <ul>
        <li>Your fee percentage.</li>
        <li>Your cashback mode and its share.</li>
        <li>The quote token, supply, and graduation threshold.</li>
        <li>The token&apos;s name, ticker, and on-chain metadata.</li>
      </ul>
      <p>
        The <strong>only</strong> thing you can change is which address receives your creator fees, and
        only you can change it. Nobody can change it for you, which also means that if you lose the
        key, those future fees are gone. That tradeoff is deliberate; see{" "}
        <Link href="/docs/trust">trust &amp; security</Link>.
      </p>
    </>
  );
}

import Link from "next/link";

export default function GraduationDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Graduation</h1>
      <p className="mt-2">
        Graduation is the moment a launch stops being a bonding curve and becomes a real, permanently
        liquid market. On most launchpads this is the riskiest step in the whole lifecycle. Here it is
        deliberately boring, and the reason is worth understanding.
      </p>

      <h2>Why it is not risky here</h2>
      <p>
        The usual graduation has to <em>convert</em>: the curve collected one asset, the pool needs
        another, so somewhere in the middle there is a swap. A swap needs a price. A price needs an
        oracle or a router, and both can be manipulated by whoever is watching for exactly this moment.
      </p>
      <p>
        A $POP curve collects the quote token from the very first trade, the same token its pool will
        be paired with. So at graduation there is <strong>nothing to convert</strong>. No swap, no
        router, no oracle, no slippage parameter, nothing to front-run. The curve hands over exactly
        what the pool needs.
      </p>

      <h2>What happens, in order</h2>
      <ol>
        <li>
          <strong>The threshold is crossed.</strong> A buy takes the curve&apos;s sellable allocation to
          zero. That same transaction attempts graduation automatically.
        </li>
        <li>
          <strong>Phase one: the curve is drained.</strong> Outstanding fees are swept, trading halts
          permanently, and the collected quote plus the remaining tokens move to the factory.
        </li>
        <li>
          <strong>Phase two: the pool is seeded.</strong> A Uniswap V4 pool is created at exactly the
          curve&apos;s final price, and a full-range liquidity position is minted{" "}
          <strong>directly into the locker</strong>. Not to us and then transferred, but minted straight
          there, so there is never a block in which anyone could have taken it.
        </li>
      </ol>

      <h2>Both phases are permissionless</h2>
      <p>
        The crossing buy tries to do this atomically, but wallets do not account for that extra work
        when estimating gas, so sometimes it runs out. That is fine and expected: <strong>anyone</strong>{" "}
        can complete either phase afterwards, and it stays retryable forever. A keeper does it within
        seconds; if the keeper vanished, any holder could do it themselves.
      </p>
      <p>Nothing is ever stuck waiting on us.</p>

      <h2>What gets locked</h2>
      <ul>
        <li>
          <strong>The entire liquidity position.</strong> The NFT representing it lives in a contract
          with no withdrawal function, no transfer function, and no arbitrary-call function. Not
          time-locked. There is simply no code path out.
        </li>
        <li>
          <strong>The supply that could not enter the pool.</strong> The curve prices against a virtual
          reserve; the portion of supply corresponding to it would lower the pool&apos;s opening price
          if it were added. It is locked instead of circulating, roughly 8% of supply on standard
          terms.
        </li>
      </ul>

      <h2>After graduation</h2>
      <p>
        The token trades in a normal V4 pool. Fees keep working exactly as before: same total, same
        split, same cashback mode, collected by the hook instead of the curve. Creator revenue and
        holder rewards continue for the life of the pool.
      </p>
      <p>
        The one behavioural difference is the trader-rebate mode, which cannot identify the human trader
        through a router and so reverts to the creator. See <Link href="/docs/fees">fees</Link>.
      </p>

      <h2>If a quote token turns hostile</h2>
      <p>
        A quote token that changes behaviour after listing, by starting to tax transfers or blocklisting an
        address the protocol needs, can make the seeding step impossible. For that case there is a
        rescue path, and it is bounded on every axis: it can only pay the launch&apos;s{" "}
        <em>own creator</em>, never an address anyone picks; it only unlocks after 14 days; and during
        the entire wait anyone can still complete the graduation normally and end the window
        permanently. It exists so funds cannot be bricked, not so anyone can take them.
      </p>
    </>
  );
}

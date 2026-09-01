import Link from "next/link";

export default function GraduationDoc() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-0.8px]">Bonding</h1>
      <p className="mt-2">
        Bonding is what other launchpads call graduation: the moment a launch leaves its curve and
        becomes a real, permanently liquid market. Here the curve raises plain ETH, and bonding converts
        that whole raise into the launch&apos;s chosen quote token in one public market buy. It is worth
        understanding exactly how.
      </p>

      <h2>The curve is already a pool</h2>
      <p>
        There is no separate curve contract. At launch the entire curve allocation is placed as a
        single-sided liquidity position over the curve&apos;s price range, inside a live Uniswap V4 pool
        quoted in WETH, held by the factory. Buying up the curve is just swapping that pool. The curve
        raises <strong>4.2 ETH</strong>; a phantom reserve of 1.68 ETH sets the launch price, over a
        supply of one billion tokens.
      </p>

      <h2>What happens, in order</h2>
      <ol>
        <li>
          <strong>The range fills.</strong> Buys push the price to the top of the curve&apos;s range and
          the raise reaches its 4.2 ETH threshold. The factory starts reporting{" "}
          <code>isBondReady(token)</code> and the hook emits <code>BondReady</code>.
        </li>
        <li>
          <strong>Anyone calls bond().</strong> The factory withdraws the curve position and the entire
          ETH raise market-buys the creator&apos;s chosen quote token, a graduated Pons token, $PONS by
          default, on that quote&apos;s canonical V3 pool. The buy is bounded by a 30-minute TWAP with at
          most 5% slippage, so it cannot be sandwiched into a bad price.
        </li>
        <li>
          <strong>The new pool seeds.</strong> A token/quote Uniswap V4 pool is created at exactly the
          curve&apos;s terminal price, and the liquidity position is minted{" "}
          <strong>directly into the locker</strong>. Not to us and then transferred, but minted straight
          there, so there is never a block in which anyone could have taken it.
        </li>
      </ol>

      <h2>Every bond is a buy</h2>
      <p>
        Because the whole raise converts at once, every bond is a large public market buy of the quote
        token. That is the mechanism that makes a launch measurably good for the community it bonds
        into, and it is why quote-token holders have a reason to watch launches that are close to
        filling.
      </p>

      <h2>Bonding is permissionless</h2>
      <p>
        <code>bond(token, minQuoteOut)</code> can be called by <strong>anyone</strong> once the curve is
        ready, and it stays callable forever. A keeper does it within seconds; if the keeper vanished,
        any holder or bot could do it themselves.
      </p>
      <p>Nothing is ever stuck waiting on us.</p>

      <h2>What gets locked</h2>
      <ul>
        <li>
          <strong>The entire liquidity position.</strong> The NFT representing it lives in a contract
          with no withdrawal function, no transfer function, and no arbitrary-call function. Not
          time-locked. There is simply no code path out.
        </li>
      </ul>

      <h2>After the bond</h2>
      <p>
        The token trades in a normal V4 pool paired with its quote token. Fees keep working exactly as
        before: same total, same split, same cashback mode, still collected by the hook, now denominated
        in the quote token instead of WETH. Creator revenue and holder rewards continue for the life of
        the pool.
      </p>
      <p>
        Cashback carve-outs that accrued in WETH during the curve phase are converted and settled at the
        bond. See <Link href="/docs/fees">fees</Link>.
      </p>

      <h2>If a quote token turns hostile</h2>
      <p>
        A quote token that changes behaviour after listing, by starting to tax transfers or breaking its
        own pool, can make the bond&apos;s market buy impossible. For that case there is a rescue path,
        and it is bounded on every axis: it can only pay the launch&apos;s <em>own creator fee
        recipient</em>, never an address anyone picks; it only unlocks after the launch has sat
        bond-ready for 14 days; and during the entire wait anyone can still complete the bond normally
        and end the window permanently. It exists so funds cannot be bricked, not so anyone can take
        them.
      </p>
    </>
  );
}

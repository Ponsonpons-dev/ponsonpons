"use client";

/**
 * Live fee-flow breakdown: where each 100 units of trade fee go under the
 * current create-form settings. Base fee is 1% of the trade (50% protocol /
 * 50% creator, the hook's hard cap on the protocol side), creator fee is 0 to
 * 2% on top (all creator), and the cashback share is carved out of the
 * creator's combined take.
 */
export function FeeFlowDiagram({
  creatorFeeBps,
  cashbackMode,
  cashbackShareBps,
}: {
  creatorFeeBps: number;
  cashbackMode: number;
  cashbackShareBps: number;
}) {
  const baseBps = 100;
  const totalBps = baseBps + creatorFeeBps;
  const protocolBps = (baseBps * 5000) / 10_000;
  const creatorTakeBps = totalBps - protocolBps;
  const cashbackBps = cashbackMode === 0 ? 0 : (creatorTakeBps * cashbackShareBps) / 10_000;
  const creatorNetBps = creatorTakeBps - cashbackBps;

  const rows = [
    { label: "Protocol", bps: protocolBps, color: "bg-dim" },
    { label: "Creator (you)", bps: creatorNetBps, color: "bg-pop" },
    ...(cashbackMode === 2
      ? [{ label: "Burned quote", bps: cashbackBps, color: "bg-burn" }]
      : cashbackMode === 3
        ? [{ label: "Paid to holders", bps: cashbackBps, color: "bg-up" }]
        : []),
  ];

  return (
    <div className="card p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-semibold">Fee flow per trade</span>
        <span className="text-xs text-dim">total {(totalBps / 100).toFixed(2)}% of each trade</span>
      </div>
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        {rows.map((r) => (
          <div
            key={r.label}
            className={`${r.color} transition-[width] duration-300`}
            style={{ width: `${(r.bps / totalBps) * 100}%` }}
            title={`${r.label}: ${(r.bps / 100).toFixed(3)}%`}
          />
        ))}
      </div>
      <div className="mt-2 space-y-1 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${r.color}`} />
              {r.label}
            </span>
            <span className="text-dim">{(r.bps / 100).toFixed(3)}% of each trade</span>
          </div>
        ))}
      </div>
      {cashbackMode === 2 && (
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          Quote burn runs forever; curve-phase carve-outs convert and burn at the bond, pool-phase
          burns happen at each sweep. Launching with burn on makes your quote token's community your
          marketing team.
        </p>
      )}
      {cashbackMode === 3 && (
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          Holder rewards run forever too, paid in the bond quote to everyone holding your token
          (curve-phase carve-outs convert at the bond), with no
          staking, no snapshots, no operator. This mode deploys the reward-token variant, which carries
          an accounting-only transfer hook (still no owner and no transfer restrictions); every other
          mode gets the completely inert token.
        </p>
      )}
    </div>
  );
}

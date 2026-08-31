"use client";

import Link from "next/link";

import { ArrowRight } from "./icons";

import { AddressLink } from "./ui";
import { ADDRESSES, explorerAddress } from "@/lib/addresses";
import type { Launch } from "@/lib/indexer";

/** The anti-rug pitch, per token, with explorer proof for every claim. */
export function TrustPanel({ launch }: { launch: Launch }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Token contract (verified)", value: <AddressLink address={launch.token} /> },
    { label: "Bonding curve (verified)", value: <AddressLink address={launch.curve} /> },
    {
      label: "Admin powers over this launch",
      value: <span className="font-bold text-up">None</span>,
    },
    {
      label: "Token owner / mint / blacklist",
      value: <span className="text-up">None. Plain fixed-supply ERC-20</span>,
    },
    {
      label: "Fee terms",
      value: (
        <span>
          Frozen at launch: 1% base + {(launch.creatorFeeBps / 100).toFixed(2)}% creator
        </span>
      ),
    },
  ];

  if (launch.phase === 2) {
    rows.push(
      {
        label: "Liquidity",
        value: (
          <span className="font-bold text-up">
            100% locked forever,{" "}
            <a
              className="text-pop hover:underline"
              href={explorerAddress(ADDRESSES.locker)}
              target="_blank"
              rel="noreferrer"
            >
              locker ↗
            </a>
            {launch.positionId ? ` (position #${launch.positionId})` : ""}
          </span>
        ),
      },
      {
        label: "Supply never in circulation",
        value: <span>{(Number(launch.lockedSupplyExcess) / 1e18 / 1e6).toFixed(1)}M locked at graduation</span>,
      },
    );
  } else {
    rows.push({
      label: "At graduation",
      value: <span>Entire pool position mints directly into the locker: no migration step, no window</span>,
    });
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold">Trust panel</span>
        <Link href="/docs/proof" className="flex items-center gap-1 text-xs text-pop transition-colors hover:text-ink">
          <span className="whitespace-nowrap">full proof</span>
          <ArrowRight className="h-3 w-3 shrink-0" />
        </Link>
      </div>
      <dl className="space-y-2 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3">
            <dt className="text-dim">{r.label}</dt>
            <dd className="text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

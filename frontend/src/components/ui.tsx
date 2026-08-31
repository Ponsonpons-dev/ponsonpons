"use client";

import Link from "next/link";

import { explorerAddress } from "@/lib/addresses";
import { shortAddr } from "@/lib/format";

function ipfsUrl(logo: string) {
  return logo.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${logo.slice(7)}` : logo;
}

/** Stable hue from an address so a logo-less token always gets the same tile. */
function seedHue(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

export function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="card px-3.5 py-3">
      <div className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim/70">{label}</div>
      <div className={`mt-1 text-[15px] font-semibold tabular-nums tracking-[-0.02em] ${accent ?? "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

export function ProgressBar({ bps }: { bps: number }) {
  const pct = Math.min(100, bps / 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.07] shadow-[inset_0_1px_1px_rgb(0_0_0_/_0.35)]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-pop/70 to-pop shadow-[0_0_10px_rgb(20_216_44_/_0.55)] transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a
      href={explorerAddress(address)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[12px] text-pop transition-colors hover:text-ink"
    >
      {label ?? shortAddr(address)}
    </a>
  );
}

export function TokenLogo({ logo, symbol, size = 40 }: { logo: string; symbol: string; size?: number }) {
  const src = logo ? ipfsUrl(logo) : "";
  if (!src) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full border border-edge bg-ink/[0.05] text-[11px] font-semibold text-pop shadow-[inset_0_1px_0_rgb(237_242_234_/_0.1)]"
        style={{ width: size, height: size }}
      >
        {symbol.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={symbol}
      width={size}
      height={size}
      className="shrink-0 rounded-full border border-edge bg-ink/[0.05] object-cover"
      style={{ width: size, height: size }}
      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
    />
  );
}

/**
 * Square token artwork: the launch's own image, or a tinted glass panel keyed
 * to its address. Hue varies per token, but lightness and saturation are
 * pinned so every tile still sits inside the site's palette.
 */
export function TokenTile({ logo, symbol, seed }: { logo: string; symbol: string; seed: string }) {
  const src = logo ? ipfsUrl(logo) : "";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={symbol}
        className="aspect-square w-full rounded-[12px] border border-edge bg-ink/[0.05] object-cover"
        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
      />
    );
  }
  const hue = seedHue(seed);
  return (
    <div
      className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[12px] border border-edge shadow-[inset_0_1px_0_rgb(237_242_234_/_0.14)]"
      style={{
        background:
          // Full hue wheel for identity, but saturation and lightness are
          // pinned low so a tile always reads as tinted glass on the forest
          // ground rather than a neon square fighting the palette.
          `linear-gradient(155deg, hsl(${hue} 26% 30%), hsl(${(hue + 24) % 360} 30% 13%))`,
      }}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1/2 opacity-40"
        style={{ background: "linear-gradient(180deg, rgb(237 242 234 / 0.16), transparent)" }}
      />
      <span className="relative font-display text-[44px] font-semibold tracking-[-0.04em] text-ink/85 sm:text-[52px]">
        {symbol.slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[16px] border border-edge bg-ink/[0.035] ${className}`} />;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-dashed border-edge px-6 py-12 text-center text-[13px] leading-relaxed text-dim">
      <div className="mx-auto max-w-[46ch]">{children}</div>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[12.5px] text-dim transition-colors hover:text-ink">
      ← {children}
    </Link>
  );
}

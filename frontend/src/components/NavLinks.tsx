"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/ponscope", label: "Ponscope" },
  { href: "/create", label: "Launch" },
  { href: "/docs", label: "Docs" },
];

/**
 * One nav, two shapes: a floating glass capsule on desktop, a scrollable strip
 * of chips on mobile. Kept in a single component so the active state and the
 * link list can never drift apart.
 */
export function NavLinks({ className = "", mobile = false }: { className?: string; mobile?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  if (mobile) {
    return (
      <nav className={className}>
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                active
                  ? "border-pop/35 bg-pop/10 text-pop"
                  : "border-edge bg-ink/[0.03] text-dim active:bg-ink/[0.07]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      className={`items-center gap-0.5 rounded-full border border-edge bg-ink/[0.035] p-1 shadow-[inset_0_1px_0_rgb(237_242_234_/_0.06)] ${className}`}
    >
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              active ? "bg-ink/[0.09] text-ink" : "text-dim hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

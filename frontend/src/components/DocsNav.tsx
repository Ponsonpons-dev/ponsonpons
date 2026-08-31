"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS: Array<{ title: string; items: Array<{ href: string; label: string }> }> = [
  {
    title: "Start here",
    items: [
      { href: "/docs", label: "What $POP is" },
      { href: "/docs/launching", label: "Launch a token" },
      { href: "/docs/trading", label: "Buy & sell" },
      { href: "/docs/ponscope", label: "Ponscope" },
    ],
  },
  {
    title: "Mechanics",
    items: [
      { href: "/docs/fees", label: "Fees & cashback" },
      { href: "/docs/quotes", label: "Quote tokens" },
      { href: "/docs/graduation", label: "Graduation" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/trust", label: "Trust & security" },
      { href: "/docs/proof", label: "Proof" },
      { href: "/docs/faq", label: "FAQ" },
      { href: "/docs/developers", label: "Developers" },
    ],
  },
];

export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav className="text-sm">
      <div className="mb-4 text-xs font-bold uppercase tracking-wide text-dim lg:hidden">Docs</div>
      <div className="flex gap-6 overflow-x-auto pb-2 lg:block lg:gap-0 lg:overflow-visible lg:pb-0">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-5 shrink-0">
            <div className="mb-1.5 hidden text-[11px] font-semibold uppercase tracking-wide text-dim lg:block">
              {section.title}
            </div>
            <ul className="flex gap-3 lg:block lg:space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href} className="whitespace-nowrap">
                    <Link
                      href={item.href}
                      className={`block rounded-[10px] px-2.5 py-2 text-[13.5px] transition-colors ${
                        active
                          ? "bg-pop/[0.07] font-semibold text-pop"
                          : "text-dim hover:bg-ink/[0.05] hover:text-ink"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

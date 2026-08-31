import Link from "next/link";

import { DocsNav } from "@/components/DocsNav";

export const metadata = {
  title: "Docs · $POP",
  description: "How $POP works: launching, fee modes, quote listing, graduation, and the trust model.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <DocsNav />
      </aside>
      <article className="prose-pop min-w-0 max-w-3xl pb-10">
        {children}
        <hr className="my-8 border-edge" />
        <p className="text-xs text-dim">
          Something unclear or wrong? The contracts are the source of truth, and every claim here is
          checkable on{" "}
          <Link href="/docs/proof" className="text-pop">
            /proof
          </Link>
          .
        </p>
      </article>
    </div>
  );
}

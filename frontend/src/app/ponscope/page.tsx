import type { Metadata } from "next";

import { Scope } from "@/components/scope/Scope";

export const metadata: Metadata = {
  title: "Ponscope",
  description:
    "Every $POP launch as it happens: fresh, filling and graduated, in three live columns you can filter independently.",
};

export default function ScopePage() {
  return <Scope />;
}

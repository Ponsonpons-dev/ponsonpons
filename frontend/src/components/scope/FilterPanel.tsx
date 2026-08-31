"use client";

import { useEffect, useRef } from "react";

import { CASHBACK_ICON } from "@/components/icons";
import { CASHBACK_LABEL } from "@/lib/format";
import type { Quote } from "@/lib/indexer";
import type { ColumnKey, Filters } from "@/lib/scope";
import { defaultsFor } from "@/lib/scope";

/** Numeric input that maps "" to null so a cleared bound means "no bound". */
function NumField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <label className="flex-1">
      <span className="mb-1 block text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim/70">
        {label}
      </span>
      <span className="relative block">
        <input
          type="number"
          inputMode="decimal"
          className="input py-1.5 text-[13px]"
          placeholder={placeholder ?? "any"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-dim/60">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
        active
          ? "border-pop/40 bg-pop/10 text-pop"
          : "border-edge bg-ink/[0.03] text-dim hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterPanel({
  columnKey,
  filters,
  quotes,
  onChange,
  onClose,
}: {
  columnKey: ColumnKey;
  filters: Filters;
  quotes: Quote[];
  onChange: (f: Filters) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click or Escape, like any popover should.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v });

  const toggleIn = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Column filters"
      className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(320px,calc(100vw-2rem))] rounded-[16px] border border-edge bg-raised/95 p-4 shadow-[0_20px_60px_rgb(0_0_0_/_0.6)] backdrop-blur-xl"
    >
      <input
        className="input py-1.5 text-[13px]"
        placeholder="Search name or ticker…"
        value={filters.q}
        onChange={(e) => set("q", e.target.value)}
      />

      <div className="mt-4">
        <div className="mb-2 text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim/70">
          Quote token
        </div>
        <div className="flex flex-wrap gap-1.5">
          {quotes.map((q) => (
            <Chip
              key={q.address}
              active={filters.quotes.includes(q.address.toLowerCase())}
              onClick={() => set("quotes", toggleIn(filters.quotes, q.address.toLowerCase()))}
            >
              ${q.symbol ?? "?"}
            </Chip>
          ))}
          {!quotes.length && <span className="text-[12px] text-dim/70">none listed yet</span>}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim/70">
          Cashback
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3].map((mode) => {
            const Icon = CASHBACK_ICON[mode];
            return (
              <Chip
                key={mode}
                active={filters.modes.includes(mode)}
                onClick={() => set("modes", toggleIn(filters.modes, mode))}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {CASHBACK_LABEL[mode]}
              </Chip>
            );
          })}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex gap-2">
          <NumField
            label="Curve min"
            suffix="%"
            value={filters.minProgress}
            onChange={(v) => set("minProgress", v)}
          />
          <NumField
            label="Curve max"
            suffix="%"
            value={filters.maxProgress}
            onChange={(v) => set("maxProgress", v)}
          />
        </div>
        <div className="flex gap-2">
          <NumField label="Min holders" value={filters.minHolders} onChange={(v) => set("minHolders", v)} />
          <NumField
            label="Min volume"
            value={filters.minVolume}
            onChange={(v) => set("minVolume", v)}
            placeholder="any"
          />
        </div>
        <div className="flex gap-2">
          <NumField
            label="Newer than"
            suffix="min"
            value={filters.maxAgeMin}
            onChange={(v) => set("maxAgeMin", v)}
          />
          <NumField
            label="Older than"
            suffix="min"
            value={filters.minAgeMin}
            onChange={(v) => set("minAgeMin", v)}
          />
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-[12.5px] text-dim">
        <input
          type="checkbox"
          checked={filters.cashbackOnly}
          onChange={(e) => set("cashbackOnly", e.target.checked)}
          className="h-3.5 w-3.5 accent-pop"
        />
        Only launches that give something back
      </label>

      <div className="mt-4 flex justify-between border-t border-edge pt-3">
        <button
          type="button"
          onClick={() => onChange(defaultsFor(columnKey))}
          className="text-[12.5px] text-dim transition-colors hover:text-ink"
        >
          Reset
        </button>
        <button type="button" onClick={onClose} className="text-[12.5px] font-medium text-pop">
          Done
        </button>
      </div>
    </div>
  );
}

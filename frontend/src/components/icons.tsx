/**
 * A small, deliberately uniform icon set: 16px grid, 1.5 stroke, currentColor,
 * no fills. These replace the emoji the UI used to lean on. Emoji render
 * differently on every platform and read as decoration rather than as part of
 * the type system.
 */
type IconProps = { className?: string };

const base = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Image upload drop zone. */
export function UploadImage({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <path d="M2 11l3.2-3.2a1 1 0 0 1 1.4 0L10 11.2" />
      <circle cx="10.25" cy="5.75" r="1.15" />
    </svg>
  );
}

/** Quote burn. */
export function Flame({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 1.75s3.75 2.5 3.75 6a3.75 3.75 0 1 1-7.5 0c0-1.4.6-2.4 1.2-3.1.2 1 .8 1.6 1.5 1.85C7.2 5.3 7.4 3.3 8 1.75Z" />
    </svg>
  );
}

/** Holder rewards. */
export function Droplet({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 1.9c2 2.3 4 4.2 4 6.6a4 4 0 0 1-8 0c0-2.4 2-4.3 4-6.6Z" />
    </svg>
  );
}

/** Trader rebate. */
export function Rebate({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13.5 9.5a4.75 4.75 0 0 0-4.75-4.75H3.2" />
      <path d="M5.9 2.2 2.6 4.75 5.9 7.3" />
    </svg>
  );
}

export function Check({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 8.4 6.2 11.6 13 4.8" />
    </svg>
  );
}

export function Lock({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.25" y="7" width="9.5" height="7" rx="2" />
      <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" />
    </svg>
  );
}

export function ArrowRight({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 8h10" />
      <path d="M9.25 4.25 13 8l-3.75 3.75" />
    </svg>
  );
}

export function ArrowDown({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 3v10" />
      <path d="M4.25 9.25 8 13l3.75-3.75" />
    </svg>
  );
}

export function XLogo({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M12.6 0h2.45l-5.35 6.12L16 16h-4.93l-3.86-5.05L2.79 16H.34l5.72-6.54L0 0h5.05l3.5 4.62L12.6 0Zm-.86 14.53h1.36L4.32 1.39H2.87l8.87 13.14Z" />
    </svg>
  );
}

/** Icon + colour for a launch's cashback mode, keyed by the on-chain enum. */
export const CASHBACK_ICON = [null, Rebate, Flame, Droplet] as const;
export const CASHBACK_TONE = ["text-dim", "text-ink", "text-burn", "text-pop"] as const;

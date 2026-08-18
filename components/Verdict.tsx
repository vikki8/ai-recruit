import type { Verdict } from "@/lib/schemas";

export const VERDICT_UI: Record<
  Verdict,
  { label: string; symbol: string; cell: string; pill: string }
> = {
  met: {
    label: "Met",
    symbol: "✓",
    cell: "bg-emerald-50 text-emerald-700",
    pill: "bg-emerald-100 text-emerald-800",
  },
  partial: {
    label: "Partial",
    symbol: "~",
    cell: "bg-amber-50 text-amber-700",
    pill: "bg-amber-100 text-amber-800",
  },
  missing: {
    label: "Missing",
    symbol: "—",
    cell: "bg-slate-50 text-slate-400",
    pill: "bg-slate-100 text-slate-600",
  },
};

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const ui = VERDICT_UI[verdict];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${ui.pill}`}
    >
      {ui.label}
    </span>
  );
}

export function KindBadge({ kind }: { kind: "must_have" | "nice_to_have" }) {
  const must = kind === "must_have";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
        must ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-700"
      }`}
    >
      {must ? "Must" : "Nice"}
    </span>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
      {(["met", "partial", "missing"] as const).map((v) => (
        <span key={v} className="flex items-center gap-1.5">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded ${VERDICT_UI[v].cell} font-semibold`}
          >
            {VERDICT_UI[v].symbol}
          </span>
          {VERDICT_UI[v].label}
        </span>
      ))}
      <span className="text-[var(--muted)]">Hover any cell to read the quoted evidence.</span>
      <span className="text-[var(--muted)]">
        Click a candidate&rsquo;s name to see full evidence.
      </span>
    </div>
  );
}

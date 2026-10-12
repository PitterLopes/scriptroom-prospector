import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Card({ title, children, action, className = "" }: { title?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm ${className}`}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "bad" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
  accent: "bg-blue-100 text-blue-800",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">{children}</div>;
}

export function Button({ children, tone = "neutral", type = "submit", name, value, title }: { children: ReactNode; tone?: "neutral" | "accent" | "bad"; type?: "submit" | "button"; name?: string; value?: string; title?: string }) {
  const styles = tone === "accent" ? "bg-[var(--accent)] text-white hover:opacity-90" : tone === "bad" ? "bg-red-600 text-white hover:opacity-90" : "border border-[var(--line)] bg-white hover:bg-slate-50";
  return (
    <button type={type} name={name} value={value} title={title} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${styles}`}>
      {children}
    </button>
  );
}

export function channelTone(state: string): Tone {
  if (state === "human_review_required" || state === "api_window_closed") return "warn";
  if (state === "do_not_contact" || state === "blocked") return "bad";
  if (state === "api_active" || state === "api_eligible") return "accent";
  if (state === "completed") return "neutral";
  return "neutral";
}

export function pipelineTone(state: string): Tone {
  if (["interested", "whatsapp_handoff", "registered", "active_customer", "active_affiliate", "generated_customer"].includes(state)) return "ok";
  if (state === "closed") return "neutral";
  if (state === "replied") return "accent";
  return "neutral";
}

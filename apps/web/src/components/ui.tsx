import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { publicUrl } from "../lib/api";

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; tone: "success" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${t.tone === "error" ? "bg-danger text-white" : "bg-ink text-white"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- layout primitives ---------- */
export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  return (
    <div className="mb-6">
      {back && <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">‹ {back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-card border border-line bg-white p-4 shadow-sm md:p-5 ${className}`}>{children}</section>;
}
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold tracking-tight">{children}</h2>{aside}</div>;
}

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "lime";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface text-muted", brand: "bg-brand-50 text-brand", success: "bg-green-50 text-success",
  warning: "bg-amber-50 text-amber-800", danger: "bg-red-50 text-danger", lime: "bg-lime text-ink",
};
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children?: ReactNode }) {
  const c = { info: "border-brand/30 bg-brand-50", warning: "border-amber-300 bg-amber-50", danger: "border-danger/30 bg-red-50", success: "border-success/30 bg-green-50" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`rounded-2xl border p-4 text-sm ${c}`}>
      {title && <p className="font-bold">{title}</p>}
      {children && <div className={title ? "mt-1 text-ink/80" : "text-ink/80"}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-10 text-center">
      <p className="text-lg font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-muted">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-card bg-surface ${className}`} aria-hidden />;
}
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return <div role="status" aria-label="Loading" className="space-y-3">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} />)}</div>;
}

/* ---------- people ---------- */
export function Avatar({ name, path, size = 44 }: { name: string; path?: string | null; size?: number }) {
  const url = publicUrl("avatars", path);
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("");
  return url ? (
    <img src={url} alt={name} width={size} height={size} className="flex-none rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="grid flex-none place-items-center rounded-full bg-lime font-extrabold text-ink" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials}</span>
  );
}

export function Stars({ value, count }: { value: number; count: number }) {
  if (count === 0) return <Pill tone="brand">New on ConnectMe</Pill>;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span className="text-amber-500" aria-hidden>★</span>
      <b>{Number(value).toFixed(1)}</b>
      <span className="text-muted">({count} {count === 1 ? "review" : "reviews"})</span>
    </span>
  );
}

export function VerifiedBadge({ level }: { level: number }) {
  return <Pill tone="lime">✓ {level >= 3 ? "Trusted Pro" : "Verified Pro"}</Pill>;
}

/* ---------- forms ---------- */
export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: ReactNode; error?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function Button({ children, variant = "primary", loading, className = "", ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "soft"; loading?: boolean }) {
  const v = { primary: "btn", ghost: "btn btn-ghost", soft: "btn bg-surface text-ink", danger: "btn bg-danger" }[variant];
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`${v} ${className}`}>
      {loading ? "Please wait…" : children}
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 flex-none rounded-full transition ${checked ? "bg-brand" : "bg-line"} disabled:opacity-50`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/* ---------- dialogs ---------- */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose in a ref. Depending on it directly re-ran the effect on every keystroke
  // (parents pass a new function each render) and stole focus from the text field being typed in.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("textarea, input, select");
    (first ?? ref.current)?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 p-0 md:items-center md:p-4" onClick={() => closeRef.current()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl outline-none md:rounded-3xl">
        <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
        <div className="mt-3">{children}</div>
        {footer && <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
      ))}
    </dl>
  );
}

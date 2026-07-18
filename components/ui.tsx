"use client";

import { ReactNode } from "react";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Kpi({ titulo, valor, sub, tom = "default" }: { titulo: string; valor: string; sub?: string; tom?: "default" | "brand" | "warn" | "good" }) {
  const cor = {
    default: "text-slate-900",
    brand: "text-brand-700",
    warn: "text-amber-600",
    good: "text-emerald-600",
  }[tom];
  return (
    <div className="card p-4">
      <div className="label">{titulo}</div>
      <div className={`mt-1 text-2xl font-bold ${cor}`}>{valor}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}
    </div>
  );
}

export function Progress({ pct, label }: { pct: number; label?: string }) {
  return (
    <div className="w-full">
      {label && <div className="mb-1 text-xs text-slate-500">{label}</div>}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}

export function Alert({ tom = "warn", children }: { tom?: "warn" | "erro" | "info" | "good"; children: ReactNode }) {
  const cls = {
    warn: "bg-amber-50 border-amber-200 text-amber-800",
    erro: "bg-rose-50 border-rose-200 text-rose-800",
    info: "bg-sky-50 border-sky-200 text-sky-800",
    good: "bg-emerald-50 border-emerald-200 text-emerald-800",
  }[tom];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

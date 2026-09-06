"use client";

import { ReactNode, useEffect } from "react";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Kpi({
  titulo,
  valor,
  sub,
  tom = "default",
}: {
  titulo: string;
  valor: string;
  sub?: ReactNode;
  tom?: "default" | "brand" | "warn" | "good" | "azul";
}) {
  const cor = {
    default: "text-slate-900",
    brand: "text-brand-700",
    azul: "text-azul-600",
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

export function Secao({ titulo, desc, right, children }: { titulo: string; desc?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{titulo}</h2>
          {desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
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

/** Barra de cobertura (0..1) — usada nos destinos. */
export function Barra({ pct, tom = "brand" }: { pct: number; tom?: "brand" | "azul" | "good" }) {
  const cor = { brand: "bg-brand-500", azul: "bg-azul-500", good: "bg-emerald-500" }[tom];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full ${cor}`} style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
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

export function Badge({ tom = "slate", children }: { tom?: "slate" | "brand" | "azul" | "good" | "warn"; children: ReactNode }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    brand: "bg-brand-50 text-brand-700",
    azul: "bg-azul-50 text-azul-700",
    good: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
  }[tom];
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function Modal({
  aberto,
  titulo,
  onFechar,
  children,
  largura = "max-w-2xl",
}: {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
  largura?: string;
}) {
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto, onFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16">
      <div className={`card w-full ${largura} p-5 shadow-xl`} role="dialog" aria-modal="true">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">{titulo}</h2>
          <button onClick={onFechar} className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fechar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS = [
  { href: "/", label: "Dashboard", icon: "▦", desc: "Visão executiva" },
  { href: "/plano", label: "Plano de transferência", icon: "▤", desc: "Detalhe por SKU" },
  { href: "/simulador", label: "Simulador de cenários", icon: "⇄", desc: "Base vs. simulado" },
  { href: "/parametros", label: "Parâmetros e importação", icon: "⚙", desc: "Config + upload" },
  { href: "/aprovacao", label: "Aprovação / execução", icon: "✓", desc: "Ordem para ERP/WMS" },
];

export function Nav() {
  const path = usePathname();
  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white px-3 py-5 hidden md:flex md:flex-col">
      <div className="px-3 pb-5">
        <div className="text-sm font-bold text-brand-700">Transferências CD</div>
        <div className="text-xs text-slate-500">Otimização de excesso · DRP</div>
      </div>
      <nav className="flex flex-col gap-1">
        {ITENS.map((it) => {
          const ativo = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`rounded-lg px-3 py-2 transition-colors ${
                ativo ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-base">{it.icon}</span>
                {it.label}
              </div>
              <div className="pl-6 text-xs text-slate-400">{it.desc}</div>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-3 pt-6 text-[11px] leading-relaxed text-slate-400">
        Motor validado contra a planilha original (RESUMO) ao centavo. Toda mudança
        de parâmetro gera nova versão de cálculo.
      </div>
    </aside>
  );
}

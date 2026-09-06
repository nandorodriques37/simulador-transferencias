"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useEscape } from "@/components/ui";

const ITENS = [
  { href: "/", label: "Dashboard", icon: "▦", desc: "Resultado da análise" },
  { href: "/analise", label: "Nova análise", icon: "⚙", desc: "Bases · origens · destinos" },
  { href: "/plano", label: "Plano de transferência", icon: "▤", desc: "Rota × SKU · aprovação" },
  { href: "/carteira", label: "Carteira", icon: "✓", desc: "Aprovadas · faturamento" },
];

function Marca() {
  return (
    <div className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/pague-menos-icon.svg" alt="" aria-hidden className="h-9 w-9 shrink-0" />
      <div className="leading-none">
        <div className="text-lg font-extrabold tracking-tight text-azul-600">
          Pague<span className="text-brand-500"> </span>Menos
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Supply Chain</div>
      </div>
    </div>
  );
}

/** Corpo do menu — o mesmo na barra lateral fixa e na gaveta do celular. */
function Menu({ onNavegar }: { onNavegar?: () => void }) {
  const path = usePathname();
  return (
    <>
      <div className="mb-4 border-t border-slate-100 px-3 pt-4">
        <div className="text-sm font-bold text-azul-700">Transferências entre CDs</div>
        <div className="text-xs text-slate-500">Rede multi-origem · multi-destino</div>
      </div>
      <nav className="flex flex-col gap-1" aria-label="Seções do aplicativo">
        {ITENS.map((it) => {
          const ativo = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onNavegar}
              aria-current={ativo ? "page" : undefined}
              className={`rounded-lg px-3 py-2 transition-colors ${
                ativo ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-base" aria-hidden>{it.icon}</span>
                {it.label}
              </div>
              <div className="pl-6 text-xs text-slate-400">{it.desc}</div>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-3 pt-6 text-[11px] leading-relaxed text-slate-400">
        Uma base com todos os CDs. Você escolhe a ordem das origens e a ordem dos
        destinos — as sugestões aprovadas seguem descontadas até o faturamento
        ser importado.
      </div>
    </>
  );
}

export function Nav() {
  const path = usePathname();
  const [aberto, setAberto] = useState(false);

  useEscape(aberto, () => setAberto(false));
  // Trocar de tela fecha a gaveta; sem isso ela cobriria a página recém-aberta.
  useEffect(() => setAberto(false), [path]);
  // Enquanto a gaveta está aberta, o fundo não rola junto.
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  return (
    <>
      {/* ---------------------- Barra lateral (desktop) ---------------------- */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white px-3 py-5 md:flex md:flex-col">
        <div className="px-3 pb-4"><Marca /></div>
        <Menu />
      </aside>

      {/* ------------------------ Barra superior (mobile) -------------------- */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 md:hidden">
        <Marca />
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir o menu"
          aria-expanded={aberto}
          className="rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-100"
        >
          <span aria-hidden>☰</span>
        </button>
      </header>

      {/* --------------------------- Gaveta (mobile) ------------------------- */}
      {aberto && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setAberto(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col overflow-y-auto bg-white px-3 py-4 shadow-xl"
          >
            <div className="flex items-start justify-between px-3 pb-4">
              <Marca />
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar o menu"
                className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <Menu onNavegar={() => setAberto(false)} />
          </div>
        </div>
      )}
    </>
  );
}

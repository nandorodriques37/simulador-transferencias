"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { useEscape } from "@/components/ui";
import { SeletorTema } from "@/components/Tema";
import { useApi } from "@/lib/useApi";
import { Icone, type NomeIcone } from "@/components/icones";

interface Item {
  href: string;
  label: string;
  curto: string;
  icone: NomeIcone;
  grupo: "Análise" | "Execução";
}

const ITENS: Item[] = [
  { href: "/", label: "Dashboard", curto: "Dashboard", icone: "dashboard", grupo: "Análise" },
  { href: "/analise", label: "Nova análise", curto: "Análise", icone: "analise", grupo: "Análise" },
  { href: "/plano", label: "Plano de transferência", curto: "Plano", icone: "plano", grupo: "Execução" },
  { href: "/carteira", label: "Carteira", curto: "Carteira", icone: "carteira", grupo: "Execução" },
];

/** O que a casca lê de /api/status para o topo e o contador da Carteira. */
interface Status {
  dataset?: { pronto?: boolean; demo?: boolean; dataPosicao?: string };
  resultados?: { duravel?: boolean };
  carteira?: { envelhecidas?: number; durable?: boolean };
}

function ativo(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

function fmtData(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

/** Símbolo da marca em SVG: o mesmo do favicon, com as cores vindas dos tokens. */
function Simbolo({ tamanho = 34 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 120 120" fill="none" role="img" aria-label="Pague Menos">
      <path d="M60 4c22.9 0 34.4 0 44.6 6.2A44 44 0 0 1 109.8 15.4C116 25.6 116 37.1 116 60s0 34.4-6.2 44.6a44 44 0 0 1-5.2 5.2C94.4 116 82.9 116 60 116s-34.4 0-44.6-6.2a44 44 0 0 1-5.2-5.2C4 94.4 4 82.9 4 60s0-34.4 6.2-44.6A44 44 0 0 1 15.4 10.2C25.6 4 37.1 4 60 4Z" fill="var(--coral)" />
      <path d="M60 30c5.2 0 7.3.6 8.8 2.1 1.3 1.3 1.9 3 2 6.7l.2 8.2 8.2.2c3.7.1 5.4.7 6.7 2 1.5 1.5 2.1 3.6 2.1 8.8s-.6 7.3-2.1 8.8c-1.3 1.3-3 1.9-6.7 2l-8.2.2-.2 8.2c-.1 3.7-.7 5.4-2 6.7-1.5 1.5-3.6 2.1-8.8 2.1s-7.3-.6-8.8-2.1c-1.3-1.3-1.9-3-2-6.7l-.2-8.2-8.2-.2c-3.7-.1-5.4-.7-6.7-2C30.6 67.3 30 65.2 30 60s.6-7.3 2.1-8.8c1.3-1.3 3-1.9 6.7-2l8.2-.2.2-8.2c.1-3.7.7-5.4 2-6.7C52.7 30.6 54.8 30 60 30Z" fill="#fff" />
    </svg>
  );
}

/**
 * Marca no rail. Não há wordmark vetorial no repositório (o DS só tem PNG,
 * que não pôde ser baixado aqui); até ele chegar, símbolo + nome em texto.
 */
function Marca({ claro = true }: { claro?: boolean }) {
  return (
    <div className="app-marca app-marca--logo">
      <div className="flex items-center gap-2.5">
        <Simbolo />
        <b style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em", color: claro ? "var(--rail-ink)" : "var(--texto-marca)" }}>
          Pague Menos
        </b>
      </div>
      <span>Transferências entre CDs</span>
    </div>
  );
}

function Itens({ path, envelhecidas, onNavegar }: { path: string; envelhecidas: number; onNavegar?: () => void }) {
  let grupo = "";
  return (
    <>
      {ITENS.map((it) => {
        const cab = it.grupo !== grupo ? <div className="app-rail__grupo">{it.grupo}</div> : null;
        grupo = it.grupo;
        return (
          <div key={it.href} className="contents">
            {cab}
            <Link className="app-item" href={it.href} onClick={onNavegar} aria-current={ativo(path, it.href) ? "page" : undefined}>
              <Icone nome={it.icone} />
              <span>{it.label}</span>
              {it.href === "/carteira" && envelhecidas > 0 && (
                <b className="app-n" aria-label={`${envelhecidas} sugestões em aberto há mais de 30 dias`}>{envelhecidas}</b>
              )}
            </Link>
          </div>
        );
      })}
    </>
  );
}

/**
 * Casca do app: rail azul no desktop; barra superior, gaveta e barra inferior
 * no celular; topo com breadcrumb, estado da base e seletor de tema.
 */
export function Casca({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [aberto, setAberto] = useState(false);
  const status = useApi<Status>("/api/status");

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

  const atual = ITENS.find((it) => ativo(path, it.href)) ?? ITENS[0];
  const envelhecidas = status.data?.carteira?.envelhecidas ?? 0;
  const ds = status.data?.dataset;
  const duravel = status.data?.resultados?.duravel ?? true;
  const dataBase = fmtData(ds?.dataPosicao);
  const estado = !status.data
    ? ""
    : ds?.pronto === false
      ? "Sem base carregada"
      : [ds?.demo ? "Base de demonstração" : duravel ? "Resultado salvo" : "Em memória", dataBase && `base de ${dataBase}`]
          .filter(Boolean)
          .join(" · ");
  const tomEstado = ds?.pronto === false || ds?.demo || !duravel ? "var(--ambar)" : "var(--verde)";

  return (
    <div className="app">
      {/* ---------------------------- Rail (desktop) ---------------------------- */}
      <nav className="app-rail" aria-label="Navegação principal">
        <Marca />
        <Itens path={path} envelhecidas={envelhecidas} />
        <div className="app-rail__fim">
          <span>{estado || "Carregando…"}</span>
        </div>
      </nav>

      {/* ------------------------ Barra superior (celular) ---------------------- */}
      <header className="casca-mb-top">
        <Simbolo tamanho={30} />
        <b>{atual.label}</b>
        <button type="button" onClick={() => setAberto(true)} aria-label="Abrir o menu" aria-expanded={aberto}>
          <Icone nome="menu" tamanho={24} />
        </button>
      </header>

      {/* ------------------------------ Gaveta (celular) ------------------------ */}
      {aberto && (
        <>
          <div className="casca-scrim" onClick={() => setAberto(false)} aria-hidden />
          <nav className="casca-gaveta" role="dialog" aria-modal="true" aria-label="Menu de navegação">
            <div className="flex items-start justify-between">
              <Marca />
              <button type="button" className="btn-icone" style={{ color: "var(--rail-ink)" }} onClick={() => setAberto(false)} aria-label="Fechar o menu">
                <Icone nome="fechar" />
              </button>
            </div>
            <Itens path={path} envelhecidas={envelhecidas} onNavegar={() => setAberto(false)} />
            <div className="app-rail__grupo">Aparência</div>
            <div style={{ padding: "4px 12px" }}>
              <SeletorTema />
            </div>
            <div className="app-rail__fim" style={{ flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
              <span>{estado}</span>
            </div>
          </nav>
        </>
      )}

      {/* --------------------------------- Conteúdo ----------------------------- */}
      <div className="app-main">
        <header className="app-top">
          <div className="app-top__crumb">
            {atual.grupo} · <b>{atual.label}</b>
          </div>
          <div className="app-top__fim">
            {estado && (
              <span className="app-sync">
                <i style={{ background: tomEstado }} />
                {estado}
              </span>
            )}
            <SeletorTema />
          </div>
        </header>
        <main className="app-pagina">{children}</main>
      </div>

      {/* ------------------------- Barra inferior (celular) --------------------- */}
      <nav className="casca-mb-nav" aria-label="Navegação principal">
        {ITENS.map((it) => (
          <Link key={it.href} href={it.href} aria-current={ativo(path, it.href) ? "page" : undefined}>
            <Icone nome={it.icone} tamanho={22} />
            {it.curto}
            {it.href === "/carteira" && envelhecidas > 0 && <span className="n" aria-label={`${envelhecidas} envelhecidas`}>{envelhecidas}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}

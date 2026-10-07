"use client";

import { ReactNode, useEffect } from "react";
import { Icone, type NomeIcone } from "@/components/icones";

/** Fecha o que está aberto com Escape. Compartilhado pelo modal e pelo menu. */
export function useEscape(ativo: boolean, onFechar: () => void) {
  useEffect(() => {
    if (!ativo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ativo, onFechar]);
}

/* ------------------------------------------------------------------------- */
/* Cabeçalho da tela                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Título que afirma o achado (com número), subtítulo de contexto e ações à
 * direita. Um por tela. Use <em> no título só para o termo em alerta.
 */
export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="titulo-linha">
      <div className="pgm-cabecalho__textos" style={{ flex: 1, minWidth: 280 }}>
        <h1 className="pgm-cabecalho__titulo">{title}</h1>
        {subtitle && <p className="pgm-cabecalho__sub">{subtitle}</p>}
      </div>
      {right && <div className="app-acoes">{right}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* KPI                                                                        */
/* ------------------------------------------------------------------------- */

type TomKpi = "default" | "brand" | "azul" | "warn" | "good" | "alerta";
const KPI_CLASSE: Record<TomKpi, string> = {
  default: "",
  brand: "",
  azul: "",
  warn: "pgm-kpi--atencao",
  good: "pgm-kpi--melhora",
  alerta: "pgm-kpi--alerta",
};

export function Kpi({ titulo, valor, sub, tom = "default", badge }: { titulo: string; valor: string; sub?: ReactNode; tom?: TomKpi; badge?: ReactNode }) {
  return (
    <div className={`pgm-kpi ${KPI_CLASSE[tom]}`}>
      <span className="pgm-kpi__valor">{valor}</span>
      <div className="pgm-kpi__rotulo">{titulo}</div>
      {sub && <div className="pgm-kpi__apoio">{sub}</div>}
      {badge && <span className="pgm-kpi__badge">{badge}</span>}
    </div>
  );
}

/** Faixa de KPIs: 4 colunas no desktop, 2 e 1 conforme a largura. */
export function Kpis({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section className="app-kpis app-kpis--4" aria-label={label}>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Cartão / seção                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Cartão com título de painel e descrição. `flush` cola uma tabela nas bordas
 * (o cabeçalho ganha o respiro interno e o corpo vai sem padding).
 */
export function Secao({
  titulo,
  desc,
  right,
  children,
  flush = false,
  id,
}: {
  titulo: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className={`app-card ${flush ? "app-card--flush" : ""}`} id={id}>
      <div className="app-card__cab">
        <div>
          <h2 className="app-card__titulo">{titulo}</h2>
          {desc && <p className="app-card__sub">{desc}</p>}
        </div>
        {right && <div className="app-card__lado" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** Caixa de rolagem horizontal para tabelas largas. */
export function Rolagem({ children }: { children: ReactNode }) {
  return <div className="tabela-rolagem thin-scroll">{children}</div>;
}

/* ------------------------------------------------------------------------- */
/* Estados: erro, vazio, carregando                                           */
/* ------------------------------------------------------------------------- */

type TomEstado = "info" | "atencao" | "erro";

/**
 * Estado de tela com ícone, rótulo, título e ações. Nunca tela branca: toda
 * situação tem palavra, explicação e a próxima ação.
 */
export function Estado({
  tom = "info",
  icone = "info",
  rotulo,
  titulo,
  texto,
  acoes,
}: {
  tom?: TomEstado;
  icone?: NomeIcone;
  rotulo?: string;
  titulo: string;
  texto?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <section className="estado" data-tom={tom}>
      <span className="estado__ico"><Icone nome={icone} tamanho={24} /></span>
      {rotulo && <span className="rotulo-ctx">{rotulo}</span>}
      <h3>{titulo}</h3>
      {texto && <p>{texto}</p>}
      {acoes && <div className="acoes">{acoes}</div>}
    </section>
  );
}

/**
 * Falha de carga com saída. Antes, uma API fora do ar deixava a tela em branco
 * — sem explicação e sem caminho de volta.
 */
export function ErroCarga({ erro, onTentar }: { erro: string; onTentar: () => void }) {
  return (
    <Estado
      tom="erro"
      icone="semRede"
      rotulo="Falha de rede"
      titulo="Não foi possível carregar esta tela"
      texto={<>{erro}. A conexão pode ter caído ou o servidor pode estar reiniciando. Nada foi perdido.</>}
      acoes={<button onClick={onTentar} className="pgm-botao" type="button">Tentar de novo</button>}
    />
  );
}

/** Faixa discreta de recarga: o conteúdo antigo fica, mas avisa que mudou. */
export function Revalidando({ ativo, label = "Atualizando…" }: { ativo: boolean; label?: string }) {
  if (!ativo) return null;
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-2" role="status" aria-live="polite">
      <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, marginRight: 0 }} />
      {label}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="estado estado--faixa" style={{ flexDirection: "row", alignItems: "center", gap: 16 }} role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <div style={{ flex: 1 }}>
        <span className="rotulo-ctx">Carregando</span>
        <h3 style={{ marginTop: 4 }}>{label ?? "Abrindo a tela…"}</h3>
        <div className="esqueleto" style={{ marginTop: 12, maxWidth: 560 }}><i /><i /><i /></div>
      </div>
    </div>
  );
}

export function Progress({ pct, label }: { pct: number; label?: string }) {
  const p = Math.min(100, Math.max(0, pct));
  return (
    <div className="progresso" style={{ width: "100%" }}>
      <div className="progresso__linha">
        <span>{label ?? "Processando…"}</span>
        <span>{Math.round(p)}%</span>
      </div>
      <div className="progresso__trilho" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progresso"}>
        <div className="progresso__barra" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Barras                                                                     */
/* ------------------------------------------------------------------------- */

type TomBarra = "brand" | "azul" | "good" | "atencao" | "alto";
const BARRA_ESTADO: Record<TomBarra, string | undefined> = { brand: undefined, azul: undefined, good: "ok", atencao: "atencao", alto: "alto" };

/** Barra de percentual (0..1) com o número ao lado. O valor sempre aparece escrito. */
export function Barra({ pct, tom = "brand", mostrarValor = true }: { pct: number; tom?: TomBarra; mostrarValor?: boolean }) {
  const p = Math.min(100, Math.max(0, pct * 100));
  const estado = BARRA_ESTADO[tom];
  return (
    <div className="pct">
      <div className="pct__trilho">
        <div className="pct__barra" data-estado={estado} style={{ width: `${p}%` }} />
      </div>
      {mostrarValor && <span className="pct__v" data-estado={estado}>{Math.round(p)}%</span>}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Aviso                                                                      */
/* ------------------------------------------------------------------------- */

type TomAviso = "warn" | "erro" | "info" | "good";
const AVISO: Record<TomAviso, { tom: string; icone: NomeIcone; rotulo: string }> = {
  warn: { tom: "atencao", icone: "atencao", rotulo: "Atenção" },
  erro: { tom: "erro", icone: "erro", rotulo: "Falha" },
  info: { tom: "info", icone: "info", rotulo: "Informação" },
  good: { tom: "ok", icone: "ok", rotulo: "Pronto" },
};

/** Aviso com ícone, palavra e texto: a cor nunca viaja sozinha. */
export function Alert({ tom = "warn", titulo, acao, children }: { tom?: TomAviso; titulo?: string; acao?: ReactNode; children: ReactNode }) {
  const a = AVISO[tom];
  return (
    <div className="aviso" data-tom={a.tom} role={tom === "erro" ? "alert" : undefined}>
      <span className="aviso__ico"><Icone nome={a.icone} tamanho={16} espessura={2.4} /></span>
      <div className="aviso__txt">
        <b>{titulo ?? a.rotulo}</b>
        <p>{children}</p>
      </div>
      {acao && <span className="aviso__acao">{acao}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Rótulos de estado                                                          */
/* ------------------------------------------------------------------------- */

type TomBadge = "slate" | "brand" | "azul" | "good" | "warn" | "risco";
const BADGE: Record<TomBadge, string | undefined> = { slate: undefined, brand: "marca", azul: "marca", good: "ok", warn: "atencao", risco: "risco" };

export function Badge({ tom = "slate", children }: { tom?: TomBadge; children: ReactNode }) {
  return <span className="badge" data-badge={BADGE[tom]}>{children}</span>;
}

export type TomStatus = "aberta" | "faturada" | "parcial" | "velha" | "cancelada" | "gargalo" | "concluido";
const STATUS: Record<TomStatus, string> = {
  aberta: "pgm-status--aberta",
  faturada: "pgm-status--faturada",
  parcial: "pgm-status--parcial",
  velha: "pgm-status--velha",
  cancelada: "pgm-status--cancelada",
  gargalo: "pgm-status--atrasado",
  concluido: "pgm-status--concluido",
};

/** Pill de situação. A palavra vai junto da cor, sempre. */
export function Status({ tom, children }: { tom: TomStatus; children: ReactNode }) {
  return <span className={`pgm-status ${STATUS[tom]}`}>{children}</span>;
}

type TomPill = "verde" | "ambar" | "coral" | "critico";
export function Pill({ tom, children, pequena = false }: { tom: TomPill; children: ReactNode; pequena?: boolean }) {
  return (
    <span className={`pgm-pill pgm-pill--${tom}`} style={pequena ? { fontSize: 12, padding: "2px 10px" } : undefined}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* Insight, decisão, ressalvas e fonte                                        */
/* ------------------------------------------------------------------------- */

export function Insight({ children }: { children: ReactNode }) {
  return <div className="pgm-insight">{children}</div>;
}

export function Decisao({ children }: { children: ReactNode }) {
  return (
    <div className="pgm-decisao">
      <span className="pgm-decisao__rotulo">Decisão</span>
      <span className="pgm-decisao__texto">{children}</span>
    </div>
  );
}

export function Ressalvas({ itens }: { itens: ReactNode[] }) {
  const lista = itens.filter(Boolean);
  if (lista.length === 0) return null;
  return (
    <div className="pgm-ressalvas">
      <span className="pgm-ressalvas__rotulo">Ressalvas</span>
      <ul>
        {lista.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  );
}

export function Fonte({ children }: { children: ReactNode }) {
  return <p className="app-fonte">{children}</p>;
}

/* ------------------------------------------------------------------------- */
/* Controles                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Chave liga/desliga de um grupo de regras. Desligar NÃO apaga a configuração —
 * os valores continuam salvos, prontos para religar. O estado vai escrito.
 */
export function Chave({ ligada, onToggle, children }: { ligada: boolean; onToggle: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={ligada} onClick={() => onToggle(!ligada)} className="chave">
      <span className="chave__trilho" />
      <span className="chave__estado">{ligada ? "Ligada" : "Desligada"}</span>
      <span>{children}</span>
    </button>
  );
}

/** Controle segmentado: uma escolha entre poucas opções, sempre uma ativa. */
export function Seg<T extends string>({ opcoes, valor, onChange, label }: { opcoes: { valor: T; rotulo: string }[]; valor: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {opcoes.map((o) => (
        <button key={o.valor} type="button" aria-pressed={valor === o.valor} onClick={() => onChange(o.valor)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Campo com rótulo em maiúsculas e ajuda opcional. */
export function Campo({ rotulo, ajuda, htmlFor, children, style }: { rotulo: ReactNode; ajuda?: ReactNode; htmlFor?: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="pgm-campo" style={style}>
      <label className="pgm-campo__rotulo" htmlFor={htmlFor}>{rotulo}</label>
      {children}
      {ajuda && <span className="pgm-campo__ajuda">{ajuda}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* CD e rota                                                                  */
/* ------------------------------------------------------------------------- */

export function Cd({ n, ordem }: { n: number | string; ordem?: string }) {
  return (
    <span className="cd">
      {ordem && <i>{ordem}</i>}CD {n}
    </span>
  );
}

export function Rota({ origem, destino }: { origem: number | string; destino: number | string }) {
  return (
    <span className="rota">
      CD {origem} <Icone nome="seta" tamanho={14} espessura={2.4} /> CD {destino}
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* Modal                                                                      */
/* ------------------------------------------------------------------------- */

export function Modal({
  aberto,
  titulo,
  sub,
  onFechar,
  children,
  rodape,
  largura = 720,
}: {
  aberto: boolean;
  titulo: string;
  sub?: ReactNode;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  /** Largura em px ou classe antiga do Tailwind (ignorada). */
  largura?: number | string;
}) {
  useEscape(aberto, onFechar);

  if (!aberto) return null;
  const w = typeof largura === "number" ? largura : 720;
  return (
    <div className="scrim" style={{ position: "fixed", zIndex: 50, alignItems: "flex-start", padding: "48px 16px", overflowY: "auto" }} onClick={onFechar}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" style={{ width: "100%", maxWidth: w }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__cab">
          <div>
            <h2 id="modal-titulo">{titulo}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" onClick={onFechar} className="modal__x" aria-label="Fechar">
            <Icone nome="fechar" espessura={2.2} />
          </button>
        </div>
        <div className="modal__corpo">{children}</div>
        {rodape && <div className="modal__rod">{rodape}</div>}
      </div>
    </div>
  );
}

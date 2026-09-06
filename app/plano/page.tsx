"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, PageHeader, Spinner } from "@/components/ui";
import { fmtInt, fmtPct, fmtRs, fmtRsCompacto, rotuloMes } from "@/lib/format";

interface LinhaPlano {
  cdOrigem: number; cdDestino: number; rota: string; codigoProduto: number; produto: string;
  fornecedor: string; comprador: string; analista: string; categoriaN1: string;
  precoUnitario: number; embCompra: number;
  demandaMes: number[]; transfMes: number[]; demandaSaldo: number; transfSaldo: number;
  transfTotal: number; valorTotal: number; caixas: number;
  qtdImediata: number; imediataCaixas: number; qtdImediataArredondada: number; valorImediata: number;
  coberturaDias: number; statusCobertura: string; aliquota: number; impactoFiscal: number;
  naCarteira: boolean;
}
interface Facets {
  origens: number[]; destinos: number[]; rotas: string[]; categorias: string[];
  fornecedores: string[]; compradores: string[]; analistas: string[]; status: string[];
}
interface PlanoResp {
  analiseId: string; modoDemanda: "saldo_ideal" | "pedidos"; meses: string[];
  facets: Facets; totaisFiltro: { qtd: number; valor: number; imediata: number; fiscal: number };
  total: number; page: number; pageSize: number; totalPaginas: number; itens: LinhaPlano[];
  erro?: string; semAnalise?: boolean;
}

const FILTROS_INICIAIS: Record<string, string> = {
  cobertura: "total", origem: "", destino: "", categoria: "", fornecedor: "",
  comprador: "", analista: "", status: "", q: "", soImediata: "false",
};

export default function Plano() {
  const [filtros, setFiltros] = useState<Record<string, string>>(FILTROS_INICIAIS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ campo: string; dir: "asc" | "desc" }>({ campo: "valorTotal", dir: "desc" });
  const [data, setData] = useState<PlanoResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tom: "good" | "erro"; texto: string } | null>(null);
  const [aprovando, setAprovando] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v && v !== "false") p.set(k, v);
    p.set("page", String(page));
    p.set("pageSize", "100");
    p.set("sort", sort.campo);
    p.set("dir", sort.dir);
    return p.toString();
  }, [filtros, page, sort]);

  const carregar = useCallback(() => {
    setLoading(true);
    fetch(`/api/plano?${qs}`).then((r) => r.json()).then(setData).finally(() => setLoading(false));
  }, [qs]);
  useEffect(carregar, [carregar]);

  if (loading && !data) return <div className="pt-10"><Spinner label="Carregando plano…" /></div>;
  if (!data) return null;

  if (data.semAnalise || data.erro) {
    return (
      <div>
        <PageHeader title="Plano de transferência" />
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-600">Rode uma análise para gerar o plano.</p>
          <Link href="/analise" className="btn-primary mt-4 inline-flex">Ir para Nova análise</Link>
        </div>
      </div>
    );
  }

  const { itens, facets, meses, totaisFiltro } = data;
  const modoPedidos = data.modoDemanda === "pedidos";
  const chave = (l: LinhaPlano) => `${l.rota}|${l.codigoProduto}`;
  const setF = (k: string, v: string) => { setFiltros((f) => ({ ...f, [k]: v })); setPage(1); setSel(new Set()); };
  const ordenar = (campo: string) =>
    setSort((s) => ({ campo, dir: s.campo === campo && s.dir === "desc" ? "asc" : "desc" }));

  const alternar = (k: string) => {
    const novo = new Set(sel);
    if (novo.has(k)) novo.delete(k); else novo.add(k);
    setSel(novo);
  };
  const alternarTodas = () => {
    if (itens.every((l) => sel.has(chave(l)))) setSel(new Set());
    else setSel(new Set(itens.map(chave)));
  };

  const aprovar = async (tudoDoFiltro: boolean) => {
    setAprovando(true);
    setMsg(null);
    try {
      const body = tudoDoFiltro
        ? { analiseId: data.analiseId, filtros }
        : { analiseId: data.analiseId, chaves: Array.from(sel) };
      const r = await fetch("/api/carteira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setMsg({ tom: "erro", texto: `Erro: ${d.erro}` }); return; }
      setMsg({ tom: "good", texto: `${fmtInt(d.gravadas)} linha(s) na carteira. Elas já descontam origem e destino na próxima análise.` });
      setSel(new Set());
      carregar();
    } finally {
      setAprovando(false);
    }
  };

  const th = (campo: string, rotulo: string, extra = "") => (
    <th className={`thc cursor-pointer select-none hover:text-slate-800 ${extra}`} onClick={() => ordenar(campo)}>
      {rotulo}{sort.campo === campo ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div>
      <PageHeader
        title="Plano de transferência"
        subtitle={
          <>
            Análise <b>{data.analiseId}</b> · uma linha por rota (origem → destino) × SKU ·{" "}
            {modoPedidos ? "abatendo pedidos" : "atendendo o saldo ideal"}
          </>
        }
        right={
          <div className="flex gap-2">
            <a href={`/api/plano/export?${qs}&format=csv`} className="btn-ghost">CSV</a>
            <a href={`/api/plano/export?${qs}&format=xlsx`} className="btn-ghost">Excel</a>
          </div>
        }
      />

      {msg && <div className="mb-3"><Alert tom={msg.tom}>{msg.texto}</Alert></div>}

      {/* ------------------------------ Filtros ------------------------------ */}
      <div className="card mb-3 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="label mb-0.5">Buscar</div>
            <input value={filtros.q} onChange={(e) => setF("q", e.target.value)} placeholder="produto ou código" className="input w-48 py-1.5 text-xs" />
          </div>
          <div>
            <div className="label mb-0.5">Origem</div>
            <select value={filtros.origem} onChange={(e) => setF("origem", e.target.value)} className="input py-1.5 text-xs">
              <option value="">Todas</option>
              {facets.origens.map((c) => <option key={c} value={c}>CD {c}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-0.5">Destino</div>
            <select value={filtros.destino} onChange={(e) => setF("destino", e.target.value)} className="input py-1.5 text-xs">
              <option value="">Todos</option>
              {facets.destinos.map((c) => <option key={c} value={c}>CD {c}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-0.5">Categoria</div>
            <select value={filtros.categoria} onChange={(e) => setF("categoria", e.target.value)} className="input py-1.5 text-xs">
              <option value="">Todas</option>
              {facets.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-0.5">Comprador</div>
            <select value={filtros.comprador} onChange={(e) => setF("comprador", e.target.value)} className="input py-1.5 text-xs">
              <option value="">Todos</option>
              {facets.compradores.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-0.5">Cobertura na origem</div>
            <select value={filtros.cobertura} onChange={(e) => setF("cobertura", e.target.value)} className="input py-1.5 text-xs">
              <option value="total">Total</option>
              <option value="acima_limite">Só estoque parado</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={filtros.soImediata === "true"} onChange={(e) => setF("soImediata", String(e.target.checked))} />
            Só com saída imediata
          </label>
          <button onClick={() => { setFiltros(FILTROS_INICIAIS); setPage(1); }} className="btn-ghost py-1.5 text-xs">Limpar</button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <div className="flex flex-wrap gap-1.5">
            <Badge>{fmtInt(data.total)} linhas</Badge>
            <Badge tom="brand">{fmtRs(totaisFiltro.valor)}</Badge>
            <Badge tom="good">Imediata {fmtRsCompacto(totaisFiltro.imediata)}</Badge>
            <Badge tom="warn">Fiscal {fmtRsCompacto(totaisFiltro.fiscal)}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => aprovar(false)} disabled={sel.size === 0 || aprovando} className="btn-secondary py-1.5 text-xs">
              Aprovar selecionadas ({sel.size})
            </button>
            <button onClick={() => aprovar(true)} disabled={aprovando || data.total === 0} className="btn-primary py-1.5 text-xs">
              Aprovar todas do filtro ({fmtInt(data.total)})
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------- Tabela ------------------------------ */}
      <div className="card overflow-x-auto thin-scroll">
        <table className="min-w-full">
          <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              <th className="thc w-8">
                <input type="checkbox" checked={itens.length > 0 && itens.every((l) => sel.has(chave(l)))} onChange={alternarTodas} />
              </th>
              {th("rota", "Rota")}
              {th("codigoProduto", "Código")}
              {th("produto", "Produto")}
              <th className="thc">Categoria</th>
              {modoPedidos
                ? meses.map((m) => <th key={m} className="thc text-right">Transf. {rotuloMes(m)}</th>)
                : <th className="thc text-right">Necessidade</th>}
              {th("transfTotal", "Qtd total", "text-right")}
              <th className="thc text-right">Cx</th>
              {th("qtdImediataArredondada", "Imediata (un)", "text-right")}
              {th("valorTotal", "Valor", "text-right")}
              {th("impactoFiscal", "Fiscal", "text-right")}
              {th("coberturaDias", "Cob. origem", "text-right")}
              <th className="thc">Carteira</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((l) => {
              const k = chave(l);
              return (
                <tr key={k} className={`border-b border-slate-100 ${sel.has(k) ? "bg-brand-50/60" : ""}`}>
                  <td className="tdc"><input type="checkbox" checked={sel.has(k)} onChange={() => alternar(k)} /></td>
                  <td className="tdc font-medium">CD{l.cdOrigem} → CD{l.cdDestino}</td>
                  <td className="tdc">{l.codigoProduto}</td>
                  <td className="tdc max-w-[220px] truncate" title={l.produto}>{l.produto}</td>
                  <td className="tdc max-w-[130px] truncate text-slate-500" title={l.categoriaN1}>{l.categoriaN1}</td>
                  {modoPedidos
                    ? l.transfMes.map((t, i) => <td key={i} className="tdc num">{fmtInt(t)}</td>)
                    : <td className="tdc num text-slate-500">{fmtInt(l.demandaSaldo)}</td>}
                  <td className="tdc num font-semibold">{fmtInt(l.transfTotal)}</td>
                  <td className="tdc num text-slate-500">{fmtInt(l.caixas)}</td>
                  <td className="tdc num">{fmtInt(l.qtdImediataArredondada)}</td>
                  <td className="tdc num">{fmtRs(l.valorTotal)}</td>
                  <td className="tdc num text-slate-500">{fmtRs(l.impactoFiscal)}</td>
                  <td className="tdc num text-slate-500">{l.coberturaDias >= 9999 ? "s/ giro" : fmtInt(l.coberturaDias)}</td>
                  <td className="tdc">{l.naCarteira ? <Badge tom="good">aprovada</Badge> : <span className="text-slate-300">—</span>}</td>
                </tr>
              );
            })}
            {itens.length === 0 && (
              <tr><td colSpan={14} className="td text-center text-slate-400">Nenhuma linha com os filtros atuais.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <div>Página {data.page} de {data.totalPaginas} · {fmtInt(data.total)} linhas · imediata cobre {fmtPct(totaisFiltro.valor > 0 ? totaisFiltro.imediata / totaisFiltro.valor : 0, 0)} do valor</div>
        <div className="flex gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={data.page <= 1} className="btn-ghost py-1 text-xs">Anterior</button>
          <button onClick={() => setPage((p) => p + 1)} disabled={data.page >= data.totalPaginas} className="btn-ghost py-1 text-xs">Próxima</button>
        </div>
      </div>
    </div>
  );
}

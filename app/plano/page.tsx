"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PageHeader, Spinner } from "@/components/ui";
import { fmtInt, fmtRs, rotuloMes } from "@/lib/format";

interface Linha {
  cdDestino: number;
  idSku: string;
  codigoProduto: number;
  produto: string;
  fornecedor: string;
  comprador: string;
  analista: string;
  categoriaN1: string;
  precoUnitario: number;
  embCompra: number;
  pedidoMes: number[];
  transfMes: number[];
  valorTransfMes: number[];
  transfCaixasMes: number[];
  qtdTransfImediata: number;
  imediataCaixas: number;
  valorTransfImediata: number;
  qtdImediataArredondada: number;
  coberturaDias: number;
  statusCobertura: string;
  aprovada?: boolean;
}
interface Facets {
  cds: number[]; categorias: string[]; fornecedores: string[]; compradores: string[]; analistas: string[]; status: string[];
}
interface Resp {
  meses: string[]; facets: Facets; total: number; page: number; totalPaginas: number; itens: Linha[];
}

const emptyFacets: Facets = { cds: [], categorias: [], fornecedores: [], compradores: [], analistas: [], status: [] };

export default function PlanoPage() {
  const [q, setQ] = useState("");
  const [cobertura, setCobertura] = useState<"total" | "acima90">("total");
  const [cd, setCd] = useState("");
  const [categoria, setCategoria] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [comprador, setComprador] = useState("");
  const [analista, setAnalista] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const pageSize = 300;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    p.set("cobertura", cobertura);
    if (cd) p.set("cd", cd);
    if (categoria) p.set("categoria", categoria);
    if (fornecedor) p.set("fornecedor", fornecedor);
    if (comprador) p.set("comprador", comprador);
    if (analista) p.set("analista", analista);
    if (status) p.set("status", status);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [q, cobertura, cd, categoria, fornecedor, comprador, analista, status, page]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/plano?${qs}`)
        .then((r) => r.json())
        .then(setData)
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [qs]);

  // reset page quando filtros mudam
  useEffect(() => { setPage(1); }, [q, cobertura, cd, categoria, fornecedor, comprador, analista, status]);

  const facets = data?.facets ?? emptyFacets;
  const meses = data?.meses ?? [];
  const itens = data?.itens ?? [];

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirt = useVirtualizer({
    count: itens.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 12,
  });

  const rot = meses.map(rotuloMes);
  const nCols = 11 + meses.length * 3; // colspan total (loading / vazio)

  return (
    <div>
      <PageHeader
        title="Plano de transferência"
        subtitle={data ? `${fmtInt(data.total)} linhas (cd × sku) com transferência > 0` : "carregando…"}
        right={
          <div className="flex gap-2">
            <a className="btn-ghost" href={`/api/plano/export?${qs}&format=csv`}>⬇ CSV</a>
            <a className="btn-primary" href={`/api/plano/export?${qs}&format=xlsx`}>⬇ Excel</a>
          </div>
        }
      />

      <div className="card mb-3 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <div className="label mb-1">Busca (produto / código)</div>
            <input className="input w-full" placeholder="ex.: DIPIRONA ou 3858" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Sel label="CD" value={cd} onChange={setCd} opts={facets.cds.map((c) => [String(c), `CD ${c}`])} />
          <Sel label="Categoria N1" value={categoria} onChange={setCategoria} opts={facets.categorias.map((c) => [c, c])} />
          <Sel label="Fornecedor" value={fornecedor} onChange={setFornecedor} opts={facets.fornecedores.map((c) => [c, c])} />
          <Sel label="Comprador" value={comprador} onChange={setComprador} opts={facets.compradores.map((c) => [c, c])} />
          <Sel label="Analista" value={analista} onChange={setAnalista} opts={facets.analistas.map((c) => [c, c])} />
          <Sel label="Status cobertura" value={status} onChange={setStatus} opts={facets.status.map((c) => [c, c])} />
          <div>
            <div className="label mb-1">Cobertura</div>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
              <button onClick={() => setCobertura("total")} className={`rounded-md px-2 py-1.5 ${cobertura === "total" ? "bg-brand-600 text-white" : "text-slate-600"}`}>Total</button>
              <button onClick={() => setCobertura("acima90")} className={`rounded-md px-2 py-1.5 ${cobertura === "acima90" ? "bg-brand-600 text-white" : "text-slate-600"}`}>&gt;90d</button>
            </div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div ref={parentRef} className="thin-scroll max-h-[calc(100vh-300px)] overflow-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-slate-50">
              {/* linha de grupos */}
              <tr className="bg-slate-100/70">
                <th className="gh" colSpan={4}>SKU</th>
                <th className="gh grp" colSpan={meses.length}>Transferência (un)</th>
                <th className="gh grp" colSpan={meses.length}>Caixas (cx)</th>
                <th className="gh grp" colSpan={meses.length}>Valor (R$)</th>
                <th className="gh grp bg-brand-50 text-brand-700" colSpan={4}>Transferência imediata</th>
                <th className="gh grp" colSpan={3}>Indicadores</th>
              </tr>
              {/* linha de colunas */}
              <tr className="border-b border-slate-200">
                <th className="thc border-b border-slate-200">CD</th>
                <th className="thc border-b border-slate-200">Cód.</th>
                <th className="thc border-b border-slate-200">Produto</th>
                <th className="thc border-b border-slate-200">Fornecedor</th>
                {rot.map((m, i) => <th key={"t" + m} className={`thc num border-b border-slate-200 ${i === 0 ? "grp" : ""}`}>{m}</th>)}
                {rot.map((m, i) => <th key={"c" + m} className={`thc num border-b border-slate-200 ${i === 0 ? "grp" : ""}`}>{m}</th>)}
                {rot.map((m, i) => <th key={"v" + m} className={`thc num border-b border-slate-200 ${i === 0 ? "grp" : ""}`}>{m}</th>)}
                <th className="thc num border-b border-slate-200 grp bg-brand-50/60">Qtd un.</th>
                <th className="thc num border-b border-slate-200 bg-brand-50/60">Caixas</th>
                <th className="thc num border-b border-slate-200 bg-brand-50/60">Un. a transferir</th>
                <th className="thc num border-b border-slate-200 bg-brand-50/60">Valor R$</th>
                <th className="thc num border-b border-slate-200 grp">Preço un.</th>
                <th className="thc num border-b border-slate-200">Cobertura</th>
                <th className="thc border-b border-slate-200">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && itens.length === 0 ? (
                <tr><td className="tdc py-6" colSpan={nCols}><Spinner label="Carregando plano…" /></td></tr>
              ) : itens.length === 0 ? (
                <tr><td className="tdc py-6 text-slate-500" colSpan={nCols}>Nenhuma linha para os filtros atuais.</td></tr>
              ) : (
                <>
                  <tr style={{ height: rowVirt.getVirtualItems()[0]?.start ?? 0 }} />
                  {rowVirt.getVirtualItems().map((vi) => {
                    const l = itens[vi.index];
                    return (
                      <tr key={l.idSku + l.cdDestino} data-index={vi.index} ref={rowVirt.measureElement} className={`${vi.index % 2 ? "bg-slate-50/50" : "bg-white"} hover:bg-brand-50/40`}>
                        <td className="tdc font-semibold text-slate-900">CD {l.cdDestino}</td>
                        <td className="tdc text-slate-400">{l.codigoProduto}</td>
                        <td className="tdc max-w-[200px] truncate font-medium" title={l.produto}>{l.produto}</td>
                        <td className="tdc max-w-[140px] truncate text-slate-500" title={l.fornecedor}>{l.fornecedor}</td>
                        {l.transfMes.map((t, i) => <td key={i} className={`tdc num ${i === 0 ? "grp" : ""}`}>{fmtInt(t)}</td>)}
                        {l.transfCaixasMes.map((c, i) => <td key={i} className={`tdc num text-slate-500 ${i === 0 ? "grp" : ""}`}>{fmtInt(c)}</td>)}
                        {l.valorTransfMes.map((v, i) => <td key={i} className={`tdc num ${i === 0 ? "grp" : ""}`}>{fmtRs(v)}</td>)}
                        <td className="tdc num grp bg-brand-50/30">{fmtInt(l.qtdTransfImediata)}</td>
                        <td className="tdc num text-slate-500 bg-brand-50/30">{fmtInt(l.imediataCaixas)}</td>
                        <td className="tdc num font-semibold text-brand-700 bg-brand-50/30">{fmtInt(l.qtdImediataArredondada)}</td>
                        <td className="tdc num bg-brand-50/30">{fmtRs(l.valorTransfImediata)}</td>
                        <td className="tdc num grp text-slate-400">{fmtRs(l.precoUnitario)}</td>
                        <td className="tdc num">{l.coberturaDias >= 9999 ? "—" : `${Math.round(l.coberturaDias)}d`}</td>
                        <td className="tdc"><StatusBadge s={l.statusCobertura} /></td>
                      </tr>
                    );
                  })}
                  <tr style={{ height: Math.max(0, rowVirt.getTotalSize() - (rowVirt.getVirtualItems().at(-1)?.end ?? 0)) }} />
                </>
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPaginas > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm">
            <span className="text-slate-500">Página {data.page} de {data.totalPaginas} · {pageSize}/página</span>
            <div className="flex gap-2">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
              <button className="btn-ghost" disabled={page >= data.totalPaginas} onClick={() => setPage((p) => p + 1)}>Próxima</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Sel({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const cor = s.startsWith("Acima") ? "bg-rose-100 text-rose-700" : s === "Sem giro" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
  return <span className={`badge ${cor}`}>{s}</span>;
}

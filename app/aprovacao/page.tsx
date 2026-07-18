"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Kpi, PageHeader, Spinner } from "@/components/ui";
import { fmtInt, fmtRs, fmtRs2 } from "@/lib/format";

interface Linha {
  cdDestino: number; idSku: string; codigoProduto: number; produto: string; fornecedor: string;
  transfMes: number[]; valorTransfMes: number[]; statusCobertura: string; aprovada?: boolean;
}
interface PlanoResp { versaoId: string; total: number; itens: Linha[] }
interface AprovResp { versionId: string; totalLinhas: number; aprovadas: number; valorAprovado: number }

export default function Aprovacao() {
  const [data, setData] = useState<PlanoResp | null>(null);
  const [resumo, setResumo] = useState<AprovResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const carregar = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ page: "1", pageSize: "200", sort: "valorTotal", dir: "desc" });
    if (q) qs.set("q", q);
    Promise.all([
      fetch(`/api/plano?${qs}`).then((r) => r.json()),
      fetch("/api/aprovacoes").then((r) => r.json()),
    ]).then(([p, a]) => { setData(p); setResumo(a); }).finally(() => setLoading(false));
  }, [q]);

  useEffect(() => { const t = setTimeout(carregar, 200); return () => clearTimeout(t); }, [carregar]);

  const toggle = async (chaves: string[], aprovado: boolean) => {
    if (!data) return;
    await fetch("/api/aprovacoes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: data.versaoId, chaves, aprovado }),
    });
    carregar();
  };

  if (loading && !data) return <div className="pt-10"><Spinner label="Carregando plano…" /></div>;
  if (!data || !resumo) return null;

  const chave = (l: Linha) => `${l.cdDestino}:${l.idSku}`;
  const todasChaves = data.itens.map(chave);
  const todasAprovadas = data.itens.length > 0 && data.itens.every((l) => l.aprovada);

  return (
    <div>
      <PageHeader
        title="Aprovação e execução"
        subtitle={`Versão ${data.versaoId} · marque as linhas aprovadas e gere a ordem de transferência para o ERP/WMS.`}
        right={
          <a
            className="btn-primary"
            href={`/api/aprovacoes/ordem?versionId=${data.versaoId}`}
            onClick={(e) => { if (resumo.aprovadas === 0) { e.preventDefault(); setMsg("Aprove ao menos uma linha antes de gerar a ordem."); } }}
          >
            ⬇ Gerar ordem de transferência
          </a>
        }
      />

      {msg && <div className="mb-4"><Alert tom="warn">{msg}</Alert></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Linhas no plano" valor={fmtInt(resumo.totalLinhas)} />
        <Kpi titulo="Linhas aprovadas" valor={fmtInt(resumo.aprovadas)} tom="good" />
        <Kpi titulo="Valor aprovado" valor={fmtRs(resumo.valorAprovado)} tom="brand" />
        <Kpi titulo="% aprovado (linhas)" valor={`${((resumo.aprovadas / Math.max(1, resumo.totalLinhas)) * 100).toFixed(1)}%`} />
      </div>

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
        <input className="input flex-1 min-w-[200px]" placeholder="Buscar produto/código…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-ghost" onClick={() => toggle(todasChaves, !todasAprovadas)}>
          {todasAprovadas ? "Desmarcar página" : "Aprovar página"}
        </button>
      </div>

      <div className="card overflow-x-auto thin-scroll">
        <table className="min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th w-10"></th>
              <th className="th">CD</th>
              <th className="th">Cód.</th>
              <th className="th">Produto</th>
              <th className="th">Fornecedor</th>
              <th className="th text-right">Qtd total</th>
              <th className="th text-right">Valor total</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.itens.map((l) => {
              const qtd = l.transfMes.reduce((a, b) => a + b, 0);
              const valor = l.valorTransfMes.reduce((a, b) => a + b, 0);
              return (
                <tr key={chave(l)} className={l.aprovada ? "bg-emerald-50/50" : "hover:bg-slate-50"}>
                  <td className="td">
                    <input type="checkbox" checked={!!l.aprovada} onChange={(e) => toggle([chave(l)], e.target.checked)} />
                  </td>
                  <td className="td font-medium">CD {l.cdDestino}</td>
                  <td className="td text-slate-500">{l.codigoProduto}</td>
                  <td className="td max-w-[240px] truncate" title={l.produto}>{l.produto}</td>
                  <td className="td text-slate-500">{l.fornecedor}</td>
                  <td className="td text-right">{fmtInt(qtd)}</td>
                  <td className="td text-right font-medium">{fmtRs2(valor)}</td>
                  <td className="td">
                    <span className={`badge ${l.statusCobertura.startsWith("Acima") ? "bg-rose-100 text-rose-700" : l.statusCobertura === "Sem giro" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{l.statusCobertura}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          Exibindo as {fmtInt(data.itens.length)} linhas de maior valor. Refine com a busca. A ordem gerada inclui <b>todas</b> as linhas aprovadas da versão.
        </div>
      </div>
    </div>
  );
}

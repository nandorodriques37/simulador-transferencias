"use client";

import { CSSProperties, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, Kpi, PageHeader, Spinner } from "@/components/ui";
import { corCd, fmtInt, fmtPct, fmtRs, fmtRs2, fmtRsCompacto, rotuloMes } from "@/lib/format";

interface ResumoCd {
  cdDestino: number;
  aliquotaFiscal: number;
  aliquotaDefinida: boolean;
  transfMes: number[];
  valorTransfMes: number[];
  transfObjetivo: number;
  valorTransfObjetivo: number;
  qtdImediata: number;
  valorImediata: number;
  impactoFiscal: number;
}
interface DashResp {
  versao: { id: string; label: string; criadoEm: string };
  cobertura: string;
  modelo: "drp" | "estoque_objetivo";
  meses: string[];
  prioridadeCds: number[];
  kpis: {
    excessoSimplesRs: number;
    excessoTransferivelRs: number;
    valorTransfMes: number[];
    valorTransfObjetivo: number;
    valorTransfTotal: number;
    valorImediata: number;
    impactoFiscalTotal: number;
    linhasPlano: number;
    skusDistintos: number;
    alertaAliquotas: number[];
  };
  resumo: ResumoCd[];
  tempoMs: number;
}

export default function Dashboard() {
  const [cobertura, setCobertura] = useState<"total" | "acima90">("total");
  const [data, setData] = useState<DashResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard?cobertura=${cobertura}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [cobertura]);

  if (loading && !data) return <div className="pt-10"><Spinner label="Carregando painel…" /></div>;
  if (!data) return null;

  const { kpis, resumo, meses } = data;
  const objetivoMode = data.modelo === "estoque_objetivo";
  const totalRow = {
    transfMes: meses.map((_, m) => resumo.reduce((a, r) => a + r.transfMes[m], 0)),
    valorMes: meses.map((_, m) => resumo.reduce((a, r) => a + r.valorTransfMes[m], 0)),
    transfObjetivo: resumo.reduce((a, r) => a + r.transfObjetivo, 0),
    valorObjetivo: resumo.reduce((a, r) => a + r.valorTransfObjetivo, 0),
    qtdImediata: resumo.reduce((a, r) => a + r.qtdImediata, 0),
    valorImediata: resumo.reduce((a, r) => a + r.valorImediata, 0),
    impactoFiscal: resumo.reduce((a, r) => a + r.impactoFiscal, 0),
  };

  // Valor total por CD (meses + objetivo) — headline consistente nos 2 modelos.
  const valorCd = (r: ResumoCd) => r.valorTransfMes.reduce((a, b) => a + b, 0) + r.valorTransfObjetivo;
  const qtdCd = (r: ResumoCd) => r.transfMes.reduce((a, b) => a + b, 0) + r.transfObjetivo;

  const chartPorCd = resumo.map((r) => ({
    cd: `CD ${r.cdDestino}`,
    cdNum: r.cdDestino,
    valor: valorCd(r),
    fiscal: r.impactoFiscal,
  }));
  const chartMensal = objetivoMode
    ? [{ mes: "Estoque objetivo", valor: kpis.valorTransfObjetivo }]
    : meses.map((m, i) => ({ mes: rotuloMes(m), valor: kpis.valorTransfMes[i] }));

  // Matriz: totais gerais + heatmap por célula de valor (CD × mês / objetivo).
  const totalQtdGeral = totalRow.transfMes.reduce((a, b) => a + b, 0) + totalRow.transfObjetivo;
  const totalValorGeral = totalRow.valorMes.reduce((a, b) => a + b, 0) + totalRow.valorObjetivo;
  const maxCelulaValor = Math.max(1, ...resumo.flatMap((r) => [...r.valorTransfMes, r.valorTransfObjetivo]));
  const heat = (v: number): CSSProperties | undefined =>
    v <= 0 ? undefined : { backgroundColor: `rgba(237,10,46,${(0.05 + 0.33 * (v / maxCelulaValor)).toFixed(3)})` };

  return (
    <div>
      <PageHeader
        title="Dashboard executivo"
        subtitle={`Excesso do CD de origem → ${objetivoMode ? "atender estoque objetivo por CD" : "pedidos projetados (DRP)"} · modelo ${objetivoMode ? "Estoque Objetivo" : "DRP"} · versão ${data.versao.id} · recálculo em ${data.tempoMs} ms`}
        right={
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
            <button onClick={() => setCobertura("total")} className={`rounded-md px-3 py-1.5 ${cobertura === "total" ? "bg-brand-600 text-white" : "text-slate-600"}`}>Total</button>
            <button onClick={() => setCobertura("acima90")} className={`rounded-md px-3 py-1.5 ${cobertura === "acima90" ? "bg-brand-600 text-white" : "text-slate-600"}`}>Acima de 90 dias</button>
          </div>
        }
      />

      {kpis.alertaAliquotas.length > 0 && (
        <div className="mb-4">
          <Alert tom="warn">
            Parâmetro incompleto: os CDs {kpis.alertaAliquotas.map((c) => `CD${c}`).join(", ")} têm transferência planejada mas
            sem alíquota fiscal definida — o impacto fiscal total está subestimado. Ajuste em <b>Parâmetros</b>.
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Excesso em estoque" valor={fmtRsCompacto(kpis.excessoSimplesRs)} sub={`Transferível: ${fmtRsCompacto(kpis.excessoTransferivelRs)}`} />
        <Kpi titulo="Transferências planejadas" valor={fmtRsCompacto(kpis.valorTransfTotal)} sub={`${fmtInt(kpis.linhasPlano)} linhas · ${fmtInt(kpis.skusDistintos)} SKUs`} tom="brand" />
        <Kpi titulo="Transferência imediata" valor={fmtRsCompacto(kpis.valorImediata)} sub="pode sair hoje (fator de segurança)" tom="good" />
        <Kpi titulo="Impacto fiscal (ICMS)" valor={fmtRsCompacto(kpis.impactoFiscalTotal)} sub="custo das rotas de transferência" tom="warn" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">Valor transferido por CD destino</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartPorCd} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="cd" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => fmtRsCompacto(v)} tick={{ fontSize: 11 }} width={70} />
              <Tooltip formatter={(v: number) => fmtRs(v)} />
              <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                {chartPorCd.map((d) => (
                  <Cell key={d.cd} fill={corCd(d.cdNum)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">
            {objetivoMode ? "Valor transferido para atender estoque objetivo" : "Evolução mensal do valor transferido"}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartMensal} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => fmtRsCompacto(v)} tick={{ fontSize: 11 }} width={70} />
              <Tooltip formatter={(v: number) => fmtRs(v)} />
              <Legend />
              <Bar dataKey="valor" name="Valor transferido" fill="#0000be" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-700">{objetivoMode ? "Matriz CD destino (estoque objetivo)" : "Matriz CD destino × mês"}</div>
            <div className="text-xs text-slate-400">
              {objetivoMode
                ? "Quantidade (un) e valor (R$) para atender o estoque objetivo por CD · imediata e impacto fiscal · meses zerados neste modelo"
                : "Quantidade (un) e valor transferido (R$) por CD e mês · imediata e impacto fiscal"}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>menor</span>
            <span className="inline-block h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg, rgba(237,10,46,0.06), rgba(237,10,46,0.38))" }} />
            <span>maior R$</span>
          </div>
        </div>
        <div className="thin-scroll overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead className="bg-slate-50">
              {/* grupos */}
              <tr>
                <th rowSpan={2} className="math border-b border-slate-200">Destino</th>
                <th colSpan={meses.length + 1 + (objetivoMode ? 1 : 0)} className="matgh grp border-b border-slate-200">Quantidade (un)</th>
                <th colSpan={meses.length + 1 + (objetivoMode ? 1 : 0)} className="matgh grp border-b border-slate-200">Valor transferido (R$)</th>
                <th rowSpan={2} className="math grp border-b border-slate-200">Participação</th>
                <th colSpan={2} className="matgh grp border-b border-slate-200 bg-brand-50 text-brand-700">Transferência imediata</th>
                <th colSpan={2} className="matgh grp border-b border-slate-200 bg-amber-50 text-amber-700">Fiscal (ICMS)</th>
              </tr>
              {/* colunas */}
              <tr>
                {meses.map((m, i) => <th key={"hq" + m} className={`math num border-b border-slate-200 ${i === 0 ? "grp" : ""}`}>{rotuloMes(m)}</th>)}
                {objetivoMode && <th className="math num border-b border-slate-200 text-brand-700">Objetivo</th>}
                <th className="math num border-b border-slate-200 border-l border-l-slate-100 text-slate-600">Total</th>
                {meses.map((m, i) => <th key={"hv" + m} className={`math num border-b border-slate-200 ${i === 0 ? "grp" : ""}`}>{rotuloMes(m)}</th>)}
                {objetivoMode && <th className="math num border-b border-slate-200 text-brand-700">Objetivo</th>}
                <th className="math num border-b border-slate-200 border-l border-l-slate-100 text-slate-600">Total</th>
                <th className="math num grp border-b border-slate-200">Qtd</th>
                <th className="math num border-b border-slate-200">R$</th>
                <th className="math num grp border-b border-slate-200">Impacto</th>
                <th className="math num border-b border-slate-200">Alíquota</th>
              </tr>
            </thead>
            <tbody>
              {resumo.map((r) => {
                const rQtd = qtdCd(r);
                const rValor = valorCd(r);
                const share = totalValorGeral > 0 ? rValor / totalValorGeral : 0;
                return (
                  <tr key={r.cdDestino} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="matd">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: corCd(r.cdDestino) }} />
                        CD {r.cdDestino}
                      </span>
                    </td>
                    {r.transfMes.map((q, i) => <td key={i} className={`matd num ${i === 0 ? "grp" : ""} ${q <= 0 ? "text-slate-300" : ""}`}>{q > 0 ? fmtInt(q) : "–"}</td>)}
                    {objetivoMode && <td className={`matd num ${r.transfObjetivo <= 0 ? "text-slate-300" : "font-medium text-brand-700"}`}>{r.transfObjetivo > 0 ? fmtInt(r.transfObjetivo) : "–"}</td>}
                    <td className="matd num border-l border-slate-100 font-semibold text-slate-800">{fmtInt(rQtd)}</td>
                    {r.valorTransfMes.map((v, i) => <td key={"v" + i} className={`matd num ${i === 0 ? "grp" : ""} ${v <= 0 ? "text-slate-300" : ""}`} style={heat(v)}>{v > 0 ? fmtRs(v) : "–"}</td>)}
                    {objetivoMode && <td className={`matd num ${r.valorTransfObjetivo <= 0 ? "text-slate-300" : "font-medium text-brand-700"}`} style={heat(r.valorTransfObjetivo)}>{r.valorTransfObjetivo > 0 ? fmtRs(r.valorTransfObjetivo) : "–"}</td>}
                    <td className="matd num border-l border-slate-100 font-semibold text-slate-800">{fmtRs(rValor)}</td>
                    <td className="matd grp">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-[44px] flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${(share * 100).toFixed(1)}%`, background: corCd(r.cdDestino) }} />
                        </div>
                        <span className="w-9 text-right text-[12px] tabular-nums text-slate-500">{fmtPct(share)}</span>
                      </div>
                    </td>
                    <td className="matd num grp">{fmtInt(r.qtdImediata)}</td>
                    <td className="matd num">{fmtRs(r.valorImediata)}</td>
                    <td className="matd num grp">{fmtRs(r.impactoFiscal)}</td>
                    <td className="matd num">
                      {r.aliquotaDefinida ? fmtPct(r.aliquotaFiscal, 2) : <span className="rounded bg-amber-50 px-1.5 text-[11px] font-medium text-amber-600">a definir</span>}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
                <td className="matd font-bold">Total geral</td>
                {totalRow.transfMes.map((q, i) => <td key={i} className={`matd num ${i === 0 ? "grp" : ""}`}>{fmtInt(q)}</td>)}
                {objetivoMode && <td className="matd num font-bold text-brand-700">{fmtInt(totalRow.transfObjetivo)}</td>}
                <td className="matd num border-l border-slate-100 font-bold">{fmtInt(totalQtdGeral)}</td>
                {totalRow.valorMes.map((v, i) => <td key={"v" + i} className={`matd num ${i === 0 ? "grp" : ""}`}>{fmtRs(v)}</td>)}
                {objetivoMode && <td className="matd num font-bold text-brand-700">{fmtRs(totalRow.valorObjetivo)}</td>}
                <td className="matd num border-l border-slate-100 font-bold">{fmtRs(totalValorGeral)}</td>
                <td className="matd num grp text-slate-400">100%</td>
                <td className="matd num grp">{fmtInt(totalRow.qtdImediata)}</td>
                <td className="matd num">{fmtRs(totalRow.valorImediata)}</td>
                <td className="matd num grp">{fmtRs2(totalRow.impactoFiscal)}</td>
                <td className="matd" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

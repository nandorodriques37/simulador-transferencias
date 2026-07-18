"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, Kpi, PageHeader, Spinner } from "@/components/ui";
import { corCd, fmtInt, fmtRs, fmtRs2, fmtRsCompacto, rotuloMes } from "@/lib/format";

interface ResumoCd {
  cdDestino: number;
  aliquotaFiscal: number;
  aliquotaDefinida: boolean;
  transfMes: number[];
  valorTransfMes: number[];
  qtdImediata: number;
  valorImediata: number;
  impactoFiscal: number;
}
interface DashResp {
  versao: { id: string; label: string; criadoEm: string };
  cobertura: string;
  meses: string[];
  prioridadeCds: number[];
  kpis: {
    excessoSimplesRs: number;
    excessoTransferivelRs: number;
    valorTransfMes: number[];
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
  const totalRow = {
    transfMes: meses.map((_, m) => resumo.reduce((a, r) => a + r.transfMes[m], 0)),
    valorMes: meses.map((_, m) => resumo.reduce((a, r) => a + r.valorTransfMes[m], 0)),
    qtdImediata: resumo.reduce((a, r) => a + r.qtdImediata, 0),
    valorImediata: resumo.reduce((a, r) => a + r.valorImediata, 0),
    impactoFiscal: resumo.reduce((a, r) => a + r.impactoFiscal, 0),
  };

  const chartPorCd = resumo.map((r) => ({
    cd: `CD ${r.cdDestino}`,
    cdNum: r.cdDestino,
    valor: r.valorTransfMes.reduce((a, b) => a + b, 0),
    fiscal: r.impactoFiscal,
  }));
  const chartMensal = meses.map((m, i) => ({ mes: rotuloMes(m), valor: kpis.valorTransfMes[i] }));

  return (
    <div>
      <PageHeader
        title="Dashboard executivo"
        subtitle={`Excesso do CD10 → pedidos projetados (DRP) · versão ${data.versao.id} · recálculo em ${data.tempoMs} ms`}
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
          <div className="mb-2 text-sm font-semibold text-slate-700">Evolução mensal do valor transferido</div>
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

      <div className="card mt-4 overflow-x-auto thin-scroll">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          Matriz CD destino × mês (quantidade e R$)
        </div>
        <table className="min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Destino</th>
              {meses.map((m) => (
                <th key={m} className="th text-right">Qtd {rotuloMes(m)}</th>
              ))}
              {meses.map((m) => (
                <th key={"v" + m} className="th text-right">R$ {rotuloMes(m)}</th>
              ))}
              <th className="th text-right">Qtd imediata</th>
              <th className="th text-right">R$ imediata</th>
              <th className="th text-right">Impacto fiscal</th>
              <th className="th text-right">Alíquota</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {resumo.map((r) => (
              <tr key={r.cdDestino} className="hover:bg-slate-50">
                <td className="td font-medium">
                  <span className="badge mr-1" style={{ background: corCd(r.cdDestino) + "22", color: corCd(r.cdDestino) }}>CD {r.cdDestino}</span>
                </td>
                {r.transfMes.map((q, i) => <td key={i} className="td text-right">{fmtInt(q)}</td>)}
                {r.valorTransfMes.map((v, i) => <td key={"v" + i} className="td text-right">{fmtRs(v)}</td>)}
                <td className="td text-right">{fmtInt(r.qtdImediata)}</td>
                <td className="td text-right">{fmtRs(r.valorImediata)}</td>
                <td className="td text-right">{fmtRs(r.impactoFiscal)}</td>
                <td className="td text-right">
                  {r.aliquotaDefinida ? `${(r.aliquotaFiscal * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : <span className="text-amber-600">a definir</span>}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td className="td">Total geral</td>
              {totalRow.transfMes.map((q, i) => <td key={i} className="td text-right">{fmtInt(q)}</td>)}
              {totalRow.valorMes.map((v, i) => <td key={"v" + i} className="td text-right">{fmtRs(v)}</td>)}
              <td className="td text-right">{fmtInt(totalRow.qtdImediata)}</td>
              <td className="td text-right">{fmtRs(totalRow.valorImediata)}</td>
              <td className="td text-right">{fmtRs2(totalRow.impactoFiscal)}</td>
              <td className="td" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

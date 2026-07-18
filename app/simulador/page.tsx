"use client";

import { useEffect, useState } from "react";
import { Alert, PageHeader, Spinner } from "@/components/ui";
import { corCd, fmtInt, fmtRs, rotuloMes } from "@/lib/format";

interface Parametros {
  prioridadeCds: number[];
  horizonteMeses: string[];
  aliquotaFiscal: Record<number, number>;
  fatorSegurancaImediata: number;
  limiteCoberturaDias: number;
}
interface ResumoSim {
  valorTransfTotal: number; valorImediata: number; impactoFiscal: number; linhas: number;
  porCd: { cd: number; valorTotal: number; valorImediata: number; impactoFiscal: number; qtdImediata: number }[];
}
interface SimResp {
  base: { versaoId: string; resumo: ResumoSim };
  simulado: { resumo: ResumoSim };
  delta: { valorTransfTotal: number; valorImediata: number; impactoFiscal: number; linhas: number };
  cenario: { id: string; nome: string } | null;
}

export default function Simulador() {
  const [params, setParams] = useState<Parametros | null>(null);
  const [res, setRes] = useState<SimResp | null>(null);
  const [rodando, setRodando] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [cenarios, setCenarios] = useState<{ id: string; nome: string; criadoEm: string }[]>([]);

  useEffect(() => {
    fetch("/api/params").then((r) => r.json()).then((d) => setParams(d.parametros));
    carregarCenarios();
  }, []);

  const carregarCenarios = () => fetch("/api/cenarios").then((r) => r.json()).then((d) => setCenarios(d.cenarios));

  if (!params) return <div className="pt-10"><Spinner label="Carregando parâmetros…" /></div>;

  const setP = (patch: Partial<Parametros>) => setParams({ ...params, ...patch });

  const moverPara = (from: number, to: number) => {
    if (to < 0 || to >= params.prioridadeCds.length) return;
    const arr = [...params.prioridadeCds];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    setP({ prioridadeCds: arr });
  };

  const simular = async (salvarComo?: string) => {
    setRodando(true);
    try {
      const r = await fetch("/api/simular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parametros: params, salvarComo }),
      });
      setRes(await r.json());
      if (salvarComo) carregarCenarios();
    } finally {
      setRodando(false);
    }
  };

  const salvar = () => {
    const nome = window.prompt("Nome do cenário:", `Cenário ${new Date().toLocaleDateString("pt-BR")}`);
    if (nome) simular(nome);
  };

  return (
    <div>
      <PageHeader
        title="Simulador de cenários"
        subtitle="Altere prioridade, alíquotas, fator de segurança e horizonte; compare o cenário base vs. simulado."
        right={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={salvar} disabled={rodando}>💾 Salvar cenário</button>
            <button className="btn-primary" onClick={() => simular()} disabled={rodando}>{rodando ? "Calculando…" : "▶ Recalcular"}</button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">Prioridade dos CDs (arraste para reordenar)</div>
          <ul className="mb-4 space-y-1">
            {params.prioridadeCds.map((cd, i) => (
              <li
                key={cd}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIdx !== null) moverPara(dragIdx, i); setDragIdx(null); }}
                className="flex cursor-grab items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="text-slate-400">⋮⋮</span>
                  <span className="badge" style={{ background: corCd(cd) + "22", color: corCd(cd) }}>CD {cd}</span>
                  <span className="text-slate-400">#{i + 1}</span>
                </span>
                <span className="flex gap-1">
                  <button className="btn-ghost px-2 py-1" onClick={() => moverPara(i, i - 1)}>↑</button>
                  <button className="btn-ghost px-2 py-1" onClick={() => moverPara(i, i + 1)}>↓</button>
                </span>
              </li>
            ))}
          </ul>

          <div className="mb-2 text-sm font-semibold text-slate-700">Alíquotas fiscais (ICMS) por CD</div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {params.prioridadeCds.map((cd) => (
              <label key={cd} className="text-sm">
                <span className="label">CD {cd} (%)</span>
                <input
                  type="number" step="0.1" className="input mt-1 w-full"
                  value={params.aliquotaFiscal[cd] != null ? (params.aliquotaFiscal[cd] * 100).toString() : ""}
                  placeholder="a definir"
                  onChange={(e) => {
                    const v = e.target.value;
                    const aliq = { ...params.aliquotaFiscal };
                    if (v === "") delete aliq[cd]; else aliq[cd] = Number(v) / 100;
                    setP({ aliquotaFiscal: aliq });
                  }}
                />
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              <span className="label">Fator segurança imediata</span>
              <input type="number" step="0.1" className="input mt-1 w-full" value={params.fatorSegurancaImediata}
                onChange={(e) => setP({ fatorSegurancaImediata: Number(e.target.value) })} />
            </label>
            <label className="text-sm">
              <span className="label">Limite cobertura (dias)</span>
              <input type="number" className="input mt-1 w-full" value={params.limiteCoberturaDias}
                onChange={(e) => setP({ limiteCoberturaDias: Number(e.target.value) })} />
            </label>
          </div>

          <div className="mt-3">
            <span className="label">Horizonte (meses AAAA_MM)</span>
            <input className="input mt-1 w-full" value={params.horizonteMeses.join(", ")}
              onChange={(e) => setP({ horizonteMeses: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <div className="mt-1 text-xs text-slate-400">{params.horizonteMeses.map(rotuloMes).join(" · ")}</div>
          </div>
        </div>

        <div className="space-y-4">
          {!res ? (
            <div className="card p-8 text-center text-sm text-slate-500">
              Ajuste os parâmetros e clique em <b>Recalcular</b> para comparar com o cenário base.
            </div>
          ) : (
            <>
              {res.cenario && <Alert tom="good">Cenário “{res.cenario.nome}” salvo.</Alert>}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <DeltaKpi titulo="Valor transferido" base={res.base.resumo.valorTransfTotal} sim={res.simulado.resumo.valorTransfTotal} delta={res.delta.valorTransfTotal} />
                <DeltaKpi titulo="Transf. imediata" base={res.base.resumo.valorImediata} sim={res.simulado.resumo.valorImediata} delta={res.delta.valorImediata} />
                <DeltaKpi titulo="Impacto fiscal" base={res.base.resumo.impactoFiscal} sim={res.simulado.resumo.impactoFiscal} delta={res.delta.impactoFiscal} invert />
                <DeltaKpi titulo="Linhas do plano" base={res.base.resumo.linhas} sim={res.simulado.resumo.linhas} delta={res.delta.linhas} moeda={false} />
              </div>

              <div className="card overflow-x-auto thin-scroll">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Comparativo por CD destino (base → simulado)</div>
                <table className="min-w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="th">Destino</th>
                      <th className="th text-right">Valor base</th>
                      <th className="th text-right">Valor simulado</th>
                      <th className="th text-right">Δ Valor</th>
                      <th className="th text-right">Fiscal base</th>
                      <th className="th text-right">Fiscal simulado</th>
                      <th className="th text-right">Δ Fiscal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {res.simulado.resumo.porCd.map((s) => {
                      const b = res.base.resumo.porCd.find((x) => x.cd === s.cd) ?? { valorTotal: 0, impactoFiscal: 0 };
                      return (
                        <tr key={s.cd} className="hover:bg-slate-50">
                          <td className="td font-medium"><span className="badge" style={{ background: corCd(s.cd) + "22", color: corCd(s.cd) }}>CD {s.cd}</span></td>
                          <td className="td text-right">{fmtRs(b.valorTotal)}</td>
                          <td className="td text-right">{fmtRs(s.valorTotal)}</td>
                          <td className={`td text-right font-medium ${s.valorTotal - b.valorTotal >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{sinal(s.valorTotal - b.valorTotal)}</td>
                          <td className="td text-right">{fmtRs(b.impactoFiscal)}</td>
                          <td className="td text-right">{fmtRs(s.impactoFiscal)}</td>
                          <td className={`td text-right font-medium ${s.impactoFiscal - b.impactoFiscal <= 0 ? "text-emerald-600" : "text-rose-600"}`}>{sinal(s.impactoFiscal - b.impactoFiscal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="card p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">Cenários salvos</div>
            {cenarios.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhum cenário salvo ainda.</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {cenarios.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <span className="font-medium">{c.nome}</span>
                    <span className="text-xs text-slate-400">{new Date(c.criadoEm).toLocaleString("pt-BR")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function sinal(n: number) {
  const s = n >= 0 ? "+" : "−";
  return `${s}${fmtRs(Math.abs(n)).replace("R$", "R$ ")}`;
}

function DeltaKpi({ titulo, base, sim, delta, invert, moeda = true }: { titulo: string; base: number; sim: number; delta: number; invert?: boolean; moeda?: boolean }) {
  const bom = invert ? delta <= 0 : delta >= 0;
  const f = moeda ? fmtRs : fmtInt;
  return (
    <div className="card p-4">
      <div className="label">{titulo}</div>
      <div className="mt-1 text-lg font-bold text-slate-900">{f(sim)}</div>
      <div className="text-xs text-slate-400">base {f(base)}</div>
      <div className={`mt-1 text-sm font-semibold ${bom ? "text-emerald-600" : "text-rose-600"}`}>
        {delta >= 0 ? "+" : "−"}{f(Math.abs(delta))}
      </div>
    </div>
  );
}

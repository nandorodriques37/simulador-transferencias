"use client";

import { useEffect, useState } from "react";
import { Alert, PageHeader, Spinner } from "@/components/ui";
import { Parametros } from "@/components/CdManager";
import { ParametrosEditor } from "@/components/ParametrosEditor";
import { corCd, fmtInt, fmtRs } from "@/lib/format";

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
  const [disponiveis, setDisponiveis] = useState<number[]>([]);
  const [res, setRes] = useState<SimResp | null>(null);
  const [rodando, setRodando] = useState(false);
  const [cenarios, setCenarios] = useState<{ id: string; nome: string; criadoEm: string }[]>([]);
  const [msgOficial, setMsgOficial] = useState<string | null>(null);

  const carregarOficiais = () => fetch("/api/params").then((r) => r.json()).then((d) => setParams(d.parametros));

  useEffect(() => {
    carregarOficiais();
    fetch("/api/cds").then((r) => r.json()).then((d) => setDisponiveis(d.todos ?? []));
    carregarCenarios();
  }, []);

  const carregarCenarios = () => fetch("/api/cenarios").then((r) => r.json()).then((d) => setCenarios(d.cenarios));

  if (!params) return <div className="pt-10"><Spinner label="Carregando parâmetros…" /></div>;

  const restaurar = () => { carregarOficiais(); setMsgOficial("Parâmetros oficiais restaurados."); };

  const aplicarOficial = async () => {
    setRodando(true);
    setMsgOficial(null);
    try {
      const r = await fetch("/api/params", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
      const d = await r.json();
      setMsgOficial(r.ok ? `Aplicado como oficial (v${d.version}) — nova versão de cálculo ${d.versaoId}.` : `Erro: ${d.erro}`);
    } finally {
      setRodando(false);
    }
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
          <div className="mb-1 text-sm font-semibold text-slate-700">Cenário simulado</div>
          <p className="mb-3 text-xs text-slate-500">
            Começa a partir dos <b>parâmetros oficiais</b>. Ajuste aqui para testar — nada é salvo
            até você <b>Salvar cenário</b> ou <b>Aplicar como oficial</b>.
          </p>

          <ParametrosEditor params={params} disponiveis={disponiveis} onChange={setParams} />

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={restaurar} disabled={rodando}>↺ Restaurar oficiais</button>
            <button className="btn-ghost" onClick={aplicarOficial} disabled={rodando}>✓ Aplicar como oficial</button>
          </div>
          {msgOficial && <div className="mt-2"><Alert tom={msgOficial.startsWith("Erro") ? "erro" : "good"}>{msgOficial}</Alert></div>}
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

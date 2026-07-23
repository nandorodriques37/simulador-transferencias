"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, PageHeader, Progress, Spinner } from "@/components/ui";
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
interface Achado { nivel: "erro" | "aviso" | "info"; codigo: string; mensagem: string; qtd: number; exemplos?: string[] }
interface Relatorio { posicaoLinhas: number; pedidosLinhas: number; objetivosLinhas?: number; achados: Achado[]; ok: boolean }
interface ImportLog { id: string; em: string; por: string; origem: string; posicaoLinhas: number; pedidosLinhas: number; objetivosLinhas?: number; relatorio: Relatorio }
interface Hist { version: number; criadoEm: string; criadoPor: string; hash: string }

const nivelCor = { erro: "erro", aviso: "warn", info: "info" } as const;

export default function ParametrosCenarios() {
  const [params, setParams] = useState<Parametros | null>(null);
  const [disponiveis, setDisponiveis] = useState<number[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  // Simulação
  const [res, setRes] = useState<SimResp | null>(null);
  const [cenarios, setCenarios] = useState<{ id: string; nome: string; criadoEm: string; criadoPor: string }[]>([]);
  const [durable, setDurable] = useState(false);
  const [cenarioAtivo, setCenarioAtivo] = useState<string | null>(null);

  // Importação
  const [posFile, setPosFile] = useState<File | null>(null);
  const [pedFile, setPedFile] = useState<File | null>(null);
  const [objFile, setObjFile] = useState<File | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [log, setLog] = useState<ImportLog[]>([]);
  const posRef = useRef<HTMLInputElement>(null);
  const pedRef = useRef<HTMLInputElement>(null);
  const objRef = useRef<HTMLInputElement>(null);

  const carregarOficiais = () => fetch("/api/params").then((r) => r.json()).then((d) => { setParams(d.parametros); setHist(d.historico); });
  const carregarCenarios = () => fetch("/api/cenarios").then((r) => r.json()).then((d) => { setCenarios(d.cenarios); setDurable(!!d.durable); });
  const carregar = () => {
    carregarOficiais();
    carregarCenarios();
    fetch("/api/importlog").then((r) => r.json()).then((d) => setLog(d.importLog));
    fetch("/api/cds").then((r) => r.json()).then((d) => setDisponiveis(d.todos ?? []));
  };
  useEffect(carregar, []);

  if (!params) return <div className="pt-10"><Spinner label="Carregando…" /></div>;

  const objetivoAtivo = params.modelo === "estoque_objetivo";

  // --- Ações de parâmetros/cenário ---
  const salvarOficial = async () => {
    setRodando(true); setMsg(null);
    const r = await fetch("/api/params", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
    const d = await r.json();
    setRodando(false);
    if (r.ok) { setMsg(`Parâmetros oficiais salvos (v${d.version}) — nova versão de cálculo ${d.versaoId}.`); carregarOficiais(); }
    else setMsg(`Erro: ${d.erro}`);
  };

  const simular = async (salvarComo?: string) => {
    setRodando(true); setMsg(null);
    try {
      const r = await fetch("/api/simular", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parametros: params, salvarComo }) });
      setRes(await r.json());
      if (salvarComo) carregarCenarios();
    } finally { setRodando(false); }
  };

  const salvarCenario = () => {
    const nome = window.prompt("Nome do cenário:", `Cenário ${new Date().toLocaleDateString("pt-BR")}`);
    if (nome) simular(nome);
  };

  const restaurar = () => { carregarOficiais(); setRes(null); setCenarioAtivo(null); setMsg("Parâmetros oficiais restaurados."); };

  // Abre uma simulação salva: recarrega o resultado gravado e exibe o comparativo.
  const abrirCenario = async (id: string, nome: string) => {
    setRodando(true); setMsg(null);
    try {
      const r = await fetch(`/api/cenarios/${id}`);
      const d = await r.json();
      if (!r.ok) { setMsg(`Erro: ${d.erro}`); return; }
      const p = d.cenario.payload as SimResp;
      setRes({ ...p, cenario: { id, nome } });
      setParams(d.cenario.parametros);
      setCenarioAtivo(id);
      setMsg(`Exibindo cenário “${nome}”.`);
    } finally { setRodando(false); }
  };

  const excluirCenario = async (id: string, nome: string) => {
    if (!window.confirm(`Excluir o cenário “${nome}”?`)) return;
    const r = await fetch(`/api/cenarios/${id}`, { method: "DELETE" });
    if (r.ok) {
      if (cenarioAtivo === id) { setRes(null); setCenarioAtivo(null); }
      carregarCenarios();
    } else {
      const d = await r.json();
      setMsg(`Erro ao excluir: ${d.erro}`);
    }
  };

  // --- Importação ---
  const enviar = async (dryRun: boolean) => {
    if (!posFile && !pedFile && !objFile) return;
    setImportando(true); setProgresso(dryRun ? 30 : 20); if (dryRun) setRelatorio(null);
    const fd = new FormData();
    if (posFile) fd.append("posicao", posFile);
    if (pedFile) fd.append("pedidos", pedFile);
    if (objFile) fd.append("objetivo", objFile);
    fd.append("dryRun", String(dryRun));
    const r = await fetch("/api/import", { method: "POST", body: fd });
    setProgresso(90);
    const d = await r.json();
    setProgresso(100); setImportando(false);
    setRelatorio(d.relatorio ?? { posicaoLinhas: 0, pedidosLinhas: 0, achados: [{ nivel: "erro", codigo: "x", mensagem: d.erro, qtd: 0 }], ok: false });
    if (!dryRun && r.ok) {
      setMsg(`Base importada · nova versão ${d.versaoId}.`);
      setPosFile(null); setPedFile(null); setObjFile(null);
      if (posRef.current) posRef.current.value = ""; if (pedRef.current) pedRef.current.value = ""; if (objRef.current) objRef.current.value = "";
      carregar();
    } else if (!dryRun) {
      setMsg(`Importação bloqueada: ${d.erro}`);
    }
  };

  return (
    <div>
      <PageHeader
        title="Parâmetros e cenários"
        subtitle="Edite os parâmetros uma vez: salve como oficial, simule variações ou importe as bases."
        right={
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={restaurar} disabled={rodando}>↺ Restaurar oficiais</button>
            <button className="btn-ghost" onClick={salvarCenario} disabled={rodando}>💾 Salvar cenário</button>
            <button className="btn-ghost" onClick={() => simular()} disabled={rodando}>▶ Simular</button>
            <button className="btn-primary" onClick={salvarOficial} disabled={rodando}>Salvar oficial (nova versão)</button>
          </div>
        }
      />

      {msg && <div className="mb-4"><Alert tom={msg.startsWith("Erro") || msg.includes("bloqueada") ? "erro" : "good"}>{msg}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* Coluna esquerda: editor único + histórico */}
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-1 text-sm font-semibold text-slate-700">Parâmetros</div>
            <p className="mb-3 text-xs text-slate-500">
              <b>Salvar oficial</b> vira a versão vigente (Dashboard/Plano/Aprovação). <b>Simular</b> compara sem
              oficializar. <b>Salvar cenário</b> guarda esta configuração nomeada.
            </p>
            <ParametrosEditor params={params} disponiveis={disponiveis} onChange={setParams} />
          </div>

          <div className="card p-4">
            <div className="label mb-2">Histórico de parâmetros (auditoria)</div>
            <ul className="max-h-48 space-y-1 overflow-auto text-xs">
              {hist.map((h) => (
                <li key={h.version} className="flex justify-between rounded border border-slate-100 px-2 py-1">
                  <span>v{h.version} · {h.criadoPor}</span>
                  <span className="text-slate-400">{new Date(h.criadoEm).toLocaleString("pt-BR")} · #{h.hash}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Coluna direita: comparação, cenários, importação */}
        <div className="space-y-4">
          {res ? (
            <>
              {res.cenario && <Alert tom="good">Cenário “{res.cenario.nome}” salvo.</Alert>}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <DeltaKpi titulo="Valor transferido" base={res.base.resumo.valorTransfTotal} sim={res.simulado.resumo.valorTransfTotal} delta={res.delta.valorTransfTotal} />
                <DeltaKpi titulo="Transf. imediata" base={res.base.resumo.valorImediata} sim={res.simulado.resumo.valorImediata} delta={res.delta.valorImediata} />
                <DeltaKpi titulo="Impacto fiscal" base={res.base.resumo.impactoFiscal} sim={res.simulado.resumo.impactoFiscal} delta={res.delta.impactoFiscal} invert />
                <DeltaKpi titulo="Linhas do plano" base={res.base.resumo.linhas} sim={res.simulado.resumo.linhas} delta={res.delta.linhas} moeda={false} />
              </div>
              <div className="card overflow-x-auto thin-scroll">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Comparativo por CD destino (oficial → simulado)</div>
                <table className="min-w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="th">Destino</th>
                      <th className="th text-right">Valor oficial</th>
                      <th className="th text-right">Valor simulado</th>
                      <th className="th text-right">Δ Valor</th>
                      <th className="th text-right">Fiscal oficial</th>
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
          ) : (
            <div className="card p-6 text-center text-sm text-slate-500">
              Ajuste os parâmetros à esquerda e clique em <b>Simular</b> para comparar com a versão oficial —
              ou <b>Salvar oficial</b> para aplicar de vez.
            </div>
          )}

          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">Cenários salvos</div>
              <span className={`badge ${durable ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {durable ? "🗄 Persistidos (Neon)" : "⚠ Em memória (demo)"}
              </span>
            </div>
            <p className="mb-2 text-xs text-slate-500">Clique em uma simulação para reexibir o comparativo salvo.</p>
            {cenarios.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhum cenário salvo ainda.</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {cenarios.map((c) => (
                  <li
                    key={c.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${cenarioAtivo === c.id ? "border-brand-300 bg-brand-50" : "border-slate-100"}`}
                  >
                    <button
                      className="flex-1 text-left hover:text-brand-700 disabled:opacity-50"
                      onClick={() => abrirCenario(c.id, c.nome)}
                      disabled={rodando}
                      title="Exibir simulação salva"
                    >
                      <span className="font-medium">{c.nome}</span>
                      <span className="block text-xs text-slate-400">
                        {new Date(c.criadoEm).toLocaleString("pt-BR")} · {c.criadoPor}
                      </span>
                    </button>
                    <button
                      className="text-xs text-slate-400 hover:text-rose-600"
                      onClick={() => excluirCenario(c.id, c.nome)}
                      title="Excluir cenário"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <div className="mb-1 text-sm font-semibold text-slate-700">Importar bases (CSV / Excel / XLSB)</div>
            <p className="mb-3 text-xs text-slate-500">
              A <b>posição de estoque</b> alimenta o excesso do CD de origem nos dois modelos. Depois envie a fonte de
              demanda do modelo ativo:{" "}
              {objetivoAtivo
                ? <><b>estoque objetivo</b> (modelo 2)</>
                : <><b>pedidos projetados</b> (DRP)</>}. Você pode enviar só o arquivo que mudou.
            </p>
            <label className="mb-2 block text-sm">
              <span className="label">Posição de estoque origem (BASE_MODELOS)</span>
              <input ref={posRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" className="input mt-1 w-full" onChange={(e) => setPosFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className={`mb-2 block text-sm ${objetivoAtivo ? "opacity-60" : ""}`}>
              <span className="label">Pedidos projetados (PEDIDOS PROJETADOS) {!objetivoAtivo && <span className="text-brand-600">· modelo ativo</span>}</span>
              <input ref={pedRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" className="input mt-1 w-full" onChange={(e) => setPedFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className={`mb-3 block text-sm ${objetivoAtivo ? "" : "opacity-60"}`}>
              <span className="label">Estoque objetivo por CD (CD destino · produto · descrição · saldo objetivo) {objetivoAtivo && <span className="text-brand-600">· modelo ativo</span>}</span>
              <input ref={objRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" className="input mt-1 w-full" onChange={(e) => setObjFile(e.target.files?.[0] ?? null)} />
            </label>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => enviar(true)} disabled={importando || (!posFile && !pedFile && !objFile)}>Validar (prévia)</button>
              <button className="btn-primary" onClick={() => enviar(false)} disabled={importando || (!posFile && !pedFile && !objFile)}>Importar e recalcular</button>
            </div>
            {importando && <div className="mt-3"><Progress pct={progresso} label="Processando base…" /></div>}

            {relatorio && (
              <div className="mt-4">
                <div className="mb-2 text-sm">
                  Prévia: <b>{fmtInt(relatorio.posicaoLinhas)}</b> SKUs · <b>{fmtInt(relatorio.pedidosLinhas)}</b> pedidos ·{" "}
                  <b>{fmtInt(relatorio.objetivosLinhas ?? 0)}</b> objetivos ·{" "}
                  {relatorio.ok ? <span className="text-emerald-600">sem erros bloqueantes</span> : <span className="text-rose-600">contém erros</span>}
                </div>
                <div className="space-y-1">
                  {relatorio.achados.length === 0 && <Alert tom="good">Nenhum problema de qualidade detectado.</Alert>}
                  {relatorio.achados.map((a, i) => (
                    <Alert key={i} tom={nivelCor[a.nivel]}>
                      <b>{a.mensagem}</b> {a.qtd > 0 && <>({fmtInt(a.qtd)})</>}
                      {a.exemplos && a.exemplos.length > 0 && <span className="text-slate-500"> · ex.: {a.exemplos.join(", ")}</span>}
                    </Alert>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <div className="label mb-1">Log de importações</div>
              {log.length === 0 ? (
                <div className="text-xs text-slate-400">Nenhuma importação registrada (usando base de demonstração).</div>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-auto text-xs">
                  {log.map((l) => (
                    <li key={l.id} className="rounded border border-slate-100 px-2 py-1">
                      <div className="flex justify-between"><span className="font-medium">{l.origem}</span><span className="text-slate-400">{new Date(l.em).toLocaleString("pt-BR")}</span></div>
                      <div className="text-slate-500">{fmtInt(l.posicaoLinhas)} SKUs · {fmtInt(l.pedidosLinhas)} pedidos · {fmtInt(l.objetivosLinhas ?? 0)} objetivos · por {l.por}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function sinal(n: number) {
  const s = n >= 0 ? "+" : "−";
  return `${s}${fmtRs(Math.abs(n))}`;
}

function DeltaKpi({ titulo, base, sim, delta, invert, moeda = true }: { titulo: string; base: number; sim: number; delta: number; invert?: boolean; moeda?: boolean }) {
  const bom = invert ? delta <= 0 : delta >= 0;
  const f = moeda ? fmtRs : fmtInt;
  return (
    <div className="card p-4">
      <div className="label">{titulo}</div>
      <div className="mt-1 text-lg font-bold text-slate-900">{f(sim)}</div>
      <div className="text-xs text-slate-400">oficial {f(base)}</div>
      <div className={`mt-1 text-sm font-semibold ${bom ? "text-emerald-600" : "text-rose-600"}`}>
        {delta >= 0 ? "+" : "−"}{f(Math.abs(delta))}
      </div>
    </div>
  );
}

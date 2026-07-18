"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, PageHeader, Progress, Spinner } from "@/components/ui";
import { CdManager, Parametros } from "@/components/CdManager";
import { fmtInt, rotuloMes } from "@/lib/format";

interface Achado { nivel: "erro" | "aviso" | "info"; codigo: string; mensagem: string; qtd: number; exemplos?: string[] }
interface Relatorio { posicaoLinhas: number; pedidosLinhas: number; achados: Achado[]; ok: boolean }
interface ImportLog { id: string; em: string; por: string; origem: string; posicaoLinhas: number; pedidosLinhas: number; relatorio: Relatorio }
interface Hist { version: number; criadoEm: string; criadoPor: string; hash: string }

export default function ParametrosPage() {
  const [params, setParams] = useState<Parametros | null>(null);
  const [disponiveis, setDisponiveis] = useState<number[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [posFile, setPosFile] = useState<File | null>(null);
  const [pedFile, setPedFile] = useState<File | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [log, setLog] = useState<ImportLog[]>([]);
  const posRef = useRef<HTMLInputElement>(null);
  const pedRef = useRef<HTMLInputElement>(null);

  const carregar = () => {
    fetch("/api/params").then((r) => r.json()).then((d) => { setParams(d.parametros); setHist(d.historico); });
    fetch("/api/importlog").then((r) => r.json()).then((d) => setLog(d.importLog));
    fetch("/api/cds").then((r) => r.json()).then((d) => setDisponiveis(d.todos ?? []));
  };
  useEffect(carregar, []);

  if (!params) return <div className="pt-10"><Spinner label="Carregando…" /></div>;
  const setP = (patch: Partial<Parametros>) => setParams({ ...params, ...patch });

  const salvar = async () => {
    setSalvando(true); setMsg(null);
    const r = await fetch("/api/params", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
    const d = await r.json();
    setSalvando(false);
    if (r.ok) { setMsg(`Parâmetros salvos (v${d.version}) — nova versão de cálculo ${d.versaoId} gerada.`); carregar(); }
    else setMsg(`Erro: ${d.erro}`);
  };

  const validar = async () => {
    if (!posFile && !pedFile) return;
    setImportando(true); setProgresso(30); setRelatorio(null);
    const fd = new FormData();
    if (posFile) fd.append("posicao", posFile);
    if (pedFile) fd.append("pedidos", pedFile);
    fd.append("dryRun", "true");
    const r = await fetch("/api/import", { method: "POST", body: fd });
    setProgresso(90);
    const d = await r.json();
    setRelatorio(d.relatorio ?? { posicaoLinhas: 0, pedidosLinhas: 0, achados: [{ nivel: "erro", codigo: "x", mensagem: d.erro, qtd: 0 }], ok: false });
    setProgresso(100); setImportando(false);
  };

  const importar = async () => {
    if (!posFile && !pedFile) return;
    setImportando(true); setProgresso(20);
    const fd = new FormData();
    if (posFile) fd.append("posicao", posFile);
    if (pedFile) fd.append("pedidos", pedFile);
    fd.append("dryRun", "false");
    const r = await fetch("/api/import", { method: "POST", body: fd });
    setProgresso(80);
    const d = await r.json();
    setProgresso(100); setImportando(false);
    if (r.ok) {
      setMsg(`Importado: ${fmtInt(d.meta?.excessoTotalRs ? d.log.posicaoLinhas : 0)} SKUs · nova versão ${d.versaoId}.`);
      setRelatorio(d.relatorio); setPosFile(null); setPedFile(null);
      if (posRef.current) posRef.current.value = ""; if (pedRef.current) pedRef.current.value = "";
      carregar();
    } else {
      setRelatorio(d.relatorio); setMsg(`Importação bloqueada: ${d.erro}`);
    }
  };

  const nivelCor = { erro: "erro", aviso: "warn", info: "info" } as const;

  return (
    <div>
      <PageHeader title="Parâmetros e importação" subtitle="Configuração de negócio versionada + upload das bases com validação de qualidade." />

      {msg && <div className="mb-4"><Alert tom={msg.startsWith("Erro") || msg.includes("bloqueada") ? "erro" : "good"}>{msg}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Parâmetros */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-700">Parâmetros de negócio</div>
            <button className="btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar (nova versão)"}</button>
          </div>

          <div className="mb-4">
            <CdManager params={params} disponiveis={disponiveis} onChange={setParams} />
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
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

          <label className="text-sm">
            <span className="label">Horizonte (meses AAAA_MM)</span>
            <input className="input mt-1 w-full" value={params.horizonteMeses.join(", ")}
              onChange={(e) => setP({ horizonteMeses: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <div className="mt-1 text-xs text-slate-400">{params.horizonteMeses.map(rotuloMes).join(" · ")}</div>
          </label>

          <div className="mt-4">
            <div className="label mb-1">Histórico de parâmetros (auditoria)</div>
            <ul className="max-h-40 space-y-1 overflow-auto text-xs">
              {hist.map((h) => (
                <li key={h.version} className="flex justify-between rounded border border-slate-100 px-2 py-1">
                  <span>v{h.version} · {h.criadoPor}</span>
                  <span className="text-slate-400">{new Date(h.criadoEm).toLocaleString("pt-BR")} · #{h.hash}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Importação */}
        <div className="card p-4">
          <div className="mb-3 text-sm font-semibold text-slate-700">Importar bases (CSV / Excel / XLSB)</div>

          <label className="mb-2 block text-sm">
            <span className="label">Posição de estoque origem (BASE_MODELOS)</span>
            <input ref={posRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" className="input mt-1 w-full" onChange={(e) => setPosFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="mb-3 block text-sm">
            <span className="label">Pedidos projetados (PEDIDOS PROJETADOS)</span>
            <input ref={pedRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" className="input mt-1 w-full" onChange={(e) => setPedFile(e.target.files?.[0] ?? null)} />
          </label>

          <div className="flex gap-2">
            <button className="btn-ghost" onClick={validar} disabled={importando || (!posFile && !pedFile)}>Validar (prévia)</button>
            <button className="btn-primary" onClick={importar} disabled={importando || (!posFile && !pedFile)}>Importar e recalcular</button>
          </div>

          {importando && <div className="mt-3"><Progress pct={progresso} label="Processando base…" /></div>}

          {relatorio && (
            <div className="mt-4">
              <div className="mb-2 text-sm">
                Prévia: <b>{fmtInt(relatorio.posicaoLinhas)}</b> SKUs · <b>{fmtInt(relatorio.pedidosLinhas)}</b> pedidos ·{" "}
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
                    <div className="text-slate-500">{fmtInt(l.posicaoLinhas)} SKUs · {fmtInt(l.pedidosLinhas)} pedidos · por {l.por}</div>
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

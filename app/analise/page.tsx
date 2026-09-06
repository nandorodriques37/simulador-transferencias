"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Chave, PageHeader, Progress, Secao, Spinner } from "@/components/ui";
import { CdInfo, SequenciaCds } from "@/components/SequenciaCds";
import { fmtInt, fmtRsCompacto, rotuloMes } from "@/lib/format";

type ModoDemanda = "saldo_ideal" | "pedidos";

type MetricaCapacidade = "unidades" | "caixas" | "paletes" | "peso" | "volume" | "valor";

interface CapacidadeRede {
  ativa: boolean;
  metrica: MetricaCapacidade;
  porOrigem: Record<number, number>;
  porDestino: Record<number, number>;
  porRota: Record<string, number>;
  prioridade: "valor" | "urgencia";
}

const METRICAS: { valor: MetricaCapacidade; rotulo: string; unidade: string; requer?: string }[] = [
  { valor: "unidades", rotulo: "Unidades", unidade: "un" },
  { valor: "caixas", rotulo: "Caixas", unidade: "cx", requer: "embalagem de compra" },
  { valor: "paletes", rotulo: "Paletes", unidade: "pallets", requer: "unidades por palete" },
  { valor: "peso", rotulo: "Peso", unidade: "kg", requer: "peso unitário" },
  { valor: "volume", rotulo: "Volume", unidade: "m³", requer: "cubagem unitária" },
  { valor: "valor", rotulo: "Valor", unidade: "R$" },
];

interface Parametros {
  modoDemanda: ModoDemanda;
  origens: number[];
  destinos: number[];
  horizonteMeses: string[];
  aliquotas: Record<string, number>;
  fatorSegurancaImediata: number;
  limiteCoberturaDias: number;
  considerarAprovadas: boolean;
  considerarPendenteOrigem: boolean;
  coberturaMaxDestinoDias: number;
  coberturaMinDestinoDias: number;
  estrategiaDestino: "prioridade" | "nivelar_cobertura";
  arredondarCaixaFechada: boolean;
  minUnidadesLinha: number;
  minValorLinha: number;
  limitesCoberturaAtivos: boolean;
  limitesEmbarqueAtivos: boolean;
  minValorRota: number;
  capacidade: CapacidadeRede;
}
interface Achado { nivel: "erro" | "aviso" | "info"; codigo: string; mensagem: string; qtd: number; exemplos?: string[] }
interface Relatorio { baseLinhas: number; pedidosLinhas: number; cdsBase: number[]; achados: Achado[]; ok: boolean }
interface Dataset {
  baseLinhas: number; pedidosLinhas: number; produtos: number; cds: number[];
  fonteBase: string; fontePedidos: string; importedEm: string; mesesPedidos: string[];
}
interface ImportLog { id: string; em: string; por: string; origem: string; baseLinhas: number; pedidosLinhas: number; cds: number[] }

const nivelTom = { erro: "erro", aviso: "warn", info: "info" } as const;

export default function NovaAnalise() {
  const router = useRouter();
  const [params, setParams] = useState<Parametros | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [cdsInfo, setCdsInfo] = useState<CdInfo[]>([]);
  const [log, setLog] = useState<ImportLog[]>([]);
  const [msg, setMsg] = useState<{ tom: "good" | "erro" | "info"; texto: string } | null>(null);
  const [rodando, setRodando] = useState(false);
  const [limitarRota, setLimitarRota] = useState(false);

  // Importação
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [pedFile, setPedFile] = useState<File | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const baseRef = useRef<HTMLInputElement>(null);
  const pedRef = useRef<HTMLInputElement>(null);

  const carregar = () => {
    fetch("/api/status").then((r) => r.json()).then((d) => { setParams(d.parametros); setDataset(d.dataset); });
    fetch("/api/cds").then((r) => r.json()).then((d) => setCdsInfo(d.cds ?? []));
    fetch("/api/importlog").then((r) => r.json()).then((d) => setLog(d.importLog ?? []));
  };
  useEffect(carregar, []);

  const infoPorCd = useMemo(() => Object.fromEntries(cdsInfo.map((c) => [c.cd, c])) as Record<number, CdInfo>, [cdsInfo]);

  if (!params || !dataset) return <div className="pt-10"><Spinner label="Carregando…" /></div>;

  const set = (patch: Partial<Parametros>) => setParams({ ...params, ...patch });
  const cap: CapacidadeRede = params.capacidade ?? {
    ativa: true,
    metrica: "unidades",
    porOrigem: {},
    porDestino: {},
    porRota: {},
    prioridade: "valor",
  };
  const setCap = (patch: Partial<CapacidadeRede>) => set({ capacidade: { ...cap, ...patch } });
  const setLimite = (campo: "porOrigem" | "porDestino" | "porRota", chave: number | string, valor: string) => {
    const alvo = { ...(cap[campo] as Record<string, number>) };
    if (valor === "" || Number(valor) <= 0) delete alvo[String(chave)];
    else alvo[String(chave)] = Number(valor);
    setCap({ [campo]: alvo } as Partial<CapacidadeRede>);
  };
  // Chaves gerais: desligam um grupo inteiro sem apagar o que foi configurado.
  const capAtiva = cap.ativa !== false;
  const cobAtiva = params.limitesCoberturaAtivos !== false;
  const embAtiva = params.limitesEmbarqueAtivos !== false;
  const algumaLigada = cobAtiva || embAtiva || capAtiva;
  const desligarTudo = () =>
    set({
      limitesCoberturaAtivos: false,
      limitesEmbarqueAtivos: false,
      capacidade: { ...cap, ativa: false },
    });
  const religarTudo = () =>
    set({
      limitesCoberturaAtivos: true,
      limitesEmbarqueAtivos: true,
      capacidade: { ...cap, ativa: true },
    });
  const metricaAtual = METRICAS.find((m) => m.valor === cap.metrica);
  const unidadeCap = metricaAtual?.unidade ?? "un";
  const temCapacidade =
    Object.keys(cap.porOrigem ?? {}).length + Object.keys(cap.porDestino ?? {}).length + Object.keys(cap.porRota ?? {}).length > 0;
  const modoPedidos = params.modoDemanda === "pedidos";
  const rotas = params.origens.flatMap((o) => params.destinos.filter((d) => d !== o).map((d) => `${o}>${d}`));
  const mesesDisponiveis = Array.from(new Set([...dataset.mesesPedidos, ...params.horizonteMeses])).sort();

  // --- Importação das bases ---
  const enviar = async (dryRun: boolean) => {
    if (!baseFile && !pedFile) return;
    setImportando(true);
    setProgresso(dryRun ? 30 : 20);
    if (dryRun) setRelatorio(null);
    const fd = new FormData();
    if (baseFile) fd.append("base", baseFile);
    if (pedFile) fd.append("pedidos", pedFile);
    fd.append("dryRun", String(dryRun));
    const r = await fetch("/api/import", { method: "POST", body: fd });
    setProgresso(90);
    const d = await r.json();
    setProgresso(100);
    setImportando(false);
    setRelatorio(d.relatorio ?? { baseLinhas: 0, pedidosLinhas: 0, cdsBase: [], achados: [{ nivel: "erro", codigo: "x", mensagem: d.erro, qtd: 0 }], ok: false });
    if (!dryRun && r.ok) {
      setMsg({ tom: "good", texto: `Bases atualizadas: ${fmtInt(d.dataset.baseLinhas)} linhas · ${d.dataset.cds.length} CDs.` });
      setBaseFile(null); setPedFile(null);
      if (baseRef.current) baseRef.current.value = "";
      if (pedRef.current) pedRef.current.value = "";
      carregar();
    } else if (!dryRun) {
      setMsg({ tom: "erro", texto: `Importação bloqueada: ${d.erro}` });
    }
  };

  // --- Rodar análise ---
  const rodar = async () => {
    setRodando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/analise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parametros: params }) });
      const d = await r.json();
      if (!r.ok) { setMsg({ tom: "erro", texto: `Erro: ${d.erro}` }); return; }
      setMsg({ tom: "good", texto: `Análise ${d.id} concluída em ${d.meta.tempoMs} ms — ${fmtInt(d.meta.linhasPlano)} linhas, ${fmtRsCompacto(d.meta.valorTransfTotal)} em transferências.` });
      router.push("/");
    } finally {
      setRodando(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Nova análise de transferência"
        subtitle={
          <>
            Duas bases, uma análise: a <b>base de CDs</b> (origem e destino) e a <b>base de pedidos</b>.
            Você define a <b>sequência das origens</b> e a <b>ordem dos destinos</b>.
          </>
        }
        right={
          <button onClick={rodar} disabled={rodando} className="btn-primary">
            {rodando ? "Rodando…" : "▶ Rodar análise"}
          </button>
        }
      />

      {msg && <div className="mb-4"><Alert tom={msg.tom}>{msg.texto}</Alert></div>}

      {/* --------------------- Chaves gerais das restrições -------------------- */}
      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">Restrições</span>
          <Chave ligada={cobAtiva} onToggle={(v) => set({ limitesCoberturaAtivos: v })}>
            Teto/piso de cobertura
            {cobAtiva && (params.coberturaMaxDestinoDias > 0 || params.coberturaMinDestinoDias > 0) && (
              <span className="ml-1 opacity-70">
                {params.coberturaMaxDestinoDias > 0 ? `máx ${params.coberturaMaxDestinoDias}d` : ""}
                {params.coberturaMaxDestinoDias > 0 && params.coberturaMinDestinoDias > 0 ? " · " : ""}
                {params.coberturaMinDestinoDias > 0 ? `mín ${params.coberturaMinDestinoDias}d` : ""}
              </span>
            )}
          </Chave>
          <Chave ligada={embAtiva} onToggle={(v) => set({ limitesEmbarqueAtivos: v })}>
            Caixa fechada e mínimos
          </Chave>
          <Chave ligada={capAtiva} onToggle={(v) => setCap({ ativa: v })}>
            Capacidade operacional
            {capAtiva && temCapacidade && <span className="ml-1 opacity-70">({unidadeCap})</span>}
          </Chave>
        </div>
        <button type="button" onClick={algumaLigada ? desligarTudo : religarTudo} className="btn-ghost py-1.5 text-xs">
          {algumaLigada ? "Desligar todas as restrições" : "Religar restrições"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------- 1. Bases ------------------------- */}
        <div className="lg:col-span-3">
          <Secao
            titulo="1 · Bases da análise"
            desc="A base de CDs vem no mesmo layout de antes, agora com todos os CDs empilhados — ela é a fonte de origem E de destino."
            right={
              <div className="text-right text-xs text-slate-500">
                <div>{fmtInt(dataset.baseLinhas)} linhas · {fmtInt(dataset.produtos)} produtos · {dataset.cds.length} CDs</div>
                <div>{fmtInt(dataset.pedidosLinhas)} linhas de pedido</div>
              </div>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="label mb-1">Base de CDs (obrigatória)</div>
                <input ref={baseRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" onChange={(e) => setBaseFile(e.target.files?.[0] ?? null)} className="input w-full text-xs" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Colunas: CD · código do produto · estoque disponível · estoque objetivo · quantidade pendente ·
                  venda média 3m · custo/preço · embalagem. Fonte atual: <b>{dataset.fonteBase || "—"}</b>
                </p>
              </div>
              <div>
                <div className="label mb-1">Base de pedidos (para o modo Pedidos)</div>
                <input ref={pedRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" onChange={(e) => setPedFile(e.target.files?.[0] ?? null)} className="input w-full text-xs" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Colunas: ano-mês · CD destino · código do produto · pedido. Fonte atual: <b>{dataset.fontePedidos || "—"}</b>
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => enviar(true)} disabled={(!baseFile && !pedFile) || importando} className="btn-ghost">Validar (prévia)</button>
              <button onClick={() => enviar(false)} disabled={(!baseFile && !pedFile) || importando} className="btn-secondary">Importar</button>
              {importando && <div className="w-40"><Progress pct={progresso} /></div>}
            </div>

            {relatorio && (
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="text-xs text-slate-600">
                  {fmtInt(relatorio.baseLinhas)} linhas de base · {fmtInt(relatorio.pedidosLinhas)} de pedidos ·
                  CDs: {relatorio.cdsBase.join(", ") || "—"}
                </div>
                {relatorio.achados.map((a, i) => (
                  <Alert key={i} tom={nivelTom[a.nivel]}>
                    <b>{a.mensagem}</b> {a.qtd > 0 && <span className="opacity-70">({fmtInt(a.qtd)})</span>}
                    {a.exemplos && a.exemplos.length > 0 && (
                      <div className="mt-0.5 text-xs opacity-80">{a.exemplos.slice(0, 6).join(" · ")}</div>
                    )}
                  </Alert>
                ))}
              </div>
            )}
          </Secao>
        </div>

        {/* ------------------- 2. Modo de demanda -------------------- */}
        <div className="lg:col-span-1">
          <Secao titulo="2 · O que o destino precisa" desc="Define a demanda que a análise vai tentar cobrir.">
            <div className="flex flex-col gap-2">
              <label className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${!modoPedidos ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                <input type="radio" checked={!modoPedidos} onChange={() => set({ modoDemanda: "saldo_ideal" })} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Só o saldo ideal</span>
                  <span className="block text-xs text-slate-500">Necessidade = estoque objetivo − disponível − pendente. Não usa a base de pedidos.</span>
                </span>
              </label>
              <label className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${modoPedidos ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                <input type="radio" checked={modoPedidos} onChange={() => set({ modoDemanda: "pedidos" })} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Consumir os pedidos futuros</span>
                  <span className="block text-xs text-slate-500">Necessidade = pedidos projetados mês a mês. A transferência abate a compra planejada.</span>
                </span>
              </label>
            </div>

            {modoPedidos && (
              <div className="mt-3">
                <div className="label mb-1">Horizonte (meses da base de pedidos)</div>
                <div className="flex flex-wrap gap-1.5">
                  {mesesDisponiveis.map((m) => {
                    const ativo = params.horizonteMeses.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() =>
                          set({
                            horizonteMeses: ativo
                              ? params.horizonteMeses.filter((x) => x !== m)
                              : [...params.horizonteMeses, m].sort(),
                          })
                        }
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${ativo ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"}`}
                      >
                        {rotuloMes(m)}
                      </button>
                    );
                  })}
                  {mesesDisponiveis.length === 0 && <span className="text-xs text-slate-400">Importe a base de pedidos.</span>}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">A cascata segue mês a mês: o mês 1 de todos os destinos antes do mês 2.</p>
              </div>
            )}

            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="label">Limites de cobertura do destino</span>
                <Chave ligada={cobAtiva} onToggle={(v) => set({ limitesCoberturaAtivos: v })}>
                  {cobAtiva ? "ativo" : "desligado"}
                </Chave>
              </div>
              <div className={`grid grid-cols-2 gap-2 ${cobAtiva ? "" : "opacity-40"}`}>
                <label className="block">
                  <span className="block text-[11px] text-slate-500">Teto (dias) · 0 = sem teto · sugerido 60–90</span>
                  <input type="number" min="0" disabled={!cobAtiva} value={params.coberturaMaxDestinoDias} onChange={(e) => set({ coberturaMaxDestinoDias: Number(e.target.value) })} className="input mt-0.5 w-full py-1.5 text-xs" />
                </label>
                <label className="block">
                  <span className="block text-[11px] text-slate-500">Piso (dias) · 0 = sem piso · sugerido 15–30</span>
                  <input type="number" min="0" disabled={!cobAtiva} value={params.coberturaMinDestinoDias} onChange={(e) => set({ coberturaMinDestinoDias: Number(e.target.value) })} className="input mt-0.5 w-full py-1.5 text-xs" />
                </label>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                O <b>teto</b> impede que um estoque objetivo inflado (ou meses de pedido) puxe volume demais para um CD.
                O <b>piso</b> garante o mínimo antirruptura mesmo com objetivo defasado ou zerado. SKU sem giro no destino
                ignora os dois.
              </p>
              {params.coberturaMaxDestinoDias > 0 && params.coberturaMinDestinoDias > params.coberturaMaxDestinoDias && (
                <div className="mt-2"><Alert tom="erro">O piso não pode ser maior que o teto.</Alert></div>
              )}
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={params.considerarAprovadas} onChange={(e) => set({ considerarAprovadas: e.target.checked })} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium text-slate-800">Considerar sugestões já aprovadas</span>
                  <span className="block text-xs text-slate-500">
                    Desconta o excesso da origem e trata o volume como trânsito no destino, até o faturamento ser importado.
                  </span>
                </span>
              </label>
            </div>
          </Secao>
        </div>

        {/* ---------------- 3. Sequência de origens ----------------- */}
        <div className="lg:col-span-1">
          <Secao titulo="3 · Sequência das origens" desc="Quem escoa o excesso primeiro. A ordem muda o resultado.">
            <SequenciaCds papel="origem" selecionados={params.origens} disponiveis={dataset.cds} info={infoPorCd} onChange={(cds) => set({ origens: cds })} />
            <div className="mt-3 border-t border-slate-100 pt-3">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={params.considerarPendenteOrigem} onChange={(e) => set({ considerarPendenteOrigem: e.target.checked })} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium text-slate-800">Somar a quantidade pendente ao excesso</span>
                  <span className="block text-xs text-slate-500">
                    Ligado: excesso de planejamento (conta o que ainda vai entrar). Desligado: excesso <b>físico</b> —
                    só o que já está no CD pode ser oferecido, sem sugerir a transferência do que não chegou.
                  </span>
                </span>
              </label>
            </div>
          </Secao>
        </div>

        {/* ---------------- 4. Ordem dos destinos ------------------- */}
        <div className="lg:col-span-1">
          <Secao titulo="4 · Ordem dos destinos" desc="Cada origem olha todos estes destinos, nesta prioridade.">
            <SequenciaCds papel="destino" selecionados={params.destinos} disponiveis={dataset.cds} info={infoPorCd} onChange={(cds) => set({ destinos: cds })} excluir={params.origens} />
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="label mb-1.5">Quando o excesso não cobre todos</div>
              <div className="flex flex-col gap-2">
                <label className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 ${params.estrategiaDestino === "prioridade" ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                  <input type="radio" checked={params.estrategiaDestino === "prioridade"} onChange={() => set({ estrategiaDestino: "prioridade" })} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Prioridade estrita</span>
                    <span className="block text-xs text-slate-500">O destino 1 é atendido por inteiro antes do 2.</span>
                  </span>
                </label>
                <label className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 ${params.estrategiaDestino === "nivelar_cobertura" ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                  <input type="radio" checked={params.estrategiaDestino === "nivelar_cobertura"} onChange={() => set({ estrategiaDestino: "nivelar_cobertura" })} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Nivelar dias de cobertura</span>
                    <span className="block text-xs text-slate-500">Enche primeiro quem está mais descoberto — evita ruptura no último da fila.</span>
                  </span>
                </label>
              </div>
            </div>

            {params.destinos.some((d) => params.origens.includes(d)) && (
              <div className="mt-2">
                <Alert tom="info">CDs que são origem e destino ao mesmo tempo são permitidos — o motor só nunca transfere um CD para ele mesmo.</Alert>
              </div>
            )}
          </Secao>
        </div>

        {/* -------------------- 5. Parâmetros ---------------------- */}
        <div className="lg:col-span-3">
          <Secao
            titulo="5 · Parâmetros, embarque e alíquotas por rota"
            desc="O ICMS depende do par origem → destino, por isso a alíquota é por rota."
            right={
              <Chave ligada={embAtiva} onToggle={(v) => set({ limitesEmbarqueAtivos: v })}>
                Caixa fechada e mínimos {embAtiva ? "ativos" : "desligados"}
              </Chave>
            }
          >
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="label mb-1">Fator de segurança (imediata)</div>
                <input type="number" step="0.1" min="0" value={params.fatorSegurancaImediata} onChange={(e) => set({ fatorSegurancaImediata: Number(e.target.value) })} className="input w-full" />
                <p className="mt-1 text-[11px] text-slate-500">Retém venda média × fator antes de liberar a saída de hoje.</p>
              </div>
              <div>
                <div className="label mb-1">Limite de cobertura (dias)</div>
                <input type="number" min="1" value={params.limiteCoberturaDias} onChange={(e) => set({ limiteCoberturaDias: Number(e.target.value) })} className="input w-full" />
                <p className="mt-1 text-[11px] text-slate-500">Classifica o SKU parado na origem.</p>
              </div>
              <div className={embAtiva ? "" : "opacity-40"}>
                <div className="label mb-1">Mínimo por linha (un)</div>
                <input type="number" min="0" disabled={!embAtiva} value={params.minUnidadesLinha} onChange={(e) => set({ minUnidadesLinha: Number(e.target.value) })} className="input w-full" />
                <p className="mt-1 text-[11px] text-slate-500">Abaixo disso a linha não embarca.</p>
              </div>
              <div className={embAtiva ? "" : "opacity-40"}>
                <div className="label mb-1">Mínimo por linha (R$)</div>
                <input type="number" min="0" step="10" disabled={!embAtiva} value={params.minValorLinha} onChange={(e) => set({ minValorLinha: Number(e.target.value) })} className="input w-full" />
                <p className="mt-1 text-[11px] text-slate-500">Corta a cauda longa sem valor.</p>
              </div>
              <div className={embAtiva ? "" : "opacity-40"}>
                <div className="label mb-1">Carga mínima por rota (R$)</div>
                <input type="number" min="0" step="100" disabled={!embAtiva} value={params.minValorRota} onChange={(e) => set({ minValorRota: Number(e.target.value) })} className="input w-full" />
                <p className="mt-1 text-[11px] text-slate-500">Rota abaixo do piso sai do plano inteira.</p>
              </div>
              <div className={`flex items-start pt-5 ${embAtiva ? "" : "opacity-40"}`}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" disabled={!embAtiva} checked={params.arredondarCaixaFechada} onChange={(e) => set({ arredondarCaixaFechada: e.target.checked })} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">Só caixa fechada</span>
                    <span className="block text-[11px] text-slate-500">Transfere múltiplos da embalagem; o resto fica na origem.</span>
                  </span>
                </label>
              </div>
              <div className="md:col-span-4">
                <div className="label mb-1">Resumo da rede</div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge tom="azul">{params.origens.length} origem(ns)</Badge>
                  <Badge tom="brand">{params.destinos.length} destino(s)</Badge>
                  <Badge>{rotas.length} rota(s)</Badge>
                  <Badge tom={modoPedidos ? "warn" : "good"}>{modoPedidos ? `Pedidos · ${params.horizonteMeses.length} mês(es)` : "Saldo ideal"}</Badge>
                  {cobAtiva && params.coberturaMaxDestinoDias > 0 && <Badge>Teto {params.coberturaMaxDestinoDias}d</Badge>}
                  {cobAtiva && params.coberturaMinDestinoDias > 0 && <Badge>Piso {params.coberturaMinDestinoDias}d</Badge>}
                  {params.estrategiaDestino === "nivelar_cobertura" && <Badge tom="azul">Nivelando cobertura</Badge>}
                  {!params.considerarPendenteOrigem && <Badge tom="azul">Excesso físico</Badge>}
                  {embAtiva && params.arredondarCaixaFechada && <Badge>Caixa fechada</Badge>}
                  {capAtiva && temCapacidade && <Badge tom="warn">Capacidade limitada ({unidadeCap})</Badge>}
                  {!cobAtiva && !embAtiva && !capAtiva && <Badge tom="good">Sem restrições</Badge>}
                </div>
              </div>
            </div>

            {rotas.length > 0 && (
              <div className="mt-4 overflow-x-auto thin-scroll">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="th">Rota</th>
                      {params.destinos.map((d) => <th key={d} className="th text-right">→ CD {d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {params.origens.map((o) => (
                      <tr key={o} className="border-b border-slate-100">
                        <td className="td font-semibold">CD {o} →</td>
                        {params.destinos.map((d) => (
                          <td key={d} className="td text-right">
                            {o === d ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  placeholder="0,000"
                                  value={params.aliquotas[`${o}>${d}`] ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    const novo = { ...params.aliquotas };
                                    if (v === "") delete novo[`${o}>${d}`];
                                    else novo[`${o}>${d}`] = Number(v);
                                    set({ aliquotas: novo });
                                  }}
                                  className="input w-24 py-1 text-right text-xs"
                                />
                                <span className="text-[11px] text-slate-400">
                                  {params.aliquotas[`${o}>${d}`] !== undefined ? `${(params.aliquotas[`${o}>${d}`] * 100).toFixed(1)}%` : "—"}
                                </span>
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[11px] text-slate-500">Informe em fração: 0,052 = 5,2%. Rotas sem alíquota entram no plano, mas o impacto fiscal fica subestimado (o dashboard avisa).</p>
              </div>
            )}
          </Secao>
        </div>

        {/* ------------------ 6. Capacidade operacional -------------- */}
        <div className="lg:col-span-3">
          <Secao
            titulo="6 · Capacidade operacional"
            desc="O limite físico da rede na janela desta análise: quanto cada CD expede, quanto recebe e quanto cada rota transporta. Deixe 0 para sem limite."
            right={
              <div className="flex flex-wrap items-end gap-2">
                <div className="pb-1.5">
                  <Chave ligada={capAtiva} onToggle={(v) => setCap({ ativa: v })}>
                    {capAtiva ? "Limites ativos" : "Limites desligados"}
                  </Chave>
                </div>
                <label className="block">
                  <span className="label block">Métrica</span>
                  <select
                    value={cap.metrica}
                    onChange={(e) => setCap({ metrica: e.target.value as MetricaCapacidade })}
                    className="input mt-0.5 py-1.5 text-xs"
                  >
                    {METRICAS.map((m) => (
                      <option key={m.valor} value={m.valor}>{m.rotulo} ({m.unidade})</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label block">Com capacidade escassa, carrega primeiro</span>
                  <select
                    value={cap.prioridade}
                    onChange={(e) => setCap({ prioridade: e.target.value as "valor" | "urgencia" })}
                    className="input mt-0.5 py-1.5 text-xs"
                  >
                    <option value="valor">O SKU de maior valor</option>
                    <option value="urgencia">O SKU mais urgente no destino</option>
                  </select>
                </label>
              </div>
            }
          >
            {metricaAtual?.requer && (
              <div className="mb-3">
                <Alert tom="info">
                  A métrica <b>{metricaAtual.rotulo}</b> usa a coluna <b>{metricaAtual.requer}</b> da base. SKU sem esse
                  dado não consome capacidade — a análise informa quantos ficaram de fora da conta.
                </Alert>
              </div>
            )}

            {!capAtiva && temCapacidade && (
              <div className="mb-3">
                <Alert tom="info">
                  Limites <b>desligados</b> — os valores abaixo ficam guardados e voltam a valer quando você religar a chave.
                </Alert>
              </div>
            )}

            <div className={`grid gap-4 md:grid-cols-2 ${capAtiva ? "" : "opacity-40"}`}>
              <div>
                <div className="label mb-1.5">Expedição por origem ({unidadeCap})</div>
                <div className="flex flex-col gap-1.5">
                  {params.origens.map((cd) => (
                    <label key={cd} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-sm font-medium text-slate-700">CD {cd}</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="sem limite"
                        disabled={!capAtiva}
                        value={cap.porOrigem?.[cd] ?? ""}
                        onChange={(e) => setLimite("porOrigem", cd, e.target.value)}
                        className="input w-40 py-1.5 text-right text-xs"
                      />
                      <span className="text-[11px] text-slate-400">separação e embarque</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="label mb-1.5">Recebimento por destino ({unidadeCap})</div>
                <div className="flex flex-col gap-1.5">
                  {params.destinos.map((cd) => (
                    <label key={cd} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-sm font-medium text-slate-700">CD {cd}</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="sem limite"
                        disabled={!capAtiva}
                        value={cap.porDestino?.[cd] ?? ""}
                        onChange={(e) => setLimite("porDestino", cd, e.target.value)}
                        className="input w-40 py-1.5 text-right text-xs"
                      />
                      <span className="text-[11px] text-slate-400">docas, conferência, endereços</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" disabled={!capAtiva} checked={limitarRota} onChange={(e) => setLimitarRota(e.target.checked)} />
                <span className="text-sm font-medium text-slate-800">Limitar também o transporte por rota (frota disponível)</span>
              </label>
              {limitarRota && rotas.length > 0 && (
                <div className="mt-3 overflow-x-auto thin-scroll">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="th">Rota</th>
                        {params.destinos.map((d) => <th key={d} className="th text-right">→ CD {d}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {params.origens.map((o) => (
                        <tr key={o} className="border-b border-slate-100">
                          <td className="td font-semibold">CD {o} →</td>
                          {params.destinos.map((d) => (
                            <td key={d} className="td text-right">
                              {o === d ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="sem limite"
                                  value={cap.porRota?.[`${o}>${d}`] ?? ""}
                                  onChange={(e) => setLimite("porRota", `${o}>${d}`, e.target.value)}
                                  className="input w-28 py-1 text-right text-xs"
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Os três limites valem ao mesmo tempo — o menor deles é o gargalo. Sugestões já aprovadas e não faturadas
              <b> ocupam capacidade</b>, porque a doca e a frota já estão comprometidas com elas. O dashboard mostra a
              utilização e o que ficou barrado.
            </p>
          </Secao>
        </div>

        {/* ---------------------- Histórico ------------------------ */}
        {log.length > 0 && (
          <div className="lg:col-span-3">
            <Secao titulo="Histórico de importações" desc="Auditoria das bases carregadas nesta instância.">
              <div className="overflow-x-auto thin-scroll">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="th">Quando</th><th className="th">Quem</th><th className="th">Arquivos</th>
                      <th className="th text-right">Base</th><th className="th text-right">Pedidos</th><th className="th">CDs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.slice(0, 8).map((l) => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="td">{new Date(l.em).toLocaleString("pt-BR")}</td>
                        <td className="td">{l.por}</td>
                        <td className="td max-w-xs truncate">{l.origem}</td>
                        <td className="td num">{fmtInt(l.baseLinhas)}</td>
                        <td className="td num">{fmtInt(l.pedidosLinhas)}</td>
                        <td className="td">{l.cds.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Secao>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <button onClick={rodar} disabled={rodando} className="btn-primary">
          {rodando ? "Rodando…" : "▶ Rodar análise"}
        </button>
      </div>
    </div>
  );
}

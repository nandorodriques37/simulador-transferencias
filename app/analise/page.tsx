"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Campo, Chave, ErroCarga, Fonte, PageHeader, Progress, Rolagem, Secao, Spinner } from "@/components/ui";
import { Icone } from "@/components/icones";
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
  pronto: boolean; demo: boolean; duravel: boolean; salvoEm: string; dataPosicao: string;
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
  const [uploadDireto, setUploadDireto] = useState(false);
  const [dataPosicao, setDataPosicao] = useState("");
  const [resultadosDuraveis, setResultadosDuraveis] = useState(false);
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  // Importação
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [pedFile, setPedFile] = useState<File | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const baseRef = useRef<HTMLInputElement>(null);
  const pedRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(() => {
    setErroCarga(null);
    const json = async (u: string) => {
      const r = await fetch(u);
      const d = await r.json();
      if (!r.ok && !d) throw new Error(`${u} respondeu ${r.status}`);
      return d;
    };
    json("/api/status")
      .then((d) => {
        setParams(d.parametros);
        setDataset(d.dataset);
        setUploadDireto(!!d.armazenamento?.uploadDireto);
        setResultadosDuraveis(!!d.resultados?.duravel);
      })
      // O status é o que sustenta a tela inteira: sem ele não há o que mostrar.
      .catch((e: Error) => setErroCarga(e.message || "falha ao carregar"));
    // CDs e histórico são complementos — se falharem, a tela segue utilizável.
    json("/api/cds").then((d) => setCdsInfo(d.cds ?? [])).catch(() => undefined);
    json("/api/importlog").then((d) => setLog(d.importLog ?? [])).catch(() => undefined);
  }, []);
  useEffect(carregar, [carregar]);

  const infoPorCd = useMemo(() => Object.fromEntries(cdsInfo.map((c) => [c.cd, c])) as Record<number, CdInfo>, [cdsInfo]);

  if (erroCarga && (!params || !dataset)) return <ErroCarga erro={erroCarga} onTentar={carregar} />;
  if (!params || !dataset) return <Spinner label="Abrindo a análise…" />;

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
    try {
    let r: Response;
    if (uploadDireto) {
      // Arquivo grande não cabe no corpo de uma função serverless (4,5 MB): vai
      // direto do navegador para o armazenamento e a importação recebe a URL.
      const { upload } = await import("@vercel/blob/client");
      const enviar = async (f: File, prefixo: string) => {
        const blob = await upload(`upload/${prefixo}-${Date.now()}-${f.name}`, f, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          onUploadProgress: ({ percentage }) => setProgresso(Math.round(percentage * 0.7)),
        });
        return blob.url;
      };
      const baseUrl = baseFile ? await enviar(baseFile, "base") : undefined;
      const pedidosUrl = pedFile ? await enviar(pedFile, "pedidos") : undefined;
      setProgresso(75);
      r = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, pedidosUrl, dryRun, dataPosicao }),
      });
    } else {
      const fd = new FormData();
      if (baseFile) fd.append("base", baseFile);
      if (pedFile) fd.append("pedidos", pedFile);
      fd.append("dryRun", String(dryRun));
      fd.append("dataPosicao", dataPosicao);
      r = await fetch("/api/import", { method: "POST", body: fd });
    }
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
    } catch (e) {
      setImportando(false);
      setMsg({ tom: "erro", texto: `Falha no envio: ${(e as Error).message}` });
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
    } catch (e) {
      setMsg({ tom: "erro", texto: `Falha ao rodar a análise: ${(e as Error).message}` });
    } finally {
      setRodando(false);
    }
  };

  // --- Estado de cada passo para o índice lateral ---
  const rotasSemAliquota = rotas.filter((r) => params.aliquotas[r] === undefined);
  const passos: { id: string; nome: string; estado: "ok" | "atencao" | "desligado" | "pendente"; status: string }[] = [
    { id: "p1", nome: "Bases", estado: dataset.pronto ? "ok" : "atencao", status: dataset.pronto ? `Pronto · ${fmtInt(dataset.baseLinhas)} linhas` : "Importe a base de CDs" },
    { id: "p2", nome: "Demanda", estado: modoPedidos && params.horizonteMeses.length === 0 ? "atencao" : "ok", status: modoPedidos ? (params.horizonteMeses.length ? `Pedidos · ${params.horizonteMeses.length} mês(es)` : "Escolha os meses") : "Saldo ideal" },
    { id: "p3", nome: "Origens", estado: params.origens.length ? "ok" : "atencao", status: params.origens.length ? `Pronto · ${params.origens.length} CD(s)` : "Escolha ao menos uma" },
    { id: "p4", nome: "Destinos", estado: params.destinos.length ? "ok" : "atencao", status: params.destinos.length ? `Pronto · ${params.destinos.length} CD(s)` : "Escolha ao menos um" },
    { id: "p5", nome: "Parâmetros e alíquotas", estado: rotasSemAliquota.length ? "atencao" : "ok", status: rotasSemAliquota.length ? `${rotasSemAliquota.length} rota(s) sem alíquota` : "Alíquotas completas" },
    { id: "p6", nome: "Capacidade", estado: capAtiva ? (temCapacidade ? "ok" : "pendente") : "desligado", status: capAtiva ? (temCapacidade ? `Limites ativos · ${unidadeCap}` : "Sem limites definidos") : "Desligada" },
  ];
  const dataBase = dataset.dataPosicao ? new Date(dataset.dataPosicao).toLocaleDateString("pt-BR") : "";
  const titulo = !dataset.pronto
    ? "Importe a base de CDs para começar"
    : rotasSemAliquota.length > 0
      ? <>Falta alíquota em <em>{rotasSemAliquota.length} rota(s)</em></>
      : <>{dataBase ? `Base de ${dataBase} carregada` : "Base carregada"}: {dataset.cds.length} CDs e {fmtInt(dataset.baseLinhas)} linhas</>;
  const podeRodar = dataset.pronto && params.origens.length > 0 && params.destinos.length > 0 && !rodando;
  const nivelAchado = (n: Achado["nivel"]) => nivelTom[n];
  const aliquotaTexto = (rota: string) => {
    const v = params.aliquotas[rota];
    return v === undefined ? "" : String(v).replace(".", ",");
  };
  const setAliquota = (rota: string, texto: string) => {
    const novo = { ...params.aliquotas };
    const limpo = texto.trim().replace(",", ".");
    if (limpo === "") delete novo[rota];
    else if (!Number.isNaN(Number(limpo))) novo[rota] = Number(limpo);
    else return;
    set({ aliquotas: novo });
  };

  const Rodar = ({ className = "pgm-botao" }: { className?: string }) => (
    <button onClick={rodar} disabled={!podeRodar} className={className} type="button">
      {rodando ? "Rodando…" : "Rodar análise"}
    </button>
  );

  return (
    <>
      <PageHeader
        title={titulo}
        subtitle="Seis passos até o plano · a ordem das origens e dos destinos muda o resultado"
        right={<Rodar />}
      />

      {(msg || !dataset.pronto || dataset.demo) && (
        <div className="flex flex-col gap-3">
          {msg && <Alert tom={msg.tom} titulo={msg.tom === "good" ? "Pronto" : msg.tom === "erro" ? "Falha" : "Informação"}>{msg.texto}</Alert>}
          {!dataset.pronto && (
            <Alert tom="warn" titulo="Sem base carregada">
              Importe a base de CDs no passo 1 para rodar a análise. O estado da base vive na memória do servidor: depois de um período ocioso ou de um novo deploy, a importação precisa ser refeita.
            </Alert>
          )}
          {dataset.pronto && dataset.demo && (
            <Alert tom="info" titulo="Base de demonstração">
              Você está vendo dados sintéticos. Importe as suas planilhas para trabalhar com a rede real.
            </Alert>
          )}
        </div>
      )}

      {/* --------------------- Chaves gerais das restrições -------------------- */}
      <section className="app-card restricoes" aria-label="Chaves gerais de restrição">
        <span className="restricoes__tit">Restrições</span>
        <Chave ligada={cobAtiva} onToggle={(v) => set({ limitesCoberturaAtivos: v })}>
          Teto e piso de cobertura
          {cobAtiva && (params.coberturaMaxDestinoDias > 0 || params.coberturaMinDestinoDias > 0) && (
            <small style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}>
              {[params.coberturaMaxDestinoDias > 0 && `teto ${params.coberturaMaxDestinoDias} d`, params.coberturaMinDestinoDias > 0 && `piso ${params.coberturaMinDestinoDias} d`].filter(Boolean).join(" · ")}
            </small>
          )}
        </Chave>
        <Chave ligada={embAtiva} onToggle={(v) => set({ limitesEmbarqueAtivos: v })}>Caixa fechada e mínimos</Chave>
        <Chave ligada={capAtiva} onToggle={(v) => setCap({ ativa: v })}>
          Capacidade operacional
          {capAtiva && temCapacidade && <small style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}>em {unidadeCap}</small>}
        </Chave>
        <button type="button" onClick={algumaLigada ? desligarTudo : religarTudo} className="pgm-botao pgm-botao--secundario">
          {algumaLigada ? "Desligar todas as restrições" : "Religar restrições"}
        </button>
      </section>

      <div className="fluxo">
        {/* ------------------------------ Índice ------------------------------ */}
        <ol className="passos" aria-label="Passos da análise">
          <li className="passos__titulo">Passos</li>
          {passos.map((p, i) => (
            <li key={p.id}>
              <a className="passo" href={`#${p.id}`} data-estado={p.estado}>
                <span className="passo__n">{p.estado === "ok" ? <Icone nome="check" tamanho={14} espessura={3} /> : i + 1}</span>
                <span><b>{p.nome}</b><small>{p.status}</small></span>
              </a>
            </li>
          ))}
        </ol>

        <div className="fluxo__corpo">
          {/* ------------------------- 1. Bases ------------------------- */}
          <Secao
            flush
            id="p1"
            titulo="1 · Bases da análise"
            desc="Uma base só, com todos os CDs empilhados: ela é a fonte de origem e de destino."
            right={
              <div className="app-card__resumo">
                <b>{fmtInt(dataset.baseLinhas)}</b> linhas · <b>{fmtInt(dataset.produtos)}</b> produtos · <b>{dataset.cds.length}</b> CDs
                <br /><b>{fmtInt(dataset.pedidosLinhas)}</b> linhas de pedido{dataBase && <> · posição de <b>{dataBase}</b></>}
              </div>
            }
          >
            <div className="app-card__corpo">
              <div className="parametros">
                <Badge tom={uploadDireto ? "good" : "warn"}>{uploadDireto ? "Upload direto (arquivo grande)" : "Upload pela API (até 4,5 MB)"}</Badge>
                <Badge tom={resultadosDuraveis ? "good" : "warn"}>{resultadosDuraveis ? "Resultados persistidos" : "Resultados em memória"}</Badge>
              </div>

              <div className="opcoes">
                <div className="pgm-campo" style={{ gap: 8 }}>
                  <span className="pgm-campo__rotulo">Base de CDs · obrigatória</span>
                  <input ref={baseRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" className="sr-only" id="arq-base" onChange={(e) => setBaseFile(e.target.files?.[0] ?? null)} />
                  <div className="upload" data-ok={baseFile ? "true" : undefined}>
                    <span className="upload__ico"><Icone nome={baseFile ? "check" : "upload"} tamanho={22} /></span>
                    <div className="upload__txt">
                      <b>{baseFile ? baseFile.name : "Nenhum arquivo escolhido"}</b>
                      <span>{baseFile ? `${(baseFile.size / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB · pronto para validar` : "CSV, XLSX ou XLSB · CSV é mais rápido"}</span>
                    </div>
                    <button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => baseRef.current?.click()}>{baseFile ? "Trocar" : "Escolher arquivo"}</button>
                  </div>
                  <span className="pgm-campo__ajuda">CD · código do produto · estoque disponível · estoque objetivo · quantidade pendente · venda média 3m · custo ou preço · embalagem.{dataset.fonteBase && <> Fonte atual: <b>{dataset.fonteBase}</b>.</>}</span>
                </div>
                <div className="pgm-campo" style={{ gap: 8 }}>
                  <span className="pgm-campo__rotulo">Base de pedidos · para o modo pedidos</span>
                  <input ref={pedRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" className="sr-only" id="arq-ped" onChange={(e) => setPedFile(e.target.files?.[0] ?? null)} />
                  <div className="upload" data-ok={pedFile ? "true" : undefined}>
                    <span className="upload__ico"><Icone nome={pedFile ? "check" : "upload"} tamanho={22} /></span>
                    <div className="upload__txt">
                      <b>{pedFile ? pedFile.name : "Nenhum arquivo escolhido"}</b>
                      <span>{pedFile ? `${(pedFile.size / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB · pronto para validar` : "CSV, XLSX ou XLSB"}</span>
                    </div>
                    <button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => pedRef.current?.click()}>{pedFile ? "Trocar" : "Escolher arquivo"}</button>
                  </div>
                  <span className="pgm-campo__ajuda">Ano-mês · CD destino · código do produto · pedido.{dataset.fontePedidos && <> Fonte atual: <b>{dataset.fontePedidos}</b>.</>}</span>
                </div>
              </div>

              <hr className="divisor" />
              <div className="campo-linha">
                <Campo rotulo="Data da posição de estoque" htmlFor="data-posicao" style={{ maxWidth: 220 }}>
                  <input id="data-posicao" type="date" value={dataPosicao} onChange={(e) => setDataPosicao(e.target.value)} className="pgm-campo__controle" />
                </Campo>
                <p className="ajuda" style={{ maxWidth: 640, paddingBottom: 8 }}>
                  <b>Quando a base foi extraída</b>, não quando você está subindo. É essa data que diz se uma transferência já faturada aparece nos números. Sem ela, o volume é descontado duas vezes ou a mesma transferência é sugerida de novo. Em branco = agora.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => enviar(true)} disabled={(!baseFile && !pedFile) || importando} className="pgm-botao pgm-botao--secundario">Validar (prévia)</button>
                <button type="button" onClick={() => enviar(false)} disabled={(!baseFile && !pedFile) || importando} className="pgm-botao">Importar</button>
                {importando && <div style={{ width: 280 }}><Progress pct={progresso} label="Enviando e validando…" /></div>}
              </div>

              {relatorio && (
                <div className="flex flex-col gap-3">
                  <p className="ajuda">
                    {fmtInt(relatorio.baseLinhas)} linhas de base · {fmtInt(relatorio.pedidosLinhas)} de pedidos · CDs: {relatorio.cdsBase.join(", ") || "nenhum"}
                  </p>
                  {relatorio.achados.length === 0 && <Alert tom="good" titulo="Validação sem achados">Nenhuma inconsistência encontrada nas bases enviadas.</Alert>}
                  {relatorio.achados.map((a, i) => (
                    <Alert key={i} tom={nivelAchado(a.nivel)} titulo={`${a.nivel === "erro" ? "Erro" : a.nivel === "aviso" ? "Atenção" : "Informação"}${a.qtd > 0 ? ` · ${fmtInt(a.qtd)}` : ""}`}>
                      {a.mensagem}
                      {a.exemplos && a.exemplos.length > 0 && <> Exemplos: {a.exemplos.slice(0, 6).join(" · ")}.</>}
                    </Alert>
                  ))}
                </div>
              )}
            </div>
          </Secao>

          {/* ------------------- 2. Modo de demanda -------------------- */}
          <Secao flush id="p2" titulo="2 · O que o destino precisa" desc="Define a demanda que a análise vai tentar cobrir.">
            <div className="app-card__corpo">
              <div className="opcoes">
                <label className="opcao" data-ativo={!modoPedidos ? "true" : undefined}>
                  <input type="radio" name="demanda" checked={!modoPedidos} onChange={() => set({ modoDemanda: "saldo_ideal" })} />
                  <div><b>Só o saldo ideal</b><span>Necessidade = estoque objetivo menos disponível e pendente. Não usa a base de pedidos.</span></div>
                </label>
                <label className="opcao" data-ativo={modoPedidos ? "true" : undefined}>
                  <input type="radio" name="demanda" checked={modoPedidos} onChange={() => set({ modoDemanda: "pedidos" })} />
                  <div><b>Consumir os pedidos futuros</b><span>Necessidade = pedidos projetados mês a mês. A transferência abate a compra planejada.</span></div>
                </label>
              </div>

              <div>
                <p className="pgm-campo__rotulo" style={{ margin: "0 0 8px" }}>Meses do horizonte · só no modo pedidos</p>
                <div className="chips">
                  {mesesDisponiveis.map((m) => {
                    const ativo = params.horizonteMeses.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        className="chip-mes"
                        aria-pressed={ativo}
                        disabled={!modoPedidos}
                        onClick={() => set({ horizonteMeses: ativo ? params.horizonteMeses.filter((x) => x !== m) : [...params.horizonteMeses, m].sort() })}
                      >
                        {rotuloMes(m)}
                      </button>
                    );
                  })}
                  {mesesDisponiveis.length === 0 && <span className="ajuda">Importe a base de pedidos para escolher os meses.</span>}
                </div>
                {modoPedidos && <p className="ajuda" style={{ marginTop: 8 }}>A cascata segue mês a mês: o mês 1 de todos os destinos antes do mês 2.</p>}
              </div>

              <hr className="divisor" />
              <div className="flex flex-wrap items-end gap-4" style={{ opacity: cobAtiva ? 1 : 0.5 }}>
                <Campo rotulo="Teto de cobertura (dias)" htmlFor="teto" ajuda="Corta demanda inflada. 0 = sem teto. Sugestão: 60 a 90." style={{ maxWidth: 240 }}>
                  <input id="teto" type="number" min="0" disabled={!cobAtiva} value={params.coberturaMaxDestinoDias} onChange={(e) => set({ coberturaMaxDestinoDias: Number(e.target.value) })} className="pgm-campo__controle" />
                </Campo>
                <Campo rotulo="Piso de cobertura (dias)" htmlFor="piso" ajuda="Garante o mínimo antirruptura. 0 = sem piso. Sugestão: 15 a 30." style={{ maxWidth: 240 }}>
                  <input id="piso" type="number" min="0" disabled={!cobAtiva} value={params.coberturaMinDestinoDias} onChange={(e) => set({ coberturaMinDestinoDias: Number(e.target.value) })} className="pgm-campo__controle" />
                </Campo>
                {!cobAtiva && <span className="ajuda" style={{ paddingBottom: 10 }}>Chave "Teto e piso" desligada: os valores ficam guardados.</span>}
              </div>
              {params.coberturaMaxDestinoDias > 0 && params.coberturaMinDestinoDias > params.coberturaMaxDestinoDias && (
                <Alert tom="erro" titulo="Piso maior que o teto">O piso não pode ser maior que o teto de cobertura.</Alert>
              )}
              <p className="ajuda">O <b>teto</b> impede que um estoque objetivo inflado, ou meses de pedido, puxe volume demais para um CD. O <b>piso</b> garante o mínimo antirruptura mesmo com objetivo defasado ou zerado. SKU sem giro no destino ignora os dois.</p>

              <hr className="divisor" />
              <label className="marca">
                <input type="checkbox" checked={params.considerarAprovadas} onChange={(e) => set({ considerarAprovadas: e.target.checked })} />
                <span>Considerar sugestões já aprovadas<small>Desconta o excesso da origem e trata o volume como trânsito no destino, até o faturamento ser importado.</small></span>
              </label>
            </div>
          </Secao>

          {/* ---------------- 3. Sequência de origens ----------------- */}
          <Secao flush id="p3" titulo="3 · Sequência das origens" desc="Quem escoa o excesso primeiro. A ordem muda o resultado.">
            <div className="app-card__corpo">
              <SequenciaCds papel="origem" selecionados={params.origens} disponiveis={dataset.cds} info={infoPorCd} onChange={(cds) => set({ origens: cds })} />
              <hr className="divisor" />
              <label className="marca">
                <input type="checkbox" checked={params.considerarPendenteOrigem} onChange={(e) => set({ considerarPendenteOrigem: e.target.checked })} />
                <span>Somar a quantidade pendente ao excesso<small>Ligado: excesso de planejamento, conta o que ainda vai entrar. Desligado: excesso físico, só o que já está no CD é oferecido.</small></span>
              </label>
            </div>
          </Secao>

          {/* ---------------- 4. Ordem dos destinos ------------------- */}
          <Secao flush id="p4" titulo="4 · Ordem dos destinos" desc="Cada origem olha todos estes destinos, nesta prioridade.">
            <div className="app-card__corpo">
              <SequenciaCds papel="destino" selecionados={params.destinos} disponiveis={dataset.cds} info={infoPorCd} onChange={(cds) => set({ destinos: cds })} excluir={params.origens} />
              {params.destinos.some((d) => params.origens.includes(d)) && (
                <Alert tom="info" titulo="CD nas duas listas">Um CD pode ser origem e destino ao mesmo tempo. A única regra: nenhum CD transfere para si mesmo.</Alert>
              )}
              <hr className="divisor" />
              <div>
                <p className="pgm-campo__rotulo" style={{ margin: "0 0 8px" }}>Como repartir o excesso escasso</p>
                <div className="opcoes">
                  <label className="opcao" data-ativo={params.estrategiaDestino === "prioridade" ? "true" : undefined}>
                    <input type="radio" name="estrategia" checked={params.estrategiaDestino === "prioridade"} onChange={() => set({ estrategiaDestino: "prioridade" })} />
                    <div><b>Prioridade estrita</b><span>O primeiro destino leva o que precisar; o último pode ficar sem nada.</span></div>
                  </label>
                  <label className="opcao" data-ativo={params.estrategiaDestino === "nivelar_cobertura" ? "true" : undefined}>
                    <input type="radio" name="estrategia" checked={params.estrategiaDestino === "nivelar_cobertura"} onChange={() => set({ estrategiaDestino: "nivelar_cobertura" })} />
                    <div><b>Nivelar dias de cobertura</b><span>Reparte pelo giro e enche primeiro quem está mais descoberto.</span></div>
                  </label>
                </div>
              </div>
            </div>
          </Secao>

          {/* -------------------- 5. Parâmetros ---------------------- */}
          <Secao
            flush
            id="p5"
            titulo="5 · Parâmetros, embarque e alíquotas por rota"
            desc="O ICMS depende do par origem → destino, por isso a alíquota é por rota."
            right={<Chave ligada={embAtiva} onToggle={(v) => set({ limitesEmbarqueAtivos: v })}>Caixa fechada e mínimos</Chave>}
          >
            <div className="app-card__corpo">
              <div className="campos" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
                <Campo rotulo="Fator de segurança (imediata)" htmlFor="fs" ajuda="Retém venda média × fator antes de liberar a saída de hoje.">
                  <input id="fs" type="number" step="0.1" min="0" value={params.fatorSegurancaImediata} onChange={(e) => set({ fatorSegurancaImediata: Number(e.target.value) })} className="pgm-campo__controle" />
                </Campo>
                <Campo rotulo="Limite de cobertura (dias)" htmlFor="lc" ajuda="Classifica o SKU parado na origem.">
                  <input id="lc" type="number" min="1" value={params.limiteCoberturaDias} onChange={(e) => set({ limiteCoberturaDias: Number(e.target.value) })} className="pgm-campo__controle" />
                </Campo>
                <Campo rotulo="Mínimo por linha (un)" htmlFor="mu" ajuda="Abaixo disso a linha não embarca." style={{ opacity: embAtiva ? 1 : 0.5 }}>
                  <input id="mu" type="number" min="0" disabled={!embAtiva} value={params.minUnidadesLinha} onChange={(e) => set({ minUnidadesLinha: Number(e.target.value) })} className="pgm-campo__controle" />
                </Campo>
                <Campo rotulo="Mínimo por linha (R$)" htmlFor="mv" ajuda="Corta a cauda longa sem valor." style={{ opacity: embAtiva ? 1 : 0.5 }}>
                  <input id="mv" type="number" min="0" step="10" disabled={!embAtiva} value={params.minValorLinha} onChange={(e) => set({ minValorLinha: Number(e.target.value) })} className="pgm-campo__controle" />
                </Campo>
                <Campo rotulo="Carga mínima por rota (R$)" htmlFor="mr" ajuda="Rota abaixo do piso sai do plano inteira." style={{ opacity: embAtiva ? 1 : 0.5 }}>
                  <input id="mr" type="number" min="0" step="100" disabled={!embAtiva} value={params.minValorRota} onChange={(e) => set({ minValorRota: Number(e.target.value) })} className="pgm-campo__controle" />
                </Campo>
                <div style={{ paddingTop: 22, opacity: embAtiva ? 1 : 0.5 }}>
                  <label className="marca">
                    <input type="checkbox" disabled={!embAtiva} checked={params.arredondarCaixaFechada} onChange={(e) => set({ arredondarCaixaFechada: e.target.checked })} />
                    <span>Só caixa fechada<small>Transfere múltiplos da embalagem; o resto fica na origem.</small></span>
                  </label>
                </div>
              </div>

              <hr className="divisor" />
              <div>
                <p className="pgm-campo__rotulo" style={{ margin: "0 0 8px" }}>Resumo da rede</p>
                <div className="parametros">
                  <Badge tom="azul">{params.origens.length} origem(ns)</Badge>
                  <Badge tom="azul">{params.destinos.length} destino(s)</Badge>
                  <Badge>{rotas.length} rota(s)</Badge>
                  <Badge>{modoPedidos ? `Pedidos · ${params.horizonteMeses.length} mês(es)` : "Saldo ideal"}</Badge>
                  {cobAtiva && params.coberturaMaxDestinoDias > 0 && <Badge>Teto {params.coberturaMaxDestinoDias} d</Badge>}
                  {cobAtiva && params.coberturaMinDestinoDias > 0 && <Badge>Piso {params.coberturaMinDestinoDias} d</Badge>}
                  {params.estrategiaDestino === "nivelar_cobertura" && <Badge>Nivelando cobertura</Badge>}
                  {!params.considerarPendenteOrigem && <Badge>Excesso físico</Badge>}
                  {embAtiva && params.arredondarCaixaFechada && <Badge>Caixa fechada</Badge>}
                  {capAtiva && temCapacidade && <Badge tom="warn">Capacidade limitada ({unidadeCap})</Badge>}
                  {!cobAtiva && !embAtiva && !capAtiva && <Badge tom="good">Sem restrições</Badge>}
                </div>
              </div>
            </div>

            {rotas.length > 0 && (
              <>
                <Rolagem>
                  <table className="pgm-tabela">
                    <thead>
                      <tr>
                        <th>Alíquota de ICMS</th>
                        {params.destinos.map((d) => <th key={d} className="pgm-num">→ CD {d}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {params.origens.map((o) => (
                        <tr key={o}>
                          <td><span className="cd">CD {o} →</span></td>
                          {params.destinos.map((d) => {
                            if (o === d) return <td key={d} className="pgm-num" style={{ color: "var(--ink-3)" }}>mesmo CD</td>;
                            const rota = `${o}>${d}`;
                            const v = params.aliquotas[rota];
                            return (
                              <td key={d} className="pgm-num">
                                <span className="aliq" data-vazio={v === undefined ? "true" : undefined}>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="pgm-campo__controle"
                                    placeholder="0,000"
                                    aria-label={`Alíquota CD ${o} para CD ${d}`}
                                    defaultValue={aliquotaTexto(rota)}
                                    key={`${rota}-${aliquotaTexto(rota)}`}
                                    onBlur={(e) => setAliquota(rota, e.target.value)}
                                  />
                                  <small>{v === undefined ? "sem alíquota" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</small>
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Rolagem>
                <div className="app-card__corpo" style={{ paddingTop: 16 }}>
                  <p className="ajuda">Informe em fração: 0,052 = 5,2%. Rotas sem alíquota entram no plano, mas o impacto fiscal fica subestimado; o dashboard avisa.</p>
                </div>
              </>
            )}
          </Secao>

          {/* ------------------ 6. Capacidade operacional -------------- */}
          <Secao
            flush
            id="p6"
            titulo="6 · Capacidade operacional"
            desc="O limite físico da rede na janela desta análise: quanto cada CD expede, quanto recebe e quanto cada rota transporta. Em branco = sem limite."
            right={<Chave ligada={capAtiva} onToggle={(v) => setCap({ ativa: v })}>Limites de capacidade</Chave>}
          >
            <div className="app-card__corpo">
              <div className="campo-linha">
                <Campo rotulo="Métrica" htmlFor="metrica" style={{ minWidth: 240 }}>
                  <select id="metrica" value={cap.metrica} onChange={(e) => setCap({ metrica: e.target.value as MetricaCapacidade })} className="pgm-campo__controle">
                    {METRICAS.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo} ({m.unidade})</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Com capacidade escassa, carrega primeiro" htmlFor="prioridade" style={{ minWidth: 320 }}>
                  <select id="prioridade" value={cap.prioridade} onChange={(e) => setCap({ prioridade: e.target.value as "valor" | "urgencia" })} className="pgm-campo__controle">
                    <option value="valor">O SKU de maior valor</option>
                    <option value="urgencia">O SKU mais urgente no destino</option>
                  </select>
                </Campo>
              </div>

              {metricaAtual?.requer && (
                <Alert tom="info" titulo="Sobre a métrica">
                  <b>{metricaAtual.rotulo}</b> usa a coluna <b>{metricaAtual.requer}</b> da base. SKU sem esse dado não consome capacidade; a análise informa quantos ficaram de fora da conta.
                </Alert>
              )}
              {!capAtiva && temCapacidade && (
                <Alert tom="info" titulo="Limites desligados">Os valores abaixo ficam guardados e voltam a valer quando você religar a chave.</Alert>
              )}

              <div className="opcoes" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 32, opacity: capAtiva ? 1 : 0.5 }}>
                <div className="flex flex-col gap-3">
                  <p className="pgm-campo__rotulo" style={{ margin: 0 }}>Expedição por origem ({unidadeCap})</p>
                  {params.origens.map((cd) => (
                    <div key={cd} className="limite">
                      <b>CD {cd}</b>
                      <input type="number" min="0" placeholder="sem limite" disabled={!capAtiva} value={cap.porOrigem?.[cd] ?? ""} onChange={(e) => setLimite("porOrigem", cd, e.target.value)} className="pgm-campo__controle" aria-label={`Expedição do CD ${cd}`} />
                      <span>separação e embarque</span>
                    </div>
                  ))}
                  {params.origens.length === 0 && <span className="ajuda">Escolha as origens no passo 3.</span>}
                </div>
                <div className="flex flex-col gap-3">
                  <p className="pgm-campo__rotulo" style={{ margin: 0 }}>Recebimento por destino ({unidadeCap})</p>
                  {params.destinos.map((cd) => (
                    <div key={cd} className="limite">
                      <b>CD {cd}</b>
                      <input type="number" min="0" placeholder="sem limite" disabled={!capAtiva} value={cap.porDestino?.[cd] ?? ""} onChange={(e) => setLimite("porDestino", cd, e.target.value)} className="pgm-campo__controle" aria-label={`Recebimento do CD ${cd}`} />
                      <span>docas, conferência, endereços</span>
                    </div>
                  ))}
                  {params.destinos.length === 0 && <span className="ajuda">Escolha os destinos no passo 4.</span>}
                </div>
              </div>

              <hr className="divisor" />
              <label className="marca">
                <input type="checkbox" disabled={!capAtiva} checked={limitarRota} onChange={(e) => setLimitarRota(e.target.checked)} />
                <span>Limitar também o transporte por rota<small>Frota disponível entre cada par de CDs.</small></span>
              </label>
            </div>
            {limitarRota && rotas.length > 0 && (
              <Rolagem>
                <table className="pgm-tabela">
                  <thead>
                    <tr>
                      <th>Transporte ({unidadeCap})</th>
                      {params.destinos.map((d) => <th key={d} className="pgm-num">→ CD {d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {params.origens.map((o) => (
                      <tr key={o}>
                        <td><span className="cd">CD {o} →</span></td>
                        {params.destinos.map((d) => (
                          <td key={d} className="pgm-num">
                            {o === d ? (
                              <span style={{ color: "var(--ink-3)" }}>mesmo CD</span>
                            ) : (
                              <input type="number" min="0" placeholder="sem limite" className="pgm-campo__controle pgm-campo__controle--pequeno" style={{ width: 120, textAlign: "right" }} value={cap.porRota?.[`${o}>${d}`] ?? ""} onChange={(e) => setLimite("porRota", `${o}>${d}`, e.target.value)} aria-label={`Transporte CD ${o} para CD ${d}`} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Rolagem>
            )}
            <div className="app-card__corpo" style={{ paddingTop: 16 }}>
              <p className="ajuda">Os três limites valem ao mesmo tempo, e o menor deles é o gargalo. Sugestões já aprovadas e não faturadas <b>ocupam capacidade</b>, porque a doca e a frota já estão comprometidas com elas. O dashboard mostra a utilização e o que ficou barrado.</p>
            </div>
          </Secao>

          {/* ---------------------- Histórico ------------------------ */}
          {log.length > 0 && (
            <Secao flush titulo="Histórico de importações" desc="Auditoria das bases carregadas nesta instância">
              <Rolagem>
                <table className="pgm-tabela">
                  <thead>
                    <tr><th>Quando</th><th>Quem</th><th>Arquivos</th><th className="pgm-num">Base</th><th className="pgm-num">Pedidos</th><th>CDs</th></tr>
                  </thead>
                  <tbody>
                    {log.slice(0, 8).map((l) => (
                      <tr key={l.id}>
                        <td>{new Date(l.em).toLocaleString("pt-BR")}</td>
                        <td>{l.por}</td>
                        <td className="prod" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{l.origem}</td>
                        <td className="pgm-num">{fmtInt(l.baseLinhas)}</td>
                        <td className="pgm-num">{fmtInt(l.pedidosLinhas)}</td>
                        <td>{l.cds.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Rolagem>
            </Secao>
          )}

          <div className="barra-acao">
            <p className="barra-acao__resumo">
              <b>{podeRodar ? "Pronto para rodar:" : "Ainda falta:"}</b>{" "}
              {podeRodar
                ? `${params.origens.length} origem(ns) → ${params.destinos.length} destino(s), ${rotas.length} rota(s), ${modoPedidos ? "pedidos" : "saldo ideal"}${cobAtiva && params.coberturaMaxDestinoDias > 0 ? `, teto ${params.coberturaMaxDestinoDias} d` : ""}${capAtiva && temCapacidade ? `, capacidade em ${unidadeCap}` : ""}.`
                : [!dataset.pronto && "importar a base", params.origens.length === 0 && "escolher as origens", params.destinos.length === 0 && "escolher os destinos"].filter(Boolean).join(", ") + "."}
              {rotasSemAliquota.length > 0 && <> <b>{rotasSemAliquota.length} rota(s) sem alíquota.</b></>}
            </p>
            {rotasSemAliquota.length > 0 && <a href="#p5" className="pgm-botao pgm-botao--secundario">Informar alíquota</a>}
            <Rodar />
          </div>

          <Fonte>
            Fonte: {dataset.fonteBase || "base de CDs importada"}{dataBase && ` · posição de estoque de ${dataBase}`}{dataset.demo && " · base de demonstração (sintética)"}.
          </Fonte>
        </div>
      </div>
    </>
  );
}

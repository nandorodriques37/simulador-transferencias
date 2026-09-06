import { calcularRede, indexarPedidos } from "@/lib/engine/calc";
import {
  Compromissos,
  compromissosVazios,
  LinhaBase,
  ParametrosRede,
  PedidoProjetado,
  ResultadoRede,
} from "@/lib/engine/types";
import { parametrosPadrao } from "@/lib/data/defaults";
import { gerarBaseDemo } from "@/lib/data/seed";
import { RelatorioQualidade } from "@/lib/data/validate";
import { carteira } from "@/lib/store/carteira";
import { analisesStore } from "@/lib/store/analises";
import { DatasetSalvo, repositorio } from "@/lib/store/repositorio";
import { agregarRotas, calcularKpis } from "@/lib/query/aggregate";

/** Uma análise rodada (snapshot completo do resultado). */
export interface Analise {
  id: string;
  label: string;
  criadoEm: string;
  criadoPor: string;
  paramsHash: string;
  parametros: ParametrosRede;
  fonteBase: string;
  fontePedidos: string;
  compromissos: { origens: number; destinos: number }; // pares descontados
  resultado: ResultadoRede;
}

export interface ImportLogItem {
  id: string;
  em: string;
  por: string;
  origem: string;
  baseLinhas: number;
  pedidosLinhas: number;
  cds: number[];
  relatorio: RelatorioQualidade;
}

interface EstadoStore {
  base: LinhaBase[];
  pedidos: PedidoProjetado[];
  fonteBase: string;
  fontePedidos: string;
  importedEm: string;
  /** Dataset carregado nesta instância (vindo do repositório). */
  datasetId: string;
  parametros: ParametrosRede;
  analises: Analise[];
  importLog: ImportLogItem[];
  seq: number;
}

/**
 * Máximo de análises mantidas em memória (a mais antiga é descartada).
 *
 * Cada análise carrega o plano inteiro: numa rede de 11 CDs × 80 mil produtos
 * são ~240 mil linhas, cerca de 150 MB. Guardar muitas versões estoura a
 * memória da função serverless — por isso o histórico vive de 2, o suficiente
 * para comparar a rodada atual com a anterior.
 */
const MAX_ANALISES = 2;

export function hashParams(p: ParametrosRede): string {
  const s = JSON.stringify({
    modo: p.modoDemanda,
    ori: p.origens,
    dst: p.destinos,
    meses: p.horizonteMeses,
    aliq: Object.entries(p.aliquotas).sort(),
    fs: p.fatorSegurancaImediata,
    lim: p.limiteCoberturaDias,
    apr: p.considerarAprovadas,
  });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

const nowIso = () => new Date().toISOString();

/**
 * Sufixo curto e estável por instância. O contador `a1, a2…` é legível, mas
 * duas instâncias começariam do mesmo número e sobrescreveriam o resultado uma
 * da outra no armazenamento — o sufixo garante a unicidade sem perder a leitura.
 */
const SUFIXO_INSTANCIA = Math.random().toString(36).slice(2, 6);
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// Singleton por instância (sobrevive a HMR e a múltiplas rotas na mesma lambda).
const g = globalThis as unknown as { __transfStore?: EstadoStore };

/**
 * Em produção o estado começa VAZIO, nunca com a base de demonstração.
 *
 * O motivo é de segurança de dados: como o estado vive na memória da instância,
 * uma requisição pode cair numa instância nova que nunca viu a importação. Se
 * ela respondesse com a base sintética, o usuário veria números plausíveis e
 * falsos. Vazio é honesto — a tela pede a importação.
 *
 * Para avaliar o app com dados de exemplo em produção, defina `DEMO_DATA=1`.
 */
function usarDemo(): boolean {
  if (process.env.DEMO_DATA === "1") return true;
  if (process.env.DEMO_DATA === "0") return false;
  return process.env.NODE_ENV !== "production";
}

function bootstrap(): EstadoStore {
  const parametros = parametrosPadrao();
  if (!usarDemo()) {
    return {
      base: [],
      pedidos: [],
      fonteBase: "",
      fontePedidos: "",
      importedEm: "",
      datasetId: "",
      parametros,
      analises: [],
      importLog: [],
      seq: 0,
    };
  }
  const demo = gerarBaseDemo();
  return {
    base: demo.base,
    pedidos: demo.pedidos,
    fonteBase: "Base de demonstração (sintética, todos os CDs)",
    fontePedidos: "Pedidos de demonstração (sintéticos)",
    importedEm: nowIso(),
    datasetId: "",
    parametros: ajustarParametrosAosCds(parametros, demo.cds),
    analises: [],
    importLog: [],
    seq: 0,
  };
}

function getState(): EstadoStore {
  if (!g.__transfStore) g.__transfStore = bootstrap();
  return g.__transfStore;
}

/**
 * Mantém as sequências coerentes com os CDs realmente presentes na base:
 * remove CDs inexistentes e completa os destinos com os que sobraram.
 */
export function ajustarParametrosAosCds(p: ParametrosRede, cds: number[]): ParametrosRede {
  if (cds.length === 0) return p;
  const set = new Set(cds);
  const origens = p.origens.filter((c) => set.has(c));
  const destinos = p.destinos.filter((c) => set.has(c));
  return {
    ...p,
    origens: origens.length ? origens : [cds[0]],
    destinos: destinos.length ? destinos : cds.filter((c) => c !== (origens[0] ?? cds[0])),
  };
}

/** CDs presentes na base, ordenados. */
export function cdsDaBase(base: LinhaBase[]): number[] {
  return Array.from(new Set(base.map((l) => l.cd))).sort((a, b) => a - b);
}

// ------------------------- API pública do store ---------------------------

export const store = {
  getDataset() {
    const st = getState();
    const cds = cdsDaBase(st.base);
    return {
      /** `false` quando ainda não há base nesta instância (pede importação). */
      pronto: st.base.length > 0,
      demo: usarDemo() && st.importLog.length === 0,
      baseLinhas: st.base.length,
      pedidosLinhas: st.pedidos.length,
      produtos: new Set(st.base.map((l) => l.codigoProduto)).size,
      cds,
      fonteBase: st.fonteBase,
      fontePedidos: st.fontePedidos,
      importedEm: st.importedEm,
      mesesPedidos: Array.from(new Set(st.pedidos.map((p) => p.anoMes))).sort(),
    };
  },

  getBase(): LinhaBase[] {
    return getState().base;
  },
  getPedidos(): PedidoProjetado[] {
    return getState().pedidos;
  },

  /**
   * Garante que esta instância tem a base carregada.
   *
   * O estado vive na memória da função, mas o insumo está no repositório: se a
   * requisição caiu numa instância fria, a base é reconstruída de lá em poucos
   * segundos, sem novo upload. Devolve `false` quando não há nada guardado.
   */
  async ensureBase(): Promise<boolean> {
    const st = getState();
    if (st.base.length > 0) return true;
    const atual = await repositorio.atual();
    if (!atual) return false;
    const dados = await repositorio.carregar(atual.id);
    if (!dados) return false;
    st.base = dados.base;
    st.pedidos = dados.pedidos;
    st.fonteBase = atual.fonteBase;
    st.fontePedidos = atual.fontePedidos;
    st.importedEm = atual.criadoEm;
    st.datasetId = atual.id;
    st.parametros = ajustarParametrosAosCds(st.parametros, atual.cds);
    return true;
  },

  /** Metadados do insumo guardado (sem carregá-lo). */
  async datasetSalvo(): Promise<DatasetSalvo | null> {
    return repositorio.atual();
  },

  async setDataset(
    base: LinhaBase[] | null,
    pedidos: PedidoProjetado[] | null,
    fonteBase: string,
    fontePedidos: string,
    por: string,
    relatorio: RelatorioQualidade,
  ): Promise<ImportLogItem> {
    const st = getState();
    if (base) {
      st.base = base;
      st.fonteBase = fonteBase;
    }
    if (pedidos) {
      st.pedidos = pedidos;
      st.fontePedidos = fontePedidos;
    }
    st.importedEm = nowIso();
    const cds = cdsDaBase(st.base);
    st.parametros = ajustarParametrosAosCds(st.parametros, cds);

    // Guarda o insumo fora da memória para as próximas instâncias.
    try {
      const salvo = await repositorio.salvar(st.base, st.pedidos, {
        criadoPor: por,
        fonteBase: st.fonteBase,
        fontePedidos: st.fontePedidos,
      });
      st.datasetId = salvo.id;
    } catch (e) {
      // Falha no armazenamento não pode derrubar a importação: o app segue com
      // a base em memória e a tela avisa que ela não é durável.
      console.error("[store] falha ao guardar o dataset:", (e as Error).message);
    }

    const log: ImportLogItem = {
      id: uid("imp"),
      em: nowIso(),
      por,
      origem: [base ? fonteBase : null, pedidos ? fontePedidos : null].filter(Boolean).join(" + "),
      baseLinhas: st.base.length,
      pedidosLinhas: st.pedidos.length,
      cds,
      relatorio,
    };
    st.importLog.unshift(log);
    return log;
  },

  getParametros(): ParametrosRede {
    return getState().parametros;
  },

  setParametros(p: ParametrosRede): ParametrosRede {
    const st = getState();
    st.parametros = ajustarParametrosAosCds(p, cdsDaBase(st.base));
    return st.parametros;
  },

  /**
   * Roda uma análise completa e guarda o snapshot.
   * Os compromissos (sugestões aprovadas ainda não faturadas) entram no cálculo
   * quando `parametros.considerarAprovadas` está ligado.
   */
  async rodarAnalise(params: ParametrosRede, por: string, label: string, idExistente?: string): Promise<Analise> {
    const st = getState();
    st.parametros = params;
    const compromissos: Compromissos = params.considerarAprovadas
      ? await carteira.compromissos()
      : compromissosVazios();
    const idx = indexarPedidos(st.pedidos);
    const resultado = calcularRede(st.base, idx, params, compromissos);
    const analise: Analise = {
      // `idExistente` chega quando a tela recalcula uma análise cujo detalhe
      // saiu da memória: o resultado é o mesmo, então mantém o mesmo id.
      id: idExistente || `a${++st.seq}-${SUFIXO_INSTANCIA}`,
      label,
      criadoEm: nowIso(),
      criadoPor: por,
      paramsHash: hashParams(params),
      parametros: params,
      fonteBase: st.fonteBase,
      fontePedidos: st.fontePedidos,
      compromissos: { origens: compromissos.saidaOrigem.size, destinos: compromissos.entradaDestino.size },
      resultado,
    };
    st.analises.push(analise);
    while (st.analises.length > MAX_ANALISES) st.analises.shift();

    // Persiste o RESULTADO (parâmetros, KPIs e resumos). O plano linha a linha
    // fica só nesta instância — é material de trabalho da sessão.
    try {
      const rotas = agregarRotas(resultado.linhas, params, resultado.rotas);
      await analisesStore.salvar({
        id: analise.id,
        criadoEm: analise.criadoEm,
        criadoPor: analise.criadoPor,
        label: analise.label,
        datasetId: st.datasetId,
        fonteBase: st.fonteBase,
        parametros: params,
        kpis: calcularKpis(resultado.linhas, rotas, {
          excessoDisponivelRs: resultado.meta.excessoDisponivelRs,
          necessidadeTotalRs: resultado.meta.necessidadeTotalRs,
        }),
        rotas: resultado.rotas,
        origens: resultado.origens,
        destinos: resultado.destinos,
        reconciliacao: resultado.reconciliacao,
        meses: resultado.meta.meses,
        tempoMs: resultado.meta.tempoMs,
      });
    } catch (e) {
      console.error("[store] falha ao salvar o resultado da análise:", (e as Error).message);
    }
    return analise;
  },

  listAnalises(): Omit<Analise, "resultado">[] {
    return getState()
      .analises.map(({ resultado: _r, ...a }) => a)
      .reverse();
  },

  getAnalise(id?: string): Analise | undefined {
    const st = getState();
    if (!id) return st.analises[st.analises.length - 1];
    return st.analises.find((a) => a.id === id);
  },

  getAnaliseAtual(): Analise | undefined {
    const st = getState();
    return st.analises[st.analises.length - 1];
  },

  getImportLog(): ImportLogItem[] {
    return getState().importLog;
  },
};

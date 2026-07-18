import { calcular, indexarPedidos } from "@/lib/engine/calc";
import { Parametros, PedidoProjetado, PosicaoEstoque, ResultadoCalculo } from "@/lib/engine/types";
import { parametrosPadrao } from "@/lib/data/defaults";
import { gerarBaseDemo } from "@/lib/data/seed";
import { RelatorioQualidade } from "@/lib/data/validate";

export interface CalcVersion {
  id: string;
  label: string;
  criadoEm: string;
  criadoPor: string;
  paramsHash: string;
  parametros: Parametros;
  datasetSource: string;
  resultado: ResultadoCalculo;
}

export interface ParamHistoricoItem {
  version: number;
  criadoEm: string;
  criadoPor: string;
  parametros: Parametros;
  hash: string;
}

export interface Cenario {
  id: string;
  nome: string;
  criadoEm: string;
  criadoPor: string;
  parametros: Parametros;
  baseVersionId: string;
}

export interface ImportLogItem {
  id: string;
  em: string;
  por: string;
  origem: string;
  posicaoLinhas: number;
  pedidosLinhas: number;
  relatorio: RelatorioQualidade;
}

export interface Aprovacao {
  chave: string; // `${cdDestino}:${idSku}`
  versionId: string;
  aprovadoPor: string;
  aprovadoEm: string;
}

interface EstadoStore {
  posicao: PosicaoEstoque[];
  pedidos: PedidoProjetado[];
  datasetSource: string;
  importedEm: string;
  parametros: Parametros;
  paramHistorico: ParamHistoricoItem[];
  versoes: CalcVersion[];
  cenarios: Cenario[];
  aprovacoes: Map<string, Aprovacao>;
  importLog: ImportLogItem[];
  seq: number;
}

export function hashParams(p: Parametros): string {
  const s = JSON.stringify({
    origem: p.cdOrigem,
    cds: p.prioridadeCds,
    meses: p.horizonteMeses,
    aliq: Object.entries(p.aliquotaFiscal).sort(),
    fs: p.fatorSegurancaImediata,
    lim: p.limiteCoberturaDias,
  });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

const nowIso = () => new Date().toISOString();
const uid = (prefixo: string) => `${prefixo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// Singleton por instância (sobrevive a HMR e a múltiplas rotas na mesma lambda).
const g = globalThis as unknown as { __transfStore?: EstadoStore };

function bootstrap(): EstadoStore {
  const { posicao, pedidos } = gerarBaseDemo();
  const parametros = parametrosPadrao();
  const st: EstadoStore = {
    posicao,
    pedidos,
    datasetSource: "Base de demonstração (sintética)",
    importedEm: nowIso(),
    parametros,
    paramHistorico: [
      { version: 1, criadoEm: nowIso(), criadoPor: "sistema", parametros, hash: hashParams(parametros) },
    ],
    versoes: [],
    cenarios: [],
    aprovacoes: new Map(),
    importLog: [],
    seq: 0,
  };
  // Roda a primeira versão de cálculo (versão base).
  runCalcInterno(st, parametros, "sistema", "Cálculo base");
  return st;
}

function getState(): EstadoStore {
  if (!g.__transfStore) g.__transfStore = bootstrap();
  return g.__transfStore;
}

function runCalcInterno(st: EstadoStore, params: Parametros, por: string, label: string): CalcVersion {
  const idx = indexarPedidos(st.pedidos);
  const resultado = calcular(st.posicao, idx, params);
  const versao: CalcVersion = {
    id: `v${++st.seq}`,
    label,
    criadoEm: nowIso(),
    criadoPor: por,
    paramsHash: hashParams(params),
    parametros: params,
    datasetSource: st.datasetSource,
    resultado,
  };
  st.versoes.push(versao);
  return versao;
}

// ------------------------- API pública do store ---------------------------

export const store = {
  getDataset() {
    const st = getState();
    return {
      posicaoLinhas: st.posicao.length,
      pedidosLinhas: st.pedidos.length,
      origem: st.datasetSource,
      importedEm: st.importedEm,
    };
  },

  getPosicao(): PosicaoEstoque[] {
    return getState().posicao;
  },
  getPedidos(): PedidoProjetado[] {
    return getState().pedidos;
  },

  setDataset(posicao: PosicaoEstoque[], pedidos: PedidoProjetado[], origem: string, por: string, relatorio: RelatorioQualidade): ImportLogItem {
    const st = getState();
    st.posicao = posicao;
    st.pedidos = pedidos;
    st.datasetSource = origem;
    st.importedEm = nowIso();
    const log: ImportLogItem = {
      id: uid("imp"),
      em: nowIso(),
      por,
      origem,
      posicaoLinhas: posicao.length,
      pedidosLinhas: pedidos.length,
      relatorio,
    };
    st.importLog.unshift(log);
    // Nova base => novo cálculo (versão) mantendo os parâmetros atuais.
    runCalcInterno(st, st.parametros, por, `Importação: ${origem}`);
    return log;
  },

  getParametros(): Parametros {
    return getState().parametros;
  },

  updateParametros(params: Parametros, por: string): { version: number; parametros: Parametros } {
    const st = getState();
    st.parametros = params;
    const version = st.paramHistorico.length + 1;
    st.paramHistorico.unshift({ version, criadoEm: nowIso(), criadoPor: por, parametros: params, hash: hashParams(params) });
    // Toda mudança de parâmetro gera nova versão de cálculo (nunca sobrescreve).
    runCalcInterno(st, params, por, `Parâmetros v${version}`);
    return { version, parametros: params };
  },

  getParamHistorico(): ParamHistoricoItem[] {
    return getState().paramHistorico;
  },

  runCalc(por = "sistema", label = "Recálculo manual"): CalcVersion {
    const st = getState();
    return runCalcInterno(st, st.parametros, por, label);
  },

  listVersoes(): Omit<CalcVersion, "resultado">[] {
    return getState().versoes.map(({ resultado, ...v }) => ({
      ...v,
      // resumo leve
    })).reverse();
  },

  getVersao(id?: string): CalcVersion | undefined {
    const st = getState();
    if (!id) return st.versoes[st.versoes.length - 1];
    return st.versoes.find((v) => v.id === id);
  },

  getVersaoAtual(): CalcVersion {
    const st = getState();
    return st.versoes[st.versoes.length - 1];
  },

  // Simulador: calcula um cenário (sem persistir versão) para comparação.
  simular(params: Parametros): ResultadoCalculo {
    const st = getState();
    return calcular(st.posicao, indexarPedidos(st.pedidos), params);
  },

  salvarCenario(nome: string, params: Parametros, por: string): Cenario {
    const st = getState();
    const cen: Cenario = {
      id: uid("cen"),
      nome,
      criadoEm: nowIso(),
      criadoPor: por,
      parametros: params,
      baseVersionId: st.versoes[st.versoes.length - 1]?.id ?? "",
    };
    st.cenarios.unshift(cen);
    return cen;
  },

  listCenarios(): Cenario[] {
    return getState().cenarios;
  },

  // Aprovações (por versão + linha).
  aprovar(versionId: string, chaves: string[], por: string, aprovado: boolean): number {
    const st = getState();
    for (const chave of chaves) {
      const k = `${versionId}:${chave}`;
      if (aprovado) st.aprovacoes.set(k, { chave, versionId, aprovadoPor: por, aprovadoEm: nowIso() });
      else st.aprovacoes.delete(k);
    }
    return chaves.length;
  },

  getAprovacoes(versionId: string): Aprovacao[] {
    const st = getState();
    return Array.from(st.aprovacoes.values()).filter((a) => a.versionId === versionId);
  },

  isAprovada(versionId: string, chave: string): Aprovacao | undefined {
    return getState().aprovacoes.get(`${versionId}:${chave}`);
  },

  getImportLog(): ImportLogItem[] {
    return getState().importLog;
  },
};

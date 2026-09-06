// ---------------------------------------------------------------------------
// Modelo de dados do motor de transferências entre CDs — REDE MULTI-ORIGEM.
//
// Conceito (v2):
//   * UMA base única com TODOS os CDs (mesmo layout da antiga base de origem).
//     Cada linha (cd × produto) é ao mesmo tempo candidata a ORIGEM (pelo que
//     sobra) e a DESTINO (pelo que falta).
//   * UMA base de pedidos projetados (opcional), usada quando a análise roda no
//     modo "pedidos".
//   * O usuário escolhe a SEQUÊNCIA de origens e a SEQUÊNCIA de destinos. Cada
//     origem, na ordem, olha todos os destinos selecionados, na ordem.
//
// Nenhum parâmetro de negócio é fixado em código: tudo vem de `ParametrosRede`.
// ---------------------------------------------------------------------------

/** 1 linha por (CD, produto) da BASE ÚNICA de posição de estoque. */
export interface LinhaBase {
  idSku: string; // `${cd}-${codigoProduto}`
  cd: number; // CD ao qual a linha pertence (origem e/ou destino)
  codigoProduto: number; // sem dígito verificador
  produto: string;
  estoqueDisponivel: number;
  estoqueObjetivo: number;
  quantidadePendente: number;
  vendaMedia3m: number;
  custoReposicao: number; // PRDP_VL_CMPCSICMS
  precoLista: number; // fallback quando custoReposicao == 0
  embCompra: number; // unidades por caixa
  fornecedor: string;
  comprador: string;
  analista: string;
  categoriaN1: string;
  categoriaN2: string;
  categoriaN3: string;
  categoriaN4: string;
  flagAme?: string;
  monitorado?: string;
  marcaPropria?: string;
  leadTime?: number;
}

/** 1 linha por (ano_mes, cd_destino, codigo_produto). Base de PEDIDOS. */
export interface PedidoProjetado {
  anoMes: string; // 'AAAA_MM'
  cdDestino: number;
  codigoProduto: number;
  pedido: number;
}

/** 1 linha da base de FATURAMENTO (transferências já realizadas). */
export interface LinhaFaturamento {
  cdOrigem: number;
  cdDestino: number;
  codigoProduto: number;
  quantidade: number;
  documento?: string;
  data?: string;
}

/**
 * Fonte da demanda do CD destino:
 * - "saldo_ideal": o que falta para o estoque objetivo do destino
 *   (`objetivo − disponível − pendente`). Não usa a base de pedidos.
 * - "pedidos": os pedidos projetados do destino, mês a mês (DRP puro).
 */
export type ModoDemanda = "saldo_ideal" | "pedidos";

/** Parâmetros de uma análise de rede. */
export interface ParametrosRede {
  modoDemanda: ModoDemanda;
  /** CDs de origem NA ORDEM em que devem ser analisados. */
  origens: number[];
  /** CDs de destino NA ORDEM de prioridade de atendimento. */
  destinos: number[];
  /** Horizonte (AAAA_MM) — usado apenas no modo "pedidos". */
  horizonteMeses: string[];
  /** Alíquota fiscal por rota `origem>destino` (fração: 0.052 = 5,2%). */
  aliquotas: Record<string, number>;
  fatorSegurancaImediata: number; // ex.: 0.5
  limiteCoberturaDias: number; // ex.: 90
  /** Descontar as sugestões já aprovadas e ainda não faturadas. */
  considerarAprovadas: boolean;
}

/** Chave de rota origem→destino. */
export function chaveRota(cdOrigem: number, cdDestino: number): string {
  return `${cdOrigem}>${cdDestino}`;
}

/** Chave (cd, produto). */
export function chaveCdProduto(cd: number, codigoProduto: number): string {
  return `${cd}|${codigoProduto}`;
}

/** Chave (mês, cd, produto). */
export function chavePedido(anoMes: string, cd: number, codigoProduto: number): string {
  return `${anoMes}|${cd}|${codigoProduto}`;
}

/** Índice de pedidos: `${anoMes}|${cd}|${produto}` -> quantidade. */
export type PedidosIndex = Map<string, number>;

/**
 * Saldos já comprometidos por sugestões APROVADAS e ainda não faturadas.
 * Enquanto o faturamento não acontece, a base ainda não reflete a movimentação:
 * o app desconta o saldo da origem e trata o volume como trânsito no destino.
 */
export interface Compromissos {
  /** `${cd}|${produto}` -> unidades já comprometidas para SAIR daquele CD. */
  saidaOrigem: Map<string, number>;
  /** `${cd}|${produto}` -> unidades já a caminho daquele CD (trânsito). */
  entradaDestino: Map<string, number>;
}

export function compromissosVazios(): Compromissos {
  return { saidaOrigem: new Map(), entradaDestino: new Map() };
}

/** Uma linha do plano: rota (origem → destino) × SKU, com transferência > 0. */
export interface LinhaPlano {
  cdOrigem: number;
  cdDestino: number;
  rota: string; // `${cdOrigem}>${cdDestino}`
  idSku: string; // `${cdOrigem}-${codigoProduto}`
  codigoProduto: number;
  produto: string;
  fornecedor: string;
  comprador: string;
  analista: string;
  categoriaN1: string;
  categoriaN2: string;
  categoriaN3: string;
  categoriaN4: string;
  precoUnitario: number;
  embCompra: number;
  /** Modo "pedidos": demanda e transferência por mês (ordem do horizonte). */
  demandaMes: number[];
  transfMes: number[];
  /** Modo "saldo_ideal": demanda e transferência únicas (sem quebra mensal). */
  demandaSaldo: number;
  transfSaldo: number;
  transfTotal: number; // unidades (meses + saldo)
  valorTotal: number; // R$
  caixas: number; // transfTotal / emb (arredondado)
  qtdImediata: number; // unidades que podem sair hoje (antes da caixa fechada)
  imediataCaixas: number; // caixas fechadas
  qtdImediataArredondada: number; // caixas * emb
  valorImediata: number; // R$
  coberturaDias: number; // cobertura do SKU no CD de origem
  statusCobertura: string;
  aliquota: number;
  impactoFiscal: number; // valorTotal * aliquota
}

/** Agregado por rota (origem → destino). */
export interface ResumoRota {
  cdOrigem: number;
  cdDestino: number;
  rota: string;
  aliquota: number;
  aliquotaDefinida: boolean;
  qtdMes: number[];
  valorMes: number[];
  qtd: number;
  valor: number;
  qtdImediata: number;
  valorImediata: number;
  impactoFiscal: number;
  linhas: number;
}

/** Agregado por CD de origem (o quanto cada origem conseguiu escoar). */
export interface ResumoOrigem {
  cd: number;
  ordem: number; // posição na sequência de análise
  excessoQtd: number; // excesso transferível disponível (após aprovadas)
  excessoRs: number;
  transferidoQtd: number;
  transferidoRs: number;
  sobraQtd: number;
  sobraRs: number;
  skusComExcesso: number;
}

/** Agregado por CD de destino (o quanto da necessidade foi coberto). */
export interface ResumoDestino {
  cd: number;
  ordem: number; // posição na sequência de prioridade
  necessidadeQtd: number; // demanda considerada (após trânsito aprovado)
  necessidadeRs: number;
  atendidoQtd: number;
  atendidoRs: number;
  aberto: number; // necessidade não atendida (qtd)
  cobertura: number; // atendidoQtd / necessidadeQtd (0..1)
}

export interface Reconciliacao {
  skusBase: number;
  produtosDistintos: number;
  paresOrigemProduto: number;
  invarianteOk: boolean; // nenhuma origem transferiu mais que seu excesso,
  // nenhum destino recebeu mais que sua necessidade
  maiorDivergencia: number;
  autoTransferencias: number; // deve ser sempre 0 (origem == destino)
}

export interface ResultadoRede {
  linhas: LinhaPlano[];
  rotas: ResumoRota[];
  origens: ResumoOrigem[];
  destinos: ResumoDestino[];
  reconciliacao: Reconciliacao;
  meta: {
    modoDemanda: ModoDemanda;
    meses: string[]; // vazio no modo saldo_ideal
    sequenciaOrigens: number[];
    sequenciaDestinos: number[];
    excessoDisponivelRs: number; // excesso das origens selecionadas
    excessoUtilizadoRs: number; // parte do excesso efetivamente transferida
    necessidadeTotalRs: number; // demanda dos destinos selecionados
    necessidadeAtendidaRs: number;
    valorTransfTotal: number;
    valorImediataTotal: number;
    impactoFiscalTotal: number;
    qtdTransfTotal: number;
    linhasPlano: number;
    skusDistintos: number;
    tempoMs: number;
    rotasSemAliquota: string[]; // rotas com transferência e sem alíquota definida
  };
}

/** Filtro Total vs. cobertura crítica (SKUs parados na origem). */
export type FiltroCobertura = "total" | "acima_limite";

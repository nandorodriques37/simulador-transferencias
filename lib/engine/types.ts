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
  /** Unidades por palete — usado quando a capacidade é medida em paletes. */
  unidadesPorPalete?: number;
  /** Peso unitário (kg) — usado quando a capacidade é medida em peso. */
  pesoUnitario?: number;
  /** Cubagem unitária (m³) — usada quando a capacidade é medida em volume. */
  cubagemUnitaria?: number;
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

/**
 * Como o excesso é dividido quando ele não cobre todos os destinos:
 * - "prioridade": ordem estrita — o destino 1 é atendido por inteiro antes do 2;
 * - "nivelar_cobertura": distribui de forma a igualar os DIAS DE COBERTURA dos
 *   destinos (water-filling), evitando que o último da fila fique em ruptura.
 */
export type EstrategiaDestino = "prioridade" | "nivelar_cobertura";

/**
 * Unidade em que a capacidade operacional é medida. O motor converte cada
 * unidade transferida para essa métrica usando os dados do próprio SKU:
 *
 * | métrica    | fator por unidade transferida        | vem de              |
 * |------------|--------------------------------------|---------------------|
 * | unidades   | 1                                    | —                   |
 * | caixas     | 1 / embalagem de compra              | `embCompra`         |
 * | paletes    | 1 / unidades por palete              | `unidadesPorPalete` |
 * | peso       | peso unitário (kg)                   | `pesoUnitario`      |
 * | volume     | cubagem unitária (m³)                | `cubagemUnitaria`   |
 * | valor      | preço unitário (R$)                  | custo/preço         |
 *
 * SKU sem o dado da métrica escolhida não consome capacidade (e o resultado
 * informa quantos SKUs ficaram nessa situação).
 */
export type MetricaCapacidade = "unidades" | "caixas" | "paletes" | "peso" | "volume" | "valor";

/**
 * Quando a capacidade é escassa, qual SKU carrega primeiro:
 * - "valor": o de maior valor de excesso (maximiza R$ escoado);
 * - "urgencia": o de menor cobertura no destino (reduz risco de ruptura).
 */
export type PrioridadeCapacidade = "valor" | "urgencia";

/**
 * Capacidade operacional da rede — o limite físico de quanto cada CD consegue
 * EXPEDIR e RECEBER, e de quanto cada rota consegue transportar na janela da
 * análise. Zero (ou ausente) significa sem limite.
 */
export interface CapacidadeRede {
  /** Chave geral: `false` ignora todos os limites sem apagar os valores. */
  ativa: boolean;
  metrica: MetricaCapacidade;
  /** Limite de expedição por CD de origem (separação e embarque). */
  porOrigem: Record<number, number>;
  /** Limite de recebimento por CD de destino (docas, conferência, endereços). */
  porDestino: Record<number, number>;
  /** Limite de transporte por rota `origem>destino` (frota disponível). */
  porRota: Record<string, number>;
  /** Ordem em que os SKUs consomem a capacidade escassa. */
  prioridade: PrioridadeCapacidade;
}

export function capacidadeVazia(): CapacidadeRede {
  return { ativa: true, metrica: "unidades", porOrigem: {}, porDestino: {}, porRota: {}, prioridade: "valor" };
}

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

  // --- Oferta da origem ---------------------------------------------------
  /**
   * Somar a quantidade pendente ao excesso da origem.
   * `true` (padrão): excesso de planejamento — conta o que ainda vai entrar.
   * `false`: excesso FÍSICO — só o que já está no CD pode ser oferecido.
   */
  considerarPendenteOrigem: boolean;

  // --- Necessidade do destino ---------------------------------------------
  /** Chave geral do teto/piso de cobertura (`false` ignora sem apagar). */
  limitesCoberturaAtivos: boolean;
  /**
   * Teto de cobertura do destino, em dias (0 = sem teto). Limita a necessidade
   * a `venda_dia × dias − (disponível + pendente + trânsito)`. Protege contra
   * estoque objetivo inflado e contra antecipar meses de pedido.
   */
  coberturaMaxDestinoDias: number;
  /**
   * Piso de cobertura do destino, em dias (0 = sem piso). Garante a demanda
   * mínima antirruptura mesmo quando o estoque objetivo está defasado ou zerado.
   */
  coberturaMinDestinoDias: number;
  /** Como repartir o excesso entre os destinos. */
  estrategiaDestino: EstrategiaDestino;

  // --- Materialidade e logística ------------------------------------------
  /** Chave geral da caixa fechada e dos mínimos (`false` ignora sem apagar). */
  limitesEmbarqueAtivos: boolean;
  /** Transferir apenas múltiplos da embalagem de compra (caixa fechada). */
  arredondarCaixaFechada: boolean;
  /** Mínimo de unidades para a transferência de uma linha valer a pena. */
  minUnidadesLinha: number;
  /** Mínimo em R$ para a transferência de uma linha valer a pena. */
  minValorLinha: number;
  /** Mínimo em R$ para a ROTA inteira entrar no plano (carga mínima). */
  minValorRota: number;

  // --- Capacidade operacional ---------------------------------------------
  /** Limites de expedição, recebimento e transporte. */
  capacidade: CapacidadeRede;
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
  /**
   * `${origem}>${destino}|${produto}` -> unidades já aprovadas naquela rota.
   * Usado para debitar a capacidade operacional já comprometida.
   */
  rotaProduto: Map<string, number>;
}

export function compromissosVazios(): Compromissos {
  return { saidaOrigem: new Map(), entradaDestino: new Map(), rotaProduto: new Map() };
}

/** Chave (rota, produto) usada nos compromissos. */
export function chaveRotaProduto(cdOrigem: number, cdDestino: number, codigoProduto: number): string {
  return `${cdOrigem}>${cdDestino}|${codigoProduto}`;
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
  /** Unidades que a demanda pedia e a caixa fechada não permitiu enviar. */
  perdaCaixaFechada: number;
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
  /** Capacidade de transporte da rota: limite, comprometido e usado. */
  capacidadeLimite: number;
  capacidadeComprometida: number;
  capacidadeUsada: number;
  bloqueadoPorCapacidade: number;
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
  /** Capacidade de expedição: limite, já comprometido e usado nesta análise. */
  capacidadeLimite: number;
  capacidadeComprometida: number;
  capacidadeUsada: number;
  /** Unidades que a demanda pedia e a capacidade de expedição barrou. */
  bloqueadoPorCapacidade: number;
}

/** Agregado por CD de destino (o quanto da necessidade foi coberto). */
export interface ResumoDestino {
  cd: number;
  ordem: number; // posição na sequência de prioridade
  /** Demanda crua da base/pedidos, antes de teto e piso de cobertura. */
  necessidadeBrutaQtd: number;
  necessidadeQtd: number; // demanda considerada (após trânsito, teto e piso)
  necessidadeRs: number;
  atendidoQtd: number;
  atendidoRs: number;
  aberto: number; // necessidade não atendida (qtd)
  cobertura: number; // atendidoQtd / necessidadeQtd (0..1)
  /** Capacidade de recebimento: limite, já comprometido e usado nesta análise. */
  capacidadeLimite: number;
  capacidadeComprometida: number;
  capacidadeUsada: number;
  /** Unidades que a demanda pedia e a capacidade de recebimento barrou. */
  bloqueadoPorCapacidade: number;
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
    /** Métrica usada nos limites de capacidade desta análise. */
    metricaCapacidade: MetricaCapacidade;
    /** Unidades barradas por falta de capacidade (expedição, recebimento ou rota). */
    qtdBloqueadaPorCapacidade: number;
    valorBloqueadoPorCapacidade: number;
    /** SKUs sem o dado da métrica escolhida (não consomem capacidade). */
    skusSemFatorCapacidade: number;
    /** Gargalos identificados: onde a capacidade barrou transferência. */
    gargalos: { tipo: "origem" | "destino" | "rota"; id: string; bloqueado: number }[];
  };
}

/** Filtro Total vs. cobertura crítica (SKUs parados na origem). */
export type FiltroCobertura = "total" | "acima_limite";

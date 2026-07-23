// ---------------------------------------------------------------------------
// Modelo de dados do motor de otimização de transferências entre CDs.
// Nenhum parâmetro de negócio é fixado em código: tudo vem de `Parametros`.
// ---------------------------------------------------------------------------

/** 1 linha por SKU do CD de origem (ex.: CD10). Fonte: BASE_MODELOS. */
export interface PosicaoEstoque {
  idSku: string; // `${deposito}-${codigoProduto}` (ex.: '10-3858')
  deposito: number; // CD de origem (ex.: 10)
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
  envelopado?: string;
  leadTime?: number;
}

/** 1 linha por (ano_mes, cd_destino, codigo_produto). Fonte: PEDIDOS PROJETADOS. */
export interface PedidoProjetado {
  anoMes: string; // 'AAAA_MM'
  cdDestino: number;
  codigoProduto: number;
  pedido: number;
  estoqueAtual?: number;
  estoqueProjetado?: number;
  eo?: number;
}

/**
 * 1 linha por (cd_destino, codigo_produto). Fonte: planilha do MODELO 2
 * (estoque objetivo). Colunas simples: CD destino, produto, descrição e o
 * saldo de estoque objetivo — a quantidade que aquele CD precisa receber.
 */
export interface ObjetivoDestino {
  cdDestino: number;
  codigoProduto: number;
  descricao: string;
  saldoEstoqueObjetivo: number; // demanda a atender naquele CD (unidades)
}

/**
 * Modelo de transferência escolhido (modelo híbrido):
 * - "drp": distribui o excesso por pedidos projetados (mês × CD) — modelo 1.
 * - "estoque_objetivo": distribui o excesso para atender o saldo de estoque
 *   objetivo por CD destino, sem quebra mensal — modelo 2.
 */
export type ModeloTransferencia = "drp" | "estoque_objetivo";

/** Parâmetros editáveis com trilha de auditoria. */
export interface Parametros {
  modelo: ModeloTransferencia; // modelo de transferência ativo (default "drp")
  cdOrigem: number; // CD de origem do excesso (ex.: 10). Nunca é destino.
  prioridadeCds: number[]; // CDs destino em ordem de alocação, ex.: [1, 9, 2, 8, 7]
  horizonteMeses: string[]; // ex.: ['2026_07','2026_08','2026_09']
  aliquotaFiscal: Record<number, number>; // por CD destino, fração (0.052 = 5,2%)
  fatorSegurancaImediata: number; // ex.: 0.5
  limiteCoberturaDias: number; // ex.: 90
}

/** Índice de pedidos: chave `${anoMes}|${cd}|${codigoProduto}` -> quantidade. */
export type PedidosIndex = Map<string, number>;

/** Índice de estoque objetivo: chave `${cd}|${codigoProduto}` -> saldo objetivo. */
export type ObjetivoIndex = Map<string, number>;

export function chavePedido(anoMes: string, cd: number, codigoProduto: number): string {
  return `${anoMes}|${cd}|${codigoProduto}`;
}

export function chaveObjetivo(cd: number, codigoProduto: number): string {
  return `${cd}|${codigoProduto}`;
}

/** Uma linha do plano de transferência (cd_destino × sku) com transferência > 0. */
export interface LinhaPlano {
  cdDestino: number;
  idSku: string;
  deposito: number;
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
  // por mês (mesma ordem de horizonteMeses) — modelo DRP.
  // No modelo "estoque_objetivo" estes vetores vêm ZERADOS.
  pedidoMes: number[];
  transfMes: number[]; // unidades
  valorTransfMes: number[]; // R$
  transfCaixasMes: number[]; // caixas arredondadas
  // Modelo "estoque_objetivo": transferência única para atender o saldo objetivo
  // daquele CD (sem quebra mensal). No modelo DRP estes campos vêm ZERADOS.
  transfObjetivo: number; // unidades a transferir para atender o estoque objetivo
  valorTransfObjetivo: number; // R$
  transfObjetivoCaixas: number; // caixas arredondadas
  qtdTransfImediata: number; // unidades (não arredondado)
  valorTransfImediata: number; // R$
  imediataCaixas: number;
  qtdImediataArredondada: number; // caixas * embCompra
  coberturaDias: number;
  statusCobertura: string; // 'Acima de N dias' | 'Ate N dias' | 'Sem giro'
  transfTotal: number; // total transferido no CD (materialidade > 0): meses + objetivo
}

/** Quantidade total transferida na linha (unidades) — soma meses + objetivo. */
export function qtdTotalLinha(l: LinhaPlano): number {
  let s = l.transfObjetivo;
  for (const t of l.transfMes) s += t;
  return s;
}

/** Valor total transferido na linha (R$) — soma meses + objetivo. */
export function valorTotalLinha(l: LinhaPlano): number {
  let s = l.valorTransfObjetivo;
  for (const v of l.valorTransfMes) s += v;
  return s;
}

/** Agregado por CD destino × mês para o resumo executivo. */
export interface ResumoCd {
  cdDestino: number;
  aliquotaFiscal: number;
  aliquotaDefinida: boolean;
  transfMes: number[]; // qtd por mês (modelo DRP)
  valorTransfMes: number[]; // R$ por mês (modelo DRP)
  transfObjetivo: number; // qtd para atender estoque objetivo (modelo 2)
  valorTransfObjetivo: number; // R$ para atender estoque objetivo (modelo 2)
  qtdImediata: number;
  valorImediata: number;
  impactoFiscal: number; // soma valor transferido (meses + objetivo) * aliquota
}

export interface Reconciliacao {
  skusTotal: number;
  skusComExcesso: number;
  invarianteOk: boolean; // sum(transf) + sobraFinal == excesso, por SKU
  maiorDivergencia: number;
}

export interface ResultadoCalculo {
  linhas: LinhaPlano[];
  resumo: ResumoCd[];
  reconciliacao: Reconciliacao;
  meta: {
    modelo: ModeloTransferencia; // modelo usado neste cálculo
    excessoSimplesRs: number; // sum(max(disp - objetivo,0) * preco) — headline "excesso em estoque"
    excessoTotalRs: number; // sum(excesso_transferivel * preco) — base da alocação
    valorTransfMesTotal: number[]; // por mês (todos os CDs) — modelo DRP
    valorTransfObjetivoTotal: number; // total para atender estoque objetivo (modelo 2)
    valorImediataTotal: number;
    impactoFiscalTotal: number;
    tempoMs: number;
    meses: string[];
    prioridadeCds: number[];
    alertaAliquotasIncompletas: number[]; // CDs sem alíquota definida mas com transferência
  };
}

/** Filtro Total vs. cobertura crítica. */
export type FiltroCobertura = "total" | "acima90";

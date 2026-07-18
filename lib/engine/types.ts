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

/** Parâmetros editáveis com trilha de auditoria. */
export interface Parametros {
  cdOrigem: number; // CD de origem do excesso (ex.: 10). Nunca é destino.
  prioridadeCds: number[]; // CDs destino em ordem de alocação, ex.: [1, 9, 2, 8, 7]
  horizonteMeses: string[]; // ex.: ['2026_07','2026_08','2026_09']
  aliquotaFiscal: Record<number, number>; // por CD destino, fração (0.052 = 5,2%)
  fatorSegurancaImediata: number; // ex.: 0.5
  limiteCoberturaDias: number; // ex.: 90
}

/** Índice de pedidos: chave `${anoMes}|${cd}|${codigoProduto}` -> quantidade. */
export type PedidosIndex = Map<string, number>;

export function chavePedido(anoMes: string, cd: number, codigoProduto: number): string {
  return `${anoMes}|${cd}|${codigoProduto}`;
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
  // por mês (mesma ordem de horizonteMeses)
  pedidoMes: number[];
  transfMes: number[]; // unidades
  valorTransfMes: number[]; // R$
  transfCaixasMes: number[]; // caixas arredondadas
  qtdTransfImediata: number; // unidades (não arredondado)
  valorTransfImediata: number; // R$
  imediataCaixas: number;
  qtdImediataArredondada: number; // caixas * embCompra
  coberturaDias: number;
  statusCobertura: string; // 'Acima de N dias' | 'Ate N dias' | 'Sem giro'
  transfTotal: number; // soma transfMes (materialidade > 0)
}

/** Agregado por CD destino × mês para o resumo executivo. */
export interface ResumoCd {
  cdDestino: number;
  aliquotaFiscal: number;
  aliquotaDefinida: boolean;
  transfMes: number[]; // qtd por mês
  valorTransfMes: number[]; // R$ por mês
  qtdImediata: number;
  valorImediata: number;
  impactoFiscal: number; // soma valor horizonte * aliquota
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
    excessoSimplesRs: number; // sum(max(disp - objetivo,0) * preco) — headline "excesso em estoque"
    excessoTotalRs: number; // sum(excesso_transferivel * preco) — base da alocação
    valorTransfMesTotal: number[]; // por mês (todos os CDs)
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

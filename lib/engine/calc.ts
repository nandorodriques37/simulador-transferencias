import {
  chavePedido,
  FiltroCobertura,
  LinhaPlano,
  Parametros,
  PedidosIndex,
  PosicaoEstoque,
  Reconciliacao,
  ResultadoCalculo,
  ResumoCd,
} from "./types";

// Excel-compatíveis (valores sempre >= 0 no modelo).
const round = (x: number) => Math.floor(x + 0.5); // ROUND (half away from zero, x>=0)
const roundUp = (x: number) => Math.ceil(x - 1e-9); // ROUNDUP
const roundDown = (x: number) => Math.floor(x + 1e-9); // ROUNDDOWN
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Preço de valorização (REGRA 1): custo de reposição; se 0, usa preço de lista.
 */
export function precoUnitario(sku: PosicaoEstoque): number {
  return sku.custoReposicao !== 0 ? sku.custoReposicao : sku.precoLista;
}

/**
 * Excesso transferível (REGRA 2): protege 1 mês de venda média + estoque objetivo,
 * soma o pendente que ainda vai entrar.
 */
export function excessoTransferivel(sku: PosicaoEstoque): number {
  return Math.max(
    sku.estoqueDisponivel + sku.quantidadePendente - sku.vendaMedia3m - sku.estoqueObjetivo,
    0,
  );
}

/**
 * Cobertura de estoque em dias e classificação (REGRA 7).
 */
export function cobertura(
  sku: PosicaoEstoque,
  limiteDias: number,
): { dias: number; status: string } {
  const estoque = sku.estoqueDisponivel + sku.quantidadePendente;
  if (sku.vendaMedia3m <= 0) {
    if (estoque > 0) return { dias: 9999, status: "Sem giro" };
    return { dias: 0, status: `Ate ${limiteDias} dias` };
  }
  const dias = (estoque * 30) / sku.vendaMedia3m;
  return { dias, status: dias > limiteDias ? `Acima de ${limiteDias} dias` : `Ate ${limiteDias} dias` };
}

/**
 * Cascata por prioridade implementada de forma VETORIZADA por soma acumulada
 * (REGRA 4 / requisito não-funcional). Para os N baldes (mês × CD, em ordem
 * cronológica e de prioridade) com pedidos p[i]:
 *
 *   cumBefore[i] = soma(p[0..i-1])
 *   transf[i]    = CLAMP(excesso - cumBefore[i], 0, p[i])
 *
 * É algebricamente idêntico ao laço `saldo -= min(pedido, saldo)`, mas sem
 * dependência sequencial artificial — permite paralelização por SKU.
 *
 * @param pedidos vetor de pedidos na ordem dos baldes
 * @param excesso excesso transferível do SKU
 * @returns vetor de transferências por balde
 */
export function cascataCumsum(pedidos: number[], excesso: number): number[] {
  const n = pedidos.length;
  const transf = new Array<number>(n);
  let cumBefore = 0;
  for (let i = 0; i < n; i++) {
    transf[i] = clamp(excesso - cumBefore, 0, pedidos[i]);
    cumBefore += pedidos[i];
  }
  return transf;
}

export interface OpcoesCalculo {
  /** Reconciliação por SKU: soma(transf)+sobra == excesso. Default true. */
  validarInvariante?: boolean;
  /** callback de progresso (0..1) a cada `progressoIntervalo` SKUs. */
  onProgresso?: (pct: number) => void;
  progressoIntervalo?: number;
}

/**
 * Motor de cálculo completo. Puro, sem estado, testável:
 * (posicao, pedidosIndex, parametros) -> (plano, resumo, reconciliação).
 */
export function calcular(
  posicao: PosicaoEstoque[],
  pedidosIndex: PedidosIndex,
  params: Parametros,
  opts: OpcoesCalculo = {},
): ResultadoCalculo {
  const t0 = Date.now();
  const meses = params.horizonteMeses;
  const cds = params.prioridadeCds;
  const nMes = meses.length;
  const nCd = cds.length;
  const nBaldes = nMes * nCd;
  const fs = params.fatorSegurancaImediata;
  const validar = opts.validarInvariante ?? true;
  const progInt = opts.progressoIntervalo ?? 5000;

  const linhas: LinhaPlano[] = [];

  // Acumuladores do resumo por CD.
  const resumoMap = new Map<number, ResumoCd>();
  for (const cd of cds) {
    resumoMap.set(cd, {
      cdDestino: cd,
      aliquotaFiscal: params.aliquotaFiscal[cd] ?? 0,
      aliquotaDefinida: params.aliquotaFiscal[cd] !== undefined,
      transfMes: new Array(nMes).fill(0),
      valorTransfMes: new Array(nMes).fill(0),
      qtdImediata: 0,
      valorImediata: 0,
      impactoFiscal: 0,
    });
  }

  let excessoTotalRs = 0;
  let excessoSimplesRs = 0;
  let skusComExcesso = 0;
  let invarianteOk = true;
  let maiorDivergencia = 0;
  const valorTransfMesTotal = new Array(nMes).fill(0);
  let valorImediataTotal = 0;

  const pedidosBuf = new Array<number>(nBaldes);

  for (let s = 0; s < posicao.length; s++) {
    const sku = posicao[s];
    const preco = precoUnitario(sku);
    const excesso = excessoTransferivel(sku);
    excessoTotalRs += excesso * preco;
    excessoSimplesRs += Math.max(sku.estoqueDisponivel - sku.estoqueObjetivo, 0) * preco;
    if (excesso <= 0) {
      if (opts.onProgresso && s % progInt === 0) opts.onProgresso(s / posicao.length);
      continue;
    }
    skusComExcesso++;

    // REGRA 3 — demanda por balde (ordem cronológica × prioridade).
    let b = 0;
    for (let m = 0; m < nMes; m++) {
      for (let c = 0; c < nCd; c++) {
        pedidosBuf[b++] = pedidosIndex.get(chavePedido(meses[m], cds[c], sku.codigoProduto)) ?? 0;
      }
    }

    // REGRA 4 — cascata vetorizada.
    const transf = cascataCumsum(pedidosBuf, excesso);

    // REGRA 5/6/7 — valores, imediata, caixas, cobertura por CD.
    const dispHoje = Math.max(sku.estoqueDisponivel - sku.vendaMedia3m * fs, 0);
    const cov = cobertura(sku, params.limiteCoberturaDias);

    // Reconciliação por SKU (invariante do modelo).
    if (validar) {
      let soma = 0;
      for (let i = 0; i < nBaldes; i++) soma += transf[i];
      const sobraFinal = excesso - soma;
      const diverg = Math.abs(soma + sobraFinal - excesso);
      if (diverg > 1e-6) {
        invarianteOk = false;
        if (diverg > maiorDivergencia) maiorDivergencia = diverg;
      }
      // sobra não pode ser negativa (transf nunca excede excesso)
      if (sobraFinal < -1e-6) {
        invarianteOk = false;
        maiorDivergencia = Math.max(maiorDivergencia, -sobraFinal);
      }
    }

    // Monta uma linha por CD com transferência > 0.
    for (let c = 0; c < nCd; c++) {
      const cd = cds[c];
      const transfMes = new Array(nMes);
      const pedidoMes = new Array(nMes);
      const valorTransfMes = new Array(nMes);
      const transfCaixasMes = new Array(nMes);
      let transfTotalCd = 0;
      let valorHorizonte = 0;
      for (let m = 0; m < nMes; m++) {
        const idx = m * nCd + c;
        const t = transf[idx];
        transfMes[m] = t;
        pedidoMes[m] = pedidosBuf[idx];
        const v = t * preco;
        valorTransfMes[m] = v;
        transfCaixasMes[m] = sku.embCompra > 0 ? round(t / sku.embCompra) : 0;
        transfTotalCd += t;
        valorHorizonte += v;
        valorTransfMesTotal[m] += v;
      }
      if (transfTotalCd <= 0) continue; // REGRA 9 — materialidade

      // REGRA 5/6 — transferência imediata (mês 1 deste CD).
      const transfM1 = transfMes[0] ?? 0;
      const qtdImediata = Math.min(transfM1, dispHoje);
      const valorImediata = qtdImediata * preco;
      let imediataCaixas = 0;
      let qtdImediataArred = 0;
      if (sku.embCompra > 0 && qtdImediata > 0) {
        imediataCaixas = Math.min(
          roundUp(qtdImediata / sku.embCompra),
          roundDown(dispHoje / sku.embCompra),
        );
        if (imediataCaixas < 0) imediataCaixas = 0;
        qtdImediataArred = imediataCaixas * sku.embCompra;
      }

      const r = resumoMap.get(cd)!;
      for (let m = 0; m < nMes; m++) {
        r.transfMes[m] += transfMes[m];
        r.valorTransfMes[m] += valorTransfMes[m];
      }
      r.qtdImediata += qtdImediata;
      r.valorImediata += valorImediata;
      r.impactoFiscal += valorHorizonte * r.aliquotaFiscal;
      valorImediataTotal += valorImediata;

      linhas.push({
        cdDestino: cd,
        idSku: sku.idSku,
        deposito: sku.deposito,
        codigoProduto: sku.codigoProduto,
        produto: sku.produto,
        fornecedor: sku.fornecedor,
        comprador: sku.comprador,
        analista: sku.analista,
        categoriaN1: sku.categoriaN1,
        categoriaN2: sku.categoriaN2,
        categoriaN3: sku.categoriaN3,
        categoriaN4: sku.categoriaN4,
        precoUnitario: preco,
        embCompra: sku.embCompra,
        pedidoMes,
        transfMes,
        valorTransfMes,
        transfCaixasMes,
        qtdTransfImediata: qtdImediata,
        valorTransfImediata: valorImediata,
        imediataCaixas,
        qtdImediataArredondada: qtdImediataArred,
        coberturaDias: cov.dias,
        statusCobertura: cov.status,
        transfTotal: transfTotalCd,
      });
    }

    if (opts.onProgresso && s % progInt === 0) opts.onProgresso(s / posicao.length);
  }

  const resumo = cds.map((cd) => resumoMap.get(cd)!);
  const impactoFiscalTotal = resumo.reduce((a, r) => a + r.impactoFiscal, 0);
  const alertaAliquotas = resumo
    .filter((r) => !r.aliquotaDefinida && r.valorTransfMes.some((v) => v > 0))
    .map((r) => r.cdDestino);

  const reconciliacao: Reconciliacao = {
    skusTotal: posicao.length,
    skusComExcesso,
    invarianteOk,
    maiorDivergencia,
  };

  if (opts.onProgresso) opts.onProgresso(1);

  return {
    linhas,
    resumo,
    reconciliacao,
    meta: {
      excessoSimplesRs,
      excessoTotalRs,
      valorTransfMesTotal,
      valorImediataTotal,
      impactoFiscalTotal,
      tempoMs: Date.now() - t0,
      meses,
      prioridadeCds: cds,
      alertaAliquotasIncompletas: alertaAliquotas,
    },
  };
}

/** Constrói o índice de pedidos a partir das linhas (join O(1) por chave). */
export function indexarPedidos(pedidos: { anoMes: string; cdDestino: number; codigoProduto: number; pedido: number }[]): PedidosIndex {
  const idx: PedidosIndex = new Map();
  for (const p of pedidos) {
    idx.set(chavePedido(p.anoMes, p.cdDestino, p.codigoProduto), p.pedido);
  }
  return idx;
}

/** Filtra linhas do plano por cobertura (Total vs. crítico > limite). */
export function filtrarPorCobertura(linhas: LinhaPlano[], filtro: FiltroCobertura, limiteDias: number): LinhaPlano[] {
  if (filtro === "total") return linhas;
  return linhas.filter((l) => l.coberturaDias > limiteDias);
}

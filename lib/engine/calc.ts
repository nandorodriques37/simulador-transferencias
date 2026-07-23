import {
  chaveObjetivo,
  chavePedido,
  FiltroCobertura,
  LinhaPlano,
  ObjetivoDestino,
  ObjetivoIndex,
  Parametros,
  PedidosIndex,
  PosicaoEstoque,
  Reconciliacao,
  ResultadoCalculo,
  ResumoCd,
} from "./types";

// Excel-compatíveis (valores sempre >= 0 no modelo).
const round = (x: number) => Math.floor(x + 0.5); // ROUND (half away from zero, x>=0)
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
 * Motor de cálculo completo. Puro, sem estado, testável.
 *
 * Suporta os DOIS modelos de transferência (modelo híbrido), escolhidos por
 * `params.modelo`:
 *
 * - "drp" (modelo 1): distribui o excesso do CD de origem pelos PEDIDOS
 *   PROJETADOS, cascateando por (mês × CD) na ordem cronológica e de
 *   prioridade. Fonte da demanda: `pedidosIndex`.
 *
 * - "estoque_objetivo" (modelo 2): distribui o mesmo excesso para atender o
 *   SALDO DE ESTOQUE OBJETIVO de cada CD destino, SEM quebra mensal — um único
 *   balde por CD, na ordem de prioridade. Fonte da demanda: `objetivoIndex`.
 *   Neste modelo os vetores por mês saem ZERADOS e a coluna
 *   "Transferir para atender estoque objetivo" carrega a transferência.
 *
 * Em ambos os modelos a cascata gulosa `cascataCumsum` é a mesma — muda apenas
 * de onde vêm os baldes de demanda.
 */
export function calcular(
  posicao: PosicaoEstoque[],
  pedidosIndex: PedidosIndex,
  params: Parametros,
  opts: OpcoesCalculo = {},
  objetivoIndex: ObjetivoIndex = new Map(),
): ResultadoCalculo {
  const t0 = Date.now();
  const modelo = params.modelo ?? "drp";
  const objetivoMode = modelo === "estoque_objetivo";
  const meses = params.horizonteMeses;
  // Destinos = prioridade, sempre excluindo o CD de origem (não transfere para si).
  const cds = params.prioridadeCds.filter((cd) => cd !== params.cdOrigem);
  const nMes = meses.length;
  const nCd = cds.length;
  const nBaldes = objetivoMode ? nCd : nMes * nCd;
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
      transfObjetivo: 0,
      valorTransfObjetivo: 0,
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
  let valorTransfObjetivoTotal = 0;
  let valorImediataTotal = 0;

  // Buffer de demanda por balde. No modelo objetivo há 1 balde por CD; no
  // modelo DRP há 1 balde por (mês × CD).
  const demandaBuf = new Array<number>(nBaldes);

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

    // Demanda por balde (ordem de prioridade — e cronológica no modelo DRP).
    if (objetivoMode) {
      // MODELO 2 — 1 balde por CD: saldo de estoque objetivo daquele CD.
      for (let c = 0; c < nCd; c++) {
        demandaBuf[c] = objetivoIndex.get(chaveObjetivo(cds[c], sku.codigoProduto)) ?? 0;
      }
    } else {
      // MODELO DRP (REGRA 3) — 1 balde por (mês × CD): pedido projetado.
      let b = 0;
      for (let m = 0; m < nMes; m++) {
        for (let c = 0; c < nCd; c++) {
          demandaBuf[b++] = pedidosIndex.get(chavePedido(meses[m], cds[c], sku.codigoProduto)) ?? 0;
        }
      }
    }

    // REGRA 4 — cascata vetorizada (idêntica nos dois modelos).
    const transf = cascataCumsum(demandaBuf, excesso);

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
      const transfMes = new Array(nMes).fill(0);
      const pedidoMes = new Array(nMes).fill(0);
      const valorTransfMes = new Array(nMes).fill(0);
      const transfCaixasMes = new Array(nMes).fill(0);
      let transfObjetivo = 0;
      let valorTransfObjetivo = 0;
      let transfObjetivoCaixas = 0;
      let transfTotalCd = 0;
      let valorHorizonte = 0;
      let baseImediata = 0; // quantidade candidata à transferência imediata

      if (objetivoMode) {
        // MODELO 2 — transferência única para atender o estoque objetivo.
        const t = transf[c];
        transfObjetivo = t;
        valorTransfObjetivo = t * preco;
        transfObjetivoCaixas = sku.embCompra > 0 ? round(t / sku.embCompra) : 0;
        transfTotalCd = t;
        valorHorizonte = valorTransfObjetivo;
        valorTransfObjetivoTotal += valorTransfObjetivo;
        baseImediata = t; // atender o objetivo é, por natureza, imediato
      } else {
        // MODELO DRP — transferência mês a mês.
        for (let m = 0; m < nMes; m++) {
          const idx = m * nCd + c;
          const t = transf[idx];
          transfMes[m] = t;
          pedidoMes[m] = demandaBuf[idx];
          const v = t * preco;
          valorTransfMes[m] = v;
          transfCaixasMes[m] = sku.embCompra > 0 ? round(t / sku.embCompra) : 0;
          transfTotalCd += t;
          valorHorizonte += v;
          valorTransfMesTotal[m] += v;
        }
        baseImediata = transfMes[0] ?? 0; // mês 1 deste CD
      }
      if (transfTotalCd <= 0) continue; // REGRA 9 — materialidade

      // REGRA 5/6 — transferência imediata.
      const qtdImediata = Math.min(baseImediata, dispHoje);
      // Transferência imediata em CAIXAS (cx): arredonda SEMPRE PARA BAIXO
      // (caixa fechada). Se a quantidade imediata não fecha 1 caixa
      // (qtdImediata < embCompra), a transferência imediata em cx é ZERO —
      // ROUNDDOWN(qtd/emb) já entrega 0 nesse caso.
      let imediataCaixas = 0;
      let qtdImediataArred = 0;
      if (sku.embCompra > 0 && qtdImediata > 0) {
        imediataCaixas = roundDown(qtdImediata / sku.embCompra);
        if (imediataCaixas < 0) imediataCaixas = 0;
        qtdImediataArred = imediataCaixas * sku.embCompra;
      }
      // Valor da transferência imediata = valor das UNIDADES efetivamente
      // transferidas em caixas fechadas (qtdImediataArred), e não da
      // quantidade teórica não arredondada.
      const valorImediata = qtdImediataArred * preco;

      const r = resumoMap.get(cd)!;
      for (let m = 0; m < nMes; m++) {
        r.transfMes[m] += transfMes[m];
        r.valorTransfMes[m] += valorTransfMes[m];
      }
      r.transfObjetivo += transfObjetivo;
      r.valorTransfObjetivo += valorTransfObjetivo;
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
        transfObjetivo,
        valorTransfObjetivo,
        transfObjetivoCaixas,
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
    .filter((r) => !r.aliquotaDefinida && (r.valorTransfMes.some((v) => v > 0) || r.valorTransfObjetivo > 0))
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
      modelo,
      excessoSimplesRs,
      excessoTotalRs,
      valorTransfMesTotal,
      valorTransfObjetivoTotal,
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

/**
 * Constrói o índice de estoque objetivo por (cd, produto) — join O(1) por chave.
 * Se houver linhas repetidas para a mesma (cd, produto), soma os saldos.
 */
export function indexarObjetivos(objetivos: ObjetivoDestino[]): ObjetivoIndex {
  const idx: ObjetivoIndex = new Map();
  for (const o of objetivos) {
    const k = chaveObjetivo(o.cdDestino, o.codigoProduto);
    idx.set(k, (idx.get(k) ?? 0) + o.saldoEstoqueObjetivo);
  }
  return idx;
}

/** Filtra linhas do plano por cobertura (Total vs. crítico > limite). */
export function filtrarPorCobertura(linhas: LinhaPlano[], filtro: FiltroCobertura, limiteDias: number): LinhaPlano[] {
  if (filtro === "total") return linhas;
  return linhas.filter((l) => l.coberturaDias > limiteDias);
}

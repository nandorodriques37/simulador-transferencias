import {
  chaveCdProduto,
  chavePedido,
  chaveRota,
  Compromissos,
  compromissosVazios,
  FiltroCobertura,
  LinhaBase,
  LinhaPlano,
  ParametrosRede,
  PedidosIndex,
  Reconciliacao,
  ResultadoRede,
  ResumoDestino,
  ResumoOrigem,
  ResumoRota,
} from "./types";

// Arredondamentos compatíveis com Excel (valores sempre >= 0 no modelo).
const round = (x: number) => Math.floor(x + 0.5); // ROUND
const roundDown = (x: number) => Math.floor(x + 1e-9); // ROUNDDOWN
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const EPS = 1e-9;

/** REGRA 1 — preço de valorização: custo de reposição; se 0, preço de lista. */
export function precoUnitario(l: LinhaBase): number {
  return l.custoReposicao !== 0 ? l.custoReposicao : l.precoLista;
}

/**
 * REGRA 2 — excesso transferível do CD quando ele age como ORIGEM.
 * Protege 1 mês de venda média + o estoque objetivo do próprio CD, e soma o
 * que ainda está pendente de entrada.
 */
export function excessoTransferivel(l: LinhaBase): number {
  return Math.max(
    l.estoqueDisponivel + l.quantidadePendente - l.vendaMedia3m - l.estoqueObjetivo,
    0,
  );
}

/**
 * REGRA 3 — necessidade do CD quando ele age como DESTINO no modo
 * "saldo_ideal": o que falta para chegar ao estoque objetivo, já considerando
 * o que está pendente de entrada.
 */
export function necessidadeSaldoIdeal(l: LinhaBase): number {
  return Math.max(l.estoqueObjetivo - l.estoqueDisponivel - l.quantidadePendente, 0);
}

/** REGRA 7 — cobertura em dias do SKU no CD (usada na visão da origem). */
export function cobertura(l: LinhaBase, limiteDias: number): { dias: number; status: string } {
  const estoque = l.estoqueDisponivel + l.quantidadePendente;
  if (l.vendaMedia3m <= 0) {
    if (estoque > 0) return { dias: 9999, status: "Sem giro" };
    return { dias: 0, status: `Ate ${limiteDias} dias` };
  }
  const dias = (estoque * 30) / l.vendaMedia3m;
  return {
    dias,
    status: dias > limiteDias ? `Acima de ${limiteDias} dias` : `Ate ${limiteDias} dias`,
  };
}

/**
 * REGRA 4 — cascata por prioridade, vetorizada por soma acumulada.
 * Para os N baldes de demanda p[i] na ordem de prioridade:
 *   transf[i] = CLAMP(excesso - soma(p[0..i-1]), 0, p[i])
 * Algebricamente idêntico ao laço `saldo -= min(pedido, saldo)`, sem
 * dependência sequencial artificial.
 */
export function cascataCumsum(demanda: number[], excesso: number): number[] {
  const n = demanda.length;
  const transf = new Array<number>(n);
  let cumBefore = 0;
  for (let i = 0; i < n; i++) {
    transf[i] = clamp(excesso - cumBefore, 0, demanda[i]);
    cumBefore += demanda[i];
  }
  return transf;
}

/** Constrói o índice de pedidos (join O(1) por chave). */
export function indexarPedidos(
  pedidos: { anoMes: string; cdDestino: number; codigoProduto: number; pedido: number }[],
): PedidosIndex {
  const idx: PedidosIndex = new Map();
  for (const p of pedidos) {
    const k = chavePedido(p.anoMes, p.cdDestino, p.codigoProduto);
    idx.set(k, (idx.get(k) ?? 0) + p.pedido);
  }
  return idx;
}

/** Remove duplicatas preservando a ordem escolhida pelo usuário. */
function unicos(cds: number[]): number[] {
  const vistos = new Set<number>();
  const out: number[] = [];
  for (const cd of cds) {
    const n = Number(cd);
    if (!vistos.has(n)) {
      vistos.add(n);
      out.push(n);
    }
  }
  return out;
}

export interface OpcoesCalculo {
  /** Valida os invariantes de rede (origem e destino). Default true. */
  validarInvariante?: boolean;
  onProgresso?: (pct: number) => void;
  progressoIntervalo?: number;
}

/**
 * MOTOR DE REDE — multi-origem × multi-destino.
 *
 * Sequência exata da análise (é o que o usuário configura na tela):
 *   para cada ORIGEM na ordem escolhida
 *     para cada balde de demanda na ordem (mês → destino, ou destino no modo
 *     saldo ideal)
 *       aloca o excesso da origem até acabar o excesso ou a demanda
 *
 * A demanda é um saldo COMPARTILHADO: o que a origem 1 atende some da fila da
 * origem 2. Por isso a ordem das origens muda o resultado — é o comportamento
 * pedido: "primeiro a sequência das origens, depois a ordem dos destinos".
 *
 * Um CD nunca transfere para si mesmo (o balde da própria origem é pulado).
 */
export function calcularRede(
  base: LinhaBase[],
  pedidosIndex: PedidosIndex,
  params: ParametrosRede,
  compromissos: Compromissos = compromissosVazios(),
  opts: OpcoesCalculo = {},
): ResultadoRede {
  const t0 = Date.now();
  const modo = params.modoDemanda;
  const usaPedidos = modo === "pedidos";
  const origens = unicos(params.origens);
  const destinos = unicos(params.destinos);
  const meses = usaPedidos ? params.horizonteMeses : [];
  const nMes = meses.length;
  const nOri = origens.length;
  const nDst = destinos.length;
  // Baldes por origem: mês → destino (modo pedidos) ou destino (saldo ideal).
  const nBaldes = usaPedidos ? nMes * nDst : nDst;
  const fs = params.fatorSegurancaImediata;
  const validar = opts.validarInvariante ?? true;
  const progInt = opts.progressoIntervalo ?? 5000;
  const usarAprovadas = params.considerarAprovadas !== false;

  const posOrigem = new Map<number, number>();
  origens.forEach((cd, i) => posOrigem.set(cd, i));
  const posDestino = new Map<number, number>();
  destinos.forEach((cd, i) => posDestino.set(cd, i));

  // --- Agrupamento por produto (um passe pela base) --------------------------
  // Só interessam linhas de CDs selecionados como origem ou destino.
  const porProduto = new Map<number, LinhaBase[]>();
  for (const l of base) {
    if (!posOrigem.has(l.cd) && !posDestino.has(l.cd)) continue;
    const arr = porProduto.get(l.codigoProduto);
    if (arr) arr.push(l);
    else porProduto.set(l.codigoProduto, [l]);
  }

  const linhas: LinhaPlano[] = [];

  // Acumuladores.
  const rotaMap = new Map<string, ResumoRota>();
  for (const o of origens) {
    for (const d of destinos) {
      if (o === d) continue;
      const r = chaveRota(o, d);
      rotaMap.set(r, {
        cdOrigem: o,
        cdDestino: d,
        rota: r,
        aliquota: params.aliquotas[r] ?? 0,
        aliquotaDefinida: params.aliquotas[r] !== undefined,
        qtdMes: new Array(nMes).fill(0),
        valorMes: new Array(nMes).fill(0),
        qtd: 0,
        valor: 0,
        qtdImediata: 0,
        valorImediata: 0,
        impactoFiscal: 0,
        linhas: 0,
      });
    }
  }

  const resumoOrigem: ResumoOrigem[] = origens.map((cd, i) => ({
    cd,
    ordem: i + 1,
    excessoQtd: 0,
    excessoRs: 0,
    transferidoQtd: 0,
    transferidoRs: 0,
    sobraQtd: 0,
    sobraRs: 0,
    skusComExcesso: 0,
  }));
  const resumoDestino: ResumoDestino[] = destinos.map((cd, i) => ({
    cd,
    ordem: i + 1,
    necessidadeQtd: 0,
    necessidadeRs: 0,
    atendidoQtd: 0,
    atendidoRs: 0,
    aberto: 0,
    cobertura: 0,
  }));

  let valorTransfTotal = 0;
  let qtdTransfTotal = 0;
  let valorImediataTotal = 0;
  let impactoFiscalTotal = 0;
  let necessidadeTotalRs = 0;
  let necessidadeAtendidaRs = 0;
  let paresOrigemProduto = 0;
  let invarianteOk = true;
  let maiorDivergencia = 0;
  let autoTransferencias = 0;
  const skusDistintos = new Set<string>();

  // Buffers reaproveitados entre produtos (evita alocação por SKU).
  const demandaBuf = new Array<number>(nBaldes).fill(0);
  const linhaOrigem = new Array<LinhaBase | undefined>(nOri);
  const linhaDestino = new Array<LinhaBase | undefined>(nDst);
  const precoRef = new Array<number>(nOri);
  // Snapshot da demanda vista pela origem da vez (antes de ela consumir).
  const baldes = new Array<number>(nBaldes).fill(0);

  let processados = 0;
  const totalProdutos = porProduto.size;

  for (const [codigoProduto, linhasProduto] of porProduto) {
    processados++;
    if (opts.onProgresso && processados % progInt === 0) {
      opts.onProgresso(processados / totalProdutos);
    }

    // Posiciona as linhas do produto nos slots de origem/destino.
    linhaOrigem.fill(undefined);
    linhaDestino.fill(undefined);
    for (const l of linhasProduto) {
      const io = posOrigem.get(l.cd);
      if (io !== undefined) linhaOrigem[io] = l;
      const id = posDestino.get(l.cd);
      if (id !== undefined) linhaDestino[id] = l;
    }

    // --- Demanda de cada balde (saldo compartilhado entre as origens) -------
    // Preço de referência do produto (para valorizar a necessidade quando o
    // destino não tem custo próprio): usa a 1ª origem com preço > 0.
    let precoProduto = 0;
    for (let i = 0; i < nOri; i++) {
      const lo = linhaOrigem[i];
      const p = lo ? precoUnitario(lo) : 0;
      precoRef[i] = p;
      if (precoProduto === 0 && p > 0) precoProduto = p;
    }
    if (precoProduto === 0) {
      for (let d = 0; d < nDst; d++) {
        const ld = linhaDestino[d];
        if (ld) {
          const p = precoUnitario(ld);
          if (p > 0) {
            precoProduto = p;
            break;
          }
        }
      }
    }

    let demandaTotalProduto = 0;
    if (usaPedidos) {
      // Modo "pedidos": um balde por (mês × destino), na ordem cronológica e
      // depois na ordem de prioridade dos destinos.
      for (let d = 0; d < nDst; d++) {
        const cdD = destinos[d];
        // Trânsito já aprovado abate os pedidos mais próximos primeiro.
        let transito = usarAprovadas
          ? compromissos.entradaDestino.get(chaveCdProduto(cdD, codigoProduto)) ?? 0
          : 0;
        let necCd = 0;
        for (let m = 0; m < nMes; m++) {
          let ped = pedidosIndex.get(chavePedido(meses[m], cdD, codigoProduto)) ?? 0;
          if (transito > 0 && ped > 0) {
            const abate = Math.min(transito, ped);
            ped -= abate;
            transito -= abate;
          }
          demandaBuf[m * nDst + d] = ped;
          necCd += ped;
        }
        resumoDestino[d].necessidadeQtd += necCd;
        resumoDestino[d].necessidadeRs += necCd * precoProduto;
        demandaTotalProduto += necCd;
      }
    } else {
      // Modo "saldo ideal": um balde por destino (o que falta para o objetivo).
      for (let d = 0; d < nDst; d++) {
        const ld = linhaDestino[d];
        let nec = ld ? necessidadeSaldoIdeal(ld) : 0;
        if (usarAprovadas && nec > 0) {
          const transito =
            compromissos.entradaDestino.get(chaveCdProduto(destinos[d], codigoProduto)) ?? 0;
          nec = Math.max(nec - transito, 0);
        }
        demandaBuf[d] = nec;
        resumoDestino[d].necessidadeQtd += nec;
        resumoDestino[d].necessidadeRs += nec * precoProduto;
        demandaTotalProduto += nec;
      }
    }
    necessidadeTotalRs += demandaTotalProduto * precoProduto;

    // --- Excesso de cada origem (também contabilizado quando não há demanda) -
    let temExcesso = false;
    for (let i = 0; i < nOri; i++) {
      const lo = linhaOrigem[i];
      if (!lo) continue;
      let exc = excessoTransferivel(lo);
      if (usarAprovadas && exc > 0) {
        const comprometido =
          compromissos.saidaOrigem.get(chaveCdProduto(origens[i], codigoProduto)) ?? 0;
        exc = Math.max(exc - comprometido, 0);
      }
      if (exc <= 0) continue;
      temExcesso = true;
      paresOrigemProduto++;
      const ro = resumoOrigem[i];
      ro.excessoQtd += exc;
      ro.excessoRs += exc * precoRef[i];
      ro.skusComExcesso++;
    }

    if (!temExcesso || demandaTotalProduto <= 0) continue;

    // --- Alocação: origem por origem, na ordem escolhida --------------------
    for (let i = 0; i < nOri; i++) {
      const lo = linhaOrigem[i];
      if (!lo) continue;
      const cdO = origens[i];
      let excesso = excessoTransferivel(lo);
      if (usarAprovadas && excesso > 0) {
        excesso = Math.max(
          excesso - (compromissos.saidaOrigem.get(chaveCdProduto(cdO, codigoProduto)) ?? 0),
          0,
        );
      }
      if (excesso <= EPS) continue;

      // Baldes visíveis para esta origem (nunca transfere para si mesma).
      const slotProprio = posDestino.get(cdO);
      for (let b = 0; b < nBaldes; b++) baldes[b] = demandaBuf[b];
      if (slotProprio !== undefined) {
        if (usaPedidos) {
          for (let m = 0; m < nMes; m++) baldes[m * nDst + slotProprio] = 0;
        } else {
          baldes[slotProprio] = 0;
        }
      }

      const transf = cascataCumsum(baldes, excesso);

      // Consome os baldes (a demanda atendida some para as próximas origens).
      let transferidoOrigem = 0;
      for (let b = 0; b < nBaldes; b++) {
        if (transf[b] > 0) {
          demandaBuf[b] -= transf[b];
          if (demandaBuf[b] < 0) demandaBuf[b] = 0;
          transferidoOrigem += transf[b];
        }
      }
      if (transferidoOrigem <= EPS) continue;

      const preco = precoRef[i];
      const cov = cobertura(lo, params.limiteCoberturaDias);
      // Capacidade de saída imediata da origem (compartilhada pelos destinos,
      // consumida na ordem de prioridade).
      let saldoImediato = Math.max(lo.estoqueDisponivel - lo.vendaMedia3m * fs, 0);

      for (let d = 0; d < nDst; d++) {
        const cdD = destinos[d];
        if (cdD === cdO) {
          // O balde da própria origem é zerado antes da cascata: se algo foi
          // alocado nele, o invariante da rede foi violado.
          if (usaPedidos) {
            for (let m = 0; m < nMes; m++) if (transf[m * nDst + d] > 0) autoTransferencias++;
          } else if (transf[d] > 0) autoTransferencias++;
          continue;
        }
        const transfMes = usaPedidos ? new Array<number>(nMes).fill(0) : [];
        const demandaMes = usaPedidos ? new Array<number>(nMes).fill(0) : [];
        let transfTotalRota = 0;
        let transfSaldo = 0;
        let demandaSaldo = 0;
        let baseImediata = 0;

        if (usaPedidos) {
          for (let m = 0; m < nMes; m++) {
            const b = m * nDst + d;
            const t = transf[b];
            transfMes[m] = t;
            demandaMes[m] = baldes[b];
            transfTotalRota += t;
          }
          baseImediata = transfMes[0] ?? 0; // o mês 1 é o que pode sair já
        } else {
          transfSaldo = transf[d];
          demandaSaldo = baldes[d];
          transfTotalRota = transfSaldo;
          baseImediata = transfSaldo; // atender o saldo ideal é imediato
        }
        if (transfTotalRota <= EPS) continue;

        const valorTotal = transfTotalRota * preco;
        // REGRA 5/6 — transferência imediata em caixa fechada.
        const qtdImediata = Math.min(baseImediata, saldoImediato);
        saldoImediato = Math.max(saldoImediato - qtdImediata, 0);
        let imediataCaixas = 0;
        let qtdImediataArred = 0;
        if (lo.embCompra > 0 && qtdImediata > 0) {
          imediataCaixas = Math.max(roundDown(qtdImediata / lo.embCompra), 0);
          qtdImediataArred = imediataCaixas * lo.embCompra;
        }
        const valorImediata = qtdImediataArred * preco;

        const rotaKey = chaveRota(cdO, cdD);
        const r = rotaMap.get(rotaKey)!;
        const impactoFiscal = valorTotal * r.aliquota;

        for (let m = 0; m < nMes; m++) {
          r.qtdMes[m] += transfMes[m];
          r.valorMes[m] += transfMes[m] * preco;
        }
        r.qtd += transfTotalRota;
        r.valor += valorTotal;
        r.qtdImediata += qtdImediata;
        r.valorImediata += valorImediata;
        r.impactoFiscal += impactoFiscal;
        r.linhas++;

        resumoDestino[d].atendidoQtd += transfTotalRota;
        resumoDestino[d].atendidoRs += valorTotal;
        necessidadeAtendidaRs += valorTotal;
        valorTransfTotal += valorTotal;
        qtdTransfTotal += transfTotalRota;
        valorImediataTotal += valorImediata;
        impactoFiscalTotal += impactoFiscal;
        skusDistintos.add(`${codigoProduto}`);

        linhas.push({
          cdOrigem: cdO,
          cdDestino: cdD,
          rota: rotaKey,
          idSku: `${cdO}-${codigoProduto}`,
          codigoProduto,
          produto: lo.produto,
          fornecedor: lo.fornecedor,
          comprador: lo.comprador,
          analista: lo.analista,
          categoriaN1: lo.categoriaN1,
          categoriaN2: lo.categoriaN2,
          categoriaN3: lo.categoriaN3,
          categoriaN4: lo.categoriaN4,
          precoUnitario: preco,
          embCompra: lo.embCompra,
          demandaMes,
          transfMes,
          demandaSaldo,
          transfSaldo,
          transfTotal: transfTotalRota,
          valorTotal,
          caixas: lo.embCompra > 0 ? round(transfTotalRota / lo.embCompra) : 0,
          qtdImediata,
          imediataCaixas,
          qtdImediataArredondada: qtdImediataArred,
          valorImediata,
          coberturaDias: cov.dias,
          statusCobertura: cov.status,
          aliquota: r.aliquota,
          impactoFiscal,
        });
      }

      const ro = resumoOrigem[i];
      ro.transferidoQtd += transferidoOrigem;
      ro.transferidoRs += transferidoOrigem * preco;

      if (validar) {
        const diverg = transferidoOrigem - excesso;
        if (diverg > 1e-6) {
          invarianteOk = false;
          if (diverg > maiorDivergencia) maiorDivergencia = diverg;
        }
      }
    }
  }

  // Sobras por origem e cobertura por destino.
  for (const ro of resumoOrigem) {
    ro.sobraQtd = Math.max(ro.excessoQtd - ro.transferidoQtd, 0);
    ro.sobraRs = Math.max(ro.excessoRs - ro.transferidoRs, 0);
  }
  for (const rd of resumoDestino) {
    rd.aberto = Math.max(rd.necessidadeQtd - rd.atendidoQtd, 0);
    rd.cobertura = rd.necessidadeQtd > 0 ? rd.atendidoQtd / rd.necessidadeQtd : 0;
    if (validar && rd.atendidoQtd - rd.necessidadeQtd > 1e-6) {
      invarianteOk = false;
      maiorDivergencia = Math.max(maiorDivergencia, rd.atendidoQtd - rd.necessidadeQtd);
    }
  }

  const rotas = Array.from(rotaMap.values()).filter((r) => r.linhas > 0 || r.qtd > 0);
  const rotasSemAliquota = rotas.filter((r) => !r.aliquotaDefinida && r.valor > 0).map((r) => r.rota);
  const excessoDisponivelRs = resumoOrigem.reduce((a, r) => a + r.excessoRs, 0);
  const excessoUtilizadoRs = resumoOrigem.reduce((a, r) => a + r.transferidoRs, 0);

  const reconciliacao: Reconciliacao = {
    skusBase: base.length,
    produtosDistintos: porProduto.size,
    paresOrigemProduto,
    invarianteOk,
    maiorDivergencia,
    autoTransferencias,
  };

  if (opts.onProgresso) opts.onProgresso(1);

  return {
    linhas,
    rotas,
    origens: resumoOrigem,
    destinos: resumoDestino,
    reconciliacao,
    meta: {
      modoDemanda: modo,
      meses,
      sequenciaOrigens: origens,
      sequenciaDestinos: destinos,
      excessoDisponivelRs,
      excessoUtilizadoRs,
      necessidadeTotalRs,
      necessidadeAtendidaRs,
      valorTransfTotal,
      valorImediataTotal,
      impactoFiscalTotal,
      qtdTransfTotal,
      linhasPlano: linhas.length,
      skusDistintos: skusDistintos.size,
      tempoMs: Date.now() - t0,
      rotasSemAliquota,
    },
  };
}

/** Filtra linhas do plano por cobertura do SKU na origem. */
export function filtrarPorCobertura(
  linhas: LinhaPlano[],
  filtro: FiltroCobertura,
  limiteDias: number,
): LinhaPlano[] {
  if (filtro === "total") return linhas;
  return linhas.filter((l) => l.coberturaDias > limiteDias);
}

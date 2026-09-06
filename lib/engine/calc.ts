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
const EPS = 1e-9;

/** REGRA 1 — preço de valorização: custo de reposição; se 0, preço de lista. */
export function precoUnitario(l: LinhaBase): number {
  return l.custoReposicao !== 0 ? l.custoReposicao : l.precoLista;
}

/**
 * REGRA 2 — excesso transferível do CD quando ele age como ORIGEM.
 * Protege 1 mês de venda média + o estoque objetivo do próprio CD.
 *
 * `comPendente = true` (padrão) soma o que ainda vai entrar — é o excesso de
 * PLANEJAMENTO. `false` devolve o excesso FÍSICO: só o que já está no CD, que é
 * o que de fato pode embarcar hoje.
 */
export function excessoTransferivel(l: LinhaBase, comPendente = true): number {
  const entrada = comPendente ? l.quantidadePendente : 0;
  return Math.max(l.estoqueDisponivel + entrada - l.vendaMedia3m - l.estoqueObjetivo, 0);
}

/**
 * REGRA 3 — necessidade do CD quando ele age como DESTINO no modo
 * "saldo_ideal": o que falta para chegar ao estoque objetivo, já considerando
 * o que está pendente de entrada.
 */
export function necessidadeSaldoIdeal(l: LinhaBase): number {
  return Math.max(l.estoqueObjetivo - l.estoqueDisponivel - l.quantidadePendente, 0);
}

/** Venda diária do SKU no CD (venda média mensal ÷ 30). */
export function vendaDia(l: LinhaBase): number {
  return l.vendaMedia3m > 0 ? l.vendaMedia3m / 30 : 0;
}

/**
 * REGRA 3b — teto/piso de cobertura do destino, em unidades.
 * Converte "dias de cobertura" no volume que ainda cabe no CD:
 *   limite = venda_dia × dias − (disponível + pendente + trânsito)
 * Devolve `null` quando a regra está desligada (dias = 0) ou quando o SKU não
 * tem giro no destino (aí dias de cobertura não significam nada).
 */
export function limitePorCobertura(l: LinhaBase, dias: number, transito = 0): number | null {
  if (dias <= 0) return null;
  const vd = vendaDia(l);
  if (vd <= 0) return null;
  return Math.max(vd * dias - (l.estoqueDisponivel + l.quantidadePendente + transito), 0);
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

/** Regras de materialidade e caixa fechada aplicadas a cada alocação. */
export interface RegrasLote {
  embCompra: number;
  preco: number;
  caixaFechada: boolean;
  minUnidades: number;
  minValor: number;
}

/**
 * Ajusta uma quantidade alocada às regras de embarque: caixa fechada (arredonda
 * para baixo, nunca inventa unidade) e materialidade mínima. O que não passa
 * volta a zero — e, como a cascata é sequencial, o saldo continua disponível
 * para o próximo balde.
 */
export function ajustarLote(qtd: number, r: RegrasLote): number {
  let q = qtd;
  if (q <= EPS) return 0;
  if (r.caixaFechada && r.embCompra > 0) q = roundDown(q / r.embCompra) * r.embCompra;
  if (q <= EPS) return 0;
  if (r.minUnidades > 0 && q < r.minUnidades) return 0;
  if (r.minValor > 0 && q * r.preco < r.minValor) return 0;
  return q;
}

/**
 * REGRA 4 — cascata gulosa por prioridade.
 * Para os N baldes de demanda na ordem escolhida:
 *   transf[i] = ajustarLote(MIN(demanda[i], saldo))
 * Sem regras de lote é exatamente `CLAMP(excesso − cumsum_anterior, 0, p[i])`.
 */
export function cascata(demanda: number[], excesso: number, regras?: RegrasLote): number[] {
  const n = demanda.length;
  const transf = new Array<number>(n).fill(0);
  let saldo = excesso;
  for (let i = 0; i < n; i++) {
    if (saldo <= EPS) break;
    const bruto = Math.min(demanda[i], saldo);
    const q = regras ? ajustarLote(bruto, regras) : bruto;
    if (q > 0) {
      transf[i] = q;
      saldo -= q;
    }
  }
  return transf;
}

/** Mantido como referência da formulação vetorizada (cumsum-clamp). */
export function cascataCumsum(demanda: number[], excesso: number): number[] {
  return cascata(demanda, excesso);
}

/**
 * Distribui o excesso entre destinos NIVELANDO os dias de cobertura
 * (water-filling): enche primeiro quem está mais descoberto, até igualar ao
 * próximo, e assim por diante. Evita que o último da fila fique em ruptura
 * quando o excesso é escasso.
 *
 * @param necessidade limite de cada destino (unidades) — índice = ordem do destino
 * @param estoqueDia  estoque projetado de cada destino, em unidades
 * @param vd          venda diária de cada destino (0 = sem giro)
 * @param excesso     unidades a distribuir
 * @returns unidades por destino (mesma indexação)
 */
export function nivelarPorCobertura(
  necessidade: number[],
  estoqueDia: number[],
  vd: number[],
  excesso: number,
): number[] {
  const n = necessidade.length;
  const saida = new Array<number>(n).fill(0);
  let restante = excesso;

  // Só entram no nivelamento destinos com demanda e com giro.
  const ativos: number[] = [];
  for (let d = 0; d < n; d++) if (necessidade[d] > EPS && vd[d] > EPS) ativos.push(d);

  let guarda = 0;
  while (restante > EPS && ativos.length > 0 && guarda++ < 4 * n + 8) {
    // Cobertura atual (em dias) de cada ativo, já com o que foi alocado.
    let nivel = Infinity;
    for (const d of ativos) {
      const cob = (estoqueDia[d] + saida[d]) / vd[d];
      if (cob < nivel) nivel = cob;
    }
    // Grupo no nível mais baixo e o próximo degrau a alcançar.
    const grupo: number[] = [];
    let proximo = Infinity;
    for (const d of ativos) {
      const cob = (estoqueDia[d] + saida[d]) / vd[d];
      if (cob <= nivel + 1e-6) grupo.push(d);
      else if (cob < proximo) proximo = cob;
    }
    let somaVenda = 0;
    for (const d of grupo) somaVenda += vd[d];
    if (somaVenda <= EPS) break;

    // Quanto podemos subir: até o próximo degrau, até acabar o excesso, ou até
    // o primeiro destino do grupo bater a própria necessidade.
    let deltaDias = Math.min(
      proximo === Infinity ? Infinity : proximo - nivel,
      restante / somaVenda,
    );
    for (const d of grupo) {
      const cabe = (necessidade[d] - saida[d]) / vd[d];
      if (cabe < deltaDias) deltaDias = cabe;
    }
    if (!(deltaDias > EPS)) {
      // Ninguém pode subir: remove os saturados e tenta de novo.
      for (let i = ativos.length - 1; i >= 0; i--) {
        if (necessidade[ativos[i]] - saida[ativos[i]] <= EPS) ativos.splice(i, 1);
      }
      if (grupo.every((d) => necessidade[d] - saida[d] <= EPS)) continue;
      break;
    }
    for (const d of grupo) {
      const q = Math.min(deltaDias * vd[d], necessidade[d] - saida[d], restante);
      saida[d] += q;
      restante -= q;
    }
    for (let i = ativos.length - 1; i >= 0; i--) {
      if (necessidade[ativos[i]] - saida[ativos[i]] <= EPS) ativos.splice(i, 1);
    }
  }

  // Sobra: destinos sem giro (ou remanescentes) atendidos na ordem de prioridade.
  if (restante > EPS) {
    for (let d = 0; d < n && restante > EPS; d++) {
      const cabe = necessidade[d] - saida[d];
      if (cabe <= EPS) continue;
      const q = Math.min(cabe, restante);
      saida[d] += q;
      restante -= q;
    }
  }
  return saida;
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
 * Sequência da análise (é o que o usuário configura na tela):
 *   para cada ORIGEM na ordem escolhida
 *     reparte o excesso entre os destinos — por prioridade estrita (mês →
 *     destino, no modo pedidos) ou nivelando dias de cobertura
 *
 * A demanda é um saldo COMPARTILHADO: o que a origem 1 atende some da fila da
 * origem 2. Por isso a ordem das origens muda o resultado.
 *
 * Um CD nunca transfere para si mesmo (o balde da própria origem é zerado).
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
  const fs = params.fatorSegurancaImediata;
  const validar = opts.validarInvariante ?? true;
  const progInt = opts.progressoIntervalo ?? 5000;
  const usarAprovadas = params.considerarAprovadas !== false;
  const comPendente = params.considerarPendenteOrigem !== false;
  const nivelar = params.estrategiaDestino === "nivelar_cobertura";
  const diasMax = params.coberturaMaxDestinoDias ?? 0;
  const diasMin = params.coberturaMinDestinoDias ?? 0;
  const caixaFechada = params.arredondarCaixaFechada === true;
  const minUn = params.minUnidadesLinha ?? 0;
  const minVal = params.minValorLinha ?? 0;
  const minValRota = params.minValorRota ?? 0;

  const posOrigem = new Map<number, number>();
  origens.forEach((cd, i) => posOrigem.set(cd, i));
  const posDestino = new Map<number, number>();
  destinos.forEach((cd, i) => posDestino.set(cd, i));

  // --- Agrupamento por produto (um passe pela base) --------------------------
  const porProduto = new Map<number, LinhaBase[]>();
  for (const l of base) {
    if (!posOrigem.has(l.cd) && !posDestino.has(l.cd)) continue;
    const arr = porProduto.get(l.codigoProduto);
    if (arr) arr.push(l);
    else porProduto.set(l.codigoProduto, [l]);
  }

  const linhas: LinhaPlano[] = [];

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
    necessidadeBrutaQtd: 0,
    necessidadeQtd: 0,
    necessidadeRs: 0,
    atendidoQtd: 0,
    atendidoRs: 0,
    aberto: 0,
    cobertura: 0,
  }));

  let necessidadeTotalRs = 0;
  let paresOrigemProduto = 0;
  let invarianteOk = true;
  let maiorDivergencia = 0;
  let autoTransferencias = 0;

  // Buffers reaproveitados entre produtos (evita alocação por SKU).
  const mesBuf = new Array<number>(Math.max(nMes * nDst, 1)).fill(0); // modo pedidos
  const totBuf = new Array<number>(nDst).fill(0); // necessidade total por destino
  const linhaOrigem = new Array<LinhaBase | undefined>(nOri);
  const linhaDestino = new Array<LinhaBase | undefined>(nDst);
  const precoRef = new Array<number>(nOri);
  const alvoDst = new Array<number>(nDst).fill(0); // alocação por destino (nivelamento)
  const estoqueDst = new Array<number>(nDst).fill(0);
  const vdDst = new Array<number>(nDst).fill(0);
  const transfDst = new Array<number>(nDst).fill(0);
  const perdaDst = new Array<number>(nDst).fill(0);
  const demandaVistaDst = new Array<number>(nDst).fill(0);
  const transfDstMes: number[][] = Array.from({ length: nDst }, () => new Array<number>(nMes).fill(0));
  const demandaDstMes: number[][] = Array.from({ length: nDst }, () => new Array<number>(nMes).fill(0));

  let processados = 0;
  const totalProdutos = porProduto.size;

  for (const [codigoProduto, linhasProduto] of porProduto) {
    processados++;
    if (opts.onProgresso && processados % progInt === 0) opts.onProgresso(processados / totalProdutos);

    linhaOrigem.fill(undefined);
    linhaDestino.fill(undefined);
    for (const l of linhasProduto) {
      const io = posOrigem.get(l.cd);
      if (io !== undefined) linhaOrigem[io] = l;
      const id = posDestino.get(l.cd);
      if (id !== undefined) linhaDestino[id] = l;
    }

    // Preço de referência do produto (valoriza a necessidade do destino).
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

    // ----------------------- Demanda de cada destino -----------------------
    let demandaTotalProduto = 0;
    for (let d = 0; d < nDst; d++) {
      const ld = linhaDestino[d];
      const transito = usarAprovadas
        ? compromissos.entradaDestino.get(chaveCdProduto(destinos[d], codigoProduto)) ?? 0
        : 0;

      // Demanda bruta (antes de teto/piso).
      let bruta = 0;
      if (usaPedidos) {
        for (let m = 0; m < nMes; m++) {
          const ped = pedidosIndex.get(chavePedido(meses[m], destinos[d], codigoProduto)) ?? 0;
          mesBuf[m * nDst + d] = ped;
          bruta += ped;
        }
      } else {
        bruta = ld ? necessidadeSaldoIdeal(ld) : 0;
      }
      resumoDestino[d].necessidadeBrutaQtd += bruta;

      // Trânsito aprovado abate primeiro (meses mais próximos no modo pedidos).
      let liquida = bruta;
      if (transito > 0) {
        if (usaPedidos) {
          let resto = transito;
          for (let m = 0; m < nMes && resto > 0; m++) {
            const b = m * nDst + d;
            const abate = Math.min(resto, mesBuf[b]);
            mesBuf[b] -= abate;
            resto -= abate;
          }
          liquida = Math.max(bruta - transito, 0);
        } else {
          liquida = Math.max(bruta - transito, 0);
        }
      }

      // Piso e teto de cobertura (só fazem sentido com giro e cadastro no CD).
      if (ld) {
        const piso = limitePorCobertura(ld, diasMin, transito);
        if (piso !== null && piso > liquida) {
          const falta = piso - liquida;
          if (usaPedidos) mesBuf[0 * nDst + d] += falta; // antirruptura entra já no 1º mês
          liquida = piso;
        }
        const teto = limitePorCobertura(ld, diasMax, transito);
        if (teto !== null && liquida > teto) {
          if (usaPedidos) {
            // Corta do mês mais distante para o mais próximo.
            let excedente = liquida - teto;
            for (let m = nMes - 1; m >= 0 && excedente > 0; m--) {
              const b = m * nDst + d;
              const corte = Math.min(excedente, mesBuf[b]);
              mesBuf[b] -= corte;
              excedente -= corte;
            }
          }
          liquida = teto;
        }
      }

      totBuf[d] = liquida;
      estoqueDst[d] = ld ? ld.estoqueDisponivel + ld.quantidadePendente + transito : 0;
      vdDst[d] = ld ? vendaDia(ld) : 0;
      resumoDestino[d].necessidadeQtd += liquida;
      resumoDestino[d].necessidadeRs += liquida * precoProduto;
      demandaTotalProduto += liquida;
    }
    necessidadeTotalRs += demandaTotalProduto * precoProduto;

    // ------------------------- Excesso de cada origem ----------------------
    let temExcesso = false;
    for (let i = 0; i < nOri; i++) {
      const lo = linhaOrigem[i];
      if (!lo) continue;
      let exc = excessoTransferivel(lo, comPendente);
      if (usarAprovadas && exc > 0) {
        exc = Math.max(exc - (compromissos.saidaOrigem.get(chaveCdProduto(origens[i], codigoProduto)) ?? 0), 0);
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

    // ------------- Alocação: origem por origem, na ordem escolhida ---------
    for (let i = 0; i < nOri; i++) {
      const lo = linhaOrigem[i];
      if (!lo) continue;
      const cdO = origens[i];
      let excesso = excessoTransferivel(lo, comPendente);
      if (usarAprovadas && excesso > 0) {
        excesso = Math.max(
          excesso - (compromissos.saidaOrigem.get(chaveCdProduto(cdO, codigoProduto)) ?? 0),
          0,
        );
      }
      if (excesso <= EPS) continue;

      const preco = precoRef[i];
      const regras: RegrasLote = {
        embCompra: lo.embCompra,
        preco,
        caixaFechada,
        minUnidades: minUn,
        minValor: minVal,
      };
      const slotProprio = posDestino.get(cdO); // a origem nunca é destino de si mesma

      for (let d = 0; d < nDst; d++) {
        transfDst[d] = 0;
        perdaDst[d] = 0;
        demandaVistaDst[d] = slotProprio === d ? 0 : totBuf[d];
        for (let m = 0; m < nMes; m++) {
          transfDstMes[d][m] = 0;
          demandaDstMes[d][m] = slotProprio === d ? 0 : mesBuf[m * nDst + d];
        }
      }

      if (nivelar) {
        // Nivelamento por dias de cobertura entre os destinos elegíveis.
        for (let d = 0; d < nDst; d++) alvoDst[d] = demandaVistaDst[d];
        const alocado = nivelarPorCobertura(alvoDst, estoqueDst, vdDst, excesso);
        for (let d = 0; d < nDst; d++) {
          const q = ajustarLote(alocado[d], regras);
          if (q <= 0) continue;
          transfDst[d] = q;
          perdaDst[d] = Math.max(alocado[d] - q, 0);
          if (usaPedidos) {
            // Distribui a cota do destino do mês mais próximo para o mais distante.
            let resto = q;
            for (let m = 0; m < nMes && resto > EPS; m++) {
              const usa = Math.min(resto, demandaDstMes[d][m]);
              transfDstMes[d][m] = usa;
              resto -= usa;
            }
            if (resto > EPS && nMes > 0) transfDstMes[d][0] += resto; // piso antirruptura
          }
        }
      } else {
        // Prioridade estrita: mês → destino (modo pedidos) ou destino (saldo ideal).
        const nBaldes = usaPedidos ? nMes * nDst : nDst;
        const demandaBaldes = new Array<number>(nBaldes);
        for (let b = 0; b < nBaldes; b++) {
          demandaBaldes[b] = usaPedidos ? demandaDstMes[b % nDst][Math.floor(b / nDst)] : demandaVistaDst[b];
        }
        const alocado = cascata(demandaBaldes, excesso, regras);
        for (let b = 0; b < nBaldes; b++) {
          if (alocado[b] <= 0) continue;
          const d = usaPedidos ? b % nDst : b;
          const m = usaPedidos ? Math.floor(b / nDst) : -1;
          transfDst[d] += alocado[b];
          if (m >= 0) transfDstMes[d][m] = alocado[b];
        }
        if (caixaFechada || minUn > 0 || minVal > 0) {
          // O que a demanda pedia e o lote não permitiu enviar.
          let saldo = excesso;
          for (let b = 0; b < nBaldes; b++) {
            const bruto = Math.min(demandaBaldes[b], saldo);
            const d = usaPedidos ? b % nDst : b;
            perdaDst[d] += Math.max(bruto - alocado[b], 0);
            saldo -= alocado[b];
            if (saldo <= EPS) break;
          }
        }
      }

      // ------------------------- Materialização ---------------------------
      const cov = cobertura(lo, params.limiteCoberturaDias);
      let saldoImediato = Math.max(lo.estoqueDisponivel - lo.vendaMedia3m * fs, 0);
      let transferidoOrigem = 0;

      for (let d = 0; d < nDst; d++) {
        const cdD = destinos[d];
        const total = transfDst[d];
        if (total <= EPS) continue;
        if (cdD === cdO) {
          autoTransferencias++; // nunca deve ocorrer
          continue;
        }

        // Consome a demanda compartilhada (some para as próximas origens).
        totBuf[d] = Math.max(totBuf[d] - total, 0);
        if (usaPedidos) {
          for (let m = 0; m < nMes; m++) {
            const b = m * nDst + d;
            mesBuf[b] = Math.max(mesBuf[b] - transfDstMes[d][m], 0);
          }
        }
        transferidoOrigem += total;

        const valorTotal = total * preco;
        const baseImediata = usaPedidos ? transfDstMes[d][0] ?? 0 : total;
        const qtdImediata = Math.min(baseImediata, saldoImediato);
        saldoImediato = Math.max(saldoImediato - qtdImediata, 0);
        let imediataCaixas = 0;
        let qtdImediataArred = 0;
        if (lo.embCompra > 0 && qtdImediata > 0) {
          imediataCaixas = Math.max(roundDown(qtdImediata / lo.embCompra), 0);
          qtdImediataArred = imediataCaixas * lo.embCompra;
        }
        const rotaKey = chaveRota(cdO, cdD);
        const aliquota = params.aliquotas[rotaKey] ?? 0;

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
          demandaMes: usaPedidos ? [...demandaDstMes[d]] : [],
          transfMes: usaPedidos ? [...transfDstMes[d]] : [],
          demandaSaldo: usaPedidos ? 0 : demandaVistaDst[d],
          transfSaldo: usaPedidos ? 0 : total,
          transfTotal: total,
          perdaCaixaFechada: perdaDst[d],
          valorTotal,
          caixas: lo.embCompra > 0 ? round(total / lo.embCompra) : 0,
          qtdImediata,
          imediataCaixas,
          qtdImediataArredondada: qtdImediataArred,
          valorImediata: qtdImediataArred * preco,
          coberturaDias: cov.dias,
          statusCobertura: cov.status,
          aliquota,
          impactoFiscal: valorTotal * aliquota,
        });
      }

      if (validar && transferidoOrigem - excesso > 1e-6) {
        invarianteOk = false;
        maiorDivergencia = Math.max(maiorDivergencia, transferidoOrigem - excesso);
      }
    }
  }

  // --------- Carga mínima por rota: rota abaixo do piso não embarca ---------
  let linhasFinais = linhas;
  if (minValRota > 0) {
    const valorPorRota = new Map<string, number>();
    for (const l of linhas) valorPorRota.set(l.rota, (valorPorRota.get(l.rota) ?? 0) + l.valorTotal);
    const descartadas = new Set<string>();
    for (const [rota, valor] of valorPorRota) if (valor < minValRota) descartadas.add(rota);
    if (descartadas.size > 0) linhasFinais = linhas.filter((l) => !descartadas.has(l.rota));
  }

  // ------------------------- Resumos a partir das linhas -------------------
  const rotaMap = new Map<string, ResumoRota>();
  const skusDistintos = new Set<number>();
  let valorTransfTotal = 0;
  let qtdTransfTotal = 0;
  let valorImediataTotal = 0;
  let impactoFiscalTotal = 0;

  for (const l of linhasFinais) {
    let r = rotaMap.get(l.rota);
    if (!r) {
      r = {
        cdOrigem: l.cdOrigem,
        cdDestino: l.cdDestino,
        rota: l.rota,
        aliquota: l.aliquota,
        aliquotaDefinida: params.aliquotas[l.rota] !== undefined,
        qtdMes: new Array(nMes).fill(0),
        valorMes: new Array(nMes).fill(0),
        qtd: 0,
        valor: 0,
        qtdImediata: 0,
        valorImediata: 0,
        impactoFiscal: 0,
        linhas: 0,
      };
      rotaMap.set(l.rota, r);
    }
    for (let m = 0; m < nMes; m++) {
      const t = l.transfMes[m] ?? 0;
      r.qtdMes[m] += t;
      r.valorMes[m] += t * l.precoUnitario;
    }
    r.qtd += l.transfTotal;
    r.valor += l.valorTotal;
    r.qtdImediata += l.qtdImediata;
    r.valorImediata += l.valorImediata;
    r.impactoFiscal += l.impactoFiscal;
    r.linhas++;

    const ro = resumoOrigem[posOrigem.get(l.cdOrigem) ?? -1];
    if (ro) {
      ro.transferidoQtd += l.transfTotal;
      ro.transferidoRs += l.valorTotal;
    }
    const rd = resumoDestino[posDestino.get(l.cdDestino) ?? -1];
    if (rd) {
      rd.atendidoQtd += l.transfTotal;
      rd.atendidoRs += l.valorTotal;
    }

    skusDistintos.add(l.codigoProduto);
    valorTransfTotal += l.valorTotal;
    qtdTransfTotal += l.transfTotal;
    valorImediataTotal += l.valorImediata;
    impactoFiscalTotal += l.impactoFiscal;
  }

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

  const posO = new Map(origens.map((c, i) => [c, i]));
  const posD = new Map(destinos.map((c, i) => [c, i]));
  const rotas = Array.from(rotaMap.values()).sort(
    (a, b) =>
      (posO.get(a.cdOrigem) ?? 99) - (posO.get(b.cdOrigem) ?? 99) ||
      (posD.get(a.cdDestino) ?? 99) - (posD.get(b.cdDestino) ?? 99),
  );
  const rotasSemAliquota = rotas.filter((r) => !r.aliquotaDefinida && r.valor > 0).map((r) => r.rota);
  const excessoDisponivelRs = resumoOrigem.reduce((a, r) => a + r.excessoRs, 0);

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
    linhas: linhasFinais,
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
      excessoUtilizadoRs: valorTransfTotal,
      necessidadeTotalRs,
      necessidadeAtendidaRs: valorTransfTotal,
      valorTransfTotal,
      valorImediataTotal,
      impactoFiscalTotal,
      qtdTransfTotal,
      linhasPlano: linhasFinais.length,
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

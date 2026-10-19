import type { Sugestao } from "@/lib/store/carteira";

/**
 * ACOMPANHAMENTO — o que foi aprovado virou NF? Em quanto tempo?
 *
 * Duas perguntas, uma passada sobre a carteira:
 *
 * 1. **Aprovado × faturado**, por rota, por CD de origem e por CD de destino.
 *    Cada sugestão se divide em três partes que somam o aprovado:
 *      aprovado = faturado + em aberto + cancelado
 *    O atendimento é `faturado ÷ (aprovado − cancelado)`: o que foi cancelado
 *    saiu do compromisso e não conta contra a operação.
 *
 * 2. **Tempo da aprovação até a NF.** Cada baixa é medida em dias desde a
 *    aprovação da sugestão e pesa pela quantidade faturada — uma NF de 1.000
 *    unidades diz mais sobre a operação que uma de 3. A mediana responde
 *    "metade do volume faturou em até N dias".
 *
 * Função pura: a mesma conta vale para o banco e para o modo em memória.
 */

export interface Faixa {
  rotulo: string;
  /** Limite superior em dias (inclusive); `null` = sem limite. */
  ate: number | null;
}

export const FAIXAS_DIAS: Faixa[] = [
  { rotulo: "Até 7 dias", ate: 7 },
  { rotulo: "8 a 15 dias", ate: 15 },
  { rotulo: "16 a 30 dias", ate: 30 },
  { rotulo: "Mais de 30 dias", ate: null },
];

export interface Volume {
  sugestoes: number;
  aprovadoQtd: number;
  aprovadoValor: number;
  faturadoQtd: number;
  faturadoValor: number;
  abertoQtd: number;
  abertoValor: number;
  canceladoQtd: number;
  canceladoValor: number;
  /** faturado ÷ (aprovado − cancelado), de 0 a 1. */
  atendimento: number;
}

export interface Prazo {
  /** Unidades faturadas que entraram na medição. */
  qtd: number;
  /** Número de baixas (linhas de NF casadas). */
  baixas: number;
  mediaDias: number | null;
  medianaDias: number | null;
  p90Dias: number | null;
}

export interface FaixaVolume extends Faixa {
  qtd: number;
  /** Fatia do total da distribuição, de 0 a 1. */
  pct: number;
}

export interface LinhaGrupo extends Volume {
  chave: string;
  cdOrigem: number | null;
  cdDestino: number | null;
  prazo: Prazo;
}

export interface Acompanhamento {
  total: Volume;
  prazo: Prazo;
  /** Volume faturado por tempo até a NF. */
  faixasPrazo: FaixaVolume[];
  /** Saldo em aberto por idade da aprovação: quanto está parado há quanto tempo. */
  faixasAberto: FaixaVolume[];
  porRota: LinhaGrupo[];
  porOrigem: LinhaGrupo[];
  porDestino: LinhaGrupo[];
}

const DIA_MS = 86400000;

/** Dias inteiros decorridos de `de` até `ate` (nunca negativo). */
export function diasEntre(de: string, ate: string | number): number {
  const fim = typeof ate === "number" ? ate : new Date(ate).getTime();
  const d = Math.floor((fim - new Date(de).getTime()) / DIA_MS);
  return Number.isFinite(d) ? Math.max(0, d) : 0;
}

function volumeVazio(): Volume {
  return {
    sugestoes: 0, aprovadoQtd: 0, aprovadoValor: 0, faturadoQtd: 0, faturadoValor: 0,
    abertoQtd: 0, abertoValor: 0, canceladoQtd: 0, canceladoValor: 0, atendimento: 0,
  };
}

/** As três partes de uma sugestão, que somam o aprovado. */
function partes(s: Sugestao): { aprovado: number; faturado: number; aberto: number; cancelado: number } {
  const aprovado = Math.max(s.qtd, 0);
  // Reaprovação pode baixar a quantidade abaixo do já faturado: o faturado
  // nunca passa do aprovado, senão a identidade quebra.
  const faturado = Math.min(Math.max(s.qtdFaturada, 0), aprovado);
  const resto = aprovado - faturado;
  return {
    aprovado,
    faturado,
    aberto: s.status === "aprovada" ? resto : 0,
    cancelado: s.status === "cancelada" ? resto : 0,
  };
}

function somar(v: Volume, s: Sugestao): void {
  const p = partes(s);
  const preco = s.preco || 0;
  v.sugestoes++;
  v.aprovadoQtd += p.aprovado;
  v.aprovadoValor += p.aprovado * preco;
  v.faturadoQtd += p.faturado;
  v.faturadoValor += p.faturado * preco;
  v.abertoQtd += p.aberto;
  v.abertoValor += p.aberto * preco;
  v.canceladoQtd += p.cancelado;
  v.canceladoValor += p.cancelado * preco;
}

function fechar(v: Volume): Volume {
  const base = v.aprovadoQtd - v.canceladoQtd;
  v.atendimento = base > 0 ? Math.min(1, v.faturadoQtd / base) : 0;
  return v;
}

/** Amostra de prazo: `dias` com peso `qtd`. */
type Amostra = [dias: number, qtd: number];

/** Quantil ponderado: menor `dias` cujo peso acumulado alcança `q` do total. */
function quantil(ordenadas: Amostra[], total: number, q: number): number | null {
  if (total <= 0) return null;
  const alvo = total * q;
  let acc = 0;
  for (const [dias, qtd] of ordenadas) {
    acc += qtd;
    if (acc >= alvo - 1e-9) return dias;
  }
  return ordenadas[ordenadas.length - 1]?.[0] ?? null;
}

function resumirPrazo(amostras: Amostra[]): Prazo {
  const validas = amostras.filter(([, q]) => q > 0);
  const total = validas.reduce((a, [, q]) => a + q, 0);
  if (total <= 0) return { qtd: 0, baixas: 0, mediaDias: null, medianaDias: null, p90Dias: null };
  const ordenadas = [...validas].sort((a, b) => a[0] - b[0]);
  return {
    qtd: total,
    baixas: validas.length,
    mediaDias: validas.reduce((a, [d, q]) => a + d * q, 0) / total,
    medianaDias: quantil(ordenadas, total, 0.5),
    p90Dias: quantil(ordenadas, total, 0.9),
  };
}

function distribuir(amostras: Amostra[]): FaixaVolume[] {
  const qtds = FAIXAS_DIAS.map(() => 0);
  for (const [dias, qtd] of amostras) {
    const i = FAIXAS_DIAS.findIndex((f) => f.ate == null || dias <= f.ate);
    qtds[i] += qtd;
  }
  const total = qtds.reduce((a, b) => a + b, 0);
  return FAIXAS_DIAS.map((f, i) => ({ ...f, qtd: qtds[i], pct: total > 0 ? qtds[i] / total : 0 }));
}

/** Amostras de prazo de uma sugestão: uma por baixa, limitadas ao aprovado. */
function amostrasDe(s: Sugestao): Amostra[] {
  const out: Amostra[] = [];
  let restante = Math.max(s.qtd, 0);
  for (const b of s.baixas ?? []) {
    const q = Math.min(Math.max(b.qtd, 0), restante);
    if (q <= 0) continue;
    restante -= q;
    out.push([diasEntre(s.criadoEm, b.em), q]);
  }
  return out;
}

interface Acumulador {
  vol: Volume;
  amostras: Amostra[];
  cdOrigem: number | null;
  cdDestino: number | null;
}

function linhas(mapa: Map<string, Acumulador>): LinhaGrupo[] {
  return Array.from(mapa.entries())
    .map(([chave, a]) => ({ chave, cdOrigem: a.cdOrigem, cdDestino: a.cdDestino, ...fechar(a.vol), prazo: resumirPrazo(a.amostras) }))
    .sort((x, y) => y.aprovadoValor - x.aprovadoValor || x.chave.localeCompare(y.chave));
}

/**
 * Consolida a carteira. `agora` é a referência para a idade do saldo em aberto
 * (parâmetro para o teste não depender do relógio).
 */
export function calcularAcompanhamento(sugestoes: Sugestao[], agora: number = Date.now()): Acompanhamento {
  const total = volumeVazio();
  const todasAmostras: Amostra[] = [];
  const idadesAberto: Amostra[] = [];
  const porRota = new Map<string, Acumulador>();
  const porOrigem = new Map<string, Acumulador>();
  const porDestino = new Map<string, Acumulador>();

  const pegar = (m: Map<string, Acumulador>, chave: string, o: number | null, d: number | null) => {
    let a = m.get(chave);
    if (!a) {
      a = { vol: volumeVazio(), amostras: [], cdOrigem: o, cdDestino: d };
      m.set(chave, a);
    }
    return a;
  };

  for (const s of sugestoes) {
    const amostras = amostrasDe(s);
    const grupos = [
      pegar(porRota, `${s.cdOrigem}>${s.cdDestino}`, s.cdOrigem, s.cdDestino),
      pegar(porOrigem, String(s.cdOrigem), s.cdOrigem, null),
      pegar(porDestino, String(s.cdDestino), null, s.cdDestino),
    ];
    somar(total, s);
    for (const g of grupos) {
      somar(g.vol, s);
      g.amostras.push(...amostras);
    }
    todasAmostras.push(...amostras);
    const aberto = partes(s).aberto;
    if (aberto > 0) idadesAberto.push([diasEntre(s.criadoEm, agora), aberto]);
  }

  return {
    total: fechar(total),
    prazo: resumirPrazo(todasAmostras),
    faixasPrazo: distribuir(todasAmostras),
    faixasAberto: distribuir(idadesAberto),
    porRota: linhas(porRota),
    porOrigem: linhas(porOrigem),
    porDestino: linhas(porDestino),
  };
}

import { LinhaPlano, Parametros, ResumoCd } from "@/lib/engine/types";

/**
 * Reagrega o resumo por CD (× mês no DRP; único no modelo objetivo) a partir de
 * um subconjunto de linhas do plano (ex.: após aplicar o filtro de cobertura).
 * Mantém a mesma semântica do motor nos dois modelos.
 */
export function agregarResumo(linhas: LinhaPlano[], params: Parametros): ResumoCd[] {
  const nMes = params.horizonteMeses.length;
  const map = new Map<number, ResumoCd>();
  for (const cd of params.prioridadeCds) {
    map.set(cd, {
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
  for (const l of linhas) {
    const r = map.get(l.cdDestino);
    if (!r) continue;
    let valorHorizonte = l.valorTransfObjetivo ?? 0;
    for (let m = 0; m < nMes; m++) {
      r.transfMes[m] += l.transfMes[m] ?? 0;
      r.valorTransfMes[m] += l.valorTransfMes[m] ?? 0;
      valorHorizonte += l.valorTransfMes[m] ?? 0;
    }
    r.transfObjetivo += l.transfObjetivo ?? 0;
    r.valorTransfObjetivo += l.valorTransfObjetivo ?? 0;
    r.qtdImediata += l.qtdTransfImediata;
    r.valorImediata += l.valorTransfImediata;
    r.impactoFiscal += valorHorizonte * r.aliquotaFiscal;
  }
  return params.prioridadeCds.map((cd) => map.get(cd)!);
}

export interface KpisDashboard {
  excessoSimplesRs: number;
  excessoTransferivelRs: number;
  valorTransfMes: number[];
  valorTransfObjetivo: number; // total para atender estoque objetivo (modelo 2)
  valorTransfTotal: number; // meses + objetivo (headline do dashboard)
  valorImediata: number;
  impactoFiscalTotal: number;
  linhasPlano: number;
  skusDistintos: number;
  meses: string[];
  alertaAliquotas: number[];
}

export function calcularKpis(linhas: LinhaPlano[], resumo: ResumoCd[], params: Parametros, excessoSimplesRs: number, excessoTransferivelRs: number): KpisDashboard {
  const nMes = params.horizonteMeses.length;
  const valorTransfMes = new Array(nMes).fill(0);
  let valorTransfObjetivo = 0;
  const skus = new Set<string>();
  for (const l of linhas) {
    skus.add(l.idSku);
    for (let m = 0; m < nMes; m++) valorTransfMes[m] += l.valorTransfMes[m] ?? 0;
    valorTransfObjetivo += l.valorTransfObjetivo ?? 0;
  }
  const valorMesesTotal = valorTransfMes.reduce((a, b) => a + b, 0);
  return {
    excessoSimplesRs,
    excessoTransferivelRs,
    valorTransfMes,
    valorTransfObjetivo,
    valorTransfTotal: valorMesesTotal + valorTransfObjetivo,
    valorImediata: resumo.reduce((a, r) => a + r.valorImediata, 0),
    impactoFiscalTotal: resumo.reduce((a, r) => a + r.impactoFiscal, 0),
    linhasPlano: linhas.length,
    skusDistintos: skus.size,
    meses: params.horizonteMeses,
    alertaAliquotas: resumo.filter((r) => !r.aliquotaDefinida && (r.valorTransfMes.some((v) => v > 0) || r.valorTransfObjetivo > 0)).map((r) => r.cdDestino),
  };
}

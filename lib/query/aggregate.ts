import { LinhaPlano, Parametros, ResumoCd } from "@/lib/engine/types";

/**
 * Reagrega o resumo por CD × mês a partir de um subconjunto de linhas do plano
 * (ex.: após aplicar o filtro de cobertura). Mantém a mesma semântica do motor.
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
      qtdImediata: 0,
      valorImediata: 0,
      impactoFiscal: 0,
    });
  }
  for (const l of linhas) {
    const r = map.get(l.cdDestino);
    if (!r) continue;
    let valorHorizonte = 0;
    for (let m = 0; m < nMes; m++) {
      r.transfMes[m] += l.transfMes[m] ?? 0;
      r.valorTransfMes[m] += l.valorTransfMes[m] ?? 0;
      valorHorizonte += l.valorTransfMes[m] ?? 0;
    }
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
  valorTransfTotal: number;
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
  const skus = new Set<string>();
  for (const l of linhas) {
    skus.add(l.idSku);
    for (let m = 0; m < nMes; m++) valorTransfMes[m] += l.valorTransfMes[m] ?? 0;
  }
  return {
    excessoSimplesRs,
    excessoTransferivelRs,
    valorTransfMes,
    valorTransfTotal: valorTransfMes.reduce((a, b) => a + b, 0),
    valorImediata: resumo.reduce((a, r) => a + r.valorImediata, 0),
    impactoFiscalTotal: resumo.reduce((a, r) => a + r.impactoFiscal, 0),
    linhasPlano: linhas.length,
    skusDistintos: skus.size,
    meses: params.horizonteMeses,
    alertaAliquotas: resumo.filter((r) => !r.aliquotaDefinida && r.valorTransfMes.some((v) => v > 0)).map((r) => r.cdDestino),
  };
}

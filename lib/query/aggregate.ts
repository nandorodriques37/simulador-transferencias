import { chaveRota, LinhaPlano, ParametrosRede, ResumoDestino, ResumoOrigem, ResumoRota } from "@/lib/engine/types";

/**
 * Reagrega as rotas (origem → destino) a partir de um subconjunto de linhas do
 * plano (ex.: depois do filtro de cobertura). Mantém a mesma semântica do motor.
 */
export function agregarRotas(
  linhas: LinhaPlano[],
  params: ParametrosRede,
  rotasBase: ResumoRota[] = [],
): ResumoRota[] {
  // A leitura de capacidade vem do cálculo (é da análise inteira, não do filtro).
  const capPorRota = new Map(rotasBase.map((r) => [r.rota, r]));
  const nMes = params.modoDemanda === "pedidos" ? params.horizonteMeses.length : 0;
  const map = new Map<string, ResumoRota>();
  for (const l of linhas) {
    const rota = chaveRota(l.cdOrigem, l.cdDestino);
    let r = map.get(rota);
    if (!r) {
      const base = capPorRota.get(rota);
      r = {
        cdOrigem: l.cdOrigem,
        cdDestino: l.cdDestino,
        rota,
        aliquota: params.aliquotas[rota] ?? 0,
        aliquotaDefinida: params.aliquotas[rota] !== undefined,
        qtdMes: new Array(nMes).fill(0),
        valorMes: new Array(nMes).fill(0),
        qtd: 0,
        valor: 0,
        qtdImediata: 0,
        valorImediata: 0,
        impactoFiscal: 0,
        linhas: 0,
        capacidadeLimite: base?.capacidadeLimite ?? 0,
        capacidadeComprometida: base?.capacidadeComprometida ?? 0,
        capacidadeUsada: base?.capacidadeUsada ?? 0,
        bloqueadoPorCapacidade: base?.bloqueadoPorCapacidade ?? 0,
      };
      map.set(rota, r);
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
  }
  // Ordena pela sequência escolhida (origem, depois destino).
  const posO = new Map(params.origens.map((c, i) => [c, i]));
  const posD = new Map(params.destinos.map((c, i) => [c, i]));
  return Array.from(map.values()).sort(
    (a, b) =>
      (posO.get(a.cdOrigem) ?? 99) - (posO.get(b.cdOrigem) ?? 99) ||
      (posD.get(a.cdDestino) ?? 99) - (posD.get(b.cdDestino) ?? 99),
  );
}

/** Reagrega o total enviado por CD de origem (sobre as linhas filtradas). */
export function agregarPorOrigem(linhas: LinhaPlano[], baseOrigens: ResumoOrigem[]): ResumoOrigem[] {
  const map = new Map<number, ResumoOrigem>();
  for (const o of baseOrigens) map.set(o.cd, { ...o, transferidoQtd: 0, transferidoRs: 0 });
  for (const l of linhas) {
    const o = map.get(l.cdOrigem);
    if (!o) continue;
    o.transferidoQtd += l.transfTotal;
    o.transferidoRs += l.valorTotal;
  }
  for (const o of map.values()) {
    o.sobraQtd = Math.max(o.excessoQtd - o.transferidoQtd, 0);
    o.sobraRs = Math.max(o.excessoRs - o.transferidoRs, 0);
  }
  return Array.from(map.values()).sort((a, b) => a.ordem - b.ordem);
}

/** Reagrega o atendimento por CD de destino (sobre as linhas filtradas). */
export function agregarPorDestino(linhas: LinhaPlano[], baseDestinos: ResumoDestino[]): ResumoDestino[] {
  const map = new Map<number, ResumoDestino>();
  for (const d of baseDestinos) map.set(d.cd, { ...d, atendidoQtd: 0, atendidoRs: 0 });

  for (const l of linhas) {
    const d = map.get(l.cdDestino);
    if (!d) continue;
    d.atendidoQtd += l.transfTotal;
    d.atendidoRs += l.valorTotal;
  }
  for (const d of map.values()) {
    d.aberto = Math.max(d.necessidadeQtd - d.atendidoQtd, 0);
    d.cobertura = d.necessidadeQtd > 0 ? d.atendidoQtd / d.necessidadeQtd : 0;
  }
  return Array.from(map.values()).sort((a, b) => a.ordem - b.ordem);
}

export interface Kpis {
  excessoDisponivelRs: number;
  excessoUtilizadoRs: number;
  necessidadeTotalRs: number;
  necessidadeAtendidaRs: number;
  coberturaNecessidade: number; // 0..1
  usoDoExcesso: number; // 0..1
  valorTransfTotal: number;
  qtdTransfTotal: number;
  valorImediata: number;
  impactoFiscalTotal: number;
  linhasPlano: number;
  skusDistintos: number;
  rotasAtivas: number;
  rotasSemAliquota: string[];
}

export function calcularKpis(
  linhas: LinhaPlano[],
  rotas: ResumoRota[],
  meta: { excessoDisponivelRs: number; necessidadeTotalRs: number },
): Kpis {
  let valor = 0;
  let qtd = 0;
  let imediata = 0;
  let fiscal = 0;
  const skus = new Set<number>();
  for (const l of linhas) {
    valor += l.valorTotal;
    qtd += l.transfTotal;
    imediata += l.valorImediata;
    fiscal += l.impactoFiscal;
    skus.add(l.codigoProduto);
  }
  return {
    excessoDisponivelRs: meta.excessoDisponivelRs,
    excessoUtilizadoRs: valor,
    necessidadeTotalRs: meta.necessidadeTotalRs,
    necessidadeAtendidaRs: valor,
    coberturaNecessidade: meta.necessidadeTotalRs > 0 ? valor / meta.necessidadeTotalRs : 0,
    usoDoExcesso: meta.excessoDisponivelRs > 0 ? valor / meta.excessoDisponivelRs : 0,
    valorTransfTotal: valor,
    qtdTransfTotal: qtd,
    valorImediata: imediata,
    impactoFiscalTotal: fiscal,
    linhasPlano: linhas.length,
    skusDistintos: skus.size,
    rotasAtivas: rotas.filter((r) => r.valor > 0).length,
    rotasSemAliquota: rotas.filter((r) => !r.aliquotaDefinida && r.valor > 0).map((r) => r.rota),
  };
}

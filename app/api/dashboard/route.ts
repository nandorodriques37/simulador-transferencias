import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { agregarPorDestino, agregarPorOrigem, agregarRotas, calcularKpis } from "@/lib/query/aggregate";
import { filtrarPlano } from "@/lib/query/plano";
import { regrasEfetivas } from "@/lib/engine/calc";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const analise = store.getAnalise(sp.get("analiseId") ?? undefined);
  if (!analise)
    return NextResponse.json({ erro: "nenhuma análise rodada ainda", semAnalise: true }, { status: 404 });

  const cobertura = (sp.get("cobertura") as "total" | "acima_limite") ?? "total";
  const params = analise.parametros;
  const efetivas = regrasEfetivas(params);
  const linhas = filtrarPlano(analise.resultado.linhas, {
    cobertura,
    limiteDias: params.limiteCoberturaDias,
  });
  const rotas = agregarRotas(linhas, params, analise.resultado.rotas);
  const kpis = calcularKpis(linhas, rotas, {
    excessoDisponivelRs: analise.resultado.meta.excessoDisponivelRs,
    necessidadeTotalRs: analise.resultado.meta.necessidadeTotalRs,
  });

  return NextResponse.json({
    analise: {
      id: analise.id,
      label: analise.label,
      criadoEm: analise.criadoEm,
      criadoPor: analise.criadoPor,
      fonteBase: analise.fonteBase,
      fontePedidos: analise.fontePedidos,
    },
    cobertura,
    modoDemanda: params.modoDemanda,
    meses: analise.resultado.meta.meses,
    sequenciaOrigens: params.origens,
    sequenciaDestinos: params.destinos,
    consideraAprovadas: params.considerarAprovadas,
    regras: {
      coberturaMaxDestinoDias: efetivas.coberturaMax,
      coberturaMinDestinoDias: efetivas.coberturaMin,
      estrategiaDestino: params.estrategiaDestino ?? "prioridade",
      considerarPendenteOrigem: params.considerarPendenteOrigem !== false,
      arredondarCaixaFechada: efetivas.caixaFechada,
      minValorRota: efetivas.minValorRota,
      semRestricoes:
        efetivas.coberturaMax === 0 &&
        efetivas.coberturaMin === 0 &&
        !efetivas.caixaFechada &&
        efetivas.minValorRota === 0 &&
        efetivas.minUnidades === 0 &&
        efetivas.minValor === 0 &&
        Object.keys(efetivas.capacidade.porOrigem).length === 0 &&
        Object.keys(efetivas.capacidade.porDestino).length === 0 &&
        Object.keys(efetivas.capacidade.porRota).length === 0,
    },
    kpis,
    rotas,
    origens: agregarPorOrigem(linhas, analise.resultado.origens),
    destinos: agregarPorDestino(linhas, analise.resultado.destinos),
    capacidade: {
      metrica: analise.resultado.meta.metricaCapacidade,
      qtdBloqueada: analise.resultado.meta.qtdBloqueadaPorCapacidade,
      valorBloqueado: analise.resultado.meta.valorBloqueadoPorCapacidade,
      skusSemFator: analise.resultado.meta.skusSemFatorCapacidade,
      gargalos: analise.resultado.meta.gargalos,
    },
    tempoMs: analise.resultado.meta.tempoMs,
  });
}

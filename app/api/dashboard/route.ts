import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { agregarPorDestino, agregarPorOrigem, agregarRotas, calcularKpis } from "@/lib/query/aggregate";
import { filtrarPlano } from "@/lib/query/plano";
import { regrasEfetivas } from "@/lib/engine/calc";
import { analisesStore, AnaliseSalva } from "@/lib/store/analises";
import { ParametrosRede } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

function blocoRegras(params: ParametrosRede) {
  const efetivas = regrasEfetivas(params);
  return {
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
  };
}

/** Resposta montada a partir do RESULTADO salvo (sem o plano em memória). */
function doResultadoSalvo(a: AnaliseSalva) {
  const params = a.parametros;
  return {
    analise: {
      id: a.id,
      label: a.label,
      criadoEm: a.criadoEm,
      criadoPor: a.criadoPor,
      fonteBase: a.fonteBase,
      fontePedidos: "",
    },
    somenteResultado: true,
    cobertura: "total",
    modoDemanda: params.modoDemanda,
    meses: a.meses,
    sequenciaOrigens: params.origens,
    sequenciaDestinos: params.destinos,
    consideraAprovadas: params.considerarAprovadas,
    regras: blocoRegras(params),
    kpis: a.kpis,
    rotas: a.rotas,
    origens: a.origens,
    destinos: a.destinos,
    capacidade: {
      metrica: params.capacidade?.metrica ?? "unidades",
      qtdBloqueada: a.rotas.reduce((s, r) => s + (r.bloqueadoPorCapacidade ?? 0), 0)
        + a.origens.reduce((s, o) => s + (o.bloqueadoPorCapacidade ?? 0), 0)
        + a.destinos.reduce((s, d) => s + (d.bloqueadoPorCapacidade ?? 0), 0),
      valorBloqueado: 0,
      skusSemFator: 0,
      gargalos: [
        ...a.origens.filter((o) => o.bloqueadoPorCapacidade > 0).map((o) => ({ tipo: "origem" as const, id: `CD ${o.cd}`, bloqueado: o.bloqueadoPorCapacidade })),
        ...a.destinos.filter((d) => d.bloqueadoPorCapacidade > 0).map((d) => ({ tipo: "destino" as const, id: `CD ${d.cd}`, bloqueado: d.bloqueadoPorCapacidade })),
        ...a.rotas.filter((r) => r.bloqueadoPorCapacidade > 0).map((r) => ({ tipo: "rota" as const, id: r.rota, bloqueado: r.bloqueadoPorCapacidade })),
      ].sort((x, y) => y.bloqueado - x.bloqueado),
    },
    aprovado: a.aprovado ?? null,
    tempoMs: a.tempoMs,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const analise = store.getAnalise(sp.get("analiseId") ?? undefined);

  // Instância sem o plano em memória: serve o RESULTADO salvo (KPIs e resumos).
  if (!analise) {
    const salva = sp.get("analiseId")
      ? await analisesStore.obter(sp.get("analiseId")!)
      : await analisesStore.ultima();
    if (!salva) return NextResponse.json({ erro: "nenhuma análise rodada ainda", semAnalise: true }, { status: 404 });
    return NextResponse.json(doResultadoSalvo(salva));
  }

  const cobertura = (sp.get("cobertura") as "total" | "acima_limite") ?? "total";
  const params = analise.parametros;
  const linhas = filtrarPlano(analise.resultado.linhas, {
    cobertura,
    limiteDias: params.limiteCoberturaDias,
  });
  const rotas = agregarRotas(linhas, params, analise.resultado.rotas);
  const kpis = calcularKpis(linhas, rotas, {
    excessoDisponivelRs: analise.resultado.meta.excessoDisponivelRs,
    necessidadeTotalRs: analise.resultado.meta.necessidadeTotalRs,
  });
  const salva = await analisesStore.obter(analise.id);

  return NextResponse.json({
    analise: {
      id: analise.id,
      label: analise.label,
      criadoEm: analise.criadoEm,
      criadoPor: analise.criadoPor,
      fonteBase: analise.fonteBase,
      fontePedidos: analise.fontePedidos,
    },
    somenteResultado: false,
    cobertura,
    modoDemanda: params.modoDemanda,
    meses: analise.resultado.meta.meses,
    sequenciaOrigens: params.origens,
    sequenciaDestinos: params.destinos,
    consideraAprovadas: params.considerarAprovadas,
    regras: blocoRegras(params),
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
    aprovado: salva?.aprovado ?? null,
    tempoMs: analise.resultado.meta.tempoMs,
  });
}

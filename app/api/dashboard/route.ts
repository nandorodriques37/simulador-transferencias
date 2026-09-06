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

type Gargalo = { tipo: "origem" | "destino" | "rota"; id: string; bloqueado: number };

/** Gargalos derivados dos resumos — servem com ou sem o plano carregado. */
function gargalosDe(a: Pick<AnaliseSalva, "rotas" | "origens" | "destinos">): Gargalo[] {
  return [
    ...a.origens.filter((o) => o.bloqueadoPorCapacidade > 0).map((o) => ({ tipo: "origem" as const, id: `CD ${o.cd}`, bloqueado: o.bloqueadoPorCapacidade })),
    ...a.destinos.filter((d) => d.bloqueadoPorCapacidade > 0).map((d) => ({ tipo: "destino" as const, id: `CD ${d.cd}`, bloqueado: d.bloqueadoPorCapacidade })),
    ...a.rotas.filter((r) => r.bloqueadoPorCapacidade > 0).map((r) => ({ tipo: "rota" as const, id: r.rota, bloqueado: r.bloqueadoPorCapacidade })),
  ].sort((x, y) => y.bloqueado - x.bloqueado);
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
      gargalos: gargalosDe(a),
    },
    aprovado: a.aprovado ?? null,
    tempoMs: a.tempoMs,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("analiseId") ?? undefined;
  const salva = id ? await analisesStore.obter(id) : await analisesStore.ultima();
  const emMemoria = store.getAnalise(id);
  const cobertura = (sp.get("cobertura") as "total" | "acima_limite") ?? "total";

  // Sem filtro, os agregados salvos já respondem à tela inteira — não vale
  // baixar e reconstruir o plano só para chegar ao mesmo número.
  if (cobertura === "total" && !emMemoria && salva) {
    return NextResponse.json({
      ...doResultadoSalvo(salva),
      planoDisponivel: (salva.kpis?.linhasPlano ?? 0) > 0,
    });
  }

  // Com filtro de cobertura, precisamos das linhas: memória ou plano guardado.
  const plano = await store.obterPlano(id);
  if (!plano) {
    if (!salva) return NextResponse.json({ erro: "nenhuma análise rodada ainda", semAnalise: true }, { status: 404 });
    return NextResponse.json({ ...doResultadoSalvo(salva), cobertura: "total", planoDisponivel: false });
  }

  const params = plano.parametros;
  const linhas = filtrarPlano(plano.linhas, { cobertura, limiteDias: params.limiteCoberturaDias });
  const base = emMemoria?.resultado;
  const rotas = agregarRotas(linhas, params, base?.rotas ?? salva?.rotas ?? []);
  const kpis = calcularKpis(linhas, rotas, {
    excessoDisponivelRs: base?.meta.excessoDisponivelRs ?? salva?.kpis?.excessoDisponivelRs ?? 0,
    necessidadeTotalRs: base?.meta.necessidadeTotalRs ?? salva?.kpis?.necessidadeTotalRs ?? 0,
  });

  return NextResponse.json({
    analise: {
      id: plano.id,
      label: emMemoria?.label ?? salva?.label ?? "",
      criadoEm: emMemoria?.criadoEm ?? salva?.criadoEm ?? "",
      criadoPor: emMemoria?.criadoPor ?? salva?.criadoPor ?? "",
      fonteBase: emMemoria?.fonteBase ?? salva?.fonteBase ?? "",
      fontePedidos: emMemoria?.fontePedidos ?? "",
    },
    somenteResultado: false,
    planoDisponivel: true,
    cobertura,
    modoDemanda: params.modoDemanda,
    meses: plano.meses,
    sequenciaOrigens: params.origens,
    sequenciaDestinos: params.destinos,
    consideraAprovadas: params.considerarAprovadas,
    regras: blocoRegras(params),
    kpis,
    rotas,
    origens: agregarPorOrigem(linhas, base?.origens ?? salva?.origens ?? []),
    destinos: agregarPorDestino(linhas, base?.destinos ?? salva?.destinos ?? []),
    capacidade: {
      metrica: base?.meta.metricaCapacidade ?? params.capacidade?.metrica ?? "unidades",
      qtdBloqueada: base?.meta.qtdBloqueadaPorCapacidade ?? 0,
      valorBloqueado: base?.meta.valorBloqueadoPorCapacidade ?? 0,
      skusSemFator: base?.meta.skusSemFatorCapacidade ?? 0,
      gargalos: base?.meta.gargalos ?? (salva ? gargalosDe(salva) : []),
    },
    aprovado: salva?.aprovado ?? null,
    tempoMs: base?.meta.tempoMs ?? salva?.tempoMs ?? 0,
  });
}

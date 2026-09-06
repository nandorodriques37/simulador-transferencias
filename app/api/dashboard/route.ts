import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { agregarPorDestino, agregarPorOrigem, agregarRotas, calcularKpis } from "@/lib/query/aggregate";
import { filtrarPlano } from "@/lib/query/plano";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const analise = store.getAnalise(sp.get("analiseId") ?? undefined);
  if (!analise)
    return NextResponse.json({ erro: "nenhuma análise rodada ainda", semAnalise: true }, { status: 404 });

  const cobertura = (sp.get("cobertura") as "total" | "acima_limite") ?? "total";
  const params = analise.parametros;
  const linhas = filtrarPlano(analise.resultado.linhas, {
    cobertura,
    limiteDias: params.limiteCoberturaDias,
  });
  const rotas = agregarRotas(linhas, params);
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
    kpis,
    rotas,
    origens: agregarPorOrigem(linhas, analise.resultado.origens),
    destinos: agregarPorDestino(linhas, analise.resultado.destinos),
    tempoMs: analise.resultado.meta.tempoMs,
  });
}

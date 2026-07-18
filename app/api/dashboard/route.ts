import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { agregarResumo, calcularKpis } from "@/lib/query/aggregate";
import { filtrarPlano } from "@/lib/query/plano";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const versionId = sp.get("versionId") ?? undefined;
  const cobertura = (sp.get("cobertura") as "total" | "acima90") ?? "total";
  const versao = store.getVersao(versionId);
  if (!versao) return NextResponse.json({ erro: "versão não encontrada" }, { status: 404 });

  const params = versao.parametros;
  const todas = versao.resultado.linhas;
  const linhas = filtrarPlano(todas, { cobertura, limiteDias: params.limiteCoberturaDias });
  const resumo = agregarResumo(linhas, params);
  const kpis = calcularKpis(linhas, resumo, params, versao.resultado.meta.excessoSimplesRs, versao.resultado.meta.excessoTotalRs);

  return NextResponse.json({
    versao: { id: versao.id, label: versao.label, criadoEm: versao.criadoEm, criadoPor: versao.criadoPor },
    cobertura,
    meses: params.horizonteMeses,
    prioridadeCds: params.prioridadeCds,
    kpis,
    resumo,
    tempoMs: versao.resultado.meta.tempoMs,
  });
}

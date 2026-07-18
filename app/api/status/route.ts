import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const dataset = store.getDataset();
  const versao = store.getVersaoAtual();
  const params = store.getParametros();
  return NextResponse.json({
    dataset,
    parametros: params,
    versaoAtual: {
      id: versao.id,
      label: versao.label,
      criadoEm: versao.criadoEm,
      criadoPor: versao.criadoPor,
      meta: versao.resultado.meta,
      reconciliacao: versao.resultado.reconciliacao,
    },
  });
}

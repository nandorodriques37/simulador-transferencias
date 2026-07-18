import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Recalcula com os parâmetros atuais e persiste uma nova versão (snapshot). */
export async function POST(req: NextRequest) {
  const versao = store.runCalc(getUsuario(req), "Recálculo manual");
  return NextResponse.json({
    versaoId: versao.id,
    label: versao.label,
    criadoEm: versao.criadoEm,
    meta: versao.resultado.meta,
    reconciliacao: versao.resultado.reconciliacao,
  });
}

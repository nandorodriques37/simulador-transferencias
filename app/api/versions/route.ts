import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const versoes = store.listVersoes().map((v) => {
    const full = store.getVersao(v.id)!;
    return {
      id: v.id,
      label: v.label,
      criadoEm: v.criadoEm,
      criadoPor: v.criadoPor,
      paramsHash: v.paramsHash,
      modelo: full.resultado.meta.modelo,
      valorTransfTotal: full.resultado.meta.valorTransfMesTotal.reduce((a, b) => a + b, 0) + full.resultado.meta.valorTransfObjetivoTotal,
      valorImediata: full.resultado.meta.valorImediataTotal,
      impactoFiscal: full.resultado.meta.impactoFiscalTotal,
      linhas: full.resultado.linhas.length,
      tempoMs: full.resultado.meta.tempoMs,
    };
  });
  return NextResponse.json({ versoes });
}

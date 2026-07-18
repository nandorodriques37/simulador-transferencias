import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { Parametros, ResultadoCalculo } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

function resumir(res: ResultadoCalculo) {
  return {
    valorTransfMes: res.meta.valorTransfMesTotal,
    valorTransfTotal: res.meta.valorTransfMesTotal.reduce((a, b) => a + b, 0),
    valorImediata: res.meta.valorImediataTotal,
    impactoFiscal: res.meta.impactoFiscalTotal,
    linhas: res.linhas.length,
    tempoMs: res.meta.tempoMs,
    meses: res.meta.meses,
    porCd: res.resumo.map((r) => ({
      cd: r.cdDestino,
      valorTotal: r.valorTransfMes.reduce((a, b) => a + b, 0),
      valorImediata: r.valorImediata,
      impactoFiscal: r.impactoFiscal,
      qtdImediata: r.qtdImediata,
    })),
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { parametros: Parametros; salvarComo?: string };
  const params = body.parametros;
  const base = store.getVersaoAtual();
  const sim = store.simular(params);

  const baseResumo = resumir(base.resultado);
  const simResumo = resumir(sim);

  let cenario = null;
  if (body.salvarComo && body.salvarComo.trim()) {
    cenario = store.salvarCenario(body.salvarComo.trim(), params, getUsuario(req));
  }

  return NextResponse.json({
    base: { versaoId: base.id, parametros: base.parametros, resumo: baseResumo },
    simulado: { parametros: params, resumo: simResumo },
    delta: {
      valorTransfTotal: simResumo.valorTransfTotal - baseResumo.valorTransfTotal,
      valorImediata: simResumo.valorImediata - baseResumo.valorImediata,
      impactoFiscal: simResumo.impactoFiscal - baseResumo.impactoFiscal,
      linhas: simResumo.linhas - baseResumo.linhas,
    },
    cenario,
  });
}

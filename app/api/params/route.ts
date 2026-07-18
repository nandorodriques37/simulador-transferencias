import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { Parametros } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ parametros: store.getParametros(), historico: store.getParamHistorico() });
}

function validar(p: Partial<Parametros>): string | null {
  if (!Array.isArray(p.prioridadeCds) || p.prioridadeCds.length === 0) return "prioridadeCds inválida";
  if (!Array.isArray(p.horizonteMeses) || p.horizonteMeses.length === 0) return "horizonteMeses inválido";
  if (typeof p.fatorSegurancaImediata !== "number" || p.fatorSegurancaImediata < 0) return "fatorSegurancaImediata inválido";
  if (typeof p.limiteCoberturaDias !== "number" || p.limiteCoberturaDias <= 0) return "limiteCoberturaDias inválido";
  if (typeof p.aliquotaFiscal !== "object" || p.aliquotaFiscal === null) return "aliquotaFiscal inválida";
  return null;
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<Parametros>;
  const erro = validar(body);
  if (erro) return NextResponse.json({ erro }, { status: 400 });
  const params: Parametros = {
    prioridadeCds: body.prioridadeCds!.map(Number),
    horizonteMeses: body.horizonteMeses!,
    aliquotaFiscal: Object.fromEntries(Object.entries(body.aliquotaFiscal!).map(([k, v]) => [Number(k), Number(v)])),
    fatorSegurancaImediata: Number(body.fatorSegurancaImediata),
    limiteCoberturaDias: Number(body.limiteCoberturaDias),
  };
  const r = store.updateParametros(params, getUsuario(req));
  const versao = store.getVersaoAtual();
  return NextResponse.json({ ...r, versaoId: versao.id, meta: versao.resultado.meta });
}

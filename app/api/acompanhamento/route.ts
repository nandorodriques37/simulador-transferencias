import { NextRequest, NextResponse } from "next/server";
import { carteira } from "@/lib/store/carteira";
import { calcularAcompanhamento } from "@/lib/query/acompanhamento";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Períodos aceitos, em dias de aprovação para trás; 0 = todo o histórico. */
const PERIODOS = [30, 90, 180, 0];

/**
 * Acompanhamento da carteira: aprovado × faturado por rota, origem e destino,
 * e o tempo da aprovação até a NF. O período filtra pela DATA DE APROVAÇÃO —
 * uma sugestão aprovada no período conta com todo o faturamento que já teve.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const pedido = Number(sp.get("dias") ?? 90);
  const dias = PERIODOS.includes(pedido) ? pedido : 90;
  const agora = Date.now();
  const desde = dias > 0 ? new Date(agora - dias * 86400000).toISOString() : null;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : null);

  const sugestoes = await carteira.listarPeriodo({ desde, cdOrigem: num("origem"), cdDestino: num("destino") });
  return NextResponse.json({
    dias,
    desde,
    geradoEm: new Date(agora).toISOString(),
    durable: carteira.durable(),
    ...calcularAcompanhamento(sugestoes, agora),
  });
}

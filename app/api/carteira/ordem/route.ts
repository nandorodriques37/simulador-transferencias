import { NextRequest, NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { carteira, qtdAberta } from "@/lib/store/carteira";
import { ordemTransferenciaCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

/** Ordem de transferência (ERP/WMS) com o saldo aprovado ainda em aberto. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const itens = (
    await carteira.listar({
      status: "aprovada",
      cdOrigem: sp.get("origem") ? Number(sp.get("origem")) : null,
      cdDestino: sp.get("destino") ? Number(sp.get("destino")) : null,
      limite: 5000,
    })
  ).filter((s) => qtdAberta(s) > 0);

  if (itens.length === 0)
    return NextResponse.json({ erro: "nenhuma sugestão aprovada em aberto" }, { status: 400 });

  const csv = ordemTransferenciaCsv(itens, getUsuario(req));
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ordem_transferencia_${stamp}.csv"`,
    },
  });
}

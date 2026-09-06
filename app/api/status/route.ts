import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { carteira } from "@/lib/store/carteira";

export const dynamic = "force-dynamic";

export async function GET() {
  const analise = store.getAnaliseAtual();
  return NextResponse.json({
    dataset: store.getDataset(),
    parametros: store.getParametros(),
    carteira: { ...(await carteira.resumo()), durable: carteira.durable() },
    analiseAtual: analise
      ? {
          id: analise.id,
          label: analise.label,
          criadoEm: analise.criadoEm,
          criadoPor: analise.criadoPor,
          parametros: analise.parametros,
          meta: analise.resultado.meta,
          reconciliacao: analise.resultado.reconciliacao,
        }
      : null,
  });
}

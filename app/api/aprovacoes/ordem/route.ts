import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { ordemTransferenciaCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

/** Gera o arquivo de ordem de transferência (ERP/WMS) com as linhas aprovadas. */
export async function GET(req: NextRequest) {
  const versionId = req.nextUrl.searchParams.get("versionId") ?? store.getVersaoAtual().id;
  const versao = store.getVersao(versionId);
  if (!versao) return NextResponse.json({ erro: "versão não encontrada" }, { status: 404 });
  const aprovadas = new Set(store.getAprovacoes(versionId).map((a) => a.chave));
  const linhas = versao.resultado.linhas.filter((l) => aprovadas.has(`${l.cdDestino}:${l.idSku}`));
  if (linhas.length === 0) return NextResponse.json({ erro: "nenhuma linha aprovada nesta versão" }, { status: 400 });

  const csv = ordemTransferenciaCsv(linhas, versao.parametros.horizonteMeses, getUsuario(req), versionId);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ordem_transferencia_${versionId}_${stamp}.csv"`,
    },
  });
}

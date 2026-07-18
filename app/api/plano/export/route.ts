import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { filtrarPlano, ordenarPlano } from "@/lib/query/plano";
import { colunasPlano, linhaParaArray, planoParaCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const versao = store.getVersao(sp.get("versionId") ?? undefined);
  if (!versao) return NextResponse.json({ erro: "versão não encontrada" }, { status: 404 });
  const params = versao.parametros;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : null);
  const linhas = ordenarPlano(
    filtrarPlano(versao.resultado.linhas, {
      cobertura: (sp.get("cobertura") as "total" | "acima90") ?? "total",
      limiteDias: params.limiteCoberturaDias,
      cd: num("cd"),
      categoria: sp.get("categoria"),
      fornecedor: sp.get("fornecedor"),
      comprador: sp.get("comprador"),
      analista: sp.get("analista"),
      status: sp.get("status"),
      q: sp.get("q"),
    }),
    { campo: "valorTotal", dir: "desc" },
  );

  const format = sp.get("format") ?? "csv";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const aoa = [colunasPlano(params.horizonteMeses), ...linhas.map(linhaParaArray)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plano");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="plano_transferencia_${stamp}.xlsx"`,
      },
    });
  }

  const csv = planoParaCsv(linhas, params.horizonteMeses);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plano_transferencia_${stamp}.csv"`,
    },
  });
}

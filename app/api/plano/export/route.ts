import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { filtrarPlano, ordenarPlano } from "@/lib/query/plano";
import { colunasPlano, linhaParaArray, planoParaCsv } from "@/lib/export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const analise = store.getAnalise(sp.get("analiseId") ?? undefined);
  if (!analise) return NextResponse.json({ erro: "nenhuma análise rodada ainda" }, { status: 404 });
  const params = analise.parametros;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : null);

  const linhas = ordenarPlano(
    filtrarPlano(analise.resultado.linhas, {
      cobertura: (sp.get("cobertura") as "total" | "acima_limite") ?? "total",
      limiteDias: params.limiteCoberturaDias,
      cdOrigem: num("origem"),
      cdDestino: num("destino"),
      categoria: sp.get("categoria"),
      fornecedor: sp.get("fornecedor"),
      comprador: sp.get("comprador"),
      analista: sp.get("analista"),
      status: sp.get("status"),
      q: sp.get("q"),
      soImediata: sp.get("soImediata") === "true",
    }),
    { campo: "valorTotal", dir: "desc" },
  );

  const modoPedidos = params.modoDemanda === "pedidos";
  const meses = analise.resultado.meta.meses;
  const stamp = new Date().toISOString().slice(0, 10);

  if ((sp.get("format") ?? "csv") === "xlsx") {
    const XLSX = await import("xlsx");
    const aoa = [colunasPlano(meses, modoPedidos), ...linhas.map((l) => linhaParaArray(l, modoPedidos))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plano");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="plano_transferencia_${analise.id}_${stamp}.xlsx"`,
      },
    });
  }

  return new NextResponse(planoParaCsv(linhas, meses, modoPedidos), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plano_transferencia_${analise.id}_${stamp}.csv"`,
    },
  });
}

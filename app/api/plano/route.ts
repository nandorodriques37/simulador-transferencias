import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { extrairFacets, filtrarPlano, ordenarPlano, paginar } from "@/lib/query/plano";
import { LinhaPlano } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const versionId = sp.get("versionId") ?? undefined;
  const versao = store.getVersao(versionId);
  if (!versao) return NextResponse.json({ erro: "versão não encontrada" }, { status: 404 });
  const params = versao.parametros;
  const todas = versao.resultado.linhas;

  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : null);
  const filtradas = filtrarPlano(todas, {
    cobertura: (sp.get("cobertura") as "total" | "acima90") ?? "total",
    limiteDias: params.limiteCoberturaDias,
    cd: num("cd"),
    categoria: sp.get("categoria"),
    fornecedor: sp.get("fornecedor"),
    comprador: sp.get("comprador"),
    analista: sp.get("analista"),
    status: sp.get("status"),
    q: sp.get("q"),
  });

  const sortCampo = (sp.get("sort") as keyof LinhaPlano | "valorTotal") ?? "valorTotal";
  const ordenadas = ordenarPlano(filtradas, { campo: sortCampo, dir: (sp.get("dir") as "asc" | "desc") ?? "desc" });

  const page = Number(sp.get("page") ?? 1);
  const pageSize = Math.min(500, Number(sp.get("pageSize") ?? 100));
  const pagina = paginar(ordenadas, page, pageSize);

  // Aprovações da versão para marcar as linhas.
  const aprovadas = new Set(store.getAprovacoes(versao.id).map((a) => a.chave));
  const itens = pagina.itens.map((l) => ({ ...l, aprovada: aprovadas.has(`${l.cdDestino}:${l.idSku}`) }));

  return NextResponse.json({
    versaoId: versao.id,
    meses: params.horizonteMeses,
    facets: extrairFacets(todas),
    total: pagina.total,
    page: pagina.page,
    pageSize: pagina.pageSize,
    totalPaginas: pagina.totalPaginas,
    itens,
  });
}

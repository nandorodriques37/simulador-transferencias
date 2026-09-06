import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { extrairFacets, filtrarPlano, ordenarPlano, paginar } from "@/lib/query/plano";
import { LinhaPlano } from "@/lib/engine/types";
import { carteira } from "@/lib/store/carteira";
import { analisesStore } from "@/lib/store/analises";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // O plano vem da memória ou do armazenamento — a tela não precisa saber.
  const plano = await store.obterPlano(sp.get("analiseId") ?? undefined);
  if (!plano)
    return NextResponse.json({ erro: "nenhuma análise rodada ainda", semAnalise: true }, { status: 404 });

  const params = plano.parametros;
  const todas = plano.linhas;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : null);

  const filtradas = filtrarPlano(todas, {
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
  });

  const campo = (sp.get("sort") as keyof LinhaPlano) ?? "valorTotal";
  const ordenadas = ordenarPlano(filtradas, { campo, dir: (sp.get("dir") as "asc" | "desc") ?? "desc" });

  const page = Number(sp.get("page") ?? 1);
  const pageSize = Math.min(500, Number(sp.get("pageSize") ?? 100));
  const pagina = paginar(ordenadas, page, pageSize);

  // Marca as linhas que já estão na carteira desta análise.
  const aprovadas = new Set(
    (await carteira.listar({ status: "todas", limite: 5000 }))
      .filter((x) => x.analiseId === plano.id && x.status !== "cancelada")
      .map((x) => `${x.cdOrigem}>${x.cdDestino}|${x.codigoProduto}`),
  );

  const totaisFiltro = filtradas.reduce(
    (acc, l) => {
      acc.qtd += l.transfTotal;
      acc.valor += l.valorTotal;
      acc.imediata += l.valorImediata;
      acc.fiscal += l.impactoFiscal;
      return acc;
    },
    { qtd: 0, valor: 0, imediata: 0, fiscal: 0 },
  );

  return NextResponse.json({
    analiseId: plano.id,
    modoDemanda: params.modoDemanda,
    meses: plano.meses,
    facets: extrairFacets(todas),
    totaisFiltro,
    total: pagina.total,
    page: pagina.page,
    pageSize: pagina.pageSize,
    totalPaginas: pagina.totalPaginas,
    itens: pagina.itens.map((l) => ({ ...l, naCarteira: aprovadas.has(`${l.rota}|${l.codigoProduto}`) })),
  });
}

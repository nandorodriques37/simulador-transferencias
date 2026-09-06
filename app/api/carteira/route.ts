import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { carteira, NovaSugestao, StatusSugestao } from "@/lib/store/carteira";
import { analisesStore } from "@/lib/store/analises";
import { filtrarPlano } from "@/lib/query/plano";
import { rotuloMes } from "@/lib/data/defaults";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const itens = await carteira.listar({
    status: (sp.get("status") as StatusSugestao | "todas") ?? "aprovada",
    cdOrigem: sp.get("origem") ? Number(sp.get("origem")) : null,
    cdDestino: sp.get("destino") ? Number(sp.get("destino")) : null,
    q: sp.get("q"),
    limite: Number(sp.get("limite") ?? 500),
  });
  return NextResponse.json({
    itens,
    dataPosicao: store.getDataset().dataPosicao,
    resumo: await carteira.resumo(store.getDataset().dataPosicao),
    durable: carteira.durable(),
    eventos: await carteira.eventos(),
  });
}

/**
 * Aprova linhas da análise atual: elas viram compromissos e passam a descontar
 * o excesso da origem e a necessidade do destino nas próximas análises.
 *
 * Body: { analiseId?, chaves?: string[] ("origem>destino|produto"),
 *         todosOsFiltros?: { ...filtros do plano } }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    analiseId?: string;
    chaves?: string[];
    filtros?: Record<string, string | null>;
  };
  const plano = await store.obterPlano(body.analiseId);
  if (!plano) return NextResponse.json({ erro: "análise não encontrada" }, { status: 404 });

  let linhas = plano.linhas;
  if (body.chaves && body.chaves.length) {
    const set = new Set(body.chaves);
    linhas = linhas.filter((l) => set.has(`${l.rota}|${l.codigoProduto}`));
  } else if (body.filtros) {
    const f = body.filtros;
    const num = (k: string) => (f[k] ? Number(f[k]) : null);
    linhas = filtrarPlano(linhas, {
      cobertura: (f.cobertura as "total" | "acima_limite") ?? "total",
      limiteDias: plano.parametros.limiteCoberturaDias,
      cdOrigem: num("origem"),
      cdDestino: num("destino"),
      categoria: f.categoria ?? null,
      fornecedor: f.fornecedor ?? null,
      comprador: f.comprador ?? null,
      analista: f.analista ?? null,
      status: f.status ?? null,
      q: f.q ?? null,
      soImediata: f.soImediata === "true",
    });
  } else {
    return NextResponse.json({ erro: "informe as linhas a aprovar" }, { status: 400 });
  }

  if (linhas.length === 0) return NextResponse.json({ erro: "nenhuma linha selecionada" }, { status: 400 });

  const meses = plano.meses;
  const itens: NovaSugestao[] = linhas.map((l) => ({
    cdOrigem: l.cdOrigem,
    cdDestino: l.cdDestino,
    codigoProduto: l.codigoProduto,
    produto: l.produto,
    qtd: l.transfTotal,
    valor: l.valorTotal,
    preco: l.precoUnitario,
    embCompra: l.embCompra,
    detalhe: {
      modoDemanda: plano.parametros.modoDemanda,
      meses: meses.map(rotuloMes),
      transfMes: l.transfMes,
      transfSaldo: l.transfSaldo,
      caixas: l.caixas,
      qtdImediata: l.qtdImediataArredondada,
      impactoFiscal: l.impactoFiscal,
    },
  }));

  const r = await carteira.aprovar(plano.id, itens, getUsuario(req), {
    consideraAprovadas: plano.parametros.considerarAprovadas !== false,
  });
  // Controle: a análise salva registra o que saiu dela para a carteira.
  await analisesStore.registrarAprovacao(plano.id, {
    linhas: r.gravadas,
    qtd: itens.reduce((a, i) => a + i.qtd, 0),
    valor: itens.reduce((a, i) => a + i.valor, 0),
  });
  return NextResponse.json({ ...r, resumo: await carteira.resumo(store.getDataset().dataPosicao) });
}

/** Cancela sugestões (voltam a liberar excesso e necessidade). */
export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as { ids: string[] };
  if (!Array.isArray(body.ids) || body.ids.length === 0)
    return NextResponse.json({ erro: "informe os ids" }, { status: 400 });
  const n = await carteira.cancelar(body.ids, getUsuario(req));
  return NextResponse.json({ canceladas: n, resumo: await carteira.resumo(store.getDataset().dataPosicao) });
}

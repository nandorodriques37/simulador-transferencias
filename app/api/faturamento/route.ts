import { NextRequest, NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { store } from "@/lib/store";
import { lerPlanilha } from "@/lib/data/planilha";
import { parseFaturamento } from "@/lib/data/parse";
import { carteira } from "@/lib/store/carteira";
import { baixarUpload, limparUploads } from "@/lib/data/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Histórico de baixas por faturamento. */
export async function GET() {
  return NextResponse.json({ eventos: await carteira.eventos(), resumo: await carteira.resumo(store.getDataset().dataPosicao) });
}

/**
 * Importa a base de FATURAMENTO (transferências realizadas) e dá baixa nas
 * sugestões aprovadas. Depois da baixa elas param de descontar o excesso da
 * origem e o trânsito do destino — as bases atualizadas já refletem isso.
 */
export async function POST(req: NextRequest) {
  // Dois caminhos, como na importação das bases: arquivo no corpo (até 4,5 MB)
  // ou a URL de um upload direto ao Blob.
  let file: File | null = null;
  let dryRun = false;
  let url: string | undefined;
  if (req.headers.get("content-type")?.includes("application/json")) {
    const body = (await req.json()) as { url?: string; dryRun?: boolean };
    dryRun = body.dryRun === true;
    url = body.url;
    if (url) {
      try {
        file = await baixarUpload(url, "faturamento.csv");
      } catch (e) {
        return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
      }
    }
  } else {
    const form = await req.formData();
    file = form.get("faturamento") as File | null;
    dryRun = form.get("dryRun") === "true";
  }
  if (!file) return NextResponse.json({ erro: "anexe a planilha de faturamento" }, { status: 400 });

  let linhas;
  let diag;
  try {
    const r = parseFaturamento(await lerPlanilha(file));
    linhas = r.itens;
    diag = r.diag;
  } catch (e) {
    return NextResponse.json({ erro: `falha ao ler a planilha: ${(e as Error).message}` }, { status: 400 });
  }

  if (diag.faltando.length) {
    return NextResponse.json(
      {
        erro: "colunas obrigatórias ausentes na planilha de faturamento",
        faltando: diag.faltando,
        diag,
      },
      { status: 422 },
    );
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      diag,
      linhas: linhas.length,
      quantidadeTotal: linhas.reduce((a, l) => a + l.quantidade, 0),
      rotas: Array.from(new Set(linhas.map((l) => `${l.cdOrigem}>${l.cdDestino}`))).slice(0, 30),
    });
  }

  // Impressão digital do conteúdo: barra a reimportação do mesmo arquivo.
  const { createHash } = await import("node:crypto");
  const impressao = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex").slice(0, 32);
  const relatorio = await carteira.baixarFaturamento(linhas, getUsuario(req), file.name, impressao);
  if (!relatorio.ok) return NextResponse.json({ erro: relatorio.achados[0]?.mensagem, relatorio }, { status: 409 });
  await limparUploads([url]);
  return NextResponse.json({ ok: true, relatorio, diag, resumo: await carteira.resumo(store.getDataset().dataPosicao) });
}

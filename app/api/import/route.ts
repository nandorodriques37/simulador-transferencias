import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { lerPlanilha } from "@/lib/data/planilha";
import { normalizarDataFaturamento } from "@/lib/store/carteira";
import { parseBase, parsePedidos } from "@/lib/data/parse";
import { validarImportacao } from "@/lib/data/validate";
import { LinhaBase, PedidoProjetado } from "@/lib/engine/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Importa as DUAS bases da análise:
 *   - "base"    → base única com todos os CDs (origem e destino);
 *   - "pedidos" → pedidos projetados (usados no modo Pedidos).
 * `dryRun=true` só valida e devolve a prévia, sem trocar a base.
 */
/** Baixa um arquivo já enviado ao armazenamento e o devolve como File. */
async function baixar(url: string, nomePadrao: string): Promise<File> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`não foi possível ler o arquivo enviado (${resp.status})`);
  const nome = decodeURIComponent(new URL(url).pathname.split("/").pop() || nomePadrao);
  return new File([await resp.arrayBuffer()], nome);
}

export async function POST(req: NextRequest) {
  // Dois caminhos: arquivo no corpo (até 4,5 MB) ou URL de um upload direto.
  let baseFile: File | null = null;
  let pedidosFile: File | null = null;
  let dryRun = false;
  let dataPosicao = "";

  if (req.headers.get("content-type")?.includes("application/json")) {
    const body = (await req.json()) as { baseUrl?: string; pedidosUrl?: string; dryRun?: boolean; dataPosicao?: string };
    dryRun = body.dryRun === true;
    dataPosicao = body.dataPosicao ?? "";
    try {
      if (body.baseUrl) baseFile = await baixar(body.baseUrl, "base.csv");
      if (body.pedidosUrl) pedidosFile = await baixar(body.pedidosUrl, "pedidos.csv");
    } catch (e) {
      return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
    }
  } else {
    const form = await req.formData();
    baseFile = form.get("base") as File | null;
    pedidosFile = form.get("pedidos") as File | null;
    dryRun = form.get("dryRun") === "true";
    dataPosicao = (form.get("dataPosicao") as string | null) ?? "";
  }

  if (!baseFile && !pedidosFile)
    return NextResponse.json({ erro: "envie ao menos um arquivo (base de CDs ou base de pedidos)" }, { status: 400 });

  // Importação parcial (só pedidos, por exemplo) precisa da base já carregada.
  await store.ensureBase();
  const modoDemanda = store.getParametros().modoDemanda;
  let base: LinhaBase[] | null = null;
  let pedidos: PedidoProjetado[] | null = null;
  let diagBase;
  let diagPedidos;

  try {
    if (baseFile) {
      const r = parseBase(await lerPlanilha(baseFile));
      base = r.itens;
      diagBase = r.diag;
    }
    if (pedidosFile) {
      const r = parsePedidos(await lerPlanilha(pedidosFile));
      pedidos = r.itens;
      diagPedidos = r.diag;
    }
  } catch (e) {
    return NextResponse.json({ erro: `falha ao ler a planilha: ${(e as Error).message}` }, { status: 400 });
  }

  const relatorio = validarImportacao(
    base ?? store.getBase(),
    pedidos ?? store.getPedidos(),
    diagBase,
    diagPedidos,
    modoDemanda,
  );

  if (dryRun) return NextResponse.json({ dryRun: true, relatorio });
  if (!relatorio.ok)
    return NextResponse.json({ erro: "importação bloqueada por erros de validação", relatorio }, { status: 422 });

  // Data da posição de estoque: informada pelo usuário ou o momento do envio.
  // É a referência que evita contar duas vezes uma transferência já faturada.
  const iso = normalizarDataFaturamento(dataPosicao) ?? new Date().toISOString();
  const log = await store.setDataset(
    base,
    pedidos,
    baseFile?.name ?? "",
    pedidosFile?.name ?? "",
    getUsuario(req),
    relatorio,
    iso,
  );
  return NextResponse.json({ ok: true, log, dataset: store.getDataset(), parametros: store.getParametros(), relatorio });
}

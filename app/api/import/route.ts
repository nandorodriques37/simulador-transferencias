import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { parsePedidos, parsePosicao } from "@/lib/data/parse";
import { validarImportacao } from "@/lib/data/validate";
import { PedidoProjetado, PosicaoEstoque } from "@/lib/engine/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function lerPlanilha(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const posicaoFile = form.get("posicao") as File | null;
  const pedidosFile = form.get("pedidos") as File | null;
  const dryRun = form.get("dryRun") === "true";

  if (!posicaoFile && !pedidosFile) {
    return NextResponse.json({ erro: "envie ao menos o arquivo de posição de estoque" }, { status: 400 });
  }

  let posicao: PosicaoEstoque[] = store.getPosicao();
  let pedidos: PedidoProjetado[] = store.getPedidos();
  let diagPosicao;
  let diagPedidos;
  const origens: string[] = [];

  try {
    if (posicaoFile) {
      const r = parsePosicao(await lerPlanilha(posicaoFile));
      posicao = r.itens;
      diagPosicao = r.diag;
      origens.push(posicaoFile.name);
    }
    if (pedidosFile) {
      const r = parsePedidos(await lerPlanilha(pedidosFile));
      pedidos = r.itens;
      diagPedidos = r.diag;
      origens.push(pedidosFile.name);
    }
  } catch (e) {
    return NextResponse.json({ erro: `falha ao ler planilha: ${(e as Error).message}` }, { status: 400 });
  }

  const relatorio = validarImportacao(posicao, pedidos, diagPosicao, diagPedidos);
  const origem = origens.join(" + ") || "importação";

  if (dryRun) {
    return NextResponse.json({ dryRun: true, relatorio, origem });
  }
  if (!relatorio.ok) {
    return NextResponse.json({ erro: "importação bloqueada por erros de validação", relatorio }, { status: 422 });
  }

  const log = store.setDataset(posicao, pedidos, origem, getUsuario(req), relatorio);
  const versao = store.getVersaoAtual();
  return NextResponse.json({ ok: true, log, versaoId: versao.id, meta: versao.resultado.meta, relatorio });
}

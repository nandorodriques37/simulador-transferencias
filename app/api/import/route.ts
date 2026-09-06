import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { lerPlanilha } from "@/lib/data/planilha";
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
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const baseFile = form.get("base") as File | null;
  const pedidosFile = form.get("pedidos") as File | null;
  const dryRun = form.get("dryRun") === "true";

  if (!baseFile && !pedidosFile)
    return NextResponse.json({ erro: "envie ao menos um arquivo (base de CDs ou base de pedidos)" }, { status: 400 });

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

  const log = store.setDataset(
    base,
    pedidos,
    baseFile?.name ?? "",
    pedidosFile?.name ?? "",
    getUsuario(req),
    relatorio,
  );
  return NextResponse.json({ ok: true, log, dataset: store.getDataset(), parametros: store.getParametros(), relatorio });
}

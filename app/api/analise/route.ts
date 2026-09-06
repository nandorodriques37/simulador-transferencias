import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { ParametrosRede } from "@/lib/engine/types";
import { normalizarParametros } from "@/lib/data/params";
import { analisesStore } from "@/lib/store/analises";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Histórico de análises — vem do banco, não da memória da instância. */
export async function GET() {
  const analises = await analisesStore.listar(20);
  const atual = store.getAnaliseAtual();
  return NextResponse.json({
    analises,
    duravel: analisesStore.durable(),
    atual: atual
      ? { id: atual.id, meta: atual.resultado.meta, reconciliacao: atual.resultado.reconciliacao, comPlano: true }
      : null,
  });
}

/** Roda uma análise com a sequência de origens e destinos escolhida. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { parametros: Partial<ParametrosRede>; label?: string; analiseId?: string };
  const { erro, params } = normalizarParametros(body.parametros ?? {});
  if (erro || !params) return NextResponse.json({ erro }, { status: 400 });

  // Instância fria: reconstrói a base do repositório antes de calcular.
  await store.ensureBase();
  const dataset = store.getDataset();
  if (dataset.baseLinhas === 0)
    return NextResponse.json({ erro: "importe a base de CDs antes de rodar a análise" }, { status: 400 });

  const label =
    body.label?.trim() ||
    `${params.modoDemanda === "pedidos" ? "Pedidos" : "Saldo ideal"} · ${params.origens.length} origem(ns) → ${params.destinos.length} destino(s)`;

  // Recalcular uma análise existente mantém o id (mesmo resultado, mesmo
  // registro no histórico) — só é aceito se ela realmente existir.
  const idExistente = body.analiseId && (await analisesStore.obter(body.analiseId)) ? body.analiseId : undefined;
  const analise = await store.rodarAnalise(params, getUsuario(req), label, idExistente);
  return NextResponse.json({
    id: analise.id,
    label: analise.label,
    criadoEm: analise.criadoEm,
    meta: analise.resultado.meta,
    reconciliacao: analise.resultado.reconciliacao,
    origens: analise.resultado.origens,
    destinos: analise.resultado.destinos,
    rotas: analise.resultado.rotas,
    compromissos: analise.compromissos,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";
import { ParametrosRede } from "@/lib/engine/types";
import { normalizarParametros } from "@/lib/data/params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lista as análises rodadas nesta instância (mais recente primeiro). */
export async function GET() {
  const analises = store.listAnalises().map((a) => ({
    id: a.id,
    label: a.label,
    criadoEm: a.criadoEm,
    criadoPor: a.criadoPor,
    modoDemanda: a.parametros.modoDemanda,
    origens: a.parametros.origens,
    destinos: a.parametros.destinos,
  }));
  const atual = store.getAnaliseAtual();
  return NextResponse.json({
    analises,
    atual: atual
      ? { id: atual.id, meta: atual.resultado.meta, reconciliacao: atual.resultado.reconciliacao }
      : null,
  });
}

/** Roda uma análise com a sequência de origens e destinos escolhida. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { parametros: Partial<ParametrosRede>; label?: string };
  const { erro, params } = normalizarParametros(body.parametros ?? {});
  if (erro || !params) return NextResponse.json({ erro }, { status: 400 });

  const dataset = store.getDataset();
  if (dataset.baseLinhas === 0)
    return NextResponse.json({ erro: "importe a base de CDs antes de rodar a análise" }, { status: 400 });

  const label =
    body.label?.trim() ||
    `${params.modoDemanda === "pedidos" ? "Pedidos" : "Saldo ideal"} · ${params.origens.length} origem(ns) → ${params.destinos.length} destino(s)`;

  const analise = await store.rodarAnalise(params, getUsuario(req), label);
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

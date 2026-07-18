import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Descobre os CDs presentes nas bases: origens (depósitos) e destinos (pedidos). */
export async function GET() {
  const params = store.getParametros();
  const destinos = new Set<number>();
  for (const p of store.getPedidos()) destinos.add(p.cdDestino);
  const origens = new Set<number>();
  for (const s of store.getPosicao()) origens.add(s.deposito);

  const destinosDisponiveis = Array.from(destinos).sort((a, b) => a - b);
  const origensDisponiveis = Array.from(origens).sort((a, b) => a - b);
  // União de todos os CDs vistos (para o seletor de origem/destino).
  const todos = Array.from(new Set([...destinosDisponiveis, ...origensDisponiveis, ...params.prioridadeCds, params.cdOrigem])).sort((a, b) => a - b);

  return NextResponse.json({
    cdOrigem: params.cdOrigem,
    prioridadeCds: params.prioridadeCds,
    destinosDisponiveis,
    origensDisponiveis,
    todos,
  });
}

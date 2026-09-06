import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { excessoTransferivel, necessidadeSaldoIdeal, precoUnitario } from "@/lib/engine/calc";
import { carteira } from "@/lib/store/carteira";
import { chaveCdProduto } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

/**
 * Radiografia da rede: para cada CD da base, quanto ele tem de EXCESSO (se for
 * origem) e quanto tem de FALTA (se for destino). É o que sustenta a escolha da
 * sequência de origens e destinos na tela de análise.
 */
export async function GET() {
  const base = store.getBase();
  const pedidos = store.getPedidos();
  const compromissos = await carteira.compromissos();

  const map = new Map<
    number,
    { cd: number; skus: number; excessoQtd: number; excessoRs: number; faltaQtd: number; faltaRs: number; pedidosQtd: number; comprometidoSaida: number; emTransito: number }
  >();
  const get = (cd: number) => {
    let m = map.get(cd);
    if (!m) {
      m = { cd, skus: 0, excessoQtd: 0, excessoRs: 0, faltaQtd: 0, faltaRs: 0, pedidosQtd: 0, comprometidoSaida: 0, emTransito: 0 };
      map.set(cd, m);
    }
    return m;
  };

  for (const l of base) {
    const m = get(l.cd);
    const preco = precoUnitario(l);
    const exc = excessoTransferivel(l);
    const falta = necessidadeSaldoIdeal(l);
    m.skus++;
    m.excessoQtd += exc;
    m.excessoRs += exc * preco;
    m.faltaQtd += falta;
    m.faltaRs += falta * preco;
    const k = chaveCdProduto(l.cd, l.codigoProduto);
    m.comprometidoSaida += compromissos.saidaOrigem.get(k) ?? 0;
    m.emTransito += compromissos.entradaDestino.get(k) ?? 0;
  }
  for (const p of pedidos) get(p.cdDestino).pedidosQtd += p.pedido;

  const cds = Array.from(map.values()).sort((a, b) => a.cd - b.cd);
  const params = store.getParametros();
  return NextResponse.json({
    cds,
    todos: cds.map((c) => c.cd),
    origens: params.origens,
    destinos: params.destinos,
    mesesPedidos: store.getDataset().mesesPedidos,
  });
}

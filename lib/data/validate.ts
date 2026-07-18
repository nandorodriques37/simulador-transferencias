import { chavePedido, PedidoProjetado, PosicaoEstoque } from "@/lib/engine/types";

export interface Achado {
  nivel: "erro" | "aviso" | "info";
  codigo: string;
  mensagem: string;
  qtd: number;
  exemplos?: string[];
}

export interface RelatorioQualidade {
  posicaoLinhas: number;
  pedidosLinhas: number;
  achados: Achado[];
  ok: boolean; // sem erros bloqueantes
}

/**
 * Valida qualidade dos dados na importação (os pontos frágeis da planilha):
 * schema, duplicidade de chave, preços zerados/negativos, SKUs sem pedido,
 * emb_compra zerada, alíquotas ausentes (via parâmetros, tratado em outro nível).
 */
export function validarImportacao(
  posicao: PosicaoEstoque[],
  pedidos: PedidoProjetado[],
): RelatorioQualidade {
  const achados: Achado[] = [];
  const add = (a: Achado) => achados.push(a);

  // 1. Base vazia = erro bloqueante.
  if (posicao.length === 0) add({ nivel: "erro", codigo: "posicao_vazia", mensagem: "Nenhuma linha de posição de estoque reconhecida (verifique o cabeçalho).", qtd: 0 });
  if (pedidos.length === 0) add({ nivel: "aviso", codigo: "pedidos_vazio", mensagem: "Nenhum pedido projetado reconhecido — o plano ficará vazio.", qtd: 0 });

  // 2. Duplicidade de chave em pedidos (ano_mes|cd|produto).
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const p of pedidos) {
    const k = chavePedido(p.anoMes, p.cdDestino, p.codigoProduto);
    if (seen.has(k)) dups.push(k);
    else seen.add(k);
  }
  if (dups.length) add({ nivel: "erro", codigo: "pedido_duplicado", mensagem: "Chaves (ano_mes, cd, produto) duplicadas em pedidos projetados. Consolide antes de importar.", qtd: dups.length, exemplos: dups.slice(0, 5) });

  // 3. SKU duplicado na posição.
  const skuSeen = new Set<string>();
  const skuDup: string[] = [];
  for (const s of posicao) {
    if (skuSeen.has(s.idSku)) skuDup.push(s.idSku);
    else skuSeen.add(s.idSku);
  }
  if (skuDup.length) add({ nivel: "erro", codigo: "sku_duplicado", mensagem: "SKUs (deposito-codigo) repetidos na posição de estoque.", qtd: skuDup.length, exemplos: skuDup.slice(0, 5) });

  // 4. Preço zero (fallback silencioso para preço de lista distorce valores).
  const precoZero = posicao.filter((s) => s.custoReposicao === 0);
  if (precoZero.length) add({ nivel: "aviso", codigo: "custo_zero", mensagem: "SKUs com custo de reposição = 0 (valorização usa o preço de lista como fallback).", qtd: precoZero.length, exemplos: precoZero.slice(0, 5).map((s) => s.idSku) });

  // 5. Preço/estoque negativos.
  const negativos = posicao.filter((s) => s.custoReposicao < 0 || s.precoLista < 0 || s.estoqueDisponivel < 0);
  if (negativos.length) add({ nivel: "erro", codigo: "valor_negativo", mensagem: "SKUs com custo, preço de lista ou estoque negativo.", qtd: negativos.length, exemplos: negativos.slice(0, 5).map((s) => s.idSku) });

  // 6. emb_compra = 0 (zera caixas — alertar em vez de silenciar).
  const embZero = posicao.filter((s) => s.embCompra <= 0);
  if (embZero.length) add({ nivel: "aviso", codigo: "emb_zero", mensagem: "SKUs com embalagem de compra <= 0: transferência em caixas será 0.", qtd: embZero.length, exemplos: embZero.slice(0, 5).map((s) => s.idSku) });

  // 7. Venda média 0 com estoque alto (cobertura 9999 = sem giro).
  const semGiro = posicao.filter((s) => s.vendaMedia3m <= 0 && s.estoqueDisponivel + s.quantidadePendente > 0);
  if (semGiro.length) add({ nivel: "info", codigo: "sem_giro", mensagem: "SKUs sem giro (venda média 0 e estoque > 0): cobertura tratada como 'Sem giro'.", qtd: semGiro.length, exemplos: semGiro.slice(0, 5).map((s) => s.idSku) });

  // 8. SKUs sem nenhum pedido correspondente em qualquer CD/mês.
  const codigosComPedido = new Set(pedidos.map((p) => p.codigoProduto));
  const semPedido = posicao.filter((s) => !codigosComPedido.has(s.codigoProduto));
  if (semPedido.length) add({ nivel: "info", codigo: "sku_sem_pedido", mensagem: "SKUs sem pedido projetado em nenhum CD (não geram transferência).", qtd: semPedido.length, exemplos: semPedido.slice(0, 5).map((s) => s.idSku) });

  const ok = !achados.some((a) => a.nivel === "erro");
  return { posicaoLinhas: posicao.length, pedidosLinhas: pedidos.length, achados, ok };
}

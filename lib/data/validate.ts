import { chavePedido, PedidoProjetado, PosicaoEstoque } from "@/lib/engine/types";
import { DiagParse } from "./parse";

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
  diagPosicao?: DiagParse;
  diagPedidos?: DiagParse;
  achados: Achado[];
  ok: boolean; // sem erros bloqueantes
}

function diagAchados(diag: DiagParse | undefined, base: string, add: (a: Achado) => void) {
  if (!diag) return;

  // Colunas obrigatórias ausentes — mensagem com o nome EXATO esperado + aceitos.
  if (diag.faltando.length) {
    for (const f of diag.faltando) {
      add({
        nivel: "erro",
        codigo: "coluna_faltando",
        mensagem: `${base}: coluna obrigatória ausente — "${f.rotulo}". Renomeie uma coluna do arquivo para um dos nomes aceitos.`,
        qtd: 1,
        exemplos: f.aliases,
      });
    }
    add({
      nivel: "info",
      codigo: "colunas_detectadas",
      mensagem: `${base}: colunas reconhecidas no arquivo`,
      qtd: diag.mapeadas.length,
      exemplos: diag.mapeadas.map((m) => `${m.rotulo} ← "${m.coluna}"`).slice(0, 20),
    });
    return; // sem as obrigatórias, não há como validar linhas
  }

  // Erros de valor por LINHA — informa linha, coluna e valor exatos.
  if (diag.errosLinha.length || diag.errosTruncados) {
    add({
      nivel: "erro",
      codigo: "erro_linha",
      mensagem: `${base}: ${diag.errosLinha.length + diag.errosTruncados} linha(s) com valores inválidos (não numéricos ou negativos em colunas obrigatórias).`,
      qtd: diag.errosLinha.length + diag.errosTruncados,
      exemplos: diag.errosLinha.slice(0, 10).map((e) => `linha ${e.linha} · coluna "${e.coluna}": ${e.msg} [valor: "${e.valor}"]`),
    });
  }

  if (diag.ignoradas.length) {
    add({
      nivel: "info",
      codigo: "colunas_ignoradas",
      mensagem: `${base}: colunas não utilizadas pelo cálculo (ignoradas).`,
      qtd: diag.ignoradas.length,
      exemplos: diag.ignoradas.slice(0, 15),
    });
  }
}

/**
 * Valida qualidade dos dados na importação com mensagens PRECISAS: nomes exatos
 * de colunas faltantes, linha/coluna/valor de cada erro, chaves duplicadas.
 */
export function validarImportacao(
  posicao: PosicaoEstoque[],
  pedidos: PedidoProjetado[],
  diagPosicao?: DiagParse,
  diagPedidos?: DiagParse,
): RelatorioQualidade {
  const achados: Achado[] = [];
  const add = (a: Achado) => achados.push(a);

  // --- Schema + valores por linha (bloqueantes) ---
  diagAchados(diagPosicao, "Posição de estoque", add);
  diagAchados(diagPedidos, "Pedidos projetados", add);

  const schemaPosOk = !diagPosicao || diagPosicao.faltando.length === 0;

  // --- Base vazia ---
  if (schemaPosOk && posicao.length === 0)
    add({ nivel: "erro", codigo: "posicao_vazia", mensagem: "Nenhuma linha de posição de estoque válida após a leitura.", qtd: 0 });
  if (pedidos.length === 0)
    add({ nivel: "aviso", codigo: "pedidos_vazio", mensagem: "Nenhum pedido projetado válido — o plano ficará vazio.", qtd: 0 });

  // --- Duplicidade de chave em pedidos (ano_mes|cd|produto) ---
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const p of pedidos) {
    const k = chavePedido(p.anoMes, p.cdDestino, p.codigoProduto);
    if (seen.has(k)) { if (dups.length < 8) dups.push(k); }
    else seen.add(k);
  }
  if (dups.length) add({ nivel: "erro", codigo: "pedido_duplicado", mensagem: "Chaves (ano_mes, cd, produto) duplicadas em pedidos projetados. Consolide antes de importar.", qtd: dups.length, exemplos: dups });

  // --- SKU duplicado na posição ---
  const skuSeen = new Set<string>();
  const skuDup: string[] = [];
  for (const s of posicao) {
    if (skuSeen.has(s.idSku)) { if (skuDup.length < 8) skuDup.push(s.idSku); }
    else skuSeen.add(s.idSku);
  }
  if (skuDup.length) add({ nivel: "erro", codigo: "sku_duplicado", mensagem: "SKUs (deposito-codigo) repetidos na posição de estoque.", qtd: skuDup.length, exemplos: skuDup });

  // --- Avisos de negócio (não bloqueiam) ---
  const custoZero = posicao.filter((s) => s.custoReposicao === 0);
  if (custoZero.length) add({ nivel: "aviso", codigo: "custo_zero", mensagem: "SKUs com custo de reposição = 0 (valorização usa o preço de lista como fallback).", qtd: custoZero.length, exemplos: custoZero.slice(0, 5).map((s) => s.idSku) });

  const semPreco = posicao.filter((s) => s.custoReposicao === 0 && s.precoLista === 0);
  if (semPreco.length) add({ nivel: "aviso", codigo: "sem_preco", mensagem: "SKUs sem custo E sem preço de lista: valorização em R$ será zero.", qtd: semPreco.length, exemplos: semPreco.slice(0, 5).map((s) => s.idSku) });

  const embZero = posicao.filter((s) => s.embCompra <= 0);
  if (embZero.length) add({ nivel: "aviso", codigo: "emb_zero", mensagem: "SKUs com embalagem de compra <= 0: transferência em caixas será 0.", qtd: embZero.length, exemplos: embZero.slice(0, 5).map((s) => s.idSku) });

  const semGiro = posicao.filter((s) => s.vendaMedia3m <= 0 && s.estoqueDisponivel + s.quantidadePendente > 0);
  if (semGiro.length) add({ nivel: "info", codigo: "sem_giro", mensagem: "SKUs sem giro (venda média 0 e estoque > 0): cobertura tratada como 'Sem giro'.", qtd: semGiro.length, exemplos: semGiro.slice(0, 5).map((s) => s.idSku) });

  const codigosComPedido = new Set(pedidos.map((p) => p.codigoProduto));
  const semPedido = posicao.filter((s) => !codigosComPedido.has(s.codigoProduto));
  if (semPedido.length) add({ nivel: "info", codigo: "sku_sem_pedido", mensagem: "SKUs sem pedido projetado em nenhum CD (não geram transferência).", qtd: semPedido.length, exemplos: semPedido.slice(0, 5).map((s) => s.idSku) });

  const ok = !achados.some((a) => a.nivel === "erro");
  return { posicaoLinhas: posicao.length, pedidosLinhas: pedidos.length, diagPosicao, diagPedidos, achados, ok };
}

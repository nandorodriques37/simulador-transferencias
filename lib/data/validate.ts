import { chaveCdProduto, chavePedido, LinhaBase, ModoDemanda, PedidoProjetado } from "@/lib/engine/types";
import { DiagParse } from "./parse";

export interface Achado {
  nivel: "erro" | "aviso" | "info";
  codigo: string;
  mensagem: string;
  qtd: number;
  exemplos?: string[];
}

export interface RelatorioQualidade {
  baseLinhas: number;
  pedidosLinhas: number;
  cdsBase: number[];
  diagBase?: DiagParse;
  diagPedidos?: DiagParse;
  achados: Achado[];
  ok: boolean; // sem erros bloqueantes
}

function diagAchados(diag: DiagParse | undefined, base: string, add: (a: Achado) => void) {
  if (!diag) return;

  // Colunas obrigatórias ausentes — nome esperado + variações aceitas.
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
    return; // sem as obrigatórias, não há como validar as linhas
  }

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
 * Valida a qualidade das DUAS bases da análise com mensagens precisas: nome
 * exato da coluna ausente, linha/coluna/valor de cada erro e chaves duplicadas.
 */
export function validarImportacao(
  base: LinhaBase[],
  pedidos: PedidoProjetado[],
  diagBase?: DiagParse,
  diagPedidos?: DiagParse,
  modoDemanda: ModoDemanda = "saldo_ideal",
): RelatorioQualidade {
  const achados: Achado[] = [];
  const add = (a: Achado) => achados.push(a);

  diagAchados(diagBase, "Base de CDs", add);
  diagAchados(diagPedidos, "Base de pedidos", add);

  const schemaBaseOk = !diagBase || diagBase.faltando.length === 0;
  const cdsBase = Array.from(new Set(base.map((l) => l.cd))).sort((a, b) => a - b);

  if (schemaBaseOk && base.length === 0)
    add({ nivel: "erro", codigo: "base_vazia", mensagem: "Nenhuma linha válida na base de CDs após a leitura.", qtd: 0 });

  // A base agora tem que trazer TODOS os CDs — com um só CD não há rede.
  if (base.length > 0 && cdsBase.length < 2)
    add({
      nivel: "aviso",
      codigo: "base_um_cd",
      mensagem: `A base tem apenas o CD ${cdsBase[0]}. Suba a planilha com todos os CDs para analisar transferências entre eles.`,
      qtd: cdsBase.length,
    });

  if (base.length > 0)
    add({ nivel: "info", codigo: "cds_detectados", mensagem: "CDs encontrados na base.", qtd: cdsBase.length, exemplos: cdsBase.map((c) => `CD ${c}`) });

  if (modoDemanda === "pedidos" && pedidos.length === 0)
    add({ nivel: "aviso", codigo: "pedidos_vazio", mensagem: "Nenhum pedido projetado válido — a análise no modo Pedidos ficará vazia.", qtd: 0 });

  // --- Duplicidade de chave (cd, produto) na base ---
  const seenBase = new Set<string>();
  const dupBase: string[] = [];
  for (const l of base) {
    const k = chaveCdProduto(l.cd, l.codigoProduto);
    if (seenBase.has(k)) {
      if (dupBase.length < 8) dupBase.push(k);
    } else seenBase.add(k);
  }
  if (dupBase.length)
    add({ nivel: "erro", codigo: "base_duplicada", mensagem: "Chaves (CD, produto) repetidas na base. Consolide uma linha por CD e produto antes de importar.", qtd: dupBase.length, exemplos: dupBase });

  // --- Duplicidade de chave em pedidos (ano_mes, cd, produto) ---
  const seenPed = new Set<string>();
  const dupPed: string[] = [];
  for (const p of pedidos) {
    const k = chavePedido(p.anoMes, p.cdDestino, p.codigoProduto);
    if (seenPed.has(k)) {
      if (dupPed.length < 8) dupPed.push(k);
    } else seenPed.add(k);
  }
  if (dupPed.length)
    add({ nivel: "aviso", codigo: "pedido_duplicado", mensagem: "Chaves (ano_mês, CD, produto) repetidas na base de pedidos — as quantidades serão somadas.", qtd: dupPed.length, exemplos: dupPed });

  // --- Descrição e categoria N3: não entram na conta, mas sem elas o plano
  // vira uma lista de códigos que ninguém consegue revisar nem filtrar. ---
  if (diagBase && base.length) {
    const mapeado = new Set(diagBase.mapeadas.map((m) => m.campo));
    const faltaCol = [
      !mapeado.has("produto") && "descrição do produto (produto, descricao, nome_produto)",
      !mapeado.has("categoriaN3") && "categoria N3 (categoria_n3, CAT_NÍVEL_3, categoria)",
    ].filter(Boolean) as string[];
    if (faltaCol.length)
      add({
        nivel: "aviso",
        codigo: "sem_descricao",
        mensagem: "A base não traz colunas que o plano usa para revisar e filtrar. O cálculo sai certo, mas o plano mostra só o código. Inclua na próxima base:",
        qtd: faltaCol.length,
        exemplos: faltaCol,
      });
    const vazias = (campo: "produto" | "categoriaN3") => (mapeado.has(campo) ? base.filter((l) => !l[campo]).length : 0);
    const semNome = vazias("produto");
    const semCat = vazias("categoriaN3");
    if (semNome || semCat)
      add({
        nivel: "info",
        codigo: "descricao_vazia",
        mensagem: "Linhas com descrição ou categoria N3 em branco.",
        qtd: Math.max(semNome, semCat),
        exemplos: [semNome && `${semNome} sem descrição`, semCat && `${semCat} sem categoria N3`].filter(Boolean) as string[],
      });
  }

  // --- Avisos de negócio (não bloqueiam) ---
  // Preço e embalagem só pesam na linha que pode ser ORIGEM: a transferência é
  // valorizada pelo custo da origem e arredondada pela embalagem dela. Contar
  // todas as linhas assustava à toa — numa base real, quase toda linha sem custo
  // é CD sem o produto (destino), e a origem que atende já traz o próprio custo.
  const temExcesso = (l: LinhaBase) => l.estoqueDisponivel + l.quantidadePendente - l.vendaMedia3m - l.estoqueObjetivo > 0;
  const soPeloPendente = (l: LinhaBase) => l.estoqueDisponivel - l.vendaMedia3m - l.estoqueObjetivo <= 0;
  const origens = base.filter(temExcesso);

  const semPreco = origens.filter((l) => l.custoReposicao === 0 && l.precoLista === 0);
  if (semPreco.length) {
    const pendente = semPreco.filter(soPeloPendente).length;
    add({
      nivel: "aviso",
      codigo: "sem_preco",
      mensagem:
        "Linhas com excesso (podem ser origem) sem custo nem preço de lista: o que elas transferirem sai sem valor em R$." +
        (pendente ? ` ${pendente} delas só têm excesso por causa do pendente — com "Excesso físico" ligado, saem da conta.` : ""),
      qtd: semPreco.length,
      exemplos: semPreco.slice(0, 5).map((l) => l.idSku),
    });
  }

  const custoZero = base.filter((l) => l.custoReposicao === 0);
  if (custoZero.length) {
    const comLista = custoZero.filter((l) => l.precoLista > 0).length;
    add({
      nivel: "info",
      codigo: "custo_zero",
      mensagem:
        `Linhas sem custo de reposição${comLista ? ` (${comLista} usam o preço de lista)` : ""}. Como destino não pesam: a transferência é valorizada pelo custo do CD de origem.`,
      qtd: custoZero.length,
      exemplos: custoZero.slice(0, 5).map((l) => l.idSku),
    });
  }

  const embZero = origens.filter((l) => l.embCompra <= 0);
  if (embZero.length)
    add({ nivel: "aviso", codigo: "emb_zero", mensagem: "Linhas com excesso (podem ser origem) e embalagem de compra <= 0: a transferência em caixas fica 0 e a caixa fechada não se aplica.", qtd: embZero.length, exemplos: embZero.slice(0, 5).map((l) => l.idSku) });

  const semGiro = base.filter((l) => l.vendaMedia3m <= 0 && l.estoqueDisponivel + l.quantidadePendente > 0);
  if (semGiro.length)
    add({ nivel: "info", codigo: "sem_giro", mensagem: "Linhas sem giro (venda média 0 e estoque > 0): cobertura tratada como 'Sem giro'.", qtd: semGiro.length, exemplos: semGiro.slice(0, 5).map((l) => l.idSku) });

  if (modoDemanda === "pedidos" && pedidos.length > 0) {
    const cdsPedido = Array.from(new Set(pedidos.map((p) => p.cdDestino))).sort((a, b) => a - b);
    const foraDaBase = cdsPedido.filter((c) => !cdsBase.includes(c));
    if (foraDaBase.length)
      add({ nivel: "aviso", codigo: "cd_pedido_fora_base", mensagem: "CDs presentes na base de pedidos que não existem na base de CDs.", qtd: foraDaBase.length, exemplos: foraDaBase.map((c) => `CD ${c}`) });
  }

  // Fatores logísticos disponíveis — habilitam as métricas de capacidade.
  if (base.length > 0) {
    const comPalete = base.filter((l) => (l.unidadesPorPalete ?? 0) > 0).length;
    const comPeso = base.filter((l) => (l.pesoUnitario ?? 0) > 0).length;
    const comCubagem = base.filter((l) => (l.cubagemUnitaria ?? 0) > 0).length;
    const disponiveis = ["unidades", "valor"];
    if (base.some((l) => l.embCompra > 0)) disponiveis.push("caixas");
    if (comPalete) disponiveis.push(`paletes (${comPalete} SKUs)`);
    if (comPeso) disponiveis.push(`peso (${comPeso} SKUs)`);
    if (comCubagem) disponiveis.push(`volume (${comCubagem} SKUs)`);
    add({
      nivel: "info",
      codigo: "metricas_capacidade",
      mensagem: "Métricas de capacidade operacional que esta base sustenta.",
      qtd: disponiveis.length,
      exemplos: disponiveis,
    });
  }

  const ok = !achados.some((a) => a.nivel === "erro");
  return { baseLinhas: base.length, pedidosLinhas: pedidos.length, cdsBase, diagBase, diagPedidos, achados, ok };
}

/** Relatório da importação de faturamento (baixa das sugestões aprovadas). */
export interface RelatorioFaturamento {
  linhas: number;
  quantidadeTotal: number;
  baixadas: number; // sugestões que receberam baixa
  qtdBaixada: number;
  semCorrespondencia: { cdOrigem: number; cdDestino: number; codigoProduto: number; quantidade: number }[];
  achados: Achado[];
  ok: boolean;
}

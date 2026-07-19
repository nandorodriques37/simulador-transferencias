// ---------------------------------------------------------------------------
// Esquema canônico das bases de ENTRADA (colunas cruas do ERP/forecast).
//
// Princípio (melhoria #1): a base anexada NÃO precisa conter nenhuma coluna de
// FÓRMULA da planilha original. Tudo que é fórmula (ID, EXCESSO*, EXCESSOS+PEND,
// PEDIDOS ... CD x, TRANSF..., SOBRA..., colunas em R$) é recalculado pelo motor
// a partir das colunas cruas abaixo. Este arquivo é a fonte da verdade tanto do
// parser quanto da validação de importação.
// ---------------------------------------------------------------------------

export type TipoCol = "int" | "num" | "str";

export interface ColSpec {
  campo: string; // nome interno
  rotulo: string; // rótulo para o usuário
  aliases: string[]; // cabeçalhos aceitos (na planilha original e variações)
  required: boolean; // coluna obrigatória para o cálculo
  tipo: TipoCol;
  naoNegativo?: boolean; // erro se valor < 0
  chave?: boolean; // compõe a chave de deduplicação
}

// --- Posição de estoque do CD de origem (equivale à aba BASE_MODELOS) --------
export const SCHEMA_POSICAO: ColSpec[] = [
  { campo: "codigoProduto", rotulo: "Código do produto", aliases: ["CodsemDv", "codigo_produto", "codigoProduto", "codigo", "Cod"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "deposito", rotulo: "Depósito (CD origem)", aliases: ["Deposito", "deposito"], required: false, tipo: "int", chave: true },
  { campo: "produto", rotulo: "Descrição do produto", aliases: ["Produto", "descricao", "produto", "nome_produto"], required: false, tipo: "str" },
  { campo: "estoqueDisponivel", rotulo: "Estoque disponível", aliases: ["Estoque_DISP_CDs", "estoque_disponivel", "estoqueDisponivel", "EstoqueDisponivel"], required: true, tipo: "num", naoNegativo: true },
  { campo: "estoqueObjetivo", rotulo: "Estoque objetivo", aliases: ["ESTOQUE_OBJETIVO", "estoque_objetivo", "estoqueObjetivo"], required: true, tipo: "num", naoNegativo: true },
  { campo: "quantidadePendente", rotulo: "Quantidade pendente", aliases: ["Quant.Pendente", "quantidade_pendente", "quantidadePendente", "QuantPendente"], required: false, tipo: "num", naoNegativo: true },
  { campo: "vendaMedia3m", rotulo: "Venda média 3 meses", aliases: ["Venda_ QTD_Média3meses", "venda_media_3m", "Venda QTD Média 3 meses", "vendaMedia3m"], required: true, tipo: "num", naoNegativo: true },
  { campo: "custoReposicao", rotulo: "Custo de reposição", aliases: ["PRDP_VL_CMPCSICMS", "custo_reposicao", "custoReposicao"], required: false, tipo: "num", naoNegativo: true },
  { campo: "precoLista", rotulo: "Preço de lista", aliases: ["Preço Lista", "preco_lista", "precoLista", "PrecoLista"], required: false, tipo: "num", naoNegativo: true },
  { campo: "embCompra", rotulo: "Embalagem de compra (un/cx)", aliases: ["Qt_Emb_Compra", "emb_compra", "embCompra"], required: false, tipo: "num", naoNegativo: true },
  { campo: "fornecedor", rotulo: "Fornecedor", aliases: ["Fornecedor", "fornecedor"], required: false, tipo: "str" },
  { campo: "comprador", rotulo: "Comprador", aliases: ["Comprador", "comprador"], required: false, tipo: "str" },
  { campo: "analista", rotulo: "Analista", aliases: ["Analista", "analista"], required: false, tipo: "str" },
  { campo: "categoriaN1", rotulo: "Categoria nível 1", aliases: ["CAT_NÍVEL_1", "categoria_n1", "categoriaN1", "categoria_nivel_1"], required: false, tipo: "str" },
  { campo: "categoriaN2", rotulo: "Categoria nível 2", aliases: ["CAT_NÍVEL_2", "categoria_n2", "categoriaN2", "categoria_nivel_2"], required: false, tipo: "str" },
  { campo: "categoriaN3", rotulo: "Categoria nível 3", aliases: ["CAT_NÍVEL_3", "categoria_n3", "categoriaN3", "categoria_nivel_3"], required: false, tipo: "str" },
  { campo: "categoriaN4", rotulo: "Categoria nível 4", aliases: ["CAT_NÍVEL_4", "categoria_n4", "categoriaN4", "categoria_nivel_4"], required: false, tipo: "str" },
  { campo: "flagAme", rotulo: "Flag AME", aliases: ["FLAG_AME", "flag_ame", "ame"], required: false, tipo: "str" },
  { campo: "monitorado", rotulo: "Monitorado", aliases: ["Monitorado", "monitorado"], required: false, tipo: "str" },
  { campo: "marcaPropria", rotulo: "Marca própria", aliases: ["MARCA_PROPRIA", "marca_propria", "marcaPropria"], required: false, tipo: "str" },
  { campo: "leadTime", rotulo: "Lead time", aliases: ["LeadTimeReal", "lead_time", "leadTime"], required: false, tipo: "num" },
];

// --- Pedidos projetados / DRP (equivale à aba PEDIDOS PROJETADOS) ------------
export const SCHEMA_PEDIDOS: ColSpec[] = [
  { campo: "anoMes", rotulo: "Ano-mês (AAAA_MM)", aliases: ["ano_mes", "anoMes", "ano mes"], required: true, tipo: "str", chave: true },
  { campo: "cdDestino", rotulo: "CD destino", aliases: ["codigo_deposito_pd", "cd_destino", "cdDestino", "cd"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "codigoProduto", rotulo: "Código do produto", aliases: ["codigo_produto", "codigoProduto", "CodsemDv", "codigo"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "pedido", rotulo: "Pedido projetado (qtd)", aliases: ["pedido"], required: true, tipo: "num", naoNegativo: true },
  { campo: "estoqueAtual", rotulo: "Estoque atual destino", aliases: ["estoque_atual", "estoqueAtual"], required: false, tipo: "num" },
  { campo: "estoqueProjetado", rotulo: "Estoque projetado destino", aliases: ["estoque_projetado", "estoqueProjetado"], required: false, tipo: "num" },
  { campo: "eo", rotulo: "Estoque objetivo destino", aliases: ["eo"], required: false, tipo: "num" },
];

// --- Campos CALCULADOS pelo app (o que eram fórmulas na planilha) ------------
// Documentação viva do mapeamento fórmula → regra do motor. Nenhum destes
// precisa existir na base anexada.
export const CAMPOS_CALCULADOS: { campo: string; origemPlanilha: string; regra: string }[] = [
  { campo: "id_sku", origemPlanilha: "ID (dep+cod)", regra: "deposito + '-' + codigo_produto" },
  { campo: "preco", origemPlanilha: "SE(custo=0; preço lista; custo)", regra: "REGRA 1 — custo de reposição; se 0, preço de lista" },
  { campo: "excesso_em_stk", origemPlanilha: "EXCESSO EM STK", regra: "MAX(estoque_disponivel - estoque_objetivo, 0)" },
  { campo: "excesso_transferivel", origemPlanilha: "EXCESSOS + PEND", regra: "REGRA 2 — MAX(disp + pendente - venda_media - objetivo, 0)" },
  { campo: "pedido_mes_cd", origemPlanilha: "PEDIDOS <mês> CD x (XLOOKUP)", regra: "REGRA 3 — join indexado em pedidos_projetados por (ano_mes, cd, codigo)" },
  { campo: "transf_mes_cd", origemPlanilha: "TRANSF. <mês> CD x", regra: "REGRA 4 — cascata por prioridade (cumsum-clamp)" },
  { campo: "sobra_mes", origemPlanilha: "SOBRA 1/2/3", regra: "REGRA 4 — saldo do excesso após os CDs de cada mês" },
  { campo: "valor_transf", origemPlanilha: "Valor Transf. <mês> (R$)", regra: "REGRA 5 — transf * preco" },
  { campo: "qtd_transf_imediata", origemPlanilha: "Qtd Transf. Imediata", regra: "REGRA 5/6 — MIN(transf_m1, disp - venda_media*fator_seguranca)" },
  { campo: "imediata_caixas", origemPlanilha: "Transf. Imediata (cx)", regra: "REGRA 6 — ROUNDDOWN(qtd_imediata / emb_compra); < 1 caixa => 0" },
  { campo: "caixas", origemPlanilha: "Transf. <mês> (cx)", regra: "REGRA 6 — arredondamento por embalagem de compra" },
  { campo: "cobertura_dias", origemPlanilha: "Status Cobertura (>90d)", regra: "REGRA 7 — (disp+pend)*30/venda_media" },
  { campo: "impacto_fiscal", origemPlanilha: "Impacto fiscal", regra: "REGRA 8 — soma(valor_transf no horizonte) * aliquota[cd]" },
];

export function normKey(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

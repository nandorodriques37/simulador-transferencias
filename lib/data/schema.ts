// ---------------------------------------------------------------------------
// Esquema canônico das bases de ENTRADA (colunas cruas do ERP/forecast).
//
// A partir da v2 são apenas DUAS bases obrigatórias na análise:
//   1) BASE ÚNICA DE CDs  — mesmo layout da antiga base de origem, agora com
//      TODOS os CDs empilhados. Serve como base de ORIGEM (o que sobra) e como
//      base de DESTINO (o que falta para o estoque objetivo).
//   2) BASE DE PEDIDOS    — pedidos projetados por (mês × CD × produto). Só é
//      usada quando a análise roda no modo "pedidos".
//
// Há ainda uma base auxiliar, importada fora da análise:
//   3) BASE DE FATURAMENTO — transferências efetivamente realizadas, que dão
//      baixa nas sugestões aprovadas (o estoque já saiu da origem e já entrou
//      como pendência/trânsito no destino).
//
// A base anexada NÃO precisa conter nenhuma coluna de fórmula: tudo que era
// fórmula na planilha original é recalculado pelo motor (ver CAMPOS_CALCULADOS).
// ---------------------------------------------------------------------------

export type TipoCol = "int" | "num" | "str";

export interface ColSpec {
  campo: string; // nome interno
  rotulo: string; // rótulo para o usuário
  aliases: string[]; // cabeçalhos aceitos (planilha original e variações)
  required: boolean; // coluna obrigatória para o cálculo
  tipo: TipoCol;
  naoNegativo?: boolean; // erro se valor < 0
  chave?: boolean; // compõe a chave de deduplicação
}

// --- 1) Base única de CDs (origem E destino) --------------------------------
export const SCHEMA_BASE: ColSpec[] = [
  { campo: "cd", rotulo: "CD (depósito)", aliases: ["Deposito", "deposito", "cd", "CD", "codigo_deposito", "deposito_origem", "cd_origem"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "codigoProduto", rotulo: "Código do produto", aliases: ["CodsemDv", "codigo_produto", "codigoProduto", "codigo", "Cod", "produto_codigo"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "produto", rotulo: "Descrição do produto", aliases: ["Produto", "descricao", "produto", "nome_produto", "Descrição"], required: false, tipo: "str" },
  { campo: "estoqueDisponivel", rotulo: "Estoque disponível", aliases: ["Estoque_DISP_CDs", "estoque_disponivel", "estoqueDisponivel", "EstoqueDisponivel", "estoque_disp"], required: true, tipo: "num", naoNegativo: true },
  { campo: "estoqueObjetivo", rotulo: "Estoque objetivo", aliases: ["ESTOQUE_OBJETIVO", "estoque_objetivo", "estoqueObjetivo", "saldo_estoque_objetivo", "eo"], required: true, tipo: "num", naoNegativo: true },
  { campo: "quantidadePendente", rotulo: "Quantidade pendente", aliases: ["Quant.Pendente", "quantidade_pendente", "quantidadePendente", "QuantPendente", "pendente", "em_transito"], required: false, tipo: "num", naoNegativo: true },
  { campo: "vendaMedia3m", rotulo: "Venda média 3 meses", aliases: ["Venda_ QTD_Média3meses", "venda_media_3m", "Venda QTD Média 3 meses", "vendaMedia3m", "venda_media"], required: true, tipo: "num", naoNegativo: true },
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

// --- 2) Base de pedidos projetados (DRP) ------------------------------------
export const SCHEMA_PEDIDOS: ColSpec[] = [
  { campo: "anoMes", rotulo: "Ano-mês (AAAA_MM)", aliases: ["ano_mes", "anoMes", "ano mes", "mes", "competencia"], required: true, tipo: "str", chave: true },
  { campo: "cdDestino", rotulo: "CD destino", aliases: ["codigo_deposito_pd", "cd_destino", "cdDestino", "cd", "deposito"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "codigoProduto", rotulo: "Código do produto", aliases: ["codigo_produto", "codigoProduto", "CodsemDv", "codigo", "produto"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "pedido", rotulo: "Pedido projetado (qtd)", aliases: ["pedido", "qtd_pedido", "necessidade_compra"], required: true, tipo: "num", naoNegativo: true },
];

// --- 3) Base de faturamento (transferências realizadas) ---------------------
export const SCHEMA_FATURAMENTO: ColSpec[] = [
  { campo: "cdOrigem", rotulo: "CD origem", aliases: ["cd_origem", "cdOrigem", "deposito_origem", "origem", "deposito"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "cdDestino", rotulo: "CD destino", aliases: ["cd_destino", "cdDestino", "deposito_destino", "destino"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "codigoProduto", rotulo: "Código do produto", aliases: ["codigo_produto", "codigoProduto", "CodsemDv", "codigo", "produto"], required: true, tipo: "int", naoNegativo: true, chave: true },
  { campo: "quantidade", rotulo: "Quantidade faturada", aliases: ["quantidade", "qtd", "qtd_faturada", "quantidade_faturada", "qtd_transferida"], required: true, tipo: "num", naoNegativo: true },
  { campo: "documento", rotulo: "Documento / NF", aliases: ["documento", "nf", "nota_fiscal", "num_nf", "pedido_transferencia"], required: false, tipo: "str" },
  { campo: "data", rotulo: "Data do faturamento", aliases: ["data", "data_faturamento", "dt_emissao", "emissao"], required: false, tipo: "str" },
];

// --- Campos CALCULADOS pelo app (o que eram fórmulas na planilha) -----------
export const CAMPOS_CALCULADOS: { campo: string; origemPlanilha: string; regra: string }[] = [
  { campo: "id_sku", origemPlanilha: "ID (dep+cod)", regra: "cd + '-' + codigo_produto" },
  { campo: "preco", origemPlanilha: "SE(custo=0; preço lista; custo)", regra: "REGRA 1 — custo de reposição; se 0, preço de lista" },
  { campo: "excesso_transferivel", origemPlanilha: "EXCESSOS + PEND", regra: "REGRA 2 — MAX(disp + pendente − venda média − objetivo, 0), por CD de origem" },
  { campo: "necessidade_destino", origemPlanilha: "Saldo de estoque objetivo", regra: "REGRA 3 — MAX(objetivo − disp − pendente, 0), por CD de destino (modo saldo ideal)" },
  { campo: "pedido_mes_cd", origemPlanilha: "PEDIDOS <mês> CD x (XLOOKUP)", regra: "REGRA 3 — join indexado na base de pedidos (modo pedidos)" },
  { campo: "transf_rota", origemPlanilha: "TRANSF. <mês> CD x", regra: "REGRA 4 — cascata por prioridade (cumsum-clamp), origem a origem" },
  { campo: "valor_transf", origemPlanilha: "Valor Transf. (R$)", regra: "REGRA 5 — transf * preço da origem" },
  { campo: "qtd_transf_imediata", origemPlanilha: "Qtd Transf. Imediata", regra: "REGRA 5/6 — MIN(transf, disp − venda média * fator), rateado entre destinos na ordem" },
  { campo: "imediata_caixas", origemPlanilha: "Transf. Imediata (cx)", regra: "REGRA 6 — ROUNDDOWN(qtd imediata / emb); < 1 caixa ⇒ 0" },
  { campo: "cobertura_dias", origemPlanilha: "Status Cobertura (>90d)", regra: "REGRA 7 — (disp+pend)*30/venda média, no CD de origem" },
  { campo: "impacto_fiscal", origemPlanilha: "Impacto fiscal", regra: "REGRA 8 — valor transferido * alíquota da ROTA (origem→destino)" },
];

export function normKey(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

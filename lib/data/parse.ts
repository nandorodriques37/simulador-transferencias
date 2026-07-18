import { PedidoProjetado, PosicaoEstoque } from "@/lib/engine/types";
import { CD_ORIGEM_PADRAO } from "./defaults";

/** Normaliza cabeçalho: minúsculas, sem acento, sem separadores. */
export function normKey(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pick(row: Record<string, unknown>, aliases: string[]): unknown {
  const norm: Record<string, unknown> = {};
  for (const k of Object.keys(row)) norm[normKey(k)] = row[k];
  for (const a of aliases) {
    const v = norm[normKey(a)];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function num(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

const A = {
  codigo: ["CodsemDv", "codigo_produto", "codigoProduto", "codigo", "Cod"],
  deposito: ["Deposito", "deposito"],
  produto: ["Produto", "descricao", "produto", "nome_produto"],
  disp: ["Estoque_DISP_CDs", "estoque_disponivel", "estoqueDisponivel", "EstoqueDisponivel"],
  objetivo: ["ESTOQUE_OBJETIVO", "estoque_objetivo", "estoqueObjetivo"],
  pendente: ["Quant.Pendente", "quantidade_pendente", "quantidadePendente", "QuantPendente"],
  vmed: ["Venda_ QTD_Média3meses", "venda_media_3m", "Venda QTD Média 3 meses", "vendaMedia3m"],
  custo: ["PRDP_VL_CMPCSICMS", "custo_reposicao", "custoReposicao"],
  lista: ["Preço Lista", "preco_lista", "precoLista", "PrecoLista"],
  emb: ["Qt_Emb_Compra", "emb_compra", "embCompra"],
  fornecedor: ["Fornecedor", "fornecedor"],
  comprador: ["Comprador", "comprador"],
  analista: ["Analista", "analista"],
  cat1: ["CAT_NÍVEL_1", "categoria_n1", "categoriaN1", "categoria_nivel_1"],
  cat2: ["CAT_NÍVEL_2", "categoria_n2", "categoriaN2", "categoria_nivel_2"],
  cat3: ["CAT_NÍVEL_3", "categoria_n3", "categoriaN3", "categoria_nivel_3"],
  cat4: ["CAT_NÍVEL_4", "categoria_n4", "categoriaN4", "categoria_nivel_4"],
  ame: ["FLAG_AME", "flag_ame", "ame"],
  monit: ["Monitorado", "monitorado"],
  marca: ["MARCA_PROPRIA", "marca_propria", "marcaPropria"],
  lead: ["LeadTimeReal", "lead_time", "leadTime"],
};

const P = {
  anoMes: ["ano_mes", "anoMes", "ano mes"],
  cd: ["codigo_deposito_pd", "cd_destino", "cdDestino", "cd"],
  codigo: ["codigo_produto", "codigoProduto", "CodsemDv", "codigo"],
  pedido: ["pedido"],
  estoqueAtual: ["estoque_atual", "estoqueAtual"],
  estoqueProjetado: ["estoque_projetado", "estoqueProjetado"],
  eo: ["eo"],
};

export function parsePosicao(rows: Record<string, unknown>[]): PosicaoEstoque[] {
  const out: PosicaoEstoque[] = [];
  for (const row of rows) {
    const codigo = Math.round(num(pick(row, A.codigo)));
    if (!codigo) continue;
    const deposito = Math.round(num(pick(row, A.deposito))) || CD_ORIGEM_PADRAO;
    out.push({
      idSku: `${deposito}-${codigo}`,
      deposito,
      codigoProduto: codigo,
      produto: str(pick(row, A.produto)),
      estoqueDisponivel: num(pick(row, A.disp)),
      estoqueObjetivo: num(pick(row, A.objetivo)),
      quantidadePendente: num(pick(row, A.pendente)),
      vendaMedia3m: num(pick(row, A.vmed)),
      custoReposicao: num(pick(row, A.custo)),
      precoLista: num(pick(row, A.lista)),
      embCompra: num(pick(row, A.emb)),
      fornecedor: str(pick(row, A.fornecedor)),
      comprador: str(pick(row, A.comprador)),
      analista: str(pick(row, A.analista)),
      categoriaN1: str(pick(row, A.cat1)),
      categoriaN2: str(pick(row, A.cat2)),
      categoriaN3: str(pick(row, A.cat3)),
      categoriaN4: str(pick(row, A.cat4)),
      flagAme: str(pick(row, A.ame)),
      monitorado: str(pick(row, A.monit)),
      marcaPropria: str(pick(row, A.marca)),
      leadTime: num(pick(row, A.lead)),
    });
  }
  return out;
}

export function parsePedidos(rows: Record<string, unknown>[]): PedidoProjetado[] {
  const out: PedidoProjetado[] = [];
  for (const row of rows) {
    const anoMes = str(pick(row, P.anoMes));
    const cd = Math.round(num(pick(row, P.cd)));
    const codigo = Math.round(num(pick(row, P.codigo)));
    if (!anoMes || !cd || !codigo) continue;
    out.push({
      anoMes,
      cdDestino: cd,
      codigoProduto: codigo,
      pedido: num(pick(row, P.pedido)),
      estoqueAtual: num(pick(row, P.estoqueAtual)),
      estoqueProjetado: num(pick(row, P.estoqueProjetado)),
      eo: num(pick(row, P.eo)),
    });
  }
  return out;
}

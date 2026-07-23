import { LinhaPlano, qtdTotalLinha, valorTotalLinha } from "@/lib/engine/types";
import { rotuloMes } from "@/lib/data/defaults";

const dec = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * Colunas do plano (base de acompanhamento). A estrutura é a MESMA nos dois
 * modelos: as colunas mês a mês permanecem — no modelo "estoque objetivo" elas
 * saem ZERADAS — e há a nova coluna "Transferir p/ Atender Estoque Objetivo".
 */
export function colunasPlano(meses: string[]): string[] {
  const rot = meses.map(rotuloMes);
  return [
    "CD",
    "Deposito",
    "CodsemDv",
    "Produto",
    "Fornecedor",
    "Comprador",
    "Analista",
    "Categoria N1",
    ...rot.map((m) => `Pedido ${m}`),
    ...rot.map((m) => `Transf. ${m}`),
    "Transferir p/ Atender Estoque Objetivo (un)",
    "Preço Unitário",
    ...rot.map((m) => `Valor Transf. ${m}`),
    "Valor Transf. Estoque Objetivo",
    "Qtd Transf. Imediata",
    "Valor Transf. Imediata",
    "Emb. Compra (un/cx)",
    "Transf. Imediata (cx)",
    "Qtd Transf Unidade Arredond",
    ...rot.map((m) => `Transf. ${m} (cx)`),
    "Transf. Estoque Objetivo (cx)",
    "Cobertura (dias)",
    "Status Cobertura (>90d)",
  ];
}

export function linhaParaArray(l: LinhaPlano): (string | number)[] {
  return [
    `CD ${l.cdDestino}`,
    l.deposito,
    l.codigoProduto,
    l.produto,
    l.fornecedor,
    l.comprador,
    l.analista,
    l.categoriaN1,
    ...l.pedidoMes,
    ...l.transfMes,
    l.transfObjetivo,
    l.precoUnitario,
    ...l.valorTransfMes,
    l.valorTransfObjetivo,
    l.qtdTransfImediata,
    l.valorTransfImediata,
    l.embCompra,
    l.imediataCaixas,
    l.qtdImediataArredondada,
    ...l.transfCaixasMes,
    l.transfObjetivoCaixas,
    Math.round(l.coberturaDias),
    l.statusCobertura,
  ];
}

/** CSV pt-BR (separador ';', decimais com vírgula) — abre direto no Excel BR. */
export function planoParaCsv(linhas: LinhaPlano[], meses: string[]): string {
  const header = colunasPlano(meses);
  const linhasCsv = [header.join(";")];
  for (const l of linhas) {
    const arr = linhaParaArray(l).map((v) => {
      if (typeof v === "number") return Number.isInteger(v) ? String(v) : dec(v);
      return `"${String(v).replace(/"/g, '""')}"`;
    });
    linhasCsv.push(arr.join(";"));
  }
  return "﻿" + linhasCsv.join("\r\n");
}

/** Ordem de transferência para ERP/WMS (linhas aprovadas). */
export function ordemTransferenciaCsv(linhas: LinhaPlano[], meses: string[], aprovador: string, versionId: string): string {
  const header = ["Ordem", "Origem", "Destino", "Codigo Produto", "Produto", "Qtd Transferir (un)", "Qtd (caixas)", "Emb (un/cx)", "Valor (R$)", "Aprovado Por", "Versao", "Gerado Em"];
  const emissao = new Date().toISOString();
  const rows = [header.join(";")];
  linhas.forEach((l, i) => {
    // Total transferido = meses + estoque objetivo (funciona nos dois modelos).
    const qtd = qtdTotalLinha(l);
    const caixas = l.transfCaixasMes.reduce((a, b) => a + b, 0) + l.transfObjetivoCaixas;
    const valor = valorTotalLinha(l);
    rows.push([
      `OT-${versionId}-${String(i + 1).padStart(5, "0")}`,
      `CD ${l.deposito}`,
      `CD ${l.cdDestino}`,
      l.codigoProduto,
      `"${l.produto.replace(/"/g, '""')}"`,
      int(qtd),
      int(caixas),
      l.embCompra,
      dec(valor),
      aprovador,
      versionId,
      emissao,
    ].join(";"));
  });
  return "﻿" + rows.join("\r\n");
}

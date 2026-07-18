import { LinhaPlano } from "@/lib/engine/types";
import { rotuloMes } from "@/lib/data/defaults";

const dec = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/** Colunas do plano, espelhando a aba Transferencias_Long. */
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
    "Preço Unitário",
    ...rot.map((m) => `Valor Transf. ${m}`),
    "Qtd Transf. Imediata",
    "Valor Transf. Imediata",
    "Emb. Compra (un/cx)",
    "Transf. Imediata (cx)",
    "Qtd Transf Unidade Arredond",
    ...rot.map((m) => `Transf. ${m} (cx)`),
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
    l.precoUnitario,
    ...l.valorTransfMes,
    l.qtdTransfImediata,
    l.valorTransfImediata,
    l.embCompra,
    l.imediataCaixas,
    l.qtdImediataArredondada,
    ...l.transfCaixasMes,
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
    const qtd = l.transfMes.reduce((a, b) => a + b, 0);
    const caixas = l.transfCaixasMes.reduce((a, b) => a + b, 0);
    const valor = l.valorTransfMes.reduce((a, b) => a + b, 0);
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

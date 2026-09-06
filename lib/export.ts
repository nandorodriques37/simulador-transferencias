import { LinhaPlano } from "@/lib/engine/types";
import { rotuloMes } from "@/lib/data/defaults";
import { Sugestao } from "@/lib/store/carteira";

const dec = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * Colunas do plano de rede. A linha é a ROTA (CD origem → CD destino) × SKU.
 * No modo "pedidos" há as colunas mês a mês; no modo "saldo ideal" há a coluna
 * única de necessidade/transferência.
 */
export function colunasPlano(meses: string[], modoPedidos: boolean): string[] {
  const rot = meses.map(rotuloMes);
  return [
    "CD Origem",
    "CD Destino",
    "Rota",
    "CodsemDv",
    "Produto",
    "Fornecedor",
    "Comprador",
    "Analista",
    "Categoria N1",
    ...(modoPedidos ? rot.map((m) => `Pedido ${m}`) : ["Necessidade destino (un)"]),
    ...(modoPedidos ? rot.map((m) => `Transf. ${m}`) : ["Transferir (un)"]),
    "Qtd Total (un)",
    "Preço Unitário",
    "Valor Total (R$)",
    "Emb. Compra (un/cx)",
    "Qtd Total (cx)",
    "Qtd Transf. Imediata",
    "Transf. Imediata (cx)",
    "Qtd Imediata Arredondada",
    "Valor Transf. Imediata",
    "Cobertura origem (dias)",
    "Status Cobertura",
    "Alíquota da rota (%)",
    "Impacto fiscal (R$)",
  ];
}

export function linhaParaArray(l: LinhaPlano, modoPedidos: boolean): (string | number)[] {
  return [
    `CD ${l.cdOrigem}`,
    `CD ${l.cdDestino}`,
    l.rota,
    l.codigoProduto,
    l.produto,
    l.fornecedor,
    l.comprador,
    l.analista,
    l.categoriaN1,
    ...(modoPedidos ? l.demandaMes : [l.demandaSaldo]),
    ...(modoPedidos ? l.transfMes : [l.transfSaldo]),
    l.transfTotal,
    l.precoUnitario,
    l.valorTotal,
    l.embCompra,
    l.caixas,
    l.qtdImediata,
    l.imediataCaixas,
    l.qtdImediataArredondada,
    l.valorImediata,
    Math.round(l.coberturaDias),
    l.statusCobertura,
    Math.round(l.aliquota * 1000000) / 10000, // em %
    l.impactoFiscal,
  ];
}

/** CSV pt-BR (separador ';', decimais com vírgula) — abre direto no Excel BR. */
export function planoParaCsv(linhas: LinhaPlano[], meses: string[], modoPedidos: boolean): string {
  const header = colunasPlano(meses, modoPedidos);
  const linhasCsv = [header.join(";")];
  for (const l of linhas) {
    const arr = linhaParaArray(l, modoPedidos).map((v) => {
      if (typeof v === "number") return Number.isInteger(v) ? String(v) : dec(v);
      return `"${String(v).replace(/"/g, '""')}"`;
    });
    linhasCsv.push(arr.join(";"));
  }
  return "﻿" + linhasCsv.join("\r\n");
}

/** Ordem de transferência para ERP/WMS a partir da carteira aprovada. */
export function ordemTransferenciaCsv(sugestoes: Sugestao[], solicitante: string): string {
  const header = [
    "Ordem",
    "Origem",
    "Destino",
    "Codigo Produto",
    "Produto",
    "Qtd Aprovada (un)",
    "Qtd Ja Faturada (un)",
    "Qtd Em Aberto (un)",
    "Qtd (caixas)",
    "Emb (un/cx)",
    "Valor Em Aberto (R$)",
    "Analise",
    "Aprovado Por",
    "Aprovado Em",
    "Gerado Por",
    "Gerado Em",
  ];
  const emissao = new Date().toISOString();
  const rows = [header.join(";")];
  sugestoes.forEach((s, i) => {
    const aberto = Math.max(s.qtd - s.qtdFaturada, 0);
    const caixas = s.embCompra > 0 ? Math.floor(aberto / s.embCompra) : 0;
    rows.push(
      [
        `OT-${s.analiseId}-${String(i + 1).padStart(5, "0")}`,
        `CD ${s.cdOrigem}`,
        `CD ${s.cdDestino}`,
        s.codigoProduto,
        `"${(s.produto ?? "").replace(/"/g, '""')}"`,
        int(s.qtd),
        int(s.qtdFaturada),
        int(aberto),
        int(caixas),
        s.embCompra,
        dec(aberto * s.preco),
        s.analiseId,
        s.criadoPor,
        s.criadoEm,
        solicitante,
        emissao,
      ].join(";"),
    );
  });
  return "﻿" + rows.join("\r\n");
}

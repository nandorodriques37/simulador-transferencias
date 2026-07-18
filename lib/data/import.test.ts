import { describe, expect, it } from "vitest";
import { parsePedidos, parsePosicao } from "./parse";
import { validarImportacao } from "./validate";

describe("parser dirigido por esquema", () => {
  it("aceita cabeçalhos da planilha original (BASE_MODELOS)", () => {
    const rows = [
      { CodsemDv: 3858, Deposito: 10, "Estoque_DISP_CDs": 74, "ESTOQUE_OBJETIVO": 88, "Venda_ QTD_Média3meses": 21, "PRDP_VL_CMPCSICMS": 73.54, "Qt_Emb_Compra": 10 },
    ];
    const { itens, diag } = parsePosicao(rows as any);
    expect(diag.faltando).toHaveLength(0);
    expect(itens[0].idSku).toBe("10-3858"); // idSku é CALCULADO (era fórmula na planilha)
    expect(itens[0].estoqueDisponivel).toBe(74);
  });

  it("aponta EXATAMENTE a coluna obrigatória que falta", () => {
    const rows = [{ CodsemDv: 1, ESTOQUE_OBJETIVO: 10, "Venda_ QTD_Média3meses": 5 }]; // falta estoque disponível
    const { diag } = parsePosicao(rows as any);
    const faltando = diag.faltando.map((f) => f.campo);
    expect(faltando).toContain("estoqueDisponivel");
    const rel = validarImportacao([], [], diag, undefined);
    const achado = rel.achados.find((a) => a.codigo === "coluna_faltando");
    expect(achado?.mensagem).toContain("Estoque disponível");
    expect(rel.ok).toBe(false);
  });

  it("reporta linha, coluna e valor de um valor negativo", () => {
    const rows = [
      { codigo_produto: 1, estoque_disponivel: 100, estoque_objetivo: 10, venda_media_3m: 5, custo_reposicao: -5 },
    ];
    const { diag } = parsePosicao(rows as any);
    expect(diag.errosLinha.length).toBe(1);
    expect(diag.errosLinha[0].coluna).toBe("custo_reposicao");
    expect(diag.errosLinha[0].linha).toBe(2); // cabeçalho=1, primeira linha=2
    const rel = validarImportacao([], [], diag, undefined);
    expect(rel.achados.some((a) => a.codigo === "erro_linha")).toBe(true);
  });

  it("reporta valor não numérico em coluna obrigatória", () => {
    const rows = [{ codigo_produto: 1, estoque_disponivel: "abc", estoque_objetivo: 10, venda_media_3m: 5 }];
    const { diag } = parsePosicao(rows as any);
    expect(diag.errosLinha[0].msg).toContain("não numérico");
  });

  it("detecta chave duplicada em pedidos projetados", () => {
    const rows = [
      { ano_mes: "2026_07", cd_destino: 1, codigo_produto: 10, pedido: 5 },
      { ano_mes: "2026_07", cd_destino: 1, codigo_produto: 10, pedido: 8 },
    ];
    const { itens, diag } = parsePedidos(rows as any);
    const rel = validarImportacao([], itens, undefined, diag);
    const dup = rel.achados.find((a) => a.codigo === "pedido_duplicado");
    expect(dup?.exemplos).toContain("2026_07|1|10");
    expect(rel.ok).toBe(false);
  });

  it("aceita números em formato pt-BR (1.234,56)", () => {
    const rows = [{ codigo_produto: 1, estoque_disponivel: "1.234,00", estoque_objetivo: "10", venda_media_3m: "5", custo_reposicao: "73,54" }];
    const { itens } = parsePosicao(rows as any);
    expect(itens[0].estoqueDisponivel).toBe(1234); // "1.234,00" pt-BR
    expect(itens[0].custoReposicao).toBe(73.54); // "73,54" pt-BR
  });
});

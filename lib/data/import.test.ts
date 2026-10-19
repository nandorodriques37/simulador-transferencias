import { describe, expect, it } from "vitest";
import { normalizarAnoMes, parseBase, parseFaturamento, parsePedidos } from "./parse";
import { detectarDelimitador, dividirLinhaCsv, tabelaDeCsv } from "./tabela";
import { validarImportacao } from "./validate";

// Cabeçalhos como saem da planilha original (com acento, espaço e ponto).
const linhaBase = (over: Record<string, unknown> = {}) => ({
  Deposito: 10,
  CodsemDv: 111,
  Produto: "DIPIRONA 500MG",
  Estoque_DISP_CDs: 1000,
  ESTOQUE_OBJETIVO: 100,
  "Quant.Pendente": 0,
  "Venda_ QTD_Média3meses": 200,
  PRDP_VL_CMPCSICMS: 10.5,
  Qt_Emb_Compra: 12,
  "CAT_NÍVEL_3": "SIST. NERVOSO",
  ...over,
});

describe("parse da base de CDs", () => {
  it("reconhece os cabeçalhos originais e monta o id por CD", () => {
    const { itens, diag } = parseBase([linhaBase(), linhaBase({ Deposito: 1, Estoque_DISP_CDs: 50, ESTOQUE_OBJETIVO: 600 })]);
    expect(diag.faltando).toHaveLength(0);
    expect(itens).toHaveLength(2);
    expect(itens[0].idSku).toBe("10-111");
    expect(itens[1].cd).toBe(1);
    expect(itens[0].vendaMedia3m).toBe(200);
  });

  it("aceita números em pt-BR e nomes alternativos de coluna", () => {
    const { itens } = parseBase([
      { cd: "10", codigo_produto: "111", produto: "DIPIRONA", categoria_n3: "ANALGÉSICOS", estoque_disponivel: "1.234,50", estoque_objetivo: "100", venda_media_3m: "10,5" },
    ]);
    expect(itens[0].estoqueDisponivel).toBeCloseTo(1234.5, 6);
    expect(itens[0].vendaMedia3m).toBeCloseTo(10.5, 6);
  });

  it("aceita custo e embalagem com nome curto (layout do extrator do BD)", () => {
    const { itens, diag } = parseBase([
      { cd: 1, codigo_produto: 8, descricao_produto: "DEPAKENE", categoria_n3: "SIST. NERVOSO", estoque_disponivel: 725, estoque_objetivo: 951, quantidade_pendente: 0, venda_media_3m: 705, custo: "66.6", embalagem: 112 },
    ]);
    expect(diag.ignoradas).toHaveLength(0);
    expect(itens[0].custoReposicao).toBeCloseTo(66.6, 6);
    expect(itens[0].embCompra).toBe(112);
  });

  it("aviso de preço só conta linha que pode ser origem", () => {
    const { itens, diag } = parseBase([
      { cd: 1, codigo_produto: 1, produto: "P", categoria_n3: "C", estoque_disponivel: 0, estoque_objetivo: 50, venda_media_3m: 10, custo: 0, embalagem: 0 }, // destino sem custo
      { cd: 2, codigo_produto: 1, produto: "P", categoria_n3: "C", estoque_disponivel: 500, estoque_objetivo: 50, venda_media_3m: 10, custo: 0, embalagem: 12 }, // origem sem custo
    ]);
    const r = validarImportacao(itens, [], diag, undefined, "saldo_ideal");
    expect(r.achados.find((a) => a.codigo === "sem_preco")?.qtd).toBe(1);
    expect(r.achados.find((a) => a.codigo === "custo_zero")?.nivel).toBe("info");
    expect(r.achados.some((a) => a.codigo === "emb_zero")).toBe(false);
  });

  it("bloqueia a base sem descrição ou sem categoria N3", () => {
    const { itens, diag } = parseBase([{ cd: 1, codigo_produto: 8, estoque_disponivel: 10, estoque_objetivo: 5, venda_media_3m: 1 }]);
    expect(diag.faltando.map((f) => f.campo).sort()).toEqual(["categoriaN3", "produto"]);
    const r = validarImportacao(itens, [], diag, undefined, "saldo_ideal");
    expect(r.ok).toBe(false);
    expect(r.achados.filter((x) => x.codigo === "coluna_faltando")).toHaveLength(2);
  });

  it("com as colunas presentes, linha em branco só informa", () => {
    const com = parseBase([
      { cd: 1, codigo_produto: 8, estoque_disponivel: 10, estoque_objetivo: 5, venda_media_3m: 1, produto: "DIPIRONA", categoria_n3: "ANALGÉSICOS" },
      { cd: 2, codigo_produto: 8, estoque_disponivel: 10, estoque_objetivo: 5, venda_media_3m: 1, produto: "DIPIRONA", categoria_n3: "" },
    ]);
    expect(com.itens[0].categoriaN3).toBe("ANALGÉSICOS");
    const r = validarImportacao(com.itens, [], com.diag, undefined, "saldo_ideal");
    expect(r.ok).toBe(true);
    expect(r.achados.find((x) => x.codigo === "descricao_vazia")).toMatchObject({ nivel: "info", qtd: 1 });
  });

  it("aponta a coluna obrigatória ausente com os nomes aceitos", () => {
    const { diag } = parseBase([{ Deposito: 10, CodsemDv: 111, Estoque_DISP_CDs: 10, ESTOQUE_OBJETIVO: 5 }]);
    expect(diag.faltando.map((f) => f.campo)).toContain("vendaMedia3m");
    expect(diag.faltando[0].aliases.length).toBeGreaterThan(0);
  });

  it("marca linha com valor negativo em coluna obrigatória", () => {
    const { itens, diag } = parseBase([linhaBase({ Estoque_DISP_CDs: -5 })]);
    expect(itens).toHaveLength(0);
    expect(diag.errosLinha[0].coluna).toBe("Estoque_DISP_CDs");
    expect(diag.errosLinha[0].linha).toBe(2);
  });
});

describe("parse de pedidos e faturamento", () => {
  it("normaliza o ano-mês em vários formatos", () => {
    expect(normalizarAnoMes("2026-07")).toBe("2026_07");
    expect(normalizarAnoMes("07/2026")).toBe("2026_07");
    expect(normalizarAnoMes("2026_7")).toBe("2026_07");
  });

  it("lê pedidos projetados", () => {
    const { itens } = parsePedidos([{ ano_mes: "2026-09", codigo_deposito_pd: 1, codigo_produto: 111, pedido: 300 }]);
    expect(itens[0]).toEqual({ anoMes: "2026_09", cdDestino: 1, codigoProduto: 111, pedido: 300 });
  });

  it("lê a base de faturamento com rota e quantidade", () => {
    const { itens } = parseFaturamento([{ cd_origem: 10, cd_destino: 1, codigo_produto: 111, quantidade: 400, nf: "NF-1" }]);
    expect(itens[0].cdOrigem).toBe(10);
    expect(itens[0].quantidade).toBe(400);
    expect(itens[0].documento).toBe("NF-1");
  });
});

describe("validação da importação", () => {
  it("aprova uma base com vários CDs", () => {
    const { itens, diag } = parseBase([linhaBase(), linhaBase({ Deposito: 1 })]);
    const rel = validarImportacao(itens, [], diag, undefined, "saldo_ideal");
    expect(rel.ok).toBe(true);
    expect(rel.cdsBase).toEqual([1, 10]);
  });

  it("bloqueia chave (CD, produto) duplicada", () => {
    const { itens, diag } = parseBase([linhaBase(), linhaBase()]);
    const rel = validarImportacao(itens, [], diag, undefined, "saldo_ideal");
    expect(rel.ok).toBe(false);
    expect(rel.achados.some((a) => a.codigo === "base_duplicada")).toBe(true);
  });

  it("avisa quando a base traz um único CD (não há rede)", () => {
    const { itens, diag } = parseBase([linhaBase()]);
    const rel = validarImportacao(itens, [], diag, undefined, "saldo_ideal");
    expect(rel.achados.some((a) => a.codigo === "base_um_cd")).toBe(true);
  });

  it("avisa que o modo Pedidos ficará vazio sem base de pedidos", () => {
    const { itens, diag } = parseBase([linhaBase(), linhaBase({ Deposito: 1 })]);
    const rel = validarImportacao(itens, [], diag, undefined, "pedidos");
    expect(rel.achados.some((a) => a.codigo === "pedidos_vazio")).toBe(true);
  });
});

describe("leitura de CSV (caminho leve)", () => {
  it("lê o cabeçalho, o delimitador e as linhas", () => {
    const t = tabelaDeCsv("a;b;c\n1;2;3\n4;5;6\n");
    expect(t.header).toEqual(["a", "b", "c"]);
    expect(t.total).toBe(2);
    const linhas: unknown[][] = [];
    t.forEach((c) => linhas.push([...c]));
    expect(linhas).toEqual([["1", "2", "3"], ["4", "5", "6"]]);
  });

  it("detecta vírgula e tabulação como delimitador", () => {
    expect(detectarDelimitador("a,b,c")).toBe(",");
    expect(detectarDelimitador("a\tb\tc")).toBe("\t");
    expect(detectarDelimitador("a;b;c")).toBe(";");
  });

  it("respeita aspas, delimitador dentro do texto e aspas escapadas", () => {
    expect(dividirLinhaCsv('1;"DIPIRONA; 500MG";3', ";")).toEqual(["1", "DIPIRONA; 500MG", "3"]);
    expect(dividirLinhaCsv('1;"DIZ ""OK""";3', ";")).toEqual(["1", 'DIZ "OK"', "3"]);
  });

  it("ignora BOM, CRLF e linhas em branco", () => {
    const t = tabelaDeCsv("﻿a;b\r\n1;2\r\n\r\n3;4\r\n");
    expect(t.header).toEqual(["a", "b"]);
    const linhas: unknown[][] = [];
    t.forEach((c) => linhas.push([...c]));
    expect(linhas).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("o parser dirigido por esquema consome CSV direto", () => {
    const csv = [
      "Deposito;CodsemDv;Produto;CAT_NÍVEL_3;Estoque_DISP_CDs;ESTOQUE_OBJETIVO;Venda_ QTD_Média3meses",
      "10;111;DIPIRONA;ANALGÉSICOS;1.000,50;100;200",
      "1;111;DIPIRONA;ANALGÉSICOS;50;600;120",
    ].join("\n");
    const { itens, diag } = parseBase(tabelaDeCsv(csv));
    expect(diag.faltando).toHaveLength(0);
    expect(itens).toHaveLength(2);
    expect(itens[0].estoqueDisponivel).toBeCloseTo(1000.5, 6);
    expect(itens[1].cd).toBe(1);
  });

  it("aponta a linha exata do erro no CSV", () => {
    const csv = [
      "Deposito;CodsemDv;Produto;CAT_NÍVEL_3;Estoque_DISP_CDs;ESTOQUE_OBJETIVO;Venda_ QTD_Média3meses",
      "10;111;A;C;100;100;200",
      "10;112;B;C;-5;100;200",
    ].join("\n");
    const { diag } = parseBase(tabelaDeCsv(csv));
    expect(diag.errosLinha[0].linha).toBe(3);
    expect(diag.errosLinha[0].coluna).toBe("Estoque_DISP_CDs");
  });
});

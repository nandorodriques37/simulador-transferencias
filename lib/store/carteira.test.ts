import { beforeEach, describe, expect, it } from "vitest";
import { carteira, normalizarDataFaturamento, qtdNaoRefletida, Sugestao } from "./carteira";

/**
 * O ciclo periódico: sobe base, analisa, aprova, fatura, sobe base nova.
 * Estes testes existem para garantir as duas invariantes que sustentam o app:
 * nenhuma transferência se perde, nenhuma é sugerida duas vezes.
 */

const g = globalThis as unknown as { __carteira?: Map<string, Sugestao>; __faturamentos?: unknown[] };
beforeEach(() => {
  g.__carteira = new Map();
  g.__faturamentos = [];
});

const item = (qtd: number, over: Partial<Parameters<typeof carteira.aprovar>[1][0]> = {}) => ({
  cdOrigem: 10, cdDestino: 1, codigoProduto: 111, produto: "DIPIRONA",
  qtd, valor: qtd * 10, preco: 10, embCompra: 12, ...over,
});

const D = (dia: number) => new Date(Date.UTC(2026, 8, dia, 12)).toISOString();

describe("normalização de data do faturamento", () => {
  it("aceita dd/mm/aaaa e ISO", () => {
    expect(normalizarDataFaturamento("15/09/2026")!.slice(0, 10)).toBe("2026-09-15");
    expect(normalizarDataFaturamento("2026-09-15")!.slice(0, 10)).toBe("2026-09-15");
    expect(normalizarDataFaturamento("")).toBeNull();
    expect(normalizarDataFaturamento("banana")).toBeNull();
  });
});

describe("o que a base já reflete", () => {
  const sugestao = (over: Partial<Sugestao> = {}): Sugestao => ({
    id: "s1", analiseId: "a1", criadoEm: D(1), criadoPor: "x",
    cdOrigem: 10, cdDestino: 1, codigoProduto: 111, produto: "P",
    qtd: 500, valor: 5000, preco: 10, embCompra: 12, detalhe: {},
    status: "aprovada", qtdFaturada: 0, baixas: [], faturadoEm: null, atualizadoEm: D(1),
    ...over,
  });

  it("aprovada e não faturada conta inteira", () => {
    expect(qtdNaoRefletida(sugestao(), D(10))).toBe(500);
  });

  it("faturada ANTES da base não conta — a base já mostra a saída", () => {
    const s = sugestao({ status: "faturada", qtdFaturada: 500, baixas: [{ qtd: 500, em: D(5), registradoEm: D(5) }] });
    expect(qtdNaoRefletida(s, D(10))).toBe(0);
  });

  it("faturada DEPOIS da base ainda conta — a base é anterior à movimentação", () => {
    const s = sugestao({ status: "faturada", qtdFaturada: 500, baixas: [{ qtd: 500, em: D(15), registradoEm: D(15) }] });
    expect(qtdNaoRefletida(s, D(10))).toBe(500);
  });

  it("baixa parcial separa o que a base reflete do que não reflete", () => {
    const s = sugestao({
      qtdFaturada: 300,
      baixas: [
        { qtd: 200, em: D(5), registradoEm: D(5) },  // a base já reflete
        { qtd: 100, em: D(15), registradoEm: D(15) }, // a base ainda não
      ],
    });
    // 200 em aberto + 100 faturados depois da base
    expect(qtdNaoRefletida(s, D(10))).toBe(300);
  });

  it("cancelada nunca conta", () => {
    expect(qtdNaoRefletida(sugestao({ status: "cancelada" }), D(1))).toBe(0);
  });

  it("sem data de referência, tudo que foi faturado conta (postura conservadora)", () => {
    const s = sugestao({ status: "faturada", qtdFaturada: 500, baixas: [{ qtd: 500, em: D(5), registradoEm: D(5) }] });
    expect(qtdNaoRefletida(s, "")).toBe(500);
  });
});

describe("aprovar sem duplicar", () => {
  it("análise que considerou a carteira SOMA (o número dela é o incremento)", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    const r = await carteira.aprovar("a2", [item(300)], "user", { consideraAprovadas: true });
    expect(r.gravadas).toBe(1);
    expect(r.ignoradas).toBe(0);
    const resumo = await carteira.resumo();
    expect(resumo.qtdAberta).toBe(800);
  });

  it("análise que IGNOROU a carteira não soma — grava só a diferença", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    // a2 rodou com a chave desligada: os 800 incluem os 500 já comprometidos
    const r = await carteira.aprovar("a2", [item(800)], "user", { consideraAprovadas: false });
    expect(r.conciliadas).toBe(1);
    const resumo = await carteira.resumo();
    expect(resumo.qtdAberta).toBe(800); // e não 1.300
  });

  it("análise que ignorou a carteira e sugere menos que o aberto é descartada", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    const r = await carteira.aprovar("a2", [item(400)], "user", { consideraAprovadas: false });
    expect(r.gravadas).toBe(0);
    expect(r.ignoradas).toBe(1);
    expect(r.avisos.join(" ")).toContain("já havia");
    expect((await carteira.resumo()).qtdAberta).toBe(500);
  });

  it("reaprovar a MESMA análise substitui, não soma", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    expect((await carteira.resumo()).qtdAberta).toBe(500);
  });

  it("o valor acompanha a quantidade conciliada", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    await carteira.aprovar("a2", [item(800)], "user", { consideraAprovadas: false });
    const itens = await carteira.listar({ status: "aprovada" });
    const da2 = itens.find((s) => s.analiseId === "a2")!;
    expect(da2.qtd).toBe(300);
    expect(da2.valor).toBeCloseTo(3000, 6); // 300 un × R$ 10
  });
});

describe("faturamento sem baixa dupla", () => {
  const fat = (qtd: number, over: Record<string, unknown> = {}) => ({
    cdOrigem: 10, cdDestino: 1, codigoProduto: 111, quantidade: qtd, ...over,
  });

  it("o mesmo arquivo importado duas vezes não baixa duas vezes", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    const r1 = await carteira.baixarFaturamento([fat(200)], "user", "fat.csv", "impressao-1");
    expect(r1.qtdBaixada).toBe(200);
    const r2 = await carteira.baixarFaturamento([fat(200)], "user", "fat.csv", "impressao-1");
    expect(r2.ok).toBe(false);
    expect(r2.qtdBaixada).toBe(0);
    expect((await carteira.resumo()).qtdAberta).toBe(300);
  });

  it("arquivo diferente com a mesma NF não baixa de novo aquela linha", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    await carteira.baixarFaturamento([fat(200, { documento: "NF-1" })], "user", "a.csv", "imp-a");
    const r = await carteira.baixarFaturamento([fat(200, { documento: "NF-1" })], "user", "b.csv", "imp-b");
    expect(r.qtdBaixada).toBe(0);
    expect(r.achados.some((a) => a.codigo === "documento_repetido")).toBe(true);
    expect((await carteira.resumo()).qtdAberta).toBe(300);
  });

  it("NF nova continua baixando normalmente", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    await carteira.baixarFaturamento([fat(200, { documento: "NF-1" })], "user", "a.csv", "imp-a");
    const r = await carteira.baixarFaturamento([fat(150, { documento: "NF-2" })], "user", "b.csv", "imp-b");
    expect(r.qtdBaixada).toBe(150);
    expect((await carteira.resumo()).qtdAberta).toBe(150);
  });

  it("a baixa guarda a data do faturamento vinda da planilha", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    await carteira.baixarFaturamento([fat(500, { data: "05/09/2026", documento: "NF-9" })], "user", "a.csv", "imp-a");
    const s = (await carteira.listar({ status: "todas" }))[0];
    expect(s.status).toBe("faturada");
    expect(s.baixas[0].em.slice(0, 10)).toBe("2026-09-05");
    // Base extraída depois do faturamento: já reflete, não vira compromisso.
    const c = await carteira.compromissos(D(10));
    expect(c.saidaOrigem.size).toBe(0);
    // Base extraída antes: ainda precisa contar.
    const c2 = await carteira.compromissos(D(1));
    expect(c2.saidaOrigem.get("10|111")).toBe(500);
  });
});

describe("ciclo completo de dois lotes", () => {
  it("segundo lote não repete o que o primeiro já transferiu", async () => {
    // Lote 1: aprova 500 e fatura tudo no dia 5.
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    await carteira.baixarFaturamento(
      [{ cdOrigem: 10, cdDestino: 1, codigoProduto: 111, quantidade: 500, data: "05/09/2026", documento: "NF-1" }],
      "user", "fat1.csv", "imp-1",
    );

    // Base nova, extraída no dia 10: já mostra a saída.
    const compDia10 = await carteira.compromissos(D(10));
    expect(compDia10.saidaOrigem.size).toBe(0);
    expect(compDia10.entradaDestino.size).toBe(0);

    // Lote 2 sobre a base nova: aprova mais 300 (volume novo, não repetido).
    const r = await carteira.aprovar("a2", [item(300)], "user", { consideraAprovadas: true });
    expect(r.gravadas).toBe(1);
    const resumo = await carteira.resumo();
    expect(resumo.qtdAberta).toBe(300);
    expect(resumo.qtdFaturada).toBe(500);
  });

  it("base atrasada não faz o app sugerir de novo o que já saiu", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    await carteira.baixarFaturamento(
      [{ cdOrigem: 10, cdDestino: 1, codigoProduto: 111, quantidade: 500, data: "15/09/2026", documento: "NF-1" }],
      "user", "fat1.csv", "imp-1",
    );
    // A base foi extraída no dia 10, ANTES do faturamento do dia 15.
    const comp = await carteira.compromissos(D(10));
    expect(comp.saidaOrigem.get("10|111")).toBe(500);
    expect(comp.entradaDestino.get("1|111")).toBe(500);
  });

  it("cancelar libera o compromisso para a próxima análise", async () => {
    await carteira.aprovar("a1", [item(500)], "user", { consideraAprovadas: true });
    const itens = await carteira.listar({ status: "aprovada" });
    await carteira.cancelar([itens[0].id], "user");
    const comp = await carteira.compromissos(D(10));
    expect(comp.saidaOrigem.size).toBe(0);
  });
});

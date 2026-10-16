import { describe, expect, it } from "vitest";
import { calcularAcompanhamento, diasEntre } from "./acompanhamento";
import type { Sugestao } from "@/lib/store/carteira";

const D = (dia: number) => new Date(Date.UTC(2026, 8, dia, 12)).toISOString();

let n = 0;
const sug = (over: Partial<Sugestao> = {}): Sugestao => ({
  id: `s${++n}`, analiseId: "a1", criadoEm: D(1), criadoPor: "x",
  cdOrigem: 10, cdDestino: 1, codigoProduto: n, produto: "P",
  qtd: 100, valor: 1000, preco: 10, embCompra: 12, detalhe: {},
  status: "aprovada", qtdFaturada: 0, baixas: [], faturadoEm: null, atualizadoEm: D(1),
  ...over,
});

describe("aprovado × faturado", () => {
  it("aprovado = faturado + em aberto + cancelado, e o cancelado não pesa no atendimento", () => {
    const r = calcularAcompanhamento([
      sug({ status: "faturada", qtdFaturada: 100, baixas: [{ qtd: 100, em: D(5), registradoEm: D(5) }] }),
      sug({ qtdFaturada: 40, baixas: [{ qtd: 40, em: D(3), registradoEm: D(3) }] }),
      sug({ status: "cancelada" }),
    ], Date.parse(D(20)));
    expect(r.total.aprovadoQtd).toBe(300);
    expect(r.total.faturadoQtd).toBe(140);
    expect(r.total.abertoQtd).toBe(60);
    expect(r.total.canceladoQtd).toBe(100);
    expect(r.total.faturadoQtd + r.total.abertoQtd + r.total.canceladoQtd).toBe(r.total.aprovadoQtd);
    expect(r.total.atendimento).toBeCloseTo(140 / 200);
    expect(r.total.faturadoValor).toBe(1400);
  });

  it("quebra por rota, origem e destino", () => {
    const r = calcularAcompanhamento([
      sug({ cdOrigem: 10, cdDestino: 1 }),
      sug({ cdOrigem: 10, cdDestino: 2, status: "faturada", qtdFaturada: 100, baixas: [{ qtd: 100, em: D(2), registradoEm: D(2) }] }),
      sug({ cdOrigem: 9, cdDestino: 1 }),
    ]);
    expect(r.porRota.map((x) => x.chave).sort()).toEqual(["10>1", "10>2", "9>1"]);
    const o10 = r.porOrigem.find((x) => x.cdOrigem === 10)!;
    expect(o10.aprovadoQtd).toBe(200);
    expect(o10.atendimento).toBeCloseTo(0.5);
    const d1 = r.porDestino.find((x) => x.cdDestino === 1)!;
    expect(d1.aprovadoQtd).toBe(200);
    expect(d1.faturadoQtd).toBe(0);
  });

  it("reaprovação abaixo do já faturado não gera faturado maior que o aprovado", () => {
    const r = calcularAcompanhamento([sug({ qtd: 50, qtdFaturada: 80, status: "faturada", baixas: [{ qtd: 80, em: D(4), registradoEm: D(4) }] })]);
    expect(r.total.faturadoQtd).toBe(50);
    expect(r.total.atendimento).toBe(1);
    expect(r.prazo.qtd).toBe(50);
  });
});

describe("tempo da aprovação até a NF", () => {
  it("mediana e média pesam pela quantidade faturada", () => {
    const r = calcularAcompanhamento([
      sug({ qtd: 900, status: "faturada", qtdFaturada: 900, baixas: [{ qtd: 900, em: D(3), registradoEm: D(3) }] }), // 2 dias
      sug({ qtd: 100, status: "faturada", qtdFaturada: 100, baixas: [{ qtd: 100, em: D(41), registradoEm: D(41) }] }), // 40 dias
    ]);
    expect(r.prazo.medianaDias).toBe(2);
    expect(r.prazo.mediaDias).toBeCloseTo((2 * 900 + 40 * 100) / 1000);
    expect(r.prazo.p90Dias).toBe(2);
    expect(r.faixasPrazo.map((f) => f.qtd)).toEqual([900, 0, 0, 100]);
    expect(r.faixasPrazo[0].pct).toBeCloseTo(0.9);
  });

  it("baixa parcial: cada NF é medida pela própria data", () => {
    const r = calcularAcompanhamento([
      sug({
        qtdFaturada: 100, status: "faturada",
        baixas: [{ qtd: 50, em: D(6), registradoEm: D(6) }, { qtd: 50, em: D(21), registradoEm: D(21) }],
      }),
    ]);
    expect(r.faixasPrazo.map((f) => f.qtd)).toEqual([50, 0, 50, 0]); // 5 dias e 20 dias
    expect(r.porRota[0].prazo.baixas).toBe(2);
  });

  it("NF com data anterior à aprovação conta como zero dias", () => {
    expect(diasEntre(D(10), D(5))).toBe(0);
  });

  it("sem nenhuma NF, prazo vazio e não zero", () => {
    const r = calcularAcompanhamento([sug()]);
    expect(r.prazo.medianaDias).toBeNull();
    expect(r.faixasPrazo.every((f) => f.qtd === 0)).toBe(true);
  });

  it("saldo em aberto é distribuído pela idade da aprovação", () => {
    const r = calcularAcompanhamento(
      [sug({ criadoEm: D(1) }), sug({ criadoEm: D(25), qtdFaturada: 30, baixas: [{ qtd: 30, em: D(26), registradoEm: D(26) }] })],
      Date.parse(D(30)),
    );
    // 29 dias → 16 a 30; 5 dias → até 7 (só os 70 em aberto)
    expect(r.faixasAberto.map((f) => f.qtd)).toEqual([70, 0, 100, 0]);
  });
});

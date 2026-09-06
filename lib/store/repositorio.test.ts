import { describe, expect, it } from "vitest";
import {
  desserializarBase,
  desserializarPedidos,
  serializarBase,
  serializarPedidos,
} from "./repositorio";
import { LinhaBase, PedidoProjetado } from "@/lib/engine/types";

function linha(cd: number, codigo: number, over: Partial<LinhaBase> = {}): LinhaBase {
  return {
    idSku: `${cd}-${codigo}`,
    cd,
    codigoProduto: codigo,
    produto: "DIPIRONA 500MG COMP",
    estoqueDisponivel: 1000.5,
    estoqueObjetivo: 100,
    quantidadePendente: 20,
    vendaMedia3m: 200,
    custoReposicao: 10.55,
    precoLista: 14,
    embCompra: 12,
    fornecedor: "EMS",
    comprador: "COMPRADOR",
    analista: "ANALISTA",
    categoriaN1: "MEDICAMENTO",
    categoriaN2: "GENERICOS",
    categoriaN3: "SIST. NERVOSO",
    categoriaN4: "ANTICONVULSIVO",
    flagAme: "AME",
    monitorado: "SIM",
    marcaPropria: "NAO",
    leadTime: 15,
    unidadesPorPalete: 600,
    pesoUnitario: 0.25,
    cubagemUnitaria: 0.0015,
    ...over,
  };
}

describe("serialização do insumo", () => {
  it("faz a volta completa da base sem perder campo", () => {
    const base = [linha(10, 111), linha(1, 111, { estoqueDisponivel: 0, produto: "OUTRO PRODUTO" })];
    const volta = desserializarBase(serializarBase(base));
    expect(volta).toHaveLength(2);
    expect(volta[0]).toEqual(base[0]);
    expect(volta[1]).toEqual(base[1]);
  });

  it("recalcula o idSku a partir de CD e produto", () => {
    const volta = desserializarBase(serializarBase([linha(7, 999)]));
    expect(volta[0].idSku).toBe("7-999");
  });

  it("preserva decimais", () => {
    const volta = desserializarBase(serializarBase([linha(10, 1, { custoReposicao: 12.345, vendaMedia3m: 0.5 })]));
    expect(volta[0].custoReposicao).toBeCloseTo(12.345, 6);
    expect(volta[0].vendaMedia3m).toBeCloseTo(0.5, 6);
  });

  it("neutraliza tabulação e quebra de linha vindas do texto do produto", () => {
    const volta = desserializarBase(serializarBase([linha(10, 1, { produto: "PRODUTO\tCOM\nSUJEIRA" })]));
    expect(volta[0].produto).toBe("PRODUTO COM SUJEIRA");
    expect(volta).toHaveLength(1);
  });

  it("faz a volta dos pedidos", () => {
    const pedidos: PedidoProjetado[] = [
      { anoMes: "2026_09", cdDestino: 1, codigoProduto: 111, pedido: 300 },
      { anoMes: "2026_10", cdDestino: 2, codigoProduto: 222, pedido: 0 },
    ];
    expect(desserializarPedidos(serializarPedidos(pedidos))).toEqual(pedidos);
  });

  it("lida com base e pedidos vazios", () => {
    expect(desserializarBase(serializarBase([]))).toEqual([]);
    expect(desserializarPedidos(serializarPedidos([]))).toEqual([]);
  });

  it("o formato compacto é bem menor que JSON", () => {
    const base = Array.from({ length: 500 }, (_, i) => linha(10, 1000 + i));
    const tsv = serializarBase(base).length;
    const json = JSON.stringify(base).length;
    expect(tsv).toBeLessThan(json * 0.5);
  });
});

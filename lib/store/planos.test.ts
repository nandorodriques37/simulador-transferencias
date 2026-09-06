import { describe, expect, it } from "vitest";
import { desserializarPlano, serializarPlano, MetaPlano } from "./planos";
import { LinhaPlano } from "@/lib/engine/types";

function linhaPlano(over: Partial<LinhaPlano> = {}): LinhaPlano {
  const base: LinhaPlano = {
    cdOrigem: 10, cdDestino: 1, rota: "10>1", idSku: "10-111", codigoProduto: 111,
    produto: "DIPIRONA 500MG COMP", fornecedor: "EMS", comprador: "COMPRADOR A", analista: "ANALISTA B",
    categoriaN1: "MEDICAMENTO", categoriaN2: "GENERICOS", categoriaN3: "SIST NERVOSO", categoriaN4: "ANALGESICO",
    precoUnitario: 10.5, embCompra: 12,
    demandaMes: [], transfMes: [], demandaSaldo: 500, transfSaldo: 400,
    transfTotal: 400, perdaCaixaFechada: 0, valorTotal: 4200, caixas: 33,
    qtdImediata: 400, imediataCaixas: 33, qtdImediataArredondada: 396, valorImediata: 4158,
    coberturaDias: 150, statusCobertura: "Acima de 90 dias", aliquota: 0.052, impactoFiscal: 4200 * 0.052,
  };
  return { ...base, ...over };
}

const meta = (over: Partial<MetaPlano> = {}): MetaPlano => ({
  analiseId: "a1-abc", modoDemanda: "saldo_ideal", meses: [], limiteCoberturaDias: 90, linhas: 1, ...over,
});

describe("plano persistido", () => {
  it("faz a volta completa e recalcula os campos derivados", () => {
    const linhas = [linhaPlano()];
    const lido = desserializarPlano(serializarPlano(linhas, meta()))!;
    expect(lido.linhas).toHaveLength(1);
    expect(lido.linhas[0]).toEqual(linhas[0]);
  });

  it("os campos derivados batem com o cálculo original", () => {
    const lido = desserializarPlano(serializarPlano([linhaPlano()], meta()))!;
    const l = lido.linhas[0];
    expect(l.valorTotal).toBeCloseTo(400 * 10.5, 6);
    expect(l.caixas).toBe(33);
    expect(l.qtdImediataArredondada).toBe(396);
    expect(l.valorImediata).toBeCloseTo(396 * 10.5, 6);
    expect(l.impactoFiscal).toBeCloseTo(4200 * 0.052, 6);
    expect(l.rota).toBe("10>1");
    expect(l.idSku).toBe("10-111");
  });

  it("sobrevive a campos de texto VAZIOS (o caso que quebrava o dicionário)", () => {
    const linhas = [
      linhaPlano({ fornecedor: "", comprador: "", analista: "", categoriaN1: "" }),
      linhaPlano({ cdDestino: 2, rota: "10>2", produto: "OUTRO", transfTotal: 100, transfSaldo: 100 }),
    ];
    const lido = desserializarPlano(serializarPlano(linhas, meta({ linhas: 2 })))!;
    expect(lido.linhas).toHaveLength(2);
    expect(lido.linhas[0].fornecedor).toBe("");
    expect(lido.linhas[0].produto).toBe("DIPIRONA 500MG COMP");
    expect(lido.linhas[1].produto).toBe("OUTRO");
    expect(lido.linhas[1].cdDestino).toBe(2);
  });

  it("preserva a quebra mensal do modo pedidos", () => {
    const linhas = [linhaPlano({ demandaMes: [300, 200], transfMes: [300, 100], demandaSaldo: 0, transfSaldo: 0, transfTotal: 400 })];
    const lido = desserializarPlano(serializarPlano(linhas, meta({ modoDemanda: "pedidos", meses: ["2026_09", "2026_10"] })))!;
    expect(lido.linhas[0].transfMes).toEqual([300, 100]);
    expect(lido.linhas[0].demandaMes).toEqual([300, 200]);
    expect(lido.meta.meses).toEqual(["2026_09", "2026_10"]);
  });

  it("classifica cobertura pelo limite gravado na análise", () => {
    const lido = desserializarPlano(serializarPlano([linhaPlano({ coberturaDias: 100 })], meta({ limiteCoberturaDias: 120 })))!;
    expect(lido.linhas[0].statusCobertura).toBe("Ate 120 dias");
  });

  it("reconhece SKU sem giro", () => {
    const lido = desserializarPlano(serializarPlano([linhaPlano({ coberturaDias: 9999 })], meta()))!;
    expect(lido.linhas[0].statusCobertura).toBe("Sem giro");
  });

  it("plano vazio volta vazio", () => {
    const lido = desserializarPlano(serializarPlano([], meta({ linhas: 0 })))!;
    expect(lido.linhas).toEqual([]);
  });

  it("o dicionário deixa o arquivo bem menor que JSON", () => {
    const linhas = Array.from({ length: 2000 }, (_, i) => linhaPlano({ codigoProduto: 1000 + (i % 300) }));
    const tsv = serializarPlano(linhas, meta({ linhas: 2000 })).length;
    expect(tsv).toBeLessThan(JSON.stringify(linhas).length * 0.25);
  });

  it("texto sujo com tabulação não desalinha as colunas", () => {
    const lido = desserializarPlano(
      serializarPlano([linhaPlano({ produto: "PRODUTO\tCOM\nSUJEIRA" })], meta()),
    )!;
    expect(lido.linhas).toHaveLength(1);
    expect(lido.linhas[0].produto).toBe("PRODUTO COM SUJEIRA");
  });
});

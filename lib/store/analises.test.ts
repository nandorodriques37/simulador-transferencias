import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnaliseSalva } from "./analises";

/**
 * Exclusão de análises sem banco: o resultado, o índice e o plano guardado
 * saem juntos. Roda no disco de uma pasta temporária.
 */
const pasta = mkdtempSync(join(tmpdir(), "analises-"));
let analisesStore: typeof import("./analises").analisesStore;
let planosStore: typeof import("./planos").planosStore;

beforeAll(async () => {
  process.env.DADOS_DIR = pasta;
  delete process.env.POSTGRES_URL;
  delete process.env.DATABASE_URL;
  ({ analisesStore } = await import("./analises"));
  ({ planosStore } = await import("./planos"));
});
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

const analise = (id: string, criadoEm: string): AnaliseSalva =>
  ({
    id, criadoEm, criadoPor: "x", label: id, datasetId: "d1", fonteBase: "base.csv",
    parametros: { modoDemanda: "saldo_ideal", origens: [10], destinos: [1] },
    kpis: { valorTransfTotal: 100, coberturaNecessidade: 0.5, linhasPlano: 1 },
    rotas: [], origens: [], destinos: [], reconciliacao: {}, meses: [], tempoMs: 1,
  }) as unknown as AnaliseSalva;

describe("excluir análises", () => {
  it("apaga resultado, índice e plano; as outras ficam", async () => {
    await analisesStore.salvar(analise("a1", "2026-10-01T00:00:00.000Z"));
    await analisesStore.salvar(analise("a2", "2026-10-02T00:00:00.000Z"));
    await planosStore.salvar([], { analiseId: "a1", modoDemanda: "saldo_ideal", meses: [], limiteCoberturaDias: 90, linhas: 0 });

    expect(await analisesStore.excluir(["a1"])).toBe(1);
    expect(await analisesStore.obter("a1")).toBeNull();
    expect((await analisesStore.listar()).map((a) => a.id)).toEqual(["a2"]);
    expect(await planosStore.carregar("a1")).toBeNull();
    expect((await analisesStore.ultima())?.id).toBe("a2");
  });

  it("registrar aprovação numa análise antiga não a torna a mais recente", async () => {
    await analisesStore.salvar(analise("b1", "2026-10-05T00:00:00.000Z"));
    await analisesStore.salvar(analise("b2", "2026-10-06T00:00:00.000Z"));
    await analisesStore.registrarAprovacao("b1", { linhas: 1, qtd: 1, valor: 1 });
    expect((await analisesStore.ultima())?.id).toBe("b2");
  });

  it("id inexistente ou repetido não quebra nem conta duas vezes", async () => {
    expect(await analisesStore.excluir(["nao-existe", "nao-existe"])).toBe(0);
    expect(await analisesStore.excluir([])).toBe(0);
  });
});

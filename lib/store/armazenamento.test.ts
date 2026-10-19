import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Caminho do Vercel Blob com a loja PRIVADA (padrão). O SDK é simulado: o que
 * importa é que nada seja gravado como público e que a leitura passe pelo
 * `get` autenticado, nunca por um `fetch` na URL.
 */
const loja = new Map<string, Uint8Array>();
const chamadas: { op: string; access?: string }[] = [];

vi.mock("@vercel/blob", () => ({
  put: async (chave: string, corpo: Buffer, o: { access: string }) => {
    chamadas.push({ op: "put", access: o.access });
    loja.set(chave, new Uint8Array(corpo));
    return { url: `https://x.${o.access}.blob.vercel-storage.com/${chave}` };
  },
  get: async (chave: string, o: { access: string }) => {
    chamadas.push({ op: "get", access: o.access });
    const nome = chave.replace(/^https:\/\/[^/]+\//, "");
    const b = loja.get(nome);
    return b ? { statusCode: 200, stream: new Blob([b as BlobPart]).stream() } : null;
  },
  del: async (chave: string) => {
    chamadas.push({ op: "del" });
    loja.delete(chave);
  },
}));

import { acessoBlob, backend, guardar, modoUploadDireto, recuperar, remover } from "./armazenamento";

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "teste";
  loja.clear();
  chamadas.length = 0;
});
afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  delete process.env.BLOB_ACESSO;
});

describe("detecção da loja conectada", () => {
  it("loja nova (OIDC) só traz BLOB_STORE_ID: usa o Blob e a URL pré-assinada", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_STORE_ID = "store_abc";
    expect(backend()).toBe("blob");
    expect(modoUploadDireto()).toBe("presigned");
  });

  it("loja antiga com token fixo usa o token de cliente", () => {
    expect(modoUploadDireto()).toBe("token");
  });

  it("sem loja: disco e sem upload direto", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(backend()).toBe("disco");
    expect(modoUploadDireto()).toBeNull();
  });
});

describe("armazenamento no Blob", () => {
  it("grava e lê como privado por padrão", async () => {
    expect(acessoBlob()).toBe("private");
    const r = await guardar("plano/a1.tsv", "linha 1\nlinha 2");
    expect(r.url).toContain(".private.");
    expect(await recuperar("plano/a1.tsv")).toBe("linha 1\nlinha 2");
    expect(chamadas.every((c) => c.access === undefined || c.access === "private")).toBe(true);
  });

  it("objeto inexistente devolve null, e remover apaga pelo caminho", async () => {
    expect(await recuperar("nao/existe.tsv")).toBeNull();
    await guardar("dataset/x/base.tsv", "a");
    await remover("dataset/x/base.tsv");
    expect(await recuperar("dataset/x/base.tsv")).toBeNull();
  });

  it("loja pública antiga só com BLOB_ACESSO=public", async () => {
    process.env.BLOB_ACESSO = "public";
    await guardar("plano/a2.tsv", "x");
    expect(chamadas[0].access).toBe("public");
  });
});

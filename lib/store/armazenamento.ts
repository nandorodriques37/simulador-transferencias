import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Armazenamento de objetos grandes (base e pedidos normalizados).
 *
 * Dois backends, mesma API:
 * - **Vercel Blob** quando `BLOB_READ_WRITE_TOKEN` está definido — durável e
 *   compartilhado entre instâncias, que é o que o serverless exige.
 * - **Disco local** (`.data/`) caso contrário — para desenvolvimento e testes.
 *
 * O conteúdo é sempre texto comprimido com gzip: a base normalizada de uma rede
 * de 11 CDs × 80 mil produtos tem ~105 MB de texto e cai para ~20 MB no
 * armazenamento.
 */
export type BackendArmazenamento = "blob" | "disco";

export function backend(): BackendArmazenamento {
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "disco";
}

/** `true` quando o armazenamento sobrevive à troca de instância. */
export function armazenamentoDuravel(): boolean {
  return backend() === "blob";
}

const RAIZ_DISCO = process.env.DADOS_DIR ?? ".data";

function caminhoDisco(chave: string): string {
  // Impede escapar da raiz por "..".
  const limpa = chave.split("/").filter((p) => p && p !== "." && p !== "..").join("/");
  return `${RAIZ_DISCO}/${limpa}`;
}

/** Grava texto comprimido e devolve a chave (ou a URL, no Blob). */
export async function guardar(chave: string, texto: string): Promise<{ chave: string; url: string; bytes: number }> {
  const conteudo = gzipSync(Buffer.from(texto, "utf8"), { level: 6 });
  if (backend() === "blob") {
    const { put } = await import("@vercel/blob");
    const r = await put(chave, conteudo, {
      access: "public",
      contentType: "application/gzip",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { chave, url: r.url, bytes: conteudo.length };
  }
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const caminho = caminhoDisco(chave);
  await mkdir(dirname(caminho), { recursive: true });
  await writeFile(caminho, conteudo);
  return { chave, url: `file://${caminho}`, bytes: conteudo.length };
}

/** Lê o texto guardado. Devolve `null` quando a chave não existe. */
export async function recuperar(chave: string): Promise<string | null> {
  if (backend() === "blob") {
    const { head } = await import("@vercel/blob");
    try {
      const meta = await head(chave);
      const resp = await fetch(meta.url);
      if (!resp.ok) return null;
      return gunzipSync(Buffer.from(await resp.arrayBuffer())).toString("utf8");
    } catch {
      return null;
    }
  }
  const { readFile } = await import("node:fs/promises");
  try {
    return gunzipSync(await readFile(caminhoDisco(chave))).toString("utf8");
  } catch {
    return null;
  }
}

/** Remove um objeto (silencioso quando não existe). */
export async function remover(chave: string): Promise<void> {
  if (backend() === "blob") {
    const { del, head } = await import("@vercel/blob");
    try {
      const meta = await head(chave);
      await del(meta.url);
    } catch {
      /* já não existe */
    }
    return;
  }
  const { rmdir, unlink } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const caminho = caminhoDisco(chave);
  try {
    await unlink(caminho);
  } catch {
    /* já não existe */
  }
  // O Blob não tem diretório; no disco, a pasta vazia sobraria.
  try {
    await rmdir(dirname(caminho));
  } catch {
    /* ainda tem arquivo dentro, ou é a raiz */
  }
}

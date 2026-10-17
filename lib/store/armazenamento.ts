import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Armazenamento de objetos grandes (base e pedidos normalizados).
 *
 * Dois backends, mesma API:
 * - **Vercel Blob** quando a loja está conectada ao projeto — durável e
 *   compartilhado entre instâncias, que é o que o serverless exige.
 * - **Disco local** (`.data/`) caso contrário — para desenvolvimento e testes.
 *
 * O conteúdo é sempre texto comprimido com gzip: a base normalizada de uma rede
 * de 11 CDs × 80 mil produtos tem ~105 MB de texto e cai para ~20 MB no
 * armazenamento.
 */
export type BackendArmazenamento = "blob" | "disco";

export function backend(): BackendArmazenamento {
  return blobConfigurado() ? "blob" : "disco";
}

/**
 * Loja do Blob conectada. Dois jeitos de autenticar, e o SDK escolhe sozinho:
 * - **OIDC** (lojas novas): o Vercel injeta só `BLOB_STORE_ID`, e a função
 *   recebe um token de curta duração a cada requisição;
 * - **token fixo** (lojas antigas): `BLOB_READ_WRITE_TOKEN`.
 */
export function blobConfigurado(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

/**
 * Como o navegador envia arquivo grande direto ao Blob:
 * - `"presigned"` — URL pré-assinada emitida pelo servidor (funciona com OIDC);
 * - `"token"` — token de cliente gerado do token fixo (lojas antigas);
 * - `null` — sem Blob: o arquivo passa pela função (até 4,5 MB).
 */
export function modoUploadDireto(): "presigned" | "token" | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "token";
  if (process.env.BLOB_STORE_ID) return "presigned";
  return null;
}

/**
 * Acesso da loja do Blob. A loja é criada **privada** ou pública no painel do
 * Vercel, e a escolha não muda depois. Privada é o padrão: a base tem estoque
 * e custo de todos os CDs, e numa loja pública qualquer um com a URL lê o
 * arquivo. `BLOB_ACESSO=public` só para uma loja pública já existente.
 */
export function acessoBlob(): "public" | "private" {
  return process.env.BLOB_ACESSO === "public" ? "public" : "private";
}

/**
 * Lê um objeto do Blob (URL ou caminho) como bytes. Na loja privada a leitura
 * exige o token, por isso nunca um `fetch` direto. Sem cache: o catálogo é
 * regravado no mesmo caminho, e a cópia do CDN podia vir velha.
 */
export async function lerBlob(urlOuCaminho: string): Promise<Buffer | null> {
  const { get } = await import("@vercel/blob");
  const r = await get(urlOuCaminho, { access: acessoBlob(), useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return Buffer.from(await new Response(r.stream).arrayBuffer());
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
      access: acessoBlob(),
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
    try {
      const bytes = await lerBlob(chave);
      return bytes ? gunzipSync(bytes).toString("utf8") : null;
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
    const { del } = await import("@vercel/blob");
    try {
      await del(chave);
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

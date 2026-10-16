/**
 * Arquivos que o navegador enviou DIRETO ao Vercel Blob (upload acima de
 * 4,5 MB). A rota recebe só a URL; aqui ela é validada, lida e, depois da
 * importação, apagada — o arquivo cru não tem por que ficar guardado.
 */

/** Prefixo dos arquivos crus enviados pela tela. */
export const PREFIXO_UPLOAD = "upload/";

/** Arquivo cru esquecido (validado e nunca importado) vive no máximo isto. */
const VIDA_MAXIMA_MS = 24 * 3600 * 1000;

/**
 * Só aceita URL do próprio Blob. Sem essa trava a rota buscaria qualquer
 * endereço que alguém mandasse no corpo da requisição.
 */
export function urlDeUploadValida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com") && u.pathname.startsWith(`/${PREFIXO_UPLOAD}`);
  } catch {
    return false;
  }
}

/** Baixa um arquivo já enviado ao armazenamento e o devolve como File. */
export async function baixarUpload(url: string, nomePadrao: string): Promise<File> {
  if (!urlDeUploadValida(url)) throw new Error("endereço de arquivo não reconhecido");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`não foi possível ler o arquivo enviado (${resp.status})`);
  const nome = decodeURIComponent(new URL(url).pathname.split("/").pop() || nomePadrao);
  return new File([await resp.arrayBuffer()], nome);
}

/**
 * Apaga os arquivos crus já importados e os esquecidos há mais de 24 h.
 * Nunca falha: limpeza é higiene, não pode derrubar uma importação que deu certo.
 */
export async function limparUploads(urls: (string | undefined)[]): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { del, list } = await import("@vercel/blob");
    const alvo = urls.filter((u): u is string => !!u && urlDeUploadValida(u));
    const limite = Date.now() - VIDA_MAXIMA_MS;
    let cursor: string | undefined;
    do {
      const r = await list({ prefix: PREFIXO_UPLOAD, cursor, limit: 1000 });
      for (const b of r.blobs) if (new Date(b.uploadedAt).getTime() < limite) alvo.push(b.url);
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    if (alvo.length) await del(Array.from(new Set(alvo)));
  } catch (e) {
    console.error("limpeza de uploads falhou", e);
  }
}

"use client";

/**
 * Upload direto do navegador para o Vercel Blob (arquivos acima de 4,5 MB).
 *
 * Duas decisões:
 * - **Um envio por arquivo.** "Validar" e depois "Importar" usavam o mesmo
 *   arquivo e mandavam os 150 MB duas vezes. A URL fica guardada por arquivo.
 * - **Tipo fixo.** Sem tipo explícito, o Blob deduz pela extensão e recusa o
 *   XLSB (`application/vnd.ms-excel.sheet.binary…` não está na lista aceita).
 *   O tipo não importa para a leitura: o servidor reconhece pelo conteúdo.
 */
const enviados = new WeakMap<File, string>();

/** Acima disso o envio vai em partes paralelas, com nova tentativa por parte. */
const LIMIAR_MULTIPART = 32 * 1024 * 1024;

export async function enviarDireto(
  arquivo: File,
  prefixo: string,
  aoProgredir?: (pct: number) => void,
  /** Acesso da loja do Blob (o servidor informa; privada por padrão). */
  acesso: "public" | "private" = "private",
): Promise<string> {
  const ja = enviados.get(arquivo);
  if (ja) {
    aoProgredir?.(100);
    return ja;
  }
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(`upload/${prefixo}-${Date.now()}-${arquivo.name}`, arquivo, {
    access: acesso,
    contentType: "application/octet-stream",
    handleUploadUrl: "/api/blob/upload",
    multipart: arquivo.size > LIMIAR_MULTIPART,
    onUploadProgress: ({ percentage }) => aoProgredir?.(percentage),
  });
  enviados.set(arquivo, blob.url);
  return blob.url;
}

/** Esquece a URL guardada (o servidor apagou o arquivo depois de importar). */
export function esquecerEnvio(arquivo: File | null | undefined): void {
  if (arquivo) enviados.delete(arquivo);
}

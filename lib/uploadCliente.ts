"use client";

/**
 * Upload direto do navegador para o Vercel Blob (arquivos acima de 4,5 MB).
 *
 * Três decisões:
 * - **Um envio por arquivo.** "Validar" e depois "Importar" usavam o mesmo
 *   arquivo e mandavam os 150 MB duas vezes. A URL fica guardada por arquivo.
 * - **Tipo fixo.** Sem tipo explícito, o Blob deduz pela extensão e recusa o
 *   XLSB (`application/vnd.ms-excel.sheet.binary…` não está na lista aceita).
 *   O tipo não importa para a leitura: o servidor reconhece pelo conteúdo.
 * - **Modo que o servidor indica.** Loja nova (OIDC) usa URL pré-assinada;
 *   loja antiga, com token fixo, usa o token de cliente.
 */
const enviados = new WeakMap<File, string>();

/** Acima disso o envio vai em partes paralelas, com nova tentativa por parte. */
const LIMIAR_MULTIPART = 32 * 1024 * 1024;

export type ModoUpload = "presigned" | "token";

/** Caminho único: na URL pré-assinada o servidor não acrescenta sufixo. */
function caminho(prefixo: string, nome: string): string {
  const aleatorio = Math.random().toString(36).slice(2, 10);
  const limpo = nome.replace(/[\\/]/g, "_");
  return `upload/${prefixo}-${Date.now()}-${aleatorio}-${limpo}`;
}

export async function enviarDireto(
  arquivo: File,
  prefixo: string,
  aoProgredir?: (pct: number) => void,
  /** Acesso da loja do Blob (o servidor informa; privada por padrão). */
  acesso: "public" | "private" = "private",
  modo: ModoUpload = "presigned",
): Promise<string> {
  const ja = enviados.get(arquivo);
  if (ja) {
    aoProgredir?.(100);
    return ja;
  }
  const { upload, uploadPresigned } = await import("@vercel/blob/client");
  const enviar = modo === "presigned" ? uploadPresigned : upload;
  const blob = await enviar(caminho(prefixo, arquivo.name), arquivo, {
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

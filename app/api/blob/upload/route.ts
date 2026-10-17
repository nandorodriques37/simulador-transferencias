import {
  handleUpload,
  handleUploadPresigned,
  type HandleUploadBody,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { PREFIXO_UPLOAD } from "@/lib/data/upload";
import { modoUploadDireto } from "@/lib/store/armazenamento";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Planilhas aceitas. O navegador envia como octet-stream; o resto cobre envios antigos. */
const TIPOS = [
  "text/csv",
  "text/plain",
  "text/tab-separated-values",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/octet-stream",
];
const TAMANHO_MAXIMO = 512 * 1024 * 1024;

/** Só a pasta de upload: o resto do Blob guarda o insumo e os planos. */
function validarCaminho(pathname: string): void {
  if (!pathname.startsWith(PREFIXO_UPLOAD) || pathname.includes("..")) throw new Error("caminho de upload inválido");
}

/**
 * Autoriza o upload DIRETO do navegador para o Vercel Blob.
 *
 * Existe por um limite de plataforma: o corpo de uma função serverless não pode
 * passar de 4,5 MB, e a base real tem dezenas de MB. Com o upload direto o
 * arquivo nunca atravessa a função — o navegador fala com o Blob e devolve uma
 * URL, que é o que a importação recebe.
 *
 * Dois modos, conforme a loja conectada:
 * - **URL pré-assinada** (lojas novas, autenticadas por OIDC — o Vercel injeta
 *   só `BLOB_STORE_ID`): o servidor emite uma autorização de escrita válida
 *   para UM caminho, por uma hora;
 * - **token de cliente** (lojas antigas, com `BLOB_READ_WRITE_TOKEN`).
 */
export async function POST(request: NextRequest) {
  const modo = modoUploadDireto();
  if (!modo) {
    return NextResponse.json({ erro: "armazenamento de arquivos não configurado (conecte um Blob store ao projeto)" }, { status: 501 });
  }
  const body = (await request.json()) as HandleUploadBody | HandleUploadPresignedBody;
  try {
    if (body.type === "blob.generate-presigned-url") {
      const resposta = await handleUploadPresigned({
        body: body as HandleUploadPresignedBody,
        request,
        // Sem callback de conclusão (a tela dispara a importação), então a
        // chave só existe para satisfazer o SDK quando a variável faltar.
        webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY ?? "sem-callback",
        getSignedToken: async (pathname) => {
          validarCaminho(pathname);
          const validUntil = Date.now() + 3600 * 1000;
          const token = await issueSignedToken({
            pathname,
            operations: ["put"],
            allowedContentTypes: TIPOS,
            maximumSizeInBytes: TAMANHO_MAXIMO,
            validUntil,
          });
          // O caminho já chega único da tela (data + aleatório): sem sufixo
          // do servidor, a autorização vale exatamente para ele.
          return { token, urlOptions: { allowedContentTypes: TIPOS, maximumSizeInBytes: TAMANHO_MAXIMO, validUntil, allowOverwrite: false } };
        },
      });
      return NextResponse.json(resposta);
    }

    const usuario = getUsuario(request);
    const resposta = await handleUpload({
      body: body as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (pathname) => {
        validarCaminho(pathname);
        return {
          allowedContentTypes: TIPOS,
          addRandomSuffix: true,
          maximumSizeInBytes: TAMANHO_MAXIMO,
          tokenPayload: JSON.stringify({ usuario, pathname }),
        };
      },
      // O upload termina no Blob; a importação é disparada pela tela em seguida.
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(resposta);
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}

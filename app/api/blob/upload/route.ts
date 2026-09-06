import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Autoriza o upload DIRETO do navegador para o Vercel Blob.
 *
 * Existe por um limite de plataforma: o corpo de uma função serverless não pode
 * passar de 4,5 MB, e a base real tem dezenas de MB. Com o upload direto o
 * arquivo nunca atravessa a função — o navegador fala com o Blob e devolve uma
 * URL, que é o que a importação recebe.
 */
export async function POST(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { erro: "armazenamento de arquivos não configurado (BLOB_READ_WRITE_TOKEN ausente)" },
      { status: 501 },
    );
  }
  const usuario = getUsuario(request);
  const body = (await request.json()) as HandleUploadBody;
  try {
    const resposta = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: [
          "text/csv",
          "text/plain",
          "text/tab-separated-values",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/octet-stream",
        ],
        addRandomSuffix: true,
        maximumSizeInBytes: 512 * 1024 * 1024,
        tokenPayload: JSON.stringify({ usuario, pathname }),
      }),
      // O upload termina no Blob; a importação é disparada pela tela em seguida.
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(resposta);
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}

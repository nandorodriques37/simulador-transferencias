import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getUsuario } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const versionId = req.nextUrl.searchParams.get("versionId") ?? store.getVersaoAtual().id;
  const aprovacoes = store.getAprovacoes(versionId);
  const versao = store.getVersao(versionId);
  const totalLinhas = versao?.resultado.linhas.length ?? 0;
  const valorAprovado = versao
    ? versao.resultado.linhas
        .filter((l) => aprovacoes.some((a) => a.chave === `${l.cdDestino}:${l.idSku}`))
        .reduce((acc, l) => acc + l.valorTransfMes.reduce((a, b) => a + b, 0), 0)
    : 0;
  return NextResponse.json({ versionId, aprovacoes, totalLinhas, aprovadas: aprovacoes.length, valorAprovado });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { versionId?: string; chaves: string[]; aprovado: boolean };
  const versionId = body.versionId ?? store.getVersaoAtual().id;
  if (!Array.isArray(body.chaves)) return NextResponse.json({ erro: "chaves inválidas" }, { status: 400 });
  const n = store.aprovar(versionId, body.chaves, getUsuario(req), body.aprovado);
  return NextResponse.json({ versionId, alteradas: n, aprovadas: store.getAprovacoes(versionId).length });
}

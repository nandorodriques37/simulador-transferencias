import { NextRequest, NextResponse } from "next/server";
import { cenariosStore } from "@/lib/store/cenarios";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cen = await cenariosStore.obter(params.id);
  if (!cen) return NextResponse.json({ erro: "Cenário não encontrado." }, { status: 404 });
  return NextResponse.json({ cenario: cen });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ok = await cenariosStore.remover(params.id);
  if (!ok) return NextResponse.json({ erro: "Cenário não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

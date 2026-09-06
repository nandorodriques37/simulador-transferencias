import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { ParametrosRede } from "@/lib/engine/types";
import { normalizarParametros } from "@/lib/data/params";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ parametros: store.getParametros() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<ParametrosRede>;
  const { erro, params } = normalizarParametros(body);
  if (erro || !params) return NextResponse.json({ erro }, { status: 400 });
  return NextResponse.json({ parametros: store.setParametros(params) });
}

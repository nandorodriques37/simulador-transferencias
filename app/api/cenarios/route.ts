import { NextResponse } from "next/server";
import { cenariosStore } from "@/lib/store/cenarios";

export const dynamic = "force-dynamic";

export async function GET() {
  const cenarios = await cenariosStore.listar();
  return NextResponse.json({ cenarios, durable: cenariosStore.durable() });
}

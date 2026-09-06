import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { carteira } from "@/lib/store/carteira";
import { analisesStore } from "@/lib/store/analises";
import { repositorio } from "@/lib/store/repositorio";
import { backend } from "@/lib/store/armazenamento";

export const dynamic = "force-dynamic";

export async function GET() {
  await store.ensureBase();
  const analise = store.getAnaliseAtual();
  const salvo = await store.datasetSalvo();
  return NextResponse.json({
    dataset: { ...store.getDataset(), duravel: repositorio.duravel(), salvoEm: salvo?.criadoEm ?? "" },
    resultados: {
      duravel: analisesStore.durable(),
      destino: analisesStore.destino(),
      ultima: (await analisesStore.listar(1))[0] ?? null,
    },
    armazenamento: { backend: backend(), uploadDireto: !!process.env.BLOB_READ_WRITE_TOKEN },
    parametros: store.getParametros(),
    carteira: { ...(await carteira.resumo(store.getDataset().dataPosicao)), durable: carteira.durable() },
    analiseAtual: analise
      ? {
          id: analise.id,
          label: analise.label,
          criadoEm: analise.criadoEm,
          criadoPor: analise.criadoPor,
          parametros: analise.parametros,
          meta: analise.resultado.meta,
          reconciliacao: analise.resultado.reconciliacao,
        }
      : null,
  });
}

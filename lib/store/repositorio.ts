import { LinhaBase, PedidoProjetado } from "@/lib/engine/types";
import { armazenamentoDuravel, guardar, recuperar } from "./armazenamento";

/**
 * REPOSITÓRIO DO INSUMO — guarda a base normalizada fora da memória.
 *
 * O app não persiste a base como dado de negócio: o que vale é o RESULTADO
 * (análises, KPIs e a carteira aprovada). A base é insumo de trabalho. Mas ela
 * precisa sobreviver à troca de instância, senão o operador perde a sessão no
 * meio da análise e teria que subir a planilha de novo.
 *
 * Por isso ela é guardada uma vez, em formato compacto (TSV comprimido, sem
 * repetir nomes de campo), e qualquer instância a reconstrói em segundos.
 */

export interface DatasetSalvo {
  id: string;
  criadoEm: string;
  criadoPor: string;
  fonteBase: string;
  fontePedidos: string;
  baseLinhas: number;
  pedidosLinhas: number;
  cds: number[];
  mesesPedidos: string[];
  bytes: number;
}

const CHAVE_CATALOGO = "catalogo/datasets.json";
const MAX_DATASETS = 5;

const uid = () => `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const limpar = (s: string) => (s ?? "").replace(/[\t\r\n]/g, " ");

// --------------------------- Serialização compacta -------------------------

const COLS_BASE = [
  "cd", "codigoProduto", "produto", "estoqueDisponivel", "estoqueObjetivo",
  "quantidadePendente", "vendaMedia3m", "custoReposicao", "precoLista", "embCompra",
  "fornecedor", "comprador", "analista", "categoriaN1", "categoriaN2", "categoriaN3",
  "categoriaN4", "flagAme", "monitorado", "marcaPropria", "leadTime",
  "unidadesPorPalete", "pesoUnitario", "cubagemUnitaria",
] as const;

export function serializarBase(base: LinhaBase[]): string {
  const partes: string[] = [COLS_BASE.join("\t")];
  for (const l of base) {
    partes.push(
      [
        l.cd, l.codigoProduto, limpar(l.produto), l.estoqueDisponivel, l.estoqueObjetivo,
        l.quantidadePendente, l.vendaMedia3m, l.custoReposicao, l.precoLista, l.embCompra,
        limpar(l.fornecedor), limpar(l.comprador), limpar(l.analista), limpar(l.categoriaN1),
        limpar(l.categoriaN2), limpar(l.categoriaN3), limpar(l.categoriaN4),
        limpar(l.flagAme ?? ""), limpar(l.monitorado ?? ""), limpar(l.marcaPropria ?? ""),
        l.leadTime ?? 0, l.unidadesPorPalete ?? 0, l.pesoUnitario ?? 0, l.cubagemUnitaria ?? 0,
      ].join("\t"),
    );
  }
  return partes.join("\n");
}

export function desserializarBase(texto: string): LinhaBase[] {
  const out: LinhaBase[] = [];
  let pos = texto.indexOf("\n") + 1; // pula o cabeçalho
  if (pos <= 0) return out;
  const n = (s: string) => {
    const v = parseFloat(s);
    return isNaN(v) ? 0 : v;
  };
  while (pos < texto.length) {
    let fim = texto.indexOf("\n", pos);
    if (fim === -1) fim = texto.length;
    const linha = texto.slice(pos, fim);
    pos = fim + 1;
    if (!linha) continue;
    const c = linha.split("\t");
    const cd = n(c[0]);
    const cod = n(c[1]);
    out.push({
      idSku: `${cd}-${cod}`,
      cd, codigoProduto: cod, produto: c[2],
      estoqueDisponivel: n(c[3]), estoqueObjetivo: n(c[4]), quantidadePendente: n(c[5]),
      vendaMedia3m: n(c[6]), custoReposicao: n(c[7]), precoLista: n(c[8]), embCompra: n(c[9]),
      fornecedor: c[10], comprador: c[11], analista: c[12],
      categoriaN1: c[13], categoriaN2: c[14], categoriaN3: c[15], categoriaN4: c[16],
      flagAme: c[17], monitorado: c[18], marcaPropria: c[19],
      leadTime: n(c[20]), unidadesPorPalete: n(c[21]), pesoUnitario: n(c[22]), cubagemUnitaria: n(c[23]),
    });
  }
  return out;
}

export function serializarPedidos(pedidos: PedidoProjetado[]): string {
  const partes = ["anoMes\tcdDestino\tcodigoProduto\tpedido"];
  for (const p of pedidos) partes.push(`${p.anoMes}\t${p.cdDestino}\t${p.codigoProduto}\t${p.pedido}`);
  return partes.join("\n");
}

export function desserializarPedidos(texto: string): PedidoProjetado[] {
  const out: PedidoProjetado[] = [];
  let pos = texto.indexOf("\n") + 1;
  if (pos <= 0) return out;
  while (pos < texto.length) {
    let fim = texto.indexOf("\n", pos);
    if (fim === -1) fim = texto.length;
    const linha = texto.slice(pos, fim);
    pos = fim + 1;
    if (!linha) continue;
    const c = linha.split("\t");
    out.push({
      anoMes: c[0],
      cdDestino: Number(c[1]) || 0,
      codigoProduto: Number(c[2]) || 0,
      pedido: Number(c[3]) || 0,
    });
  }
  return out;
}

// ------------------------------- API pública -------------------------------

export const repositorio = {
  /** O insumo sobrevive à troca de instância? */
  duravel(): boolean {
    return armazenamentoDuravel();
  },

  async listar(): Promise<DatasetSalvo[]> {
    const txt = await recuperar(CHAVE_CATALOGO);
    if (!txt) return [];
    try {
      return JSON.parse(txt) as DatasetSalvo[];
    } catch {
      return [];
    }
  },

  async atual(): Promise<DatasetSalvo | null> {
    const lista = await this.listar();
    return lista[0] ?? null;
  },

  /** Guarda a base normalizada e passa a ser o dataset atual. */
  async salvar(
    base: LinhaBase[],
    pedidos: PedidoProjetado[],
    meta: { criadoPor: string; fonteBase: string; fontePedidos: string },
  ): Promise<DatasetSalvo> {
    const id = uid();
    const rb = await guardar(`dataset/${id}/base.tsv`, serializarBase(base));
    const rp = await guardar(`dataset/${id}/pedidos.tsv`, serializarPedidos(pedidos));
    const salvo: DatasetSalvo = {
      id,
      criadoEm: new Date().toISOString(),
      criadoPor: meta.criadoPor,
      fonteBase: meta.fonteBase,
      fontePedidos: meta.fontePedidos,
      baseLinhas: base.length,
      pedidosLinhas: pedidos.length,
      cds: Array.from(new Set(base.map((l) => l.cd))).sort((a, b) => a - b),
      mesesPedidos: Array.from(new Set(pedidos.map((p) => p.anoMes))).sort(),
      bytes: rb.bytes + rp.bytes,
    };
    const lista = [salvo, ...(await this.listar())].slice(0, MAX_DATASETS);
    await guardar(CHAVE_CATALOGO, JSON.stringify(lista));
    return salvo;
  },

  /** Reconstrói a base a partir do armazenamento (poucos segundos). */
  async carregar(id: string): Promise<{ base: LinhaBase[]; pedidos: PedidoProjetado[] } | null> {
    const tb = await recuperar(`dataset/${id}/base.tsv`);
    if (tb === null) return null;
    const tp = await recuperar(`dataset/${id}/pedidos.tsv`);
    return { base: desserializarBase(tb), pedidos: tp ? desserializarPedidos(tp) : [] };
  },
};

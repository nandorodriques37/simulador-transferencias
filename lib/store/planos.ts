import { LinhaPlano, ParametrosRede } from "@/lib/engine/types";
import { guardar, recuperar } from "./armazenamento";

/**
 * PLANO PERSISTIDO — as linhas (origem × destino × SKU) da análise.
 *
 * A base de 900 mil linhas é o insumo pesado; o PLANO é o resultado operacional
 * e é bem menor. Guardá-lo tem dois efeitos: o operador reabre a análise em
 * qualquer instância sem recalcular, e a base deixa de ser necessária para
 * visualizar, filtrar, exportar e aprovar.
 *
 * Formato: TSV com dicionário de textos. Os campos deriváveis (valor, caixas,
 * impacto fiscal, status de cobertura) NÃO são gravados — são recalculados na
 * leitura, o que mantém o arquivo pequeno e impossível de ficar inconsistente.
 *
 * Medido com 240 mil linhas: 17,6 MB de texto, 1,0 MB comprimido, ~0,9 s para
 * serializar e ~54 MB de memória ao reconstruir.
 */

const TAB = String.fromCharCode(9);
const VERSAO = 1;

export interface MetaPlano {
  analiseId: string;
  modoDemanda: ParametrosRede["modoDemanda"];
  meses: string[];
  limiteCoberturaDias: number;
  linhas: number;
}

const round = (x: number) => Math.floor(x + 0.5);

/** Recompõe os campos deriváveis de uma linha. */
function completar(
  l: Omit<LinhaPlano, "rota" | "idSku" | "valorTotal" | "caixas" | "qtdImediataArredondada" | "valorImediata" | "impactoFiscal" | "statusCobertura">,
  limiteDias: number,
): LinhaPlano {
  const valorTotal = l.transfTotal * l.precoUnitario;
  const qtdImediataArredondada = l.imediataCaixas * l.embCompra;
  const status =
    l.coberturaDias >= 9999
      ? "Sem giro"
      : l.coberturaDias > limiteDias
        ? "Acima de " + limiteDias + " dias"
        : "Ate " + limiteDias + " dias";
  return {
    ...l,
    rota: l.cdOrigem + ">" + l.cdDestino,
    idSku: l.cdOrigem + "-" + l.codigoProduto,
    valorTotal,
    caixas: l.embCompra > 0 ? round(l.transfTotal / l.embCompra) : 0,
    qtdImediataArredondada,
    valorImediata: qtdImediataArredondada * l.precoUnitario,
    impactoFiscal: valorTotal * l.aliquota,
    statusCobertura: status,
  };
}

export function serializarPlano(linhas: LinhaPlano[], meta: MetaPlano): string {
  const dic = new Map<string, number>();
  const textos: string[] = [];
  const id = (s: string) => {
    const v = s ?? "";
    let i = dic.get(v);
    if (i === undefined) {
      i = textos.length;
      dic.set(v, i);
      textos.push(v.replace(/[\t\r\n]/g, " "));
    }
    return i;
  };
  const corpo: string[] = [];
  for (const l of linhas) {
    corpo.push(
      [
        l.cdOrigem, l.cdDestino, l.codigoProduto,
        id(l.produto), id(l.fornecedor), id(l.comprador), id(l.analista),
        id(l.categoriaN1), id(l.categoriaN2), id(l.categoriaN3), id(l.categoriaN4),
        l.precoUnitario, l.embCompra,
        l.demandaSaldo, l.transfSaldo,
        l.demandaMes.join(","), l.transfMes.join(","),
        l.transfTotal, l.perdaCaixaFechada,
        l.qtdImediata, l.imediataCaixas,
        Math.round(l.coberturaDias), l.aliquota,
      ].join(TAB),
    );
  }
  // O tamanho do dicionário vai no cabeçalho: campos vazios viram linhas em
  // branco no meio dele, então não dá para separá-lo por uma linha em branco.
  return (
    JSON.stringify({ versao: VERSAO, ...meta, nTextos: textos.length }) +
    "\n" +
    textos.join("\n") +
    (textos.length ? "\n" : "") +
    corpo.join("\n")
  );
}

export function desserializarPlano(texto: string): { linhas: LinhaPlano[]; meta: MetaPlano } | null {
  const fimCabecalho = texto.indexOf("\n");
  if (fimCabecalho === -1) return null;
  let meta: MetaPlano & { nTextos?: number };
  try {
    meta = JSON.parse(texto.slice(0, fimCabecalho)) as MetaPlano & { nTextos?: number };
  } catch {
    return null;
  }

  // Lê exatamente `nTextos` linhas de dicionário; o corpo começa logo depois.
  const nTextos = meta.nTextos ?? 0;
  const textos: string[] = new Array(nTextos);
  let cursor = fimCabecalho + 1;
  for (let i = 0; i < nTextos; i++) {
    let fim = texto.indexOf("\n", cursor);
    if (fim === -1) fim = texto.length;
    textos[i] = texto.slice(cursor, fim);
    cursor = fim + 1;
  }
  const sepDic = cursor - 1;
  const num = (s: string) => {
    const v = parseFloat(s);
    return isNaN(v) ? 0 : v;
  };
  const lista = (s: string) => (s ? s.split(",").map(num) : []);

  const linhas: LinhaPlano[] = [];
  let pos = sepDic + 1;
  while (pos < texto.length) {
    let fim = texto.indexOf("\n", pos);
    if (fim === -1) fim = texto.length;
    const linha = texto.slice(pos, fim);
    pos = fim + 1;
    if (!linha) continue;
    const c = linha.split(TAB);
    linhas.push(
      completar(
        {
          cdOrigem: num(c[0]), cdDestino: num(c[1]), codigoProduto: num(c[2]),
          produto: textos[num(c[3])] ?? "", fornecedor: textos[num(c[4])] ?? "",
          comprador: textos[num(c[5])] ?? "", analista: textos[num(c[6])] ?? "",
          categoriaN1: textos[num(c[7])] ?? "", categoriaN2: textos[num(c[8])] ?? "",
          categoriaN3: textos[num(c[9])] ?? "", categoriaN4: textos[num(c[10])] ?? "",
          precoUnitario: num(c[11]), embCompra: num(c[12]),
          demandaSaldo: num(c[13]), transfSaldo: num(c[14]),
          demandaMes: lista(c[15]), transfMes: lista(c[16]),
          transfTotal: num(c[17]), perdaCaixaFechada: num(c[18]),
          qtdImediata: num(c[19]), imediataCaixas: num(c[20]),
          coberturaDias: num(c[21]), aliquota: num(c[22]),
        },
        meta.limiteCoberturaDias,
      ),
    );
  }
  return { linhas, meta };
}

// ----------------------------- Cache + acesso ------------------------------

/** Planos reconstruídos nesta instância (o mais recente primeiro). */
const MAX_CACHE = 2;
const g = globalThis as unknown as { __planos?: Map<string, LinhaPlano[]> };
function cache(): Map<string, LinhaPlano[]> {
  if (!g.__planos) g.__planos = new Map();
  return g.__planos;
}

export const planosStore = {
  async salvar(linhas: LinhaPlano[], meta: MetaPlano): Promise<{ bytes: number }> {
    const r = await guardar("plano/" + meta.analiseId + ".tsv", serializarPlano(linhas, meta));
    this.cachear(meta.analiseId, linhas);
    return { bytes: r.bytes };
  },

  cachear(analiseId: string, linhas: LinhaPlano[]): void {
    const c = cache();
    c.delete(analiseId);
    c.set(analiseId, linhas);
    while (c.size > MAX_CACHE) {
      const primeira = c.keys().next().value;
      if (primeira === undefined) break;
      c.delete(primeira);
    }
  },

  /** Linhas do plano: memória desta instância ou armazenamento. */
  async carregar(analiseId: string): Promise<LinhaPlano[] | null> {
    const emMemoria = cache().get(analiseId);
    if (emMemoria) return emMemoria;
    const texto = await recuperar("plano/" + analiseId + ".tsv");
    if (!texto) return null;
    const lido = desserializarPlano(texto);
    if (!lido) return null;
    this.cachear(analiseId, lido.linhas);
    return lido.linhas;
  },
};

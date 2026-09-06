import { LinhaBase, LinhaFaturamento, PedidoProjetado } from "@/lib/engine/types";
import { ColSpec, normKey, SCHEMA_BASE, SCHEMA_FATURAMENTO, SCHEMA_PEDIDOS } from "./schema";

export interface ErroLinha {
  linha: number; // linha aproximada na planilha (cabeçalho = 1)
  campo: string;
  coluna: string;
  valor: string;
  msg: string;
}

export interface DiagParse {
  header: string[];
  mapeadas: { campo: string; rotulo: string; coluna: string }[];
  faltando: { campo: string; rotulo: string; aliases: string[] }[]; // requeridas ausentes
  ignoradas: string[]; // colunas do arquivo sem uso
  totalLinhas: number;
  linhasValidas: number;
  errosLinha: ErroLinha[];
  errosTruncados: number;
}

const MAX_ERROS = 100;

function coefNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace(/\s/g, "");
  // pt-BR: 1.234,56 -> 1234.56 ; en: 1234.56
  let norm = s;
  if (/,/.test(s) && /\./.test(s)) norm = s.replace(/\./g, "").replace(",", ".");
  else if (/,/.test(s)) norm = s.replace(",", ".");
  norm = norm.replace(/[^0-9.\-]/g, "");
  const n = parseFloat(norm);
  return isNaN(n) ? null : n;
}
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim());

interface ColMap {
  spec: ColSpec;
  coluna: string | null; // cabeçalho original casado
}

function mapearColunas(header: string[], schema: ColSpec[]): ColMap[] {
  const normToOrig = new Map<string, string>();
  for (const h of header) if (!normToOrig.has(normKey(h))) normToOrig.set(normKey(h), h);
  return schema.map((spec) => {
    let coluna: string | null = null;
    for (const a of spec.aliases) {
      const orig = normToOrig.get(normKey(a));
      if (orig) {
        coluna = orig;
        break;
      }
    }
    return { spec, coluna };
  });
}

/** Parser genérico dirigido por esquema: coage tipos e coleta erros precisos. */
export function parseComEsquema(
  rows: Record<string, unknown>[],
  schema: ColSpec[],
): { itens: Record<string, unknown>[]; diag: DiagParse } {
  const header = rows.length ? Object.keys(rows[0]) : [];
  const cols = mapearColunas(header, schema);
  const usados = new Set(cols.map((c) => c.coluna).filter(Boolean) as string[]);

  const faltando = cols
    .filter((c) => c.spec.required && !c.coluna)
    .map((c) => ({ campo: c.spec.campo, rotulo: c.spec.rotulo, aliases: c.spec.aliases }));
  const ignoradas = header.filter((h) => !usados.has(h));

  const itens: Record<string, unknown>[] = [];
  const errosLinha: ErroLinha[] = [];
  let errosTruncados = 0;

  if (faltando.length === 0) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const linha = i + 2; // +1 header, +1 base-1
      const obj: Record<string, unknown> = {};
      let linhaErro = false;
      for (const { spec, coluna } of cols) {
        if (!coluna) continue;
        const raw = row[coluna];
        if (spec.tipo === "str") {
          obj[spec.campo] = str(raw);
          continue;
        }
        const n = coefNum(raw);
        if (n === null) {
          if (spec.required) {
            linhaErro = true;
            if (errosLinha.length < MAX_ERROS)
              errosLinha.push({ linha, campo: spec.campo, coluna, valor: str(raw), msg: `valor não numérico em coluna obrigatória "${coluna}"` });
            else errosTruncados++;
          }
          obj[spec.campo] = 0;
          continue;
        }
        if (spec.naoNegativo && n < 0) {
          linhaErro = true;
          if (errosLinha.length < MAX_ERROS)
            errosLinha.push({ linha, campo: spec.campo, coluna, valor: str(raw), msg: `valor negativo não permitido em "${coluna}" (${n})` });
          else errosTruncados++;
        }
        obj[spec.campo] = spec.tipo === "int" ? Math.round(n) : n;
      }
      // Linha só entra com as chaves obrigatórias preenchidas (descarta as
      // linhas em branco no fim do arquivo).
      const temChave = cols
        .filter((c) => c.spec.chave && c.spec.required)
        .every((c) => {
          const v = obj[c.spec.campo];
          return v !== undefined && v !== "" && v !== 0;
        });
      if (!linhaErro && temChave) itens.push(obj);
    }
  }

  return {
    itens,
    diag: {
      header,
      mapeadas: cols.filter((c) => c.coluna).map((c) => ({ campo: c.spec.campo, rotulo: c.spec.rotulo, coluna: c.coluna! })),
      faltando,
      ignoradas,
      totalLinhas: rows.length,
      linhasValidas: itens.length,
      errosLinha,
      errosTruncados,
    },
  };
}

/** Base única de CDs — cada linha é (CD × produto). */
export function parseBase(rows: Record<string, unknown>[]): { itens: LinhaBase[]; diag: DiagParse } {
  const { itens, diag } = parseComEsquema(rows, SCHEMA_BASE);
  const out: LinhaBase[] = itens.map((o) => {
    const cd = Number(o.cd);
    const codigo = Number(o.codigoProduto);
    return {
      idSku: `${cd}-${codigo}`, // CALCULADO (era a fórmula ID na planilha)
      cd,
      codigoProduto: codigo,
      produto: str(o.produto),
      estoqueDisponivel: Number(o.estoqueDisponivel) || 0,
      estoqueObjetivo: Number(o.estoqueObjetivo) || 0,
      quantidadePendente: Number(o.quantidadePendente) || 0,
      vendaMedia3m: Number(o.vendaMedia3m) || 0,
      custoReposicao: Number(o.custoReposicao) || 0,
      precoLista: Number(o.precoLista) || 0,
      embCompra: Number(o.embCompra) || 0,
      fornecedor: str(o.fornecedor),
      comprador: str(o.comprador),
      analista: str(o.analista),
      categoriaN1: str(o.categoriaN1),
      categoriaN2: str(o.categoriaN2),
      categoriaN3: str(o.categoriaN3),
      categoriaN4: str(o.categoriaN4),
      flagAme: str(o.flagAme),
      monitorado: str(o.monitorado),
      marcaPropria: str(o.marcaPropria),
      leadTime: Number(o.leadTime) || 0,
    };
  });
  return { itens: out, diag };
}

/** Normaliza o ano-mês para 'AAAA_MM' (aceita 2026-07, 07/2026, 202607…). */
export function normalizarAnoMes(v: string): string {
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[_\-/.]?(\d{1,2})$/);
  if (m) return `${m[1]}_${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[_\-/.](\d{4})$/);
  if (m) return `${m[2]}_${m[1].padStart(2, "0")}`;
  return s;
}

export function parsePedidos(rows: Record<string, unknown>[]): { itens: PedidoProjetado[]; diag: DiagParse } {
  const { itens, diag } = parseComEsquema(rows, SCHEMA_PEDIDOS);
  const out: PedidoProjetado[] = itens.map((o) => ({
    anoMes: normalizarAnoMes(str(o.anoMes)),
    cdDestino: Number(o.cdDestino),
    codigoProduto: Number(o.codigoProduto),
    pedido: Number(o.pedido) || 0,
  }));
  return { itens: out, diag };
}

export function parseFaturamento(rows: Record<string, unknown>[]): { itens: LinhaFaturamento[]; diag: DiagParse } {
  const { itens, diag } = parseComEsquema(rows, SCHEMA_FATURAMENTO);
  const out: LinhaFaturamento[] = itens.map((o) => ({
    cdOrigem: Number(o.cdOrigem),
    cdDestino: Number(o.cdDestino),
    codigoProduto: Number(o.codigoProduto),
    quantidade: Number(o.quantidade) || 0,
    documento: str(o.documento),
    data: str(o.data),
  }));
  return { itens: out, diag };
}

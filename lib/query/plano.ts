import { LinhaPlano } from "@/lib/engine/types";

export interface FiltrosPlano {
  cobertura?: "total" | "acima90";
  limiteDias?: number;
  cd?: number | null;
  categoria?: string | null; // categoriaN1
  fornecedor?: string | null;
  comprador?: string | null;
  analista?: string | null;
  status?: string | null; // status de cobertura exato
  q?: string | null; // busca por produto/código
}

export interface OrdenacaoPlano {
  campo: keyof LinhaPlano | "valorTotal";
  dir: "asc" | "desc";
}

function valorTotal(l: LinhaPlano): number {
  return l.valorTransfMes.reduce((a, b) => a + b, 0);
}

export function filtrarPlano(linhas: LinhaPlano[], f: FiltrosPlano): LinhaPlano[] {
  const q = f.q?.trim().toLowerCase();
  const lim = f.limiteDias ?? 90;
  return linhas.filter((l) => {
    if (f.cobertura === "acima90" && l.coberturaDias <= lim) return false;
    if (f.cd != null && l.cdDestino !== f.cd) return false;
    if (f.categoria && l.categoriaN1 !== f.categoria) return false;
    if (f.fornecedor && l.fornecedor !== f.fornecedor) return false;
    if (f.comprador && l.comprador !== f.comprador) return false;
    if (f.analista && l.analista !== f.analista) return false;
    if (f.status && l.statusCobertura !== f.status) return false;
    if (q && !(l.produto.toLowerCase().includes(q) || String(l.codigoProduto).includes(q) || l.idSku.toLowerCase().includes(q))) return false;
    return true;
  });
}

export function ordenarPlano(linhas: LinhaPlano[], ord?: OrdenacaoPlano): LinhaPlano[] {
  if (!ord) return linhas;
  const mult = ord.dir === "asc" ? 1 : -1;
  const get = (l: LinhaPlano): number | string =>
    ord.campo === "valorTotal" ? valorTotal(l) : (l[ord.campo] as unknown as number | string);
  return [...linhas].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
    return String(va).localeCompare(String(vb)) * mult;
  });
}

export interface Facets {
  cds: number[];
  categorias: string[];
  fornecedores: string[];
  compradores: string[];
  analistas: string[];
  status: string[];
}

export function extrairFacets(linhas: LinhaPlano[]): Facets {
  const cds = new Set<number>();
  const categorias = new Set<string>();
  const fornecedores = new Set<string>();
  const compradores = new Set<string>();
  const analistas = new Set<string>();
  const status = new Set<string>();
  for (const l of linhas) {
    cds.add(l.cdDestino);
    if (l.categoriaN1) categorias.add(l.categoriaN1);
    if (l.fornecedor) fornecedores.add(l.fornecedor);
    if (l.comprador) compradores.add(l.comprador);
    if (l.analista) analistas.add(l.analista);
    if (l.statusCobertura) status.add(l.statusCobertura);
  }
  const sort = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
  return {
    cds: Array.from(cds).sort((a, b) => a - b),
    categorias: sort(categorias),
    fornecedores: sort(fornecedores),
    compradores: sort(compradores),
    analistas: sort(analistas),
    status: sort(status),
  };
}

export function paginar<T>(linhas: T[], page: number, pageSize: number): { itens: T[]; total: number; page: number; pageSize: number; totalPaginas: number } {
  const total = linhas.length;
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPaginas);
  const start = (p - 1) * pageSize;
  return { itens: linhas.slice(start, start + pageSize), total, page: p, pageSize, totalPaginas };
}

import { LinhaPlano } from "@/lib/engine/types";

export interface FiltrosPlano {
  cobertura?: "total" | "acima_limite";
  limiteDias?: number;
  cdOrigem?: number | null;
  cdDestino?: number | null;
  categoria?: string | null; // categoriaN1
  fornecedor?: string | null;
  comprador?: string | null;
  analista?: string | null;
  status?: string | null; // status de cobertura exato
  q?: string | null; // busca por produto/código
  soImediata?: boolean; // apenas linhas com transferência imediata > 0
}

export interface OrdenacaoPlano {
  campo: keyof LinhaPlano;
  dir: "asc" | "desc";
}

export function filtrarPlano(linhas: LinhaPlano[], f: FiltrosPlano): LinhaPlano[] {
  const q = f.q?.trim().toLowerCase();
  const lim = f.limiteDias ?? 90;
  return linhas.filter((l) => {
    if (f.cobertura === "acima_limite" && l.coberturaDias <= lim) return false;
    if (f.cdOrigem != null && l.cdOrigem !== f.cdOrigem) return false;
    if (f.cdDestino != null && l.cdDestino !== f.cdDestino) return false;
    if (f.categoria && l.categoriaN1 !== f.categoria) return false;
    if (f.fornecedor && l.fornecedor !== f.fornecedor) return false;
    if (f.comprador && l.comprador !== f.comprador) return false;
    if (f.analista && l.analista !== f.analista) return false;
    if (f.status && l.statusCobertura !== f.status) return false;
    if (f.soImediata && l.qtdImediataArredondada <= 0) return false;
    if (q && !(l.produto.toLowerCase().includes(q) || String(l.codigoProduto).includes(q))) return false;
    return true;
  });
}

export function ordenarPlano(linhas: LinhaPlano[], ord?: OrdenacaoPlano): LinhaPlano[] {
  if (!ord) return linhas;
  const mult = ord.dir === "asc" ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const va = a[ord.campo] as unknown as number | string;
    const vb = b[ord.campo] as unknown as number | string;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
    return String(va).localeCompare(String(vb)) * mult;
  });
}

export interface Facets {
  origens: number[];
  destinos: number[];
  rotas: string[];
  categorias: string[];
  fornecedores: string[];
  compradores: string[];
  analistas: string[];
  status: string[];
}

export function extrairFacets(linhas: LinhaPlano[]): Facets {
  const origens = new Set<number>();
  const destinos = new Set<number>();
  const rotas = new Set<string>();
  const categorias = new Set<string>();
  const fornecedores = new Set<string>();
  const compradores = new Set<string>();
  const analistas = new Set<string>();
  const status = new Set<string>();
  for (const l of linhas) {
    origens.add(l.cdOrigem);
    destinos.add(l.cdDestino);
    rotas.add(l.rota);
    if (l.categoriaN1) categorias.add(l.categoriaN1);
    if (l.fornecedor) fornecedores.add(l.fornecedor);
    if (l.comprador) compradores.add(l.comprador);
    if (l.analista) analistas.add(l.analista);
    if (l.statusCobertura) status.add(l.statusCobertura);
  }
  const sortS = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
  return {
    origens: Array.from(origens).sort((a, b) => a - b),
    destinos: Array.from(destinos).sort((a, b) => a - b),
    rotas: sortS(rotas),
    categorias: sortS(categorias),
    fornecedores: sortS(fornecedores),
    compradores: sortS(compradores),
    analistas: sortS(analistas),
    status: sortS(status),
  };
}

export function paginar<T>(
  linhas: T[],
  page: number,
  pageSize: number,
): { itens: T[]; total: number; page: number; pageSize: number; totalPaginas: number } {
  const total = linhas.length;
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPaginas);
  const start = (p - 1) * pageSize;
  return { itens: linhas.slice(start, start + pageSize), total, page: p, pageSize, totalPaginas };
}

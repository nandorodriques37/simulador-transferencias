export const fmtInt = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export const fmtRs = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const fmtRs2 = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Compacto: R$ 42,7 mi / R$ 851 mil */
export function fmtRsCompacto(n: number): string {
  const abs = Math.abs(n ?? 0);
  if (abs >= 1e6) return `R$ ${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1e3) return `R$ ${(n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return fmtRs(n);
}

/** Capacidade: inteiro quando fecha, senão até 2 casas (2,5 paletes). */
export const fmtCap = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });

export const fmtPct = (n: number, dec = 1) =>
  `${((n ?? 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: dec })}%`;

export function rotuloMes(anoMes: string): string {
  const nomes: Record<string, string> = {
    "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun",
    "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
  };
  const [ano, mes] = anoMes.split("_");
  return `${nomes[mes] ?? mes}/${ano?.slice(2) ?? ""}`;
}

// Paleta da rede — cores estáveis por CD (Pague Menos em destaque nos 2 primeiros)
const PALETA = [
  "#0000be", "#ff2342", "#16a34a", "#f59e0b", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0f766e",
];

/** Cor determinística por CD (mesmo CD, mesma cor em todas as telas). */
export function corCd(cd: number): string {
  const i = Math.abs(Math.floor(cd)) % PALETA.length;
  return PALETA[i];
}

/** Rótulo curto de rota: "CD10 → CD1". */
export function rotuloRota(rota: string): string {
  const [o, d] = rota.split(">");
  return `CD${o} → CD${d}`;
}

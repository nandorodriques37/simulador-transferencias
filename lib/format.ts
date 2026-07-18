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

export const CD_CORES: Record<number, string> = {
  1: "#2563eb",
  9: "#16a34a",
  2: "#f59e0b",
  8: "#db2777",
  7: "#7c3aed",
};
export const corCd = (cd: number) => CD_CORES[cd] ?? "#64748b";

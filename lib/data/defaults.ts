import { Parametros } from "@/lib/engine/types";

/** Retorna 'AAAA_MM' para o mês corrente + offset. */
export function mesOffset(offset: number, base = new Date()): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Horizonte padrão: mês corrente + próximos 2 (3 meses). */
export function horizontePadrao(base = new Date()): string[] {
  return [mesOffset(0, base), mesOffset(1, base), mesOffset(2, base)];
}

export const NOMES_MES: Record<string, string> = {
  "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun",
  "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
};

export function rotuloMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("_");
  return `${NOMES_MES[mes] ?? mes}/${ano?.slice(2) ?? ""}`;
}

/** Parâmetros padrão (equivalem aos valores da planilha original). */
export function parametrosPadrao(base = new Date()): Parametros {
  return {
    cdOrigem: CD_ORIGEM_PADRAO,
    prioridadeCds: [1, 9, 2, 8, 7],
    horizonteMeses: horizontePadrao(base),
    aliquotaFiscal: { 1: 0.052, 9: 0.015 }, // CD2/8/7 a definir
    fatorSegurancaImediata: 0.5,
    limiteCoberturaDias: 90,
  };
}

export const CD_ORIGEM_PADRAO = 10;

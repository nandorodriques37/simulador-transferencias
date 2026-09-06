/**
 * Leitura de planilhas (CSV/XLSX/XLSB) para linhas cruas.
 *
 * Detalhe que dava dor de cabeça: um CSV salvo em UTF-8 sem BOM era lido como
 * latin1 e os cabeçalhos com acento ("Venda_ QTD_Média3meses") deixavam de
 * casar com o esquema. Aqui o encoding é detectado: se o arquivo decodifica
 * como UTF-8 válido, força a codepage 65001; senão deixa o SheetJS decidir
 * (planilhas binárias caem sempre neste caso).
 */
export async function lerPlanilha(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const buf = new Uint8Array(await file.arrayBuffer());
  const opcoes: Parameters<typeof XLSX.read>[1] = { type: "array" };
  if (pareceUtf8(buf)) opcoes.codepage = 65001;
  const wb = XLSX.read(buf, opcoes);
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
}

/** Decodifica uma amostra em UTF-8 estrito: erro ⇒ não é UTF-8. */
function pareceUtf8(buf: Uint8Array): boolean {
  const amostra = buf.subarray(0, Math.min(buf.length, 262144));
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(amostra);
    return true;
  } catch {
    return false;
  }
}

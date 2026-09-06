import { TabelaBruta, tabelaDeCsv, tabelaDeObjetos } from "./tabela";

/** Extensões tratadas como texto delimitado (caminho leve). */
const EXT_TEXTO = /\.(csv|txt|tsv)$/i;

/**
 * Lê o arquivo enviado e devolve uma tabela pronta para o parser.
 *
 * CSV/TXT/TSV seguem pelo caminho leve (um passe sobre o texto). XLSX/XLSB
 * passam pelo SheetJS, que precisa carregar a planilha inteira — muito mais
 * caro em tempo e memória, então bases grandes devem vir em CSV.
 *
 * Encoding: um CSV salvo em UTF-8 sem BOM era lido como latin1 e os cabeçalhos
 * com acento ("Venda_ QTD_Média3meses") deixavam de casar com o esquema. Aqui
 * o encoding é detectado antes de decidir.
 */
export async function lerPlanilha(file: File): Promise<TabelaBruta> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const utf8 = pareceUtf8(buf);

  if (EXT_TEXTO.test(file.name) || (!ehBinario(buf) && utf8)) {
    const texto = new TextDecoder(utf8 ? "utf-8" : "windows-1252").decode(buf);
    return tabelaDeCsv(texto);
  }

  const XLSX = await import("xlsx");
  const opcoes: Parameters<typeof XLSX.read>[1] = { type: "array" };
  if (utf8) opcoes.codepage = 65001;
  const wb = XLSX.read(buf, opcoes);
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return tabelaDeObjetos([]);
  return tabelaDeObjetos(XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }));
}

/** Assinaturas de planilha binária (ZIP do xlsx, OLE do xls/xlsb). */
function ehBinario(buf: Uint8Array): boolean {
  if (buf.length < 4) return false;
  const zip = buf[0] === 0x50 && buf[1] === 0x4b; // PK
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf;
  return zip || ole;
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

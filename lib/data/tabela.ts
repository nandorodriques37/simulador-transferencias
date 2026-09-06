/**
 * Fonte tabular genérica para o parser dirigido por esquema.
 *
 * Existem dois caminhos de leitura, com custos MUITO diferentes:
 *
 * - **CSV** (`tabelaDeCsv`): percorre o texto direto, sem materializar um
 *   objeto por linha. Para 300 mil linhas: ~0,5 s e ~100 MB de pico.
 * - **XLSX/XLSB** (`tabelaDeObjetos`, alimentada pelo SheetJS): o formato é
 *   binário e obriga a carregar a planilha inteira. Mesmas 300 mil linhas:
 *   ~18 s e ~1,1 GB de pico — perto do limite de memória de uma função
 *   serverless. Base grande deve vir em CSV.
 */
export interface TabelaBruta {
  header: string[];
  total: number;
  /** Percorre as linhas; `celulas[i]` corresponde a `header[i]`. */
  forEach(cb: (celulas: unknown[], linhaPlanilha: number) => void): void;
}

/** Detecta o delimitador mais provável do CSV pela linha de cabeçalho. */
export function detectarDelimitador(cabecalho: string): string {
  const candidatos = [";", ",", "\t", "|"];
  let melhor = ";";
  let max = -1;
  for (const c of candidatos) {
    const n = cabecalho.split(c).length - 1;
    if (n > max) {
      max = n;
      melhor = c;
    }
  }
  return max > 0 ? melhor : ";";
}

/** Divide uma linha de CSV respeitando aspas duplas e o escape "". */
export function dividirLinhaCsv(linha: string, delim: string): string[] {
  if (linha.indexOf('"') === -1) return linha.split(delim);
  const out: string[] = [];
  let atual = "";
  let dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentro) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          atual += '"';
          i++;
        } else dentro = false;
      } else atual += c;
    } else if (c === '"') dentro = true;
    else if (c === delim) {
      out.push(atual);
      atual = "";
    } else atual += c;
  }
  out.push(atual);
  return out;
}

/** Tabela a partir do TEXTO de um CSV — caminho leve, um passe só. */
export function tabelaDeCsv(texto: string): TabelaBruta {
  // Remove BOM.
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const fimHeader = t.indexOf("\n");
  const cabecalho = (fimHeader === -1 ? t : t.slice(0, fimHeader)).replace(/\r$/, "");
  const delim = detectarDelimitador(cabecalho);
  const header = dividirLinhaCsv(cabecalho, delim).map((h) => h.trim());

  // Conta as linhas úteis sem materializar o array.
  let total = 0;
  for (let i = fimHeader + 1; i < t.length; ) {
    let fim = t.indexOf("\n", i);
    if (fim === -1) fim = t.length;
    if (fim > i + 1 || (fim === i + 1 && t[i] !== "\r")) total++;
    i = fim + 1;
  }

  return {
    header,
    total,
    forEach(cb) {
      if (fimHeader === -1) return;
      let pos = fimHeader + 1;
      let linhaPlanilha = 2; // 1 = cabeçalho
      while (pos < t.length) {
        let fim = t.indexOf("\n", pos);
        if (fim === -1) fim = t.length;
        let linha = t.slice(pos, fim);
        pos = fim + 1;
        if (linha.endsWith("\r")) linha = linha.slice(0, -1);
        if (linha === "") {
          linhaPlanilha++;
          continue;
        }
        cb(dividirLinhaCsv(linha, delim), linhaPlanilha++);
      }
    },
  };
}

/** Tabela a partir de objetos (saída do SheetJS para XLSX/XLSB). */
export function tabelaDeObjetos(rows: Record<string, unknown>[]): TabelaBruta {
  const header = rows.length ? Object.keys(rows[0]) : [];
  return {
    header,
    total: rows.length,
    forEach(cb) {
      const n = header.length;
      const buf = new Array<unknown>(n);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        for (let c = 0; c < n; c++) buf[c] = row[header[c]];
        cb(buf, i + 2);
      }
    },
  };
}

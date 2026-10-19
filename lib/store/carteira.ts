import {
  chaveCdProduto,
  chaveRotaProduto,
  Compromissos,
  compromissosVazios,
  LinhaFaturamento,
} from "@/lib/engine/types";
import { RelatorioFaturamento } from "@/lib/data/validate";
import { dbEnabled, getPool } from "@/lib/store/db";

/**
 * CARTEIRA DE TRANSFERÊNCIAS — o elo entre uma análise e a próxima.
 *
 * Ciclo de vida de uma sugestão:
 *   1. a análise gera a linha (origem → destino × SKU);
 *   2. o usuário APROVA a linha  → vira sugestão com status "aprovada";
 *   3. enquanto está aprovada e não faturada, ela é um COMPROMISSO: desconta o
 *      excesso da origem e entra como trânsito na necessidade do destino nas
 *      próximas análises;
 *   4. quando o faturamento é importado, a sugestão recebe baixa ("faturada").
 *      A partir daí ela some dos compromissos, porque as bases atualizadas já
 *      refletem a saída na origem e a pendência no destino.
 *
 * Persistência: Vercel Neon/Postgres quando configurado; memória (modo demo)
 * caso contrário.
 */

export type StatusSugestao = "aprovada" | "faturada" | "cancelada";

/**
 * Uma baixa por faturamento. Guardamos CADA baixa com a data em que a
 * transferência foi faturada, e não só o total — é isso que permite responder
 * à pergunta que decide duplicidade: *a base que estou importando agora já
 * reflete esta movimentação?*
 */
export interface Baixa {
  qtd: number;
  /** Data do faturamento (da planilha; se ausente, a do processamento). */
  em: string;
  registradoEm: string;
  documento?: string;
}

export interface Sugestao {
  id: string;
  analiseId: string;
  criadoEm: string;
  criadoPor: string;
  cdOrigem: number;
  cdDestino: number;
  codigoProduto: number;
  produto: string;
  qtd: number;
  valor: number;
  preco: number;
  embCompra: number;
  detalhe: Record<string, unknown>;
  status: StatusSugestao;
  qtdFaturada: number;
  baixas: Baixa[];
  faturadoEm: string | null;
  atualizadoEm: string;
}

export interface NovaSugestao {
  cdOrigem: number;
  cdDestino: number;
  codigoProduto: number;
  produto: string;
  qtd: number;
  valor: number;
  preco: number;
  embCompra: number;
  detalhe?: Record<string, unknown>;
}

export interface EventoFaturamento {
  id: string;
  em: string;
  por: string;
  arquivo: string;
  linhas: number;
  casadas: number;
  semCorrespondencia: number;
  qtdBaixada: number;
  /** Impressão digital do conteúdo — barra a reimportação do mesmo arquivo. */
  impressao?: string;
}

export interface FiltroCarteira {
  status?: StatusSugestao | "todas";
  cdOrigem?: number | null;
  cdDestino?: number | null;
  q?: string | null;
  limite?: number;
}

const nowIso = () => new Date().toISOString();

/** Datas fora desta janela são lixo de conversão, não faturamento real. */
const ANO_MIN = 2000;
const ANO_MAX = 2100;

/** Dia serial do Excel (dias desde 30/12/1899) → ISO ao meio-dia UTC. */
function deSerialExcel(serial: number): string | null {
  // 36526 = 01/01/2000; 73051 = 01/01/2100.
  if (!(serial >= 36526 && serial < 73051)) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return new Date(ms + 12 * 3600000).toISOString();
}

function deDiaMesAno(d: number, m: number, a: number): string | null {
  if (a < 100) a += 2000;
  if (a < ANO_MIN || a > ANO_MAX || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(a, m - 1, d, 12));
  return dt.getUTCDate() === d ? dt.toISOString() : null;
}

/**
 * Data do faturamento (ou da posição de estoque) → ISO, ou `null`.
 *
 * Aceita dd/mm/aaaa (também com `-`, `.` e ano de 2 dígitos), aaaa-mm-dd,
 * aaaammdd, ISO completo e o **dia serial do Excel**. Este último é o caso que
 * importa: uma célula de data em XLSX chega como número (46305). Lida como
 * texto, ela virava o ano 46305 — o Postgres recusa a gravação no meio da baixa
 * e, em memória, a comparação com a data da base dava o resultado errado.
 */
export function normalizarDataFaturamento(v?: string | number | null): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (/^\d{5}(\.\d+)?$/.test(t)) return deSerialExcel(Number(t));
  if (/^\d{8}$/.test(t)) return deDiaMesAno(+t.slice(6, 8), +t.slice(4, 6), +t.slice(0, 4));
  const br = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?!\d)/);
  if (br) return deDiaMesAno(+br[1], +br[2], +br[3]);
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return deDiaMesAno(+iso[3], +iso[2], +iso[1]);
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  const ano = d.getUTCFullYear();
  return ano >= ANO_MIN && ano <= ANO_MAX ? d.toISOString() : null;
}

/**
 * Conserta baixas gravadas antes da correção acima: "+046305-01-01T…" era o
 * serial do Excel lido como ano. Datas válidas passam intactas.
 */
export function repararDataBaixa(em: string): string {
  const m = /^\+0*(\d{5})-01-01T/.exec(em);
  if (!m) return em;
  return deSerialExcel(Number(m[1])) ?? em;
}
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Id determinístico: reaprovar a mesma linha da mesma análise atualiza. */
function idSugestao(analiseId: string, cdOrigem: number, cdDestino: number, codigoProduto: number): string {
  return `sug_${analiseId}_${cdOrigem}_${cdDestino}_${codigoProduto}`;
}

/** Saldo ainda em aberto (não faturado) de uma sugestão. */
export function qtdAberta(s: Sugestao): number {
  if (s.status !== "aprovada") return 0;
  return Math.max(s.qtd - s.qtdFaturada, 0);
}

/**
 * Quanto desta sugestão a base de referência AINDA NÃO reflete.
 *
 * É o coração do ciclo periódico. Uma transferência pode estar em três estados
 * em relação à base que acabou de ser importada:
 *
 * 1. aprovada e não faturada → não saiu do estoque: a base não reflete → conta;
 * 2. faturada DEPOIS da data da base → saiu, mas a base é anterior → conta;
 * 3. faturada ANTES da data da base → a base já mostra a saída na origem e a
 *    pendência no destino → NÃO conta (contar de novo seria descontar duas
 *    vezes o mesmo volume).
 *
 * Sem essa distinção o app ou some com estoque disponível (caso 3 contado) ou
 * sugere de novo algo que já foi transferido (caso 2 ignorado).
 */
export function qtdNaoRefletida(s: Sugestao, dataBase: string): number {
  if (s.status === "cancelada") return 0;
  const emAberto = Math.max(s.qtd - s.qtdFaturada, 0);
  let faturadoDepois = 0;
  for (const b of s.baixas ?? []) {
    if (!dataBase || b.em > dataBase) faturadoDepois += b.qtd;
  }
  return emAberto + faturadoDepois;
}

// --------------------------- Fallback em memória ---------------------------

const g = globalThis as unknown as {
  __carteira?: Map<string, Sugestao>;
  __faturamentos?: EventoFaturamento[];
};
function mem(): Map<string, Sugestao> {
  if (!g.__carteira) g.__carteira = new Map();
  return g.__carteira;
}
function memEventos(): EventoFaturamento[] {
  if (!g.__faturamentos) g.__faturamentos = [];
  return g.__faturamentos;
}

// ----------------------------- Schema (Neon) -------------------------------

let schemaPronto = false;
async function ensureSchema(): Promise<void> {
  if (schemaPronto) return;
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sugestao_transferencia (
      id             TEXT PRIMARY KEY,
      analise_id     TEXT NOT NULL,
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
      criado_por     TEXT NOT NULL,
      cd_origem      INTEGER NOT NULL,
      cd_destino     INTEGER NOT NULL,
      codigo_produto BIGINT NOT NULL,
      produto        TEXT,
      qtd            DOUBLE PRECISION NOT NULL,
      valor          DOUBLE PRECISION NOT NULL,
      preco          DOUBLE PRECISION NOT NULL DEFAULT 0,
      emb_compra     DOUBLE PRECISION NOT NULL DEFAULT 0,
      detalhe        JSONB NOT NULL DEFAULT '{}'::jsonb,
      status         TEXT NOT NULL DEFAULT 'aprovada',
      qtd_faturada   DOUBLE PRECISION NOT NULL DEFAULT 0,
      baixas         JSONB NOT NULL DEFAULT '[]'::jsonb,
      faturado_em    TIMESTAMPTZ,
      atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_sugestao_aberta
     ON sugestao_transferencia (status, cd_origem, cd_destino, codigo_produto)`,
  );
  // Coluna adicionada depois da primeira versão do esquema.
  await pool.query(`ALTER TABLE sugestao_transferencia ADD COLUMN IF NOT EXISTS baixas JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS faturamento_evento (
      id                  TEXT PRIMARY KEY,
      em                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      por                 TEXT NOT NULL,
      arquivo             TEXT,
      linhas              INTEGER NOT NULL DEFAULT 0,
      casadas             INTEGER NOT NULL DEFAULT 0,
      sem_correspondencia INTEGER NOT NULL DEFAULT 0,
      qtd_baixada         DOUBLE PRECISION NOT NULL DEFAULT 0,
      impressao           TEXT
    )
  `);
  await pool.query(`ALTER TABLE faturamento_evento ADD COLUMN IF NOT EXISTS impressao TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_faturamento_impressao ON faturamento_evento (impressao) WHERE impressao IS NOT NULL`);
  schemaPronto = true;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function daLinha(r: any): Sugestao {
  return {
    id: r.id,
    analiseId: r.analise_id,
    criadoEm: new Date(r.criado_em).toISOString(),
    criadoPor: r.criado_por,
    cdOrigem: Number(r.cd_origem),
    cdDestino: Number(r.cd_destino),
    codigoProduto: Number(r.codigo_produto),
    produto: r.produto ?? "",
    qtd: Number(r.qtd),
    valor: Number(r.valor),
    preco: Number(r.preco),
    embCompra: Number(r.emb_compra),
    detalhe: (r.detalhe ?? {}) as Record<string, unknown>,
    status: r.status as StatusSugestao,
    qtdFaturada: Number(r.qtd_faturada),
    baixas: ((r.baixas ?? []) as Baixa[]).map((b) => ({ ...b, em: repararDataBaixa(b.em) })),
    faturadoEm: r.faturado_em ? new Date(r.faturado_em).toISOString() : null,
    atualizadoEm: new Date(r.atualizado_em).toISOString(),
  };
}

/** Colunas usadas no cálculo: tudo menos `detalhe`, que só a tela mostra. */
const COLUNAS_CALCULO = `id, analise_id, criado_em, criado_por, cd_origem, cd_destino, codigo_produto,
  produto, qtd, valor, preco, emb_compra, status, qtd_faturada, baixas, faturado_em, atualizado_em`;

/** Linhas por comando no banco: grande o bastante para poucas idas, pequeno para não estourar o corpo. */
const LOTE_SQL = 2000;

const porCriacao = (a: Sugestao, b: Sugestao) =>
  a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : a.id < b.id ? -1 : 1;

/**
 * TODAS as sugestões em aberto, sem teto, da mais antiga para a mais nova.
 *
 * Cálculo nunca pode usar a listagem da tela: ela tem limite, e uma sugestão
 * que fica de fora deixa de descontar a origem (o app sugere de novo o que já
 * foi aprovado) e deixa de receber a baixa da NF.
 */
async function carregarAbertas(f: { cdOrigem?: number | null; cdDestino?: number | null } = {}): Promise<Sugestao[]> {
  const pool = getPool();
  if (pool) {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT ${COLUNAS_CALCULO} FROM sugestao_transferencia
       WHERE status = 'aprovada'
         AND ($1::int IS NULL OR cd_origem = $1)
         AND ($2::int IS NULL OR cd_destino = $2)
       ORDER BY criado_em, id`,
      [f.cdOrigem ?? null, f.cdDestino ?? null],
    );
    return rows.map(daLinha);
  }
  return Array.from(mem().values())
    .filter((s) => s.status === "aprovada")
    .filter((s) => f.cdOrigem == null || s.cdOrigem === f.cdOrigem)
    .filter((s) => f.cdDestino == null || s.cdDestino === f.cdDestino)
    .sort(porCriacao);
}

/**
 * Sugestões que a base de `dataBase` pode não refletir: as em aberto e as
 * faturadas com alguma baixa posterior à base. As faturadas antes da base —
 * a imensa maioria do histórico — nem saem do banco.
 */
async function carregarNaoRefletidas(dataBase: string): Promise<Sugestao[]> {
  const pool = getPool();
  if (pool) {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT ${COLUNAS_CALCULO} FROM sugestao_transferencia
       WHERE status = 'aprovada'
          OR (status = 'faturada' AND ($1 = '' OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(baixas) b
                WHERE b->>'em' > $1 OR b->>'em' LIKE '+%')))`,
      [dataBase],
    );
    return rows.map(daLinha);
  }
  return Array.from(mem().values()).filter((s) => s.status !== "cancelada");
}

/**
 * Evento que já processou este conteúdo. Busca direto pela impressão: a lista
 * da tela só traz os 50 últimos, e no banco ela nem trazia a impressão — a
 * trava de reimportação não funcionava fora do modo memória.
 */
async function eventoPorImpressao(impressao: string): Promise<EventoFaturamento | null> {
  const pool = getPool();
  if (pool) {
    await ensureSchema();
    const { rows } = await pool.query(`SELECT em, por, arquivo FROM faturamento_evento WHERE impressao = $1 LIMIT 1`, [impressao]);
    const r = rows[0];
    if (!r) return null;
    return { id: "", em: new Date(r.em).toISOString(), por: r.por, arquivo: r.arquivo ?? "", linhas: 0, casadas: 0, semCorrespondencia: 0, qtdBaixada: 0, impressao };
  }
  return memEventos().find((e) => e.impressao === impressao) ?? null;
}

// ------------------------------ API pública --------------------------------

export const carteira = {
  /** Persistência durável (Neon) ativa? */
  durable(): boolean {
    return dbEnabled();
  },

  /**
   * Aprova linhas de uma análise, CONCILIANDO com o que já está em aberto.
   *
   * O risco que isto elimina: aprovar duas vezes a mesma rota + produto e somar
   * volume que não existe. Quando a análise considerou as sugestões aprovadas,
   * o número que ela sugere já é o incremento — some. Quando não considerou (a
   * chave "considerar aprovadas" estava desligada), o número é o total bruto —
   * somar duplicaria, então grava-se apenas a diferença.
   */
  async aprovar(
    analiseId: string,
    itens: NovaSugestao[],
    por: string,
    opcoes: { consideraAprovadas: boolean } = { consideraAprovadas: true },
  ): Promise<{ gravadas: number; conciliadas: number; ignoradas: number; avisos: string[] }> {
    if (itens.length === 0) return { gravadas: 0, conciliadas: 0, ignoradas: 0, avisos: [] };
    const em = nowIso();

    // Saldo em aberto por rota + produto, vindo de OUTRAS análises.
    const existentes = await carregarAbertas();
    const abertoOutras = new Map<string, number>();
    for (const s of existentes) {
      if (s.analiseId === analiseId) continue;
      const aberto = qtdAberta(s);
      if (aberto <= 0) continue;
      const k = `${s.cdOrigem}>${s.cdDestino}|${s.codigoProduto}`;
      abertoOutras.set(k, (abertoOutras.get(k) ?? 0) + aberto);
    }

    let gravadas = 0;
    let conciliadas = 0;
    let ignoradas = 0;
    const avisos: string[] = [];
    const paraGravar: NovaSugestao[] = [];

    for (const it of itens) {
      const chave = `${it.cdOrigem}>${it.cdDestino}|${it.codigoProduto}`;
      const jaAberto = abertoOutras.get(chave) ?? 0;
      let qtd = it.qtd;

      if (!opcoes.consideraAprovadas && jaAberto > 0) {
        // A análise ignorou a carteira: o número dela inclui o que já está
        // comprometido. Grava só o que falta.
        qtd = Math.max(it.qtd - jaAberto, 0);
        if (qtd <= 0) {
          ignoradas++;
          if (avisos.length < 5)
            avisos.push(`CD${it.cdOrigem}→CD${it.cdDestino} · produto ${it.codigoProduto}: já havia ${Math.round(jaAberto)} un em aberto`);
          continue;
        }
        conciliadas++;
      }

      const proporcao = it.qtd > 0 ? qtd / it.qtd : 0;
      paraGravar.push({ ...it, qtd, valor: it.valor * proporcao });
      gravadas++;
    }
    await this.gravarSugestoes(paraGravar, analiseId, por, em);

    if (ignoradas > 0 || conciliadas > 0) {
      avisos.unshift(
        `Conciliação: ${conciliadas} linha(s) ajustada(s) e ${ignoradas} ignorada(s) por já terem saldo em aberto na carteira.`,
      );
    }
    return { gravadas, conciliadas, ignoradas, avisos };
  },

  /** Grava (ou atualiza) uma sugestão da análise. */
  async gravarSugestao(it: NovaSugestao, analiseId: string, por: string, em: string): Promise<void> {
    await this.gravarSugestoes([it], analiseId, por, em);
  },

  /**
   * Grava (ou atualiza) sugestões em lote. Aprovar "todas do filtro" num plano
   * real são dezenas de milhares de linhas: uma ida ao banco por linha estoura
   * o tempo da função.
   */
  async gravarSugestoes(itens: NovaSugestao[], analiseId: string, por: string, em: string): Promise<void> {
    // Mesmo id duas vezes no lote: vale a última (o banco recusaria o lote).
    const unicos = new Map<string, NovaSugestao>();
    for (const it of itens) unicos.set(idSugestao(analiseId, it.cdOrigem, it.cdDestino, it.codigoProduto), it);
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const todos = Array.from(unicos.entries());
      for (let i = 0; i < todos.length; i += LOTE_SQL) {
        const lote = todos.slice(i, i + LOTE_SQL);
        await pool.query(
          `INSERT INTO sugestao_transferencia
             (id, analise_id, criado_em, criado_por, cd_origem, cd_destino, codigo_produto,
              produto, qtd, valor, preco, emb_compra, detalhe, status, qtd_faturada, atualizado_em)
           SELECT u.id, $1, $2, $3, u.o, u.d, u.p, u.nome, u.qtd, u.valor, u.preco, u.emb, u.det::jsonb, 'aprovada', 0, $2
           FROM unnest($4::text[], $5::int[], $6::int[], $7::bigint[], $8::text[],
                       $9::float8[], $10::float8[], $11::float8[], $12::float8[], $13::text[])
                AS u(id, o, d, p, nome, qtd, valor, preco, emb, det)
           ON CONFLICT (id) DO UPDATE SET
             qtd = EXCLUDED.qtd,
             valor = EXCLUDED.valor,
             preco = EXCLUDED.preco,
             emb_compra = EXCLUDED.emb_compra,
             detalhe = EXCLUDED.detalhe,
             produto = EXCLUDED.produto,
             status = CASE WHEN sugestao_transferencia.status = 'cancelada'
                           THEN 'aprovada' ELSE sugestao_transferencia.status END,
             atualizado_em = EXCLUDED.criado_em`,
          [
            analiseId, em, por,
            lote.map(([id]) => id),
            lote.map(([, it]) => it.cdOrigem),
            lote.map(([, it]) => it.cdDestino),
            lote.map(([, it]) => it.codigoProduto),
            lote.map(([, it]) => it.produto ?? ""),
            lote.map(([, it]) => it.qtd),
            lote.map(([, it]) => it.valor),
            lote.map(([, it]) => it.preco ?? 0),
            lote.map(([, it]) => it.embCompra ?? 0),
            lote.map(([, it]) => JSON.stringify(it.detalhe ?? {})),
          ],
        );
      }
      return;
    }
    const m = mem();
    for (const [id, it] of unicos) {
      const anterior = m.get(id);
      m.set(id, {
        id,
        analiseId,
        criadoEm: anterior?.criadoEm ?? em,
        criadoPor: anterior?.criadoPor ?? por,
        cdOrigem: it.cdOrigem,
        cdDestino: it.cdDestino,
        codigoProduto: it.codigoProduto,
        produto: it.produto ?? "",
        qtd: it.qtd,
        valor: it.valor,
        preco: it.preco ?? 0,
        embCompra: it.embCompra ?? 0,
        detalhe: it.detalhe ?? {},
        status: anterior && anterior.status === "faturada" ? "faturada" : "aprovada",
        qtdFaturada: anterior?.qtdFaturada ?? 0,
        baixas: anterior?.baixas ?? [],
        faturadoEm: anterior?.faturadoEm ?? null,
        atualizadoEm: em,
      });
    }
  },

  /** Cancela sugestões (deixam de contar como compromisso). */
  async cancelar(ids: string[], _por: string): Promise<number> {
    if (ids.length === 0) return 0;
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const { rowCount } = await pool.query(
        `UPDATE sugestao_transferencia SET status = 'cancelada', atualizado_em = now()
         WHERE id = ANY($1::text[]) AND status <> 'faturada'`,
        [ids],
      );
      return rowCount ?? 0;
    }
    const m = mem();
    let n = 0;
    for (const id of ids) {
      const s = m.get(id);
      if (s && s.status !== "faturada") {
        s.status = "cancelada";
        s.atualizadoEm = nowIso();
        n++;
      }
    }
    return n;
  },

  /**
   * Listagem para a TELA: filtrada no banco e com teto (padrão 500, máx. 5000).
   * Para cálculo use `listarAbertas` — o teto aqui é de exibição, não de regra.
   */
  async listar(f: FiltroCarteira = {}): Promise<Sugestao[]> {
    const limite = Math.min(f.limite ?? 500, 5000);
    const status = f.status ?? "aprovada";
    const q = (f.q ?? "").toString().trim().toLowerCase();
    const cdO = f.cdOrigem == null ? null : Number(f.cdOrigem);
    const cdD = f.cdDestino == null ? null : Number(f.cdDestino);
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT * FROM sugestao_transferencia
         WHERE ($1 = 'todas' OR status = $1)
           AND ($2::int IS NULL OR cd_origem = $2)
           AND ($3::int IS NULL OR cd_destino = $3)
           AND ($4 = '' OR lower(codigo_produto::text || ' ' || coalesce(produto, '')) LIKE '%' || $4 || '%')
         ORDER BY criado_em DESC, id
         LIMIT $5`,
        [status, cdO, cdD, q, limite],
      );
      return rows.map(daLinha);
    }
    return Array.from(mem().values())
      .sort((a, b) => -porCriacao(a, b))
      .filter((s) => (status === "todas" ? true : s.status === status))
      .filter((s) => (cdO == null ? true : s.cdOrigem === cdO))
      .filter((s) => (cdD == null ? true : s.cdDestino === cdD))
      .filter((s) => (q ? `${s.codigoProduto} ${s.produto}`.toLowerCase().includes(q) : true))
      .slice(0, limite);
  },

  /** Todas as sugestões em aberto, sem teto (ordem de transferência, cálculos). */
  async listarAbertas(f: { cdOrigem?: number | null; cdDestino?: number | null } = {}): Promise<Sugestao[]> {
    return carregarAbertas(f);
  },

  /**
   * Todas as sugestões aprovadas a partir de `desde` (qualquer status), sem
   * teto — base do acompanhamento aprovado × faturado.
   */
  async listarPeriodo(f: { desde?: string | null; cdOrigem?: number | null; cdDestino?: number | null } = {}): Promise<Sugestao[]> {
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT ${COLUNAS_CALCULO} FROM sugestao_transferencia
         WHERE ($1::timestamptz IS NULL OR criado_em >= $1)
           AND ($2::int IS NULL OR cd_origem = $2)
           AND ($3::int IS NULL OR cd_destino = $3)`,
        [f.desde ?? null, f.cdOrigem ?? null, f.cdDestino ?? null],
      );
      return rows.map(daLinha);
    }
    return Array.from(mem().values())
      .filter((s) => !f.desde || s.criadoEm >= f.desde)
      .filter((s) => f.cdOrigem == null || s.cdOrigem === f.cdOrigem)
      .filter((s) => f.cdDestino == null || s.cdDestino === f.cdDestino);
  },

  /** Saldo em aberto que cada análise ainda tem na carteira. */
  async abertasPorAnalise(): Promise<Map<string, { sugestoes: number; qtd: number; valor: number }>> {
    const out = new Map<string, { sugestoes: number; qtd: number; valor: number }>();
    for (const s of await carregarAbertas()) {
      const aberto = qtdAberta(s);
      if (aberto <= 0) continue;
      const a = out.get(s.analiseId) ?? { sugestoes: 0, qtd: 0, valor: 0 };
      a.sugestoes++;
      a.qtd += aberto;
      a.valor += aberto * s.preco;
      out.set(s.analiseId, a);
    }
    return out;
  },

  /**
   * Cancela o que ainda está em aberto das sugestões destas análises. Faturadas
   * não mudam; faturadas em parte mantêm a baixa e só o saldo deixa de valer.
   */
  async cancelarDasAnalises(analiseIds: string[], por: string): Promise<number> {
    if (!analiseIds.length) return 0;
    const alvo = new Set(analiseIds);
    const ids = (await carregarAbertas()).filter((s) => alvo.has(s.analiseId)).map((s) => s.id);
    return ids.length ? this.cancelar(ids, por) : 0;
  },

  /** Rota + produto (`"10>1|123"`) já levados à carteira por uma análise. */
  async chavesDaAnalise(analiseId: string): Promise<Set<string>> {
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT cd_origem, cd_destino, codigo_produto FROM sugestao_transferencia
         WHERE analise_id = $1 AND status <> 'cancelada'`,
        [analiseId],
      );
      return new Set(rows.map((r: any) => `${Number(r.cd_origem)}>${Number(r.cd_destino)}|${Number(r.codigo_produto)}`));
    }
    return new Set(
      Array.from(mem().values())
        .filter((s) => s.analiseId === analiseId && s.status !== "cancelada")
        .map((s) => `${s.cdOrigem}>${s.cdDestino}|${s.codigoProduto}`),
    );
  },

  /**
   * Compromissos em aberto: o que já foi aprovado e ainda não foi faturado.
   * Alimenta a próxima análise (desconta da origem, entra como trânsito no
   * destino).
   */
  /**
   * Compromissos que a base importada AINDA NÃO reflete.
   *
   * `dataBase` é a data de referência da posição de estoque. Sugestões
   * faturadas antes dela já aparecem na base (estoque menor na origem,
   * pendência no destino) e por isso NÃO entram — contá-las descontaria duas
   * vezes o mesmo volume. As faturadas depois dela, e as ainda em aberto,
   * entram: a base é anterior à movimentação.
   */
  async compromissos(dataBase = ""): Promise<Compromissos> {
    const c = compromissosVazios();
    const todas = await carregarNaoRefletidas(dataBase);
    for (const s of todas) {
      const saldo = qtdNaoRefletida(s, dataBase);
      if (saldo <= 0) continue;
      const ko = chaveCdProduto(s.cdOrigem, s.codigoProduto);
      c.saidaOrigem.set(ko, (c.saidaOrigem.get(ko) ?? 0) + saldo);
      const kd = chaveCdProduto(s.cdDestino, s.codigoProduto);
      c.entradaDestino.set(kd, (c.entradaDestino.get(kd) ?? 0) + saldo);
      // Rota + produto: o que está comprometido também ocupa doca e frota.
      const kr = chaveRotaProduto(s.cdOrigem, s.cdDestino, s.codigoProduto);
      c.rotaProduto.set(kr, (c.rotaProduto.get(kr) ?? 0) + saldo);
    }
    return c;
  },

  /** Totais da carteira para os cabeçalhos das telas. */
  async resumo(dataBase = ""): Promise<{
    aprovadas: number;
    qtdAberta: number;
    valorAberto: number;
    faturadas: number;
    qtdFaturada: number;
    /** Volume que a base atual ainda NÃO reflete (o que a análise desconta). */
    qtdNaoRefletida: number;
    valorNaoRefletido: number;
    /** Sugestões em aberto há mais de 30 dias — candidatas a revisão. */
    envelhecidas: number;
    diasMaisAntiga: number;
  }> {
    const todas = await carregarNaoRefletidas(dataBase);
    const agora = Date.now();
    let qtdAb = 0;
    let valorAb = 0;
    let aprovadas = 0;
    let faturadas = 0;
    let qtdFat = 0;
    let qtdNaoRefl = 0;
    let valorNaoRefl = 0;
    let envelhecidas = 0;
    let diasMaisAntiga = 0;
    // Faturadas são histórico e crescem sem parar: só os totais saem do banco.
    const pool = getPool();
    if (pool) {
      const { rows } = await pool.query(
        `SELECT count(*) FILTER (WHERE status = 'faturada') AS n, coalesce(sum(qtd_faturada), 0) AS q
         FROM sugestao_transferencia`,
      );
      faturadas = Number(rows[0]?.n ?? 0);
      qtdFat = Number(rows[0]?.q ?? 0);
    } else {
      for (const s of mem().values()) {
        if (s.status === "faturada") faturadas++;
        qtdFat += s.qtdFaturada;
      }
    }
    for (const s of todas) {
      if (s.status === "aprovada") {
        aprovadas++;
        const ab = qtdAberta(s);
        qtdAb += ab;
        valorAb += ab * s.preco;
        if (ab > 0) {
          const dias = Math.floor((agora - new Date(s.criadoEm).getTime()) / 86400000);
          if (dias > diasMaisAntiga) diasMaisAntiga = dias;
          if (dias >= 30) envelhecidas++;
        }
      }
      const nr = qtdNaoRefletida(s, dataBase);
      qtdNaoRefl += nr;
      valorNaoRefl += nr * s.preco;
    }
    return {
      aprovadas,
      qtdAberta: qtdAb,
      valorAberto: valorAb,
      faturadas,
      qtdFaturada: qtdFat,
      qtdNaoRefletida: qtdNaoRefl,
      valorNaoRefletido: valorNaoRefl,
      envelhecidas,
      diasMaisAntiga,
    };
  },

  /**
   * Dá baixa nas sugestões aprovadas a partir da base de faturamento.
   * Casamento por (CD origem, CD destino, produto), FIFO pela data de criação.
   */
  async baixarFaturamento(
    linhas: LinhaFaturamento[],
    por: string,
    arquivo: string,
    impressao?: string,
  ): Promise<RelatorioFaturamento> {
    // Trava de reimportação: o mesmo arquivo processado duas vezes baixaria o
    // dobro e liberaria compromisso que ninguém faturou.
    if (impressao) {
      const repetido = await eventoPorImpressao(impressao);
      if (repetido) {
        return {
          linhas: linhas.length,
          quantidadeTotal: 0,
          baixadas: 0,
          qtdBaixada: 0,
          semCorrespondencia: [],
          achados: [
            {
              nivel: "erro",
              codigo: "faturamento_repetido",
              mensagem: `Este arquivo já foi importado em ${new Date(repetido.em).toLocaleString("pt-BR")} por ${repetido.por} — nada foi alterado.`,
              qtd: 1,
              exemplos: [`arquivo anterior: ${repetido.arquivo}`],
            },
          ],
          ok: false,
        };
      }
    }

    const abertas = (await carregarAbertas()).filter((s) => qtdAberta(s) > 0);

    const porChave = new Map<string, Sugestao[]>();
    for (const s of abertas) {
      const k = `${s.cdOrigem}>${s.cdDestino}|${s.codigoProduto}`;
      const arr = porChave.get(k);
      if (arr) arr.push(s);
      else porChave.set(k, [s]);
    }

    const agora = nowIso();
    const alterados = new Map<string, Sugestao>();
    const semCorrespondencia: RelatorioFaturamento["semCorrespondencia"] = [];
    let qtdBaixada = 0;
    let quantidadeTotal = 0;
    let documentosRepetidos = 0;
    let datasNaoReconhecidas = 0;
    const exemplosData: string[] = [];

    for (const f of linhas) {
      quantidadeTotal += f.quantidade;
      let restante = f.quantidade;
      const chave = `${f.cdOrigem}>${f.cdDestino}|${f.codigoProduto}`;
      const fila = porChave.get(chave) ?? [];
      const doc = (f.documento ?? "").trim();
      const dataLida = normalizarDataFaturamento(f.data);
      if (!dataLida && (f.data ?? "").trim()) {
        datasNaoReconhecidas++;
        if (exemplosData.length < 5) exemplosData.push(String(f.data));
      }
      const dataFat = dataLida ?? agora;

      // Mesmo documento já lançado nesta rota + produto: linha repetida.
      if (doc && fila.some((s) => (s.baixas ?? []).some((b) => b.documento === doc))) {
        documentosRepetidos++;
        continue;
      }

      for (const s of fila) {
        if (restante <= 0) break;
        const disp = qtdAberta(s);
        if (disp <= 0) continue;
        const baixa = Math.min(disp, restante);
        s.qtdFaturada += baixa;
        s.baixas = [...(s.baixas ?? []), { qtd: baixa, em: dataFat, registradoEm: agora, documento: doc || undefined }];
        restante -= baixa;
        qtdBaixada += baixa;
        if (s.qtdFaturada >= s.qtd - 1e-9) {
          s.status = "faturada";
          s.faturadoEm = dataFat;
        }
        s.atualizadoEm = agora;
        alterados.set(s.id, s);
      }
      if (restante > 1e-9) {
        semCorrespondencia.push({ cdOrigem: f.cdOrigem, cdDestino: f.cdDestino, codigoProduto: f.codigoProduto, quantidade: restante });
      }
    }

    const evento: EventoFaturamento = {
      id: uid("fat"),
      em: agora,
      por,
      arquivo,
      linhas: linhas.length,
      casadas: alterados.size,
      semCorrespondencia: semCorrespondencia.length,
      qtdBaixada,
      impressao,
    };

    // Grava tudo numa transação: baixas e evento entram juntos ou nada entra.
    // Antes, uma falha no meio deixava baixas gravadas sem o evento — e a
    // reimportação do mesmo arquivo, sem impressão registrada, baixava de novo.
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const cli = await pool.connect();
      try {
        await cli.query("BEGIN");
        const todos = Array.from(alterados.values());
        for (let i = 0; i < todos.length; i += LOTE_SQL) {
          const lote = todos.slice(i, i + LOTE_SQL);
          await cli.query(
            `UPDATE sugestao_transferencia AS s
             SET qtd_faturada = u.qf, status = u.st, faturado_em = u.fe::timestamptz,
                 baixas = u.bx::jsonb, atualizado_em = now()
             FROM unnest($1::text[], $2::float8[], $3::text[], $4::text[], $5::text[]) AS u(id, qf, st, fe, bx)
             WHERE s.id = u.id`,
            [
              lote.map((x) => x.id),
              lote.map((x) => x.qtdFaturada),
              lote.map((x) => x.status),
              lote.map((x) => x.faturadoEm),
              lote.map((x) => JSON.stringify(x.baixas ?? [])),
            ],
          );
        }
        await cli.query(
          `INSERT INTO faturamento_evento (id, em, por, arquivo, linhas, casadas, sem_correspondencia, qtd_baixada, impressao)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [evento.id, evento.em, evento.por, evento.arquivo, evento.linhas, evento.casadas, evento.semCorrespondencia, evento.qtdBaixada, evento.impressao ?? null],
        );
        await cli.query("COMMIT");
      } catch (e) {
        await cli.query("ROLLBACK").catch(() => undefined);
        // Duas importações do mesmo arquivo ao mesmo tempo: a segunda esbarra
        // no índice único da impressão e nada dela é gravado.
        if ((e as { code?: string }).code === "23505" && impressao) {
          return {
            linhas: linhas.length, quantidadeTotal: 0, baixadas: 0, qtdBaixada: 0, semCorrespondencia: [], ok: false,
            achados: [{ nivel: "erro", codigo: "faturamento_repetido", mensagem: "Este arquivo acabou de ser importado por outra pessoa — nada foi alterado.", qtd: 1 }],
          };
        }
        throw e;
      } finally {
        cli.release();
      }
    } else {
      const m = mem();
      for (const s of alterados.values()) m.set(s.id, s);
      memEventos().unshift(evento);
    }

    const achados: RelatorioFaturamento["achados"] = [
      { nivel: "info", codigo: "baixa_ok", mensagem: `${alterados.size} sugestão(ões) baixada(s) — ${Math.round(qtdBaixada)} unidades confirmadas como transferidas.`, qtd: alterados.size },
    ];
    if (documentosRepetidos > 0)
      achados.push({
        nivel: "aviso",
        codigo: "documento_repetido",
        mensagem: "Linhas com documento já lançado anteriormente foram ignoradas (não baixam duas vezes).",
        qtd: documentosRepetidos,
      });
    if (datasNaoReconhecidas > 0)
      achados.push({
        nivel: "aviso",
        codigo: "data_nao_reconhecida",
        mensagem: "Data do faturamento não reconhecida: essas linhas usaram a data de hoje. Confira o formato (dd/mm/aaaa).",
        qtd: datasNaoReconhecidas,
        exemplos: exemplosData,
      });
    if (semCorrespondencia.length)
      achados.push({
        nivel: "aviso",
        codigo: "sem_correspondencia",
        mensagem: "Linhas de faturamento sem sugestão aprovada correspondente (rota + produto). Elas não alteram a carteira.",
        qtd: semCorrespondencia.length,
        exemplos: semCorrespondencia.slice(0, 8).map((x) => `CD${x.cdOrigem}→CD${x.cdDestino} · produto ${x.codigoProduto} · ${Math.round(x.quantidade)} un`),
      });

    return { linhas: linhas.length, quantidadeTotal, baixadas: alterados.size, qtdBaixada, semCorrespondencia: semCorrespondencia.slice(0, 200), achados, ok: true };
  },

  async eventos(): Promise<EventoFaturamento[]> {
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const { rows } = await pool.query(`SELECT * FROM faturamento_evento ORDER BY em DESC LIMIT 50`);
      return rows.map((r: any) => ({
        id: r.id,
        em: new Date(r.em).toISOString(),
        por: r.por,
        arquivo: r.arquivo ?? "",
        linhas: Number(r.linhas),
        casadas: Number(r.casadas),
        semCorrespondencia: Number(r.sem_correspondencia),
        qtdBaixada: Number(r.qtd_baixada),
        impressao: r.impressao ?? undefined,
      }));
    }
    return memEventos().slice(0, 50);
  },
};

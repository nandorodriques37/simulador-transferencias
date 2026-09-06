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
}

export interface FiltroCarteira {
  status?: StatusSugestao | "todas";
  cdOrigem?: number | null;
  cdDestino?: number | null;
  q?: string | null;
  limite?: number;
}

const nowIso = () => new Date().toISOString();
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
      faturado_em    TIMESTAMPTZ,
      atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_sugestao_aberta
     ON sugestao_transferencia (status, cd_origem, cd_destino, codigo_produto)`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS faturamento_evento (
      id                  TEXT PRIMARY KEY,
      em                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      por                 TEXT NOT NULL,
      arquivo             TEXT,
      linhas              INTEGER NOT NULL DEFAULT 0,
      casadas             INTEGER NOT NULL DEFAULT 0,
      sem_correspondencia INTEGER NOT NULL DEFAULT 0,
      qtd_baixada         DOUBLE PRECISION NOT NULL DEFAULT 0
    )
  `);
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
    faturadoEm: r.faturado_em ? new Date(r.faturado_em).toISOString() : null,
    atualizadoEm: new Date(r.atualizado_em).toISOString(),
  };
}

// ------------------------------ API pública --------------------------------

export const carteira = {
  /** Persistência durável (Neon) ativa? */
  durable(): boolean {
    return dbEnabled();
  },

  /** Aprova (ou reaprova) linhas de uma análise. */
  async aprovar(analiseId: string, itens: NovaSugestao[], por: string): Promise<{ gravadas: number }> {
    if (itens.length === 0) return { gravadas: 0 };
    const em = nowIso();
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      for (const it of itens) {
        const id = idSugestao(analiseId, it.cdOrigem, it.cdDestino, it.codigoProduto);
        await pool.query(
          `INSERT INTO sugestao_transferencia
             (id, analise_id, criado_em, criado_por, cd_origem, cd_destino, codigo_produto,
              produto, qtd, valor, preco, emb_compra, detalhe, status, qtd_faturada, atualizado_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'aprovada',0,$3)
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
            id, analiseId, em, por, it.cdOrigem, it.cdDestino, it.codigoProduto,
            it.produto ?? "", it.qtd, it.valor, it.preco ?? 0, it.embCompra ?? 0,
            JSON.stringify(it.detalhe ?? {}),
          ],
        );
      }
      return { gravadas: itens.length };
    }
    const m = mem();
    for (const it of itens) {
      const id = idSugestao(analiseId, it.cdOrigem, it.cdDestino, it.codigoProduto);
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
        faturadoEm: anterior?.faturadoEm ?? null,
        atualizadoEm: em,
      });
    }
    return { gravadas: itens.length };
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

  async listar(f: FiltroCarteira = {}): Promise<Sugestao[]> {
    const limite = Math.min(f.limite ?? 500, 5000);
    const pool = getPool();
    let itens: Sugestao[];
    if (pool) {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT * FROM sugestao_transferencia ORDER BY criado_em DESC LIMIT 5000`,
      );
      itens = rows.map(daLinha);
    } else {
      itens = Array.from(mem().values()).sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
    }
    const status = f.status ?? "aprovada";
    const q = (f.q ?? "").toString().trim().toLowerCase();
    return itens
      .filter((s) => (status === "todas" ? true : s.status === status))
      .filter((s) => (f.cdOrigem == null ? true : s.cdOrigem === Number(f.cdOrigem)))
      .filter((s) => (f.cdDestino == null ? true : s.cdDestino === Number(f.cdDestino)))
      .filter((s) => (q ? `${s.codigoProduto} ${s.produto}`.toLowerCase().includes(q) : true))
      .slice(0, limite);
  },

  /**
   * Compromissos em aberto: o que já foi aprovado e ainda não foi faturado.
   * Alimenta a próxima análise (desconta da origem, entra como trânsito no
   * destino).
   */
  async compromissos(): Promise<Compromissos> {
    const c = compromissosVazios();
    const pool = getPool();
    let abertas: { cdOrigem: number; cdDestino: number; codigoProduto: number; saldo: number }[];
    if (pool) {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT cd_origem, cd_destino, codigo_produto, SUM(qtd - qtd_faturada) AS saldo
         FROM sugestao_transferencia
         WHERE status = 'aprovada' AND qtd > qtd_faturada
         GROUP BY cd_origem, cd_destino, codigo_produto`,
      );
      abertas = rows.map((r: any) => ({
        cdOrigem: Number(r.cd_origem),
        cdDestino: Number(r.cd_destino),
        codigoProduto: Number(r.codigo_produto),
        saldo: Number(r.saldo),
      }));
    } else {
      abertas = Array.from(mem().values())
        .filter((s) => qtdAberta(s) > 0)
        .map((s) => ({ cdOrigem: s.cdOrigem, cdDestino: s.cdDestino, codigoProduto: s.codigoProduto, saldo: qtdAberta(s) }));
    }
    for (const a of abertas) {
      if (a.saldo <= 0) continue;
      const ko = chaveCdProduto(a.cdOrigem, a.codigoProduto);
      c.saidaOrigem.set(ko, (c.saidaOrigem.get(ko) ?? 0) + a.saldo);
      const kd = chaveCdProduto(a.cdDestino, a.codigoProduto);
      c.entradaDestino.set(kd, (c.entradaDestino.get(kd) ?? 0) + a.saldo);
      // Rota + produto: o que já está aprovado também ocupa doca, frota e
      // área de expedição na próxima análise.
      const kr = chaveRotaProduto(a.cdOrigem, a.cdDestino, a.codigoProduto);
      c.rotaProduto.set(kr, (c.rotaProduto.get(kr) ?? 0) + a.saldo);
    }
    return c;
  },

  /** Totais da carteira para os cabeçalhos das telas. */
  async resumo(): Promise<{ aprovadas: number; qtdAberta: number; valorAberto: number; faturadas: number; qtdFaturada: number }> {
    const todas = await this.listar({ status: "todas", limite: 5000 });
    let qtdAb = 0;
    let valorAb = 0;
    let aprovadas = 0;
    let faturadas = 0;
    let qtdFat = 0;
    for (const s of todas) {
      if (s.status === "aprovada") {
        aprovadas++;
        const ab = qtdAberta(s);
        qtdAb += ab;
        valorAb += ab * s.preco;
      }
      if (s.status === "faturada") faturadas++;
      qtdFat += s.qtdFaturada;
    }
    return { aprovadas, qtdAberta: qtdAb, valorAberto: valorAb, faturadas, qtdFaturada: qtdFat };
  },

  /**
   * Dá baixa nas sugestões aprovadas a partir da base de faturamento.
   * Casamento por (CD origem, CD destino, produto), FIFO pela data de criação.
   */
  async baixarFaturamento(linhas: LinhaFaturamento[], por: string, arquivo: string): Promise<RelatorioFaturamento> {
    const abertas = (await this.listar({ status: "aprovada", limite: 5000 }))
      .filter((s) => qtdAberta(s) > 0)
      .sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : 1));

    const porChave = new Map<string, Sugestao[]>();
    for (const s of abertas) {
      const k = `${s.cdOrigem}>${s.cdDestino}|${s.codigoProduto}`;
      const arr = porChave.get(k);
      if (arr) arr.push(s);
      else porChave.set(k, [s]);
    }

    const alterados = new Map<string, Sugestao>();
    const semCorrespondencia: RelatorioFaturamento["semCorrespondencia"] = [];
    let qtdBaixada = 0;
    let quantidadeTotal = 0;

    for (const f of linhas) {
      quantidadeTotal += f.quantidade;
      let restante = f.quantidade;
      const fila = porChave.get(`${f.cdOrigem}>${f.cdDestino}|${f.codigoProduto}`) ?? [];
      for (const s of fila) {
        if (restante <= 0) break;
        const disp = qtdAberta(s);
        if (disp <= 0) continue;
        const baixa = Math.min(disp, restante);
        s.qtdFaturada += baixa;
        restante -= baixa;
        qtdBaixada += baixa;
        if (s.qtdFaturada >= s.qtd - 1e-9) {
          s.status = "faturada";
          s.faturadoEm = nowIso();
        }
        s.atualizadoEm = nowIso();
        alterados.set(s.id, s);
      }
      if (restante > 1e-9) {
        semCorrespondencia.push({ cdOrigem: f.cdOrigem, cdDestino: f.cdDestino, codigoProduto: f.codigoProduto, quantidade: restante });
      }
    }

    // Grava as alterações.
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      for (const s of alterados.values()) {
        await pool.query(
          `UPDATE sugestao_transferencia
           SET qtd_faturada = $2, status = $3, faturado_em = $4, atualizado_em = now()
           WHERE id = $1`,
          [s.id, s.qtdFaturada, s.status, s.faturadoEm],
        );
      }
    } else {
      const m = mem();
      for (const s of alterados.values()) m.set(s.id, s);
    }

    const evento: EventoFaturamento = {
      id: uid("fat"),
      em: nowIso(),
      por,
      arquivo,
      linhas: linhas.length,
      casadas: alterados.size,
      semCorrespondencia: semCorrespondencia.length,
      qtdBaixada,
    };
    if (pool) {
      await pool.query(
        `INSERT INTO faturamento_evento (id, em, por, arquivo, linhas, casadas, sem_correspondencia, qtd_baixada)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [evento.id, evento.em, evento.por, evento.arquivo, evento.linhas, evento.casadas, evento.semCorrespondencia, evento.qtdBaixada],
      );
    } else {
      memEventos().unshift(evento);
    }

    const achados: RelatorioFaturamento["achados"] = [
      { nivel: "info", codigo: "baixa_ok", mensagem: `${alterados.size} sugestão(ões) baixada(s) — ${Math.round(qtdBaixada)} unidades confirmadas como transferidas.`, qtd: alterados.size },
    ];
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
      }));
    }
    return memEventos().slice(0, 50);
  },
};

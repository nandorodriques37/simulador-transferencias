import { Parametros } from "@/lib/engine/types";
import { getPool, dbEnabled } from "@/lib/store/db";

/**
 * Persistência de cenários/simulações.
 *
 * Cada simulação salva guarda o RESULTADO completo (comparativo oficial →
 * simulado), não apenas os parâmetros — assim é possível reexibir a simulação
 * exatamente como foi calculada, ao clicar nela, sem depender do estado atual
 * da base. Quando há Vercel Neon/Postgres configurado, grava lá (durável e
 * compartilhado); caso contrário, mantém em memória (modo demo).
 */

/** Resumo de uma rodada (mesma forma usada na tela de simulação). */
export interface ResumoSimulacao {
  modelo: string;
  valorTransfTotal: number;
  valorImediata: number;
  impactoFiscal: number;
  linhas: number;
  porCd: {
    cd: number;
    valorTotal: number;
    valorImediata: number;
    impactoFiscal: number;
    qtdImediata: number;
  }[];
}

/** Payload completo da simulação (o que a tela renderiza ao exibir). */
export interface SimulacaoPayload {
  base: { versaoId: string; parametros: Parametros; resumo: ResumoSimulacao };
  simulado: { parametros: Parametros; resumo: ResumoSimulacao };
  delta: {
    valorTransfTotal: number;
    valorImediata: number;
    impactoFiscal: number;
    linhas: number;
  };
}

export interface CenarioSalvo {
  id: string;
  nome: string;
  criadoEm: string;
  criadoPor: string;
  parametros: Parametros;
  baseVersionId: string;
  payload: SimulacaoPayload;
}

/** Metadados leves para a listagem (sem o payload pesado). */
export type CenarioResumo = Omit<CenarioSalvo, "payload">;

const uid = () => `cen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// --------------------------- Fallback em memória ---------------------------

const g = globalThis as unknown as { __cenarios?: Map<string, CenarioSalvo> };
function memStore(): Map<string, CenarioSalvo> {
  if (!g.__cenarios) g.__cenarios = new Map();
  return g.__cenarios;
}

// --------------------------- Schema (Neon/Postgres) ------------------------

let schemaPronto = false;
async function ensureSchema(): Promise<void> {
  if (schemaPronto) return;
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cenario_simulacao (
      id              TEXT PRIMARY KEY,
      nome            TEXT NOT NULL,
      criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
      criado_por      TEXT NOT NULL,
      base_version_id TEXT,
      parametros      JSONB NOT NULL,
      payload         JSONB NOT NULL
    )
  `);
  schemaPronto = true;
}

// ------------------------------- API pública -------------------------------

export const cenariosStore = {
  /** Indica se a persistência durável (Neon) está ativa. */
  durable(): boolean {
    return dbEnabled();
  },

  async salvar(
    nome: string,
    parametros: Parametros,
    por: string,
    payload: SimulacaoPayload,
  ): Promise<CenarioResumo> {
    const cen: CenarioSalvo = {
      id: uid(),
      nome,
      criadoEm: new Date().toISOString(),
      criadoPor: por,
      parametros,
      baseVersionId: payload.base.versaoId,
      payload,
    };
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      await pool.query(
        `INSERT INTO cenario_simulacao (id, nome, criado_em, criado_por, base_version_id, parametros, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cen.id, cen.nome, cen.criadoEm, cen.criadoPor, cen.baseVersionId, JSON.stringify(parametros), JSON.stringify(payload)],
      );
    } else {
      memStore().set(cen.id, cen);
    }
    const { payload: _omit, ...resumo } = cen;
    return resumo;
  },

  async listar(): Promise<CenarioResumo[]> {
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT id, nome, criado_em, criado_por, base_version_id, parametros
         FROM cenario_simulacao ORDER BY criado_em DESC`,
      );
      return rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        criadoEm: new Date(r.criado_em).toISOString(),
        criadoPor: r.criado_por,
        baseVersionId: r.base_version_id ?? "",
        parametros: r.parametros as Parametros,
      }));
    }
    return Array.from(memStore().values())
      .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1))
      .map(({ payload: _omit, ...r }) => r);
  },

  async obter(id: string): Promise<CenarioSalvo | null> {
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT id, nome, criado_em, criado_por, base_version_id, parametros, payload
         FROM cenario_simulacao WHERE id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        nome: r.nome,
        criadoEm: new Date(r.criado_em).toISOString(),
        criadoPor: r.criado_por,
        baseVersionId: r.base_version_id ?? "",
        parametros: r.parametros as Parametros,
        payload: r.payload as SimulacaoPayload,
      };
    }
    return memStore().get(id) ?? null;
  },

  async remover(id: string): Promise<boolean> {
    const pool = getPool();
    if (pool) {
      await ensureSchema();
      const { rowCount } = await pool.query(`DELETE FROM cenario_simulacao WHERE id = $1`, [id]);
      return (rowCount ?? 0) > 0;
    }
    return memStore().delete(id);
  },
};

import { ParametrosRede, Reconciliacao, ResumoDestino, ResumoOrigem, ResumoRota } from "@/lib/engine/types";
import { Kpis } from "@/lib/query/aggregate";
import { dbEnabled, getPool } from "@/lib/store/db";
import { armazenamentoDuravel, guardar, recuperar } from "@/lib/store/armazenamento";

/**
 * RESULTADO DAS ANÁLISES — o que o app guarda de verdade.
 *
 * A base é insumo e o plano linha a linha é material de trabalho da sessão. O
 * que precisa atravessar sessões, instâncias e deploys é o RESULTADO: com que
 * parâmetros a análise rodou, quanto ela liberou, quanto cobriu da necessidade,
 * o impacto fiscal e o desempenho de cada rota, origem e destino — além da
 * carteira aprovada, que vive em `lib/store/carteira.ts`.
 *
 * São poucos KB por análise, então cabem no Postgres sem cerimônia.
 */

export interface AnaliseSalva {
  id: string;
  criadoEm: string;
  criadoPor: string;
  label: string;
  datasetId: string;
  fonteBase: string;
  parametros: ParametrosRede;
  kpis: Kpis;
  rotas: ResumoRota[];
  origens: ResumoOrigem[];
  destinos: ResumoDestino[];
  reconciliacao: Reconciliacao;
  meses: string[];
  tempoMs: number;
  /** Preenchido quando linhas desta análise entram na carteira. */
  aprovado?: { linhas: number; qtd: number; valor: number; em: string };
}

/** Cabeçalho leve para listagens. */
export type AnaliseResumo = Pick<
  AnaliseSalva,
  "id" | "criadoEm" | "criadoPor" | "label" | "datasetId" | "fonteBase" | "tempoMs"
> & { kpis: Kpis; modoDemanda: string; origens: number[]; destinos: number[]; aprovado?: AnaliseSalva["aprovado"] };

/**
 * Sem Postgres, o resultado ainda precisa sobreviver à troca de instância —
 * então ele cai no mesmo armazenamento do insumo (Blob em produção, disco em
 * desenvolvimento). A memória é o último recurso, e aí a tela avisa.
 */
const CHAVE_INDICE = "catalogo/analises.json";
const MAX_GUARDADAS = 30;

const g = globalThis as unknown as { __analises?: Map<string, AnaliseSalva> };
function mem(): Map<string, AnaliseSalva> {
  if (!g.__analises) g.__analises = new Map();
  return g.__analises;
}

async function indiceArquivo(): Promise<string[]> {
  const txt = await recuperar(CHAVE_INDICE);
  if (!txt) return [];
  try {
    return JSON.parse(txt) as string[];
  } catch {
    return [];
  }
}

async function salvarNoArmazenamento(a: AnaliseSalva): Promise<void> {
  await guardar(`analise/${a.id}.json`, JSON.stringify(a));
  const idx = await indiceArquivo();
  const novo = [a.id, ...idx.filter((x) => x !== a.id)].slice(0, MAX_GUARDADAS);
  await guardar(CHAVE_INDICE, JSON.stringify(novo));
}

async function lerDoArmazenamento(id: string): Promise<AnaliseSalva | null> {
  const txt = await recuperar(`analise/${id}.json`);
  if (!txt) return null;
  try {
    return JSON.parse(txt) as AnaliseSalva;
  } catch {
    return null;
  }
}

let schemaPronto = false;
async function ensureSchema(): Promise<void> {
  if (schemaPronto) return;
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analise_resultado (
      id          TEXT PRIMARY KEY,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
      criado_por  TEXT NOT NULL,
      label       TEXT,
      dataset_id  TEXT,
      fonte_base  TEXT,
      parametros  JSONB NOT NULL,
      resultado   JSONB NOT NULL,
      aprovado    JSONB
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_analise_criado ON analise_resultado (criado_em DESC)`);
  schemaPronto = true;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function daLinha(r: any): AnaliseSalva {
  const res = r.resultado ?? {};
  return {
    id: r.id,
    criadoEm: new Date(r.criado_em).toISOString(),
    criadoPor: r.criado_por,
    label: r.label ?? "",
    datasetId: r.dataset_id ?? "",
    fonteBase: r.fonte_base ?? "",
    parametros: r.parametros,
    kpis: res.kpis,
    rotas: res.rotas ?? [],
    origens: res.origens ?? [],
    destinos: res.destinos ?? [],
    reconciliacao: res.reconciliacao,
    meses: res.meses ?? [],
    tempoMs: res.tempoMs ?? 0,
    aprovado: r.aprovado ?? undefined,
  };
}

export const analisesStore = {
  /** O resultado sobrevive à troca de instância? */
  durable(): boolean {
    return dbEnabled() || armazenamentoDuravel();
  },

  /** Onde os resultados estão sendo gravados. */
  destino(): "postgres" | "armazenamento" | "memoria" {
    if (dbEnabled()) return "postgres";
    return armazenamentoDuravel() ? "armazenamento" : "memoria";
  },

  async salvar(a: AnaliseSalva): Promise<void> {
    const pool = getPool();
    if (!pool) {
      mem().set(a.id, a);
      await salvarNoArmazenamento(a);
      return;
    }
    await ensureSchema();
    const resultado = {
      kpis: a.kpis,
      rotas: a.rotas,
      origens: a.origens,
      destinos: a.destinos,
      reconciliacao: a.reconciliacao,
      meses: a.meses,
      tempoMs: a.tempoMs,
    };
    await pool.query(
      `INSERT INTO analise_resultado (id, criado_em, criado_por, label, dataset_id, fonte_base, parametros, resultado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label, parametros = EXCLUDED.parametros, resultado = EXCLUDED.resultado`,
      [a.id, a.criadoEm, a.criadoPor, a.label, a.datasetId, a.fonteBase, JSON.stringify(a.parametros), JSON.stringify(resultado)],
    );
  },

  async obter(id: string): Promise<AnaliseSalva | null> {
    const pool = getPool();
    if (!pool) return mem().get(id) ?? (await lerDoArmazenamento(id));
    await ensureSchema();
    const { rows } = await pool.query(`SELECT * FROM analise_resultado WHERE id = $1`, [id]);
    return rows[0] ? daLinha(rows[0]) : null;
  },

  async ultima(): Promise<AnaliseSalva | null> {
    const lista = await this.listarCompleto(1);
    return lista[0] ?? null;
  },

  async listarCompleto(limite = 20): Promise<AnaliseSalva[]> {
    const pool = getPool();
    if (!pool) {
      const ids = await indiceArquivo();
      const doArquivo: AnaliseSalva[] = [];
      for (const id of ids.slice(0, limite)) {
        const a = mem().get(id) ?? (await lerDoArmazenamento(id));
        if (a) doArquivo.push(a);
      }
      // Análises só em memória (armazenamento indisponível) entram também.
      for (const a of mem().values()) if (!ids.includes(a.id)) doArquivo.push(a);
      return doArquivo.sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1)).slice(0, limite);
    }
    await ensureSchema();
    const { rows } = await pool.query(`SELECT * FROM analise_resultado ORDER BY criado_em DESC LIMIT $1`, [limite]);
    return rows.map(daLinha);
  },

  async listar(limite = 20): Promise<AnaliseResumo[]> {
    const completas = await this.listarCompleto(limite);
    return completas.map((a) => ({
      id: a.id,
      criadoEm: a.criadoEm,
      criadoPor: a.criadoPor,
      label: a.label,
      datasetId: a.datasetId,
      fonteBase: a.fonteBase,
      tempoMs: a.tempoMs,
      kpis: a.kpis,
      modoDemanda: a.parametros?.modoDemanda ?? "saldo_ideal",
      origens: a.parametros?.origens ?? [],
      destinos: a.parametros?.destinos ?? [],
      aprovado: a.aprovado,
    }));
  },

  /** Marca o que foi aprovado a partir desta análise (controle de execução). */
  async registrarAprovacao(id: string, dados: { linhas: number; qtd: number; valor: number }): Promise<void> {
    const aprovado = { ...dados, em: new Date().toISOString() };
    const pool = getPool();
    if (!pool) {
      const a = mem().get(id) ?? (await lerDoArmazenamento(id));
      if (a) {
        const antes = a.aprovado;
        a.aprovado = antes
          ? { linhas: antes.linhas + dados.linhas, qtd: antes.qtd + dados.qtd, valor: antes.valor + dados.valor, em: aprovado.em }
          : aprovado;
        mem().set(a.id, a);
        await salvarNoArmazenamento(a);
      }
      return;
    }
    await ensureSchema();
    await pool.query(
      `UPDATE analise_resultado SET aprovado = jsonb_build_object(
         'linhas', COALESCE((aprovado->>'linhas')::numeric, 0) + $2::numeric,
         'qtd',    COALESCE((aprovado->>'qtd')::numeric, 0) + $3::numeric,
         'valor',  COALESCE((aprovado->>'valor')::numeric, 0) + $4::numeric,
         'em',     $5::text)
       WHERE id = $1`,
      [id, dados.linhas, dados.qtd, dados.valor, aprovado.em],
    );
  },
};

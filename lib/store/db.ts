import { createPool, type VercelPool } from "@vercel/postgres";

/**
 * Conexão com o Vercel Postgres (Neon). A aplicação funciona sem banco (store
 * em memória, modo demo). Quando uma das variáveis de conexão está definida,
 * a camada de persistência (ex.: cenários/simulações) passa a gravar e ler do
 * Neon, tornando os dados duráveis e compartilhados entre instâncias.
 *
 * A integração Vercel + Neon injeta `POSTGRES_URL` automaticamente; aceitamos
 * também `DATABASE_URL` e `POSTGRES_PRISMA_URL` para flexibilidade local.
 */
function connectionString(): string | undefined {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    undefined
  );
}

let cached: VercelPool | null | undefined;

/** Pool singleton (ou `null` quando não há banco configurado). */
export function getPool(): VercelPool | null {
  if (cached !== undefined) return cached;
  const url = connectionString();
  cached = url ? createPool({ connectionString: url }) : null;
  return cached;
}

/** `true` quando há um banco Neon/Postgres configurado. */
export function dbEnabled(): boolean {
  return getPool() !== null;
}

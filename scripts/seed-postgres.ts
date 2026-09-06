/**
 * Aplica o esquema (lib/store/schema.sql) no Vercel Postgres/Neon.
 * Uso: defina POSTGRES_URL no ambiente e rode `npm run seed:pg`.
 *
 * O app funciona sem banco (modo demo, tudo em memória). Com banco, a CARTEIRA
 * de transferências (sugestões aprovadas + baixas por faturamento) passa a ser
 * durável — é o estado que precisa atravessar análises. As tabelas da carteira
 * também são criadas sob demanda por lib/store/carteira.ts; este script cria o
 * esquema completo, incluindo as tabelas de staging das bases.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Defina POSTGRES_URL (Vercel Postgres) antes de rodar o seed.");
    process.exit(1);
  }
  const { sql } = await import("@vercel/postgres");
  const schema = readFileSync(join(process.cwd(), "lib/store/schema.sql"), "utf8");
  // Executa cada statement separadamente.
  const statements = schema
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  console.log(`Esquema aplicado: ${statements.length} statements.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

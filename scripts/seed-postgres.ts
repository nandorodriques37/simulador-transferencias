/**
 * Aplica o esquema (lib/store/schema.sql) no Vercel Postgres.
 * Uso: defina POSTGRES_URL no ambiente e rode `npm run seed:pg`.
 *
 * A aplicação funciona sem banco (store em memória, modo demo). Este script é
 * o primeiro passo para ativar persistência real: cria as tabelas versionadas.
 * O adaptador de leitura/escrita (lib/store/postgres.ts) deve implementar a
 * mesma interface exportada em lib/store/index.ts.
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

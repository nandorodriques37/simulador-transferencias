-- ---------------------------------------------------------------------------
-- Esquema de persistência (Vercel Postgres / Neon).
--
-- O store padrão da aplicação é em memória (funciona no Vercel em modo demo,
-- porém efêmero por instância). Para persistência real, provisione o Vercel
-- Postgres, rode este script e implemente o adaptador em lib/store/postgres.ts
-- com a MESMA interface exportada em lib/store/index.ts. Toda a lógica de
-- versionamento já está modelada abaixo: nenhuma versão é sobrescrita.
-- ---------------------------------------------------------------------------

-- Bases importadas (posição de estoque + pedidos são gravadas em tabelas de
-- staging particionadas por import_id; aqui só o cabeçalho/auditoria).
CREATE TABLE IF NOT EXISTS importacao (
  id            TEXT PRIMARY KEY,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    TEXT NOT NULL,
  origem        TEXT NOT NULL,
  posicao_linhas INTEGER NOT NULL,
  pedidos_linhas INTEGER NOT NULL,
  relatorio     JSONB NOT NULL           -- RelatorioQualidade (achados)
);

CREATE TABLE IF NOT EXISTS posicao_estoque (
  import_id     TEXT NOT NULL REFERENCES importacao(id) ON DELETE CASCADE,
  id_sku        TEXT NOT NULL,
  deposito      INTEGER NOT NULL,
  codigo_produto INTEGER NOT NULL,
  produto       TEXT,
  estoque_disponivel   NUMERIC NOT NULL DEFAULT 0,
  estoque_objetivo     NUMERIC NOT NULL DEFAULT 0,
  quantidade_pendente  NUMERIC NOT NULL DEFAULT 0,
  venda_media_3m       NUMERIC NOT NULL DEFAULT 0,
  custo_reposicao      NUMERIC NOT NULL DEFAULT 0,
  preco_lista          NUMERIC NOT NULL DEFAULT 0,
  emb_compra           NUMERIC NOT NULL DEFAULT 0,
  fornecedor    TEXT, comprador TEXT, analista TEXT,
  categoria_n1  TEXT, categoria_n2 TEXT, categoria_n3 TEXT, categoria_n4 TEXT,
  flag_ame TEXT, monitorado TEXT, marca_propria TEXT, lead_time NUMERIC,
  PRIMARY KEY (import_id, id_sku)
);
CREATE INDEX IF NOT EXISTS ix_posicao_codigo ON posicao_estoque (import_id, codigo_produto);

CREATE TABLE IF NOT EXISTS pedidos_projetados (
  import_id     TEXT NOT NULL REFERENCES importacao(id) ON DELETE CASCADE,
  ano_mes       TEXT NOT NULL,
  cd_destino    INTEGER NOT NULL,
  codigo_produto INTEGER NOT NULL,
  pedido        NUMERIC NOT NULL DEFAULT 0,
  estoque_atual NUMERIC, estoque_projetado NUMERIC, eo NUMERIC,
  PRIMARY KEY (import_id, ano_mes, cd_destino, codigo_produto)  -- rejeita duplicidade de chave
);

-- Parâmetros versionados (nunca sobrescrever histórico).
CREATE TABLE IF NOT EXISTS parametros_versao (
  version    INTEGER PRIMARY KEY,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por TEXT NOT NULL,
  parametros JSONB NOT NULL,
  hash       TEXT NOT NULL
);

-- Snapshots de cálculo (uma versão por rodada; carimbo de base + params).
CREATE TABLE IF NOT EXISTS calc_versao (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por   TEXT NOT NULL,
  import_id    TEXT REFERENCES importacao(id),
  params_hash  TEXT NOT NULL,
  parametros   JSONB NOT NULL,
  meta         JSONB NOT NULL,          -- ResultadoCalculo.meta
  resumo       JSONB NOT NULL           -- ResultadoCalculo.resumo
);

-- Linhas do plano por versão (apenas transf_total > 0).
CREATE TABLE IF NOT EXISTS plano_linha (
  version_id   TEXT NOT NULL REFERENCES calc_versao(id) ON DELETE CASCADE,
  cd_destino   INTEGER NOT NULL,
  id_sku       TEXT NOT NULL,
  codigo_produto INTEGER NOT NULL,
  produto      TEXT,
  fornecedor TEXT, comprador TEXT, analista TEXT,
  categoria_n1 TEXT, categoria_n2 TEXT, categoria_n3 TEXT, categoria_n4 TEXT,
  preco_unitario NUMERIC, emb_compra NUMERIC,
  pedido_mes    NUMERIC[] NOT NULL,
  transf_mes    NUMERIC[] NOT NULL,
  valor_mes     NUMERIC[] NOT NULL,
  caixas_mes    NUMERIC[] NOT NULL,
  qtd_imediata  NUMERIC, valor_imediata NUMERIC, imediata_caixas NUMERIC, qtd_imediata_arred NUMERIC,
  cobertura_dias NUMERIC, status_cobertura TEXT, transf_total NUMERIC,
  PRIMARY KEY (version_id, cd_destino, id_sku)
);
CREATE INDEX IF NOT EXISTS ix_plano_busca ON plano_linha (version_id, cd_destino, status_cobertura);

-- Cenários nomeados do simulador.
CREATE TABLE IF NOT EXISTS cenario (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por TEXT NOT NULL,
  parametros JSONB NOT NULL,
  base_version_id TEXT REFERENCES calc_versao(id)
);

-- Trilha de aprovações (quem aprovou o quê e quando).
CREATE TABLE IF NOT EXISTS aprovacao (
  version_id  TEXT NOT NULL REFERENCES calc_versao(id) ON DELETE CASCADE,
  cd_destino  INTEGER NOT NULL,
  id_sku      TEXT NOT NULL,
  aprovado_por TEXT NOT NULL,
  aprovado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, cd_destino, id_sku)
);

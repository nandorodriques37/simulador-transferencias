-- ---------------------------------------------------------------------------
-- Esquema de persistência (Vercel Postgres / Neon).
--
-- O que É persistido de fato: a CARTEIRA DE TRANSFERÊNCIAS — as sugestões
-- aprovadas e as baixas por faturamento. É esse estado que atravessa análises
-- e precisa sobreviver a reinícios da instância.
--
-- As bases importadas e o resultado da análise ficam em memória por instância
-- (modo demo/serverless). As tabelas de staging abaixo estão prontas para
-- quando a base também for persistida.
--
-- Este arquivo é aplicado por `npm run seed:pg`. As tabelas da carteira também
-- são criadas sob demanda pelo app (lib/store/carteira.ts).
-- ---------------------------------------------------------------------------

-- ------------------------- Carteira de transferências ----------------------

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
  -- aprovada  = compromisso em aberto (desconta origem e destino)
  -- faturada  = já transferida (as bases atualizadas já refletem)
  -- cancelada = descartada (não desconta nada)
  status         TEXT NOT NULL DEFAULT 'aprovada',
  qtd_faturada   DOUBLE PRECISION NOT NULL DEFAULT 0,
  faturado_em    TIMESTAMPTZ,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sugestao_aberta
  ON sugestao_transferencia (status, cd_origem, cd_destino, codigo_produto);

CREATE TABLE IF NOT EXISTS faturamento_evento (
  id                  TEXT PRIMARY KEY,
  em                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  por                 TEXT NOT NULL,
  arquivo             TEXT,
  linhas              INTEGER NOT NULL DEFAULT 0,
  casadas             INTEGER NOT NULL DEFAULT 0,
  sem_correspondencia INTEGER NOT NULL DEFAULT 0,
  qtd_baixada         DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- ------------------------------ Bases (staging) ----------------------------

CREATE TABLE IF NOT EXISTS importacao (
  id            TEXT PRIMARY KEY,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    TEXT NOT NULL,
  origem        TEXT NOT NULL,
  base_linhas    INTEGER NOT NULL DEFAULT 0,
  pedidos_linhas INTEGER NOT NULL DEFAULT 0,
  relatorio     JSONB NOT NULL
);

-- Base única de CDs: uma linha por (CD, produto) — origem E destino.
CREATE TABLE IF NOT EXISTS base_cd (
  import_id      TEXT NOT NULL REFERENCES importacao(id) ON DELETE CASCADE,
  cd             INTEGER NOT NULL,
  codigo_produto BIGINT NOT NULL,
  produto        TEXT,
  estoque_disponivel  DOUBLE PRECISION NOT NULL DEFAULT 0,
  estoque_objetivo    DOUBLE PRECISION NOT NULL DEFAULT 0,
  quantidade_pendente DOUBLE PRECISION NOT NULL DEFAULT 0,
  venda_media_3m      DOUBLE PRECISION NOT NULL DEFAULT 0,
  custo_reposicao     DOUBLE PRECISION NOT NULL DEFAULT 0,
  preco_lista         DOUBLE PRECISION NOT NULL DEFAULT 0,
  emb_compra          DOUBLE PRECISION NOT NULL DEFAULT 0,
  fornecedor    TEXT,
  comprador     TEXT,
  analista      TEXT,
  categoria_n1  TEXT,
  categoria_n2  TEXT,
  categoria_n3  TEXT,
  categoria_n4  TEXT,
  PRIMARY KEY (import_id, cd, codigo_produto)
);

CREATE TABLE IF NOT EXISTS pedido_projetado (
  import_id      TEXT NOT NULL REFERENCES importacao(id) ON DELETE CASCADE,
  ano_mes        TEXT NOT NULL,
  cd_destino     INTEGER NOT NULL,
  codigo_produto BIGINT NOT NULL,
  pedido         DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (import_id, ano_mes, cd_destino, codigo_produto)
);

-- --------------------------- Auditoria das análises ------------------------

CREATE TABLE IF NOT EXISTS analise (
  id          TEXT PRIMARY KEY,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  TEXT NOT NULL,
  label       TEXT,
  parametros  JSONB NOT NULL,  -- ParametrosRede (origens, destinos, modo…)
  meta        JSONB NOT NULL   -- totais e KPIs do resultado
);

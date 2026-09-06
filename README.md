# Transferências entre CDs — análise de rede

Aplicativo web que planeja transferências de estoque **entre todos os CDs da
rede**: cada CD pode ser **origem** (pelo que sobra) e **destino** (pelo que
falta), na sequência que o planejador escolher — mostrando o benefício e o
**impacto fiscal (ICMS) por rota** ao lado.

> **Mudança de conceito (v2).** Antes eram três bases e uma origem fixa (CD10 →
> demais CDs). Agora são **duas bases** e a rede inteira em uma análise só.

---

## 🧠 O conceito em uma tela

```
      BASE ÚNICA DE CDs                    BASE DE PEDIDOS (opcional)
  (todos os CDs empilhados)                 ano_mês · CD · produto
   ↓ o que sobra    ↓ o que falta                    ↓
   EXCESSO           NECESSIDADE  ←—— modo "saldo ideal" ou "pedidos"

   Sequência de ORIGENS      →     Ordem de DESTINOS
   CD10 → CD9 → CD8                CD1 → CD2 → CD7 → CD8
     │                                │
     └── cada origem, na sua vez, olha TODOS os destinos na ordem
```

1. **Uma base só, com todos os CDs.** Mesmo layout da antiga base de origem —
   agora com todos os depósitos empilhados. Dela saem as duas pontas:
   - **excesso** (o CD como origem): `disponível + pendente − venda média 3m − estoque objetivo`
   - **falta** (o CD como destino): `estoque objetivo − disponível − pendente`
2. **Uma base de pedidos.** Você escolhe, por análise, o que o destino precisa:
   - **Só o saldo ideal** → a falta calculada acima (não usa a base de pedidos);
   - **Consumir os pedidos futuros** → os pedidos projetados mês a mês (DRP puro).
3. **Você define as duas sequências.** Primeiro a ordem das **origens** (quem
   escoa primeiro), depois a ordem dos **destinos** (quem é atendido primeiro).
   A demanda é um **saldo compartilhado**: o que a origem 1 atende some da fila
   da origem 2 — por isso a ordem muda o resultado.
4. **Aprovou, ficou valendo.** A linha aprovada vira uma **sugestão em carteira**
   e passa a descontar o excesso da origem e a entrar como trânsito no destino
   nas próximas análises — até você **importar a base de faturamento**, que dá
   baixa nela (a partir daí as bases atualizadas já refletem a movimentação).

Um CD pode estar nas duas listas. A única regra absoluta: **nenhum CD transfere
para si mesmo**.

---

## 🧮 Motor de cálculo (`lib/engine/`)

Puro, sem estado e testado (35 casos). Nenhum número de negócio é fixado em
código — tudo vem de `ParametrosRede`.

| # | Regra | Como o motor calcula |
|---|---|---|
| 1 | **Preço** | custo de reposição; se 0, preço de lista |
| 2 | **Excesso (origem)** | `MAX(disp + pendente − venda média 3m − objetivo, 0)` |
| 3 | **Necessidade (destino)** | modo *saldo ideal*: `MAX(objetivo − disp − pendente, 0)`; modo *pedidos*: pedido projetado por (mês × CD) |
| 4 | **Cascata por prioridade** | `transf[i] = CLAMP(excesso − cumsum_anterior, 0, demanda[i])` — vetorizada, sem laço sequencial |
| 5 | **Ordem dos baldes** | modo pedidos: **mês → destino** (mês 1 de todos os destinos antes do mês 2); modo saldo ideal: destino a destino |
| 6 | **Transferência imediata** | `MIN(transf, disp − venda média × fator)`, **rateada entre os destinos na ordem**, em **caixa fechada** (`ROUNDDOWN`) |
| 7 | **Cobertura** | `(disp + pendente) × 30 / venda média`, na visão do CD de origem |
| 8 | **Impacto fiscal** | `valor transferido × alíquota da ROTA (origem → destino)` |
| 9 | **Materialidade** | só entram no plano rotas × SKU com transferência > 0 |

**Invariantes verificados a cada análise** (`reconciliacao`):
- nenhuma origem envia mais que o próprio excesso;
- nenhum destino recebe mais que a própria necessidade;
- nenhuma auto-transferência (origem = destino).

**Desempenho:** rede de 6 CDs × 20 mil produtos (120 mil linhas de base) em
**menos de 1 s** — teste de performance em `lib/engine/calc.test.ts`.

```bash
npm test
```

---

## 📄 As duas bases (e a terceira, do faturamento)

A base anexada **não precisa de nenhuma coluna de fórmula**: o app lê só as
colunas cruas e recalcula tudo (mapa em `CAMPOS_CALCULADOS`, `lib/data/schema.ts`).
Os cabeçalhos aceitam variações e formato pt-BR (`1.234,56`); CSV em UTF-8 ou
latin1 é detectado automaticamente.

### 1. Base de CDs — origem **e** destino (obrigatória)

| Coluna | Campo | Obrigatória |
|---|---|---|
| CD / Depósito | `cd` | ✅ |
| Código do produto (`CodsemDv`) | `codigoProduto` | ✅ |
| Estoque disponível | `estoqueDisponivel` | ✅ |
| Estoque objetivo | `estoqueObjetivo` | ✅ |
| Venda média 3 meses | `vendaMedia3m` | ✅ |
| Quantidade pendente | `quantidadePendente` | — |
| Custo de reposição / Preço de lista | `custoReposicao` / `precoLista` | — |
| Embalagem de compra | `embCompra` | — |
| Fornecedor · comprador · analista · categorias N1–N4 | — | — |

> Uma linha por **(CD, produto)**. Chave repetida bloqueia a importação.

### 2. Base de pedidos (usada no modo *pedidos*)

`ano_mês` (aceita `2026_07`, `2026-07`, `07/2026`) · `CD destino` ·
`código do produto` · `pedido`.

### 3. Base de faturamento (importada na tela **Carteira**)

`CD origem` · `CD destino` · `código do produto` · `quantidade faturada` ·
(opcional) documento/NF e data. O casamento é por **rota + produto**, na ordem
de aprovação, com baixa parcial quando a quantidade faturada é menor que a
aprovada. Linhas sem sugestão correspondente são listadas, e não alteram nada.

---

## 🔄 O ciclo entre análises

```
 análise → aprova linha → SUGESTÃO EM ABERTO ──(desconta origem e destino)──┐
                                │                                          │
                                │ importa faturamento                      │ próxima análise
                                ▼                                          │
                            FATURADA (bases atualizadas já refletem) ───────┘
```

- **Em aberto:** desconta o excesso da origem e entra como trânsito no destino
  (no modo pedidos, o trânsito abate os meses mais próximos primeiro).
- **Faturada:** sai dos compromissos — o estoque já saiu da origem e já aparece
  como pendência no destino nas bases atualizadas.
- **Cancelada:** libera de volta o excesso e a necessidade.

A caixa *"Considerar sugestões já aprovadas"* permite rodar uma análise do
cenário cheio, ignorando a carteira, sem apagar nada.

---

## 🖥️ Telas

1. **Dashboard executivo** — KPIs (excesso disponível, transferências, cobertura
   da necessidade, impacto fiscal), **matriz origem × destino** (heatmap na
   sequência escolhida), aproveitamento por origem, cobertura por destino,
   maiores rotas e detalhe por rota (com quebra mensal no modo pedidos).
2. **Nova análise** — upload das duas bases com validação, escolha do modo de
   demanda, **sequência de origens**, **ordem de destinos** (cada CD mostra
   quanto tem de excesso/falta e o que já está comprometido), alíquotas por rota
   e parâmetros. Um clique roda a análise.
3. **Plano de transferência** — uma linha por rota × SKU, filtros (origem,
   destino, categoria, comprador, cobertura, só imediata), busca, ordenação,
   exportação **CSV/Excel** e **aprovação** (selecionadas ou todas do filtro).
4. **Carteira** — sugestões em aberto e faturadas, cancelamento, **modal de
   importação do faturamento** (com prévia) e geração da **ordem de
   transferência** para ERP/WMS com o saldo em aberto.

---

## 🚀 Deploy no Vercel

```bash
npm install
npm run dev        # http://localhost:3000
```

1. Importe o repositório no Vercel (framework **Next.js** detectado
   automaticamente; `vercel.json` ajusta o timeout das rotas pesadas).
2. **Persistência (Vercel Neon / Postgres):** crie um banco Neon no painel do
   Vercel e conecte ao projeto — `POSTGRES_URL` (ou `DATABASE_URL`) é injetada
   automaticamente. Opcionalmente aplique o esquema completo:

   ```bash
   npm run seed:pg
   ```

   O que é persistido é a **carteira** (`sugestao_transferencia` e
   `faturamento_evento`, criadas sob demanda) — o estado que precisa atravessar
   análises. Sem banco, o app roda em **modo demonstração**: base sintética com
   6 CDs (`lib/data/seed.ts`) e carteira em memória, efêmera por instância. A
   tela avisa quando está nesse modo.

   > As bases importadas e o resultado das análises ficam em memória por
   > instância (até 8 análises). O esquema em `lib/store/schema.sql` já prevê as
   > tabelas de staging para persistir também as bases.

### Pipeline: PR aprovado → app publicado

1. No Vercel, *Settings → Git*: **Production Branch = `main`**.
2. Merge em `main` dispara o deploy de produção; cada PR ganha um Preview.
3. Para exigir aprovação, ative no GitHub *Settings → Branches → Branch
   protection* em `main`: PR obrigatório + aprovação + status check
   **CI / test-build** (`.github/workflows/ci.yml`, roda `npm test` e
   `npm run build`).

> **Autenticação (SSO):** `lib/auth.ts` é um stub pronto para o SSO corporativo
> (lê `x-user-email`). Em produção, plugue o provedor (ex.: Azure AD via
> NextAuth) mantendo a trilha de auditoria já existente.

---

## 📁 Estrutura

```
app/                   Telas + rotas de API
  analise/             Nova análise (bases, sequências, parâmetros)
  plano/               Plano de transferência + aprovação
  carteira/            Sugestões aprovadas + faturamento + ordem ERP
  api/                 status · cds · params · import · importlog · analise ·
                       dashboard · plano[/export] · carteira[/ordem] · faturamento
lib/engine/            Motor de rede (puro) + tipos + testes
lib/data/              Esquemas, parsing, validação, leitura de planilha, seed
lib/query/             Filtro/paginação/agregação server-side
lib/store/             Estado da instância + carteira (Neon/memória) + schema.sql
lib/export.ts          CSV/Excel do plano e ordem de transferência
components/            Nav, UI e o seletor ordenado de CDs
```

## 🔭 Próximos passos previstos

Persistir as bases no Neon (staging já modelado), solver de otimização global
como modo avançado (a cascata gulosa é o padrão), custo de frete por rota,
restrições de capacidade e validade (shelf life), e integração direta com o ERP
para dispensar a importação manual do faturamento.

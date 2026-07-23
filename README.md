# Otimização de Transferências entre CDs

Aplicativo web que substitui a planilha Excel usada para planejar transferências
de **excesso de estoque do CD10** para os CDs **1, 9, 2, 8 e 7** — liberando
capital de giro e mostrando o **impacto fiscal (ICMS)** de cada rota ao lado do
benefício.

O app tem **dois modelos de transferência** (modelo **híbrido**), escolhidos com
um clique em *Parâmetros*:

- **DRP (pedidos):** abate os **pedidos de compra projetados (DRP)** dos próximos
  meses, cascateando o excesso por (mês × CD) na ordem de prioridade.
- **Estoque objetivo:** envia o excesso para **atender o saldo de estoque
  objetivo de cada CD** — sem quebra mensal. Recebe uma planilha simples
  (`CD destino · produto · descrição · saldo de estoque objetivo`) e distribui
  tudo o que sobra no CD de origem até cobrir o objetivo de cada destino, na
  ordem de prioridade.

A **base de acompanhamento é a mesma** nos dois modelos: as colunas mês a mês
permanecem (saem **zeradas** no modelo Estoque Objetivo) e há a coluna adicional
**"Transferir p/ Atender Estoque Objetivo"**.

Construído em **Next.js (App Router) + TypeScript**, pronto para deploy no
**Vercel**, com persistência em **Vercel Postgres** (modo demo em memória por
padrão). O motor de cálculo é **puro, vetorizado e testado**, e foi **validado
ao centavo contra a planilha original**.

---

## ✅ Validação do motor (contra a base real)

O motor TypeScript foi executado contra a base real da planilha
(`Transferencias_Saindo_CD10b.xlsb`): **79.313 SKUs / 130.608 células de pedido**.
Reproduziu **exatamente** os totais da aba `RESUMO` e gerou **8.926 linhas de
plano em ~250 ms**:

| Métrica | Planilha (RESUMO) | Motor TS |
|---|---|---|
| Transferido Jul / Ago / Set | 27.437.557,41 / 9.648.297,85 / 5.607.118,90 | ✅ idêntico |
| Total transferido | R$ 42.692.974,16 | ✅ |
| Transferência imediata | R$ 20.071.632,03 (861.396 un) | ✅ |
| Impacto fiscal total | R$ 851.307,68 | ✅ |
| Linhas do plano | ~8.900 | 8.926 |

Os agregados de referência ficam em `lib/engine/reference-totals.ts`. Nenhum
dado de SKU/preço individual é versionado no repositório.

---

## 🧮 Motor de cálculo (`lib/engine/`)

Regras implementadas exatamente como na planilha (nenhum número hardcoded — tudo
vem de `Parametros`):

1. **Preço** = custo de reposição; se 0, preço de lista.
2. **Excesso transferível** = `MAX(disp + pendente − venda_média − objetivo, 0)`.
3. **Demanda** por (mês × CD) via `lookup` indexado (um join, não 15 XLOOKUPs).
4. **Cascata por prioridade vetorizada** (cumsum-clamp, sem laço sequencial):
   `transf_i = CLAMP(excesso − cumsum_anterior, 0, pedido_i)`.
5. Valores em R$, **transferência imediata** (fator de segurança), **caixas**
   (arredondamento logístico), **cobertura** e **impacto fiscal** por CD.
6. Só entram no plano linhas `cd × sku` com transferência total > 0.

**Requisitos não-funcionais atendidos:**
- Recálculo completo **< 10 s** (na prática ~250 ms para 80k SKUs — ver teste de
  performance em `lib/engine/calc.test.ts`).
- **Invariante de reconciliação** por SKU: `soma(transf) + sobra = excesso`.
- **Versionamento**: toda mudança de parâmetro/base gera **nova versão de
  cálculo** (snapshot) — o histórico nunca é sobrescrito.

Rodar os testes (23 casos, incluindo bordas: preço 0, venda 0, emb 0, SKU sem
pedido, excesso < 1º pedido, sobra integral no mês 3, e o teste de performance):

```bash
npm test
```

---

## 🔀 Modelo híbrido (DRP × Estoque objetivo)

O motor é **um só** e a cascata gulosa (`cascataCumsum`) é idêntica nos dois
modelos — muda apenas **de onde vêm os baldes de demanda** (`params.modelo`):

| | **DRP (pedidos)** | **Estoque objetivo** |
|---|---|---|
| Fonte de demanda | Pedidos projetados (mês × CD) | Saldo de estoque objetivo (por CD) |
| Baldes da cascata | `nMeses × nCDs` | `nCDs` (um por CD) |
| Quebra mensal | sim | não (meses saem **zerados**) |
| Coluna resultado | `Transf. <mês>` | `Transferir p/ Atender Estoque Objetivo` |
| Planilha extra | PEDIDOS PROJETADOS | `CD destino · produto · descrição · saldo objetivo` |

O **excesso transferível** (REGRA 2), o **preço** (REGRA 1), a **transferência
imediata** (fator de segurança + caixa fechada), a **cobertura** e o **impacto
fiscal** funcionam igual nos dois modelos. No modelo Estoque Objetivo a
transferência imediata considera o objetivo inteiro (é, por natureza, imediato),
e o impacto fiscal usa o valor transferido para atender o objetivo.

A **nova planilha** do modelo 2 tem colunas simples (esquema em
`SCHEMA_OBJETIVO`, aceita variações de cabeçalho e formato pt-BR):

| Coluna | Campo interno | Obrigatória |
|---|---|---|
| CD destino | `cdDestino` | ✅ |
| Produto (código) | `codigoProduto` | ✅ |
| Descrição | `descricao` | — |
| Saldo de estoque objetivo | `saldoEstoqueObjetivo` | ✅ |

Escolha o modelo em *Parâmetros* (seletor no topo do editor) e envie a planilha
correspondente na área de importação. Toda troca de modelo/base gera **nova
versão de cálculo** (o histórico nunca é sobrescrito).

## 🖥️ Telas

1. **Dashboard executivo** — KPIs (excesso, transferido/mês, imediata, fiscal),
   matriz CD × mês, gráficos por CD e evolução mensal, filtro Total vs. >90 dias.
2. **Plano de transferência** — tabela virtualizada com as ~9 mil linhas, busca,
   filtros (CD, categoria, fornecedor, comprador, analista, cobertura),
   exportação **CSV/Excel** (layout da aba `Transferencias_Long`).
3. **Simulador de cenários** — reordena prioridade dos CDs (drag-and-drop),
   alíquotas, fator de segurança e horizonte; compara **base vs. simulado**
   (Δ R$ transferido e Δ fiscal); salva cenários nomeados.
4. **Parâmetros e importação** — **seletor do modelo** (DRP × Estoque objetivo),
   upload das bases (posição de estoque + pedidos **ou** estoque objetivo, em
   CSV/Excel/XLSB) com **validação de qualidade** (schema, duplicidade de chave,
   preços zerados/negativos, emb 0, SKUs sem demanda), prévia e log de
   importações; histórico de parâmetros (auditoria).
5. **Aprovação / execução** — marca linhas aprovadas (quem e quando) e gera o
   **arquivo de ordem de transferência** para o ERP/WMS.

---

## 🚀 Deploy no Vercel

```bash
npm install
npm run dev        # local em http://localhost:3000
```

1. Importe o repositório no Vercel (framework **Next.js** detectado
   automaticamente; `vercel.json` já ajusta o timeout das rotas de cálculo).
2. **Persistência (Vercel Postgres):** crie um banco Postgres no painel do
   Vercel e conecte ao projeto — as variáveis `POSTGRES_URL` são injetadas
   automaticamente. Depois aplique o esquema:

   ```bash
   npm run seed:pg
   ```

   O esquema versionado está em `lib/store/schema.sql`. Sem banco configurado, a
   aplicação roda em **modo demonstração** com uma base sintética em memória
   (`lib/data/seed.ts`) — funcional para avaliação, porém efêmera por instância.

### Pipeline: PR aprovado → app publicado

O deploy contínuo é feito pela **integração Git nativa do Vercel** (não precisa
de workflow de deploy próprio):

1. No Vercel, em *Settings → Git*, defina **Production Branch = `main`**.
2. Toda vez que um PR é **mergeado em `main`**, o Vercel dispara o **deploy de
   produção** automaticamente. Cada PR aberto também ganha um **Preview
   Deployment** com URL própria para revisão.
3. Para exigir **aprovação** antes do merge, ative no GitHub
   *Settings → Branches → Branch protection rule* para `main`:
   *Require a pull request before merging* + *Require approvals* +
   *Require status checks to pass* → selecione o check **CI / test-build**
   (definido em `.github/workflows/ci.yml`, que roda `npm test` e `npm run build`
   em todo PR).

Com isso o fluxo fica: **PR → CI verde + aprovação → merge em `main` → deploy de
produção no Vercel**.

> **Autenticação (SSO):** `lib/auth.ts` é um stub pronto para o SSO corporativo
> (lê `x-user-email`). Em produção, plugue o provedor (ex.: Azure AD via
> NextAuth) mantendo a trilha de auditoria já existente.

---

## 🔁 Cobertura de fórmulas, CDs configuráveis e validação precisa

**A base anexada NÃO precisa conter nenhuma coluna de fórmula** da planilha
original. O esquema canônico de entrada está em `lib/data/schema.ts`: o app lê
apenas as **colunas cruas** (ERP/forecast) e **recalcula tudo** que era fórmula.
O mapeamento fórmula → regra do motor está documentado em
`CAMPOS_CALCULADOS` (mesmo arquivo):

| Coluna de fórmula na planilha | Como o app calcula |
|---|---|
| `ID (dep+cod)` | `deposito + '-' + codigo` |
| `EXCESSO EM STK` / `EXCESSOS + PEND` | REGRA 2 |
| `PEDIDOS <mês> CD x` (XLOOKUP) | REGRA 3 — join indexado em pedidos |
| `TRANSF...` / `SOBRA 1/2/3` | REGRA 4 — cascata cumsum-clamp |
| `Valor Transf.` / `Qtd Imediata` / `(cx)` | REGRAS 5–6 |
| `Status Cobertura` / `Impacto fiscal` | REGRAS 7–8 |

**CDs configuráveis (rede de 11 CDs):** origem e destinos não são fixos. Em
*Parâmetros* e no *Simulador* dá para **escolher o CD de origem** e
**adicionar/remover/reordenar** os CDs de destino (com alíquota por rota) —
qualquer quantidade. O motor sempre exclui a origem dos destinos. Os CDs
presentes nas bases são descobertos em `/api/cds`.

**Validação com erro exato (melhoria #3):** a importação aponta precisamente o
problema — nome da **coluna obrigatória ausente** (com os nomes aceitos), e
**linha + coluna + valor** de cada célula inválida (não numérica ou negativa),
além de chaves duplicadas. Nada de erro silencioso.

## 📁 Estrutura

```
app/                    Telas (App Router) + rotas de API
  api/                  status, dashboard, plano, plano/export, params,
                        calc, versions, simular, cenarios, aprovacoes[/ordem],
                        import, importlog
lib/engine/             Motor puro + tipos + testes + totais de referência
lib/data/               Parsing, validação de importação, seed, parâmetros padrão
lib/query/              Filtro/paginação/agregação server-side
lib/store/              Store versionado (memória) + schema.sql (Postgres)
lib/export.ts           CSV/Excel do plano e ordem de transferência
components/              Nav + componentes de UI
```

## 🔭 Evoluções previstas na arquitetura
Múltiplos CDs de origem (origem já é parâmetro), solver de otimização global
como modo avançado (a cascata gulosa é o padrão), custo de frete por rota,
restrições de capacidade e validade (shelf life), e integração direta com o ERP.

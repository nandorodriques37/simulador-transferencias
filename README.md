# Otimização de Transferências entre CDs

Aplicativo web que substitui a planilha Excel usada para planejar transferências
de **excesso de estoque do CD10** para os CDs **1, 9, 2, 8 e 7**, abatendo os
**pedidos de compra projetados (DRP)** dos próximos meses — liberando capital de
giro e mostrando o **impacto fiscal (ICMS)** de cada rota ao lado do benefício.

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

## 🖥️ Telas

1. **Dashboard executivo** — KPIs (excesso, transferido/mês, imediata, fiscal),
   matriz CD × mês, gráficos por CD e evolução mensal, filtro Total vs. >90 dias.
2. **Plano de transferência** — tabela virtualizada com as ~9 mil linhas, busca,
   filtros (CD, categoria, fornecedor, comprador, analista, cobertura),
   exportação **CSV/Excel** (layout da aba `Transferencias_Long`).
3. **Simulador de cenários** — reordena prioridade dos CDs (drag-and-drop),
   alíquotas, fator de segurança e horizonte; compara **base vs. simulado**
   (Δ R$ transferido e Δ fiscal); salva cenários nomeados.
4. **Parâmetros e importação** — upload das bases (CSV/Excel/XLSB) com
   **validação de qualidade** (schema, duplicidade de chave, preços zerados/
   negativos, emb 0, SKUs sem pedido), prévia e log de importações; histórico de
   parâmetros (auditoria).
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

> **Autenticação (SSO):** `lib/auth.ts` é um stub pronto para o SSO corporativo
> (lê `x-user-email`). Em produção, plugue o provedor (ex.: Azure AD via
> NextAuth) mantendo a trilha de auditoria já existente.

---

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

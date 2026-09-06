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
| 2 | **Excesso (origem)** | `MAX(disp + pendente − venda média 3m − objetivo, 0)`. Com *excesso físico* ligado, o pendente sai da conta: só o que já está no CD é oferecido |
| 3 | **Necessidade (destino)** | modo *saldo ideal*: `MAX(objetivo − disp − pendente, 0)`; modo *pedidos*: pedido projetado por (mês × CD) |
| 3b | **Teto e piso de cobertura** | necessidade limitada a `venda_dia × dias − (disp + pendente + trânsito)`. Teto corta demanda inflada; piso garante o mínimo antirruptura. SKU sem giro no destino ignora os dois |
| 4 | **Repartição** | *prioridade estrita* (cascata gulosa) ou *nivelar dias de cobertura* (water-filling: enche primeiro quem está mais descoberto) |
| 5 | **Ordem dos baldes** | modo pedidos: **mês → destino** (mês 1 de todos os destinos antes do mês 2); modo saldo ideal: destino a destino |
| 6 | **Embarque** | opção de **caixa fechada** (múltiplos da embalagem, `ROUNDDOWN`), mínimo por linha (un e R$) e **carga mínima por rota** |
| 7 | **Transferência imediata** | `MIN(transf, disp − venda média × fator)`, **rateada entre os destinos na ordem**, em caixa fechada |
| 8 | **Cobertura** | `(disp + pendente) × 30 / venda média`, na visão do CD de origem |
| 9 | **Impacto fiscal** | `valor transferido × alíquota da ROTA (origem → destino)` |
| 10 | **Capacidade operacional** | cada alocação consome três orçamentos ao mesmo tempo — expedição da origem, recebimento do destino e transporte da rota. O menor é o gargalo |
| 11 | **Materialidade** | só entram no plano rotas × SKU com transferência > 0 |

**Invariantes verificados a cada análise** (`reconciliacao`):
- nenhuma origem envia mais que o próprio excesso;
- nenhum destino recebe mais que a própria necessidade;
- nenhuma auto-transferência (origem = destino).

**Desempenho:** rede de 6 CDs × 20 mil produtos (120 mil linhas de base) em
**menos de 1 s** — teste de performance em `lib/engine/calc.test.ts`.

### Qualidade da sugestão — o que dá para ajustar

Todas essas regras vêm **desligadas por padrão** (o resultado sai igual à regra
crua da base) e ficam na tela *Nova análise*. Cada grupo tem uma **chave geral**
na barra do topo — *Teto/piso de cobertura*, *Caixa fechada e mínimos* e
*Capacidade operacional* — mais um botão **Desligar todas as restrições**.
Desligar não apaga nada: os valores continuam guardados e voltam a valer quando
a chave é religada, o que torna barato comparar o plano com e sem restrição.

| Regra | Para que serve | Sugestão |
|---|---|---|
| **Teto de cobertura (dias)** | Um estoque objetivo inflado — ou 3 meses de pedido — puxa volume demais para um CD e trava capital do outro lado. O teto converte a demanda em dias de venda. | 60–90 dias |
| **Piso de cobertura (dias)** | Objetivo defasado ou zerado esconde uma ruptura real: sem piso, o CD em falta não aparece como destino. | 15–30 dias |
| **Excesso físico** | O pendente ainda não chegou; sugerir a transferência dele gera ordem que o WMS não consegue executar. | ligar quando o plano for executado no curto prazo |
| **Nivelar dias de cobertura** | Na prioridade estrita, o excesso escasso vai todo para o primeiro CD e o último fica em ruptura. O nivelamento reparte pelo giro. | usar quando os destinos têm importância parecida |
| **Caixa fechada** | Transferência quebrada não embarca no WMS. | ligar quando a operação exige caixa fechada |
| **Mínimo por linha / carga mínima por rota** | Cauda longa de 3 unidades e rotas de R$ 200 custam mais em frete e conferência do que o benefício. | mínimo por linha em R$ e carga mínima por rota |

O dashboard mostra a **necessidade bruta → considerada** por destino sempre que
o teto ou o piso mudou o número, e o plano exporta a coluna *não enviado por
caixa fechada*.

### Capacidade operacional — o plano cabe na operação?

Um plano que sugere mais do que a rede consegue mover não é um plano, é uma
lista de desejos. A análise aceita três limites, válidos ao mesmo tempo:

| Limite | O que representa |
|---|---|
| **Expedição por origem** | separação, embalagem e embarque que o CD consegue produzir na janela |
| **Recebimento por destino** | docas, conferência e endereços livres no CD que recebe |
| **Transporte por rota** | frota/viagens disponíveis entre aquele par de CDs |

Cada alocação consome os três — **o menor é o gargalo**. A capacidade é medida
na unidade que faz sentido para a operação, e o motor converte cada unidade
transferida usando dados do próprio SKU:

| Métrica | Fator por unidade | Coluna da base |
|---|---|---|
| Unidades | 1 | — |
| Caixas | 1 / embalagem de compra | `Qt_Emb_Compra` |
| Paletes | 1 / unidades por palete | `unidades_por_palete` |
| Peso (kg) | peso unitário | `peso_unitario` |
| Volume (m³) | cubagem unitária | `cubagem_unitaria` |
| Valor (R$) | preço unitário | custo/preço |

As três últimas colunas são **opcionais** — a validação da importação lista
quais métricas a sua base sustenta. SKU sem o dado da métrica escolhida não
consome capacidade, e o resultado diz quantos ficaram nessa situação.

Dois detalhes que fecham o ciclo:

- **Sugestões aprovadas e não faturadas já ocupam capacidade.** A doca e a frota
  estão comprometidas com elas; a análise seguinte só distribui o que sobra.
- **Com capacidade escassa, a ordem dos SKUs passa a importar.** Você escolhe:
  carregar primeiro o **de maior valor** (maximiza R$ escoado) ou o **mais
  urgente** (menor cobertura no destino, reduz risco de ruptura).

O dashboard traz um painel com limite, comprometido, usado, % de utilização e
quanto ficou barrado em cada ponto — e nomeia o **gargalo da rede**, que é onde
ampliar capacidade libera mais transferência do que remexer prioridades.

```bash
npm test
```

---

## 📄 As duas bases (e a terceira, do faturamento)

A base anexada **não precisa de nenhuma coluna de fórmula**: o app lê só as
colunas cruas e recalcula tudo (mapa em `CAMPOS_CALCULADOS`, `lib/data/schema.ts`).
Os cabeçalhos aceitam variações e formato pt-BR (`1.234,56`); CSV em UTF-8 ou
latin1 é detectado automaticamente.

> **Base grande? Mande CSV.** O CSV é lido em um passe direto (300 mil linhas em
> ~1,6 s, pico de ~270 MB). XLSX e XLSB passam pelo SheetJS, que carrega a
> planilha inteira: as mesmas 300 mil linhas levam ~18 s e passam de 1 GB de
> memória — perto do limite de uma função serverless.

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
| Unidades por palete | `unidadesPorPalete` | — (só para capacidade em paletes) |
| Peso unitário (kg) | `pesoUnitario` | — (só para capacidade em peso) |
| Cubagem unitária (m³) | `cubagemUnitaria` | — (só para capacidade em volume) |

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
   **painel de capacidade com o gargalo da rede**, maiores rotas e detalhe por
   rota (com quebra mensal no modo pedidos).
2. **Nova análise** — upload das duas bases com validação, escolha do modo de
   demanda, **sequência de origens**, **ordem de destinos** (cada CD mostra
   quanto tem de excesso/falta e o que já está comprometido), alíquotas por rota,
   regras de necessidade/materialidade e **capacidade operacional**. Um clique
   roda a análise.
3. **Plano de transferência** — uma linha por rota × SKU, filtros (origem,
   destino, categoria, comprador, cobertura, só imediata), busca, ordenação,
   exportação **CSV/Excel** e **aprovação** (selecionadas ou todas do filtro).
4. **Carteira** — sugestões em aberto e faturadas, cancelamento, **modal de
   importação do faturamento** (com prévia) e geração da **ordem de
   transferência** para ERP/WMS com o saldo em aberto.

---

## 🗄️ O que o app guarda (e o que é descartável)

A decisão de arquitetura é simples: **o app guarda resultado, não base**.

| Camada | O que é | Onde vive | Sobrevive a deploy/instância? |
|---|---|---|---|
| **Carteira** | sugestões aprovadas e baixas por faturamento | Postgres (Neon) | ✅ sempre |
| **Resultado das análises** | parâmetros, KPIs, resumos por rota/origem/destino, o que foi aprovado | Postgres, ou o armazenamento de arquivos quando não há banco | ✅ |
| **Insumo (base + pedidos)** | a planilha normalizada | Armazenamento de arquivos (Vercel Blob), em TSV comprimido | ✅ reconstruído em segundos |
| **Plano linha a linha** | as ~240 mil linhas de rota × SKU | memória da instância | ❌ recalculado em um clique |

O plano detalhado é material de trabalho da sessão: quem opera roda a análise,
filtra e aprova. Se a instância esfria, o **dashboard continua mostrando os KPIs
e os resumos salvos** e a tela do Plano oferece *Recalcular* — mesma base, mesmos
parâmetros, mesmo id de análise, alguns segundos. Nada de subir a planilha de novo.

Por que não persistir o plano inteiro: são ~150 MB por rodada. O que a operação
precisa reter é o que foi **decidido** (a carteira) e o que foi **medido** (os
KPIs) — não o rascunho que levou até lá.

### Upload de arquivo grande

O corpo de uma função serverless no Vercel não passa de **4,5 MB**, e a base real
tem dezenas de MB. Com `BLOB_READ_WRITE_TOKEN` configurado, a tela envia o
arquivo **direto do navegador para o Vercel Blob** e a importação recebe só a
URL — o arquivo nunca atravessa a função. Sem o token, o app cai no upload
tradicional (que funciona local e para arquivos pequenos) e a tela avisa qual
caminho está ativo.

Números medidos com 300 mil linhas (CSV de 54 MB): importação em ~4 s, e o
insumo normalizado ocupa **2,1 MB** no armazenamento.

## 🚀 Deploy no Vercel

```bash
npm install
npm run dev        # http://localhost:3000
```

1. Importe o repositório no Vercel (framework **Next.js** detectado
   automaticamente; `vercel.json` ajusta o timeout das rotas pesadas).
2. **Banco (Vercel Neon / Postgres):** crie um banco Neon no painel do Vercel e
   conecte ao projeto — `POSTGRES_URL` (ou `DATABASE_URL`) é injetada
   automaticamente. Opcionalmente aplique o esquema completo:

   ```bash
   npm run seed:pg
   ```

   Guarda a **carteira** (`sugestao_transferencia`, `faturamento_evento`) e o
   **resultado das análises** (`analise_resultado`) — as tabelas são criadas sob
   demanda.

3. **Armazenamento de arquivos (Vercel Blob):** crie um Blob store e conecte ao
   projeto; `BLOB_READ_WRITE_TOKEN` é injetada automaticamente. É o que
   habilita o **upload direto** (arquivos acima de 4,5 MB) e o que faz o insumo
   sobreviver à troca de instância. Sem ele, o app grava em `.data/` no disco
   local — bom para desenvolvimento, efêmero no serverless.

   Sem banco **e** sem Blob, tudo roda em memória: útil para avaliar, mas a tela
   sinaliza o estado e nada sobrevive a um novo deploy.

   **Variáveis de ambiente**

   | Variável | Para quê |
   |---|---|
   | `POSTGRES_URL` / `DATABASE_URL` | carteira e resultados das análises |
   | `BLOB_READ_WRITE_TOKEN` | upload direto e insumo durável |
   | `DADOS_DIR` | pasta local do armazenamento em disco (padrão `.data`) |
   | `DEMO_DATA` | `1` força a base de exemplo; `0` desliga em qualquer ambiente |

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
lib/store/             Estado da instância, carteira, resultados das análises,
                       repositório do insumo e armazenamento (Blob/disco)
lib/export.ts          CSV/Excel do plano e ordem de transferência
components/            Nav, UI e o seletor ordenado de CDs
```

## ⚠️ Limites conhecidos do modelo

Explícitos de propósito — o motor é guloso e determinístico, não um otimizador:

1. **Sem custo de frete nem distância.** A decisão pesa benefício e ICMS; uma
   rota longa e barata em imposto pode não compensar. Hoje isso é compensado na
   mão pela ordem dos destinos e pela carga mínima por rota.
2. **Sem validade (shelf life).** Nada impede mandar um lote perto do vencimento
   para um CD de giro baixo. A base ainda não traz a data.
3. **Lead time não entra na conta.** A coluna existe na base, mas o motor não usa
   para decidir a partir de qual mês a transferência atende — no modo pedidos, o
   trânsito abate sempre o mês mais próximo.
4. **Guloso por produto, não ótimo global.** Cada SKU é resolvido isoladamente,
   sem consolidar carga por rota nem trocar volume entre SKUs para fechar um
   caminhão.
5. **Capacidade é um teto, não uma agenda.** Os limites valem para a janela
   inteira da análise: o motor não distribui a carga ao longo dos dias nem
   respeita janelas de recebimento por dia da semana.
6. **Um preço por SKU/origem.** A necessidade em R$ é valorizada pelo preço da
   primeira origem com custo — se os CDs têm custos muito diferentes, o KPI de
   necessidade fica aproximado (o plano, não: cada linha usa o preço da origem).
7. **Venda média tratada como mensal.** `venda_media_3m` é lida como média
   mensal dos 3 meses. Se a base trouxer a soma do trimestre, o excesso e a
   cobertura saem distorcidos — divida por 3 antes de importar.

## 🔭 Próximos passos previstos

Frete por rota e consolidação
de carga, validade (shelf life) e lead time no horizonte, capacidade por janela
diária, solver de otimização global como modo avançado (a cascata gulosa segue
como padrão) e integração direta com o ERP para dispensar a importação manual
do faturamento.

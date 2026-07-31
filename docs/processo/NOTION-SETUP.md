# Notion — como montar, em 10 minutos

Este documento é um roteiro para o Gabriel executar à mão. **Nada aqui foi criado por
automação** — não há integração do Notion autenticada neste repositório, e inventar que
existe seria pior do que não ter.

O Notion aqui é a camada de **produto e conhecimento**. Ele não executa trabalho.

---

## A regra de fronteira

> **Task nova nasce como issue no GitHub. Notion nunca recebe task. Se você está prestes a
> criar um cartão no Notion, ele é uma ideia — vai em Ideias e descobertas.**

Esta frase está escrita com as mesmas palavras aqui e no [`KANBAN.md`](KANBAN.md). **Cole-a
no topo da página raiz do Notion**, como texto de callout. É a única coisa que impede as duas
camadas de virarem trabalho dobrado.

| Fica no GitHub | Fica no Notion |
| --- | --- |
| Toda task, sem exceção | Roadmap em visão de linha do tempo |
| Quem está fazendo o quê, agora | Ideias que ainda não são task |
| Critério de aceite e evidência | Índice dos ADRs (que vivem no repo) |
| Bloqueios entre tasks | Notas de planejamento e retro |
| Estado do trabalho (as 6 colunas) | Métricas acompanhadas ao longo do tempo |
| Ligação issue ↔ branch ↔ PR ↔ commit | Contexto de produto e de negócio |

---

## 1. Estrutura de páginas

Crie exatamente esta árvore. Nada além dela — o que não tiver dono e uso semanal vira página
morta em duas semanas.

```text
IKCOUS Marketplace
├── 📍 Comece por aqui        (links para os docs de onboarding do repo)
├── 🗺️ Roadmap                (as 4 ondas do ROADMAP.md, visão de timeline)
├── 💡 Ideias e descobertas   (o que ainda não é task)
├── 🧠 Decisões               (índice dos ADRs, que vivem no repo)
├── 📝 Notas de ciclo         (planejamento e retro semanais)
└── 📊 Métricas               (o que acompanhar)
```

O que vai em cada uma:

- **📍 Comece por aqui** — só links, sem conteúdo próprio. Aponta para `docs/onboarding/01`
  a `06`, para o `CONTRIBUTING.md` e para o [board](https://github.com/users/BielWeed/projects/1).
  Se alguém precisar de contexto, começa aqui e sai do Notion em um clique.
- **🗺️ Roadmap** — as 4 ondas do ⧗ `docs/backlog/ROADMAP.md` como linha do tempo: Onda 0
  (parar o sangramento), Onda 1 (confiança), Onda 2 (fechar o produto), Onda 3 (polimento).
  Objetivo e critério de saída de cada uma, copiados de lá. **Sem tasks** — a task está no
  GitHub.
- **💡 Ideias e descobertas** — o depósito. Tudo que não passa na Definition of Ready mora
  aqui até passar. Quando passar, vira issue no GitHub e **sai daqui**.
- **🧠 Decisões** — índice: número, título, estado e link para o arquivo em `docs/decisoes/`
  no repositório. O ADR em si **não** é escrito no Notion: ele é versionado junto do código
  que ele explica.
- **📝 Notas de ciclo** — uma página por semana, com o template abaixo.
- **📊 Métricas** — ver a seção 4.

---

## 2. Importar o backlog como database somente-leitura

**Esta database é um retrato. Ela não recebe estado, não recebe task nova e não é atualizada
à mão. A execução acontece no GitHub.**

Escreva a frase acima, em negrito, no topo da própria database. Sem ela, em três semanas
alguém vai marcar uma task como feita ali e ninguém no GitHub vai saber.

Passo a passo:

1. No Notion, na página **IKCOUS Marketplace**, use `/database` → **Database - Full page**.
   Nome: `Backlog (retrato de 30/07/2026)`.
2. Menu `⋯` → **Merge with CSV** → escolha ⧗ `docs/backlog/backlog.csv` do repositório.
3. O arquivo já está em **UTF-8 com BOM**, que é o que o Notion precisa para não quebrar
   acentuação. Se aparecer `Ã§` no lugar de `ç`, o arquivo foi reencodado no caminho — pegue
   de novo direto do repositório.
4. Confira que vieram **111 linhas** e **13 colunas**:
   `ID · Titulo · Tipo · Prioridade · Tamanho · Epico · Area · Risco · Contexto ·
   CriterioAceite · Arquivos · DependeDe · BomParaIniciante`.
5. Ajuste os tipos de coluna: `Tipo`, `Prioridade`, `Tamanho` e `Area` como **Select**;
   o resto como **Text**. O Notion importa tudo como texto.
6. Crie uma visão agrupada por `Epico` e outra agrupada por `Prioridade`. São as duas leituras
   que o CSV serve bem e o board do GitHub não dá de graça.
7. **Trave a página** (`⋯` → **Lock database**). É o que transforma a intenção em barreira.

Quando o backlog mudar de verdade — e ele vai —, **não conserte esta database**. Ela é de
30/07/2026 e continua sendo. Se precisar de um retrato novo, importe outro CSV e renomeie a
data.

---

## 3. Template de nota de ciclo

Uma página por semana, dentro de **📝 Notas de ciclo**. Título: `Ciclo AAAA-MM-DD`.
Transforme em template do Notion (`⋯` → **Turn into template**) para não copiar à mão.

```markdown
# Ciclo <data da segunda>

## Planejamento — segunda, 30 min

**Ficou aberto do ciclo passado:**
-

**Tem P0? Tem cartão bloqueando o outro? Tem decisão travando trilha?**
-

**Cartões escolhidos** (só os IDs — o detalhe está no board):

| Cartão | Quem | Por que este |
| --- | --- | --- |
|  |  |  |

**Dono por ciclo dos arquivos de conflito:**

| Arquivo | Dono nesta semana |
| --- | --- |
| src/contexts/StoreContext.tsx |  |
| src/contexts/CartContext.tsx |  |
| src/hooks/useOrders.ts |  |
| src/views/customer/CheckoutView.tsx |  |
| src/lib/mappers.ts |  |
| vite.config.ts |  |

---

## Fechamento e retro — sexta, 20 min

**Cartões fechados nesta semana:** <número>

**O combinado da semana passada aconteceu?** sim / não — por quê:

**O que atrapalhou** (um de cada):
- Gabriel:
- Netim:

**O que funcionou e vale repetir** (um de cada):
- Gabriel:
- Netim:

**O combinado desta semana** (um só):
-
```

---

## 4. Métricas — o que acompanhar

Poucas, e todas obtíveis sem trabalho manual. Métrica que exige alguém preencher planilha
morre no segundo mês.

| Métrica | De onde sai | Para quê |
| --- | --- | --- |
| Cartões fechados por semana | Contagem da retro de sexta | É a **única** medida de ritmo que a dupla tem. Sem 4 semanas dela, toda estimativa do ROADMAP é chute |
| Cartões abertos por prioridade | Visão `Por prioridade` do board | Ver se os P0 e P1 estão de fato à frente |
| Tamanho da fila de decisões | Visão `Fila de decisões` do board | Se não cair, o gargalo de conhecimento não se moveu |
| Tempo médio de PR aberto | `gh pr list --state merged --json createdAt,mergedAt` | O prazo combinado é 48h. Passar disso é o modo de falha nº 1 de dupla assíncrona |
| Os 4 números da catraca de lint | `.lint-baseline.json` | Dívida só pode descer |

Anote uma linha por semana. Cinco números, cinco minutos.

---

## 5. Template de ADR

**O ADR em si vive no repositório**, em `docs/decisoes/`, com o template
[`0000-template.md`](../decisoes/0000-template.md). O Notion guarda só o **índice**, para
quem está pensando em produto conseguir achar a decisão sem abrir o repo.

Estrutura da página **🧠 Decisões** — uma database simples:

| Coluna | Tipo | Conteúdo |
| --- | --- | --- |
| Número | Text | `0001`, `0002`, … |
| Título | Text | O mesmo do arquivo |
| Estado | Select | Proposta · Aceito · Substituído · Recusado |
| Data | Date | |
| Cartão | Text | O ID do backlog que originou (ex.: `CHECKOUT-010`) |
| Link | URL | Para o arquivo no GitHub |

**Não escreva o corpo da decisão aqui.** Se o ADR existir em dois lugares, um dos dois vai
ficar velho, e vai ser o que alguém ler.

Para começar: os **20 cartões `tipo:decisao`** do backlog são a fila inicial, e a visão
`Fila de decisões` do board já mostra todos. A ordem de ataque está em
[`docs/decisoes/README.md`](../decisoes/README.md).

---

## O que fazer se isto virar trabalho dobrado

Se em um mês vocês perceberem que estão atualizando a mesma coisa nos dois lugares, **corte o
Notion**. Uma camada só, bem usada, vale mais que duas meio usadas — e a camada que não pode
ser cortada é o GitHub, porque é lá que a issue conversa com a branch, o PR e o commit.

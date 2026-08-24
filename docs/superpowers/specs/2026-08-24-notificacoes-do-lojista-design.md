# Notificações do lojista — tela de avisos do painel

**Data:** 24/08/2026
**Pedido do Gabriel:** *"essa tela nao existe, crie uma tela de notificaçao para o
logista(admin), mas somente notificaçao, e nao notificar clientes, entende?"* — com print
apontando a seta para o **sino da barra superior do painel**.

## O problema, e por que os consertos de hoje não o resolveram

O sino do painel nunca teve destino próprio. `AdminLayout.tsx:400`:

```
pendingOrdersCount > 0  -> "admin-orders"
pendingQuestionsCount > 0 -> "admin-qa"
senão                    -> "admin-push"   (a tela de DISPARAR push aos clientes)
```

Três destinos, nenhum deles um mural de avisos do lojista. Foi essa ambiguidade que gerou o
relato anterior de "a tela de notificações está duplicada": as duas portas que ele viu levavam
à tela de **enviar** aviso para cliente, que ele leu — corretamente — como a tela errada.

**Consequência para o nome:** hoje `admin-push` se chama "Notificações" no cabeçalho
(`AdminArea.tsx:167`). Duas coisas opostas com o mesmo nome é a causa raiz, não um detalhe
estético.

## O que a tela é

Uma lista do que **precisa da atenção do lojista agora**, derivada dos dados que já existem.
Tocar num aviso leva ao item.

**Decisão do Gabriel, que define tudo o resto:** *o aviso some quando você resolve.* A tela é
"o que falta fazer", não um histórico. Consequência direta e desejada: **nenhuma tabela nova,
nenhuma migration, nenhum gatilho.** Nada para limpar depois, nada que possa gravar errado.

### As quatro fontes

| aviso | "precisa de você" | some quando | fonte |
|---|---|---|---|
| Pedido | `status IN ('pending','new','processing')` | despacha/conclui | `marketplace_orders`, com a constante `STATUS_PEDIDOS_COM_ACAO_PENDENTE` que já existe |
| Pergunta | filtro `pending` | responde | RPC `get_admin_questions_paged` (já usada pelo crachá) |
| Avaliação | `merchant_reply IS NULL` | responde | `reviews` |
| Estoque baixo | `estoque efetivo <= COALESCE(estoque_minimo, 5)` | repõe | `produtos` + `product_variants` via `useProducts` |

**O limiar de estoque não se inventa.** O projeto já tem a regra, e ela é por produto:
`estoque_minimo` com padrão 5, escrita em
`supabase/migrations/20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql`. Um limiar fixo de
3 no front (o palpite inicial) faria a tela discordar do KPI "Estoque Baixo" que o painel já
mostra — dois números sobre a mesma coisa, e o lojista sem saber em qual acreditar.

**O estoque efetivo também não se inventa.** `mapProductFromDB` (`src/lib/mappers.ts:96-107`)
já aplica a regra que a loja inteira usa: soma dos `stock_increment` das variantes **ativas**
se houver ao menos uma, senão a coluna `estoque`. Ler `produtos.estoque` cru é o defeito que a
migration de 02/09 corrigiu nos KPIs — não reintroduzir.

### A bolinha vermelha conta três dos quatro

Pedido, pergunta e avaliação contam. **Estoque baixo não.**

Motivo: os três primeiros são coisas que *outra pessoa fez e está esperando resposta* — têm
fim natural. Estoque baixo só termina se o lojista repuser; se ele decidir não repor, o aviso
fica para sempre e a bolinha nunca zera. Bolinha que nunca zera é bolinha que se para de olhar,
e aí ela deixa de avisar também os três que importam.

Estoque baixo aparece numa faixa própria, "De olho", sem contar para o crachá.

### Para onde cada aviso leva

| aviso | destino |
|---|---|
| Pedido | `onNavigate("admin-orders", pedido.id)` — abre **aquele** pedido; `admin-orders` já está na lista de views que aceitam id em `App.tsx:905-917` |
| Estoque | `onNavigate("admin-product-form", produto.id)` — abre **aquele** produto; também já aceita id |
| Pergunta | `onNavigate("admin-qa")` — abre a tela de perguntas |
| Avaliação | `onNavigate("admin-reviews")` — abre a tela de avaliações |

Pergunta e avaliação levam à tela, não ao item: `admin-qa` e `admin-reviews` não estão na
lista de views que aceitam id, e acrescentá-las exigiria mexer em `App.tsx` — arquivo de 2000+
linhas com máquina de navegação (`pushState`, popstate, trava de transição) que já produziu
defeito neste repositório. O ganho não paga o risco agora.

## Arquitetura

Três peças, cada uma testável sozinha.

### 1. `src/utils/avisos-do-lojista.ts` — a regra, pura

Sem React, sem Supabase. Recebe os dados já buscados e devolve a lista de avisos.

```ts
export type TipoDeAviso = "pedido" | "pergunta" | "avaliacao" | "estoque";

export interface Aviso {
  id: string;              // `${tipo}:${idDaOrigem}` — chave estável de lista
  tipo: TipoDeAviso;
  titulo: string;          // "Pedido #C09E68 esperando você despachar"
  detalhe: string;         // "Maria Silva · R$ 22,90"
  quando: string;          // ISO do created_at da origem
  destino: { view: View; id?: string };
  contaNoCracha: boolean;  // false só para "estoque"
}

export function montarAvisos(entrada: EntradaDeAvisos): Aviso[];
export function precisaDeReposicao(estoque: number, estoqueMinimo: number | null): boolean;
```

`montarAvisos` ordena por urgência: pedido, pergunta, avaliação, estoque; dentro de cada tipo,
mais recente primeiro. `precisaDeReposicao` é a regra do limiar isolada — `estoque <=
(estoqueMinimo ?? 5)` — para ficar sob teste de valor, não só de presença.

### 2. `src/hooks/useAvisosDoLojista.ts` — a busca

Faz as quatro consultas em paralelo e chama `montarAvisos`. Devolve
`{ avisos, quantidadeNoCracha, carregando, erro, recarregar }`.

Falha parcial não derruba a tela: se uma das quatro consultas falhar, as outras três aparecem
e a tela mostra uma linha dizendo qual parte não carregou. Uma tela de avisos que fica em
branco por causa de uma consulta é pior que uma tela incompleta e honesta.

Sem realtime nesta versão: recarrega ao montar e num botão de atualizar. O painel já tem
realtime no `AdminLayout` para os crachás, e duplicar assinatura ali (leader election,
`BroadcastChannel`) é onde o risco mora.

### 3. `src/views/admin/AdminNotificationsView.tsx` — a tela

Só desenha. Recebe do hook, agrupa por tipo, e renderiza linhas clicáveis. Segue o padrão
visual dos cartões do painel (bordas `white/5`, fundo `zinc-950/40`, `rounded-2xl`).

Estado vazio: "Nada esperando por você" — e é um estado bom, não um erro.

### Ligações no que já existe

| arquivo | mudança |
|---|---|
| `src/types/index.ts` | nova view `"admin-notifications"`; campo `estoqueMinimo?: number \| null` em `Product` |
| `src/lib/mappers.ts` | `mapProductFromDB` passa a mapear `estoque_minimo` (o `select("*")` de `useProducts` já o traz do banco) |
| `src/App.tsx` | **apenas** o registro da view nova: o `lazyWithPreload`, a entrada no mapa de views e o `case` que a renderiza. Nada de `pushState`, popstate, trava de transição ou a lista de views que aceitam `?id=` |
| `src/components/layouts/AdminArea.tsx` | montar a tela nova; título "Notificações"; **renomear o título de `admin-push` para "Avisar clientes"** |
| `src/components/layouts/AdminLayout.tsx` | `notificationBellTarget` vira a constante `"admin-notifications"` (some a escada de três destinos); somar `pendingReviewsCount` ao crachá, no mesmo padrão do `pendingQuestionsCount`, **sem tocar no realtime nem no leader election** |
| `src/utils/pai-da-tela-do-admin.ts` | **nenhuma mudança de código.** O `default` do switch já devolve `"profile"`, que é o certo para uma tela de topo. O que entra é um *caso de teste* prendendo isso, para que ninguém a transforme em subtela sem perceber |
| `src/views/admin/AdminSettingsView.tsx` | o cartão criado hoje passa a se chamar **"Avisar clientes"** |

## Testes

Vitest, em `tests/front/`, no padrão da casa (`createRoot` + `act`, sem testing-library).

1. **`avisos-do-lojista.test.ts`** — a regra pura. Cada tipo vira aviso com o destino certo;
   ordem por urgência e por data; `contaNoCracha` é false só para estoque; `quantidadeNoCracha`
   bate com o número de avisos que contam (contagem, não presença); o limiar respeita
   `estoque_minimo` por produto e cai em 5 quando é nulo — com os casos vizinhos do limiar
   (igual, um a menos, um a mais), porque guarda de limiar quase nunca é binária.
2. **`admin-notifications-view.test.tsx`** — a tela. Renderiza uma lista com os quatro tipos;
   clicar num aviso de pedido chama `onNavigate("admin-orders", <id daquele pedido>)`; estado
   vazio aparece quando não há avisos; falha de uma fonte não apaga as outras.
3. **`sino-do-painel-leva-as-notificacoes.test.tsx`** — o sino leva a `admin-notifications`
   **com e sem** pendência. Já existe `sino-do-painel-leva-onde-o-alerta-aponta.test.tsx`
   prendendo o comportamento ANTIGO: esse teste é substituído, e a substituição é deliberada,
   não um teste apagado por incômodo.

Cada suíte é vista falhar antes da implementação. Mutação obrigatória na regra pura: trocar
`<=` por `<` no limiar tem de matar um caso; devolver `contaNoCracha: true` para estoque tem
de matar outro.

## O que fica de fora, de propósito

- **Histórico e "marcar como lido"** — decisão do Gabriel: o aviso some quando resolve.
- **Push no celular do lojista quando chega pedido** — não foi pedido; exige permissão de
  notificação e assinatura própria do aparelho dele.
- **Realtime na tela** — os crachás já têm; a tela recarrega ao abrir.
- **Abrir a pergunta ou a avaliação específica** — exigiria mexer no `App.tsx`.
- **Qualquer alteração no `admin-push`** além do nome. Ele continua fazendo o que faz.

## Riscos

| risco | mitigação |
|---|---|
| Mexer em `AdminLayout` de novo (3ª vez hoje) | Só a constante do sino e uma consulta a mais no `fetchInitialCounts`. Nada de realtime, nada de leader election. |
| `estoqueMinimo` novo em `Product` | Aditivo e opcional; nenhum consumidor existente lê. |
| A tela discordar do KPI "Estoque Baixo" | Mesma regra, mesma fonte, mesmo limiar — e o teste prende o valor. |
| Renomear `admin-push` confundir quem já usava | O nome antigo é justamente a causa do pedido. A tela e o caminho continuam iguais. |

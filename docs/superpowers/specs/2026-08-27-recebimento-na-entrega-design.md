# O lojista registra o pagamento que recebeu na mão — e a receita para de mentir

**Data:** 27/08/2026
**Decisor:** Gabriel
**Origem:** item 1 do caminho aprovado em 27/08/2026, depois de laudo do `socio`
**Status:** spec aprovada, aguardando plano

---

## O problema, medido

O painel diz que a loja recebeu **R$ 2.977,09**. Entraram **R$ 4,00**.

A diferença não é arredondamento: são 53 pedidos que o cliente escolheu pagar **na entrega**
(PIX, cartão ou dinheiro na mão) e que ninguém nunca marcou como recebidos — porque **não
existe como marcar**.

Duas causas, as duas medidas em 27/08/2026 no banco vivo:

**1. A regra de receita trata "ninguém confirmou" como "pago".** A expressão

```sql
payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar')
```

aparece **12 vezes em 3 funções**, e `payment_status IS NULL` é exatamente todo pedido na
entrega:

| função | ocorrências | o que ela alimenta |
|---|---:|---|
| `get_admin_analytics_v2` | 9 | Receita Hoje, receita de ontem, do mês, do mês anterior, histórico e ticket médio |
| `get_admin_customers_paged` | 2 | quanto cada cliente já gastou (LTV), e o LTV global |
| `get_segmented_push_targets` | 1 | a mira de notificação por "cliente que já gastou X" |

A ocorrência de `get_admin_customers_paged:44` é especialmente clara: o comentário logo acima
diz *"LTV global: mesma correção do achado 17, dinheiro reconhecido só"* — e a linha abaixo
inclui o dinheiro **não** reconhecido. O comentário descreve a intenção; o código faz o
contrário.

**2. Não existe caminho pela tela para o lojista confirmar recebimento.** A função
`confirmar_pagamento` tem `GRANT` apenas para `postgres` e `service_role` — ou seja, só o
webhook do Mercado Pago consegue chamá-la. O lojista autenticado, não.

### O vocabulário, conferido no código e no banco

`PaymentMethod` (`src/types/index.ts:128`) é `"pix" | "card" | "cash" | "online"`. **`online`
é o pagamento pelo site** (Mercado Pago); **`pix`, `card` e `cash` são as três formas na
entrega.**

Distribuição real no banco em 27/08/2026:

```
(NULO)            | pix     | 52      expirado | online | 14
(NULO)            | card    |  1      expirado | pix    | 13
pago              | online  |  3      pago_apos_expirar | online | 1
```

Os 13 `pix` com status `expirado` são de março a julho e **nenhum tem `gateway_payment_id`** —
expiraram pela reserva do próprio app, não pelo gateway. `cash` nunca apareceu porque ninguém
escolheu dinheiro neste banco.

`payment_status` **não é enum** — é texto livre. Não há guarda no banco contra valor inválido.

---

## As decisões

### 1. "Receita Hoje" passa a contar só o dinheiro que entrou

Decidido pelo Gabriel. O número conta pedido pago pelo site **ou** pedido na entrega que o
lojista marcou como recebido. Pedido na entrega ainda não cobrado não entra.

**Descartado:** mostrar "vendido" e "recebido" lado a lado, e manter "vendido" com a cobrança
em lista separada. Os dois são desenhos válidos; ele escolheu o número único e honesto.

### 2. Valor novo `recebido_na_entrega`, separado de `pago`

`payment_status` ganha um quarto valor: **`recebido_na_entrega`**.

**Por que não reaproveitar `pago`:** são duas verdades de naturezas diferentes. `pago` é o
gateway confirmando; `recebido_na_entrega` é o lojista afirmando. No dia em que um número não
bater, essa distinção é a primeira coisa que se olha — e se as duas estiverem no mesmo rótulo,
não há como separá-las depois.

### 3. Dá para desmarcar, com registro

Decidido pelo Gabriel. Marcar por engano é erro de dedo, e o conserto não pode depender de
alguém mexer no banco — inclusive porque **"zero vezes em que você precisou mexer no banco" é
um dos quatro portões** que liberam a venda para o primeiro lojista.

Cada marca e cada desmarca vira uma linha de histórico: quando, quem, e o que mudou.

### 4. O histórico de pagamento vai em lista própria

**Não** na `marketplace_order_history`, que existe (52 linhas) mas guarda `old_status` /
`new_status` do **pedido** — sair para entrega, entregue. Natureza diferente.

Usar uma lista só para duas perguntas diferentes já mordeu este repositório **duas vezes**, e
na segunda apagou estoque em silêncio.

### 5. As três funções entram no mesmo trabalho

Consertar só o painel deixaria a loja se contradizendo: o financeiro diria R$ 4,00 e a ficha
do cliente continuaria dizendo que ele gastou milhares. **Meia correção some com o sintoma que
faria alguém desconfiar.**

### 6. Marcar é possível em qualquer momento, não só depois de entregue

Decisão técnica, com cara de produto. Na prática o cliente às vezes manda o PIX antes de o
pedido sair. Travar por status criaria o caso em que o dinheiro entrou e o app não deixa
registrar.

A única trava: **pedido cancelado não pode ser marcado como recebido.**

---

## O que NÃO entra (YAGNI, e é deliberado)

- **Valor e forma de cada recebimento em separado** — permitiria pagamento parcial e o cliente
  que ia pagar em dinheiro e pagou PIX na hora. Dobra o tamanho. Ninguém pediu.
- **Pagamento parcial.**
- **Retro-marcar os 53 pedidos históricos.** Nenhum daquele dinheiro existiu: o único e-mail no
  banco é `test@test.com`. Eles simplesmente saem da conta.
- **`orders_count` e `last_order_date` do cliente.** Contam qualquer pedido não cancelado de
  propósito, e o comentário do código diz isso. "Quantas vezes comprou" não é "quanto pagou".
- **Estorno pelo app.** É o item 5 do caminho aprovado, não este.

---

## Arquitetura

### Banco

Uma migration, faixa `20261020000000`, com o `rollback-manual-` par dela.

**a) Duas colunas de carimbo em `marketplace_orders`:**

| coluna | tipo | significado |
|---|---|---|
| `pagamento_recebido_em` | `timestamptz` | quando o lojista confirmou. `NULL` = não confirmado |
| `pagamento_recebido_por` | `uuid` | qual admin confirmou |

**b) Uma tabela de histórico de pagamento**, com RLS: só admin lê e ninguém escreve direto —
só a RPC escreve (`SECURITY DEFINER`).

Colunas: `id`, `order_id`, `acao` (`recebido` / `desfeito`), `payment_status_antes`,
`payment_status_depois`, `created_by`, `created_at`.

**c) Uma RPC `registrar_pagamento_recebido(p_order_id uuid, p_recebido boolean)`**,
`SECURITY DEFINER`, com `GRANT` para `authenticated` e guarda `is_admin()` no corpo — o mesmo
formato de `confirmar_retorno_do_produto`, que subiu hoje e está funcionando.

Ela recusa, com mensagem em português: quem não é admin; pedido inexistente; pedido cancelado;
marcar o que já está marcado; desmarcar o que não está; e **marcar pedido cujo
`payment_method` é `online`** — nesse caminho quem responde é o gateway, não a loja.

**d) A regra de receita, nas 3 funções.** `payment_status IS NULL OR payment_status IN (...)`
passa a `payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')` — o `IS NULL`
sai. São 12 pontos, e **cada um é conferido individualmente**, não trocado em massa.

⚠️ Migration **sem** `BEGIN`/`COMMIT`: com eles o `ROLLBACK` da prova vira no-op e a mudança
grava mesmo assim.

⚠️ A entrada em `VERIFICACOES` (`scripts/db-apply.cjs`) é **obrigatória**. Sem ela o
`db-apply` devolve `PULADA` com saída 2 — que não é sucesso nem falha, é "ninguém conferiu".

### Front

- `src/hooks/useOrders.ts`: uma função que chama a RPC, com atualização otimista e desfazer em
  caso de erro — mesmo padrão do `confirmarRetornoDoProduto`.
- `src/lib/mappers.ts`: os dois campos novos no objeto do pedido.
- `src/views/admin/AdminOrdersView.tsx`: o botão no cartão do pedido. Aparece só quando o
  `payment_method` não é `online` e o pedido não está cancelado. Depois de marcado, mostra
  quando foi e oferece desfazer.

---

## O que o Gabriel vai ver mudar

**A "Receita Hoje" e o histórico de receita vão despencar** — de R$ 2.977,09 para cerca de
R$ 4,00. **O app não quebrou: ele parou de mentir.** Aqueles quase três mil reais nunca
entraram em conta nenhuma.

O mesmo vale para o quanto cada cliente "já gastou", na ficha do cliente.

---

## Como isto é provado

**Camada 1 — CI, sem banco (Deno, `tests/`).** Prova de forma da migration, seguindo o padrão
de `tests/migration_vitrine_sabe_que_produto_mudou_test.ts`: nenhuma transação escondida
(reusando `avaliarFase0` de `scripts/db-prove-rollback.cjs`), o rollback derruba tudo que a
migration cria, e a entrada em `VERIFICACOES` nomeia as funções certas. **Nenhuma das sete
verificações do CI olha SQL** — esta camada é a única rede.

**Camada 2 — CI, tela (Vitest, `tests/front/`).** O botão aparece só em pedido na entrega e
não cancelado; some em pedido `online`; depois de marcar aparece o desfazer; o cartão de
receita mostra o número certo.

**Camada 3 — medição no banco real, fora do CI, feita pela sessão principal.** Tudo dentro de
`BEGIN … ROLLBACK`, com `SAVEPOINT` por chamada que deve falhar (o primeiro erro aborta a
transação e os seguintes viram falso "barrado"):

1. admin marca → `payment_status` vira `recebido_na_entrega`, carimbo gravado, e a receita
   **sobe exatamente o `total` daquele pedido**. ⚠️ O pedido usado no teste tem de ter
   `created_at` **dentro da janela que está sendo medida** — "Receita Hoje" só enxerga
   `created_at >= date_trunc('day', now())`. Testar com um pedido antigo dá diferença **zero**
   e parece que a marcação não funcionou, quando o defeito é do teste;
2. admin desmarca → volta, a receita **desce de volta ao valor de antes**, e o histórico tem
   **duas** linhas (`recebido` e `desfeito`), nessa ordem;
3. **controle negativo:** não-admin é recusado — e o privilégio do sujeito é **assertado antes**
   de interpretar o resultado, porque a guarda mora dentro de `IF NOT is_admin` e o dono da
   maioria dos pedidos deste banco É admin;
4. pedido `online` é recusado;
5. pedido cancelado é recusado;
6. o `ROLLBACK` valeu: a população de pedidos por status fica idêntica à de antes.

**Mutação obrigatória:** apagar a linha que exclui o `IS NULL` e ver o teste da receita cair.
Verde não prova nada até a implementação ser apagada e o teste falhar.

---

## Riscos

| risco | o que fazemos |
|---|---|
| `payment_status` é texto livre — nada impede valor inválido | a RPC é o único caminho de escrita, e ela só grava os dois valores previstos |
| Trocar 12 pontos em massa e acertar o alvo errado | cada ponto é lido e decidido individualmente; `orders_count` e `last_order_date` ficam fora por decisão escrita |
| A queda da receita ser lida como defeito | está escrito aqui, e vai no corpo do PR e no CHANGELOG |
| Migration aplicada antes de a tela subir | a tela vai a produção **antes** do banco. Tela nova com banco velho funciona; banco novo com tela velha é que quebra — foi o erro cometido hoje na migration do estorno |

---

## Referências

- Decisão de rumo: `~/.claude/memoria/portao-dos-30-pedidos-antes-do-primeiro-lojista.md`
- Padrão de RPC com guarda de admin: `confirmar_retorno_do_produto`, migration
  `20260970000000_cancelamento_respeita_o_envio.sql`
- Padrão de teste de migration: `tests/migration_vitrine_sabe_que_produto_mudou_test.ts`

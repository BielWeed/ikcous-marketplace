# Cobrança no site com Mercado Pago — desenho

**Data:** 06/08/2026 · **Issues:** `CHECKOUT-010` #109, `CHECKOUT-040` #110
**Decisor:** Gabriel · **Status:** desenho aprovado, pronto para virar plano

---

## O problema, medido

Hoje o checkout **não cobra nada**. Os três botões de método de pagamento
(`"pix" | "card" | "cash"`) são rótulos de texto: o valor escolhido é gravado no
pedido e nada mais acontece. Não há gateway no projeto — busca por
`mercadopago|stripe|pagseguro|asaas|pagarme|cielo|getnet|iugu|paypal|payment_intent`
em `src/`, `supabase/` e `package.json` não retorna nada.

A tela de sucesso com confete aparece no instante em que a linha do pedido é
gravada, e **o estoque é decrementado ali**, sem pagamento nenhum.

### O custo disso, em números de 06/08/2026

| | |
| --- | ---: |
| pedidos parados em `pending` | **15** |
| unidades de estoque presas neles | **37** |
| **estoque total do catálogo vivo** | **28** unidades / 18 produtos |
| pedido pendente mais antigo | **15/03/2026** |
| valor parado | ~R$ 1.782 |

**Há mais estoque travado em pedidos não confirmados do que existe no catálogo
inteiro.** A loja vem vendendo o próprio inventário para pedidos que ninguém sabe
se foram pagos, desde março.

### O que os dados dizem sobre a operação

- **63 dos 64 pedidos são PIX.** Um é cartão, nenhum é dinheiro.
- **As 44 cancelações são de 08/02 a 09/03** — o primeiro mês do projeto. **Zero
  nos cinco meses seguintes.** Não é abandono contínuo; é ruído de largada.
- Volume real: 64 pedidos em 6 meses, R$ 4,6 mil lançados, **R$ 304 entregues**.

Os 15 pendentes, por idade:

| idade | pedidos | unidades |
| --- | ---: | ---: |
| 30 dias ou mais | **13** | **33** |
| menos de 30 dias | 2 | 4 |

Metade do estoque preso vem de um único dia — 26/05, 4 pedidos, 20 unidades,
parados há 72 dias.

---

## Decisões tomadas

| # | decisão | alternativas descartadas |
| --- | --- | --- |
| 1 | **Mercado Pago** | conta já existe: cai fora a análise cadastral, que costuma demorar mais que o código |
| 2 | **PIX + cartão** | recomendei só PIX (1 pedido de cartão em 64); Gabriel decidiu os dois, e cartão passa a ser cidadão de primeira classe |
| 3 | **Checkout Bricks** | Checkout Pro reintroduz perda de venda no redirect, o que anularia parte do motivo de ter cartão. API pura: mais risco, sem ganho |
| 4 | **Reservar estoque na criação, devolver na expiração** | "só baixar quando pagar" arrisca dois clientes comprando a última unidade; "manter como está" preserva o problema |
| 5 | **Janela de 30 minutos** | casada com a validade do PIX que o MP gera, para não existir código válido de pedido morto |
| 6 | **`pg_cron`** para a varredura | expiração preguiçosa dispensaria infraestrutura, mas deixa o catálogo mentindo enquanto ninguém compra |
| 7 | **Cancelar os 13 pendentes com 30+ dias**, revisar os 2 recentes na mão | cancelar todos os 15 seria rude com o de 30/07; não mexer preserva o vazamento |

---

## Arquitetura

```
1. Cliente clica "finalizar pedido"
   └─ RPC create_marketplace_order_v24: valida preço e estoque, RESERVA
      estoque, grava payment_status='aguardando' e expires_at = now() + 30min

2. Front chama a edge function `criar-pagamento` com o order_id
   └─ lê o pedido com service role, chama a API do Mercado Pago,
      grava gateway_payment_id no pedido, devolve ao front o que o Brick precisa

3. O Brick renderiza no checkout
   └─ PIX: QR code + copia-e-cola, validade de 30 min
   └─ Cartão: formulário do MP, dados tokenizados NO NAVEGADOR

4. Cliente paga

5. Mercado Pago chama `webhook-mercadopago` (verify_jwt = false)
   └─ valida a assinatura x-signature
   └─ consulta a API do MP pelo payment_id — NÃO confia no corpo
   └─ aprovado → payment_status='pago', dispara notify-new-order
   └─ recusado → devolver_estoque(), payment_status='recusado'

6. pg_cron, a cada 5 min
   └─ expirar_pedidos_vencidos(): aguardando + expires_at vencido
      → devolver_estoque(), payment_status='expirado', status='cancelled'
   └─ reconciliar_pagamentos(): expirados que TINHAM pagamento em aberto
      → pergunta ao MP o que houve
```

### Três invariantes do desenho

**O webhook não confia no corpo da requisição.** Pega só o id do pagamento e vai
perguntar ao Mercado Pago o status real. Sem isso, quem descobrir a URL forja um
"aprovado" e leva produto de graça.

**O front nunca confirma pagamento.** Quem muda para `pago` é sempre o webhook. A
tela do cliente só reflete o que já aconteceu — se o navegador dele cair, o
pedido segue.

**A reserva continua sendo na criação**, como hoje. O que muda é ganhar prazo e
devolução automática. Isso mantém a RPC atual quase intacta, em vez de reescrever
o caminho do dinheiro.

---

## Modelo de dados

`status` (ciclo de **entrega**) fica como está: `pending`, `processing`,
`shipping`, `delivered`, `cancelled`. Entra um campo independente:

| `payment_status` | quando | estoque |
| --- | --- | --- |
| `aguardando` | pedido criado, cliente pagando | reservado, com prazo |
| `pago` | webhook confirmou | reservado, definitivo |
| `recusado` | cartão negado ou PIX cancelado — **o dinheiro nunca entrou** | devolvido |
| `expirado` | passou dos 30 min sem pagar | devolvido |
| `estornado` | **o dinheiro entrou e voltou** — estorno ou chargeback | **não mexer automaticamente** |
| `pago_apos_expirar` | dinheiro entrou após o prazo | **devolvido — pedido sem estoque** |

`recusado` e `estornado` são estados separados de propósito. No primeiro nada
aconteceu e o estoque volta com segurança. No segundo houve venda, possivelmente
entrega, e depois devolução de dinheiro — mexer no estoque sozinho aí é chutar
onde a mercadoria está. Os dois últimos da tabela são os que exigem uma pessoa.

**Por que dois campos e não um:** um pedido pode estar pago e não enviado, ou
enviado e com pagamento estornado. Espremer num campo só parece econômico hoje e
vira bug em três meses.

**Colunas novas em `marketplace_orders`:** `payment_status text`,
`expires_at timestamptz`, `gateway_payment_id text`.

**Consequência no painel:** hoje "15 pendentes" não distingue lixo de venda.
Depois: `pending` + `aguardando` é lixo em formação; `pending` + `pago` é venda
esperando despacho. É a diferença entre uma lista confiável e uma que se ignora —
que foi o que aconteceu com os 15.

Isso é o que a **#110 (`CHECKOUT-040`)** pede. Ela deixa de ser issue separada e
vira parte deste trabalho: construir o gateway sem ela seria gravar a confirmação
em lugar nenhum.

---

## Componentes

**Edge functions novas**

| arquivo | `verify_jwt` | papel |
| --- | --- | --- |
| `criar-pagamento/index.ts` | `true` | cria o pagamento no MP a partir do order_id |
| `webhook-mercadopago/index.ts` | **`false`** | recebe a confirmação; o MP não manda JWT |
| `_shared/mercadopago.ts` | — | cliente da API, no padrão de `_shared/webpush.ts` |

**Migration** — colunas novas, `create_marketplace_order_v24`,
`devolver_estoque(order_id)`, `expirar_pedidos_vencidos()`,
`reconciliar_pagamentos()`, extensão `pg_cron` e os dois agendamentos.

**Front** — `CheckoutView.tsx` (1.110 linhas) troca os três botões de rótulo pelo
Brick; nova tela de "aguardando pagamento"; `PaymentMethod` em `types/index.ts`
deixa de ser rótulo e passa a refletir o que o gateway retornou.

**Admin** — fila de atenção para `pago_apos_expirar` e estornos.

**Segredo** — `MP_ACCESS_TOKEN` no ambiente das functions. **Nunca no `.env` do
front**, que vai para o bundle.

---

## Casos de falha, e o que o desenho faz

**O webhook chega mais de uma vez.** O MP reenvia quando não recebe `200` rápido.
→ `gateway_payment_id` único, e a atualização só age se `payment_status` ainda for
`aguardando`. A segunda chamada encontra `pago` e devolve `200` sem fazer nada.

**O webhook não chega.** Função fora do ar, falha do MP, rede. O cliente pagou e o
pedido expira como se nada tivesse acontecido.
→ `reconciliar_pagamentos()` pega expirados que tinham pagamento em aberto e
pergunta ao MP. É a rede de segurança do webhook; sem ela, 30 minutos de queda
viram dinheiro recebido sem pedido.

**A expiração roda no instante do pagamento.** Dois processos no mesmo pedido.
→ `SELECT ... FOR UPDATE` nas duas operações. Quem chega primeiro ganha; o
segundo enxerga o resultado em vez de sobrescrever. É a trava que o
`update_order_status_atomic` já usa neste banco.

**Estorno e chargeback.** Semanas depois, o cliente contesta.
→ tratado como estado, não exceção: `payment_status` vira `estornado` (não
`recusado` — ali o dinheiro nunca entrou; aqui entrou e voltou) e o pedido cai na
fila de atenção. **Não** tenta desfazer entrega nem repor estoque sozinho — a
essa altura só uma pessoa sabe onde a mercadoria está.

**`criar-pagamento` falha após o pedido criado.** Cliente fica com pedido sem
cobrança. → expira sozinho em 30 min. A expiração já é a rede; não precisa de
tratamento próprio.

---

## Fases

**Cada fase vira um plano de implementação próprio.** São quatro entregas
sequenciais, não um plano só: a Fase 1 mexe em migration no caminho do dinheiro,
a 2 e a 3 em edge function e front, a 4 em painel. Tentar planejar as quatro de
uma vez produz um plano que ninguém consegue revisar — e a Fase 1 já tem valor
sozinha, então não há motivo para amarrá-las.

**Fase 1 — o estoque, sem gateway nenhum.** Migration completa + backfill
(cancelar os 13 antigos, devolver 33 unidades). A máquina de expiração fica
montada e agendada, **ociosa**: nada carimba prazo ainda.
**Entrega valor sozinha:** conserta o vazamento que **já existe** — as 33 unidades
presas — e não depende de uma linha de Mercado Pago. Se o resto parar, isso já
valeu.

> **Correção de 06/08/2026, decidida pelo Gabriel depois da revisão final da Fase 1.**
> A troca do front para a `create_marketplace_order_v24` **saiu da Fase 1 e entrou na
> Fase 2**. Motivo: os três meios de pagamento do checkout são *na entrega*
> (`CheckoutView.tsx:874-891`), então carimbar 30 minutos de prazo hoje cancelaria
> sozinho todo pedido legítimo — o cliente não teria como cumprir o prazo. Prazo de
> pagamento só faz sentido junto do meio de pagar. Consequência a dizer com todas as
> letras: **a Fase 1 fecha o vazamento antigo, não o contínuo.** Fechar o contínuo
> passou a ser entrega da Fase 2.

**Fase 2 — criar o pagamento, mostrar o Brick e ligar a expiração.** `criar-pagamento`
+ mudança no `CheckoutView`, com credenciais de teste, **e a troca da RPC para a v24**,
que é o que arma a reserva com prazo. No fim dela dá para gerar PIX e preencher cartão
de teste; nada confirma ainda.

**Fase 3 — o webhook e a reconciliação.** O laço fecha: pagou → pedido pago →
lojista avisado pela `notify-new-order`, que já existe e está publicada.

**Fase 4 — o painel.** Status de pagamento visível e a fila de atenção. Sem ela,
`pago_apos_expirar` existe no banco e ninguém vê.

---

## Testes

**Sem tocar no Mercado Pago** (a maior parte): validação da assinatura,
idempotência do webhook, transições de estado, cálculo de expiração, e o
comportamento quando o pagamento chega após o prazo. Lógica pura, em Deno, como
os 43 testes que já rodam no CI.

**Webhook contra servidor HTTP local**, no padrão dos testes da `send-push`, que
já sobem um push service falso para provar envio sem rede.

**Ponta a ponta com credenciais de teste do MP.** Pagamento fictício, dinheiro
nenhum. É o mais perto de produção possível sem a #131.

**Funções do banco em transação com `ROLLBACK`.** ⚠️ A migration **não pode ter
`BEGIN`/`COMMIT` embutido**: as de julho têm, e é isso que faz o `ROLLBACK` do
teste virar no-op e gravar em produção. Já aconteceu neste repositório.

---

## Restrições herdadas

- A migration da Fase 1 passa pelo **§ 9 do `03-SETUP-AMBIENTE.md`**: confirmar
  que o backup do dia já saiu, rodar `db-snapshot-politicas.cjs`, e só então
  aplicar. Não há PITR — reverter custa até 24 h de pedidos.
- `pg_cron` **não está instalado** (só `pg_net` v0.19.5). Instalar faz parte da
  Fase 1.
- Deploy de edge function **sempre com o nome da função**; sem nome, publica
  todas as do diretório.
- A `webhook-mercadopago` exige `--no-verify-jwt` no deploy, e isso **não é
  versionado** no `config.toml` — é a #162.

---

## Fora de escopo, de propósito

- **Tela de reembolso** — o painel do Mercado Pago já faz.
- **Lógica própria de parcelamento** — o Brick faz.
- **Camada de abstração de gateway.** Há um gateway. Abstrair o segundo antes de
  ele existir é inventar trabalho.
- **Migrar os pedidos históricos** para o novo modelo além do backfill dos 13.

---

## Não verificado

- **Se a conta do Mercado Pago está habilitada para PIX via API.** A conta
  existe e é usada, mas não foi confirmado que o token de produção tem o escopo
  de criar cobrança PIX. **É o primeiro passo da Fase 2** — se faltar, o
  cronograma muda antes de qualquer código.
- **Onde o dinheiro cai.** Com Mercado Pago, o valor entra no saldo do MP, não
  direto na conta bancária. Se hoje o PIX cai direto no banco, isso é uma
  mudança operacional real — saque passa a ser um passo.
- **Se o `CheckoutView.tsx` comporta o Brick sem ser quebrado antes.** 1.110
  linhas não é impeditivo, mas a Fase 2 deve começar lendo o arquivo e decidir
  se a integração entra direto ou se o passo de checkout sai para um componente
  próprio.
- **Taxa por transação.** Não entrou na decisão e não foi consultada.

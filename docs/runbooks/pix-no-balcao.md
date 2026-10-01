# Runbook — PIX com QR no balcão e "Anular venda" (frente A, 28/09/2026)

O que sobe: as migrations `20261184000000_o_pix_do_balcao_abre_na_hora.sql` e
`20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql`, a edge nova `cobrar-pix-no-balcao`
e o front da tela Vender. Plano: [2026-09-28-balcao-pix-no-balcao.md](../superpowers/plans/2026-09-28-balcao-pix-no-balcao.md).

**Só publicar após decisão do dono.** Esta preparação não aplica migrations, não publica
functions e não faz cobrança real. O último CI do PR #741 (01/10) ainda achou as duas
RPCs ausentes no banco ativo da IKCOUS; a prova em Postgres efêmero passou.

| Destino no workflow | Projeto Supabase | Segredo usado pelo Actions |
|---|---|---|
| `loja` (IKCOUS) | `dekxabvqdsuukijblazl` | `SUPABASE_ACCESS_TOKEN` |
| `savy` | `gnjsrucsmjkajijrakzr` | `SUPABASE_ACCESS_TOKEN_SAVY` |

O projeto `cafkrminfnokvgjqtkle` é o antigo e não deve receber esta release.
Nos dois workflows, selecione a branch que contém o commit aprovado; na Savy,
preencha `expected_sha` com os 40 caracteres do commit selecionado. O run deve
mostrar o mesmo `GITHUB_SHA` antes de qualquer operação.

## 0. Pré-requisitos (conferir antes)

- Em **IKCOUS e Savy**, confira por leitura do catálogo as migrations **74–83** e os
  objetos dos quais 84/85 dependem. Um run de 28/09 registrou 74–83 na Savy,
  mas não prova o estado no dia da publicação. A 84 grava
  `metodo_online` (coluna da 76) e usa `forma_de_pagamento_aceita` (74); a 85 usa a
  `devolver_estoque` da 75 e a tabela `devolucoes`. Sem elas, a aplicação falha no primeiro uso.
- O PIX do site funciona em cada loja (credencial do Mercado Pago cadastrada e
  `pagamento_online` ligado): o PIX com QR do balcão usa a conta e o webhook
  daquela loja.
- O cartão continua **desligado** — nada aqui liga cartão.

## 1. Ordem de publicação (fixa)

Faça os passos 1–4 primeiro na IKCOUS (`projeto=loja`) e depois na Savy
(`projeto=savy`, com `expected_sha` exato). Confira o ref e o SHA no run antes
de aceitar seu resultado. Não avance para o front enquanto qualquer loja estiver
sem a edge ou sem as duas RPCs.

1. **Migration 84** — Actions → *Aplicar migrations (Supabase)* → Run workflow, na branch que já contém o
   arquivo; `migracoes` = `20261184000000_o_pix_do_balcao_abre_na_hora.sql`.
   O workflow prova em `BEGIN/ROLLBACK` e aplica no projeto selecionado.
2. **Conferir a 84** no SQL Editor do **mesmo ref** selecionado na tabela acima.
   Não use *Conferir banco da loja*: esse verificador ainda aponta `loja` para
   o projeto antigo e não oferece Savy nem as consultas da 84/85.
   ```sql
   SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p
    WHERE p.proname IN ('iniciar_venda_presencial_pix', 'venda_do_balcao_paga_e_entregue');
   -- esperado: 2 linhas, prosecdef = true, {"search_path=pg_catalog, pg_temp"}
   SELECT tgname FROM pg_trigger
    WHERE tgname IN ('tr_venda_do_balcao_paga_e_entregue', 'tr_venda_do_balcao_guarda_o_status');
   -- esperado: 2 linhas
   SELECT has_function_privilege('anon', 'public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text)', 'EXECUTE');
   -- esperado: false
   SELECT has_function_privilege('authenticated', 'public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text)', 'EXECUTE');
   -- esperado: true
   ```
3. **Migration 85** — mesmo workflow e mesmo projeto, `migracoes` =
   `20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql`. Conferir:
   ```sql
   SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'anular_venda_presencial';
   -- esperado: true, {"search_path=pg_catalog, pg_temp"}
   SELECT has_function_privilege('anon', 'public.anular_venda_presencial(uuid, text)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.anular_venda_presencial(uuid, text)', 'EXECUTE');
   -- esperado: false, true
   ```
   Se o workflow falhar **depois** de mostrar `APLICADA`, o banco pode já ter
   recebido o DDL. Confira os objetos e os grants no mesmo ref antes de tentar
   novamente; não trate o run vermelho como rollback automático.
4. **Edge** — Actions → *Publicar edge functions (Supabase)* → `functions` = `cobrar-pix-no-balcao send-order-confirmation`,
   no mesmo `projeto`. (Elas NÃO estão no atalho "cobranca": publique pelos nomes.) Conferir no
   painel do Supabase que `cobrar-pix-no-balcao` aparece com **Verify JWT ligado**
   (vem do `supabase/config.toml`).
   A edge `send-order-confirmation` também mudou (texto do comprovante no balcão). O mesmo `_shared` é usado
   pelo `webhook-mercadopago` e pelo `reconciliar-pagamentos`: republicá-los não é obrigatório
   (a mudança só troca o rótulo do e-mail do balcão), mas é o jeito de o e-mail do PIX com QR
   confirmado pelo webhook também dizer "no balcão".
5. **Front** — o deploy normal da Vercel, por último, após conferir ambos os destinos.
   Sem a 84 no ar, "Gerar PIX" mostra
   "O balcão ainda não está liberado neste servidor"; dinheiro, PIX na chave e maquininha
   continuam funcionando.

## 2. Teste de verdade (depois do passo 5)

1. Tela Vender → bipe um produto barato → Fechar venda → **PIX com QR** → *Gerar PIX*.
2. Pague R$ 1,00+ com o app do banco pelo QR da tela. Em até alguns segundos depois do webhook,
   a tela vai sozinha para o recibo "PIX com QR no balcão".
3. Confira em Pedidos: a venda aparece **Entregue**, "Pago no balcão (PIX com QR)". No
   Financeiro, a entrada está na conta **Mercado Pago**, forma pix, canal balcão.
4. Gere outro PIX e toque *Cancelar este PIX e trocar a forma*: a tela volta ao fechamento com o
   cupom; em Pedidos a venda fica Cancelada e o estoque voltou; no painel do Mercado Pago a
   cobrança aparece cancelada.
5. Registre uma venda em dinheiro e, no recibo, *Anular venda* com um motivo: estoque de volta,
   pedido Cancelado/Estornado, e o esperado do caixa (Financeiro › Caixa) volta ao que era.

## 3. Rollback e gatilhos de parada

Pare a promoção se o QR não for emitido com as credenciais configuradas, se um
pagamento confirmado não atualizar o pedido/estoque, ou se a verificação das RPCs,
grants e JWT não bater com o esperado. Registre os pedidos em aberto antes de
reverter qualquer componente.

- Front: redeploy do anterior na Vercel.
- Edge: republicar a versão anterior de `send-order-confirmation`; sem a tela nova,
  `cobrar-pix-no-balcao` fica sem chamadas normais. Em falha financeira, confira
  também `webhook-mercadopago` e `reconciliar-pagamentos` antes de reverter qualquer um.
- Banco: **não remover a 84 enquanto houver QR pendente** — um PIX pago depois
  perderia a entrega automática. Primeiro resolva/cancele os pedidos em aberto.
  Só se a remoção for necessária e revisada, aplicar os rollback-manual da 85 e
  depois da 84 no mesmo destino, verificando cada etapa. Vendas já feitas
  continuam fatos; pagamento tardio após a remoção requer tratamento manual.

## 4. Riscos conhecidos

- O e-mail do pagador vai ao Mercado Pago como: e-mail do pedido → e-mail da conta do cliente
  cadastrado → `sem-email@ikcous.com.br` (nunca o do lojista logado, para o pagador não ser o
  próprio recebedor). **Não medido contra a API real**: se o MP recusar o genérico numa venda sem
  cliente, a tela mostra a frase de erro e o balconista usa outra forma. Medir no passo 2.
- Um PIX cancelado na tela é cancelado primeiro no Mercado Pago. Se o cliente pagar exatamente
  nesse instante, a edge descobre e responde **pago** (a venda não é cancelada). Se o MP estiver
  fora do ar, a venda NÃO é cancelada (a tela pede para tentar de novo).
- Pagamento que chega depois do prazo (30 min) vira `pago_apos_expirar` (política P1): a tela
  avisa para não cobrar de novo e o pedido fica com o selo de atenção em Pedidos. "Conferir" e
  "Cancelar" sempre perguntam ao Mercado Pago quando existe cobrança, mesmo com a venda vencida.
- A 84 aborta na aplicação (`PREFLIGHT_20261184`) se faltar a 74 ou a 76; a 85 aborta
  (`PREFLIGHT_20261185`) se faltar a 75.
- Venda do balcão: só a loja muda o status (o cliente com conta não cancela pelo app), e ninguém
  marca "Entregue" enquanto o PIX estiver aguardando. Se o Mercado Pago não responder ao
  cancelamento, a tela oferece "Deixar este PIX vencer e limpar o cupom" para o caixa não parar.

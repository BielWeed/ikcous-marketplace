# Runbook — PIX com QR no balcão e "Anular venda" (frente A, 28/09/2026)

O que sobe: as migrations `20261184000000_o_pix_do_balcao_abre_na_hora.sql` e
`20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql`, a edge nova `cobrar-pix-no-balcao`
e o front da tela Vender. Plano: [2026-09-28-balcao-pix-no-balcao.md](../superpowers/plans/2026-09-28-balcao-pix-no-balcao.md).

**Só o dono aplica.** Nada disto foi aplicado em banco nenhum pela sessão que escreveu.

## 0. Pré-requisitos (conferir antes)

- As migrations **75–78** (PR #666) já estão aplicadas e conferidas na loja — a 84 grava
  `metodo_online` (coluna da 76) e usa `forma_de_pagamento_aceita` (74); a 85 usa a
  `devolver_estoque` da 75 e a tabela `devolucoes`. Sem elas, a aplicação falha no primeiro uso.
- O PIX do site funciona na loja (credencial do Mercado Pago cadastrada e `pagamento_online`
  ligado): o PIX com QR do balcão usa a MESMA conta e o MESMO webhook.
- O cartão continua **desligado** — nada aqui liga cartão.

## 1. Ordem de publicação (fixa)

1. **Migration 84** — Actions → *Aplicar migrations (Supabase)* → Run workflow, na branch que já contém o
   arquivo; `migracoes` = `20261184000000_o_pix_do_balcao_abre_na_hora.sql`, `projeto` = `loja`.
   O workflow prova em `BEGIN/ROLLBACK` e aplica.
2. **Conferir a 84** (SQL Editor ou *Conferir banco da loja*):
   ```sql
   SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p
    WHERE p.proname IN ('iniciar_venda_presencial_pix', 'venda_do_balcao_paga_e_entregue');
   -- esperado: 2 linhas, prosecdef = true, {"search_path=pg_catalog, pg_temp"}
   SELECT tgname FROM pg_trigger WHERE tgname = 'tr_venda_do_balcao_paga_e_entregue';
   -- esperado: 1 linha
   SELECT has_function_privilege('anon', 'public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text)', 'EXECUTE');
   -- esperado: false
   ```
3. **Migration 85** — mesmo workflow, `migracoes` =
   `20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql`. Conferir:
   ```sql
   SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'anular_venda_presencial';
   -- esperado: true, {"search_path=pg_catalog, pg_temp"}
   ```
4. **Edge** — Actions → *Publicar edge functions (Supabase)* → `functions` = `cobrar-pix-no-balcao`,
   `projeto` = `loja`. (Ela NÃO está no atalho "cobranca": publique pelo nome.) Conferir no
   painel do Supabase que ela aparece com **Verify JWT ligado** (vem do `supabase/config.toml`).
   A edge `send-order-confirmation` também mudou (texto do comprovante no balcão) — publique-a
   junto: `functions` = `cobrar-pix-no-balcao send-order-confirmation`. O mesmo `_shared` é usado
   pelo `webhook-mercadopago` e pelo `reconciliar-pagamentos`: republicá-los não é obrigatório
   (a mudança só troca o rótulo do e-mail do balcão), mas é o jeito de o e-mail do PIX com QR
   confirmado pelo webhook também dizer "no balcão".
5. **Front** — o deploy normal da Vercel, por último. Sem a 84 no ar, "Gerar PIX" mostra
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

## 3. Rollback

- Front: redeploy do anterior na Vercel.
- Edge: republicar a versão anterior de `send-order-confirmation`; `cobrar-pix-no-balcao` pode
  ficar (sem a tela, ninguém a chama) ou ser removida no painel.
- Migrations: `rollback-manual-20261185000000_…sql` e depois `rollback-manual-20261184000000_…sql`
  (pelo mesmo workflow). Vendas já feitas continuam válidas; um PIX pago depois do rollback da
  84 fica "pendente/pago" e precisa ser marcado entregue à mão.

## 4. Riscos conhecidos

- O e-mail do pagador vai ao Mercado Pago como: e-mail do pedido → e-mail da conta do cliente
  cadastrado → `sem-email@ikcous.com.br` (nunca o do lojista logado, para o pagador não ser o
  próprio recebedor). **Não medido contra a API real**: se o MP recusar o genérico numa venda sem
  cliente, a tela mostra a frase de erro e o balconista usa outra forma. Medir no passo 2.
- Um PIX cancelado na tela é cancelado primeiro no Mercado Pago. Se o cliente pagar exatamente
  nesse instante, a edge descobre e responde **pago** (a venda não é cancelada). Se o MP estiver
  fora do ar, a venda NÃO é cancelada (a tela pede para tentar de novo).
- Pagamento que chega depois do prazo (30 min) vira `pago_apos_expirar` (política P1): a tela
  avisa para não cobrar de novo e o pedido fica com o selo de atenção em Pedidos.

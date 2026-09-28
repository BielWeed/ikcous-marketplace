# Frente A — PIX no balcão (plano de execução, 28/09/2026)

Ponto de partida: [investigação da coordenadora](../specs/2026-09-28-balcao-pix-investigacao.md)
(conferida contra o código nesta sessão — os defeitos D1–D12 dela batem; o D1 é o mesmo defeito que
esta sessão achou antes de a investigação chegar à base). Roteiro:
[2026-09-28-sessoes-paralelas.md](2026-09-28-sessoes-paralelas.md), frente A.

## Decisões desta sessão (sobre as da coordenadora)

- **Opção A mantida**: RPC nova + edge nova (`cobrar-pix-no-balcao`); `criar-pagamento`,
  `webhook-mercadopago` e `reconciliar-pagamentos` ficam intocados.
- **Divergência consciente — quem vira `delivered`**: a investigação propõe que a TELA chame
  `update_order_status_atomic(id,'delivered')` ao ver `pago`. Aqui é um **gatilho**
  (`BEFORE UPDATE OF payment_status`, só `canal='presencial'`, `aguardando→pago`, `status='pending'`):
  o pagamento pode ser confirmado pelo webhook ou pela reconciliação com a tela FECHADA (aba
  descartada, F5, outro aparelho) — sem o gatilho, a venda ficaria "pendente/paga" na fila de
  Pedidos como se fosse para separar e enviar. O gatilho roda dentro da MESMA transação de
  `confirmar_pagamento`, não toca dinheiro nem estoque (só `status` e uma linha de histórico).
- PIX com QR grava `payment_method='online'` + `metodo_online='pix'` + `canal='presencial'`: o
  Financeiro já põe isso na conta Mercado Pago, forma pix, origem `venda_balcao` — sem mexer em
  `fin_*`. Enquanto `aguardando`, nada entra no Financeiro, no caixa nem no CRM (todos filtram por
  pago); o estoque fica RESERVADO (mesma reserva de 30 min do PIX do site: expira → devolve).
- A chave de idempotência do PIX é **própria** (gerada ao tocar "Gerar PIX"), nunca a do cupom:
  trocar para dinheiro depois de cancelar o PIX usa a chave do cupom, intacta.

## Fases e tarefas (cada uma com teste primeiro; etiqueta de risco)

### Fase 1 — banco (RISCO: migration, SECURITY DEFINER, gatilho em `marketplace_orders`)
- 1.1 `supabase/migrations/20261184000000_o_pix_do_balcao_abre_na_hora.sql`:
  `iniciar_venda_presencial_pix(jsonb, uuid, text, text, numeric, text, uuid)` — mesmas travas de
  `registrar_venda_presencial` (admin, vendedor = sessão, preço/estoque do banco com trava, desconto
  com motivo, teto de itens), exige PIX pelo app ligado (`forma_de_pagamento_aceita('online')`),
  recusa total zero; nasce `pending`/`online`/`aguardando`/`metodo_online='pix'`,
  `expires_at=now()+30min`; idempotência por canal+vendedor+`online`. Gatilho
  `tr_venda_do_balcao_paga_e_entregue`. Rollback manual ao lado.
- 1.2 Teste estático `tests/migration_o_pix_do_balcao_abre_na_hora_test.ts`.
- 1.3 Prova viva `tests/banco/pix-do-balcao-viva.cjs` (+ passo no `rpc-ci.yml`): nasce aguardando e
  reserva estoque; idempotência; expira → devolve estoque; pago → `delivered` + histórico;
  cancelado antes de pagar → `pago_apos_expirar` sem virar entregue; Financeiro só conta depois de
  pago, na conta Mercado Pago; caixa não muda; não-admin recusado.

### Fase 2 — edge `cobrar-pix-no-balcao` (RISCO: edge de pagamento)
- 2.1 `_shared/pix-do-balcao.ts`: cópia de `expiracaoRealinhavel` com teste de paridade.
- 2.2 Porta: `verify_jwt` + admin (padrão `estornar-pagamento`), só pedido presencial+online.
- 2.3 `gerar`: cria (chave = id do pedido) ou reconsulta; grava a vaga com UPDATE condicional;
  e-mail do pagador pedido → conta do cliente → genérico (nunca o do lojista); devolve QR, prazo e
  hora do servidor.
- 2.4 `cancelar`: cancela no MP; só então cancela o pedido (`update_order_status_atomic` com o JWT do
  admin); MP diz pago → responde pago e não cancela.
- 2.5 `conferir`: reconsulta; pago + valor ±R$ 0,05 → `confirmar_pagamento('pago')`.

### Fase 3 — tela do PIX (RISCO: checkout/pagamento)
- 3.1 Máquina: etapa `pix`, `pix: {chave, orderId}` no rascunho (retoma depois do F5), cupom só
  leitura enquanto espera; forma `pix_qr`.
- 3.2 `PixDoBalcao.tsx`: QR ≥256 px, copia-e-cola, valor, "Vence em mm:ss (às HH:MM)" pelo relógio do
  servidor, "Aguardando pagamento…" anunciado, consulta a cada 3 s, "Já pagou? Conferir agora",
  "Trocar forma de pagamento", "Cancelar PIX"; venceu → "Gerar novo PIX" / "Trocar forma".
- 3.3 View: gerar → acompanhar → recibo; e-mail do comprovante só depois de pago.

### Fase 4 — correções da investigação
- A1 dinheiro em centavos no front (D5) · A2 motivo não vaza (D6) · A3/A4 rótulo único da forma
  (ficha, CSV, recibo) (D4) · A5 e-mail diz "no balcão" (D3, `_shared`, RISCO) · A7 a11y das formas
  e do desconto (D9) · A8 troco · A9 aviso de caixa fechado no dinheiro (D8) · B14 "Conferi o
  pagamento" obrigatório no PIX na chave e na maquininha.

### Fase 5 — anular venda do balcão (resposta do dono: mesmo dia, motivo obrigatório)
- `supabase/migrations/20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql`:
  `anular_venda_presencial(uuid, text)` — só admin, só `canal='presencial'` recebida na hora
  (dinheiro, PIX na chave, maquininha), só no mesmo dia da loja; devolve estoque, vira
  `cancelled`/`estornado` (o Financeiro e o caixa já descontam pelo estorno registrado fora do app).
  PIX com QR pago usa o estorno pelo Mercado Pago que a ficha já tem.

### Fase 6 — verificação, prints 375 px, revisões (`revisor` + `revisor-risco`), PR rascunho.

Fora desta frente (descrito no PR): D7 (aba Caixa mostra o estorno), D10 (aviso de preço mudado),
D11 (texto do AGENTS.md — arquivo compartilhado), D12 (conta configurável por forma: exige
decidir se a troca de conta vale para o passado; proposta no PR).

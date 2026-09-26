# Devolução e troca de produto — design

> 26/09/2026. Pedido do dono: sistema de devolução do produto que o cliente quer devolver,
> **local ou nacional**. Também atende a P3 do `AGENTS.md` (política de reembolso de cada
> lojista, configurável no painel).

Hoje "devolução" no app é só **dinheiro** (ledger `order_refunds`) e a confirmação de que o
produto voltou num pedido cancelado depois do envio. Não existe o cliente pedir para devolver
um produto **entregue** — `update_order_status_atomic` diz isso com todas as letras.

## Regras legais que o app respeita (e não deixa o lojista desligar)

- **Arrependimento (CDC art. 49)**: compra fora da loja física → 7 dias da entrega, sem
  motivo, devolução integral **incluindo o frete de ida**; frete de volta é da loja (STJ,
  REsp 1.340.604/RJ). O prazo configurável nunca fica abaixo de 7.
- **Defeito (arts. 18 e 26)**: 30 dias (não durável) / 90 (durável) da entrega; padrão 90
  e mínimo 30. Recusa sempre explícita e registrada (a reclamação suspende o prazo até
  resposta negativa inequívoca — art. 26 §2º I) → trilha em `devolucao_eventos`.
- **Decreto 7.962/2013**: o cliente desiste pelo mesmo canal (botão no pedido) e recebe
  confirmação imediata (protocolo na hora).
- **Troca por gosto/tamanho** fora do arrependimento: cortesia da loja → política dela.

## Fluxo

```text
cliente (pedido entregue) ─ Solicitar devolução ─► solicitada
   loja aprova (instruções/coleta) ─► aprovada ── cliente cancela ─► cancelada
   loja recusa (motivo obrigatório) ─► recusada
aprovada ─ postagem/rastreio ─► em_transito ─► recebida      (nacional)
aprovada ─ entregou na loja / coleta feita ─────► recebida   (local)
recebida ─ inspeção por item (reestocar?) + resolução ─► concluida
recebida ─ produto não confere ─► reprovada
```

- **Local** (entrega da loja, retirada ou balcão): entregar na loja (endereço e horário da
  loja) ou coleta no endereço do pedido (a loja marca o horário).
- **Nacional** (transportadora): etiqueta reversa do Melhor Envio quando a ida saiu por lá
  (`POST /api/v2/me/cart/reverse` — código de postagem nos Correios, válido 7 dias) ou
  envio pelo próprio cliente com código de rastreio (loja reembolsa o frete no
  arrependimento/defeito).
- **Reembolso**: pedido pago pelo app → linha no ledger `order_refunds` e a mesma edge
  `estornar-pagamento` do estorno (Mercado Pago devolve ao cartão/PIX). Pago na entrega ou no
  balcão → reembolso registrado como manual (a loja devolve em dinheiro/PIX) e o Financeiro
  mostra a saída.
- **Estoque**: volta **por item**, só o que a inspeção marcou para reestocar, uma vez só
  (`reestocado_em`). Não usa `devolver_estoque` (que é do pedido inteiro).
- **Avisos**: cada mudança de status avisa o cliente em `notificacoes`; o sino do lojista
  ganha a fonte "devolução".

## Fontes

- CDC: <https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm>
- Decreto 7.962/2013: <https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm>
- Melhor Envio — logística reversa: <https://docs.melhorenvio.com.br/reference/inserir-logistica-reversa-no-carrinho>
- Mercado Pago — reembolsos: <https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/additional-content/payment-management/cancellations-and-refunds>

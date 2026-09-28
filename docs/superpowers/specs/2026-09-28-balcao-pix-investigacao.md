# Venda no balcão: diagnóstico do pagamento e desenho do PIX com QR (28/09/2026)

Investigação só-leitura feita pela sessão coordenadora sobre o commit `f2e907bf` (igual à
`proxima/base`), para a frente A de
[2026-09-28-sessoes-paralelas.md](../plans/2026-09-28-sessoes-paralelas.md). Não rodou teste; a
documentação do Mercado Pago não abriu (proxy) — o que depende dela está marcado **NÃO
VERIFICADO**. Confira tudo antes de usar.

## Decisões do coordenador (padrões; o dono pode mudar)

- Opção **A** (RPC nova + edge nova; `criar-pagamento` e webhook intocados).
- "PIX com QR" só aparece quando o PIX pelo app estiver ligado; o PIX manual continua como
  alternativa, renomeado "PIX na chave da loja".
- QR no balcão **sem exigir cliente cadastrado** (a P6 é regra do checkout do app; no balcão quem
  opera é a loja logada).
- Botão "Já pagou? Conferir agora" (B7) entra, com a mesma regra da reconciliação.
- PIX abandonado fica como pedido "Cancelado" do balcão (rastro).
- Em aberto, esperando o dono (não construir sem resposta): "Anular venda do balcão" (D2),
  passo "Conferi" no PIX manual/maquininha (B14), crédito × débito com parcelas, e se a chave PIX e
  a maquininha da loja são do Mercado Pago (D12).

## 1. Como funciona hoje

### Tela Vender

- `src/views/admin/AdminPdvView.tsx` é a única peça que fala com o Supabase: bipe
  `buscar_por_codigo_barras` (:186-209), cliente `get_admin_customers_paged` (:218-232), produto
  `get_admin_products_paged` (:234-249), fechamento `registrar_venda_presencial` (:363-472),
  depois `send-order-confirmation` sem esperar (:455-471). O fechamento é um cartão no fim da
  página (:524-531).
- `src/hooks/useVendaPresencial.ts` (reducer): formas `"cash" | "pix" | "card"` (:66); cliente
  nenhum/cadastrado/avulso (:92-104); chave de idempotência nasce com o cupom (:309-327) e gira em
  `cupom_limpo` (:754-780); subtotal/total em float (:428-437); `vendaPodeSerRegistrada`
  (:447-489); rascunho em `localStorage` (:833-950).
- `src/components/admin/pdv/FechamentoDaVenda.tsx`: Dinheiro, "PIX na hora", "Cartão na
  maquininha" (:58-66, :152-170); desconto com motivo (:172-209); resumo (:211-226); sem internet
  recusa (:228-237); botão desabilitado em envio/sem rede/validação/chave queimada (:108-110,
  :121-136). **Não existe**: troco/valor recebido, crédito × débito, parcelas, "outro", QR, chave
  PIX.
- Erros: `src/lib/erro-da-venda-presencial.ts` (:97-150). Recibo:
  `src/components/admin/pdv/ReciboDaVenda.tsx` (rótulo :84-91; "já registrada" :127-135); o papel
  impresso (`OrderReceipt`) não imprime a forma.

### RPC `registrar_venda_presencial`

`supabase/migrations/20261162000000_a_venda_no_balcao_nasce_inteira.sql`: só admin, vendedor =
logado (:219-228); idempotência por canal+vendedor com corrida tratada (:241-254, :397-413);
formas `cash|pix|card` (:263-265); desconto 2 casas com motivo (:278-287), nunca > subtotal
(:359-362); preço do banco com trava (:298-352); pedido `delivered` + `recebido_na_entrega` +
`pagamento_recebido_em=now()` + `canal='presencial'` + `payment_method` como veio, `expires_at`
NULL (:378-395); estoque na variação OU no produto com 2ª checagem (:424-478); históricos
(:485-491); EXECUTE só `authenticated` (:525-526).

### Cada forma

| Forma | Banco | Financeiro (conta / forma) | Caixa |
| --- | --- | --- | --- |
| Dinheiro | `cash`, pago na hora | Caixa da loja / dinheiro | entra no esperado se houver sessão aberta |
| PIX na hora | `pix`, pago na hora, **na confiança** | Conta bancária / pix | não |
| Maquininha | `card`, pago na hora | Conta bancária / cartao | não |

Financeiro em `supabase/migrations/20261177000000_o_financeiro_da_loja_nasce.sql`:
`fin__conta_da_forma` (:298-306), `fin__forma_do_pedido` (:308-318), `fin__movimentos`
(:332-356, origem `venda_balcao`), `fin__caixa_calculo` soma todo `cash` recebido na sessão, de
qualquer canal (:475-479), estornos externos no esperado (:497-507, :528).

### Onde aparece

Pedidos (chip/selo "Balcão", `src/views/admin/AdminOrdersView.tsx` :1645-1655, :2203-2208,
:2448-2453); selo "Recebido no balcão"
(`src/components/admin/orders/OrderStatusBadge.tsx:298`); ficha
(`src/components/admin/orders/OrderDetail.tsx`: :171-175; rótulo `card`→"Cartão de crédito",
desconhecida→"Dinheiro Espécie" :121-126; sem Cancelar para entregue :346-347); Financeiro
(`por_canal.presencial`); CRM/Início (`crm__vendas`, migration 20261178 :53-59; "Hoje na loja");
CSV (`src/lib/pedidos-csv.ts` :69, rótulos de forma errados :7-15); e-mail
(`supabase/functions/_shared/comprovante.ts:193-200`, forma por `rotuloDoPagamento` sem canal).

## 2. PIX no balcão hoje

Não existe cobrança do Mercado Pago no balcão: nenhum QR, copia-e-cola ou chave PIX (a chave nem
existe na configuração; backlog `docs/backlog/BACKLOG.md:2587`). "PIX na hora" grava pago no
clique, por desenho (`docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md` :282, :323,
:369).

PIX do app: `supabase/functions/criar-pagamento/index.ts` confere o dono (:231-237,
:1021-1024), `podeCobrar` exige `aguardando` + não cancelado + prazo (:252-287), pedido sem conta
→ 403 `PAGAMENTO_ONLINE_EXIGE_CONTA` (:1634), e-mail do pagador corpo→pedido→**token de quem
chama**→genérico (:1639-1643), Orders API 30 min (:1739-1875;
`supabase/functions/_shared/mercadopago.ts:914-975`), chave `<pedido>` / `<pedido>:<n>`
(:564-578), realinha `expires_at` (:326-347). Webhook reconsulta e confere valor ±R$ 0,05
(`supabase/functions/webhook-mercadopago/index.ts:1899`) → `confirmar_pagamento` (:2131), que
não mexe no `status` (migration 20260901 :471-566). `reconciliar-pagamentos` a cada 10 min
(migration 20261010 :69-94); expiração a cada 5 min (20260901 :254-270). Tela:
`src/components/checkout/PagamentoOnline.tsx` (anti-duplo no StrictMode :196-303; copiar
:504-555; QR base64 :737-757; sem contagem regressiva de propósito :465-478);
`src/views/customer/CheckoutView.tsx` descobre o pago por realtime + consulta a cada 10 s (:129,
:158, :1870-1952).

O que impede o reuso direto: (1) o pedido do balcão nasce pago/entregue; (2) com cliente
cadastrado o `user_id` é do cliente → 404 na conferência de dono; (3) sem cliente → 403 pela P6;
(4) o e-mail do token seria o do lojista — pagador = recebedor, que o MP recusaria (**NÃO
VERIFICADO**); (5) para cair na conta Mercado Pago do Financeiro tem de ser `online` +
`metodo_online='pix'`; (6) depois do `pago` alguém muda `pending`→`delivered`. Já serve sem
mudança: webhook/reconciliação (acham pelo id da cobrança), cron de expiração, leitura pelo admin
(RLS, baseline :5592), cancelamento pelo admin com devolução de estoque
(`update_order_status_atomic`, migration 20261180 :211+).

## 3. Defeitos

| # | Sev. | O quê | Onde |
| --- | --- | --- | --- |
| D1 | Alta | PIX e maquininha gravam pago no clique, sem QR/chave/conferência; o Financeiro já conta | FechamentoDaVenda.tsx:58-66; 20261162:379-395; 20261177:332-356 |
| D2 | Média | Venda errada não tem correção (nasce entregue, sem Cancelar); forma errada deixa Financeiro e caixa errados | 20261162:386; OrderDetail.tsx:346-347 |
| D3 | Média-baixa | E-mail do balcão diz "… na entrega" | `supabase/functions/_shared/pedido.ts:96-117`; comprovante.ts:190 |
| D4 | Baixa | Rótulos: `card`→"Cartão de crédito" na ficha; CSV `card`→"Crédito Seguro", `online`→"Outro" | OrderDetail.tsx:121-126; pedidos-csv.ts:7-15 |
| D5 | Baixa | Float: 3 × 1,15 com desconto 3,45 recusado no front | useVendaPresencial.ts:428-430, :481-486 |
| D6 | Baixa | Motivo de desconto fica gravado depois de zerar o desconto | FechamentoDaVenda.tsx:112-119, :183-186; AdminPdvView.tsx:390 |
| D7 | Baixa | Aba Caixa não mostra o estorno em dinheiro que o banco subtrai | 20261177:497-507, :528; `src/lib/financeiro.ts:966-986`; `src/components/admin/financeiro/AbaCaixa.tsx:128-157` |
| D8 | Baixa | Vende em dinheiro com caixa fechado sem avisar | 20261177:475-479 |
| D9 | Baixa (a11y) | Formas sem `aria-pressed`/grupo; desconto sem teclado numérico; fechamento sem foco/rolagem; sem troco | FechamentoDaVenda.tsx:152-188; AdminPdvView.tsx:524-531 |
| D10 | Baixa | Preço muda entre o bipe e o fechamento sem aviso | useVendaPresencial.ts:641, :429; 20261162:309-351, :444-466 |
| D11 | Doc | AGENTS.md :76-79 e `docs/mapa/03-funcionamento.md` :34-35 citam `registrar_pagamento_recebido` no PDV; é `registrar_venda_presencial` | — |
| D12 | Info | PIX manual e maquininha sempre em "Conta bancária" | 20261177:298-306 |

Conferido sem defeito: toque duplo (3 camadas), estoque, `numeric` no servidor, sem rede,
recibo com itens gravados.

## 4. Desenho recomendado (A)

1. **RPC `iniciar_venda_presencial_pix`** (migration): mesmas travas/preço/estoque de
   `registrar_venda_presencial`, mas nasce `pending` / `online` / `aguardando`,
   `expires_at=now()+30 min`, sem `pagamento_recebido_em`; recusa total zero; idempotência por
   canal+vendedor+`online` com **chave própria do PIX** gerada ao tocar "Gerar PIX" (nunca a do
   cupom — senão `registrar_venda_presencial` devolveria um PIX cancelado com `ja_existia`).
2. **Edge `cobrar-pix-no-balcao`** (`verify_jwt` + conferência de admin como
   `supabase/functions/estornar-pagamento/index.ts:135-160`), só pedido presencial+`online`:
   - `gerar`: Orders API com chave = id do pedido; UPDATE condicional grava a cobrança,
     `metodo_online='pix'` e o prazo realinhado; devolve QR, prazo e hora do servidor; se já houver
     cobrança, reconsulta. E-mail do pagador: pedido → conta do cliente → genérico, **nunca** o do
     token do lojista.
   - `cancelar`: cancela no MP; se ok, `update_order_status_atomic(id,'cancelled')` com o JWT do
     admin; se o MP disser pago, responde pago.
   - `conferir`: reconsulta; só com pago e valor ±R$ 0,05 chama `confirmar_pagamento('pago')`.
3. **Tela**: QR ≥256 px em fundo branco, copia-e-cola, valor, "Vence em mm:ss (às HH:MM)" com o
   relógio do servidor, "Aguardando pagamento…" anunciado, consulta a cada 3 s; ao ver `pago`,
   `update_order_status_atomic(id,'delivered')` e recibo; rascunho guarda `{chave, orderId}` para
   retomar; Voltar do celular abre "Trocar forma/cancelar"; cupom só-leitura durante a espera;
   venceu → "Gerar novo PIX" ou "Trocar forma".
4. Depois de pago: Financeiro `venda_balcao` na conta Mercado Pago, forma pix; caixa não muda;
   webhook e reconciliação sem mudança.

Alternativas descartadas: ramo presencial dentro de `criar-pagamento` (mistura autorização,
arrisca o PIX online); QR presencial do MP (loja/caixa cadastrados no MP, webhook de orders `qr`);
BR Code estático sem MP (não confirma sozinho).

## 5. Plano

Parte A — correções sem migration: A1 desconto em centavos; A2 motivo não vaza; A3 rótulo único
de forma (+ CSV); A4 ficha usa o rótulo; A5 e-mail diz "no balcão" (edge
`send-order-confirmation`, RISCO); A6 caixa lê e mostra o estorno em dinheiro; A7 `aria-pressed`,
`inputMode`, foco/rolagem; A8 troco (função pura em centavos + campo, não vai para a RPC); A9 aviso
de caixa fechado (`fin_caixa_atual`); A10 aviso "o total mudou" (opcional); A11 corrigir docs.

Parte B — PIX com QR: B1 migration (`tests/migration_*_test.ts` no molde de
`tests/migration_a_venda_no_balcao_nasce_inteira_test.ts`, rollback); B2 prova viva
`tests/banco/pix-do-balcao-viva.cjs` + passo no `rpc-ci.yml`; B3 cópia de `expiracaoRealinhavel`
em `_shared` com teste de paridade (sem tocar `criar-pagamento`); B4–B7 edge (porta, gerar,
cancelar, conferir) com testes Deno; B8 máquina de estados `aguardando_pix`; B9 opção "PIX com QR"
(grade 2×2); B10 componente `PixDoBalcao.tsx`; B11 view (gerar, consultar/concluir,
cancelar/trocar, retomar); B12 rótulos "PIX (QR) no balcão"; B13 runbook `docs/runbooks/pix-no-balcao.md`
(ordem: migration → edge → front; PIX de R$ 1 no sandbox e em produção; medir e-mail genérico).

Publicação: migration só pelo dono via `aplicar-migrations.yml`; edges por `publicar-functions.yml`;
front por último (sem a migration, o front recebe PGRST202 e mostra "não liberado").

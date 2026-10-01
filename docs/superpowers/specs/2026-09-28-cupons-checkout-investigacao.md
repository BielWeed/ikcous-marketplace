# Cupons no checkout: diagnóstico, spec e plano (28/09/2026)

Investigação só-leitura feita pela sessão coordenadora sobre o commit `f2e907bf` (igual à
`proxima/base`), para a frente B de
[2026-09-28-sessoes-paralelas.md](../plans/2026-09-28-sessoes-paralelas.md). Nada foi executado.
Confira antes de usar.

**Achado principal:** cupom exclusivo de cliente **não existe hoje**. A migration
`20261052000000_o_cupom_exclusivo_vira_exclusivo.sql` e `tests/migration_cupom_exclusivo_test.ts`
só fecharam a leitura pública da tabela ("exclusivo" = "só quem tem o código"). O título "Vantagem
Exclusiva" é só rótulo. Exclusivo de verdade é funcionalidade nova, com banco novo.

## Decisões adotadas (recomendações; o dono pode mudar)

| # | Decisão |
| --- | --- |
| D1 | Cupons que já existem ficam **secretos** (`alcance='codigo'`); nada aparece sem o lojista marcar |
| D2 | Exclusivo para uma **lista** de clientes (tabela `cupom_clientes`) |
| D3 | Deslogado vê os cupons "Todos os clientes"; sem chamada "entre para ver exclusivos" na v1 |
| D4 | **Não** aplicar sozinho; um toque, com o melhor em destaque |
| D5 | Limite por cliente (CUPOM-020) **depois**, em plano próprio |
| D6 | Apagar `used_count` (P4) por último, com trava "só se tudo for 0" |
| D7 | O servidor passa a respeitar "Cupons desligados" |
| D8 | Corrigir a cor da linha "Desconto" do resumo (3,76:1 → AA) |
| D9 | Título da seção: **"Cupons"** |

## 1. Como funciona hoje

- **Seção:** `src/views/customer/CheckoutView.tsx:4186-4206`, só com `config.enableCoupons`
  (4187). Componente `src/components/ui/custom/CouponInput.tsx`: campo sem `<label>` (68-84, id
  `coupon-code-input` usado por testes); "Aplicar" cinza desabilitado (85-91); código em
  maiúsculas (20-25); aplicado vira bloco verde com X (27-55); erro `role="alert"` (93-105). Estado
  `appliedCoupon`/`couponError` (1189-1193), `handleApplyCoupon` (2191-2205), `handleRemoveCoupon`
  (2147-2150), saída "remover_cupom" (2167-2171; classificador `src/lib/recusaDoPedido.ts:121-147`).
- **Hook:** `src/hooks/useCoupons.ts:70-117` chama `validate_coupon_secure_v2`; CRUD do painel
  (119-255). Mapeamento banco→tela triplicado: `useCoupons.ts:36-50`,
  `src/lib/realtimeSyncEngine.ts:191-208`, `src/utils/admin_cache.ts:105-115`.
- **RPC `validate_coupon_secure_v2`:** só no baseline
  (`supabase/migrations/20260806000000_baseline_do_schema_vivo.sql:3714-3754`), SECURITY DEFINER,
  EXECUTE para anon e authenticated (exceção deliberada, `20261090500000:173`). Mensagens:
  inválido/expirado/limite/"Valor mínimo não atingido." (sem dizer quanto). Desconto % ou fixo com
  teto no subtotal.
- **Validação final:** `create_marketplace_order_v23`/`_v24`
  (`20261174000000_formas_de_pagamento_por_loja.sql`; v24 cupom 2318-2366 com `FOR UPDATE`,
  motivos detalhados, total conferido ±R$ 0,05 em 2370-2380, `usage_count + 1` em 2482-2485; v23
  1350-1400 e 1501-1504).
- **Tabela `coupons`** (baseline:3881-3894): `type` fixed|percentage (sem frete grátis), `value`
  sem CHECK, `min_purchase` (subtotal de produtos), `valid_until`, `usage_limit` (NULL/0 =
  ilimitado), `usage_count`, `used_count` morto (P4), `active`, `code` UNIQUE sensível a caixa.
  Não existem: limite por cliente, produto/categoria, descrição, dono, visibilidade. Um cupom por
  pedido. Chave `store_config.enable_coupons` (painel `src/views/admin/AdminCouponsView.tsx:332-432`).
- **RLS:** SELECT em `coupons` só admin; anon/cliente leem 0 linhas (baseline:5478-5492).
- **Do desconto ao pedido:** `CheckoutView.tsx` 1996-1997, 2100, 2518, 2541, 2563;
  `src/hooks/useOrders.ts:3255-3280`; grava `coupon_id`, `coupon_code`, `discount`; aparece em
  "Desconto" (4602-4608), pílula da barra (4701-4708), sucesso (5071-5075), painel
  (`OrderDetail.tsx:742-760`).
- **Depois:** vaga volta ~24h depois de o pedido morrer (20260901:40-56, decisão do dono); rateio
  de devolução `(subtotal - discount)/subtotal` (20261175 :449, 607, 734, 746) — desconto que não
  seja de produto não pode entrar em `discount`; Financeiro pelo `total`; CRM não usa cupom; PDV não
  tem cupom.

## 2. Defeitos

1. (Média) "Exclusivo" sem dono.
2. (Média) O servidor ignora `enable_coupons` (v23/v24 e validação); o rascunho restaura cupom com a
   seção escondida (`CheckoutView.tsx:949-951`, envio 2541).
3. (Média, UX) Recusa por mínimo não diz quanto falta.
4. (Acessibilidade) erro red-500 3,76:1; "-R$ X aplicado" green-600/green-50 3,15:1; linha
   "Desconto" red-500 3,76:1; borda do campo 1,18:1; campo sem `<label>`.
5. (Baixa) Sem "aplicando…"; toque duplo dispara 2 validações.
6. (Baixa) Duas validações por toque (2194 e o efeito 1361-1386).
7. (Baixa) Cupom restaurado aparece "R$ 0,00 aplicado" até revalidar.
8. (Baixa → relevante com exclusivo) Rascunho não amarrado à conta
   (`src/lib/rascunho-do-checkout.ts`; logout não limpa).
9. (Baixa) Validação aberta a anon sem limite de tentativas distingue motivos (oráculo).
10. (Baixa) Sem CHECK de `value` (só o formulário barra).
11. (Baixa) `UNIQUE(code)` sensível a caixa × busca por `UPPER`.
12. (P4) `used_count` morto.
13. Mapeador triplicado.
14. (Borda, fora do escopo) pedido com total R$ 0,00 online.

Conferido e correto: validação final no servidor; teto no subtotal; corrida de uso único fechada
por `FOR UPDATE` (sem prova concorrente no repo); lista de cupons não vaza.

## 3. Desenho

- **`coupons.alcance`** text NOT NULL DEFAULT `'codigo'`: `'codigo'` (secreto), `'vitrine'`
  (aparece para todos), `'exclusivo'` (só as contas escolhidas). O CHECK só aceita `'exclusivo'`
  depois que o gatilho e a validação existirem (migration que liga confere os dois).
- **`cupom_clientes`** (`coupon_id` FK CASCADE, `user_id` FK `profiles(id)` CASCADE, PK dupla):
  RLS SELECT só admin; escrita só pela RPC admin
  `admin_cupom_definir_clientes(p_coupon_id uuid, p_clientes uuid[])` (atômica, teto 500, recusa
  id inexistente). Exclusivo sem destinatário vale para ninguém. Painel nunca seleciona `cpf`.
- **`cupons_do_checkout(p_subtotal numeric)`**: SECURITY DEFINER, `SET search_path = public`,
  STABLE, **LANGUAGE sql**, REVOKE PUBLIC, GRANT anon e authenticated. Devolve
  `codigo, tipo, valor, minimo, valido_ate, exclusivo, aplica, falta, desconto` (sem id,
  `usage_count`, `usage_limit` nem PII); vazio se a loja desligou cupons; só ativos, válidos, não
  esgotados, `vitrine` ou `exclusivo` do `auth.uid()`; cálculo de aplica/falta/desconto no
  servidor, mesma fórmula da v24; `ORDER BY aplica DESC, desconto DESC, falta ASC, valid_until
  NULLS LAST, code LIMIT 20`.
- **Garantia do exclusivo:** gatilho `BEFORE INSERT ON marketplace_orders WHEN (NEW.coupon_id IS
  NOT NULL)` (SECURITY DEFINER, EXECUTE revogado) recusa exclusivo de quem não está na lista com a
  **mesma frase** do "não existe" da v24 (o classificador já trata; nada muda no front); e
  `validate_coupon_secure_v2` (mesma assinatura e JSON) devolve "Cupom inválido ou expirado." para
  exclusivo de outro **antes** de "expirou". Resíduo aceito: v24 ainda diz "expirou" para quem já
  sabe o código de um exclusivo vencido de outra pessoa — mitigado com "Gerar código" aleatório.
- **Tela (celular, só esta seção):** título "Cupons"; lista `<ul aria-label="Cupons
  disponíveis">` com cards (descrição "10% OFF", "Acima de R$ 100,00 · vale até 30/09", código,
  "Você economiza R$ X" + "Aplicar"; ou "Faltam R$ X em produtos" sem botão, nunca `opacity-50`);
  selos "Melhor opção" e "Exclusivo para você"; aplicado no topo com economia e "Remover"; trocar
  cupom; "Ver todos (n)" acima de 3; esqueleto `aria-busy`; erro com "Tentar de novo"; RPC
  inexistente → silêncio (só o campo); campo manual com `<label>` "Tem um código de cupom?",
  atributos de celular e "Aplicando…". Cores AA: erro red-700, economia green-700/green-50 ou
  emerald-700/emerald-50, selo amber-800/amber-50, secundário zinc-600, borda zinc-500; alvos
  `min-h-11`; `role="status"` ao aplicar. Manter no `CouponInput`: id `coupon-code-input`, texto
  "Aplicar", `aria-label="Remover cupom"`, o anel de foco atual (contratos `acess-onda1-*`).
- **Painel:** `AdminCouponFormView` ganha "Quem pode usar" (Quem tiver o código / Todos os clientes
  / Clientes escolhidos, com busca via `get_admin_customers_paged`, chips e "Gerar código"); aviso
  quando "Todos" não tem limite nem validade; salvar em 2 passos com falha fechada; selos na lista.

## 4. Plano (resumo; detalhe de testes na investigação)

Banco (RISCO, revisor + revisor-risco, aplicação só pelo dono, sem BEGIN/COMMIT, com rollback,
tipos à mão, `VERIFICACOES` em `scripts/db-apply.cjs`, prova viva
`tests/banco/cupons-do-checkout-viva.cjs` no `rpc-ci.yml`; numeração **reservada a esta frente: 20261187000000 a
20261194000000** — a faixa 20261184–20261186 é da frente A):
1. `alcance` com CHECK só `codigo|vitrine`;
2. `cupom_clientes` + `admin_cupom_definir_clientes`;
3. gatilho no pedido (inerte até existir exclusivo);
4. validação conhece o dono (rollback recria o corpo do baseline sem diferença);
5. liga `exclusivo` (autoverificação; rollback desativa exclusivos antes de estreitar o CHECK);
6. `cupons_do_checkout`;
7. (D7) loja desligada não dá desconto; 8. (D6) `DROP COLUMN used_count` por último.

Front do checkout: funções puras `src/lib/cupons-do-checkout.ts`; hook
`src/hooks/useCuponsDoCheckout.ts` (PGRST202 → indisponível em silêncio, descarta resposta
atrasada); `src/components/checkout/CartaoDeCupom.tsx`; `src/components/checkout/CuponsDisponiveis.tsx`;
`CouponInput` (label, aplicando, cores AA); integração serial no `CheckoutView` (≈37 testes mocam
`supabase: {}` — o hook engole o erro); rascunho amarrado à conta; D7 no front; D8 cor do
"Desconto".

Painel: `Coupon.alcance` em `src/types/index.ts`; mapeador único `src/lib/cupom-do-banco.ts` nos 3
lugares; `useCoupons` (alcance só quando presente; lista de clientes sem `cpf`);
`AdminCouponFormView` ("Quem pode usar", clientes escolhidos); selos em `AdminCouponsView`;
runbook `docs/runbooks/publicar-cupons-no-checkout.md`.

**Publicação:** migrations 1→6 (a que liga o exclusivo num run separado) → front (checkout novo com
banco antigo degrada para o campo de hoje; painel novo com banco antigo quebra ao salvar, por isso
banco antes) → 7 e 8 a qualquer momento. Rollback de trás para frente.

## Coordenação com o layout de computador

A frente F6 do plano do computador (checkout) listava `CouponInput` como dela: **a dona é a frente
B**. F6 só posiciona a seção no layout de computador e não edita `CouponInput` nem os componentes
novos de cupom. Mudanças em `CheckoutView.tsx` das duas frentes ficam em trechos separados; quem
integra resolve o merge.

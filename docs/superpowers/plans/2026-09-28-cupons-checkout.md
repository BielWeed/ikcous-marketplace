# Frente B — Cupons no checkout: plano executado (28/09/2026)

Pedido do dono (roteiro [sessões paralelas](2026-09-28-sessoes-paralelas.md), frente B): a seção de
cupom do checkout "mais inteligente: detectar os cupons que estão liberados para uso, inclusive os
exclusivos, tudo bonitinho". Ponto de partida: a
[investigação da coordenadora](../specs/2026-09-28-cupons-checkout-investigacao.md) (conferida e
adotada, com os desvios abaixo). Publicação: [runbook](../../runbooks/publicar-cupons-no-checkout.md).

## Decisões adotadas da investigação

D1 (cupons de hoje ficam secretos), D2 (exclusivo para uma LISTA de clientes, `cupom_clientes`),
D3 (deslogado vê a vitrine; sem chamada "entre para ver exclusivos"), D4 (não aplica sozinho; um
toque, melhor em destaque), D5 (limite por cliente fica para depois), D6 (`used_count` morre por
último, com trava "só se tudo for 0"), D7 (o servidor respeita "Cupons desligados"), D9 (título
"Cupons").

## Desvios (e por quê)

- **Duas migrations em vez de oito.** O workflow aplica cada arquivo numa chamada só da API de
  gestão (transação implícita — a prova do próprio workflow é `BEGIN; <arquivo>; ROLLBACK;`), então
  o que a investigação separava para "ligar o exclusivo só depois do gatilho" acontece dentro de UM
  arquivo, na ordem certa, com autoverificação no fim: `20261187000000` (alcance + lista + RPCs do
  painel + gatilho + validação + lista do checkout + D7) e `20261188000000` (P4, `used_count`).
  Faixa usada: dentro da reservada à frente B (20261187–20261194).
- **D7 mora no gatilho**, não em reescrever a v23/v24 (~900 linhas cada): o mesmo `BEFORE INSERT`
  que garante o exclusivo recusa cupom com a loja desligada, com a frase que o classificador do front
  já trata ("O cupom X está desativado pela loja.").
- **D8 (cor da linha "Desconto" do resumo) NÃO foi feita**: fica fora da seção do cupom, e a regra
  desta frente é "no celular, só a seção do cupom muda". Fica para a frente do checkout (F6) ou um
  pedido à parte.

## O que foi feito

Banco (`supabase/migrations/`):

1. `coupons.alcance` (`codigo` | `vitrine` | `exclusivo`, DEFAULT `codigo`).
2. `cupom_clientes` (RLS: só admin lê; sem grant de escrita) + `admin_cupom_definir_clientes`
   (troca atômica, trava o cupom, teto 500, recusa conta inexistente) + `admin_cupom_clientes`
   (nome e e-mail, nunca CPF).
3. Gatilho `tr_cupom_do_pedido_vale_para_quem_compra` (BEFORE INSERT em `marketplace_orders`, só com
   cupom): exclusivo de outra conta (ou de convidado) → "O cupom X não existe. Confira o código.";
   loja desligada → "O cupom X está desativado pela loja.".
4. `validate_coupon_secure_v2` (mesma assinatura/JSON/grants): exclusivo de outra conta responde
   "Cupom inválido ou expirado." ANTES de qualquer outro motivo; corte de validade `<=` (igual à
   v24); a recusa por mínimo diz quanto falta; loja desligada recusa.
5. `cupons_do_checkout(p_subtotal)`: só ativos, válidos, não esgotados, e só `vitrine` ou
   `exclusivo` da própria conta; devolve `codigo, tipo, valor, minimo, valido_ate, exclusivo, aplica,
   falta, desconto` (sem id, contadores nem pessoa); EXECUTE para anon e authenticated.
6. `20261188000000`: `DROP COLUMN used_count` com trava.

Front do checkout (só a seção do cupom muda no celular):

- `src/lib/cupons-do-checkout.ts` (leitura defensiva + textos), `src/hooks/useCuponsDoCheckout.ts`
  (pausa no subtotal, descarta resposta atrasada, troca de conta limpa na hora, PGRST202 → só o
  campo), `src/components/checkout/CuponsDoCheckout.tsx` (cartões, melhor opção, exclusivo, "faltam
  R$ X" com barra, aplicado no topo com economia e Remover, "Ver mais", esqueleto, erro com "Tentar
  de novo"), `CouponInput` (rótulo, "Aplicando…", cores AA, "Conferindo o desconto…" no lugar de
  "R$ 0,00 aplicado").
- `CheckoutView`: um toque valida UMA vez (antes, duas); toque duplo travado; o rascunho da sessão
  só devolve o cupom para a MESMA conta (espera a autenticação); trocar de conta tira o cupom; loja
  desligada tira o cupom.

Painel:

- "Quem pode usar" no formulário (Quem tiver o código / Todos os clientes / Clientes escolhidos,
  com busca por `get_admin_customers_paged`, sem CPF), "Gerar" código aleatório, aviso de vitrine
  sem limite nem validade; salvar em dois passos com falha fechada; selos "No checkout"/"Exclusivo"
  na lista; mapeador único `src/lib/cupom-do-banco.ts` nos três lugares que tinham cópia.

## Verificação

Prova viva `tests/banco/cupons-do-checkout-viva.cjs` (entra no `rpc-ci.yml`), vitest dos arquivos
novos e vizinhos, typecheck, lint ratchet, build fixture + size, harness visual do checkout. Saídas
reais no corpo do PR.

## Fora desta frente

D5 (limite por cliente), defeitos 9–11 e 14 da investigação (oráculo da validação para anon, CHECK
de `value`, `UNIQUE(code)` sensível a caixa, pedido de R$ 0,00 online), D8.

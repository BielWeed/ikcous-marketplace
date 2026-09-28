# Publicar os cupons no checkout (frente B, 28/09/2026)

Passo a passo para o **dono** publicar a seção nova de cupons do checkout. Ninguém mais aplica
nada no banco da loja. Investigação e desenho:
[spec da investigação](../superpowers/specs/2026-09-28-cupons-checkout-investigacao.md) ·
[plano da frente](../superpowers/plans/2026-09-28-cupons-checkout.md).

O que sobe:

| Ordem | O quê | Arquivo |
|---|---|---|
| 1 | Alcance do cupom, lista de clientes do exclusivo, gatilho do pedido, validação que conhece o dono, lista do checkout | [`20261187000000_o_checkout_mostra_os_cupons_da_cliente.sql`](../../supabase/migrations/20261187000000_o_checkout_mostra_os_cupons_da_cliente.sql) |
| 2 | Apaga a coluna morta `coupons.used_count` (política P4) | [`20261188000000_o_contador_duplicado_do_cupom_morre.sql`](../../supabase/migrations/20261188000000_o_contador_duplicado_do_cupom_morre.sql) |
| 3 | O front (checkout + painel) | deploy normal da Vercel |

**Banco antes do front.** Com o banco novo e o front antigo, nada muda para ninguém (todo cupom que
já existe nasce "Quem tiver o código"; a validação mantém a assinatura). Com o front novo e o banco
antigo, o checkout só mostra o campo de digitar (sem lista, sem aviso), mas o painel **falha ao
salvar** um cupom em que o lojista mudou "Quem pode usar" — por isso o banco vai primeiro.

**Não marque nenhum cupom como "Clientes escolhidos" antes do passo 3 (front) estar no ar.** O
checkout antigo guarda o código do cupom no rascunho da aba sem dizer de quem ele é: outra conta
que entrar na mesma aba veria o código (não conseguiria usar — o banco recusa —, mas veria).

**Resíduo conhecido (revisão de risco, B1):** quem não está na lista de um exclusivo e digita o
código dele no pedido pode receber o motivo real da recusa ("exige compra mínima de R$ X",
"expirou", "atingiu o limite", "está desativado") em vez de "não existe" — a mensagem vem da
`create_marketplace_order_v24`, que roda antes do gatilho. Isso só revela que o código existe; o
gatilho continua impedindo o uso. Por isso, para exclusivo, use o botão **Gerar** (código
aleatório, difícil de adivinhar). Fechar isso exige reescrever a v24 — fica para um pedido à parte.

## 1. Migration 20261187000000

GitHub → Actions → **Aplicar migrations (Supabase)** → Run workflow:

- `migracoes`: `20261187000000_o_checkout_mostra_os_cupons_da_cliente.sql`
- `projeto`: `loja`

O workflow roda a prova (`BEGIN; …; ROLLBACK;`) e depois aplica. O próprio arquivo tem uma
autoverificação no fim: se o gatilho não ficar de pé, ou se algum grant sair diferente, ele explode
e nada fica gravado (o arquivo inteiro é uma transação).

**Conferir** (SQL Editor do projeto da loja — só leitura):

```sql
-- todos os cupons de hoje continuam secretos (esperado: uma linha, 'codigo')
SELECT alcance, count(*) FROM public.coupons GROUP BY alcance;

-- o gatilho existe (esperado: 1)
SELECT count(*) FROM pg_trigger
 WHERE tgname = 'tr_cupom_do_pedido_vale_para_quem_compra';

-- anon executa a lista do checkout e NÃO executa as RPCs do painel
-- (esperado: t, f, f)
SELECT has_function_privilege('anon', 'public.cupons_do_checkout(numeric)', 'EXECUTE'),
       has_function_privilege('anon', 'public.admin_cupom_definir_clientes(uuid, uuid[])', 'EXECUTE'),
       has_function_privilege('anon', 'public.admin_cupom_clientes(uuid)', 'EXECUTE');
```

Nada aparece no checkout até o lojista marcar um cupom como "Todos os clientes" ou "Clientes
escolhidos" no painel (Cupons → editar → **Quem pode usar**).

## 2. Migration 20261188000000 (run separado, a qualquer momento depois)

Mesmo workflow, `migracoes`: `20261188000000_o_contador_duplicado_do_cupom_morre.sql`.

Trava: se alguma linha tiver `used_count` diferente de 0, o arquivo recusa e **não apaga nada** —
nesse caso, pare e me chame (alguém gravou nessa coluna por fora).

Conferir: `SELECT column_name FROM information_schema.columns WHERE table_name = 'coupons';`
— `used_count` não aparece mais.

## 3. Front

Deploy normal. Teste de fumaça no celular, com uma conta de teste:

1. Painel → Cupons → um cupom de teste → **Quem pode usar: Todos os clientes** → salvar. Abrir o
   checkout **sem conta**: o cartão aparece com "Aplicar".
2. Outro cupom de teste → **Clientes escolhidos** → adicionar a conta de teste → salvar. Entrar
   com essa conta: o cartão aparece com "Exclusivo para você". Entrar com **outra** conta: o cartão
   não aparece, e digitar o código responde "Cupom inválido ou expirado.".
3. Aplicar um cupom com um toque, conferir "Você economiza R$ X" e a linha "Desconto" do resumo;
   "Remover" tira.

## Rollback (de trás para frente)

- Front: redeploy da versão anterior na Vercel.
- 20261188: [`rollback-manual-20261188000000_o_contador_duplicado_do_cupom_morre.sql`](../../supabase/migrations/rollback-manual-20261188000000_o_contador_duplicado_do_cupom_morre.sql)
  (recria a coluna com 0).
- 20261187: [`rollback-manual-20261187000000_o_checkout_mostra_os_cupons_da_cliente.sql`](../../supabase/migrations/rollback-manual-20261187000000_o_checkout_mostra_os_cupons_da_cliente.sql).
  **Antes de rodar:** ele DESATIVA todo cupom exclusivo (senão, sem a regra do dono, o código
  passaria a valer para qualquer um) e os cupons "Todos os clientes" somem do checkout.
  **Atenção ao reativar:** depois do rollback (e mesmo se a 20261187 for reaplicada), os
  ex-exclusivos voltam como "Quem tiver o código" — reativar um deles o abre para QUALQUER pessoa
  que tenha o código. Só reative o que pode ser público, ou reaplique a migration e marque de novo
  "Clientes escolhidos" com a lista antes de reativar.

Os rollbacks não passam pelo workflow (ele só aceita nomes `AAAAMMDDHHMMSS_*.sql`): rode no SQL
Editor, arquivo inteiro de uma vez.

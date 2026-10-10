# Integração da RPC do pedido: frete nacional (20261171) + CPF (20261172)

Ordem da central (23/09/2026): a `20261171000000_o_frete_nacional_ganha_estrategia_propria.sql`
(esta branch, `feat/local-national-shipping-strategies-20260923`) é a do frete nacional. A
migration do CPF da frente cart-ux (`ikcous-cart-ux-wt`) passa a ser `20261172000000` e
**depende** da 20261171 — as duas substituem os MESMOS corpos de
`create_marketplace_order_v23` e `_v24`.

## O que a 20261172 (CPF) tem de fazer

1. **Partir dos corpos da 20261171, nunca dos da 20261170.** Os corpos-base estão nos dois
   `CREATE OR REPLACE FUNCTION public.create_marketplace_order_v2{3,4}` da 20261171. Aplicar a
   mudança do CPF por *splice* cirúrgico nesse texto (só as linhas do CPF — ex.: o
   `jsonb_build_object` do `customer_data` no passo 7). Partir da 20261170 APAGA, sem erro nenhum,
   a regra nacional: o frete local voltaria a zerar transportadora e o carimbo
   `estrategiaNacional` deixaria de ser conferido.
2. **Preflight por hash aceitando os corpos da 20261171** (LF e CRLF) — e os corpos novos da
   própria 20261172, para a reaplicação:

   | função | 20261171 LF | 20261171 CRLF |
   |---|---|---|
   | `create_marketplace_order_v23` | `41a6d704029cf80efc2f803740352fd6b5d7e5797c83c3a783edab76ee677836` | `5b26a261ac9a92dad38ce6582d70f2fd7b36ee9def5c5b60dc2eb9cb795ad5a5` |
   | `create_marketplace_order_v24` | `e1dfc5ee59b7cf42f85b4c226204fc2330bcc2d4bf2e5686ce9b7f577ca4fef5` | `4bc424e88f82dd09268679c58519d644293084bf552df4b33b67af380d065cee` |

   ⚠️ Estes hashes valem para o commit da 20261171 que for congelado após a revisão Opus. Se a
   revisão mudar a SQL, esta tabela é atualizada no mesmo commit. Conferir no PR antes de copiar.

   Atualizado em 23/09/2026 (correções da T1 após revisão Opus, veredito CORRIGE): o carimbo
   `estrategiaNacional` presente mas não-objeto (`null`/campo faltando) deixou de ser tratado
   como "presente e comparado", e passou a exigir `jsonb_typeof(...) = 'object'` +
   `COALESCE(comparação, false)` antes de aceitar; e a estratégia `acima_de_valor`/
   `desconto_na_mais_barata` com mínimo > 0 passou a exigir também `subtotalCotacao` do MESMO
   lado do mínimo que o subtotal atual (campo novo, gravado pela edge em toda opção carimbada).
   Isso reescreveu o corpo de `create_marketplace_order_v23`/`_v24` — os hashes acima são os
   NOVOS (pós-correção); os hashes anteriores à correção NÃO valem mais para basear a 20261172.
3. **Não mexer** no bloco 4 (frete) nem no 2-ter; não mudar a assinatura (13 argumentos — mudar
   cria overload e perde o GRANT).
4. **Rollback-manual da 20261172** = os corpos EXATOS da 20261171 (não os da 20261170).
5. Entrada própria no `VERIFICACOES` do `scripts/db-apply.cjs`, sem remover a da 20261171.

## Estado medido da 20261172 (23/09/2026, leitura do `ikcous-cart-ux-wt`, NÃO commitada)

Três bloqueios, avisados à sessão dona por mensagem direta:
1. **Base errada:** corpos e preflight da 20261170 (0 ocorrências de `estrategiaNacional`) —
   aplicada depois da 20261171, apagaria a regra nacional sem erro.
2. **`DROP FUNCTION` + assinatura de 14 argumentos (`p_customer_cpf`):** perde os GRANTs vivos
   (função recriada nasce com EXECUTE para PUBLIC) e quebra o PWA antigo aberto no celular, que
   chama a de 13 argumentos — todo pedido de quem não atualizou falharia. Caminho sem mudar
   assinatura: CPF dentro de `p_address_data->>'cpf'` (jsonb já existente). Se a assinatura nova
   ficar: overload de 13 argumentos para o app velho + GRANTs reproduzidos a partir do
   `pg_catalog` vivo das DUAS lojas.
3. **Sem ensaio de banco do CPF** (só testes de tela).

## Teste conjunto obrigatório antes de qualquer aplicação

`node tests/frete-estrategias-database/run.cjs --com-migration <caminho da 20261172>` (Postgres
efêmero; aplica a raiz inteira + a migration extra por cima) deve dar 100% verde e rodar os casos
conjuntos:
- os casos nacionais inteiros continuam verdes com a 20261172 por cima (o CPF não apagou a regra);
- `v24` nacional com `desconto_na_mais_barata` (cheio 24,90 → `price` 21,16) + CPF → total =
  subtotal + 21,16 e `customer_data.cpf` com 11 dígitos;
- `v24` nacional escolhendo a opção NÃO mais barata → cobra o preço cheio dela (desconto só na
  escolhida quando ela é a beneficiada);
- chamada com a assinatura de 13 argumentos (app velho) continua criando pedido.

## Ordem de aplicação por loja (quando autorizada, nunca antes)

20261170 → 20261171 → 20261172 → edge `calculate-shipping` desta branch → front. Nenhuma `db
push`: `node scripts/db-apply.cjs <basename>` por arquivo, com o rollback-manual provado antes.

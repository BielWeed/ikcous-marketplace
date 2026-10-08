# tests/banco — contrato do DINHEIRO provado em CI (rpc-ci.yml)

Suíte da frente **CI-CONTRATO-DINHEIRO** (14/09/2026): prova o COMPORTAMENTO
das funções SQL que guardam dinheiro contra um Postgres **efêmero** criado
pelo job do [.github/workflows/rpc-ci.yml](../../.github/workflows/rpc-ci.yml)
— nada de lint de existência: as migrations são aplicadas DO ZERO e as
invariantes abaixo são executadas contra o banco que nasceu delas.

## As provas (`invariantes-dinheiro.cjs`)

- **(a) cupom**: `usage_limit` nunca fica negativo; a vaga do cupom não volta
  duas vezes para o mesmo pedido (`devolver_cupons_de_pedidos_mortos` é
  idempotente pelo fato `coupon_usage_returned`), não volta no cancelamento
  (só depois do PIX morto) e volta usável para o próximo pedido.
- **(b) cancelamento duplo**: cancelar o pedido duas vezes não devolve
  estoque em dobro (`stock_returned_at`) nem abre estorno em dobro (ledger
  `order_refunds`); a 2ª tentativa do dono do pedido é recusada com exceção;
  o re-cancelamento pelo admin não dobra nada.
- **(c) resolver_loja**: só resolve host ATIVO da frota com a chave certa;
  host sem sensibilidade a maiúscula; inativo e chave errada devolvem zero
  linhas (sem oráculo).

- **pagamentos (`pagamentos-rpc-viva.cjs`, via `rodar-isolado.cjs`)**:
  `confirmar_pagamento` e `registrar_pagamento_recebido` — transições,
  estoque devolvido uma vez, expiração, permissão por papel e corridas com
  duas conexões reais (a 2a espera o `FOR UPDATE`).
- **admin atual (`admin-atual-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration 20261197000000 — admin rebaixado com JWT de admin ainda válido
  (só no `profiles`, só no `auth.users`, nos dois) é recusado nas seis RPCs
  de dinheiro sem escrever nada, e a RLS de `marketplace_orders`/
  `order_refunds` não mostra a ele linha alheia; controle sem a guarda (e
  com a política antiga) escreve/vaza; rollback byte a byte e preflights
  recusando sem escrita. A prova concede `USAGE` no schema `auth` a
  anon/authenticated/service_role **no clone** (o Supabase real concede; o
  `provisionar.cjs` não).

- **cupons desligados (`cupons-desligados-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration 20261203000000 — com `store_config.enable_coupons IS FALSE` nenhum
  pedido novo nasce com cupom (gatilho BEFORE INSERT em `marketplace_orders`,
  pela v24 e pela v23) e `validate_coupon_secure_v2` recusa com o motivo; chave
  ligada, NULL ou sem linha segue como antes; o retry idempotente de pedido
  criado antes devolve o mesmo pedido; ACL igual antes/depois, rollback byte a
  byte e mutantes (sem gatilho, `IS NOT TRUE`, validação sem a checagem) pegos.
- **portão dos cupons desligados (`cupons-desligados-portao-viva.cjs`, via
  `rodar-isolado.cjs`)**: as consultas `10a-conferir-cupons-desligados-aplicado`
  (DEPOIS do apply, 21 linhas) e `10b-antes-cupons-desligados-gatilho-e-corpo`
  (ANTES, 6 linhas), que são a "prova de objetos" do lote 20261203000000 em
  `scripts/frota/canais-de-backend.json`, executadas como papel de leitura num
  Postgres real e levadas até o portão (`evidenciaDaProva` e `decidirLote`).
  Monta o SEU banco-base **sem** a migration (a 10b positiva ali), aplica o
  ARQUIVO dela de verdade (LF e CRLF; a 10a positiva e igual à da árvore
  inteira) e prova um defeito por vez — gatilho ausente, desabilitado, sem
  `WHEN`, em outro evento, corpo da validate ou do gatilho com 1 byte a mais,
  função sem `search_path`, `EXECUTE` para PUBLIC, índice único ausente ou de
  outra forma — cada um reprovando a SUA linha e levando o portão a NEGATIVA;
  13 mutantes do texto das consultas ficam vermelhos; resposta parcial ou
  duplicada tem `rol=invalido`; erro de SQL nunca vira positivo; o
  `conferir-banco.cjs` de verdade (processo filho, HTTP local) e o lote do
  `canais-de-backend.json` real fecham em APLICAR / NADA / PARAR. **Não prova**
  a IKCOUS nem a Savy (só o run da consulta contra o ref de cada loja prova) e
  não mede o `supabase_read_only_user` nem o Postgres 15 da Supabase.

## Como rodar

**SÓ no CI** (regra do dono, 14/09: suíte de banco não roda na máquina do
dono). A receita inteira está no workflow:

1. service `postgres:17` do próprio job (efêmero, morre no fim);
2. `node tests/banco/provisionar.cjs` — emula a fábrica do Supabase: papéis
   anon/authenticated/service_role, default privileges, contrib no schema
   `extensions` (pgcrypto para o `extensions.crypt` da `resolver_loja`),
   `auth.*` (o `auth.uid()` daqui lê o GUC `app.rpc.user_id`, que é o "login"
   da prova), publication de realtime, storage mínimo e **pg_cron emulado por
   stub** (agendamentos registram, nada dispara);
3. `node tests/banco/aplicar-migrations.cjs supabase/migrations` — aplica a
   raiz inteira do zero; as duas linhas `CREATE EXTENSION ... pg_cron/pg_net`
   viram comentário (stub já de pé), todo o resto aplica nativo;
4. `node tests/banco/invariantes-dinheiro.cjs` — as provas.

Trava de segurança (`efemero.cjs`): a suíte RECUSA rodar sem
`CI_BANCO_EFEMERO=1` e com `DATABASE_URL` fora de localhost — este diretório
**nunca** aponta para banco real, e dinheiro em teste é dado de FIXTURE.

## Custódia

Arquivos desta pasta são da frente CI-CONTRATO-DINHEIRO. A receita de
provisionamento é a mesma da frente ci-banco (`scripts/ci/banco/`, PR #585),
reesrita autocontida — com três diferenças documentadas no cabeçalho do
`provisionar.cjs` (auth.uid() lendo GUC, auth.users com raw_app_meta_data e
o stub do pg_cron), todas necessárias para PROVAR comportamento, não só
aplicação.

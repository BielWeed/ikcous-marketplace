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

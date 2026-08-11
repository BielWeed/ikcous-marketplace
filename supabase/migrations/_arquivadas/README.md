# Migrations arquivadas — NÃO restaurar sem ler isto

Estes 44 arquivos foram movidos para cá em **05/08/2026**, pela decisão registrada
em [`ADR 0002`](../../../docs/decisoes/0002-baseline-do-ledger-de-migrations.md)
(`BANCO-050` #42, `BANCO-030` #112).

**Eles não estão aqui porque são inúteis. Estão aqui porque são perigosos.**

## Por que saíram de `supabase/migrations/`

Medido em 05/08/2026 com `node scripts/db-reconcilia-ledger.cjs`:

- **A fila não era fila de deploy.** Das 41 versões, 22 não continham função
  alguma, e **19 de 33 pares função/arquivo tinham corpo idêntico ao que já está
  vivo no banco** — ou seja, já haviam sido aplicadas sob outro timestamp.

- **Aplicá-las desmontaria o RLS.** Somadas: **309 `DROP POLICY` contra 209
  `CREATE POLICY`** e 129 `REVOKE`, sobre **71 policies vivas**. Saldo de −100.

- **E nem completaria.** `20260708150000_database_deep_cleanup_and_optimization.sql`
  faz `CREATE OR REPLACE` de `generate_order_otp_v1` com `RETURNS TEXT`, enquanto
  a função viva retorna `boolean`, e não há `DROP` antes. O Postgres recusa com
  *cannot change return type* e aborta **ali** — depois de já ter derrubado
  policies, e sem chegar no que as reconstrói.

Enquanto estavam no diretório principal, um `supabase db push` acidental
executava isso. Hoje o push é no-op.

## Quatro regressões conhecidas aqui dentro

Nomeadas na #112, e o motivo de "é só rodar" nunca ter sido verdade:

| arquivo | o que reintroduz |
| --- | --- |
| `20260703080000_optimize_remaining_rls.sql` | muda a fonte de verdade do `is_admin` de JWT para `profiles.role`, com 57 policies dependentes |
| `20260708080000_add_shipping_api_config.sql` | reintroduz o `upsert_store_config` que apaga a config da loja |
| `20260712230000_add_local_shipping_config.sql` | idem |
| `20260708190000_secure_otp_flow.sql` | reverte a URL do OTP para o projeto principal |

## Os dois sem timestamp

`add_user_id_to_orders.sql` e `favorites_migration.sql` não têm prefixo de
versão. O CLI do Supabase **nunca os aplicaria** — eram peso morto que parecia
dívida.

## Para que servem agora

São a **única pista** do que aconteceu com este banco em julho de 2026. As 28
versões do ledger sem arquivo já são ilegíveis para sempre; estas não precisam
ser. Leia para entender *por que* uma policy é como é — não para replicar.

Vários deles têm `BEGIN`/`COMMIT` embutido, o que faz o `ROLLBACK` de um script
de prova virar no-op e **gravar em produção**. Se for rodar qualquer coisa daqui
em teste, tire a transação primeiro.

## Se você acha que precisa restaurar um

Não restaure para o diretório principal. Copie o trecho que interessa para uma
migration nova, com timestamp novo, e siga o § 9 do
[`03-SETUP-AMBIENTE.md`](../../../docs/onboarding/03-SETUP-AMBIENTE.md) —
confirmar o backup do dia, fotografar as policies, ensaiar na cópia.

---
description: Cria uma migration Supabase com RLS/search_path corretos, valida e regenera os tipos
argument-hint: <descricao_snake_case>
---

# Nova migration: $ARGUMENTS

## 1. Nome e cabeçalho
- Caminho: `supabase/migrations/<YYYYMMDDHHMMSS>_$ARGUMENTS.sql`
- O padrão real do repo é contador sequencial no dia: `20260715000000`, `...000001`, `...000002`. Confira o último arquivo:
  ```
  ls supabase/migrations | tail -5
  ```
- **Cheque colisão de prefixo** (já existe uma no repo, em `20260708020000`):
  ```
  ls supabase/migrations | cut -c1-14 | sort | uniq -d
  ```
- Cabeçalho de 3 linhas + transação:
  ```sql
  -- Migration: <título em inglês>
  -- Date: YYYY-MM-DD
  -- Version: <mesmo timestamp do nome do arquivo>
  BEGIN;
  ...
  COMMIT;
  ```
- **Nunca edite migration existente.** Correção entra como arquivo novo.

## 2. Regras invioláveis de segurança
Modelo de referência para copiar: `supabase/migrations/20260708230000_optimize_is_admin_rls.sql`.

- Tabela nova → `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` **no mesmo arquivo** que a cria.
- Policies separadas por ação (`FOR SELECT`/`INSERT`/`UPDATE`/`DELETE`), nome `<tabela>_<escopo>_<acao>_policy`, minúsculo e sem aspas.
- Antes de criar, bateria de `DROP POLICY IF EXISTS` com todos os nomes históricos daquela tabela (idempotência).
- **Toda** chamada de função em `USING`/`WITH CHECK` vem em subselect: `(SELECT public.is_admin())`, `(SELECT auth.uid())`, `(SELECT auth.role())`. Sem isso o linter acusa `auth_rls_initplan`.
- Admin é sempre `public.is_admin()`. Nunca `EXISTS (SELECT 1 FROM profiles WHERE ... role='admin')` — isso causa recursão de RLS.
- Posse: `((SELECT auth.uid()) = user_id)` — exceto `notificacoes` (`usuario_id`) e `profiles` (`id`).
- Toda função `SECURITY DEFINER` declara `SET search_path = public` (ou `public, auth` se ler `auth.users`; `public, extensions` se usar pgcrypto/pg_net).
- RPC de admin faz o gate **dentro** da função (`IF NOT public.is_admin() THEN RAISE EXCEPTION ...`); o GRANT fica em `authenticated`.
- Função de trigger: `REVOKE EXECUTE ... FROM PUBLIC, ANON, AUTHENTICATED`.
- **Nunca** revogue `EXECUTE` de `is_admin()` de `anon` — as policies públicas de banners/coupons/produtos chamam a função; isso já derrubou produção e só foi corrigido em `20260709003000_grant_is_admin_to_anon.sql`.
- View pública nova: `WITH (security_invoker = on)` + `GRANT SELECT TO anon, authenticated, service_role`. Exceção deliberada: `vw_produtos_public` NÃO tem security_invoker (ver `20260713000000`).

## 3. Realtime (se a UI precisa reagir a mudanças)
Bloco `DO $$` idempotente checando `pg_publication_tables` antes de `ALTER PUBLICATION supabase_realtime ADD TABLE public.<t>` — copie de `supabase/migrations/20260708020000_enable_realtime_for_monitored_tables.sql`. Sem isso, `postgres_changes` simplesmente não dispara.

## 4. Lint da migration
```
python -m sqlfluff lint supabase/migrations/<arquivo>.sql --dialect postgres
supabase db lint
```
`npm run sqlfluff:lint` está QUEBRADO (o binário não está no PATH) — use a forma acima.

Validador estático do manager (RLS + search_path), rodando de `manager-claude/`:
```
python -c "from src.database.supabase_validator import validate_migration_file; print(validate_migration_file(r'<caminho absoluto do .sql>'))"
```
Ele valida **um arquivo por vez**; não rode sobre o histórico (20 migrations antigas reprovam legitimamente).

## 5. Depois de aplicar: regenerar os tipos
- Gere via **Supabase MCP** e salve em `src/types/database.types.ts` (não existe npm script para isso).
- `src/types/supabase.ts` é cópia órfã e byte-a-byte idêntica — ou espelhe, ou apague; não deixe divergir.
- `npx tsc -b` — é o único gate que pega divergência de schema, já que os mappers usam `any` e nunca lançam.

## 6. Se a mudança afeta o cache offline
Entidade nova que a UI lê exige:
- store no DataVault: acrescentar ao union `StoreName` (`src/lib/dataVault.ts:19`), criar **`MIGRATIONS[3]` nova** (nunca editar `MIGRATIONS[1]`, que já rodou nas máquinas dos usuários) e incrementar `DATA_VAULT_VERSION`;
- entrada em `TABLE_CONFIGS` (`src/lib/realtimeSyncEngine.ts:56`);
- **mapper coerente nos 3 lugares** onde a tradução DB→domínio está duplicada: `TABLE_CONFIGS[].mapRecord`, `hydrateAllStores` (`src/hooks/useDataVault.ts`) e o mapper inline do hook. O bug de banner que perde texto/cores sozinho vem exatamente daí;
- hook em `src/hooks/` no padrão SWR (vault → rede → `replaceAll` → `setLastSync`), modelo: `src/hooks/useCategories.ts:20-51`.

Coluna nova em tabela existente: escrita monta `dbUpdates` campo a campo (`if (updates.x !== undefined) dbUpdates.snake_name = updates.x`) — nunca spread do objeto de domínio. Schema mistura português (catálogo: `produtos.nome/preco_venda/estoque`) e inglês (marketplace: `subtotal/shipping_cost`); confira o nome real em `src/types/database.types.ts`.

## 7. Fechamento
- Delete de produto é SOFT (`deleted_at` + `ativo:false`) — toda query admin nova precisa de `.is("deleted_at", null)`.
- A migration vai ser propagada para os clones (`supabase/migrations/` é sincronizada): ela não pode assumir dados já seedados no banco do Core.
- Rode `/checar` antes de encerrar.

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
- **Cheque colisão de prefixo.** Hoje não há nenhuma viva — a única que já existiu
  (`20260708020000`) está arquivada em `supabase/migrations/_arquivadas/`, então não sirva
  mais de exemplo de colisão real. Rode assim mesmo: é a defesa mais barata contra pegar o
  mesmo timestamp que outra frente aplicou minutos antes, na mesma árvore compartilhada.
  ```
  ls supabase/migrations | grep -v '^rollback-manual-' | grep -v '^_arquivadas$' | cut -c1-14 | sort | uniq -d
  ```
- **Sem `BEGIN`/`COMMIT` de nível superior no arquivo.** É a regra da casa (AGENTS.md:
  "Migration não leva BEGIN/COMMIT. Com eles, o ROLLBACK do script de prova vira no-op e a
  mudança fica gravada.") e já causou incidente real em produção. Quem abre a transação é
  quem aplica: `scripts/db-apply.cjs` (`BEGIN` → roda o arquivo → `COMMIT`, com `ROLLBACK`
  automático se algo falhar no meio). Um `COMMIT` embutido no arquivo fecha essa transação
  ANTES da hora — o `ROLLBACK` de erro do script vira no-op e o resto do arquivo roda em
  autocommit. Nenhuma das ~96 migrations vivas do repositório usa `BEGIN`/`COMMIT`; os ~77
  arquivos que ainda usam estão todos em `supabase/migrations/_arquivadas/` (schema antigo,
  não copie de lá).
- **Cabeçalho longo, não 3 linhas.** O molde real é
  `supabase/migrations/20261150000000_a_loja_declara_a_sua_configuracao_publica.sql` — leia
  esse arquivo inteiro antes de escrever o seu. Ele conta, nesta ordem, em comentário `--`
  (nunca `BEGIN`/`COMMIT`, nunca bloco `/* */` de nível superior — só linha `--`, para não
  confundir com string/dollar-quote de função):
  1. **O defeito que esta migration fecha** — o sintoma medido, não a solução.
  2. **O que ela faz, na ordem** — cada `ALTER`/`CREATE`/`DROP`, numerado, com o "porquê"
     de cada decisão (tipo da coluna, default, ordem das colunas na view, `WHEN` do
     trigger).
  3. **Dados existentes** — o que acontece com as linhas que já existem (`NULL`? default?
     nenhuma linha é lida/reescrita?).
  4. **Idempotência** — por que reaplicar o arquivo dá o mesmo estado
     (`IF NOT EXISTS`/`OR REPLACE`/`DROP ... IF EXISTS` seguido de `CREATE`).
  5. **Fora do escopo** — o que essa migration deliberadamente não faz (aplicar de
     verdade, semear dado, código que passa a ler a coluna nova — essas partes ficam para
     outro passo/PR).
  6. **Como aplicar** — `node scripts/db-apply.cjs <arquivo.sql>` (ou `psql -1`), citando
     explicitamente "sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa)".
  7. **Ficha de verificação** pós-aplicação — consultas/`SELECT`s numerados que qualquer
     pessoa roda à mão contra o banco para conferir que a migration fez o que prometeu.
  8. **Rollback** — nome do arquivo (`rollback-manual-<mesmo nome>.sql`, ver seção 4) e um
     resumo de uma linha do que ele desfaz, na ordem inversa.
- **Nunca edite migration existente.** Correção entra como arquivo novo.

## 2. Regras invioláveis de segurança
Modelo de referência para copiar: `supabase/migrations/20261031000000_a_moderacao_ativa_e_real.sql` (o exemplo antigo, `20260708230000_optimize_is_admin_rls.sql`, foi arquivado em `supabase/migrations/_arquivadas/`).

- Tabela nova → `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` **no mesmo arquivo** que a cria.
- Policies separadas por ação (`FOR SELECT`/`INSERT`/`UPDATE`/`DELETE`), nome `<tabela>_<escopo>_<acao>_policy`, minúsculo e sem aspas.
- Antes de criar, bateria de `DROP POLICY IF EXISTS` com todos os nomes históricos daquela tabela (idempotência).
- **Toda** chamada de função em `USING`/`WITH CHECK` vem em subselect: `(SELECT public.is_admin())`, `(SELECT auth.uid())`, `(SELECT auth.role())`. Sem isso o linter acusa `auth_rls_initplan`.
- Admin é sempre `public.is_admin()`. Nunca `EXISTS (SELECT 1 FROM profiles WHERE ... role='admin')` — isso causa recursão de RLS.
- Posse: `((SELECT auth.uid()) = user_id)` — exceto `notificacoes` (`usuario_id`) e `profiles` (`id`).
- Toda função `SECURITY DEFINER` declara `SET search_path = public` (ou `public, auth` se ler `auth.users`; `public, extensions` se usar pgcrypto/pg_net).
- RPC de admin faz o gate **dentro** da função (`IF NOT public.is_admin() THEN RAISE EXCEPTION ...`); o GRANT fica em `authenticated`.
- Função de trigger: `REVOKE EXECUTE ... FROM PUBLIC, ANON, AUTHENTICATED`.
- **Nunca** revogue `EXECUTE` de `is_admin()` de `anon` — as policies públicas de banners/coupons/produtos chamam a função; isso já derrubou produção e só foi corrigido em `20260709003000_grant_is_admin_to_anon.sql` (histórico — hoje arquivado em `supabase/migrations/_arquivadas/`, mas o incidente e a regra continuam valendo).
- View pública nova: `WITH (security_invoker = on)` + `GRANT SELECT TO anon, authenticated, service_role`. Exceção deliberada: `vw_produtos_public` NÃO tem security_invoker (decisão registrada em `20260713000000`, hoje arquivado em `supabase/migrations/_arquivadas/`; a view viva sem `security_invoker` está em `supabase/migrations/20260806000000_baseline_do_schema_vivo.sql`).

## 3. Realtime (se a UI precisa reagir a mudanças)
Bloco `DO $$` idempotente checando `pg_publication_tables` antes de `ALTER PUBLICATION supabase_realtime ADD TABLE public.<t>` — copie de `supabase/migrations/20261061000000_a_publication_nasce_no_repositorio.sql` (o exemplo antigo, `20260708020000`, foi arquivado em `supabase/migrations/_arquivadas/` e não existe mais nesse caminho). Sem isso, `postgres_changes` simplesmente não dispara.

## 4. Rollback e prova estática — ANTES de aplicar
- Arquivo: `rollback-manual-<nome-completo-do-arquivo-da-migration>.sql` (o prefixo
  `rollback-manual-` na frente do nome inteiro, timestamp incluído — não só o timestamp).
  Desfaz na ordem INVERSA da criação (trigger volta ao `WHEN` antigo, view volta a
  `CREATE OR REPLACE` sem a coluna nova, só então `DROP COLUMN IF EXISTS`) e também não leva
  `BEGIN`/`COMMIT`.
- **Onde salvar:** hoje o repo tem arquivos de rollback convivendo em dois lugares — mais
  antigos na raiz do projeto, mais recentes em `supabase/migrations/` (convenção desde o
  commit `1a4e332`, 09/09). Salve o seu em `supabase/migrations/`, ao lado da migration: é
  ali que os leitores do repo (`db-prove-rollback.cjs`, e qualquer script novo) procuram
  PRIMEIRO — a raiz só existe por compatibilidade com o que já foi escrito antes da
  convenção mudar.
- **Prove o par antes de pedir para alguém aplicar.** Não existe gate de CI para SQL neste
  repositório (nenhuma das sete verificações do `npm test`/`npm run build` olha `.sql`) —
  `scripts/db-prove-rollback.cjs` é a única defesa estática, e ninguém a chama por você:
  ```
  node scripts/db-prove-rollback.cjs supabase/migrations/<arquivo>.sql
  ```
  (resolve o rollback pela convenção do nome automaticamente; passe `--rollback <caminho>`
  só se o seu não seguir o padrão). Códigos de saída: `0` sem divergência nas dimensões
  medidas, `2` RECUSADO (achou `BEGIN`/`COMMIT`/`ROLLBACK`/outro controle de transação de
  nível superior — é a Fase 0, estática, sem banco), `3` FALHOU (rollback infiel ou erro de
  SQL real), `4` INSTRUMENTO-QUEBRADO, `5` INDETERMINADO (faltou `DATABASE_URL`/`pg` — não é
  veredito sobre o SQL). Um `0` não prova o rollback correto em qualquer sentido — ele só
  diz que não achou divergência de ESQUEMA; dado de linha (`UPDATE`/`INSERT`/`DELETE`) não é
  comparado por este script.

## 5. Teste estático (obrigatório, não precisa de banco)
Arquivo: `tests/migration_$ARGUMENTS_test.ts`, no padrão de
`tests/migration_a_loja_declara_a_sua_configuracao_publica_test.ts` — copie a estrutura
dele:
- Importe `avaliarFase0`, `detectarTransacaoExplicita` e `removerRuido` de
  `scripts/db-prove-rollback.cjs` via `createRequire` (o mesmo padrão de
  `tests/ler_migration_test.ts`) — nunca reescreva essa lógica no teste.
- Leia a migration e o rollback com `Deno.readTextFileSync` (caminho pelo par
  `supabase/migrations/<arquivo>.sql` / `supabase/migrations/rollback-manual-<arquivo>.sql`).
- Um `Deno.test` que chama `avaliarFase0({ sqlMigration, sqlRollback, temRollback: true })`
  e afirma `recusado === false`.
- Um `Deno.test` que roda `detectarTransacaoExplicita(removerRuido(...))` nos dois arquivos
  e afirma `achados` vazio nos dois — é o teste que quebra primeiro se alguém reintroduzir
  `BEGIN`/`COMMIT`.
- Testes de conteúdo: cada `ALTER`/`CREATE`/`DROP` que a migration promete no cabeçalho,
  conferido por `assertStringIncludes` sobre o SQL com espaço normalizado (`norm()`, mesma
  função do arquivo-molde) — isso é o que faria o teste falhar se a implementação sumisse
  ou voltasse a divergir do que o cabeçalho descreve.

Rode com o comando **Unit** do ambiente, apontando para o arquivo novo (é Deno, não
Vitest: `tests/` roda fora do `test:front`).

## 6. Lint da migration
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

## 7. Depois de aplicar: regenerar os tipos
- Aplicar de verdade é `node scripts/db-apply.cjs <arquivo.sql>` (ver seção 1 — é ele quem
  abre a transação; por isso a migration não pode trazer a sua própria).
- **Sem Supabase MCP nesta receita.** Edite manualmente `src/types/database.types.ts`,
  acrescentando/ajustando os tipos das colunas/views/funções que a migration mudou (mesmo
  padrão já usado quando um MCP não estava disponível: cast `(row as any)` só enquanto o
  tipo não acompanha, nunca como solução definitiva). Confira com:
  ```
  npx tsc -b
  ```
  É o único gate que pega divergência de schema, já que os mappers usam `any` e nunca
  lançam — rode-o de verdade, não assuma que compila.
- **Não crie nem mantenha `src/types/supabase.ts`.** Ele era uma cópia órfã de
  `database.types.ts` e chegou a divergir 839 linhas dela com um importador vivo
  (`src/hooks/useCoupons.ts`) ainda apontando para o arquivo velho — motivo de uma tarefa
  de limpeza à parte nesta mesma frente. Se ele ainda existir quando você regenerar tipos,
  não replique a mudança nele nem o edite: `src/types/database.types.ts` é a única fonte.

## 8. Se a mudança afeta o cache offline
Entidade nova que a UI lê exige:
- store no DataVault: acrescentar ao union `StoreName` (`src/lib/dataVault.ts:19`), criar **`MIGRATIONS[3]` nova** (nunca editar `MIGRATIONS[1]`, que já rodou nas máquinas dos usuários) e incrementar `DATA_VAULT_VERSION`;
- entrada em `TABLE_CONFIGS` (`src/lib/realtimeSyncEngine.ts:56`);
- **mapper coerente nos 3 lugares** onde a tradução DB→domínio está duplicada: `TABLE_CONFIGS[].mapRecord`, `hydrateAllStores` (`src/hooks/useDataVault.ts`) e o mapper inline do hook. O bug de banner que perde texto/cores sozinho vem exatamente daí;
- hook em `src/hooks/` no padrão SWR (vault → rede → `replaceAll` → `setLastSync`), modelo: `src/hooks/useCategories.ts:20-51`.

Coluna nova em tabela existente: escrita monta `dbUpdates` campo a campo (`if (updates.x !== undefined) dbUpdates.snake_name = updates.x`) — nunca spread do objeto de domínio. Schema mistura português (catálogo: `produtos.nome/preco_venda/estoque`) e inglês (marketplace: `subtotal/shipping_cost`); confira o nome real em `src/types/database.types.ts`.

## 9. Fechamento
- Delete de produto é SOFT (`deleted_at` + `ativo:false`) — toda query admin nova precisa de `.is("deleted_at", null)`.
- A migration vai ser propagada para os clones (`supabase/migrations/` é sincronizada): ela não pode assumir dados já seedados no banco do Core.
- Rode `/checar` antes de encerrar.

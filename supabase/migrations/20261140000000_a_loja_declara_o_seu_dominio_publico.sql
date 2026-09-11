-- ============================================================================
-- Migration 20261140000000 — a loja declara o seu domínio público (T4 do
-- brief equipe/entregas/20260911-brief-escala-etapa2-site-por-host.md,
-- 11/09/2026)
-- ============================================================================
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: a partir da etapa 2 um único build
-- serve toda a frota; o porteiro (Edge Function em middleware.ts, T3 da
-- mesma bancada) resolve o banco pelo HOST da requisição e monta a ficha
-- (marca + conexão) direto no HTML. Sem uma trava NO BANCO amarrando "este
-- host só pode ser servido por ESTE banco", um porteiro com bug, um cache
-- envenenado ou uma variável de ambiente trocada montaria a ficha da loja A
-- no host da loja B — "loja A com dado de loja B" é o risco central desta
-- frente inteira (parecer do sócio, tabela PARA A HUB, item 6, e a nota de
-- risco/revisão no fim do mesmo documento).
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `store_config.dominio_publico` (text, ADITIVA): o host que a loja
--      DECLARA aceitar. NULL até a hub semear (fora desta migration — passo
--      "Depois do lote" do brief: `UPDATE store_config SET dominio_publico
--      = '<host>' WHERE id = 1`, um por loja). CHECK aceita NULL ou um host
--      minúsculo sem esquema/porta/caminho, com pelo menos um ponto
--      (rejeita "localhost" sozinho, aceita "loja-savy.vercel.app").
--   2. `v_store_config` ganha a coluna no FIM da lista — `CREATE OR REPLACE
--      VIEW` só aceita coluna nova no fim, sem reordenar as demais. É dali
--      que o porteiro lê com a chave PÚBLICA (T3:
--      `readPublicStoreIdentity` via `/rest/v1/v_store_config`) — devolver
--      a coluna para `anon` é o que permite ao porteiro comparar o host da
--      requisição com o que o BANCO declara, sem service_role.
--   3. DUAS triggers, BEFORE UPDATE e BEFORE INSERT (mesma função
--      `dominio_publico_so_muda_pela_frota`), que recusam a escrita quando
--      quem PEDIU não é a hub nem `service_role` — ver "CORREÇÃO RODADA 2"
--      logo abaixo para o porquê de serem duas e para a regra de decisão
--      completa (é LISTA DE PERMISSÃO, não lista de negação). A trigger de
--      UPDATE só dispara quando a coluna MUDA
--      (`WHEN (OLD.dominio_publico IS DISTINCT FROM NEW.dominio_publico)`),
--      então um UPDATE comum de `share_text`/`primary_color`/etc por
--      `anon`/`authenticated` continua passando normalmente. A trigger de
--      INSERT só dispara quando a linha nasce COM domínio
--      (`WHEN (NEW.dominio_publico IS NOT NULL)`) — o caminho legítimo de
--      INSERT (`upsert_store_config`) nunca menciona a coluna (medido: o
--      `SET` do `ON CONFLICT DO UPDATE` não a lista), então sempre insere
--      `NULL` e nunca aciona a trava.
--
-- CORREÇÃO RODADA 2 (revisor Opus, 11/09/2026 — dois achados, os dois
-- fechados nesta versão):
--
--   ACHADO 1 — só BEFORE UPDATE não bastava: um admin autenticado conseguia
--   `DELETE FROM store_config WHERE id=1` (policy `store_config_admin_delete_policy`,
--   `USING is_admin()`) seguido de `INSERT ... (id, dominio_publico) VALUES
--   (1, 'loja-da-vitima.exemplo')` (policy `store_config_admin_insert_policy`,
--   `WITH CHECK is_admin()`) — o trigger de UPDATE nunca dispara para um
--   INSERT, e o revisor mediu isso passando no banco vivo (DELETE+INSERT
--   como `authenticated`+admin, ambos `{"ok":true}`, ROLLBACK no `finally`).
--   Fechado com a segunda trigger, BEFORE INSERT, acima.
--
--   ACHADO 2 — a condição original (`IF v_role IN ('anon','authenticated')`)
--   é lista de NEGAÇÃO e falha ABERTA: claims sem a chave `role` (`v_role`
--   fica `NULL`, e `NULL IN (...)` é `NULL`, o `IF` não dispara) ou com
--   `role` desconhecido continuam gravando — medido pelo revisor no banco
--   vivo (`SET LOCAL ROLE authenticated` + claims sem `role` OU com
--   `role='papel_inventado'`: os dois `UPDATE dominio_publico` passam,
--   `{"ok":true,"rowCount":1}`). Reescrita como lista de PERMISSÃO: recusa
--   sempre, exceto claim `role = 'service_role'`, ou ausência de claim COM
--   o papel de banco fora de `('anon','authenticated')`.
--
--   O "papel de banco" da condição acima **não** pode ser lido com
--   `current_user`: esta função é `SECURITY DEFINER`, e dentro de uma
--   função `SECURITY DEFINER` o Postgres troca `current_user` para o DONO
--   da função (o owner da migration, tipicamente `postgres`) durante toda a
--   execução — MEDIDO agora contra o banco vivo, em transação com ROLLBACK
--   (função `pg_temp.probe_definer()` temporária, chamada com
--   `SET LOCAL ROLE authenticated`): `current_user` devolveu `postgres`
--   (o dono), não `authenticated` (quem chamou); `current_setting('role',
--   true)` devolveu `authenticated`, o valor correto. Usar `current_user`
--   aqui faria QUALQUER chamador sem claim de `role` reconhecido passar
--   pela trava (porque dentro da função ele sempre "parece" `postgres`) —
--   o oposto do que o achado pede. Por isso a condição usa
--   `current_setting('role', true)`, o MESMO padrão que `public.is_admin()`
--   já usa (baseline, `IF current_setting('role', true) IN ('postgres',
--   'service_role') THEN RETURN true`) pelo mesmo motivo: essa GUC reflete
--   o `SET ROLE`/`SET LOCAL ROLE` de quem chamou, e não é afetada pela
--   troca de identidade do `SECURITY DEFINER`. Valor medido para conexão
--   direta sem `SET ROLE` (a hub): `'none'` (texto, não `NULL`) — por isso
--   a comparação é `NOT IN ('anon', 'authenticated')`, não `IS NULL`.
--
-- POR QUE NÃO UM `REVOKE UPDATE (dominio_publico)`: medido no banco vivo
-- desta bancada antes de escrever este arquivo —
-- `SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_schema='public' AND table_name='store_config'` devolve GRANT
-- de TABELA INTEIRA (`DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
-- TRUNCATE, UPDATE`) para `anon` e `authenticated` desde antes da baseline
-- (`backups/politicas-2026-08-06T09-14-45.sql:601-602`, confirmado ainda
-- vivo). `REVOKE UPDATE (dominio_publico) ON store_config FROM anon,
-- authenticated` quando o GRANT vivo é de TABELA (não de coluna) é NO-OP no
-- Postgres — o `UPDATE` de tabela inteira continua valendo para qualquer
-- coluna, coluna nova incluída. Escrever esse REVOKE teria a cara de
-- proteção sem proteger nada (`check-ausente-tem-a-cara-de-check-verde`). A
-- trava real é o trigger do item 3, que olha o CLAIM de quem pediu, nunca o
-- privilégio de coluna.
--
-- DADOS EXISTENTES: a única linha de `store_config` (id=1) ganha
-- `dominio_publico = NULL` (comportamento padrão de `ADD COLUMN` sem
-- `DEFAULT`). Nenhuma linha é lida, comparada nem reescrita por esta
-- migration — o CHECK só passa a valer a partir de agora, e NULL sempre
-- satisfaz o CHECK. A hub semeia o valor real por UPDATE separado, FORA
-- desta migration (SQL mostrado no relatório da hub), depois de aplicar nas
-- duas lojas.
--
-- IDEMPOTÊNCIA: `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE VIEW`,
-- `CREATE OR REPLACE FUNCTION` e `DROP TRIGGER IF EXISTS` seguido de
-- `CREATE TRIGGER` deixam o mesmo estado se este arquivo for reaplicado. O
-- CHECK só é criado se ainda não existir (`DO $$ ... IF NOT EXISTS
-- (pg_constraint) ... $$` — `ADD CONSTRAINT` sozinho falharia na segunda
-- aplicação).
--
-- FORA DO ESCOPO: a caderneta da frota (`frota_lojas`, `resolver_loja`) é a
-- T5 da mesma bancada, migration separada (20261141000000) — aquela tabela
-- é quem a hub povoa com o mapa host→projeto; esta migration só cria a
-- COLUNA que cada loja usa para se AUTODECLARAR e a trava que impede
-- qualquer papel de visitante de mudar essa autodeclaração. O porteiro que
-- LÊ esta coluna é a T3 (`src/hospedagem/porteiro.ts`), não tocado aqui.
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs` (uma transação por arquivo) ou `psql -1`. Sem
-- `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da casa) — o
-- único bloco `DO $$ ... $$` não abre nem fecha transação, só decide se
-- executa o `ALTER TABLE ... ADD CONSTRAINT` por dentro.
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco; a prova
-- completa em transação com ROLLBACK é `scripts/db-prove-dominio-publico.cjs`):
--
--   1. SELECT column_name FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='store_config'
--        AND column_name='dominio_publico';
--      -- esperado: 1 linha.
--
--   2. SELECT dominio_publico FROM public.v_store_config;
--      -- esperado: 1 linha (id=1), valor NULL antes da hub semear.
--
--   3. UPDATE public.store_config SET dominio_publico='exemplo.com' WHERE id=1;
--      -- como postgres/hub (sem claims): esperado sucesso.
--      UPDATE public.store_config SET dominio_publico='https://exemplo.com' WHERE id=1;
--      -- esperado: erro de CHECK (23514) — esquema não é permitido.
--
--   4. SET LOCAL ROLE anon;
--      UPDATE public.store_config SET dominio_publico='outro.com' WHERE id=1;
--      -- esperado: UPDATE 0 (zero linhas afetadas, SEM erro). CORREÇÃO
--      -- RODADA B (11/09/2026): a versão anterior deste item dizia "erro
--      -- 42501", e isso é FALSO — medido contra o banco vivo em transação
--      -- com ROLLBACK (scripts/db-prove-dominio-publico.cjs). `anon` não
--      -- tem NENHUMA policy de UPDATE em `store_config` (só existe
--      -- `store_config_admin_update_policy`, `TO authenticated USING
--      -- is_admin()`); a RLS pré-existente (não introduzida por esta
--      -- migration) já filtra a linha para ZERO antes de o trigger sequer
--      -- rodar — trigger BEFORE ROW só dispara para linhas que passaram
--      -- pela RLS. O mesmo vale, medido, para `SET LOCAL ROLE
--      -- authenticated` SEM nenhum `request.jwt.claims`: sem claim,
--      -- `is_admin()` cai no fallback de `auth.users` via `auth.uid()`
--      -- (NULL sem claim), a policy filtra e o resultado também é 0
--      -- linhas, nunca 42501 (prova acrescentada em
--      -- `scripts/db-prove-dominio-publico.cjs`, passo 4b). O trigger só
--      -- aparece de fato quando o papel JÁ passou pela RLS admin (item 3,
--      -- com claims de um admin real) — é ali, e só ali, que se observa o
--      -- 42501. A tabela continua com GRANT UPDATE de tabela inteira para
--      -- `anon`/`authenticated` (ver "POR QUE NÃO UM REVOKE UPDATE" acima)
--      -- — quem recusa a escrita de `anon` é a RLS, não o GRANT.
--
--   5. Prova completa: node scripts/db-prove-dominio-publico.cjs
--      (roda dentro de transação, ROLLBACK no fim — nada gravado).
--
--   6. (rodada 2) Como authenticated com claims de admin:
--      DELETE FROM public.store_config WHERE id=1;
--      INSERT INTO public.store_config (id, dominio_publico)
--        VALUES (1, 'loja-da-vitima.exemplo');
--      -- esperado: o DELETE pode passar (policy de admin), mas o INSERT
--      -- recusa com 42501 — é a trigger nova (BEFORE INSERT) quem barra.
--
-- ROLLBACK: rollback-manual-20261140000000_*.sql versionado junto — na
-- ordem inversa da criação (derruba as DUAS triggers — UPDATE e INSERT —
-- e a função, recria a view SEM a coluna, tira o CHECK e por fim a
-- coluna). A view não pode referenciar uma coluna que já não existe, por
-- isso a view é recriada ANTES de tirar a coluna.
-- ============================================================================

ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS dominio_publico text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_dominio_publico_host_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_dominio_publico_host_check
      CHECK (
        dominio_publico IS NULL
        OR dominio_publico ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      );
  END IF;
END $$;

CREATE OR REPLACE VIEW public.v_store_config WITH (security_invoker=on) AS
 SELECT id,
    free_shipping_min,
    shipping_fee,
    whatsapp_number,
    share_text,
    business_hours,
    enable_reviews,
    enable_coupons,
    primary_color,
    theme_mode,
    logo_url,
    real_time_sales_alerts,
    push_marketing_enabled,
    min_app_version,
    origin_cep,
    shipping_provider,
    enabled_shipping_methods,
    shipping_coverage,
    local_delivery_fee,
    local_cep_range,
    created_at,
    updated_at,
    store_name,
    store_city,
    store_state,
    home_sections,
    secondary_color,
    accent_color,
    branding_assets,
    dominio_publico
   FROM store_config
  WHERE id = 1;

CREATE OR REPLACE FUNCTION public.dominio_publico_so_muda_pela_frota()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_role text;
BEGIN
  -- Olha QUEM PEDIU (o claim `role` do JWT que o PostgREST injeta em
  -- `request.jwt.claims`), nunca em qual papel a função RODA — é essa
  -- distinção que barra `upsert_store_config` (SECURITY DEFINER, roda como
  -- `postgres`) mesmo quando chamada por um `authenticated` admin.
  -- MEDIDO no banco vivo (rodando a prova): `request.jwt.claims` já existe
  -- como GUC nesta base mesmo numa conexão direta, com valor `''` (string
  -- vazia) — NÃO `NULL`. `''::jsonb` lança `invalid input syntax for type
  -- json` (erro real do Postgres, não algo que `coalesce` alcança depois
  -- do cast já ter falhado). Mesmo cuidado que `public.is_admin()` já toma
  -- (`current_setting('request.jwt.claims', true) IS NOT NULL AND <> ''`,
  -- baseline:3107) — só faz o cast para jsonb quando o valor bruto existe
  -- E não é vazio.
  IF current_setting('request.jwt.claims', true) IS NOT NULL
      AND current_setting('request.jwt.claims', true) <> '' THEN
    v_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  END IF;

  -- LISTA DE PERMISSÃO (rodada 2 — ver "CORREÇÃO RODADA 2" no cabeçalho
  -- deste arquivo): a versão anterior era lista de NEGAÇÃO
  -- (`IF v_role IN ('anon','authenticated')`) e falhava aberta quando o
  -- claim não tinha a chave `role`, ou trazia um `role` desconhecido —
  -- `v_role` ficava `NULL` ou um texto fora da lista, e o UPDATE passava
  -- sem checagem nenhuma. Agora só passam DOIS casos, e tudo mais recusa:
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- `current_setting('role', true)` — NUNCA `current_user` — é quem reflete
  -- o `SET ROLE`/`SET LOCAL ROLE` de quem chamou. Esta função é `SECURITY
  -- DEFINER`; dentro dela `current_user` sempre devolve o DONO da função
  -- (`postgres`), MEDIDO agora contra o banco vivo em transação com
  -- ROLLBACK — usar `current_user` faria qualquer chamador sem `role`
  -- reconhecido no claim passar pela trava, porque "pareceria" `postgres`
  -- por dentro. `public.is_admin()` já usa o mesmo `current_setting('role',
  -- true)` pelo mesmo motivo (baseline:3102). Conexão direta sem `SET
  -- ROLE` (a hub) mede `'none'` (texto), nunca `NULL` — por isso a
  -- comparação é `NOT IN (...)`, não `IS NULL`.
  IF v_role IS NULL AND current_setting('role', true) NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA';
END;
$function$;

REVOKE ALL ON FUNCTION public.dominio_publico_so_muda_pela_frota() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota ON public.store_config;
CREATE TRIGGER dominio_publico_so_muda_pela_frota
  BEFORE UPDATE ON public.store_config
  FOR EACH ROW
  WHEN (OLD.dominio_publico IS DISTINCT FROM NEW.dominio_publico)
  EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();

-- ACHADO 1 (rodada 2): a trigger acima só dispara em UPDATE. Um admin
-- autenticado conseguia `DELETE FROM store_config WHERE id=1` seguido de
-- `INSERT ... (id, dominio_publico) VALUES (1, 'loja-da-vitima.exemplo')`
-- sem passar por ela nenhuma vez — o INSERT é evento diferente. Esta
-- segunda trigger fecha o caminho: dispara só quando a linha NASCE com
-- `dominio_publico` preenchido (o caminho legítimo, `upsert_store_config`,
-- nunca escreve essa coluna no INSERT — medido: não está no `SET` do
-- `ON CONFLICT DO UPDATE` — então insere sempre `NULL` e nunca aciona
-- esta trava).
DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota_no_insert ON public.store_config;
CREATE TRIGGER dominio_publico_so_muda_pela_frota_no_insert
  BEFORE INSERT ON public.store_config
  FOR EACH ROW
  WHEN (NEW.dominio_publico IS NOT NULL)
  EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();

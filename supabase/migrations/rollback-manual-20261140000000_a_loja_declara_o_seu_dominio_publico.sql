-- ============================================================================
-- Rollback manual — a loja declara o seu domínio público (20261140000000)
-- ============================================================================
-- Reverte na ordem INVERSA da criação: primeiro as DUAS triggers (UPDATE e
-- INSERT — rodada 2, achado 1 do revisor: só BEFORE UPDATE deixava passar
-- um DELETE+INSERT) e a função (quem lê/escreve a coluna), depois a view
-- (recriada SEM `dominio_publico`, voltando às 29 colunas originais na
-- mesma ordem — a view não pode referenciar uma coluna que já não existe,
-- por isso é recriada ANTES de tirar a coluna), por fim o CHECK e a coluna
-- em si. As duas triggers, a função, o CHECK e a coluna usam `IF EXISTS`,
-- então repetir esses passos depois que já foram desfeitos não dá erro.
-- `DROP VIEW` (sem `IF EXISTS`
-- — Postgres não aceita a cláusula ali) não precisa dela: a view SEMPRE
-- existe nos dois lados (com ou sem `dominio_publico`), então repetir
-- DROP+CREATE só a recria igual, nunca falha por ausência. `store_config`,
-- `upsert_store_config`, `is_admin()` e as demais colunas/triggers/funções
-- pré-existentes não são tocados.
--
-- ORDEM DE INTEGRAÇÃO: reverter ANTES o porteiro (T3, mesma bancada) que lê
-- `dominio_publico` de `v_store_config` para decidir a concordância
-- host↔banco — se este rollback rodar primeiro com o porteiro ainda no ar,
-- toda requisição passa a ver `dominio_publico` ausente e o porteiro
-- recusa com 503 `sem-loja` para QUALQUER host (falha fechada, sem vazar
-- loja errada, mas a frota inteira fica fora do ar até a ordem certa).
--
-- POR QUE `DROP VIEW` + `CREATE VIEW` (nunca `CREATE OR REPLACE VIEW`) AQUI:
-- medido rodando a prova (scripts/db-prove-dominio-publico.cjs) contra o
-- banco vivo — o Postgres recusa `CREATE OR REPLACE VIEW` quando a lista de
-- colunas do REPLACE tem MENOS colunas que a view existente
-- ("cannot drop columns from view"). `OR REPLACE` só aceita ACRESCENTAR
-- coluna no fim (é o que a migration 20261140000000 faz), nunca remover —
-- por isso só o rollback precisa do par DROP+CREATE. `DROP VIEW` apaga o
-- ACL da view junto (medido: ACL vivo antes deste rollback é
-- `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
-- authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` — ALL
-- PRIVILEGES para os quatro papéis), por isso o `GRANT ALL` explícito logo
-- depois do `CREATE VIEW` — sem ele, a view voltaria a existir mas SEM os
-- grants que `anon`/`authenticated`/`service_role` tinham antes desta
-- migration, e o rollback deixaria de ser fiel (regra: reproduzir o corpo
-- VIVO byte a byte, ACL incluído).
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa) — aplicar via
-- node scripts/db-apply.cjs (uma transação por arquivo) ou psql -1.
-- ============================================================================

DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota ON public.store_config;
DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota_no_insert ON public.store_config;
DROP FUNCTION IF EXISTS public.dominio_publico_so_muda_pela_frota();

DROP VIEW public.v_store_config;
CREATE VIEW public.v_store_config WITH (security_invoker=on) AS
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
    branding_assets
   FROM store_config
  WHERE id = 1;

GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role;

ALTER TABLE public.store_config DROP CONSTRAINT IF EXISTS store_config_dominio_publico_host_check;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS dominio_publico;

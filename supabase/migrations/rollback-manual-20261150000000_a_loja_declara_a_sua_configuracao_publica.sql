-- ============================================================================
-- Rollback manual — a loja declara a sua configuração pública (20261150000000)
-- ============================================================================
-- Reverte na ordem INVERSA da criação: primeiro as DUAS triggers voltam ao
-- `WHEN` estreito que a 20261140 deixou (só `dominio_publico` — os dois
-- `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` são idempotentes, repetir não
-- dá erro), depois a view (recriada com SÓ as 30 colunas que a 20261140 já
-- deixava, sem as 4 novas — a view não pode referenciar uma coluna que já
-- não existe, por isso é recriada ANTES de tirar as colunas), por fim as 4
-- colunas em si (`DROP COLUMN IF EXISTS`, idempotente). A FUNÇÃO
-- `dominio_publico_so_muda_pela_frota()` NÃO é tocada aqui — nem recriada,
-- nem derrubada: ela pertence à migration 20261140000000 e continua servindo
-- a trigger dela, que sobrevive a este rollback. `store_config`,
-- `upsert_store_config`, `is_admin()` e as demais colunas/triggers/funções
-- pré-existentes (inclusive `dominio_publico` e a sua própria trigger, no
-- estado da 20261140) não são tocados.
--
-- ORDEM DE INTEGRAÇÃO: reverter ANTES o app (T4) e o porteiro (T3, mesma
-- bancada) que passam a ler `mp_public_key`/`vapid_public_key`/
-- `pagamento_online`/`manutencao` de `v_store_config` — se este rollback
-- rodar primeiro com o porteiro/app novos ainda no ar, a próxima leitura da
-- view recebe uma coluna a menos e o porteiro recusa com 503
-- `banco-indisponivel` (falha fechada, mesmo raciocínio da 20261140). A
-- ordem certa (ver o brief, "Desfazer (por camada)"): promover o deployment
-- anterior na Vercel PRIMEIRO, só então rodar este rollback.
--
-- POR QUE `DROP VIEW` + `CREATE VIEW` (nunca `CREATE OR REPLACE VIEW`) AQUI:
-- a view alvo, sem as 4 colunas novas, tem MENOS colunas que a view CRIADA
-- por esta migration mas continua com o MESMO NÚMERO de colunas (30) que a
-- 20261140000000 já deixava — `CREATE OR REPLACE VIEW` recusa reduzir a
-- lista de colunas em relação ao que está VIVO no banco no momento em que
-- este rollback roda (que são as 34 colunas desta migration), então este
-- rollback usa `DROP VIEW` + `CREATE VIEW` (nunca `CREATE OR REPLACE VIEW`)
-- pelo mesmo motivo documentado no rollback da 20261140: o Postgres recusa
-- `OR REPLACE` quando a lista do REPLACE tem menos colunas que a view
-- existente ("cannot drop columns from view"). `DROP VIEW` apaga o ACL da
-- view junto, por isso o `GRANT ALL` explícito logo depois do `CREATE VIEW`
-- — sem ele, a view voltaria a existir mas SEM os grants que
-- `anon`/`authenticated`/`service_role` tinham antes desta migration, e o
-- rollback deixaria de ser fiel (regra: reproduzir o corpo VIVO byte a byte,
-- ACL incluído — mesma regra e mesmos quatro grantees do rollback da
-- 20261140).
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa) — aplicar via
-- node scripts/db-apply.cjs (uma transação por arquivo) ou psql -1.
-- ============================================================================

DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota ON public.store_config;
CREATE TRIGGER dominio_publico_so_muda_pela_frota
  BEFORE UPDATE ON public.store_config
  FOR EACH ROW
  WHEN (OLD.dominio_publico IS DISTINCT FROM NEW.dominio_publico)
  EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();

DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota_no_insert ON public.store_config;
CREATE TRIGGER dominio_publico_so_muda_pela_frota_no_insert
  BEFORE INSERT ON public.store_config
  FOR EACH ROW
  WHEN (NEW.dominio_publico IS NOT NULL)
  EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();

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
    branding_assets,
    dominio_publico
   FROM store_config
  WHERE id = 1;

GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role;

ALTER TABLE public.store_config DROP COLUMN IF EXISTS mp_public_key;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS vapid_public_key;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS pagamento_online;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS manutencao;

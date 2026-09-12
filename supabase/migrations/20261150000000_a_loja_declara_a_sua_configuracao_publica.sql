-- ============================================================================
-- Migration 20261150000000 — a loja declara a sua configuração pública (T1
-- do brief equipe/entregas/20260911-brief-escala-etapa3-uma-publicacao-para-todas.md,
-- spec equipe/entregas/20260911-spec-escala-etapa3-uma-publicacao-para-todas.md
-- bloco A + ADENDO A.4, 11/09/2026)
-- ============================================================================
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: desde a etapa 2, um único build serve
-- toda a frota, e o porteiro (middleware.ts) já monta a ficha por HOST a
-- partir de `v_store_config`. Mas QUATRO valores por loja ainda são ASSADOS
-- no build (lidos via `import.meta.env`, iguais para todas as lojas): a
-- chave pública do Mercado Pago, a chave pública VAPID, a flag de pagamento
-- online e o modo manutenção. MEDIDO na spec (bloco A, item 1): MP e VAPID
-- DIFEREM entre a principal e a Savy — a Savy servida pelo build da
-- principal tokenizaria cartão com a chave pública ERRADA e assinaria push
-- com VAPID errada. Esta migration cria a COLUNA que cada loja usa para
-- declarar os seus próprios 4 valores, e a trava que impede qualquer papel
-- de visitante de mudar essa autodeclaração — mesmo desenho e mesma trigger
-- da 20261140 (`dominio_publico`), agora cobrindo também estas 4 colunas.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `store_config` ganha 4 colunas ADITIVAS:
--        - `mp_public_key text` — chave pública do Mercado Pago da loja.
--        - `vapid_public_key text` — chave pública VAPID (push) da loja.
--        - `pagamento_online boolean NOT NULL DEFAULT false` — liga/desliga
--          o checkout com cartão; nasce DESLIGADA (falha fechada: uma loja
--          nova nunca começa cobrando sem a chave ter sido semeada).
--        - `manutencao boolean NOT NULL DEFAULT false` — modo manutenção
--          por loja; nasce DESLIGADO.
--      Todas NULL/false até a hub semear (fora desta migration — passo
--      "Depois do lote" do brief: `semear-configuracao.cjs`, um por loja).
--   2. `v_store_config` é recriada com `CREATE OR REPLACE VIEW` listando as
--      30 colunas que a 20261140 já deixou (na MESMA ordem — `OR REPLACE`
--      só aceita coluna nova no FIM) + as 4 novas no fim. É dali que o
--      porteiro lê com a chave PÚBLICA (`anon`), numa consulta só, como já
--      faz hoje para `dominio_publico`.
--   3. As DUAS triggers que já existem desde a 20261140
--      (`dominio_publico_so_muda_pela_frota`, BEFORE UPDATE, e
--      `dominio_publico_so_muda_pela_frota_no_insert`, BEFORE INSERT) têm
--      só o `WHEN` reescrito para cobrir também as 4 colunas novas — a
--      FUNÇÃO por trás delas (`public.dominio_publico_so_muda_pela_frota()`)
--      NÃO muda de corpo nesta migration: ela já decide "quem pediu" (claim
--      `role` do JWT / `current_setting('role', true)`) e essa decisão
--      continua igual, só passa a valer para mais colunas. Ver a migration
--      20261140000000 para a lista de achados (rodada 2) que blindaram essa
--      função — nada disso muda aqui.
--        - UPDATE (WHEN — ADENDO A.4): dispara quando QUALQUER uma das 5
--          colunas muda (`OLD.x IS DISTINCT FROM NEW.x`, uma por coluna,
--          unidas por `OR`) — um UPDATE comum de `share_text`/`primary_color`
--          continua passando sem tocar o trigger.
--        - INSERT (WHEN — ADENDO A.4): dispara quando a linha NASCE com
--          QUALQUER uma das 5 colunas preenchida (`dominio_publico`/
--          `mp_public_key`/`vapid_public_key` `IS NOT NULL`, ou
--          `pagamento_online`/`manutencao` `IS DISTINCT FROM false`) — o
--          caminho legítimo (`upsert_store_config`, lista FECHADA de 27
--          colunas) nunca menciona nenhuma das 5, então sempre insere os
--          defaults (`NULL`/`NULL`/`NULL`/`false`/`false`) e nunca aciona a
--          trava. Os booleanos usam `IS DISTINCT FROM false` (não
--          `IS NOT FALSE`) pelo mesmo motivo de robustez que o resto da
--          função já segue: comparação explícita, nunca dependente de como o
--          Postgres trata NULL num operador que parece, mas não é, o mesmo.
--
-- QUEM PODE GRAVAR NESTAS 4 COLUNAS: só a hub (conexão direta, sem
-- `request.jwt.claims`) ou `service_role` — a mesma regra de
-- `dominio_publico`. Quem liga pagamento/manutenção de uma loja é a frota
-- (por script, hoje; painel do lojista fica fora desta etapa — §6 da spec),
-- nunca o lojista logado nem um visitante anônimo. Os valores são PÚBLICOS
-- por natureza (a chave pública do MP e a VAPID pública vão ao navegador de
-- todo visitante; `anon` já lê `v_store_config` inteira) — a trava aqui é
-- sobre QUEM ESCREVE, nunca sobre quem lê.
--
-- POR QUE NÃO REVOKE DE COLUNA: mesmo motivo já documentado na 20261140
-- ("POR QUE NÃO UM REVOKE UPDATE") — o GRANT vivo de `store_config` é de
-- TABELA INTEIRA para `anon`/`authenticated`, então um `REVOKE UPDATE
-- (mp_public_key, ...)` seria NO-OP. A trava real continua sendo o trigger,
-- que olha o CLAIM de quem pediu, nunca o privilégio de coluna.
--
-- DADOS EXISTENTES: a única linha de `store_config` (id=1) ganha
-- `mp_public_key = NULL`, `vapid_public_key = NULL`, `pagamento_online =
-- false`, `manutencao = false` (comportamento padrão de `ADD COLUMN` com/sem
-- `DEFAULT`). Nenhuma linha é lida, comparada nem reescrita por esta
-- migration — a semente real (`semear-configuracao.cjs`) é passo separado,
-- FORA desta migration, depois de aplicar nas duas lojas.
--
-- IDEMPOTÊNCIA: `ADD COLUMN IF NOT EXISTS` ×4, `CREATE OR REPLACE VIEW` e
-- `DROP TRIGGER IF EXISTS` seguido de `CREATE TRIGGER` ×2 deixam o mesmo
-- estado se este arquivo for reaplicado. Nenhuma `DO $$ ... $$` é necessária
-- aqui (ao contrário da 20261140): não há CHECK novo para criar de forma
-- condicional — os dois booleanos já nascem com `NOT NULL DEFAULT false`
-- direto na coluna, e `ADD COLUMN IF NOT EXISTS` sozinho é idempotente para
-- isso.
--
-- FORA DO ESCOPO: aplicar de verdade no banco (a hub aplica, carta branca,
-- ANTES do PR — ADENDO A.7); semear os 4 valores reais por loja
-- (`semear-configuracao.cjs`, T6); o porteiro que LÊ estas colunas (T3,
-- `src/hospedagem/porteiro.ts`); o app que passa a ler pela ficha em vez do
-- `import.meta.env` (T4).
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs` (uma transação por arquivo) ou `psql -1`. Sem
-- `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco; a prova completa
-- em transação com ROLLBACK é `scripts/db-prove-configuracao-publica.cjs`):
--
--   1. SELECT column_name FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='store_config'
--        AND column_name IN ('mp_public_key','vapid_public_key',
--                             'pagamento_online','manutencao');
--      -- esperado: 4 linhas.
--
--   2. SELECT mp_public_key, vapid_public_key, pagamento_online, manutencao
--        FROM public.v_store_config;
--      -- esperado: 1 linha (id=1), NULL/NULL/false/false antes da semente.
--
--   3. Como postgres/hub (sem claims):
--      UPDATE public.store_config SET pagamento_online = true WHERE id = 1;
--      -- esperado sucesso.
--
--   4. SET LOCAL ROLE authenticated com claims de um admin REAL:
--      UPDATE public.store_config SET pagamento_online = true WHERE id = 1;
--      -- esperado: 42501 DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA.
--
--   5. SELECT public.upsert_store_config('{"store_name":"x"}'::jsonb);
--      -- esperado: sucesso, e mp_public_key/vapid_public_key/
--      -- pagamento_online/manutencao continuam com o valor de ANTES da
--      -- chamada (a função não lista nenhuma das 4 colunas no INSERT nem no
--      -- ON CONFLICT DO UPDATE).
--
--   6. Prova completa: node scripts/db-prove-configuracao-publica.cjs
--      (roda dentro de transação, ROLLBACK no fim — nada gravado).
--
-- ROLLBACK: rollback-manual-20261150000000_*.sql versionado junto — na
-- ordem inversa da criação: as DUAS triggers voltam ao `WHEN` estreito da
-- 20261140 (só `dominio_publico`), a view volta a ter só as 30 colunas
-- atuais (sem as 4 novas), e por fim as 4 colunas são derrubadas
-- (`DROP COLUMN IF EXISTS`). A função `dominio_publico_so_muda_pela_frota()`
-- NÃO é tocada pelo rollback (nem recriada, nem derrubada): ela continua
-- servindo a trigger da 20261140, que sobrevive ao rollback desta migration.
-- ============================================================================

ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS mp_public_key text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS vapid_public_key text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS pagamento_online boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS manutencao boolean NOT NULL DEFAULT false;

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
    dominio_publico,
    mp_public_key,
    vapid_public_key,
    pagamento_online,
    manutencao
   FROM store_config
  WHERE id = 1;

DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota ON public.store_config;
CREATE TRIGGER dominio_publico_so_muda_pela_frota
  BEFORE UPDATE ON public.store_config
  FOR EACH ROW
  WHEN (OLD.dominio_publico IS DISTINCT FROM NEW.dominio_publico
    OR OLD.mp_public_key IS DISTINCT FROM NEW.mp_public_key
    OR OLD.vapid_public_key IS DISTINCT FROM NEW.vapid_public_key
    OR OLD.pagamento_online IS DISTINCT FROM NEW.pagamento_online
    OR OLD.manutencao IS DISTINCT FROM NEW.manutencao)
  EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();

DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota_no_insert ON public.store_config;
CREATE TRIGGER dominio_publico_so_muda_pela_frota_no_insert
  BEFORE INSERT ON public.store_config
  FOR EACH ROW
  WHEN (NEW.dominio_publico IS NOT NULL
    OR NEW.mp_public_key IS NOT NULL
    OR NEW.vapid_public_key IS NOT NULL
    OR NEW.pagamento_online IS DISTINCT FROM false
    OR NEW.manutencao IS DISTINCT FROM false)
  EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();

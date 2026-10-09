-- ============================================================================
-- Rollback manual -- o contador duplicado do cupom morre (20261207000000)
-- ============================================================================
-- Recria `public.coupons.used_count` como era no baseline
-- (supabase/migrations/20260806000000_baseline_do_schema_vivo.sql, tabela coupons):
-- integer, aceita NULL, DEFAULT 0. Os valores voltam 0 em TODAS as linhas: a
-- migration so apagou a coluna quando toda linha tinha used_count igual a 0 exato
-- (NULL recusava), e nenhuma gravacao poderia ter acontecido nela depois, porque
-- a coluna nao existia. O estado anterior e reproduzido sem perda.
--
-- O QUE VOLTA A VALER: a coluna duplicada de volta, sem ninguem que a leia ou a
-- escreva (e o que o banco era antes). `usage_count` nao e tocado.
--
-- GUARDA: ADD COLUMN IF NOT EXISTS nao faz nada quando a coluna ja existe -- e um
-- rollback que "passa" com a coluna errada seria silencioso. Por isso, depois do
-- ALTER, a forma da coluna e conferida (integer, aceita NULL, DEFAULT 0, nem gerada
-- nem identidade) e o rollback RECUSA com o nome do que diverge. Rollback repetido
-- (a coluna ja existe com a forma do baseline) e idempotente: nao faz nada.
--
-- COMO DESFAZER: pelo WORKFLOW `aplicar-migrations.yml`, com este arquivo
-- (`rollback-manual-<versao>`; o runbook, secao Rollback > Banco). Ele roda o arquivo
-- no mesmo envelope da migration e APAGA a linha 20261207000000 do ledger na MESMA
-- transacao. NUNCA por `psql` direto: a coluna voltaria com o ledger ainda dizendo
-- "aplicada", e o portao da release (14a NEGATIVA + ledger com a versao) PARARIA --
-- e ninguem tem credencial `psql` direta nas lojas.
--
-- `lock_timeout` de 5 s: o ADD COLUMN pede trava exclusiva por uma fracao de segundo;
-- se a tabela estiver presa por mais que isso, o rollback falha sem gravar nada e se
-- repete. Sem BEGIN/COMMIT de nivel superior neste arquivo -- regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS used_count integer DEFAULT 0;

DO $verifica_rollback_20261207$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_attribute a
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     WHERE a.attrelid = 'public.coupons'::regclass
       AND a.attname = 'used_count' AND a.attnum > 0 AND NOT a.attisdropped
       AND a.atttypid = 'integer'::regtype AND NOT a.attnotnull
       AND a.attgenerated = '' AND a.attidentity = ''
       AND pg_get_expr(ad.adbin, ad.adrelid) IS NOT DISTINCT FROM '0'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_20261207: public.coupons.used_count existe mas nao tem a forma do baseline (integer, aceita NULL, DEFAULT 0) -- alguem a recriou diferente; confira antes.';
  END IF;
END
$verifica_rollback_20261207$;

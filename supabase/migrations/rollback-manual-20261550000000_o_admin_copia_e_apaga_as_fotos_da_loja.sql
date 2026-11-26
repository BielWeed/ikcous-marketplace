-- Rollback manual da 20261550000000 (o admin copia e apaga as fotos da loja).
-- Tira SO as duas politicas que a migration criou em storage.objects: "Admin Select Access (products)" e "Admin Select Access (banners)".
-- O estado anterior e' a AUSENCIA delas (a migration nao alterou nem derrubou nenhuma politica alheia), entao dropar as duas devolve o
-- catalogo de storage.objects exatamente ao de antes. Nenhum arquivo, bucket, linha, grant ou outra politica e' tocado; a "Public Display"
-- e as demais politicas das lojas antigas ficam como estao.
-- EFEITO: na loja nova o admin volta a nao conseguir copiar foto (duplicar produto falha) nem apagar foto ou banner (o remove apaga 0
-- arquivo, sem erro). Nas lojas antigas nada muda (a politica larga de leitura continua la).
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) sem escrever se storage.objects nao existe ou se uma politica com um dos dois nomes NAO for
-- exatamente a desta migration (alguem a recriou com outra forma: dropar levaria junto uma politica que nao e' desta migration). Estados
-- aceitos: a politica desta migration (sai) ou ausente (rodar de novo e' no-op).
-- Conferencia final: as duas ausentes.
-- ORDEM: desfazer ESTA antes de desfazer a 20261197000000 (o rollback da 97 recusa enquanto alguma politica cita rls_admin_atual()).
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo -
-- regra da casa. Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261550000000$
DECLARE
  r record;
  v_caminho text;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: storage.objects ausente.';
  END IF;
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('Admin Select Access (products)', '((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('Admin Select Access (banners)', '((bucket_id = ''banners''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))')
  ) AS esperado(politica, qual) LOOP
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('storage.objects') AND p.polname = r.politica)
       AND NOT EXISTS (
         SELECT 1 FROM pg_policy p
          WHERE p.polrelid = to_regclass('storage.objects') AND p.polname = r.politica
            AND p.polcmd = 'r' AND p.polpermissive
            AND p.polroles = ARRAY['authenticated'::regrole::oid]
            AND pg_get_expr(p.polqual, p.polrelid) = r.qual
            AND p.polwithcheck IS NULL) THEN
      PERFORM set_config('search_path', v_caminho, true);
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a politica "%" de storage.objects nao e a da 20261550000000; revise antes de apagar.', r.politica;
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight_rollback_20261550000000$;

DROP POLICY IF EXISTS "Admin Select Access (products)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Select Access (banners)" ON storage.objects;

DO $conferencia_rollback_20261550000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = to_regclass('storage.objects')
                AND polname IN ('Admin Select Access (products)', 'Admin Select Access (banners)')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261550000000: uma politica Admin Select Access ainda existe em storage.objects';
  END IF;
END $conferencia_rollback_20261550000000$;

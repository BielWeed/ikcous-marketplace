-- O ADMIN COPIA E APAGA AS FOTOS DA LOJA (26/11/2026; lacuna L4 da loja nova)
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. Cria DUAS politicas novas em
-- storage.objects; o unico DROP e' o da propria politica desta migration, recriada logo em seguida (idempotencia). Nenhuma funcao, gatilho,
-- grant, bucket ou objeto do Storage e' criado, alterado ou removido.
--
-- O DEFEITO: a loja recem-instalada nasce SEM politica SELECT nos buckets `products` e `banners`. A 20261071000000 deixou as de listagem
-- do molde de fora de proposito ("o front nao usa .list()"). Mas o Storage tambem le a linha em outras operacoes. Pela doc do Supabase
-- Storage, copy exige select + insert e remove exige select + delete; pela regra do Postgres, um DELETE com WHERE so enxerga as linhas que
-- alguma politica SELECT libera. Sem a politica:
--   - duplicar produto com foto falha (useProducts copia a foto no bucket `products`: o Storage nao acha a origem);
--   - apagar foto de produto ou banner apaga 0 arquivo e nao avisa (o remove roda DELETE ... WHERE ... RETURNING e volta vazio): o
--     arquivo fica no bucket para sempre (useProducts, descartar-fotos-do-produto.ts, useBanners).
-- As lojas antigas nao sentem isso porque tem a politica larga "Public Display" (products) e "Public Read Banners Bucket" (banners), SELECT
-- para qualquer logado (tests/identity-database/storage-principal.sql); a Savy tem "Leitura publica (products|banners)" para anon e logado.
--
-- O QUE ENTRA: "Admin Select Access (products)" e "Admin Select Access (banners)", FOR SELECT TO authenticated USING
-- (bucket_id = '<bucket>' AND (SELECT public.rls_admin_atual())). So o admin de AGORA (auth.users E profiles, 20261197000000) le a linha do
-- arquivo nesses dois buckets; e' o mesmo guarda que a 20261360000000 pos nas politicas de escrita (Insert/Update/Delete) dos dois buckets.
-- Cliente logado, admin rebaixado (ainda com JWT de admin) e visitante continuam sem listar nada. A foto publica continua servida por URL
-- (bucket publico, getPublicUrl), que nao passa por politica.
--
-- POR QUE rls_admin_atual() E NAO is_admin_atual(): authenticated NAO tem EXECUTE na is_admin_atual (20261197; a 20261360 exige isso no
-- pre-voo). O Postgres confere o EXECUTE de toda funcao do plano ao montar a consulta, mesmo quando o bucket_id ja descartaria a linha:
-- uma politica com is_admin_atual() faria TODO SELECT de usuario logado em storage.objects cair com 42501 (inclusive o cliente lendo a
-- propria foto de devolucao). rls_admin_atual() e' a porta feita para politica: EXECUTE so de authenticated, e devolve is_admin_atual().
-- Por isso a politica e' TO authenticated (anon nao tem EXECUTE nela; TO public derrubaria o visitante com o mesmo 42501).
--
-- DADOS EXISTENTES: nenhuma linha de storage.objects, storage.buckets ou de qualquer tabela e' lida ou escrita ao aplicar; nenhum arquivo e'
-- apagado ou movido. Na loja nova: o admin passa a copiar e apagar foto e banner. Nas lojas antigas (IKCOUS, Savy): nada muda para ninguem,
-- porque politicas PERMISSIVE se somam por OU e a "Public Display" / "Public Read Banners Bucket" / "Leitura publica" ja liberam a mesma
-- linha a todo logado (o admin incluso); elas NAO sao tocadas aqui. Os arquivos orfaos que as tentativas antigas de apagar deixaram na loja
-- nova continuam la (varrer o bucket e' outro passo).
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs / instalador abrem BEGIN, aplicam o arquivo
-- e fazem COMMIT; qualquer erro, inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui (regra da casa: com
-- eles o ROLLBACK da prova viraria no-op). CREATE/DROP POLICY pedem trava exclusiva de storage.objects, que e' tabela quente: o lock_timeout
-- de 5 s faz o apply DESISTIR (55P03, nada gravado) em vez de enfileirar as leituras da vitrine atras dele; e' so rodar de novo.
-- Idempotente: DROP POLICY IF EXISTS + CREATE do mesmo texto; rodar duas vezes deixa o mesmo estado (o pre-voo so aceita a politica
-- ausente ou exatamente a desta migration). Exige a 20261197000000 (rls_admin_atual); a 20261071000000 (buckets) nao e' pre-requisito da
-- politica, mas vem antes na fila. Nenhuma edge nem front precisa mudar: eles ja chamam copy e remove; so passam a funcionar na loja nova.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT, nada escrito): storage.objects ausente ou sem RLS; rls_admin_atual() ausente, com corpo
-- diferente do da 20261197 (md5 sem CR) ou sem SECURITY DEFINER; EXECUTE dela fora de "authenticated sim, anon nao"; ou uma politica com o
-- nome de uma das duas que nao seja EXATAMENTE a desta migration (comando, papel, PERMISSIVE e expressao) - nao se derruba politica de
-- ninguem.
-- POS-VOO (B2_POSVOO_DIVERGENTE): as duas politicas existem exatamente com esta forma.
--
-- ROLLBACK: rollback-manual-20261550000000_o_admin_copia_e_apaga_as_fotos_da_loja.sql tira SO as duas politicas (o estado anterior e' a
-- ausencia delas). Recusa politica homonima alheia. Desfazer ESTA antes de desfazer a 20261197 (a politica cita rls_admin_atual(); por isso
-- ela entra no fim de POSTERIORES_A_97, tests/banco/o-admin-copia-e-apaga-as-fotos-posterior.cjs).
-- TIPOS: nada muda em src/types/database.types.ts (nenhuma coluna, funcao ou tabela nova em public).
-- FICHA DE VERIFICACAO: consultas 192b (antes) e 192a (depois); prova viva tests/banco/o-admin-copia-e-apaga-as-fotos-viva.cjs (rpc-ci).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261550000000$
DECLARE
  r record;
  v_caminho text;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: storage.objects ausente.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('storage.objects') AND relrowsecurity) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: storage.objects sem RLS ligada (a politica nao valeria; a plataforma liga, conferir a loja).';
  END IF;

  -- A porta do admin de agora (20261197): corpo, seguranca e EXECUTE so para authenticated.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.rls_admin_atual()')
        AND md5(replace(p.prosrc, chr(13), '')) = 'ccb7a56e835b8181795fffb7bee97305'
        AND p.prosecdef) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: rls_admin_atual() ausente ou divergente (a 20261197 e a base desta migration).';
  END IF;
  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
     OR has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: EXECUTE de rls_admin_atual() divergente (a politica nova precisa dele para authenticated e nao para anon).';
  END IF;

  -- Politica homonima: so "ausente" ou "exatamente a desta migration" (forma deparseada com search_path = pg_catalog).
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
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: storage.objects ja tem a politica "%" com outra forma; conferir antes de aplicar (nao se derruba politica de ninguem).', r.politica;
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight_20261550000000$;

-- ===== as duas politicas =====

DROP POLICY IF EXISTS "Admin Select Access (products)" ON storage.objects;
CREATE POLICY "Admin Select Access (products)" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'products' AND (SELECT public.rls_admin_atual()));

DROP POLICY IF EXISTS "Admin Select Access (banners)" ON storage.objects;
CREATE POLICY "Admin Select Access (banners)" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'banners' AND (SELECT public.rls_admin_atual()));

-- ===== pos-voo =====

DO $posvoo_20261550000000$
DECLARE
  r record;
  v_caminho text;
BEGIN
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('Admin Select Access (products)', '((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('Admin Select Access (banners)', '((bucket_id = ''banners''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))')
  ) AS esperado(politica, qual) LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_policy p
          WHERE p.polrelid = to_regclass('storage.objects') AND p.polname = r.politica
            AND p.polcmd = 'r' AND p.polpermissive
            AND p.polroles = ARRAY['authenticated'::regrole::oid]
            AND pg_get_expr(p.polqual, p.polrelid) = r.qual
            AND p.polwithcheck IS NULL) THEN
      PERFORM set_config('search_path', v_caminho, true);
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: a politica "%" de storage.objects nao ficou com a forma desta migration.', r.politica;
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $posvoo_20261550000000$;

-- 184b-antes-a-caderneta-fecha-para-o-service-role-ausente: ANTES da 20261480000000 (ou depois do rollback-manual dela). SO LEITURA, somente
-- catalogo, rol fechado de 5 linhas. Nao le nenhuma linha. As linhas 2 e 3 sao o estado que o rollback reproduz (GRANT ALL ... TO
-- service_role): o service_role com o conjunto inteiro de privilegios de tabela do dono, concedido pelo dono, sem GRANT OPTION e sem
-- privilegio de coluna. Se vier "nao" nelas ANTES do apply, o pre-voo da migration recusaria (B1_BASELINE_DIVERGENT, nada escrito) ou o
-- banco ja esta fechado: meca antes. As linhas 4 e 5 sao a base que o pre-voo exige (o mesmo dono e a 20261460000000 aplicada).
WITH tab AS (
  SELECT c.oid, c.relname, c.relowner, c.relacl
  FROM pg_class c WHERE c.oid IN (to_regclass('public.frota_lojas'), to_regclass('public.frota_segredo'))
), fn AS (
  SELECT p.proname, p.proowner, md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')
    AND pg_get_function_identity_arguments(p.oid) = 'p_host text, p_chave text'
), com_tudo AS (
  SELECT t.relname,
         (SELECT string_agg(g.privilege_type || CASE WHEN g.grantor = t.relowner THEN '' ELSE '/outro' END
                            || CASE WHEN g.is_grantable THEN '*' ELSE '' END, ',' ORDER BY g.privilege_type)
            FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) g WHERE g.grantee = to_regrole('service_role'))
         = (SELECT string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
              FROM aclexplode(acldefault('r', t.relowner)) g WHERE g.grantee = t.relowner)
         AND NOT EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                          WHERE a.attrelid = t.oid AND a.attacl IS NOT NULL AND g.grantee = to_regrole('service_role')) AS tudo
  FROM tab t
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas: service_role ainda com TODOS os privilegios de tabela (o conjunto do dono, concedido pelo dono, sem grant option) e nenhum de coluna', 'sim', CASE WHEN
    COALESCE((SELECT x.tudo FROM com_tudo x WHERE x.relname = 'frota_lojas'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_segredo: service_role ainda com TODOS os privilegios de tabela (o conjunto do dono, concedido pelo dono, sem grant option) e nenhum de coluna', 'sim', CASE WHEN
    COALESCE((SELECT x.tudo FROM com_tudo x WHERE x.relname = 'frota_segredo'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas e frota_segredo existem com o mesmo dono da resolver_loja e da resolver_loja_com_estado', 'sim', CASE WHEN
    (SELECT count(*) FROM tab) = 2 AND (SELECT count(*) FROM fn) = 2
    AND (SELECT count(DISTINCT d) FROM (SELECT relowner AS d FROM tab UNION ALL SELECT proowner FROM fn) x) = 1 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a 20261460000000 esta aplicada: resolver_loja e resolver_loja_com_estado com os corpos dela (md5)', 'sim', CASE WHEN
    (SELECT h FROM fn WHERE proname = 'resolver_loja') = '19072d99f3253583342a0bb6c42447dd'
    AND (SELECT h FROM fn WHERE proname = 'resolver_loja_com_estado') = '92682af1143806d3662411b6d5788096' THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

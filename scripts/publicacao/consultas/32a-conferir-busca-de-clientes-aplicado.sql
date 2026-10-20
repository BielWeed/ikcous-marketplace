-- 32a — DEPOIS de aplicar as migrations 20261230000000 e 20261231000000 (a busca de clientes: a tela Clientes,
-- o balcao e o cupom exclusivo acham pelo numero do WhatsApp; a aba Clientes do CRM ignora acento): confirma,
-- POR OBJETO, que o corpo vivo de cada uma das DUAS funcoes e o NOVO (md5), que cada uma mantem os atributos de
-- sempre (SECURITY DEFINER, plpgsql, o search_path e a volatilidade de sempre) e que a ACL segue a de sempre
-- (PUBLIC e anon sem EXECUTE; authenticated e service_role com). E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 32b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha de
-- cliente, de perfil ou de pedido e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9 linhas, as
-- mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma
-- linha). Tudo `true` = a busca nova esta aplicada; qualquer `false` = PARE e leia a linha. Depois do
-- rollback-manual de uma das duas reprovam SO as duas linhas do corpo dela (md5 e marcador).
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261230000000
--                (get_admin_customers_paged) e o da 20261231000000 (crm_clientes).
--   * marcador -- 'sim' se o corpo traz a regra nova: na tela Clientes, o calculo dos digitos (`v_search_digitos`)
--                e o corte do 55 (`IN (12, 13)`); no CRM, o `f_unaccent` sobre o nome. Leitura humana do
--                mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + a volatilidade e o `search_path` de cada uma (a tela Clientes:
--                VOLATILE e {search_path=public, extensions}; o CRM: STABLE e {search_path=public}).
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e
--                service_role por has_function_privilege. (A ACL ja e' a das duas funcoes desde a
--                20261199000000; aqui ela confirma que os corpos novos nao a mexeram.)
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts e pelos testes
-- estaticos tests/migration_a_busca_de_clientes_acha_pelo_numero_do_whatsapp_test.ts e
-- tests/migration_a_busca_do_crm_ignora_acento_test.ts; tests/banco/busca-de-clientes-portao-viva.cjs roda
-- esta consulta num Postgres real (positiva depois do apply, negativa depois de cada rollback, um negativo por
-- linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de tests/banco/busca-de-clientes-viva.cjs). Evidencia
-- LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(chave, assinatura) AS (
  VALUES ('clientes', 'public.get_admin_customers_paged(text,text,text,integer,integer)'),
         ('crm', 'public.crm_clientes(text,text,integer,integer)')
), fn AS (
  SELECT t.chave,
         p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN t.chave = 'clientes'
                   THEN CASE WHEN position('v_search_digitos' IN p.prosrc) > 0
                                  AND position('IN (12, 13)' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END
              ELSE CASE WHEN position('public.f_unaccent(COALESCE(nome_exibido' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END
         END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql'
                   AND ((t.chave = 'clientes' AND p.provolatile = 'v'
                         AND p.proconfig = ARRAY['search_path=public, extensions']::text[])
                     OR (t.chave = 'crm' AND p.provolatile = 's'
                         AND p.proconfig = ARRAY['search_path=public']::text[]))
              THEN 'SECURITY DEFINER plpgsql ' || CASE WHEN t.chave = 'clientes' THEN 'VOLATILE search_path=public, extensions'
                                                       ELSE 'STABLE search_path=public' END
              ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                          WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_admin_customers_paged: corpo e o da 20261230000000, com a busca por digitos do WhatsApp (md5)',
         'd6c092c3e0d8069891af795147d65e9e',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_customers_paged: o corpo traz os digitos do termo e o corte do 55',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_customers_paged: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, extensions)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public, extensions',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_customers_paged: EXECUTE fechado para anon (authenticated e service_role sim)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.chave = 'clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_clientes: corpo e o da 20261231000000, com nome e e-mail sem acento (md5)',
         '9c4268178a50729b5f7b256b77882585',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_clientes: o corpo ignora o acento do nome',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_clientes: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)',
         'SECURITY DEFINER plpgsql STABLE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_clientes: EXECUTE fechado para anon (authenticated e service_role sim)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

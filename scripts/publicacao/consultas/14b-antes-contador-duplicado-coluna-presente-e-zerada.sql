-- 14b - ANTES de aplicar a migration 20261207000000 (o contador duplicado do cupom
-- morre: apaga `public.coupons.used_count`): confirma que a condicao em que o dono
-- aprovou apagar VALE AGORA, nesta loja. E' a consulta "do antes" do lote
-- (`ausenciaConfirmadaPor` em scripts/frota/canais-de-backend.json): aqui o antes e'
-- o CONTRARIO do precedente 12b -- a coluna tem de estar PRESENTE e zerada, e nada
-- pode depender dela. So com a 14a NEGATIVA e esta POSITIVA (da mesma janela ou mais
-- nova) o portao (scripts/frota/publicar-release.mjs) imprime o apply.
-- SO LEITURA, um unico SELECT: catalogo (pg_attribute, pg_attrdef, pg_depend, pg_description,
-- pg_proc, pg_namespace, pg_policies, pg_trigger, pg_views) e UMA contagem sobre `public.coupons`
-- (`to_jsonb(c)` para a linha, so para contar: nenhum valor, codigo de cupom, pedido,
-- cliente ou dinheiro e' lido nem devolvido).
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO
-- de 13 linhas, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE`
-- na propria linha, nunca some uma linha). Tudo `true` = a migration pode ser aplicada;
-- um `false` nomeia o que impede. Sao as MESMAS condicoes do pre-voo
-- `PREFLIGHT_20261207` da migration, lidas antes de gravar qualquer coisa.
--
-- O QUE CADA LINHA PROVA
--   * controle        -- o papel enxerga as funcoes de `public` (catalogo vazio, por
--                        permissao, faria todo "AUSENTE" parecer erro).
--   * coluna presente -- `used_count` existe (se ela ja nao existe, a migration ja foi
--                        aplicada: o caminho e' a 14a, nao esta).
--   * forma           -- integer, aceita NULL, DEFAULT 0, nem gerada nem identidade: a
--                        forma que o rollback recria.
--   * usage_count     -- o contador verdadeiro existe e esta na forma do baseline (integer,
--                        aceita NULL, DEFAULT 0, nem gerada nem identidade): a MESMA forma que
--                        o pre-voo da migration exige e que a 14a cobra depois do apply. Sem
--                        isso a loja passaria aqui, apagaria, e a 14a sairia NEGATIVA com a
--                        coluna ja apagada.
--   * permissao propria -- `used_count` nao tem permissao por coluna (pg_attribute.attacl
--                        nulo): o DROP COLUMN a apagaria e o rollback nao a recria.
--   * comentario proprio -- `used_count` nao tem comentario (pg_description): idem.
--   * seguranca por linha -- `row_security_active('public.coupons')` e' falso para este
--                        papel: sem isso a contagem de baixo so veria as linhas que o
--                        papel enxerga e "tudo zero" nao valeria nada.
--   * linhas          -- quantas linhas tem used_count DIFERENTE de 0 exato; NULL conta
--                        (como o item 5 da 13a). Quando a coluna nao existe a linha diz
--                        `AUSENTE`, nunca "todas as linhas": `to_jsonb(c)` sem a chave
--                        daria "diferente de 0" para toda linha.
--   * dependentes     -- linhas de pg_depend sobre a coluna (visao, politica, gatilho,
--                        indice, constraint, coluna GERADA que a cita, estatistica...),
--                        EXCETO o DEFAULT da PROPRIA used_count: o pg_attrdef cuja coluna
--                        (adnum) e' a mesma da dependencia. Qualquer outro pg_attrdef
--                        (a expressao de uma coluna gerada de OUTRA coluna) CONTA.
--   * texto           -- nenhuma funcao de `public` (corpo, qualquer tipo de rotina),
--                        politica, gatilho nem visao de `public` cita `used_count`.
--
-- LIMITES: nao le valor de cupom, so conta. Evidencia LOCAL nao prova a IKCOUS nem a
-- Savy: so o run desta consulta contra o ref de cada loja. A resposta vale como
-- evidencia so com rol=ok no veredito. Uma gravacao em used_count DEPOIS desta consulta
-- e ANTES do apply nao e' vista aqui: o pre-voo da migration a trava a partir do LOCK
-- (SHARE ROW EXCLUSIVE). No envelope REPEATABLE READ do aplicar-migrations.yml a foto da
-- impressao digital e' tirada ANTES do LOCK: um UPDATE depois da foto faz o pre-voo
-- RECUSAR (40001; o workflow mostra ESTADO DESCONHECIDO; e' so repetir). Um INSERT com
-- used_count explicito diferente de zero nos segundos entre a foto e o LOCK nao e' visto:
-- risco residual aceito (ninguem grava essa coluna).
WITH tab AS (
  SELECT to_regclass('public.coupons') AS oid
), col AS (
  SELECT a.attnum, a.atttypid = 'integer'::regtype AND NOT a.attnotnull
                   AND a.attgenerated = '' AND a.attidentity = ''
                   AND pg_get_expr(ad.adbin, ad.adrelid) IS NOT DISTINCT FROM '0' AS forma_ok
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE a.attrelid = (SELECT oid FROM tab)
     AND a.attname = 'used_count' AND a.attnum > 0 AND NOT a.attisdropped
), acl AS (
  SELECT a.attacl IS NOT NULL AS tem
    FROM pg_attribute a
   WHERE a.attrelid = (SELECT oid FROM tab)
     AND a.attname = 'used_count' AND a.attnum > 0 AND NOT a.attisdropped
), uso AS (
  SELECT a.atttypid = 'integer'::regtype AND NOT a.attnotnull
         AND a.attgenerated = '' AND a.attidentity = ''
         AND pg_get_expr(ad.adbin, ad.adrelid) IS NOT DISTINCT FROM '0' AS forma_ok
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE a.attrelid = (SELECT oid FROM tab)
     AND a.attname = 'usage_count' AND a.attnum > 0 AND NOT a.attisdropped
), dep AS (
  SELECT count(*) AS n
    FROM pg_depend d
   WHERE d.refclassid = 'pg_class'::regclass
     AND d.refobjid = (SELECT oid FROM tab)
     AND d.refobjsubid = (SELECT attnum FROM col)
     AND NOT (
       d.classid = 'pg_attrdef'::regclass
       AND EXISTS (
         SELECT 1 FROM pg_attrdef ad
          WHERE ad.oid = d.objid
            AND ad.adrelid = d.refobjid
            AND ad.adnum = d.refobjsubid
       )
     )
), fn AS (
  SELECT coalesce(string_agg(p.proname::text, ',' ORDER BY p.proname), '(nenhuma)') AS nomes
    FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND strpos(lower(p.prosrc), 'used_count') > 0
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'coupons.used_count: coluna presente', 'PRESENTE',
         CASE WHEN EXISTS (SELECT 1 FROM col) THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'coupons.used_count: forma do baseline (integer, aceita NULL, DEFAULT 0)', 'sim',
         COALESCE((SELECT CASE WHEN c.forma_ok THEN 'sim' ELSE 'nao' END FROM col c), 'AUSENTE')
  UNION ALL
  SELECT 'coupons.usage_count: forma do baseline (integer, aceita NULL, DEFAULT 0)', 'sim',
         COALESCE((SELECT CASE WHEN u.forma_ok THEN 'sim' ELSE 'nao' END FROM uso u), 'AUSENTE')
  UNION ALL
  SELECT 'coupons.used_count: permissao propria por coluna (attacl)', 'nenhuma',
         CASE WHEN NOT EXISTS (SELECT 1 FROM col) THEN 'AUSENTE'
              WHEN (SELECT tem FROM acl) THEN 'tem' ELSE 'nenhuma' END
  UNION ALL
  SELECT 'coupons.used_count: comentario proprio', 'nenhum',
         CASE WHEN NOT EXISTS (SELECT 1 FROM col) THEN 'AUSENTE'
              WHEN EXISTS (SELECT 1 FROM pg_description d
                            WHERE d.classoid = 'pg_class'::regclass
                              AND d.objoid = (SELECT oid FROM tab)
                              AND d.objsubid = (SELECT attnum FROM col)) THEN 'tem' ELSE 'nenhum' END
  UNION ALL
  SELECT 'public.coupons: a seguranca por linha vale para este papel', 'nao',
         CASE WHEN (SELECT oid FROM tab) IS NULL THEN 'AUSENTE'
              WHEN row_security_active('public.coupons') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'coupons.used_count: linhas com valor diferente de 0 (NULL conta)', '0',
         CASE WHEN NOT EXISTS (SELECT 1 FROM col) THEN 'AUSENTE'
              ELSE (SELECT count(*)::text FROM public.coupons c
                     WHERE (to_jsonb(c) -> 'used_count') IS DISTINCT FROM '0'::jsonb) END
  UNION ALL
  SELECT 'coupons.used_count: dependentes (fora o default da propria coluna)', '0',
         CASE WHEN NOT EXISTS (SELECT 1 FROM col) THEN 'AUSENTE'
              ELSE (SELECT n::text FROM dep) END
  UNION ALL
  SELECT 'funcoes de public que citam used_count', '(nenhuma)',
         (SELECT nomes FROM fn)
  UNION ALL
  SELECT 'politicas de public que citam used_count', '0',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public'
             AND (strpos(lower(qual), 'used_count') > 0
                  OR strpos(lower(with_check), 'used_count') > 0))
  UNION ALL
  SELECT 'gatilhos que citam used_count', '0',
         (SELECT count(*)::text FROM pg_trigger t
           WHERE NOT t.tgisinternal AND strpos(lower(pg_get_triggerdef(t.oid)), 'used_count') > 0)
  UNION ALL
  SELECT 'visoes de public que citam used_count', '0',
         (SELECT count(*)::text FROM pg_views
           WHERE schemaname = 'public' AND strpos(lower(definition), 'used_count') > 0)
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

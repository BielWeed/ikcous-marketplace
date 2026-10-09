-- 11a — DEPOIS de aplicar a migration 20261204000000 (a venda do balcao se anula no
-- mesmo dia): confere, por OBJETO, que a funcao `anular_venda_presencial(uuid, text)`
-- esta de pe com o corpo FINAL esperado e com a ACL certa. E' a prova de objetos do
-- lote `20261204000000` em scripts/frota/canais-de-backend.json: o portao
-- (scripts/frota/publicar-release.mjs) so libera a release com esta consulta
-- POSITIVA (ou, antes do apply, NEGATIVA com a 11b positiva).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language):
-- nenhuma linha de pedido, venda, caixa ou cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e'
-- FECHADO: sempre as mesmas 14 linhas, em qualquer estado do banco (objeto ausente
-- vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a migration
-- esta inteira no banco. Um `false` nomeia o que ficou de fora ou divergiu.
--
-- O QUE CADA GRUPO DE LINHAS PROVA (cada item reprova na SUA linha)
--   * controle     -- o papel enxerga as funcoes de `public` (um catalogo vazio, por
--                     permissao, faria todo "AUSENTE" parecer erro e todo "nao" parecer
--                     acerto).
--   * a funcao     -- uma sobrecarga so, SECURITY DEFINER, `search_path=public`,
--                     plpgsql que devolve jsonb, corpo (prosrc) com o sha256 do corpo
--                     desta migration (LF ou CRLF, a mesma conta do rollback-manual) e
--                     ACL: SEM EXECUTE para PUBLIC, anon e service_role, COM EXECUTE para
--                     authenticated. PUBLIC e' medido por
--                     aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                     has_function_privilege nao tem o pseudo-papel PUBLIC (o mesmo
--                     metodo da 20261090500000).
--   * dependencias -- `is_admin_atual()`, `pedido__mudar_status(...)`,
--                     `devolver_estoque(uuid)` e `fin__dia`/`fin__hoje` existem (a funcao
--                     chama as quatro; o corpo delas e' conferido ANTES do apply pela
--                     11b e pelo pre-voo da migration, nao aqui, para uma migration
--                     futura que as aperfeicoe nao reprovar a prova desta).
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta do
-- rollback-manual. O hash final aparece abaixo uma vez em LF e uma em CRLF;
-- tests/ci_conferir_banco_test.ts recalcula os dois a partir do arquivo da migration
-- desta arvore, e tests/banco/anular-venda-portao-viva.cjs roda esta consulta num
-- Postgres real (positivo depois do apply, e um negativo por item).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva da migration, em
-- tests/banco/anular-venda-viva.cjs); prova que o objeto vivo e' o desta migration.
-- Evidencia LOCAL nao prova a CAF nem a Savy: so o run desta consulta contra o ref de
-- cada loja.
WITH fn AS (
  SELECT p.prosecdef, p.proconfig, l.lanname, p.prorettype::regtype::text AS retorno,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS exec_public,
         CASE WHEN to_regrole('anon') IS NULL THEN NULL
              ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS exec_anon,
         CASE WHEN to_regrole('authenticated') IS NULL THEN NULL
              ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS exec_auth,
         CASE WHEN to_regrole('service_role') IS NULL THEN NULL
              ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS exec_service
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.anular_venda_presencial(uuid,text)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'anular_venda_presencial: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'anular_venda_presencial')
  UNION ALL
  SELECT 'anular_venda_presencial: SECURITY DEFINER', 'true',
         COALESCE((SELECT f.prosecdef::text FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'anular_venda_presencial: search_path', 'search_path=public',
         COALESCE((SELECT COALESCE(array_to_string(f.proconfig, ','), 'sem search_path') FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'anular_venda_presencial: linguagem e retorno', 'plpgsql jsonb',
         COALESCE((SELECT f.lanname || ' ' || f.retorno FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'anular_venda_presencial: corpo (sha256)',
         'f7d50fc4e53536209d265b9b8acb7bc5df327b131523a015bb7a29549b577701',
         COALESCE((SELECT CASE WHEN f.h IN ('f7d50fc4e53536209d265b9b8acb7bc5df327b131523a015bb7a29549b577701',
                                            'c6a471f446010427d0f43fd8a3976b8005c3d8da054b59876bf68679f3182cdc')
                               THEN 'f7d50fc4e53536209d265b9b8acb7bc5df327b131523a015bb7a29549b577701'
                               ELSE f.h END
                     FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'anular_venda_presencial: EXECUTE para PUBLIC', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'anular_venda_presencial: EXECUTE para anon', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_anon IS NULL THEN 'papel anon ausente'
                               WHEN f.exec_anon THEN 'sim' ELSE 'nao' END FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'anular_venda_presencial: EXECUTE para authenticated', 'sim',
         COALESCE((SELECT CASE WHEN f.exec_auth IS NULL THEN 'papel authenticated ausente'
                               WHEN f.exec_auth THEN 'sim' ELSE 'nao' END FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'anular_venda_presencial: EXECUTE para service_role', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_service IS NULL THEN 'papel service_role ausente'
                               WHEN f.exec_service THEN 'sim' ELSE 'nao' END FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'dependencia is_admin_atual(): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.is_admin_atual()') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia pedido__mudar_status(...): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)') IS NOT NULL
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia devolver_estoque(uuid): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.devolver_estoque(uuid)') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia fin__dia e fin__hoje: existem', 'EXISTEM',
         CASE WHEN to_regprocedure('public.fin__dia(timestamptz)') IS NOT NULL
                AND to_regprocedure('public.fin__hoje()') IS NOT NULL
              THEN 'EXISTEM' ELSE 'AUSENTE' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

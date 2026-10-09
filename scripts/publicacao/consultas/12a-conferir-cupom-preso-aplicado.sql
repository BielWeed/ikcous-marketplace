-- 12a — DEPOIS de aplicar as migrations 20261205000000 e 20261206000000 (o cupom preso
-- diz quando a vaga volta, e a vaga do pedido nunca cobrado volta em 1 h): confere, por
-- OBJETO, que as TRES funcoes estao de pe com o corpo FINAL esperado e com a ACL certa:
--   * `cupom__vaga_volta_em(...)`           o auxiliar (corpo da 20261206);
--   * `vaga_do_cupom_presa(text)`           a RPC que a tela chama (corpo da 20261205);
--   * `devolver_cupons_de_pedidos_mortos()` a varredura reescrita (corpo da 20261206).
-- E' a prova de objetos do lote `20261205000000` + `20261206000000` em
-- scripts/frota/canais-de-backend.json: o portao (scripts/frota/publicar-release.mjs)
-- so libera a release com esta consulta POSITIVA (ou, antes do apply, NEGATIVA com a
-- 12b positiva).
-- SO LEITURA, um unico SELECT: catalogo (pg_proc, pg_namespace, pg_language) e o
-- agendador (cron.job: so jobname, schedule e active). Nenhuma linha de pedido, cupom,
-- cliente ou dinheiro e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e'
-- FECHADO: sempre as mesmas 24 linhas, em qualquer estado do banco (objeto ausente vira
-- `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = as duas migrations
-- estao inteiras no banco. Um `false` nomeia o que ficou de fora ou divergiu.
--
-- O QUE CADA GRUPO DE LINHAS PROVA (cada item reprova na SUA linha)
--   * controle    -- o papel enxerga as funcoes de `public` (catalogo vazio, por
--                    permissao, faria todo "AUSENTE" parecer erro).
--   * o auxiliar  -- uma sobrecarga so, corpo (prosrc) com o sha256 da 20261206 (LF ou
--                    CRLF) e SEM EXECUTE para PUBLIC, anon, authenticated e service_role
--                    (so o dono e as funcoes SECURITY DEFINER que o chamam).
--   * a RPC       -- uma sobrecarga so, SECURITY DEFINER, `search_path=public`, plpgsql
--                    que devolve jsonb, corpo com o sha256 da 20261205, EXECUTE SO para
--                    authenticated (nao para PUBLIC, anon nem service_role).
--   * a varredura -- uma sobrecarga so, SECURITY DEFINER, `search_path=public`, corpo
--                    com o sha256 da 20261206, SEM EXECUTE para PUBLIC, anon nem
--                    authenticated. PUBLIC e' medido por
--                    aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                    has_function_privilege nao tem o pseudo-papel PUBLIC (o mesmo metodo
--                    da 11a).
--   * os donos    -- o DONO da varredura e o DONO da RPC tem EXECUTE no auxiliar. As duas
--                    sao SECURITY DEFINER e chamam o auxiliar COM O PAPEL DO DONO: se o
--                    dono de uma delas divergir do dono do auxiliar e nao tiver EXECUTE,
--                    a varredura falha em TODO ciclo (e as vagas deixam de voltar, sem
--                    erro visivel para ninguem) e a RPC passa a falhar para quem a chama.
--   * as dependencias -- `devolver_uso_cupom(uuid)` (a varredura a chama) e `auth.uid()`
--                    (a RPC a chama) existem.
--   * o agendamento -- o job `devolver-cupons-de-pedidos-mortos` esta agendado a cada 15
--                    minutos e ATIVO (a varredura so devolve a vaga se roda).
--
-- VISIBILIDADE DO JOB (importante): `cron.job` tem RLS no pg_cron ("so quem criou o job
-- ve o job"), e um papel que SOFRE essa RLS pode ver ZERO jobs mesmo com o job rodando
-- (a mesma ressalva da 8g-cron-reconciliar). Quem decide se o papel e' cego e'
-- row_security_active('cron.job') (o mesmo recurso da 8k): `true` = a RLS vale para
-- ele. A linha do agendamento so NAO conclui nada quando as DUAS coisas valem: a RLS e'
-- ativa para o papel E ele ve zero jobs; ai diz `NAO VERIFICAVEL` nas duas colunas, com o
-- motivo, e fica ok = true so para nao travar o portao por uma coisa que o papel nao
-- enxerga (o job se confere no painel do Supabase, Database -> Cron, ou pela 8g). Um papel
-- que ATRAVESSA a RLS (BYPASSRLS, como o supabase_read_only_user) tem `false` e a linha
-- e' ESTRITA mesmo com zero jobs: o zero e' a verdade, e job ausente reprova. Tambem e'
-- estrita quando o papel ve algum job: ausente, inativo ou com outro horario reprova.
-- Se o papel nao tem sequer USAGE no schema cron, a consulta ERRA (SQLSTATE 42501) e o
-- portao fica SEM EVIDENCIA, nunca positivo.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta dos
-- rollbacks-manuais. Cada hash aparece aqui uma vez em LF e uma em CRLF;
-- tests/ci_conferir_banco_test.ts recalcula os seis a partir dos arquivos das migrations
-- desta arvore, e tests/banco/cupom-preso-portao-viva.cjs roda esta consulta num
-- Postgres real (positivo depois do apply, e um negativo por linha).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva das migrations, em
-- tests/banco/cupom-preso-viva.cjs); prova que o objeto vivo e' o das migrations. Nao
-- prova o codigo das edge functions de que a pista rapida depende (criar-pagamento e
-- webhook-mercadopago: a vaga de cobranca so e' adotada para cartao). Evidencia LOCAL
-- nao prova a CAF nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH f AS (
  SELECT x.chave, p.oid AS fn_oid, p.proowner, p.prosecdef, p.proconfig, l.lanname,
         p.prorettype::regtype::text AS retorno,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS exec_public,
         CASE WHEN to_regrole('anon') IS NULL THEN NULL
              ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS exec_anon,
         CASE WHEN to_regrole('authenticated') IS NULL THEN NULL
              ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS exec_auth,
         CASE WHEN to_regrole('service_role') IS NULL THEN NULL
              ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS exec_service
    FROM (VALUES
           ('aux', 'public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer)'),
           ('rpc', 'public.vaga_do_cupom_presa(text)'),
           ('var', 'public.devolver_cupons_de_pedidos_mortos()')
         ) AS x(chave, assinatura)
    JOIN pg_proc p ON p.oid = to_regprocedure(x.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), vis AS (
  SELECT count(*) AS n FROM cron.job
), rls AS (
  SELECT row_security_active('cron.job') AS ativa
), agendado AS (
  SELECT j.schedule, j.active
    FROM cron.job j
   WHERE j.jobname = 'devolver-cupons-de-pedidos-mortos'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  -- o auxiliar
  UNION ALL
  SELECT 'cupom__vaga_volta_em: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'cupom__vaga_volta_em')
  UNION ALL
  SELECT 'cupom__vaga_volta_em: corpo (sha256)',
         'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363',
         COALESCE((SELECT CASE WHEN f.h IN ('aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363',
                                            '6fc3bb6775c34d5739516fa9841bbc4787ae2d3be87e647acca8d465c513f6b6')
                               THEN 'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363'
                               ELSE f.h END
                     FROM f WHERE f.chave = 'aux'), 'AUSENTE')
  UNION ALL
  SELECT 'cupom__vaga_volta_em: EXECUTE para PUBLIC, anon, authenticated e service_role', 'nenhum',
         COALESCE((SELECT CASE WHEN array_length(q.quem, 1) IS NULL THEN 'nenhum'
                               ELSE array_to_string(q.quem, ',') END
                     FROM (SELECT array_remove(ARRAY[
                                    CASE WHEN f.exec_public THEN 'PUBLIC' END,
                                    CASE WHEN COALESCE(f.exec_anon, false) THEN 'anon' END,
                                    CASE WHEN COALESCE(f.exec_auth, false) THEN 'authenticated' END,
                                    CASE WHEN COALESCE(f.exec_service, false) THEN 'service_role' END
                                  ], NULL) AS quem
                             FROM f WHERE f.chave = 'aux') q), 'AUSENTE')
  -- a RPC
  UNION ALL
  SELECT 'vaga_do_cupom_presa: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'vaga_do_cupom_presa')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: SECURITY DEFINER', 'true',
         COALESCE((SELECT f.prosecdef::text FROM f WHERE f.chave = 'rpc'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: search_path', 'search_path=public',
         COALESCE((SELECT COALESCE(array_to_string(f.proconfig, ','), 'sem search_path')
                     FROM f WHERE f.chave = 'rpc'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: linguagem e retorno', 'plpgsql jsonb',
         COALESCE((SELECT f.lanname || ' ' || f.retorno FROM f WHERE f.chave = 'rpc'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: corpo (sha256)',
         'a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47',
         COALESCE((SELECT CASE WHEN f.h IN ('a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47',
                                            '49e0b6befb684756ed4f1fada1e30ed7162763dc903816f49f2f76ce61820593')
                               THEN 'a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47'
                               ELSE f.h END
                     FROM f WHERE f.chave = 'rpc'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: EXECUTE para PUBLIC', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END FROM f WHERE f.chave = 'rpc'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: EXECUTE para anon', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_anon IS NULL THEN 'papel anon ausente'
                               WHEN f.exec_anon THEN 'sim' ELSE 'nao' END FROM f WHERE f.chave = 'rpc'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: EXECUTE para authenticated', 'sim',
         COALESCE((SELECT CASE WHEN f.exec_auth IS NULL THEN 'papel authenticated ausente'
                               WHEN f.exec_auth THEN 'sim' ELSE 'nao' END FROM f WHERE f.chave = 'rpc'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: EXECUTE para service_role', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_service IS NULL THEN 'papel service_role ausente'
                               WHEN f.exec_service THEN 'sim' ELSE 'nao' END FROM f WHERE f.chave = 'rpc'), 'AUSENTE')
  -- a varredura
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: SECURITY DEFINER', 'true',
         COALESCE((SELECT f.prosecdef::text FROM f WHERE f.chave = 'var'), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: search_path', 'search_path=public',
         COALESCE((SELECT COALESCE(array_to_string(f.proconfig, ','), 'sem search_path')
                     FROM f WHERE f.chave = 'var'), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: corpo (sha256)',
         'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
         COALESCE((SELECT CASE WHEN f.h IN ('f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
                                            'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8')
                               THEN 'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f'
                               ELSE f.h END
                     FROM f WHERE f.chave = 'var'), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: EXECUTE para PUBLIC', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END FROM f WHERE f.chave = 'var'), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: EXECUTE para anon', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_anon IS NULL THEN 'papel anon ausente'
                               WHEN f.exec_anon THEN 'sim' ELSE 'nao' END FROM f WHERE f.chave = 'var'), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: EXECUTE para authenticated', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_auth IS NULL THEN 'papel authenticated ausente'
                               WHEN f.exec_auth THEN 'sim' ELSE 'nao' END FROM f WHERE f.chave = 'var'), 'AUSENTE')
  -- os donos da varredura e da RPC chamam o auxiliar com o proprio papel
  UNION ALL
  SELECT 'donos da varredura e da RPC: EXECUTE no auxiliar', 'sim',
         CASE WHEN (SELECT count(*) FROM f) <> 3 THEN 'AUSENTE'
              WHEN (SELECT bool_and(has_function_privilege(d.proowner, a.fn_oid, 'EXECUTE'))
                      FROM f d, f a WHERE d.chave IN ('rpc', 'var') AND a.chave = 'aux')
              THEN 'sim' ELSE 'nao' END
  -- as dependencias
  UNION ALL
  SELECT 'dependencia devolver_uso_cupom(uuid): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.devolver_uso_cupom(uuid)') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia auth.uid(): existe', 'EXISTE',
         CASE WHEN to_regprocedure('auth.uid()') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  -- o agendamento
  UNION ALL
  SELECT 'job devolver-cupons-de-pedidos-mortos: agendado a cada 15 min e ativo',
         CASE WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls)
              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'
              ELSE 'ativo */15 * * * *' END,
         CASE WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls)
              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'
              WHEN NOT EXISTS (SELECT 1 FROM agendado) THEN 'AUSENTE'
              ELSE (SELECT string_agg(CASE WHEN g.active THEN 'ativo ' ELSE 'inativo ' END || g.schedule,
                                      '; ' ORDER BY g.schedule, g.active)
                      FROM agendado g) END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

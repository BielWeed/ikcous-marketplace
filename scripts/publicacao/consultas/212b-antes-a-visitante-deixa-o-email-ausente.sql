-- 212b-antes-a-visitante-deixa-o-email-ausente: ANTES da 20261656000000. SO LEITURA, somente catalogo, rol fechado de 4 linhas (o mesmo
-- da 212a). Confere as premissas do pre-voo: as duas funcoes novas AUSENTES (ou uma so cada, com o corpo desta, para uma reaplicacao
-- idempotente: informar_email_da_visitante md5 4ab021c0ff86fbecf36e4c4702a04398, reivindicar_comprovante_da_visitante md5
-- 37c9cd2bd0d16c466bb824d0f3a2887c), o teto de e-mail da 20261217000000 no ar com os corpos dela e as colunas de marketplace_orders que
-- as duas leem. NAO le nenhuma linha de pedido nem de contador e NAO chama funcao nenhuma. Tudo true = pode aplicar; qualquer false = PARE
-- (o pre-voo da migration recusaria).
WITH fn AS (
  SELECT q.nome,
         (SELECT count(*) FROM pg_catalog.pg_proc x
           WHERE x.pronamespace = 'public'::regnamespace AND x.proname = q.nome) AS n,
         md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
           AND pg_get_function_arguments(p.oid) = q.argumentos
           AND pg_get_function_result(p.oid) = q.retorno
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND has_function_privilege('anon', p.oid, 'EXECUTE') = q.anon
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = q.anon
           AND has_function_privilege('service_role', p.oid, 'EXECUTE') = (NOT q.anon) AS atributos
  FROM (VALUES
          ('informar_email_da_visitante', 'public.informar_email_da_visitante(uuid,text)', 'p_order_id uuid, p_email text', 'jsonb', true),
          ('reivindicar_comprovante_da_visitante', 'public.reivindicar_comprovante_da_visitante(uuid)', 'p_order_id uuid', 'boolean', false)
       ) q(nome, assinatura, argumentos, retorno, anon)
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(q.assinatura)
  LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
), teto AS (
  SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.reservar_vaga_de_email(text,integer)'))
                   = '373815e668edf9480d2dce94fb59d467', false)
         AND COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.chave_do_destinatario(text)'))
                   = 'b5a9a0f8bb405c082cdb8cb7ee662d1e', false)
         AND to_regprocedure('public.liberar_email_de_confirmacao(uuid)') IS NOT NULL AS certo
), colunas AS (
  SELECT COALESCE((SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname)
                     FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attnum > 0 AND NOT a.attisdropped
                      AND a.attname IN ('id', 'user_id', 'canal', 'payment_method', 'created_at', 'customer_data', 'confirmation_email_sent_at'))
                   = 'canal:text,confirmation_email_sent_at:timestamp with time zone,created_at:timestamp with time zone,customer_data:jsonb,id:uuid,payment_method:text,user_id:uuid', false) AS certo
), itens(item, esperado, vivo, ok) AS (
  SELECT 'informar_email_da_visitante: corpo exato (md5), uma so, plpgsql SECURITY DEFINER VOLATILE, search_path=public, EXECUTE de anon e authenticated (nem PUBLIC nem service_role)',
         'AUSENTE ou 4ab021c0ff86fbecf36e4c4702a04398',
         COALESCE(f.h, 'AUSENTE')
           || CASE WHEN f.n > 1 THEN ' (sobrecarga)'
                   WHEN f.h IS NOT NULL AND NOT COALESCE(f.atributos, false) THEN ' (atributos ou ACL)'
                   ELSE '' END,
         COALESCE(f.n = 0 OR (f.n = 1 AND f.h = '4ab021c0ff86fbecf36e4c4702a04398' AND f.atributos), false)
  FROM fn f WHERE f.nome = 'informar_email_da_visitante'
  UNION ALL
  SELECT 'reivindicar_comprovante_da_visitante: corpo exato (md5), uma so, plpgsql SECURITY DEFINER VOLATILE, search_path=public, EXECUTE so do service_role',
         'AUSENTE ou 37c9cd2bd0d16c466bb824d0f3a2887c',
         COALESCE(f.h, 'AUSENTE')
           || CASE WHEN f.n > 1 THEN ' (sobrecarga)'
                   WHEN f.h IS NOT NULL AND NOT COALESCE(f.atributos, false) THEN ' (atributos ou ACL)'
                   ELSE '' END,
         COALESCE(f.n = 0 OR (f.n = 1 AND f.h = '37c9cd2bd0d16c466bb824d0f3a2887c' AND f.atributos), false)
  FROM fn f WHERE f.nome = 'reivindicar_comprovante_da_visitante'
  UNION ALL
  SELECT 'o teto de e-mail da 20261217000000: reservar_vaga_de_email e chave_do_destinatario com os corpos dela, liberar_email_de_confirmacao no ar',
         'sim',
         CASE WHEN teto.certo THEN 'sim' ELSE 'nao' END,
         teto.certo
  FROM teto
  UNION ALL
  SELECT 'marketplace_orders: as colunas que as duas leem, com o tipo esperado',
         'sim',
         CASE WHEN colunas.certo THEN 'sim' ELSE 'nao' END,
         colunas.certo
  FROM colunas
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

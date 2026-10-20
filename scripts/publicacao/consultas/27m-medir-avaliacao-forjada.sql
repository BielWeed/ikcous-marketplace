-- 27m — MEDICAO, so leitura, das avaliacoes que podem ter sido FORJADAS pela API antes do gatilho da migration
-- 20261224000000 (a avaliacao nasce sem a resposta da loja). Molde da 18a/22m: UM SELECT de ROL ABERTO, sem coluna
-- `ok`; nunca e prova do portao da release. Quem decide e a pessoa que le a tabela. Rodar nas duas lojas
-- assinantes (IKCOUS e Savy), ANTES e DEPOIS do apply: o gatilho so protege o que nasce DEPOIS dele, e esta
-- consulta mostra o que ja estava la.
--
-- O DEFEITO: antes da 20261224 uma cliente logada gravava, por chamada direta a API, a propria avaliacao ja com
-- `merchant_reply` ("Resposta Oficial da Loja"), `merchant_reply_at`, `helpful` (ex.: 9999) e `created_at` (ex.:
-- 2030). Se a loja aprovou, o texto falso esta PUBLICO com a voz da loja.
--
-- Saida: tipo | objeto | detalhe. O detalhe e `chave=valor` separado por `|`. Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?), a versao do servidor e se a RLS VALE para quem leu em
--              reviews. Com a RLS valendo para quem leu, toda contagem abaixo sai baixa: o numero nao e o da loja.
--   gatilho    o gatilho novo e a funcao dele: ligado (O = origin; D = desligado), tabela, tipo (7 = BEFORE INSERT por
--              linha) e se o corpo e o da migration (md5 sem CR), ou AUSENTE (loja antes do apply).
--   migration  a versao 20261224000000 no registro de migrations (presente/ausente; o registro nao prova o objeto).
--   contagem   quantas avaliacoes existem (total, publicadas, pendentes) e o maior `helpful`.
--   sinal      CADA sinal de avaliacao forjada, em total, so entre as PUBLICADAS (as que o publico ve) e so entre as
--              PENDENTES. Zero tambem aparece. Os sinais:
--                resposta preenchida                   merchant_reply nao vazio (base de comparacao, nao e suspeita).
--                resposta sem data da resposta         resposta sem `merchant_reply_at`: `reply_review_atomic` SEMPRE grava
--                                                      a data junto; quem fez UPDATE direto no banco tambem pode ter deixado assim.
--                data da resposta no futuro            `merchant_reply_at` depois de agora: o servidor nunca grava isso.
--                resposta sem nenhum log do produto    NAO existe, em push_notifications_log, aviso "Sua avaliacao foi respondida!"
--                                                      para o produto (url /product/<id>): `reply_review_atomic` registra um
--                                                      por resposta. E o rastro mais forte, mas e por PRODUTO, nao por avaliacao:
--                                                      uma forjada num produto que ja teve resposta de verdade nao aparece aqui.
--                resposta sem log na data (+-10 min)   o log do produto existe, mas nenhum cai ate 10 minutos da data da
--                                                      resposta. Mais ruidoso: log apagado, ou banco fora do fuso UTC (o carimbo do log
--                                                      sai com o fuso mudado), tambem aparecem.
--                helpful maior que 0 / >= 100          contador de "uteis".
--                helpful > 0 em avaliacao pendente     a pendente nao e vista pelo publico; com o voto `increment_helpful` fechado a
--                                                      pendente (20261223) isso so nasce por forja, ou por voto de ANTES da 20261223.
--                criada no futuro / mais de 1 dia      `created_at` depois de agora (a margem de 1 dia absorve o relogio e o fuso).
--                SUSPEITA FORTE                        qualquer um destes: criada mais de 1 dia no futuro, data da resposta no
--                                                      futuro, resposta sem nenhum log do produto, helpful >= 100 em pendente.
--              Dois critérios (por que dois): a suspeita forte olha o QUE a API nunca deixaria um servidor gravar; os
--              demais sinais ajudam a entender o tamanho, mas uma resposta legitima feita por UPDATE direto no banco
--              (sem passar pela RPC) tambem aparece em "sem log". Limpar o que achar e decisao do dono, com a lista na mao.
--
-- QUEM LE: o papel so-leitura do workflow (BYPASSRLS + pg_read_all_data) le o catalogo, supabase_migrations,
-- public.reviews e push_notifications_log SO por agregado. Sem acesso a uma delas a consulta INTEIRA falha com
-- "permission denied" (nunca um "0" por engano). Objeto ausente do catalogo vira AUSENTE na propria linha.
-- NENHUM DADO PESSOAL: so contagens e o maior `helpful`; nenhum id, nenhum texto de comentario, nenhum texto de
-- resposta (`merchant_reply` so e usado para saber se esta vazio), nenhum autor. O log do run e legivel por quem le o
-- repositorio: o que sai daqui e so catalogo e agregado.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH
av AS (
  SELECT r.product_id, r.status, r.helpful, r.created_at, r.merchant_reply_at,
         (r.merchant_reply IS NOT NULL AND btrim(r.merchant_reply) <> '') AS respondida
    FROM public.reviews r
),
sinais AS (
  SELECT a.status, a.helpful, a.created_at, a.merchant_reply_at, a.respondida,
         (a.respondida AND NOT EXISTS (
            SELECT 1 FROM public.push_notifications_log l
             WHERE l.url = '/product/' || a.product_id::text
               AND l.title IN ('Sua avaliação foi respondida!', 'Sua avaliacao foi respondida!')
         )) AS sem_log_do_produto,
         (a.respondida AND NOT EXISTS (
            SELECT 1 FROM public.push_notifications_log l
             WHERE l.url = '/product/' || a.product_id::text
               AND l.title IN ('Sua avaliação foi respondida!', 'Sua avaliacao foi respondida!')
               AND a.merchant_reply_at IS NOT NULL
               AND abs(extract(epoch FROM (l.sent_at - a.merchant_reply_at))) <= 600
         )) AS sem_log_na_data,
         COALESCE(a.merchant_reply_at > now(), false) AS resposta_no_futuro,
         COALESCE(a.created_at > now(), false) AS criada_no_futuro,
         COALESCE(a.created_at > now() + interval '1 day', false) AS criada_muito_no_futuro,
         (a.status = 'pendente' AND COALESCE(a.helpful, 0) >= 100) AS helpful_alto_em_pendente
    FROM av a
),
nomes(ordem, nome) AS (
  VALUES (10, 'resposta preenchida'),
         (11, 'resposta sem data da resposta'),
         (12, 'data da resposta no futuro'),
         (13, 'resposta sem nenhum log do produto'),
         (14, 'resposta sem log na data (+-10 min)'),
         (20, 'helpful maior que 0'),
         (21, 'helpful >= 100'),
         (22, 'helpful maior que 0 em avaliacao pendente'),
         (30, 'criada no futuro'),
         (31, 'criada mais de 1 dia no futuro'),
         (40, 'SUSPEITA FORTE')
),
ativos AS (
  SELECT s.ordem, a.status
    FROM sinais a
   CROSS JOIN LATERAL (VALUES
           (10, a.respondida),
           (11, a.respondida AND a.merchant_reply_at IS NULL),
           (12, a.resposta_no_futuro),
           (13, a.sem_log_do_produto),
           (14, a.sem_log_na_data),
           (20, COALESCE(a.helpful, 0) > 0),
           (21, COALESCE(a.helpful, 0) >= 100),
           (22, a.status = 'pendente' AND COALESCE(a.helpful, 0) > 0),
           (30, a.criada_no_futuro),
           (31, a.criada_muito_no_futuro),
           (40, a.criada_muito_no_futuro OR a.resposta_no_futuro OR a.sem_log_do_produto OR a.helpful_alto_em_pendente)
         ) AS s(ordem, ativo)
   WHERE s.ativo
),
contados AS (
  SELECT ordem,
         count(*) AS total,
         count(*) FILTER (WHERE status = 'publicada') AS publicadas,
         count(*) FILTER (WHERE status = 'pendente') AS pendentes
    FROM ativos
   GROUP BY ordem
),
r(ordem, tipo, objeto, detalhe) AS (
  -- controle
  SELECT 0, 'controle', 'papel que leu',
         concat_ws('|',
           'papel=' || current_user::text,
           'super=' || eu.rolsuper::text,
           'bypassrls=' || eu.rolbypassrls::text)
    FROM pg_roles eu
   WHERE eu.rolname = current_user
  UNION ALL
  SELECT 0, 'controle', 'servidor',
         'versao_num=' || current_setting('server_version_num') || '|banco=' || current_database()
  UNION ALL
  SELECT 0, 'controle', 'rls vale para quem leu',
         'reviews=' || COALESCE(row_security_active(to_regclass('public.reviews'))::text, 'AUSENTE')
  -- o gatilho novo e a funcao dele
  UNION ALL
  SELECT 1, 'gatilho', 'tr_avaliacao_nasce_sem_a_resposta_da_loja',
         COALESCE((SELECT concat_ws('|',
                      'ligado=' || t.tgenabled::text,
                      'tabela=' || t.tgrelid::regclass::text,
                      'tipo=' || t.tgtype::text)
                     FROM pg_trigger t
                    WHERE t.tgname = 'tr_avaliacao_nasce_sem_a_resposta_da_loja' AND NOT t.tgisinternal
                    LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 1, 'gatilho', 'public.avaliacao_nasce_sem_a_resposta_da_loja()',
         COALESCE((SELECT 'corpo_e_o_da_migration=' ||
                          CASE WHEN md5(replace(p.prosrc, chr(13), '')) = '2c2d607c4009de72d10d1a7d154a642f' THEN 'sim' ELSE 'NAO' END
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.avaliacao_nasce_sem_a_resposta_da_loja()')), 'AUSENTE')
  -- registro de migrations
  UNION ALL
  SELECT 1, 'migration', '20261224000000',
         CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = '20261224000000')
              THEN 'presente' ELSE 'ausente' END
  -- tamanho da base
  UNION ALL
  SELECT 2, 'contagem', 'avaliacoes',
         'total=' || count(*)::text ||
         '|publicadas=' || count(*) FILTER (WHERE status = 'publicada')::text ||
         '|pendentes=' || count(*) FILTER (WHERE status = 'pendente')::text
    FROM sinais
  UNION ALL
  SELECT 2, 'contagem', 'maior helpful', 'max=' || COALESCE(max(helpful), 0)::text
    FROM sinais
  -- os sinais
  UNION ALL
  SELECT n.ordem, 'sinal', n.nome,
         'total=' || COALESCE(c.total, 0)::text ||
         '|publicadas=' || COALESCE(c.publicadas, 0)::text ||
         '|pendentes=' || COALESCE(c.pendentes, 0)::text
    FROM nomes n
    LEFT JOIN contados c ON c.ordem = n.ordem
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto, detalhe;

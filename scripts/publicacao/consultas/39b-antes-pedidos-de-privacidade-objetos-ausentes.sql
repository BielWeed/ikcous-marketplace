-- 39b — ANTES de aplicar a migration 20261238000000 (a cliente pede a exclusao da conta e a correcao do e-mail): confirma,
-- POR OBJETO, a base de antes: NADA do que a migration cria existe ainda (a tabela `pedidos_de_privacidade`, os dois indices,
-- a funcao do gatilho `pedidos_de_privacidade__carimbar` e o gatilho) e tudo de que o pre-voo dela depende ESTA no banco
-- (auth.users, auth.uid(), public.rls_admin_atual()) -- mais UMA coisa que o pre-voo nao confere e que a transacao do apply
-- so descobriria no meio: o papel `postgres`, que roda o apply, tem REFERENCES em auth.users (e' ele que permite a chave
-- estrangeira user_id -> auth.users(id), linha ~96 da migration). E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote
-- em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 39a negativa so vira "aplique" se esta for positiva (a loja
-- esta na base de antes, e nao com a migration pela metade ou com um homonimo de forma desconhecida). A migration NASCE o
-- objeto e NAO e' reaplicavel (o pre-voo dela recusa se a tabela ja existe): uma loja que ja a tem reprova aqui de proposito.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_trigger, pg_index e a consulta de privilegio do
-- Postgres): nenhuma linha de pedido, de cliente ou de login e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9 linhas, as mesmas em qualquer
-- estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a loja esta na base
-- de antes e a migration pode ser aplicada; qualquer `false` = PARE e leia a linha (a migration, aplicada assim, abortaria
-- no pre-voo B1_BASELINE_DIVERGENT -- aqui a gente descobre ANTES, por leitura).
--
-- O QUE CADA LINHA PROVA (as mesmas condicoes do `DO $preflight_20261238$`, mais o REFERENCES)
--   * a tabela, os indices, a funcao e o gatilho -- NAO existem. A funcao e' medida por NOME (qualquer sobrecarga de
--                  `pedidos_de_privacidade__carimbar` reprova: um homonimo alheio tambem) e o gatilho por NOME em qualquer
--                  tabela. Meia migration (so a tabela, so o gatilho) reprova na linha do que ja existe.
--   * as dependencias -- auth.users e auth.uid() existem e public.rls_admin_atual() existe (a 20261197000000 vem antes).
--   * REFERENCES -- `has_table_privilege('postgres', auth.users, 'REFERENCES')`: o papel que aplica tem o privilegio de
--                  referenciar a tabela de login. E' medido POR NOME, `postgres`, porque o aplicar-migrations.yml roda pela
--                  API de consulta da Supabase, que roda como `postgres`; o papel de LEITURA que roda esta consulta nao e'
--                  ele, e has_table_privilege mede o papel nomeado, nao o de quem pergunta. Num Postgres onde `postgres` e'
--                  superusuario o privilegio e' sempre `sim`; o numero que importa e' o da loja.
--
-- tests/banco/pedidos-de-privacidade-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback,
-- negativa depois do apply, um negativo por linha). LIMITES: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja; e o REFERENCES local e' o de um superusuario.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'pedidos_de_privacidade: tabela ausente', 'AUSENTE',
         CASE WHEN to_regclass('public.pedidos_de_privacidade') IS NOT NULL THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'pedidos_de_privacidade: os dois indices ausentes', 'AUSENTES',
         CASE WHEN to_regclass('public.uq_pedidos_de_privacidade_um_aberto') IS NOT NULL
                OR to_regclass('public.idx_pedidos_de_privacidade_situacao_criado') IS NOT NULL
              THEN 'PRESENTES' ELSE 'AUSENTES' END
  UNION ALL
  SELECT 'pedidos_de_privacidade__carimbar: funcao ausente (qualquer sobrecarga)', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = 'pedidos_de_privacidade__carimbar')
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'tr_pedidos_de_privacidade_carimbar: gatilho ausente (em qualquer tabela)', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t
                            WHERE t.tgname = 'tr_pedidos_de_privacidade_carimbar' AND NOT t.tgisinternal)
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia auth.users: existe', 'EXISTE',
         CASE WHEN to_regclass('auth.users') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia auth.uid(): existe', 'EXISTE',
         CASE WHEN to_regprocedure('auth.uid()') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia public.rls_admin_atual(): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.rls_admin_atual()') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'auth.users: o papel postgres (que aplica a migration) tem REFERENCES', 'sim',
         CASE WHEN to_regrole('postgres') IS NULL THEN 'papel postgres ausente'
              WHEN to_regclass('auth.users') IS NULL THEN 'AUSENTE'
              WHEN has_table_privilege('postgres'::name, to_regclass('auth.users'), 'REFERENCES') THEN 'sim'
              ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

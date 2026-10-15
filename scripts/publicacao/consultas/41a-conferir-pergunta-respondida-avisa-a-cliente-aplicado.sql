-- 41a — DEPOIS de aplicar a migration 20261240000000 (a cliente e avisada quando a loja responde a pergunta dela:
-- `answer_question_atomic` deixa de gravar a linha falsa em `push_notifications_log` e cria UM aviso no sino
-- `notificacoes` de quem perguntou): confirma, POR OBJETO, que o corpo vivo de CADA UMA das DUAS sobrecargas de
-- `answer_question_atomic` e o NOVO (md5), que cada uma traz o aviso no sino e nao grava mais no log de push, que cada
-- uma mantem os atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path=public, retorna void) e que a
-- ACL segue a de sempre (PUBLIC e anon sem EXECUTE; authenticated com). E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 41b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha de pergunta,
-- de resposta, de notificacao nem de cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 10 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o
-- aviso da pergunta respondida esta aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual
-- reprovam SO as quatro linhas dos corpos (md5 e marcador de cada sobrecarga).
--
--   * sobrecargas -- EXATAMENTE duas funcoes com esse nome em `public` (a de 2 e a de 3 argumentos).
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261240000000, de cada uma.
--   * marcador -- 'sim' se o corpo grava em `notificacoes` E nao menciona mais `push_notifications_log`. Leitura humana do
--                mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + `search_path=public` + retorno void.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon e authenticated por
--                has_function_privilege. O EXECUTE de service_role nao e' medido (nenhuma migration o fixa; o CREATE OR
--                REPLACE o preserva).
--
-- ESTA MIGRATION NAO TOCA `reply_review_atomic` (a resposta a AVALIACAO): a consulta 27m usa a linha do log dela como
-- rastro e por isso ela segue gravando em `push_notifications_log`. Nada aqui mede essa funcao.
--
-- CADEIA: o corpo desta consulta e' o SUCESSOR da 20261065000000 (sobrecarga de 2 argumentos) e da 20261064000000
-- (sobrecarga de 3). Por isso `db-apply.cjs` NUNCA reaplica a 64 nem a 65 sobre uma loja que ja esta nesta (o marcador
-- `A10: log honesto` deixou de existir nos dois corpos de `answer_question_atomic`).
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts e pelo teste estatico da migration;
-- tests/banco/pergunta-respondida-avisa-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do
-- apply, negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/pergunta-respondida-avisa-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH alvo(chave, assinatura) AS (
  VALUES ('dois', 'public.answer_question_atomic(uuid,text)'),
         ('tres', 'public.answer_question_atomic(uuid,text,uuid)')
), fn AS (
  SELECT t.chave,
         p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'answer_question_atomic') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('notificacoes' IN p.prosrc) > 0
                   AND position('push_notifications_log' IN p.prosrc) = 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND p.prorettype = 'void'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public -> void'
              ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'answer_question_atomic: sobrecargas', '2',
         COALESCE((SELECT f.sobrecargas::text FROM fn f WHERE f.chave = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text): corpo e o da 20261240000000, com o aviso no sino da cliente (md5)',
         '1268df6cb364dfb46b5c535e007bb2d0',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text): o corpo avisa no sino e nao grava mais no log de push',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text): atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, void)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> void',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text): EXECUTE fechado para anon (authenticated sim)',
         'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.chave = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text,uuid): corpo e o da 20261240000000, com o aviso no sino da cliente (md5)',
         'b62a4186ff8d58955973f53d6c0f302b',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'tres'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text,uuid): o corpo avisa no sino e nao grava mais no log de push',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'tres'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text,uuid): atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, void)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> void',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'tres'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text,uuid): EXECUTE fechado para anon (authenticated sim)',
         'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.chave = 'tres'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

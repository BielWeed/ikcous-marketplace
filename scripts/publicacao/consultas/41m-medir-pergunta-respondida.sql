-- 41m — MEDICAO, so leitura, do que a migration 20261240000000 (a cliente e avisada quando a loja responde a pergunta
-- dela) encontra na loja ANTES do apply: quantas perguntas ja foram respondidas sem a cliente ter sido avisada (a
-- migration NAO cria aviso em massa: so a resposta NOVA ou EDITADA depois do apply avisa), quantas linhas falsas
-- "Sua pergunta foi respondida!" ja estao no log de push (ficam no banco; o painel de campanhas as esconde do
-- historico) e se ja existe algum aviso de pergunta no sino (esperado: zero antes do apply).
-- Molde da 18a/22m/32m/35m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release. Quem decide e a
-- pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), ANTES do apply, so para saber o tamanho do
-- que esta para tras; o apply nao muda nenhuma linha de pergunta, de resposta, de aviso nem do log.
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu em questions: com a RLS valendo, toda
--              contagem abaixo sai baixa e o numero nao e o da loja.
--   contagem   perguntas (total, respondidas, sem resposta), perguntas respondidas SEM aviso no sino da cliente (o que
--              a migration deixa como esta), avisos de pergunta ja existentes no sino (`dados` com `question_id`) e as
--              linhas do log de push com o titulo da pergunta respondida (total e com 0 aparelhos: as linhas falsas).
-- NENHUM DADO PESSOAL: so contagens; nenhum texto de pergunta ou de resposta, nenhum id, nenhuma cliente. O log do run e
-- legivel por quem le o repositorio: o que sai daqui e so agregado.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH perg AS (
  SELECT q.id,
         EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id) AS respondida,
         EXISTS (SELECT 1 FROM public.notificacoes n
                  WHERE n.dados ->> 'question_id' = q.id::text) AS avisada
    FROM public.questions q
), lg AS (
  SELECT l.recipient_count
    FROM public.push_notifications_log l
   WHERE l.title = 'Sua pergunta foi respondida!'
)
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
       || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
       || '|rls_vale_em_questions=' || (SELECT (c.relrowsecurity AND NOT COALESCE(r.rolbypassrls, false) AND NOT COALESCE(r.rolsuper, false))::text
                                         FROM pg_class c, pg_roles r
                                        WHERE c.oid = 'public.questions'::regclass AND r.rolname = current_user) AS detalhe
UNION ALL
SELECT 'contagem', 'perguntas', 'total=' || count(*)::text FROM perg
UNION ALL
SELECT 'contagem', 'perguntas respondidas pela loja', 'total=' || count(*) FILTER (WHERE respondida)::text FROM perg
UNION ALL
SELECT 'contagem', 'perguntas ainda sem resposta (a resposta nova ja avisa)', 'total=' || count(*) FILTER (WHERE NOT respondida)::text FROM perg
UNION ALL
SELECT 'contagem', 'perguntas respondidas SEM aviso no sino da cliente (ficam como estao; so a edicao da resposta avisa)',
       'total=' || count(*) FILTER (WHERE respondida AND NOT avisada)::text FROM perg
UNION ALL
SELECT 'contagem', 'perguntas ja com aviso no sino (esperado zero antes do apply)',
       'total=' || count(*) FILTER (WHERE avisada)::text FROM perg
UNION ALL
SELECT 'contagem', 'linhas do log de push com o titulo "Sua pergunta foi respondida!" (deixam de nascer)',
       'total=' || count(*)::text FROM lg
UNION ALL
SELECT 'contagem', 'dessas, as linhas falsas com 0 aparelhos (o painel as esconde; nada e apagado)',
       'total=' || count(*) FILTER (WHERE COALESCE(recipient_count, 0) = 0)::text FROM lg;

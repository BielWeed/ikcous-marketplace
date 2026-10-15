-- 41b — ANTES de aplicar a migration 20261240000000 (a cliente e avisada quando a loja responde a pergunta dela):
-- confirma, POR OBJETO, a base de antes: as DUAS sobrecargas de `answer_question_atomic` existem (so essas duas), cada
-- uma com o corpo VIGENTE (md5: o da 20261065000000 na de 2 argumentos e o da 20261064000000 na de 3), SEM o aviso no
-- sino da cliente, e com os atributos de sempre. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 41a negativa so vira "aplique" se esta for positiva (a
-- loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de pergunta, de
-- resposta, de notificacao nem de cliente e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: a ACL das duas funcoes e' a de sempre (20261090500000); o pre-voo da migration nao a mexe
-- e a 41a a mede DEPOIS.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 8 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de
-- antes; uma loja que JA tem o aviso novo reprova aqui de proposito, nas linhas do corpo e do marcador da funcao.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261065000000 (2 args) e o da
--                20261064000000 (3 args).
--   * marcador -- 'nao' se o corpo NAO grava em `notificacoes` (so o corpo novo grava). Leitura humana do mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + `search_path=public` + retorno void.
--
-- tests/banco/pergunta-respondida-avisa-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do
-- rollback, negativa depois do apply, um negativo por linha). O md5 dos corpos de antes vem dos ARQUIVOS das migrations
-- 20261064 e 20261065, nao de uma loja: o valor VIVO de cada loja so esta consulta mede (medido igual nas duas lojas
-- em 14/10/2026, mas isso e' leitura daquele dia, nao prova de hoje).
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(chave, assinatura) AS (
  VALUES ('dois', 'public.answer_question_atomic(uuid,text)'),
         ('tres', 'public.answer_question_atomic(uuid,text,uuid)')
), fn AS (
  SELECT t.chave,
         p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'answer_question_atomic') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('notificacoes' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND p.prorettype = 'void'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public -> void'
              ELSE 'DIFERENTE' END AS atributos
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
  SELECT 'answer_question_atomic(uuid,text): corpo e o da 20261065000000, sem o aviso no sino da cliente (md5)',
         '8cf000b6c9ed27f482906752469f08ff',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text): o corpo ainda NAO grava no sino da cliente',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text): atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, void)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> void',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text,uuid): corpo e o da 20261064000000, sem o aviso no sino da cliente (md5)',
         'ad99d54575ac95445103ea5b78e4a1e8',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'tres'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text,uuid): o corpo ainda NAO grava no sino da cliente',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'tres'), 'AUSENTE')
  UNION ALL
  SELECT 'answer_question_atomic(uuid,text,uuid): atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, void)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> void',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'tres'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

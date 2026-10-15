-- 43b — ANTES de aplicar a migration 20261241000000 (o reembolso em duvida prende o saldo): confirma, POR OBJETO, a
-- base de antes: a tabela de marcas `order_refund_prova` e as CINCO funcoes novas ainda NAO existem; as SETE funcoes
-- que a migration reescreve existem (uma assinatura so cada) com o corpo VIGENTE (md5: pedido__saldo_a_estornar da
-- 20261198000000; solicitar_estorno e admin_devolucao_concluir da 20261197000000; autorizar_post_do_estorno da
-- 20261196000000; reemitir_reembolso_da_devolucao e admin_devolucao_reembolso_por_fora da 20261226000000;
-- devolucao_avisa_o_cliente da 20261225000000) e com os atributos de sempre; as duas funcoes de dinheiro que ela CHAMA
-- (concluir_estorno e devolucao__avisar_reembolso) tem o corpo conhecido; a funcao antiga
-- `admin_devolucao_reemitir_reembolso(uuid, boolean)` existe (a migration fecha o EXECUTE dela); e o gatilho de aviso da
-- devolucao esta ligado a sua funcao. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos`
-- de scripts/frota/canais-de-backend.json: a 43a negativa so vira "aplique" se esta for positiva (a loja esta na base
-- de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_trigger): nenhuma linha de pedido,
-- de reembolso ou de devolucao e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: o CREATE OR REPLACE a preserva e a 43a a mede DEPOIS.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 14 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de
-- antes; uma loja que JA tem a migration reprova aqui de proposito, nas linhas dos objetos novos e dos corpos.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF).
--   * atributos  -- SECURITY DEFINER + `search_path=public` + a linguagem, a volatilidade e o retorno de cada uma.
--
-- tests/banco/reembolso-em-duvida-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback,
-- negativa depois do apply, um negativo por linha). Os md5 vem dos ARQUIVOS das migrations, nao de uma loja: o valor
-- VIVO de cada loja so esta consulta mede. LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH alvo(chave, assinatura, nome, lingua, volatilidade, retorno) AS (
  VALUES ('saldo', 'public.pedido__saldo_a_estornar(uuid)', 'pedido__saldo_a_estornar', 'sql', 's', 'numeric'),
         ('solicitar', 'public.solicitar_estorno(uuid,numeric,text)', 'solicitar_estorno', 'plpgsql', 'v', 'jsonb'),
         ('concluir', 'public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'admin_devolucao_concluir', 'plpgsql', 'v', 'jsonb'),
         ('autorizar', 'public.autorizar_post_do_estorno(uuid,numeric)', 'autorizar_post_do_estorno', 'plpgsql', 'v', 'jsonb'),
         ('reemitir', 'public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)', 'reemitir_reembolso_da_devolucao', 'plpgsql', 'v', 'jsonb'),
         ('porfora', 'public.admin_devolucao_reembolso_por_fora(uuid,uuid)', 'admin_devolucao_reembolso_por_fora', 'plpgsql', 'v', 'jsonb'),
         ('avisa', 'public.devolucao_avisa_o_cliente()', 'devolucao_avisa_o_cliente', 'plpgsql', 'v', 'trigger')
), fn AS (
  SELECT t.chave, p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         (p.prosecdef AND l.lanname = t.lingua AND p.provolatile = t.volatilidade AND NOT p.proretset
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = t.retorno
            AND (SELECT count(*) FROM pg_proc q
                  WHERE q.pronamespace = 'public'::regnamespace AND q.proname = t.nome) = 1) AS atributos_ok
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), chamadas AS (
  SELECT (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p
           WHERE p.oid = to_regprocedure('public.concluir_estorno(uuid,text,text,text)')) AS concluir,
         (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p
           WHERE p.oid = to_regprocedure('public.devolucao__avisar_reembolso(uuid,text,text,text,text)')) AS avisar
), novos AS (
  SELECT (to_regclass('public.order_refund_prova') IS NULL
          AND NOT EXISTS (SELECT 1 FROM pg_proc p
                           WHERE p.pronamespace = 'public'::regnamespace
                             AND p.proname IN ('order_refund__pode_ter_saido', 'order_refund__liberavel_apos_espera',
                                               'pedido_reembolsos_e_saldo',
                                               'admin_devolucao_reembolso_por_fora_apos_espera',
                                               'registrar_estorno_manual_apos_espera'))) AS ausentes
), gat AS (
  SELECT CASE WHEN t.tgenabled = 'O'
               AND t.tgfoid = to_regprocedure('public.devolucao_avisa_o_cliente()')
              THEN 'ligado' ELSE 'DIFERENTE' END AS estado
    FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.devolucoes')
     AND t.tgname = 'tr_devolucao_avisa_o_cliente'
     AND NOT t.tgisinternal
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'order_refund_prova e as cinco funcoes novas ainda NAO existem',
         'ausentes',
         CASE WHEN (SELECT n.ausentes FROM novos n) THEN 'ausentes' ELSE 'presentes' END
  UNION ALL
  SELECT 'pedido__saldo_a_estornar: corpo e o vigente da 20261198000000, sem o em duvida (md5)',
         '9579d2b56b57cf948659936a928dd7dc',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'saldo'), 'AUSENTE')
  UNION ALL
  SELECT 'solicitar_estorno: corpo e o vigente da 20261197000000 (md5)',
         '069c3d12a470cc4708099d909c57ca02',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'solicitar'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo e o vigente da 20261197000000 (md5)',
         '26080db4aeb82bdfb9fcd0c6f7169ebb',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'concluir'), 'AUSENTE')
  UNION ALL
  SELECT 'autorizar_post_do_estorno: corpo e o vigente da 20261196000000 (md5)',
         'e128f7ad54ebc82c97b97af4aa7baa08',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'autorizar'), 'AUSENTE')
  UNION ALL
  SELECT 'reemitir_reembolso_da_devolucao: corpo e o vigente da 20261226000000 (md5)',
         '872fcb1d2bac9816e2d2b1c7c2e868c0',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'reemitir'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_reembolso_por_fora: corpo e o vigente da 20261226000000 (md5)',
         '0a7e06d7004c3fb70897e87c4dfa8cf9',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'porfora'), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_avisa_o_cliente: corpo e o vigente da 20261225000000 (md5)',
         '2cd21f47021cafc15cae4ccd0c8c67e5',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'avisa'), 'AUSENTE')
  UNION ALL
  SELECT 'as sete funcoes: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, linguagem, volatilidade e retorno)',
         'atributos de sempre',
         CASE WHEN (SELECT count(*) FROM fn) < 7 THEN 'AUSENTE'
              WHEN (SELECT bool_and(f.atributos_ok) FROM fn f) THEN 'atributos de sempre'
              ELSE 'DIFERENTE: ' || (SELECT string_agg(f.chave, ',' ORDER BY f.chave) FROM fn f WHERE NOT f.atributos_ok) END
  UNION ALL
  SELECT 'concluir_estorno: corpo e o conhecido da 2026110000100 (md5; a reemissao o chama)',
         '662daf0dfc065a820231e9d30f4f6275',
         COALESCE((SELECT c.concluir FROM chamadas c), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao__avisar_reembolso: corpo e o da 20261225000000 (md5; o por fora e a saida dos 7 dias o chamam)',
         '769267b826e4629b91da056c28b393da',
         COALESCE((SELECT c.avisar FROM chamadas c), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_reemitir_reembolso(uuid, boolean) existe (a migration fecha o EXECUTE dela ao logado)',
         'existe',
         CASE WHEN to_regprocedure('public.admin_devolucao_reemitir_reembolso(uuid,boolean)') IS NULL
              THEN 'AUSENTE' ELSE 'existe' END
  UNION ALL
  SELECT 'tr_devolucao_avisa_o_cliente: ligado a devolucao_avisa_o_cliente',
         'ligado',
         COALESCE((SELECT g.estado FROM gat g), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

-- 29b — ANTES de aplicar a migration 20261226000000 (a reemissao do reembolso consulta o Mercado Pago antes de pagar
-- de novo): confirma, POR OBJETO, a base de antes: as tres funcoes novas e a tabela `order_refund_diagnostico` ainda
-- NAO existem, e as tres funcoes que a migration CHAMA estao vivas com o corpo conhecido (md5):
-- `concluir_estorno` (o unico ponto que conclui o reembolso e soma o pedido), `pedido__saldo_a_estornar` (a conta
-- de saldo) e `devolucao__avisar_reembolso` (a auxiliar de aviso da 20261225000000: a loja sem o lote 28 recusa
-- aqui e o lote 28 TEM DE ESTAR aplicado antes). E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 29a negativa so vira "aplique" se esta for positiva (a
-- loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace): nenhuma linha de devolucao, de reembolso ou de
-- pedido e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de
-- antes; uma loja que JA tem a migration reprova aqui de proposito, na linha dos objetos novos.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF).
--   * objetos novos -- 'ausentes' se nenhuma das tres funcoes nem a tabela existem.
--
-- tests/banco/reemissao-do-reembolso-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do
-- rollback, negativa depois do apply, um negativo por linha). Os md5 vem dos ARQUIVOS das migrations
-- (2026110000100, 20261198000000, 20261225000000), nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja. Nao mede
-- ACL.
WITH alvo(chave, assinatura) AS (
  VALUES ('concluir', 'public.concluir_estorno(uuid,text,text,text)'),
         ('saldo', 'public.pedido__saldo_a_estornar(uuid)'),
         ('avisar', 'public.devolucao__avisar_reembolso(uuid,text,text,text,text)')
), fn AS (
  SELECT t.chave, md5(replace(p.prosrc, chr(13), '')) AS m
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
), novos AS (
  SELECT (to_regprocedure('public.registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)') IS NULL
          AND to_regprocedure('public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)') IS NULL
          AND to_regprocedure('public.admin_devolucao_reembolso_por_fora(uuid,uuid)') IS NULL
          AND to_regclass('public.order_refund_diagnostico') IS NULL) AS ausentes
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'as tres funcoes novas e a tabela order_refund_diagnostico ainda NAO existem',
         'ausentes',
         CASE WHEN (SELECT n.ausentes FROM novos n) THEN 'ausentes' ELSE 'presentes' END
  UNION ALL
  SELECT 'concluir_estorno: corpo e o conhecido da 2026110000100 (md5)',
         '662daf0dfc065a820231e9d30f4f6275',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'concluir'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido__saldo_a_estornar: corpo e o da 20261198000000 (md5)',
         '9579d2b56b57cf948659936a928dd7dc',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'saldo'), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao__avisar_reembolso: corpo e o da 20261225000000 (md5; o lote 28 aplicado)',
         '769267b826e4629b91da056c28b393da',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'avisar'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

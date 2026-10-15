-- 32b — ANTES de aplicar as migrations 20261230000000 e 20261231000000 (a busca de clientes): confirma, POR OBJETO,
-- a base de antes: cada uma das duas funcoes existe com o corpo VIGENTE (md5, o da 20261199000000), SEM a regra
-- nova, e com os atributos de sempre. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 32a negativa so vira "aplique" se esta for
-- positiva (a loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de cliente, de
-- perfil ou de pedido e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: a ACL das duas funcoes e' a da 20261199000000 (lote 8e) e e' da 8e e da 22a; os
-- pre-voos das duas migrations recusam o apply com a ACL diferente.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 7 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base
-- de antes; uma loja que JA tem uma das duas reprova aqui de proposito, nas linhas do corpo e do marcador
-- daquela funcao.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261199000000 nas duas.
--   * marcador -- 'nao' se a regra nova NAO aparece no corpo (so os corpos novos a trazem).
--   * atributos -- SECURITY DEFINER + plpgsql + a volatilidade e o `search_path` de sempre de cada uma.
--
-- tests/banco/busca-de-clientes-portao-viva.cjs roda esta consulta num Postgres real (positiva depois dos dois
-- rollbacks, negativa depois do apply, um negativo por linha). O md5 dos corpos de antes vem do ARQUIVO da
-- migration 20261199000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(chave, assinatura) AS (
  VALUES ('clientes', 'public.get_admin_customers_paged(text,text,text,integer,integer)'),
         ('crm', 'public.crm_clientes(text,text,integer,integer)')
), fn AS (
  SELECT t.chave,
         p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN t.chave = 'clientes'
                   THEN CASE WHEN position('v_search_digitos' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END
              ELSE CASE WHEN position('public.f_unaccent(COALESCE(nome_exibido' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END
         END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql'
                   AND ((t.chave = 'clientes' AND p.provolatile = 'v'
                         AND p.proconfig = ARRAY['search_path=public, extensions']::text[])
                     OR (t.chave = 'crm' AND p.provolatile = 's'
                         AND p.proconfig = ARRAY['search_path=public']::text[]))
              THEN 'SECURITY DEFINER plpgsql ' || CASE WHEN t.chave = 'clientes' THEN 'VOLATILE search_path=public, extensions'
                                                       ELSE 'STABLE search_path=public' END
              ELSE 'DIFERENTE' END AS atributos
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_admin_customers_paged: corpo e o da 20261199000000, sem a busca por digitos (md5)',
         '3c4a0fc4ca6f5d1c9a017a38bff2ec49',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_customers_paged: o corpo ainda NAO calcula os digitos do termo',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_customers_paged: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, extensions)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public, extensions',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_clientes: corpo e o da 20261199000000, sem o acento ignorado (md5)',
         'd5823a661555bcee3813ab32aeee9117',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_clientes: o corpo ainda NAO ignora o acento do nome',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_clientes: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)',
         'SECURITY DEFINER plpgsql STABLE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

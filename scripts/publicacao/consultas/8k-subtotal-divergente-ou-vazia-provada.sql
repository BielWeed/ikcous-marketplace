-- 8k — Pedidos cuja soma dos itens NÃO bate com o `subtotal` gravado, OU as duas
-- tabelas VAZIAS PROVADAS (nenhum pedido existe, e o 0 lido é conclusivo).
-- É a 8c com o furo fechado: a 8c reprova "por construção" numa loja sem pedido
-- (os dois controles de visibilidade leem 0) e não deixa distinguir "loja vazia"
-- de "papel cego pela RLS". A 8c fica no menu como consulta LEGADA; esta é a que
-- o lote 92-202 exige antes do apply (scripts/frota/canais-de-backend.json).
-- SÓ LEITURA, um único SELECT (um único statement, logo UM snapshot para as
-- contagens e a soma), só agregados e metadados: nenhum id de pedido, nenhum valor
-- de dinheiro, nenhum dado de cliente sai daqui.
--
-- A FÓRMULA E DE ONDE VEM (a MESMA da 8c, não foi inventada): quem GRAVA `subtotal`
-- é a RPC de criação do pedido — `v_calculated_subtotal := v_calculated_subtotal +
-- (v_db_price * v_quantity)` e, no mesmo laço, o item é inserido com
-- `price = v_db_price, quantity = v_quantity`
-- (supabase/migrations/20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql
-- linhas 125 e 317; a mesma conta no baseline 20260806000000 e em
-- `registrar_venda_presencial`, 20261199000000 linha 2714). Logo, para um pedido
-- que nasceu por essas RPCs:
--     marketplace_orders.subtotal = SUM(quantity * price) dos seus itens,
-- sem frete e sem desconto (esses são colunas à parte). A CTE `soma` abaixo é
-- IDÊNTICA à da 8c (LEFT JOIN, `IS DISTINCT FROM`); tests/ci_conferir_banco_test.ts
-- prova a igualdade texto a texto. As contagens NÃO usam ONLY: a contagem no pai
-- inclui as tabelas-filhas (herança) sob a permissão e a RLS do pai, e um filho
-- com linhas sob um pai "vazio" não pode virar vazia provada.
--
-- LIMITE HONESTO DA FÓRMULA (o da 8c): pedido criado por uma versão ANTIGA da RPC,
-- por edição manual no painel do Supabase ou por importação pode divergir sem ter
-- havido adulteração; a contagem diz QUANTOS divergem, não POR QUÊ.
--
-- A PRÉ-CONDIÇÃO, EM TODOS OS RAMOS (com ou sem pedido), nas DUAS tabelas que a
-- fórmula conta (public.marketplace_orders e public.marketplace_order_items), para
-- o papel EFETIVO (current_user; o endpoint somente leitura roda como
-- supabase_read_only_user: BYPASSRLS + pg_read_all_data, sem GRANT direto):
--   * relkind = 'r' (tabela comum: nem vista, nem tabela particionada, nem outra
--     coisa de mesmo nome). As tabelas são achadas pelo schema public e pelo nome
--     (pg_class + relnamespace), nunca pelo search_path;
--   * SELECT de TABELA INTEIRA (has_table_privilege(current_user, tabela,
--     'SELECT')). SELECT só de coluna NÃO serve: ele deixa o statement rodar e o
--     count enxergar linhas, mas não é a permissão que o papel precisa ter;
--   * row_security_active(tabela) = false E igual à derivação do catálogo
--     (relrowsecurity, BYPASSRLS/superuser, dono, FORCE): se a função não bate com
--     a derivação, o comportamento é desconhecido e reprova. A RLS (Row Level
--     Security, a regra do banco que decide quais linhas cada papel enxerga) ativa
--     para o papel reprova SEMPRE: o papel pode ver tudo, parte ou nada, e esta
--     consulta não consegue saber qual. É o lado seguro: papel sem BYPASSRLS e com
--     RLS ativa nunca fecha esta conferência (a 8c fechava com a parte visível);
--   * o TIPO de cada coluna que a fórmula usa, por format_type(atttypid,
--     atttypmod), contra o valor MEDIDO num Postgres 17 com a árvore de migrations
--     inteira E com a árvore só até a 20261191 (o estado da Savy antes do lote
--     92-202), que dão o mesmo (tests/banco/subtotal-vazia-provada-viva.cjs): ids
--     uuid, subtotal e price numeric(10,2), quantity integer. Tipo diferente (price
--     em double precision, subtotal sem (10,2)) tira a exatidão da comparação e
--     reprova na linha do tipo.
--
-- SEMÂNTICA DE row_security_active (conferida na fonte, não de memória; a mesma
-- que a 8j documenta):
--   * Documentação oficial (PostgreSQL 17, 9.27 Session Information Functions):
--     "Is row-level security active for the specified table in the context of the
--     current user and current environment?". A página NÃO detalha as condições.
--   * Quem as define é o código (src/backend/utils/misc/rls.c, ramos REL_15_STABLE
--     e REL_17_STABLE, idênticos neste ponto): row_security_active() devolve
--     check_enable_rls(tabela, InvalidOid, noError => true) == RLS_ENABLED, e
--     check_enable_rls devolve, nesta ordem:
--       1. relrowsecurity = false           -> NÃO ativa (a tabela não tem RLS);
--       2. papel com BYPASSRLS ou superuser  -> NÃO ativa (vence até o FORCE);
--       3. papel dono da tabela, sem FORCE   -> NÃO ativa (o dono ignora a RLS);
--       4. qualquer outro caso (não dono, ou dono COM FORCE) -> ATIVA.
--   * O ajuste row_security NÃO muda esse resultado (o noError=true o ignora):
--     com row_security = off e RLS aplicável, row_security_active continua true e
--     é o SELECT de verdade que falha (42501, "query would be affected by
--     row-level security policy"), nunca devolve linhas em silêncio.
--   * ATIVA não diz o que o papel vê: com RLS ativa, o papel pode ver tudo, parte
--     ou nada (sem política que case, o padrão é negar). Por isso um 0 sob RLS
--     ativa NUNCA prova tabela vazia.
--
-- O VEREDITO (quem decide é o `ok` de cada linha; o conjunto de linhas é o MESMO
-- em todos os ramos, o rol fechado de 20 itens de conferir-banco.cjs):
--   1. PRÉ-CONDIÇÃO (acima) errada em qualquer das duas tabelas -> a linha do
--      metadado sai ok=false, haja pedido ou não.
--   2. AS DUAS COM 0 LINHAS -> positiva só como "VAZIA PROVADA": a pré-condição
--      vale para AS DUAS (a prova é CONJUNTA: uma tabela provada não vale pela
--      outra). Sem isso o 0 não prova nada e os controles e a linha "vazia
--      provada" reprovam.
--   3. HÁ LINHAS (qualquer das duas com mais de 0) -> as MESMAS regras da 8c, sem
--      afrouxar: controles "pedidos visiveis" > 0 e "itens de pedido visiveis" > 0
--      (pedidos visíveis com 0 itens, ou itens com 0 pedidos, reprova),
--      divergentes = 0 e divergentes sem item = 0 — mais a pré-condição do item 1.
--   Com dados e papel de leitura com BYPASSRLS esta consulta reproduz a 8c linha a
--   linha; com RLS ativa é mais forte. É estritamente igual ou mais forte que a 8c.
--
-- SEM PRIVILÉGIO / TABELA AUSENTE / row_security=off: um statement estático não
-- consegue pular um SELECT sem permissão nem uma tabela que não existe. Tabela
-- ausente em public falha o statement INTEIRO com 42P01 ("relation ... does not
-- exist"); papel sem NENHUM privilégio de SELECT (nem de tabela, nem das colunas
-- que a fórmula lê) falha com 42501 ("permission denied for table ..."); papel sem
-- BYPASSRLS com row_security = off e RLS aplicável falha com 42501 ("query would
-- be affected by row-level security policy"). Falha alta, nunca um zero que
-- engana: não há linha `ok=true` nem linha `VEREDITO-CONSULTA`, e o
-- scripts/publicacao/conferir-banco.cjs sai com erro (a Management API devolve
-- HTTP 400) e o portão trata como SEM_EVIDENCIA, nunca como positiva. Já o papel
-- com SELECT só nas COLUNAS que a fórmula lê roda a consulta inteira, e a linha
-- "select de tabela inteira" daquela tabela sai ok=false.
--
-- LIMITES (o que esta consulta NÃO prova):
--   * Evidência LOCAL não prova a Savy vazia: a prova viva (Postgres 17 efêmero)
--     prova que a consulta DECIDE certo; só o run desta consulta na loja diz se a
--     loja está vazia, e só como o papel que leu.
--   * Com DADOS, o limite da 8c continua para quem enxerga tudo: a soma conferida
--     é a das linhas que o papel vê, e com BYPASSRLS ele vê todas. O que a 8c
--     deixava passar (RLS ativa, parte visível) aqui reprova.
--   * NÃO diz quantos pedidos há, nem quais divergem: só contagem de divergentes
--     (e 0 / >0 de visibilidade).
--   * Postgres 17: row_security_active e os tipos foram medidos no PG17 local; um
--     outro major pode mudar a regra e o formato de format_type.
--   * Metadados (relrowsecurity, dono, privilégio, tipo) vêm do cache de catálogo
--     do Postgres e as linhas vêm do snapshot do statement: uma ALTER TABLE, um
--     ALTER ROLE ... BYPASSRLS ou um GRANT concorrente que comitasse no meio da
--     execução (exige um administrador agindo naquele instante) poderia aparecer
--     num lado e não no outro. A janela entre esta conferência e o apply é a mesma
--     limitação que a 8c tinha com dados (`validadeDaEvidenciaHoras`).
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro), no formato da 8c e da
-- 8j. As linhas "papel efetivo" e "metadados do papel efetivo" só informam
-- (esperado '(so informa)', ok true).
WITH papel AS (
  SELECT current_user::text AS nome,
         (SELECT r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS bypass,
         (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS super,
         current_setting('row_security') AS ajuste,
         current_setting('server_version_num') AS versao
), soma AS (
  SELECT o.id, o.subtotal,
         COALESCE(SUM(oi.quantity * oi.price), 0) AS soma_itens,
         count(oi.id) AS n_itens
    FROM public.marketplace_orders o
    LEFT JOIN public.marketplace_order_items oi ON oi.order_id = o.id
   GROUP BY o.id, o.subtotal
), vistas AS (
  SELECT (SELECT count(*) FROM soma) AS pedidos,
         (SELECT count(*) FROM public.marketplace_order_items) AS itens,
         (SELECT count(*) FROM soma WHERE subtotal IS DISTINCT FROM soma_itens) AS divergentes,
         (SELECT count(*) FROM soma WHERE subtotal IS DISTINCT FROM soma_itens AND n_itens = 0) AS divergentes_sem_item
), ped AS (
  SELECT c.relkind::text AS relkind,
         c.relrowsecurity AS rls_ligada,
         c.relforcerowsecurity AS rls_forcada,
         pg_has_role(current_user, c.relowner, 'USAGE') AS dono,
         has_table_privilege(current_user, c.oid, 'SELECT') AS pode_ler,
         row_security_active(c.oid) AS rls_ativa,
         (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped) AS t_id,
         (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'subtotal' AND a.attnum > 0 AND NOT a.attisdropped) AS t_subtotal
    FROM (SELECT 1) AS um
    LEFT JOIN pg_catalog.pg_class c
      ON c.relname = 'marketplace_orders' AND c.relnamespace = 'public'::regnamespace
), ite AS (
  SELECT c.relkind::text AS relkind,
         c.relrowsecurity AS rls_ligada,
         c.relforcerowsecurity AS rls_forcada,
         pg_has_role(current_user, c.relowner, 'USAGE') AS dono,
         has_table_privilege(current_user, c.oid, 'SELECT') AS pode_ler,
         row_security_active(c.oid) AS rls_ativa,
         (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped) AS t_id,
         (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'order_id' AND a.attnum > 0 AND NOT a.attisdropped) AS t_order_id,
         (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'quantity' AND a.attnum > 0 AND NOT a.attisdropped) AS t_quantity,
         (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'price' AND a.attnum > 0 AND NOT a.attisdropped) AS t_price
    FROM (SELECT 1) AS um
    LEFT JOIN pg_catalog.pg_class c
      ON c.relname = 'marketplace_order_items' AND c.relnamespace = 'public'::regnamespace
), deriv AS (
  SELECT (po.rls_ligada AND NOT (p.bypass OR p.super) AND NOT (po.dono AND NOT po.rls_forcada)) AS ped,
         (it.rls_ligada AND NOT (p.bypass OR p.super) AND NOT (it.dono AND NOT it.rls_forcada)) AS ite
    FROM papel p
   CROSS JOIN ped po
   CROSS JOIN ite it
), julga AS (
  SELECT v.pedidos, v.itens, v.divergentes, v.divergentes_sem_item,
         (v.pedidos = 0 AND v.itens = 0) AS zero_nas_duas,
         COALESCE(po.relkind = 'r' AND po.pode_ler AND po.rls_ativa IS NOT NULL
                  AND po.rls_ativa = d.ped AND NOT po.rls_ativa, false) AS ped_pronta,
         COALESCE(it.relkind = 'r' AND it.pode_ler AND it.rls_ativa IS NOT NULL
                  AND it.rls_ativa = d.ite AND NOT it.rls_ativa, false) AS ite_pronta
    FROM vistas v
   CROSS JOIN ped po
   CROSS JOIN ite it
   CROSS JOIN deriv d
), fim AS (
  SELECT j.*, (j.zero_nas_duas AND j.ped_pronta AND j.ite_pronta) AS vazia_provada
    FROM julga j
), r(item, esperado, vivo, ok) AS (
  SELECT 'papel efetivo', '(so informa)',
         'current_user=' || p.nome
           || '; rolbypassrls=' || COALESCE(p.bypass::text, '?')
           || '; rolsuper=' || COALESCE(p.super::text, '?')
           || '; row_security=' || p.ajuste
           || '; server_version_num=' || p.versao,
         true
    FROM papel p
  UNION ALL
  SELECT 'marketplace_orders: metadados do papel efetivo', '(so informa)',
         'relkind=' || COALESCE(po.relkind, 'AUSENTE')
           || '; select=' || COALESCE(po.pode_ler::text, '?')
           || '; rls_ligada=' || COALESCE(po.rls_ligada::text, '?')
           || '; rls_forcada=' || COALESCE(po.rls_forcada::text, '?')
           || '; dono=' || COALESCE(po.dono::text, '?')
           || '; row_security_active=' || COALESCE(po.rls_ativa::text, '?')
           || '; linhas=' || CASE WHEN j.pedidos > 0 THEN '>0' ELSE '0' END,
         true
    FROM ped po CROSS JOIN fim j
  UNION ALL
  SELECT 'marketplace_order_items: metadados do papel efetivo', '(so informa)',
         'relkind=' || COALESCE(it.relkind, 'AUSENTE')
           || '; select=' || COALESCE(it.pode_ler::text, '?')
           || '; rls_ligada=' || COALESCE(it.rls_ligada::text, '?')
           || '; rls_forcada=' || COALESCE(it.rls_forcada::text, '?')
           || '; dono=' || COALESCE(it.dono::text, '?')
           || '; row_security_active=' || COALESCE(it.rls_ativa::text, '?')
           || '; linhas=' || CASE WHEN j.itens > 0 THEN '>0' ELSE '0' END,
         true
    FROM ite it CROSS JOIN fim j
  UNION ALL
  SELECT 'marketplace_orders: relkind', 'r', COALESCE(po.relkind, 'AUSENTE'),
         COALESCE(po.relkind = 'r', false)
    FROM ped po
  UNION ALL
  SELECT 'marketplace_order_items: relkind', 'r', COALESCE(it.relkind, 'AUSENTE'),
         COALESCE(it.relkind = 'r', false)
    FROM ite it
  UNION ALL
  SELECT 'marketplace_orders: select de tabela inteira', 'true', COALESCE(po.pode_ler::text, 'AUSENTE'),
         COALESCE(po.pode_ler, false)
    FROM ped po
  UNION ALL
  SELECT 'marketplace_order_items: select de tabela inteira', 'true', COALESCE(it.pode_ler::text, 'AUSENTE'),
         COALESCE(it.pode_ler, false)
    FROM ite it
  UNION ALL
  SELECT 'marketplace_orders: row_security_active', 'false (e igual a derivacao do catalogo)',
         COALESCE(po.rls_ativa::text, 'AUSENTE')
           || CASE WHEN po.rls_ativa IS NOT NULL AND po.rls_ativa IS DISTINCT FROM d.ped
                   THEN ' (NAO bate com a derivacao)' ELSE '' END,
         COALESCE(po.rls_ativa = d.ped AND NOT po.rls_ativa, false)
    FROM ped po CROSS JOIN deriv d
  UNION ALL
  SELECT 'marketplace_order_items: row_security_active', 'false (e igual a derivacao do catalogo)',
         COALESCE(it.rls_ativa::text, 'AUSENTE')
           || CASE WHEN it.rls_ativa IS NOT NULL AND it.rls_ativa IS DISTINCT FROM d.ite
                   THEN ' (NAO bate com a derivacao)' ELSE '' END,
         COALESCE(it.rls_ativa = d.ite AND NOT it.rls_ativa, false)
    FROM ite it CROSS JOIN deriv d
  UNION ALL
  SELECT 'marketplace_orders.id: tipo', 'uuid', COALESCE(po.t_id, 'AUSENTE'),
         COALESCE(po.t_id = 'uuid', false)
    FROM ped po
  UNION ALL
  SELECT 'marketplace_orders.subtotal: tipo', 'numeric(10,2)', COALESCE(po.t_subtotal, 'AUSENTE'),
         COALESCE(po.t_subtotal = 'numeric(10,2)', false)
    FROM ped po
  UNION ALL
  SELECT 'marketplace_order_items.id: tipo', 'uuid', COALESCE(it.t_id, 'AUSENTE'),
         COALESCE(it.t_id = 'uuid', false)
    FROM ite it
  UNION ALL
  SELECT 'marketplace_order_items.order_id: tipo', 'uuid', COALESCE(it.t_order_id, 'AUSENTE'),
         COALESCE(it.t_order_id = 'uuid', false)
    FROM ite it
  UNION ALL
  SELECT 'marketplace_order_items.quantity: tipo', 'integer', COALESCE(it.t_quantity, 'AUSENTE'),
         COALESCE(it.t_quantity = 'integer', false)
    FROM ite it
  UNION ALL
  SELECT 'marketplace_order_items.price: tipo', 'numeric(10,2)', COALESCE(it.t_price, 'AUSENTE'),
         COALESCE(it.t_price = 'numeric(10,2)', false)
    FROM ite it
  UNION ALL
  SELECT 'controle: pedidos visiveis', '>0 (ou 0 com as duas tabelas VAZIAS PROVADAS)',
         CASE WHEN j.pedidos > 0 THEN '>0'
              WHEN j.vazia_provada THEN '0 (vazia provada)'
              ELSE '0' END,
         (j.pedidos > 0 OR j.vazia_provada)
    FROM fim j
  UNION ALL
  SELECT 'controle: itens de pedido visiveis', '>0 (ou 0 com as duas tabelas VAZIAS PROVADAS)',
         CASE WHEN j.itens > 0 THEN '>0'
              WHEN j.vazia_provada THEN '0 (vazia provada)'
              ELSE '0' END,
         (j.itens > 0 OR j.vazia_provada)
    FROM fim j
  UNION ALL
  SELECT 'vazia provada', 'se as duas leem 0: relkind r, SELECT de tabela inteira e RLS nao ativa nas duas',
         CASE WHEN NOT j.zero_nas_duas THEN 'nao se aplica (ha linhas visiveis)'
              WHEN j.vazia_provada THEN 'VAZIA PROVADA'
              ELSE 'ZERO NAO PROVADO (a RLS pode esconder linhas, ou falta SELECT de tabela inteira, ou nao e tabela comum)' END,
         (NOT j.zero_nas_duas OR j.vazia_provada)
    FROM fim j
  UNION ALL
  SELECT 'pedidos com soma dos itens diferente do subtotal', '0', j.divergentes::text,
         (j.divergentes = 0)
    FROM fim j
  UNION ALL
  SELECT '  dos quais sem nenhum item', '0', j.divergentes_sem_item::text,
         (j.divergentes_sem_item = 0)
    FROM fim j
)
SELECT item, esperado, vivo, ok
  FROM r
 ORDER BY ok, item;

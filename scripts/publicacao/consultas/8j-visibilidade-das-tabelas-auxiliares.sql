-- 8j — As seis tabelas que a 8h e a 8i leem estão VISÍVEIS para o papel que lê?
-- É DIAGNÓSTICO, não portão: não substitui, não suaviza e não reinterpreta a 8c,
-- a 8h nem a 8i, e NÃO atesta a impressão da 8i. Responde uma única pergunta que
-- as duas deixaram aberta: quando o controle "estornos visiveis" ou "devolucoes
-- visiveis" lê 0, a tabela está realmente VAZIA, ou tem linhas que a RLS (Row
-- Level Security, a regra do banco que decide quais linhas cada papel enxerga)
-- esconde de quem leu? Na CAF o papel é supabase_read_only_user, pelo endpoint
-- somente leitura, e não se sabe se ele tem BYPASSRLS (o atributo que dispensa a
-- RLS); por isso aqueles dois zeros ficaram INCONCLUSIVOS.
-- SÓ LEITURA, um único SELECT (um único statement, logo um único snapshot para as
-- seis contagens): sai só METADADO e 0 / >0. Nenhum id, nenhum valor de dinheiro,
-- nenhum dado de cliente. A contagem é EXATA (EXISTS), nunca a estimativa do
-- catálogo (a contagem aproximada que o Postgres guarda por tabela).
--
-- AS SEIS TABELAS: as mesmas da 8h e da 8i: marketplace_orders,
-- marketplace_order_items, marketplace_order_history,
-- marketplace_order_payment_history, order_refunds e devolucoes.
--
-- O QUE É MOSTRADO, para o papel EFETIVO (current_user; o endpoint somente
-- leitura roda como supabase_read_only_user): relkind (tem de ser 'r', tabela
-- comum), se o papel tem SELECT (has_table_privilege), relrowsecurity (RLS
-- ligada), relforcerowsecurity (FORCE: vale até para o dono), se o papel É o dono
-- (ou herda os privilégios do dono: é o que o Postgres compara), rolbypassrls e
-- rolsuper do papel, o ajuste row_security, e row_security_active(tabela).
--
-- SEMÂNTICA DE row_security_active (conferida na fonte, não de memória):
--   * Documentação oficial (PostgreSQL 17, 9.27 Session Information Functions):
--     "Is row-level security active for the specified table in the context of the
--     current user and current environment?". A página NÃO detalha as condições.
--   * Quem as define é o código (src/backend/utils/misc/rls.c, ramos REL_15_STABLE
--     e REL_17_STABLE, idênticos neste ponto): row_security_active() devolve
--     check_enable_rls(tabela, InvalidOid, noError => true) == RLS_ENABLED, e
--     check_enable_rls devolve, nesta ordem:
--       1. relrowsecurity = false           -> NÃO ativa (a tabela não tem RLS);
--       2. papel com BYPASSRLS ou superuser  -> NÃO ativa;
--       3. papel dono da tabela, sem FORCE   -> NÃO ativa (o dono ignora a RLS);
--       4. qualquer outro caso (não dono, ou dono COM FORCE) -> ATIVA.
--     "Dono" é object_ownercheck, que é has_privs_of_role: quem herda o papel dono
--     também conta (a consulta usa pg_has_role(..., 'USAGE'), o mesmo teste).
--   * O ajuste row_security NÃO muda esse resultado (o noError=true o ignora):
--     com row_security = off e RLS aplicável, row_security_active continua true e
--     é o SELECT de verdade que falha (42501, "query would be affected by
--     row-level security policy"), nunca devolve linhas em silêncio. Isto
--     CORRIGE a premissa de que a função "considera o GUC": ela não considera.
--   * ATIVA não diz o que o papel vê: com RLS ativa, o papel pode ver tudo, parte
--     ou nada (sem política que case, o padrão é negar). Por isso um 0 sob RLS
--     ativa NUNCA prova tabela vazia, nem quando o papel vê algumas linhas.
--
-- O VEREDITO de cada tabela usa SÓ estes quatro valores:
--   VISIVEL_VAZIA          tem SELECT, RLS NÃO ativa para o papel e nenhuma linha:
--                          o 0 É conclusivo (a tabela está vazia);
--   VISIVEL_COM_LINHAS     tem SELECT, RLS NÃO ativa para o papel e há linha;
--   RLS_ATIVA_INCONCLUSIVO RLS ativa para o papel: o 0 NÃO prova vazio (e um >0
--                          não prova que o papel vê tudo);
--   BLOQUEIA               qualquer outro caso: não é tabela comum, ausente do
--                          schema public, sem SELECT, ou row_security_active
--                          NÃO bate com a derivação (relrowsecurity, bypass, dono,
--                          FORCE): formato ou comportamento desconhecido bloqueia.
-- ok só é true para VISIVEL_VAZIA e VISIVEL_COM_LINHAS (conclusivos). INCONCLUSIVO
-- NÃO é ok. As linhas "papel efetivo" e "metadados" só informam (esperado
-- '(so informa)', ok true): quem decide é a linha "veredito" de cada tabela.
--
-- SEM PRIVILÉGIO: um statement estático não consegue pular um SELECT sem
-- permissão (o Postgres confere o privilégio de TODAS as tabelas do plano ao
-- iniciar, mesmo dentro de CASE), e SQL dinâmico está fora de questão. Então, se o
-- papel não tem NENHUM privilégio de SELECT numa das seis (nem de tabela inteira,
-- nem de coluna), a consulta INTEIRA falha com 42501 ("permission denied for
-- table <nome>"), que cita a tabela: falha alta, nunca um zero que engana.
-- MAS a ramificação BLOQUEIA de "sem SELECT" É alcançável: o EXISTS só exige algum
-- privilégio de SELECT, ainda que de UMA coluna, então um papel com SELECT só de
-- coluna(s) numa das seis roda a consulta inteira, e has_table_privilege(...,
-- 'SELECT'), que olha a tabela inteira, dá false: a linha dessa tabela sai
-- BLOQUEIA (select=false), nunca VISIVEL_VAZIA nem VISIVEL_COM_LINHAS, com ok
-- false. É o que o `AND m.pode_ler` de "julga" garante: sem ele, o EXISTS lido por
-- coluna daria VISIVEL_VAZIA e o 0 passaria por conclusivo (o teste de banco
-- tests/banco/impressao-digital-viva.cjs prova este caso).
-- Tabela ausente em public também falha
-- alto (42P01) pelo mesmo motivo.
--
-- O QUE ISTO NÃO DIZ:
--   * NÃO diz quantas linhas há: só 0 ou >0, e só como o papel que leu enxerga.
--   * NÃO atesta o hash da 8i nem dispensa a 8c: a 8c continua acusando e quem
--     decide continua sendo o dono. Uma tabela VISIVEL_VAZIA só torna o ZERO da
--     8h/8i naquela tabela conclusivo ("não há linha"), o que não prova que nunca
--     houve estorno ou devolução (pode ter sido apagado, ou passado por fora).
--   * Metadados (relrowsecurity, dono, privilégio) vêm do cache de catálogo do
--     Postgres e as linhas vêm do snapshot do statement: uma ALTER TABLE que
--     comitasse no meio da execução poderia aparecer num lado e não no outro.
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro), no formato da 8c.
WITH alvo(ordem, tabela) AS (
  VALUES (1, 'marketplace_orders'),
         (2, 'marketplace_order_items'),
         (3, 'marketplace_order_history'),
         (4, 'marketplace_order_payment_history'),
         (5, 'order_refunds'),
         (6, 'devolucoes')
), papel AS (
  SELECT current_user::text AS nome,
         (SELECT r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS bypass,
         (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS super,
         current_setting('row_security') AS ajuste,
         current_setting('server_version_num') AS versao
), vis AS (
  SELECT 'marketplace_orders' AS tabela,
         EXISTS (SELECT 1 FROM public.marketplace_orders) AS tem_linha
  UNION ALL
  SELECT 'marketplace_order_items',
         EXISTS (SELECT 1 FROM public.marketplace_order_items)
  UNION ALL
  SELECT 'marketplace_order_history',
         EXISTS (SELECT 1 FROM public.marketplace_order_history)
  UNION ALL
  SELECT 'marketplace_order_payment_history',
         EXISTS (SELECT 1 FROM public.marketplace_order_payment_history)
  UNION ALL
  SELECT 'order_refunds',
         EXISTS (SELECT 1 FROM public.order_refunds)
  UNION ALL
  SELECT 'devolucoes',
         EXISTS (SELECT 1 FROM public.devolucoes)
), meta AS (
  SELECT a.ordem, a.tabela,
         c.relkind::text AS relkind,
         c.relrowsecurity AS rls_ligada,
         c.relforcerowsecurity AS rls_forcada,
         pg_has_role(current_user, c.relowner, 'USAGE') AS dono,
         has_table_privilege(current_user, c.oid, 'SELECT') AS pode_ler,
         row_security_active(c.oid) AS rls_ativa,
         v.tem_linha
    FROM alvo a
    LEFT JOIN pg_catalog.pg_class c
      ON c.relname = a.tabela AND c.relnamespace = 'public'::regnamespace
    LEFT JOIN vis v ON v.tabela = a.tabela
), julga AS (
  SELECT m.*,
         COALESCE(m.relkind = 'r'
                  AND m.pode_ler
                  AND m.rls_ativa IS NOT NULL
                  AND m.rls_ativa = (m.rls_ligada
                                     AND NOT (p.bypass OR p.super)
                                     AND NOT (m.dono AND NOT m.rls_forcada)),
                  false) AS apto
    FROM meta m
   CROSS JOIN papel p
), veredito AS (
  SELECT j.ordem, j.tabela, j.relkind, j.pode_ler, j.rls_ligada, j.rls_forcada, j.dono,
         j.rls_ativa, j.tem_linha,
         CASE WHEN j.apto AND NOT j.rls_ativa AND NOT j.tem_linha THEN 'VISIVEL_VAZIA'
              WHEN j.apto AND NOT j.rls_ativa AND j.tem_linha THEN 'VISIVEL_COM_LINHAS'
              WHEN j.apto AND j.rls_ativa THEN 'RLS_ATIVA_INCONCLUSIVO'
              ELSE 'BLOQUEIA' END AS resultado
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
  SELECT v.tabela || ': metadados do papel efetivo', '(so informa)',
         'relkind=' || COALESCE(v.relkind, 'AUSENTE')
           || '; select=' || COALESCE(v.pode_ler::text, '?')
           || '; rls_ligada=' || COALESCE(v.rls_ligada::text, '?')
           || '; rls_forcada=' || COALESCE(v.rls_forcada::text, '?')
           || '; dono=' || COALESCE(v.dono::text, '?')
           || '; row_security_active=' || COALESCE(v.rls_ativa::text, '?')
           || '; linhas=' || CASE WHEN v.tem_linha IS NULL THEN '?'
                                  WHEN v.tem_linha THEN '>0' ELSE '0' END,
         true
    FROM veredito v
  UNION ALL
  SELECT v.tabela || ': veredito', 'VISIVEL_VAZIA ou VISIVEL_COM_LINHAS (conclusivo)',
         v.resultado,
         v.resultado IN ('VISIVEL_VAZIA', 'VISIVEL_COM_LINHAS')
    FROM veredito v
)
SELECT item, esperado, vivo, ok
  FROM r
 ORDER BY ok, item;

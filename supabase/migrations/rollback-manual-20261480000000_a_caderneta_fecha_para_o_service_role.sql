-- ============================================================================
-- Rollback manual — a caderneta fecha para o service_role (20261480000000)
-- ============================================================================
-- Devolve ao service_role TODOS os privilégios de tabela em public.frota_lojas e public.frota_segredo: GRANT ALL ... TO service_role,
-- o estado de antes medido no efêmero ({postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres} nas duas). Rodado pelo dono ou por
-- superusuário, o GRANT sai com o dono como concedente e a ACL volta byte a byte.
-- COM ELE VOLTA O COMPORTAMENTO DE ANTES: quem tiver a chave service_role do banco da caderneta volta a ler e escrever a frota inteira
-- pela API. Nada do repositório depende disso (ver o cabeçalho da migration), então não há código a reverter antes.
-- DADOS: nenhuma linha é lida nem tocada; muda só a ACL das duas tabelas, na entrada do service_role.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se as tabelas ou o papel não existirem, ou se o service_role estiver, em alguma das duas, com só
-- PARTE dos privilégios, privilégio de outro concedente, GRANT OPTION ou privilégio de coluna, ou as duas em estados diferentes (alguém
-- mexeu depois da migration: meça antes). Aceita as duas sem nada (o estado que a migration deixa) ou as duas com tudo (já desfeito:
-- rodar de novo é no-op). O pós-voo recusa se o service_role não ficou com tudo, sem GRANT OPTION, nas duas.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação) ou, no banco da caderneta de produção, pela sessão
-- (MCP), numa transação. Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261480000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_segredo oid := to_regclass('public.frota_segredo');
  v_sr oid := to_regrole('service_role');
  v_estados text;
BEGIN
  IF v_sr IS NULL OR v_lojas IS NULL OR v_segredo IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o papel service_role, public.frota_lojas ou public.frota_segredo não existe — nada a reverter aqui; meça o banco.';
  END IF;
  SELECT string_agg(t.estado, ',' ORDER BY t.relname) INTO v_estados FROM (
    SELECT c.relname,
           CASE
             WHEN EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                           WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND g.grantee = v_sr) THEN 'coluna'
             WHEN NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = v_sr) THEN 'nada'
             WHEN (SELECT string_agg(g.privilege_type || CASE WHEN g.grantor = c.relowner THEN '' ELSE '/outro' END
                                     || CASE WHEN g.is_grantable THEN '*' ELSE '' END, ',' ORDER BY g.privilege_type)
                     FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = v_sr)
                  = (SELECT string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
                       FROM aclexplode(acldefault('r', c.relowner)) g WHERE g.grantee = c.relowner) THEN 'tudo'
             ELSE 'parte'
           END AS estado
      FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)) t;
  IF v_estados NOT IN ('nada,nada', 'tudo,tudo') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o service_role em frota_lojas,frota_segredo está % — não é o estado que a 20261480000000 deixa (as duas sem nada) nem o de antes (as duas com tudo); nada foi desfeito, meça o banco.', v_estados;
  END IF;
END $preflight_rollback_20261480000000$;

GRANT ALL ON TABLE public.frota_lojas, public.frota_segredo TO service_role;

DO $posvoo_rollback_20261480000000$
DECLARE
  v_sr oid := to_regrole('service_role');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c
              WHERE c.oid IN (to_regclass('public.frota_lojas'), to_regclass('public.frota_segredo'))
                AND (SELECT string_agg(g.privilege_type || CASE WHEN g.grantor = c.relowner THEN '' ELSE '/outro' END
                                       || CASE WHEN g.is_grantable THEN '*' ELSE '' END, ',' ORDER BY g.privilege_type)
                       FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = v_sr)
                    IS DISTINCT FROM (SELECT string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
                                        FROM aclexplode(acldefault('r', c.relowner)) g WHERE g.grantee = c.relowner)) THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261480000000: o service_role não voltou com todos os privilégios de tabela (concedidos pelo dono, sem GRANT OPTION) nas duas';
  END IF;
END $posvoo_rollback_20261480000000$;

-- Privilégio mudou: recarrega o schema cache do PostgREST. Idempotente.
NOTIFY pgrst, 'reload schema';

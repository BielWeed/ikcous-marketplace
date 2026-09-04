-- ============================================================================
-- Migration 20261090000000 — a porta de ESCRITA anônima de produtos fecha na
-- camada do privilégio: tabela E views
-- (BANCO-090, issue #141 — frente blindagem-banco-0409, 04/09/2026)
-- ============================================================================
--
-- O PROBLEMA (tudo medido ao vivo em 04/09, scripts/db-inspect-blindagem-141.cjs
-- e revisão em duas rodadas — laudos 20260904-0754 e 20260904-0829 na mesa):
--
--   * TABELA produtos: anon e authenticated carregam DELETE, INSERT,
--     MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE (grantor=postgres).
--   * VIEW vw_produtos_admin: anon carrega INSERT, UPDATE, DELETE, TRUNCATE,
--     TRIGGER, MAINTAIN — o MESMO pacote que a view irmã vw_produtos_public
--     tinha em 20/08 e que a migration 20260821000100 revogou; a view de
--     admin ficou fora daquela correção (verificada: nenhuma das 4 migrations
--     que citam vw_produtos_admin a revoga). A view não é security_invoker,
--     roda com o crachá do dono — e o dono é isento do RLS da tabela
--     (relforcerowsecurity=false, documentado na própria 20260821000100).
--     A única fechadura é o WHERE is_admin() com check_option=cascaded:
--     SEGUNDA camada segurando a primeira, exatamente o que esta frente
--     recusa.
--   * VIEW vw_produtos_public: resíduo da mesma leva — anon e authenticated
--     ainda carregam TRUNCATE/TRIGGER/MAINTAIN (o INSERT/UPDATE/DELETE de
--     anon já saiu na 20260821000100).
--
-- O QUE SEGURAVA ISSO HOJE (dito com precisão, porque o texto da 1ª versão
-- desta migration errava): NÃO é só o RLS. O RLS nem cobre parte do pacote —
-- operações de tabela inteira (TRUNCATE, REFERENCES) nunca passaram por row
-- security, e MAINTAIN (LOCK TABLE/VACUUM — PG17) também não; o que os
-- segurava era o PostgREST não expor o verbo (acidente de superfície) e, no
-- caso do anon, a ausência de policy. Não escrever não era IMPOSSÍVEL: era
-- não ter sido tentado por nenhum caminho que não o PostgREST padrão.
--
-- IMPORTANTE, para não ler errado: o checkout de CONVIDADO escreve em
-- produtos HOJE, POR DESENHO — as RPC create_marketplace_order_v23/v24 são
-- SECURITY DEFINER e o front as chama com a chave anon sem sessão. Isso
-- NÃO é o furo: é camada deliberada (a RPC recalcula tudo no servidor). O
-- furo é o privilégio DIRETO na tabela e nas views, que ninguém chama.
--
-- O QUE ESTA MIGRATION FAZ:
--   * TABELA produtos: anon perde INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER
--     e MAINTAIN (REFERENCES fica — inócuo sem CREATE no schema, medido:
--     has_schema_privilege não concedido); authenticated perde TRUNCATE,
--     TRIGGER e MAINTAIN (o app nunca exerce: PostgREST não os emite; grep
--     de src/ + supabase/functions/: zero usos, só a classe CSS "truncate").
--     authenticated MANTÉM INSERT/UPDATE/DELETE — a escrita legítima do
--     painel admin, decidida pelas policies produtos_admin_*_policy.
--   * VIEW vw_produtos_admin: anon perde a escrita e manutenção TODA
--     (INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/MAINTAIN); authenticated perde
--     TRUNCATE/TRIGGER/MAINTAIN e MANTÉM INSERT/UPDATE/DELETE — é o caminho
--     real do cadastro do painel (src/hooks/useProducts.ts).
--   * VIEW vw_produtos_public (só leitura por natureza): anon e
--     authenticated perdem TRUNCATE/TRIGGER/MAINTAIN — resíduo da leva de
--     20/08. NÃO é sujeira inerte (correção da 3ª revisão): TRUNCATE de
--     view nem é comando válido, mas TRIGGER em view É (INSTEAD OF), e
--     MAINTAIN ATRAVESSA — lock numa view trava recursivamente as tabelas
--     da definição SEM o usuário precisar de permissão nelas (doc PG17,
--     sql-lock): anon com MAINTAIN em qualquer uma das views tomava ACCESS
--     EXCLUSIVE sobre produtos por um SEGUNDO caminho, sem tocar a tabela.
--     Por isso o REVOKE nas views vale por si.
--   * postgres e service_role: intocados em tudo (donos/backend).
--
-- POR QUE MAINTAIN ENTRA (PG17, medido: este banco é 17.6): MAINTAIN autoriza
-- LOCK TABLE — anon com MAINTAIN consegue ACCESS EXCLUSIVE na tabela/view e
-- segura a vitrine inteira por refém (negação de serviço barata). NOTA do
-- revisor (laudo 2ª rodada, aceita): o DoS por lock já era alcançável por
-- UPDATE/DELETE de anon; revogar MAINTAIN de authenticated NÃO fecha o DoS
-- de authenticated (que mantém UPDATE/DELETE por desenho) — o que fecha o
-- de anon é revogar o pacote TODO dele, que é o que este arquivo faz.
-- REVOKE MAINTAIN é erro de parse em Postgres <= 16: aceitável — o alvo é o
-- banco-molde e seus clones (PG17+); falhar em vermelho em banco mais velho
-- é sinal de ambiente errado.
--
-- FORA DO ESCOPO (registrado por nome, não evapora):
--   * ALTER DEFAULT PRIVILEGES (medido em 04/09): relações NOVAS em public
--     criadas por postgres/supabase_admin nascem com anon+authenticated
--     recebendo o pacote inteiro por atacado — é a RAIZ (e inclui views,
--     "tables (including views and foreign tables)" na doc do PG17). E tem
--     PRAZO, não é "algum dia": CREATE OR REPLACE VIEW preserva a ACL, mas
--     DROP+CREATE não — a próxima mudança de coluna em vw_produtos_admin a
--     faz RENASCER com o pacote inteiro. Foi exatamente assim que a porta
--     que este arquivo fecha nasceu. Pendência para o dono (issue própria).
--   * anon MANTÉM SELECT na vw_produtos_admin (medido 04/09: lê 0 linhas —
--     o WHERE is_admin() filtra; é segunda camada na LEITURA, o mesmo
--     arranjo que esta frente recusa na escrita). Candidato a REVOKE SELECT
--     em issue própria, precedido de grep provando que nenhuma tela
--     anônima consulta a view.
--   * authenticated escreve na vw_produtos_admin guardado só pelo
--     is_admin() do check_option — arranjo legítimo do app hoje, registrado.
--   * A porta de EXECUTE das RPCs (v22/PUBLIC): é a issue #114, migration
--     irmã 20261091000000 desta mesma frente.
--
-- IDEMPOTÊNCIA: REVOKE de privilégio já ausente é no-op. Re-executar mantém o
-- mesmo estado.
--
-- COMO PROVAR (padrão da casa — transação com ROLLBACK, nada gravado; a prova
-- LÊ ESTE ARQUIVO do disco e o executa dentro da tx, nada é redigitado):
--   ANTES de a central aplicar:  node scripts/db-prove-blindagem-anon-produtos.cjs
--   DEPOIS de a central aplicar: node scripts/db-prove-blindagem-anon-produtos.cjs --depois
-- Os dois modos têm pré-condições que abortam com exit 2 INCONCLUSIVO se o
-- estado vivo não for o esperado do momento — verde sem estado é vácuo.
--
-- ROLLBACK: rollback-manual-20261090000000_*.sql versionado junto (o
-- db-apply.cjs NÃO fotografa ACL — issue #140 — por isso o rollback é à mão).
-- ============================================================================

-- 1. TABELA produtos ----------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.produtos FROM anon;
REVOKE TRUNCATE, TRIGGER, MAINTAIN
  ON public.produtos FROM authenticated;

-- 2. VIEW vw_produtos_admin (a porta esquecida pela 20260821000100) -----------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_admin FROM anon;
REVOKE TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_admin FROM authenticated;

-- 3. VIEW vw_produtos_public (resíduo da mesma leva) ---------------------------
REVOKE TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_public FROM anon;
REVOKE TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_public FROM authenticated;

-- 4. Trava de estado final: varre o QUADRO INTEIRO que esta migration mexe
-- (3 objetos x 2 papéis x 6 privilégios = 24 triplas) e explode se SOBRAR
-- qualquer célula de escrita/manutenção fora das exceções legítimas (o
-- INSERT/UPDATE/DELETE de authenticated, que o painel usa; SELECT e
-- REFERENCES, que esta migration não toca). Cobertura 24/24 — não uma lista
-- de disjuntos que envelhece mal. INSERT/UPDATE também conferidos por
-- COLUNA (a cicatriz da 20260821000100: grant de coluna escapa do
-- has_table_privilege). IMPORTANTE, dito com precisão: isto valida o
-- INSTANTE em que este arquivo roda — um DO block executa uma vez, não
-- protege o futuro; quem vigia daqui em diante são os repetíveis (a prova
-- em modo --depois e o detector de objetos do CI, #139).
DO $$ DECLARE sobrou record; BEGIN
  FOR sobrou IN
    SELECT o.objeto, r.papel, p.priv
    FROM (VALUES ('produtos'),('vw_produtos_admin'),('vw_produtos_public')) o(objeto),
         (VALUES ('anon'),('authenticated')) r(papel),
         (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('TRIGGER'),('MAINTAIN')) p(priv)
    WHERE (
            has_table_privilege(r.papel, 'public.'||o.objeto, p.priv)
            OR (p.priv IN ('INSERT','UPDATE')
                AND has_any_column_privilege(r.papel, 'public.'||o.objeto, p.priv))
          )
      AND NOT (
            (r.papel = 'authenticated' AND p.priv IN ('INSERT','UPDATE','DELETE')
             AND o.objeto IN ('produtos','vw_produtos_admin'))
          )
  LOOP
    RAISE EXCEPTION 'blindagem 141 falhou: % ainda alcanca % em %', sobrou.papel, sobrou.priv, sobrou.objeto;
  END LOOP;
END $$;

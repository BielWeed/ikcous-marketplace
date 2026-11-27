-- O CATALOGO E A CONFIGURACAO CHEGAM AO VIVO EM TODA LOJA (27/11/2026).
--
-- 1. O DEFEITO
-- O front assina, pelo realtime, as mudancas de produto, variacao, categoria, banner, configuracao da loja, avaliacao, pergunta,
-- resposta, carrinho e favorito (`grep -rn 'table: "' src/`): 10 tabelas. Cupom NAO (realtimeSyncEngine.ts: "CUPONS NAO ENTRAM
-- AQUI"; useCoupons.ts so consulta). Medido em 27/11/2026 03:02 UTC com a consulta 18a-inventario-de-portas (papel
-- supabase_read_only_user):
--   - IKCOUS (CAF, a loja de desenvolvimento): a publicacao supabase_realtime tem 14 tabelas (as 10 abaixo, coupons e as 3 da
--     20261061), todas com replica identity default menos as 3 que a 20261061 deixa FULL. As 11 foram postas A MAO (o que as punha
--     era a _arquivadas/20260708020000 e as 030000/040000/050000, que nao rodam mais: o instalador ignora _arquivadas/).
--   - Savy (cliente real) e toda loja nova do instalador (scripts/frota/instalador-banco.mjs): SO as 3 da 20261061.
-- Efeito para quem usa: na Savy e nas lojas novas, o segundo aparelho da lojista (e o da cliente) nao ve AO VIVO a mudanca de
-- configuracao, produto, variacao, categoria ou banner feita no outro; e as telas que gravam a LISTA INTEIRA (as vitrines em
-- AdminCarouselsView.tsx, as formas de pagamento na entrega, os metodos de envio) gravam por cima do que o outro aparelho mudou.
--
-- 2. O QUE ESTA MIGRATION FAZ
-- Poe na publicacao supabase_realtime, SO se a publicacao existir e SO a tabela que ainda nao estiver nela, exatamente estas 10:
-- answers, banners, cart_items, categorias, favorites, product_variants, produtos, questions, reviews e store_config.
-- Nenhuma outra tabela: coupons fica de fora (ninguem a assina; na IKCOUS ela continua publicada como esta, nao e' tocada).
-- Replica identity NAO e' tocada (default, a da CAF). Nenhuma linha e' lida, gravada ou apagada: entrar na publicacao so faz o
-- realtime passar a receber as mudancas FUTURAS dessas tabelas; nada do que ja existe e' reenviado.
--   - IKCOUS (as 14 ja la): NO-OP. Os IF pulam e o catalogo da publicacao fica identico (provado: o oid de cada pg_publication_rel
--     nao muda); coupons continua la.
--   - Savy e loja nova: as 10 entram (13 tabelas no total); as 3 da 20261061 ficam como estao.
--   - Loja pela metade (alguma posta a mao): so as que faltam entram.
--   - Sem a publicacao (Postgres que nao e' Supabase): NOTICE e nada; a 20261061 ja teria recusado antes.
--   - Publicacao FOR ALL TABLES: pg_publication_tables ja lista todas, os IF pulam: no-op.
-- Idempotente: rodar de novo (LF ou CRLF) nao erra e nao mexe. SEM BEGIN/COMMIT (regra da casa: o db-apply.cjs e o instalador
-- abrem a transacao; tudo ou nada).
--
-- 3. PRE-VOO (B1_BASELINE_DIVERGENT, antes de qualquer ALTER; nada entra se uma das 10 falhar)
--   - a tabela existe e e' tabela comum;
--   - RLS ligada: sem RLS o realtime entregaria toda linha a todo assinante com SELECT na tabela;
--   - identidade de replicacao utilizavel (chave primaria com replica identity default, FULL, ou indice): numa tabela publicada SEM
--     ela, o Postgres passa a RECUSAR todo UPDATE e DELETE ("does not have a replica identity and publishes updates") e a loja
--     pararia de gravar. As 10 tem chave primaria (id) no esquema que as migrations criam.
-- POS-VOO (B2_POSVOO_DIVERGENTE): se a publicacao existe e nao e' FOR ALL TABLES, as 10 estao nela.
--
-- 4. TRAVA
-- ALTER PUBLICATION ... ADD TABLE pega SHARE UPDATE EXCLUSIVE em cada tabela (medido no PG 17): gravacao e leitura em voo NAO
-- seguram o apply nem sao seguradas por ele. Quem segura e' VACUUM/ANALYZE/CREATE INDEX CONCURRENTLY: com lock_timeout de 5 s o apply
-- desiste com 55P03 e nada fica (provado no CI); rodar de novo.
--
-- 5. SEGURANCA: o realtime (postgres_changes) entrega o que o SELECT ja entrega
-- Pela documentacao do Supabase Realtime (ARCHITECTURE.md e SECURITY.md do repositorio supabase/realtime, lidos em 27/11/2026):
-- cada mudanca de INSERT/UPDATE so vai ao assinante se a RLS de SELECT da tabela deixa ESSE usuario (papel + JWT) ler ESSA linha, e
-- as colunas que o papel nao pode ler (privilegio por coluna) saem da mensagem. Politicas medidas no Postgres efemero com a fila
-- inteira de migrations (27/11/2026; a prova viva confere a lista e falha se uma mudar):
--
--   tabela            politica de SELECT mais nova (onde)                         visitante (anon)         conta (authenticated)
--   answers           answers_select_policy TO public USING true (baseline)       todas                    todas
--   banners           banners_select_policy TO public: ativo e na janela          so o ativo na janela     o ativo na janela;
--                     (20261381); banners_admin_select_policy TO authenticated                             o admin atual, todos
--                     USING rls_admin_atual() (20261381)
--   cart_items        cart_items_select_policy TO authenticated: o proprio        nada (sem politica)      so o PROPRIO carrinho;
--                     (user_id = auth.uid()) ou rls_admin_atual() (20261340)                                o admin atual, todos
--   categorias        categorias_select_policy TO public USING true (baseline)    todas                    todas
--   favorites         favorites_all_policy (ALL) TO authenticated: o proprio      nada (sem politica)      so os PROPRIOS favoritos
--                     (user_id = auth.uid()) (baseline)
--   product_variants  product_variants_select_policy TO public USING true         todas                    todas
--                     (baseline; nenhuma coluna de custo)
--   produtos          produtos_select_policy TO authenticated: ativo, ou o        nada (sem SELECT em      o ativo; o admin atual,
--                     admin atual (20261360); anon sem SELECT e authenticated     nenhuma coluna)          todos; SEM a coluna custo
--                     com SELECT por coluna, sem `custo` (20261070)
--   questions         questions_select_policy TO authenticated USING true         nada (sem politica)      todas: o esquema nao tem
--                     (20261111)                                                                            pergunta "nao aprovada"
--   reviews           reviews_select_policy TO authenticated: publicada, ou a     nada (sem politica)      a publicada, a PROPRIA
--                     propria, ou o admin atual (20261360)                                                  pendente; o admin, todas
--   store_config      store_config_select_policy TO public USING true (baseline)  todas as colunas         todas as colunas
--
-- Em todas a RLS esta ligada, sem FORCE e sem politica restritiva; quem le a vitrine como visitante (avaliacao, pergunta, perfil) le
-- por funcao, nunca pelo realtime. Conclusao: por INSERT/UPDATE ninguem passa a receber uma linha que nao poderia ler por SELECT.
--
-- O QUE SOBRA (comportamento documentado da plataforma, ja vale hoje na CAF para as 14 e na Savy para as 3): o DELETE nao passa pela
-- RLS (a linha ja nao existe para ser conferida), e quem assina a tabela com SELECT nela recebe SO a chave primaria da linha apagada.
-- Aqui a chave e' um uuid aleatorio (id) que nao abre nada: toda leitura continua passando pela RLS. Ou seja: um assinante pode saber
-- QUE um item de carrinho ou favorito de alguem foi apagado, e o id dele, nunca o conteudo.
-- Efeito no front: com replica identity default, o registro antigo do DELETE so traz a chave primaria (id). O filtro do realtime e'
-- comparado com esse registro, entao uma assinatura filtrada por outra coluna (o `user_id=eq.<id>` de CartContext.tsx) NUNCA casa com
-- um DELETE: o outro aparelho nao fica sabendo, por esse canal, do item tirado do carrinho. A identidade fica default DE PROPOSITO
-- (paridade com a CAF, que funciona assim hoje); mudar isso e' outra decisao, nao desta migration.
--
-- 6. ORDEM E CONFERENCIA
-- Banco antes ou depois do front da no mesmo (o front ja assina as 10). Conferencia: 197b (antes: premissas e pelo menos uma das 10
-- fora) e 197a (depois: as 10 e as 3 presentes; coupons TOLERADA, nem exigida nem proibida; nenhuma outra no esquema public). Na IKCOUS
-- a 197a sai POSITIVA ANTES do apply (as 10 ja la): com o ledger sem a versao e sem backfillLedger o portao PARA, e o caminho e'
-- aplicar pelo aplicar-migrations.yml (no-op que grava o ledger na mesma transacao). Prova de comportamento no CI efemero:
-- tests/banco/o-catalogo-chega-ao-vivo-em-toda-loja-viva.cjs.
--
-- ROLLBACK EM DOIS ARQUIVOS: rollback-manual-20261610000000_o_catalogo_e_a_configuracao_chegam_ao_vivo_em_toda_loja.sql (o comum) NAO
-- tira nada da publicacao: so confere e avisa (roda sem confirmacao, inclusive na pilha de rollbacks do CI). Tirar do ao vivo e'
-- rollback-manual-destrutivo-20261610000000_o_catalogo_e_a_configuracao_chegam_ao_vivo_em_toda_loja.sql, SO COM O DONO, so para loja que
-- nao tinha NENHUMA das 10 antes (a Savy medida em 27/11/2026, loja nova) e com confirmacao; NUNCA na IKCOUS.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $publicacao_20261610000000$
DECLARE
  v_dez CONSTANT text[] := ARRAY['answers', 'banners', 'cart_items', 'categorias', 'favorites', 'product_variants', 'produtos',
                                 'questions', 'reviews', 'store_config'];
  v_tabela text;
  v_t regclass;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE '20261610000000: a publicacao supabase_realtime nao existe neste banco; nada a fazer.';
    RETURN;
  END IF;

  -- PRE-VOO: as 10, todas, antes de qualquer ALTER.
  FOREACH v_tabela IN ARRAY v_dez LOOP
    v_t := to_regclass(format('public.%I', v_tabela));
    IF v_t IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_t AND relkind = 'r') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% nao existe (ou nao e tabela comum).', v_tabela;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_t AND relrowsecurity) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% esta sem RLS: no realtime, toda linha iria para todo assinante.', v_tabela;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class k
       WHERE k.oid = v_t
         AND (k.relreplident = 'f'
              OR (k.relreplident = 'd' AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.oid AND i.indisprimary))
              OR (k.relreplident = 'i' AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.oid AND i.indisreplident)))
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% sem identidade de replicacao utilizavel (sem chave primaria, ou NOTHING): publicada, todo UPDATE e DELETE nela passaria a errar.', v_tabela;
    END IF;
  END LOOP;

  -- A tabela que ja esta na publicacao (a CAF, ou posta a mao) nao e' tocada.
  FOREACH v_tabela IN ARRAY v_dez LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = v_tabela
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tabela);
    END IF;
  END LOOP;

  -- POS-VOO
  IF EXISTS (
    SELECT 1 FROM unnest(v_dez) AS o(t)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public' AND pt.tablename = o.t
     )
  ) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: alguma das 10 tabelas nao ficou na publicacao supabase_realtime.';
  END IF;
END
$publicacao_20261610000000$;

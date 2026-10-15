-- ============================================================================
-- Migration 20261242000000 — o lucro usa o custo do dia da venda
-- (dinheiro e relatório do lojista; decisão de produto do dono em 15/10/2026: "guardar o custo do dia
-- em cada venda; venda anterior continua com o custo de hoje")
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- O lucro do CRM (`get_admin_analytics_v2`: gráfico "Lucro acumulado" e "Top 5 produtos mais lucrativos") e o
-- CMV da DRE (`fin_dre`) calculavam o custo de cada item vendido com o custo de HOJE do produto
-- (`produtos.custo`). Mudar o custo de um produto reescrevia, para trás, o lucro de TODA venda já feita: o
-- relatório do mês passado mudava sozinho quando a lojista corrigia um custo. A decisão antiga ("custo
-- histórico fora do escopo", 20261177000000, linhas 84-87) foi reaberta pelo dono.
--
-- 2. O QUE ELA FAZ
--
--   (a) `marketplace_order_item_custo` — tabela LATERAL, só do servidor: uma linha por item de pedido com o custo
--       que o produto tinha NO MOMENTO em que o item nasceu (item_id PK e FK com ON DELETE CASCADE, custo
--       numeric NOT NULL, registrado_em). RLS ligada, NENHUMA política, REVOKE ALL de PUBLIC, anon, authenticated
--       e service_role: ninguém de fora lê ou escreve; leem só o dono do banco e as funções SECURITY DEFINER.
--   (b) `marketplace_order_item__guarda_o_custo_do_dia()` + o gatilho `tr_marketplace_order_items_guarda_o_custo_do_dia`
--       (AFTER INSERT, por linha, em `marketplace_order_items`): copia `produtos.custo` para a tabela lateral
--       quando o item nasce. É um gatilho, e não uma mudança nas funções de compra, para valer para TODO caminho
--       que cria item — a loja (`create_marketplace_order_v24`), o balcão (`registrar_venda_presencial`), qualquer
--       versão futura e a inserção direta do painel — sem tocar em nenhuma delas.
--   (c) `get_admin_analytics_v2` e `fin_dre` passam a usar `COALESCE(custo do dia, produtos.custo)`: o custo do
--       dia quando o item tem registro, o custo de hoje quando não tem (venda de antes desta migration, ou
--       produto sem custo no dia). SÓ a fonte do custo muda; filtros, janelas, status, chaves e tipos do JSON
--       ficam como estavam.
--
-- 3. POR QUE UMA TABELA LATERAL, E NÃO UMA COLUNA EM marketplace_order_items
--
-- `marketplace_order_items` tem GRANT de tabela inteira a authenticated e anon (medido: ALL), e a cliente lê os
-- itens do PRÓPRIO pedido por política de linha. Uma coluna nova herdaria esse GRANT e entregaria o CUSTO do
-- lojista à cliente (e `produtos.custo` é justamente a coluna que 20260990000000/20261070000000 fecharam).
-- Tabela à parte, sem GRANT e sem política, não tem como vazar por PostgREST, por RLS ou por
-- `select=*` — e nenhuma função que devolve itens ao cliente a menciona.
--
-- 4. POR QUE O GATILHO NUNCA PODE QUEBRAR A COMPRA (E O QUE ISSO CUSTA)
--
-- O gatilho roda DENTRO da transação da venda, logo depois do item. Um erro dele abortaria a compra inteira:
-- a cliente ficaria sem comprar (e sem o estoque reservado) por causa de um dado de RELATÓRIO. Por isso o corpo
-- tem um bloco `EXCEPTION WHEN OTHERS` que só avisa e segue: o item nasce SEM registro e a conta cai, para ESSE
-- item, no custo de hoje — o mesmo que acontecia antes desta migration. A degradação é a de sempre; o erro é
-- que seria novo. O aviso (`RAISE WARNING`) leva SÓ o SQLSTATE e o id do item: nunca o valor do custo nem a
-- mensagem do erro (que pode citar valor). `INSERT ... ON CONFLICT (item_id) DO NOTHING`: repetir é inofensivo.
-- (`WHEN OTHERS` não captura o cancelamento por `statement_timeout`/`lock_timeout`: esses seguem valendo para a
-- venda.) O gatilho lê `produtos` sem trava: a venda já travou a linha do produto no UPDATE do estoque, então o
-- custo lido é o que estava gravado quando a venda pegou o produto.
--
-- CUSTO DO BLOCO EXCEPTION (doc PG17, 41.6.8 e 66.3): cada bloco que entra no corpo abre uma SUBTRANSAÇÃO por
-- item. Passar de 64 subtransações numa transação "estoura" o cache de subtransações do backend: enquanto a
-- venda não termina, as consultas dos OUTROS backends passam a consultar pg_subtrans para decidir visibilidade
-- (mais lento, sem erro, sem perda de dado). O balcão aceita até 200 itens por venda e a loja online não tem
-- teto, então o estouro existe para venda grande. Alternativas pesadas e descartadas:
--   * sem bloco EXCEPTION: a compra passaria a depender deste INSERT (qualquer falha dele aborta a venda),
--     que é exatamente o que a regra "a venda nunca quebra" proíbe;
--   * gatilho por INSTRUÇÃO (tabela de transição): as funções de compra inserem item a item num laço, então
--     cada instrução tem uma linha e o número de subtransações é o mesmo;
--   * um laço único no fim da venda: exigiria mexer nas funções de compra, o que o gatilho existe para evitar.
-- O que SE evita: item sem produto sai ANTES do bloco (nenhuma subtransação). O resto fica e foi MEDIDO: a prova
-- viva (tests/banco/custo-do-dia-viva.cjs, prova da carga de 200 itens) vende 200 itens no balcão em UMA
-- transação e mede os xids gastos (uma subtransação que escreve gasta um) e o tempo, com e sem o gatilho.
-- MEDIDO (PG17 local, 200 itens, produto com custo em todos): 203 xids com o gatilho contra 3 sem ele (o cache
-- de 64 estoura), 394 a 475 ms contra 373 a 434 ms (a diferença é do tamanho do ruído da máquina). Venda de até
-- uns 60 itens com custo não estoura; só a venda grande o faz, por menos de meio segundo, sem erro e sem perda.
-- Aceito de propósito: o ganho de nunca derrubar a compra vale mais que esse custo, que só aparece em venda
-- de centenas de itens e só atrasa as consultas dos outros enquanto ela não termina.
--
-- 5. REGRAS DA CONTA
--
--   * item COM registro: custo do dia; item SEM registro: custo de hoje do produto (COALESCE, nunca erro);
--   * produto SEM custo no dia da venda (`custo IS NULL`): NENHUMA linha é gravada — o item usa o custo de
--     hoje, como as vendas antigas, e a regra do CRM de 20261234000000 (custo ausente não vira margem de 100%)
--     segue valendo item a item: sem custo do dia e sem custo hoje, o item fica fora do lucro e do ranking e
--     o produto entra em `productsWithoutCost`;
--   * custo 0 é zero medido (o brinde) e é gravado e contado;
--   * CRM: o ranking e o contador de "sem custo" passam a decidir por ITEM (antes, por produto). Sem nenhum
--     registro (hoje, em toda loja) a decisão é idêntica à de antes;
--   * DRE: o CMV da venda e o que volta por devolução usam o mesmo custo do item vendido (a devolução credita
--     o custo com que a venda saiu, não o de hoje); sem registro, o custo de hoje, e produto sem custo conta 0
--     (a regra de sempre da DRE, que não filtra por "tem custo");
--   * estoque (`inventory`, `inventoryAlerts`) NÃO muda: o estoque vale pelo custo de HOJE.
--
-- 6. DADOS EXISTENTES (o que acontece com a linha que já estava lá)
--
-- NENHUM BACKFILL (decisão do dono): nenhuma linha de pedido, item ou produto é lida para decidir ou
-- reescrita ao aplicar; a tabela nasce VAZIA. Todo item que já existe fica sem registro e continua com o
-- custo de hoje. Os números dos relatórios, com a tabela vazia, são IDÊNTICOS aos do corpo anterior (a prova
-- viva compara os dois corpos no mesmo banco, em dataset sem registro). Só as vendas feitas DEPOIS do apply
-- passam a ter o custo do dia.
--
-- 7. QUEM LÊ / QUEM QUEBRA
--
-- Nenhuma assinatura muda. `get_admin_analytics_v2` (src/hooks/useAnalytics.ts, src/hooks/useOrders.ts) devolve
-- as MESMAS chaves e tipos; `fin_dre` (src/components/admin/financeiro/AbaDre.tsx e, por
-- `painel_inicio`/`get_admin_dashboard`, o "lucro do mês" do Início) também. Quem insere itens
-- (`create_marketplace_order_v24`, `registrar_venda_presencial`, a inserção do painel) não muda uma linha. O front
-- de antes funciona com o banco novo.
--
-- 8. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: faltar tabela ou coluna que os corpos leem; alguma das duas funções não existir, tiver
-- sobrecarga, atributos diferentes, ACL aberta ou corpo (md5 de replace(prosrc, E'\r', '')) que não seja o
-- VIGENTE nem o desta migration; a tabela nova ou a função do gatilho já existirem com forma diferente; o
-- gatilho já existir apontando para outra função. Os hashes são o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_lucro_usa_o_custo_do_dia_da_venda_test.ts.
--
-- 9. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa — o aplicador recusa controle de transação no corpo e
-- quem abre a transação é ele; local: `psql -1`): o pré-voo, as criações, a troca dos dois corpos e a
-- conferência final CAEM JUNTOS OU NÃO CAEM. Aplicar duas vezes deixa o mesmo estado: CREATE TABLE IF NOT EXISTS,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER, CREATE OR REPLACE, e o pré-voo aceita o corpo desta migration como
-- estado de entrada.
--
-- TRAVA DO APPLY (aplique FORA DO HORÁRIO DE PICO): CREATE TRIGGER e a chave estrangeira pedem
-- `marketplace_order_items` em SHARE ROW EXCLUSIVE, que conflita com o ROW EXCLUSIVE de todo INSERT de item. O
-- balcão trava produto a produto DENTRO do laço de itens e a v24 trava todos ANTES (20261235:404-457,
-- 20261236:528-561): uma `LOCK` simples na fila deixaria TODA venda nova esperando atrás da migration, e dois
-- caminhos de ordem diferente formariam o ciclo "mole" que o Postgres só desfaz depois de `deadlock_timeout`.
-- Por isso o pré-voo pega essa trava PRIMEIRO, SEM ficar na fila: tenta `LOCK ... NOWAIT` e, se a tabela está
-- ocupada por uma venda em andamento, dorme 100 ms e tenta de novo, por no máximo 4 s; passado isso RECUSA
-- (55P03) sem gravar nada e basta repetir (a forma da 20261209000000). Esperando ela não segura nada que uma
-- venda queira, então não há deadlock possível; depois de pegar a trava só cria objetos novos e troca dois
-- corpos de função (que não travam tabela). `SET LOCAL lock_timeout = '5s'` fica como cinto de segurança para
-- qualquer outra espera e `SET LOCAL statement_timeout = '30s'` limita a transação inteira do aplicador.
--
-- 10. HASHES (md5 do corpo sem CR, vigente -> desta)
--   get_admin_analytics_v2   05eac70f6bd4360c1f71fd373747ad0e -> dceb62881ebf8fa404ba3ac295041691
--   fin_dre                  e58ac49d3881a459b929064a3acb470a -> afc3e13805ce37819cfdcd094043087c
--   marketplace_order_item__guarda_o_custo_do_dia   (nova)   b9be9cba9794deb2c1700bfbc3578454
-- Os "vigentes" vêm dos ARQUIVOS das migrations 20261234000000 e 20261199000000; o corpo vivo de cada loja só
-- a consulta 45b mede, ANTES do apply.
--
-- 11. ORDEM E ROLLBACK (DOIS DEGRAUS)
--
-- Depois da 20261241000000 (e de toda a cadeia: analytics 99 -> 14 -> 34 -> 42, fin_dre 99 -> 42). O banco de
-- CADA loja ANTES do front desta mudança (o front só troca textos). NUNCA reaplicar depois desta a
-- 20261234000000 nem a 20261199000000: o pré-voo delas recusa o corpo novo.
-- ROLLBACK, DOIS DEGRAUS: o custo do dia é a ENTREGA desta migration e não se reconstrói (o custo do produto
-- muda e o de ontem se perde). Por isso o rollback comum NÃO apaga a tabela.
--   (a) rollback-manual-20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql — devolve os DOIS corpos de antes
--       byte a byte (md5 acima), tira o gatilho e a função do gatilho, e DEIXA a tabela com os registros. Os
--       relatórios voltam a usar o custo de hoje; os registros ficam guardados. REAPLICAR esta migration depois
--       funciona com a tabela já presente (o pré-voo aceita a tabela existente na forma certa) e os registros
--       voltam a valer. Itens nascidos entre o rollback e a reaplicação ficam sem registro (custo de hoje).
--   (b) rollback-manual-destrutivo-20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql — SÓ COM O DONO: apaga a
--       tabela e os registros. Recusa se o gatilho ou a função ainda existem (o degrau (a) vem antes) e só roda
--       com uma confirmação explícita na sessão. É um arquivo à parte de propósito.
--
-- 12. O QUE ESTA MIGRATION NÃO FAZ E O QUE FICA DECLARADO (limites conhecidos, nenhum é regressão)
--
--   * custo ERRADO congela errado: o registro é o custo que estava no produto naquele instante. Produto legado
--     com custo 0 (do `|| 0` antigo do formulário, 20261024000000) vende com custo 0 gravado e fica assim. Não há
--     "ajuste de custo" nesta migration (decisão de produto, à parte);
--   * VENDA SEM CUSTO NO DIA: produto com `custo IS NULL` no momento da venda não gera registro; o item usa o
--     custo de HOJE (como as vendas antigas). Vender sem custo cadastrado e preencher depois reescreve o lucro
--     daquele item, como sempre foi;
--   * CARGA DE DADOS: um INSERT em massa em `marketplace_order_items` (importação, restauração) dispara o gatilho
--     e grava o custo de HOJE do produto como se fosse o do dia. Carregue histórico com
--     `SET session_replication_role = replica` (o gatilho não dispara) e deixe os itens sem registro;
--   * `marketplace_order_items.product_id` é editável pelo admin (PostgREST, 20261202000000:35-44): trocar o
--     produto de um item JÁ existente não refaz o registro (o gatilho é só de INSERT). Fica como está;
--   * a DRE trata custo desconhecido como 0 (`COALESCE(..., 0)`, 20261199000000), diferente do CRM, que tira o
--     item do lucro (20261234000000). Mantido: cada relatório segue a sua regra; só a FONTE do custo muda;
--   * `cmv_estimado` da DRE deixa de ser constante: é `true` só quando algum item que entrou na conta do período
--     (venda ou devolução) NÃO tem custo do dia gravado e usou o custo de hoje. Mesma chave, mesmo tipo.
--
-- 13. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)');
--      -- esperado: dceb62881ebf8fa404ba3ac295041691.
--   2. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_dre(date,date)');
--      -- esperado: afc3e13805ce37819cfdcd094043087c.
--   3. has_table_privilege('anon'|'authenticated'|'service_role', 'public.marketplace_order_item_custo', 'SELECT') = false
--      nos três; relrowsecurity = true; nenhuma linha em pg_policy para ela.
--   4. O gatilho `tr_marketplace_order_items_guarda_o_custo_do_dia` existe, ligado (tgenabled = 'O'), AFTER INSERT por linha.
--   PROVA VIVA: tests/banco/custo-do-dia-viva.cjs (rpc-ci); portão da release: consultas 45a e 45b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261242$
DECLARE
  r record;
  v_hash text;
  v_oid oid;
  v_public boolean;
  v_tentativa integer := 0;
BEGIN
  IF to_regclass('public.marketplace_order_items') IS NULL
     OR to_regclass('public.marketplace_orders') IS NULL
     OR to_regclass('public.produtos') IS NULL
     OR to_regclass('public.devolucoes') IS NULL
     OR to_regclass('public.devolucao_itens') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta uma tabela que os corpos desta migration leem (marketplace_order_items, marketplace_orders, produtos, devolucoes, devolucao_itens) — meça a loja e revise antes de aplicar.';
  END IF;

  -- A trava vem ANTES de qualquer leitura que decida e SEM esperar na fila: ver o item 9 do cabeçalho.
  LOOP
    BEGIN
      LOCK TABLE public.marketplace_order_items IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      v_tentativa := v_tentativa + 1;
      IF v_tentativa >= 40 THEN
        RAISE EXCEPTION 'PREFLIGHT_20261242: public.marketplace_order_items ficou ocupada por mais de 4 s (uma venda em andamento) — nada foi gravado; repita a aplicação fora do horário de pico.'
          USING ERRCODE = 'lock_not_available';
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND ((c.table_name = 'marketplace_order_items' AND c.column_name IN ('id', 'order_id', 'product_id', 'quantity', 'price'))
           OR (c.table_name = 'produtos' AND c.column_name IN ('id', 'custo', 'deleted_at'))
           OR (c.table_name = 'devolucao_itens' AND c.column_name IN ('order_item_id', 'product_id', 'quantidade', 'reestocado_em')))) <> 12 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta uma coluna que os corpos desta migration leem — meça a loja e revise antes de aplicar.';
  END IF;

  -- Os dois corpos: um só overload, o corpo vigente (aplica) ou o desta migration (reaplicar reescreve o mesmo texto).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_analytics_v2(integer)', '05eac70f6bd4360c1f71fd373747ad0e', 'dceb62881ebf8fa404ba3ac295041691'),
        ('public.fin_dre(date,date)', 'e58ac49d3881a459b929064a3acb470a', 'afc3e13805ce37819cfdcd094043087c')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname = substring(r.assinatura FROM 'public\.([a-z_0-9]+)\(')) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — meça a loja e revise antes de aplicar.', r.assinatura;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    -- ACL como a de hoje (PUBLIC medido por aclexplode, grantee = 0): o CREATE OR REPLACE a preserva.
    v_public := EXISTS (SELECT 1 FROM pg_proc p
                          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
    IF v_public OR has_function_privilege('anon', v_oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC e anon sem EXECUTE, authenticated com) — meça a loja e revise.', r.assinatura;
    END IF;
  END LOOP;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.get_admin_analytics_v2(integer)')
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
          AND pg_get_function_result(p.oid) = 'json'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de get_admin_analytics_v2 (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.fin_dre(date,date)')
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de fin_dre (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.';
  END IF;

  -- A tabela nova: ausente, ou com exatamente as colunas desta migration.
  IF to_regclass('public.marketplace_order_item_custo') IS NOT NULL THEN
    IF (SELECT string_agg(c.column_name || ':' || c.data_type, ',' ORDER BY c.column_name)
          FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = 'marketplace_order_item_custo')
       IS DISTINCT FROM 'custo:numeric,item_id:uuid,registrado_em:timestamp with time zone' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_order_item_custo já existe com colunas diferentes das desta migration — revise antes de aplicar.';
    END IF;
  END IF;

  -- A função do gatilho: ausente, ou com o corpo desta migration, e sem sobrecarga.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'marketplace_order_item__guarda_o_custo_do_dia') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_order_item__guarda_o_custo_do_dia tem sobrecarga em public — revise antes de aplicar.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'marketplace_order_item__guarda_o_custo_do_dia'
                AND md5(replace(p.prosrc, E'\r', '')) <> 'b9be9cba9794deb2c1700bfbc3578454') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_order_item__guarda_o_custo_do_dia já existe com um corpo que não é o desta migration — revise antes de aplicar.';
  END IF;

  -- O gatilho: ausente, ou apontando para a função desta migration.
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.marketplace_order_items'::regclass
                AND t.tgname = 'tr_marketplace_order_items_guarda_o_custo_do_dia'
                AND NOT t.tgisinternal
                AND t.tgfoid IS DISTINCT FROM to_regprocedure('public.marketplace_order_item__guarda_o_custo_do_dia()')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_marketplace_order_items_guarda_o_custo_do_dia já existe apontando para outra função — revise antes de aplicar.';
  END IF;
END $preflight_20261242$;

-- ---------------------------------------------------------------------------
-- 1. O custo do dia: tabela SEPARADA, só do servidor
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_order_item_custo (
  item_id uuid PRIMARY KEY REFERENCES public.marketplace_order_items (id) ON DELETE CASCADE,
  custo numeric NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketplace_order_item_custo IS
  'O custo que o produto tinha NO DIA da venda de cada item de pedido (copiado de produtos.custo quando o item nasce, pelo gatilho tr_marketplace_order_items_guarda_o_custo_do_dia). SÓ do servidor: nenhum papel de API lê ou escreve (o custo é do lojista; a cliente lê os itens do próprio pedido, por isso o custo NÃO mora em marketplace_order_items). Item sem linha aqui (venda de antes desta tabela, ou produto sem custo no dia) usa o custo de hoje do produto nos relatórios. 20261242000000.';

ALTER TABLE public.marketplace_order_item_custo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketplace_order_item_custo FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. O gatilho que guarda o custo do dia — e que NUNCA derruba a compra
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_order_item__guarda_o_custo_do_dia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $guarda_o_custo_do_dia$
BEGIN
  -- Copia o custo de hoje do produto para o item que acabou de nascer (20261242000000). Produto sem custo
  -- (NULL) não grava nada: o item usa o custo de hoje nos relatórios. Custo 0 é zero medido e é gravado.
  -- O bloco interno é a garantia de que ESTE gatilho nunca aborta a compra: qualquer falha vira aviso (só o
  -- SQLSTATE e o id do item, nunca o valor) e o item fica sem registro, que é o estado de sempre das vendas antigas.
  -- Item sem produto: nada a copiar, e nenhuma subtransação aberta (ver o item 4 do cabeçalho).
  IF NEW.product_id IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO public.marketplace_order_item_custo (item_id, custo)
    SELECT NEW.id, p.custo
      FROM public.produtos p
     WHERE p.id = NEW.product_id
       AND p.custo IS NOT NULL
    ON CONFLICT (item_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'marketplace_order_item__guarda_o_custo_do_dia: o item % ficou sem o custo do dia (SQLSTATE %).', NEW.id, SQLSTATE;
  END;
  RETURN NULL;
END;
$guarda_o_custo_do_dia$;

REVOKE ALL ON FUNCTION public.marketplace_order_item__guarda_o_custo_do_dia() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_marketplace_order_items_guarda_o_custo_do_dia ON public.marketplace_order_items;
CREATE TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia
AFTER INSERT ON public.marketplace_order_items
FOR EACH ROW
EXECUTE FUNCTION public.marketplace_order_item__guarda_o_custo_do_dia();

-- ---------------------------------------------------------------------------
-- 3. get_admin_analytics_v2: corpo vigente da 20261234000000, com o custo do dia da venda
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    result json;
    active_users_count int;
    low_stock_count int;

    -- Today stats
    today_revenue numeric;
    today_count bigint;
    today_pending bigint;
    yesterday_revenue numeric;
    yesterday_count bigint;
    today_rev_trend numeric;
    today_count_trend numeric;

    -- month stats (rolling 30 days)
    month_revenue numeric;
    month_count bigint;
    prev_month_revenue numeric;
    prev_month_count bigint;
    month_rev_trend numeric;
    month_count_trend numeric;

    -- executive stats (all-time)
    total_rev numeric;
    total_ord bigint;

    -- avg ticket (all-time)
    avg_ticket numeric;

    -- active customers (all-time)
    active_customers bigint;

    -- inventory values
    inv_cost_total numeric;
    inv_value_total numeric;

    -- lists
    rev_history json;
    top_prods json;

    -- dinheiro reconhecido: pedido concluído e cobrança paga fora do prazo,
    -- mesmo com o pedido cancelado (achados 2 e 3, 22/08/2026)
    delivered_total bigint;
    paid_on_cancelled bigint;

    -- produtos vendidos SEM custo cadastrado: ficam fora do lucro e do top 5 (20261234000000)
    products_without_cost bigint;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Today vs Yesterday (Same period)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', (now() - interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    today_rev_trend := CASE WHEN yesterday_revenue > 0 THEN ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100 ELSE (CASE WHEN today_revenue > 0 THEN 100 ELSE 0 END) END;
    today_count_trend := CASE WHEN yesterday_count > 0 THEN ((today_count::numeric - yesterday_count::numeric) / yesterday_count::numeric) * 100 ELSE (CASE WHEN today_count > 0 THEN 100 ELSE 0 END) END;

    SELECT COUNT(*) INTO today_pending
    FROM public.marketplace_orders
    WHERE status in ('pending', 'new', 'processing');

    -- 2. month vs Previous Month (Rolling 30 Days)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_month_revenue, prev_month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    month_rev_trend := CASE WHEN prev_month_revenue > 0 THEN ((month_revenue - prev_month_revenue) / prev_month_revenue) * 100 ELSE (CASE WHEN month_revenue > 0 THEN 100 ELSE 0 END) END;
    month_count_trend := CASE WHEN prev_month_count > 0 THEN ((month_count::numeric - prev_month_count::numeric) / prev_month_count::numeric) * 100 ELSE (CASE WHEN month_count > 0 THEN 100 ELSE 0 END) END;

    -- 3. Executive Metrics (All-time total metrics)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    -- Estoque efetivo: soma dos `stock_increment` das variantes ATIVAS
    -- quando existe ao menos uma variante ativa; senão a coluna
    -- `produtos.estoque` crua. É a MESMA regra de src/lib/mappers.ts:98-107
    -- (mapProductFromDB), que o cartão do produto, o formulário e a loja já
    -- usam — antes esta função lia a coluna crua e divergia (achado 13,
    -- 20/08/2026). Calculada uma única vez e usada nos dois agregados
    -- abaixo (estoque baixo, custo/valor de estoque).
    WITH estoque_efetivo AS (
        SELECT
            p.custo,
            p.preco_venda,
            p.estoque_minimo,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                ELSE p.estoque
            END AS estoque
        FROM public.produtos p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE pv.active) AS qtd_ativas,
                SUM(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas
            FROM public.product_variants pv
            WHERE pv.product_id = p.id
        ) v ON true
        WHERE p.deleted_at IS NULL AND p.ativo = true
    )
    SELECT
        COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),
        COALESCE(SUM(custo * estoque), 0),
        -- Só produto COM custo: sem custo, a venda inteira contava como lucro em "Lucro se vender tudo" (20261214000000).
        COALESCE(SUM(preco_venda * estoque) FILTER (WHERE custo IS NOT NULL), 0)
    INTO low_stock_count, inv_cost_total, inv_value_total
    FROM estoque_efetivo;

    -- 4. Revenue, Orders, Profit & Cost History (Filtered by p_limit_days for performance)
    -- This scans only within the required range using the created_at index or created_at::date expression index
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        WITH days AS (
            SELECT generate_series(
                ((now() AT TIME ZONE 'America/Sao_Paulo')
                - (p_limit_days || ' days')::interval)::date,
                (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                interval '1 day'
            )::date AS day
        ),
        daily_orders AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                COALESCE(SUM(o.total), 0) AS revenue,
                COUNT(o.id)::int as orders
            FROM public.marketplace_orders o
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY ((o.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        ),
        daily_items AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                -- Lucro só dos itens com custo conhecido (custo IS NOT NULL; custo 0 é zero medido e conta): sem custo, a venda inteira virava lucro (20261234000000).
                -- O custo de cada item é o do DIA da venda (marketplace_order_item_custo, 20261242000000); venda sem registro usa o custo de hoje do produto.
                COALESCE(SUM(oi.quantity * (oi.price - COALESCE(oic.custo, p.custo))) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit,
                COALESCE(SUM(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0) AS cost_sold
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON oi.order_id = o.id
            JOIN public.produtos p ON oi.product_id = p.id
            LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY ((o.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        )
        SELECT
            TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
            TO_CHAR(d.day, 'DD/MM') AS full_date,
            COALESCE(dor.revenue, 0) AS revenue,
            COALESCE(dor.orders, 0) AS orders,
            COALESCE(dit.profit, 0) AS profit,
            COALESCE(dit.cost_sold, 0) AS cost_sold
        FROM days d
        LEFT JOIN daily_orders dor ON d.day = dor.day
        LEFT JOIN daily_items dit ON d.day = dit.day
        ORDER BY d.day ASC
    ) h;

    -- 5. Top Products (All time)
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        SELECT
            p.id as id,
            p.nome AS name,
            SUM(oi.quantity)::int as quantity,
            SUM(oi.quantity * (oi.price - COALESCE(oic.custo, p.custo))) as total,
            COALESCE(p.imagem_url, '') as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
        AND p.deleted_at IS NULL
        -- Só item com custo conhecido (o do dia da venda, ou o de hoje do produto): sem custo o ranking de LUCRO empatava com a receita (20261234000000, 20261242000000).
        AND COALESCE(oic.custo, p.custo) IS NOT NULL
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

    -- 5b. Produtos vendidos (mesma regra de venda do top 5) que ficaram FORA do lucro por não terem custo (20261234000000): venda sem custo do dia e produto sem custo hoje (20261242000000).
    SELECT COUNT(DISTINCT p.id)
    INTO products_without_cost
    FROM public.produtos p
    JOIN public.marketplace_order_items oi ON p.id = oi.product_id
    JOIN public.marketplace_orders o ON oi.order_id = o.id
    LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
    WHERE o.status NOT IN ('cancelled', 'returned')
    AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
    AND p.deleted_at IS NULL
    AND COALESCE(oic.custo, p.custo) IS NULL;

    -- 6. Dinheiro reconhecido fora da regra de status (achados 2 e 3)
    SELECT COUNT(*) INTO delivered_total
    FROM public.marketplace_orders
    WHERE status = 'delivered';

    SELECT COUNT(*) INTO paid_on_cancelled
    FROM public.marketplace_orders
    WHERE payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled';

    -- BUILD FINAL OBJECT (Matching DashboardStats interface 100%)
    result := json_build_object(
        'today', json_build_object(
            'revenue', today_revenue,
            'count', today_count,
            'pending', today_pending,
            'revenueTrend', round(today_rev_trend, 1),
            'countTrend', round(today_count_trend, 1)
        ),
        'month', json_build_object(
            'revenue', month_revenue,
            'count', month_count,
            'revenueTrend', round(month_rev_trend, 1),
            'countTrend', round(month_count_trend, 1)
        ),
        'executive', json_build_object(
            'totalRevenue', total_rev,
            'totalOrders', total_ord,
            'revenueTrend', 0,
            'ordersTrend', 0,
            'avgTicket', round(avg_ticket, 2),
            'avgTicketTrend', 0,
            'activeCustomers', active_customers,
            'activeCustomersTrend', 0
        ),
        'revenueHistory', COALESCE(rev_history, '[]'::json),
        'topProducts', COALESCE(top_prods, '[]'::json),
        'inventoryAlerts', low_stock_count,
        'growth', round(month_rev_trend, 1),
        'inventory', json_build_object(
            'totalCost', inv_cost_total,
            'totalValue', inv_value_total
        ),
        'averageTicket', round(avg_ticket, 2),
        'deliveredTotal', delivered_total,
        'paidOnCancelled', paid_on_cancelled,
        'productsWithoutCost', products_without_cost
    );

    RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. fin_dre: corpo vigente da 20261199000000, com o custo do dia da venda
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fin_dre(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_online numeric;
  v_balcao numeric;
  v_outras_receitas numeric;
  v_ded_derivadas numeric;
  v_ded_manuais numeric;
  v_deducoes numeric;
  v_cmv numeric;
  v_cmv_volta numeric;
  v_cmv_estimado boolean;
  v_variaveis numeric;
  v_fixas numeric;
  v_financeiro numeric;
  v_bruta numeric;
  v_liquida numeric;
  v_lucro_bruto numeric;
  v_margem numeric;
  v_operacional numeric;
  v_linhas_manuais jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;

  -- Competência: derivados pela data do dinheiro; manuais pela competência,
  -- previstos inclusive (a despesa do mês pesa no mês, paga ou não). Estorno
  -- pendente ainda não é dedução. Uma consulta só (sem tabela temporária: a
  -- função roda também em transação só-leitura).
  WITH mov AS (
    SELECT * FROM public.fin__movimentos(NULL, NULL) m
     WHERE m.data_competencia BETWEEN p_inicio AND p_fim
       AND (m.status = 'realizado' OR (m.status = 'previsto' AND m.origem <> 'estorno'))
  ), manuais AS (
    SELECT m.tipo, m.valor, c.grupo_dre, c.nome
      FROM mov m JOIN public.fin_categorias c ON c.id = m.categoria_id
     WHERE m.origem IN ('manual', 'ajuste_caixa') AND m.tipo <> 'transferencia'
  )
  SELECT
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('venda_online', 'venda_entrega')),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem = 'venda_balcao'),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('estorno', 'estorno_externo', 'devolucao')),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'entrada' AND grupo_dre = 'receita'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'deducao'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'custo_variavel'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'despesa_fixa'),
    (SELECT COALESCE(sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)
       FROM manuais WHERE grupo_dre = 'financeiro'),
    -- CMV pelo custo do DIA da venda (marketplace_order_item_custo,
    -- 20261242000000); a venda de antes dela, sem registro, segue estimada pelo
    -- custo ATUAL do produto. Menos o que voltou para a prateleira por
    -- devolução no período. Achado K, refinado pelo achado 4 (rodada 2): a exclusão não é
    -- "stock_returned_at preenchido" sozinho — a política P1 (pago após
    -- expirar, HONRAR) deixa esse carimbo em pedido que foi reativado e
    -- ENTREGUE de verdade (não é mais cancelamento nenhum, e o produto SAIU
    -- da loja outra vez, com custo real). Só CANCELADO com estoque já de
    -- volta é que não custou nada; por isso a condição junta as duas coisas.
    (SELECT COALESCE(sum(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0)
       FROM mov m
       JOIN public.marketplace_orders o2 ON o2.id = m.pedido_id
       JOIN public.marketplace_order_items oi ON oi.order_id = m.pedido_id
       LEFT JOIN public.produtos p ON p.id = oi.product_id
       LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
      WHERE m.origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
        AND NOT (o2.status = 'cancelled' AND o2.stock_returned_at IS NOT NULL)),
    -- Achado 5 (rodada 2): o desconto de devolução PARCIAL não pode contar de
    -- novo o item de um pedido que a linha acima JÁ excluiu inteiro (cancelado
    -- + estoque de volta) — sem este filtro, o mesmo item saía do CMV duas
    -- vezes (uma pela exclusão do pedido inteiro, outra por este desconto) e
    -- comia o custo de OUTRAS vendas do período.
    -- A devolução volta pelo MESMO custo com que a venda saiu (o do dia, se
    -- houver registro do item vendido; senão o de hoje do produto).
    (SELECT COALESCE(sum(di.quantidade * COALESCE(oic.custo, p.custo, 0)), 0)
       FROM public.devolucao_itens di
       JOIN public.devolucoes d3 ON d3.id = di.devolucao_id
       JOIN public.marketplace_orders o3 ON o3.id = d3.order_id
       LEFT JOIN public.produtos p ON p.id = di.product_id
       LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = di.order_item_id
      WHERE di.reestocado_em IS NOT NULL
        AND public.fin__dia(di.reestocado_em) BETWEEN p_inicio AND p_fim
        AND NOT (o3.status = 'cancelled' AND o3.stock_returned_at IS NOT NULL)),
    -- 'cmv_estimado': true so se algum item que entrou na conta acima (venda ou devolucao do periodo) NAO tem o
    -- custo do dia gravado e usou o custo de HOJE do produto (20261242000000); antes era sempre true.
    (SELECT EXISTS (SELECT 1
                      FROM mov m
                      JOIN public.marketplace_orders o2 ON o2.id = m.pedido_id
                      JOIN public.marketplace_order_items oi ON oi.order_id = m.pedido_id
                      LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
                     WHERE m.origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
                       AND NOT (o2.status = 'cancelled' AND o2.stock_returned_at IS NOT NULL)
                       AND oic.item_id IS NULL)
         OR EXISTS (SELECT 1
                      FROM public.devolucao_itens di
                      JOIN public.devolucoes d3 ON d3.id = di.devolucao_id
                      JOIN public.marketplace_orders o3 ON o3.id = d3.order_id
                      LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = di.order_item_id
                     WHERE di.reestocado_em IS NOT NULL
                       AND public.fin__dia(di.reestocado_em) BETWEEN p_inicio AND p_fim
                       AND NOT (o3.status = 'cancelled' AND o3.stock_returned_at IS NOT NULL)
                       AND oic.item_id IS NULL)),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo', g.grupo_dre, 'categoria', g.nome, 'valor', g.total)
                               ORDER BY g.ordem, g.total DESC), '[]'::jsonb)
       FROM (SELECT grupo_dre, nome, sum(valor) AS total,
                    CASE grupo_dre WHEN 'receita' THEN 1 WHEN 'deducao' THEN 2 WHEN 'custo_variavel' THEN 4
                                   WHEN 'despesa_fixa' THEN 5 ELSE 6 END AS ordem
               FROM manuais WHERE grupo_dre <> 'fora_dre'
              GROUP BY grupo_dre, nome) g)
    INTO v_online, v_balcao, v_ded_derivadas, v_outras_receitas, v_ded_manuais,
         v_variaveis, v_fixas, v_financeiro, v_cmv, v_cmv_volta, v_cmv_estimado, v_linhas_manuais;

  v_cmv := GREATEST(v_cmv - v_cmv_volta, 0);
  v_deducoes := v_ded_derivadas + v_ded_manuais;
  v_bruta := v_online + v_balcao + v_outras_receitas;
  v_liquida := v_bruta - v_deducoes;
  v_lucro_bruto := v_liquida - v_cmv;
  v_margem := v_lucro_bruto - v_variaveis;
  v_operacional := v_margem - v_fixas;

  RETURN jsonb_build_object(
    'receita_bruta', v_bruta,
    'receita_online', v_online,
    'receita_balcao', v_balcao,
    'deducoes', v_deducoes,
    'receita_liquida', v_liquida,
    'cmv', v_cmv,
    'cmv_estimado', v_cmv_estimado,
    'lucro_bruto', v_lucro_bruto,
    'custos_variaveis', v_variaveis,
    'margem_contribuicao', v_margem,
    'despesas_fixas', v_fixas,
    'resultado_operacional', v_operacional,
    'resultado_financeiro', v_financeiro,
    'lucro_liquido', v_operacional + v_financeiro,
    'linhas',
      (SELECT COALESCE(jsonb_agg(l - 'ordem' ORDER BY (l ->> 'ordem')::int), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas pelo app', 'valor', v_online, 'ordem', 1) AS l
          WHERE v_online > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas na loja física', 'valor', v_balcao, 'ordem', 1)
          WHERE v_balcao > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'deducao', 'categoria', 'Estornos e devoluções', 'valor', v_ded_derivadas, 'ordem', 2)
          WHERE v_ded_derivadas > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'cmv', 'categoria', 'Custo das mercadorias vendidas', 'valor', v_cmv, 'ordem', 3)
          WHERE v_cmv > 0
       ) x) || v_linhas_manuais
  );
END;
$$;

-- CONFERÊNCIA no instante do apply: aborta (e desfaz TUDO) se algum corpo vivo não é o novo, se algum
-- atributo mudou, se a ACL ficou aberta, se a tabela não é só do servidor ou se o gatilho não está ligado.
DO $conferencia_20261242$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_analytics_v2(integer)', 'dceb62881ebf8fa404ba3ac295041691'),
        ('public.fin_dre(date,date)', 'afc3e13805ce37819cfdcd094043087c'),
        ('public.marketplace_order_item__guarda_o_custo_do_dia()', 'b9be9cba9794deb2c1700bfbc3578454')
      ) AS esperado(assinatura, hash_desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'conferencia 20261242: % sumiu', r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname = substring(r.assinatura FROM 'public\.([a-z_0-9]+)\(')) <> 1 THEN
      RAISE EXCEPTION 'conferencia 20261242: % ficou com sobrecarga', r.assinatura;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'conferencia 20261242: corpo vivo de % (hash %) não é o desta migration', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
       OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261242: % alcançável por PUBLIC ou anon', r.assinatura;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', to_regprocedure('public.get_admin_analytics_v2(integer)'), 'EXECUTE')
     OR NOT has_function_privilege('authenticated', to_regprocedure('public.fin_dre(date,date)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261242: authenticated perdeu EXECUTE em get_admin_analytics_v2 ou fin_dre';
  END IF;
  -- A função do gatilho: fechada a todo papel de API (o gatilho dispara sem checar EXECUTE).
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = to_regprocedure('public.marketplace_order_item__guarda_o_custo_do_dia()')
                AND g.privilege_type = 'EXECUTE' AND (g.grantee = 0 OR g.grantee IN (SELECT pr.oid FROM pg_roles pr WHERE pr.rolname IN ('anon', 'authenticated', 'service_role')))) THEN
    RAISE EXCEPTION 'conferencia 20261242: a função do gatilho tem de ficar fechada a PUBLIC, anon, authenticated e service_role';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.get_admin_analytics_v2(integer)')
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
          AND pg_get_function_result(p.oid) = 'json'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261242: atributos de get_admin_analytics_v2 mudaram';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.fin_dre(date,date)')
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261242: atributos de fin_dre mudaram';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.marketplace_order_item__guarda_o_custo_do_dia()')
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'trigger'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261242: atributos da função do gatilho não são os do desenho';
  END IF;

  -- A tabela: só do servidor (RLS ligada, nenhuma política, nenhum acesso de papel de API) e com as 3 colunas.
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.marketplace_order_item_custo'::regclass AND c.relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.marketplace_order_item_custo'::regclass)
     OR has_table_privilege('anon', 'public.marketplace_order_item_custo', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.marketplace_order_item_custo', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('service_role', 'public.marketplace_order_item_custo', 'SELECT, INSERT, UPDATE, DELETE')
     OR EXISTS (SELECT 1 FROM pg_class c
                  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = 'public.marketplace_order_item_custo'::regclass AND (g.grantee = 0 OR g.grantee IN (SELECT pr.oid FROM pg_roles pr WHERE pr.rolname IN ('anon', 'authenticated', 'service_role')))) THEN
    RAISE EXCEPTION 'conferencia 20261242: marketplace_order_item_custo tem de ter RLS ligada, nenhuma política e nenhum privilégio para PUBLIC, anon, authenticated ou service_role';
  END IF;
  -- FORCE RLS fica DESLIGADO de propósito: com ele o INSERT do gatilho (dono do banco) falharia em silêncio.
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.marketplace_order_item_custo'::regclass AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'conferencia 20261242: marketplace_order_item_custo não pode ter FORCE ROW LEVEL SECURITY (o gatilho não gravaria)';
  END IF;
  IF (SELECT string_agg(c.column_name || ':' || c.data_type, ',' ORDER BY c.column_name)
        FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'marketplace_order_item_custo')
     IS DISTINCT FROM 'custo:numeric,item_id:uuid,registrado_em:timestamp with time zone' THEN
    RAISE EXCEPTION 'conferencia 20261242: as colunas de marketplace_order_item_custo não são as do desenho';
  END IF;

  -- O gatilho: ligado, AFTER INSERT por linha, apontando para a função.
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.marketplace_order_items'::regclass
          AND t.tgname = 'tr_marketplace_order_items_guarda_o_custo_do_dia'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgtype = 5
          AND t.tgfoid = to_regprocedure('public.marketplace_order_item__guarda_o_custo_do_dia()')
     ) THEN
    RAISE EXCEPTION 'conferencia 20261242: o gatilho tr_marketplace_order_items_guarda_o_custo_do_dia não existe, está desligado ou não é AFTER INSERT por linha';
  END IF;
END $conferencia_20261242$;

-- ============================================================================
-- Migration 20261399500000 — as estrelas do produto aparecem na vitrine
-- (dado público de catálogo; rodada 13 do modo autônomo, 05/11/2026; lote 121)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
-- O cartão de produto (ProductCard e PremiumOffers) só desenha as estrelas quando `produtos.review_count > 0`
-- (src/components/ui/custom/ProductCard.tsx e PremiumOffers.tsx; src/lib/mappers.ts lê `rating` e `review_count`
-- da linha de `produtos`). Só que NADA no banco preenche essas duas colunas: `rating` nasce com DEFAULT 5 e
-- `review_count` com DEFAULT 0 (baseline 20260806000000) e nenhum gatilho, RPC ou função escreve nelas. Medido no
-- repositório: os gatilhos de `reviews` (o do selo `verified` e o que limpa a resposta forjada) só escrevem na própria
-- avaliação, e as RPCs de avaliar, aprovar, excluir e responder não tocam em `produtos`. Resultado: com 50 avaliações publicadas o cartão continua
-- sem estrela nenhuma; só a tela de detalhe mostra a nota, porque ela calcula da lista de avaliações que baixa
-- (src/views/customer/ProductView.tsx, `avaliacoesPublicadas`). Quem sente: a cliente que navega pela lista, busca
-- ou "você também pode gostar" e nunca vê a nota que a loja ganhou.
--
-- 2. O QUE MUDA (só objeto NOVO; nenhum objeto existente é alterado)
--
--   * função NOVA `public.avaliacao_atualiza_a_nota_do_produto()` (RETURNS trigger, SECURITY DEFINER,
--     `search_path = public`, `lock_timeout = 500ms`), fechada a todos os papéis de aplicação;
--   * gatilho NOVO `tr_avaliacao_atualiza_a_nota_do_produto` em `public.reviews`: AFTER INSERT OR DELETE OR
--     UPDATE OF status, rating, product_id, por linha.
--
-- O QUE O GATILHO FAZ: depois de uma avaliação entrar, sair, mudar de nota, mudar de status ou trocar de produto,
-- RECALCULA DO ZERO, para cada produto afetado, as duas colunas a partir das avaliações com `status = 'publicada'`
-- (o mesmo critério da vitrine `vw_reviews_public` e da policy `reviews_select_policy`):
--     review_count := quantidade de avaliações publicadas do produto
--     rating       := média das notas publicadas, 1 casa decimal (round(avg, 1)); sem nenhuma publicada, 5 (o DEFAULT
--                     da coluna, e o que o mapeador já trata como "sem avaliação": o cartão esconde as estrelas com
--                     review_count = 0)
-- Avaliação PENDENTE não conta (nem ao nascer, nem ao ser excluída). Aprovar (pendente -> publicada) conta; despublicar
-- ou excluir (publicada -> fora) descontam. Só a coluna `produtos.ultima_atualizacao` ganha efeito colateral: o
-- gatilho BEFORE UPDATE que já existe (`set_ultima_atualizacao`, 20261012000000) a renova, e é isso mesmo que se
-- quer — a vitrine percebe que o produto mudou e rebusca a nota nova. O UPDATE só acontece quando o valor MUDA.
--
-- 3. POR QUE RECALCULAR DO ZERO (e não somar/subtrair)
--
-- Contador incremental (+1 ao inserir, -1 ao excluir) herda qualquer erro anterior para sempre e erra na corrida.
-- Recalcular do conjunto publicado faz o resultado depender só das avaliações que existem, nunca do histórico de
-- eventos: um produto que hoje tem 0 em `review_count` e 12 avaliações publicadas fica CERTO na próxima avaliação
-- publicada, editada ou excluída dele (ver item 5).
--
-- 4. CONCORRÊNCIA E ORDEM DE TRAVAS (o ponto que dói)
--
-- (a) PERDA DE ATUALIZAÇÃO. Duas avaliações do mesmo produto entram ao mesmo tempo. Se cada gatilho calculasse a
--     média num `UPDATE ... SET rating = (SELECT avg ...)`, o segundo esperaria a linha do produto e, ao acordar,
--     gravaria a média calculada com a foto ANTIGA do banco (o Postgres reavalia a linha, não a subconsulta): a
--     avaliação do primeiro sumiria da conta. Por isso o gatilho TRANCA PRIMEIRO a linha do produto
--     (`SELECT ... FOR NO KEY UPDATE`, a mesma força que o UPDATE tomaria) e SÓ DEPOIS lê as avaliações, em
--     instrução separada, que no READ COMMITTED (o modo do PostgREST) enxerga tudo o que o primeiro já confirmou.
--     Provado em duas conexões reais com COMMIT na prova viva (e o mutante sem a trava perde a contagem).
-- (b) ORDEM. A compra tranca, numa ordem global, as variações do carrinho por id e depois os produtos por id
--     (20261350000000/20261384000000; devolver_estoque na 20261389100000; admin_devolucao_concluir na
--     20261395200000). Este gatilho tranca UMA coisa só em `produtos` (os produtos afetados, por id) e nenhuma
--     variação, e roda com a linha da avaliação já em mãos. Quando a avaliação troca de produto, as DUAS linhas de
--     produto são travadas num único SELECT ... ORDER BY id (a mesma regra global), então duas trocas cruzadas não
--     se enroscam. O UPDATE OF status, rating, product_id deixa FORA o gatilho do selo (`verified`), o voto útil
--     (`helpful`) e a resposta da loja (`merchant_reply`): essas gravações não esperam produto algum, então o
--     caminho "pedido pago -> selo nas avaliações da cliente" NÃO ganhou aresta nova.
-- (c) NUNCA DERRUBA QUEM ESTÁ AO LADO. O único cruzamento possível é uma moderação de avaliação (que tem a linha da
--     avaliação) esperando um produto que uma compra em andamento segura, enquanto essa compra espera a mesma linha
--     de avaliação. O Postgres desfaz deadlock depois de `deadlock_timeout` (1 s) derrubando QUEM detectou — poderia
--     ser a compra. Para isso nunca acontecer, o gatilho espera no máximo 500 ms pela linha do produto
--     (`lock_timeout` na definição da função, MENOR que o `deadlock_timeout`): estourando, ele desiste, a avaliação
--     segue e quem está ao lado nunca é a vítima.
-- (d) MELHOR ESFORÇO. Todo o trabalho fica num bloco BEGIN ... EXCEPTION WHEN OTHERS: qualquer falha (trava
--     perdida por 500 ms, produto sumido, disco) vira um WARNING no log e a avaliação é gravada, aprovada, editada
--     ou excluída do mesmo jeito. O custo é uma nota que fica desatualizada até o próximo evento de avaliação do
--     produto (o recálculo é do zero, então se corrige sozinho). Perder a avaliação por causa da nota seria pior.
--
-- 5. DADOS EXISTENTES — NÃO HÁ BACKFILL AQUI (decisão registrada)
--
-- O apply NÃO lê nem escreve nenhuma linha de `produtos` nem de `reviews`: criar objeto e pronto. Um backfill
-- alteraria dado existente do catálogo (a nota que a vitrine mostra) e fica como PENDÊNCIA DO DONO, com o SQL
-- pronto e revisado em scripts/publicacao/pendente-as-estrelas-do-produto-backfill.sql.pendente (não é migration,
-- ninguém o aplica por engano). CONSEQUÊNCIA: produtos que HOJE já têm avaliações publicadas continuam sem
-- estrelas no cartão até a PRÓXIMA avaliação publicada, aprovada, editada ou excluída daquele produto (aí ele é
-- recalculado inteiro e fica certo) ou até o dono aprovar o backfill. Produtos sem nenhuma avaliação ficam como
-- estão (5 / 0), que já é o resultado certo para eles.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: `reviews` não tiver product_id (uuid), rating (integer) e status (text); `produtos` não tiver id
-- (uuid), rating (numeric) e review_count (integer); a restrição `reviews_status_check` não existir ou não citar
-- 'publicada' (o valor que o gatilho conta); existir mais de uma função com o nome novo ou uma com corpo (md5 de
-- `replace(prosrc, E'\r', '')`) diferente do desta migration; ou existir gatilho com o nome novo que NÃO seja o
-- desenhado (outra tabela, outra função, outro momento ou evento, com WHEN, outras colunas, com argumentos,
-- por comando). Estados aceitos: (a) nada do que esta migration cria existe (aplica); (b) tudo existe como
-- desenhado (reaplicar é no-op). Qualquer outro estado ABORTA sem escrever.
--
-- 7. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- `CREATE OR REPLACE FUNCTION` + `CREATE OR REPLACE TRIGGER` (sem DROP): rodar duas vezes deixa o mesmo estado.
-- Sem BEGIN/COMMIT de nível superior (regra da casa; `db-prove-rollback.cjs` recusa): quem abre a transação é o
-- aplicador (`aplicar-migrations.yml`/`db-apply.cjs`); o pré-voo, a criação e a conferência final caem juntos ou
-- não caem. ATENÇÃO — CREATE TRIGGER pega `SHARE ROW EXCLUSIVE` em `reviews`: espera qualquer transação que esteja
-- gravando avaliação naquele instante terminar, e as gravações que chegarem depois ficam na fila por instantes.
-- `lock_timeout` de 5 s: melhor FALHAR e reaplicar do que prender a vitrine. A ACL da função é fechada (REVOKE de
-- PUBLIC, anon, authenticated e service_role): gatilho não precisa de EXECUTE de quem grava (o Postgres confere
-- EXECUTE só ao CRIAR o gatilho), e a lista L8 ("função nova não nasce aberta") não ganha entrada.
--
-- 8. QUEM QUEBRA
--
-- Ninguém no app: o front já lê `rating` e `review_count` (src/lib/mappers.ts) e nada na vitrine muda de código.
-- Nenhuma edge function grava avaliação. `src/types/database.types.ts` não muda (nenhuma coluna ou assinatura nova).
-- Quem passa a ver diferença: a cliente (estrelas e contagem nos cartões, busca e recomendações, SÓ de produto que
-- receber avaliação publicada daqui em diante, ou depois do backfill) e `get_admin_*`/RPCs que repassam as duas
-- colunas. Uma coisa observável: `produtos.ultima_atualizacao` é renovada a cada mudança de nota (item 2).
--
-- 9. ORDEM E ROLLBACK
--
-- Independe das demais (usa só `reviews` e `produtos`, que existem desde o baseline, e a restrição de status da
-- 20261031000000). Banco antes ou depois do front dá no mesmo. ROLLBACK MANUAL:
-- rollback-manual-20261399500000_as_estrelas_do_produto_aparecem_na_vitrine.sql remove o gatilho e a função (os
-- dois eram novos); nada a restaurar. As notas que o gatilho já gravou em `produtos` FICAM (são dado, e estão
-- certas); sem o gatilho elas só deixam de acompanhar as avaliações novas.
--
-- PROVA VIVA: tests/banco/as-estrelas-do-produto-aparecem-na-vitrine-viva.cjs (comportamento por evento, produto
-- trocado, não publicada não conta, falha do gatilho não perde a avaliação, corrida em duas conexões, mutantes,
-- pré-voo, conferência, idempotência, rollback e as consultas 121a/121b).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399500000$
DECLARE
  v_fn CONSTANT text := 'public.avaliacao_atualiza_a_nota_do_produto()';
  v_oid oid := to_regprocedure('public.avaliacao_atualiza_a_nota_do_produto()');
  v_hash text;
  v_gat record;
BEGIN
  -- As colunas que o gatilho lê (reviews) e escreve (produtos), com os tipos de sempre.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
         AND ((a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'rating'     AND a.atttypid = 'integer'::regtype)
           OR (a.attname = 'status'     AND a.atttypid = 'text'::regtype))) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.reviews não tem product_id (uuid), rating (integer) e status (text) — meça a loja e revise antes de aplicar.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.produtos') AND NOT a.attisdropped
         AND ((a.attname = 'id'           AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'rating'       AND a.atttypid = 'numeric'::regtype)
           OR (a.attname = 'review_count' AND a.atttypid = 'integer'::regtype))) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.produtos não tem id (uuid), rating (numeric) e review_count (integer) — meça a loja e revise antes de aplicar.';
  END IF;

  -- O valor que o gatilho conta ('publicada') tem de ser um status que a tabela conhece.
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = to_regclass('public.reviews') AND c.conname = 'reviews_status_check'
          AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%publicada%'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.reviews não tem a restrição reviews_status_check citando ''publicada'' — aplique a 20261031000000 antes.';
  END IF;

  -- A função nova: ausente, ou exatamente a desta migration.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_atualiza_a_nota_do_produto') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_atualiza_a_nota_do_produto tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '469676dde2cf265cbf7b2af1df0df8ee' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % já existe com corpo desconhecido (hash %) — ninguém revisou essa redefinição; capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_atualiza_a_nota_do_produto') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_atualiza_a_nota_do_produto existe em public com outra assinatura — revise antes de aplicar.';
  END IF;

  -- O gatilho novo: ausente, ou exatamente o desenhado (AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id,
  -- por linha, sem WHEN e sem argumentos). tgtype 29 = ROW (1) + INSERT (4) + DELETE (8) + UPDATE (16), AFTER.
  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgisinternal,
           (SELECT array_agg(c ORDER BY c) FROM unnest(t.tgattr::int2[]) c) AS colunas,
           (SELECT array_agg(a.attnum ORDER BY a.attnum) FROM pg_attribute a
             WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
               AND a.attname IN ('status', 'rating', 'product_id')) AS esperadas
      FROM pg_trigger t
     WHERE t.tgname = 'tr_avaliacao_atualiza_a_nota_do_produto'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.reviews')
       OR v_gat.tgfoid IS DISTINCT FROM v_oid
       OR v_gat.tgtype <> 29
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.tgisinternal
       OR v_gat.colunas IS DISTINCT FROM v_gat.esperadas THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_avaliacao_atualiza_a_nota_do_produto que NÃO é o desenhado aqui (outra tabela, outra função, outro momento/evento, WHEN, outras colunas ou argumentos) — revise antes de aplicar.';
    END IF;
  END LOOP;
END $preflight_20261399500000$;

CREATE OR REPLACE FUNCTION public.avaliacao_atualiza_a_nota_do_produto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '500ms'
AS $function$
DECLARE
    v_produtos uuid[] := ARRAY[]::uuid[];
    v_produto uuid;
    v_total integer;
    v_nota numeric;
BEGIN
    -- Tudo num bloco de melhor esforço: a nota é um reflexo das avaliações, nunca a condição para elas existirem.
    -- Qualquer falha (a linha do produto presa por mais de 500 ms, produto sumido, disco) vira WARNING e a avaliação
    -- é gravada, aprovada, editada ou excluída do mesmo jeito; o recálculo é do zero, então o próximo evento corrige.
    BEGIN
        -- 1. Quais produtos mudam de nota. Só conta a avaliação PUBLICADA: pendente que nasce ou é excluída não mexe
        --    na média. No UPDATE, só importa se ela entrou, saiu ou mudou de nota/produto dentro do conjunto publicado.
        IF TG_OP = 'INSERT' THEN
            IF NEW.status = 'publicada' THEN
                v_produtos := ARRAY[NEW.product_id];
            END IF;
        ELSIF TG_OP = 'DELETE' THEN
            IF OLD.status = 'publicada' THEN
                v_produtos := ARRAY[OLD.product_id];
            END IF;
        ELSIF (OLD.status = 'publicada' OR NEW.status = 'publicada')
              AND (OLD.status IS DISTINCT FROM NEW.status
                   OR OLD.rating IS DISTINCT FROM NEW.rating
                   OR OLD.product_id IS DISTINCT FROM NEW.product_id) THEN
            v_produtos := ARRAY[OLD.product_id, NEW.product_id];
        END IF;
        IF cardinality(v_produtos) = 0 THEN
            RETURN NULL;
        END IF;

        -- 2. TRANCA a linha de cada produto afetado, na ordem global (por id), ANTES de ler as avaliações. Quem
        --    chega depois espera aqui e, ao acordar, lê o que o primeiro já confirmou (instrução nova no READ
        --    COMMITTED). Sem esta trava a segunda gravação calcularia com a foto antiga e apagaria a contagem da primeira.
        PERFORM 1
           FROM public.produtos p
          WHERE p.id = ANY (v_produtos)
          ORDER BY p.id
            FOR NO KEY UPDATE;

        -- 3. Recalcula do zero, produto a produto, e só grava quando o valor muda.
        FOR v_produto IN SELECT DISTINCT x FROM unnest(v_produtos) AS x ORDER BY x LOOP
            SELECT count(*)::integer, COALESCE(round(avg(r.rating), 1), 5)
              INTO v_total, v_nota
              FROM public.reviews r
             WHERE r.product_id = v_produto
               AND r.status = 'publicada';

            UPDATE public.produtos p
               SET rating = v_nota,
                   review_count = v_total
             WHERE p.id = v_produto
               AND (p.rating IS DISTINCT FROM v_nota OR p.review_count IS DISTINCT FROM v_total);
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'avaliacao_atualiza_a_nota_do_produto: a nota do(s) produto(s) % nao foi recalculada (% / %).',
            v_produtos, SQLSTATE, SQLERRM;
    END;
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.avaliacao_atualiza_a_nota_do_produto() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER tr_avaliacao_atualiza_a_nota_do_produto
AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.avaliacao_atualiza_a_nota_do_produto();

-- CONFERÊNCIA no instante do apply: aborta se a função ou o gatilho não ficaram como desenhados.
DO $conferencia_20261399500000$
DECLARE
  v_fn CONSTANT text := 'public.avaliacao_atualiza_a_nota_do_produto()';
  v_oid oid := to_regprocedure('public.avaliacao_atualiza_a_nota_do_produto()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261399500000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_atualiza_a_nota_do_produto') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261399500000: avaliacao_atualiza_a_nota_do_produto ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '469676dde2cf265cbf7b2af1df0df8ee' THEN
    RAISE EXCEPTION 'conferencia 20261399500000: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.prorettype = 'trigger'::regtype
          AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public', 'lock_timeout=500ms']::text[]
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399500000: atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, lock_timeout, retorno ou argumentos)', v_fn;
  END IF;
  -- Função de gatilho FECHADA a todos os papéis de fora (a lista L8 não ganha entrada).
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261399500000: % alcancavel por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261399500000: anon, authenticated ou service_role executa %', v_fn;
  END IF;
  -- O gatilho: um só, em public.reviews, AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id por linha,
  -- ligado (origin), sem WHEN, apontando para a função.
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tr_avaliacao_atualiza_a_nota_do_produto') <> 1
     OR NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgname = 'tr_avaliacao_atualiza_a_nota_do_produto'
             AND t.tgrelid = to_regclass('public.reviews')
             AND t.tgfoid = v_oid
             AND t.tgtype = 29
             AND t.tgenabled = 'O'
             AND t.tgqual IS NULL
             AND t.tgnargs = 0
             AND NOT t.tgisinternal
             AND (SELECT array_agg(c ORDER BY c) FROM unnest(t.tgattr::int2[]) c)
                 = (SELECT array_agg(a.attnum ORDER BY a.attnum) FROM pg_attribute a
                     WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
                       AND a.attname IN ('status', 'rating', 'product_id'))
        ) THEN
    RAISE EXCEPTION 'conferencia 20261399500000: o gatilho tr_avaliacao_atualiza_a_nota_do_produto não ficou como desenhado (um só, em public.reviews, AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id por linha, ligado, sem WHEN)';
  END IF;
END $conferencia_20261399500000$;

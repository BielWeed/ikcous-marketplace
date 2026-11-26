-- O LIVRO DE REGISTRO GUARDA A VERSAO ANTIGA (dinheiro + dado de cliente + permissao; 26/11/2026)
-- RASCUNHO PARA REVISAO OPUS. Nada foi aplicado em banco algum.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. Cria 3 tabelas, 2 indices
-- (alem das PKs), 2 funcoes, 34 gatilhos (2 em cada uma das 17 tabelas abaixo), 1 linha de configuracao e 1 tarefa agendada; nenhuma
-- funcao, politica, grant ou gatilho que ja existia e' redefinido ou removido.
--
-- PRODUTO (decidido pelo socio em 26/11/2026, plano PLANO-LIVRO-DE-REGISTRO): dentro do banco de CADA loja, antes de uma linha de 17
-- tabelas de dinheiro ser ALTERADA ou APAGADA, guardar a versao antiga por 90 dias. Nunca INSERT. Nunca derrubar a gravacao original.
-- Ninguem do app le (nem a tela, nem o PostgREST). A exclusao de conta (LGPD) apaga junto. NAO e' backup: cadastro nunca alterado,
-- fotos, contas, enderecos, carrinho e o que passou de 90 dias nao estao aqui.
--
-- AS 17 TABELAS (e de onde vem o titular, para a LGPD apagar o que e' da cliente):
--   user_id      -> marketplace_orders, devolucoes (a propria linha);
--   order_id     -> marketplace_order_items, order_refunds, marketplace_order_payment_history (o user_id do pedido);
--   devolucao_id -> devolucao_itens (o user_id da devolucao);
--   sem titular  -> produtos, product_variants, categorias, coupons, fornecedores, fin_lancamentos, fin_contas, fin_categorias,
--                   store_config, config_pagamento_cartao, politica_devolucao.
--   FORA de proposito: carrinho, visitas, eventos, favoritos, avisos, push, codigos, logs, cache de frete, enderecos, perfis, avaliacoes,
--   perguntas, notas internas, store_shipping_credentials (SEGREDO), tabelas que ja sao historico, assinatura, frota, *_tentativas,
--   banners e marketplace_order_item_custo (a chave nao e' id).
--
-- O QUE ENTRA:
--   (1) public.livro_de_registro: uma linha por linha ALTERADA (operacao 'U': em `antes`, SO as colunas que mudaram, com o valor
--       ANTIGO; UPDATE sem mudanca, ou que so mexe em updated_at/ultima_atualizacao, nao anota) ou APAGADA (operacao 'D': em `antes`,
--       a linha inteira). quem = auth.uid(); papel = o papel do comando (o SET ROLE do PostgREST, senao o usuario da sessao);
--       transacao = pg_current_xact_id(); quando = clock_timestamp(). Indices: PK, BRIN(quando) e titular (parcial). SEM FK, SEM CHECK
--       de valor e SEM indice unico alem da PK: nada no livro pode recusar a anotacao que a tabela de origem aceitou.
--   (2) public.livro_de_registro_chave (UMA linha): ligado (desliga em segundos: UPDATE ... SET ligado = false, motivo = ...),
--       teto_linhas (200000) e teto_banco_mb (400, o disjuntor). Semeada com ON CONFLICT DO NOTHING: reaplicar nao religa.
--   (3) public.livro_de_registro_falhas (dia, tabela, sqlstate, vezes, ultima): SO o codigo do erro, NUNCA a mensagem (a mensagem pode
--       carregar valor da linha).
--   (4) public.livro_de_registro_anotar(): a funcao dos 34 gatilhos. SECURITY DEFINER, search_path fixo (tudo qualificado),
--       lock_timeout de 200ms, EXECUTE de ninguem. Tudo dentro de UM bloco com EXCEPTION WHEN OTHERS (uma subtransacao por COMANDO):
--       chave desligada -> nao anota; erro -> conta em falhas (que tambem tem o proprio EXCEPTION, com RAISE WARNING) e segue. Nenhum
--       RAISE EXCEPTION. Sempre devolve NULL (AFTER): a gravacao original nunca muda nem cai por causa do livro.
--   (5) 34 gatilhos POR COMANDO: tr_livro_alteracao (AFTER UPDATE, REFERENCING OLD TABLE AS antigos NEW TABLE AS novos, FOR EACH
--       STATEMENT) e tr_livro_exclusao (AFTER DELETE, REFERENCING OLD TABLE AS antigos, FOR EACH STATEMENT), escritos tabela por
--       tabela (sem laco dinamico). POR QUE por comando e nao por linha: gatilho por linha com EXCEPTION abre UMA subtransacao por
--       linha, e mais de 64 numa transacao estoura o cache de subtransacoes do Postgres (lentidao geral); por comando e' uma
--       subtransacao e UM INSERT ... SELECT em lote, qualquer que seja o numero de linhas.
--   (6) public.livro_de_registro_limpar() (pg_cron diario 'limpar-livro-de-registro', 06:17 UTC): apaga o que passou de 90 dias em
--       lotes de 5000; corta acima de teto_linhas (as mais antigas); se o banco passou de teto_banco_mb, DESLIGA a chave com o motivo;
--       limpa falhas de mais de 90 dias. SECURITY DEFINER, search_path fixo, statement_timeout de 60s, EXECUTE de ninguem.
--   (7) NOTIFY pgrst.
--   Moram em public de proposito (as varreduras de LGPD olham public), sem grant algum e com RLS ligada sem politica (padrao de
--   visitas_por_dia/frota_segredo): anon, authenticated e service_role recebem 42501. Fora do realtime.
--
-- NUNCA NO CAMINHO DE QUEM COMPRA (e os limites, escritos): so UPDATE e DELETE anotam; erro do livro e' engolido (subtransacao); trava
-- no livro espera no maximo 200ms e vira 55P03 engolido; AFTER + RETURN NULL; sem FK. LIMITES que NAO sao engolidos: 57014
-- (statement_timeout/cancelamento) nao e' capturado por WHEN OTHERS; uma transacao com mais de 64 COMANDOS nessas tabelas ainda estoura
-- o cache de subtransacoes (SQL em massa nosso = UM comando; TRUNCATE proibido, e nao anota). OUTROS LIMITES: troca de id (PK) nao anota
-- a linha (o par antigo/novo e' casado pelo id); item/historico/devolucao_item apagados EM CASCATA junto com o pedido ou a devolucao
-- ficam sem titular (o pai ja nao e' visivel quando o gatilho do filho roda; nao guardam nome nem telefone); pedido de convidado
-- (user_id NULL) fica sem titular.
--
-- DADOS EXISTENTES: nenhuma linha das 17 tabelas e' lida para fora nem alterada. O livro nasce VAZIO (nao ha backfill: so o que for
-- alterado ou apagado DEPOIS do apply entra). A unica escrita de dado e' a linha da chave (id 1), so se ainda nao existir.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e
-- fazem COMMIT; qualquer erro, inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Logo depois do pre-voo, LOCK das 17 em
-- SHARE ROW EXCLUSIVE NOWAIT: com qualquer escrita em voo numa delas a migration FALHA NA HORA (55P03), sem enfileirar as vendas atras
-- dela; e' so rodar de novo (aplicar de madrugada). Esse lock nao segura leitura (a vitrine segue). Idempotente: IF NOT EXISTS, CREATE
-- OR REPLACE (funcoes e gatilhos), REVOKE repetivel, cron.schedule e' upsert pelo nome, chave com ON CONFLICT DO NOTHING; rodar duas
-- vezes nao erra, nao duplica linha e nao religa a chave desligada.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT, nada escrito): Postgres 14+, as 17 tabelas existem com chave primaria de UMA coluna
-- chamada id, as colunas de titular existem (uuid), cron.schedule(text,text,text) e auth.uid() existem, e cada livro_* ausente ou com a
-- MESMA forma desta migration. POS-VOO (B2_POSVOO_DIVERGENTE): RLS ligada e 0 politicas nas 3; ACL vazia fora do dono (tabelas,
-- colunas, sequencia e funcoes); os 34 gatilhos ligados (origin), por comando, com as transicoes e o argumento certos, apontando para
-- a funcao com o proconfig esperado (e nenhum outro gatilho usando a funcao); limpar com o proconfig esperado; o job agendado; a chave
-- com 1 linha; nada do livro no realtime.
--
-- DESLIGAR: na hora (segundos, sem deploy): UPDATE public.livro_de_registro_chave SET ligado = false, motivo = '...', mudado_em = now();
-- para sempre: rollback-manual-20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql (tira os 34 gatilhos e a funcao,
-- desagenda o job se existir; as tabelas ficam seladas com as linhas). rollback-manual-destrutivo-20261510000000_... apaga as tabelas
-- (so com SET LOCAL app.confirmo_apagar_livro = 'APAGAR' e o "pode" do dono). Desfazer dado PELO livro: docs/runbooks/
-- desfazer-pelo-livro-de-registro.md (todo bloco com ENSAIO; mudar dado real = "pode" do dono a cada vez).
-- TIPOS: src/types/database.types.ts nao muda (nada do front le o livro).
-- Sem BEGIN/COMMIT: o aplicador controla a transacao (com eles o ROLLBACK da prova viraria no-op e a mudanca ficaria gravada).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261510000000$
DECLARE
  v_tabela text;
  v_coluna text;
  v_forma text;
  v_esperada text;
  v_nome text;
BEGIN
  IF current_setting('server_version_num')::int < 140000 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o Postgres precisa ser 14 ou mais novo (CREATE OR REPLACE TRIGGER); este e %.',
      current_setting('server_version');
  END IF;

  FOREACH v_tabela IN ARRAY ARRAY['marketplace_orders', 'marketplace_order_items', 'order_refunds',
                                  'marketplace_order_payment_history', 'devolucoes', 'devolucao_itens', 'produtos',
                                  'product_variants', 'categorias', 'coupons', 'fornecedores', 'fin_lancamentos', 'fin_contas',
                                  'fin_categorias', 'store_config', 'config_pagamento_cartao', 'politica_devolucao'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.' || v_tabela) AND c.relkind = 'r') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a tabela public.%.', v_tabela;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint k
                    WHERE k.conrelid = to_regclass('public.' || v_tabela) AND k.contype = 'p'
                      AND array_length(k.conkey, 1) = 1
                      AND (SELECT a.attname FROM pg_attribute a
                            WHERE a.attrelid = k.conrelid AND a.attnum = k.conkey[1]) = 'id') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% nao tem chave primaria de uma coluna so chamada id.', v_tabela;
    END IF;
  END LOOP;

  FOREACH v_coluna IN ARRAY ARRAY['marketplace_orders.user_id', 'devolucoes.user_id', 'marketplace_order_items.order_id',
                                  'order_refunds.order_id', 'marketplace_order_payment_history.order_id',
                                  'devolucao_itens.devolucao_id'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || split_part(v_coluna, '.', 1))
                      AND a.attname = split_part(v_coluna, '.', 2) AND a.atttypid = 'uuid'::regtype AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a coluna uuid public.% (de onde vem o titular).', v_coluna;
    END IF;
  END LOOP;

  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta o pg_cron (cron.schedule(text,text,text) e cron.job).';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta auth.uid().';
  END IF;

  FOREACH v_nome IN ARRAY ARRAY['livro_de_registro', 'livro_de_registro_chave', 'livro_de_registro_falhas'] LOOP
    IF to_regclass('public.' || v_nome) IS NOT NULL THEN
      SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
        INTO v_forma
        FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.' || v_nome) AND a.attnum > 0 AND NOT a.attisdropped;
      v_esperada := CASE v_nome
        WHEN 'livro_de_registro' THEN
          'id:bigint:true,tabela:text:true,linha_id:text:true,titular:uuid:false,operacao:text:true,antes:jsonb:true,'
          || 'quem:uuid:false,papel:text:false,transacao:bigint:false,quando:timestamp with time zone:true'
        WHEN 'livro_de_registro_chave' THEN
          'id:smallint:true,ligado:boolean:true,teto_linhas:integer:true,teto_banco_mb:integer:true,motivo:text:false,'
          || 'mudado_em:timestamp with time zone:true'
        ELSE
          'dia:date:true,tabela:text:true,sqlstate:text:true,vezes:bigint:true,ultima:timestamp with time zone:true'
      END;
      IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.' || v_nome) AND c.relkind = 'r')
         OR v_forma IS DISTINCT FROM v_esperada THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% existe e nao tem a forma desta migration (%).', v_nome, v_forma;
      END IF;
    END IF;
  END LOOP;
END $preflight_20261510000000$;

-- ===== as 17 tabelas: nenhuma escrita em voo (falha na hora, sem fila; e' so rodar de novo) =====

LOCK TABLE public.marketplace_orders, public.marketplace_order_items, public.order_refunds, public.marketplace_order_payment_history,
  public.devolucoes, public.devolucao_itens, public.produtos, public.product_variants, public.categorias, public.coupons,
  public.fornecedores, public.fin_lancamentos, public.fin_contas, public.fin_categorias, public.store_config,
  public.config_pagamento_cartao, public.politica_devolucao IN SHARE ROW EXCLUSIVE MODE NOWAIT;

-- ===== (1) (2) (3) as tabelas =====

CREATE TABLE IF NOT EXISTS public.livro_de_registro (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tabela text NOT NULL,
  linha_id text NOT NULL,
  titular uuid,
  operacao text NOT NULL,
  antes jsonb NOT NULL,
  quem uuid,
  papel text,
  transacao bigint,
  quando timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT livro_de_registro_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS livro_de_registro_quando_brin ON public.livro_de_registro USING brin (quando);
CREATE INDEX IF NOT EXISTS livro_de_registro_titular_idx ON public.livro_de_registro (titular) WHERE titular IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.livro_de_registro_chave (
  id smallint NOT NULL DEFAULT 1,
  ligado boolean NOT NULL DEFAULT true,
  teto_linhas integer NOT NULL DEFAULT 200000,
  teto_banco_mb integer NOT NULL DEFAULT 400,
  motivo text,
  mudado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT livro_de_registro_chave_pkey PRIMARY KEY (id),
  CONSTRAINT livro_de_registro_chave_uma_linha CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS public.livro_de_registro_falhas (
  dia date NOT NULL,
  tabela text NOT NULL,
  sqlstate text NOT NULL,
  vezes bigint NOT NULL DEFAULT 1,
  ultima timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT livro_de_registro_falhas_pkey PRIMARY KEY (dia, tabela, sqlstate)
);

INSERT INTO public.livro_de_registro_chave (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.livro_de_registro IS 'Versao antiga de linhas ALTERADAS (U: so as colunas que mudaram, com o valor antigo) ou APAGADAS (D: a linha inteira) em 17 tabelas de dinheiro, por 90 dias. Escrita so pelos gatilhos tr_livro_*; ninguem do app le. Nao e backup. LGPD: DELETE ... WHERE titular = <cliente> no roteiro de exclusao de conta.';
COMMENT ON TABLE public.livro_de_registro_chave IS 'Uma linha: ligado (desliga o livro na hora), teto_linhas e teto_banco_mb (disjuntor do livro_de_registro_limpar).';
COMMENT ON TABLE public.livro_de_registro_falhas IS 'Falhas do livro por dia, tabela e SQLSTATE (so o codigo, nunca a mensagem). A gravacao original nao cai por elas.';

-- ===== quem le e quem escreve: ninguem de aplicacao =====

ALTER TABLE public.livro_de_registro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.livro_de_registro_chave ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.livro_de_registro_falhas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.livro_de_registro FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.livro_de_registro_chave FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.livro_de_registro_falhas FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.livro_de_registro_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ===== (4) a funcao dos gatilhos =====

CREATE OR REPLACE FUNCTION public.livro_de_registro_anotar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
 SET lock_timeout = '200ms'
AS $function$
DECLARE
  v_origem text := COALESCE(TG_ARGV[0], '');
  v_erro text;
BEGIN
  BEGIN
    -- A chave: desligada (ou sem a linha) = nao anota.
    IF NOT COALESCE((SELECT c.ligado FROM public.livro_de_registro_chave c WHERE c.id = 1), false) THEN
      RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- So as colunas que mudaram, com o valor ANTIGO; o par antigo/novo e' casado pelo id.
      INSERT INTO public.livro_de_registro (tabela, linha_id, titular, operacao, antes, quem, papel, transacao, quando)
      SELECT TG_TABLE_NAME, d.linha_id,
             CASE v_origem
               WHEN 'user_id' THEN (d.velha ->> 'user_id')::uuid
               WHEN 'order_id' THEN (SELECT p.user_id FROM public.marketplace_orders p WHERE p.id = (d.velha ->> 'order_id')::uuid)
               WHEN 'devolucao_id' THEN (SELECT dv.user_id FROM public.devolucoes dv WHERE dv.id = (d.velha ->> 'devolucao_id')::uuid)
             END,
             'U', d.antes, auth.uid(), COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text),
             pg_current_xact_id()::text::bigint, clock_timestamp()
        FROM (SELECT a.j ->> 'id' AS linha_id, a.j AS velha,
                     (SELECT jsonb_object_agg(k.key, k.value)
                        FROM jsonb_each(a.j) AS k
                       WHERE k.value IS DISTINCT FROM (n.j -> k.key)) AS antes
                FROM (SELECT to_jsonb(ant) AS j FROM antigos ant) AS a
                JOIN (SELECT to_jsonb(nov) AS j FROM novos nov) AS n ON (n.j -> 'id') = (a.j -> 'id')) AS d
       WHERE d.antes IS NOT NULL
         AND (d.antes - ARRAY['updated_at', 'ultima_atualizacao']) <> '{}'::jsonb;
    ELSIF TG_OP = 'DELETE' THEN
      -- A linha inteira.
      INSERT INTO public.livro_de_registro (tabela, linha_id, titular, operacao, antes, quem, papel, transacao, quando)
      SELECT TG_TABLE_NAME, a.j ->> 'id',
             CASE v_origem
               WHEN 'user_id' THEN (a.j ->> 'user_id')::uuid
               WHEN 'order_id' THEN (SELECT p.user_id FROM public.marketplace_orders p WHERE p.id = (a.j ->> 'order_id')::uuid)
               WHEN 'devolucao_id' THEN (SELECT dv.user_id FROM public.devolucoes dv WHERE dv.id = (a.j ->> 'devolucao_id')::uuid)
             END,
             'D', a.j, auth.uid(), COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text),
             pg_current_xact_id()::text::bigint, clock_timestamp()
        FROM (SELECT to_jsonb(ant) AS j FROM antigos ant) AS a;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      -- Nunca no caminho de quem compra: o erro do livro vira uma contagem e a gravacao original segue.
      v_erro := SQLSTATE;
      BEGIN
        INSERT INTO public.livro_de_registro_falhas AS f (dia, tabela, sqlstate, vezes, ultima)
        VALUES (current_date, TG_TABLE_NAME, v_erro, 1, clock_timestamp())
        ON CONFLICT ON CONSTRAINT livro_de_registro_falhas_pkey DO UPDATE SET vezes = f.vezes + 1, ultima = EXCLUDED.ultima;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING 'livro_de_registro: a anotacao de % falhou (%) e a falha nao foi contada (%).', TG_TABLE_NAME, v_erro, SQLSTATE;
      END;
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.livro_de_registro_anotar() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.livro_de_registro_anotar() IS 'Gatilho por comando das 17 tabelas do livro: anota a versao antiga de UPDATE (so o que mudou) e DELETE (a linha inteira). Engole o proprio erro (conta em livro_de_registro_falhas) e espera trava no maximo 200ms.';

-- ===== (6) a limpeza =====

CREATE OR REPLACE FUNCTION public.livro_de_registro_limpar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
 SET statement_timeout = '60s'
AS $function$
DECLARE
  v_teto_linhas integer;
  v_teto_mb integer;
  v_lote bigint;
  v_velhas bigint := 0;
  v_cortadas bigint := 0;
  v_excesso bigint;
  v_falhas bigint;
  v_banco_mb bigint;
  v_desligou boolean := false;
BEGIN
  SELECT c.teto_linhas, c.teto_banco_mb INTO v_teto_linhas, v_teto_mb
    FROM public.livro_de_registro_chave c WHERE c.id = 1;

  -- O que passou do prazo, em lotes de 5000.
  LOOP
    DELETE FROM public.livro_de_registro l
     WHERE l.id IN (SELECT v.id FROM public.livro_de_registro v
                     WHERE v.quando < clock_timestamp() - interval '90 days'
                     ORDER BY v.id LIMIT 5000);
    GET DIAGNOSTICS v_lote = ROW_COUNT;
    v_velhas := v_velhas + v_lote;
    EXIT WHEN v_lote < 5000;
  END LOOP;

  -- Teto de linhas: corta as mais antigas (menor id).
  IF v_teto_linhas IS NOT NULL THEN
    SELECT count(*) - v_teto_linhas INTO v_excesso FROM public.livro_de_registro;
    WHILE v_excesso > 0 LOOP
      DELETE FROM public.livro_de_registro l
       WHERE l.id IN (SELECT v.id FROM public.livro_de_registro v ORDER BY v.id LIMIT LEAST(v_excesso, 5000));
      GET DIAGNOSTICS v_lote = ROW_COUNT;
      v_cortadas := v_cortadas + v_lote;
      v_excesso := v_excesso - v_lote;
      EXIT WHEN v_lote = 0;
    END LOOP;
  END IF;

  -- Disjuntor: banco acima do teto desliga o livro (quem religa e' gente, depois de olhar).
  v_banco_mb := pg_database_size(current_database()) / (1024 * 1024);
  IF v_teto_mb IS NOT NULL AND v_banco_mb > v_teto_mb THEN
    UPDATE public.livro_de_registro_chave c
       SET ligado = false,
           motivo = format('disjuntor: o banco tem %s MB, acima do teto de %s MB', v_banco_mb, v_teto_mb),
           mudado_em = clock_timestamp()
     WHERE c.id = 1 AND c.ligado;
    v_desligou := FOUND;
  END IF;

  DELETE FROM public.livro_de_registro_falhas f WHERE f.dia < current_date - 90;
  GET DIAGNOSTICS v_falhas = ROW_COUNT;

  RETURN jsonb_build_object('velhas', v_velhas, 'cortadas', v_cortadas, 'falhas', v_falhas, 'banco_mb', v_banco_mb,
                            'desligou', v_desligou);
END;
$function$;

REVOKE ALL ON FUNCTION public.livro_de_registro_limpar() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.livro_de_registro_limpar() IS 'Job diario limpar-livro-de-registro: apaga o que passou de 90 dias (lotes de 5000), corta acima de teto_linhas, desliga a chave se o banco passou de teto_banco_mb e limpa falhas antigas.';

-- ===== (5) os 34 gatilhos, tabela por tabela =====
-- CREATE OR REPLACE TRIGGER (PG14+), nao DROP + CREATE: o DROP TRIGGER pegaria ACCESS EXCLUSIVE (bloquearia leitura); o OR REPLACE so
-- pega SHARE ROW EXCLUSIVE, que o LOCK acima ja segura.

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.marketplace_orders
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('user_id');
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.marketplace_orders
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('user_id');

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.marketplace_order_items
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('order_id');
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.marketplace_order_items
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('order_id');

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.order_refunds
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('order_id');
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.order_refunds
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('order_id');

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.marketplace_order_payment_history
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('order_id');
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.marketplace_order_payment_history
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('order_id');

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.devolucoes
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('user_id');
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.devolucoes
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('user_id');

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.devolucao_itens
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('devolucao_id');
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.devolucao_itens
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('devolucao_id');

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.produtos
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.produtos
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.product_variants
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.product_variants
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.categorias
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.categorias
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.coupons
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.coupons
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.fornecedores
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.fornecedores
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.fin_lancamentos
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.fin_lancamentos
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.fin_contas
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.fin_contas
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.fin_categorias
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.fin_categorias
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.store_config
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.store_config
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.config_pagamento_cartao
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.config_pagamento_cartao
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

CREATE OR REPLACE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.politica_devolucao
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();
CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.politica_devolucao
  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();

-- ===== (6) a agenda (upsert pelo nome: reaplicar nao duplica) =====

SELECT cron.schedule('limpar-livro-de-registro', '17 6 * * *', 'SELECT public.livro_de_registro_limpar()');

-- ===== pos-voo =====

DO $posvoo_20261510000000$
DECLARE
  v_nome text;
  v_rel regclass;
  v_anotar oid := to_regprocedure('public.livro_de_registro_anotar()');
  v_limpar oid := to_regprocedure('public.livro_de_registro_limpar()');
  v_esperados integer;
BEGIN
  FOREACH v_nome IN ARRAY ARRAY['livro_de_registro', 'livro_de_registro_chave', 'livro_de_registro_falhas'] LOOP
    v_rel := to_regclass('public.' || v_nome);
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_rel AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: a RLS de % nao ficou ligada.', v_nome;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_rel) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem politica (o livro nao tem porta nenhuma).', v_nome;
    END IF;
    -- Os quatro papeis (PUBLIC, anon, authenticated, service_role): nada de tabela nem de coluna, nem por heranca de papel.
    IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                WHERE c.oid = v_rel AND g.grantee = 0)
       OR EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                   WHERE a.attrelid = v_rel AND a.attacl IS NOT NULL AND g.grantee = 0)
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(papel)
                   WHERE has_table_privilege(r.papel, v_rel, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                      OR has_any_column_privilege(r.papel, v_rel, 'SELECT, INSERT, UPDATE, REFERENCES')) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: PUBLIC, anon, authenticated ou service_role alcanca % (tabela ou coluna).', v_nome;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_publication_tables pt WHERE pt.schemaname = 'public' AND pt.tablename = v_nome) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % entrou numa publicacao (realtime).', v_nome;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) g
              WHERE c.oid = to_regclass('public.livro_de_registro_id_seq') AND g.grantee = 0)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(papel)
                 WHERE has_sequence_privilege(r.papel, 'public.livro_de_registro_id_seq', 'USAGE, SELECT, UPDATE')) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: PUBLIC, anon, authenticated ou service_role alcanca a sequencia do livro.';
  END IF;

  IF v_anotar IS NULL OR v_limpar IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc f WHERE f.oid = v_anotar AND f.prosecdef
                      AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp', 'lock_timeout=200ms']::text[])
     OR NOT EXISTS (SELECT 1 FROM pg_proc f WHERE f.oid = v_limpar AND f.prosecdef
                      AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp', 'statement_timeout=60s']::text[]) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: as funcoes do livro nao estao SECURITY DEFINER com a configuracao esperada.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc f CROSS JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) g
              WHERE f.oid IN (v_anotar, v_limpar) AND g.grantee = 0)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(papel)
                 WHERE has_function_privilege(r.papel, v_anotar, 'EXECUTE')
                    OR has_function_privilege(r.papel, v_limpar, 'EXECUTE')) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: PUBLIC, anon, authenticated ou service_role executa uma funcao do livro.';
  END IF;

  -- Os 34 gatilhos: por tabela, os dois, com evento, transicoes e argumento certos; e nenhum outro gatilho usa a funcao.
  SELECT count(*) INTO v_esperados
    FROM (VALUES ('marketplace_orders', 'user_id'), ('marketplace_order_items', 'order_id'), ('order_refunds', 'order_id'),
                 ('marketplace_order_payment_history', 'order_id'), ('devolucoes', 'user_id'), ('devolucao_itens', 'devolucao_id'),
                 ('produtos', ''), ('product_variants', ''), ('categorias', ''), ('coupons', ''), ('fornecedores', ''),
                 ('fin_lancamentos', ''), ('fin_contas', ''), ('fin_categorias', ''), ('store_config', ''),
                 ('config_pagamento_cartao', ''), ('politica_devolucao', '')) AS e(tabela, origem)
    CROSS JOIN (VALUES ('tr_livro_alteracao', 16, 'novos'), ('tr_livro_exclusao', 8, NULL)) AS g(nome, tipo, novos)
   WHERE EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = to_regclass('public.' || e.tabela) AND t.tgname = g.nome AND NOT t.tgisinternal
                    AND t.tgfoid = v_anotar AND t.tgenabled = 'O' AND t.tgtype = g.tipo
                    AND t.tgoldtable = 'antigos' AND t.tgnewtable IS NOT DISTINCT FROM g.novos
                    AND t.tgnargs = CASE WHEN e.origem = '' THEN 0 ELSE 1 END
                    AND replace(encode(t.tgargs, 'escape'), '\000', '') = e.origem);
  IF v_esperados <> 34
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = v_anotar) <> 34 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: dos 34 gatilhos do livro, % estao como esta migration manda (ou ha outro usando a funcao).',
      v_esperados;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job j
                  WHERE j.jobname = 'limpar-livro-de-registro' AND j.schedule = '17 6 * * *'
                    AND j.command = 'SELECT public.livro_de_registro_limpar()') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o job limpar-livro-de-registro nao ficou agendado.';
  END IF;
  IF (SELECT count(*) FROM public.livro_de_registro_chave) <> 1 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: a chave do livro tem de ter exatamente uma linha.';
  END IF;
END $posvoo_20261510000000$;

NOTIFY pgrst, 'reload schema';

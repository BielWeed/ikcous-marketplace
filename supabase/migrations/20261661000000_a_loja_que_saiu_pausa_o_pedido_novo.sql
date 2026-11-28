-- A LOJA QUE SAIU PAUSA O PEDIDO NOVO (28/11/2026; decisao do socio "loja vendendo depois do fim do contrato"; sucessora do motivo da 20261600000000)
-- RISCO: migration que REDEFINE o motivo lido pelo gatilho BEFORE INSERT de marketplace_orders (o caminho do dinheiro). Revisao Opus antes de aplicar.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. So REDEFINE public.motivo_da_loja_nao_aceitar_pedido()
-- (o corpo da 20261600000000 com UM ramo a mais); a tabela pausa_de_vendas, a regra das datas, a marca, a fechadura do pedido, o gatilho e a leitura do painel
-- ficam como estao. Nenhum GRANT novo: o motivo segue com EXECUTE de ninguem de aplicacao.
--
-- O DEFEITO: a saida registrada pelo dono no app de gestao chega a loja como assinatura_da_loja.status = 'cancelada', e o motivo da 1600 so pausa 'suspensa'.
-- A loja cujo contrato terminou sem continuar seguia aceitando pedido novo pela vitrine para sempre.
--
-- O QUE MUDA NO MOTIVO: com a pausa LIGADA nesta loja (pausa_de_vendas.vale_pela_assinatura = true, chave 1) e a chave da gestao definida (chave 2), o status
-- 'cancelada' devolve 'vendas_pausadas' NA HORA, sem data a esperar (o dono so registra a saida depois do fim do contrato e da tolerancia; a conta e' do app de
-- gestao). E' o MESMO motivo da suspensa: a fechadura da 1600 recusa o pedido novo pela vitrine com 'Esta loja não está aceitando pedidos agora.' e o balcao,
-- os pedidos que ja existem (pagamento, entrega, cancelamento, estorno, devolucao) e o painel seguem como na pausa da suspensa. Manutencao continua vencendo.
-- Pausa DESLIGADA (ou sem a linha, ou sem a chave da gestao) = aceita, como hoje. Os outros status (ativa, teste, pendente, atrasada, suspensa) nao mudam.
--
-- DADOS EXISTENTES: o apply nao le, nao reescreve e nao apaga linha nenhuma. O efeito na hora so existe na loja que JA esta cancelada E tem a pausa ligada
-- (a chave nasce desligada e nenhuma ferramenta a liga; hoje: desligada em todas, decisao do dono ligar). Essa loja para de aceitar pedido NOVO pela vitrine no
-- COMMIT; a 217b confere antes do apply, so pelo catalogo, que a fechadura e o gatilho da 1600 estao no ar.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e fazem COMMIT; qualquer erro,
-- inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui (regra da casa: com eles o ROLLBACK da prova vira no-op). Idempotente:
-- CREATE OR REPLACE com o mesmo corpo (o OID, o dono e a ACL ficam) e REVOKE explicito; rodar duas vezes nao erra e nao muda nada. EXIGE a 20261600000000 (o
-- motivo, a fechadura que recusa 'vendas_pausadas', o gatilho do pedido e a tabela). lock_timeout de 5 s: falha LIMPA (55P03) em vez de enfileirar; e' so rodar
-- de novo.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT), recusa sem escrever: falta papel de aplicacao; pausa_de_vendas ausente ou com outra forma; o motivo ausente, com
-- sobrecarga ou com corpo que nao seja o da 20261600000000 nem o desta; a fechadura a_loja_aceita_pedido_novo com corpo que nao seja o da 1600; o gatilho
-- tr_a_loja_aceita_pedido_novo ausente, desligado ou com outra definicao.
-- POS-VOO (B2_POSVOO_DIVERGENTE), so catalogo: o motivo com o corpo desta (md5), plpgsql, SECURITY DEFINER, STABLE, retorno text, search_path fixo, EXECUTE de
-- ninguem (nem PUBLIC), o dono passando a RLS de pausa_de_vendas; o gatilho com a definicao exata da 1600 e ligado.
-- ROLLBACK: rollback-manual-20261661000000_a_loja_que_saiu_pausa_o_pedido_novo.sql devolve o motivo da 20261600000000 byte a byte (md5 bfe365fb64ad8d2bb9c06efca304375c). Um degrau so:
-- esta migration nao cria tabela nem coluna. Com ele a loja cancelada volta a vender pela vitrine no proximo pedido.
-- CONFERENCIA NA LOJA: 217b ANTES (o motivo da 1600 ou desta, a fechadura, o gatilho e a tabela) e 217a DEPOIS. A 196a aceita o motivo desta como SUCESSORA.
-- TIPOS: nenhum (o motivo fica fora da API).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261661000000$
DECLARE
  v_forma text;
  v_hash text;
  v_caminho text;
  v_def text;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papeis anon, authenticated ou service_role.';
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.pausa_de_vendas') AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.pausa_de_vendas') AND relkind = 'r')
     OR v_forma IS DISTINCT FROM 'id:smallint:true,ligada_em:timestamp with time zone:false,suspensa_desde:date:false,vale_pela_assinatura:boolean:true' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pausa_de_vendas ausente ou com outra forma (%) - aplique a 20261600000000 antes.', COALESCE(v_forma, 'ausente');
  END IF;

  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'motivo_da_loja_nao_aceitar_pedido') <> 1
     OR to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.motivo_da_loja_nao_aceitar_pedido() ausente, com sobrecarga ou com outra assinatura - aplique a 20261600000000 antes.';
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash FROM pg_proc p WHERE p.oid = to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()');
  IF v_hash IS NULL OR v_hash NOT IN ('bfe365fb64ad8d2bb9c06efca304375c', 'f2404f96cd8a589f2821eb5c20a85aa2') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.motivo_da_loja_nao_aceitar_pedido() tem corpo desconhecido (hash %) - nao e o da 20261600000000 nem o desta; capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  -- A fechadura que LE o motivo: a da 1600, que recusa 'vendas_pausadas' (sem ela a saida nao para pedido nenhum).
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash FROM pg_proc p WHERE p.oid = to_regprocedure('public.a_loja_aceita_pedido_novo()');
  IF v_hash IS DISTINCT FROM 'b53378b9838954977af9bad3af6ccbc0' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.a_loja_aceita_pedido_novo() ausente ou com corpo desconhecido (hash %) - nao e a fechadura da 20261600000000; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  -- O gatilho que chama a fechadura: a definicao exata da 1600 (deparseada com search_path = pg_catalog: nomes sempre qualificados), ligado.
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.marketplace_orders') AND t.tgname = 'tr_a_loja_aceita_pedido_novo' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  PERFORM set_config('search_path', v_caminho, true);
  IF v_def IS DISTINCT FROM 'CREATE TRIGGER tr_a_loja_aceita_pedido_novo BEFORE INSERT ON public.marketplace_orders FOR EACH ROW WHEN ((new.canal IS DISTINCT FROM ''presencial''::text)) EXECUTE FUNCTION public.a_loja_aceita_pedido_novo()' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_a_loja_aceita_pedido_novo esta ausente, desligado ou com outra definicao - aplique a 20261600000000 antes.';
  END IF;
END $preflight_20261661000000$;

-- ===== o motivo: a loja que saiu (cancelada) com a pausa ligada tambem nao aceita pedido novo =====

CREATE OR REPLACE FUNCTION public.motivo_da_loja_nao_aceitar_pedido()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manutencao boolean;
  v_vale boolean;
  v_suspensa_desde date;
  v_status text;
  v_teste_ate date;
  v_proxima date;
  v_pausa_em date;
  v_inicio date;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- (a) Manutencao: store_config.manutencao da linha 1 (a que a ferramenta da frota liga). Vence a pausa.
  SELECT s.manutencao INTO v_manutencao FROM public.store_config s WHERE s.id = 1;
  IF v_manutencao IS TRUE THEN
    RETURN 'manutencao';
  END IF;

  -- (b) Vendas pausadas por assinatura: as 5 chaves JUNTAS. Qualquer uma faltando = aceita (o que acontece hoje).
  --     Se um rollback tirar uma tabela da porta (20261177000000, 20261399998000) ou a desta migration, aceita, sem erro.
  IF to_regclass('public.pausa_de_vendas') IS NULL OR to_regclass('public.assinatura_da_loja') IS NULL
     OR to_regclass('public.assinatura_da_loja_chave') IS NULL THEN
    RETURN NULL;
  END IF;
  -- 1. ligada nesta loja (so o dono do banco grava; Savy e IKCOUS nunca)
  SELECT p.vale_pela_assinatura, p.suspensa_desde INTO v_vale, v_suspensa_desde FROM public.pausa_de_vendas p WHERE p.id = 1;
  IF v_vale IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  -- 2. a gestao esta ligada (a chave da porta foi definida)
  IF NOT EXISTS (SELECT 1 FROM public.assinatura_da_loja_chave) THEN
    RETURN NULL;
  END IF;
  -- 3. o pedido de pausa: status suspensa (atrasada NUNCA pausa: pausar e' decisao manual)
  SELECT a.status, a.teste_ate, a.proxima_cobranca_em, a.pausa_em INTO v_status, v_teste_ate, v_proxima, v_pausa_em
    FROM public.assinatura_da_loja a WHERE a.id = 1;
  -- 3-bis. A LOJA QUE SAIU (20261661000000): a gestao gravou a saida (status cancelada). Com a pausa ligada nesta loja (1) e a chave da gestao
  --        definida (2), o pedido NOVO para na hora, sem data a esperar: o dono so registra a saida depois do fim do contrato e da tolerancia
  --        (a conta e' do app de gestao). Pedidos que ja existem, o balcao e o painel seguem como na suspensa. Pausa desligada = aceita.
  IF v_status = 'cancelada' THEN
    RETURN 'vendas_pausadas';
  END IF;
  IF v_status IS DISTINCT FROM 'suspensa' THEN
    RETURN NULL;
  END IF;
  -- 4 e 5. passou o minimo, o dia da suspensa e o dia prometido pela gestao (nunca antes de pausa_em), em dia util
  v_inicio := public.data_da_pausa_de_vendas(v_teste_ate, v_proxima, v_suspensa_desde, v_pausa_em);
  IF v_inicio IS NULL OR v_hoje < v_inicio THEN
    RETURN NULL;
  END IF;
  RETURN 'vendas_pausadas';
END;
$function$;

REVOKE ALL ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido() IS 'Por que a loja nao aceita pedido NOVO agora: manutencao (store_config.manutencao, vence), vendas_pausadas (pausa_de_vendas ligada, chave da gestao definida e: cartao cancelada, a saida registrada pelo dono, na hora, desde a 20261661000000; ou cartao suspensa e hoje em Sao Paulo >= data_da_pausa_de_vendas) ou NULL (aceita). Todo caso duvidoso, inclusive tabela ausente ou pausa desligada, aceita. EXECUTE de ninguem de aplicacao.';

-- ===== pos-voo (so catalogo: nunca chama o motivo nem cria pedido) =====

DO $conferencia_20261661000000$
DECLARE
  v_tab oid := to_regclass('public.pausa_de_vendas');
  v_oid oid := to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()');
  v_caminho text;
  v_def text;
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'motivo_da_loja_nao_aceitar_pedido') <> 1 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: public.motivo_da_loja_nao_aceitar_pedido() sumiu ou ficou com sobrecarga.';
  END IF;
  IF (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM 'f2404f96cd8a589f2821eb5c20a85aa2' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o corpo vivo de public.motivo_da_loja_nao_aceitar_pedido() nao e o desta migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 's'
                    AND NOT p.proretset AND pg_get_function_result(p.oid) = 'text'
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: os atributos de public.motivo_da_loja_nao_aceitar_pedido() mudaram (lingua, SECURITY DEFINER, volatilidade, retorno, search_path).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o EXECUTE de public.motivo_da_loja_nao_aceitar_pedido() esta errado (tem de ser de ninguem de aplicacao).';
  END IF;
  -- SECURITY DEFINER: o dono passa a RLS de pausa_de_vendas (superusuario / BYPASSRLS, ou dono da tabela)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid = p.proowner
                  WHERE p.oid = v_oid AND (o.rolsuper OR o.rolbypassrls OR o.oid = (SELECT relowner FROM pg_class WHERE oid = v_tab))) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de public.motivo_da_loja_nao_aceitar_pedido() nao passa a RLS de pausa_de_vendas.';
  END IF;

  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.marketplace_orders') AND t.tgname = 'tr_a_loja_aceita_pedido_novo' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  PERFORM set_config('search_path', v_caminho, true);
  IF v_def IS DISTINCT FROM 'CREATE TRIGGER tr_a_loja_aceita_pedido_novo BEFORE INSERT ON public.marketplace_orders FOR EACH ROW WHEN ((new.canal IS DISTINCT FROM ''presencial''::text)) EXECUTE FUNCTION public.a_loja_aceita_pedido_novo()' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o gatilho tr_a_loja_aceita_pedido_novo nao ficou com a forma da 20261600000000 ou esta desligado.';
  END IF;
END $conferencia_20261661000000$;

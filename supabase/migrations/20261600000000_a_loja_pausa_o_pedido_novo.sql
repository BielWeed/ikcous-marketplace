-- A LOJA PAUSA O PEDIDO NOVO (26/11/2026; plano PLANO-PAUSA-DE-VENDAS-LOTE1-26-11 com as correcoes da hub; decisao DECISAO-FIM-DO-TESTE-E-PAUSA-26-11)
-- RISCO: migration + gatilho BEFORE INSERT em marketplace_orders (o caminho do dinheiro) + gatilho em assinatura_da_loja (a porta do app de gestao). Revisao Opus antes de aplicar.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. NAO redefine as funcoes que criam pedido (v1, v23, v24), a venda de
-- balcao, a porta do cartao da assinatura nem o leitor dele. So CRIA: a tabela public.pausa_de_vendas (linha unica, nasce VAZIA) e as funcoes e gatilhos abaixo.
--
-- O DEFEITO: hoje nada no servidor recusa pedido. A manutencao (store_config.manutencao) so esconde a vitrine de quem abre o app; quem ja esta com ele aberto compra.
-- E a loja que nao paga a assinatura nao tem como parar de receber pedido novo sem fechar o painel junto.
--
-- O QUE CRIA:
--   (1) public.pausa_de_vendas (id smallint = 1, vale_pela_assinatura boolean NOT NULL DEFAULT false, ligada_em timestamptz, suspensa_desde date): RLS ligada SEM
--       politica e nada para PUBLIC, anon, authenticated nem service_role. So o dono (postgres) grava. Nasce VAZIA: sem a linha com vale_pela_assinatura = true a loja
--       NUNCA pausa por assinatura (Savy, IKCOUS e as lojas de teste nunca recebem true).
--
-- DADOS EXISTENTES: nenhuma linha de nenhuma tabela e' lida, reescrita ou apagada pelo apply.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e fazem COMMIT; qualquer erro, inclusive o
-- pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui. Idempotente: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE com o mesmo corpo e REVOKE/GRANT
-- explicitos; rodar duas vezes nao erra e nao muda nada. lock_timeout de 5 s: um pedido em voo faz o arquivo FALHAR LIMPO (55P03) em vez de enfileirar o checkout; e' so
-- rodar de novo.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT), recusa sem escrever: falta papel de aplicacao; marketplace_orders sem canal (text NOT NULL) ou idempotency_key (uuid);
-- store_config sem manutencao (boolean NOT NULL); is_admin() ou is_admin_atual() ausentes; assinatura_da_loja sem a forma de 14 colunas da 20261590000000 (com pausa_em);
-- assinatura_da_loja_chave ausente ou torta; pausa_de_vendas ja existente com outra forma.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261600000000$
DECLARE
  v_forma text;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papeis anon, authenticated ou service_role.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'canal'
                    AND a.atttypid = 'text'::regtype AND a.attnotnull AND a.attnum > 0 AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'idempotency_key'
                    AND a.atttypid = 'uuid'::regtype AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_orders sem canal (text NOT NULL) ou idempotency_key (uuid) - aplique a 20261160000000 e a 20261203000000 antes.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'manutencao'
                    AND a.atttypid = 'boolean'::regtype AND a.attnotnull AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config sem manutencao (boolean NOT NULL) - aplique a 20261150000000 antes.';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: is_admin() ou is_admin_atual() ausente - aplique a 20261197000000 antes.';
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS DISTINCT FROM 'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,pausa_em:date:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja nao tem a forma de 14 colunas da 20261590000000 (com pausa_em) (%) - aplique a 20261590000000 antes.', COALESCE(v_forma, 'ausente');
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.assinatura_da_loja_chave') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS DISTINCT FROM 'chave_hash:text:true,criada_em:timestamp with time zone:true,id:smallint:true' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja_chave ausente ou com outra forma (%) - aplique a 20261399998000 antes.', COALESCE(v_forma, 'ausente');
  END IF;

  IF to_regclass('public.pausa_de_vendas') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.pausa_de_vendas') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.pausa_de_vendas') AND relkind = 'r')
       OR v_forma IS DISTINCT FROM 'id:smallint:true,ligada_em:timestamp with time zone:false,suspensa_desde:date:false,vale_pela_assinatura:boolean:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pausa_de_vendas ja existe com outra forma (%) - nao e a desta migration; revise antes de aplicar.', COALESCE(v_forma, 'nao e tabela');
    END IF;
  END IF;
END $preflight_20261600000000$;

-- ===== (1) a tabela: a chave que LIGA a pausa por assinatura nesta loja, e o dia em que o status virou suspensa =====

CREATE TABLE IF NOT EXISTS public.pausa_de_vendas (
  id smallint NOT NULL,
  vale_pela_assinatura boolean NOT NULL DEFAULT false,
  ligada_em timestamptz,
  suspensa_desde date,
  CONSTRAINT pausa_de_vendas_pkey PRIMARY KEY (id),
  CONSTRAINT pausa_de_vendas_linha_unica CHECK (id = 1)
);

ALTER TABLE public.pausa_de_vendas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pausa_de_vendas FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.pausa_de_vendas IS 'Linha unica (id = 1) da pausa de vendas por assinatura. vale_pela_assinatura = true LIGA a pausa nesta loja (so o dono do banco grava; nasce vazia = nunca pausa; Savy e IKCOUS nunca recebem true). suspensa_desde = dia (Sao Paulo) em que assinatura_da_loja.status virou suspensa, gravado pelo gatilho tr_assinatura_marca_suspensa_desde. RLS sem politica: nenhum papel de aplicacao le nem grava.';

-- ===== (2) a regra das datas: o primeiro dia em que a loja PODE pausar por assinatura (pura: sem relogio, sem tabela) =====

CREATE OR REPLACE FUNCTION public.data_da_pausa_de_vendas(p_teste_ate date, p_proxima date, p_suspensa_desde date, p_pausa_em date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $function$
  -- d0 = p_proxima (a mensalidade mais antiga em aberto). Tolerancia: 3 dias com o sinal de teste nao convertido (teste_ate = proxima), 10 nos outros casos
  -- (sinal torto cai nos 10, o lado leniente). minimo = d0 + tolerancia + 1. inicio = o MAIOR entre o minimo, o dia em que virou suspensa e o dia que a
  -- gestao prometeu (pausa_em; nunca pausa antes dele). Sexta, sabado ou domingo passam para a segunda. Sem d0 ou sem suspensa_desde: NULL (nao pausa).
  -- Sinal de teste SEM pausa_em: NULL (a conta daqui nao conhece feriado; sem o dia prometido no WhatsApp a loja nao pausa).
  SELECT CASE
           WHEN p_proxima IS NULL OR p_suspensa_desde IS NULL THEN NULL
           WHEN p_teste_ate IS NOT NULL AND p_teste_ate = p_proxima AND p_pausa_em IS NULL THEN NULL
           ELSE d.inicio + CASE WHEN extract(isodow FROM d.inicio) IN (5, 6, 7) THEN 8 - extract(isodow FROM d.inicio)::integer ELSE 0 END
         END
    FROM (SELECT greatest(p_proxima + CASE WHEN p_teste_ate IS NOT NULL AND p_teste_ate = p_proxima THEN 3 ELSE 10 END + 1,
                          p_suspensa_desde, p_pausa_em) AS inicio) AS d;
$function$;

REVOKE ALL ON FUNCTION public.data_da_pausa_de_vendas(date, date, date, date) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.data_da_pausa_de_vendas(date, date, date, date) IS 'Primeiro dia (Sao Paulo) em que a loja pode ter as vendas pausadas por assinatura: greatest(proxima + 3 ou 10 + 1, suspensa_desde, pausa_em), com sexta a domingo passando para a segunda. NULL = nao pausa (sem proxima, sem suspensa_desde, ou sinal de teste sem pausa_em). Pura; EXECUTE de ninguem de aplicacao.';

-- ===== (3) a marca: o dia (Sao Paulo) em que o cartao da assinatura virou suspensa =====

CREATE OR REPLACE FUNCTION public.marcar_suspensa_desde()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Grava o dia quando o status ENTRA em suspensa; mantem enquanto segue suspensa (o reenvio das 03:00 nao recomeca a contagem); apaga quando sai.
  -- So mexe em suspensa_desde: vale_pela_assinatura e ligada_em (a chave que liga a pausa) ficam como estao.
  -- NUNCA derruba a porta do app de gestao: se a marca falhar, a gravacao do cartao segue (e com ela o "pagou, reabre"); a falha vira WARNING.
  BEGIN
    IF NEW.status = 'suspensa' THEN
      IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'suspensa' THEN
        INSERT INTO public.pausa_de_vendas AS p (id, suspensa_desde)
        VALUES (1, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        ON CONFLICT (id) DO UPDATE SET suspensa_desde = EXCLUDED.suspensa_desde;
      END IF;
    ELSE
      UPDATE public.pausa_de_vendas SET suspensa_desde = NULL WHERE id = 1 AND suspensa_desde IS NOT NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'marcar_suspensa_desde: a marca do dia da suspensa falhou (% %); o cartao foi gravado sem ela', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_suspensa_desde() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.marcar_suspensa_desde() IS 'Gatilho de assinatura_da_loja: grava pausa_de_vendas.suspensa_desde (dia de Sao Paulo) quando o status entra em suspensa, mantem enquanto segue suspensa e apaga quando sai. Nunca levanta erro (a porta do app de gestao grava mesmo se a marca falhar).';

CREATE OR REPLACE TRIGGER tr_assinatura_marca_suspensa_desde
  AFTER INSERT OR UPDATE OF status ON public.assinatura_da_loja
  FOR EACH ROW
  EXECUTE FUNCTION public.marcar_suspensa_desde();

-- ===== (4) o motivo de a loja nao aceitar pedido novo agora: 'manutencao', 'vendas_pausadas' ou NULL (aceita) =====

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
COMMENT ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido() IS 'Por que a loja nao aceita pedido NOVO agora: manutencao (store_config.manutencao, vence), vendas_pausadas (pausa_de_vendas ligada, chave da gestao definida, cartao suspensa e hoje em Sao Paulo >= data_da_pausa_de_vendas) ou NULL (aceita). Todo caso duvidoso, inclusive tabela ausente, aceita. EXECUTE de ninguem de aplicacao.';

-- ===== (5) a fechadura na porta do cofre: o pedido NOVO pela vitrine passa por aqui antes de nascer =====

CREATE OR REPLACE FUNCTION public.a_loja_aceita_pedido_novo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_motivo text;
  v_admin_atual boolean;
BEGIN
  -- O gatilho fica na TABELA (nao em cada funcao que cria pedido): vale para a v23, a v24, a v1 e a v22 (revogadas, ainda presentes), qualquer
  -- corpo antigo e toda versao futura. O WHEN do gatilho deixa o balcao (canal = 'presencial') de fora: o painel e o balcao seguem vendendo.
  --
  -- ATALHO DA RETENTATIVA (identico ao de pedido_com_cupom_so_nasce_para_a_lista, 20261208000000): se este INSERT vai COLIDIR com um pedido
  -- que ja existe pela chave de compra, nao e' pedido NOVO. O RETURN NEW deixa o indice unico agir: o unique_violation cai no tratamento da
  -- v23/v24, que devolve o pedido que ja existe ao dono. Recusar aqui trocaria esse retorno pela frase da pausa, e a tela giraria a chave.
  IF NEW.idempotency_key IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = NEW.idempotency_key) THEN
    RETURN NEW;
  END IF;

  -- DEFEITO NA LEITURA = VENDE: qualquer erro ao ler o motivo vira WARNING e o pedido segue (o que acontece hoje). Parar todas as vendas
  -- online por um defeito daqui e' o pior caso; vender durante uma pausa e' o resto aceito.
  BEGIN
    v_motivo := public.motivo_da_loja_nao_aceitar_pedido();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'a_loja_aceita_pedido_novo: a leitura do motivo falhou (% %); o pedido segue', SQLSTATE, SQLERRM;
    v_motivo := NULL;
  END;

  IF v_motivo = 'manutencao' THEN
    -- Na manutencao o admin de AGORA (JWT de admin E as duas fontes do papel) testa a loja; cliente e ex-admin nao.
    v_admin_atual := COALESCE(public.is_admin() AND public.is_admin_atual(), false);
    IF v_admin_atual THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A loja está em manutenção. Tente de novo mais tarde.' USING ERRCODE = 'P0001';
  ELSIF v_motivo = 'vendas_pausadas' THEN
    -- Sem isencao: nem o admin cria pedido pela vitrine com as vendas pausadas (o balcao segue).
    RAISE EXCEPTION 'Esta loja não está aceitando pedidos agora.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.a_loja_aceita_pedido_novo() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.a_loja_aceita_pedido_novo() IS 'Gatilho BEFORE INSERT de marketplace_orders (so canal online): recusa o pedido NOVO com a loja em manutencao (exceto o admin atual) ou com as vendas pausadas por assinatura (sem excecao). Retentativa com a chave de um pedido que ja existe passa (o indice unico age). Erro ao ler o motivo = vende (WARNING).';

-- O nome decide a ordem: tr_a_ roda ANTES dos gatilhos do cupom (tr_pedido_com_cupom_*): o cliente ve "loja pausada", nao "cupom invalido".
CREATE OR REPLACE TRIGGER tr_a_loja_aceita_pedido_novo
  BEFORE INSERT ON public.marketplace_orders
  FOR EACH ROW
  WHEN (NEW.canal IS DISTINCT FROM 'presencial')
  EXECUTE FUNCTION public.a_loja_aceita_pedido_novo();

-- ===== (6) a leitura do painel: a loja aceita pedido novo agora? (so o admin de agora) =====

CREATE OR REPLACE FUNCTION public.situacao_das_vendas_da_loja()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_motivo text;
  v_pausada_desde date;
BEGIN
  IF NOT COALESCE(public.is_admin() AND public.is_admin_atual(), false) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  v_motivo := public.motivo_da_loja_nao_aceitar_pedido();
  -- pausada_desde: o dia em que a pausa passou a valer (o mesmo calculo do motivo; nunca antes do pausa_em prometido pela gestao).
  IF v_motivo = 'vendas_pausadas' THEN
    SELECT public.data_da_pausa_de_vendas(a.teste_ate, a.proxima_cobranca_em, p.suspensa_desde, a.pausa_em)
      INTO v_pausada_desde
      FROM public.assinatura_da_loja a CROSS JOIN public.pausa_de_vendas p
     WHERE a.id = 1 AND p.id = 1;
  END IF;
  RETURN jsonb_build_object('aceita', v_motivo IS NULL, 'motivo', v_motivo, 'pausada_desde', v_pausada_desde);
END;
$function$;

REVOKE ALL ON FUNCTION public.situacao_das_vendas_da_loja() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.situacao_das_vendas_da_loja() TO authenticated;
COMMENT ON FUNCTION public.situacao_das_vendas_da_loja() IS 'Painel (Inicio): {aceita, motivo (manutencao | vendas_pausadas | null), pausada_desde (date ou null)}. So o admin atual (is_admin() E is_admin_atual(); senao 42501). EXECUTE so de authenticated.';

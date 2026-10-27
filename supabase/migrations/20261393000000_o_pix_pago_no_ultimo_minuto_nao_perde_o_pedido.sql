-- ============================================================================
-- Migration 20261393000000 — o PIX pago no último minuto não perde o pedido
-- (dinheiro e estoque; caçada de 26/10/2026; troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
-- public.expirar_pedidos_vencidos() (pg_cron, a cada 5 minutos) cancela todo pedido
-- 'aguardando'/'pending' com expires_at < now(), devolve o estoque e grava
-- 'expirado'/'cancelled'. Só o cartão tinha folga (20261186000000). O criar-pagamento
-- alinha o expires_at do PIX EXATAMENTE com o vencimento do QR e a tela promete "Prazo
-- informado: até HH:MM". Cenário: o QR vale até 14:30:00; a cliente paga às 14:29:50; o
-- aviso do Mercado Pago chega às 14:30:40 (atraso de ~90 s já medido em 16/08/2026); a
-- varredura roda às 14:30:00, cancela o pedido e devolve a mercadoria à prateleira; o
-- aviso grava 'pago_apos_expirar' (dinheiro entrou, pedido cancelado) e o item pode ter
-- sido vendido a outra pessoa. O estorno é manual.
--
-- 2. A REGRA NOVA
--
-- PIX com cobrança na vaga := gateway_payment_id de verdade (não nulo e que não seja o
-- sentinela 'verificando:%', que é do cartão) E metodo_online = 'pix'. Esse pedido só
-- expira quando passaram 10 minutos do expires_at. Os 10 minutos cobrem o atraso do aviso
-- (~90 s) e UMA passada inteira da reconciliação (a cada 10 minutos, 20261010000000),
-- que confirma o pagamento como 'pago' enquanto o pedido ainda é aguardando/pending. Os
-- 5 minutos do agendador somam: na prática o PIX com vaga expira entre 10 e 15 minutos
-- depois do vencimento do QR.
--
-- 3. O QUE MUDA NO CORPO (só esta troca; o resto não muda um byte)
--
-- Um segundo predicado AND (e o comentário dele) entre o predicado do cartão e o
-- FOR UPDATE SKIP LOCKED. NÃO mudam: o laço com FOR UPDATE SKIP LOCKED, a ordem das travas,
-- devolver_estoque, o UPDATE ('expirado'/'cancelled'), o retorno (quantos expirou), a
-- assinatura, SECURITY DEFINER, search_path ('public'), a folga de 24 h do cartão e a ACL
-- (CREATE OR REPLACE a preserva; este arquivo não tem GRANT nem REVOKE).
--
-- 4. O QUE ACONTECE EM CADA CASO
--
--   * PIX com vaga, vencido há menos de 10 min: NÃO expira nesta varredura;
--   * PIX com vaga, vencido há 10 min ou mais: expira como sempre (estoque volta);
--   * PIX sem vaga (gateway_payment_id NULL), ou vaga liberada (liberar_cobranca_do_pedido
--     zera id e método), ou metodo_online NULL: expira no horário de sempre;
--   * sentinela 'verificando:%', com qualquer método: segue a regra do cartão (24 h);
--   * cartão (crédito/débito) com vaga: como antes (24 h);
--   * pedido cancelado, pago ou já expirado: fora da varredura, como antes.
--
-- 5. CUSTO ACEITO
--
-- Todo PIX aberto com cobrança gerada passa a segurar o estoque por 10 a 15 minutos a mais
-- depois do vencimento do QR (hoje 30 min; passa a ~40-45 min). É o preço de não vender
-- duas vezes a mercadoria de quem pagou no último minuto. O PIX do balcão não é afetado
-- (a venda do balcão nasce paga, sem expires_at).
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem reescrita ao aplicar: só o corpo de UMA função muda. Pedidos PIX
-- que já expiraram ficam como estão. Um PIX com vaga vencido há menos de 10 min no instante
-- do apply deixa de ser pego pela próxima varredura e é pego quando completar 10 min.
--
-- 7. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; faltar uma das cinco colunas que o
-- corpo lê (plpgsql não valida coluna ao criar: a função nasceria quebrada e só falharia na
-- primeira varredura); o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois
-- conhecidos (o da 20261186000000, 4e6b4c105ee2eaaecd9c2e19a5c535af, ou o desta migration,
-- 463086667b8d20b327c37faac9a9b16f); os atributos não forem os de sempre; ou a função estiver aberta a
-- PUBLIC, anon ou authenticated. Os hashes são o md5 REAL dos corpos, amarrados ao texto
-- por tests/migration_o_pix_pago_no_ultimo_minuto_nao_perde_o_pedido_test.ts.
--
-- 8. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada: corpo da 20261186000000 (aplica) ou corpo desta migration
-- (reaplicar reescreve o MESMO texto). Qualquer outro estado ABORTA. Sem BEGIN/COMMIT de
-- nível superior (regra da casa): quem abre a transação é o aplicador; o pré-voo, a troca do
-- corpo e a conferência final caem juntos ou não caem.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261186000000 (o pré-voo recusa sem ela). ROLLBACK MANUAL:
-- rollback-manual-20261393000000_o_pix_pago_no_ultimo_minuto_nao_perde_o_pedido.sql devolve o
-- corpo da 20261186000000 byte a byte. Este rollback vem ANTES de qualquer rollback da
-- 20261186000000 (o dela recusa enquanto este corpo estiver no ar). A prova da release
-- (scripts/publicacao/verificar-pagamentos-ikcous.cjs) passa a pinar o corpo DESTA migration.
--
-- 10. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.expirar_pedidos_vencidos()');
--      -- esperado: 463086667b8d20b327c37faac9a9b16f.
--   2. PIX com vaga (metodo_online 'pix', id de gateway) e expires_at há 1 min:
--      SELECT public.expirar_pedidos_vencidos() NÃO o toca; com expires_at há 11 min, expira.
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-viva.cjs (rpc-ci);
--   portão da release: consultas 103a e 103b.
-- ============================================================================

DO $preflight_20261393000000$
DECLARE
  v_fn CONSTANT text := 'public.expirar_pedidos_vencidos()';
  v_oid oid := to_regprocedure('public.expirar_pedidos_vencidos()');
  v_hash text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'expirar_pedidos_vencidos') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: expirar_pedidos_vencidos tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- As colunas que o corpo lê (plpgsql só acusa coluna ausente na primeira chamada).
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'marketplace_orders'
         AND column_name IN ('payment_status', 'status', 'expires_at', 'gateway_payment_id', 'metodo_online')) <> 5 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_orders não tem as cinco colunas que a varredura lê (payment_status, status, expires_at, gateway_payment_id, metodo_online) — aplique antes a 20261176000000_o_cartao_online_nasce.sql.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261186000000, aplica) ou o desta migration (reaplicar é no-op).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (
       '4e6b4c105ee2eaaecd9c2e19a5c535af', -- corpo da 20261186000000 (vigente até aqui)
       '463086667b8d20b327c37faac9a9b16f'  -- corpo que ESTA migration deixa — reaplicação idempotente
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261186000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'integer'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- A ACL é preservada pelo CREATE OR REPLACE; aqui só se recusa partir de uma função aberta (PUBLIC medido por aclexplode, grantee = 0).
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  IF v_public OR v_anon OR v_auth THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % está aberta (PUBLIC=%, anon=%, authenticated=%) — a varredura é de serviço; meça a loja e revise.', v_fn, v_public, v_anon, v_auth;
  END IF;
END $preflight_20261393000000$;

-- expirar_pedidos_vencidos: corpo vigente da 20261186000000_cartao_em_analise_segura_a_expiracao.sql,
-- com a folga de 10 minutos do PIX com cobrança na vaga (a troca declarada no cabeçalho, item 3).
CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $expirar$
DECLARE
    v_pedido   RECORD;
    v_expirados integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED protege contra OUTRA varredura: se dois ciclos do
    -- pg_cron se sobrepuserem, o segundo pula a linha travada em vez de creditar
    -- estoque duas vezes. NAO resolve a corrida com o webhook da Fase 3: se a
    -- varredura pegar a trava primeiro, o UPDATE do webhook espera, reavalia o
    -- WHERE por id (que continua valendo) e sobrescreve — sai pedido 'pago' com
    -- status 'cancelled' e estoque ja devolvido. Tratar esse estado e' obrigacao
    -- de quem escrever o webhook; a CHECK ja reserva 'pago_apos_expirar' para
    -- ele. Este comentario e' o que a Fase 3 vai ler: nao prometa aqui garantia
    -- que o codigo nao da.
    --
    -- status = 'pending' e' o filtro que impede credito em dobro: quando o
    -- cliente cancela pelo app, a update_order_status_atomic JA devolve o
    -- estoque e NAO escreve payment_status. Sem este AND, o pedido cancelado as
    -- 10:05 seria varrido as 10:30 e creditado uma segunda vez. Vale tambem para
    -- o pedido que o admin adiantou para 'processing' dentro dos 30 minutos:
    -- venda fechada por fora nao pode ser cancelada por varredura.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE payment_status = 'aguardando'
          AND status = 'pending'
          AND expires_at IS NOT NULL
          AND expires_at < now()
          -- Cartao possivelmente vivo NAO expira enquanto a reconciliacao ainda
          -- o enxerga (mesma janela de 24 h de pagamentos_a_reconciliar,
          -- 20261010000000): um cartao em analise antifraude nao estende
          -- expires_at, e cancelar aqui devolveria o estoque de um pedido que o
          -- banco ainda pode aprovar. O COALESCE embrulha o teste inteiro: com
          -- metodo_online NULL, NOT (NULL) seria NULL e a linha sumiria da
          -- varredura. PIX, sem vaga e vaga liberada nunca sao "cartao vivo".
          AND (
                expires_at <= now() - interval '24 hours'
                OR NOT COALESCE(
                     gateway_payment_id LIKE 'verificando:%'
                     OR (
                          gateway_payment_id IS NOT NULL
                          AND metodo_online IN ('credito', 'debito')
                        ),
                     false
                   )
              )
          -- PIX com cobranca na vaga ganha 10 minutos de folga depois do vencimento
          -- do QR (20261393000000). O QR vale ate o expires_at, mas o aviso do
          -- Mercado Pago de um PIX pago nos ultimos segundos pode chegar minutos
          -- depois (atraso medido de ~90 s em 16/08/2026): cancelar aqui devolveria o
          -- estoque de um pedido que acabou de ser pago (o aviso viraria
          -- pago_apos_expirar e a mercadoria poderia ser vendida a outra pessoa).
          -- PIX com cobranca na vaga := gateway_payment_id de verdade (o sentinela
          -- 'verificando:%' e' do cartao e ja tem o teto de 24 h acima) E
          -- metodo_online = 'pix'. Os 10 minutos cobrem uma passada inteira da
          -- reconciliacao (a cada 10 min, 20261010000000), que confirma o pagamento
          -- como 'pago' enquanto o pedido ainda e' aguardando/pending. PIX sem
          -- cobranca na vaga (NULL/NULL, vaga liberada, metodo NULL) expira no
          -- horario de sempre. O COALESCE embrulha o teste inteiro: com
          -- metodo_online NULL, NOT (NULL) seria NULL e a linha sumiria da varredura.
          AND (
                expires_at <= now() - interval '10 minutes'
                OR NOT COALESCE(
                     gateway_payment_id IS NOT NULL
                     AND gateway_payment_id NOT LIKE 'verificando:%'
                     AND metodo_online = 'pix',
                     false
                   )
              )
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = v_pedido.id;

        v_expirados := v_expirados + 1;
    END LOOP;

    RETURN v_expirados;
END;
$expirar$;

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a função ficou aberta a PUBLIC, anon ou authenticated.
DO $conferencia_20261393000000$
DECLARE
  v_fn CONSTANT text := 'public.expirar_pedidos_vencidos()';
  v_oid oid := to_regprocedure('public.expirar_pedidos_vencidos()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261393000000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'expirar_pedidos_vencidos') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261393000000: expirar_pedidos_vencidos ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '463086667b8d20b327c37faac9a9b16f' THEN
    RAISE EXCEPTION 'conferencia 20261393000000: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'integer'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261393000000: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261393000000: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261393000000: anon executa %', v_fn;
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261393000000: authenticated executa %', v_fn;
  END IF;
END $conferencia_20261393000000$;

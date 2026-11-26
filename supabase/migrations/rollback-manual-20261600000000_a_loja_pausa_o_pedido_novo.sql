-- Rollback manual da 20261600000000 (a loja pausa o pedido novo).
-- Tira os 2 gatilhos (tr_a_loja_aceita_pedido_novo em marketplace_orders e tr_assinatura_marca_suspensa_desde em assinatura_da_loja) e as 5
-- funcoes que a migration criou. O estado anterior e' a AUSENCIA delas (a migration nao redefiniu nada), entao tira-las devolve o catalogo de
-- marketplace_orders e assinatura_da_loja exatamente ao de antes; as funcoes que criam pedido, o balcao e a porta do cartao nunca foram tocados.
-- EFEITO NA HORA: toda loja volta a aceitar pedido pela vitrine (manutencao e pausa por assinatura deixam de recusar). E' o desligamento de
-- emergencia completo; para desligar so o gatilho, sem rollback: ALTER TABLE public.marketplace_orders DISABLE TRIGGER tr_a_loja_aceita_pedido_novo;
-- MANTEM a tabela public.pausa_de_vendas com as linhas (a chave ligada e o dia da suspensa): reaplicar a migration volta ao mesmo estado.
-- Quem apaga a tabela e' o rollback-manual-destrutivo-20261600000000_a_loja_pausa_o_pedido_novo.sql, so com o dono e so depois deste.
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) sem escrever se alguma das 5 funcoes existir com corpo que nao e' o desta migration, ou se um gatilho
-- com um dos dois nomes apontar para outra funcao ou tabela (alguem recriou: tirar levaria junto o que nao e' desta migration). Estados aceitos:
-- o desta migration (sai) ou ausente (rodar de novo e' no-op).
-- ORDEM: desfazer ESTA antes de desfazer a 20261197000000 (o rollback da 97 recusa enquanto alguma funcao cita is_admin_atual), a 20261590000000
-- (o destrutivo dela recusa enquanto alguma funcao cita pausa_em), a 20261399998000 ou a 20261177000000.
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo -
-- regra da casa. Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261600000000$
DECLARE
  v_hash text;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.data_da_pausa_de_vendas(date, date, date, date)', 'ce4f41a99d7cdce593f07cfd42ee18ec'),
    ('public.marcar_suspensa_desde()', '162120d86a79c72a8b3622d2777dfa8d'),
    ('public.motivo_da_loja_nao_aceitar_pedido()', 'bfe365fb64ad8d2bb9c06efca304375c'),
    ('public.a_loja_aceita_pedido_novo()', 'b53378b9838954977af9bad3af6ccbc0'),
    ('public.situacao_das_vendas_da_loja()', '3757e68d6bf74e5f4428eae612e60749')
  ) AS f(assinatura, hash) LOOP
    SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NOT NULL AND v_hash <> r.hash THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % existe com corpo desconhecido (hash %) - nao e o da 20261600000000; revise antes de desfazer.', r.assinatura, v_hash;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'tr_a_loja_aceita_pedido_novo'
                AND (t.tgrelid IS DISTINCT FROM to_regclass('public.marketplace_orders') OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.a_loja_aceita_pedido_novo()')))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'tr_assinatura_marca_suspensa_desde'
                AND (t.tgrelid IS DISTINCT FROM to_regclass('public.assinatura_da_loja') OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.marcar_suspensa_desde()'))) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: um gatilho com o nome de um da 20261600000000 aponta para outra funcao ou tabela - revise antes de desfazer.';
  END IF;
END $preflight_rollback_20261600000000$;

-- Os gatilhos primeiro (dependem das funcoes); IF EXISTS na tabela para nao errar se ela ja nao existir.
DO $gatilhos_rollback_20261600000000$
BEGIN
  IF to_regclass('public.marketplace_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tr_a_loja_aceita_pedido_novo ON public.marketplace_orders;
  END IF;
  IF to_regclass('public.assinatura_da_loja') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tr_assinatura_marca_suspensa_desde ON public.assinatura_da_loja;
  END IF;
END $gatilhos_rollback_20261600000000$;

-- Sem CASCADE: um dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP FUNCTION IF EXISTS public.a_loja_aceita_pedido_novo();
DROP FUNCTION IF EXISTS public.marcar_suspensa_desde();
DROP FUNCTION IF EXISTS public.situacao_das_vendas_da_loja();
DROP FUNCTION IF EXISTS public.motivo_da_loja_nao_aceitar_pedido();
DROP FUNCTION IF EXISTS public.data_da_pausa_de_vendas(date, date, date, date);

DO $conferencia_rollback_20261600000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('data_da_pausa_de_vendas', 'marcar_suspensa_desde', 'motivo_da_loja_nao_aceitar_pedido',
                                  'a_loja_aceita_pedido_novo', 'situacao_das_vendas_da_loja'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
                   AND t.tgname IN ('tr_a_loja_aceita_pedido_novo', 'tr_assinatura_marca_suspensa_desde')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261600000000: sobrou funcao ou gatilho da migration';
  END IF;
END $conferencia_rollback_20261600000000$;

NOTIFY pgrst, 'reload schema';

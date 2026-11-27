-- ROLLBACK DESTRUTIVO 20261600000000 - SO COM O DONO.
-- Apaga a tabela public.pausa_de_vendas (a chave que LIGA a pausa de vendas por assinatura nesta loja e o dia em que o cartao virou suspensa).
-- O rollback comum PRESERVA a tabela. Depois de apagar, o que estava nela NAO tem como ser recuperado daqui: a loja que tinha a pausa ligada
-- volta a nunca pausar ate alguem religar (INSERT do roteiro docs/runbooks/assinatura-da-loja.md), e o dia da suspensa recomeca no proximo
-- envio de suspensa do app de gestao. Nenhuma outra tabela, linha ou objeto e' tocado.
-- So depois do rollback comum (rollback-manual-20261600000000_a_loja_pausa_o_pedido_novo.sql), numa transacao do caller, com confirmacao
-- explicita (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL ficaria na sessao inteira e confirmaria o apagamento de uma chamada
-- futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_pausa_de_vendas = 'APAGAR';
-- PRE-VOO: recusa sem apagar nada se faltar a confirmacao; se alguma funcao ou gatilho da migration ainda existir (PAUSA_ROLLBACK_COMUM_PRIMEIRO);
-- se a tabela existir com outra forma; ou se QUALQUER funcao fora dos esquemas do sistema ainda citar pausa_de_vendas no corpo (o plpgsql nao
-- registra dependencia: apagar quebraria essa funcao em silencio). Uma visao que dependa da tabela faz o proprio Postgres recusar (sem CASCADE).
-- Idempotente: DROP TABLE IF EXISTS; rodar duas vezes nao erra. Sem BEGIN/COMMIT: quem roda abre a transacao.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261600000000$
DECLARE
  v_funcoes text;
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_pausa_de_vendas', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'PAUSA_DE_VENDAS_SO_COM_O_DONO: confirme antes de apagar a tabela pausa_de_vendas (SET LOCAL app.confirmo_apagar_pausa_de_vendas = ''APAGAR'').';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('data_da_pausa_de_vendas', 'marcar_suspensa_desde', 'motivo_da_loja_nao_aceitar_pedido',
                                  'a_loja_aceita_pedido_novo', 'situacao_das_vendas_da_loja'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
                   AND t.tgname IN ('tr_a_loja_aceita_pedido_novo', 'tr_assinatura_marca_suspensa_desde')) THEN
    RAISE EXCEPTION 'PAUSA_DE_VENDAS_ROLLBACK_COMUM_PRIMEIRO: ainda ha funcao ou gatilho da 20261600000000 - rode o rollback comum antes de apagar a tabela.';
  END IF;
  IF to_regclass('public.pausa_de_vendas') IS NOT NULL
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
            FROM pg_attribute a WHERE a.attrelid = to_regclass('public.pausa_de_vendas') AND a.attnum > 0 AND NOT a.attisdropped)
         IS DISTINCT FROM 'id:smallint:true,ligada_em:timestamp with time zone:false,suspensa_desde:date:false,vale_pela_assinatura:boolean:true' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pausa_de_vendas existe com outra forma - nao e a tabela desta migration; revise antes de apagar.';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_funcoes
    FROM pg_proc p
   WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p.prosrc LIKE '%pausa_de_vendas%';
  IF v_funcoes IS NOT NULL THEN
    RAISE EXCEPTION 'PAUSA_DE_VENDAS_EM_USO: ainda ha funcao que cita pausa_de_vendas (%) - desfaca quem le a tabela antes de apaga-la.', v_funcoes;
  END IF;
END $destrutivo_20261600000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP TABLE IF EXISTS public.pausa_de_vendas;

DO $conferencia_destrutivo_20261600000000$
BEGIN
  IF to_regclass('public.pausa_de_vendas') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia destrutivo 20261600000000: a tabela pausa_de_vendas nao saiu';
  END IF;
END $conferencia_destrutivo_20261600000000$;

NOTIFY pgrst, 'reload schema';

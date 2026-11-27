-- ROLLBACK DESTRUTIVO 20261590000000 - SO COM O DONO.
-- Apaga a coluna public.assinatura_da_loja.pausa_em (o dia em que os pedidos pela loja pausam, prometido pelo app de gestao). O rollback comum PRESERVA a coluna. Depois de
-- apagar, os dias guardados NAO tem como ser recuperados daqui; o app de gestao os regrava no envio seguinte se a 20261590000000 voltar a ser aplicada (e' dado derivado: a
-- mesma conta da mensagem de WhatsApp). Nenhuma outra coluna, linha ou objeto e' tocado; o cartao e a chave guardada ficam como estao.
-- Para que serve: com a coluna, a tabela do cartao tem 14 colunas e o pre-voo da 20261399998000 (que exige as 13 da 20261177000000) recusa reaplicar a porta unica.
-- So depois do rollback comum (rollback-manual-20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql), numa transacao do caller, com confirmacao explicita (SET LOCAL
-- vale so ate o fim da transacao; um SET sem LOCAL ficaria na sessao inteira e confirmaria o apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_pausa_em = 'APAGAR';
-- PRE-VOO: recusa sem apagar nada se faltar a confirmacao; se a porta ainda for a desta migration (ou qualquer corpo que nao o da 20261399998000: PAUSA_ROLLBACK_COMUM_PRIMEIRO);
-- se a coluna existir com outro tipo; ou se QUALQUER funcao fora dos esquemas do sistema ainda citar pausa_em no corpo (o plpgsql nao registra dependencia: apagar a coluna
-- quebraria essa funcao em silencio, na primeira chamada). Uma visao que dependa da coluna faz o proprio Postgres recusar (sem CASCADE).
-- Idempotente: DROP COLUMN IF EXISTS; rodar duas vezes nao erra. Sem BEGIN/COMMIT: quem roda abre a transacao.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261590000000$
DECLARE
  v_hash text;
  v_funcoes text;
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_pausa_em', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'PAUSA_SO_COM_O_DONO: confirme antes de apagar a coluna pausa_em (SET LOCAL app.confirmo_apagar_pausa_em = ''APAGAR'').';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)');
  IF v_hash IS DISTINCT FROM '565f82cb9a65ed96e4702db9d97bf0d6' THEN
    RAISE EXCEPTION 'PAUSA_ROLLBACK_COMUM_PRIMEIRO: a porta assinatura_da_loja_gravar nao e a da 20261399998000 (hash %) - rode o rollback comum antes de apagar a coluna.', COALESCE(v_hash, 'ausente');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attname = 'pausa_em' AND a.attnum > 0 AND NOT a.attisdropped
                AND a.atttypid <> 'date'::regtype) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja.pausa_em existe com outro tipo - nao e a coluna desta migration; revise antes de apagar.';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_funcoes
    FROM pg_proc p
   WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p.prosrc LIKE '%pausa_em%';
  IF v_funcoes IS NOT NULL THEN
    RAISE EXCEPTION 'PAUSA_EM_USO: ainda ha funcao que cita pausa_em (%) - desfaca quem le a coluna antes de apaga-la.', v_funcoes;
  END IF;
END $destrutivo_20261590000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
ALTER TABLE public.assinatura_da_loja DROP COLUMN IF EXISTS pausa_em;

DO $conferencia_destrutivo_20261590000000$
BEGIN
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
        FROM pg_attribute a WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false' THEN
    RAISE EXCEPTION 'conferencia destrutivo 20261590000000: assinatura_da_loja nao voltou as 13 colunas da 20261177000000';
  END IF;
END $conferencia_destrutivo_20261590000000$;

NOTIFY pgrst, 'reload schema';

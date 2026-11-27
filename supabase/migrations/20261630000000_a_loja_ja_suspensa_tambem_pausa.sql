-- A LOJA JA SUSPENSA TAMBEM PAUSA (27/11/2026; caca da pausa de vendas, achado 3, BAIXA; sucessora da 20261600000000)
-- RISCO: migration + gatilho SECURITY DEFINER em assinatura_da_loja (a porta do app de gestao) que alimenta a pausa de vendas (o caminho do dinheiro). Revisao
-- Opus antes de aplicar.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. So REDEFINE public.marcar_suspensa_desde() (o corpo da
-- 20261600000000 com UM ramo a mais); o gatilho tr_assinatura_marca_suspensa_desde, a tabela pausa_de_vendas, a regra, o motivo, a fechadura do pedido e a leitura
-- do painel ficam como estao.
--
-- O DEFEITO: a marca da 20261600000000 so grava pausa_de_vendas.suspensa_desde quando o status ENTRA em suspensa. A loja que ja estava suspensa quando a 1600 foi
-- aplicada nunca entra (o reenvio diario da gestao manda suspensa sobre suspensa), entao o dia fica NULL para sempre e data_da_pausa_de_vendas devolve NULL com
-- suspensa_desde NULL: essa loja NUNCA pausa, mesmo com a pausa ligada.
--
-- O QUE MUDA NA MARCA: seguindo suspensa (UPDATE de suspensa para suspensa) e com suspensa_desde NULL (ou sem a linha da pausa), a marca grava o dia de HOJE em Sao
-- Paulo, o primeiro dia em que ela ve a loja suspensa. Seguindo suspensa COM dia, nada muda (ON CONFLICT ... WHERE p.suspensa_desde IS NULL): o reenvio nao recomeca
-- a contagem. Entrar em suspensa e sair dela continuam byte a byte como na 1600. Nunca liga vale_pela_assinatura; qualquer erro continua WARNING (a porta grava).
-- A regra data_da_pausa_de_vendas nao muda: o inicio continua o MAIOR entre o minimo, suspensa_desde (agora o dia em que a marca viu) e pausa_em, sexta a domingo
-- para a segunda. Para a loja antiga isso quer dizer: pausa no primeiro dia util a partir do reenvio que a viu, nunca antes de pausa_em nem do minimo.
--
-- DADOS EXISTENTES: o apply nao le, nao reescreve e nao apaga linha nenhuma (nada de backfill). A linha de pausa_de_vendas com suspensa_desde NULL so ganha o dia
-- quando a GESTAO gravar o cartao de novo com status suspensa (o reenvio diario; gravacao mais velha que a guardada nao chega ao gatilho). Loja que nao esta
-- suspensa, ou ja tem o dia, nao muda. Sem a linha (a tabela nasce vazia), a marca cria a linha com vale_pela_assinatura = false (o mesmo que a 1600 faz ao entrar
-- em suspensa): nada pausa sem o dono ligar a chave.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e fazem COMMIT; qualquer erro,
-- inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui (regra da casa: com eles o ROLLBACK da prova vira no-op). Idempotente:
-- CREATE OR REPLACE com o mesmo corpo (o OID, o dono e o gatilho ficam) e REVOKE explicito; rodar duas vezes nao erra e nao muda nada. Concorrencia: duas gravacoes
-- do cartao se enfileiram na linha de assinatura_da_loja; o INSERT ... ON CONFLICT da marca e' atomico. EXIGE a 20261600000000 (a tabela, o gatilho e a marca).
-- lock_timeout de 5 s: um gatilho em voo faz o arquivo FALHAR LIMPO (55P03); e' so rodar de novo.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT), recusa sem escrever: falta papel de aplicacao; pausa_de_vendas ausente ou com outra forma; marcar_suspensa_desde
-- ausente, com sobrecarga ou com corpo que nao seja o da 20261600000000 nem o desta; o gatilho tr_assinatura_marca_suspensa_desde ausente, desligado ou com
-- outra definicao.
-- POS-VOO (B2_POSVOO_DIVERGENTE), so catalogo: a marca com o corpo desta (md5), plpgsql, SECURITY DEFINER, VOLATILE, retorno trigger, search_path fixo, EXECUTE de
-- ninguem (nem PUBLIC), o dono passando a RLS de pausa_de_vendas; o gatilho com a definicao exata da 1600 e ligado.
-- ROLLBACK: rollback-manual-20261630000000_a_loja_ja_suspensa_tambem_pausa.sql devolve a marca da 20261600000000 byte a byte (md5 162120d86a79c72a8b3622d2777dfa8d). Um degrau so: esta
-- migration nao cria tabela nem coluna. Os dias que a marca nova ja gravou ficam (a marca velha os mantem enquanto a loja segue suspensa).
-- CONFERENCIA NA LOJA: 199b ANTES (a marca da 1600 ou desta, o gatilho e a tabela) e 199a DEPOIS. A 196a aceita a marca desta como SUCESSORA.
-- TIPOS: nenhum (a marca e' gatilho, fora da API).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261630000000$
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

  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'marcar_suspensa_desde') <> 1
     OR to_regprocedure('public.marcar_suspensa_desde()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marcar_suspensa_desde() ausente, com sobrecarga ou com outra assinatura - aplique a 20261600000000 antes.';
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_suspensa_desde()');
  IF v_hash IS NULL OR v_hash NOT IN ('162120d86a79c72a8b3622d2777dfa8d', '974c4efadc6876427ffe740312c7619b') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marcar_suspensa_desde() tem corpo desconhecido (hash %) - nao e o da 20261600000000 nem o desta; capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  -- O gatilho que chama a marca: a definicao exata da 1600 (deparseada com search_path = pg_catalog: nomes sempre qualificados), ligado.
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.assinatura_da_loja') AND t.tgname = 'tr_assinatura_marca_suspensa_desde' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  PERFORM set_config('search_path', v_caminho, true);
  IF v_def IS DISTINCT FROM 'CREATE TRIGGER tr_assinatura_marca_suspensa_desde AFTER INSERT OR UPDATE OF status ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde()' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_assinatura_marca_suspensa_desde esta ausente, desligado ou com outra definicao - aplique a 20261600000000 antes.';
  END IF;
END $preflight_20261630000000$;

-- ===== a marca: tambem a loja que ja estava suspensa ganha o dia =====

CREATE OR REPLACE FUNCTION public.marcar_suspensa_desde()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Grava o dia quando o status ENTRA em suspensa; mantem enquanto segue suspensa (o reenvio das 03:00 nao recomeca a contagem); apaga quando sai.
  -- A LOJA QUE JA ESTAVA SUSPENSA (20261630000000): quem ja era suspensa quando a 20261600000000 chegou nunca ENTRA em suspensa, e o dia ficava NULL
  -- para sempre (a regra devolve NULL: nunca pausa). Seguindo suspensa SEM dia, o reenvio da gestao grava o dia de hoje (o primeiro em que a marca a
  -- ve); seguindo suspensa COM dia, nada muda (o WHERE do ON CONFLICT).
  -- So mexe em suspensa_desde: vale_pela_assinatura e ligada_em (a chave que liga a pausa) ficam como estao.
  -- NUNCA derruba a porta do app de gestao: se a marca falhar, a gravacao do cartao segue (e com ela o "pagou, reabre"); a falha vira WARNING.
  BEGIN
    IF NEW.status = 'suspensa' THEN
      IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'suspensa' THEN
        INSERT INTO public.pausa_de_vendas AS p (id, suspensa_desde)
        VALUES (1, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        ON CONFLICT (id) DO UPDATE SET suspensa_desde = EXCLUDED.suspensa_desde;
      ELSE
        INSERT INTO public.pausa_de_vendas AS p (id, suspensa_desde)
        VALUES (1, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        ON CONFLICT (id) DO UPDATE SET suspensa_desde = EXCLUDED.suspensa_desde
        WHERE p.suspensa_desde IS NULL;
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
COMMENT ON FUNCTION public.marcar_suspensa_desde() IS 'Gatilho de assinatura_da_loja: grava pausa_de_vendas.suspensa_desde (dia de Sao Paulo) quando o status entra em suspensa, ou quando segue suspensa sem dia (a loja que ja estava suspensa antes da 20261600000000, desde a 20261630000000); mantem enquanto segue suspensa com dia e apaga quando sai. Nunca levanta erro (a porta do app de gestao grava mesmo se a marca falhar).';

-- ===== pos-voo (so catalogo: nunca chama a porta nem grava o cartao) =====

DO $conferencia_20261630000000$
DECLARE
  v_tab oid := to_regclass('public.pausa_de_vendas');
  v_oid oid := to_regprocedure('public.marcar_suspensa_desde()');
  v_caminho text;
  v_def text;
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'marcar_suspensa_desde') <> 1 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: public.marcar_suspensa_desde() sumiu ou ficou com sobrecarga.';
  END IF;
  IF (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM '974c4efadc6876427ffe740312c7619b' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o corpo vivo de public.marcar_suspensa_desde() nao e o desta migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proretset AND pg_get_function_result(p.oid) = 'trigger'
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: os atributos de public.marcar_suspensa_desde() mudaram (lingua, SECURITY DEFINER, volatilidade, retorno, search_path).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o EXECUTE de public.marcar_suspensa_desde() esta errado (tem de ser de ninguem de aplicacao).';
  END IF;
  -- SECURITY DEFINER: o dono passa a RLS de pausa_de_vendas (superusuario / BYPASSRLS, ou dono da tabela)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid = p.proowner
                  WHERE p.oid = v_oid AND (o.rolsuper OR o.rolbypassrls OR o.oid = (SELECT relowner FROM pg_class WHERE oid = v_tab))) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de public.marcar_suspensa_desde() nao passa a RLS de pausa_de_vendas.';
  END IF;

  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.assinatura_da_loja') AND t.tgname = 'tr_assinatura_marca_suspensa_desde' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  PERFORM set_config('search_path', v_caminho, true);
  IF v_def IS DISTINCT FROM 'CREATE TRIGGER tr_assinatura_marca_suspensa_desde AFTER INSERT OR UPDATE OF status ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde()' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o gatilho tr_assinatura_marca_suspensa_desde nao ficou com a forma da 20261600000000 ou esta desligado.';
  END IF;
END $conferencia_20261630000000$;

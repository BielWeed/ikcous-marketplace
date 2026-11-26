-- A LOJA GUARDA O DIA DA PAUSA DO TESTE (26/11/2026; plano PLANO-AVISO-TESTE-ENCERRADO-26-11, decisao do aviso de teste vencido)
-- RISCO: migration + porta SECURITY DEFINER usada pelo app de gestao do dono para gravar o cartao da assinatura de TODAS as lojas. Revisao Opus do SQL antes de aplicar.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. UMA coluna nova (public.assinatura_da_loja.pausa_em date, anulavel,
-- SEM padrao) e a porta public.assinatura_da_loja_gravar(text, jsonb, boolean) REDEFINIDA (sucessora da 20261399998000). Nada mais e' tocado: assinatura_da_loja_definir_chave,
-- assinatura_da_loja_ler() (to_jsonb(a) - 'id' - 'observacao': a coluna nova aparece sozinha na leitura, corpo e md5 iguais), a tabela da chave, as politicas e os grants.
--
-- O DEFEITO: a lojista que so testou e nao pagou abre o painel e ve "Atrasada", "Em aberto desde" e "Regularize": e' tratada como devedora. O app de gestao ja sabe o dia em que
-- os pedidos pela loja pausam (a mesma conta da mensagem de WhatsApp), mas a loja nao tem onde guardar: a porta recusa qualquer chave fora das 10 (campo_nao_permitido).
--
-- O QUE MUDA NA PORTA (o corpo da 20261399998000 com SO estas mudancas; o resto e' byte a byte, provado pelo teste da migration):
--   - a lista branca vira as 10 obrigatorias de sempre + pausa_em OPCIONAL (v_opcionais). As 10 continuam obrigatorias (campo_ausente) e qualquer outra chave continua
--     'campo_nao_permitido' (22023, DETAIL 'campo: <nome>');
--   - pausa_em passa pela MESMA regra das outras datas ('AAAA-MM-DD' de dia real; 'infinity', '2026-02-31', 20261207 e texto solto sao 'valor_invalido' com o nome do campo
--     no DETAIL e nunca o valor); null explicito = "nao tem";
--   - AUSENTE = NULL: a gestao velha (10 chaves) continua gravando e APAGA o dia guardado; a gravacao reescreve os 11 campos, como ja fazia com os 10;
--   - a simulacao mostra pausa_em em "mudaria" e "atual";
--   - continua autenticando ANTES de olhar p_dados; recursos e observacao continuam fora; mesmo cabecalho (SECURITY DEFINER, VOLATILE, search_path) e mesma ACL.
-- O CONTRATO DO RECUO: a porta VELHA (antes desta migration ou depois do rollback) recusa o corpo da gestao nova com code 22023, message 'campo_nao_permitido' e
-- DETAIL 'campo: pausa_em', sem gravar nada; a gestao nova reenvia sem pausa_em (provado na prova viva). Por isso qualquer ordem de publicacao e' segura.
--
-- DADOS EXISTENTES: nenhuma linha e' lida, reescrita ou apagada pelo apply. A linha do cartao que ja existe ganha pausa_em NULL (ADD COLUMN sem padrao: so catalogo, sem
-- reescrever a tabela); o cartao mostrado hoje nao muda enquanto a gestao nao mandar o dia. A chave guardada (assinatura_da_loja_chave) fica como esta.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e fazem COMMIT; qualquer erro, inclusive o
-- pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui. Idempotente: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE com o mesmo corpo (o OID fica) e
-- REVOKE/GRANT explicitos; rodar duas vezes nao erra e nao muda nada. EXIGE a 20261399998000 (a porta, a tabela da chave e definir_chave). lock_timeout de 5 s: o ALTER pega
-- a trava exclusiva do cartao; uma leitura em voo faz o arquivo FALHAR LIMPO (55P03) em vez de segurar a loja. E' so rodar de novo.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT), recusa sem escrever: falta papel de aplicacao; o cartao sem a forma de 13 colunas da 20261177000000 nem a de 14 (13 + pausa_em
-- date anulavel, reaplicacao); store_config sem id/store_name; a tabela da chave ausente ou torta; a porta ausente, com sobrecarga, outra assinatura ou corpo que nao seja o
-- da 20261399998000 nem o desta; definir_chave ausente ou com corpo desconhecido.
-- POS-VOO (B2_POSVOO_DIVERGENTE), catalogo apenas (nunca chama a porta: chamar mexeria no cartao REAL): a forma de 14 colunas, pausa_em date anulavel SEM padrao; a porta com
-- o corpo desta (md5), SECURITY DEFINER, VOLATILE, search_path, retorno e argumentos, EXECUTE so de anon e authenticated, nada a service_role nem a PUBLIC, e o dono passando a
-- RLS das tabelas que ela escreve; definir_chave e o leitor intactos (md5).
--
-- ROLLBACK EM DOIS DEGRAUS (costume da casa):
--   1) rollback-manual-20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql devolve a porta byte a byte (md5 565f82cb9a65ed96e4702db9d97bf0d6, a da 20261399998000) e
--      MANTEM a coluna pausa_em com os dias guardados (a porta velha nao a le nem a grava; o leitor continua mostrando o que esta la).
--   2) rollback-manual-destrutivo-20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql, SO COM O DONO e so depois do 1): apaga a coluna (o dia da pausa guardado se perde;
--      a gestao o regrava no envio seguinte se a migration voltar). E' o que torna a 20261399998000 reaplicavel de novo (o pre-voo dela exige a forma de 13 colunas).
-- TIPOS: src/types/database.types.ts ganha pausa_em (Row anulavel; Insert e Update opcionais). A porta continua fora dos tipos (so o hub a chama).
-- FICHA DE VERIFICACAO: consultas 195a (depois) e 195b (antes); prova viva tests/banco/a-loja-guarda-o-dia-da-pausa-do-teste-viva.cjs (rpc-ci).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261590000000$
DECLARE
  v_forma text;
  v_hash text;
  v_oid oid;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papeis anon, authenticated ou service_role.';
  END IF;

  IF to_regclass('public.assinatura_da_loja') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja nao existe - aplique a 20261177000000 antes.';
  END IF;
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.assinatura_da_loja') AND relkind = 'r')
     OR v_forma IS NULL
     OR v_forma NOT IN ('atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false',
                        'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,pausa_em:date:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja nao tem a forma da 20261177000000 nem a desta migration (%) - meca a loja e revise antes de seguir.', v_forma;
  END IF;

  IF to_regclass('public.store_config') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'store_name' AND a.atttypid = 'text'::regtype AND a.attnum > 0 AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'id' AND a.atttypid = 'bigint'::regtype AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config nao tem id bigint e store_name text - aplique a 20260819000000 antes.';
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.assinatura_da_loja_chave') AND a.attnum > 0 AND NOT a.attisdropped;
  IF to_regclass('public.assinatura_da_loja_chave') IS NULL
     OR v_forma IS DISTINCT FROM 'chave_hash:text:true,criada_em:timestamp with time zone:true,id:smallint:true' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja_chave ausente ou com outra forma (%) - aplique a 20261399998000 antes.', v_forma;
  END IF;

  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'assinatura_da_loja_gravar') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: assinatura_da_loja_gravar tem sobrecarga em public - revise antes de aplicar.';
  END IF;
  v_oid := to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja_gravar(text, jsonb, boolean) nao existe (ausente ou com outra assinatura) - aplique a 20261399998000 antes.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN ('565f82cb9a65ed96e4702db9d97bf0d6', '1ea3a3dddecfeb7a0305b0e4e02263b5') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja_gravar(text, jsonb, boolean) tem corpo desconhecido (hash %) - nao e o da 20261399998000 nem o desta; capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'assinatura_da_loja_definir_chave') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: assinatura_da_loja_definir_chave ausente ou com sobrecarga - aplique a 20261399998000 antes.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = to_regprocedure('public.assinatura_da_loja_definir_chave(text, boolean)');
  IF v_hash IS DISTINCT FROM 'ee89c0e70e378fe0be0fc3c805567d56' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja_definir_chave(text, boolean) tem corpo desconhecido (hash %) - revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_20261590000000$;

-- ===== (1) a coluna: o dia em que os pedidos pela loja pausam (anulavel, sem padrao) =====

ALTER TABLE public.assinatura_da_loja ADD COLUMN IF NOT EXISTS pausa_em date;

COMMENT ON COLUMN public.assinatura_da_loja.pausa_em IS 'Dia (Sao Paulo) em que os pedidos pela loja ficam pausados se a primeira mensalidade depois do teste gratis nao for paga; a mesma conta da mensagem de WhatsApp do app de gestao. So vem com o sinal do teste encerrado (status atrasada com teste_ate = proxima_cobranca_em); NULL = sem dia prometido. Gravado so pela porta assinatura_da_loja_gravar (chave opcional; ausente apaga).';

-- ===== (2) a porta, com a 11a chave opcional =====

CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_chaves CONSTANT text[] := ARRAY['plano', 'status', 'ciclo', 'valor_mensal', 'inicio_em', 'teste_ate', 'proxima_cobranca_em', 'suporte_whatsapp', 'gerenciar_url', 'atualizado_em'];
  v_opcionais CONSTANT text[] := ARRAY['pausa_em'];
  v_guardado text;
  v_enviado text;
  v_campo text;
  v_texto text;
  v_plano text;
  v_status text;
  v_ciclo text;
  v_numero numeric;
  v_valor numeric(10, 2);
  v_data date;
  v_datas jsonb := '{}'::jsonb;
  v_whatsapp text;
  v_url text;
  v_instante timestamptz;
  v_novo jsonb;
  v_atual public.assinatura_da_loja%ROWTYPE;
  v_existe boolean;
  v_antes jsonb;
  v_mudaria jsonb;
  v_linhas integer;
  v_loja text;
BEGIN
  -- a) Autentica ANTES de olhar p_dados. Mesma excecao para "sem chave definida", chave nula, vazia ou errada. O hash e' calculado sempre (mesmo trabalho nos quatro casos).
  SELECT k.chave_hash INTO v_guardado FROM public.assinatura_da_loja_chave k WHERE k.id = 1;
  v_enviado := encode(sha256(convert_to(COALESCE(p_chave, ''), 'UTF8')), 'hex');
  IF v_guardado IS NULL OR p_chave IS NULL OR p_chave = '' OR v_enviado <> v_guardado THEN
    RAISE EXCEPTION 'nao_autorizado' USING ERRCODE = '42501';
  END IF;

  -- b) simular nulo nao vira escrita por acidente.
  IF p_simular IS NULL THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: p_simular';
  END IF;

  -- c) Forma de p_dados: objeto JSON, so as 10 chaves da lista (todas presentes) e a opcional pausa_em (ausente = NULL).
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RAISE EXCEPTION 'dados_invalidos' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_campo FROM jsonb_object_keys(p_dados) AS k WHERE k <> ALL (v_chaves || v_opcionais) ORDER BY k LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'campo_nao_permitido' USING ERRCODE = '22023', DETAIL = 'campo: ' || left(v_campo, 40);
  END IF;
  FOREACH v_campo IN ARRAY v_chaves LOOP
    IF (p_dados -> v_campo) IS NULL THEN
      RAISE EXCEPTION 'campo_ausente' USING ERRCODE = '22023', DETAIL = 'campo: ' || v_campo;
    END IF;
  END LOOP;

  -- d) Tipos e regras iguais aos CHECKs da tabela (e mais estritos onde o banco arredondaria ou aceitaria texto solto).
  IF jsonb_typeof(p_dados -> 'plano') <> 'string' THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: plano';
  END IF;
  v_plano := p_dados ->> 'plano';
  IF char_length(btrim(v_plano)) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: plano';
  END IF;

  IF jsonb_typeof(p_dados -> 'status') <> 'string' OR (p_dados ->> 'status') NOT IN ('ativa', 'teste', 'pendente', 'atrasada', 'suspensa', 'cancelada') THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: status';
  END IF;
  v_status := p_dados ->> 'status';

  IF jsonb_typeof(p_dados -> 'ciclo') <> 'string' OR (p_dados ->> 'ciclo') NOT IN ('mensal', 'trimestral', 'semestral', 'anual') THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: ciclo';
  END IF;
  v_ciclo := p_dados ->> 'ciclo';

  IF jsonb_typeof(p_dados -> 'valor_mensal') = 'number' THEN
    v_numero := (p_dados -> 'valor_mensal')::numeric;
    IF v_numero < 0 OR v_numero >= 100000000 OR v_numero <> round(v_numero, 2) THEN
      RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: valor_mensal';
    END IF;
    v_valor := v_numero;
  ELSIF jsonb_typeof(p_dados -> 'valor_mensal') <> 'null' THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: valor_mensal';
  END IF;

  -- pausa_em passa pela MESMA regra das outras datas; ausente vira NULL (as outras tres ja foram exigidas acima).
  FOREACH v_campo IN ARRAY ARRAY['inicio_em', 'teste_ate', 'proxima_cobranca_em', 'pausa_em'] LOOP
    IF (p_dados -> v_campo) IS NULL OR jsonb_typeof(p_dados -> v_campo) = 'null' THEN
      v_datas := v_datas || jsonb_build_object(v_campo, NULL::date);
      CONTINUE;
    END IF;
    v_texto := CASE WHEN jsonb_typeof(p_dados -> v_campo) = 'string' THEN p_dados ->> v_campo END;
    IF v_texto IS NULL OR v_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: ' || v_campo;
    END IF;
    BEGIN
      v_data := v_texto::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: ' || v_campo;
    END;
    v_datas := v_datas || jsonb_build_object(v_campo, v_data);
  END LOOP;

  IF jsonb_typeof(p_dados -> 'suporte_whatsapp') = 'string' THEN
    v_whatsapp := p_dados ->> 'suporte_whatsapp';
    IF v_whatsapp !~ '^[0-9]{10,15}$' THEN
      RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: suporte_whatsapp';
    END IF;
  ELSIF jsonb_typeof(p_dados -> 'suporte_whatsapp') <> 'null' THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: suporte_whatsapp';
  END IF;

  IF jsonb_typeof(p_dados -> 'gerenciar_url') = 'string' THEN
    v_url := p_dados ->> 'gerenciar_url';
    IF v_url !~ '^https://' THEN
      RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: gerenciar_url';
    END IF;
  ELSIF jsonb_typeof(p_dados -> 'gerenciar_url') <> 'null' THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: gerenciar_url';
  END IF;

  v_texto := CASE WHEN jsonb_typeof(p_dados -> 'atualizado_em') = 'string' THEN p_dados ->> 'atualizado_em' END;
  IF v_texto IS NULL OR v_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: atualizado_em';
  END IF;
  BEGIN
    v_instante := v_texto::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: atualizado_em';
  END;
  IF v_instante > clock_timestamp() + interval '1 day' THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: atualizado_em';
  END IF;

  SELECT NULLIF(btrim(s.store_name), '') INTO v_loja FROM public.store_config s WHERE s.id = 1;

  -- f) Simular: a mesma validacao, nenhuma escrita.
  IF p_simular THEN
    SELECT * INTO v_atual FROM public.assinatura_da_loja a WHERE a.id = 1;
    v_existe := FOUND;
    v_novo := jsonb_build_object(
      'plano', v_plano, 'status', v_status, 'ciclo', v_ciclo, 'valor_mensal', v_valor,
      'inicio_em', (v_datas ->> 'inicio_em')::date, 'teste_ate', (v_datas ->> 'teste_ate')::date,
      'proxima_cobranca_em', (v_datas ->> 'proxima_cobranca_em')::date, 'pausa_em', (v_datas ->> 'pausa_em')::date,
      'suporte_whatsapp', v_whatsapp, 'gerenciar_url', v_url, 'atualizado_em', v_instante);
    IF v_existe THEN
      v_antes := jsonb_build_object(
        'plano', v_atual.plano, 'status', v_atual.status, 'ciclo', v_atual.ciclo, 'valor_mensal', v_atual.valor_mensal,
        'inicio_em', v_atual.inicio_em, 'teste_ate', v_atual.teste_ate, 'proxima_cobranca_em', v_atual.proxima_cobranca_em, 'pausa_em', v_atual.pausa_em,
        'suporte_whatsapp', v_atual.suporte_whatsapp, 'gerenciar_url', v_atual.gerenciar_url, 'atualizado_em', v_atual.atualizado_em);
      IF v_instante < v_atual.atualizado_em THEN
        RETURN jsonb_build_object('gravado', false, 'simulado', true, 'motivo', 'mais_velho', 'loja', v_loja, 'mudaria', '{}'::jsonb, 'atual', v_antes);
      END IF;
    END IF;
    SELECT COALESCE(jsonb_object_agg(n.key, jsonb_build_object('de', CASE WHEN v_existe THEN v_antes -> n.key ELSE 'null'::jsonb END, 'para', n.value)), '{}'::jsonb)
      INTO v_mudaria
      FROM jsonb_each(v_novo) AS n
     WHERE NOT v_existe OR (v_antes -> n.key) IS DISTINCT FROM n.value;
    RETURN jsonb_build_object('gravado', false, 'simulado', true, 'loja', v_loja, 'mudaria', v_mudaria, 'atual', CASE WHEN v_existe THEN v_antes END);
  END IF;

  -- e) Grava: UM comando atomico; o WHERE do ON CONFLICT e' quem barra a gravacao mais velha (inclusive na corrida entre duas conexoes). recursos e observacao ficam fora;
  --    pausa_em ausente grava NULL (apaga o dia velho).
  INSERT INTO public.assinatura_da_loja AS a (id, plano, status, ciclo, valor_mensal, inicio_em, teste_ate, proxima_cobranca_em, pausa_em, suporte_whatsapp, gerenciar_url, atualizado_em)
  VALUES (1, v_plano, v_status, v_ciclo, v_valor, (v_datas ->> 'inicio_em')::date, (v_datas ->> 'teste_ate')::date, (v_datas ->> 'proxima_cobranca_em')::date, (v_datas ->> 'pausa_em')::date, v_whatsapp, v_url, v_instante)
  ON CONFLICT (id) DO UPDATE SET
    plano = EXCLUDED.plano,
    status = EXCLUDED.status,
    ciclo = EXCLUDED.ciclo,
    valor_mensal = EXCLUDED.valor_mensal,
    inicio_em = EXCLUDED.inicio_em,
    teste_ate = EXCLUDED.teste_ate,
    proxima_cobranca_em = EXCLUDED.proxima_cobranca_em,
    pausa_em = EXCLUDED.pausa_em,
    suporte_whatsapp = EXCLUDED.suporte_whatsapp,
    gerenciar_url = EXCLUDED.gerenciar_url,
    atualizado_em = EXCLUDED.atualizado_em
  WHERE a.atualizado_em <= EXCLUDED.atualizado_em;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas = 0 THEN
    RETURN jsonb_build_object('gravado', false, 'motivo', 'mais_velho');
  END IF;
  RETURN jsonb_build_object('gravado', true, 'atualizado_em', v_instante, 'loja', v_loja);
END;
$function$;

REVOKE ALL ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) TO anon, authenticated;
COMMENT ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) IS 'Porta unica do app de gestao: grava o cartao da assinatura (10 campos obrigatorios + pausa_em opcional, ausente = NULL; lista branca; recursos e observacao nunca) quando p_chave bate com o hash guardado (senao nao_autorizado, sem dizer o motivo). Gravacao mais velha que a guardada e ignorada; p_simular mostra o que mudaria sem gravar. Chamar por POST (a chave nao pode ir na URL).';

-- ===== pos-voo =====

DO $conferencia_20261590000000$
DECLARE
  v_tab oid := to_regclass('public.assinatura_da_loja');
  v_oid oid := to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)');
  v_dono oid;
  v_privilegio text;
BEGIN
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
        FROM pg_attribute a WHERE a.attrelid = v_tab AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,pausa_em:date:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false'
     OR EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                 WHERE d.adrelid = v_tab AND a.attname = 'pausa_em') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: assinatura_da_loja nao tem as 14 colunas desta migration, ou pausa_em nao e date anulavel sem padrao.';
  END IF;

  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'assinatura_da_loja_gravar') <> 1 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: assinatura_da_loja_gravar(text, jsonb, boolean) sumiu ou ficou com sobrecarga.';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM '1ea3a3dddecfeb7a0305b0e4e02263b5' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o corpo vivo de assinatura_da_loja_gravar nao e o desta migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proretset AND NOT p.proisstrict
                    AND pg_get_function_result(p.oid) = 'jsonb'
                    AND pg_get_function_arguments(p.oid) = 'p_chave text, p_dados jsonb, p_simular boolean DEFAULT false'
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: os atributos de assinatura_da_loja_gravar mudaram (SECURITY DEFINER, VOLATILE, search_path, retorno, argumentos).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o EXECUTE de assinatura_da_loja_gravar esta errado (so anon e authenticated; service_role e PUBLIC nada).';
  END IF;
  -- O dono da porta e' quem escreve (SECURITY DEFINER): ou passa a RLS (superusuario / BYPASSRLS), ou e' dono das tabelas; e tem os privilegios, um a um.
  SELECT p.proowner INTO v_dono FROM pg_proc p WHERE p.oid = v_oid;
  IF NOT (EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = v_dono AND (r.rolsuper OR r.rolbypassrls))
          OR (v_dono = (SELECT relowner FROM pg_class WHERE oid = v_tab)
              AND v_dono = (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.assinatura_da_loja_chave')))) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de assinatura_da_loja_gravar nao passa a RLS das tabelas que ela escreve.';
  END IF;
  FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT has_table_privilege(v_dono, v_tab, v_privilegio) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de assinatura_da_loja_gravar nao tem % em assinatura_da_loja.', v_privilegio;
    END IF;
  END LOOP;
  IF NOT has_table_privilege(v_dono, to_regclass('public.assinatura_da_loja_chave'), 'SELECT')
     OR NOT has_column_privilege(v_dono, to_regclass('public.store_config'), 'store_name', 'SELECT') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de assinatura_da_loja_gravar nao le a tabela da chave ou store_config.store_name.';
  END IF;

  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.assinatura_da_loja_definir_chave(text, boolean)'))
       IS DISTINCT FROM 'ee89c0e70e378fe0be0fc3c805567d56' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: assinatura_da_loja_definir_chave nao esta intacta.';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.assinatura_da_loja_ler()'))
       IS DISTINCT FROM 'edeff71c925244a7a450c817d0acd6ae' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: assinatura_da_loja_ler nao esta intacta.';
  END IF;
END $conferencia_20261590000000$;

NOTIFY pgrst, 'reload schema';

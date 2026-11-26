-- ROLLBACK COMUM da 20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql: a porta volta a ser a da 20261399998000.
-- Recria public.assinatura_da_loja_gravar(text, jsonb, boolean) com o texto da 20261399998000 BYTE A BYTE (md5 565f82cb9a65ed96e4702db9d97bf0d6), com a mesma ACL
-- (EXECUTE so de anon e authenticated) e o mesmo comentario. MANTEM a coluna public.assinatura_da_loja.pausa_em com os dias que ja estao guardados: a porta velha nao a le nem a
-- grava (o INSERT/UPDATE dela lista as colunas), e o leitor assinatura_da_loja_ler() continua mostrando o ultimo dia guardado ate o rollback destrutivo ou a migration voltar.
-- COM ELE: a porta volta a recusar a chave pausa_em ('campo_nao_permitido', 22023, DETAIL 'campo: pausa_em'); o app de gestao novo reenvia sem ela (o recuo) e a loja segue
-- gravando o cartao todo dia. Nenhuma linha e' lida ou alterada; a chave guardada (assinatura_da_loja_chave) e o cartao ficam como estao.
-- APAGAR a coluna e' outro arquivo, rollback-manual-destrutivo-20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql, SO COM O DONO e so depois deste.
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) antes de escrever se a porta estiver ausente, com sobrecarga, com outra assinatura ou com corpo que nao seja o desta migration nem o da
-- 20261399998000 (alguem a redefiniu depois: devolver o corpo velho apagaria uma redefinicao que ninguem revisou), ou se a tabela do cartao nao tiver a forma de 13 nem a de 14
-- colunas. Estados aceitos: a migration no ar, ou ja desfeita (rodar de novo e' no-op). Conferencia final: o corpo, os atributos e o EXECUTE da porta sao os da 20261399998000.
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo - regra da casa.
-- Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261590000000$
DECLARE
  v_oid oid;
  v_hash text;
  v_forma text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'assinatura_da_loja_gravar') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: assinatura_da_loja_gravar ausente ou com sobrecarga em public - revise antes de desfazer.';
  END IF;
  v_oid := to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: assinatura_da_loja_gravar existe em public com outra assinatura - revise antes de desfazer.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN ('1ea3a3dddecfeb7a0305b0e4e02263b5', '565f82cb9a65ed96e4702db9d97bf0d6') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.assinatura_da_loja_gravar(text, jsonb, boolean) (hash %) nao e o da 20261590000000 nem o da 20261399998000 - uma redefinicao posterior esta no ar; revise antes de desfazer.', COALESCE(v_hash, 'ausente');
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS NULL
     OR v_forma NOT IN ('atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false',
                        'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,pausa_em:date:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja nao tem a forma de 13 nem a de 14 colunas (%) - revise antes de desfazer.', v_forma;
  END IF;
END $preflight_rollback_20261590000000$;

-- A porta da 20261399998000, letra por letra (o mesmo texto do arquivo dela).
CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_chaves CONSTANT text[] := ARRAY['plano', 'status', 'ciclo', 'valor_mensal', 'inicio_em', 'teste_ate', 'proxima_cobranca_em', 'suporte_whatsapp', 'gerenciar_url', 'atualizado_em'];
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

  -- c) Forma de p_dados: objeto JSON, so as 10 chaves da lista, todas presentes.
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RAISE EXCEPTION 'dados_invalidos' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_campo FROM jsonb_object_keys(p_dados) AS k WHERE k <> ALL (v_chaves) ORDER BY k LIMIT 1;
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

  FOREACH v_campo IN ARRAY ARRAY['inicio_em', 'teste_ate', 'proxima_cobranca_em'] LOOP
    IF jsonb_typeof(p_dados -> v_campo) = 'null' THEN
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
      'proxima_cobranca_em', (v_datas ->> 'proxima_cobranca_em')::date,
      'suporte_whatsapp', v_whatsapp, 'gerenciar_url', v_url, 'atualizado_em', v_instante);
    IF v_existe THEN
      v_antes := jsonb_build_object(
        'plano', v_atual.plano, 'status', v_atual.status, 'ciclo', v_atual.ciclo, 'valor_mensal', v_atual.valor_mensal,
        'inicio_em', v_atual.inicio_em, 'teste_ate', v_atual.teste_ate, 'proxima_cobranca_em', v_atual.proxima_cobranca_em,
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

  -- e) Grava: UM comando atomico; o WHERE do ON CONFLICT e' quem barra a gravacao mais velha (inclusive na corrida entre duas conexoes). recursos e observacao ficam fora.
  INSERT INTO public.assinatura_da_loja AS a (id, plano, status, ciclo, valor_mensal, inicio_em, teste_ate, proxima_cobranca_em, suporte_whatsapp, gerenciar_url, atualizado_em)
  VALUES (1, v_plano, v_status, v_ciclo, v_valor, (v_datas ->> 'inicio_em')::date, (v_datas ->> 'teste_ate')::date, (v_datas ->> 'proxima_cobranca_em')::date, v_whatsapp, v_url, v_instante)
  ON CONFLICT (id) DO UPDATE SET
    plano = EXCLUDED.plano,
    status = EXCLUDED.status,
    ciclo = EXCLUDED.ciclo,
    valor_mensal = EXCLUDED.valor_mensal,
    inicio_em = EXCLUDED.inicio_em,
    teste_ate = EXCLUDED.teste_ate,
    proxima_cobranca_em = EXCLUDED.proxima_cobranca_em,
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
COMMENT ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) IS 'Porta unica do app de gestao: grava o cartao da assinatura (10 campos, lista branca; recursos e observacao nunca) quando p_chave bate com o hash guardado (senao nao_autorizado, sem dizer o motivo). Gravacao mais velha que a guardada e ignorada; p_simular mostra o que mudaria sem gravar. Chamar por POST (a chave nao pode ir na URL).';

DO $conferencia_rollback_20261590000000$
DECLARE
  v_oid oid := to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)');
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'assinatura_da_loja_gravar') <> 1
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM '565f82cb9a65ed96e4702db9d97bf0d6' THEN
    RAISE EXCEPTION 'conferencia rollback 20261590000000: a porta nao voltou ao corpo da 20261399998000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proretset AND NOT p.proisstrict
                    AND pg_get_function_result(p.oid) = 'jsonb'
                    AND pg_get_function_arguments(p.oid) = 'p_chave text, p_dados jsonb, p_simular boolean DEFAULT false'
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'conferencia rollback 20261590000000: os atributos da porta nao sao os da 20261399998000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261590000000: o EXECUTE da porta nao e o da 20261399998000 (so anon e authenticated)';
  END IF;
END $conferencia_rollback_20261590000000$;

NOTIFY pgrst, 'reload schema';

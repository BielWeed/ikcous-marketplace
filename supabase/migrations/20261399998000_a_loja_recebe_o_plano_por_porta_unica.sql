-- A LOJA RECEBE O PLANO POR UMA PORTA UNICA (13/11/2026; decisao do socio: o app de gestao do dono grava o "cartao da assinatura" de cada loja por uma porta com chave PROPRIA da loja, nao mais por upsert direto com a chave de servico)
-- RASCUNHO PARA REVISAO OPUS (permissao + dinheiro visivel + dado de cliente). Nada foi aplicado em banco algum.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. Cria 1 tabela e 2 funcoes NOVAS; nenhuma funcao, politica,
-- gatilho, grant ou tabela que ja existia e' redefinido ou removido (public.assinatura_da_loja e public.assinatura_da_loja_ler() NAO sao tocadas: o upsert direto do
-- hub continua funcionando ate ele migrar para a porta nova; fechar a escrita direta do service_role e' decisao POSTERIOR, de outro passo).
--
-- O DEFEITO: o card "Plano da loja" do Inicio le public.assinatura_da_loja (linha unica id = 1, 20261177000000). Quem a grava e' o hub de Gestao de Assinantes, por upsert
-- direto (POST /rest/v1/assinatura_da_loja) com a CHAVE DE SERVICO do Supabase da loja: poder TOTAL sobre o banco inteiro para gravar um cartao de 10 campos, cifrada no
-- hub. Uma chave de servico vazada (ou um hub comprometido) le e apaga pedido, cliente e dinheiro de TODAS as lojas cadastradas.
--
-- O QUE ENTRA (3 objetos novos):
--   (1) public.assinatura_da_loja_chave(id, chave_hash, criada_em): a linha unica (id = 1) que guarda o SHA-256 (64 hex minusculos) da chave da loja. NUNCA a chave.
--       RLS ligada SEM politica e REVOKE ALL de PUBLIC, anon, authenticated e service_role: ninguem de aplicacao le nem escreve a tabela; so as duas funcoes abaixo
--       (SECURITY DEFINER, do dono da tabela) passam. O Supabase concede tudo a objeto novo por padrao e as lojas clonadas tem ACL de fabrica diferente: o fechamento e' explicito.
--   (2) public.assinatura_da_loja_definir_chave(p_hash text, p_substituir boolean DEFAULT false) RETURNS void: guarda o hash (o app de gestao calcula o SHA-256 da chave
--       que ELE gerou; a chave nunca chega ao banco por esta porta). EXECUTE SO service_role (anon, authenticated e PUBLIC nao). Sem chave definida: grava. Com chave
--       definida e p_substituir falso (ou NULL): erro 'chave_ja_definida' (23505), mesmo que o hash seja o mesmo. Com p_substituir verdadeiro: troca (rotacao).
--   (3) public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb: a PORTA. EXECUTE para anon e authenticated (o hub
--       chama com a chave PUBLICA da loja + p_chave); service_role e PUBLIC nao. Descrita abaixo.
--
-- A PORTA (assinatura_da_loja_gravar), na ordem em que o corpo decide:
--   a) AUTENTICA ANTES DE OLHAR p_dados: SHA-256 de p_chave (builtin sha256(convert_to(...)), sem extensao) comparado com o hash guardado. Sem chave definida, chave
--      NULL, chave vazia ou chave diferente: a MESMA excecao 'nao_autorizado' (42501), sem dizer qual dos casos. Cada tentativa custa um hash e uma leitura de uma
--      linha. O banco so enxerga o hash: a chave precisa ser aleatoria (>= 128 bits); uma chave fraca nao se protege daqui.
--      Quem tem so o hash guardado NAO abre a porta (o hash enviado como chave e' hasheado de novo e nao bate): prova viva.
--   b) p_simular nulo = 'valor_invalido' (nunca vira escrita por acidente).
--   c) p_dados e' um objeto JSON; LISTA BRANCA de 10 chaves: plano, status, ciclo, valor_mensal, inicio_em, teste_ate, proxima_cobranca_em, suporte_whatsapp, gerenciar_url,
--      atualizado_em. Qualquer outra (recursos, observacao, id, qualquer nome) = 'campo_nao_permitido' (22023), antes de olhar os valores. As 10 sao OBRIGATORIAS
--      (chave ausente = 'campo_ausente'); null explicito = "nao tem" so nos campos que a tabela aceita nulos (valor_mensal, inicio_em, teste_ate, proxima_cobranca_em,
--      suporte_whatsapp, gerenciar_url).
--   d) Tipos e regras IGUAIS aos CHECKs da tabela, e mais estritos onde o banco arredondaria ou aceitaria texto solto (erro 'valor_invalido', 22023, com o NOME do campo
--      no DETAIL e nunca o valor):
--        plano     texto, 1 a 60 caracteres depois do btrim;      status  um dos 6 da tabela (ativa, teste, pendente, atrasada, suspensa, cancelada);
--        ciclo     um dos 4 da tabela (mensal, trimestral, semestral, anual);
--        valor_mensal  numero JSON (nunca texto), >= 0, ate 2 casas (49.995 e' recusado, nao arredondado: e' dinheiro que a lojista le) e < 100000000 (numeric(10,2));
--        datas     'AAAA-MM-DD' de dia real (2026-02-31, 'today', 'infinity', 20261113 e '2026-11-13 ' sao recusados);
--        atualizado_em  instante ISO 8601 COM fuso (Z ou +hh[:mm]) e NAO mais de 1 dia no futuro (um relogio errado no hub nao pode travar a gravacao para sempre);
--        suporte_whatsapp  so 10 a 15 digitos;    gerenciar_url  comeca com https://  (a mesma checagem da tabela).
--   e) GRAVA na linha id = 1 por UM comando atomico (INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE atualizado_em_guardado <= o_enviado):
--        - reescreve TODOS os 10 campos (null apaga o valor antigo) e NUNCA toca recursos nem observacao na atualizacao (na criacao da linha usam o default da tabela);
--        - se o atualizado_em enviado for MAIS VELHO que o ja gravado: nao grava e devolve {"gravado": false, "motivo": "mais_velho"} (uma gravacao atrasada nao
--          desfaz uma mais nova; igual NAO e' mais velho: regravar o mesmo carimbo e' idempotente). O WHERE do ON CONFLICT e' quem arbitra a corrida entre duas conexoes.
--        - devolve {"gravado": true, "atualizado_em": ..., "loja": <store_config.store_name da linha 1, ou null se a loja ainda nao tem nome>}.
--   f) p_simular verdadeiro: NAO grava (nenhum INSERT/UPDATE na tabela). Devolve {"gravado": false, "simulado": true, "loja": ..., "mudaria": {campo: {"de": x, "para": y}, ...},
--      "atual": {os 10 campos como estao agora, ou null se a linha nao existe}}; "mudaria" so traz o que difere (todos, se a linha nao existe) e vem {} + "motivo":
--      "mais_velho" se a gravacao real seria ignorada. A simulacao passa pela MESMA validacao: simular e' o jeito de achar um contrato torto sem escrever nada.
--   Nenhuma mensagem de erro carrega dado da loja: so o codigo, o nome do campo da lista branca (ou os 40 primeiros caracteres do nome estranho, so DEPOIS de autenticar).
--
-- O QUE A PORTA NAO FAZ: nao le nem devolve recursos, observacao, pedido, cliente ou dinheiro; nao apaga a linha; nao cria outra linha que nao a id = 1; nao aceita
-- chave de servico em lugar da chave da loja (service_role nao executa a porta; a sua porta e' definir_chave).
-- CHAMADA: PostgREST aceita GET em funcao VOLATILE (medido em 11/09/2026: roda em transacao somente-leitura). A chave so pode viajar no CORPO de um POST; um GET poria a chave
-- na URL e nos logs. Convencao do chamador (o hub), nao protecao do banco: o contrato esta em docs/runbooks/assinatura-da-loja.md.
--
-- DADOS EXISTENTES: nenhuma linha de tabela alguma e' lida, reescrita ou apagada pelo apply. public.assinatura_da_loja (com o cartao que o hub gravou) fica como esta;
-- a tabela da chave nasce VAZIA (sem chave definida a porta responde 'nao_autorizado' a todos: fechada por padrao). Reaplicar nao apaga a chave guardada:
-- CREATE TABLE IF NOT EXISTS nao toca a tabela que ja existe e as funcoes sao recriadas com o mesmo corpo.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e fazem COMMIT; qualquer erro, inclusive o
-- pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui (com eles o ROLLBACK da prova viraria no-op). Idempotente: IF NOT EXISTS na tabela,
-- CREATE OR REPLACE nas funcoes e REVOKE/GRANT de ACL explicita; rodar duas vezes nao erra, nao muda a chave guardada e nao toca o cartao.
-- DEPOIS da 20261177000000 (a tabela do cartao) e da 20260819000000 (store_config.store_name). O hub continua gravando por upsert direto enquanto nao migrar.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT): recusa sem escrever se faltarem os papeis anon/authenticated/service_role, se public.assinatura_da_loja nao tiver a forma
-- que a 20261177000000 criou (13 colunas) ou se public.store_config nao tiver id/store_name; se assinatura_da_loja_chave existir com outra forma; ou se
-- definir_chave/gravar existirem com corpo desconhecido, outra assinatura ou sobrecarga (so se aceita ausente ou igual ao desta migration).
-- POS-VOO (B2_POSVOO_DIVERGENTE): confere a tabela da chave (comum, RLS ligada sem FORCE, zero politica, nenhum privilegio de anon/authenticated/service_role/PUBLIC, colunas,
-- default, chave, CHECKs) e, em cada funcao, o corpo (md5), SECURITY DEFINER, volatilidade, search_path, retorno e o EXECUTE por papel; e que o dono das funcoes alcanca as
-- tabelas que elas escrevem. Catalogo apenas: o pos-voo NAO chama as funcoes (chamar gravar mexeria no cartao REAL da loja).
--
-- ROLLBACK: rollback-manual-20261399998000_a_loja_recebe_o_plano_por_porta_unica.sql tira as duas funcoes e a tabela da chave (SO o que esta migration criou; recusa corpo
-- desconhecido). A CHAVE (o hash) guardada se perde: depois de reaplicar, o app de gestao tem de mandar o hash de novo (definir_chave). O cartao (assinatura_da_loja)
-- NAO e' tocado. TIPOS: src/types/database.types.ts nao muda aqui (so o hub chama a porta; o app da loja nao).
-- FICHA DE VERIFICACAO: consultas 150c (depois) e 150d (antes); prova viva tests/banco/a-loja-recebe-o-plano-por-porta-unica-viva.cjs (rpc-ci).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261399998000$
DECLARE
  v_forma text;
  v_hash text;
  v_oid oid;
  v_f record;
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
     OR v_forma IS DISTINCT FROM 'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja nao tem a forma da 20261177000000 (%) - meca a loja e revise antes de seguir.', v_forma;
  END IF;

  IF to_regclass('public.store_config') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'store_name' AND a.atttypid = 'text'::regtype AND a.attnum > 0 AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'id' AND a.atttypid = 'bigint'::regtype AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config nao tem id bigint e store_name text - aplique a 20260819000000 antes.';
  END IF;

  IF to_regclass('public.assinatura_da_loja_chave') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.assinatura_da_loja_chave') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.assinatura_da_loja_chave') AND relkind = 'r')
       OR v_forma IS DISTINCT FROM 'chave_hash:text:true,criada_em:timestamp with time zone:true,id:smallint:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja_chave existe e nao tem a forma desta migration (%).', v_forma;
    END IF;
  END IF;

  FOR v_f IN
    SELECT * FROM (VALUES
      ('assinatura_da_loja_definir_chave', 'public.assinatura_da_loja_definir_chave(text, boolean)', 'ee89c0e70e378fe0be0fc3c805567d56'),
      ('assinatura_da_loja_gravar', 'public.assinatura_da_loja_gravar(text, jsonb, boolean)', '565f82cb9a65ed96e4702db9d97bf0d6')
    ) AS t(nome, assinatura, hash)
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public - revise antes de aplicar.', v_f.nome;
    END IF;
    v_oid := to_regprocedure(v_f.assinatura);
    IF v_oid IS NOT NULL THEN
      SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
      IF v_hash IS DISTINCT FROM v_f.hash THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ja existe com corpo desconhecido (hash %) - ninguem revisou essa redefinicao; capture o corpo vivo e revise antes de aplicar.', v_f.assinatura, COALESCE(v_hash, 'ausente');
      END IF;
    ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % existe em public com outra assinatura - revise antes de aplicar.', v_f.nome;
    END IF;
  END LOOP;
END $preflight_20261399998000$;

-- ===== (1) a tabela da chave: fechada a todo papel de aplicacao =====

CREATE TABLE IF NOT EXISTS public.assinatura_da_loja_chave (
  id smallint NOT NULL DEFAULT 1,
  chave_hash text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assinatura_da_loja_chave_pkey PRIMARY KEY (id),
  CONSTRAINT assinatura_da_loja_chave_id_check CHECK (id = 1),
  CONSTRAINT assinatura_da_loja_chave_chave_hash_check CHECK (chave_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE public.assinatura_da_loja_chave IS 'Hash SHA-256 (64 hex minusculos) da chave com que o app de gestao grava o cartao da assinatura desta loja; linha unica (id = 1). NUNCA a chave. Ninguem de aplicacao le nem escreve: so assinatura_da_loja_definir_chave e assinatura_da_loja_gravar (SECURITY DEFINER).';

ALTER TABLE public.assinatura_da_loja_chave ENABLE ROW LEVEL SECURITY;
-- As lojas clonadas tem ACL de fabrica diferente: o REVOKE e' explicito, nunca depende do default.
REVOKE ALL ON TABLE public.assinatura_da_loja_chave FROM PUBLIC, anon, authenticated, service_role;

-- ===== (2) guardar o hash da chave: so service_role =====

CREATE OR REPLACE FUNCTION public.assinatura_da_loja_definir_chave(p_hash text, p_substituir boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_linhas integer;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hash_invalido' USING ERRCODE = '22023';
  END IF;

  IF p_substituir IS TRUE THEN
    INSERT INTO public.assinatura_da_loja_chave AS k (id, chave_hash)
    VALUES (1, p_hash)
    ON CONFLICT (id) DO UPDATE SET chave_hash = EXCLUDED.chave_hash, criada_em = now();
    RETURN;
  END IF;

  INSERT INTO public.assinatura_da_loja_chave (id, chave_hash)
  VALUES (1, p_hash)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas = 0 THEN
    RAISE EXCEPTION 'chave_ja_definida' USING ERRCODE = '23505';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) TO service_role;
COMMENT ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) IS 'Guarda o SHA-256 (64 hex minusculos) da chave da loja. Sem chave: grava. Com chave e p_substituir falso ou nulo: erro chave_ja_definida (23505). Com p_substituir verdadeiro: troca. So service_role executa; a chave nunca chega aqui, so o hash.';

-- ===== (3) a porta: gravar o cartao da assinatura com a chave da loja =====

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

-- ===== pos-voo =====

DO $conferencia_20261399998000$
DECLARE
  v_tab oid := to_regclass('public.assinatura_da_loja_chave');
  v_papel text;
  v_privilegio text;
  v_f record;
  v_oid oid;
  v_hash text;
  v_dono oid;
  v_dono_gravar oid;
  v_dono_definir oid;
BEGIN
  IF v_tab IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_tab AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: assinatura_da_loja_chave tem de ser tabela comum com a RLS ligada (sem FORCE).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_tab) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: assinatura_da_loja_chave nao pode ter politica: a RLS sem politica e a segunda fechadura.';
  END IF;
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_papel, v_tab, v_privilegio) THEN
        RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem % em assinatura_da_loja_chave.', v_papel, v_privilegio;
      END IF;
    END LOOP;
    IF has_any_column_privilege(v_papel, v_tab, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem privilegio de coluna em assinatura_da_loja_chave.', v_papel;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
              WHERE c.oid = v_tab AND a.grantee = 0) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: PUBLIC tem privilegio em assinatura_da_loja_chave.';
  END IF;

  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
        FROM pg_attribute a WHERE a.attrelid = v_tab AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'chave_hash:text:true,criada_em:timestamp with time zone:true,id:smallint:true'
     OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                     WHERE d.adrelid = v_tab AND a.attname = 'id' AND pg_get_expr(d.adbin, d.adrelid) = '1')
     OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                     WHERE d.adrelid = v_tab AND a.attname = 'criada_em' AND pg_get_expr(d.adbin, d.adrelid) = 'now()')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'p' AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (id)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'c' AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((id=1))')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'c'
                      AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((chave_hash~''^[0-9a-f]{64}$''::text))')
     OR (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = v_tab) <> 3 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: as colunas, os defaults, a chave ou os CHECKs de assinatura_da_loja_chave nao sao os desta migration.';
  END IF;

  FOR v_f IN
    SELECT * FROM (VALUES
      ('assinatura_da_loja_definir_chave', 'public.assinatura_da_loja_definir_chave(text, boolean)', 'ee89c0e70e378fe0be0fc3c805567d56', 'void', false, false),
      ('assinatura_da_loja_gravar', 'public.assinatura_da_loja_gravar(text, jsonb, boolean)', '565f82cb9a65ed96e4702db9d97bf0d6', 'jsonb', true, true)
    ) AS t(nome, assinatura, hash, retorno, anon_executa, authenticated_executa)
  LOOP
    v_oid := to_regprocedure(v_f.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % sumiu.', v_f.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) <> 1 THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % ficou com sobrecarga.', v_f.nome;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM v_f.hash THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: corpo vivo de % (hash %) nao e o desta migration.', v_f.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                      AND NOT p.proretset AND NOT p.proisstrict
                      AND pg_get_function_result(p.oid) = v_f.retorno
                      AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: os atributos de % mudaram (SECURITY DEFINER, VOLATILE, search_path, retorno).', v_f.assinatura;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % alcancavel por PUBLIC.', v_f.assinatura;
    END IF;
    IF has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM (v_f.nome = 'assinatura_da_loja_definir_chave')
       OR has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM v_f.anon_executa
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM v_f.authenticated_executa THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o EXECUTE de % esta errado (definir_chave so service_role; gravar so anon e authenticated).', v_f.assinatura;
    END IF;
    -- O dono da funcao e' quem escreve nas tabelas (SECURITY DEFINER): ou e' dono delas, ou passa a RLS (superusuario / BYPASSRLS).
    SELECT p.proowner INTO v_dono FROM pg_proc p WHERE p.oid = v_oid;
    IF NOT (EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = v_dono AND (r.rolsuper OR r.rolbypassrls))
            OR (v_dono = (SELECT relowner FROM pg_class WHERE oid = v_tab)
                AND v_dono = (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.assinatura_da_loja')))) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de % nao passa a RLS das tabelas que ela escreve.', v_f.assinatura;
    END IF;
  END LOOP;
  -- has_table_privilege com lista devolve verdadeiro se tiver QUALQUER uma: um a um.
  SELECT proowner INTO v_dono_gravar FROM pg_proc WHERE oid = to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)');
  SELECT proowner INTO v_dono_definir FROM pg_proc WHERE oid = to_regprocedure('public.assinatura_da_loja_definir_chave(text, boolean)');
  FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT has_table_privilege(v_dono_gravar, to_regclass('public.assinatura_da_loja'), v_privilegio)
       OR NOT has_table_privilege(v_dono_gravar, v_tab, 'SELECT')
       OR NOT has_table_privilege(v_dono_definir, v_tab, v_privilegio) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono das funcoes nao tem % nas tabelas que elas escrevem.', v_privilegio;
    END IF;
  END LOOP;
  IF NOT has_column_privilege(v_dono_gravar, to_regclass('public.store_config'), 'store_name', 'SELECT') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de assinatura_da_loja_gravar nao le store_config.store_name.';
  END IF;
END $conferencia_20261399998000$;

NOTIFY pgrst, 'reload schema';

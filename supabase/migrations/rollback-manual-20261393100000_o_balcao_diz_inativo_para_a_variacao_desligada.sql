-- ============================================================================
-- Rollback manual — o balcão diz "inativo" para a variação desligada (20261393100000)
-- ============================================================================
-- Recria public.buscar_por_codigo_barras(text) com o corpo VIGENTE de antes (o da
-- 20261381000000, byte a byte: o md5 de replace(prosrc, E'\r', '') volta a ser
-- e1b93114cd9deee7eda6801ef37ff1f9, e a prova viva confere). Assinatura, SECURITY DEFINER, STABLE, search_path e retorno
-- são os mesmos da migration.
--
-- A ACL NÃO é tocada: CREATE OR REPLACE preserva dono e privilégios, e este arquivo não tem
-- nenhum GRANT nem REVOKE — nunca devolve EXECUTE a anon ou a PUBLIC.
--
-- COM ELE VOLTA O DEFEITO: o código de uma variação desligada volta a responder "não encontrado"
-- no balcão (e a tela de produto volta a só descobrir a colisão na hora de gravar).
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo
-- vivo não for um dos dois conhecidos (o desta migration, ou o vigente — e então rodar de novo
-- reescreve o mesmo texto) — reescrever por cima de um corpo desconhecido apagaria uma
-- redefinição que ninguém revisou; se os atributos não forem os de sempre; ou se PUBLIC tiver
-- EXECUTE ou authenticated/service_role não tiverem. A conferência final recusa se o corpo não
-- voltou ao vigente, se algum atributo mudou ou se PUBLIC passou a executar.
--
-- ORDEM: este vem ANTES do rollback da 20261381000000, se os dois forem rodados.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo
-- estado.
-- ============================================================================

DO $preflight_rollback_20261393100000$
DECLARE
  v_fn CONSTANT text := 'public.buscar_por_codigo_barras(text)';
  v_oid oid := to_regprocedure('public.buscar_por_codigo_barras(text)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'buscar_por_codigo_barras') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: buscar_por_codigo_barras tem sobrecarga em public — revise antes de devolver o corpo vigente.';
  END IF;

  -- O corpo vivo tem de ser o desta migration (desfaz) ou o vigente (já desfeito: reescreve o mesmo texto).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (
       'e1b93114cd9deee7eda6801ef37ff1f9', -- corpo da 20261381000000 (o que este rollback devolve)
       '3e2276ae97a7f2aef487e55d259ba7a3'  -- corpo desta migration (o que este rollback desfaz)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o vigente — uma redefinição posterior está no ar; revise antes de sobrescrever.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_codigo text'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está aberta para PUBLIC — o estado de antes nunca teve PUBLIC; revise a ACL antes.', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (anon sem, authenticated e service_role com) — revise a ACL antes.', v_fn;
  END IF;
END $preflight_rollback_20261393100000$;

CREATE OR REPLACE FUNCTION public.buscar_por_codigo_barras(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    -- O codigo ja' normalizado: e' ele que vai na comparacao e no retorno,
    -- para a tela ecoar exatamente o que foi procurado.
    v_codigo text;
    -- 'variante', 'produto' ou NULL (nao achou). E' quem define `encontrado`.
    v_origem text := NULL;
    v_produto jsonb := NULL;
    v_variante jsonb := NULL;
    v_preco numeric := NULL;
    v_estoque integer := NULL;
    -- Lista vazia, NUNCA NULL: a tela faz `for` em cima dela sem perguntar.
    v_variacoes jsonb := '[]'::jsonb;
BEGIN
    -- GATE (D6). Primeira instrucao do corpo, antes de qualquer leitura:
    -- SECURITY DEFINER roda com o cracha' do dono, por cima da RLS, entao uma
    -- consulta antes daqui ja' e' catalogo vazando. `IS DISTINCT FROM true`
    -- porque `NOT NULL` e' NULL — com `NOT public.is_admin()` o portao ficaria
    -- aberto no caso mais estranho.
    IF public.is_admin_atual() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja consulta código de barras.';
    END IF;

    -- NORMALIZACAO. `btrim` de DOIS argumentos, e nao o de um: `btrim(text)`
    -- sozinho apara APENAS espaco (' '), nunca \n, \r nem \t — medido no
    -- Postgres 16, `btrim(E'7891000000011\r\n')` devolve os 15 caracteres com
    -- o CRLF inteiro. E o leitor fisico se apresenta como TECLADO: termina o
    -- bipe com Enter (src/lib/leitor/buffer-do-leitor-fisico.ts), e EAN colado
    -- de planilha do fornecedor vem com CRLF. Com a forma de um argumento, o
    -- balcao diria "nao cadastrado" para produto que ESTA' cadastrado, e a
    -- entrada so'-branco escaparia do 22023 abaixo.
    v_codigo := NULLIF(btrim(p_codigo, E' \t\r\n'), '');
    IF v_codigo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o código de barras.';
    END IF;
    -- TETO: o leitor fisico se apresenta como TECLADO. Buffer estragado manda
    -- quilobytes, e sem este teto isso vira uma chave gigante comparada linha
    -- a linha. EAN-13 tem 13 digitos; GTIN-14, 14.
    IF length(v_codigo) > 64 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Código de barras inválido.';
    END IF;

    -- 1) A VARIACAO primeiro: o codigo de barras de verdade e' o da EMBALAGEM,
    -- e e' a caixa da combinacao ("Branca/PP") que o operador bipa. Como a
    -- unicidade do codigo e' POR TABELA (20261160000000), o mesmo codigo pode
    -- existir nas duas — a precedencia da variacao E' a regra desta RPC, e a
    -- pendencia que a C1.1 deixou registrada para ca'.
    -- `=` e nao `LIKE`: e' o que faz o indice unico parcial da C1.1 valer, e e'
    -- a unica leitura honesta de um codigo (um EAN pode ser prefixo de outro).
    SELECT
        jsonb_build_object(
            'id', p.id,
            'nome', p.nome,
            'ativo', p.ativo,
            'preco_venda', p.preco_venda,
            'estoque', p.estoque,
            'imagem', COALESCE(NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
            'codigo_barras', p.codigo_barras,
            -- Achamos uma variacao ATIVA deste produto: o EXISTS seria
            -- verdadeiro por construcao, e uma consulta a mais nao compra
            -- verdade nenhuma.
            'tem_variantes', true
        ),
        jsonb_build_object(
            'id', v.id,
            'variant_id', v.id,
            'nome', v.name,
            'valor', v.value,
            'preco', COALESCE(v.price_override, p.preco_venda),
            'estoque', v.stock_increment,
            'imagem', COALESCE(NULLIF(v.image_url, ''), NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
            'codigo_barras', v.codigo_barras
        ),
        -- A MESMA regra do checkout online (20261081000000:227) e do front
        -- (src/lib/preco-vendido.ts:19-24): so' cai no preco do produto quando
        -- o override e' NULL, porque ZERO e' preco legitimo (brinde).
        COALESCE(v.price_override, p.preco_venda),
        v.stock_increment
    INTO v_produto, v_variante, v_preco, v_estoque
    FROM public.product_variants v
    JOIN public.produtos p ON p.id = v.product_id
    WHERE v.codigo_barras = v_codigo
      AND v.active = true
      AND p.deleted_at IS NULL;

    IF FOUND THEN
        v_origem := 'variante';
    ELSE
        -- 2) O PRODUTO PAI. `deleted_at IS NULL` porque o delete de produto
        -- aqui e' SOFT: produto apagado e' INEXISTENTE. Mas `ativo = false`
        -- NAO filtra — produto inativo e' devolvido com "ativo": false, porque
        -- "inativo" e' um terceiro caso honesto, diferente de "nao cadastrado"
        -- e de "esgotado", e a tela precisa contar os tres de formas
        -- diferentes (cadastrar / reativar / repor).
        SELECT
            jsonb_build_object(
                'id', p.id,
                'nome', p.nome,
                'ativo', p.ativo,
                'preco_venda', p.preco_venda,
                'estoque', p.estoque,
                'imagem', COALESCE(NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
                'codigo_barras', p.codigo_barras,
                -- MESMO predicado com que a v23 EXIGE variacao
                -- (20261081000000:276-281): se ele mentir, o balcao vende o
                -- produto base de um produto que so' existe em combinacao.
                'tem_variantes', EXISTS (
                    SELECT 1 FROM public.product_variants v2
                     WHERE v2.product_id = p.id AND v2.active = true
                )
            ),
            p.preco_venda,
            p.estoque,
            -- A folha de escolha da combinacao (§5.3, item 1): o operador bipou
            -- a etiqueta do MODELO e precisa dizer qual caixa esta' levando.
            -- `jsonb_agg` de conjunto vazio e' NULL, e NULL aqui obrigaria a
            -- tela a testar antes de iterar — dai' o COALESCE para '[]'.
            COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'variant_id', v2.id,
                        'nome', v2.name,
                        'valor', v2.value,
                        'preco', COALESCE(v2.price_override, p.preco_venda),
                        'estoque', v2.stock_increment,
                        'imagem', COALESCE(NULLIF(v2.image_url, ''), NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
                        'codigo_barras', v2.codigo_barras
                    )
                    -- Ordem estavel: o operador escolhe por leitura, nao pela
                    -- sorte do planejador.
                    ORDER BY v2.name ASC, v2.value ASC
                )
                FROM public.product_variants v2
                WHERE v2.product_id = p.id AND v2.active = true
            ), '[]'::jsonb)
        INTO v_produto, v_preco, v_estoque, v_variacoes
        FROM public.produtos p
        WHERE p.codigo_barras = v_codigo
          AND p.deleted_at IS NULL;

        IF FOUND THEN
            v_origem := 'produto';
        ELSE
            -- `SELECT ... INTO` sem linha ZERA todas as variaveis de destino,
            -- inclusive `v_variacoes`. Repor a lista vazia aqui e' o que
            -- mantem o contrato: a chave existe sempre e nunca e' NULL.
            v_produto := NULL;
            v_preco := NULL;
            v_estoque := NULL;
            v_variacoes := '[]'::jsonb;
        END IF;
    END IF;

    -- UM retorno so', no fim: com dois caminhos de saida e' assim que uma das
    -- chaves some no caso raro. CODIGO NAO ENCONTRADO NAO E' ERRO — e' este
    -- mesmo objeto com `encontrado` falso, e a tela mostra o cartao "nao
    -- cadastrado" com o atalho de cadastro (§5.3).
    RETURN jsonb_build_object(
        'encontrado', v_origem IS NOT NULL,
        'origem', v_origem,
        'codigo', v_codigo,
        'produto', v_produto,
        'variante', v_variante,
        'preco', v_preco,
        'estoque', v_estoque,
        'variacoes', v_variacoes
    );
END;
$function$;

-- CONFERÊNCIA: o corpo voltou ao vigente (o da 20261381000000), atributos e ACL de sempre.
DO $conferencia_rollback_20261393100000$
DECLARE
  v_fn CONSTANT text := 'public.buscar_por_codigo_barras(text)';
  v_oid oid := to_regprocedure('public.buscar_por_codigo_barras(text)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'e1b93114cd9deee7eda6801ef37ff1f9' THEN
    RAISE EXCEPTION 'conferencia rollback 20261393100000: corpo vivo de % (hash %) não voltou ao vigente', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_codigo text'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261393100000: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261393100000: ACL de % mudou', v_fn;
  END IF;
END $conferencia_rollback_20261393100000$;

-- ============================================================================
-- Migration 20261393100000 — o balcão diz "inativo" para a variação desligada
-- (balcão; caçada de 26/10/2026; só LEITURA; troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
-- public.buscar_por_codigo_barras(text) é o que o balcão (e a tela de produto) pergunta ao bipar um
-- código. Ela procura primeiro a variação ATIVA com aquele código (v.active = true) e depois o
-- produto. Se a variação foi DESLIGADA pela lojista, a primeira busca não a acha, a segunda
-- também não, e a resposta é "encontrado: false": o balcão mostra "Código não encontrado. Não está
-- cadastrado... cadastre o produto". Só que a variação desligada continua dona do código (o índice
-- único de código de barras da variação não olha "active"): o cadastro novo recusa o código porque
-- ele já existe. A lojista fica sem saída. Para PRODUTO inativo a função já responde, de propósito,
-- o terceiro caso "cadastrado mas inativo" (20261161000000): devolve o produto com ativo = false.
--
-- 2. A REGRA NOVA
--
-- Variação inativa com o código cai no MESMO terceiro caso. Depois de não achar variação ativa nem
-- produto, a função procura uma variação (ativa não é, porque a primeira busca já a teria
-- achado) com aquele código cujo produto não esteja apagado. Se acha, responde:
--   encontrado = true, origem = 'variante', produto = o produto-pai com ativo = false,
--   variante = a variação (com variant_id), preço e estoque dela, variacoes = [].
-- A tela já lê isso: com produto.ativo = false mostra "Produto inativo — está inativo no catálogo.
-- Não foi adicionado à venda." (src/hooks/useVendaPresencial.ts, CupomDaVenda). "ativo = false"
-- vale aqui para "o que este código vende está desligado", mesmo que o produto-pai esteja ativo:
-- é o sinal que o balcão já entende, e um balcão que ainda não recebeu nenhum front novo também
-- RECUSA a venda (nunca a aceita). Nenhum front muda.
--
-- 3. O QUE MUDA NO CORPO (só esta troca; o resto não muda um byte)
--
-- O ELSE final (nem variação ativa, nem produto) ganha, antes de zerar as variáveis, a busca da
-- variação desligada; as quatro linhas que zeravam as variáveis passam a ficar dentro de um IF
-- FOUND ... ELSE (mais quatro espaços de recuo). A busca da variação ativa, a do produto, o
-- gate is_admin_atual(), a normalização do código, o teto de 64 caracteres, a assinatura,
-- STABLE, SECURITY DEFINER, search_path ('pg_catalog', 'pg_temp'), o retorno e a ACL NÃO mudam.
-- A busca nova só usa colunas que o corpo vivo já lê.
--
-- 4. O QUE ACONTECE EM CADA CASO
--
--   * variação ATIVA com o código: como antes (origem 'variante', produto.ativo do produto);
--   * produto (ativo ou inativo) com o código: como antes (origem 'produto');
--   * variação DESLIGADA com o código, produto não apagado: AGORA encontrado = true, ativo = false
--     (antes: encontrado = false);
--   * variação desligada de produto apagado (deleted_at): como antes, não encontrado;
--   * código que ninguém tem: como antes, não encontrado, mesmas chaves, variacoes = [];
--   * a tela de produto (conferir código duplicado): o código de uma variação desligada agora
--     aparece como já usado ("Este código já está em <produto>, variação ..."), em vez de passar
--     e ser recusado só na hora de gravar; editar a própria variação desligada não se acusa.
--
-- 5. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem reescrita ao aplicar: só o corpo de UMA função (STABLE, só leitura)
-- muda. Variações já desligadas passam a ser achadas pelo código na próxima bipada.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r',
-- '')) não for UM dos dois conhecidos (o da 20261381000000, e1b93114cd9deee7eda6801ef37ff1f9, ou o desta
-- migration, 3e2276ae97a7f2aef487e55d259ba7a3); os atributos não forem os de sempre; ou a ACL não for
-- EXATAMENTE a de hoje (PUBLIC não, anon não, authenticated sim, service_role sim). Os hashes são
-- o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_balcao_diz_inativo_para_a_variacao_desligada_test.ts.
--
-- 7. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada: corpo da 20261381000000 (aplica) ou corpo desta migration (reaplicar
-- reescreve o MESMO texto). Qualquer outro estado ABORTA. Sem BEGIN/COMMIT de nível superior
-- (regra da casa): quem abre a transação é o aplicador; o pré-voo, a troca do corpo e a
-- conferência final caem juntos ou não caem.
--
-- 8. ORDEM E ROLLBACK
--
-- Depois da 20261381000000 (o pré-voo recusa sem ela). ROLLBACK MANUAL:
-- rollback-manual-20261393100000_o_balcao_diz_inativo_para_a_variacao_desligada.sql devolve o corpo
-- da 20261381000000 byte a byte. Este rollback vem ANTES do rollback da 20261381000000 (o dela
-- recusa enquanto este corpo estiver no ar). A consulta 86a e a 9a aceitam o corpo desta
-- migration como sucessor do da 381.
--
-- 9. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.buscar_por_codigo_barras(text)');
--      -- esperado: 3e2276ae97a7f2aef487e55d259ba7a3.
--   2. Como admin: public.buscar_por_codigo_barras('<código de uma variação desligada>') devolve
--      encontrado = true e produto.ativo = false.
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/o-balcao-diz-inativo-para-a-variacao-desligada-viva.cjs (rpc-ci);
--   portão da release: consultas 104a e 104b.
-- ============================================================================

DO $preflight_20261393100000$
DECLARE
  v_fn CONSTANT text := 'public.buscar_por_codigo_barras(text)';
  v_oid oid := to_regprocedure('public.buscar_por_codigo_barras(text)');
  v_hash text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'buscar_por_codigo_barras') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: buscar_por_codigo_barras tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261381000000, aplica) ou o desta migration (reaplicar é no-op).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (
       'e1b93114cd9deee7eda6801ef37ff1f9', -- corpo da 20261381000000 (vigente até aqui)
       '3e2276ae97a7f2aef487e55d259ba7a3'  -- corpo que ESTA migration deixa — reaplicação idempotente
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261381000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- ACL exatamente a de hoje (PUBLIC medido por aclexplode, grantee = 0): o CREATE OR REPLACE a preserva.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_servico := has_function_privilege('service_role', v_oid, 'EXECUTE');
  IF NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC=%, anon=%, authenticated=%, service_role=%) — meça a loja e revise.', v_fn, v_public, v_anon, v_auth, v_servico;
  END IF;
END $preflight_20261393100000$;

-- buscar_por_codigo_barras: corpo vigente da 20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql,
-- com a busca da variação desligada (a troca declarada no cabeçalho, item 3).
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
            -- 3) A VARIACAO DESLIGADA (20261393100000). Chegar aqui quer dizer
            -- que nenhuma variacao ATIVA e nenhum produto tem este codigo. Mas
            -- o indice unico de variacao NAO olha `active`: a variacao que o
            -- lojista desligou continua dona do codigo (e o cadastro novo o
            -- recusa por isso). Dizer "nao cadastrado" aqui mandava a pessoa
            -- cadastrar o que o banco nao deixa cadastrar. Ela cai no MESMO
            -- terceiro caso do produto inativo: `encontrado` verdadeiro e
            -- `produto.ativo` falso, que a tela le como "inativo" (nao foi
            -- adicionado a venda). `ativo` falso vale aqui para "o que este
            -- codigo vende esta desligado", mesmo que o produto-pai esteja
            -- ativo: e' o sinal que o balcao e a tela de venda ja entendem, e
            -- um balcao que ainda nao recebeu o front novo tambem recusa a
            -- venda (nunca a aceita). `origem` e' 'variante' e `variante`
            -- carrega o id: e' o que o cadastro usa para saber se o codigo e'
            -- da propria variacao que esta sendo editada. Fica DEPOIS do
            -- produto de proposito: quem ja era achado continua sendo.
            SELECT
                jsonb_build_object(
                    'id', p.id,
                    'nome', p.nome,
                    'ativo', false,
                    'preco_venda', p.preco_venda,
                    'estoque', p.estoque,
                    'imagem', COALESCE(NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
                    'codigo_barras', p.codigo_barras,
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
                COALESCE(v.price_override, p.preco_venda),
                v.stock_increment
            INTO v_produto, v_variante, v_preco, v_estoque
            FROM public.product_variants v
            JOIN public.produtos p ON p.id = v.product_id
            WHERE v.codigo_barras = v_codigo
              AND v.active IS DISTINCT FROM true
              AND p.deleted_at IS NULL;

            IF FOUND THEN
                v_origem := 'variante';
                -- `SELECT ... INTO` sem linha do produto zerou `v_variacoes`:
                -- a lista vazia e' o contrato (como no caso 'variante' ativo).
                v_variacoes := '[]'::jsonb;
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

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a ACL não ficou PUBLIC não, anon não, authenticated sim, service_role sim.
DO $conferencia_20261393100000$
DECLARE
  v_fn CONSTANT text := 'public.buscar_por_codigo_barras(text)';
  v_oid oid := to_regprocedure('public.buscar_por_codigo_barras(text)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261393100000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'buscar_por_codigo_barras') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261393100000: buscar_por_codigo_barras ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '3e2276ae97a7f2aef487e55d259ba7a3' THEN
    RAISE EXCEPTION 'conferencia 20261393100000: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'conferencia 20261393100000: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261393100000: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261393100000: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261393100000: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261393100000: service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261393100000$;

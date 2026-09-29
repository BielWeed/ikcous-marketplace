-- ============================================================================
-- Migration 20261161000000 — o balcão acha o produto pelo código
-- (LOTE C1 da venda presencial/PDV, tarefa C1.2; desenho em
-- docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md §5.3,
-- decisão do dono D6 — só admin, is_admin())
-- ============================================================================
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: a 20261160000000 (C1.1) abriu as duas
-- colunas `codigo_barras` — em `produtos` e em `product_variants` —, mas NÃO
-- existe como perguntar por elas. Quem bipa um EAN-13 no balcão não tem RPC
-- nenhuma para chamar: hoje a tela teria de montar a busca no cliente, com
-- `select` direto na tabela, e aí quatro coisas dão errado ao mesmo tempo:
--   (a) a busca do cliente seria por `ilike`/prefixo (é o que toda tela de
--       busca deste app faz hoje), e isso JOGA FORA os dois índices únicos
--       parciais que a C1.1 acabou de criar — varredura de tabela a cada
--       bipe — além de achar o produto ERRADO quando um EAN é prefixo de
--       outro;
--   (b) o preço viria do cliente. Preço que o cliente manda é preço que o
--       cliente escolhe; e a regra de preço de variação deste app não é
--       óbvia (`COALESCE(v.price_override, p.preco_venda)`, porque override
--       ZERO é preço legítimo de brinde — 20261081000000:227 e
--       src/lib/preco-vendido.ts:19-24). Duas cópias da regra divergem no
--       primeiro brinde cadastrado;
--   (c) a tela precisa distinguir TRÊS casos que o `select` cru mistura:
--       "não cadastrado", "cadastrado mas inativo" e "cadastrado e esgotado".
--       Sem um contrato fixo de retorno, cada tela adivinha de um jeito;
--   (d) o código de barras de verdade é o da EMBALAGEM, isto é, o da
--       VARIAÇÃO ("Branca/PP"). Um bipe pode cair na variação OU no produto
--       pai, e a precedência entre os dois é regra de negócio — a própria
--       C1.1 registrou isso como pendência a ser resolvida aqui (a
--       unicidade do código é POR TABELA, então o mesmo EAN pode existir nas
--       duas; 20261160000000, seção PENDÊNCIA REGISTRADA).
-- Esta migration cria a ÚNICA porta de busca por código de barras: uma RPC de
-- admin que devolve produto e variação JÁ RESOLVIDOS, com preço e estoque
-- calculados no servidor.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `CREATE OR REPLACE FUNCTION public.buscar_por_codigo_barras(p_codigo
--      text) RETURNS jsonb`, `LANGUAGE plpgsql STABLE SECURITY DEFINER SET
--      search_path = pg_catalog, pg_temp`. STABLE porque a função só LÊ (o
--      planejador pode reusar o resultado dentro da mesma instrução).
--      SECURITY DEFINER porque o painel lê `produtos` por GRANT de coluna e
--      `product_variants` pela RLS: o crachá do dono é o que deixa a RPC
--      montar a resposta inteira numa consulta só, com o gate de admin dentro
--      dela (é o padrão de RPC de admin da casa,
--      .claude/commands/nova-migration.md:63-64). O `search_path` restrito a
--      `pg_catalog, pg_temp` é o molde de 20261122000000:93-95 e obriga a
--      QUALIFICAR tudo (`public.produtos`, `public.is_admin()`): sem isso,
--      um esquema plantado na frente do `public` sequestraria a leitura de
--      uma função que roda com privilégio elevado.
--   2. GATE, primeira instrução do corpo: `IF public.is_admin() IS DISTINCT
--      FROM true THEN RAISE EXCEPTION USING ERRCODE='42501' ...`. Primeira
--      mesmo — antes até de normalizar o parâmetro. Com SECURITY DEFINER,
--      qualquer leitura antes do gate é catálogo vazando (preço, estoque e
--      `ativo` são inteligência de loja). `IS DISTINCT FROM true` e não `NOT
--      ...`: se `is_admin()` devolvesse NULL, `NOT NULL` é NULL e o `IF` não
--      dispara — o portão ficaria aberto para o caso mais estranho.
--   3. NORMALIZAÇÃO do parâmetro: `NULLIF(btrim(p_codigo, E' \t\r\n'), '')`,
--      com o conjunto de caracteres ESCRITO — espaço, TAB, CR e LF. O `btrim`
--      de um argumento só apara espaço, e o bipe do leitor termina em Enter
--      (CR/LF) e o EAN colado de planilha vem com CRLF: com a forma curta, um
--      produto cadastrado voltaria como "não cadastrado". Recusa com ERRCODE
--      22023 se vier vazio (ou só branco), e TETO DE 64 CARACTERES, também
--      22023. O teto não é firula: o leitor físico é um TECLADO, e um buffer
--      estragado manda quilobytes — sem o teto isso vira uma chave gigante
--      comparada linha a linha (EAN-13 tem 13 dígitos; GTIN-14, 14; o maior
--      código de barras usado no varejo não passa de algumas dezenas).
--   4. BUSCA EM DOIS TEMPOS, sempre com `=` (IGUALDADE EXATA — nunca `LIKE`,
--      nunca `ILIKE`, nunca similaridade): é o que faz os índices únicos
--      parciais da C1.1 valerem, e é a única leitura HONESTA de um código de
--      barras (dois EANs diferentes podem ser prefixo um do outro).
--      Primeiro a VARIAÇÃO (`public.product_variants` com `active = true`,
--      juntando `public.produtos` com `deleted_at IS NULL`) — a variação
--      ganha porque é a caixa dela que é bipada; depois, só se não achou, o
--      PRODUTO PAI. Essa é a regra de precedência que a C1.1 deixou em
--      aberto.
--   5. AS TRÊS AUSÊNCIAS, que não são a mesma coisa: produto com `deleted_at`
--      preenchido é INEXISTENTE (o delete de produto aqui é SOFT,
--      .claude/commands/nova-migration.md:162) e as duas buscas o filtram;
--      produto com `ativo = false` É DEVOLVIDO, com `"ativo": false`, porque
--      "inativo" é um terceiro caso honesto, diferente de "não cadastrado" e
--      de "esgotado" — a tela do PDV precisa contar os três de formas
--      diferentes (cadastrar / reativar / repor); `estoque` zero volta como
--      zero, não como ausência.
--   6. FORMATO FIXO DO RETORNO — SEMPRE as mesmas oito chaves, mesmo quando
--      não achou nada: `encontrado`, `origem` (`'produto'`/`'variante'`/NULL),
--      `codigo`, `produto`, `variante`, `preco`, `estoque`, `variacoes`.
--      CÓDIGO NÃO ENCONTRADO NÃO É ERRO: devolve o mesmo objeto com
--      `encontrado` falso, e a tela mostra o cartão "não cadastrado" com o
--      atalho de cadastro (§5.3). Devolver NULL no lugar do objeto obrigaria
--      cada chamador a adivinhar o motivo. Há um RETURN só, no fim do corpo,
--      justamente para o contrato não depender do caminho percorrido.
--      (A ficha da tarefa fala em "9 chaves" e ENUMERA oito; o que vale é a
--      enumeração, que é a mesma nos dois lugares em que ela aparece —
--      inventar uma nona chave quebraria o contrato em vez de cumpri-lo.)
--   7. CAMPOS DERIVADOS, todos calculados no SERVIDOR e nenhum vindo de
--      parâmetro: `preco` = `COALESCE(v.price_override, p.preco_venda)` na
--      variação e `p.preco_venda` no produto — a MESMA regra do checkout
--      online (20261081000000:227) e do front (src/lib/preco-vendido.ts:19-24),
--      que só cai no preço do produto quando o override é NULL, porque ZERO é
--      preço legítimo; `estoque` = `v.stock_increment` na variação e
--      `p.estoque` no produto (é o "estoque efetivo" daquele alvo); `imagem`
--      cai em cascata (`v.image_url` → `p.imagem_url` → `p.imagem_urls[1]`,
--      com `NULLIF` porque no banco o "sem imagem" às vezes é string vazia e
--      às vezes é NULL) — e o índice do array é 1, não 0: o Postgres indexa a
--      partir de 1 e `[0]` devolveria NULL calado; `tem_variantes` é o MESMO
--      predicado com que a v23 EXIGE variação (20261081000000:276-281), para
--      a tela não vender o produto base de um produto que só existe em
--      combinação.
--   8. `variacoes`: quando o bipe caiu no PRODUTO PAI e ele tem variação
--      ativa, a RPC devolve a folha de escolha COMPLETA (variant_id, nome,
--      valor, preço resolvido, estoque, imagem e código de barras de cada
--      uma, ordenada por nome/valor para a tela não depender da sorte do
--      planejador) — é a tela de escolha da combinação do desenho (§5.3,
--      item 1). Em qualquer outro caso a chave existe e vale `[]`: lista
--      vazia, nunca NULL. Quando a busca não acha NADA, `variacoes` é
--      reposta explicitamente como `'[]'::jsonb`, porque `SELECT ... INTO`
--      sem linha ZERA todas as variáveis de destino.
--   9. OS GRANTS: `REVOKE ALL ... FROM PUBLIC, anon, authenticated,
--      service_role` e só então `GRANT EXECUTE` para `authenticated` e
--      `service_role`. O REVOKE de PUBLIC é obrigatório — função nova nasce
--      com EXECUTE para PUBLIC, e foi exatamente esse resíduo que a
--      20261090500000 teve de limpar em massa; sem ele, a chave anônima que
--      vai no bundle do site varreria o catálogo por código. `authenticated`
--      precisa do GRANT (o gate de admin é DENTRO da função, e sem o GRANT o
--      job "Código x banco" do CI acusa INALCANÇÁVEL assim que C3 chamar a
--      RPC, scripts/db-check-objetos-do-codigo.mjs:20-27); `anon` fica de
--      fora de propósito (D6).
--
-- DADOS EXISTENTES: nenhuma linha é lida, comparada nem reescrita por esta
-- migration. Ela cria UMA função de LEITURA e mais nada — não há `ALTER
-- TABLE`, não há seed, não há tabela, índice, trigger, policy nem view aqui.
-- As colunas que a função lê (`codigo_barras` nas duas tabelas) vieram da
-- 20261160000000 e continuam NULL em todo produto e toda variação: até
-- alguém cadastrar um código, a RPC devolve honestamente `encontrado: false`
-- para qualquer bipe.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` (substitui o corpo, preserva os
-- grants), `REVOKE`/`GRANT` (declaram estado, repetir é no-op). Reaplicar o
-- arquivo deixa exatamente o mesmo estado.
--
-- FORA DO ESCOPO, de propósito: aplicar de verdade no banco (é `node
-- scripts/db-apply.cjs`, fora do PR); QUALQUER escrita — a venda de balcão é
-- `registrar_venda_presencial` (C1.3), e esta função é STABLE justamente para
-- não poder gravar; o filtro `p_canal` de `get_admin_orders_paged` (C1.4); o
-- leitor de câmera (C2), a tela do PDV (C3) e o campo de código de barras no
-- formulário do produto (C5); busca por NOME ou SKU (já existe em
-- `get_admin_products_paged` e é assunto de C3 — aqui é igualdade exata de
-- código, e só); reserva/baixa de estoque (esta RPC só INFORMA o estoque, não
-- reserva nada); `src/types/database.types.ts` (a assinatura entra junto com
-- o consumidor, em C3 — tipo de RPC que ninguém chama é tipo que ninguém
-- confere); e as colunas da C1.1, que esta migration só LÊ.
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs <arquivo.sql>` (uma transação por arquivo) ou
-- `psql -1`. Sem `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da
-- casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar à mão contra o banco):
--
--   1. SELECT p.prokind, p.provolatile, p.prosecdef, p.proconfig
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'buscar_por_codigo_barras';
--      -- esperado: uma linha — f (função), s (STABLE), t (SECURITY DEFINER),
--      -- {"search_path=pg_catalog, pg_temp"}.
--
--   2. SELECT has_function_privilege('anon',
--             'public.buscar_por_codigo_barras(text)', 'EXECUTE') AS anon,
--             has_function_privilege('authenticated',
--             'public.buscar_por_codigo_barras(text)', 'EXECUTE') AS auth;
--      -- esperado: false, true. (anon true = o REVOKE de PUBLIC falhou.)
--
--   3. Como admin (sessão com role admin em profiles):
--      SELECT public.buscar_por_codigo_barras('nao-existe-nenhum');
--      -- esperado: NÃO erra, e devolve
--      -- {"encontrado": false, "origem": null, "codigo": "nao-existe-nenhum",
--      --  "produto": null, "variante": null, "preco": null, "estoque": null,
--      --  "variacoes": []}
--
--   4. Ainda como admin, com um produto de teste que tenha DUAS variações
--      ativas e código no pai e numa das variações:
--      SELECT public.buscar_por_codigo_barras('<codigo da variacao>');
--      -- esperado: origem = "variante", "preco" igual ao price_override da
--      -- variação (e não ao preco_venda do produto), "estoque" igual ao
--      -- stock_increment dela, "variacoes" = [].
--      SELECT public.buscar_por_codigo_barras('<codigo do produto pai>');
--      -- esperado: origem = "produto", produto.tem_variantes = true e
--      -- jsonb_array_length(... -> 'variacoes') = 2.
--
--   5. SELECT public.buscar_por_codigo_barras('   ');
--      -- esperado (como admin): 22023, "Informe o código de barras."
--      SELECT public.buscar_por_codigo_barras(repeat('9', 65));
--      -- esperado (como admin): 22023, "Código de barras inválido."
--
--   6. Numa sessão de cliente comum (role customer):
--      SELECT public.buscar_por_codigo_barras('qualquer');
--      -- esperado: 42501, "Acesso negado: só a loja consulta código de
--      -- barras." (se voltar dado, o gate não está valendo).
--
--   7. Prova do par (estática, sem banco):
--      node scripts/db-prove-rollback.cjs \
--        supabase/migrations/20261161000000_o_balcao_acha_o_produto_pelo_codigo.sql
--
-- ROLLBACK: rollback-manual-20261161000000_o_balcao_acha_o_produto_pelo_
-- codigo.sql, versionado ao lado — derruba SÓ esta função
-- (`DROP FUNCTION IF EXISTS public.buscar_por_codigo_barras(text);`) e mais
-- nada: a função é NOVA, não há corpo anterior para restaurar, e as colunas
-- que ela lê são da 20261160000000 (desfazê-las é o rollback DAQUELA).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.buscar_por_codigo_barras(p_codigo text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
    IF public.is_admin() IS DISTINCT FROM true THEN
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

-- Funcao NOVA nasce com EXECUTE para PUBLIC: sem este REVOKE, a chave anonima
-- que vai no bundle do site varre o catalogo por codigo. Foi esse residuo que
-- a 20261090500000 teve de limpar em massa. O GRANT para `authenticated` e'
-- obrigatorio (o gate de admin mora DENTRO da funcao, e sem ele o job
-- "Codigo x banco" do CI acusa INALCANCAVEL assim que C3 chamar a RPC);
-- `anon` fica de fora de proposito (D6).
REVOKE ALL ON FUNCTION public.buscar_por_codigo_barras(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buscar_por_codigo_barras(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_por_codigo_barras(text) TO service_role;

COMMENT ON FUNCTION public.buscar_por_codigo_barras(text) IS 'PDV/balcão: acha produto ou variação pelo código de barras em IGUALDADE EXATA, nunca por busca aproximada nem por prefixo — é o que faz os índices únicos parciais da 20261160000000 valerem. Só admin (is_admin(), D6). Devolve SEMPRE o mesmo jsonb de oito chaves (encontrado, origem, codigo, produto, variante, preco, estoque, variacoes); código não encontrado NÃO é erro. Preço e estoque saem do banco, nunca do cliente: COALESCE(price_override, preco_venda), a mesma regra do checkout online.';

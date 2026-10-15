-- ============================================================================
-- Migration 20261237000000 — a lojista renomeia e apaga categoria sem deixar produto órfão
-- (permissão + regra de devolução; 14/10/2026; ADITIVA: só cria funções, nenhuma linha é lida ou reescrita ao aplicar)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CRIA
--
-- A lojista só conseguia CRIAR categoria. A tela de produtos não deixa renomear nem apagar, e o motivo é o perigo
-- que esta migration resolve: a categoria do produto é guardada pelo NOME escrito (public.produtos.categoria é
-- texto, sem chave estrangeira) e o mesmo nome aparece em quatro lugares:
--
--   a) public.categorias.nome (e o slug, derivado dele);
--   b) public.produtos.categoria, de cada produto da categoria;
--   c) public.banners.link, quando o banner abre a categoria (`/?category=<nome>`, com o nome codificado ou, em
--      banner antigo, escrito cru — destino-do-banner.ts lê os dois);
--   d) public.politica_devolucao.categorias_sem_troca, a lista "não aceita troca por gosto" da política de devolução.
--
-- Trocar só a linha de (a) deixaria o produto órfão (some da aba da vitrine), o banner abrindo uma página vazia e a
-- regra de devolução apagada sem ninguém ver. Por isso a troca passa a ser UMA função, numa transação só.
--
--   * public.renomear_categoria(p_id uuid, p_novo_nome text) -> jsonb
--       só o administrador de AGORA. Recusa nome vazio, grande demais, só de símbolos, "Todas"/"all" (o filtro da
--       vitrine) ou igual (sem diferenciar maiúscula, acento nem pontuação — a mesma regra do slug) ao de OUTRA
--       categoria. Troca o nome (em TODOS os produtos da categoria, também o pausado e o excluído) nos quatro
--       lugares e devolve quantos de cada foram trocados: {id, nome_antigo, nome, slug, mudou, produtos, banners,
--       regra_devolucao}. Se qualquer passo falhar, NADA muda (uma função = uma transação).
--   * public.apagar_categoria_vazia(p_id uuid) -> jsonb
--       só o administrador de AGORA. Recusa, com o motivo e as contagens, enquanto houver produto, banner ou regra
--       de devolução apontando para a categoria. Vazia, apaga a linha.
--   * public.categorias_com_uso() -> jsonb
--       só o administrador de AGORA. Lista todas as categorias (também as escondidas) com a contagem de produtos
--       (e, deles, quantos estão excluídos), banners e regra de devolução de cada uma: é o que a tela "Gerenciar
--       categorias" mostra antes de a lojista renomear ou apagar.
--   * oito funções AUXILIARES privadas (categoria__*): a chave de comparação, o slug, a codificação e a decodificação
--     do nome para o endereço, a leitura do link do banner (partes e nome), o "é a mesma categoria?" e a contagem de
--     usos. Ninguém de fora as executa.
--
-- 2. COMO O MESMO NOME É RECONHECIDO (a régua é a da vitrine)
--
-- A vitrine compara categoria com `toLowerCase().trim()` (HomeView, useSearch, categoria-valida-da-home) e a política
-- de devolução com `lower()`. Então, aqui, "mesma categoria" = mesmo texto sem diferenciar maiúscula/minúscula e sem
-- espaço nas pontas (categoria__chave). Um produto escrito "Brinquedo" já aparece hoje na aba "brinquedo"; depois da
-- troca ele acompanha, em vez de sumir da aba. O link do banner é lido como destino-do-banner.ts o lê: o texto depois
-- de `category=` vai até o primeiro `&chave=valor`; o nome é decodificado só quando já está codificado (sem espaço,
-- `+`, `#` nem `&`, e todo `%` abrindo um par hexadecimal); o resto dos parâmetros do link é preservado. O link novo
-- é escrito como `/?category=` + encodeURIComponent(nome novo), igual a linkDaCategoria().
--
-- As DUAS réguas não são a mesma, e renomear não pode mexer na regra de devolução de ninguém: a vitrine tira o espaço
-- das pontas; a regra de devolução (solicitar_devolucao, 20261175000000) compara lower() SEM tirar. Um produto
-- " Brinquedo" (espaço na ponta) aparece na aba "brinquedo" da vitrine, mas NÃO casa com o item "Brinquedo" da lista
-- de "não aceita troca": hoje aceita troca. Se a troca de nome o reescrevesse como "Jogos" limpo, ele passaria a casar
-- com o item "Jogos" e deixaria de aceitar troca, sem a lojista ver. Por isso, nos produtos e nos itens da lista, o
-- que É a categoria (pela chave da vitrine) troca só o miolo e MANTÉM o espaço que já tinha nas pontas: " Brinquedo"
-- vira " Jogos", "Brinquedo " vira "Jogos ". A vitrine continua agrupando (tira o espaço dos dois lados) e, para a
-- regra de devolução, "Brinquedo" e " Brinquedo" continuam textos diferentes, antes e depois: o resultado de
-- "aceita troca?" de cada produto é o mesmo de antes (tests/banco/categorias-gestao-viva.cjs prova numa matriz).
-- Limite: se o nome NOVO já estiver escrito na lista de devolução (item antigo, sem categoria própria), os produtos
-- da categoria trocada passam a casar com ele: é o que a lojista escreveu na lista, e a recusa de nome repetido só
-- olha a tabela de categorias.
--
-- Exceção deliberada: se existirem DUAS linhas em categorias que só diferem por maiúscula/espaço (o slug único
-- impede isso para quem cria pela tela, mas dado antigo pode ter), renomear RECUSA (a troca não saberia de qual das
-- duas é o produto) e apagar passa a comparar o texto EXATO. Ninguém é adivinhado.
--
-- 3. O QUE NÃO MUDA
--
--   * Nenhuma tabela, coluna, política, gatilho ou dado é tocado ao aplicar. A coluna `ativo` de categorias (a
--     "escondida da vitrine", que a vitrine já respeita: CategoryFilter, link do banner, categoria-valida-da-home)
--     já existe; esta migration NÃO cria outra.
--   * O gatilho set_ultima_atualizacao (20261012000000) dispara em cada produto trocado: a vitrine percebe a mudança.
--   * A política de devolução registra a troca em updated_at/updated_by (é uma edição dela, feita pela lojista).
--
-- 4. PERMISSÃO
--
-- As três funções do painel são SECURITY DEFINER com search_path = public, exigem `is_admin()` E `is_admin_atual()`
-- (o papel de AGORA em auth.users e profiles, não o do JWT velho — 20261197000000) e recusam com 42501. EXECUTE:
-- só authenticated e service_role (anon e PUBLIC revogados). As auxiliares: ninguém de fora (REVOKE de PUBLIC, anon,
-- authenticated e service_role; o dono executa por dentro das três). Mais as três entradas em
-- tests/banco/portas-do-visitante-permitidas.json (situacao `logado`).
--
-- 5. LIMITES CONHECIDOS (declarados, não escondidos)
--
--   * Um link de banner com ENDEREÇO COMPLETO escrito à mão ("link personalizado": https://<loja>/?category=...) não
--     é reconhecido: o domínio da loja não é conhecido aqui. Só o link que o painel grava (`/?category=...`) é.
--   * Quem salva um produto com a categoria ANTIGA (tela aberta antes da troca) durante a troca recria o órfão: não há
--     trava de linha entre "trocar categoria" e "salvar produto". A janela é de milissegundos e a tela de produtos
--     relê as categorias.
--   * O front não troca mais o nome direto na tabela (useCategories.updateCategory chama a RPC), mas as políticas de
--     RLS de UPDATE E DE DELETE de `categorias` ainda usam is_admin() (o papel do JWT, não o de AGORA) e continuam
--     permitindo o admin gravar `nome` e apagar a linha por PostgREST, sem passar por estas funções: um nome trocado
--     assim deixa o produto órfão, e um DELETE direto apaga a categoria mesmo com produto, banner ou regra. Fechar
--     isso é tarefa separada (rls_admin_atual nas duas políticas, como a 20261202000000 fez nas do pedido): mexe nas
--     políticas e no grant de coluna de uma tabela que a vitrine lê no boot — fora do escopo desta migration.
--   * Produto EXCLUÍDO (deleted_at preenchido) continua contando como "em uso" ao apagar, e a lojista não o vê na
--     lista: a recusa e a tela dizem quantos são, mas não há como ela mover produto excluído. Se isso deve
--     liberar a exclusão da categoria (ou ganhar uma tela de "excluídos"), é decisão de produto, não desta migration.
--   * Os nomes "Todas" e "all" (o filtro da vitrine e o valor dele no painel) são recusados ao RENOMEAR; a CRIAÇÃO
--     de categoria é um INSERT direto na tabela (a tela recusa, o banco não): proteger o banco pediria gatilho ou
--     CHECK em `categorias`, que muda o contrato da tabela — registrado, não feito aqui.
--   * A ordem de categorias_com_uso é por byte (COLLATE "C"), igual em qualquer banco; a tela reordena por idioma.
--
-- 6. PRÉ-VOO E CONFERÊNCIA FINAL (neste arquivo)
--
-- Antes de criar qualquer coisa, recusa (B1_BASELINE_DIVERGENT) se faltar tabela, coluna ou função de que o corpo
-- depende, ou se f_unaccent não tirar o acento. Depois de criar, recusa se alguma função ficou aberta ao visitante,
-- se as três do painel não ficaram abertas ao authenticated, ou se a codificação do nome divergir de
-- encodeURIComponent (o contrato com destino-do-banner.ts).
--
-- 7. IDEMPOTÊNCIA, TRANSAÇÃO E ROLLBACK
--
-- CREATE OR REPLACE: reaplicar deixa o mesmo estado. Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a
-- transação é o aplicador. ROLLBACK MANUAL: rollback-manual-20261237000000_a_lojista_renomeia_e_apaga_categoria_sem_
-- deixar_produto_orfao.sql apaga as onze funções (todas nascem aqui; nenhuma existia antes). Ele NÃO desfaz as
-- trocas de nome já feitas pela lojista enquanto as funções valeram: são dado dela, e o nome novo é o que vale.
--
-- 8. ORDEM
--
-- Depois da 20261199000000 (is_admin_atual) e da 20261068000000 (f_unaccent); o pré-voo recusa sem elas.
-- ============================================================================

DO $preflight_20261237$
DECLARE
  v_faltando text[] := ARRAY[]::text[];
  v_item text;
BEGIN
  FOREACH v_item IN ARRAY ARRAY[
    'public.categorias', 'public.produtos', 'public.banners', 'public.politica_devolucao'
  ] LOOP
    IF to_regclass(v_item) IS NULL THEN
      v_faltando := v_faltando || ('tabela ' || v_item);
    END IF;
  END LOOP;

  FOREACH v_item IN ARRAY ARRAY[
    'categorias.id', 'categorias.nome', 'categorias.slug', 'categorias.ativo',
    'produtos.categoria', 'produtos.deleted_at', 'banners.id', 'banners.link',
    'politica_devolucao.categorias_sem_troca', 'politica_devolucao.updated_at', 'politica_devolucao.updated_by'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.' || split_part(v_item, '.', 1))
         AND a.attname = split_part(v_item, '.', 2)
         AND a.attnum > 0
         AND NOT a.attisdropped
    ) THEN
      v_faltando := v_faltando || ('coluna public.' || v_item);
    END IF;
  END LOOP;

  FOREACH v_item IN ARRAY ARRAY['public.is_admin()', 'public.is_admin_atual()', 'public.f_unaccent(text)'] LOOP
    IF to_regprocedure(v_item) IS NULL THEN
      v_faltando := v_faltando || ('função ' || v_item);
    END IF;
  END LOOP;

  IF cardinality(v_faltando) > 0 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam objetos de que a gestão de categorias depende: % — aplique as anteriores antes.',
      array_to_string(v_faltando, ', ');
  END IF;

  IF public.f_unaccent('João Álvaro Çedilha') IS DISTINCT FROM 'Joao Alvaro Cedilha' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.f_unaccent não tira o acento como esperado — meça a loja e revise antes de aplicar.';
  END IF;
END $preflight_20261237$;

-- ---------------------------------------------------------------------------
-- AUXILIARES PRIVADAS
-- ---------------------------------------------------------------------------

-- A chave de comparação da vitrine: minúscula e sem espaço nas pontas.
CREATE OR REPLACE FUNCTION public.categoria__chave(p_texto text)
 RETURNS text
 LANGUAGE sql
 STABLE
 STRICT
 SET search_path TO 'public'
AS $$
  SELECT lower(regexp_replace($1, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
$$;

-- O slug que a tela sempre gravou (useCategories.generateSlug): sem acento, minúsculo, só letras e números ligados
-- por hífen. Nome só de símbolos dá '' (a RPC recusa).
CREATE OR REPLACE FUNCTION public.categoria__slug(p_nome text)
 RETURNS text
 LANGUAGE sql
 STABLE
 STRICT
 SET search_path TO 'public'
AS $$
  SELECT btrim(
           regexp_replace(lower(public.f_unaccent(btrim($1))), '[^a-z0-9]+', '-', 'g'),
           '-');
$$;

-- encodeURIComponent: só A-Z a-z 0-9 - _ . ! ~ * ' ( ) ficam; o resto vira %XX nos bytes UTF-8, em maiúscula.
CREATE OR REPLACE FUNCTION public.categoria__url_codifica(p_texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 STRICT
 SET search_path TO 'public'
AS $$
  SELECT COALESCE(string_agg(
           CASE
             WHEN t.b BETWEEN 48 AND 57 OR t.b BETWEEN 65 AND 90 OR t.b BETWEEN 97 AND 122
               OR t.b IN (45, 95, 46, 33, 126, 42, 39, 40, 41)
               THEN chr(t.b)
             ELSE '%' || upper(lpad(to_hex(t.b), 2, '0'))
           END, '' ORDER BY t.i), '')
    FROM (
      SELECT g.i, get_byte(convert_to($1, 'UTF8'), g.i) AS b
        FROM generate_series(0, octet_length(convert_to($1, 'UTF8')) - 1) AS g(i)
    ) t;
$$;

-- decodeURIComponent: %XX (par hexadecimal) vira o byte; o resto fica. Sequência UTF-8 inválida devolve NULL.
CREATE OR REPLACE FUNCTION public.categoria__url_decodifica(p_texto text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 STRICT
 SET search_path TO 'public'
AS $$
DECLARE
  v_bytes bytea := ''::bytea;
  v_i integer := 1;
  v_n integer := length(p_texto);
  v_c text;
BEGIN
  WHILE v_i <= v_n LOOP
    v_c := substr(p_texto, v_i, 1);
    IF v_c = '%' AND substr(p_texto, v_i + 1, 2) ~ '^[0-9A-Fa-f]{2}$' THEN
      v_bytes := v_bytes || decode(substr(p_texto, v_i + 1, 2), 'hex');
      v_i := v_i + 3;
    ELSE
      v_bytes := v_bytes || convert_to(v_c, 'UTF8');
      v_i := v_i + 1;
    END IF;
  END LOOP;
  RETURN convert_from(v_bytes, 'UTF8');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Lê o link de categoria como destino-do-banner.ts: devolve {nome_bruto, resto} ou NULL quando o link não é de
-- categoria. O nome vai até o primeiro pedaço `chave=valor` depois de um `&` (aí começam os outros parâmetros).
CREATE OR REPLACE FUNCTION public.categoria__partes_do_link(p_link text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 STRICT
 SET search_path TO 'public'
AS $$
DECLARE
  v_pedacos text[];
  v_n integer;
  v_inicio integer := NULL;
  v_i integer;
  v_nome text;
  v_resto text;
BEGIN
  IF p_link !~ '^/\?category=' THEN
    RETURN NULL;
  END IF;
  v_pedacos := string_to_array(substr(p_link, length('/?category=') + 1), '&');
  v_n := COALESCE(array_length(v_pedacos, 1), 0);
  IF v_n = 0 THEN
    RETURN NULL;
  END IF;
  FOR v_i IN 2..v_n LOOP
    IF v_pedacos[v_i] ~ '^[A-Za-z0-9_.-]+=' THEN
      v_inicio := v_i;
      EXIT;
    END IF;
  END LOOP;
  IF v_inicio IS NULL THEN
    v_nome := array_to_string(v_pedacos, '&');
    v_resto := '';
  ELSE
    v_nome := array_to_string(v_pedacos[1:v_inicio - 1], '&');
    v_resto := array_to_string(v_pedacos[v_inicio:v_n], '&');
  END IF;
  IF v_nome = '' THEN
    RETURN NULL;
  END IF;
  RETURN ARRAY[v_nome, v_resto];
END;
$$;

-- O NOME que o link de categoria pede (decodificado só quando já está codificado), ou NULL.
CREATE OR REPLACE FUNCTION public.categoria__nome_do_link(p_link text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 STRICT
 SET search_path TO 'public'
AS $$
DECLARE
  v_partes text[] := public.categoria__partes_do_link(p_link);
BEGIN
  IF v_partes IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_partes[1] !~ '[[:space:]+#&]' AND v_partes[1] !~ '%(?![0-9A-Fa-f]{2})' THEN
    RETURN public.categoria__url_decodifica(v_partes[1]);
  END IF;
  RETURN v_partes[1];
END;
$$;

-- "É a mesma categoria?" — pela chave da vitrine, ou pelo texto exato quando há outra linha quase igual.
CREATE OR REPLACE FUNCTION public.categoria__mesma(p_texto text, p_nome text, p_estrito boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  SELECT $1 IS NOT NULL AND $2 IS NOT NULL
         AND CASE WHEN $3 THEN $1 = $2 ELSE public.categoria__chave($1) = public.categoria__chave($2) END;
$$;

-- Quanto desta categoria está em uso: {produtos, produtos_excluidos, banners, regra_devolucao, estrito}. NULL se a
-- categoria não existe. `produtos` conta TODOS os produtos da categoria (também o pausado e o excluído: é o que
-- impede apagar e o que renomear troca); `produtos_excluidos` é a parte deles com deleted_at preenchido, que a lista
-- de produtos da lojista não mostra — a tela e a recusa de apagar a explicam em vez de dizer "3 produtos" quando ela
-- vê 1.
CREATE OR REPLACE FUNCTION public.categoria__usos(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
DECLARE
  v_nome text;
  v_estrito boolean;
  v_produtos integer;
  v_excluidos integer;
  v_banners integer;
  v_regra integer;
BEGIN
  SELECT c.nome INTO v_nome FROM public.categorias c WHERE c.id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_estrito := EXISTS (
    SELECT 1 FROM public.categorias o
     WHERE o.id <> p_id AND public.categoria__chave(o.nome) = public.categoria__chave(v_nome)
  );

  SELECT count(*)::integer, (count(*) FILTER (WHERE p.deleted_at IS NOT NULL))::integer
    INTO v_produtos, v_excluidos
    FROM public.produtos p
   WHERE public.categoria__mesma(p.categoria, v_nome, v_estrito);

  SELECT count(*)::integer INTO v_banners
    FROM public.banners b
   WHERE public.categoria__mesma(public.categoria__nome_do_link(b.link), v_nome, v_estrito);

  SELECT count(*)::integer INTO v_regra
    FROM public.politica_devolucao d
   CROSS JOIN LATERAL unnest(d.categorias_sem_troca) AS e(item)
   WHERE public.categoria__mesma(e.item, v_nome, v_estrito);

  RETURN jsonb_build_object(
    'produtos', v_produtos,
    'produtos_excluidos', v_excluidos,
    'banners', v_banners,
    'regra_devolucao', v_regra,
    'estrito', v_estrito
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- AS TRÊS PORTAS DO PAINEL
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.categorias_com_uso()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', c.id,
               'nome', c.nome,
               'slug', c.slug,
               'ativo', COALESCE(c.ativo, true),
               'produtos', (u.j ->> 'produtos')::integer,
               'produtos_excluidos', (u.j ->> 'produtos_excluidos')::integer,
               'banners', (u.j ->> 'banners')::integer,
               'regra_devolucao', (u.j ->> 'regra_devolucao')::integer
             )
             -- Ordem fixa por byte, igual em qualquer banco: a de "idioma" muda de uma loja para outra (no
             -- collation C "Íntimos" ficaria depois de "Outlet"). A tela ordena por idioma pt-BR no cliente.
             ORDER BY c.nome COLLATE "C", c.id)
      FROM public.categorias c
     CROSS JOIN LATERAL (SELECT public.categoria__usos(c.id) AS j) u
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.renomear_categoria(p_id uuid, p_novo_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_cat public.categorias%ROWTYPE;
  v_novo text;
  v_slug text;
  v_antigo text;
  v_existente text;
  v_n integer;
  v_produtos integer := 0;
  v_banners integer := 0;
  v_regra integer := 0;
  v_lista text[];
  v_nova_lista text[];
  r record;
  v_partes text[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Categoria inválida.' USING ERRCODE = '22023';
  END IF;

  -- O nome como a lojista o vê: sem espaço nas pontas e com um espaço só entre as palavras.
  v_novo := regexp_replace(
              regexp_replace(COALESCE(p_novo_nome, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'),
              '[[:space:]]+', ' ', 'g');
  IF v_novo = '' THEN
    RAISE EXCEPTION 'Escreva o novo nome da categoria.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_novo) > 80 THEN
    RAISE EXCEPTION 'O nome da categoria pode ter no máximo 80 letras.' USING ERRCODE = '22023';
  END IF;
  v_slug := public.categoria__slug(v_novo);
  IF v_slug = '' THEN
    RAISE EXCEPTION 'O nome da categoria precisa ter pelo menos uma letra ou um número.' USING ERRCODE = '22023';
  END IF;
  -- "Todas" é o filtro que a vitrine mostra antes de todas as categorias (e "all" é o valor dele no painel): uma
  -- categoria com esse nome colidiria com ele e não conseguiria ser filtrada.
  IF public.categoria__chave(v_novo) IN ('todas', 'all') THEN
    RAISE EXCEPTION 'O nome "%" já é do filtro que mostra todos os produtos da loja. Escolha outro nome.', v_novo
      USING ERRCODE = '22023';
  END IF;

  -- Uma gestão de categoria por vez (renomear e apagar não se atropelam).
  PERFORM pg_advisory_xact_lock(hashtext('categorias:gestao'));

  SELECT * INTO v_cat FROM public.categorias WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  v_antigo := v_cat.nome;

  IF v_antigo = v_novo THEN
    RETURN jsonb_build_object(
      'id', p_id, 'nome_antigo', v_antigo, 'nome', v_antigo, 'slug', v_cat.slug, 'mudou', false,
      'produtos', 0, 'banners', 0, 'regra_devolucao', 0);
  END IF;

  -- Nome repetido: sem diferenciar maiúscula, acento nem pontuação (a regra do slug) e, por segurança, também a
  -- chave da vitrine. Só OUTRAS categorias contam: "brinquedo" -> "Brinquedo" é a mesma linha e pode.
  SELECT o.nome INTO v_existente
    FROM public.categorias o
   WHERE o.id <> p_id
     AND (public.categoria__slug(o.nome) = v_slug
          OR o.slug = v_slug
          OR public.categoria__chave(o.nome) = public.categoria__chave(v_novo))
   ORDER BY o.nome
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Já existe uma categoria chamada "%". Escolha outro nome.', v_existente
      USING ERRCODE = '23505';
  END IF;

  -- Outra linha quase igual à ANTIGA (só maiúscula/espaço): a troca não saberia de qual das duas é cada produto.
  SELECT o.nome INTO v_existente
    FROM public.categorias o
   WHERE o.id <> p_id AND public.categoria__chave(o.nome) = public.categoria__chave(v_antigo)
   ORDER BY o.nome
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Existe outra categoria com quase o mesmo nome ("%"). Mude os produtos de uma para a outra e apague a repetida antes de renomear.', v_existente
      USING ERRCODE = '55006';
  END IF;

  -- (a) a própria linha
  BEGIN
    UPDATE public.categorias SET nome = v_novo, slug = v_slug WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma categoria com esse nome. Escolha outro nome.' USING ERRCODE = '23505';
  END;

  -- (b) os produtos. O espaço que o produto já trazia nas pontas FICA: a regra de devolução compara lower() sem tirar
  -- espaço, e um produto " Brinquedo" não casa com o item "Brinquedo" da lista. Trocar o texto inteiro por "Jogos"
  -- o faria casar com o item (já trocado para "Jogos") e a lojista, sem ver, passaria a negar a troca dele.
  UPDATE public.produtos
     SET categoria = substring(categoria from '^[[:space:]]*')
                     || v_novo
                     || substring(regexp_replace(categoria, '^[[:space:]]+', '') from '[[:space:]]*$')
   WHERE public.categoria__mesma(categoria, v_antigo, false);
  GET DIAGNOSTICS v_produtos = ROW_COUNT;

  -- (c) os links de banner que abrem a categoria (nos dois formatos), preservando os outros parâmetros do link
  FOR r IN
    SELECT b.id, b.link
      FROM public.banners b
     WHERE b.link ~ '^/\?category='
     ORDER BY b.id
       FOR UPDATE
  LOOP
    IF public.categoria__mesma(public.categoria__nome_do_link(r.link), v_antigo, false) THEN
      v_partes := public.categoria__partes_do_link(r.link);
      UPDATE public.banners
         SET link = '/?category=' || public.categoria__url_codifica(v_novo)
                    || CASE WHEN v_partes[2] <> '' THEN '&' || v_partes[2] ELSE '' END
       WHERE id = r.id;
      v_banners := v_banners + 1;
    END IF;
  END LOOP;

  -- (d) a lista "sem troca por gosto" da política de devolução. Só o item que É a categoria troca de texto (com o
  -- espaço das pontas que ele já tinha, pelo mesmo motivo do produto); os outros ficam como estão, na mesma ordem e
  -- com as repetições que tinham. Única exceção: o texto novo (o mesmo nome em mais de um item trocado, ou já escrito
  -- ao lado) não se repete; vale o primeiro.
  SELECT d.categorias_sem_troca INTO v_lista FROM public.politica_devolucao d WHERE d.id = 1 FOR UPDATE;
  IF FOUND AND v_lista IS NOT NULL THEN
    SELECT count(*)::integer INTO v_n
      FROM unnest(v_lista) AS e(item)
     WHERE public.categoria__mesma(e.item, v_antigo, false);
    IF v_n > 0 THEN
      SELECT COALESCE(array_agg(q.x ORDER BY q.ord), ARRAY[]::text[]) INTO v_nova_lista
        FROM (
          WITH n AS (
            SELECT e.ord,
                   public.categoria__mesma(e.item, v_antigo, false) AS trocado,
                   CASE WHEN public.categoria__mesma(e.item, v_antigo, false)
                        THEN substring(e.item from '^[[:space:]]*')
                             || v_novo
                             || substring(regexp_replace(e.item, '^[[:space:]]+', '') from '[[:space:]]*$')
                        ELSE e.item
                   END AS x
              FROM unnest(v_lista) WITH ORDINALITY AS e(item, ord)
          )
          SELECT n.x, n.ord,
                 row_number() OVER (PARTITION BY n.x ORDER BY n.ord) AS rn,
                 EXISTS (SELECT 1 FROM n AS t WHERE t.trocado AND t.x = n.x) AS e_texto_novo
            FROM n
        ) q
       WHERE NOT (q.e_texto_novo AND q.rn > 1);
      UPDATE public.politica_devolucao
         SET categorias_sem_troca = v_nova_lista,
             updated_at = now(),
             updated_by = auth.uid()
       WHERE id = 1;
      v_regra := v_n;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', p_id,
    'nome_antigo', v_antigo,
    'nome', v_novo,
    'slug', v_slug,
    'mudou', true,
    'produtos', v_produtos,
    'banners', v_banners,
    'regra_devolucao', v_regra
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apagar_categoria_vazia(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_cat public.categorias%ROWTYPE;
  v_usos jsonb;
  v_produtos integer;
  v_excluidos integer;
  v_banners integer;
  v_regra integer;
  v_motivos text[] := ARRAY[]::text[];
  v_aviso_excluidos text := '';
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Categoria inválida.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('categorias:gestao'));

  SELECT * INTO v_cat FROM public.categorias WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  v_usos := public.categoria__usos(p_id);
  v_produtos := (v_usos ->> 'produtos')::integer;
  v_excluidos := (v_usos ->> 'produtos_excluidos')::integer;
  v_banners := (v_usos ->> 'banners')::integer;
  v_regra := (v_usos ->> 'regra_devolucao')::integer;

  IF v_produtos > 0 THEN
    v_motivos := v_motivos || (
      v_produtos || CASE WHEN v_produtos = 1 THEN ' produto' ELSE ' produtos' END
      || CASE
           WHEN v_excluidos = 1 THEN ' (1 excluído, que não aparece na lista)'
           WHEN v_excluidos > 1 THEN ' (' || v_excluidos || ' excluídos, que não aparecem na lista)'
           ELSE ''
         END);
  END IF;
  IF v_excluidos > 0 THEN
    -- A lojista não enxerga nem move produto excluído: dizer o que dá para fazer, em vez de deixá-la procurando.
    v_aviso_excluidos := ' Produto excluído não aparece na lista de produtos e só sai da categoria com a ajuda do suporte.';
  END IF;
  IF v_banners > 0 THEN
    v_motivos := v_motivos || (v_banners || CASE WHEN v_banners = 1 THEN ' banner' ELSE ' banners' END);
  END IF;
  IF v_regra > 0 THEN
    v_motivos := v_motivos || 'a regra de devolução'::text;
  END IF;

  IF cardinality(v_motivos) > 0 THEN
    RAISE EXCEPTION 'A categoria "%" ainda está em uso: %. Mude os produtos de categoria, troque o link do banner e tire a categoria da regra de devolução antes de apagar.% Se só quer tirá-la da vitrine, esconda.',
      v_cat.nome, array_to_string(v_motivos, ', '), v_aviso_excluidos
      USING ERRCODE = '55006';
  END IF;

  DELETE FROM public.categorias WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'nome', v_cat.nome, 'apagada', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- ACL: as três do painel só para quem está logado (o corpo exige o admin ATUAL); as auxiliares, ninguém de fora.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.categorias_com_uso() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renomear_categoria(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apagar_categoria_vazia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.categorias_com_uso() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.renomear_categoria(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apagar_categoria_vazia(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.categoria__chave(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.categoria__slug(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.categoria__url_codifica(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.categoria__url_decodifica(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.categoria__partes_do_link(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.categoria__nome_do_link(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.categoria__mesma(text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.categoria__usos(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.renomear_categoria(uuid, text) IS
  'Troca o nome da categoria na linha, nos produtos, nos links de banner e na lista "sem troca" da política de '
  'devolução, numa transação só. Só o admin atual.';
COMMENT ON FUNCTION public.apagar_categoria_vazia(uuid) IS
  'Apaga a categoria só se nenhum produto, banner nem regra de devolução apontar para ela. Só o admin atual.';
COMMENT ON FUNCTION public.categorias_com_uso() IS
  'Todas as categorias (também as escondidas) com a contagem de produtos, banners e regra de devolução. Só o admin atual.';

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA FINAL (recusa, e a transação inteira cai, se algo ficou diferente do contrato)
-- ---------------------------------------------------------------------------
DO $conferencia_20261237$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.categoria__chave(text)', 'public.categoria__slug(text)', 'public.categoria__url_codifica(text)',
    'public.categoria__url_decodifica(text)', 'public.categoria__partes_do_link(text)',
    'public.categoria__nome_do_link(text)', 'public.categoria__mesma(text,text,boolean)',
    'public.categoria__usos(uuid)', 'public.categorias_com_uso()', 'public.renomear_categoria(uuid,text)',
    'public.apagar_categoria_vazia(uuid)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'CONFERENCIA_20261237: % não existe depois da migration.', v_fn;
    END IF;
    IF has_function_privilege('anon', to_regprocedure(v_fn), 'EXECUTE')
       OR has_function_privilege('public', to_regprocedure(v_fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'CONFERENCIA_20261237: % ficou aberta ao visitante.', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY['public.categorias_com_uso()', 'public.renomear_categoria(uuid,text)',
                              'public.apagar_categoria_vazia(uuid)'] LOOP
    IF NOT has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'CONFERENCIA_20261237: % não ficou executável pelo painel (authenticated).', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY['public.categoria__chave(text)', 'public.categoria__usos(uuid)'] LOOP
    IF has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE')
       OR has_function_privilege('service_role', to_regprocedure(v_fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'CONFERENCIA_20261237: a auxiliar % ficou aberta ao authenticated ou ao service_role.', v_fn;
    END IF;
  END LOOP;

  -- O contrato com destino-do-banner.ts (encodeURIComponent / decodeURIComponent).
  IF public.categoria__url_codifica('Cama & Banho') IS DISTINCT FROM 'Cama%20%26%20Banho'
     OR public.categoria__url_codifica('Íntimos (50%)') IS DISTINCT FROM '%C3%8Dntimos%20(50%25)'
     OR public.categoria__url_decodifica('%C3%8Dntimos%20(50%25)') IS DISTINCT FROM 'Íntimos (50%)'
     OR public.categoria__nome_do_link('/?category=Cama%20%26%20Banho&x=1') IS DISTINCT FROM 'Cama & Banho'
     OR public.categoria__nome_do_link('/?category=Cama & Banho') IS DISTINCT FROM 'Cama & Banho' THEN
    RAISE EXCEPTION 'CONFERENCIA_20261237: a codificação do nome no link divergiu de encodeURIComponent.';
  END IF;
END $conferencia_20261237$;

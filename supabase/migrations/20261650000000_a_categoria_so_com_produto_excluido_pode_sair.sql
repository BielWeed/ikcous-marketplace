-- ============================================================================
-- Migration 20261650000000 — a categoria que só tem produto EXCLUÍDO pode ser apagada
-- (decisão de produto do sócio, 27/11/2026; ADITIVA: troca só o corpo de uma função, nenhuma linha é lida ou reescrita
-- ao aplicar)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
--   `public.apagar_categoria_vazia(uuid)` (corpo VIVO da 20261237000000, md5 942449150bb5e6fadfa7cf003f3fa49e) recusa
--   apagar enquanto QUALQUER produto tiver o nome da categoria, inclusive o produto EXCLUÍDO (deleted_at preenchido).
--   A lojista não vê nem move produto excluído: a categoria "Inverno" com 3 produtos excluídos ficava presa para
--   sempre, e a recusa mandava "pedir ajuda ao suporte". A 20261237000000 deixou isso registrado como decisão de
--   produto (§5 dela). A decisão foi tomada: produto excluído NÃO segura a categoria.
--
-- 2. O QUE ESTA MIGRATION FAZ, NA ORDEM
--
--   0. Pré-voo (B1_BASELINE_DIVERGENT, antes de qualquer escrita; ver 5) e fotografia da função no catálogo.
--   1. `CREATE OR REPLACE` de `public.apagar_categoria_vazia(uuid)` com o corpo VIVO da 20261237000000 mudando SÓ:
--        a) a recusa por produto vale quando `v_produtos - v_excluidos > 0` (o produto que a lojista vê na lista, à
--           venda ou pausado) e conta só esses na frase ("2 produtos", não "4 produtos (2 excluídos ...)");
--        b) sai a frase "só sai da categoria com a ajuda do suporte" (a variável v_aviso_excluidos);
--        c) o JSON de retorno ganha 'produtos_excluidos' (quantos excluídos ficaram com o nome da categoria apagada).
--      As duas travas de admin, o advisory lock 'categorias:gestao', o FOR UPDATE da linha, a contagem pela
--      `categoria__usos` (intocada), as recusas por banner e por regra de devolução, os códigos de erro, a assinatura,
--      SECURITY DEFINER, `search_path = public`, volatilidade, dono e ACL ficam IGUAIS (CREATE OR REPLACE preserva OID,
--      dono e ACL; a conferência compara com a fotografia). O COMMENT da função passa a dizer a regra nova.
--   2. Conferência no fim (aborta a migration inteira se algo não ficou como desenhado).
--
-- 3. DADOS EXISTENTES
--
--   NENHUMA linha é lida para reescrita, reescrita ou apagada ao aplicar. Ao APAGAR uma categoria depois do apply, os
--   produtos excluídos dela NÃO são tocados: continuam com `categoria = '<nome>'`. É de propósito: o relatório de vendas
--   por categoria (`get_category_analytics`, 20261620000000) agrupa pelo nome escrito no PRODUTO (inclusive o excluído),
--   nunca pela tabela `categorias`; o pedido antigo continua aparecendo em "<nome>" antes e depois de apagar.
--   Medido no repositório (27/11/2026): nenhuma migration ativa, edge function ou tela resolve a categoria do produto
--   pela tabela `categorias` (só a lista de categorias do painel e da vitrine a lê).
--
-- 4. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
--   `CREATE OR REPLACE` (nenhum DROP): reaplicar deixa o mesmo estado (o pré-voo aceita o corpo de antes OU o desta).
--   Sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa, AGENTS.md): quem abre a transação é o aplicador
--   (`aplicar-migrations.yml` / `node scripts/db-apply.cjs <arquivo>`); pré-voo, troca e conferência caem juntos ou não
--   caem (a fotografia é `set_config` local à transação). `lock_timeout = 5s`: uma loja em uso falha limpo em vez de
--   travar o painel; repetir depois. Um "apagar" em voo durante o apply usa o corpo que estava valendo quando começou.
--
-- 5. PRÉ-VOO
--
--   Recusa se: `apagar_categoria_vazia` ausente, com sobrecarga ou com corpo que não seja o da 20261237000000 nem o
--   desta; atributos diferentes (plpgsql, SECURITY DEFINER, VOLATILE, retorno jsonb, um argumento, search_path=public);
--   EXECUTE aberto a PUBLIC ou anon, ou fechado ao authenticated ou ao service_role (a ACL da 20261237000000);
--   `categoria__usos(uuid)` ausente ou com corpo que não seja o da 20261237000000 (md5 de71936e57268db232630d37e88fe6cd:
--   é ela que conta `produtos` COM os excluídos e `produtos_excluidos` à parte, e a conta nova depende disso); ou
--   `is_admin()` / `is_admin_atual()` ausentes.
--
-- 6. FORA DO ESCOPO (declarado, não escondido)
--
--   * `renomear_categoria` não muda: ela continua RECUSANDO o nome novo que já é a categoria de produtos de fora,
--     inclusive excluídos (recusa (2) da 20261237000000). Depois de apagar "Inverno" com excluídos, renomear OUTRA
--     categoria para "Inverno" é recusado; CRIAR uma categoria "Inverno" nova continua possível (os excluídos voltam a
--     ser dela e contam como excluídos de novo).
--   * `categoria__usos` e `categorias_com_uso` não mudam: a lista do painel segue mostrando quantos excluídos há.
--
-- 7. ORDEM E QUEM QUEBRA
--
--   Depois da 20261237000000. Banco antes do front: o front novo habilita "Apagar" para a categoria só com excluídos;
--   com o banco antigo a lojista toca, o banco recusa com a frase antiga e nada é apagado (sem perda). O front antigo
--   com o banco novo só não oferece o botão. Ninguém lê o texto da recusa por código (o painel mostra a frase).
--   O rollback-manual da 20261237000000 (DROP das onze funções) continua funcionando com esta no ar. As provas que
--   medem o corpo da 20261237000000 tiram esta antes: `tests/banco/a-categoria-so-com-excluidos-posterior.cjs`.
--
-- 8. FICHA DE VERIFICAÇÃO (só leitura)
--
--   -- Corpo (esperado: f1526e7727709356677c83fdea745491):
--   SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.apagar_categoria_vazia(uuid)');
--   Consultas oficiais: 206a (depois) / 206b (antes), em scripts/publicacao/consultas/.
--
-- 9. ROLLBACK
--
--   rollback-manual-20261650000000_a_categoria_so_com_produto_excluido_pode_sair.sql: devolve o corpo da 20261237000000
--   byte a byte (md5 942449150bb5e6fadfa7cf003f3fa49e) e o COMMENT de antes. Nenhuma linha é tocada; as categorias
--   apagadas enquanto esta valeu ficam apagadas (são decisão da lojista) e os excluídos delas seguem com o nome.
--
-- PROVA VIVA: tests/banco/a-categoria-so-com-produto-excluido-pode-sair-viva.cjs (rpc-ci, Postgres efêmero).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261650000000$
DECLARE
  v_fn oid := to_regprocedure('public.apagar_categoria_vazia(uuid)');
  v_usos oid := to_regprocedure('public.categoria__usos(uuid)');
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'apagar_categoria_vazia') <> 1
     OR v_fn IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.apagar_categoria_vazia(uuid) ausente, com outra assinatura ou com sobrecarga — aplique a 20261237000000 antes e meça a loja (consulta 206b).';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash FROM pg_proc p WHERE p.oid = v_fn;
  IF v_hash IS NULL OR v_hash NOT IN ('942449150bb5e6fadfa7cf003f3fa49e', 'f1526e7727709356677c83fdea745491') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de apagar_categoria_vazia (hash %) não é o da 20261237000000 nem o desta migration — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_fn
          AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
          AND NOT p.proretset AND p.prorettype = 'jsonb'::regtype AND p.pronargs = 1
          AND p.proconfig = ARRAY['search_path=public']::text[]
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de apagar_categoria_vazia (linguagem, SECURITY DEFINER, volatilidade, retorno, argumentos ou search_path) não são os conhecidos.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_fn AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o EXECUTE de apagar_categoria_vazia não é o da 20261237000000 (só authenticated e service_role) — revise antes de aplicar.';
  END IF;
  IF v_usos IS NULL
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_usos)
        IS DISTINCT FROM 'de71936e57268db232630d37e88fe6cd' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.categoria__usos(uuid) ausente ou com corpo que não é o da 20261237000000 — a conta "produtos menos excluídos" depende dela; meça a loja antes de aplicar.';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: is_admin() ou is_admin_atual() ausente — aplique as anteriores antes.';
  END IF;
  -- Fotografia de TUDO que a função é no catálogo (OID, dono, ACL, atributos): o CREATE OR REPLACE só pode trocar o corpo.
  PERFORM set_config('ikcous.categoria_excluidos_1650', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_fn)::text, true);
END $preflight_20261650000000$;

-- ---------------------------------------------------------------------------
-- 1. Apagar a categoria: produto excluído não segura mais (corpo da 20261237000000 com a recusa por produto trocada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apagar_categoria_vazia(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $apagar_categoria$
DECLARE
  v_cat public.categorias%ROWTYPE;
  v_usos jsonb;
  v_produtos integer;
  v_excluidos integer;
  v_banners integer;
  v_regra integer;
  v_motivos text[] := ARRAY[]::text[];
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

  -- 20261650000000: produto EXCLUÍDO (deleted_at preenchido) não segura mais a categoria; só o que a lojista vê na
  -- lista (à venda ou pausado). O excluído não é tocado: segue com o nome escrito, que o relatório de vendas lê.
  IF v_produtos - v_excluidos > 0 THEN
    v_motivos := v_motivos || (
      (v_produtos - v_excluidos) || CASE WHEN v_produtos - v_excluidos = 1 THEN ' produto' ELSE ' produtos' END);
  END IF;
  IF v_banners > 0 THEN
    v_motivos := v_motivos || (v_banners || CASE WHEN v_banners = 1 THEN ' banner' ELSE ' banners' END);
  END IF;
  IF v_regra > 0 THEN
    v_motivos := v_motivos || 'a regra de devolução'::text;
  END IF;

  IF cardinality(v_motivos) > 0 THEN
    RAISE EXCEPTION 'A categoria "%" ainda está em uso: %. Mude os produtos de categoria, troque o link do banner e tire a categoria da regra de devolução antes de apagar. Se só quer tirá-la da vitrine, esconda.',
      v_cat.nome, array_to_string(v_motivos, ', ')
      USING ERRCODE = '55006';
  END IF;

  DELETE FROM public.categorias WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'nome', v_cat.nome, 'apagada', true, 'produtos_excluidos', v_excluidos);
END;
$apagar_categoria$;

COMMENT ON FUNCTION public.apagar_categoria_vazia(uuid) IS
  'Apaga a categoria só se nenhum produto da lista (à venda ou pausado), banner nem regra de devolução apontar para ela; '
  'produto excluído não segura e fica com o nome. Só o admin atual.';

-- CONFERÊNCIA no instante do apply: aborta a migration inteira se algo não ficou como desenhado.
DO $conferencia_20261650000000$
DECLARE
  v_fn oid := to_regprocedure('public.apagar_categoria_vazia(uuid)');
BEGIN
  IF v_fn IS NULL
     OR (SELECT count(*) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'apagar_categoria_vazia') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261650000000: apagar_categoria_vazia sumiu ou ganhou sobrecarga';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM 'f1526e7727709356677c83fdea745491' THEN
    RAISE EXCEPTION 'conferencia 20261650000000: o corpo vivo de apagar_categoria_vazia não é o desta migration';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_fn)
       IS DISTINCT FROM current_setting('ikcous.categoria_excluidos_1650')::jsonb THEN
    RAISE EXCEPTION 'conferencia 20261650000000: OID, dono, ACL ou atributo de apagar_categoria_vazia mudou';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261650000000: o EXECUTE de apagar_categoria_vazia não ficou só com authenticated e service_role';
  END IF;
END $conferencia_20261650000000$;

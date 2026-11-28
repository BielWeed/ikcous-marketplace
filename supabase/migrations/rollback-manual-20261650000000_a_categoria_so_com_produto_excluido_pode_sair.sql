-- ============================================================================
-- Rollback manual — a categoria que só tem produto excluído pode ser apagada (20261650000000)
-- ============================================================================
-- Devolve `public.apagar_categoria_vazia(uuid)` ao corpo da 20261237000000, BYTE A BYTE (LF, sem CR; md5
-- 942449150bb5e6fadfa7cf003f3fa49e — copiado do arquivo da 20261237000000, a única migration que a definiu antes desta) e o
-- COMMENT de antes. CREATE OR REPLACE: OID, dono, ACL e atributos ficam (a conferência compara com a fotografia do
-- pré-voo).
--
-- COM ELE VOLTA O DEFEITO: a categoria que só tem produto EXCLUÍDO volta a não poder ser apagada (a recusa manda
-- procurar o suporte), e a lojista não vê nem move produto excluído.
--
-- DADOS: nenhuma linha é lida para reescrita, reescrita ou apagada. As categorias apagadas enquanto a 20261650000000
-- esteve no ar FICAM apagadas (foi decisão da lojista; recriar é com ela, pela tela), e os produtos excluídos delas
-- seguem com o nome escrito, como sempre estiveram.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) antes de escrever se o corpo vivo não for o desta migration nem o da
-- 20261237000000 (uma redefinição posterior desconhecida está no ar: desfazer por cima a apagaria em silêncio), se a
-- função tiver sobrecarga ou atributos diferentes. Estados aceitos: a 20261650000000 no ar, ou já desfeita (rodar duas
-- vezes deixa o mesmo estado).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261650000000$
DECLARE
  v_fn oid := to_regprocedure('public.apagar_categoria_vazia(uuid)');
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'apagar_categoria_vazia') <> 1
     OR v_fn IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.apagar_categoria_vazia(uuid) ausente, com outra assinatura ou com sobrecarga — revise antes de desfazer.';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash FROM pg_proc p WHERE p.oid = v_fn;
  IF v_hash IS NULL OR v_hash NOT IN ('f1526e7727709356677c83fdea745491', '942449150bb5e6fadfa7cf003f3fa49e') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de apagar_categoria_vazia (hash %) não é o desta migration nem o da 20261237000000 — uma redefinição posterior está no ar; revise antes de sobrescrever.', COALESCE(v_hash, 'ausente');
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
  PERFORM set_config('ikcous.categoria_excluidos_1650_rb', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_fn)::text, true);
END $preflight_rollback_20261650000000$;

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

COMMENT ON FUNCTION public.apagar_categoria_vazia(uuid) IS
  'Apaga a categoria só se nenhum produto, banner nem regra de devolução apontar para ela. Só o admin atual.';

DO $conferencia_rollback_20261650000000$
DECLARE
  v_fn oid := to_regprocedure('public.apagar_categoria_vazia(uuid)');
BEGIN
  IF v_fn IS NULL
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '942449150bb5e6fadfa7cf003f3fa49e' THEN
    RAISE EXCEPTION 'conferencia rollback 20261650000000: o corpo de apagar_categoria_vazia não voltou ao da 20261237000000';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_fn)
       IS DISTINCT FROM current_setting('ikcous.categoria_excluidos_1650_rb')::jsonb THEN
    RAISE EXCEPTION 'conferencia rollback 20261650000000: OID, dono, ACL ou atributo de apagar_categoria_vazia mudou';
  END IF;
END $conferencia_rollback_20261650000000$;

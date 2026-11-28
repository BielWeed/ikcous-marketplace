-- ============================================================================
-- Migration 20261651000000 — a ordem dos banners muda numa trava só, dentro do banco
-- (caça "concorrência entre aparelhos", src/hooks/useBanners.ts, 27/11/2026)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
--   (a) Arrumar as posições de uma página de banners (`normalizeBannersOrder` no painel) LIA a ordem e depois gravava cada
--       posição numa gravação separada, sem trava no banco. A fila que impede duas arrumações de se cruzarem só existe no
--       aparelho: com dois aparelhos (ou excluir seguido de trocar a ordem com rede lenta), duas arrumações se cruzavam e a
--       página ficava com posição repetida ou com buraco.
--   (b) Subir/descer um banner mandava à `reorder_banners_atomic` o id do VIZINHO calculado no aparelho. Se outro aparelho
--       mudou a lista, a troca acontecia com o banner errado.
--
-- 2. O QUE ESTA MIGRATION FAZ, NA ORDEM
--
--   0. Pré-voo (B1_BASELINE_DIVERGENT, antes de qualquer escrita; ver 5) e fotografia da `reorder_banners_atomic` do ar.
--   1. RPC NOVA `public.normalize_banners_atomic(p_position text, p_prioritario uuid DEFAULT NULL,
--      p_prioritario_depois boolean DEFAULT false) RETURNS integer`: admin de agora (`is_admin_atual`), posição válida,
--      trava da PÁGINA (`pg_advisory_xact_lock` pela posição) e depois as linhas dela (`FOR UPDATE` por id); renumera
--      1..n numa transação só, na ordem que a tela mostra (ordem nula conta como 0; no empate, o banner recém-salvo
--      entra antes — ou depois, quando desceu — e por fim o id). Devolve quantas linhas regravou.
--   2. RPC NOVA `public.move_banner_atomic(p_position text, p_banner_id uuid, p_direcao text) RETURNS uuid`: as mesmas
--      guardas e a mesma trava; arruma a página como a (1) (sem prioritário), acha o vizinho de cima ('cima') ou de baixo
--      ('baixo') DENTRO do banco e troca as duas posições. Banner ausente ou de outra página: 'Banner não encontrado.'
--      (a frase que o painel já trata). Na ponta não troca e devolve NULL; senão devolve o id do vizinho com quem trocou.
--   3. ACL das duas igual à da `reorder_banners_atomic`: REVOKE de PUBLIC e anon, GRANT a authenticated e service_role.
--   4. Conferência no fim (aborta a migration inteira se algo não ficou como desenhado) e recarga do cache do PostgREST.
--
--   POR QUE A TRAVA DA PÁGINA ALÉM DO FOR UPDATE: só com `FOR UPDATE`, uma arrumação que já travou as linhas {1,2,3} e
--   outra que começou depois de um banner novo entrar ({0,1,2,3}) travariam em ordens diferentes (a segunda segura o 0 e
--   espera o 1; a primeira, ao renumerar, esbarra no 0) e o banco derrubaria uma com 40P01. Com a trava da página ANTES
--   de qualquer linha, quem chega depois espera inteira, sem segurar nada.
--
-- 3. DADOS EXISTENTES
--
--   NENHUMA linha é lida para reescrita, reescrita ou apagada ao aplicar. As posições que já estão repetidas ou com buraco
--   ficam como estão até a lojista mexer na ordem daquela página (aí a RPC as arruma, como a arrumação do painel já fazia).
--   Nenhuma tabela, coluna, política, gatilho ou função existente muda: `reorder_banners_atomic` e `swap_banner_order`
--   ficam intactas (o app velho em cache ainda chama a primeira; a conferência compara a fotografia dela com o corpo).
--
-- 4. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
--   `CREATE OR REPLACE` + REVOKE/GRANT explícitos (nenhum DROP): reaplicar deixa o mesmo estado (o pré-voo aceita as
--   funções ausentes OU com o corpo desta). Sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa, AGENTS.md):
--   quem abre a transação é o aplicador (`aplicar-migrations.yml` / `node scripts/db-apply.cjs <arquivo>`); pré-voo,
--   criação, ACL e conferência caem juntos ou não caem. `lock_timeout = 5s`. Criar função não trava `banners`.
--   As RPCs em si: `normalize_banners_atomic` é idempotente (chamar duas vezes deixa 1..n igual; a segunda devolve 0).
--   `move_banner_atomic` NÃO é idempotente (mover duas vezes anda duas casas), como a troca antiga.
--   A `reorder_banners_atomic` antiga trava só as linhas, sem a trava da página: contra uma das novas, no pior caso o
--   banco derruba uma das duas com 40P01 (nada fica pela metade; o painel relê a lista).
--
-- 5. PRÉ-VOO
--
--   Recusa se: `public.banners` sem as colunas id (uuid), position (text) e order (integer); `public.is_admin_atual()`
--   ausente; `normalize_banners_atomic` ou `move_banner_atomic` já existem com outra assinatura, com sobrecarga ou com
--   corpo que não é o desta (uma redefinição desconhecida no ar).
--
-- 6. FORA DO ESCOPO
--
--   * Apagar a `reorder_banners_atomic` / `swap_banner_order`: o app velho em cache ainda as chama.
--   * Arrumar agora as páginas que já estão com posição repetida: seria escrever dado no apply.
--
-- 7. ORDEM E QUEM QUEBRA
--
--   Depois da 20261381000000 (a `is_admin_atual` nas portas do painel). Banco antes ou depois do front dá no mesmo: o front
--   novo chama as RPCs novas e, se a loja ainda não as tem (PGRST202/42883), cai no caminho antigo. Ninguém quebra.
--
-- 8. FICHA DE VERIFICAÇÃO (só leitura)
--
--   SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.normalize_banners_atomic(text,uuid,boolean)');
--   SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.move_banner_atomic(text,uuid,text)');
--   Consultas oficiais: 207a (depois) / 207b (antes), em scripts/publicacao/consultas/.
--
-- 9. ROLLBACK
--
--   rollback-manual-20261651000000_a_ordem_dos_banners_muda_numa_trava_so.sql: tira SÓ as duas funções novas. Nenhuma
--   linha é tocada; a ordem gravada por elas fica. O front novo volta sozinho ao caminho antigo (PGRST202).
--
-- PROVA VIVA: tests/banco/a-ordem-dos-banners-muda-numa-trava-so-viva.cjs (rpc-ci, Postgres efêmero).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261651000000$
DECLARE
  v_h_normaliza text := 'c221e4ba453f3f659574f03fcd1341e3';
  v_h_move text := '2da1c33deaceb650951a795b9d720eb7';
  v_forma text;
  v_hash text;
BEGIN
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.banners') AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('id', 'position', 'order');
  IF v_forma IS DISTINCT FROM 'id:uuid,order:integer,position:text' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.banners sem as colunas id (uuid), position (text) e order (integer) (%); revise antes de aplicar.', COALESCE(v_forma, 'ausente');
  END IF;
  IF to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin_atual() ausente — aplique a 20261197000000 antes (consulta 207b).';
  END IF;

  -- As RPCs novas: ausentes, ou exatamente as desta migration (sem sobrecarga).
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'normalize_banners_atomic') > 1
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'move_banner_atomic') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: normalize_banners_atomic ou move_banner_atomic tem sobrecarga em public; revise antes de aplicar.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'normalize_banners_atomic') THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc
     WHERE oid = to_regprocedure('public.normalize_banners_atomic(text,uuid,boolean)');
    IF v_hash IS DISTINCT FROM v_h_normaliza THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: normalize_banners_atomic ja existe com outra assinatura ou corpo (hash %); revise antes de aplicar.', COALESCE(v_hash, 'outra assinatura');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'move_banner_atomic') THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc
     WHERE oid = to_regprocedure('public.move_banner_atomic(text,uuid,text)');
    IF v_hash IS DISTINCT FROM v_h_move THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: move_banner_atomic ja existe com outra assinatura ou corpo (hash %); revise antes de aplicar.', COALESCE(v_hash, 'outra assinatura');
    END IF;
  END IF;

  -- Fotografia da reorder_banners_atomic do ar (corpo, OID, dono, ACL, atributos): esta migration não pode tocá-la.
  PERFORM set_config('ikcous.ordem_banners_1651_reorder',
    COALESCE((SELECT to_jsonb(p)::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reorder_banners_atomic(text,uuid,uuid)')), 'ausente'),
    true);
END $preflight_20261651000000$;

-- ---------------------------------------------------------------------------
-- 1. Arrumar a página inteira numa transação, sob a trava da página
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_banners_atomic(
  p_position text,
  p_prioritario uuid DEFAULT NULL,
  p_prioritario_depois boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $normaliza_banners$
DECLARE
  v_banner record;
  v_next_order integer := 1;
  v_regravados integer := 0;
BEGIN
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  IF p_position IS NULL OR p_position NOT IN ('home_top', 'home_middle', 'home_bottom') THEN
    RAISE EXCEPTION 'Posição inválida.';
  END IF;

  -- A trava da página vem ANTES de qualquer linha: duas arrumações (ou uma arrumação e um mover) da
  -- mesma página esperam uma pela outra inteiras, e nunca travam as linhas em ordens diferentes.
  PERFORM pg_advisory_xact_lock(hashtextextended('ikcous.banners.ordem:' || p_position, 0));
  PERFORM 1 FROM public.banners WHERE "position" = p_position ORDER BY id FOR UPDATE;

  -- A ordem que a tela mostra (ordem nula conta como 0); no empate, o banner recém-salvo entra antes
  -- (ou depois, quando desceu) e por fim o id.
  FOR v_banner IN
    SELECT id, "order" FROM public.banners
    WHERE "position" = p_position
    ORDER BY COALESCE("order", 0) ASC,
             CASE WHEN id = p_prioritario THEN CASE WHEN p_prioritario_depois THEN 1 ELSE -1 END ELSE 0 END ASC,
             id ASC
  LOOP
    IF v_banner."order" IS DISTINCT FROM v_next_order THEN
      UPDATE public.banners SET "order" = v_next_order WHERE id = v_banner.id;
      v_regravados := v_regravados + 1;
    END IF;
    v_next_order := v_next_order + 1;
  END LOOP;

  RETURN v_regravados;
END;
$normaliza_banners$;

REVOKE EXECUTE ON FUNCTION public.normalize_banners_atomic(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_banners_atomic(text, uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Subir/descer: o vizinho é achado dentro do banco, sob a mesma trava
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_banner_atomic(
  p_position text,
  p_banner_id uuid,
  p_direcao text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $move_banner$
DECLARE
  v_banner record;
  v_next_order integer := 1;
  v_ordem integer;
  v_vizinho uuid;
  v_ordem_vizinho integer;
BEGIN
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  IF p_position IS NULL OR p_position NOT IN ('home_top', 'home_middle', 'home_bottom') THEN
    RAISE EXCEPTION 'Posição inválida.';
  END IF;

  IF p_direcao IS NULL OR p_direcao NOT IN ('cima', 'baixo') THEN
    RAISE EXCEPTION 'Direção inválida.';
  END IF;

  -- A mesma trava da arrumação (normalize_banners_atomic): página primeiro, linhas por id depois.
  PERFORM pg_advisory_xact_lock(hashtextextended('ikcous.banners.ordem:' || p_position, 0));
  PERFORM 1 FROM public.banners WHERE "position" = p_position ORDER BY id FOR UPDATE;

  -- Arruma 1..n na ordem que a tela mostra, para "vizinho" ser o da lista de agora, sem empate.
  FOR v_banner IN
    SELECT id, "order" FROM public.banners
    WHERE "position" = p_position
    ORDER BY COALESCE("order", 0) ASC, id ASC
  LOOP
    IF v_banner."order" IS DISTINCT FROM v_next_order THEN
      UPDATE public.banners SET "order" = v_next_order WHERE id = v_banner.id;
    END IF;
    v_next_order := v_next_order + 1;
  END LOOP;

  SELECT "order" INTO v_ordem FROM public.banners
  WHERE id = p_banner_id AND "position" = p_position;

  -- Excluído (ou levado a outra página) em outro aparelho: desfaz também a arrumação acima.
  IF v_ordem IS NULL THEN
    RAISE EXCEPTION 'Banner não encontrado.';
  END IF;

  IF p_direcao = 'cima' THEN
    SELECT id, "order" INTO v_vizinho, v_ordem_vizinho FROM public.banners
    WHERE "position" = p_position AND "order" < v_ordem ORDER BY "order" DESC LIMIT 1;
  ELSE
    SELECT id, "order" INTO v_vizinho, v_ordem_vizinho FROM public.banners
    WHERE "position" = p_position AND "order" > v_ordem ORDER BY "order" ASC LIMIT 1;
  END IF;

  -- Já na ponta: nada a trocar.
  IF v_vizinho IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.banners SET "order" = v_ordem_vizinho WHERE id = p_banner_id;
  UPDATE public.banners SET "order" = v_ordem WHERE id = v_vizinho;

  RETURN v_vizinho;
END;
$move_banner$;

REVOKE EXECUTE ON FUNCTION public.move_banner_atomic(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_banner_atomic(text, uuid, text) TO authenticated, service_role;

-- CONFERÊNCIA no instante do apply: aborta a migration inteira se algo não ficou como desenhado.
DO $conferencia_20261651000000$
DECLARE
  v_norm oid := to_regprocedure('public.normalize_banners_atomic(text,uuid,boolean)');
  v_move oid := to_regprocedure('public.move_banner_atomic(text,uuid,text)');
BEGIN
  IF v_norm IS NULL OR v_move IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('normalize_banners_atomic', 'move_banner_atomic')) <> 2 THEN
    RAISE EXCEPTION 'conferencia 20261651000000: as RPCs novas nao existem ou ganharam sobrecarga';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_norm) IS DISTINCT FROM 'c221e4ba453f3f659574f03fcd1341e3'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_move) IS DISTINCT FROM '2da1c33deaceb650951a795b9d720eb7' THEN
    RAISE EXCEPTION 'conferencia 20261651000000: o corpo das RPCs novas nao e o desta migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_norm AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proretset AND p.prorettype = 'integer'::regtype
                    AND p.proconfig = ARRAY['search_path=public']::text[])
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                     WHERE p.oid = v_move AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                       AND NOT p.proretset AND p.prorettype = 'uuid'::regtype
                       AND p.proconfig = ARRAY['search_path=public']::text[]) THEN
    RAISE EXCEPTION 'conferencia 20261651000000: atributos das RPCs novas (linguagem, SECURITY DEFINER, volatilidade, retorno ou search_path) nao sao os desenhados';
  END IF;
  -- EXECUTE como o da reorder_banners_atomic: authenticated e service_role; nem PUBLIC, nem anon.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid IN (v_norm, v_move) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_norm, 'EXECUTE') OR has_function_privilege('anon', v_move, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_norm, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_move, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_norm, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_move, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261651000000: o EXECUTE das RPCs novas deve ser so de authenticated e service_role';
  END IF;
  IF COALESCE((SELECT to_jsonb(p)::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reorder_banners_atomic(text,uuid,uuid)')), 'ausente')
       IS DISTINCT FROM current_setting('ikcous.ordem_banners_1651_reorder') THEN
    RAISE EXCEPTION 'conferencia 20261651000000: a reorder_banners_atomic do ar mudou (corpo, OID, dono, ACL ou atributo)';
  END IF;
END $conferencia_20261651000000$;

-- As funções são RPC chamadas pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';

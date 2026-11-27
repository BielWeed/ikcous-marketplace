-- ============================================================================
-- Migration 20261645000000 — o aviso do vale-troca diz que a loja combina o vale, não que ele foi emitido
-- (caça "promessas em texto x código", topo f1784d582, 27/11/2026)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
--   Quando a lojista conclui uma devolução com a resolução vale-troca, o gatilho `tr_devolucao_avisa_o_cliente`
--   (função `public.devolucao_avisa_o_cliente()`, corpo VIVO da 20261241000000) grava no sino da CLIENTE:
--   "O vale-troca da devolução <protocolo> foi emitido." O app NÃO emite vale nenhum: `admin_devolucao_concluir`
--   só grava `resolucao_final = 'vale'` e o evento; quem cria o vale (um cupom, por exemplo) é a loja, por conta
--   própria — o painel já diz isso à lojista (`AcoesDaDevolucao.tsx`: "crie o vale ... O app não cria sozinho.") e a
--   ficha do pedido da cliente já diz "A loja combina com você o valor e como usar" (`instrucaoParaOCliente`).
--   Só o sino afirmava o contrário.
--
-- 2. O QUE ESTA MIGRATION FAZ, NA ORDEM
--
--   0. Pré-voo (B1_BASELINE_DIVERGENT, antes de qualquer escrita; ver 5) e fotografia da função no catálogo.
--   1. `CREATE OR REPLACE` de `public.devolucao_avisa_o_cliente()` com o corpo VIVO da 20261241000000
--      (md5 56502b960dcf3e136c1d0d5c41091c20) trocando SÓ o texto do ramo vale (e duas linhas de comentário
--      acima dele). Texto novo: "A devolução <protocolo> foi resolvida com vale-troca. A loja combina com você o valor e
--      como usar. Se não tiver notícia, fale com a loja." Corpo novo md5 68792e520aa47e6e62330718430d82a8. Título ("Devolução
--      concluída"), tipo ('success'), os ramos de reembolso e troca, o INSERT em notificacoes e o tratamento de erro
--      ficam IGUAIS. MESMA assinatura, linguagem, SECURITY DEFINER, `search_path = public`, volatilidade, dono e ACL
--      (CREATE OR REPLACE preserva OID, dono e ACL; a conferência compara com a fotografia).
--   2. Conferência no fim (aborta a migration inteira se algo não ficou como desenhado).
--
-- 3. DADOS EXISTENTES
--
--   NENHUMA linha é lida para reescrita, reescrita ou apagada. O aviso que JÁ foi gravado no sino ("foi emitido") fica
--   como está: é o registro do que o app disse naquele dia. Só as conclusões com vale DEPOIS do apply recebem o texto
--   novo. Nenhuma tabela, coluna, gatilho ou permissão muda; o gatilho segue o mesmo (só a função dele troca de corpo).
--
-- 4. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
--   `CREATE OR REPLACE` (nenhum DROP): reaplicar deixa o mesmo estado (o pré-voo aceita o corpo de antes OU o desta).
--   Sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa, AGENTS.md): quem abre a transação é o aplicador
--   (`aplicar-migrations.yml` / `node scripts/db-apply.cjs <arquivo>`); pré-voo, troca e conferência caem juntos ou não
--   caem (a fotografia é `set_config` local à transação). `lock_timeout = 5s`: uma loja em uso falha limpo em vez de
--   travar quem conclui devolução; repetir depois. Uma conclusão em voo durante o apply usa o corpo que estava valendo
--   quando o gatilho disparou (o de antes ou o novo); as duas versões gravam o mesmo título e o mesmo tipo.
--
-- 5. PRÉ-VOO
--
--   Recusa se: `devolucao_avisa_o_cliente` ausente, com sobrecarga ou com corpo que não seja o da 20261241000000 nem o
--   desta (uma redefinição desconhecida no ar); atributos diferentes (plpgsql, SECURITY DEFINER, VOLATILE, retorno
--   trigger, sem argumento, search_path=public); EXECUTE aberto a PUBLIC, anon ou authenticated; o gatilho
--   `tr_devolucao_avisa_o_cliente` ausente, desligado ou apontando para outra função; ou `public.notificacoes` e
--   `public.devolucoes` sem as colunas que o corpo lê e grava.
--
-- 6. FORA DO ESCOPO
--
--   * O evento da linha do tempo "Vale-troca emitido" que `admin_devolucao_concluir` grava (corpo vivo da
--     20261395200000): função de DINHEIRO, com a sua própria cadeia de pré-voos; fica para um lote próprio.
--   * Emitir vale de verdade pelo app (cupom automático): decisão de produto.
--
-- 7. ORDEM E QUEM QUEBRA
--
--   Depois da 20261241000000. Banco antes ou depois do front dá no mesmo: o front só exibe o texto gravado. Ninguém
--   quebra: nenhum código lê o texto do aviso. O rollback da 20261241000000 passa a exigir que esta saia antes (o
--   pré-voo dele recusa o corpo novo — o comportamento certo); `tests/banco/o-aviso-do-vale-troca-posterior.cjs` é a
--   entrada única para as provas que desfazem a 20261241000000.
--
-- 8. FICHA DE VERIFICAÇÃO (só leitura)
--
--   -- Corpo (esperado: 68792e520aa47e6e62330718430d82a8):
--   SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.devolucao_avisa_o_cliente()');
--   Consultas oficiais: 205a (depois) / 205b (antes), em scripts/publicacao/consultas/.
--
-- 9. ROLLBACK
--
--   rollback-manual-20261645000000_o_aviso_do_vale_troca_diz_que_a_loja_combina.sql: devolve o corpo da 20261241000000
--   byte a byte (md5 56502b960dcf3e136c1d0d5c41091c20). Nenhuma linha é tocada; avisos gravados com o texto novo ficam.
--
-- PROVA VIVA: tests/banco/o-aviso-do-vale-troca-diz-que-a-loja-combina-viva.cjs (rpc-ci, Postgres efêmero).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261645000000$
DECLARE
  v_fn oid := to_regprocedure('public.devolucao_avisa_o_cliente()');
  v_hash text;
  v_falta text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolucao_avisa_o_cliente') <> 1
     OR v_fn IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucao_avisa_o_cliente() ausente, com outra assinatura ou com sobrecarga — aplique a 20261241000000 antes e meça a loja (consulta 205b).';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash FROM pg_proc p WHERE p.oid = v_fn;
  IF v_hash IS NULL OR v_hash NOT IN ('56502b960dcf3e136c1d0d5c41091c20', '68792e520aa47e6e62330718430d82a8') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de devolucao_avisa_o_cliente (hash %) não é o da 20261241000000 nem o desta migration — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_fn
          AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
          AND NOT p.proretset AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de devolucao_avisa_o_cliente (linguagem, SECURITY DEFINER, volatilidade, retorno, argumentos ou search_path) não são os conhecidos.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_fn AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucao_avisa_o_cliente está aberta a PUBLIC, anon ou authenticated — não é a ACL da 20261175000000; revise antes de aplicar.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.devolucoes')
          AND t.tgname = 'tr_devolucao_avisa_o_cliente'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = v_fn
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_devolucao_avisa_o_cliente não existe, está desligado ou aponta para outra função.';
  END IF;
  -- O PL/pgSQL só acusa coluna ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.tabela || '.' || d.coluna, ', ' ORDER BY d.tabela, d.coluna) INTO v_falta
    FROM (VALUES
            ('notificacoes', 'usuario_id'), ('notificacoes', 'tipo'), ('notificacoes', 'titulo'),
            ('notificacoes', 'mensagem'), ('notificacoes', 'dados'),
            ('devolucoes', 'id'), ('devolucoes', 'protocolo'), ('devolucoes', 'order_id'), ('devolucoes', 'user_id'),
            ('devolucoes', 'status'), ('devolucoes', 'resolucao_final'), ('devolucoes', 'refund_id'),
            ('devolucoes', 'reembolso_manual')
         ) AS d(tabela, coluna)
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = to_regclass('public.' || d.tabela)
                        AND a.attname = d.coluna AND NOT a.attisdropped AND a.attnum > 0);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo lê ou grava não existem: % — aplique as migrations anteriores antes.', v_falta;
  END IF;
  -- Fotografia de TUDO que a função é no catálogo (OID, dono, ACL, atributos): o CREATE OR REPLACE só pode trocar o corpo.
  PERFORM set_config('ikcous.vale_troca_1645', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_fn)::text, true);
END $preflight_20261645000000$;

-- ---------------------------------------------------------------------------
-- 1. O aviso da cliente: o ramo do vale diz que a loja combina (corpo da 20261241000000 com uma frase trocada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $avisa_o_cliente$
DECLARE
  v_titulo text;
  v_msg text;
  v_tipo text := 'info';
  v_evento text;
  v_estado text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  CASE NEW.status
    WHEN 'aprovada' THEN
      v_titulo := 'Devolução aprovada';
      v_msg := 'A loja aprovou a devolução ' || NEW.protocolo || '. Veja as instruções no pedido.';
    WHEN 'recusada' THEN
      v_tipo := 'warning';
      v_titulo := 'Devolução não aprovada';
      v_msg := 'A loja respondeu a devolução ' || NEW.protocolo || '. Veja o motivo no pedido.';
    WHEN 'recebida' THEN
      v_titulo := 'Produto recebido pela loja';
      v_msg := 'A loja recebeu o produto da devolução ' || NEW.protocolo || '.';
    WHEN 'concluida' THEN
      v_tipo := 'success';
      v_titulo := 'Devolução concluída';
      IF NEW.resolucao_final = 'reembolso' THEN
        -- O estado REAL do dinheiro, lido AGORA: nunca "liberado" por antecipação. O
        -- "liberado" de verdade nasce no gatilho de order_refunds, quando o MP confirma.
        IF NEW.reembolso_manual THEN
          v_estado := 'manual';
        ELSE
          SELECT r.status INTO v_estado FROM public.order_refunds r WHERE r.id = NEW.refund_id;
        END IF;
        CASE COALESCE(v_estado, 'sem_linha')
          WHEN 'manual' THEN
            v_evento := 'reembolso_combinado';
            v_msg := 'O reembolso da devolução ' || NEW.protocolo || ' foi combinado com a loja (em mãos ou por PIX). Se tiver dúvida, fale com a loja.';
          WHEN 'concluido' THEN
            v_evento := 'reembolso_liberado';
            v_msg := 'O reembolso da devolução ' || NEW.protocolo || ' foi liberado pelo Mercado Pago.';
          WHEN 'solicitado', 'em_processamento' THEN
            v_evento := 'reembolso_em_processamento';
            v_tipo := 'info';
            v_msg := 'Devolução ' || NEW.protocolo || ' concluída. A loja está confirmando sua devolução com o Mercado Pago.';
          ELSE
            v_evento := 'reembolso_nao_liberado';
            v_tipo := 'warning';
            v_msg := 'A loja concluiu a devolução ' || NEW.protocolo || ', mas o reembolso ainda não foi liberado. A loja está resolvendo e vai falar com você.';
        END CASE;
      ELSE
        -- 20261645000000: o app NÃO emite vale-troca (a loja o cria por conta própria, ex.: um cupom, e o painel
        -- avisa a lojista disso). O aviso diz o que acontece de fato, com as palavras da ficha do pedido.
        v_msg := CASE NEW.resolucao_final
          WHEN 'troca' THEN 'A troca da devolução ' || NEW.protocolo || ' foi confirmada.'
          ELSE 'A devolução ' || NEW.protocolo || ' foi resolvida com vale-troca. A loja combina com você o valor e como usar. Se não tiver notícia, fale com a loja.'
        END;
      END IF;
    WHEN 'reprovada' THEN
      v_tipo := 'warning';
      v_titulo := 'Produto não aceito na inspeção';
      v_msg := 'Veja no pedido o retorno da loja sobre a devolução ' || NEW.protocolo || '.';
    ELSE
      RETURN NEW;
  END CASE;

  IF v_evento IS NOT NULL THEN
    PERFORM public.devolucao__avisar_reembolso(NEW.id, v_evento, v_tipo, v_titulo, v_msg);
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
    VALUES (NEW.user_id, v_tipo, v_titulo, v_msg,
            jsonb_build_object('order_id', NEW.order_id, 'devolucao_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'devolucao_avisa_o_cliente: aviso da devolução % não nasceu (%).', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$avisa_o_cliente$;

-- CONFERÊNCIA no instante do apply: aborta a migration inteira se algo não ficou como desenhado.
DO $conferencia_20261645000000$
DECLARE
  v_fn oid := to_regprocedure('public.devolucao_avisa_o_cliente()');
BEGIN
  IF v_fn IS NULL
     OR (SELECT count(*) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolucao_avisa_o_cliente') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261645000000: devolucao_avisa_o_cliente sumiu ou ganhou sobrecarga';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '68792e520aa47e6e62330718430d82a8' THEN
    RAISE EXCEPTION 'conferencia 20261645000000: o corpo vivo de devolucao_avisa_o_cliente não é o desta migration';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_fn)
       IS DISTINCT FROM current_setting('ikcous.vale_troca_1645')::jsonb THEN
    RAISE EXCEPTION 'conferencia 20261645000000: OID, dono, ACL ou atributo de devolucao_avisa_o_cliente mudou';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.devolucoes')
          AND t.tgname = 'tr_devolucao_avisa_o_cliente'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = v_fn
     ) THEN
    RAISE EXCEPTION 'conferencia 20261645000000: o gatilho tr_devolucao_avisa_o_cliente não está ligado à função';
  END IF;
END $conferencia_20261645000000$;

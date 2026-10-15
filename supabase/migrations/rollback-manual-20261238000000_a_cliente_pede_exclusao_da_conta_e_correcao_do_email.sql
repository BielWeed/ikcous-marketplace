-- ============================================================================
-- Rollback manual — a cliente pede a exclusão da conta e a correção do e-mail (20261238000000)
-- ============================================================================
-- Desfaz o que a migration criou: o gatilho, a função do gatilho, as três políticas e a tabela
-- public.pedidos_de_privacidade (com os dois índices). O estado de ANTES é a AUSÊNCIA de tudo isso — a migration
-- não alterou nenhum objeto que já existisse —, então não há corpo vivo a reproduzir: o que este arquivo
-- entrega é "nenhum desses objetos existe".
--
-- COM ELE VOLTA O DEFEITO: o app volta a não ter caminho para a cliente pedir exclusão de conta ou correção de e-mail.
--
-- DADOS — A TRAVA: a tabela guarda pedidos de privacidade, que são REGISTRO LEGAL da loja. O pré-voo RECUSA
-- (B1_BASELINE_DIVERGENT) se houver QUALQUER linha: nada é apagado por este arquivo. Para desfazer de verdade com
-- pedidos registrados, o dono do banco exporta/arquiva as linhas por fora e só então esvazia a tabela — decisão
-- humana, nunca deste script. Sem pedidos (tabela vazia), o rollback é seguro.
--
-- PRÉ-VOO: trava a tabela (ACCESS EXCLUSIVE, `lock_timeout` de 5 s) ANTES de conferir; recusa se a tabela tiver
-- linha(s) — contagem E tamanho em disco, porque sob REPEATABLE READ só o tamanho enxerga pedido gravado no meio;
-- se a tabela não existir (migration não aplicada: nada a desfazer); ou se as políticas/gatilho de agora não forem exatamente os da migration (estado divergente: meça antes).
-- A conferência final recusa se algum objeto sobrou.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa. Rodar duas vezes: a segunda recusa no pré-voo (nada a desfazer).
-- ============================================================================

SET LOCAL lock_timeout = '5s';

DO $preflight_rollback_20261238$
DECLARE
  v_rel regclass := to_regclass('public.pedidos_de_privacidade');
  v_linhas bigint;
  v_politicas text;
BEGIN
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pedidos_de_privacidade não existe — a migration 20261238000000 não está aplicada; nada a desfazer.';
  END IF;

  -- TRAVA ANTES DE CONTAR: sem ela, um pedido gravado entre a contagem e o DROP sumiria junto com a tabela. A trava
  -- vale até o fim da transação (o aplicador a abre) e fecha a tabela para leitura e escrita; com `lock_timeout`,
  -- se alguém a segura por mais de 5 s o rollback FALHA (55P03) sem desfazer nada, em vez de esperar sem prazo.
  LOCK TABLE public.pedidos_de_privacidade IN ACCESS EXCLUSIVE MODE;

  EXECUTE 'SELECT count(*) FROM public.pedidos_de_privacidade' INTO v_linhas;
  IF v_linhas > 0 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: há % pedido(s) de privacidade registrado(s) — são registro legal; exporte/arquive por fora e decida o que fazer antes de desfazer. Nada foi apagado.', v_linhas;
  END IF;

  -- Cinto para a contagem: sob REPEATABLE READ (o envelope do aplicador) a foto da contagem pode ser mais velha que
  -- a trava e NÃO enxergar um pedido gravado no meio. O tamanho físico da tabela enxerga: tabela que já guardou
  -- linha (mesmo apagada por fora, sem VACUUM) tem tamanho > 0 e também RECUSA — a decisão é do dono.
  IF pg_relation_size(v_rel) > 0 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a tabela public.pedidos_de_privacidade já guardou linha(s) (tamanho em disco % bytes, mesmo que a contagem não as veja) — são registro legal; confira por fora e decida antes de desfazer. Nada foi apagado.', pg_relation_size(v_rel);
  END IF;

  SELECT string_agg(polname::text || ':' || polcmd::text, ', ' ORDER BY polname) INTO v_politicas
    FROM pg_policy WHERE polrelid = v_rel;
  IF v_politicas IS DISTINCT FROM
     'pedidos_de_privacidade_admin_update_policy:w, pedidos_de_privacidade_dono_insert_policy:a, pedidos_de_privacidade_dono_ou_admin_select_policy:r' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: as políticas vivas de pedidos_de_privacidade (%) não são as da migration — meça antes de desfazer.', COALESCE(v_politicas, 'nenhuma');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = v_rel AND t.tgname = 'tr_pedidos_de_privacidade_carimbar' AND NOT t.tgisinternal
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_pedidos_de_privacidade_carimbar não está na tabela — meça antes de desfazer.';
  END IF;
END $preflight_rollback_20261238$;

DROP POLICY pedidos_de_privacidade_admin_update_policy ON public.pedidos_de_privacidade;
DROP POLICY pedidos_de_privacidade_dono_insert_policy ON public.pedidos_de_privacidade;
DROP POLICY pedidos_de_privacidade_dono_ou_admin_select_policy ON public.pedidos_de_privacidade;
DROP TRIGGER tr_pedidos_de_privacidade_carimbar ON public.pedidos_de_privacidade;
DROP FUNCTION public.pedidos_de_privacidade__carimbar();
DROP TABLE public.pedidos_de_privacidade;

DO $conferencia_rollback_20261238$
BEGIN
  IF to_regclass('public.pedidos_de_privacidade') IS NOT NULL
     OR to_regclass('public.uq_pedidos_de_privacidade_um_aberto') IS NOT NULL
     OR to_regclass('public.idx_pedidos_de_privacidade_situacao_criado') IS NOT NULL
     OR to_regprocedure('public.pedidos_de_privacidade__carimbar()') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261238: sobrou objeto da migration';
  END IF;
END $conferencia_rollback_20261238$;

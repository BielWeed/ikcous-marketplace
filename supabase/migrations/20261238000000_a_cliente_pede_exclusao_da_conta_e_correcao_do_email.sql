-- ============================================================================
-- Migration 20261238000000 — a cliente pede a exclusão da conta e a correção do e-mail
-- (dado de cliente + permissão; ADITIVA: cria UMA tabela, UMA função de gatilho e as regras dela; nada existente muda)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION RESOLVE
--
-- O app não tem NENHUM caminho para a cliente pedir a exclusão da conta ou a correção do e-mail (a LGPD exige um
-- caminho claro). Apagar automático é perigoso: pedido de compra aponta para o login sem cascata, e apagar sumiria o
-- histórico fiscal. Trocar o e-mail pela própria cliente depende de um remetente de e-mail próprio que ainda não
-- existe. Então esta migration cria o REGISTRO do pedido; quem ATENDE é a loja, à mão, por anonimização (nunca
-- apagando sozinho) — roteiro em docs/runbooks/atender-pedido-de-privacidade.md.
--
-- 2. O QUE É CRIADO
--
--   public.pedidos_de_privacidade
--     id            uuid, chave primária;
--     user_id       uuid -> auth.users(id), SEM cascata (apagar o login não apaga, nem é permitido enquanto
--                   houver pedido: o pedido é registro legal da loja);
--     tipo          'excluir_conta' | 'corrigir_email';
--     email_novo    o e-mail pedido (só no 'corrigir_email'; formato e tamanho conferidos);
--     situacao      'aberto' (nasce assim) | 'atendido' | 'recusado';
--     criado_em, atendido_em, atendido_por (carimbados pelo gatilho, nunca digitados), observacao (nota da loja).
--
--   public.pedidos_de_privacidade__carimbar()  -- gatilho BEFORE UPDATE (carimba quem/quando decidiu, trava o resto)
--
-- 3. QUEM PODE O QUÊ (RLS ligada; ACL fechada para PUBLIC e anon)
--
--   * a cliente (authenticated) LÊ só os pedidos dela e INSERE só em nome dela (user_id = auth.uid()), com apenas
--     três colunas (user_id, tipo, email_novo): situação, carimbos e observação nascem do servidor;
--   * no máximo UM pedido ABERTO por (cliente, tipo) — índice único parcial; o segundo falha com 23505;
--   * só o admin de AGORA (rls_admin_atual(), a mesma régua do dinheiro) LÊ todos e ATUALIZA situacao e observacao;
--     o gatilho carimba atendido_em/atendido_por e recusa mexer em pedido já decidido;
--   * NINGUÉM APAGA: nenhum grant de DELETE (nem para o service_role) e nenhuma política de DELETE. Quem decide
--     apagar um pedido é o dono do banco, por fora do app.
--
-- 4. AVISO À LOJA
--
-- Nenhuma função, nenhuma edge e nenhum gatilho de aviso novo: o painel conta os pedidos abertos como mais uma
-- fonte da lista de avisos (a tela de Notificações) e acende a bolinha vermelha do sino, junto de pedidos,
-- devoluções, perguntas e avaliações — leitura (só a contagem) protegida pela política de SELECT acima. Não há
-- e-mail, push nem mensagem para a loja: quem não abre o painel não é avisado. O prazo (15 dias) é por isso da
-- loja olhar o painel, e a seção "Pedidos de privacidade dos clientes" mostra "Responder até" e o prazo vencido.
--
-- 5. DADOS EXISTENTES
--
-- Nenhum: a tabela nasce vazia e nenhuma linha de outra tabela é lida ou reescrita.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: faltar auth.users, auth.uid() ou public.rls_admin_atual() (as migrations 20261197000000 em diante vêm
-- antes); ou se public.pedidos_de_privacidade (ou a função do gatilho) já existir — a migration NASCE o objeto, e
-- um homônimo de forma desconhecida não pode herdar as regras daqui. Reaplicar depois de aplicada ABORTA no
-- pré-voo (a ficha abaixo diz como conferir o estado em vez de reaplicar).
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261197000000 (rls_admin_atual). Independe das demais. ROLLBACK MANUAL:
-- rollback-manual-20261238000000_a_cliente_pede_exclusao_da_conta_e_correcao_do_email.sql — RECUSA apagar se
-- houver QUALQUER pedido registrado (é registro legal: a decisão de apagá-lo é do dono, por fora).
--
-- 8. FICHA DE VERIFICAÇÃO (depois de aplicar)
--
--   1. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pedidos_de_privacidade'::regclass;  -- true
--   2. SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.pedidos_de_privacidade'::regclass ORDER BY 1;
--      -- esperado: 3 linhas (insert 'a', select 'r', update 'w'); NENHUMA de DELETE ('d') nem 'ALL' ('*').
--   3. SELECT has_table_privilege('anon', 'public.pedidos_de_privacidade', 'SELECT')   -- false
--           , has_table_privilege('authenticated', 'public.pedidos_de_privacidade', 'DELETE')  -- false
--           , has_table_privilege('service_role', 'public.pedidos_de_privacidade', 'DELETE');  -- false
--   PROVA VIVA: tests/banco/pedidos-de-privacidade-viva.cjs (rpc-ci).
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador.
-- ============================================================================

DO $preflight_20261238$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: auth.users não existe.';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: auth.uid() não existe.';
  END IF;
  IF to_regprocedure('public.rls_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.rls_admin_atual() não existe — aplique a 20261197000000 antes.';
  END IF;
  IF to_regclass('public.pedidos_de_privacidade') IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pedidos_de_privacidade já existe — esta migration NASCE a tabela; confira o estado vivo pela ficha de verificação em vez de reaplicar.';
  END IF;
  IF to_regprocedure('public.pedidos_de_privacidade__carimbar()') IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pedidos_de_privacidade__carimbar() já existe — revise antes de aplicar.';
  END IF;
END $preflight_20261238$;

CREATE TABLE public.pedidos_de_privacidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  tipo text NOT NULL,
  email_novo text,
  situacao text NOT NULL DEFAULT 'aberto',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atendido_em timestamptz,
  atendido_por uuid,
  observacao text,
  CONSTRAINT pedidos_de_privacidade_tipo_check
    CHECK (tipo IN ('excluir_conta', 'corrigir_email')),
  CONSTRAINT pedidos_de_privacidade_situacao_check
    CHECK (situacao IN ('aberto', 'atendido', 'recusado')),
  -- O e-mail novo existe quando, e só quando, o pedido é de correção de e-mail.
  CONSTRAINT pedidos_de_privacidade_email_do_tipo_check
    CHECK ((tipo = 'corrigir_email') = (email_novo IS NOT NULL)),
  CONSTRAINT pedidos_de_privacidade_email_formato_check
    CHECK (
      email_novo IS NULL
      OR (
        char_length(email_novo) <= 254
        AND email_novo ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      )
    ),
  -- Aberto não tem carimbo de decisão; decidido sempre tem a hora (quem decidiu pode faltar: decisão por serviço).
  CONSTRAINT pedidos_de_privacidade_carimbo_check
    CHECK (
      (situacao = 'aberto' AND atendido_em IS NULL AND atendido_por IS NULL)
      OR (situacao <> 'aberto' AND atendido_em IS NOT NULL)
    ),
  CONSTRAINT pedidos_de_privacidade_observacao_check
    CHECK (observacao IS NULL OR char_length(observacao) <= 1000)
);

COMMENT ON TABLE public.pedidos_de_privacidade IS
  'Pedidos de privacidade da cliente (20261238000000): excluir a conta ou corrigir o e-mail. Registro legal, atendido '
  'pela loja à mão (anonimização, nunca apagar sozinho). A cliente insere e lê os próprios; o admin lê todos e '
  'decide; ninguém apaga.';
COMMENT ON COLUMN public.pedidos_de_privacidade.user_id IS
  'Quem pediu. Sem cascata: apagar o login não apaga o pedido (e é barrado enquanto houver pedido).';
COMMENT ON COLUMN public.pedidos_de_privacidade.atendido_por IS
  'Quem decidiu (auth.uid() no gatilho). Sem chave estrangeira de propósito: trilha que sobrevive à saída do admin.';

-- No máximo UM pedido aberto por cliente e tipo: repetir o toque ou abrir duas abas não enfileira pedido em dobro.
CREATE UNIQUE INDEX uq_pedidos_de_privacidade_um_aberto
  ON public.pedidos_de_privacidade (user_id, tipo)
  WHERE situacao = 'aberto';

-- A lista do painel: abertos primeiro, mais antigos primeiro (o prazo é de 15 dias).
CREATE INDEX idx_pedidos_de_privacidade_situacao_criado
  ON public.pedidos_de_privacidade (situacao, criado_em);

-- O gatilho: quem decide é carimbado pelo servidor, e a decisão é final.
CREATE FUNCTION public.pedidos_de_privacidade__carimbar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Identidade do pedido é imutável por qualquer caminho (inclusive o do dono do banco e o do service_role).
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.email_novo IS DISTINCT FROM OLD.email_novo
     OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
    RAISE EXCEPTION 'pedidos_de_privacidade: a identidade do pedido não muda.'
      USING ERRCODE = '55000';
  END IF;

  -- Pedido já decidido é registro fechado: não reabre nem muda a nota.
  IF OLD.situacao <> 'aberto' THEN
    RAISE EXCEPTION 'pedidos_de_privacidade: o pedido já foi decidido.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.situacao <> 'aberto' THEN
    NEW.atendido_em := now();
    NEW.atendido_por := auth.uid();
  ELSE
    NEW.atendido_em := NULL;
    NEW.atendido_por := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pedidos_de_privacidade__carimbar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_pedidos_de_privacidade_carimbar
  BEFORE UPDATE ON public.pedidos_de_privacidade
  FOR EACH ROW EXECUTE FUNCTION public.pedidos_de_privacidade__carimbar();

ALTER TABLE public.pedidos_de_privacidade ENABLE ROW LEVEL SECURITY;

-- Tudo fechado, depois só o que se quer. A fábrica do Supabase abre ALL para anon/authenticated/service_role.
REVOKE ALL ON TABLE public.pedidos_de_privacidade FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pedidos_de_privacidade TO authenticated;
GRANT INSERT (user_id, tipo, email_novo) ON TABLE public.pedidos_de_privacidade TO authenticated;
GRANT UPDATE (situacao, observacao) ON TABLE public.pedidos_de_privacidade TO authenticated;
-- Sem DELETE para ninguém, nem para a chave de serviço.
GRANT SELECT, INSERT, UPDATE ON TABLE public.pedidos_de_privacidade TO service_role;

CREATE POLICY pedidos_de_privacidade_dono_ou_admin_select_policy
  ON public.pedidos_de_privacidade
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.rls_admin_atual()));

CREATE POLICY pedidos_de_privacidade_dono_insert_policy
  ON public.pedidos_de_privacidade
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND situacao = 'aberto'
    AND atendido_em IS NULL
    AND atendido_por IS NULL
    AND observacao IS NULL
  );

CREATE POLICY pedidos_de_privacidade_admin_update_policy
  ON public.pedidos_de_privacidade
  FOR UPDATE TO authenticated
  USING ((SELECT public.rls_admin_atual()))
  WITH CHECK ((SELECT public.rls_admin_atual()));

-- CONFERÊNCIA no instante do apply: aborta (e a transação do aplicador desfaz tudo) se o que ficou não é o que se quis.
DO $conferencia_20261238$
DECLARE
  v_rel regclass := to_regclass('public.pedidos_de_privacidade');
  v_politicas text;
  v_colunas_insert text;
  v_colunas_update text;
  v_col text;
BEGIN
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261238: a tabela não nasceu';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) THEN
    RAISE EXCEPTION 'conferencia 20261238: RLS desligada';
  END IF;

  SELECT string_agg(polname::text || ':' || polcmd::text, ', ' ORDER BY polname) INTO v_politicas
    FROM pg_policy WHERE polrelid = v_rel;
  IF v_politicas IS DISTINCT FROM
     'pedidos_de_privacidade_admin_update_policy:w, pedidos_de_privacidade_dono_insert_policy:a, pedidos_de_privacidade_dono_ou_admin_select_policy:r' THEN
    RAISE EXCEPTION 'conferencia 20261238: políticas inesperadas (%)', COALESCE(v_politicas, 'nenhuma');
  END IF;

  IF has_table_privilege('anon', v_rel, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('public', v_rel, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
    RAISE EXCEPTION 'conferencia 20261238: anon ou PUBLIC tem acesso à tabela';
  END IF;
  IF has_table_privilege('authenticated', v_rel, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'conferencia 20261238: ACL de authenticated não é só SELECT em nível de tabela';
  END IF;
  IF has_table_privilege('service_role', v_rel, 'DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
    RAISE EXCEPTION 'conferencia 20261238: service_role consegue apagar';
  END IF;

  -- Colunas que a cliente pode inserir e que o admin pode atualizar: exatamente as combinadas.
  SELECT string_agg(a.attname, ', ' ORDER BY a.attname) INTO v_colunas_insert
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('authenticated', v_rel, a.attnum, 'INSERT');
  SELECT string_agg(a.attname, ', ' ORDER BY a.attname) INTO v_colunas_update
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('authenticated', v_rel, a.attnum, 'UPDATE');
  IF v_colunas_insert IS DISTINCT FROM 'email_novo, tipo, user_id' THEN
    RAISE EXCEPTION 'conferencia 20261238: colunas de INSERT inesperadas (%)', COALESCE(v_colunas_insert, 'nenhuma');
  END IF;
  IF v_colunas_update IS DISTINCT FROM 'observacao, situacao' THEN
    RAISE EXCEPTION 'conferencia 20261238: colunas de UPDATE inesperadas (%)', COALESCE(v_colunas_update, 'nenhuma');
  END IF;
  FOREACH v_col IN ARRAY ARRAY['id', 'criado_em', 'atendido_em', 'atendido_por'] LOOP
    IF has_column_privilege('authenticated', v_rel, v_col, 'INSERT, UPDATE') THEN
      RAISE EXCEPTION 'conferencia 20261238: authenticated escreve em %', v_col;
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = v_rel AND i.indisunique AND i.indpred IS NOT NULL
          AND i.indexrelid = to_regclass('public.uq_pedidos_de_privacidade_um_aberto')
     ) THEN
    RAISE EXCEPTION 'conferencia 20261238: o índice único parcial de um pedido aberto por tipo não existe';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = v_rel AND t.tgname = 'tr_pedidos_de_privacidade_carimbar' AND NOT t.tgisinternal
     ) THEN
    RAISE EXCEPTION 'conferencia 20261238: o gatilho de carimbo não existe';
  END IF;
  IF has_function_privilege('anon', 'public.pedidos_de_privacidade__carimbar()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pedidos_de_privacidade__carimbar()', 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261238: a função do gatilho está aberta para anon ou authenticated';
  END IF;
END $conferencia_20261238$;

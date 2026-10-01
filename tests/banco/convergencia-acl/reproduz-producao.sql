-- REPRODUZ, NO BANCO EFEMERO, O ESTADO DE PERMISSOES DA LOJA PRINCIPAL MEDIDO EM
-- 01/10/2026 (mesmo codigo, sem as migrations 20261184 e 20261185):
--
--   * as 160 funcoes de `public` com EXECUTE para anon e authenticated, EXCETO
--     confirmar_pagamento(uuid,text,text) e devolver_uso_cupom(uuid), que so
--     postgres e service_role executam (fechadas na emergencia de 01/10);
--   * proacl TEXTUAL das 8 funcoes de dinheiro igual ao medido:
--       as 6 abertas  {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--       as 2 fechadas {postgres=X/postgres,service_role=X/postgres}
--   * 16 funcoes com EXECUTE explicito para PUBLIC (lista abaixo);
--   * as 55 tabelas/views de `public` com TODOS os privilegios para anon e
--     authenticated (GRANT ALL, como o default privileges do Supabase);
--   * nenhuma tabela com PUBLIC;
--   * os grants POR COLUNA (37 colunas) ficam como as migrations os deixaram:
--     aqui so se mexe em privilegio de TABELA e de FUNCAO. REVOKE de tabela
--     levaria os de coluna junto, por isso so ha GRANT em tabela.
--   * SERVIDOR (service_role): NADA e concedido a mais nem tirado. Quem tinha
--     EXECUTE (efetivo, antes de mexer) continua tendo; quem nao tinha — as
--     ausencias que as migrations deixaram — continua sem. So as 8 funcoes de
--     dinheiro sao garantidas (o proacl medido as traz). O conjunto de ausencias
--     e medido antes e depois por reproduz-producao.cjs e impresso no log.
--   * dono = postgres (as migrations rodam como postgres, nada a fazer).
--
-- UMA transacao: se qualquer comando falhar (funcao que nao existe, por
-- exemplo), nada fica gravado pela metade. Idempotente: rodar duas vezes deixa
-- o mesmo estado (REVOKE ALL + GRANT recompoem a lista inteira do zero, e o
-- servidor volta exatamente onde estava).
BEGIN;

-- 1) Todas as funcoes de public: ninguem alem do dono, depois EXECUTE para anon
--    e authenticated, e para service_role SO onde ele ja executava (ou nas 8).
--    ROUTINE cobre funcao e procedimento.
DO $reproduz_funcoes$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS alvo,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS servidor_executava,
           p.proname IN ('pagamentos_a_reconciliar', 'liberar_cobranca_do_pedido', 'concluir_estorno',
                         'devolver_estoque', 'expirar_pedidos_vencidos', 'devolver_cupons_de_pedidos_mortos',
                         'confirmar_pagamento', 'devolver_uso_cupom') AS dinheiro
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon, authenticated, service_role', f.alvo);
    -- Um GRANT por papel, NESTA ordem: o ACL guarda as entradas na ordem em que
    -- nascem, e o texto medido em producao e
    -- {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}.
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO anon', f.alvo);
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO authenticated', f.alvo);
    IF f.servidor_executava OR f.dinheiro THEN
      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', f.alvo);
    END IF;
  END LOOP;
END
$reproduz_funcoes$;

-- 2) As duas fechadas na emergencia: so postgres (dono) e service_role —
--    proacl = {postgres=X/postgres,service_role=X/postgres}.
REVOKE ALL ON FUNCTION public.confirmar_pagamento(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.devolver_uso_cupom(uuid) FROM PUBLIC, anon, authenticated;

-- 3) As 16 com EXECUTE explicito para PUBLIC (alem de anon e authenticated).
GRANT EXECUTE ON FUNCTION public.branding_a2_assets_valid(jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.branding_a2_file_valid(jsonb,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.branding_a2_logo_valid(jsonb,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.f_digitos(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.f_unaccent(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.forma_de_pagamento_aceita(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.formas_pagamento_sem_duplicata(text[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_segmented_push_count(text,numeric,integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_produto_atualizado() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_variant_atualiza_produto() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_local_cep(text,text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.limpar_cotacoes_fora_da_janela() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.marca_avaliacao_nasce_verificada() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.marca_avaliacoes_do_pedido_verificadas() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notifica_cliente_de_mudanca_de_pagamento() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notifica_cliente_de_mudanca_de_status() TO PUBLIC;

-- 4) Tabelas e views de public: nada para PUBLIC; tudo para anon e authenticated.
--    (Sem REVOKE para anon/authenticated: ele levaria os grants de coluna.)
DO $reproduz_relacoes$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS alvo
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', r.alvo);
    EXECUTE format('GRANT ALL ON TABLE %s TO anon, authenticated', r.alvo);
  END LOOP;
END
$reproduz_relacoes$;

COMMIT;

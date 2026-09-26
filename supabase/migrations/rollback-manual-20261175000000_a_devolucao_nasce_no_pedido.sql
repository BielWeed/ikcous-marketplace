-- ============================================================================
-- Rollback manual — a devolução nasce no pedido (20261175000000)
-- ============================================================================
-- Reverter PRIMEIRO o front (botão "Solicitar devolução" do pedido, tela
-- admin-devolucoes, card no pedido do painel, seção de política nos Ajustes)
-- e a ação `gerar_devolucao_reversa` da edge melhor-envio-etiqueta; só depois
-- executar este arquivo. Executar sob transação externa (psql -1 -f) — nunca
-- pelo db-apply (registraria o rollback no ledger de migrations).
--
-- Remove, na ordem inversa, só o que a migration criou: o gatilho de aviso, as
-- RPCs, os ajudantes internos, as policies do bucket e as quatro tabelas.
-- `IF EXISTS` em tudo: repetir este rollback não dá erro.
--
-- DADOS: APAGA as devoluções registradas, os itens, a trilha e a política
-- configurada pelo lojista. As linhas de estorno que uma devolução concluída
-- abriu em `order_refunds` FICAM (são dinheiro — o ledger não se apaga). O
-- bucket `devolucoes` e os arquivos dele FICAM (apagar foto de cliente é
-- decisão do dono, fora de rollback de schema).
-- ============================================================================

DROP TRIGGER IF EXISTS tr_devolucao_avisa_o_cliente ON public.devolucoes;
DROP FUNCTION IF EXISTS public.devolucao_avisa_o_cliente();

DROP FUNCTION IF EXISTS public.salvar_politica_de_devolucao(jsonb);
DROP FUNCTION IF EXISTS public.admin_devolucao_reprovar(uuid, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_registrar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_decidir(uuid, boolean, text, timestamptz);
DROP FUNCTION IF EXISTS public.admin_devolucoes_listar(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.devolucao_detalhe(uuid);
DROP FUNCTION IF EXISTS public.devolucoes_do_pedido(uuid);
DROP FUNCTION IF EXISTS public.informar_envio_devolucao(uuid, text);
DROP FUNCTION IF EXISTS public.cancelar_devolucao(uuid);
DROP FUNCTION IF EXISTS public.solicitar_devolucao(uuid, jsonb, text, text, text, text, text[]);
DROP FUNCTION IF EXISTS public.devolucao_elegibilidade(uuid);

DROP FUNCTION IF EXISTS public.devolucao__registrar_evento(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.devolucao__metodos(text, text, boolean, text[], text[]);
DROP FUNCTION IF EXISTS public.devolucao__modalidade(text, text);
DROP FUNCTION IF EXISTS public.devolucao__entregue_em(uuid);
DROP FUNCTION IF EXISTS public.devolucao__hoje();

DROP POLICY IF EXISTS devolucoes_cliente_insert_policy ON storage.objects;
DROP POLICY IF EXISTS devolucoes_dono_ou_admin_select_policy ON storage.objects;

DROP TABLE IF EXISTS public.devolucao_eventos;
DROP TABLE IF EXISTS public.devolucao_itens;
DROP TABLE IF EXISTS public.devolucoes;
DROP TABLE IF EXISTS public.politica_devolucao;

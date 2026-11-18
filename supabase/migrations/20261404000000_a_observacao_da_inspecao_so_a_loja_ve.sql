-- ============================================================================
-- Migration 20261404000000 -- a "Observação da inspeção" da devolução é só da loja (dado interno da loja; PERMISSÃO de leitura; troca o corpo de UMA função e recorta o SELECT de UMA tabela)
-- ============================================================================
--
-- 1. O DEFEITO (decisão do sócio, delegada pelo dono; medido em Postgres 17 com os corpos reais)
--
-- Ao concluir uma devolução, a lojista pode escrever uma "Observação da inspeção" (public.devolucoes.observacao_inspecao, até 1000 caracteres). É nota
-- INTERNA da loja ("caixa amassada, peça com cheiro de uso, suspeita de troca"), mas a CLIENTE a lê por DUAS portas:
--   (a) a RPC public.devolucao_detalhe(uuid) devolve to_jsonb(v_d), a LINHA INTEIRA da devolução, ao dono da devolução (a cliente) e ao admin;
--   (b) GRANT SELECT ON public.devolucoes TO authenticated (20261175000000, tabela inteira) + a política devolucoes_dono_ou_admin_select_policy
--       (a dona lê a própria linha): `GET /rest/v1/devolucoes?select=observacao_inspecao` devolve a nota à cliente pelo PostgREST, sem passar por RPC.
--
-- 2. A REGRA NOVA
--
--   * public.devolucao_detalhe(uuid): quando quem chama NÃO é admin atual (public.is_admin_atual(), a MESMA regra da trava que já está no topo da função),
--     a chave 'observacao_inspecao' sai do JSON (chave AUSENTE, não nula). O admin atual continua recebendo o JSON inteiro, com a nota. O resto do
--     retorno (itens, eventos, pedido, ja_pedido_e_nao_veio) não muda um byte.
--   * public.devolucoes: REVOKE SELECT (tabela inteira) de authenticated e GRANT SELECT por coluna nas 34 colunas que sobram, TODAS menos
--     observacao_inspecao. As colunas são as da 20261175000000 (nenhuma migration depois delas acrescentou coluna). A política RLS não muda: a dona
--     continua lendo a PRÓPRIA linha; o grant por coluna só recorta QUAIS colunas ela lê. É o mesmo desenho da 20261215000000 (politica_devolucao).
--   * service_role e o dono da tabela (postgres) NÃO mudam: as edge functions (chave de serviço) e as funções SECURITY DEFINER leem e escrevem a linha
--     inteira como sempre, inclusive admin_devolucao_concluir, que GRAVA a observação.
--
-- 3. O QUE ACONTECE EM CADA CASO
--
--   * cliente dona, devolucao_detalhe: recebe tudo o que recebia, MENOS a chave observacao_inspecao;
--   * cliente dona, SELECT id, status, ... FROM devolucoes (qualquer coluna menos a observação): continua funcionando; SELECT observacao_inspecao (ou
--     SELECT *) falha com "permission denied for table devolucoes" (42501);
--   * admin atual (profiles E auth.users com role admin), devolucao_detalhe: recebe a observação, como antes. O painel NUNCA lê a tabela direto (só por
--     RPC: devolucao_detalhe e admin_devolucoes_listar), então o admin não perde nada;
--   * admin REBAIXADO (JWT ainda diz admin, profiles/auth.users já não): a trava do topo já o recusa em devolução alheia; numa devolução DELE (se ele
--     também comprou) recebe o JSON sem a observação, como qualquer cliente;
--   * outra cliente: não via devolução alheia (a trava e a política RLS) e continua sem ver;
--   * devolução SEM observação (a maioria): a chave já vinha nula; agora some para a cliente e segue nula para o admin.
--
-- 4. QUEM LÊ (checado ANTES de restringir)
--
--   * Front: a tabela public.devolucoes NÃO é lida direto por nenhum arquivo de src (só o bucket de storage de mesmo nome). O painel lê a observação
--     pela RPC (useDevolucoesAdmin -> DetalheDaDevolucao); o parser (src/lib/devolucao.ts) trata chave ausente como null. O app da cliente
--     (useDevolucaoCliente) lê por RPC e não mostra a observação em lugar nenhum.
--   * Edge functions: usam SÓ a chave de serviço (melhor-envio-etiqueta, estornar-pagamento via _shared/reemissao-do-reembolso) e leem colunas
--     NOMEADAS (id, order_id, status, me_reverse_id, ...), nunca a observação.
--   * SQL: as funções SECURITY INVOKER que citam a tabela (devolucao__fotos_soltas_da_conta, fin__movimentos, fin__caixa_calculo) leem só `fotos` e
--     `valor_reembolso`/`id`; as políticas que a consultam (devolucao_itens, devolucao_eventos, storage.objects) leem só `id`, `user_id` e `fotos`.
--     Todas ficam dentro do recorte. A observação é GRAVADA só por admin_devolucao_concluir (SECURITY DEFINER, dono).
--   * Realtime: nenhuma migration nem o front publica/assina a tabela. NÃO medido nas lojas vivas (ver 11).
--
-- 5. O QUE MUDA NO CORPO (só isto; o resto não muda um byte)
--
-- devolucao_detalhe: a linha `RETURN to_jsonb(v_d) || jsonb_build_object(` passa a
--   `RETURN CASE WHEN public.is_admin_atual() THEN to_jsonb(v_d) ELSE to_jsonb(v_d) - 'observacao_inspecao' END || jsonb_build_object(`,
-- mais um comentário acima dela. As duas travas do topo ficam como estão (inclusive a de is_admin() que a 20261199000000 manteve). Assinatura,
-- retorno jsonb, LANGUAGE plpgsql, STABLE, SECURITY DEFINER, search_path, dono, OID e ACL NÃO mudam (CREATE OR REPLACE, sem DROP).
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha de devolução é lida para escrita nem escrita: só o corpo de UMA função e privilégios de coluna mudam. As observações já gravadas CONTINUAM
-- gravadas e continuam visíveis ao admin; deixam de chegar à cliente, inclusive nas devoluções antigas (o recorte é por coluna, não por linha).
--
-- 7. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: devolucao_detalhe não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois conhecidos (o da
-- 20261399992000, a439e320641d553e3a21883c6606c6f2, ou o desta migration, b4eb7a928f8a6ff04c34e93f4f56188c); os atributos ou a ACL da função não forem os
-- de sempre; public.is_admin_atual() faltar; public.devolucoes não existir, estiver sem RLS ou sem alguma das 35 colunas conhecidas; houver coluna
-- DESCONHECIDA enquanto a tabela ainda está inteira para authenticated (meça a loja e revise a lista de colunas); authenticated ou anon tiverem
-- escrita, REFERENCES, TRIGGER ou TRUNCATE na tabela, anon tiver QUALQUER leitura, ou PUBLIC tiver QUALQUER privilégio na tabela ou em coluna;
-- authenticated ou anon forem membros de pg_read_all_data. Fotografa OID, dono, ACL e TODOS os atributos da função (set_config local à transação)
-- para a conferência final.
--
-- 8. TRANSAÇÃO, IDEMPOTÊNCIA E REAPLICAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa e do aplicador: o aplicador RECUSA controle de transação de topo, e com ele o ROLLBACK dos
-- scripts de prova viraria no-op): quem abre a transação é o aplicador (psql -1 / db-apply, que mandam o arquivo como UM só lote); pré-voo, troca do
-- corpo, REVOKE, GRANT e conferência caem juntos ou não caem. Dois estados de entrada: ANTES (corpo a439..., authenticated com SELECT na TABELA) e
-- DEPOIS (o desta migration, authenticated só por coluna): reaplicar reescreve o MESMO corpo, não revoga nada que já esteja revogado e reconcede as
-- mesmas 34 colunas (mesmo estado; o REVOKE de tabela só roda se authenticated ainda tiver SELECT na tabela inteira, para não apagar grant de coluna
-- que uma migration futura venha a dar). Qualquer outro estado ABORTA sem escrever. Chamada concorrente: o CREATE OR REPLACE e o REVOKE esperam o lock
-- por no máximo 5 s (lock_timeout) e abortam tudo se não conseguirem; quem já está lendo termina com o corpo antigo.
-- ATENÇÃO (consequência de ter grant por coluna): COLUNA NOVA que uma migration futura acrescente a public.devolucoes NÃO é legível por authenticated
-- até receber um `GRANT SELECT (coluna)`; e `SELECT *` na tabela, como authenticated, passa a falhar. Hoje ninguém faz nenhum dos dois.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261399992000 (o pré-voo recusa corpo diferente). O front não depende desta migration (nenhum arquivo lê a tabela, e a RPC devolve a chave
-- a menos); a migration funciona com o front velho. ROLLBACK MANUAL: rollback-manual-20261404000000_a_observacao_da_inspecao_so_a_loja_ve.sql devolve o
-- corpo a439... byte a byte e o GRANT SELECT na tabela inteira (REABRE as duas portas); vem ANTES do rollback da 20261399992000 (o dela só aceita o
-- corpo da 20261399992000 em devolucao_detalhe). Valem IKCOUS e Savy; lojas de teste ficam fora.
--
-- 10. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.devolucao_detalhe(uuid)');
--      -- esperado: b4eb7a928f8a6ff04c34e93f4f56188c.
--   2. SELECT has_column_privilege('authenticated', 'public.devolucoes', 'observacao_inspecao', 'SELECT'),
--             has_column_privilege('anon', 'public.devolucoes', 'observacao_inspecao', 'SELECT'),
--             has_table_privilege('authenticated', 'public.devolucoes', 'SELECT');
--      -- esperado: false, false, false.
--   3. SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.devolucoes'::regclass AND a.attnum > 0 AND NOT a.attisdropped
--         AND a.attname <> 'observacao_inspecao' AND has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT');
--      -- esperado: 34 (as outras colunas seguem legíveis à dona da linha).
--   4. proacl, prosecdef e proconfig de devolucao_detalhe iguais antes e depois.
--   5. Painel: a ficha de uma devolução concluída com observação mostra "Inspeção" para a lojista; o app da cliente não traz o texto.
--   PROVA VIVA: tests/banco/a-observacao-da-inspecao-so-a-loja-ve-viva.cjs.
--
-- 11. O QUE ESTA MIGRATION NÃO FECHA
--
-- (a) Realtime: se alguma loja publicar public.devolucoes em supabase_realtime (nenhuma migration o faz; não foi medido nas lojas vivas), o
--     Realtime é outra porta; meça `SELECT * FROM pg_publication_tables WHERE tablename = 'devolucoes'` antes de afirmar "nenhum caminho".
-- (b) A observação continua legível por quem leia como service_role ou dono da tabela (as edge functions, o painel do Supabase): é da loja.
-- (c) O texto que a lojista escreve em outros campos que a cliente lê DE PROPÓSITO (mensagem_loja, nota dos eventos) não muda: são mensagens à cliente.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261404000000$
DECLARE
  v_oid oid := to_regprocedure('public.devolucao_detalhe(uuid)');
  v_hash text;
  v_public boolean;
  v_priv text;
  v_col text;
  v_desconhecidas text;
  v_colunas text[] := ARRAY[
    'id', 'protocolo', 'order_id', 'user_id', 'tipo', 'motivo', 'detalhe', 'resolucao_desejada', 'resolucao_final',
    'modalidade', 'metodo_retorno', 'status', 'valor_itens', 'valor_frete_ida', 'valor_reembolso', 'refund_id',
    'reembolso_manual', 'fotos', 'codigo_rastreio', 'codigo_postagem', 'etiqueta_url', 'me_reverse_id', 'coleta_em',
    'mensagem_loja', 'observacao_inspecao', 'entregue_em', 'prazo_ate', 'politica', 'created_at', 'updated_at',
    'aprovada_em', 'postada_em', 'recebida_em', 'concluida_em', 'encerrada_em'
  ];
BEGIN
  -- ---- a função: existe, uma só, corpo conhecido, atributos e ACL de sempre ----
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucao_detalhe(uuid) não existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolucao_detalhe') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucao_detalhe tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  -- (assinatura, corpo vigente, corpo desta migration): a tupla que tests/banco/sucessoras-da-99.cjs lê (devolucao_detalhe é um dos 42 corpos da 20261199000000).
  IF v_hash IS NULL OR NOT EXISTS (
       SELECT 1 FROM (VALUES
         ('public.devolucao_detalhe(uuid)', 'a439e320641d553e3a21883c6606c6f2', 'b4eb7a928f8a6ff04c34e93f4f56188c')
       ) AS esperado(assinatura, anterior, desta)
        WHERE v_hash IN (esperado.anterior, esperado.desta)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.devolucao_detalhe(uuid) (hash %) não é o vigente nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.pronargs = 1
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.devolucao_detalhe (linguagem, SECURITY DEFINER, volatilidade, search_path, argumento ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.devolucao_detalhe não é a conhecida (authenticated sim; anon e PUBLIC não) — meça a loja e revise.';
  END IF;
  IF to_regprocedure('public.is_admin_atual()') IS NULL
     OR (SELECT count(*) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'is_admin_atual') <> 1
     OR pg_get_function_result(to_regprocedure('public.is_admin_atual()')) <> 'boolean' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta public.is_admin_atual() boolean (a regra de "admin atual" que o corpo novo chama).';
  END IF;
  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE só pode trocar o texto).
  PERFORM set_config('ikcous.obsinsp_atributos',
                     (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);

  -- ---- a tabela: existe, com RLS, com as 35 colunas conhecidas ----
  IF to_regclass('public.devolucoes') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucoes não existe.';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.devolucoes'::regclass) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucoes está sem RLS — meça a loja e revise antes de aplicar.';
  END IF;
  FOREACH v_col IN ARRAY v_colunas LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = 'public.devolucoes'::regclass
                      AND a.attname = v_col AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a coluna public.devolucoes.%.', v_col;
    END IF;
  END LOOP;
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO v_desconhecidas
    FROM pg_attribute a
   WHERE a.attrelid = 'public.devolucoes'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> ALL (v_colunas);
  -- Coluna que esta migration não conhece, com a tabela ainda inteira para authenticated: o recorte a deixaria ilegível sem ninguém ter decidido.
  IF v_desconhecidas IS NOT NULL AND has_table_privilege('authenticated', 'public.devolucoes', 'SELECT') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucoes tem coluna(s) que esta migration não conhece (%) — meça a loja e revise a lista de colunas antes de aplicar.', v_desconhecidas;
  END IF;

  -- ---- os privilégios de sempre: authenticated só lê; anon nada; PUBLIC nada; nenhum papel predefinido de leitura ----
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('authenticated', 'public.devolucoes', v_priv)
       OR has_table_privilege('anon', 'public.devolucoes', v_priv) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: authenticated ou anon têm % em public.devolucoes — meça a loja e revise.', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'REFERENCES'] LOOP
    IF has_any_column_privilege('authenticated', 'public.devolucoes', v_priv)
       OR has_any_column_privilege('anon', 'public.devolucoes', v_priv) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: authenticated ou anon têm % por coluna em public.devolucoes — meça a loja e revise.', v_priv;
    END IF;
  END LOOP;
  IF has_any_column_privilege('anon', 'public.devolucoes', 'SELECT') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: anon lê public.devolucoes (tabela ou coluna) — meça a loja e revise.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c
              CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
             WHERE c.oid = 'public.devolucoes'::regclass AND g.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute a
                 CROSS JOIN LATERAL aclexplode(a.attacl) g
                WHERE a.attrelid = 'public.devolucoes'::regclass AND a.attacl IS NOT NULL AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: PUBLIC tem privilégio em public.devolucoes (tabela ou coluna) — meça a loja e revise.';
  END IF;
  IF pg_has_role('authenticated', 'pg_read_all_data', 'MEMBER') OR pg_has_role('anon', 'pg_read_all_data', 'MEMBER') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: authenticated ou anon são membros de pg_read_all_data — o recorte por coluna não os alcançaria.';
  END IF;
END $preflight_20261404000000$;

-- devolucao_detalhe: o corpo vigente da 20261399992000 + a troca declarada no cabeçalho (item 5): a observação da inspeção só sai para o admin atual.
CREATE OR REPLACE FUNCTION public.devolucao_detalhe(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id;
  IF NOT FOUND OR (v_d.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT FOUND OR (v_d.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_atual()) THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id;
  -- 20261404000000: a "Observação da inspeção" é INTERNA da loja; só o admin ATUAL a recebe (a cliente dona da devolução recebe o resto, sem a chave).
  RETURN CASE WHEN public.is_admin_atual() THEN to_jsonb(v_d) ELSE to_jsonb(v_d) - 'observacao_inspecao' END || jsonb_build_object(
    -- 20261399992000: 'ja_pedido_e_nao_veio' = uma devolução ANTERIOR e CONCLUÍDA deste mesmo item do pedido o marcou "Não veio".
    'itens', COALESCE((SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object('ja_pedido_e_nao_veio', EXISTS (
                           SELECT 1 FROM public.devolucao_itens a
                             JOIN public.devolucoes da ON da.id = a.devolucao_id
                            WHERE a.order_item_id = i.order_item_id
                              AND a.condicao = 'ausente'
                              AND da.status = 'concluida'
                              AND da.created_at < v_d.created_at)) ORDER BY i.product_name, i.id)
                         FROM public.devolucao_itens i WHERE i.devolucao_id = v_d.id), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
                           FROM public.devolucao_eventos e WHERE e.devolucao_id = v_d.id), '[]'::jsonb),
    'pedido', jsonb_build_object(
      'id', v_o.id, 'total', v_o.total, 'shipping', v_o.shipping,
      'payment_method', v_o.payment_method, 'payment_status', v_o.payment_status,
      'canal', v_o.canal, 'customer_name', v_o.customer_name,
      'whatsapp', v_o.customer_data ->> 'whatsapp',
      'shipping_label_id', v_o.shipping_label_id,
      'shipping_option_id', v_o.customer_data ->> 'shipping_option_id'
    )
  );
END;
$$;

-- A leitura DIRETA da coluna (item 1b): tira o SELECT da tabela inteira de authenticated e devolve por coluna, todas menos observacao_inspecao.
-- O REVOKE de tabela leva junto qualquer grant de coluna que sobrasse; só roda se authenticated ainda tiver o SELECT da TABELA (reaplicar não apaga
-- grant de coluna que uma migration futura venha a dar).
DO $revoga_20261404000000$
BEGIN
  IF has_table_privilege('authenticated', 'public.devolucoes', 'SELECT') THEN
    REVOKE SELECT ON public.devolucoes FROM authenticated;
  END IF;
END $revoga_20261404000000$;

GRANT SELECT (
  id,
  protocolo,
  order_id,
  user_id,
  tipo,
  motivo,
  detalhe,
  resolucao_desejada,
  resolucao_final,
  modalidade,
  metodo_retorno,
  status,
  valor_itens,
  valor_frete_ida,
  valor_reembolso,
  refund_id,
  reembolso_manual,
  fotos,
  codigo_rastreio,
  codigo_postagem,
  etiqueta_url,
  me_reverse_id,
  coleta_em,
  mensagem_loja,
  entregue_em,
  prazo_ate,
  politica,
  created_at,
  updated_at,
  aprovada_em,
  postada_em,
  recebida_em,
  concluida_em,
  encerrada_em
) ON public.devolucoes TO authenticated;

-- Um REVOKE que não revoga nada completa com WARNING (grant de outro grantor, papel predefinido, PUBLIC): por isso a CONFERÊNCIA mede o privilégio
-- EFETIVO (has_*_privilege) e aborta a migration inteira se a observação ainda for legível por authenticated, anon ou PUBLIC.
DO $posvoo_20261404000000$
DECLARE
  v_oid oid := to_regprocedure('public.devolucao_detalhe(uuid)');
  v_src text;
  v_hash text;
  v_public boolean;
  v_col text;
  v_lidas text[] := ARRAY[
    'id', 'protocolo', 'order_id', 'user_id', 'tipo', 'motivo', 'detalhe', 'resolucao_desejada', 'resolucao_final',
    'modalidade', 'metodo_retorno', 'status', 'valor_itens', 'valor_frete_ida', 'valor_reembolso', 'refund_id',
    'reembolso_manual', 'fotos', 'codigo_rastreio', 'codigo_postagem', 'etiqueta_url', 'me_reverse_id', 'coleta_em',
    'mensagem_loja', 'entregue_em', 'prazo_ate', 'politica', 'created_at', 'updated_at',
    'aprovada_em', 'postada_em', 'recebida_em', 'concluida_em', 'encerrada_em'
  ];
BEGIN
  -- ---- a função: o corpo desta migration, a troca presente UMA vez, nada mais mudou ----
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: public.devolucao_detalhe(uuid) sumiu';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')), prosrc INTO v_hash, v_src FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'b4eb7a928f8a6ff04c34e93f4f56188c' THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: corpo vivo de devolucao_detalhe (hash %) não é o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF (length(v_src) - length(replace(v_src, 'to_jsonb(v_d) - ''observacao_inspecao''', ''))) / length('to_jsonb(v_d) - ''observacao_inspecao''') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: a troca desta migration não aparece uma vez em devolucao_detalhe';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolucao_detalhe') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: devolucao_detalhe ficou com sobrecarga';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: ACL de devolucao_detalhe não é a de sempre';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)
       IS DISTINCT FROM current_setting('ikcous.obsinsp_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: atributos, dono, OID ou ACL de devolucao_detalhe mudaram';
  END IF;

  -- ---- a tabela: a observação ilegível para authenticated, anon e PUBLIC; as outras 34 colunas legíveis; service_role intacto ----
  IF has_column_privilege('authenticated', 'public.devolucoes', 'observacao_inspecao', 'SELECT')
     OR has_column_privilege('anon', 'public.devolucoes', 'observacao_inspecao', 'SELECT')
     OR has_table_privilege('authenticated', 'public.devolucoes', 'SELECT')
     OR has_table_privilege('anon', 'public.devolucoes', 'SELECT') THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: authenticated ou anon ainda leem observacao_inspecao (ou a tabela inteira) em public.devolucoes — grant de outro grantor, papel predefinido ou PUBLIC?';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c
              CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
             WHERE c.oid = 'public.devolucoes'::regclass AND g.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute a
                 CROSS JOIN LATERAL aclexplode(a.attacl) g
                WHERE a.attrelid = 'public.devolucoes'::regclass AND a.attacl IS NOT NULL AND g.grantee = 0) THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: PUBLIC tem privilégio em public.devolucoes';
  END IF;
  FOREACH v_col IN ARRAY v_lidas LOOP
    IF NOT has_column_privilege('authenticated', 'public.devolucoes', v_col, 'SELECT') THEN
      RAISE EXCEPTION 'POSVOO_20261404000000: authenticated perdeu a leitura de public.devolucoes.%', v_col;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.devolucoes', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.devolucoes', 'observacao_inspecao', 'SELECT') THEN
    RAISE EXCEPTION 'POSVOO_20261404000000: service_role perdeu a leitura de public.devolucoes';
  END IF;
END $posvoo_20261404000000$;

-- devolucao_detalhe é RPC chamada pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';

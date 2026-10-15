-- ============================================================================
-- Migration 20261241000000 — o reembolso em dúvida prende o saldo
-- (dinheiro; lote R1 do reembolso A/B, decisão do dono delegada em 15/10/2026;
-- plano em equipe/bastoes/reembolso-ab-plano-20261015.md, seção REVISÃO, lote R1)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- Uma linha de `order_refunds` que virou `falhou` (ou `recusado` depois de um POST autorizado) pode ter
-- levado o dinheiro mesmo assim: o POST estourou o tempo e o Mercado Pago (MP) processou, ou a linha é
-- antiga e o executor antigo não carimbava o envio. Hoje o saldo a estornar IGNORA essas linhas: o
-- lojista consegue pedir outra devolução do mesmo valor e a cliente pode receber DUAS vezes. E a linha
-- que fica presa (em_processamento, sem resposta do MP) não tem saída nenhuma para o lojista.
--
-- 2. O QUE ELA FAZ
--
--   (a) `order_refund__pode_ter_saido(linha)` — a pergunta ÚNICA "o dinheiro desta linha PODE ter saído
--       no MP?". Antes ela existia em duas cópias SQL (reemissão e "por fora", 20261226000000) que não
--       conheciam a regra do LEGADO. Fechada para todo papel (inclusive service_role): só as funções daqui
--       a chamam. Ordem (o primeiro passo que casa decide):
--         (1) mp_refund_id presente -> true;  (2) linha substituída por reembolso manual -> false;
--         (3) LEGADO: criada_sob_autorizacao IS NOT TRUE AND tentativas > 1 -> true (a mesma regra de
--             linhaPodeJaTerChegadoAoMp, supabase/functions/_shared/estorno.ts);
--         (4) recusado sem post_autorizado_em -> false;
--         (5) falhou com diagnóstico, sem carimbo de POST incerto e com código da lista fechada "nada
--             saiu" ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund') -> false;
--         (6) senão -> true (inclusive falhou antiga sem diagnóstico; o lado seguro).
--   (b) `order_refund_prova` — tabela SÓ do servidor (RLS ligada, nenhuma policy, nenhum grant), uma
--       linha por linha de reembolso, com as DUAS marcas que este lote usa:
--         substituida_por_manual_em — A4: o reembolso foi resolvido MANUALMENTE no lugar desta linha
--                                     (o saldo já desconta o manual; a linha sai da conta "em dúvida");
--         por_fora_liberado_em      — A3: a loja assumiu a linha "por fora" depois da espera de 7 dias;
--                                     nenhum POST dela sai mais (autorizar_post_do_estorno recusa).
--       Não em order_refunds: a cliente lê a linha inteira de order_refunds (RLS) e marca interna não
--       vai para lá. Não em order_refund_diagnostico: o pré-voo da 20261226 e a 29a fixam as colunas dela.
--   (c) `pedido__saldo_a_estornar` passa a descontar também o EM DÚVIDA: soma das linhas falhou/recusado
--       com pode_ter_saido verdadeiro, NÃO substituídas por manual e NÃO liberadas por fora; e o POR FORA
--       PARCIAL do pedido cancelado (linha com por_fora_liberado_em sem a marca de substituída, em qualquer
--       status). `solicitar_estorno` e o ramo
--       "pago pelo app" de `admin_devolucao_concluir` passam a CHAMAR a função (tinham cópia da conta que
--       não descontava a linha concluída ainda não somada — a divergência sai junto).
--   (d) `autorizar_post_do_estorno` NÃO passa a descontar o "em dúvida" (decisão A5b: o limite do MP já
--       recusa a soma acima do total), mas devolve `linha_mudou` quando a linha tem por_fora_liberado_em.
--   (e) `reemitir_reembolso_da_devolucao` e `admin_devolucao_reembolso_por_fora` chamam a função única
--       (CREATE OR REPLACE, mesma assinatura, mesmos GRANTs). O "por fora" marca a linha como substituída.
--   (f) As SAÍDAS DOS 7 DIAS (para PIX e para cartão sem prova): `admin_devolucao_reembolso_por_fora_apos_espera`
--       (devolução) e `registrar_estorno_manual_apos_espera` (pedido cancelado). Admin ATUAL; frase fixa
--       de confirmação 'DEVOLVI POR FORA'; devolvem risco_de_dobro: true. A linha de order_refunds fica como
--       está (o robô segue consultando o MP). A da devolução marca as duas marcas. A do pedido cancelado, se a
--       linha cobre TODO o saldo ainda a devolver, marca as duas e grava payment_status = 'estornado' como
--       registrar_estorno_manual (20261197000000); se cobre só PARTE, marca só por_fora_liberado_em, não muda
--       o pedido nem as outras linhas e responde detalhe 'parcial' (o valor passa a contar no saldo como "por
--       fora"). A ESPERA é UMA função só, `order_refund__liberavel_apos_espera(linha)` (fechada para todo
--       papel), que as duas saídas e o painel leem: linha em_processamento, ou falhou que pode ter saído; não
--       substituída por manual; sem por_fora_liberado_em; now() − COALESCE(post_autorizado_em, created_at)
--       >= 7 dias (relógio SÓ do banco). O campo do painel diz só que a ESPERA passou: a porta ainda confere o
--       resto (linha do sistema, outra linha em processamento, linha de devolução...) e pode recusar — o front
--       mostra a RESPOSTA da porta.
--   (g) `pedido_reembolsos_e_saldo(pedido)` — o que o painel mostra: total, valor_estornado, em_voo,
--       em_duvida, manual, disponivel (nunca negativo: GREATEST(saldo, 0)) e as linhas {id, status, amount,
--       pode_ter_saido, por_fora_liberado_em, por_fora_apos_espera_liberado, substituida_por_manual, eh_pix};
--       NUNCA o código do MP. Só o admin atual logado. O front deixa de copiar a conta.
--       por_fora_liberado_em = a MARCA (a saída dos 7 dias JÁ foi usada); por_fora_apos_espera_liberado = a
--       ESPERA da linha passou (order_refund__liberavel_apos_espera; a porta ainda pode recusar por outro
--       motivo); substituida_por_manual = o reembolso manual tomou o lugar da linha (aí pode_ter_saido = false
--       quer dizer "não conta como dúvida", não "o dinheiro não saiu": a tela não oferece tentar de novo).
--   (h) O aviso da cliente na conclusão com reembolso ainda em andamento passa a dizer "A loja está
--       confirmando sua devolução com o Mercado Pago." (não promete o que o MP ainda não confirmou).
--   (i) REVOKE do authenticated em `admin_devolucao_reemitir_reembolso` (a antiga, que só aceitava
--       `recusado`): nenhum chamador no front publicado (git grep em 65c0e582, release 1.5.27).
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha de order_refunds, devolucoes, marketplace_orders ou notificacoes muda no apply: nasce
-- uma tabela VAZIA e mudam corpos de função. O EFEITO muda: linha falhou/recusado que pode ter saído
-- passa a prender saldo. Medido ANTES (consulta 42m, 15/10/2026, IKCOUS e Savy): ZERO linhas
-- falhou/recusado nas duas lojas — o saldo de nenhum pedido existente muda hoje.
--
-- 4. QUEM QUEBRA
--
-- Ninguém por assinatura: nenhuma assinatura existente muda. Quem chamava
-- admin_devolucao_reemitir_reembolso como authenticated recebe permission denied (nenhum chamador).
-- NUNCA reaplicar depois desta as migrations que deixam os corpos de antes (20261196, 20261197, 20261198,
-- 20261201, 20261225, 20261226): o pré-voo delas recusa o corpo novo e, se forçado, devolveria a conta
-- sem o "em dúvida".
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: faltar tabela/coluna que os corpos leem; alguma das SETE funções reescritas tiver sobrecarga,
-- atributos diferentes ou corpo que não seja o VIGENTE nem o desta migration; as funções chamadas
-- (concluir_estorno, devolucao__avisar_reembolso, devolucao__registrar_evento, is_admin, is_admin_atual)
-- faltarem ou tiverem corpo desconhecido; uma função nova existir com corpo diferente ou com sobrecarga; a
-- tabela nova existir com colunas diferentes; o gatilho de aviso da devolução não apontar para a função.
-- SEM BEGIN/COMMIT (regra da casa: o db-apply abre a transação; pré-voo, criações e conferência final
-- caem juntos ou não caem).
--
-- 6. HASHES (md5 do corpo sem CR, vigente -> desta)
--   pedido__saldo_a_estornar            9579d2b56b57cf948659936a928dd7dc -> 99741b4cdbf1e8d8340f80440e6da094
--   solicitar_estorno                   069c3d12a470cc4708099d909c57ca02 -> 840de50f44958fe43b55f5222691df9b
--   admin_devolucao_concluir            26080db4aeb82bdfb9fcd0c6f7169ebb -> ebb901efff59a53082836a13e053cd1a
--   autorizar_post_do_estorno           e128f7ad54ebc82c97b97af4aa7baa08 -> c73e48294c08f34240abc3843aa7d1f1
--   reemitir_reembolso_da_devolucao     872fcb1d2bac9816e2d2b1c7c2e868c0 -> fd5d79042efa68f9a17298fff1e950bd
--   admin_devolucao_reembolso_por_fora  0a7e06d7004c3fb70897e87c4dfa8cf9 -> 76eaffb4f9438f7fe557961e1bdaad81
--   devolucao_avisa_o_cliente           2cd21f47021cafc15cae4ccd0c8c67e5 -> 56502b960dcf3e136c1d0d5c41091c20
--   novas: order_refund__pode_ter_saido bdbb28b3d91588c8b10283d57bfb73d6,
--   order_refund__liberavel_apos_espera cb37f24646fda24e1a51c8f01983e083, pedido_reembolsos_e_saldo
--   baf21d65b13bea6b8e0d18f3ced1e05e, admin_devolucao_reembolso_por_fora_apos_espera
--   92dd1608d02ef5e9fd9fe34e0bd7c49f, registrar_estorno_manual_apos_espera
--   7b1403e418b2d80d02db287444f8a0ef.
-- Os "vigentes" vêm dos ARQUIVOS das migrations 20261198/20261197/20261196/20261226/20261225; o corpo vivo
-- de cada loja só a consulta 43b mede, ANTES do apply.
--
-- 7. ROLLBACK MANUAL
--
-- rollback-manual-20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql: recria os sete corpos de antes
-- byte a byte, apaga as cinco funções novas, devolve o EXECUTE do authenticated à função antiga e apaga a
-- tabela — e RECUSA se a tabela já tiver qualquer marca (apagar uma marca "por fora" deixaria o robô
-- reenviar uma linha que a loja já pagou à mão: decisão do dono). Desfazer o FRONT antes (a tela passa a
-- chamar pedido_reembolsos_e_saldo e as saídas dos 7 dias).
--
-- PROVA VIVA: tests/banco/reembolso-em-duvida-viva.cjs (comportamento, corrida de 2 conexões, mutantes) e
-- tests/banco/reembolso-em-duvida-portao-viva.cjs (consultas 43a e 43b).
-- ============================================================================

DO $preflight_20261241$
DECLARE
  r record;
  v_hash text;
  v_falta text;
BEGIN
  IF to_regclass('public.order_refunds') IS NULL
     OR to_regclass('public.order_refund_diagnostico') IS NULL
     OR to_regclass('public.marketplace_orders') IS NULL
     OR to_regclass('public.devolucoes') IS NULL
     OR to_regclass('public.notificacoes') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta order_refunds/order_refund_diagnostico/marketplace_orders/devolucoes/notificacoes/auth.users/profiles — aplique as migrations anteriores (até a 20261226000000) antes da 20261241000000.';
  END IF;

  -- O PL/pgSQL só acusa coluna ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.tabela || '.' || d.coluna, ', ' ORDER BY d.tabela, d.coluna) INTO v_falta
    FROM (VALUES
            ('order_refunds', 'id'), ('order_refunds', 'order_id'), ('order_refunds', 'amount'),
            ('order_refunds', 'status'), ('order_refunds', 'mp_refund_id'), ('order_refunds', 'solicitado_por'),
            ('order_refunds', 'post_autorizado_em'), ('order_refunds', 'criada_sob_autorizacao'),
            ('order_refunds', 'tentativas'), ('order_refunds', 'concluido_em'), ('order_refunds', 'created_at'),
            ('order_refunds', 'updated_at'), ('order_refunds', 'ultimo_erro'),
            ('order_refund_diagnostico', 'refund_id'), ('order_refund_diagnostico', 'mp_codigo'),
            ('order_refund_diagnostico', 'post_incerto_em'),
            ('marketplace_orders', 'id'), ('marketplace_orders', 'status'), ('marketplace_orders', 'payment_status'),
            ('marketplace_orders', 'total'), ('marketplace_orders', 'valor_estornado'),
            ('marketplace_orders', 'metodo_online'), ('marketplace_orders', 'estorno_manual_registrado_em'),
            ('devolucoes', 'id'), ('devolucoes', 'protocolo'), ('devolucoes', 'order_id'), ('devolucoes', 'status'),
            ('devolucoes', 'resolucao_final'), ('devolucoes', 'refund_id'), ('devolucoes', 'reembolso_manual'),
            ('devolucoes', 'valor_reembolso'), ('devolucoes', 'updated_at')
         ) AS d(tabela, coluna)
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = to_regclass('public.' || d.tabela)
                        AND a.attname = d.coluna AND NOT a.attisdropped AND a.attnum > 0);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que os corpos leem ou gravam não existem: % — aplique as migrations anteriores antes.', v_falta;
  END IF;

  -- As SETE funções reescritas: uma assinatura só, atributos de sempre, corpo VIGENTE ou o DESTA.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('pedido__saldo_a_estornar', 'public.pedido__saldo_a_estornar(uuid)', 'sql', 's', 'numeric', '9579d2b56b57cf948659936a928dd7dc', '99741b4cdbf1e8d8340f80440e6da094'),
        ('solicitar_estorno', 'public.solicitar_estorno(uuid,numeric,text)', 'plpgsql', 'v', 'jsonb', '069c3d12a470cc4708099d909c57ca02', '840de50f44958fe43b55f5222691df9b'),
        ('admin_devolucao_concluir', 'public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'plpgsql', 'v', 'jsonb', '26080db4aeb82bdfb9fcd0c6f7169ebb', 'ebb901efff59a53082836a13e053cd1a'),
        ('autorizar_post_do_estorno', 'public.autorizar_post_do_estorno(uuid,numeric)', 'plpgsql', 'v', 'jsonb', 'e128f7ad54ebc82c97b97af4aa7baa08', 'c73e48294c08f34240abc3843aa7d1f1'),
        ('reemitir_reembolso_da_devolucao', 'public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)', 'plpgsql', 'v', 'jsonb', '872fcb1d2bac9816e2d2b1c7c2e868c0', 'fd5d79042efa68f9a17298fff1e950bd'),
        ('admin_devolucao_reembolso_por_fora', 'public.admin_devolucao_reembolso_por_fora(uuid,uuid)', 'plpgsql', 'v', 'jsonb', '0a7e06d7004c3fb70897e87c4dfa8cf9', '76eaffb4f9438f7fe557961e1bdaad81'),
        ('devolucao_avisa_o_cliente', 'public.devolucao_avisa_o_cliente()', 'plpgsql', 'v', 'trigger', '2cd21f47021cafc15cae4ccd0c8c67e5', '56502b960dcf3e136c1d0d5c41091c20')
      ) AS esperado(nome, assinatura, lingua, volatilidade, retorno, hash_vigente, hash_desta)
  LOOP
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) <> 1
       OR to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ausente, com outra assinatura ou com sobrecarga em public — meça a loja (consulta 43b) e revise antes de aplicar.', r.assinatura;
    END IF;
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente nem o desta migration — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = to_regprocedure(r.assinatura)
            AND l.lanname = r.lingua
            AND p.prosecdef
            AND p.provolatile = r.volatilidade
            AND NOT p.proretset
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = r.retorno
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path ou retorno) não são os conhecidos.', r.assinatura;
    END IF;
  END LOOP;

  -- As funções que os corpos CHAMAM: existem com a assinatura conhecida (e as de dinheiro, com o corpo conhecido).
  IF to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regprocedure('public.devolucao__registrar_evento(uuid,text,text,text,text)') IS NULL
     OR to_regprocedure('public.devolucao__avisar_reembolso(uuid,text,text,text,text)') IS NULL
     OR to_regprocedure('public.concluir_estorno(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.admin_devolucao_reemitir_reembolso(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta is_admin, is_admin_atual, devolucao__registrar_evento, devolucao__avisar_reembolso, concluir_estorno ou admin_devolucao_reemitir_reembolso com a assinatura conhecida.';
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('public.concluir_estorno(uuid,text,text,text)', '662daf0dfc065a820231e9d30f4f6275'),
      ('public.devolucao__avisar_reembolso(uuid,text,text,text,text)', '769267b826e4629b91da056c28b393da')
    ) AS esperado(assinatura, hash_conhecido)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_conhecido THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o conhecido — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- As funções NOVAS: ausentes, ou já com o corpo desta migration (reaplicação). Sem sobrecarga.
  FOR r IN
    SELECT * FROM (VALUES
      ('order_refund__pode_ter_saido', 'bdbb28b3d91588c8b10283d57bfb73d6'),
      ('order_refund__liberavel_apos_espera', 'cb37f24646fda24e1a51c8f01983e083'),
      ('pedido_reembolsos_e_saldo', 'baf21d65b13bea6b8e0d18f3ced1e05e'),
      ('admin_devolucao_reembolso_por_fora_apos_espera', '92dd1608d02ef5e9fd9fe34e0bd7c49f'),
      ('registrar_estorno_manual_apos_espera', '7b1403e418b2d80d02db287444f8a0ef')
    ) AS esperado(nome, hash_desta)
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — meça a loja e revise antes de aplicar.', r.nome;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome
                  AND md5(replace(p.prosrc, E'\r', '')) <> r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% já existe com um corpo que não é o desta migration — revise antes de aplicar.', r.nome;
    END IF;
  END LOOP;

  -- A tabela nova: ausente, ou com exatamente as colunas desta migration.
  IF to_regclass('public.order_refund_prova') IS NOT NULL THEN
    IF (SELECT string_agg(c.column_name || ':' || c.data_type, ',' ORDER BY c.column_name)
          FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = 'order_refund_prova')
       IS DISTINCT FROM 'por_fora_liberado_em:timestamp with time zone,refund_id:uuid,substituida_por_manual_em:timestamp with time zone' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refund_prova já existe com colunas diferentes das desta migration — revise antes de aplicar.';
    END IF;
  END IF;

  -- O gatilho que usa devolucao_avisa_o_cliente: ligado e apontando para a função.
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.devolucoes'::regclass
          AND t.tgname = 'tr_devolucao_avisa_o_cliente'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = to_regprocedure('public.devolucao_avisa_o_cliente()')
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_devolucao_avisa_o_cliente não existe, está desligado ou aponta para outra função.';
  END IF;
END $preflight_20261241$;

-- ---------------------------------------------------------------------------
-- 1. As marcas do reembolso: tabela SEPARADA, só do servidor
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_refund_prova (
  refund_id uuid PRIMARY KEY REFERENCES public.order_refunds (id) ON DELETE CASCADE,
  substituida_por_manual_em timestamptz,
  por_fora_liberado_em timestamptz
);

COMMENT ON TABLE public.order_refund_prova IS
  'Marcas do reembolso que só o servidor lê (a cliente lê order_refunds inteira, por isso moram aqui). substituida_por_manual_em = o reembolso foi resolvido manualmente no lugar desta linha (A4: ela sai da conta "em dúvida" do saldo); por_fora_liberado_em = a loja assumiu a linha por fora depois da espera de 7 dias (A3: nenhum POST dela sai mais). Uma vez postas, as marcas não saem (COALESCE). 20261241000000.';

ALTER TABLE public.order_refund_prova ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_refund_prova FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. order_refund__pode_ter_saido — a pergunta ÚNICA, fechada para todo papel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_refund__pode_ter_saido(p_refund_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $pode_ter_saido$
  -- O dinheiro desta linha PODE ter saído no Mercado Pago? (20261241000000) O primeiro passo que casa
  -- decide:
  --   (1) o MP devolveu um id para a linha                                    -> true;
  --   (2) a linha foi substituída por reembolso manual (A4)                    -> false;
  --   (3) LEGADO (A6): nasceu antes da autorização (criada_sob_autorizacao não
  --       é true) e foi marcada mais de uma vez — o executor antigo não
  --       carimbava o POST e toda marca antecedia um POST possível (a mesma
  --       regra de linhaPodeJaTerChegadoAoMp, _shared/estorno.ts)              -> true;
  --   (4) recusado sem POST autorizado                                         -> false;
  --   (5) falhou com diagnóstico, sem carimbo de POST incerto e com código da
  --       lista fechada "nada saiu" (CODIGOS_NADA_SAIU, _shared/estorno.ts)    -> false;
  --   (6) qualquer outra coisa (falhou sem diagnóstico, linha viva, linha
  --       inexistente)                                                         -> true, o lado seguro.
  SELECT CASE
           WHEN r.mp_refund_id IS NOT NULL THEN true
           WHEN pv.substituida_por_manual_em IS NOT NULL THEN false
           WHEN r.criada_sob_autorizacao IS NOT TRUE AND r.tentativas > 1 THEN true
           WHEN r.status = 'recusado' AND r.post_autorizado_em IS NULL THEN false
           WHEN r.status = 'falhou'
                AND dg.refund_id IS NOT NULL
                AND dg.post_incerto_em IS NULL
                AND dg.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund') THEN false
           ELSE true
         END
    FROM (SELECT p_refund_id AS id) k
    LEFT JOIN public.order_refunds r ON r.id = k.id
    LEFT JOIN public.order_refund_prova pv ON pv.refund_id = r.id
    LEFT JOIN public.order_refund_diagnostico dg ON dg.refund_id = r.id;
$pode_ter_saido$;

REVOKE ALL ON FUNCTION public.order_refund__pode_ter_saido(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2b. order_refund__liberavel_apos_espera — a ESPERA dos 7 dias, UMA regra para a porta e para o botão
-- ---------------------------------------------------------------------------
-- As duas saídas dos 7 dias e o painel (pedido_reembolsos_e_saldo, campo por_fora_apos_espera_liberado)
-- leem ESTA função para a ESPERA. O campo do painel diz só "a espera desta linha passou"; a porta ainda
-- confere o resto (linha do sistema, outra linha em processamento, linha de devolução no pedido cancelado,
-- pedido já estornado ou sem pagamento...) e pode recusar com o campo true: o front mostra a RESPOSTA da
-- porta. Fechada para todo papel.
CREATE OR REPLACE FUNCTION public.order_refund__liberavel_apos_espera(p_refund_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $liberavel_apos_espera$
  -- A linha PODE usar a saída dos 7 dias AGORA? (20261241000000) Todas as condições juntas:
  --   em_processamento (o MP nunca respondeu), ou falhou cujo dinheiro PODE ter saído;
  --   NÃO substituída por reembolso manual e SEM a marca por_fora_liberado_em (a saída não foi usada);
  --   7 dias desde o último envio autorizado (ou da criação), pelo relógio do BANCO (now()).
  -- Linha inexistente -> false.
  SELECT COALESCE((
    SELECT (r.status = 'em_processamento'
            OR (r.status = 'falhou' AND public.order_refund__pode_ter_saido(r.id)))
           AND pv.substituida_por_manual_em IS NULL
           AND pv.por_fora_liberado_em IS NULL
           AND now() - COALESCE(r.post_autorizado_em, r.created_at) >= interval '7 days'
      FROM public.order_refunds r
      LEFT JOIN public.order_refund_prova pv ON pv.refund_id = r.id
     WHERE r.id = p_refund_id), false);
$liberavel_apos_espera$;

REVOKE ALL ON FUNCTION public.order_refund__liberavel_apos_espera(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. O saldo a estornar desconta o EM DÚVIDA (fonte única da conta)
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE: assinatura, SECURITY DEFINER, STABLE, search_path e ACL (fechada a todos) preservados.
CREATE OR REPLACE FUNCTION public.pedido__saldo_a_estornar(p_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $saldo$
  -- total pago − já confirmado (valor_estornado) − em voo (solicitado/em_processamento, e a concluída
  -- AINDA NÃO SOMADA: status 'concluido' com concluido_em NULL) − EM DÚVIDA (20261241000000: linha
  -- falhou/recusado cujo dinheiro PODE ter saído no Mercado Pago, order_refund__pode_ter_saido, e que
  -- NÃO foi substituída por reembolso manual nem liberada por fora) − reembolso manual de devolução
  -- concluída − POR FORA PARCIAL do pedido cancelado (linha com por_fora_liberado_em SEM a marca de
  -- substituída: a saída dos 7 dias que cobriu só parte do saldo; o dinheiro saiu por fora e não está
  -- em nenhuma outra conta — conta em QUALQUER status da linha, senão voltaria ao saldo quando o robô
  -- fechasse a linha).
  -- Pode dar zero ou negativo: quem chama decide.
  SELECT o.total
         - COALESCE(o.valor_estornado, 0)
         - COALESCE((SELECT sum(r.amount)
                       FROM public.order_refunds r
                      WHERE r.order_id = o.id
                        AND (r.status IN ('solicitado', 'em_processamento')
                             OR (r.status = 'concluido' AND r.concluido_em IS NULL))), 0)
         - COALESCE((SELECT sum(r.amount)
                       FROM public.order_refunds r
                      WHERE r.order_id = o.id
                        AND r.status IN ('falhou', 'recusado')
                        AND NOT EXISTS (SELECT 1
                                          FROM public.order_refund_prova pv
                                         WHERE pv.refund_id = r.id
                                           AND pv.substituida_por_manual_em IS NOT NULL)
                        AND NOT EXISTS (SELECT 1
                                          FROM public.order_refund_prova pf
                                         WHERE pf.refund_id = r.id
                                           AND pf.por_fora_liberado_em IS NOT NULL)
                        AND public.order_refund__pode_ter_saido(r.id)), 0)
         - COALESCE((SELECT sum(d.valor_reembolso)
                       FROM public.devolucoes d
                      WHERE d.order_id = o.id
                        AND d.status = 'concluida'
                        AND d.reembolso_manual), 0)
         - COALESCE((SELECT sum(r.amount)
                       FROM public.order_refunds r
                       JOIN public.order_refund_prova pf ON pf.refund_id = r.id
                      WHERE r.order_id = o.id
                        AND pf.por_fora_liberado_em IS NOT NULL
                        AND pf.substituida_por_manual_em IS NULL), 0)
    FROM public.marketplace_orders o
   WHERE o.id = p_order_id;
$saldo$;

-- ---------------------------------------------------------------------------
-- 4. solicitar_estorno: corpo vigente da 20261197000000, com a conta trocada pela função
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_estorno(
    p_order_id uuid,
    p_amount numeric,
    p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_payment_status TEXT;
    v_paid_at TIMESTAMPTZ;
    v_total NUMERIC;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
    v_valor_estornado NUMERIC;
    v_saldo NUMERIC;
    v_refund_id UUID;
BEGIN
    -- So' a loja pede devolucao pelo painel. ERRCODE 42501 para o front
    -- distinguir "nao e' a loja" de qualquer outro erro.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Somente a loja pede a devolução pelo painel.'
            USING ERRCODE = '42501';
    END IF;

    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Somente a loja pede a devolução pelo painel.'
            USING ERRCODE = '42501';
    END IF;

    SELECT status, payment_status, paid_at, total,
           cancelled_after_shipping, returned_to_seller_at, valor_estornado
      INTO v_status, v_payment_status, v_paid_at, v_total,
           v_cancelled_after_shipping, v_returned_at, v_valor_estornado
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Dinheiro que nao entrou nao se devolve. IS NULL explicito porque
    -- `NULL NOT IN (...)` avaliaria para NULL e o IF nao dispararia.
    IF v_payment_status IS NULL
       OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
        RAISE EXCEPTION 'Este pedido não está pago: não há dinheiro do Mercado Pago para devolver.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Regra 24/08: o estorno manual so' existe para pedido CANCELADO. Pedir
    -- devolucao de pedido vivo e' trocar o dinheiro sem desfazer a venda.
    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Cancele o pedido antes de devolver o dinheiro.';
    END IF;

    -- Regra 24/08, lado do enviado: produto que SAIU so' gera devolucao
    -- depois de VOLTAR a mao do lojista. O FATO vem de returned_to_seller_at
    -- (gravado por confirmar_retorno_do_produto), nunca deduzido de status.
    IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN
        RAISE EXCEPTION 'A devolução espera o produto: ele ainda não voltou para a loja.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Saldo disponivel: a conta UNICA de pedido__saldo_a_estornar (20261241000000) -
    -- total pago - ja confirmado (valor_estornado) - em voo (solicitado/em_processamento e a
    -- concluida ainda nao somada) - EM DUVIDA (linha falhou/recusado cujo dinheiro pode ter saido
    -- no Mercado Pago e que nao foi substituida por reembolso manual) - reembolso manual de
    -- devolucao ja concluida do mesmo pedido. Antes havia aqui uma COPIA da conta que nao
    -- descontava a concluida ainda nao somada nem o que esta em duvida.
    v_saldo := public.pedido__saldo_a_estornar(p_order_id);

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a devolver tem de ser maior que zero.';
    END IF;

    IF p_amount > v_saldo THEN
        RAISE EXCEPTION 'O valor pedido (R$ %) é maior que o valor disponível para devolver (R$ %).',
            to_char(p_amount, 'FM999G999D00'), to_char(v_saldo, 'FM999G999D00')
            USING ERRCODE = 'P0001';
    END IF;

    -- A linha nasce AQUI, pedida pela loja. status default 'solicitado':
    -- quem executa e' a edge do clique (Task 3) ou o cron (Task 4).
    INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
    VALUES (p_order_id, p_amount, NULLIF(trim(COALESCE(p_motivo, '')), ''), 'lojista')
    RETURNING id INTO v_refund_id;

    RETURN jsonb_build_object('refund_id', v_refund_id, 'amount', p_amount);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. admin_devolucao_concluir: corpo vigente da 20261197000000, ramo "pago pelo app" pela função
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(
  p_id uuid,
  p_resolucao text,
  p_itens jsonb,
  p_valor_reembolso numeric DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_item jsonb;
  v_di public.devolucao_itens%ROWTYPE;
  v_condicao text;
  v_reestocar boolean;
  v_reestocados integer := 0;
  v_valor numeric(12, 2);
  v_disponivel numeric(12, 2);
  v_pago_pelo_app boolean;
  v_refund_id uuid;
  v_manual boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'recebida' THEN
    RAISE EXCEPTION 'Conclua a devolução depois de receber o produto.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao IS NULL OR p_resolucao NOT IN ('reembolso', 'troca', 'vale') THEN
    RAISE EXCEPTION 'Escolha a resolução: reembolso, troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao = 'reembolso' AND v_d.tipo = 'troca' THEN
    RAISE EXCEPTION 'Devolução por troca de política não gera reembolso. Use troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Achado H (revisão de 26/09/2026): o lock não bastava — a devolução podia
  -- concluir mesmo depois de o PEDIDO ter mudado de vida por outro caminho
  -- (admin cancela + registrar_estorno_manual enquanto a devolução está
  -- 'recebida', ou o estoque já voltou pelo cancelamento). Sem isto: venda de
  -- balcão de R$100, devolução concluída com reembolso, pedido cancelado e
  -- estornado por fora → 200 saem por uma venda de 100, e o estoque credita
  -- de novo (achado C, ver devolver_estoque logo abaixo).
  IF v_o.status <> 'delivered' THEN
    RAISE EXCEPTION 'O pedido desta devolução não está mais entregue (status atual: %). Fale com o financeiro antes de concluir.',
      v_o.status USING ERRCODE = '22023';
  END IF;
  IF v_o.payment_status IS NULL
     OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
    RAISE EXCEPTION 'Este pedido não tem pagamento registrado para devolver.' USING ERRCODE = '22023';
  END IF;
  -- Achado 4 (revisão 26/09/2026, rodada 2): stock_returned_at NÃO É só
  -- "cancelou depois da devolução" — a política P1 (pago após expirar,
  -- HONRAR) reativa pedido expirado (devolver_estoque já carimbou) até
  -- 'delivered' de verdade, e esse carimbo nunca some. Recusar a conclusão
  -- inteira aqui prendia esses pedidos para sempre, sem devolução possível.
  -- A trava certa é só no REESTOQUE (abaixo, força reestocar=false) — a
  -- resolução (reembolso/troca/vale) segue normal.

  -- Inspeção e reestoque por item (uma vez só por item).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    SELECT * INTO v_di FROM public.devolucao_itens
     WHERE id = NULLIF(v_item ->> 'item_id', '')::uuid AND devolucao_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item não pertence a esta devolução.' USING ERRCODE = '22023';
    END IF;
    v_condicao := v_item ->> 'condicao';
    IF v_condicao IS NULL OR v_condicao NOT IN ('nova', 'usada', 'danificada', 'ausente') THEN
      RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
    END IF;
    v_reestocar := COALESCE((v_item ->> 'reestocar')::boolean, false) AND v_condicao <> 'ausente'
                   AND v_o.stock_returned_at IS NULL;

    UPDATE public.devolucao_itens SET condicao = v_condicao, reestocar = v_reestocar WHERE id = v_di.id;

    IF v_reestocar AND v_di.reestocado_em IS NULL THEN
      IF v_di.variant_id IS NOT NULL THEN
        UPDATE public.product_variants SET stock_increment = stock_increment + v_di.quantidade
         WHERE id = v_di.variant_id;
      ELSIF v_di.product_id IS NOT NULL THEN
        UPDATE public.produtos SET estoque = estoque + v_di.quantidade WHERE id = v_di.product_id;
      END IF;
      UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;
      v_reestocados := v_reestocados + v_di.quantidade;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.devolucao_itens WHERE devolucao_id = p_id AND condicao IS NULL) THEN
    RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
  END IF;

  IF p_resolucao = 'reembolso' THEN
    -- Achado G: pagamento online com mais de 180 dias — o executor
    -- (supabase/functions/_shared/estorno.ts, guardaAntesDeChamar) RECUSA
    -- antes de chamar o Mercado Pago (prazo_vicio_dias aceita até 365, o MP
    -- só até 180). Abrir a linha em order_refunds ali só criaria um
    -- 'recusado' e a devolução concluiria sem dinheiro sair e sem caminho de
    -- refazer. Vai direto pelo caminho manual (a loja resolve fora do app).
    v_pago_pelo_app := v_o.payment_method = 'online'
                       AND v_o.payment_status IN ('pago', 'pago_apos_expirar')
                       AND v_o.gateway_payment_id IS NOT NULL
                       AND v_o.paid_at IS NOT NULL
                       AND now() - v_o.paid_at <= interval '180 days';

    IF v_pago_pelo_app THEN
      -- A conta ÚNICA de pedido__saldo_a_estornar (20261241000000): total − já devolvido − em voo
      -- (inclusive a concluída ainda não somada) − EM DÚVIDA (linha falhou/recusado que pode ter saído
      -- no Mercado Pago e não foi substituída por manual) − reembolso manual de devolução JÁ CONCLUÍDA
      -- (achado 3 da revisão de 26/09/2026; esta devolução está 'recebida' e não entra na própria conta).
      v_disponivel := public.pedido__saldo_a_estornar(v_o.id);
    ELSE
      SELECT v_o.total - COALESCE(v_o.valor_estornado, 0) - COALESCE(sum(d.valor_reembolso), 0)
        INTO v_disponivel
        FROM public.devolucoes d
       WHERE d.order_id = v_o.id AND d.status = 'concluida' AND d.reembolso_manual;
    END IF;
    v_disponivel := GREATEST(COALESCE(v_disponivel, 0), 0);

    -- Achado A: valor explícito do lojista continua recusado se passar do
    -- disponível (erro dele, ele corrige); o DEFAULT (valor dos itens + frete
    -- de ida) é CAPADO no disponível em vez de recusar a conclusão — era isto
    -- que fazia uma devolução integral com cupom (itens no preço cheio,
    -- 220 > 120 pagos) travar para sempre.
    IF p_valor_reembolso IS NOT NULL THEN
      v_valor := round(p_valor_reembolso, 2);
      IF v_valor <= 0 THEN
        RAISE EXCEPTION 'Informe o valor do reembolso.' USING ERRCODE = '22023';
      END IF;
      IF v_pago_pelo_app THEN
        IF v_valor > v_disponivel THEN
          RAISE EXCEPTION 'O reembolso (R$ %) passa do que ainda pode ser devolvido deste pedido (R$ %).',
            v_valor, v_disponivel USING ERRCODE = '22023';
        END IF;
      ELSE
        IF v_valor > v_disponivel THEN
          RAISE EXCEPTION 'O reembolso (R$ %) passa do valor pago no pedido (R$ %).',
            v_valor, v_disponivel USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSE
      v_valor := LEAST(round(v_d.valor_itens + v_d.valor_frete_ida, 2), v_disponivel);
      IF v_valor <= 0 THEN
        RAISE EXCEPTION 'Não há valor disponível para reembolso deste pedido.' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_pago_pelo_app THEN
      INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
      VALUES (v_o.id, v_valor, 'Devolução ' || v_d.protocolo, 'lojista', 'solicitado')
      RETURNING id INTO v_refund_id;
    ELSE
      v_manual := true;
    END IF;
  END IF;

  UPDATE public.devolucoes
     SET status = 'concluida', resolucao_final = p_resolucao,
         valor_reembolso = CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
         refund_id = v_refund_id, reembolso_manual = v_manual,
         observacao_inspecao = NULLIF(btrim(COALESCE(p_observacao, '')), ''),
         concluida_em = now(), updated_at = now()
   WHERE id = p_id;

  PERFORM public.devolucao__registrar_evento(p_id, 'recebida', 'concluida', 'loja',
    CASE p_resolucao
      WHEN 'reembolso' THEN 'Reembolso de R$ ' || to_char(v_valor, 'FM999G999G990D00')
        || CASE WHEN v_manual THEN ' (devolvido pela loja fora do app)' ELSE ' pelo Mercado Pago' END
      WHEN 'troca' THEN 'Troca combinada com a loja'
      ELSE 'Vale-troca emitido'
    END);

  RETURN jsonb_build_object(
    'id', p_id, 'status', 'concluida', 'resolucao', p_resolucao,
    'valor_reembolso', CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
    'refund_id', v_refund_id, 'reembolso_manual', v_manual, 'reestocados', v_reestocados
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. autorizar_post_do_estorno: corpo vigente da 20261196000000 + recusa da linha liberada por fora (A3)
-- ---------------------------------------------------------------------------
-- Não desconta o "em dúvida" (A5b): a conta segue a da 20261196000000.
CREATE OR REPLACE FUNCTION public.autorizar_post_do_estorno(
  p_refund_id uuid,
  p_valor numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_linha public.order_refunds%ROWTYPE;
  v_total numeric(12,2);
  v_estornado numeric(12,2);
  v_payment_status text;
  v_paid_at timestamptz;
  v_status text;
  v_gateway text;
  v_em_voo_outras numeric(12,2);
  v_disponivel numeric(12,2);
BEGIN
  IF p_refund_id IS NULL OR p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'autorizar_post_entrada_invalida: linha e valor positivo são obrigatórios.';
  END IF;

  -- ORDEM GLOBAL (cabeçalho): a LINHA, depois o PEDIDO.
  SELECT * INTO v_linha
    FROM public.order_refunds
   WHERE id = p_refund_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('decisao', 'linha_mudou', 'status', NULL);
  END IF;

  SELECT total, COALESCE(valor_estornado, 0), payment_status, paid_at, status, gateway_payment_id
    INTO v_total, v_estornado, v_payment_status, v_paid_at, v_status, v_gateway
    FROM public.marketplace_orders
   WHERE id = v_linha.order_id
     FOR UPDATE;

  IF v_linha.solicitado_por = 'sistema'
     OR v_linha.status <> 'em_processamento'
     OR v_linha.amount <> p_valor THEN
    RETURN jsonb_build_object('decisao', 'linha_mudou', 'status', v_linha.status);
  END IF;

  -- A3 (20261241000000): a loja assumiu esta linha POR FORA depois da espera de 7 dias
  -- (admin_devolucao_reembolso_por_fora_apos_espera / registrar_estorno_manual_apos_espera).
  -- Nenhum POST dela sai mais, nem do clique nem do robô: pagaria a cliente duas vezes. A marca
  -- é lida DEPOIS da trava da linha; quem marca trava a MESMA linha antes de gravar.
  IF EXISTS (SELECT 1
               FROM public.order_refund_prova pv
              WHERE pv.refund_id = v_linha.id
                AND pv.por_fora_liberado_em IS NOT NULL) THEN
    RETURN jsonb_build_object('decisao', 'linha_mudou', 'status', v_linha.status);
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_em_voo_outras
    FROM public.order_refunds
   WHERE order_id = v_linha.order_id
     AND id <> v_linha.id
     AND status IN ('solicitado', 'em_processamento');
  v_disponivel := v_total - v_estornado - v_em_voo_outras;

  IF p_valor > v_disponivel THEN
    RETURN jsonb_build_object('decisao', 'nao_cabe', 'disponivel', v_disponivel);
  END IF;

  -- O carimbo do POST autorizado (R1 da revisão Opus de 14d77a5b): daqui
  -- em diante a linha é INCERTA — ver o cabeçalho.
  UPDATE public.order_refunds
     SET updated_at = now(),
         post_autorizado_em = now()
   WHERE id = v_linha.id;

  RETURN jsonb_build_object(
    'decisao', 'autorizado',
    'disponivel', v_disponivel,
    'pedido', jsonb_build_object(
      'id', v_linha.order_id,
      'gateway_payment_id', v_gateway,
      'total', v_total,
      'valor_estornado', v_estornado,
      'payment_status', v_payment_status,
      'paid_at', v_paid_at,
      'status', v_status
    )
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. A reemissão e o "por fora" (20261226000000) chamam a regra única
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reemitir_reembolso_da_devolucao(
  p_devolucao_id uuid,
  p_ator uuid,
  p_refund_esperado uuid,
  p_consulta jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reemitir$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_consulta text;
  v_sem_post boolean;
  v_mp_refund text;
  v_mp_status text;
  v_valor numeric(12, 2);
  v_saldo numeric(12, 2);
  v_novo uuid;
BEGIN
  IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Não autorizado: a reemissão do reembolso só acontece pelo servidor.'
      USING ERRCODE = '42501';
  END IF;
  IF p_ator IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Admin ATUAL do ATOR, nas duas fontes (auth.users e profiles), nunca do JWT nem da sessão:
  -- is_admin()/is_admin_atual() devolvem TRUE para service_role e aqui não conferiam nada.
  IF NOT (
       EXISTS (SELECT 1 FROM auth.users u
                WHERE u.id = p_ator AND (u.raw_app_meta_data ->> 'role') = 'admin')
       AND EXISTS (SELECT 1 FROM public.profiles pr
                    WHERE pr.id = p_ator AND pr.role = 'admin')
     ) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;
  v_consulta := p_consulta ->> 'resultado';
  IF v_consulta IS NULL OR v_consulta NOT IN ('achou', 'nao_achou') THEN
    RAISE EXCEPTION 'A consulta ao Mercado Pago precisa dizer "achou" ou "nao_achou"; indeterminado não reemite.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final IS DISTINCT FROM 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode reemitir o reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.reembolso_manual THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'por_fora');
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso para reemitir.' USING ERRCODE = '22023';
  END IF;

  -- As linhas do pedido, por id, ANTES do pedido (a ordem de concluir_estorno e do cancelamento).
  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;
  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Duplo clique / dois lojistas / tela velha: a devolução já aponta para outra linha.
  IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'outra_linha',
                              'refund_id', v_d.refund_id);
  END IF;
  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A linha de reembolso desta devolução não existe mais.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status IN ('solicitado', 'em_processamento') THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', v_r.status, 'refund_id', v_r.id);
  END IF;

  -- A linha é `falhou` ou `recusado`. NUNCA teve POST? A regra ÚNICA "pode ter saído"
  -- (order_refund__pode_ter_saido, 20261241000000): a mesma lista fechada de antes (o diagnóstico
  -- em order_refund_diagnostico), mais a regra do LEGADO (linha nascida antes da autorização com
  -- tentativas > 1 = pode ter saído).
  v_sem_post := NOT public.order_refund__pode_ter_saido(v_r.id);

  IF v_sem_post THEN
    -- Nada saiu desta linha. Um reembolso do pedido sem dono no MP é dinheiro NÃO explicado: não
    -- cria (pagaria de novo) e não adota (nunca se adota para linha que nunca teve POST).
    IF v_consulta = 'achou' THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_do_mp_sem_dono');
    END IF;
  ELSE
    -- Incerta: o POST pode ter chegado ao MP. Sem reembolso achado, nunca ganha chave nova.
    IF v_consulta = 'nao_achou' THEN
      RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'sem_prova_de_que_nao_saiu',
                                'refund_id', v_r.id);
    END IF;

    -- ADOTAR: o MP já fez este reembolso.
    v_mp_refund := NULLIF(btrim(p_consulta ->> 'mp_refund_id'), '');
    v_mp_status := p_consulta ->> 'mp_status';
    BEGIN
      v_valor := (p_consulta ->> 'valor')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'O valor da consulta ao Mercado Pago não é um número.' USING ERRCODE = '22023';
    END;
    IF v_mp_refund IS NULL OR v_mp_status IS NULL OR v_mp_status NOT IN ('processed', 'approved') OR v_valor IS NULL THEN
      RAISE EXCEPTION 'A consulta "achou" precisa de mp_refund_id, mp_status (processed/approved) e valor.' USING ERRCODE = '22023';
    END IF;
    IF v_valor <> v_r.amount THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'valor_diferente');
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_refunds x
                WHERE x.order_id = v_r.order_id AND x.id <> v_r.id AND x.mp_refund_id = v_mp_refund) THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_ja_registrado_em_outra_linha');
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_refunds x
                WHERE x.order_id = v_r.order_id AND x.id <> v_r.id
                  AND x.solicitado_por <> 'sistema'
                  AND x.mp_refund_id IS NULL
                  AND x.amount = v_r.amount
                  AND x.status IN ('solicitado', 'em_processamento', 'falhou')) THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'outra_linha_do_mesmo_valor');
    END IF;

    BEGIN
      PERFORM public.concluir_estorno(v_r.id, v_mp_refund, v_mp_status, NULL);
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_ja_registrado_em_outra_linha');
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'estorno_acima_do_total%' THEN
          RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'passaria_do_total_do_pedido');
        END IF;
        RAISE;
    END;
    PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
      'O reembolso desta devolução já tinha sido feito pelo Mercado Pago; a loja confirmou.');
    RETURN jsonb_build_object('resultado', 'ja_existia', 'detalhe', 'adotado',
                              'refund_id', v_r.id, 'mp_refund_id', v_mp_refund);
  END IF;

  -- CRIAR a tentativa nova (a linha nunca teve POST e o MP não tem reembolso sem dono).
  IF v_o.status <> 'delivered' THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'pedido_nao_entregue');
  END IF;
  IF v_o.payment_status IS NULL OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'sem_pagamento_pelo_app');
  END IF;
  IF NOT (v_o.payment_method = 'online'
          AND v_o.gateway_payment_id IS NOT NULL
          AND v_o.paid_at IS NOT NULL
          AND now() - v_o.paid_at <= interval '180 days') THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'fora_do_prazo_ou_da_forma');
  END IF;
  -- Devolução pelo painel do MP depois da conclusão: o webhook a registra como linha `sistema`
  -- (sem contestação). Reemitir pagaria a cliente de novo.
  IF EXISTS (SELECT 1 FROM public.order_refunds s
              WHERE s.order_id = v_o.id
                AND s.solicitado_por = 'sistema'
                AND s.status = 'concluido'
                AND s.mp_chargeback_id IS NULL
                AND s.created_at >= COALESCE(v_d.concluida_em, v_d.updated_at)) THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'devolvido_pelo_painel_do_mp');
  END IF;

  v_saldo := public.pedido__saldo_a_estornar(v_o.id);
  IF v_saldo IS NULL OR v_saldo < v_d.valor_reembolso THEN
    RETURN jsonb_build_object('resultado', 'sem_saldo_para_reemitir', 'detalhe', 'saldo_menor_que_o_valor',
                              'saldo', GREATEST(COALESCE(v_saldo, 0), 0), 'valor', v_d.valor_reembolso);
  END IF;

  INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
  VALUES (v_o.id, v_d.valor_reembolso, 'Reemissão da devolução ' || v_d.protocolo, 'lojista', 'solicitado')
  RETURNING id INTO v_novo;

  UPDATE public.devolucoes
     SET refund_id = v_novo, reembolso_manual = false, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso reemitido pelo Mercado Pago após a falha anterior.');

  RETURN jsonb_build_object('resultado', 'reemitido', 'detalhe', 'tentativa_nova',
                            'refund_id', v_novo, 'refund_anterior', v_r.id);
END;
$reemitir$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_reembolso_por_fora(
  p_devolucao_id uuid,
  p_refund_esperado uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $por_fora$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_risco boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final IS DISTINCT FROM 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode ser resolvida por fora.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.reembolso_manual THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'por_fora');
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso para resolver por fora.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;
  PERFORM 1 FROM public.marketplace_orders o WHERE o.id = v_d.order_id FOR UPDATE;

  IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'outra_linha',
                              'refund_id', v_d.refund_id);
  END IF;
  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A linha de reembolso desta devolução não existe mais.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status IN ('solicitado', 'em_processamento') THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', v_r.status, 'refund_id', v_r.id);
  END IF;

  -- A regra ÚNICA "pode ter saído" (order_refund__pode_ter_saido, 20261241000000), lida ANTES da
  -- marca de substituída logo abaixo (depois dela a regra diria "não").
  v_risco := public.order_refund__pode_ter_saido(v_r.id);

  -- A4 (20261241000000): o reembolso desta devolução passa a ser MANUAL (o saldo o desconta como
  -- manual); a linha que ele substitui SAI da conta "em dúvida" do saldo, senão o mesmo valor seria
  -- descontado duas vezes. A linha em si fica como está.
  INSERT INTO public.order_refund_prova AS pv (refund_id, substituida_por_manual_em)
  VALUES (v_r.id, now())
  ON CONFLICT (refund_id) DO UPDATE
     SET substituida_por_manual_em = COALESCE(pv.substituida_por_manual_em, EXCLUDED.substituida_por_manual_em);

  UPDATE public.devolucoes
     SET refund_id = NULL, reembolso_manual = true, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso resolvido manualmente (fora do app) após a falha pelo Mercado Pago.');
  PERFORM public.devolucao__avisar_reembolso(p_devolucao_id, 'reembolso_combinado', 'success',
    'Devolução concluída',
    'O reembolso da devolução ' || v_d.protocolo || ' foi combinado com a loja (em mãos ou por PIX). Se tiver dúvida, fale com a loja.');

  RETURN jsonb_build_object('resultado', 'combinado',
                            'detalhe', CASE WHEN v_risco THEN 'pode_ter_saido_no_mp' ELSE 'ok' END,
                            'risco_de_dobro', v_risco);
END;
$por_fora$;

-- ---------------------------------------------------------------------------
-- 8. O aviso da cliente (20261225000000): reembolso em andamento = "a loja está confirmando"
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
        v_msg := CASE NEW.resolucao_final
          WHEN 'troca' THEN 'A troca da devolução ' || NEW.protocolo || ' foi confirmada.'
          ELSE 'O vale-troca da devolução ' || NEW.protocolo || ' foi emitido.'
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

-- ---------------------------------------------------------------------------
-- 9. Saída dos 7 dias da DEVOLUÇÃO
-- ---------------------------------------------------------------------------
-- A linha da devolução está em_processamento (o MP nunca respondeu) ou falhou e PODE ter saído. Depois de 7
-- dias do último envio autorizado (ou da criação), a loja pode assumir o reembolso por fora. Risco assumido
-- e devolvido na resposta: se o MP processar a linha depois, a cliente recebe duas vezes (o saldo desconta
-- os dois — o lado seguro — e o robô nunca mais envia a linha: A3).
-- Ordem de travas (a da casa): devolução -> linhas de order_refunds do pedido (por id) -> pedido.
CREATE OR REPLACE FUNCTION public.admin_devolucao_reembolso_por_fora_apos_espera(
  p_devolucao_id uuid,
  p_refund_esperado uuid,
  p_confirmacao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $por_fora_apos_espera$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_desde timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(COALESCE(p_confirmacao, ''))) <> 'DEVOLVI POR FORA' THEN
    RAISE EXCEPTION 'Para confirmar, digite DEVOLVI POR FORA.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final IS DISTINCT FROM 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode ser resolvida por fora.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.reembolso_manual THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'por_fora');
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso para resolver por fora.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;
  PERFORM 1 FROM public.marketplace_orders o WHERE o.id = v_d.order_id FOR UPDATE;

  IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'outra_linha',
                              'refund_id', v_d.refund_id);
  END IF;
  -- Lida DEPOIS da trava da linha: um POST autorizado no meio já está carimbado aqui.
  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A linha de reembolso desta devolução não existe mais.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status = 'solicitado' THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', 'solicitado', 'refund_id', v_r.id);
  END IF;
  IF v_r.status = 'recusado'
     OR (v_r.status = 'falhou' AND NOT public.order_refund__pode_ter_saido(v_r.id)) THEN
    -- Nada saiu desta linha: não precisa esperar — é o "Já devolvi por fora" de sempre.
    RETURN jsonb_build_object('resultado', 'sem_espera', 'detalhe', 'use_por_fora', 'refund_id', v_r.id);
  END IF;

  -- A linha já foi resolvida por fora (marca posta): a saída não se usa duas vezes.
  IF EXISTS (SELECT 1 FROM public.order_refund_prova pv
              WHERE pv.refund_id = v_r.id
                AND (pv.substituida_por_manual_em IS NOT NULL OR pv.por_fora_liberado_em IS NOT NULL)) THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'ja_resolvido_por_fora', 'refund_id', v_r.id);
  END IF;
  -- em_processamento, ou falhou que pode ter saído: só depois de 7 dias do último envio (relógio do banco).
  -- A espera é a MESMA regra que o painel mostra (order_refund__liberavel_apos_espera).
  v_desde := COALESCE(v_r.post_autorizado_em, v_r.created_at);
  IF NOT public.order_refund__liberavel_apos_espera(v_r.id) THEN
    RETURN jsonb_build_object('resultado', 'aguarde', 'detalhe', 'antes_de_7_dias', 'refund_id', v_r.id,
                              'liberado_a_partir_de', v_desde + interval '7 days');
  END IF;

  -- A3 + A4: nenhum POST desta linha sai mais, e ela sai da conta "em dúvida" (o manual a substitui).
  INSERT INTO public.order_refund_prova AS pv (refund_id, substituida_por_manual_em, por_fora_liberado_em)
  VALUES (v_r.id, now(), now())
  ON CONFLICT (refund_id) DO UPDATE
     SET substituida_por_manual_em = COALESCE(pv.substituida_por_manual_em, EXCLUDED.substituida_por_manual_em),
         por_fora_liberado_em = COALESCE(pv.por_fora_liberado_em, EXCLUDED.por_fora_liberado_em);

  UPDATE public.devolucoes
     SET refund_id = NULL, reembolso_manual = true, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso resolvido manualmente (fora do app) depois de 7 dias sem resposta do Mercado Pago.');
  PERFORM public.devolucao__avisar_reembolso(p_devolucao_id, 'reembolso_combinado', 'success',
    'Devolução concluída',
    'O reembolso da devolução ' || v_d.protocolo || ' foi combinado com a loja (em mãos ou por PIX). Se tiver dúvida, fale com a loja.');

  RETURN jsonb_build_object('resultado', 'combinado', 'detalhe', 'apos_espera',
                            'risco_de_dobro', true, 'refund_id', v_r.id);
END;
$por_fora_apos_espera$;

REVOKE ALL ON FUNCTION public.admin_devolucao_reembolso_por_fora_apos_espera(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_devolucao_reembolso_por_fora_apos_espera(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Saída dos 7 dias do PEDIDO CANCELADO ("Já estornei" depois da espera)
-- ---------------------------------------------------------------------------
-- O registrar_estorno_manual de sempre recusa enquanto há linha em_processamento (o POST pode ter saído).
-- Esta é a saída quando o MP nunca respondeu: mesma regra de 7 dias, mesma frase, mesmo risco assumido.
-- TOTAL (a linha cobre todo o saldo ainda a devolver: total − valor_estornado − o que já saiu por fora, em
-- centavos exatos): grava payment_status = 'estornado' como registrar_estorno_manual (20261197000000) e tira
-- da fila as outras linhas 'solicitado'. PARCIAL (a linha cobre só parte): o pedido fica como está (nada de
-- 'estornado', nenhuma outra linha recusada), a linha ganha só a marca por fora e o valor dela passa a contar
-- no saldo como "por fora"; a resposta diz detalhe 'parcial' e risco_de_dobro.
-- Ordem de travas: linhas de order_refunds do pedido (por id) -> pedido -> as linhas de novo (por id; pega a
-- linha que nasceu enquanto a trava do pedido era esperada), como registrar_estorno_manual.
CREATE OR REPLACE FUNCTION public.registrar_estorno_manual_apos_espera(
  p_order_id uuid,
  p_refund_esperado uuid,
  p_confirmacao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $manual_apos_espera$
DECLARE
  v_o public.marketplace_orders%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_desde timestamptz;
  v_ja_manual numeric;
  v_resta numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(COALESCE(p_confirmacao, ''))) <> 'DEVOLVI POR FORA' THEN
    RAISE EXCEPTION 'Para confirmar, digite DEVOLVI POR FORA.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = p_order_id
    ORDER BY r.id
      FOR UPDATE;
  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  -- RELÊ e TRAVA as linhas com o pedido já travado (o passo 3 de registrar_estorno_manual, 20261197000000):
  -- a linha que nasceu enquanto a trava do pedido era esperada fica travada ANTES das checagens abaixo; sem
  -- isto a marca da edge (solicitado -> em_processamento) cai entre a checagem e o UPDATE e o POST sai.
  PERFORM 1 FROM public.order_refunds releitura WHERE releitura.order_id = p_order_id ORDER BY releitura.id FOR UPDATE;

  -- Lida DEPOIS da trava da linha: um POST autorizado no meio já está carimbado aqui.
  SELECT * INTO v_r FROM public.order_refunds WHERE id = p_refund_esperado;
  IF NOT FOUND OR v_r.order_id IS DISTINCT FROM p_order_id THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'linha_nao_e_do_pedido');
  END IF;
  IF v_o.payment_status = 'estornado' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'pedido_ja_estornado', 'refund_id', v_r.id);
  END IF;
  IF v_o.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Esta saída é do pedido cancelado. Para a devolução de um produto, use a saída da devolução.'
      USING ERRCODE = '22023';
  END IF;
  IF v_o.payment_status IS NULL
     OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
    RAISE EXCEPTION 'Este pedido não tem pagamento confirmado: não há dinheiro a devolver. Registrar o estorno agora esconderia um pagamento que ainda pode chegar.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.devolucoes d WHERE d.refund_id = v_r.id) THEN
    RETURN jsonb_build_object('resultado', 'sem_espera', 'detalhe', 'use_a_devolucao', 'refund_id', v_r.id);
  END IF;
  IF v_r.solicitado_por = 'sistema' THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', 'disputa_no_mp', 'refund_id', v_r.id);
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status IN ('solicitado', 'recusado')
     OR (v_r.status = 'falhou' AND NOT public.order_refund__pode_ter_saido(v_r.id)) THEN
    -- Nada saiu desta linha: não precisa esperar — é o "Já estornei" de sempre.
    RETURN jsonb_build_object('resultado', 'sem_espera', 'detalhe', 'use_ja_estornei', 'refund_id', v_r.id);
  END IF;
  -- OUTRA linha com dinheiro em movimento no MP: a espera desta linha não a cobre.
  IF EXISTS (SELECT 1 FROM public.order_refunds x
              WHERE x.order_id = p_order_id AND x.id <> v_r.id
                AND x.status = 'em_processamento' AND x.solicitado_por = 'sistema') THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', 'disputa_no_mp', 'refund_id', v_r.id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_refunds x
              WHERE x.order_id = p_order_id AND x.id <> v_r.id
                AND x.status = 'em_processamento') THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', 'outra_linha_em_processamento', 'refund_id', v_r.id);
  END IF;

  -- A linha já foi resolvida por fora (marca posta): a saída não se usa duas vezes.
  IF EXISTS (SELECT 1 FROM public.order_refund_prova pv
              WHERE pv.refund_id = v_r.id
                AND (pv.substituida_por_manual_em IS NOT NULL OR pv.por_fora_liberado_em IS NOT NULL)) THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'ja_resolvido_por_fora', 'refund_id', v_r.id);
  END IF;
  -- em_processamento, ou falhou que pode ter saído: só depois de 7 dias do último envio (relógio do banco).
  -- A espera é a MESMA regra que o painel mostra (order_refund__liberavel_apos_espera).
  v_desde := COALESCE(v_r.post_autorizado_em, v_r.created_at);
  IF NOT public.order_refund__liberavel_apos_espera(v_r.id) THEN
    RETURN jsonb_build_object('resultado', 'aguarde', 'detalhe', 'antes_de_7_dias', 'refund_id', v_r.id,
                              'liberado_a_partir_de', v_desde + interval '7 days');
  END IF;

  -- O que já saiu por fora deste pedido: devolução manual concluída + linhas liberadas por fora numa saída
  -- PARCIAL anterior (por_fora_liberado_em sem a marca de substituída; a mesma parcela do saldo).
  SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
    FROM public.devolucoes d
   WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;
  v_ja_manual := v_ja_manual + COALESCE((SELECT sum(x.amount)
                                           FROM public.order_refunds x
                                           JOIN public.order_refund_prova pf ON pf.refund_id = x.id
                                          WHERE x.order_id = p_order_id
                                            AND pf.por_fora_liberado_em IS NOT NULL
                                            AND pf.substituida_por_manual_em IS NULL), 0);
  v_resta := v_o.total - COALESCE(v_o.valor_estornado, 0) - v_ja_manual;
  IF v_resta <= 0 THEN
    RAISE EXCEPTION 'Este pedido não tem mais nada a devolver: o valor já saiu por outro caminho (devolução ou estorno).'
      USING ERRCODE = '22023';
  END IF;

  -- PARCIAL: a linha NÃO cobre todo o saldo ainda a devolver (centavos exatos, numeric). O pedido NÃO vira
  -- 'estornado' (esconderia o resto, e o financeiro leria reembolso total): só a marca por fora (A3, nenhum
  -- POST desta linha sai mais). SEM a marca de substituída: o valor desta linha passa a contar no saldo como
  -- POR FORA em qualquer status (pedido__saldo_a_estornar) — é o único registro do dinheiro que saiu por
  -- fora. As outras linhas 'solicitado' seguem como estão.
  IF round(v_r.amount, 2) < round(v_resta, 2) THEN
    INSERT INTO public.order_refund_prova AS pv (refund_id, por_fora_liberado_em)
    VALUES (v_r.id, now())
    ON CONFLICT (refund_id) DO UPDATE
       SET por_fora_liberado_em = COALESCE(pv.por_fora_liberado_em, EXCLUDED.por_fora_liberado_em);

    RETURN jsonb_build_object('resultado', 'registrado', 'detalhe', 'parcial',
                              'risco_de_dobro', true, 'payment_status', v_o.payment_status, 'refund_id', v_r.id,
                              'ainda_a_devolver', v_resta - v_r.amount);
  END IF;

  -- TOTAL: a linha cobre todo o saldo ainda a devolver. A3 + A4: nenhum POST desta linha sai mais, e ela sai
  -- da conta "em dúvida" (o pedido estornado fecha a conta).
  INSERT INTO public.order_refund_prova AS pv (refund_id, substituida_por_manual_em, por_fora_liberado_em)
  VALUES (v_r.id, now(), now())
  ON CONFLICT (refund_id) DO UPDATE
     SET substituida_por_manual_em = COALESCE(pv.substituida_por_manual_em, EXCLUDED.substituida_por_manual_em),
         por_fora_liberado_em = COALESCE(pv.por_fora_liberado_em, EXCLUDED.por_fora_liberado_em);

  -- Como registrar_estorno_manual: o que ninguém pediu ao MP ainda sai da fila.
  UPDATE public.order_refunds x
     SET status = 'recusado',
         ultimo_erro = 'A loja registrou a devolução feita fora do app',
         updated_at = now()
   WHERE x.order_id = p_order_id
     AND x.status = 'solicitado';

  UPDATE public.marketplace_orders
     SET payment_status = 'estornado',
         estorno_manual_registrado_em = COALESCE(estorno_manual_registrado_em, now())
   WHERE id = p_order_id;

  RETURN jsonb_build_object('resultado', 'registrado', 'detalhe', 'apos_espera',
                            'risco_de_dobro', true, 'payment_status', 'estornado', 'refund_id', v_r.id);
END;
$manual_apos_espera$;

REVOKE ALL ON FUNCTION public.registrar_estorno_manual_apos_espera(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_estorno_manual_apos_espera(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. pedido_reembolsos_e_saldo — o que o painel mostra (o front deixa de copiar a conta)
-- ---------------------------------------------------------------------------
-- Contrato (o front depende dos NOMES): {total, valor_estornado, em_voo, em_duvida, manual, disponivel,
-- linhas: [{id, status, amount, pode_ter_saido, por_fora_liberado_em, por_fora_apos_espera_liberado,
-- substituida_por_manual, eh_pix}]}.
-- disponivel = GREATEST(pedido__saldo_a_estornar, 0) = total − valor_estornado − em_voo − em_duvida − manual,
-- nunca negativo (a linha em_processamento resolvida por fora conta em em_voo E em manual até o robô fechá-la:
-- o lado seguro, mas a conta crua pode ficar abaixo de zero). manual = devolução manual concluída + por fora
-- parcial do pedido cancelado. NUNCA o código do MP. por_fora_liberado_em = a MARCA (a saída dos 7 dias JÁ
-- foi usada, ou null); por_fora_apos_espera_liberado = a ESPERA da linha passou (order_refund__liberavel_apos_
-- espera, a mesma regra das duas portas) — a porta ainda pode recusar por outro motivo e o front mostra a
-- resposta dela; substituida_por_manual = a linha tem a marca de substituída (o manual tomou o lugar dela).
-- eh_pix: o pedido não é de cartão (metodo_online fora de credito/debito; NULL conta como PIX).
CREATE OR REPLACE FUNCTION public.pedido_reembolsos_e_saldo(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $reembolsos_e_saldo$
DECLARE
  v_o public.marketplace_orders%ROWTYPE;
  v_eh_pix boolean;
  v_em_voo numeric;
  v_em_duvida numeric;
  v_manual numeric;
  v_linhas jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  v_eh_pix := v_o.metodo_online IS NULL OR v_o.metodo_online NOT IN ('credito', 'debito');

  -- Os MESMOS filtros de pedido__saldo_a_estornar, parcela por parcela.
  SELECT COALESCE(sum(r.amount), 0) INTO v_em_voo
    FROM public.order_refunds r
   WHERE r.order_id = p_order_id
     AND (r.status IN ('solicitado', 'em_processamento')
          OR (r.status = 'concluido' AND r.concluido_em IS NULL));

  SELECT COALESCE(sum(r.amount), 0) INTO v_em_duvida
    FROM public.order_refunds r
   WHERE r.order_id = p_order_id
     AND r.status IN ('falhou', 'recusado')
     AND NOT EXISTS (SELECT 1
                       FROM public.order_refund_prova pv
                      WHERE pv.refund_id = r.id
                        AND pv.substituida_por_manual_em IS NOT NULL)
     AND NOT EXISTS (SELECT 1
                       FROM public.order_refund_prova pf
                      WHERE pf.refund_id = r.id
                        AND pf.por_fora_liberado_em IS NOT NULL)
     AND public.order_refund__pode_ter_saido(r.id);

  SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_manual
    FROM public.devolucoes d
   WHERE d.order_id = p_order_id
     AND d.status = 'concluida'
     AND d.reembolso_manual;
  v_manual := v_manual + COALESCE((SELECT sum(r.amount)
                                     FROM public.order_refunds r
                                     JOIN public.order_refund_prova pf ON pf.refund_id = r.id
                                    WHERE r.order_id = p_order_id
                                      AND pf.por_fora_liberado_em IS NOT NULL
                                      AND pf.substituida_por_manual_em IS NULL), 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'status', r.status,
           'amount', r.amount,
           'pode_ter_saido', public.order_refund__pode_ter_saido(r.id),
           'por_fora_liberado_em', pv.por_fora_liberado_em,
           'por_fora_apos_espera_liberado', public.order_refund__liberavel_apos_espera(r.id),
           'substituida_por_manual', pv.substituida_por_manual_em IS NOT NULL,
           'eh_pix', v_eh_pix
         ) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_linhas
    FROM public.order_refunds r
    LEFT JOIN public.order_refund_prova pv ON pv.refund_id = r.id
   WHERE r.order_id = p_order_id;

  RETURN jsonb_build_object(
    'total', v_o.total,
    'valor_estornado', COALESCE(v_o.valor_estornado, 0),
    'em_voo', v_em_voo,
    'em_duvida', v_em_duvida,
    'manual', v_manual,
    'disponivel', GREATEST(public.pedido__saldo_a_estornar(p_order_id), 0),
    'linhas', v_linhas
  );
END;
$reembolsos_e_saldo$;

REVOKE ALL ON FUNCTION public.pedido_reembolsos_e_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_reembolsos_e_saldo(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. A função antiga de reemissão fecha para o logado (sem chamador no front publicado)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_devolucao_reemitir_reembolso(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. CONFERÊNCIA FINAL (cai a migration inteira se qualquer coisa estiver fora do esperado)
-- ---------------------------------------------------------------------------
DO $conferencia_20261241$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.order_refund__pode_ter_saido(uuid)', 'sql', 's', 'bdbb28b3d91588c8b10283d57bfb73d6'),
      ('public.order_refund__liberavel_apos_espera(uuid)', 'sql', 's', 'cb37f24646fda24e1a51c8f01983e083'),
      ('public.pedido__saldo_a_estornar(uuid)', 'sql', 's', '99741b4cdbf1e8d8340f80440e6da094'),
      ('public.solicitar_estorno(uuid,numeric,text)', 'plpgsql', 'v', '840de50f44958fe43b55f5222691df9b'),
      ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'plpgsql', 'v', 'ebb901efff59a53082836a13e053cd1a'),
      ('public.autorizar_post_do_estorno(uuid,numeric)', 'plpgsql', 'v', 'c73e48294c08f34240abc3843aa7d1f1'),
      ('public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)', 'plpgsql', 'v', 'fd5d79042efa68f9a17298fff1e950bd'),
      ('public.admin_devolucao_reembolso_por_fora(uuid,uuid)', 'plpgsql', 'v', '76eaffb4f9438f7fe557961e1bdaad81'),
      ('public.devolucao_avisa_o_cliente()', 'plpgsql', 'v', '56502b960dcf3e136c1d0d5c41091c20'),
      ('public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', 'plpgsql', 'v', '92dd1608d02ef5e9fd9fe34e0bd7c49f'),
      ('public.registrar_estorno_manual_apos_espera(uuid,uuid,text)', 'plpgsql', 'v', '7b1403e418b2d80d02db287444f8a0ef'),
      ('public.pedido_reembolsos_e_saldo(uuid)', 'plpgsql', 's', 'baf21d65b13bea6b8e0d18f3ced1e05e')
    ) AS esperado(assinatura, lingua, volatilidade, hash_desta)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.assinatura)
                      AND l.lanname = r.lingua
                      AND p.prosecdef
                      AND p.provolatile = r.volatilidade
                      AND p.proconfig = ARRAY['search_path=public']::text[]
                      AND md5(replace(p.prosrc, E'\r', '')) = r.hash_desta) THEN
      RAISE EXCEPTION 'CONFERENCIA_20261241: % não está com o corpo e os atributos desta migration.', r.assinatura;
    END IF;
  END LOOP;

  -- A regra única: ninguém de fora executa (nem service_role); só as funções desta casa, como dono.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN (to_regprocedure('public.order_refund__pode_ter_saido(uuid)'),
                              to_regprocedure('public.order_refund__liberavel_apos_espera(uuid)'))
                AND a.privilege_type = 'EXECUTE'
                AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'CONFERENCIA_20261241: order_refund__pode_ter_saido ou order_refund__liberavel_apos_espera executável por papel que não é o dono.';
  END IF;

  -- As três portas do lojista: só o logado (o corpo exige o admin ATUAL); nem PUBLIC nem anon.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN (to_regprocedure('public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)'),
                              to_regprocedure('public.registrar_estorno_manual_apos_espera(uuid,uuid,text)'),
                              to_regprocedure('public.pedido_reembolsos_e_saldo(uuid)'))
                AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.registrar_estorno_manual_apos_espera(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.pedido_reembolsos_e_saldo(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.registrar_estorno_manual_apos_espera(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.pedido_reembolsos_e_saldo(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CONFERENCIA_20261241: as portas novas do lojista têm de ser do authenticated e fechadas a PUBLIC e anon.';
  END IF;

  -- A função antiga: fechada para PUBLIC, anon e authenticated.
  IF has_function_privilege('authenticated', 'public.admin_devolucao_reemitir_reembolso(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_devolucao_reemitir_reembolso(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CONFERENCIA_20261241: admin_devolucao_reemitir_reembolso ainda executável pelo logado ou pelo visitante.';
  END IF;

  -- A tabela: RLS ligada, nenhuma policy, nenhum acesso de papel de API (nem service_role).
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.order_refund_prova'::regclass AND c.relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.order_refund_prova'::regclass)
     OR has_table_privilege('anon', 'public.order_refund_prova', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.order_refund_prova', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('service_role', 'public.order_refund_prova', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'CONFERENCIA_20261241: order_refund_prova tem de ter RLS ligada, nenhuma policy e nenhum acesso de anon/authenticated/service_role.';
  END IF;
END $conferencia_20261241$;

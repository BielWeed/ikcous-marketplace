-- ============================================================================
-- Migration 20261210000000 -- a vaga do cupom do PIX anulado volta em minutos
-- (cupom + dado de cliente; peca 2 de 2 de "o cupom preso depois de cancelar com
-- o PIX gerado volta em minutos, nao em 24 h"; 09/10/2026)
-- ============================================================================
--
-- 1. O DEFEITO E O EFEITO
--
-- O cliente cancela o pedido com o PIX ja gerado. A edge anula a cobranca no Mercado Pago e
-- o pedido fica 'cancelled', mas a vaga do cupom de uso unico so volta 24 h depois do prazo
-- do PIX (a espera que protege o PIX pago tarde). Para quem so cancelou e nunca pagou, e um dia
-- sem poder usar o cupom de novo. Depois desta migration o cupom volta quando o prazo do PIX
-- acaba (p_expires_at, ate ~45 min depois da criacao do pedido) mais o ciclo de 15 min da
-- varredura -- MAS SO quando o historico do pedido prova que nunca houve cobranca por cartao.
-- No instante do clique NAO volta (a documentacao do Mercado Pago nao garante que um PIX
-- cancelado nao possa ser pago; por isso espera o prazo do PIX).
--
-- 2. O QUE ESTA MIGRATION FAZ (a 2a peca; a 1a e a 20261209000000, que grava a foto)
--
-- Troca TRES funcoes para lerem a foto da cobranca que a 20261209000000 guarda no instante do
-- cancelamento (tabela public.pedido_cobranca_ao_cancelar):
--
--   (a) `cupom__vaga_volta_em`: o auxiliar que diz QUANDO a vaga volta. DROP da versao de 9
--       parametros e CREATE com o MESMO NOME e 13 parametros, na MESMA migration: os 9 de
--       sempre mais `p_foto_gateway`, `p_foto_tentativas`, `p_foto_metodo` e
--       `p_foto_payment_status`. E' a UNICA coisa que esta migration apaga, e so a funcao que ela
--       mesma recria: nenhuma tabela, coluna ou dado e apagado. CREATE OR REPLACE nao serve (nao
--       muda a lista de parametros). Uma pista NOVA entra antes do ELSE de 24 h (ver 3).
--   (b) `devolver_cupons_de_pedidos_mortos` (CREATE OR REPLACE, mesmo cabecalho): o corpo da
--       20261206000000 INTEIRO, mudando so a consulta do laco: le a foto por LEFT JOIN e passa os
--       13 argumentos ao auxiliar. O Postgres recusa `FOR UPDATE` simples com juncao externa; a
--       trava e `FOR UPDATE OF o SKIP LOCKED` (so a linha do pedido). Mantem o SKIP LOCKED e a UNICA
--       chamada a devolver_uso_cupom.
--   (c) `vaga_do_cupom_presa` (CREATE OR REPLACE, mesma assinatura): o corpo da 20261205000000
--       lendo a foto do mesmo jeito, para a tela prometer o prazo novo.
--   Nao ha mudanca em validate_coupon_secure_v2, create_marketplace_order_v23/_v24,
--   devolver_uso_cupom, na foto nem em edge function.
--
-- 3. POR QUE A PISTA E SEGURA (E O QUE NAO E O MOTIVO)
--
-- A pista vale quando TODAS: (1) a FOTO do cancelamento tem id de cobranca de PIX (nao vazio, nao
-- 'verificando:'), zero tentativas, metodo 'pix' e payment_status 'aguardando'; (2) AGORA o pedido
-- esta cancelado, 'aguardando', com a vaga de cobranca VAZIA e exatamente UMA tentativa; (3) valem
-- todas as guardas de hoje (pedido com cupom, vaga nao devolvida, "cancelado depois do envio sem o
-- produto de volta"). A devolucao vem em `p_expires_at`, nunca antes e nunca '-infinity': o admin
-- pode reativar um pedido cancelado (update_order_status_atomic(id, 'pending'); o servidor nao o
-- barra) e a edge criar-pagamento aceita um pedido com prazo no futuro e vaga vazia para gerar um PIX
-- novo; se o cupom ja tivesse voltado, o PIX novo seria pago com o cupom devolvido (cupom em dobro).
-- Esperando o fim do prazo do PIX, passado o prazo a edge recusa gerar cobranca.
--
-- O RELOGIO NAO E O QUE IMPEDE O CUPOM DE VALER DUAS VEZES. O que garante e que, com a vaga VAZIA,
-- nenhum pagamento se liga ao pedido: confirmar_pagamento devolve 'divergente' (guarda da
-- 20261195000000) e payment_status segue 'aguardando'. Quatro fatos sustentam isso; se um deles
-- mudar, esta pista precisa ser revista:
--   (a) so liberar_cobranca_do_pedido (20261176000000) esvazia a vaga, sempre somando 1 em
--       tentativas_de_pagamento: foto com zero tentativas + agora uma tentativa + vaga vazia =
--       exatamente uma liberacao, a do PIX que a foto mostra;
--   (b) o cartao nunca vai ao Mercado Pago sem ocupar a vaga antes (reserva antes do POST e
--       reocupacao, edge criar-pagamento); trocar de cobranca passa por liberar, que soma 1;
--   (c) o webhook so ADOTA cobranca para cartao e o faz SEM conferir o status do pedido;
--   (d) a edge criar-pagamento recusa pedido cancelado: `.neq("status","cancelled")` (travado so
--       para PIX, `metodo !== "cartao"`) e `podeCobrar`. PARA O CARTAO O QUE SEGURA SAO A RESERVA
--       ANTES DO POST, A REOCUPACAO E A ADOCAO DA criar-pagamento, NAO o `.neq` de (d). Como o webhook
--       adota sem conferir o status do pedido, esta pista so e segura porque a foto com zero
--       tentativas e vaga = id de PIX prova que NUNCA houve POST de cartao nesse pedido.
-- (b), (c) e (d) sao codigo de edge function e NAO sao provados pelo banco (a prova viva confere o
-- lado do banco). PRE-CONDICAO DA PUBLICACAO: medir a versao das FUNCTIONS no servidor de CADA loja
-- (reserva antes do POST e travas da frente B), nao so o version.json do front.
--
-- Estado A (segundos a ~10 min depois de cancelar): a vaga ainda guarda o id do PIX e ha zero
-- tentativas. Um PIX pago tarde nessa janela vira `pago_apos_expirar` (honra o pagamento); devolver
-- o cupom ali seria cupom em dobro. A pista NAO vale no estado A: segue as 24 h de hoje.
--
-- 4. DADOS QUE JA EXISTEM
--
-- Nenhuma linha de nenhuma tabela e lida nem alterada ao aplicar: so troca tres funcoes. Pedido
-- cancelado ANTES da 20261209000000 nao tem foto e segue com o prazo de hoje (a foto de um pedido
-- que ja estava cancelado nunca se forma). A varredura seguinte (ate 15 min depois) devolve a vaga
-- dos pedidos do estado B cujo prazo do PIX ja passou: e' o efeito pretendido. Nada e apagado.
--
-- 5. O PRE-VOO (RECUSA, COM O NOME DO QUE DIVERGE, SEM GRAVAR NADA)
--
-- Colunas lidas ausentes; a foto (20261209000000) ausente ou fora da forma (tabela, chave primaria
-- que garante UMA foto por pedido -- sem ela o JOIN devolveria o cupom duas vezes --, funcao do
-- gatilho, gatilho ativo); devolver_uso_cupom ausente; mais de uma versao da varredura, da RPC ou do
-- auxiliar (uma so, de 9 parametros da 20261206000000 ou de 13 desta migration ja aplicada); corpo
-- vivo de cada uma que nao e o previsto (sha256, LF ou CRLF: 1 byte a mais ja recusa). O pos-voo
-- confere de novo, depois de criar, os tres corpos, as sobrecargas e as ACLs (o auxiliar sem EXECUTE
-- para ninguem; a RPC so para authenticated; a varredura fechada). Os hashes sao amarrados ao texto
-- por tests/migration_a_vaga_do_cupom_do_pix_anulado_volta_test.ts.
--
-- 6. TRAVAS, CONCORRENCIA E O ENVELOPE DO WORKFLOW
--
-- Esta migration NAO pede trava de tabela (CREATE OR REPLACE e DROP de funcao) e nao le nem escreve
-- LINHA de tabela: nenhum pedido em andamento a espera e ela nao espera pedido, e nao ha deadlock
-- (40P01) possivel com o checkout. No envelope REPEATABLE READ (aplicar-migrations.yml) a foto da
-- impressao digital nao a engana (so le catalogo). `SET LOCAL lock_timeout = '5s'` e cinto de
-- seguranca para qualquer outra espera; `SET LOCAL statement_timeout = '30s'` vale ate o fim da
-- transacao. A varredura que roda (agendador) no instante exato do COMMIT pode, no maximo, falhar
-- UM ciclo se a funcao antiga sumir no meio do comando dela; o ciclo seguinte (15 min) a refaz.
--
-- 7. IDEMPOTENCIA E TRANSACAO
--
-- DROP ... IF EXISTS, CREATE OR REPLACE, REVOKE e COMMENT repetiveis: reaplicar produz o mesmo
-- estado (o pre-voo aceita o auxiliar de 13 parametros com o corpo desta migration). Sem BEGIN/COMMIT
-- de nivel superior (regra da casa: com eles o ROLLBACK da prova do workflow vira no-op). O arquivo
-- roda numa unica consulta: os SET LOCAL, o pre-voo, as pecas e o pos-voo caem juntos ou nao caem
-- (inclusive o DROP). Num banco local, com `psql`, usar `-1`.
--
-- 8. ORDEM
--
-- Depois da 20261209000000 (a foto) e da 20261206000000 (o pre-voo exige). Seguro em qualquer
-- ordem de publicacao do front: so encurta a espera de quem cancelou com o PIX gerado.
--
-- 9. ROLLBACK MANUAL: supabase/migrations/rollback-manual-20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql
--    (devolve a varredura da 20261206000000, a RPC da 20261205000000 e o auxiliar de 9 parametros
--    da 20261206000000 byte a byte, com os comentarios; recusa se algum corpo vivo nao e o desta
--    migration). ORDEM DE DESFAZER: 20261210000000 -> 20261209000000 -> 20261206000000 ->
--    20261205000000 (o rollback da 20261209000000 recusa enquanto estas funcoes citarem a tabela).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261210$
DECLARE
  v_hash text;
  v_n integer;
  v_forma text;
  v_attnum smallint;
  r record;
BEGIN
  IF to_regclass('public.marketplace_orders') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: falta a tabela public.marketplace_orders -- aplique as migrations anteriores antes desta; nada foi gravado.';
  END IF;

  -- (a) as colunas que o auxiliar, a varredura e a RPC leem.
  FOR r IN
    SELECT * FROM (VALUES
      ('id'), ('user_id'), ('coupon_id'), ('status'), ('payment_status'),
      ('coupon_usage_returned'), ('expires_at'), ('cancelled_after_shipping'),
      ('returned_to_seller_at'), ('gateway_payment_id'), ('tentativas_de_pagamento')
    ) AS c(coluna)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = 'public.marketplace_orders'::regclass
         AND a.attname = r.coluna AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261210: falta a coluna public.marketplace_orders.% -- aplique as migrations anteriores antes desta; nada foi gravado.', r.coluna;
    END IF;
  END LOOP;

  -- (b) a foto da cobranca (20261209000000): tabela, chave primaria, funcao e gatilho.
  IF to_regclass('public.pedido_cobranca_ao_cancelar') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: falta a foto da cobranca (public.pedido_cobranca_ao_cancelar) -- aplique antes a migration 20261209000000; nada foi gravado.';
  END IF;
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
                    || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum)
    INTO v_forma
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS DISTINCT FROM 'order_id:uuid:true:,gateway_payment_id:text:false:,tentativas:integer:true:,metodo_online:text:false:,payment_status:text:false:,cancelado_em:timestamp with time zone:true:now()' THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: public.pedido_cobranca_ao_cancelar tem outra forma de colunas (%) -- nao e a da 20261209000000; nada foi gravado.', v_forma;
  END IF;
  SELECT a.attnum INTO v_attnum FROM pg_attribute a
   WHERE a.attrelid = 'public.pedido_cobranca_ao_cancelar'::regclass AND a.attname = 'order_id';
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
       AND c.contype = 'p' AND c.conkey = ARRAY[v_attnum]
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: public.pedido_cobranca_ao_cancelar nao tem a chave primaria em order_id -- sem ela o JOIN da varredura pode devolver o mesmo cupom duas vezes; nada foi gravado.';
  END IF;
  IF to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: public.pedido__foto_da_cobranca_ao_cancelar() nao existe -- aplique antes a migration 20261209000000; nada foi gravado.';
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()');
  IF v_hash NOT IN ('026044748667e241a86479c4e7a9a7d7fb99a677df5ef15a939335ff8403acf4', '269a863b65e3db29f14dc22fec553d8ce624a5ba070e6b7fe9cad72c12a6bcb7') THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente do da 20261209000000 (hash %); nada foi gravado.', v_hash;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.marketplace_orders'::regclass AND NOT t.tgisinternal
       AND t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'
       AND t.tgfoid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')::oid
       AND t.tgtype = 17 AND t.tgenabled = 'O'
       AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a
                              WHERE a.attrelid = t.tgrelid AND a.attname = 'status')
       AND regexp_replace(lower(substring(pg_get_triggerdef(t.oid) from ' WHEN (.*) EXECUTE FUNCTION')), '[()[:space:]]', '', 'g')
           = 'new.status=''cancelled''::textandold.statusisdistinctfrom''cancelled''::text'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: o gatilho tr_pedido_foto_da_cobranca_ao_cancelar ausente, desligado ou com outra definicao em marketplace_orders -- sem ele nao ha foto; nada foi gravado.';
  END IF;

  -- (c) a funcao que a varredura chama.
  IF to_regprocedure('public.devolver_uso_cupom(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: falta a funcao public.devolver_uso_cupom(uuid) -- aplique antes a migration 20260901000000; nada foi gravado.';
  END IF;

  -- (d) a varredura: UMA versao so, com o corpo da 20261206000000 (ou o desta, se reaplicando).
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos') <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: esperava exatamente uma versao de devolver_cupons_de_pedidos_mortos() -- inventarie antes de aplicar (nunca DROP para arrumar); nada foi gravado.';
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()');
  IF v_hash IS NULL OR v_hash NOT IN (
    'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
    'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8',
    '0e3fffedbd871c372ad000393b9f3c1abcda64a5703735a00cd5173f98bb35ae',
    'a0c8175ce56857e24fb7ebab37d18e45386f3711506f3906013ed73036c7f6ad'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: corpo vivo de devolver_cupons_de_pedidos_mortos() (hash %) nao e o da 20261206000000 nem o desta migration -- uma migration posterior o redefiniu ou a 20261206000000 nao foi aplicada; revise antes de aplicar; nada foi gravado.', COALESCE(v_hash, 'ausente');
  END IF;

  -- (e) a RPC: UMA versao so, com o corpo da 20261205000000 (ou o desta).
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'vaga_do_cupom_presa') <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: esperava exatamente uma versao de vaga_do_cupom_presa(text) -- inventarie antes de aplicar; nada foi gravado.';
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.vaga_do_cupom_presa(text)');
  IF v_hash IS NULL OR v_hash NOT IN (
    'a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47',
    '49e0b6befb684756ed4f1fada1e30ed7162763dc903816f49f2f76ce61820593',
    'd752391f13d27a741c3401b20a375ef7a7952bda3dfb2f6c257b96f6128cc84d',
    '9c659b8c1b18a808719c908076e9ce8948c384dae788aa396c4059512b5c1001'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: corpo vivo de vaga_do_cupom_presa (hash %) nao e o da 20261205000000 nem o desta migration -- uma migration posterior o redefiniu; revise antes de aplicar; nada foi gravado.', COALESCE(v_hash, 'ausente');
  END IF;

  -- (f) o auxiliar: UMA versao so -- a de 9 parametros da 20261206000000, ou a de 13 desta migration
  --     ja aplicada (o DROP da de 9 nao e repetido: IF EXISTS).
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cupom__vaga_volta_em';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_20261210: esperava exatamente uma versao de cupom__vaga_volta_em (a de 9 parametros da 20261206000000 ou a de 13 desta migration ja aplicada) e ha % -- inventarie antes de aplicar (nunca DROP para arrumar); nada foi gravado.', v_n;
  END IF;
  IF to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)') IS NOT NULL THEN
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc WHERE oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)');
    IF v_hash NOT IN (
      'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363',
      '6fc3bb6775c34d5739516fa9841bbc4787ae2d3be87e647acca8d465c513f6b6'
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261210: corpo vivo de cupom__vaga_volta_em de 9 parametros (hash %) nao e o da 20261206000000 -- uma migration posterior o redefiniu; revise antes de aplicar; nada foi gravado.', v_hash;
    END IF;
  ELSIF to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)') IS NOT NULL THEN
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc WHERE oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)');
    IF v_hash NOT IN ('0790c1962b526725c377344208392bfb7f15b1de20b0056e5bbb3002e40aa020', '8a8be76b9afd31e4e2c41f7bf559c472fbf33891cc1a771ff9116452b18afd5a') THEN
      RAISE EXCEPTION 'PREFLIGHT_20261210: corpo vivo de cupom__vaga_volta_em de 13 parametros (hash %) nao e o desta migration -- e de outra pessoa; nada foi gravado.', v_hash;
    END IF;
  ELSE
    RAISE EXCEPTION 'PREFLIGHT_20261210: a unica cupom__vaga_volta_em que existe nao tem 9 nem 13 parametros -- aplique antes a migration 20261206000000; nada foi gravado.';
  END IF;
END
$preflight_20261210$;

-- A UNICA coisa que esta migration apaga: o auxiliar de 9 parametros, que e RECRIADO logo abaixo com
-- o MESMO NOME e 13 parametros (os 9 de sempre mais os 4 da foto), na mesma migration. So uma funcao
-- recriada pode sofrer DROP aqui. Sem CASCADE de proposito: se alguem depender dela, recusa e nada
-- e gravado.
DROP FUNCTION IF EXISTS public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer);

CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(
    p_coupon_id uuid,
    p_status text,
    p_payment_status text,
    p_coupon_usage_returned boolean,
    p_expires_at timestamptz,
    p_cancelled_after_shipping boolean,
    p_returned_to_seller_at timestamptz,
    p_gateway_payment_id text,
    p_tentativas integer,
    p_foto_gateway text,
    p_foto_tentativas integer,
    p_foto_metodo text,
    p_foto_payment_status text
)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
    -- Cupom preso (20261210000000). Mesmo contrato da 20261206000000, com UMA pista nova: o PIX
    -- ANULADO. Os 4 ultimos parametros sao a FOTO da cobranca no instante do cancelamento
    -- (pedido_cobranca_ao_cancelar, 20261209000000); pedido cancelado antes da foto manda todos
    -- NULL e a pista nunca vale (as comparacoes com NULL nao sao verdadeiras).
    --
    -- A PISTA vale quando TODAS: a foto tem id de cobranca de PIX (nao vazio, nao 'verificando:'),
    -- zero tentativas, metodo 'pix' e 'aguardando'; e AGORA a vaga de cobranca esta vazia, ha
    -- exatamente UMA tentativa e o payment_status segue 'aguardando'. A devolucao vem em
    -- p_expires_at: a vaga volta no que vier por ultimo entre "a vaga esvaziou" (o estado de
    -- agora) e o fim do prazo do PIX. Nunca '-infinity': o admin pode reativar o pedido cancelado
    -- (update_order_status_atomic(id, 'pending')) e criar-pagamento aceita pedido com prazo no
    -- futuro e vaga vazia; com o cupom ja devolvido o PIX novo pago seria cupom em dobro.
    --
    -- O QUE GARANTE QUE O CUPOM NAO VALE DUAS VEZES nao e o relogio: e que, com a vaga VAZIA,
    -- nenhum pagamento se liga ao pedido (confirmar_pagamento devolve 'divergente', guarda da
    -- 20261195000000, e payment_status segue 'aguardando'). Quatro fatos sustentam isso; se um
    -- deles mudar, esta pista precisa ser revista:
    --   (a) so liberar_cobranca_do_pedido (20261176000000) esvazia a vaga, sempre somando 1 em
    --       tentativas_de_pagamento: foto com zero tentativas + agora uma tentativa + vaga vazia =
    --       exatamente uma liberacao, a do PIX que a foto mostra;
    --   (b) o cartao nunca vai ao Mercado Pago sem ocupar a vaga antes (reserva antes do POST e
    --       reocupacao, edge criar-pagamento);
    --   (c) o webhook so ADOTA cobranca para cartao, e o faz SEM conferir o status do pedido;
    --   (d) criar-pagamento recusa pedido cancelado: `.neq("status","cancelled")` so vale para PIX
    --       (metodo !== "cartao"). Para o CARTAO o que segura sao a reserva antes do POST, a
    --       reocupacao e a adocao da criar-pagamento, NAO o `.neq`. Como o webhook adota sem
    --       conferir o status do pedido, esta pista so e segura porque a foto com zero tentativas e
    --       vaga = id de PIX prova que NUNCA houve POST de cartao nesse pedido.
    -- (b), (c) e (d) sao codigo de edge function e NAO sao provados pelo banco. Se um dia surgir
    -- adocao de PIX pelo webhook, ou cartao no pedido cancelado, esta pista precisa ser revista.
    --
    -- Estado A (vaga ainda com o id do PIX e zero tentativas): fica nas 24 h. Um PIX pago tarde
    -- nessa janela vira pago_apos_expirar; devolver o cupom ali seria cupom em dobro.
    SELECT CASE
        WHEN p_coupon_id IS NULL THEN 'infinity'::timestamptz
        WHEN p_status IS DISTINCT FROM 'cancelled' THEN 'infinity'::timestamptz
        WHEN p_payment_status IN ('pago', 'pago_apos_expirar') THEN 'infinity'::timestamptz
        WHEN p_coupon_usage_returned IS DISTINCT FROM false THEN 'infinity'::timestamptz
        WHEN (p_cancelled_after_shipping = false OR p_returned_to_seller_at IS NOT NULL) IS NOT TRUE THEN 'infinity'::timestamptz
        WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz
        WHEN p_gateway_payment_id IS NULL AND p_tentativas = 0 THEN p_expires_at + interval '45 minutes'
        WHEN p_gateway_payment_id IS NULL
         AND p_tentativas = 1
         AND p_payment_status = 'aguardando'
         AND p_foto_gateway IS NOT NULL
         AND (p_foto_gateway LIKE 'verificando:%') IS NOT TRUE
         AND p_foto_tentativas = 0
         AND p_foto_metodo = 'pix'
         AND p_foto_payment_status = 'aguardando'
        THEN p_expires_at
        ELSE p_expires_at + interval '24 hours'
    END
$function$;

REVOKE ALL ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text) IS 'Cupom preso (20261205000000, pista rapida em 20261206000000, pista do PIX anulado em 20261210000000): QUANDO a varredura devolver_cupons_de_pedidos_mortos() devolve a vaga do cupom de um pedido. -infinity = ja; infinity = nunca (nem vai); senao a hora. Pedido NUNCA cobrado devolve 45 min depois de expires_at. PIX ANULADO (foto da cobranca de pedido_cobranca_ao_cancelar com id de PIX, zero tentativas, metodo pix e aguardando; agora a vaga vazia, uma tentativa e aguardando) devolve em expires_at, o fim do prazo do PIX, nunca antes (o admin pode reativar o pedido). O resto, 24 h. A pista e segura porque, com a vaga vazia, confirmar_pagamento devolve divergente; isso depende de (a) so liberar_cobranca_do_pedido esvaziar a vaga, sempre com tentativas + 1, (b) o cartao nunca ir ao Mercado Pago sem ocupar a vaga, (c) o webhook so adotar cobranca para cartao, sem conferir o status do pedido, e (d) criar-pagamento recusar pedido cancelado (o neq so vale para PIX; para cartao seguram a reserva antes do POST, a reocupacao e a adocao); a foto com zero tentativas e vaga de PIX prova que nunca houve cartao. Se um dia surgir adocao de PIX pelo webhook, esta pista precisa ser revista. Parametros simples de proposito; sem EXECUTE para ninguem alem do dono e das funcoes SECURITY DEFINER que a chamam.';

CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_volta timestamptz;
    v_minutos integer;
BEGIN
    -- A hora mais proxima em que a varredura devolve uma vaga DESTE cupom, entre
    -- os pedidos do PROPRIO usuario da sessao. Quem decide se um pedido conta e
    -- o auxiliar (a mesma regra da varredura): 'infinity' = nunca. So conta o
    -- cupom que DEVOLVER UMA vaga destrava de verdade: com limite (a validacao
    -- trata NULL e 0 como ilimitado) e no limite exato (usage_count = usage_limit);
    -- limite rebaixado (usage_count > usage_limit) ou vaga ainda livre: nao presa.
    -- Sem sessao
    -- (auth.uid() NULL) e pedido de convidado (user_id NULL) `=` nunca casa: a
    -- resposta e a de "nao preso", igual a de cupom inexistente.
    -- 20261210000000: le tambem a foto da cobranca (LEFT JOIN pela chave primaria: UMA foto por
    -- pedido, ou nenhuma) para a pista do PIX anulado; a RPC so le o que o PROPRIO usuario da
    -- sessao tem, a foto so entra pelo pedido dele.
    SELECT min(public.cupom__vaga_volta_em(
               o.coupon_id, o.status, o.payment_status, o.coupon_usage_returned,
               o.expires_at, o.cancelled_after_shipping, o.returned_to_seller_at,
               o.gateway_payment_id, o.tentativas_de_pagamento,
               f.gateway_payment_id, f.tentativas, f.metodo_online, f.payment_status))
      INTO v_volta
      FROM public.marketplace_orders o
      LEFT JOIN public.pedido_cobranca_ao_cancelar f ON f.order_id = o.id
     WHERE o.user_id = (SELECT auth.uid())
       AND o.coupon_id IN (
           SELECT c.id FROM public.coupons c
            WHERE UPPER(c.code) = UPPER(p_code) AND c.active = true
              AND c.usage_limit > 0 AND c.usage_count = c.usage_limit);

    IF v_volta IS NULL OR v_volta = 'infinity'::timestamptz THEN
        RETURN jsonb_build_object('presa', false, 'volta_em_minutos', NULL);
    END IF;

    -- GREATEST ANTES de subtrair: '-infinity' (pedido sem expires_at) e hora ja
    -- vencida viram "agora"; so entao a diferenca e finita em PG15 e em PG17.
    v_volta := GREATEST(v_volta, now());
    -- Para CIMA (nunca prometer menos que o real) + os 15 min do ciclo do
    -- agendamento da varredura.
    v_minutos := ceil(extract(epoch FROM (v_volta - now())) / 60.0)::integer + 15;

    RETURN jsonb_build_object('presa', true, 'volta_em_minutos', v_minutos);
END;
$function$;

COMMENT ON FUNCTION public.vaga_do_cupom_presa(text) IS 'Cupom preso (20261205000000; le a foto da cobranca desde 20261210000000): so LEITURA. Diz ao checkout se a vaga do cupom p_code esta presa num pedido cancelado do PROPRIO usuario da sessao e em quantos minutos a varredura a devolve (teto: espera ate a hora, arredondada para cima, mais 15 min do ciclo; para o PIX anulado a hora e o fim do prazo do PIX). Cupom ilimitado, com limite rebaixado (mais usos que o limite) ou com vaga livre tambem: presa = false (devolver uma vaga nao o destrava). Pedido de outro usuario, de convidado, outro codigo, cupom inexistente ou inativo, pedido que a varredura nao devolve e chamada sem sessao: a MESMA resposta presa = false (nao vira sonda de codigo).';

CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver_cupons_mortos$
DECLARE
    v_pedido     RECORD;
    v_devolvidos integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED: mesma protecao de expirar_pedidos_vencidos --
    -- se dois ciclos deste cron se sobrepuserem, ou se confirmar_pagamento
    -- estiver processando o MESMO pedido neste instante (por exemplo, um
    -- pagamento tardio que acabou de chegar), quem perder a corrida pela
    -- linha pula e tenta de novo no proximo ciclo -- nunca decrementa duas
    -- vezes, nunca decrementa um pedido que acabou de ser pago.
    --
    -- coupon_id IS NOT NULL: so' pedido com cupom entra na varredura.
    --
    -- status = 'cancelled' AND payment_status IS DISTINCT FROM 'pago' AND
    -- payment_status IS DISTINCT FROM 'pago_apos_expirar': exatamente o
    -- conjunto dos quatro pontos de desfazimento que ANTES desta migration
    -- devolviam (ou reconsumiam) o uso do cupom -- ver o cabecalho desta
    -- migration para a prova de que este WHERE reproduz aquele conjunto sem
    -- deduzir nada alem do que confirmar_pagamento ja registra.
    --
    -- coupon_usage_returned = FALSE: o FATO registrado, nunca deduzido --
    -- e' isto que torna a operacao idempotente por construcao. Pedido
    -- pre-existente (criado antes desta migration) nasce FALSE pelo
    -- DEFAULT da coluna, e entra na varredura normalmente -- correto,
    -- porque nenhuma versao anterior desta migration jamais rodou em
    -- producao.
    --
    -- expires_at IS NULL OR expires_at < now() - interval '24 hours': o
    -- numero da casa (pagamentos_a_reconciliar, 20260808000100), a decisao
    -- do Gabriel de que "a vaga fica reservada enquanto o PIX estiver
    -- aberto". expires_at IS NULL NAO e' so residuo historico -- e' o
    -- caminho CORRENTE de todo pedido "na entrega" criado por
    -- create_marketplace_order_v23 (a via PADRAO do app, useOrders.ts:
    -- 1059-1061; a v24 so' entra com pagamento online): v23 nunca grava
    -- expires_at nem payment_status, entao NULL aqui significa "nunca
    -- houve PIX por este caminho" -- sem janela nenhuma para proteger.
    --
    -- cancelled_after_shipping = false OR returned_to_seller_at IS NOT
    -- NULL: acrescentada por esta migration (20260970000000) -- ver o
    -- comentario acima do CREATE. Sem ela, pedido cancelado-apos-envio sem
    -- o produto de volta liberava a vaga do cupom antes da hora.
    -- 20261206000000: o WHERE abaixo mudou. As condicoes que os comentarios acima
    -- descrevem (payment_status, expires_at + 24 h, cancelado depois do envio)
    -- agora moram em public.cupom__vaga_volta_em(), a MESMA regra, com UMA pista
    -- nova: pedido NUNCA cobrado volta mais cedo (ver o comentario dela). Ficam
    -- aqui so os filtros que o indice serve (coupon_id, status,
    -- coupon_usage_returned); o resto o auxiliar decide linha a linha.
    -- 20261210000000: a consulta tambem le a FOTO da cobranca do pedido
    -- (public.pedido_cobranca_ao_cancelar, 20261209000000), por LEFT JOIN pela chave
    -- primaria (UMA foto por pedido, ou nenhuma), e passa os 13 argumentos ao auxiliar:
    -- e' o que deixa o PIX anulado voltar no fim do prazo do PIX (ver a pista dele). O
    -- Postgres recusa FOR UPDATE simples com juncao externa; a trava e' FOR UPDATE OF o
    -- SKIP LOCKED: so a linha do pedido (a foto nao e' travada nem escrita), e os dois
    -- ciclos, o pagamento tardio e a liberacao concorrentes se comportam como antes.
    FOR v_pedido IN
        SELECT o.id
        FROM public.marketplace_orders o
        LEFT JOIN public.pedido_cobranca_ao_cancelar f ON f.order_id = o.id
        WHERE o.coupon_id IS NOT NULL
          AND o.status = 'cancelled'
          AND o.coupon_usage_returned = FALSE
          AND public.cupom__vaga_volta_em(
                o.coupon_id, o.status, o.payment_status, o.coupon_usage_returned, o.expires_at,
                o.cancelled_after_shipping, o.returned_to_seller_at,
                o.gateway_payment_id, o.tentativas_de_pagamento,
                f.gateway_payment_id, f.tentativas, f.metodo_online, f.payment_status) < now()
        FOR UPDATE OF o SKIP LOCKED
    LOOP
        PERFORM public.devolver_uso_cupom(v_pedido.id);

        UPDATE public.marketplace_orders
           SET coupon_usage_returned = TRUE
         WHERE id = v_pedido.id;

        v_devolvidos := v_devolvidos + 1;
    END LOOP;

    RETURN v_devolvidos;
END;
$devolver_cupons_mortos$;

COMMENT ON FUNCTION public.devolver_cupons_de_pedidos_mortos() IS
  'Unico lugar onde a vaga de um cupom volta depois que um pedido que o usou e desfeito (so a varredura devolve; o cancelamento nao). Quando a vaga volta quem decide e public.cupom__vaga_volta_em(): na hora para pedido sem expires_at, 45 min depois de expires_at para pedido NUNCA cobrado (sem id de cobranca e zero tentativas), em expires_at para o PIX ANULADO (a foto da cobranca de pedido_cobranca_ao_cancelar prova que nunca houve cartao e a vaga ja esvaziou), 24 h para o resto, e nunca para pedido pago, pago_apos_expirar, ja devolvido ou cancelado depois do envio sem o produto de volta. Nunca deduz "ja devolvido" do estado: le e grava o fato na coluna coupon_usage_returned. FOR UPDATE OF o SKIP LOCKED: dois ciclos nunca devolvem o mesmo pedido. Agendada via pg_cron a cada 15 minutos (20260901000000). Reescrita em 20261206000000 e em 20261210000000.';

DO $posvoo_20261210$
DECLARE
  r record;
  v_hash text;
  v_n integer;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)', '0790c1962b526725c377344208392bfb7f15b1de20b0056e5bbb3002e40aa020', '8a8be76b9afd31e4e2c41f7bf559c472fbf33891cc1a771ff9116452b18afd5a'),
        ('public.vaga_do_cupom_presa(text)', 'd752391f13d27a741c3401b20a375ef7a7952bda3dfb2f6c257b96f6128cc84d', '9c659b8c1b18a808719c908076e9ce8948c384dae788aa396c4059512b5c1001'),
        ('public.devolver_cupons_de_pedidos_mortos()', '0e3fffedbd871c372ad000393b9f3c1abcda64a5703735a00cd5173f98bb35ae', 'a0c8175ce56857e24fb7ebab37d18e45386f3711506f3906013ed73036c7f6ad')
      ) AS e(assinatura, hash_lf, hash_crlf)
  LOOP
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_lf, r.hash_crlf) THEN
      RAISE EXCEPTION 'POSVOO_20261210: % saiu da migration com o corpo (hash %) e nao com o esperado -- nada foi mantido.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cupom__vaga_volta_em';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261210: cupom__vaga_volta_em ficou com % sobrecargas (esperava 1, a de 13 parametros) -- nada foi mantido.', v_n;
  END IF;

  -- ACLs: o auxiliar sem EXECUTE para ninguem (recriado por DROP + CREATE, nasce com o padrao do
  -- Supabase); a RPC so para authenticated; a varredura fechada para PUBLIC, anon e authenticated.
  IF EXISTS (
    SELECT 1
      FROM pg_proc p,
           LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)')
       AND x.privilege_type = 'EXECUTE'
       AND (x.grantee = 0 OR x.grantee IN (
              SELECT ro.oid FROM pg_roles ro WHERE ro.rolname IN ('anon', 'authenticated', 'service_role')))
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261210: public.cupom__vaga_volta_em saiu com EXECUTE para PUBLIC, anon, authenticated ou service_role -- nada foi mantido.';
  END IF;
  IF NOT has_function_privilege('authenticated', to_regprocedure('public.vaga_do_cupom_presa(text)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.vaga_do_cupom_presa(text)'), 'EXECUTE')
     OR has_function_privilege('service_role', to_regprocedure('public.vaga_do_cupom_presa(text)'), 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_proc p,
              LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
        WHERE p.oid = to_regprocedure('public.vaga_do_cupom_presa(text)')
          AND x.privilege_type = 'EXECUTE' AND x.grantee = 0
     ) THEN
    RAISE EXCEPTION 'POSVOO_20261210: public.vaga_do_cupom_presa saiu com a permissao diferente da esperada (so authenticated executa) -- nada foi mantido.';
  END IF;
  IF has_function_privilege('anon', to_regprocedure('public.devolver_cupons_de_pedidos_mortos()'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.devolver_cupons_de_pedidos_mortos()'), 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_proc p,
              LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
        WHERE p.oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()')
          AND x.privilege_type = 'EXECUTE' AND x.grantee = 0
     ) THEN
    RAISE EXCEPTION 'POSVOO_20261210: public.devolver_cupons_de_pedidos_mortos saiu com a permissao diferente da esperada (fechada para PUBLIC, anon e authenticated) -- nada foi mantido.';
  END IF;
END
$posvoo_20261210$;

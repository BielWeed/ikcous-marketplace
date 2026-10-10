-- O AVISO DE COBRANÇA DUPLICADA SAI UMA VEZ, E QUEM CHEGA JUNTO ESPERA O
-- RESULTADO DA OUTRA ENTREGA (dinheiro: aviso ao admin; 02/10/2026) — reserva
-- com prazo ("lease") para o webhook
-- `webhook-mercadopago` não repetir o push "Cobrança de cartão duplicada?" a
-- cada entrega do Mercado Pago, sem gastar a vez quando o push não chega.
--
-- O DEFEITO MEDIDO (PGlite, SQL real + webhook REAL, W7, 02/10/2026): o push
-- "Cobrança de cartão duplicada?" (ramo `cartao_divergente` e ramo S5 da
-- adoção que perdeu a corrida, `webhook-mercadopago/index.ts`) não tem
-- trava de repetição. O webhook relê o estado ATUAL da order no MP, e o MP
-- manda uma notificação por atualização da order mais os reenvios até um
-- 2xx — três entregas da MESMA order aprovada divergente davam três pushes
-- iguais. Ruído, não dinheiro: a segunda cobrança continua sem registro POR
-- DESENHO (`confirmar_pagamento` devolve 'divergente') e o admin confere e
-- devolve no painel do MP.
--
-- O QUE A RESERVA NÃO PODE FAZER: calar um aviso de dinheiro que ainda não
-- chegou. Uma reserva definitiva ("reservou, acabou") calaria o aviso para
-- sempre quando o push falha depois da reserva (web push recusado, teto de
-- 5 s, nenhum admin inscrito, isolado morto). Por isso a reserva é um PRAZO,
-- e só vira definitiva quando alguém confirma que entregou.
--
-- LIMITES QUE CONTINUAM (já existiam antes desta migration) — a entrega do
-- aviso NÃO é garantida:
--   (1) a entrega dona da reserva cujo push não chega a ninguém libera a
--       reserva e responde 200; se o MP não mandar outra notificação dessa
--       order, ninguém tenta de novo;
--   (2) na falha aberta (a reserva deu erro), o push que não chega a ninguém
--       também não se repete nesta entrega — de novo, só outra notificação
--       do MP tenta outra vez.
-- A reserva evita a repetição e faz quem chega junto esperar o resultado da
-- outra entrega; ela não cria tentativa nova por conta própria.
--
-- O QUE MUDA:
--   1. `public.avisos_ao_lojista(chave, reservado_em, enviado)`: uma linha por
--      aviso. A chave que o webhook usa é
--      `cartao_divergente:<id do pedido>:<id da order no MP>` — a MESMA nos
--      dois ramos (S5 e divergente), porque é o mesmo fato e o mesmo texto de
--      push: o S5 numa entrega e o ramo divergente na reentrega seguinte não
--      viram dois avisos. Outra order aprovada no mesmo pedido (outro id) é
--      outra chave e avisa de novo.
--   2. `reservar_aviso_ao_lojista(p_chave) RETURNS text`, três estados:
--      'reservado' — a vaga é de quem chamou: a chave não existia (grava
--      `reservado_em = now()`, `enviado = false`) OU existia NÃO enviada com a
--      reserva de mais de 2 minutos (renova o prazo — cobre a edge que morreu
--      entre reservar e avisar);
--      'em_envio' — outra entrega tem a reserva fresca e ainda não confirmou;
--      'enviado' — o aviso já foi entregue.
--      A posse sai de um só comando (`INSERT ... ON CONFLICT DO UPDATE ...
--      WHERE`): duas entregas simultâneas da mesma chave dão exatamente um
--      'reservado' — a segunda espera a linha da primeira e reavalia o WHERE
--      na versão nova. Só quando NÃO pegou a vaga a função relê a linha para
--      separar 'em_envio' de 'enviado' (linha sumida entre os dois comandos —
--      a dona liberou — também devolve 'em_envio': quem chamou pergunta de
--      novo e pega). Quem recebe 'em_envio' NÃO supõe sucesso: a edge espera o
--      RESULTADO da dona ("singleflight") perguntando de novo algumas vezes, e
--      assume se a dona liberou. Chave nula ou vazia recusa com 22023 (o
--      webhook trata erro como "avisa mesmo assim").
--   3. `confirmar_aviso_ao_lojista(p_chave)`: `enviado = true`. A edge só
--      chama depois de o push chegar a pelo menos uma inscrição de admin. Não
--      confere "de quem" é a reserva: `enviado = true` só é gravado por quem
--      ENTREGOU, então ele nunca mente — no pior caso (dois prazos
--      sobrepostos) os dois entregam, e isso é repetição, não perda.
--   4. `liberar_aviso_ao_lojista(p_chave)`: apaga a reserva NÃO enviada. A
--      edge chama quando o push não chegou a ninguém (erro, nenhum admin
--      inscrito, nenhuma entrega). Por que apagar em vez de esperar o prazo:
--      o MP manda as notificações da mesma order em sequência curta
--      (created, processed, ...); esperar 2 minutos calaria justamente a
--      entrega seguinte, que é a próxima chance de avisar. Nunca apaga linha
--      enviada (`WHERE enviado = false`). Se a liberação falhar, o prazo de 2
--      minutos solta a chave sozinho.
--
-- OBJETOS NOVOS E ACL:
--   - `public.avisos_ao_lojista`: RLS ligada e nenhuma policy; REVOKE de
--     PUBLIC/anon/authenticated (tabela NOVA: não há grant de coluna para
--     perder). Só chave de aviso, horário e um booleano — nenhum dado de
--     dinheiro, de pedido além do id, ou de cliente.
--   - as três funções `(text)` (reservar devolve text, as outras boolean): SECURITY DEFINER, search_path
--     fixo, EXECUTE só para service_role (a edge do webhook).
--
-- DADOS EXISTENTES: nada é lido ou reescrito ao aplicar; a tabela nasce
-- vazia. Efeito: cada (pedido, order divergente) que ainda receber entrega
-- do MP depois da publicação avisa UMA vez a mais — a primeira entrega
-- depois da edge nova reserva a chave pela primeira vez.
--
-- IDEMPOTÊNCIA: `CREATE TABLE IF NOT EXISTS` só depois de o preflight provar
-- que a tabela existente (se existir) tem EXATAMENTE a forma desta
-- migration; `CREATE OR REPLACE FUNCTION`; REVOKE/GRANT/COMMENT
-- reaplicáveis. Reaplicar não apaga reserva nenhuma.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT — o `DO $preflight_20261191$` abaixo é o
-- PRIMEIRO comando e roda na MESMA transação do restante (recusa = nada
-- gravado). Recusa se:
--   (a) `avisos_ao_lojista` existir com forma DIFERENTE (colunas, tipos, NOT
--       NULL, defaults `now()`/`false`, PK em `chave`, nada além disso) — não
--       se confia em IF NOT EXISTS;
--   (b) existir qualquer uma das três funções que não seja a desta migration
--       (outra assinatura, outro retorno, ou o corpo com md5 diferente do
--       listado, por `md5(replace(prosrc, E'\r', ''))`).
-- Os hashes são o md5 REAL dos corpos, amarrados ao texto do arquivo por
-- tests/migration_aviso_de_cobranca_duplicada_sai_uma_vez_test.ts.
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES da edge `webhook-mercadopago`
-- nova. A edge antiga não chama as RPCs (avisa a cada entrega, como hoje). A
-- edge nova sem esta migration recebe erro da reserva e avisa a cada entrega
-- (falha aberta) — como antes desta migration, com os mesmos limites do
-- item (2) acima.
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml`, `migracoes =
-- 20261191000000_aviso_de_cobranca_duplicada_sai_uma_vez.sql` (prova
-- `BEGIN; <arquivo>; ROLLBACK;` antes do apply). Sem `BEGIN`/`COMMIT` de nível
-- superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO:
--   1. `to_regclass('public.avisos_ao_lojista')` não nulo, RLS ligada.
--   2. `has_function_privilege('authenticated',
--      'public.reservar_aviso_ao_lojista(text)', 'EXECUTE')` = false (idem
--      confirmar_ e liberar_).
--   3. Numa transação descartável: reservar 'verificacao' -> 'reservado';
--      reservar de novo -> 'em_envio'; liberar -> true; reservar ->
--      'reservado'; confirmar -> true; liberar -> false; reservar ->
--      'enviado'; `ROLLBACK`.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261191000000_aviso_de_cobranca_duplicada_sai_uma_vez.sql
-- apaga as três RPCs e a tabela (só chaves de aviso).

DO $preflight_20261191$
DECLARE
  v_colunas text;
  v_defaults text;
  v_constraints integer;
  v_pk boolean;
  v_nome text;
  v_hash text;
  v_retorno text;
  v_funcoes integer;
BEGIN
  IF to_regclass('public.avisos_ao_lojista') IS NOT NULL THEN
    SELECT string_agg(
             a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
               || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
             ', ' ORDER BY a.attnum)
      INTO v_colunas
      FROM pg_attribute a
     WHERE a.attrelid = 'public.avisos_ao_lojista'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped;

    SELECT string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ', ' ORDER BY a.attnum)
      INTO v_defaults
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = 'public.avisos_ao_lojista'::regclass;

    SELECT count(*) FILTER (WHERE c.contype IN ('p', 'f', 'u', 'c', 'x')),
           COALESCE(bool_or(c.contype = 'p' AND c.conkey = ARRAY[1]::int2[]), false)
      INTO v_constraints, v_pk
      FROM pg_constraint c
     WHERE c.conrelid = 'public.avisos_ao_lojista'::regclass;

    IF v_colunas IS DISTINCT FROM 'chave text NOT NULL, reservado_em timestamp with time zone NOT NULL, enviado boolean NOT NULL'
       OR v_defaults IS DISTINCT FROM 'reservado_em=now(), enviado=false'
       OR v_constraints <> 1 OR NOT v_pk THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.avisos_ao_lojista já existe com outra forma (colunas: %; defaults: %; constraints: %) — revise antes de aplicar.', v_colunas, v_defaults, v_constraints;
    END IF;
  END IF;

  FOR v_nome, v_hash, v_retorno IN
    SELECT f.nome, f.hash, f.retorno FROM (VALUES
      ('reservar_aviso_ao_lojista', '1aed7ca9e2c55d1ea61e9773367faf06', 'text'),
      ('confirmar_aviso_ao_lojista', '55de4b72c2b48ab960313961c56125fd', 'boolean'),
      ('liberar_aviso_ao_lojista', 'd505bca7be99fc5e74a76a47ccd2b796', 'boolean')
    ) AS f(nome, hash, retorno)
  LOOP
    SELECT count(*) INTO v_funcoes
      FROM pg_proc
     WHERE proname = v_nome
       AND pronamespace = 'public'::regnamespace;

    IF v_funcoes > 0 AND (
         v_funcoes <> 1
         OR (SELECT md5(replace(prosrc, E'\r', ''))
               FROM pg_proc
              WHERE oid = to_regprocedure('public.' || v_nome || '(text)'))
            IS DISTINCT FROM v_hash
         OR (SELECT pg_get_function_result(oid)
               FROM pg_proc
              WHERE oid = to_regprocedure('public.' || v_nome || '(text)'))
            IS DISTINCT FROM v_retorno
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% já existe com outra forma — revise antes de aplicar.', v_nome;
    END IF;
  END LOOP;
END $preflight_20261191$;

CREATE TABLE IF NOT EXISTS public.avisos_ao_lojista (
    chave text PRIMARY KEY,
    reservado_em timestamptz NOT NULL DEFAULT now(),
    enviado boolean NOT NULL DEFAULT false
);

ALTER TABLE public.avisos_ao_lojista ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.avisos_ao_lojista FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.avisos_ao_lojista IS
  'Avisos ao admin (20261191000000): uma linha por chave — hoje '
  'cartao_divergente:<pedido>:<order do MP>. enviado = false é uma reserva com '
  'prazo de 2 minutos; enviado = true é aviso entregue, que não se repete. '
  'Escrita só pelas RPCs reservar_/confirmar_/liberar_aviso_ao_lojista.';

CREATE OR REPLACE FUNCTION public.reservar_aviso_ao_lojista(p_chave text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $reservar$
DECLARE
    v_enviado boolean;
BEGIN
    IF p_chave IS NULL OR btrim(p_chave) = '' THEN
        RAISE EXCEPTION 'reservar_aviso_ao_lojista: chave vazia'
            USING ERRCODE = '22023';
    END IF;

    -- Chave nova: reserva. Chave existente: só renova se NÃO foi enviada e o
    -- prazo de 2 minutos venceu. Duas entregas simultâneas: a segunda espera
    -- a linha da primeira e reavalia o WHERE na versão nova (prazo renovado)
    -- — não reserva (FOUND = false).
    INSERT INTO public.avisos_ao_lojista AS a (chave, reservado_em, enviado)
    VALUES (p_chave, now(), false)
    ON CONFLICT (chave) DO UPDATE
       SET reservado_em = EXCLUDED.reservado_em
     WHERE a.enviado = false
       AND a.reservado_em < now() - interval '2 minutes';

    IF FOUND THEN
        RETURN 'reservado';
    END IF;

    -- Não pegou: separa "já entregue" de "outra entrega está enviando". Linha
    -- sumida entre os dois comandos (a dona liberou) cai em 'em_envio' — quem
    -- chamou pergunta de novo e pega a vaga.
    SELECT a.enviado INTO v_enviado
      FROM public.avisos_ao_lojista a
     WHERE a.chave = p_chave;

    IF v_enviado THEN
        RETURN 'enviado';
    END IF;
    RETURN 'em_envio';
END;
$reservar$;

CREATE OR REPLACE FUNCTION public.confirmar_aviso_ao_lojista(p_chave text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $confirmar$
BEGIN
    -- Só quem ENTREGOU o push chama: enviado = true nunca mente.
    UPDATE public.avisos_ao_lojista
       SET enviado = true
     WHERE chave = p_chave;

    RETURN FOUND;
END;
$confirmar$;

CREATE OR REPLACE FUNCTION public.liberar_aviso_ao_lojista(p_chave text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $liberar$
BEGIN
    -- Push que não chegou a ninguém: a próxima entrega do MP tenta de novo.
    -- Aviso já entregue nunca é apagado.
    DELETE FROM public.avisos_ao_lojista
     WHERE chave = p_chave
       AND enviado = false;

    RETURN FOUND;
END;
$liberar$;

REVOKE ALL ON FUNCTION public.reservar_aviso_ao_lojista(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirmar_aviso_ao_lojista(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.liberar_aviso_ao_lojista(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_aviso_ao_lojista(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_aviso_ao_lojista(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.liberar_aviso_ao_lojista(text) TO service_role;

COMMENT ON FUNCTION public.reservar_aviso_ao_lojista(text) IS
  'Reserva um aviso ao admin por 2 minutos (20261191000000): reservado se a '
  'chave é nova ou se a reserva anterior não foi enviada e venceu; em_envio se '
  'outra entrega está no prazo; enviado se já foi entregue. Só service role '
  '(edge webhook-mercadopago), que avisa mesmo assim se esta RPC falhar.';
COMMENT ON FUNCTION public.confirmar_aviso_ao_lojista(text) IS
  'Marca o aviso como entregue (20261191000000): chamada só depois de o push '
  'chegar a pelo menos uma inscrição de admin. Só service role.';
COMMENT ON FUNCTION public.liberar_aviso_ao_lojista(text) IS
  'Apaga a reserva NÃO enviada (20261191000000): o push não chegou a ninguém, '
  'a próxima entrega do MP tenta de novo. Nunca apaga aviso entregue. Só '
  'service role.';

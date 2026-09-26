-- O CPF DA JANELA SAI DO ENDEREÇO (migration de DADOS, 26/09/2026 — conserta
-- os pedidos gravados na janela do defeito entre a 20261171000000 e a
-- 20261172000000).
--
-- O DEFEITO, em uma frase: entre 23/09 e 26/09/2026 17:46 UTC, o front já
-- mandava o CPF dentro de `p_address_data` (`p_address_data.cpf`), mas o
-- banco ainda estava na 20261171000000 — a versão de `create_marketplace_
-- order_v23`/`v24` que grava `p_address_data` INTEIRO em
-- `customer_data.address`, sem tirar a chave `cpf` (a 20261172000000, que
-- ensinou as duas RPCs a tirar essa chave com `v_address_data_sem_cpf`, só
-- entrou DEPOIS). Todo pedido NACIONAL de cliente LOGADO criado nessa
-- janela nasceu com `customer_data.address = {"cpf": "..."}` (o front manda
-- só isso para quem tem conta — o endereço de quem está logado vem de
-- `p_address_id`, não de `p_address_data`) e SEM `customer_data.cpf`.
--
-- EFEITO MEDIDO (ver `src/lib/mappers.ts:228-257`, `addressSource`): um
-- objeto `{cpf}` é `typeof === "object"` e TRUTHY em JS, então VENCE o
-- endereço de verdade (`row.address`, o JOIN com `user_addresses`) na
-- cadeia `||` do mapper — o painel, o comprovante e "Meus pedidos" mostram
-- endereço de entrega EM BRANCO para todo pedido da janela. A etiqueta
-- (`melhor-envio-etiqueta`) pede CPF de novo porque `customer_data.cpf` não
-- existe. E o CPF, que é dado sensível, fica gravado no lugar ERRADO
-- (`address`, que várias telas espalham) em vez de `customer_data.cpf` (só
-- lido no servidor, e explicitamente removido do mapper — `semCpf`, linha
-- 244 — antes de qualquer cache de navegador).
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--
--   0. PREFLIGHT — recusa ANTES de tocar qualquer linha se
--      `create_marketplace_order_v23` OU `create_marketplace_order_v24` não
--      tiverem o splice da 20261172000000 (`v_address_data_sem_cpf` no
--      `prosrc`). Sem essa RPC nova, um pedido NOVO continua nascendo com o
--      mesmo formato defeituoso — mover o dado dos pedidos ANTIGOS sem
--      primeiro fechar a porta que os criou reabriria o mesmo buraco no
--      próximo pedido. Verifica pelo NOME de variável (marcador estável),
--      não por hash do corpo inteiro — a 20261172000000 já documentou o
--      preço de um preflight por hash byte a byte (linha 88-96 dela: hash
--      recalculado depende até de quebra de linha adjacente ao
--      `$function$`); aqui o corpo pode variar (rebase, migration futura
--      que toque a RPC) sem quebrar este preflight, desde que a variável
--      continue existindo.
--
--   1. `alvo` (CTE, `FOR UPDATE OF o`) — trava e seleciona todo pedido cujo
--      `customer_data->'address'` é um OBJETO com a chave `cpf`
--      (`jsonb_typeof(...) = 'object' AND (...) ? 'cpf'` — guarda contra
--      endereço não-objeto, string/array/número forjado). Extrai, por
--      linha: os DÍGITOS do CPF do endereço (`regexp_replace(...,'\D','',
--      'g')`, mesma limpeza da 20261172000000); se a RAIZ de `customer_data`
--      já tem uma chave `cpf` (lojista completou pelo formulário do
--      pedido — esse valor GANHA e nunca é sobrescrito); e a opção de frete
--      normalizada (`customer_data->>'shipping_option_id'`, com o MESMO
--      `NULLIF(btrim(...))` que a 20261172000000 aplica em `v_opcao` antes
--      de comparar contra `'local-delivery'`/`'store-pickup'` — sem a
--      normalização, um valor com espaço de sobra escaparia da comparação).
--
--   2. `validado` (CTE, em cima de `alvo`) — `cpf_ok`: os MESMOS três
--      testes da 20261172000000 (v24), na MESMA ordem, para o MESMO
--      resultado: 11 dígitos exatos; rejeita as onze sequências de dígito
--      repetido (`^(\d)\1{10}$` — passam na conta dos dois verificadores
--      mas nunca são CPF real); e os DOIS dígitos verificadores pelo
--      algoritmo da Receita Federal, módulo 11, com os MESMOS pesos
--      (`11-i` para o d10, `12-i` para o d11) que o corpo de `create_
--      marketplace_order_v24` calcula linha a linha — aqui reescritos como
--      expressão de conjunto (`array_agg`/`generate_series`) porque o SQL
--      de uma CTE não tem variável de sessão PL/pgSQL, mas a fórmula é a
--      MESMA, dígito a dígito.
--
--   3. `opcao_do_dono` (CTE, primeira do arquivo) — a opção do dono AINDA
--      NÃO DECIDIDA (ver "OPÇÃO DO DONO" abaixo): `false` por padrão. É a
--      ÚNICA constante que esta migration pede para trocar à mão.
--
--   4. O `UPDATE`: para TODO pedido em `alvo` (mesmo quando `cpf_ok` é
--      falso, mesmo em local-delivery/store-pickup), a chave `cpf` SEMPRE
--      sai do endereço — `v.endereco - 'cpf'`, e SQL `NULL` (não `'{}'`)
--      quando o que sobra é objeto vazio (exatamente o que a
--      20261172000000 grava hoje para pedido novo; `NULL` é `typeof ===
--      "object"` em JS também, mas FALSY, então o mapper cai para
--      `row.address` — `'{}'` venceria, FICARIA em branco de novo).
--      `customer_data.cpf` só nasce na RAIZ quando as QUATRO condições
--      valem ao mesmo tempo: a raiz ainda não tem `cpf`; `cpf_ok`; a opção
--      de frete não é `NULL` e não é `local-delivery`/`store-pickup`
--      (retirada e entrega local nunca exigem nem gravam CPF, mesma regra
--      da 20261172000000 — e `opcao IS NOT NULL` importa de verdade: em
--      `v24`, `v_opcao NOT IN (...)` com `v_opcao` `NULL` avalia para SQL
--      `NULL`, não `TRUE`, então um pedido sem opção de frete gravada NUNCA
--      grava CPF na v24 — replicado aqui com a MESMA checagem explícita);
--      e a opção do dono (item 3) não estiver bloqueando este caso
--      específico.
--
--   5. VERIFICAÇÃO FINAL — depois do `UPDATE`, conta quantos pedidos AINDA
--      têm a chave `cpf` dentro de `customer_data->'address'`. Maior que
--      zero levanta EXCEPTION (aborta a transação inteira — sem
--      `BEGIN`/`COMMIT` neste arquivo, quem abre a transação é
--      `scripts/db-apply.cjs`, e o `ROLLBACK` dele desfaz tudo).
--
-- OPÇÃO DO DONO — AINDA NÃO DECIDIDA (Gabriel), minimização de dado (LGPD):
-- para pedido CANCELADO OU EXPIRADO (`status = 'cancelled' OR payment_status
-- = 'expirado'`) SEM etiqueta gerada (`shipping_label_id IS NULL` — nunca
-- chegou perto de despachar, então o CPF nunca serviu para nada), existem
-- duas posturas possíveis:
--   • MOVER (padrão desta migration, `false` na CTE `opcao_do_dono`): trata
--     esses pedidos como qualquer outro — CPF válido de transportadora vai
--     para a raiz, do jeito que ficaria se o pedido nunca tivesse sido
--     cancelado/expirado. Mais simples, mais uniforme, não perde dado que
--     talvez ainda sirva para auditoria/histórico de fraude.
--   • APAGAR em vez de mover (`true`): pedido cancelado/expirado sem
--     etiqueta NUNCA recebe `customer_data.cpf` — o CPF só é REMOVIDO do
--     endereço, nunca persistido em lugar nenhum. Alinhado com minimização
--     de dado (um CPF que nunca chegou a virar etiqueta não precisa
--     continuar existindo no banco). Pedidos SEM essa condição continuam
--     seguindo a regra normal (item 4 acima).
-- A escolha muda UMA linha: o literal `false`/`true` da CTE
-- `opcao_do_dono`, logo no início do `WITH` abaixo — nenhuma outra parte do
-- arquivo precisa mudar para trocar de postura.
--
-- DADOS EXISTENTES: só as linhas de `public.marketplace_orders` cujo
-- `customer_data->'address'` é objeto com chave `cpf` são lidas e
-- reescritas — a `alvo` é o próprio portão. Nenhuma outra coluna
-- (`updated_at`, `status`, `payment_status`, `shipping_label_id` etc.) é
-- tocada; `shipping_label_id`/`status`/`payment_status` só são LIDOS (para
-- a opção do dono), nunca escritos.
--
-- IDEMPOTÊNCIA: reaplicar este arquivo dá ZERO linhas afetadas na segunda
-- vez — a `WHERE` da `alvo` exige a chave `cpf` DENTRO do endereço, e a
-- primeira rodada já a removeu de toda linha alcançada; não há necessidade
-- de guarda adicional, o próprio filtro é a idempotência.
--
-- FORA DO ESCOPO: qualquer pedido cujo `customer_data.address` já não seja
-- um objeto com `cpf` (a maioria, fora da janela do defeito); a RPC de
-- criação de pedido (já corrigida pela 20261172000000, pré-requisito
-- verificado pelo preflight); a decisão do dono sobre "mover vs apagar"
-- (implementada como toggle, não decidida — ver "OPÇÃO DO DONO"); aplicar
-- de verdade em qualquer banco (passo separado, com contagem prévia feita
-- por outra pessoa, e decisão do dono).
--
-- GATILHOS EM `marketplace_orders` — CONFERIDO NO CATÁLOGO DO ZERO (banco
-- efêmero, migrations aplicadas do zero até a 20261178000000; nenhuma
-- migration depois disso existe neste pacote): SOMENTE QUATRO
-- `CREATE TRIGGER ... ON public.marketplace_orders` em todo o histórico —
-- `tr_pedido_avisa_o_cliente` (`AFTER UPDATE OF status`, 20261026000000),
-- `tr_pagamento_avisa_o_cliente` (`AFTER UPDATE OF payment_status`,
-- 20261027000000), `tr_compra_verifica_avaliacoes` (`AFTER INSERT OR
-- UPDATE OF payment_status`, 20261030000000) e
-- `tr_marca_estorno_direto_do_pedido` (`BEFORE UPDATE OF payment_status`,
-- 20261176000000) — TODOS com lista de coluna (`UPDATE OF status` ou
-- `UPDATE OF payment_status`), NENHUM em `UPDATE` puro. O `UPDATE` desta
-- migration só toca `customer_data`; nenhum dos quatro dispara.
--
-- SEM BEGIN/COMMIT (regra da casa — com eles o ROLLBACK do script de prova
-- vira no-op e a mudança fica gravada mesmo em erro no meio do arquivo).
--
-- COMO APLICAR: `node scripts/db-apply.cjs
-- 20261182000000_o_cpf_da_janela_sai_do_endereco.sql` — sem BEGIN/COMMIT de
-- nível superior neste arquivo (regra da casa: quem abre a transação é o
-- script). Antes de aplicar em qualquer banco real, uma CONTAGEM prévia
-- (feita por outra pessoa, fora desta tarefa) confirma quantas linhas a
-- `alvo` alcança ali.
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco):
--   1. Nenhum pedido deveria sobrar com `cpf` dentro do endereço:
--      SELECT count(*) FROM public.marketplace_orders o
--       WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
--         AND (o.customer_data -> 'address') ? 'cpf';
--      -> espera 0 (a própria migration já garante isto na verificação
--      final, mas confirmar depois é barato).
--   2. Amostra de pedido nacional de cliente logado da janela do defeito
--      (23/09–26/09 17:46 UTC): `customer_data.address` não é mais um
--      objeto só com `cpf`, e `customer_data.cpf` (quando a opção não era
--      local/retirada e o CPF era válido) tem 11 dígitos.
--   3. Reaplicar o arquivo: `UPDATE 0`.
--
-- ROLLBACK: rollback-manual-20261182000000_o_cpf_da_janela_sai_do_endereco.sql
-- — DOCUMENTADO como NO-OP: devolver o CPF para dentro do endereço
-- RECRIARIA o defeito que esta migration existe para fechar (o painel, o
-- comprovante e "Meus pedidos" voltariam a mostrar endereço em branco). O
-- caminho de volta, se algum dia for necessário, é o BACKUP DIÁRIO (não há
-- PITR neste projeto) — não uma migration SQL.

DO $preflight_20261182$
DECLARE
  v_prosrc_v23 text;
  v_prosrc_v24 text;
BEGIN
  SELECT prosrc INTO v_prosrc_v23
    FROM pg_proc
   WHERE oid = to_regprocedure(
     'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)'
   );
  SELECT prosrc INTO v_prosrc_v24
    FROM pg_proc
   WHERE oid = to_regprocedure(
     'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)'
   );

  IF v_prosrc_v23 IS NULL OR v_prosrc_v23 !~ 'v_address_data_sem_cpf' THEN
    RAISE EXCEPTION 'PREFLIGHT_20261182: create_marketplace_order_v23 nao carrega o splice v_address_data_sem_cpf da 20261172000000 -- aplique a 20261172000000 (e a 20261174000000, que a recria) antes desta migration.';
  END IF;
  IF v_prosrc_v24 IS NULL OR v_prosrc_v24 !~ 'v_address_data_sem_cpf' THEN
    RAISE EXCEPTION 'PREFLIGHT_20261182: create_marketplace_order_v24 nao carrega o splice v_address_data_sem_cpf da 20261172000000 -- aplique a 20261172000000 (e a 20261174000000, que a recria) antes desta migration.';
  END IF;
END $preflight_20261182$;

WITH opcao_do_dono AS (
  -- 🔴 OPÇÃO DO DONO, ainda não decidida — ver cabeçalho ("OPÇÃO DO DONO").
  -- Troque SÓ este `false` por `true` para "apagar em vez de mover" no
  -- cancelado/expirado sem etiqueta. Nenhuma outra linha do arquivo muda.
  SELECT false AS apagar_em_vez_de_mover_cancelado_sem_etiqueta
),
alvo AS (
  SELECT
    o.id,
    o.status,
    o.payment_status,
    o.shipping_label_id,
    o.customer_data -> 'address' AS endereco,
    regexp_replace(COALESCE(o.customer_data -> 'address' ->> 'cpf', ''), '\D', '', 'g') AS digitos,
    (o.customer_data ? 'cpf') AS raiz_tem_cpf,
    NULLIF(btrim(COALESCE(o.customer_data ->> 'shipping_option_id', '')), '') AS opcao
  FROM public.marketplace_orders o
  WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
    AND (o.customer_data -> 'address') ? 'cpf'
  FOR UPDATE OF o
),
validado AS (
  SELECT
    a.*,
    od.apagar_em_vez_de_mover_cancelado_sem_etiqueta,
    -- cpf_ok: MESMA regra da 20261172000000 (v24) — 11 dígitos, sem
    -- sequência repetida, dois dígitos verificadores módulo 11 com os
    -- MESMOS pesos (11-i / 12-i).
    CASE
      WHEN length(a.digitos) <> 11 THEN false
      WHEN a.digitos ~ '^(\d)\1{10}$' THEN false
      ELSE (
        SELECT (dig.d[10] = (CASE WHEN sums.s1 < 2 THEN 0 ELSE 11 - sums.s1 END))
           AND (dig.d[11] = (CASE WHEN sums.s2 < 2 THEN 0 ELSE 11 - sums.s2 END))
          FROM (
            SELECT array_agg(substr(a.digitos, gs, 1)::int ORDER BY gs) AS d
              FROM generate_series(1, 11) AS gs
          ) dig
          CROSS JOIN LATERAL (
            SELECT
              (SELECT SUM(dig.d[i] * (11 - i)) FROM generate_series(1, 9) AS i) % 11 AS s1,
              (SELECT SUM(dig.d[i] * (12 - i)) FROM generate_series(1, 10) AS i) % 11 AS s2
          ) sums
      )
    END AS cpf_ok
  FROM alvo a
  CROSS JOIN opcao_do_dono od
)
UPDATE public.marketplace_orders o
   SET customer_data =
         jsonb_set(
           o.customer_data, '{address}',
           CASE WHEN (v.endereco - 'cpf') = '{}'::jsonb
                THEN 'null'::jsonb
                ELSE (v.endereco - 'cpf')
           END
         )
         || CASE
              WHEN NOT v.raiz_tem_cpf
                   AND v.cpf_ok
                   AND v.opcao IS NOT NULL
                   AND v.opcao NOT IN ('local-delivery', 'store-pickup')
                   AND NOT (
                     v.apagar_em_vez_de_mover_cancelado_sem_etiqueta
                     AND (v.status = 'cancelled' OR v.payment_status = 'expirado')
                     AND v.shipping_label_id IS NULL
                   )
              THEN jsonb_build_object('cpf', v.digitos)
              ELSE '{}'::jsonb
            END
  FROM validado v
 WHERE o.id = v.id;

DO $verificacao_final_20261182$
DECLARE
  v_restantes integer;
BEGIN
  SELECT count(*) INTO v_restantes
    FROM public.marketplace_orders o
   WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
     AND (o.customer_data -> 'address') ? 'cpf';
  IF v_restantes > 0 THEN
    RAISE EXCEPTION 'VERIFICACAO_FINAL_20261182: % pedido(s) ainda com a chave cpf dentro de customer_data.address depois da migration -- aborte e investigue antes de reaplicar.', v_restantes;
  END IF;
END $verificacao_final_20261182$;

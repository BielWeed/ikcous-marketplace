-- O CPF DA JANELA SAI DO ENDEREÇO (migration de DADOS, 26/09/2026 — conserta
-- os pedidos gravados na janela do defeito entre a 20261171000000 e a
-- 20261172000000). RODADA 2 e RODADA 3: achados (medium/low/info) da
-- revisão de risco — ver "RODADA 2"/"RODADA 3" nas seções abaixo para o
-- que mudou e por quê.
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
-- RODADA 2 — ATOMICIDADE (achado 4, robustez): esta migration inteira agora
-- é UM ÚNICO comando (`DO $migracao_20261182$ ... END $migracao_20261182$;`)
-- — preflight, mover-ou-apagar e verificação final moram no MESMO bloco
-- PL/pgSQL, em vez de 3 comandos de nível superior separados (2 `DO` + 1
-- `UPDATE`, como na rodada 1). Motivo: sob o protocolo simples (o que
-- `psql -1`/o `pg` do Node mandam quando o texto inteiro vira UMA mensagem),
-- múltiplos comandos SEM `BEGIN`/`COMMIT` explícito já rodam como uma
-- transação implícita única — mas nada GARANTE que toda ferramenta que
-- aplica migration manda o arquivo assim; uma Management API (ou um
-- `psql -f` sem `-1`, como provado nesta própria rodada) pode enviar cada
-- comando de nível superior em separado, autocommitando cada um se não
-- houver transação envolvente. Um ÚNICO comando elimina essa dependência de
-- protocolo: não existe "meio caminho" para enviar separado, porque só há
-- UM comando. PROVADO com um gatilho SABOTADOR (`BEFORE UPDATE`, sem lista
-- de coluna, só existe no banco de prova local, nunca em produção) que
-- reinjeta `{"cpf":"..."}` no endereço de UMA linha durante o `UPDATE`: a
-- verificação final agora RESULTA NO MESMO bloco, então o `RAISE EXCEPTION`
-- desfaz o `UPDATE` inteiro (inclusive as linhas que teriam sido limpas
-- corretamente) — ver relatório desta tarefa para a prova ao vivo.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM (tudo dentro do mesmo `DO`):
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
--      já tem um CPF DE VERDADE (RODADA 2, achado 5 — ver logo abaixo); e a
--      opção de frete normalizada (`customer_data->>'shipping_option_id'`,
--      com o MESMO `NULLIF(btrim(...))` que a 20261172000000 aplica em
--      `v_opcao` antes de comparar contra `'local-delivery'`/
--      `'store-pickup'` — sem a normalização, um valor com espaço de sobra
--      escaparia da comparação).
--
--      RODADA 2, ACHADO 5 (raiz_tem_cpf): a rodada 1 usava `customer_data ?
--      'cpf'` (a chave EXISTE) — `{"cpf": null}` ou `{"cpf": ""}` na raiz
--      contavam como "já tem CPF" e bloqueavam o move de um CPF válido do
--      endereço, mesmo a raiz não tendo CPF NENHUM de verdade (caso
--      SINTÉTICO, construído para provar o achado — nenhum caminho de
--      escrita hoje grava `cpf: null`/`""` na raiz; é defesa contra um
--      formato que pode aparecer por engano, não um bug já visto em
--      produção). Trocado para `NULLIF(btrim(o.customer_data->>'cpf'), '')
--      IS NOT NULL` — só conta como "tem CPF" quem tem TEXTO não-vazio
--      depois de aparar espaço.
--
--      RODADA 3, ACHADO 6 (correção de honestidade — NÃO é a régua da
--      edge): a rodada 2 dizia que esta é "a MESMA régua" que
--      `cpfDoDestinatario` (`supabase/functions/melhor-envio-etiqueta/
--      cpf.ts:50-57`) usa. É FALSO — `cpfDoDestinatario` exige um CPF
--      VÁLIDO (módulo 11 completo); devolve `null` para texto presente mas
--      inválido. `raiz_tem_cpf` aqui exige só TEXTO NÃO-VAZIO, válido ou
--      não. As duas divergem quando a raiz tem lixo (ex.: `cpf: "123"`):
--      `raiz_tem_cpf` diz "já tem CPF" (não move o válido do endereço, só
--      apaga), enquanto `cpfDoDestinatario` trataria esse mesmo valor como
--      AUSENTE. HOJE isso é só uma divergência LATENTE — nenhum caminho de
--      escrita real grava CPF inválido na raiz (o único escritor,
--      `definir_cpf_destinatario`, valida com `cpfValido` antes de gravar;
--      ver "CORRIDA PROVADA" abaixo) — mas é honesto registrar que não é a
--      mesma régua, não fingir que é.
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
--      MESMA, dígito a dígito. PROVADO ao vivo (RODADA 2, achado 2) contra
--      o BLOCO DE CPF EXTRAÍDO do `pg_proc.prosrc` da `create_marketplace_
--      order_v24` VIVA, sobre milhares de entradas (válidas, aleatórias,
--      DV1/DV2 errados, repetidas, formatadas, tamanho errado, tipos
--      malformados) — `tests/banco/cpf-da-janela-viva.cjs`, 0 divergências.
--
--   3. `opcao_do_dono` (CTE, primeira do arquivo) — a opção do dono AINDA
--      NÃO DECIDIDA (ver "OPÇÃO DO DONO" abaixo): `false` por padrão. É a
--      ÚNICA constante que esta migration pede para trocar à mão — trocar
--      só ela é o contrato; a suíte estática (`tests/migration_o_cpf_da_
--      janela_sai_do_endereco_test.ts`) testa que a linha existe como
--      booleano, não qual dos dois valores está escolhido agora (RODADA 2,
--      achado 6 — o teste da rodada 1 pinava `false` e quebraria se o dono
--      decidisse `true`, mesmo o cabeçalho prometendo "nenhuma outra linha
--      muda").
--
--   4. O `UPDATE`: para TODO pedido em `alvo` (mesmo quando `cpf_ok` é
--      falso, mesmo em local-delivery/store-pickup), a chave `cpf` SEMPRE
--      sai do endereço — `v.endereco - 'cpf'`, e JSON `null` (RODADA 2,
--      achado 7: era chamado de "SQL NULL" no cabeçalho da rodada 1, mas o
--      que se grava é o valor JSON `null` dentro do jsonb — não confundir
--      com o SQL NULL de três valores que a comparação `v_opcao NOT IN
--      (...)` produz, descrita duas frases abaixo, NESTE MESMO item)
--      quando o que sobra é objeto vazio (exatamente o que a 20261172000000
--      grava hoje para pedido novo; `null` é `typeof === "object"` em JS
--      também, mas FALSY, então o mapper cai para `row.address` — `'{}'`
--      venceria, FICARIA em branco de novo).
--      `customer_data.cpf` só nasce na RAIZ quando as CINCO condições
--      valem ao mesmo tempo: a raiz ainda não tem CPF de verdade (achado 5);
--      `cpf_ok`; a opção de frete não é `NULL` e não é `local-delivery`/
--      `store-pickup` (retirada e entrega local nunca exigem nem gravam CPF,
--      mesma regra da 20261172000000 — e `opcao IS NOT NULL` importa de
--      verdade: em `v24`, `v_opcao NOT IN (...)` com `v_opcao` `NULL` avalia
--      para SQL `NULL` de três valores, não `TRUE`, então um pedido sem
--      opção de frete gravada NUNCA grava CPF na v24 — replicado aqui com a
--      MESMA checagem explícita); e a opção do dono (item 3) não estiver
--      bloqueando este caso específico (ver "OPÇÃO DO DONO" — RODADA 2
--      acrescenta a exclusão de `pago_apos_expirar`).
--
--   5. VERIFICAÇÃO FINAL — depois do `UPDATE`, dentro do MESMO bloco (RODADA
--      2, achado 4), conta quantos pedidos AINDA têm a chave `cpf` dentro de
--      `customer_data->'address'`. Maior que zero levanta EXCEPTION — como
--      é o MESMO bloco PL/pgSQL do `UPDATE`, a exceção desfaz o `UPDATE`
--      INTEIRO (não só o registro sabotado), sem depender de transação
--      externa nenhuma.
--
-- OPÇÃO DO DONO — AINDA NÃO DECIDIDA (Gabriel), minimização de dado (LGPD):
-- para pedido CANCELADO OU EXPIRADO (`status = 'cancelled' OR payment_status
-- = 'expirado'`) SEM etiqueta gerada (`shipping_label_id IS NULL` — nunca
-- chegou perto de despachar, então o CPF nunca serviu para nada) E cujo
-- `payment_status` NÃO seja `'pago_apos_expirar'` (RODADA 2, achado 6 —
-- dinheiro que chegou DEPOIS do prazo: política P1 do dono é RECONHECER
-- esse pagamento e corrigir o pedido, então ele pode ser reativado e voltar
-- a precisar do CPF para a etiqueta; apagar fecharia essa porta), existem
-- duas posturas possíveis:
--   • MOVER (padrão desta migration, `false` na CTE `opcao_do_dono`): trata
--     esses pedidos como qualquer outro — CPF válido de transportadora vai
--     para a raiz, do jeito que ficaria se o pedido nunca tivesse sido
--     cancelado/expirado. Mais simples, mais uniforme, não perde dado que
--     talvez ainda sirva para auditoria/histórico de fraude.
--   • APAGAR em vez de mover (`true`): pedido cancelado/expirado (sem ser
--     `pago_apos_expirar`) e sem etiqueta NUNCA recebe `customer_data.cpf`
--     — o CPF só é REMOVIDO do endereço, nunca persistido em lugar nenhum.
--     Alinhado com minimização de dado. Pedidos SEM essa condição continuam
--     seguindo a regra normal (item 4 acima).
-- A escolha muda UMA linha: o literal `false`/`true` da CTE
-- `opcao_do_dono`, logo no início do `WITH` abaixo — nenhuma outra parte do
-- arquivo precisa mudar para trocar de postura.
--
-- RODADA 2, ACHADO 6 (por que `payment_status = 'expirado'` continua na
-- condição, mesmo sendo hoje redundante com `status = 'cancelled'`): os
-- DOIS únicos lugares que gravam `payment_status = 'expirado'` em todo o
-- histórico de migrations (20260807000000 e 20260901000000, a varredura de
-- expiração) SEMPRE gravam `status = 'cancelled'` na MESMA instrução — hoje,
-- para dado real, a cláusula `OR payment_status = 'expirado'` nunca muda o
-- resultado sozinha. Mantida mesmo assim, DE PROPÓSITO: não existe CHECK
-- nem trigger no schema que AMARRE os dois campos — nada impede um caminho
-- futuro de gravar `expirado` sem tocar `status` (ex.: uma reconciliação
-- que só atualiza o pagamento). Como este é o lado "apagar dado" da opção
-- (perigoso por definição — LGPD é sobre minimizar, não sobre garantir que
-- o dado errado nunca seja apagado), a cláusula redundante custa uma
-- comparação e evita depender de um acoplamento que só existe por
-- coincidência de implementação, não por contrato.
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
-- (implementada como toggle, não decidida — ver "OPÇÃO DO DONO"); o código
-- da edge `melhor-envio-etiqueta`/`definir_cpf_destinatario` que fecha a
-- corrida — já em produção (v9, 26/09 19:58) e trazido para esta árvore
-- pelo merge de `claude/pensive-mendel-b1fnuu`, mas não é parte desta
-- migration nenhuma linha dele (ver "CORRIDA COM definir_cpf_
-- destinatario"); aplicar de verdade em qualquer banco (passo separado, com
-- contagem prévia feita por outra pessoa, e decisão do dono).
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
-- migration só toca `customer_data`; nenhum dos quatro dispara. (O gatilho
-- SABOTADOR usado para provar a atomicidade do achado 4 é sintético, só do
-- banco de prova local, e nunca entra em migration nenhuma.)
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
-- CORRIDA COM `definir_cpf_destinatario` — FECHADA EM PRODUÇÃO (RODADA 4,
-- achado B; a RODADA 3 tinha corrigido a rodada 2, que dizia "não há
-- corrida provada", para "há corrida provada" — as duas frases valiam para
-- a edge de ENTÃO, que já não está mais no ar): provada contra a edge
-- ANTERIOR à rodada 4 de `fix/etiqueta-le-endereco-da-conta` (gravava o
-- `customer_data` LIDO de volta no banco, com `address.cpf` inclusive, se
-- a leitura tivesse acontecido antes desta migration limpar a linha). A
-- versão publicada em 26/09 19:58 (`melhor-envio-etiqueta` v9, do commit
-- `a65be476`; trazida para esta árvore pelo merge de
-- `claude/pensive-mendel-b1fnuu`, commit `860848ee`) tira `address.cpf`
-- de forma INCONDICIONAL na escrita — não importa o que a leitura tinha
-- visto, a chave nunca mais volta. Com ela em produção, a corrida NÃO
-- reabre o defeito (reprodução com o trecho verbatim da action: 0 pedidos
-- com `cpf` no endereço). A corrida só volta se a function for publicada a
-- partir de um commit ANTERIOR a esse fix — por isso a recomendação
-- abaixo (item 1) virou PRUDÊNCIA, não mais obrigação.
--
-- RECOMENDAÇÃO DO DIA DA APLICAÇÃO (revisão de risco, rodada 2, achado 8;
-- item 1 revisado na rodada 4, achado B, com a corrida fechada):
--   1. Evite salvar CPF no painel (`definir_cpf_destinatario`) durante a
--      aplicação, e refaça a contagem alguns minutos depois — barato, e
--      protege contra uma republicação da edge ANTIGA (antes do commit
--      `a65be476`, ver "CORRIDA COM definir_cpf_destinatario" acima); não
--      é mais obrigatório como nas rodadas 2 e 3, porque a versão hoje em
--      produção já fecha a corrida sozinha.
--   2. Se a CONTAGEM PRÉVIA (feita por outra pessoa, antes de aplicar)
--      mostrar QUALQUER pedido com `cpf` no endereço fora da janela
--      23–26/09/2026 17:46 UTC, PARE e investigue antes de aplicar — esta
--      migration só foi provada para o formato de defeito daquela janela
--      específica; um pedido fora dela é sintoma de OUTRA causa.
--   3. O lock que fecha a corrida da etiqueta (`melhor-envio-etiqueta`,
--      `definir_cpf_destinatario`) já está em produção (v9, 26/09 19:58,
--      trazido para esta árvore pelo merge de `claude/pensive-mendel-
--      b1fnuu`) — não é parte desta migration; citado aqui só para quem
--      for revisar o runbook de aplicação lado a lado.
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco):
--   1. Nenhum pedido deveria sobrar com `cpf` dentro do endereço:
--      SELECT count(*) FROM public.marketplace_orders o
--       WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
--         AND (o.customer_data -> 'address') ? 'cpf';
--      -> espera 0 (a própria migration já garante isto na verificação
--      final, mas confirmar depois é barato — e de novo alguns minutos
--      depois, ver RECOMENDAÇÃO DO DIA item 1).
--   2. Amostra de pedido nacional de cliente logado da janela do defeito
--      (23/09–26/09 17:46 UTC): `customer_data.address` não é mais um
--      objeto só com `cpf`, e `customer_data.cpf` (quando a opção não era
--      local/retirada e o CPF era válido) tem 11 dígitos.
--   3. Reaplicar o arquivo: 0 linhas afetadas.
--
-- ROLLBACK: rollback-manual-20261182000000_o_cpf_da_janela_sai_do_endereco.sql
-- — DOCUMENTADO como NO-OP: devolver o CPF para dentro do endereço
-- RECRIARIA o defeito que esta migration existe para fechar (o painel, o
-- comprovante e "Meus pedidos" voltariam a mostrar endereço em branco). O
-- caminho de volta, se algum dia for necessário, é o BACKUP DIÁRIO (não há
-- PITR neste projeto) — não uma migration SQL.

DO $migracao_20261182$
DECLARE
  v_prosrc_v23 text;
  v_prosrc_v24 text;
  v_restantes integer;
  v_linhas_afetadas integer;
BEGIN
  -- 0. PREFLIGHT ---------------------------------------------------------
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

  -- 1-4. MOVER (ou só apagar, conforme a opcao do dono) -------------------
  WITH opcao_do_dono AS (
    -- 🔴 OPÇÃO DO DONO, ainda não decidida — ver cabeçalho ("OPÇÃO DO
    -- DONO"). Troque SÓ este `false` por `true` para "apagar em vez de
    -- mover" no cancelado/expirado sem etiqueta. Nenhuma outra linha do
    -- arquivo muda.
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
      -- RODADA 2, achado 5: presença de CPF na raiz exige TEXTO NÃO-VAZIO —
      -- `{"cpf": null}` ou `{"cpf": ""}` NÃO contam como "já tem CPF" (NÃO é
      -- a régua de `cpfDoDestinatario`, que exige válido; ver RODADA 3,
      -- achado 6, no cabeçalho).
      (NULLIF(btrim(o.customer_data ->> 'cpf'), '') IS NOT NULL) AS raiz_tem_cpf,
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
      -- MESMOS pesos (11-i / 12-i). Provado ao vivo contra o prosrc real da
      -- v24 em tests/banco/cpf-da-janela-viva.cjs.
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
           -- RODADA 2, achado 6: `payment_status IS DISTINCT FROM
           -- 'pago_apos_expirar'` na condição abaixo -- dinheiro que chegou
           -- depois do prazo (P1) pode reativar o pedido, nunca só apagar.
           -- RODADA 3, achado 2: `payment_status IS NOT DISTINCT FROM
           -- 'expirado'` (não `= 'expirado'`) -- `status` é NOT NULL, mas
           -- `payment_status` não é; com `payment_status IS NULL` e `status
           -- <> 'cancelled'`, `payment_status = 'expirado'` dá SQL NULL (não
           -- `false`), e `false OR NULL` também é NULL -- o `NOT (...)` de
           -- fora vira NULL, o `WHEN` inteiro deixa de ser `TRUE` e cai no
           -- `ELSE` como se fosse "apagar". SÓ com a opção do dono LIGADA
           -- (`true`): com ela DESLIGADA, `v.apagar_em_vez_de_mover_...` já
           -- é `false`, e `false AND (qualquer coisa, mesmo NULL)` é
           -- SEMPRE `false` em SQL (nunca NULL) -- o `NOT (...)` dá `true`
           -- de qualquer forma, e o bug nunca aparece com o padrão de
           -- fábrica. `IS NOT DISTINCT FROM` nunca devolve NULL --
           -- `payment_status IS NULL` vira `false` aqui, e o resto da
           -- comparação booleana continua determinístico nos dois casos.
           || CASE
                WHEN NOT v.raiz_tem_cpf
                     AND v.cpf_ok
                     AND v.opcao IS NOT NULL
                     AND v.opcao NOT IN ('local-delivery', 'store-pickup')
                     AND NOT (
                       v.apagar_em_vez_de_mover_cancelado_sem_etiqueta
                       AND (v.status = 'cancelled' OR v.payment_status IS NOT DISTINCT FROM 'expirado')
                       AND v.payment_status IS DISTINCT FROM 'pago_apos_expirar'
                       AND v.shipping_label_id IS NULL
                     )
                THEN jsonb_build_object('cpf', v.digitos)
                ELSE '{}'::jsonb
              END
    FROM validado v
   WHERE o.id = v.id;
  -- `GET DIAGNOSTICS` tem de vir LOGO depois do UPDATE -- ROW_COUNT reflete
  -- o ÚLTIMO comando executado; se corresse depois do SELECT INTO da
  -- verificação final (linha abaixo), devolveria 1 (a contagem escalar),
  -- nunca as linhas do UPDATE.
  GET DIAGNOSTICS v_linhas_afetadas = ROW_COUNT;

  -- 5. VERIFICAÇÃO FINAL (mesmo bloco do UPDATE -- RODADA 2, achado 4) ----
  SELECT count(*) INTO v_restantes
    FROM public.marketplace_orders o
   WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
     AND (o.customer_data -> 'address') ? 'cpf';
  IF v_restantes > 0 THEN
    RAISE EXCEPTION 'VERIFICACAO_FINAL_20261182: % pedido(s) ainda com a chave cpf dentro de customer_data.address depois da migration -- aborte e investigue antes de reaplicar.', v_restantes;
  END IF;

  -- Visibilidade operacional (RODADA 2), DEPOIS da verificação final
  -- (RODADA 3, achado 5 -- na rodada 2 o NOTICE saía ANTES do IF, então
  -- mostrava uma contagem que a exceção logo desfazia junto com o UPDATE
  -- inteiro): só imprime se a migration realmente vingou -- o `RAISE
  -- EXCEPTION` acima interrompe o bloco antes de chegar aqui.
  -- ATENÇÃO PARA QUEM APLICA PELO WORKFLOW: a Management API do Supabase
  -- NÃO devolve `NOTICE` na resposta (eles vão para o log do Postgres, não
  -- para quem chamou) -- pelo `aplicar-migrations.yml`, a contagem
  -- confiável é a da CONTAGEM PRÉVIA (script `3a-cpf-no-endereco.sql`,
  -- rodada por outra pessoa ANTES de aplicar), não este NOTICE. Rodando por
  -- `psql`/`db-apply.cjs` local, o NOTICE aparece no terminal normalmente.
  RAISE NOTICE '20261182: % pedido(s) tiveram customer_data reescrito nesta aplicação.', v_linhas_afetadas;
END $migracao_20261182$;

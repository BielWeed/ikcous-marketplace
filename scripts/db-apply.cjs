#!/usr/bin/env node
/**
 * Aplica migrations específicas no banco Supabase, uma por uma.
 *
 * POR QUE ISTO EXISTE, em vez de `supabase db push`:
 * o histórico deste projeto está fora de sincronia — em 29/07/2026 havia ~50
 * migrations locais nunca aplicadas e ~25 migrations no banco sem arquivo local
 * (aplicadas por fora, provavelmente pelo SQL Editor). Um `db push` tentaria
 * replayar as ~50 pendentes em cima de um banco que já divergiu, reescrevendo
 * políticas RLS e substituindo funções numa loja no ar. Aqui você escolhe
 * explicitamente o que aplicar.
 *
 * O QUE ELE FAZ, nesta ordem:
 *   1. Salva num arquivo a definição ATUAL de cada função que a migration toca,
 *      para servir de rollback. ATENÇÃO AO ALCANCE: é só isso que ele salva.
 *      ADD COLUMN, CREATE INDEX, constraint e qualquer UPDATE/INSERT/DELETE da
 *      migration NÃO entram no rollback e continuam sendo desfeitos à mão. O
 *      cabeçalho do arquivo gerado diz isso, e grita quando o arquivo sai sem
 *      nenhuma instrução.
 *   2. Aplica cada migration numa transação própria. Se falhar, faz ROLLBACK e para.
 *   3. Registra a versão em supabase_migrations.schema_migrations.
 *   4. Reexecuta uma verificação: confere se os marcadores esperados estão mesmo
 *      na função que ficou no banco. O veredito final é UM de três estados,
 *      nunca dois — o código de saída distingue os três:
 *        - VERIFICADO (saída 0): toda migration teve ao menos um marcador
 *          conferido, e todos apareceram.
 *        - PULADA (saída 2): alguma migration ficou SEM NENHUM marcador
 *          conferido — seja por não ter entrada em VERIFICACOES, seja por
 *          ter entrada com `esperado` vazio. Isto NÃO é sucesso: é "ninguém
 *          verificou". Migration que só faz ALTER TABLE, policy ou grant cai
 *          sempre aqui, porque o script só sabe conferir marcador dentro de
 *          corpo de função (pg_get_functiondef).
 *        - FALHOU (saída 1): algum marcador esperado não apareceu na função
 *          que ficou no banco.
 *
 * USO:
 *   node scripts/db-apply.cjs <arquivo.sql> [outro.sql ...]
 *   node scripts/db-apply.cjs --dry-run <arquivo.sql>    # só mostra o plano
 *
 * EXEMPLO:
 *   node scripts/db-apply.cjs \
 *     20260729000000_fix_free_shipping_rule_parity.sql \
 *     20260729000001_fix_upsert_store_config_partial.sql
 *
 * A conexão sai de DATABASE_URL (variável de ambiente ou .env do projeto).
 * Requer o pacote `pg`:  npm i -D pg
 */

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");

/**
 * O `pg` é carregado só na hora de conectar, e não no topo, para que
 * `montarRollback` possa ser importado por um teste sem exigir node_modules
 * (a suíte deste projeto roda em Deno, sem `npm ci`).
 */
function carregarClient() {
  try {
    return require("pg").Client;
  } catch {
    console.error(
      "Pacote 'pg' não encontrado. Instale uma vez com:\n\n  npm i -D pg\n",
    );
    process.exit(1);
  }
}

/** Marcadores que devem existir na função depois de aplicada. */
const VERIFICACOES = {
  "20260729000000_fix_free_shipping_rule_parity.sql": {
    funcao: "create_marketplace_order_v22",
    esperado: [
      "v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min",
      "NULLIF(v_store_config.free_shipping_min, 0)",
      "Os valores do pedido mudaram",
    ],
  },
  "20260729000001_fix_upsert_store_config_partial.sql": {
    funcao: "upsert_store_config",
    esperado: [
      "config_json ? 'logo_url'",
      "config_json ? 'whatsapp_number'",
      "ELSE store_config.primary_color END",
    ],
  },
  "20260804000000_add_is_admin_guard_to_category_analytics.sql": {
    funcao: "get_category_analytics",
    esperado: [
      // A guarda em si (BANCO-020).
      "IF NOT public.is_admin() THEN",
      "Acesso negado: privilégios de administrador necessários.",
      // O corpo da consulta tem de sobreviver ao REPLACE: se a linha de Frete
      // sumir, o dashboard perde o bloco de faturamento por frete em silêncio.
      "'Frete'::text as name",
    ],
  },
  "20260804010000_fix_order_owner_check_null_safety.sql": {
    funcao: "update_order_status_atomic",
    esperado: [
      // Defesa em profundidade: hoje `anon` nao tem EXECUTE nesta funcao, entao
      // o unico caso que esta linha pega e token expirado (PEDIDO-010).
      "IF v_caller_id IS NULL THEN",
      // A comparação à prova de NULL na checagem de dono — é ela que fecha o furo.
      "v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin",
      // A restauração de estoque tem de sobreviver ao REPLACE: sem ela o
      // cancelamento deixaria de devolver o produto para a prateleira.
      "SET estoque = estoque + v_item.quantity",
    ],
  },
  "20260805120000_otp_aponta_para_o_projeto_certo.sql": {
    funcao: "handle_new_otp_verification",
    esperado: [
      // O destino certo. Entre 08/07 e 05/08/2026 o corpo vivo apontava para
      // jvgyjlbjhbfrncwbytls, onde send-otp-email nao existe — 404 silencioso.
      "https://cafkrminfnokvgjqtkle.functions.supabase.co/send-otp-email",
      // A credencial vem do Vault. Se esta linha sumir, voltou o caminho por
      // app_settings/header, que manda a chave anon e leva 401.
      "FROM vault.decrypted_secrets",
      "WHERE name = 'otp_trigger_secret'",
      // Sem segredo a funcao falha em vez de gravar um OTP que nao seria
      // entregue. E o PEDIDO-080 visto pelo lado do banco.
      "RAISE EXCEPTION USING",
    ],
  },
  "20260807000000_reserva_com_expiracao.sql": [
    {
      funcao: "devolver_estoque",
      esperado: [
        // Guarda do IF/ELSE (variante XOR produto), nao dois IF independentes.
        // Se alguem trocar por dois IF, este ELSE colado no UPDATE de produtos
        // deixa de existir no corpo, e a verificacao reprova. E essa a regra
        // que evita creditar variante E produto pai a cada expiracao.
        "ELSE\n            UPDATE public.produtos",
        "SET stock_increment = stock_increment + v_item.quantity",
      ],
    },
    {
      funcao: "expirar_pedidos_vencidos",
      esperado: [
        // So varre pedido 'aguardando': sem este filtro, a funcao passaria a
        // cancelar pedido ja pago ou historico (payment_status NULL).
        "WHERE payment_status = 'aguardando'",
        // So varre pedido 'pending': sem este filtro, um pedido que o
        // cliente ja cancelou pelo app (a update_order_status_atomic devolve
        // o estoque no cancelamento e nao escreve payment_status) seria
        // creditado uma segunda vez pela varredura.
        "AND status = 'pending'",
        // FOR UPDATE SKIP LOCKED: sem ele, a varredura disputa a linha com o
        // webhook da Fase 3 em vez de pular o pedido que ja esta sendo
        // confirmado — e pode expirar um pedido que acabou de ser pago.
        "FOR UPDATE SKIP LOCKED",
      ],
    },
    {
      funcao: "create_marketplace_order_v24",
      esperado: [
        // O carimbo desta task: sem ele o pedido nasce sem prazo e a
        // varredura nunca o alcanca.
        "'aguardando', now() + interval '30 minutes'",
        // Recalculo do total pelos precos do banco (Price Tampering
        // Protection da v23). Se um REPLACE mal copiado apagar esta linha, o
        // cliente volta a poder mandar o proprio total — e a verificacao tem
        // de gritar em vez de deixar passar em silencio.
        "IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN",
        // Checagem de estoque contra o valor do banco (nao o do cliente).
        // Mesma logica: sem esta linha o pedido pode vender o que nao tem.
        "IF v_db_stock < v_quantity THEN",
        // Paridade de frete gratis para usuario logado (a correcao da
        // 20260729000000_fix_free_shipping_rule_parity.sql, hoje guardada
        // pela entrada da v22 acima). Quando a Task 6 apontar o front para a
        // v24, e esta linha que passa a ser a guarda que importa — sem
        // marcador aqui, um REPLACE mal copiado da v24 poderia perder o
        // predicado e ninguem notaria, porque a entrada da v22 continuaria
        // passando para uma funcao que ninguem mais chama.
        "OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)",
      ],
    },
  ],
  "20260808000000_confirmar_pagamento.sql": [
    {
      funcao: "confirmar_pagamento",
      esperado: [
        // FOR UPDATE sem SKIP LOCKED: e' o que faz o webhook ESPERAR a
        // varredura em vez de pular a linha. Trocado por SKIP LOCKED, o
        // pagamento fica sem registro e o teste nao pega.
        "FOR UPDATE;",
        // A releitura que decide. Sem ela volta o UPDATE cego que produz
        // pedido 'pago' com status 'cancelled' pela rota da EXPIRACAO (a
        // varredura ja marcou 'expirado' antes do webhook chegar). A mesma
        // combinacao pela rota do CANCELAMENTO NO APP e' o que a guarda
        // "IF v_pedido.status = 'cancelled' THEN" logo abaixo, dentro do
        // ramo 'aguardando', previne — ver 20260810000000_confirmar_
        // pagamento_guarda_status.sql.
        "IF v_pedido.payment_status = 'expirado' THEN",
        "RETURN 'pago_apos_expirar';",
        // A guarda que impede credito de estoque em dobro.
        "IF v_pedido.payment_status <> 'aguardando' THEN",
      ],
    },
  ],
  "20260808000100_reconciliacao.sql": [
    {
      funcao: "pagamentos_a_reconciliar",
      esperado: [
        // Sem isto a varredura revisita pedido ja reconciliado a cada ciclo.
        "AND paid_at IS NULL",
        // A janela. Sem ela vira varredura do historico inteiro a cada 10 min.
        "interval '24 hours'",
        // So quem chegou a ter cobranca no MP.
        "AND gateway_payment_id IS NOT NULL",
        // DESC, nao ASC: sem isto o LIMIT 100 sempre escolhe os candidatos
        // mais velhos (menos capazes de ainda mudar de estado) em vez dos
        // que expiraram ha pouco (unicos com chance real de terem sido
        // pagos). Achado da revisao do PR #179 (Item 3).
        "ORDER BY expires_at DESC",
      ],
    },
  ],
  "20260810000000_confirmar_pagamento_guarda_status.sql": [
    {
      funcao: "confirmar_pagamento",
      esperado: [
        // A guarda que faltava (Item 1 do achado bloqueante do PR #179): sem
        // ela, pedido cancelado pelo app com PIX pago depois virava 'pago'
        // com status 'cancelled' — dinheiro recebido, estoque ja revendivel,
        // sem sinal de atencao no admin.
        //
        // Marcador e' o BLOCO INTEIRO, nao as duas linhas soltas de antes.
        // "IF v_pedido.status = 'cancelled' THEN" e "SET payment_status =
        // 'pago_apos_expirar'," JA EXISTEM, separados, em outros pontos desta
        // mesma funcao (ramo do estorno e ramo do 'expirado') — provado
        // contra uma versao SEM esta guarda: os dois marcadores soltos davam
        // "ok" mesmo faltando exatamente o trecho que esta migration
        // acrescenta. So o bloco junto, nesta ordem, prova que a guarda nova
        // esta no lugar certo.
        `IF v_pedido.status = 'cancelled' THEN
                UPDATE public.marketplace_orders
                   SET payment_status = 'pago_apos_expirar',
                       paid_at        = now(),
                       updated_at     = now()
                 WHERE id = p_order_id;
                RETURN 'pago_apos_expirar';
            END IF;`,
      ],
    },
  ],
  "20260812000000_reconciliar_pedido_cancelado.sql": [
    {
      funcao: "pagamentos_a_reconciliar",
      esperado: [
        // Mesmos quatro marcadores da entrada de
        // "20260808000100_reconciliacao.sql" acima, exigidos de novo pelo
        // Item 3 do achado da revisao do PR #179 sobre esta mesma funcao:
        // sem isto a varredura revisita pedido ja reconciliado a cada ciclo.
        "AND paid_at IS NULL",
        // A janela. Sem ela vira varredura do historico inteiro a cada 10 min.
        "interval '24 hours'",
        // So quem chegou a ter cobranca no MP. SEM o "AND" da entrada
        // vizinha: esta migration reordenou o WHERE e colocou esta condicao
        // primeiro — provado contra a definicao viva (ver relatorio da
        // tarefa); com "AND" na frente o marcador nunca casa e a
        // verificacao reprova a propria migration correta.
        "gateway_payment_id IS NOT NULL",
        // DESC, nao ASC: mesmo raciocinio da entrada de 20260808000100 acima
        // — sem isto o LIMIT 100 favorece sempre os candidatos mais velhos.
        "ORDER BY expires_at DESC",
        // O ramo novo do issue #180: sem ele, o pedido cancelado pelo app
        // (update_order_status_atomic devolveu o estoque e nao escreveu
        // payment_status) cujo PIX foi pago mesmo assim nunca entra na fila
        // de reconciliacao — dinheiro parado no MP, zero sinal de atencao.
        "OR (payment_status = 'aguardando' AND status = 'cancelled')",
      ],
    },
  ],
  "20260819000000_identidade_da_loja.sql": {
    funcao: "upsert_store_config",
    esperado: [
      // As tres colunas novas nos DOIS ramos. No INSERT elas entram cruas
      // (sem COALESCE, de proposito: nulo e "a loja ainda nao disse")...
      "config_json->>'store_name'",
      "config_json->>'store_city'",
      "config_json->>'store_state'",
      // ...e no ON CONFLICT seguem o padrao de escrita parcial do PR #225:
      // chave ausente no payload preserva o que ja estava gravado. Sem estes
      // tres, salvar QUALQUER campo da tela de Ajustes apagaria nome, cidade
      // e estado da loja.
      "ELSE store_config.store_name END",
      "ELSE store_config.store_city END",
      "ELSE store_config.store_state END",
      // A guarda de admin tem de sobreviver ao CREATE OR REPLACE: esta funcao
      // e SECURITY DEFINER, e sem esta linha qualquer autenticado reconfigura
      // a loja inteira.
      "IF NOT public.is_admin() THEN",
    ],
  },
  "20260820000000_otp_v2_devolve_o_codigo.sql": {
    funcao: "generate_order_otp_v2",
    esperado: [
      // O retorno estruturado, que e a UNICA razao de a v2 existir: sem ele,
      // quem envia o e-mail nao tem o codigo e a inversao inteira cai.
      "'otp_code', v_otp",
      // O freio de cota. Sem ele, um laco esgota as ~100 mensagens diarias da
      // conta de Gmail da loja e ai NENHUM cliente recebe codigo no resto do dia.
      "INTERVAL '60 seconds'",
      // A regra dos dois canais (AUTH-010 #118) tem de sobreviver ao REPLACE:
      // era um OR aqui que deixava o WhatsApp sozinho abrir o fluxo com o
      // e-mail de outra pessoa.
      "coalesce(trim(p_whatsapp), '') = ''",
      // O alfabeto do fragmento. Sem ele, um `%` digitado no campo volta a
      // funcionar como curinga e o codigo sai amarrado a um pedido qualquer.
      "^[0-9a-fA-F-]{6,}$",
    ],
  },
  "20260821000200_cupom_sem_limite_e_ilimitado.sql": [
    {
      funcao: "create_marketplace_order_v23",
      esperado: [
        // A correcao em si: limite 0 (e negativo) volta a significar ilimitado,
        // a mesma regra da validate_coupon_secure_v2 e do "0 = Ilimitado" que o
        // painel promete. Sem ela, o cliente aplica o desconto no checkout e
        // leva "Cupom invalido ou expirado" ao finalizar.
        "usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit",
        // A trava contra dois pedidos gastarem a ultima unidade do cupom ao
        // mesmo tempo. Ela mora na MESMA consulta que a correcao mexeu.
        "FOR UPDATE;",
        // O resto do caminho do dinheiro tem de sobreviver ao REPLACE: esta
        // migration reescreve a funcao inteira.
        "Os valores do pedido mudaram",
        "Estoque insuficiente para o produto",
        "UPDATE public.coupons SET usage_count = usage_count + 1",
      ],
    },
    {
      funcao: "create_marketplace_order_v24",
      esperado: [
        "usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit",
        "FOR UPDATE;",
        "Os valores do pedido mudaram",
        "UPDATE public.coupons SET usage_count = usage_count + 1",
        // A UNICA coisa que separa a v24 da v23: a reserva com prazo do
        // pagamento online. Se sumir no REPLACE, o pedido de PIX deixa de
        // expirar e o pg_cron nunca devolve o estoque.
        "'aguardando', now() + interval '30 minutes'",
      ],
    },
  ],
  "20260822000100_analitico_conta_so_dinheiro_reconhecido.sql": [
    {
      funcao: "get_admin_analytics_v2",
      esperado: [
        // A correcao em si, no agregado que mais dói: "Receita Hoje" somava
        // todo pedido nao cancelado, SEM olhar pagamento. Medido: em
        // 11/08/2026 o cartao teria mostrado R$ 214,40 num dia de receita
        // real R$ 0,00 (os 6 pedidos expiraram sem pagamento).
        //
        // Marcador e' o BLOCO INTEIRO, nao a linha do predicado sozinha: o
        // predicado aparece 9 vezes nesta funcao, entao um marcador solto
        // daria "ok" mesmo se ele tivesse caido fora de today_revenue. So o
        // bloco junto prova que ele esta NESTE agregado.
        `    WHERE created_at >= date_trunc('day', now())
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'));`,
        // As CTEs de rev_history e o top_prods usam o alias `o.` — sem este
        // marcador, o grafico e a lista de mais vendidos podiam ficar com a
        // regra velha enquanto os cartoes ficavam com a nova, e as duas
        // telas passariam a discordar entre si.
        "AND (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))",
        // A guarda contra o predicado VAZAR para onde nao devia:
        // today_pending conta trabalho a fazer, nao dinheiro. Se a regra
        // entrasse aqui, "Acoes Pendentes" pararia de mostrar o pedido que
        // ainda nao foi pago — que e' justamente o que precisa de acao.
        `    SELECT COUNT(*) INTO today_pending
    FROM public.marketplace_orders
    WHERE status in ('pending', 'new', 'processing');`,
        // Os dois campos novos que o front consome. Sem eles o cartao
        // "Total Concluido" mostra travessao e o aviso de dinheiro preso
        // simplesmente NAO APARECE — e ausencia de aviso e' indistinguivel
        // de "esta tudo certo".
        "'deliveredTotal', delivered_total,",
        "'paidOnCancelled', paid_on_cancelled",
        // O contador tem de cobrir as DUAS portas: o cliente que paga o PIX
        // fora do prazo ('pago_apos_expirar') E o pedido ja pago que o admin
        // cancela pelo painel ('pago'). A segunda abre com um clique.
        `    WHERE payment_status IN ('pago', 'pago_apos_expirar') AND status = 'cancelled';`,
        // O resto do caminho tem de sobreviver ao REPLACE: esta migration
        // reescreve a funcao inteira. Sem a guarda, uma funcao SECURITY
        // DEFINER passa a entregar o financeiro da loja para qualquer
        // usuario autenticado.
        "IF NOT public.is_admin() THEN",
      ],
    },
  ],
  "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql": [
    // ⚠️ Rodada 4 (redesenho subtrativo): reconsumir_uso_cupom DEIXA DE
    // EXISTIR (DROP FUNCTION) e a coluna nova coupon_usage_returned entra
    // por ALTER TABLE. Nenhum dos dois e' verificavel por este mapa: DROP
    // nao tem "depois" para ler via pg_get_functiondef (a funcao some, e
    // buscar marcador dentro de uma definicao que nao existe so' devolveria
    // AUSENTE para tudo, mesmo com o DROP correto), e ALTER TABLE nao
    // redefine funcao nenhuma. Confira os dois A MAO depois de aplicar:
    //   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    //    WHERE n.nspname = 'public' AND p.proname = 'reconsumir_uso_cupom';
    //   -- esperado: 0 linhas.
    //   SELECT column_default, is_nullable FROM information_schema.columns
    //    WHERE table_schema='public' AND table_name='marketplace_orders'
    //      AND column_name='coupon_usage_returned';
    //   -- esperado: column_default='false', is_nullable='NO'.
    {
      funcao: "devolver_uso_cupom",
      esperado: [
        // Sobrevive sem mudanca de comportamento nesta rodada -- so muda
        // quem chama (a varredura nova, abaixo).
        "SELECT coupon_id INTO v_coupon_id",
        "GREATEST(usage_count - 1, 0)",
      ],
    },
    {
      funcao: "expirar_pedidos_vencidos",
      esperado: [
        // As tres guardas ja existentes (20260807000000) tem de sobreviver
        // ao REPLACE: sem elas a varredura passaria a alcancar pedido pago,
        // historico ou ja cancelado por outro caminho.
        "WHERE payment_status = 'aguardando'",
        "AND status = 'pending'",
        "FOR UPDATE SKIP LOCKED",
        // A prova de que a chamada de devolver_uso_cupom SAIU deste ponto
        // (Rodada 4): bloco amarrado, nao linha solta -- se alguem
        // reinserisse "PERFORM public.devolver_uso_cupom(v_pedido.id);"
        // entre as duas linhas abaixo, esta string contigua deixaria de
        // casar. E o mesmo defeito que passou pelos sete marcadores soltos
        // da Rodada 3: o revisor apagou uma chamada e a verificacao nao
        // percebeu porque cada PERFORM era um marcador isolado.
        `PERFORM public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',`,
      ],
    },
    {
      funcao: "update_order_status_atomic",
      esperado: [
        // A guarda de dono a prova de NULL (20260804010000) tem de
        // sobreviver ao REPLACE.
        "v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin",
        "SET estoque = estoque + v_item.quantity",
        // Bloco amarrado: prova que a chamada de devolver_uso_cupom SAIU do
        // cancelamento manual (Rodada 4). Se ela voltasse entre o fim do
        // loop de estoque e o fechamento do IF, este marcador nao casaria.
        `END LOOP;

        -- A vaga do cupom NAO volta aqui (Rodada 4): ela so' volta na
        -- varredura devolver_cupons_de_pedidos_mortos(), depois que o PIX
        -- ja nao pode mais ser pago (expires_at + 24h). Devolver no momento
        -- do cancelamento e' exatamente o que abriu a janela das Rodadas 2 e
        -- 3 -- ver o cabecalho desta migration.
    END IF;`,
      ],
    },
    {
      funcao: "confirmar_pagamento",
      esperado: [
        // Guardas ja existentes (20260808000000/20260810000000) que tem de
        // sobreviver ao REPLACE.
        "FOR UPDATE;",
        "IF v_pedido.payment_status IN ('pago', 'pago_apos_expirar') THEN\n            RETURN 'ja_pago';",
        // Os quatro blocos amarrados abaixo provam que as chamadas de
        // devolver_uso_cupom/reconsumir_uso_cupom SAIRAM exatamente dos
        // quatro pontos que a Rodada 4 desmonta -- nao marcador solto: e'
        // a mesma falha da Rodada 3 (sete marcadores soltos passaram com uma
        // chamada apagada) que este formato existe para nao repetir.
        //
        // 1. Estorno com reserva intacta -- devolver_estoque sobrevive,
        //    devolver_uso_cupom nao aparece mais entre ele e o UPDATE.
        `IF v_pedido.payment_status = 'aguardando'
           AND v_pedido.status = 'pending' THEN
            PERFORM public.devolver_estoque(p_order_id);
            UPDATE public.marketplace_orders
               SET payment_status = 'estornado',`,
        // 2. Recusado com reserva intacta -- mesma prova.
        `PERFORM public.devolver_estoque(p_order_id);

        UPDATE public.marketplace_orders
           SET payment_status = 'recusado',
               status         = 'cancelled',`,
        // 3. expirado -> pago: reconsumir_uso_cupom nao aparece mais entre
        //    a guarda e o UPDATE.
        `IF v_pedido.payment_status = 'expirado' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'pago_apos_expirar',`,
        // 4. cancelado manualmente -> pago: mesma prova.
        `IF v_pedido.status = 'cancelled' THEN
                UPDATE public.marketplace_orders
                   SET payment_status = 'pago_apos_expirar',`,
      ],
    },
    {
      funcao: "devolver_cupons_de_pedidos_mortos",
      esperado: [
        // A funcao nova, unico lugar onde a vaga do cupom volta (Rodada 4).
        //
        // Rodada 5: os seis marcadores soltos de antes (um por clausula do
        // WHERE) davam "ok" mesmo com o WHERE INTEIRO apagado do corpo --
        // provado por um revisor de contexto limpo -- porque cada clausula
        // tambem aparece, verbatim, no bloco de comentario logo acima deste
        // WHERE executavel. E' a MESMA falha da Rodada 3 (sete marcadores
        // soltos passaram com uma chamada apagada): aqui o texto que engana
        // nao e' outro ponto da funcao, e' o comentario dela mesma.
        //
        // O marcador agora e' o BLOCO INTEIRO, do WHERE ate FOR UPDATE SKIP
        // LOCKED, no mesmo formato ja usado (e confirmado pelo revisor) em
        // expirar_pedidos_vencidos e confirmar_pagamento acima: contiguo o
        // bastante para nao existir em nenhum outro lugar do arquivo --
        // nem no comentario (que quebra linha e pontua diferente), nem no
        // WHERE do CREATE INDEX (mesma clausula inicial, indentacao
        // diferente).
        `WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND payment_status IS DISTINCT FROM 'pago'
          AND payment_status IS DISTINCT FROM 'pago_apos_expirar'
          AND coupon_usage_returned = FALSE
          AND (expires_at IS NULL OR expires_at < now() - interval '24 hours')
        FOR UPDATE SKIP LOCKED`,
        "PERFORM public.devolver_uso_cupom(v_pedido.id);",
        "SET coupon_usage_returned = TRUE",
      ],
    },
  ],
  // ⚠️ 20260822000000_status_do_pedido_nunca_nulo.sql NAO tem entrada aqui, e
  // nao pode ter: este mapa so' sabe conferir marcador dentro de
  // pg_get_functiondef, e aquela migration e' ALTER TABLE — nao redefine
  // funcao nenhuma. O db-apply vai imprimir "sem verificacao registrada,
  // pulando" e, no fim, o veredito PULADA (saida 2) — nao "Tudo aplicado e
  // verificado". Ate 20/08/2026 ele imprimia essa ultima frase mesmo assim;
  // e' o defeito que resumirVerificacao() (mais abaixo) existe para fechar.
  //
  // Enquanto este mapa nao souber conferir DDL de tabela, migration de
  // ALTER TABLE, policy e grant se confere A MAO depois de aplicar. Para
  // esta:
  //   SELECT is_nullable, column_default FROM information_schema.columns
  //    WHERE table_schema='public' AND table_name='marketplace_orders'
  //      AND column_name='status';
  //   -- esperado: is_nullable='NO', column_default=''pending''::text
};

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    if (!fs.existsSync(caminho)) continue;
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error(
    "DATABASE_URL não encontrada (nem no ambiente, nem em .env.local, nem em .env).",
  );
}

/** Descobre quais funções a migration redefine, para conseguir salvar o rollback. */
function funcoesAlteradas(sql) {
  const nomes = new Set();
  const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/gi;
  let m;
  while ((m = re.exec(sql))) nomes.add(m[1]);
  return [...nomes];
}

/**
 * Monta o texto do arquivo de rollback a partir do que já foi lido do banco.
 *
 * `restauracoes` é uma lista de `{ funcao, defs }` — `defs` vazio quer dizer
 * que a função ainda não existe no banco, então não há definição a restaurar.
 *
 * POR QUE O CABEÇALHO É CONDICIONAL: até 06/08/2026 ele afirmava, sempre,
 * "para desfazer, rode este arquivo inteiro no SQL Editor". Isso só é verdade
 * quando a migration redefine função, porque `funcoesAlteradas()` é a única
 * coisa que este script sabe ler. Naquele dia dois rollbacks saíram sem uma
 * única instrução — um deles referente a uma migration que já tinha cancelado
 * 13 pedidos e creditado 33 unidades de estoque — e mesmo assim mandavam
 * rodar o arquivo para desfazer. Quem lê esse arquivo lê durante um incidente,
 * com backup de até 24 h de idade e sem PITR neste projeto: um "rodei e não
 * aconteceu nada" vira "então já estava desfeito".
 *
 * Devolve `{ conteudo, instrucoes }`, onde `instrucoes` é o número de
 * definições de função efetivamente gravadas — 0 significa arquivo inerte.
 */
function montarRollback(arquivos, restauracoes) {
  const corpo = [];
  let instrucoes = 0;
  for (const { funcao, defs } of restauracoes) {
    if (defs.length === 0) {
      corpo.push(`-- ${funcao}: não existe hoje no banco (será criada).`, "");
      continue;
    }
    corpo.push(`-- ${funcao}`, ...defs.map((d) => `${d};`), "");
    instrucoes += defs.length;
  }

  // `restauracoes` mistura dois casos que o cabeçalho não pode tratar como
  // iguais: função que já existia (dá para restaurar a definição anterior) e
  // função que a migration está CRIANDO (não existe definição anterior — o
  // único jeito de desfazer é DROP FUNCTION, que este script não gera).
  const restauradas = restauracoes.filter((r) => r.defs.length > 0);
  const criadas = restauracoes.filter((r) => r.defs.length === 0);
  const nomesCriadas = criadas.map((r) => r.funcao).join(", ");

  const cabecalho = [
    `-- Rollback gerado automaticamente antes de aplicar: ${arquivos.join(", ")}`,
    "--",
  ];

  if (restauracoes.length === 0) {
    // Nenhum CREATE OR REPLACE FUNCTION em nenhuma migration: só aqui "não
    // redefine função" é verdade.
    cabecalho.push(
      "-- ATENÇÃO: ESTE ROLLBACK NÃO CONTÉM NENHUM COMANDO EXECUTÁVEL.",
      "-- Rodar este arquivo NÃO DESFAZ NADA.",
      "--",
      "-- Esta migration não redefine função, e o db-apply só sabe restaurar",
      "-- definição de função (CREATE OR REPLACE FUNCTION public.<nome>).",
      "-- Desfazer o resto dela — coisas como ADD COLUMN, CREATE INDEX,",
      "-- constraint, UPDATE/INSERT/DELETE — é MANUAL, e o ponto de partida",
      "-- é ler a própria migration em supabase/migrations/.",
    );
  } else if (restauradas.length === 0) {
    // Toca função, mas todas novas: nada a restaurar, arquivo continua
    // inerte — mas por um motivo diferente do caso acima, e o cabeçalho tem
    // de nomear a criação em vez de negá-la.
    cabecalho.push(
      "-- ATENÇÃO: ESTE ROLLBACK NÃO CONTÉM NENHUM COMANDO EXECUTÁVEL.",
      "-- Rodar este arquivo NÃO DESFAZ NADA.",
      "--",
      "-- Esta migration CRIA função nova — a função ainda não existia no",
      `-- banco, então não há definição anterior para restaurar: ${nomesCriadas}.`,
      "-- Desfazê-la(s) é DROP FUNCTION public.<nome>, manual (este script não",
      "-- gera esse comando). O resto da migration — coisas como ADD COLUMN,",
      "-- CREATE INDEX, constraint, UPDATE/INSERT/DELETE — também é MANUAL;",
      "-- o ponto de partida é ler a própria migration em",
      "-- supabase/migrations/.",
    );
  } else {
    // Restaura ao menos uma função que já existia.
    cabecalho.push(
      "-- ESCOPO: este arquivo restaura APENAS a definição anterior das funções",
      "-- listadas abaixo. É o único tipo de rollback que o db-apply sabe gerar.",
      "-- O resto da migration NÃO está aqui: coisas como ADD COLUMN, CREATE",
      "-- INDEX, constraint e UPDATE/INSERT/DELETE continuam aplicados e são",
      "-- manuais.",
      "--",
      "-- Para restaurar as funções, rode este arquivo no SQL Editor. Isso não",
      "-- desfaz a migration inteira.",
    );
    if (criadas.length > 0) {
      // Caso misto: a mesma migration restaura uma função e cria outra.
      // Rodar o arquivo some com a impressão de "desfiz tudo", mas a função
      // nova continua viva no banco.
      cabecalho.push(
        "--",
        "-- Esta migration também CRIA função nova, que não existia no banco:",
        `-- ${nomesCriadas}. Restaurar as funções acima NÃO remove as novas.`,
        "-- Desfazê-la(s) é DROP FUNCTION public.<nome>, manual (este script",
        "-- não gera esse comando).",
      );
    }
  }
  cabecalho.push("");

  return {
    conteudo: [...cabecalho, ...corpo].join("\n"),
    instrucoes,
    // Devolvido para o `main()` reaproveitar em vez de derivar de novo. A
    // mensagem do terminal e o cabeçalho do arquivo TÊM de concordar sobre o
    // que é "função criada" — duas derivações independentes divergiriam em
    // silêncio no dia em que a definição mudar, e o assunto deste script é
    // justamente arquivo e terminal contarem a mesma história.
    nomesCriadas,
  };
}

/**
 * Resume o resultado da verificação pós-aplicação em UM de três estados —
 * nunca dois. O booleano `tudoOk` que existia antes só sabia representar
 * "verifiquei e passou" / "verifiquei e falhou", e "não verifiquei nada"
 * caía dentro do primeiro por padrão: foi assim que, em 20/08/2026, duas
 * migrations sem entrada em VERIFICACOES saíram como "Tudo aplicado e
 * verificado".
 *
 * `resultados` é uma lista de `{ base, funcao?, situacao, motivo? }` — um
 * resultado por CHECAGEM (uma função dentro de uma migration), não por
 * arquivo; `funcao` só existe quando o resultado veio de uma checagem
 * registrada em VERIFICACOES. `situacao` deveria estar em
 * `"verificada" | "pulada" | "falhou"`, mas QUALQUER outro valor (typo,
 * ausência, string inventada) é tratado como "pulada" antes de mais nada —
 * desconhecido nunca é sucesso, nem por acidente de digitação. Precedência:
 * qualquer "falhou" vence tudo (e ainda assim lista as "pulada" da mesma
 * rodada, para elas não desaparecerem do veredito); senão, qualquer
 * "pulada" vence "verificada"; lista vazia é tratada como "pulada".
 *
 * O código de saída tem TRÊS valores de propósito (0 / 1 / 2), não dois. Um
 * chamador que só testar `!= 0` continua falhando fechado do mesmo jeito
 * que falhava antes; quem quiser distinguir "não verificado" de "falhou",
 * consegue.
 */
function resumirVerificacao(resultados, caminhoRollback) {
  // Desconhecido nunca é sucesso, nem em silêncio: qualquer `situacao` fora
  // do vocabulário conhecido (typo, ausência, valor inventado) é tratada
  // como "pulada", com um motivo próprio que cita o valor recebido. Sem
  // isto, o `filter` por igualdade de string dos três estados conhecidos
  // não casa nada, os três `filter` abaixo saem vazios, e o `return` final
  // — que assume "nada falhou, nada foi pulado, então passou" — devolve
  // VERIFICADO. É o defeito de 20/08/2026 outra vez, dentro da própria
  // função escrita para matá-lo.
  const ESTADOS_CONHECIDOS = new Set(["verificada", "pulada", "falhou"]);
  const normalizados = resultados.map((r) => {
    if (ESTADOS_CONHECIDOS.has(r.situacao)) return r;
    return {
      ...r,
      situacao: "pulada",
      motivo: `situação desconhecida: ${JSON.stringify(r.situacao)}`,
    };
  });

  const falharam = normalizados.filter((r) => r.situacao === "falhou");
  const puladas = normalizados.filter((r) => r.situacao === "pulada");
  const verificadas = normalizados.filter((r) => r.situacao === "verificada");

  // Identifica um resultado na mensagem. `funcao` só existe quando o
  // resultado veio de uma checagem de fato registrada (uma função dentro da
  // migration) — o pseudo-resultado de "sem entrada em VERIFICACOES" não
  // tem `funcao`, e por isso cai só no nome do arquivo.
  const rotulo = (r) => (r.funcao ? `${r.base} (${r.funcao})` : r.base);

  const avisoCommit =
    `   O COMMIT do passo 2 já aconteceu — esta verificação roda DEPOIS dele, então\n` +
    `   o que foi aplicado já está gravado no banco independente do resultado\n` +
    `   acima; não há "não aplicar" a partir daqui.\n` +
    `   Ponto de partida para desfazer: ${caminhoRollback}, salvo no passo 1 — leia\n` +
    `   acima o que ele cobre e o que continua manual.`;

  if (falharam.length > 0) {
    const lista = falharam.map(rotulo).join(", ");
    // As puladas da MESMA rodada não podem desaparecer daqui: são elas que,
    // se a mensagem só falar de FALHOU, ficam sem verificação para sempre
    // depois que alguém conserta só o que apareceu e roda de novo sozinho.
    const listaPuladas =
      puladas.length > 0
        ? `\n   Verificações puladas nesta mesma rodada (também sem confirmação): ${puladas
            .map(rotulo)
            .join(", ")}\n`
        : "";
    return {
      estado: "FALHOU",
      codigoSaida: 1,
      mensagem:
        `\nATENÇÃO: algum marcador esperado não apareceu. Confira antes de confiar.\n` +
        `   Verificações com marcador AUSENTE: ${lista}\n` +
        `${listaPuladas}` +
        `${avisoCommit}`,
    };
  }

  if (puladas.length > 0 || resultados.length === 0) {
    const listaPuladas = puladas
      .map((r) => `${rotulo(r)} (${r.motivo ?? "sem motivo registrado"})`)
      .join("\n     ");
    const resumoVerificadas =
      verificadas.length > 0
        ? `   ${verificadas.length} de ${normalizados.length} verificação(ões) foram conferidas e passaram; as demais NÃO.\n`
        : "";
    return {
      estado: "PULADA",
      codigoSaida: 2,
      mensagem:
        `\nATENÇÃO: aplicado, mas NÃO VERIFICADO — isto não quer dizer que passou,\n` +
        `quer dizer que ninguém conferiu.\n` +
        `${resumoVerificadas}` +
        `   Verificações puladas:\n     ${listaPuladas || "(nenhuma verificação informada)"}\n` +
        `   O db-apply só sabe conferir marcador dentro de corpo de função\n` +
        `   (pg_get_functiondef) — ALTER TABLE, policy, grant e REVOKE saem sempre\n` +
        `   assim e precisam de conferência à mão.\n` +
        `${avisoCommit}`,
    };
  }

  // Só chega aqui quando, depois da normalização acima, nenhum resultado é
  // "falhou" nem "pulada" e a lista não está vazia — ou seja, TODOS são
  // "verificada". VERIFICADO nunca é o caminho padrão: ele só sai de prova
  // positiva de cada um dos `normalizados.length` itens.
  return {
    estado: "VERIFICADO",
    codigoSaida: 0,
    mensagem:
      `\nTudo aplicado e verificado. (O COMMIT do passo 2 já aconteceu antes desta\n` +
      `checagem.) ${verificadas.length} de ${normalizados.length} verificações conferidas.`,
  };
}

/**
 * Decide a `situacao` de UMA checagem (uma função dentro de uma migration,
 * ou o pseudo-caso "a migration não tem entrada nenhuma em VERIFICACOES") a
 * partir do que o laço de `main()` observou ao rodar os marcadores.
 *
 * Extraída para ter teste direto: antes desta função existir, só
 * `resumirVerificacao()` era testada, e o laço que DECIDE a situação — a
 * metade do defeito de 20/08/2026 — não tinha nenhum teste em cima.
 *
 * `temRegistro`: a migration tinha entrada em VERIFICACOES?
 * `algumMarcadorAvaliado`: dentro dessa entrada, algum marcador chegou a
 *   ser comparado (ou seja, `esperado` não estava vazio)?
 * `algumMarcadorAusente`: algum dos marcadores comparados não apareceu na
 *   definição que ficou no banco?
 *
 * Precedência: sem registro vence tudo (nem há o que avaliar); sem nenhum
 * marcador avaliado é pulada por outro motivo (entrada existe, mas não
 * confere nada); só com marcador avaliado é que falhou/verificada fazem
 * sentido.
 */
function classificarChecagem({
  temRegistro,
  algumMarcadorAvaliado,
  algumMarcadorAusente,
}) {
  if (!temRegistro) {
    return { situacao: "pulada", motivo: "nenhuma verificação registrada" };
  }
  if (!algumMarcadorAvaliado) {
    return {
      situacao: "pulada",
      motivo: "a entrada registrada não confere nenhum marcador",
    };
  }
  if (algumMarcadorAusente) {
    return { situacao: "falhou" };
  }
  return { situacao: "verificada" };
}

async function definicaoAtual(client, nomeFuncao) {
  const { rows } = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [nomeFuncao],
  );
  return rows.map((r) => r.def);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const arquivos = args.filter((a) => !a.startsWith("--"));

  if (arquivos.length === 0) {
    console.error("Informe ao menos um arquivo de migration.\n");
    console.error("  node scripts/db-apply.cjs <arquivo.sql> [outro.sql ...]");
    process.exit(1);
  }

  for (const nome of arquivos) {
    const caminho = path.join(MIGRATIONS_DIR, path.basename(nome));
    if (!fs.existsSync(caminho)) {
      console.error(`Migration não encontrada: ${caminho}`);
      process.exit(1);
    }
  }

  const Client = carregarClient();
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const host = new URL(lerDatabaseUrl()).hostname;
  console.log(`Conectado em ${host}`);
  console.log(`Migrations a aplicar: ${arquivos.length}\n`);

  // 1. Rollback das definições atuais.
  const restauracoes = [];
  for (const nome of arquivos) {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, path.basename(nome)),
      "utf8",
    );
    for (const fn of funcoesAlteradas(sql)) {
      restauracoes.push({ funcao: fn, defs: await definicaoAtual(client, fn) });
    }
  }
  const { conteudo, instrucoes, nomesCriadas } = montarRollback(
    arquivos,
    restauracoes,
  );
  const arquivoRollback = path.join(
    PROJECT_ROOT,
    `rollback-${arquivos[0].replace(/\.sql$/, "")}.sql`,
  );
  fs.writeFileSync(arquivoRollback, conteudo);
  const caminhoRollback = path.relative(PROJECT_ROOT, arquivoRollback);
  // Mesma distinção do cabeçalho do arquivo, aqui no terminal: quem aplica a
  // migration costuma ler só esta linha e nunca abrir o arquivo. O
  // `nomesCriadas` vem de `montarRollback` de propósito — ver o comentário lá.
  const temCriadas = nomesCriadas !== "";
  if (instrucoes === 0 && !temCriadas) {
    console.warn(
      `ATENÇÃO: o rollback gerado NÃO CONTÉM NENHUM COMANDO — rodá-lo não desfaz nada.
   Arquivo:  ${caminhoRollback}
   Motivo:   nenhuma destas migrations redefine função existente, e o db-apply
             só sabe restaurar definição de função. Desfazer o resto delas
             (ADD COLUMN, CREATE INDEX, constraint, UPDATE/INSERT/DELETE, entre
             outras coisas) é MANUAL. Escreva o desfazer À MÃO ANTES de seguir.\n`,
    );
  } else if (instrucoes === 0) {
    // Toca função, mas todas novas: nada a restaurar, e "não redefine
    // função" seria falso — foi exatamente essa frase que o achado da
    // revisão pegou.
    console.warn(
      `ATENÇÃO: o rollback gerado NÃO CONTÉM NENHUM COMANDO — rodá-lo não desfaz nada.
   Arquivo:  ${caminhoRollback}
   Motivo:   esta(s) migration(ões) CRIA(M) função nova, que ainda não existia
             no banco: ${nomesCriadas}. Não há definição anterior para
             restaurar. Desfazê-la(s) é DROP FUNCTION manual (este script não
             gera esse comando). Escreva o desfazer À MÃO ANTES de seguir.\n`,
    );
  } else if (!temCriadas) {
    console.log(
      `Rollback salvo em: ${caminhoRollback} (${instrucoes} definição(ões) de função; o resto da migration é manual)\n`,
    );
  } else {
    // Caso misto: restaura uma função e cria outra na mesma migration.
    console.log(
      `Rollback salvo em: ${caminhoRollback} (${instrucoes} definição(ões) de função; o resto da migration é manual)
   ATENÇÃO: esta(s) migration(ões) também CRIA(M) função nova (${nomesCriadas}) —
   restaurar as funções acima NÃO remove as novas. DROP FUNCTION é manual.\n`,
    );
  }

  if (dryRun) {
    console.log("--dry-run: nada foi aplicado.");
    await client.end();
    return;
  }

  // 2. Aplica cada uma em transação própria.
  for (const nome of arquivos) {
    const base = path.basename(nome);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, base), "utf8");
    const versao = base.split("_")[0];
    const rotulo = base.replace(/^\d+_/, "").replace(/\.sql$/, "");

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name)
         VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
        [versao, rotulo],
      );
      await client.query("COMMIT");
      console.log(`  aplicada  ${base}`);
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`  FALHOU    ${base}\n            ${erro.message}`);
      console.error("\nNada foi comitado desta migration. Parando aqui.");
      await client.end();
      process.exit(1);
    }
  }

  // 3. Verificação pós-aplicação. Cada migration termina classificada em UM
  // de três estados — nunca "verificada por padrão" — e é resumirVerificacao()
  // quem decide o veredito final a partir dessa lista (ver o comentário dela).
  console.log("\nVerificação:");
  const resultados = [];
  for (const nome of arquivos) {
    const base = path.basename(nome);
    const registro = VERIFICACOES[base];
    if (!registro) {
      console.log(`  ${base}: sem verificação registrada, pulando.`);
      const { situacao, motivo } = classificarChecagem({
        temRegistro: false,
        algumMarcadorAvaliado: false,
        algumMarcadorAusente: false,
      });
      resultados.push({ base, situacao, motivo });
      continue;
    }
    // Um arquivo pode redefinir mais de uma função (ex.: a mesma migration
    // reaplicada task a task) — registro vira lista nesse caso. Cada
    // checagem vira um resultado PRÓPRIO (com `funcao`), não um flag
    // agregado por arquivo: um flag agregado deixaria uma segunda função
    // sem `esperado` preenchido passar escondida atrás da primeira, que
    // conferiu normalmente.
    const checagens = Array.isArray(registro) ? registro : [registro];
    for (const checagem of checagens) {
      const [def] = await definicaoAtual(client, checagem.funcao);
      if (def === undefined) {
        // A2: o veredito abaixo (provavelmente AUSENTE em todo marcador) já
        // fica certo sozinho, mas o RÓTULO "AUSENTE" mente sobre a causa —
        // faz parecer que existe um corpo de função divergente para
        // comparar, quando na verdade a função simplesmente não existe no
        // schema (pode ser um no-op da migration, ou uma função com nome
        // errado no mapa).
        console.log(
          `  (${checagem.funcao} não existe no schema — os marcadores abaixo saem AUSENTE por isso, não por divergência de corpo)`,
        );
      }
      // Normaliza \r\n -> \n dos dois lados antes de comparar. O repo nao tem
      // .gitattributes e core.autocrlf converte as migrations para CRLF no
      // working tree a cada checkout/clone/stash; sem isso, um marcador que
      // cruza uma quebra de linha (ex.: "ELSE\n            UPDATE ...") deixa
      // de casar contra um corpo em CRLF e a verificacao grita AUSENTE para
      // uma migration que esta correta — DEPOIS do COMMIT ja ter acontecido.
      const defNormalizado = def?.replace(/\r\n/g, "\n");
      let algumMarcadorAvaliado = false;
      let algumMarcadorAusente = false;
      for (const marcador of checagem.esperado) {
        algumMarcadorAvaliado = true;
        const marcadorNormalizado = marcador.replace(/\r\n/g, "\n");
        const ok = Boolean(defNormalizado?.includes(marcadorNormalizado));
        if (!ok) algumMarcadorAusente = true;
        const rotulo = `${checagem.funcao}: ${marcador.slice(0, 64)}`;
        console.log(`  ${ok ? "ok     " : "AUSENTE"}  ${rotulo}`);
      }
      const { situacao, motivo } = classificarChecagem({
        temRegistro: true,
        algumMarcadorAvaliado,
        algumMarcadorAusente,
      });
      resultados.push({ base, funcao: checagem.funcao, situacao, motivo });
    }
  }

  await client.end();
  const { mensagem, codigoSaida } = resumirVerificacao(
    resultados,
    caminhoRollback,
  );
  console.log(mensagem);
  process.exit(codigoSaida);
}

if (require.main === module) {
  main().catch((erro) => {
    console.error("Erro:", erro.message);
    process.exit(1);
  });
}

// Exportado para tests/db_apply_rollback_test.ts (funcoesAlteradas,
// montarRollback) e tests/db_apply_resumo_verificacao_test.ts
// (resumirVerificacao, classificarChecagem). O guarda acima existe por
// causa disso: sem ele, importar o módulo dispararia a aplicação das
// migrations.
module.exports = {
  funcoesAlteradas,
  montarRollback,
  resumirVerificacao,
  classificarChecagem,
};

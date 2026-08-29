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
 *          conferido, e todos apareceram na CONTAGEM EXATA declarada.
 *        - PULADA (saída 2): alguma migration ficou SEM NENHUM marcador
 *          conferido — seja por não ter entrada em VERIFICACOES, seja por
 *          ter entrada com `esperado` vazio. Isto NÃO é sucesso: é "ninguém
 *          verificou". Migration que só faz ALTER TABLE, policy ou grant cai
 *          sempre aqui, porque o script só sabe conferir marcador dentro de
 *          corpo de função (pg_get_functiondef).
 *        - FALHOU (saída 1): algum marcador não apareceu na função que ficou
 *          no banco na CONTAGEM EXATA declarada — de menos (parte do trecho
 *          sumiu no REPLACE) ou de mais (a função mudou de um jeito que
 *          ninguém previu). As duas coisas pedem olho humano.
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
  // ⚠️ Corpo HISTÓRICO — não reaponte esta entrada. A
  // 20260729000002_shipping_quote_validation_v23.sql, logo abaixo, reescreveu
  // a v22 como FACHADA PURA ("RETURN public.create_marketplace_order_v23(...)"
  // e mais nada). Os três marcadores daqui continuam CERTOS para o corpo que
  // ESTA migration cria — e é contra o .sql dela que o teste offline os
  // confere. Medi-los contra o corpo VIVO da v22 dá AUSENTE, e isso é o
  // ESPERADO, não defeito a "corrigir".
  //
  // Quem guarda a regra de frete grátis HOJE, no corpo que o app chama
  // (src/hooks/useOrders.ts escolhe entre v24 e v23), são as entradas da
  // 20260729000002 (v23) e da 20260821000200 (v23 e v24), com o bloco
  // contíguo.
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
  "20260729000002_shipping_quote_validation_v23.sql": [
    {
      funcao: "is_local_cep",
      esperado: [
        // Esta migration cria TRES funcoes — is_local_cep, v23 e v22 — e sem
        // checagem para a primeira o veredito final do terminal deixaria de
        // dizer "1 migration ficou SEM CONFERENCIA AUTOMATICA" e passaria a
        // dizer "Tudo aplicado e verificado", com is_local_cep sem ninguem
        // olhando. Aviso honesto trocado por afirmacao falsa, DEPOIS do
        // COMMIT.
        //
        // Ela nao e' acessoria: decide se o cliente recebe a taxa de ENTREGA
        // LOCAL (mais barata) em vez do frete de transportadora, e tem GRANT
        // EXECUTE para anon. O ataque a prevenir e' a degradacao para "aceita
        // todo mundo" — um REPLACE que troque um ramo por RETURN true faz
        // qualquer CEP do pais reivindicar entrega local.
        //
        // A guarda de entrada: sem ela, CEP vazio (de origem ou de destino)
        // deixa de ser recusado de cara.
        "IF v_origem = '' OR v_destino = '' THEN RETURN false; END IF;",
        // Sem faixa configurada, cai nos 5 primeiros digitos — a mesma regra
        // da edge function. Se sumir, loja sem faixa cadastrada passa a
        // aceitar qualquer CEP como local.
        "RETURN left(v_origem, 5) = left(v_destino, 5);",
        // A comparacao da faixa explicita ("38500000-38505000"): sem ela, uma
        // faixa cadastrada deixa de limitar coisa nenhuma.
        "IF v_destino_num BETWEEN v_inicio AND v_fim THEN",
        // A comparacao do formato que o PROPRIO admin sugere como placeholder
        // ("38500-000, 38500-999") — o ramo mais exposto dos cinco que
        // devolvem true, porque e' o que a maioria das lojas vai ter
        // cadastrado. Degradado para RETURN true, qualquer CEP vira local.
        "RETURN v_destino_num BETWEEN LEAST(v_a, v_b) AND GREATEST(v_a, v_b);",
        // O ramo do PREFIXO (item curto na lista). Mesma classe: degradado,
        // qualquer destino casa com qualquer token.
        "ELSIF v_destino LIKE v_token || '%' THEN",
        // A negativa por padrao. Medido: 2x no corpo que esta migration cria
        // — dentro da guarda de entrada (marcador acima) e como o RETURN
        // final, depois de esgotada toda tentativa de casar. As duas sao
        // CODIGO, sem prosa entre elas, entao e' CONTAGEM e nao bloco
        // contiguo (o criterio deste arquivo). Trocar qualquer uma por RETURN
        // true derruba a contagem para 1 e a verificacao acusa.
        { texto: "RETURN false;", vezes: 2 },
        // E os tres RETURN true, contados: sao os tres caminhos que CONCEDEM
        // a taxa local (faixa casada, CEP completo igual, prefixo casado).
        // Contagem aqui e' de mao dupla, e e' a de MAIS que importa: um ramo
        // novo que devolva true sem ninguem ter pensado nele faz 4 > 3 e
        // reprova, em vez de passar em silencio numa funcao exposta a anon.
        { texto: "RETURN true;", vezes: 3 },
        // Os DOIS ramos que a contagem sozinha nao protege. Medido por revisao
        // de contexto limpo, com mutacao e controle positivo na mesma rodada:
        // trocar `IF v_achou_faixa` por outra variavel, ou `IF v_destino =
        // v_token` por `IF true`, deixa os 3 `RETURN true;` intactos — a
        // contagem continua batendo e a situacao sai "verificada".
        //
        // E' a MESMA lacuna da sentinela do frete, nesta funcao: contagem pega
        // sumico de ocorrencia, nunca troca de CONDICAO. So marcador que
        // ATRAVESSA a condicao pega. Sem estes dois, uma loja com faixa
        // cadastrada passa a conceder taxa de entrega local a QUALQUER CEP do
        // pais — e esta funcao tem GRANT EXECUTE para `anon`.
        "IF v_achou_faixa THEN RETURN true; END IF;",
        "IF v_destino = v_token THEN RETURN true; END IF;",
      ],
    },
    {
      funcao: "create_marketplace_order_v23",
      esperado: [
        // A regra do dinheiro MIGROU para ca: esta migration cria a v23 e
        // reescreve a v22 (que ate aqui carregava a regra sozinha) como
        // fachada que delega. Daqui em diante e' aqui — e na entrada mais
        // recente que redefinir esta mesma funcao — que a paridade de frete
        // gratis do usuario logado tem de sobreviver ao REPLACE.
        //
        // Marcador CONTIGUO, e nao os dois textos soltos da entrada da
        // 20260729000000: solto, cada um so' prova que o texto existe em
        // ALGUM ponto da funcao, nunca que um GOVERNA o outro. E contagem
        // exata tambem nao fecha isto: ela pega sumico parcial, nao pega
        // troca de VALOR. Medido — trocar a sentinela 999999 por 0 deixa os
        // dois soltos intactos, 1x cada, "ok" nos dois, e a loja inteira
        // para de cobrar frete (free_shipping_min = 0 deixa de significar
        // "desligado" e passa a significar "gratis a partir de R$ 0": o
        // primeiro cliente logado com R$ 10 no carrinho ja leva 10 >= 0). So
        // o bloco, que ATRAVESSA a sentinela, acusa.
        `    v_free_shipping_min := COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999);

    IF v_has_free_shipping_item = true
       OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)
    THEN
        v_shipping_validated := 0;`,
        // O recalculo do total pelos precos do banco (Price Tampering
        // Protection) nasce nesta funcao: sem ele o cliente volta a poder
        // mandar o proprio total.
        "Os valores do pedido mudaram",
      ],
    },
    {
      funcao: "create_marketplace_order_v22",
      esperado: [
        // A partir desta migration a v22 e' FACHADA PURA, e o que importa
        // provar sobre ela nao e' mais a regra de frete (que vive na v23) e
        // sim que ela continua DELEGANDO. Se este marcador sumir, a v22
        // voltou a ter copia propria da logica — copia que ninguem atualiza
        // quando a regra mudar de novo, e o desencontro que motivou a
        // 20260729000000 nasce outra vez, em silencio, num caminho que hoje
        // nenhum cliente chama mas que continua com GRANT para anon.
        //
        // Colado no BEGIN de proposito, e nao o `RETURN ...` solto: solto ele
        // prova que a delegacao EXISTE, nao que ela e' a UNICA coisa que o
        // corpo faz. Medido por revisao de contexto limpo, com mutacao: uma
        // v22 que ganha logica propria ANTES de delegar (um INSERT entre o
        // BEGIN e o RETURN) passava como "verificada" com o marcador solto —
        // e o pedido seria gravado duas vezes, uma pela copia e outra pela
        // v23. Colado no BEGIN, nao cabe statement nenhum antes. E' isso que
        // "fachada pura" quer dizer.
        "BEGIN\n    RETURN public.create_marketplace_order_v23(",
      ],
    },
  ],
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
        //
        // Marcador CONTIGUO, colado na ultima linha do WHERE, e nao o texto
        // solto: solto ele aparece 2x no corpo que esta migration cria, e a
        // segunda ocorrencia e' o COMENTARIO logo abaixo do BEGIN que explica
        // o mecanismo — bastava o comentario sobreviver para o marcador dar
        // "ok" com o FOR UPDATE apagado do SELECT. Contagem (`vezes: 2`)
        // fecharia esse furo e abriria outro: amarraria a checagem a REDACAO
        // do comentario, e editar prosa — ato inofensivo — passaria a
        // reprovar codigo correto.
        "AND expires_at < now()\n        FOR UPDATE SKIP LOCKED",
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
  // ⚠️ Medido: o marcador "AND gateway_payment_id IS NOT NULL" desta entrada
  // da AUSENTE contra o corpo VIVO — e isso NAO e' defeito, nao reaponte. A
  // 20260812000000, mais abaixo, REORDENOU o WHERE e subiu o mesmo predicado
  // para a primeira posicao (sem o "AND" na frente), sem perder a invariante;
  // o corpo vivo e' guardado inteiro pela entrada DELA (os 5 marcadores de la
  // dao 1x cada no corpo vivo, e nenhuma migration posterior redefine esta
  // funcao). Esta entrada esta certa para o .sql que ELA cria, que e' o
  // contrato que o teste offline cobra.
  "20260808000100_reconciliacao.sql": [
    {
      funcao: "pagamentos_a_reconciliar",
      esperado: [
        // Sem isto a varredura revisita pedido ja reconciliado a cada ciclo.
        //
        // Marcador CONTIGUO pelo mesmo motivo da expirar_pedidos_vencidos
        // acima: "AND paid_at IS NULL" solto aparece 2x no corpo que esta
        // migration cria, e a segunda ocorrencia e' a PROSA do comentario que
        // cita o predicado. Colado na linha de cima do WHERE executavel, o
        // marcador so' fala de codigo.
        "AND gateway_payment_id IS NOT NULL\n       AND paid_at IS NULL",
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
      //
      // `vezes: 2` e' exatamente a prova de "nos DOIS ramos": cada uma
      // aparece uma vez na lista do INSERT e uma vez no CASE do ON CONFLICT,
      // e as duas sao CODIGO. Como marcador solto, perder o ramo do INSERT
      // continuava dando "ok" por causa do ramo do ON CONFLICT (e vice-versa)
      // — o comentario acima prometia os dois ramos e a checagem provava um.
      { texto: "config_json->>'store_name'", vezes: 2 },
      { texto: "config_json->>'store_city'", vezes: 2 },
      { texto: "config_json->>'store_state'", vezes: 2 },
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
      //
      // Marcador CONTIGUO: o texto solto aparece 2x no corpo que esta
      // migration cria, e a segunda ocorrencia e' so' a aritmetica do
      // `espere_segundos` da mensagem de resposta — cosmetica. Solto, apagar
      // o freio de verdade (o WHERE do SELECT) continuava dando "ok" por
      // causa da conta da mensagem; `vezes: 2` amarraria a checagem a um
      // texto que ninguem promete manter.
      "AND created_at > NOW() - INTERVAL '60 seconds'",
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
        // 3x, e as tres sao CODIGO: a pre-checagem contra o estoque do banco
        // e as duas guardas do UPDATE atomico (variante e produto pai). Como
        // marcador solto, apagar DUAS das tres continuava imprimindo "ok" —
        // e o pedido passaria a vender o que a loja nao tem.
        { texto: "Estoque insuficiente para o produto", vezes: 3 },
        "UPDATE public.coupons SET usage_count = usage_count + 1",
        // A regra de FRETE GRATIS, que nasceu na 20260729000002 e tem de
        // sobreviver AQUI: esta migration reescreve a v23 inteira, e quem
        // define o corpo vivo e' sempre a entrada mais recente do mapa, nunca
        // a que criou a regra primeiro. Sem este marcador, um REPLACE futuro
        // derruba o frete gratis do caminho que o app chama e nada acusa —
        // e isso viaja para toda loja clonada deste repositorio.
        //
        // Marcador CONTIGUO pelo mesmo motivo da entrada da 20260729000002:
        // os dois textos soltos ("NULLIF(...)" e "v_user_id IS NOT NULL
        // AND ...") continuam casando 1x cada com a sentinela 999999 trocada
        // por 0 — a loja para de cobrar frete e a ferramenta imprime "ok"
        // nos dois. Contagem exata pega sumico, nao pega troca de valor.
        `    v_free_shipping_min := COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999);

    IF v_has_free_shipping_item = true
       OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)
    THEN
        v_shipping_validated := 0;`,
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
        // Esta e' a definicao VIVA da v24 — a mais recente do mapa a
        // redefini-la — e e' o caminho que o app chama quando o pagamento
        // online esta ligado (src/hooks/useOrders.ts). O bloco de frete
        // gratis precisa ser guardado aqui pelo mesmo motivo da v23 acima; a
        // entrada da 20260807000000 mais atras guarda a mesma invariante com
        // a regua intermediaria (o predicado solto), que nao acusa a troca da
        // sentinela.
        `    v_free_shipping_min := COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999);

    IF v_has_free_shipping_item = true
       OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)
    THEN
        v_shipping_validated := 0;`,
      ],
    },
  ],
  "20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql": [
    {
      funcao: "create_marketplace_order_v23",
      esperado: [
        // A CORRECAO EM SI: a cotacao de frete tem de ser DO CARRINHO que esta
        // sendo comprado. Sem ela, da para cotar com um carrinho pequeno,
        // encher o carrinho e fechar o pedido pagando o frete do pequeno — a
        // diferenca sai do bolso da lojista. `itens_da_cotacao` e o apelido da
        // subconsulta que desmonta o cart_hash; se sumir, a trava sumiu.
        "itens_da_cotacao",
        // O DIAGNOSTICO: e o unico texto que conta a quem depura POR QUE a
        // venda caiu. Sem ele, recusa por carrinho trocado aparece no log como
        // "sem cotacao nas ultimas 24h" — causa que ninguem conferiu.
        "OUTRO carrinho",
        // Daqui para baixo: o que tem de SOBREVIVER ao REPLACE, porque esta
        // migration reescreve as duas funcoes inteiras. Cada um destes ja foi
        // a correcao de outra migration, e o cenario ruim de cada um e MUDO.
        //
        // Limite 0 volta a significar ilimitado (migration 20260821000200). Se
        // sumir, a cliente aplica o cupom no checkout e leva "Cupom invalido"
        // ao finalizar.
        "usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit",
        // A trava contra dois pedidos gastarem a ultima unidade do cupom ao
        // mesmo tempo — mora na MESMA consulta que a correcao acima mexeu.
        "FOR UPDATE;",
        // A trava anti-adulteracao de 5 centavos. Ela NAO cobre carrinho
        // trocado (preco divergente e outra pergunta), mas cobre preco forjado.
        "Os valores do pedido mudaram",
        // Aparece 3x no corpo (medido): o RAISE do item normal e os dois das
        // variacoes. Contagem exata para a queda de qualquer um deles acusar,
        // em vez de imprimir ok com as outras de pe.
        { texto: "Estoque insuficiente para o produto", vezes: 3 },
        "UPDATE public.coupons SET usage_count = usage_count + 1",
      ],
    },
    {
      funcao: "create_marketplace_order_v24",
      esperado: [
        "itens_da_cotacao",
        "OUTRO carrinho",
        "usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit",
        "FOR UPDATE;",
        "Os valores do pedido mudaram",
        // Mesma contagem da v23: 3x no corpo (medido).
        { texto: "Estoque insuficiente para o produto", vezes: 3 },
        "UPDATE public.coupons SET usage_count = usage_count + 1",
        // A UNICA coisa que separa a v24 da v23: a reserva com prazo do
        // pagamento online. Se sumir no REPLACE, o PIX deixa de expirar e o
        // pg_cron nunca devolve o estoque a prateleira.
        "'aguardando', now() + interval '30 minutes'",
      ],
    },
  ],
  // 🔴 MARCADOR TEM DE SER UM BLOCO QUE SO EXISTE **COM** A CORRECAO.
  // A primeira versao desta entrada usava `"customer_phone"` e
  // `"p_customer_phone"` como marcadores "da correcao" -- e os dois ja apareciam
  // 4 vezes na definicao SEM a correcao, porque `pg_get_functiondef` devolve a
  // ASSINATURA junto com o corpo (`p_customer_phone text`) e o
  // `jsonb_build_object` cita o parametro. Resultado: a entrada trocaria um
  // PULADA barulhento por um VERIFICADO falso -- pior que nao ter entrada
  // nenhuma. Levantado por revisao de contexto limpo em 23/08/2026.
  //
  // A regra que fica: conferir o marcador contra a definicao ANTERIOR e exigir
  // ZERO ocorrencia la. "Existe no corpo novo" e' so metade da regua; a outra
  // metade e' "NAO existe no corpo velho".
  //
  // 🔴 VERIFICADO AQUI NAO QUER DIZER "as DUAS clausulas conferidas". Esta
  // funcao tem duas clausulas de telefone IDENTICAS (uma na consulta de
  // CONTAGEM, outra na de DADOS), e a checagem abaixo e' `includes()`: uma
  // ocorrencia ja basta para marcar o marcador como presente. Reverter SO
  // uma das duas clausulas ainda sai VERIFICADO aqui -- e' limite desta
  // ferramenta, nao bug dela. Quem garante as DUAS e' o passo 4/6 de
  // scripts/db-prove-busca-por-telefone.cjs, que compara `total` (da
  // CONTAGEM) com `quantos` (dos DADOS) e cai se so uma clausula tiver a
  // correcao.
  "20260961000000_busca_por_telefone_normaliza_digitos.sql": [
    {
      funcao: "get_admin_orders_paged",
      esperado: [
        // A CORRECAO: a variavel nova e o calculo dela. Conferido: 0 ocorrencia
        // na definicao anterior. Se sumir, a busca volta a comparar texto cru e
        // colar o numero do WhatsApp deixa de achar -- sem nada na tela avisar,
        // porque nome e id continuam funcionando.
        "v_search_digitos := regexp_replace(v_clean_search, '[^0-9]', '', 'g');",
        // A GUARDA por quantidade de digito. Sem ela (ou com `<> ''`),
        // termo de poucos digitos casa quase toda a base pela clausula do
        // telefone -- medido: "3d" de 15 para 60 resultados. O marcador
        // cruza quebra de linha de proposito, para casar o bloco e nao um
        // identificador solto. Aparece 2x no corpo (medido): a consulta
        // existe duplicada, uma na CONTAGEM e outra nos DADOS.
        {
          texto:
            "length(v_search_digitos) >= 4\n            AND regexp_replace(",
          vezes: 2,
        },
        // O coalesce com o jsonb: e ele que faz os pedidos de coluna nula (a
        // RPC legada nunca preencheu) serem achaveis. 0 ocorrencia na anterior.
        // 2x no corpo (medido): CONTAGEM e DADOS, como a guarda acima.
        {
          texto:
            "coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),",
          vezes: 2,
        },
        // Daqui para baixo: o que tem de SOBREVIVER ao REPLACE. Estes aparecem
        // na definicao anterior TAMBEM, e isso e o certo para a classe deles.
        //
        // `extensions` no search_path: `unaccent` mora la. Se encolher para so
        // 'public', a busca por nome quebra com "function unaccent(text) does
        // not exist" -- e o painel para de achar qualquer coisa por texto.
        "SET search_path TO 'public', 'extensions'",
        // Os dois unaccent aparecem 2x no corpo (medido): a dupla CONTAGEM x
        // DADOS duplica as clausulas de busca.
        { texto: "unaccent(o.customer_name)", vezes: 2 },
        { texto: "unaccent(oi.product_name)", vezes: 2 },
        // A trava de autorizacao. Se sumir, a busca de pedidos do painel passa
        // a responder para qualquer pessoa autenticada.
        "IF NOT public.is_admin() THEN",
      ],
    },
  ],
  "20260960000000_variacao_obrigatoria_no_servidor.sql": [
    {
      funcao: "create_marketplace_order_v23",
      esperado: [
        // A CORRECAO EM SI: sem este DETAIL a mensagem de recusa nao conta
        // POR QUE o pedido caiu — fica indistinguivel de "produto sem
        // estoque" ou "produto indisponivel" pra quem depura o log depois.
        "variant_id ausente em produto com variacao ativa",
        // O texto que a CLIENTE ve na tela. Se sumir no REPLACE, o item sem
        // variacao volta a ser aceito calado — preco de `preco_venda` em vez
        // do `price_override`, e a baixa cai no `estoque` agregado em vez do
        // `stock_increment` da variacao escolhida. 2x no corpo (medido): o
        // comentario do por-que e o RAISE — contagem exata para o comentario
        // nao "provar" a queda do RAISE.
        { texto: "Escolha uma varia", vezes: 2 },
        // Daqui para baixo: o que tem de SOBREVIVER ao REPLACE, porque esta
        // migration reescreve as duas funcoes inteiras a partir do texto da
        // 20260951 — herdado da entrada dela, mesmo cenario ruim de cada um.
        "itens_da_cotacao",
        "OUTRO carrinho",
        "FOR UPDATE;",
        // Limite 0 volta a significar ilimitado. Se a forma completa cair
        // para so' "usage_limit IS NULL OR usage_limit <= 0" no REPLACE, a
        // cliente aplica o cupom no checkout e leva "Cupom invalido" ao
        // finalizar -- e este marcador truncado nao pegaria a queda.
        "usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit",
        "Os valores do pedido mudaram",
        // Se sumir no REPLACE, pedido com estoque insuficiente e aceito
        // mesmo assim -- a lojista vende o que nao tem. 3x no corpo
        // (medido), herdado da 20260951.
        { texto: "Estoque insuficiente para o produto", vezes: 3 },
        // Se sumir no REPLACE, o cupom de uso unico deixa de ser consumido:
        // o mesmo codigo pode ser reaplicado indefinidamente.
        "UPDATE public.coupons SET usage_count = usage_count + 1",
      ],
    },
    {
      funcao: "create_marketplace_order_v24",
      esperado: [
        "variant_id ausente em produto com variacao ativa",
        { texto: "Escolha uma varia", vezes: 2 },
        "itens_da_cotacao",
        "OUTRO carrinho",
        "FOR UPDATE;",
        "usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit",
        "Os valores do pedido mudaram",
        // Mesma contagem da v23: 3x no corpo (medido).
        { texto: "Estoque insuficiente para o produto", vezes: 3 },
        "UPDATE public.coupons SET usage_count = usage_count + 1",
        // A UNICA coisa que separa a v24 da v23: a reserva com prazo do
        // pagamento online. Se sumir no REPLACE, o PIX deixa de expirar e o
        // pg_cron nunca devolve o estoque a prateleira.
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
        //
        // `vezes: 3`, e as tres sao CODIGO: a CTE do grafico de receita, a
        // CTE de lucro/custo e a consulta dos mais vendidos. Como marcador
        // solto, apagar DUAS das tres continuava imprimindo "ok" — duas
        // telas voltavam a contar dinheiro que nao entrou e ninguem via.
        {
          texto:
            "AND (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))",
          vezes: 3,
        },
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
        // Contiguo pelo mesmo motivo da entrada de 20260807000000: esta
        // migration recria a funcao com o mesmo comentario abaixo do BEGIN,
        // entao o texto solto tambem aparece 2x aqui.
        "AND expires_at < now()\n        FOR UPDATE SKIP LOCKED",
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
        // Rodada 6 (20260970000000, achado ANOTADO de revisor de contexto
        // limpo): aquela migration faz OUTRO CREATE OR REPLACE nesta mesma
        // funcao e insere uma SETIMA clausula entre a sexta e o "FOR UPDATE
        // SKIP LOCKED" -- o bloco amarrado de antes (WHERE ate esse anchor)
        // deixou de casar contra o corpo que fica no banco depois dela
        // (medido: false). A Rodada 6 ENCOLHEU o marcador para as seis
        // clausulas sem o anchor final, apostando que elas continuariam
        // contiguas byte a byte "em qualquer versao futura da funcao que
        // preserve a ordem" -- promessa sobre o futuro dentro de uma trava.
        // A propria funcao ja tinha acabado de falsificar essa promessa uma
        // vez (foi exatamente essa aposta, no marcador anterior a' Rodada
        // 6, que a 20260970000000 quebrou) -- entao encolher para fazer a
        // MESMA aposta de novo e' repetir o defeito que a Rodada 6 estava
        // tentando consertar. Achado BLOQUEANTE de revisor de contexto
        // limpo (segunda rodada): medido contra os dois corpos reais --
        // com o anchor "FOR UPDATE SKIP LOCKED" apagado do corpo, o
        // marcador encolhido da Rodada 6 ainda saia "verificada".
        //
        // Rodada 7: em vez de apostar no futuro, o segundo bloco abaixo
        // ancora no FIM do WHERE em vez do comeco -- "FOR UPDATE SKIP
        // LOCKED" seguido do "LOOP" e do PERFORM que abre o corpo do laco.
        // Uma clausula nova inserida ANTES do anchor (exatamente o que
        // 20260970000000 fez) nao move o anchor nem o que vem depois dele,
        // entao o bloco casa nos DOIS corpos (20260901000000 e
        // 20260970000000) e continua acusando a remocao do "FOR UPDATE
        // SKIP LOCKED" nos dois -- medido pelo revisor contra as duas
        // versoes.
        //
        // O marcador solto "FOR UPDATE SKIP LOCKED" sozinho NAO serve: ele
        // casa verbatim contra o comentario desta propria funcao ("-- FOR
        // UPDATE SKIP LOCKED: mesma protecao de expirar_pedidos_vencidos
        // --", logo depois do BEGIN) mesmo com o anchor executavel
        // apagado -- e' a armadilha da Rodada 5 outra vez, com outro alvo.
        `WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND payment_status IS DISTINCT FROM 'pago'
          AND payment_status IS DISTINCT FROM 'pago_apos_expirar'
          AND coupon_usage_returned = FALSE
          AND (expires_at IS NULL OR expires_at < now() - interval '24 hours')`,
        `        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_uso_cupom(v_pedido.id);`,
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

  // ---------------------------------------------------------------------
  // 20260970000000_cancelamento_respeita_o_envio.sql tambem entra por ALTER
  // TABLE (duas colunas novas: cancelled_after_shipping,
  // returned_to_seller_at) -- o mesmo limite do bloco acima vale aqui, NAO
  // e' o mesmo assunto: aquele e' sobre 20260822000000, este e' sobre esta
  // migration.
  //
  // A EXISTENCIA das duas colunas fica provada pelas checagens abaixo, mas
  // NAO por check_function_bodies "validar tabela/coluna na CRIACAO da
  // funcao" -- essa premissa e' FALSA para LANGUAGE plpgsql (as duas
  // funcoes desta migration sao plpgsql): o Postgres so' valida referencia
  // de tabela/coluna dentro de um corpo plpgsql NA EXECUCAO daquele ramo,
  // nunca na criacao (doc oficial, "PL/pgSQL Under the Hood" -- comandos
  // SQL do corpo nao sao traduzidos no CREATE FUNCTION). Quem prova a
  // coluna aqui e' outro mecanismo, mais estreito: cada migration roda em
  // transacao propria (db-apply.cjs, passo 2, `BEGIN`/`client.query(sql)`/
  // `COMMIT`) e o script sai por `process.exit(1)` ANTES desta verificacao
  // se qualquer comando da migration falhar -- entao o ALTER TABLE ADD
  // COLUMN do MESMO ARQUIVO necessariamente rodou para o fluxo chegar ate
  // aqui. Isto so' vale enquanto coluna e funcao estiverem no mesmo
  // arquivo -- se um dia se separarem (ou se DROP COLUMN vier depois),
  // confira a mao:
  //   SELECT column_name, data_type, is_nullable, column_default
  //     FROM information_schema.columns
  //    WHERE table_schema='public' AND table_name='marketplace_orders'
  //      AND column_name IN ('cancelled_after_shipping', 'returned_to_seller_at');
  //   -- esperado: 2 linhas -- cancelled_after_shipping (boolean,
  //   -- is_nullable='NO', column_default='false'); returned_to_seller_at
  //   -- (timestamp with time zone, is_nullable='YES', column_default NULL).
  "20260970000000_cancelamento_respeita_o_envio.sql": [
    {
      funcao: "update_order_status_atomic",
      esperado: [
        // 1. A CORRECAO EM SI (Regra do Gabriel, 24/08/2026): o divisor
        // passa a ser SE O PRODUTO SAIU, nao mais "so' pending pode ser
        // cancelado". Sem esta linha, o cliente que tenta cancelar um
        // pedido ja enviado levaria "Apenas pedidos pendentes podem ser
        // cancelados por voce" outra vez.
        "IF v_old_status NOT IN ('pending', 'processing', 'shipping') THEN",
        // 2. Bloco amarrado (nao marcador solto): prova que
        // cancelled_after_shipping so' vira true quando o pedido estava em
        // 'shipping'. Um marcador solto ("SET cancelled_after_shipping =
        // true" sozinho, como era antes) e' cego a QUAL guarda o antecede
        // -- achado de revisor de contexto limpo, sabotagem S5 (trocar
        // v_old_status = 'shipping' por 'pending' nesta guarda) passava
        // "verificada" com o marcador solto.
        //
        // A EXISTENCIA da coluna NAO e' provada por check_function_bodies
        // "validar tabela/coluna na CRIACAO da funcao" -- essa premissa e'
        // FALSA para LANGUAGE plpgsql (as duas funcoes desta migration
        // sao plpgsql): o Postgres so' valida referencia de tabela/coluna
        // dentro de um corpo plpgsql NA EXECUCAO daquele ramo, nunca na
        // criacao (doc oficial, "PL/pgSQL Under the Hood"). Quem prova a
        // coluna aqui e' outro mecanismo, mais estreito: cada migration
        // roda em transacao propria (db-apply.cjs, passo 2) e o script sai
        // por `process.exit(1)` ANTES desta verificacao se qualquer
        // comando falhar -- entao o ALTER TABLE ADD COLUMN do MESMO
        // ARQUIVO necessariamente rodou para chegar ate aqui. Isto so'
        // vale enquanto coluna e funcao estiverem no mesmo arquivo -- ver
        // o bloco de comentario logo acima desta entrada no mapa para o
        // SQL manual, caso um dia se separem.
        `    IF p_new_status = 'cancelled'
       AND v_old_status = 'shipping' THEN
        UPDATE public.marketplace_orders
           SET cancelled_after_shipping = true
         WHERE id = p_order_id;
    END IF;`,
        // 3. Bloco amarrado cobrindo as TRES clausulas da restauracao de
        // estoque, inclusive "AND v_old_status IS DISTINCT FROM
        // 'shipping'" -- a guarda que impede a peca voltar duas vezes para
        // o estoque (uma aqui, no cancelamento, e outra em
        // confirmar_retorno_do_produto quando o lojista confirma o
        // retorno). Achado de revisor de contexto limpo, sabotagem S6
        // (apagar so' esta clausula): um marcador por linha deixaria
        // passar, porque cada clausula continua existindo em outro ponto
        // do arquivo (a primeira em confirmar_pagamento, a segunda no
        // bloco 2 acima) -- so' o bloco amarrado das tres juntas detecta a
        // clausula que falta exatamente aqui.
        `    IF p_new_status = 'cancelled'
       AND v_old_status IS DISTINCT FROM 'cancelled'
       AND v_old_status IS DISTINCT FROM 'shipping' THEN`,
      ],
    },
    {
      funcao: "confirmar_retorno_do_produto",
      esperado: [
        // 4. A FUNCAO EXISTE: se ela nao existisse no catalogo,
        // pg_get_functiondef nao devolveria linha nenhuma, def sairia
        // undefined, e avaliarChecagem() classifica isso como
        // funcaoAusente antes mesmo de comparar qualquer marcador -- nenhum
        // dos demais abaixo sairia "ok" por acidente.
        "Não autorizado: só a loja confirma que o produto voltou.",
        // 5. ACHADO BLOQUEANTE de revisor de contexto limpo (segunda
        // rodada sobre esta migration): a entrada anterior desta checagem
        // tinha SO' os marcadores 4 e 6 (a RAISE de autorizacao e o SET
        // final) -- tudo o que fica ENTRE eles nao tinha marcador nenhum e
        // saia "verificada" mesmo com as duas guardas de estado, o FOR
        // UPDATE, a idempotencia e o PERFORM devolver_estoque apagados.
        // Medido contra o corpo real fatiado da migration: as cinco
        // sabotagens abaixo (S9-S13) davam "verificada" com a entrada
        // antiga.
        //
        // Este bloco cobre tres coisas amarradas: o FOR UPDATE da SELECT
        // (S13 -- sem ele, dois lojistas confirmando o MESMO pedido ao
        // mesmo tempo disputam a linha em vez de serializar); a guarda "nao
        // estava enviado quando foi cancelado" (S11); e a guarda "nao esta
        // mais cancelado" (S12) -- a que impede reconfirmar um pedido
        // reativado para outro status (comentario da propria migration:
        // pedido cancelado-apos-envio reativado para 'delivered', estoque
        // 499 -> 500 com o produto entregue).
        //
        // ACHADO BLOQUEANTE de revisor de contexto limpo (terceira rodada):
        // o bloco comecava em "WHERE id = p_order_id", deixando a SELECT que
        // ABRE este mesmo statement (a linha logo acima) fora de qualquer
        // marcador. S17b (trocar "cancelled_after_shipping" por um literal
        // "true" nesta SELECT, transformando v_cancelled_after_shipping numa
        // constante) saia "verificada": a guarda "IF NOT
        // v_cancelled_after_shipping" continuava intacta e o marcador
        // continuava casando, mas ela nunca dispararia -- a RPC passaria a
        // aceitar um pedido cancelado ainda em 'pending' (cujo estoque ja
        // tinha voltado no cancelamento) e devolver_estoque rodaria a
        // segunda vez: 499 -> 501, sem produto nenhum voltando.
        `    SELECT status, cancelled_after_shipping, returned_to_seller_at
      INTO v_status, v_cancelled_after_shipping, v_returned_at
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF NOT v_cancelled_after_shipping THEN
        RAISE EXCEPTION 'Este pedido não estava enviado quando foi cancelado: não há produto para voltar.';
    END IF;

    -- cancelled_after_shipping e' HISTORICO (nunca volta a false): se a loja
    -- reativou o pedido para outro status depois do cancelamento (ex.:
    -- 'delivered'), o produto NAO esta voltando -- esta entregue, na mao do
    -- cliente. Sem esta guarda a RPC ainda aceitava e creditava estoque
    -- fantasma. Medido: pedido cancelado-apos-envio reativado para
    -- 'delivered', estoque 499 -> 500 com o produto entregue.
    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Este pedido não está mais cancelado: não há retorno para confirmar.';
    END IF;`,
        // 6. Bloco amarrado cobrindo a guarda de IDEMPOTENCIA (S10 -- "dois
        // cliques dobram o estoque da loja", palavras da propria migration),
        // o PERFORM public.devolver_estoque(...) (S9 -- a RAZAO de esta
        // funcao existir: sem ele o lojista confirma o retorno e o estoque
        // nunca volta) e o UPDATE final que grava returned_to_seller_at.
        // Tambem prova, pelo mesmo raciocinio do marcador 2 acima, que a
        // coluna returned_to_seller_at EXISTE: se nao existisse, este CREATE
        // OR REPLACE FUNCTION teria falhado a aplicacao inteira.
        `    IF v_returned_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'ja_confirmado', true, 'returned_to_seller_at', v_returned_at);
    END IF;

    -- Mesmo laco de public.devolver_estoque(uuid) (20260807000000), sem nada
    -- alem dele -- reusa a funcao em vez de manter uma terceira copia do
    -- mesmo invariante (IF/ELSE variante XOR produto).
    PERFORM public.devolver_estoque(p_order_id);

    UPDATE public.marketplace_orders
       SET returned_to_seller_at = now()
     WHERE id = p_order_id;`,
      ],
    },
    {
      funcao: "devolver_cupons_de_pedidos_mortos",
      esperado: [
        // 7. A CLAUSULA NOVA do WHERE (Regra do Gabriel, 24/08/2026): sem
        // ela, a varredura devolvia a vaga do cupom de um pedido
        // cancelado-apos-envio com o produto AINDA na mao do cliente -- ver
        // o "DEFEITO MEDIDO" no comentario desta funcao, na propria
        // migration. Esta migration faz CREATE OR REPLACE nesta mesma
        // funcao -- a TERCEIRA das tres que ela redefine. Achado de
        // revisor de contexto limpo: sem esta entrada, esta migration
        // teria SO' as duas checagens acima (update_order_status_atomic,
        // confirmar_retorno_do_produto), as duas sairiam "verificada",
        // nenhuma checagem desta migration ficaria "pulada", e
        // resumirVerificacao() devolveria VERIFICADO (saida 0) com esta
        // terceira funcao nunca olhada -- o oposto do que se quer.
        //
        // Bloco amarrado, WHERE ate FOR UPDATE SKIP LOCKED com a SETIMA
        // clausula dentro -- mesmo formato ja usado (e confirmado pelo
        // revisor) na entrada de 20260901000000 acima. Marcador solto so'
        // na clausula nova deixaria passar o WHERE INTEIRO apagado, porque
        // o texto da clausula tambem aparece, verbatim, no comentario logo
        // acima dela (a mesma falha da Rodada 5, ver a entrada de
        // 20260901000000 acima).
        `WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND payment_status IS DISTINCT FROM 'pago'
          AND payment_status IS DISTINCT FROM 'pago_apos_expirar'
          AND coupon_usage_returned = FALSE
          AND (expires_at IS NULL OR expires_at < now() - interval '24 hours')
          AND (cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL)
        FOR UPDATE SKIP LOCKED`,
        // 8. ACHADO BLOQUEANTE de revisor de contexto limpo (terceira
        // rodada): o bloco acima (marcador 7) prova o WHERE, mas nada nesta
        // entrada provava o LACO em si — sem estes dois, S14 (apagar o
        // PERFORM public.devolver_uso_cupom dentro do LOOP) e S15 (apagar o
        // UPDATE ... SET coupon_usage_returned = TRUE) saiam "verificada".
        // S15 e' o pior dos dois: sem ele o proprio WHERE do marcador 7
        // (coupon_usage_returned = FALSE) continua casando o MESMO pedido em
        // todo ciclo do cron, e devolver_uso_cupom roda de novo a cada
        // ciclo -- o contador do cupom e' bombeado ate zero e fica em zero,
        // zerando inclusive uso legitimo futuro. Mesmos dois marcadores ja
        // usados (e confirmados pelo revisor) na entrada de 20260901000000
        // acima.
        "PERFORM public.devolver_uso_cupom(v_pedido.id);",
        "SET coupon_usage_returned = TRUE",
      ],
    },
  ],
  "20260990000000_fecha_custo_e_fornecedor_do_security_definer.sql": {
    funcao: "get_product_recommendations",
    esperado: [
      // A CORRECAO EM SI: custo e fornecedor_id saem NULOS do corpo da
      // funcao, em vez do valor real da tabela (SELECT * antigo). Sao os
      // dois marcadores que provam que a porta fechou NESTA funcao — sem
      // eles a migration poderia ter aplicado em qualquer outro lugar e a
      // verificacao passaria do mesmo jeito.
      "NULL::numeric(10,2),  -- custo: nunca sai desta funcao",
      "NULL::uuid,           -- fornecedor_id: nunca sai desta funcao",
      // Os dois marcadores acima tambem existem no corpo PRE-migration (o
      // texto "p.tags && v_tags" que morava aqui antes era so' do WHERE, e
      // sobrevivia sem mudanca nenhuma no corpo — nao provava a correcao
      // sozinho). Este terceiro marcador e' CONTIGUO, atravessa o
      // NULL::uuid e so' existe na forma NOVA (SELECT <lista de colunas>
      // sem ROW(...)::public.produtos em volta): se alguem reverter para
      // SELECT * (por engano) ou recolocar o embrulho ROW(...)::produtos,
      // esta faixa exata deixa de casar.
      `        p.estoque_minimo,
        NULL::uuid,           -- fornecedor_id: nunca sai desta funcao
        p.ativo,`,
    ],
  },
  // NOTA: get_active_products_internal nao entra aqui. A correcao dela nesta
  // migration e' um REVOKE EXECUTE, e o db-apply so sabe conferir marcador
  // dentro de CORPO DE FUNCAO (pg_get_functiondef) -- grant/revoke sai
  // sempre como PULADA, por desenho (ver cabecalho deste arquivo). A prova
  // de que o EXECUTE saiu de anon/authenticated e manual, por
  // has_function_privilege(...) -- receita no cabecalho da propria
  // migration (20260990000000_fecha_custo_e_fornecedor_do_security_definer.sql).
  "20261012000000_a_vitrine_sabe_que_o_produto_mudou.sql": [
    {
      funcao: "handle_produto_atualizado",
      esperado: [
        // A correcao inteira desta funcao cabe nesta linha: sem ela o
        // BEFORE UPDATE de produtos nao marca nada, e o defeito original
        // (catchUp nunca rebusca) continua intacto.
        "NEW.ultima_atualizacao = now();",
      ],
    },
    {
      funcao: "handle_variant_atualiza_produto",
      esperado: [
        // A guarda do reparenting -- sem ela, mover uma variante de produto
        // so' marcaria UM dos dois produtos, e o outro ficaria com oferta
        // desatualizada na vitrine sem nenhum sinal de mudanca.
        "OLD.product_id IS DISTINCT FROM NEW.product_id",
        // O ramo padrao (sem reparenting) -- contiguo do ELSE ate o END IF,
        // para que trocar o COALESCE por um dos dois IDs sozinho (perdendo
        // o caso INSERT ou o caso DELETE) reprove a verificacao.
        `    ELSE
        UPDATE public.produtos SET ultima_atualizacao = now()
         WHERE id = COALESCE(NEW.product_id, OLD.product_id);
    END IF;`,
      ],
    },
  ],
  "20261020000000_lojista_registra_pagamento_recebido.sql": [
    {
      funcao: "registrar_pagamento_recebido",
      esperado: [
        // BLOCOS AMARRADOS -- condicao E consequencia na mesma string. A versao
        // anterior desta entrada usava marcador de linha unica ("IF NOT
        // public.is_admin() THEN" sozinho) e um comentario que se dizia
        // "amarrado". Medido por revisor de contexto limpo: mantendo a linha e
        // trocando so' o RAISE por `NULL;`, a guarda vira no-op -- qualquer
        // cliente logado marca qualquer pedido como pago -- e os tres marcadores
        // continuavam CASANDO. Marcador que sobrevive a neutralizacao da guarda
        // nao verifica nada; ele so' registra que alguem digitou a palavra.
        "IF NOT public.is_admin() THEN\n        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';",
        "IF v_payment_method = 'online' THEN\n        RAISE EXCEPTION 'Este pedido é pago pelo site:",
        "ELSIF v_payment_status IS NOT NULL THEN\n            RAISE EXCEPTION 'Este pedido já tem pagamento registrado",
      ],
    },
  ],
  "20261021000000_receita_conta_so_dinheiro_que_entrou.sql": [
    {
      funcao: "get_admin_analytics_v2",
      esperado: [
        // 10x no corpo (medido): o predicado da receita reconhecida repete em
        // cada uma das portas de dinheiro da funcao. Contagem exata para a
        // queda de QUALQUER porta acusar, em vez de imprimir ok com as outras.
        //
        // 🔴 RESALVA da contagem: `vezes: 10` detecta MUDANCA DE QUANTIDADE,
        // nao de IDENTIDADE — apagar uma das portas e acrescentar outra em
        // outro ponto continua 10 e o marcador NAO acusa. Quem cobre o caso
        // que importa (dinheiro que o lojista recebeu e precisa devolver) e
        // o 13o ponto, abaixo, com marcador proprio e unico. Nao leia o
        // `vezes: 10` como prova forte: e' prova de que sao DEZ.
        {
          texto:
            "payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
          vezes: 10,
        },
        // O 13o ponto, do alarme `paid_on_cancelled`. Ele precisa de marcador
        // proprio porque `avaliarChecagem` usa `includes()`: o marcador acima
        // ja casaria com qualquer um dos 13 pontos, entao sozinho ele nao prova
        // que ESTE aqui foi trocado. E' o unico ponto cuja forma nao veio de
        // `payment_status IS NULL` -- ele alimenta o aviso da tela sobre dinheiro
        // que o lojista recebeu e precisa devolver (AdminOrdersView.tsx:1031).
        "payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled'",
      ],
    },
    {
      funcao: "get_admin_customers_paged",
      esperado: [
        "o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
      ],
    },
    {
      funcao: "get_segmented_push_targets",
      esperado: [
        "o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
      ],
    },
  ],
  "20261022000000_categorias_contam_so_dinheiro_reconhecido.sql": [
    {
      funcao: "get_category_analytics",
      esperado: [
        // O filtro NOVO desta migration: o literal das 3 portas, no formato
        // `o.` qualificado do JOIN — exatamente 1 ocorrência no corpo. Se a
        // contagem mudar, a categoria voltou a somar dinheiro sem dono ou
        // ganhou uma porta sem registro.
        {
          texto:
            "AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))",
          vezes: 1,
        },
        // A guarda de admin continua na primeira linha (SECURITY DEFINER).
        "Acesso negado: privilégios de administrador necessários.",
      ],
    },
  ],
  "20261023000000_push_conta_sem_baixar_credencial.sql": [
    {
      funcao: "get_segmented_push_count",
      esperado: [
        // Ramo VIP: o critério de dinheiro reconhecido + o corte de LTV.
        "HAVING SUM(o.total::numeric) >= p_min_ltv",
        // Ramo "new": a janela dos 7 dias, idêntica à original.
        "p.created_at >= NOW() - INTERVAL '7 days'",
        // A guarda de admin continua na primeira linha (SECURITY DEFINER).
        "Acesso negado: privilégios de administrador necessários.",
      ],
    },
  ],
  "20261025000000_cupom_diz_por_que_e_recusado.sql": [
    {
      // Item 16 do laudo de 29/08: a recusa final do cupom diz o MOTIVO.
      // Os 5 RAISE novos, exatamente 1 ocorrência por corpo — se a contagem
      // mudar, um motivo perdeu a frase ou o corpo divergiu do desenhado.
      funcao: "create_marketplace_order_v23",
      esperado: [
        { texto: "O cupom % não existe. Confira o código.", vezes: 1 },
        { texto: "O cupom % está desativado pela loja.", vezes: 1 },
        { texto: "O cupom % expirou em %.", vezes: 1 },
        { texto: "O cupom % já atingiu o limite de usos.", vezes: 1 },
        { texto: "O cupom % exige uma compra mínima de R$ %.", vezes: 1 },
      ],
    },
    {
      funcao: "create_marketplace_order_v24",
      esperado: [
        { texto: "O cupom % não existe. Confira o código.", vezes: 1 },
        { texto: "O cupom % está desativado pela loja.", vezes: 1 },
        { texto: "O cupom % expirou em %.", vezes: 1 },
        { texto: "O cupom % já atingiu o limite de usos.", vezes: 1 },
        { texto: "O cupom % exige uma compra mínima de R$ %.", vezes: 1 },
      ],
    },
  ],
  "20261026000000_o_pedido_avisa_o_cliente.sql": [
    {
      // Item 11 do laudo de 29/08: cada mudança de status do pedido nasce um
      // aviso no sino do cliente. As 4 frases e as 2 guardas, exatamente 1x
      // no corpo da função da trigger — se a contagem mudar, uma transição
      // perdeu a frase ou a guarda do convidado/corrida sumiu.
      funcao: "notifica_cliente_de_mudanca_de_status",
      esperado: [
        { texto: "Pedido em preparo", vezes: 1 },
        { texto: "Pedido a caminho", vezes: 1 },
        { texto: "Pedido entregue", vezes: 1 },
        { texto: "Pedido cancelado", vezes: 1 },
        { texto: "NEW.user_id IS NULL", vezes: 1 },
        { texto: "OLD.status IS NOT DISTINCT FROM NEW.status", vezes: 1 },
      ],
    },
  ],
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

  const avisoCommit = [
    "   O COMMIT do passo 2 já aconteceu — esta verificação roda DEPOIS dele, então",
    "   o que foi aplicado já está gravado no banco independente do resultado",
    '   acima; não há "não aplicar" a partir daqui.',
    `   Ponto de partida para desfazer: ${caminhoRollback}, salvo no passo 1 — leia`,
    "   acima o que ele cobre e o que continua manual.",
  ].join("\n");

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
      mensagem: `\nATENÇÃO: algum marcador esperado não conferiu — ausente, de menos ou de\nmais. Confira antes de confiar.\n   Verificações com marcador DIVERGENTE: ${lista}\n${listaPuladas}${avisoCommit}`,
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
    // N2: esta explicação só faz sentido quando o motivo de fato é "não
    // havia entrada nenhuma em VERIFICACOES" — ALTER TABLE, policy e grant
    // são a razão real disso. Quando o motivo é "a entrada registrada não
    // confere nenhum marcador" (esperado vazio ou só espaços), a migration
    // TEM entrada e provavelmente NÃO é DDL de tabela; imprimir esta frase
    // ali sugere uma causa que não é a que aconteceu.
    const explicacaoAlterTable = puladas.some(
      (r) => r.motivo === "nenhuma verificação registrada",
    )
      ? [
          "   O db-apply só sabe conferir marcador dentro de corpo de função",
          "   (pg_get_functiondef) — ALTER TABLE, policy, grant e REVOKE saem sempre",
          "   assim e precisam de conferência à mão.",
          "",
        ].join("\n")
      : "";
    return {
      estado: "PULADA",
      codigoSaida: 2,
      mensagem: `\nATENÇÃO: aplicado, mas NÃO VERIFICADO — isto não quer dizer que passou,\nquer dizer que ninguém conferiu.\n${resumoVerificadas}   Verificações puladas:\n     ${
        listaPuladas || "(nenhuma verificação informada)"
      }\n${explicacaoAlterTable}${avisoCommit}`,
    };
  }

  // Só chega aqui quando, depois da normalização acima, nenhum resultado é
  // "falhou" nem "pulada" e a lista não está vazia — ou seja, TODOS são
  // "verificada". VERIFICADO nunca é o caminho padrão: ele só sai de prova
  // positiva de cada um dos `normalizados.length` itens.
  return {
    estado: "VERIFICADO",
    codigoSaida: 0,
    mensagem: `\nTudo aplicado e verificado. (O COMMIT do passo 2 já aconteceu antes desta\nchecagem.) ${verificadas.length} de ${normalizados.length} verificações conferidas.`,
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
 * `algumMarcadorAusente`: algum dos marcadores comparados não apareceu
 *   NENHUMA vez na definição que ficou no banco?
 * `algumMarcadorDivergente`: algum dos marcadores comparados apareceu, mas
 *   um número de vezes diferente do declarado — de menos (parte do trecho
 *   sumiu no REPLACE) ou de mais (a função mudou de um jeito que ninguém
 *   previu)? Sinal PRÓPRIO, e não `algumMarcadorAusente` reaproveitado:
 *   "achou 3 onde esperava 2" não é ausência, e misturar os dois faria a
 *   palavra "ausente" mentir sobre a causa na hora de diagnosticar. Tem
 *   padrão `false` para que as chamadas anteriores a 20/08/2026 — e os
 *   testes delas — continuem significando exatamente o que significavam.
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
  algumMarcadorDivergente = false,
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
  if (algumMarcadorAusente || algumMarcadorDivergente) {
    return { situacao: "falhou" };
  }
  return { situacao: "verificada" };
}

/**
 * O rótulo de cada situação, na largura da coluna que o terminal imprime.
 * Sem um rótulo por situação, uma situação nova sairia como "undefined"
 * justamente na coluna que decide se o operador confia no que acabou de ser
 * comitado.
 */
const ROTULO_DA_SITUACAO = new Map([
  ["ok", "ok     "],
  ["ausente", "AUSENTE"],
  ["sumiu", "SUMIU  "],
  ["a_mais", "A MAIS "],
]);

/**
 * As duas formas de marcador aceitas no mapa VERIFICACOES, normalizadas em
 * `{ texto, vezes }`:
 *   - `"texto"`             → tem de aparecer EXATAMENTE 1 vez;
 *   - `{ texto, vezes: N }` → tem de aparecer EXATAMENTE N vezes.
 *
 * Assume marcador já validado por `marcadorBemFormado()`. Quem valida é a
 * guarda de `montarTarefasDeVerificacao()`, e não esta função, para que
 * entrada torta no mapa vire "pulada" — nunca um crash DEPOIS do COMMIT do
 * passo 2, cujo código de saída 1 quer dizer o contrário ("nada foi
 * comitado").
 */
function normalizarMarcador(bruto) {
  const marcador = typeof bruto === "string" ? { texto: bruto } : bruto;
  return { texto: marcador.texto, vezes: marcador.vezes ?? 1 };
}

/**
 * A forma que um marcador PRECISA ter para ser conferível: uma string, ou um
 * objeto `{ texto }` com `vezes` opcional. `vezes` fora de "inteiro a partir
 * de 1" é erro de digitação no mapa — e marcador que não prova nada é pior
 * que marcador nenhum, porque ele imprime "ok".
 */
function marcadorBemFormado(bruto) {
  if (typeof bruto === "string") return true;
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    return false;
  }
  if (typeof bruto.texto !== "string") return false;
  if (bruto.vezes === undefined) return true;
  return Number.isInteger(bruto.vezes) && bruto.vezes >= 1;
}

/** Ocorrências NÃO sobrepostas de `texto` em `corpo`. */
function contarOcorrencias(corpo, texto) {
  let total = 0;
  let de = corpo.indexOf(texto);
  while (de !== -1) {
    total += 1;
    de = corpo.indexOf(texto, de + texto.length);
  }
  return total;
}

function situacaoDe(achou, vezes) {
  // `vezes` menor que 1 nunca e' "ok", nem quando `achou` bate com ele.
  // Sem esta linha, conferirMarcador({ texto: "NAO EXISTE", vezes: 0 })
  // devolvia ok=true — zero ocorrencias "conferindo" com zero esperadas, ou
  // seja, prova nenhuma passando por prova. Hoje os dois chamadores filtram
  // marcador malformado antes (marcadorBemFormado/checagemBemFormada), mas
  // conferirMarcador e' exportado: quem chamar direto nao herda aquela
  // guarda, e uma funcao publica tem de carregar a propria.
  if (!Number.isInteger(vezes) || vezes < 1) return "malformado";
  if (achou === vezes) return "ok";
  if (achou === 0) return "ausente";
  return achou < vezes ? "sumiu" : "a_mais";
}

/**
 * Confere UM marcador contra o corpo que ficou no banco — por CONTAGEM
 * EXATA, nos dois sentidos.
 *
 * Até 20/08/2026 a comparação era `def.includes(marcador)`: bastava o texto
 * existir em QUALQUER ponto da função. Se o trecho que interessa fosse
 * apagado no CREATE OR REPLACE e o mesmo texto sobrevivesse noutro ponto,
 * saía "ok" e o veredito final saía VERIFICADO — depois do COMMIT, num
 * projeto sem PITR. Medido contra o banco de desenvolvimento naquele dia: 9
 * marcadores deste mapa casavam mais de uma vez, em 12 pontos.
 *
 * Achar de MENOS quer dizer que parte do trecho sumiu no REPLACE; achar de
 * MAIS quer dizer que a função mudou de um jeito que ninguém previu. As duas
 * coisas pedem olho humano antes de confiar, então as duas reprovam.
 */
function conferirMarcador(def, bruto) {
  const { texto, vezes } = normalizarMarcador(bruto);
  // Normaliza \r\n -> \n dos dois lados antes de contar. O repo nao tem
  // .gitattributes e core.autocrlf converte as migrations para CRLF no
  // working tree a cada checkout/clone/stash; sem isso, um marcador que
  // cruza uma quebra de linha (ex.: "ELSE\n            UPDATE ...") deixa
  // de casar contra um corpo em CRLF e a verificacao grita AUSENTE para
  // uma migration que esta correta — DEPOIS do COMMIT ja ter acontecido.
  const corpo = typeof def === "string" ? def.replace(/\r\n/g, "\n") : "";
  const achou = contarOcorrencias(corpo, texto.replace(/\r\n/g, "\n"));
  const situacao = situacaoDe(achou, vezes);
  return { texto, esperado: vezes, achou, situacao, ok: situacao === "ok" };
}

/**
 * Avalia UMA checagem completa — decide a situação, monta os textos das
 * linhas a imprimir e diz se a função estava ausente do schema. Recebe a
 * definição crua vinda do banco (`def`: string, ou `undefined` quando a
 * função não existe) e o objeto de checagem (`checagem`: `{ funcao,
 * esperado }`, ou `undefined` quando a migration não tem entrada nenhuma em
 * VERIFICACOES).
 *
 * Extraída para fechar a SEGUNDA metade do defeito de 20/08/2026. A rodada
 * anterior extraiu classificarChecagem() (a decisão pura a partir de três
 * booleanos), mas main() continuava computando esses booleanos — e no ramo
 * "sem entrada em VERIFICACOES" continuava passando LITERAIS escritos à mão
 * (`temRegistro: false, ...`) direto para classificarChecagem(), sem
 * nenhuma linha de teste exercitando esse caminho de verdade: mutar esses
 * literais para `true` deixava a suíte inteira verde. Agora quem decide
 * `temRegistro`/`algumMarcadorAvaliado`/`algumMarcadorAusente` é esta
 * função, a partir dos dados reais (`def`, `checagem`) — e ela é testada
 * direto com `avaliarChecagem(undefined, undefined)` reproduzindo o caso
 * literal de 20/08.
 *
 * `linhas` já vem como texto pronto para `console.log`, na ordem em que
 * devem aparecer: assim main() só imprime, nunca decide o que formatar.
 *
 * N1: um marcador vazio ou só espaço em branco NÃO conta como avaliado — na
 * comparação por presença, `"".includes("")` era sempre `true`, e sem esta
 * guarda `esperado: [""]` saía "ok" sem comparar nada; na comparação por
 * contagem, procurar texto vazio não tem resposta com sentido. Nos dois
 * casos a resposta certa é a mesma: a checagem sai "pulada" (ninguém
 * conferiu) em vez de "verificada".
 */
function avaliarChecagem(def, checagem) {
  if (checagem === undefined) {
    const { situacao, motivo } = classificarChecagem({
      temRegistro: false,
      algumMarcadorAvaliado: false,
      algumMarcadorAusente: false,
    });
    return {
      situacao,
      motivo,
      linhas: [],
      funcaoAusente: false,
      funcao: undefined,
    };
  }

  const funcaoAusente = def === undefined;
  const linhas = [];
  if (funcaoAusente) {
    // A2: o veredito abaixo (provavelmente AUSENTE em todo marcador) já fica
    // certo sozinho, mas o RÓTULO "AUSENTE" mente sobre a causa — faz
    // parecer que existe um corpo de função divergente para comparar,
    // quando na verdade a função simplesmente não existe no schema (pode
    // ser um no-op da migration, ou uma função com nome errado no mapa).
    linhas.push(
      `  (${checagem.funcao} não existe no schema — os marcadores abaixo saem AUSENTE por isso, não por divergência de corpo)`,
    );
  }

  let algumMarcadorAvaliado = false;
  let algumMarcadorAusente = false;
  let algumMarcadorDivergente = false;
  for (const marcadorBruto of checagem.esperado) {
    const { texto, vezes } = normalizarMarcador(marcadorBruto);
    if (texto.trim() === "") continue; // N1: vazio/espaço não é marcador.
    algumMarcadorAvaliado = true;
    const resultado = conferirMarcador(def, marcadorBruto);
    // Contagem errada NÃO é ausência: "achou 3 onde esperava 2" é a função
    // ter mudado de forma imprevista, e "achou 1 onde esperava 2" é metade
    // do trecho ter sumido no REPLACE. Os dois reprovam, por sinais
    // diferentes — ver classificarChecagem().
    if (resultado.situacao === "ausente") algumMarcadorAusente = true;
    else if (!resultado.ok) algumMarcadorDivergente = true;
    // A contagem vai na linha: "AUSENTE" sozinho não distingue "sumiu tudo"
    // de "sobrou uma cópia", e quem lê está decidindo DEPOIS do COMMIT.
    const contagem = resultado.ok
      ? `${resultado.achou}x`
      : `achou ${resultado.achou}x, o mapa declara ${vezes}x`;
    const rotulo = `${checagem.funcao}: ${texto.slice(0, 64)}`;
    linhas.push(
      `  ${ROTULO_DA_SITUACAO.get(resultado.situacao)}  (${contagem})  ${rotulo}`,
    );
  }

  const { situacao, motivo } = classificarChecagem({
    temRegistro: true,
    algumMarcadorAvaliado,
    algumMarcadorAusente,
    algumMarcadorDivergente,
  });
  return { situacao, motivo, linhas, funcaoAusente, funcao: checagem.funcao };
}

/**
 * Monta a lista de tarefas de verificação a partir dos arquivos aplicados e
 * do mapa VERIFICACOES — uma tarefa por CHECAGEM (uma função dentro de uma
 * migration), ou uma tarefa "vazia" (`checagem: undefined`) quando o
 * arquivo não tem entrada nenhuma no mapa. `linhasAntes` carrega a mensagem
 * de "sem verificação registrada" quando for o caso.
 *
 * Extraída para que main() não precise de um `if` para decidir quantas
 * checagens existem por arquivo, nem montar essa mensagem na hora: só
 * percorrer o que esta função já decidiu.
 */
/**
 * A forma que uma checagem PRECISA ter para ser conferível: uma função com
 * nome e uma lista de marcadores bem formados (string, ou `{ texto, vezes }`
 * — ver `marcadorBemFormado()`). Qualquer outra coisa é entrada malformada no
 * mapa — que vira "pulada", nunca sucesso e nunca crash.
 */
function checagemBemFormada(checagem) {
  return (
    typeof checagem === "object" &&
    checagem !== null &&
    !Array.isArray(checagem) &&
    typeof checagem.funcao === "string" &&
    checagem.funcao !== "" &&
    Array.isArray(checagem.esperado) &&
    // As DUAS formas de marcador passam aqui. Exigir `typeof m === "string"`
    // faria todo marcador com contagem (`{ texto, vezes }`) ser lido como
    // lixo: a checagem viraria "pulada" e o mapa deixaria de ser conferido
    // EM SILÊNCIO — pior desfecho possível, porque "pulada" não grita tanto
    // quanto "falhou" e a migration já está comitada.
    checagem.esperado.every((m) => marcadorBemFormado(m))
  );
}

function montarTarefasDeVerificacao(arquivos, verificacoes) {
  const tarefas = [];
  for (const nome of arquivos) {
    const base = path.basename(nome);
    const registro = verificacoes[base];
    // Qualquer coisa falsy (undefined, null, "", 0, false) e tambem a LISTA
    // VAZIA caem aqui, em "pulada". Os dois caminhos ja custaram caro:
    // trocar isto por `registro === undefined` fez `null` estourar TypeError
    // DEPOIS do COMMIT, e `[]` fazia o arquivo sumir do veredito inteiro —
    // nao virava tarefa, nao virava resultado, e o script imprimia "Tudo
    // aplicado e verificado" contando so' os outros. Entrada malformada no
    // mapa e' desconhecido, nunca sucesso e nunca crash.
    if (!registro || (Array.isArray(registro) && registro.length === 0)) {
      tarefas.push({
        base,
        checagem: undefined,
        linhasAntes: [`  ${base}: sem verificação registrada, pulando.`],
      });
      continue;
    }
    // Um arquivo pode redefinir mais de uma função (ex.: a mesma migration
    // reaplicada task a task) — registro vira lista nesse caso. Cada
    // checagem vira uma tarefa PRÓPRIA, não um flag agregado por arquivo: um
    // flag agregado deixaria uma segunda função sem `esperado` preenchido
    // passar escondida atrás da primeira, que conferiu normalmente.
    const checagens = Array.isArray(registro) ? registro : [registro];
    for (const checagem of checagens) {
      // A guarda acima cobre o RECIPIENTE; esta cobre o CONTEÚDO, e as duas
      // precisam existir. `{ funcao: "f" }` sem `esperado` — o "depois eu
      // preencho" — chegava em avaliarChecagem e estourava
      // `checagem.esperado is not iterable` DEPOIS do COMMIT do passo 2. E o
      // crash saía pelo main().catch com código 1, que é o MESMO código do
      // passo 2, onde ele quer dizer "Nada foi comitado desta migration":
      // quem lesse a tela concluiria que nada foi gravado, e tudo tinha sido.
      if (!checagemBemFormada(checagem)) {
        tarefas.push({
          base,
          checagem: undefined,
          linhasAntes: [
            `  ${base}: entrada malformada no mapa VERIFICACOES, tratada como sem verificação.`,
            `           Esperado { funcao: "nome", esperado: [...] }, onde cada item e' o texto`,
            "           do marcador (vale exatamente 1 ocorrencia) ou { texto, vezes } com",
            `           "vezes" inteiro >= 1 — corrija o mapa.`,
          ],
        });
        continue;
      }
      tarefas.push({ base, checagem, linhasAntes: [] });
    }
  }
  return tarefas;
}

/** Busca a definição atual de uma checagem no banco — `undefined` quando não há checagem (arquivo sem entrada em VERIFICACOES). */
async function buscarDef(client, checagem) {
  if (checagem === undefined) return undefined;
  const [def] = await definicaoAtual(client, checagem.funcao);
  return def;
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
  //
  // Esta seção não decide mais nada: montarTarefasDeVerificacao() já separou
  // o que precisa ser checado, buscarDef() só busca, avaliarChecagem() é
  // quem classifica cada checagem — aqui só sobra laço, chamada, print e
  // push. Se voltar a aparecer decisao aqui, o lugar dela e' dentro de uma
  // das funcoes puras acima — foi assim que este defeito sobreviveu a duas
  // correcoes: a fronteira andava em vez de fechar.
  console.log("\nVerificação:");
  const resultados = [];
  for (const tarefa of montarTarefasDeVerificacao(arquivos, VERIFICACOES)) {
    for (const linha of tarefa.linhasAntes) console.log(linha);
    const def = await buscarDef(client, tarefa.checagem);
    const avaliacao = avaliarChecagem(def, tarefa.checagem);
    for (const linha of avaliacao.linhas) console.log(linha);
    resultados.push({
      base: tarefa.base,
      funcao: avaliacao.funcao,
      situacao: avaliacao.situacao,
      motivo: avaliacao.motivo,
    });
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
// montarRollback), tests/db_apply_resumo_verificacao_test.ts
// (resumirVerificacao, classificarChecagem) e
// tests/db_apply_avaliar_checagem_test.ts (avaliarChecagem,
// montarTarefasDeVerificacao). O guarda acima existe por causa disso: sem
// ele, importar o módulo dispararia a aplicação das migrations.
module.exports = {
  funcoesAlteradas,
  montarRollback,
  resumirVerificacao,
  classificarChecagem,
  avaliarChecagem,
  montarTarefasDeVerificacao,
  conferirMarcador,
  checagemBemFormada,
  ROTULO_DA_SITUACAO,
  VERIFICACOES,
};

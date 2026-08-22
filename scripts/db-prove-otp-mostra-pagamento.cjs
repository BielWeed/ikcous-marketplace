#!/usr/bin/env node
/**
 * Prova a migration 20260950000000_rastreio_por_codigo_mostra_o_pagamento.sql.
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado — nem o
 * pedido de teste, nem os codigos, nem o CREATE OR REPLACE da funcao. Isso so
 * e verdade porque a migration NAO tem BEGIN/COMMIT embutido: se alguem
 * acrescentar um, este script passa a gravar de verdade sem avisar. Por isso a
 * primeira coisa que ele faz e RECUSAR a migration se achar controle de
 * transacao dentro dela.
 *
 * 🔴 ESTE SCRIPT SO RODA UMA VEZ, POR CONSTRUCAO — e isso e a trava
 * funcionando, nao regressao. Ele exige que o defeito REPRODUZA antes de
 * provar o conserto (controle negativo). Depois que a migration estiver
 * aplicada no banco, o defeito nao reproduz mais e ele se recusa a rodar.
 * A partir dai quem prova e estado real medido em conexao nova, nunca a
 * re-execucao deste arquivo.
 *
 * O QUE ELE PRECISA PROVAR, E POR QUE CADA CASO EXISTE
 *
 *   1. CONTROLE NEGATIVO — antes da migration, o pedido que vem pelo rastreio
 *      por codigo NAO tem a chave `payment_status`, mesmo estando pago.
 *      Sem isto, "depois esta certo" nao distingue conserto de defeito que
 *      nunca existiu.
 *
 *   2. O CONSERTO — depois, a chave existe e traz o valor real ('pago').
 *
 *   3. AUSENTE != NULO. O front (src/lib/mappers.ts:246) le
 *      `row.payment_status`, e chave ausente e chave com valor nulo dao os dois
 *      `undefined`/`null` la. Mas so uma das duas e o conserto: se a chave so
 *      aparecesse quando ha valor, um pedido sem cobranca continuaria mudo por
 *      um motivo diferente. Por isso um segundo pedido, com payment_status
 *      NULL, tem de voltar com a chave PRESENTE e valor nulo.
 *
 *   4. SO ISSO MUDOU. O objeto do pedido depois, TIRANDO a chave nova, tem de
 *      ser identico ao objeto de antes — **campo a campo, por VALOR**, e nao so
 *      no conjunto de chaves. E a versao em tempo de execucao da mesma pergunta
 *      que o diff de linhas responde no arquivo: o CREATE OR REPLACE reescreve
 *      a funcao inteira, entao "acrescentei uma linha" tem de ser medido.
 *
 *      🔴 Comparar `Object.keys()` NAO basta, e isso foi provado contra este
 *      proprio arquivo em 22/08/2026: um mutante que troca `'total', o.total`
 *      por `'total', o.subtotal` mantem o conjunto de chaves e passava 16/16,
 *      exit 0 — uma migration que faria todo pedido rastreado por codigo
 *      exibir o subtotal no lugar do total. **Um cabecalho que promete mais do
 *      que a assercao entrega e uma prova que mente sobre si mesma.**
 *
 *   5. OS ATRIBUTOS SOBREVIVERAM. CREATE OR REPLACE e SUBSTITUICAO: atributo
 *      que nao for repetido some em silencio. `prosecdef`, `proconfig`, o tipo
 *      de retorno, a linguagem e a ACL sao lidos PRESOS A ASSINATURA EXATA via
 *      `to_regprocedure` — nunca `rows[0]`, que leria uma linha arbitraria se
 *      houvesse sobrecarga.
 *
 *   6. O CONJUNTO DE ASSINATURAS NAO MUDOU — conjunto, nao contagem. Parametro
 *      a mais nao substitui: cria uma SEGUNDA funcao, e o app continuaria
 *      chamando a velha. Ha uma quebrada neste banco exatamente por isso
 *      (`get_retention_analytics`, erro 42725).
 *
 *   7. O INSTRUMENTO DISCRIMINA. No fim, dentro de um SAVEPOINT, o script
 *      SABOTA de proposito (recria a funcao sem SECURITY DEFINER) e exige que
 *      a checagem do caso 5 fique VERMELHA. Sem isso, as assercoes de atributo
 *      sao decorativas: um instrumento que aprova tudo da o mesmo verde que um
 *      instrumento que funciona.
 *
 *   8. A VOLTA TAMBEM E PROVADA. A reversao escrita a mao
 *      (rollback-manual-20260950000000_*.sql) roda na MESMA transacao, logo
 *      depois da ida, e a funcao tem de voltar ao estado original — texto do
 *      corpo E comportamento, com os atributos intactos. Reverter nao pode ser
 *      mais perigoso que aplicar: a reversao tambem e CREATE OR REPLACE.
 *
 *      O controle negativo da VOLTA e o que quase se perde: **antes de reverter,
 *      a chave tem de estar PRESENTE**. Sem isso, uma reversao que nao faz nada
 *      passa identica a uma que funciona — as duas terminam com a chave ausente.
 *
 * USO:  node scripts/db-prove-otp-mostra-pagamento.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "20260950000000_rastreio_por_codigo_mostra_o_pagamento.sql";
const REVERSAO =
  "rollback-manual-20260950000000_rastreio_por_codigo_mostra_o_pagamento.sql";
const ASSINATURA = "public.get_orders_by_otp_v1(text,text)";

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
  return Boolean(condicao);
}

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(RAIZ, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL nao encontrada em .env.local nem .env.");
}

/**
 * Controle de transacao no TOPO da migration — o que invalida o ROLLBACK desta
 * prova e faria o script gravar de verdade anunciando que nao gravou.
 *
 * 🔴 `END` NAO ESTA E NAO PODE ENTRAR NESTA LISTA. O `END;` que fecha o corpo
 * plpgsql e obrigatorio — a propria migration que este script prova tem um —
 * entao incluir `END` daria falso positivo em TODA migration que define funcao.
 * Isto esta escrito aqui de proposito: sem o motivo, o proximo editor
 * acrescenta `END`, tudo quebra, e ele reverte sem entender o que era a trava.
 *
 * O `BEGIN` do plpgsql nao tem `;` colado, e por isso nao casa — mas os
 * sinonimos com `;` casam, que era o buraco: ate 22/08/2026 esta trava so via
 * `BEGIN;`, `COMMIT;` e `ROLLBACK;`, e deixava passar `COMMIT WORK;`,
 * `COMMIT TRANSACTION;` e `START TRANSACTION;`. Falha ABERTA, o pior tipo.
 */
const CONTROLE_DE_TRANSACAO = [
  "BEGIN;",
  "BEGIN WORK;",
  "BEGIN TRANSACTION;",
  "COMMIT;",
  "COMMIT WORK;",
  "COMMIT TRANSACTION;",
  "ROLLBACK;",
  "ROLLBACK WORK;",
  "ROLLBACK TRANSACTION;",
  "START TRANSACTION",
];

/**
 * Normaliza para comparacao por prefixo LITERAL em vez de regex.
 *
 * A primeira versao usava uma expressao com quantificadores aninhados
 * (`\s*...\s+...\s*`) e o eslint acusou `security/detect-unsafe-regex` — e ele
 * estava certo: neste repositorio aviso NOVO reprova a catraca igual a erro,
 * e uma trava de seguranca nao deve depender de uma expressao com risco de
 * retrocesso exponencial. Prefixo literal e mais barato de ler e de provar.
 */
function normalizar(linha) {
  return linha.trim().replace(/\s+/g, " ").replace(/ ;/g, ";").toUpperCase();
}

function ehControleDeTransacao(linha) {
  const normalizada = normalizar(linha);
  return CONTROLE_DE_TRANSACAO.some((inicio) => normalizada.startsWith(inicio));
}

/**
 * Prova que a trava acima DISCRIMINA, antes de confiar nela.
 *
 * Positivo sozinho aprovaria uma trava que barra tudo; negativo sozinho
 * aprovaria uma trava que nao barra nada. Os dois juntos sao o minimo — e esta
 * checagem roda ANTES de qualquer conexao com o banco, e ABORTA. Uma trava de
 * seguranca que nunca foi testada nao e trava, e uma que falha aberta e pior
 * que nenhuma, porque produz confianca.
 */
function provarATrava() {
  const deveBarrar = [
    "BEGIN;",
    "  begin ;",
    "BEGIN WORK;",
    "BEGIN TRANSACTION;",
    "COMMIT;",
    "COMMIT WORK;",
    "COMMIT TRANSACTION;",
    "  commit work ;",
    "ROLLBACK;",
    "ROLLBACK WORK;",
    "START TRANSACTION;",
    "  start transaction isolation level serializable;",
  ];
  const devePassar = [
    "END;", // 🔴 o fecho do corpo plpgsql — o falso positivo que se evita
    "    END;",
    "END IF;",
    "BEGIN", // o BEGIN do plpgsql, sem ';'
    "    BEGIN",
    "-- COMMIT; num comentario",
    "  RETURN jsonb_build_object('ok', true);",
  ];

  const passouIndevido = deveBarrar.filter((l) => !ehControleDeTransacao(l));
  const barrouIndevido = devePassar.filter(ehControleDeTransacao);

  if (passouIndevido.length > 0 || barrouIndevido.length > 0) {
    throw new Error(
      `a trava de transacao nao discrimina. Passou indevidamente: ${JSON.stringify(passouIndevido)}. Barrou indevidamente: ${JSON.stringify(barrouIndevido)}.`,
    );
  }
  console.log(
    `  ok   trava de transacao: barra ${deveBarrar.length} formas, deixa passar ${devePassar.length} legitimas`,
  );
}

/**
 * Campos que mudam entre dois pedidos por construcao e nao dizem nada sobre a
 * migration. Tudo o mais e comparado VALOR A VALOR — ver caso 5.
 */
const CAMPOS_VOLATEIS = new Set(["id", "created_at", "updated_at", "order_id"]);

/**
 * Copia profunda com os volateis fora e as chaves ordenadas, para comparar por
 * texto. Percorre por `Object.entries`, nao por indexacao dinamica — o eslint
 * acusa `security/detect-object-injection` na segunda forma, e aqui aviso novo
 * reprova a catraca.
 */
function semVolateis(valor) {
  if (Array.isArray(valor)) return valor.map(semVolateis);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([chave]) => !CAMPOS_VOLATEIS.has(chave))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([chave, dentro]) => [chave, semVolateis(dentro)]),
    );
  }
  return valor;
}

/**
 * Le um SQL e RECUSA se ele tiver controle de transacao no topo. Serve para a
 * ida e para a volta: a reversao roda dentro da MESMA transacao desta prova, e
 * um `COMMIT;` dentro dela gravaria tudo do mesmo jeito.
 */
function lerSqlSemControleDeTransacao(caminho, rotulo) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(caminho, "utf8");

  const controle = sql.split("\n").filter(ehControleDeTransacao);
  if (controle.length > 0) {
    throw new Error(
      `${rotulo} tem controle de transacao no topo (${controle.length} linha(s)). Com ele o ROLLBACK desta prova vira no-op e a mudanca ficaria GRAVADA. Recusando.`,
    );
  }
  return sql;
}

function lerMigration() {
  return lerSqlSemControleDeTransacao(
    path.join(RAIZ, "supabase", "migrations", MIGRATION),
    MIGRATION,
  );
}

function lerReversao() {
  return lerSqlSemControleDeTransacao(path.join(RAIZ, REVERSAO), REVERSAO);
}

/** Estado da funcao, preso a assinatura exata. Nunca rows[0] de uma varredura. */
async function estadoDaFuncao(client) {
  const { rows } = await client.query(
    `SELECT p.prosecdef,
            p.proconfig,
            pg_get_function_result(p.oid)     AS retorno,
            pg_get_function_identity_arguments(p.oid) AS argumentos,
            l.lanname                          AS linguagem,
            COALESCE(p.proacl::text, '<default>') AS acl,
            (p.prosrc ~ 'payment_status')      AS expoe_pagamento
       FROM pg_proc p
       JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure($1)`,
    [ASSINATURA],
  );
  if (rows.length !== 1) {
    throw new Error(
      `esperava exatamente 1 funcao em ${ASSINATURA}, achei ${rows.length}`,
    );
  }
  return rows[0];
}

/** CONJUNTO de assinaturas com esse nome — nao a contagem. */
async function assinaturas(client) {
  const { rows } = await client.query(
    `SELECT p.oid::regprocedure::text AS assinatura
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_orders_by_otp_v1'
      ORDER BY 1`,
  );
  return rows.map((r) => r.assinatura);
}

/** Cria um pedido e o codigo de rastreio que aponta para ele. */
async function montarCenario(client, { email, otp, paymentStatus }) {
  const { rows: pedido } = await client.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, status, payment_status,
        total, subtotal, shipping, discount, payment_method)
     VALUES ('PROVA OTP', '{"email":"prova@exemplo.invalido"}'::jsonb,
             'pending', $1, 110.00, 100.00, 10.00, 0, 'pix')
     RETURNING id`,
    [paymentStatus],
  );
  const orderId = pedido[0].id;

  // Um item de verdade: sem ele `items` volta `[]` nos dois cenarios e a
  // comparacao por valor do caso 5 nao alcancaria o sub-SELECT dos itens.
  await client.query(
    `INSERT INTO public.marketplace_order_items
       (order_id, product_name, quantity, price)
     VALUES ($1, 'PROVA OTP - item', 1, 100.00)`,
    [orderId],
  );

  await client.query(
    `INSERT INTO public.otp_verifications
       (email, whatsapp, otp_code, expires_at, verified, order_id, attempts)
     VALUES ($1, '34999999999', $2, NOW() + interval '10 minutes', false, $3, 0)`,
    [email, otp, orderId],
  );
  return orderId;
}

/** Chama a RPC e devolve o objeto do UNICO pedido que ela retorna. */
async function pedidoPeloCodigo(client, { email, otp }) {
  const { rows } = await client.query(
    "SELECT public.get_orders_by_otp_v1($1, $2) AS r",
    [email, otp],
  );
  const r = rows[0].r;
  if (!r || r.ok !== true) {
    throw new Error(`a RPC recusou o codigo: ${JSON.stringify(r)}`);
  }
  if (!Array.isArray(r.orders) || r.orders.length !== 1) {
    throw new Error(
      `esperava 1 pedido, vieram ${Array.isArray(r.orders) ? r.orders.length : "nao-array"}`,
    );
  }
  return r.orders[0];
}

async function main() {
  // A trava se prova ANTES de qualquer conexao, e aborta se nao discriminar.
  console.log("\n0. A TRAVA DE TRANSACAO SE PROVA ANTES DE SER USADA");
  provarATrava();

  const sqlMigration = lerMigration();
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    // ---- trava do controle negativo -------------------------------------
    const antesDaFuncao = await estadoDaFuncao(client);
    if (antesDaFuncao.expoe_pagamento) {
      console.error(
        "\n🔴 RECUSANDO: get_orders_by_otp_v1 JA expoe payment_status neste banco.\n" +
          "   Esta prova exige que o defeito REPRODUZA antes de provar o conserto, e ele\n" +
          "   nao reproduz mais. Isso e a trava funcionando, nao regressao — a migration\n" +
          "   provavelmente ja foi aplicada. Daqui para a frente, quem prova e estado real\n" +
          "   medido em conexao nova.",
      );
      await client.query("ROLLBACK");
      await client.end();
      process.exit(2);
    }

    const assinaturasAntes = await assinaturas(client);

    console.log(
      "\n1. CONTROLE NEGATIVO — o defeito reproduz antes da migration",
    );
    await montarCenario(client, {
      email: "prova-otp-pago@exemplo.invalido",
      otp: "111111",
      paymentStatus: "pago",
    });
    const antes = await pedidoPeloCodigo(client, {
      email: "prova-otp-pago@exemplo.invalido",
      otp: "111111",
    });
    conferir(
      "antes: o pedido pago volta SEM a chave payment_status",
      !("payment_status" in antes),
      `chaves: ${Object.keys(antes).join(", ")}`,
    );
    conferir(
      "antes: o pedido volta com as outras chaves (o cenario e valido)",
      antes.status === "pending" && Number(antes.total) === 110,
      `status ${antes.status}, total ${antes.total}`,
    );

    // ---- aplica a migration DENTRO da transacao --------------------------
    console.log(
      "\n2. Aplicando a migration (dentro da transacao, sera desfeita)",
    );
    await client.query(sqlMigration);

    console.log("\n3. O CONSERTO");
    await montarCenario(client, {
      email: "prova-otp-pago-2@exemplo.invalido",
      otp: "222222",
      paymentStatus: "pago",
    });
    const depois = await pedidoPeloCodigo(client, {
      email: "prova-otp-pago-2@exemplo.invalido",
      otp: "222222",
    });
    conferir(
      "depois: a chave payment_status existe e vale 'pago'",
      depois.payment_status === "pago",
      `veio ${JSON.stringify(depois.payment_status)}`,
    );

    console.log(
      "\n4. AUSENTE != NULO — pedido sem cobranca traz a chave, com valor nulo",
    );
    await montarCenario(client, {
      email: "prova-otp-nulo@exemplo.invalido",
      otp: "333333",
      paymentStatus: null,
    });
    const semCobranca = await pedidoPeloCodigo(client, {
      email: "prova-otp-nulo@exemplo.invalido",
      otp: "333333",
    });
    conferir(
      "depois: pedido sem cobranca tem a chave PRESENTE",
      "payment_status" in semCobranca,
      `chaves: ${Object.keys(semCobranca).join(", ")}`,
    );
    conferir(
      "depois: e o valor dela e nulo",
      semCobranca.payment_status === null,
      `veio ${JSON.stringify(semCobranca.payment_status)}`,
    );

    console.log("\n5. SO ISSO MUDOU — o resto do objeto e identico");
    // 🔴 COMPARACAO POR VALOR, NAO POR CONJUNTO DE CHAVES. Ate 22/08/2026 este
    // caso comparava so `Object.keys()`, e uma revisao de contexto limpo
    // DERRUBOU a prova com um mutante: trocar `'total', o.total` por
    // `'total', o.subtotal` mantem o mesmo conjunto de chaves e faz todo pedido
    // rastreado por codigo exibir o subtotal no lugar do total — o frete
    // sumindo da conta, na tela de quem nao tem login. Passava 16/16, exit 0.
    //
    // Os dois cenarios sao montados com os MESMOS valores de proposito, entao
    // tirando o que muda por construcao (`id`, `created_at`, `updated_at`,
    // `order_id`) os objetos tem de ser identicos campo a campo, inclusive
    // dentro de `items`.
    const antesNormalizado = semVolateis(antes);
    const depoisNormalizado = semVolateis(depois);
    const depoisSemANova = Object.fromEntries(
      Object.entries(depoisNormalizado).filter(
        ([chave]) => chave !== "payment_status",
      ),
    );
    conferir(
      "depois: o objeto inteiro e o de antes + payment_status — mesmos VALORES, nao so as mesmas chaves",
      JSON.stringify(antesNormalizado) === JSON.stringify(depoisSemANova),
      `antes  ${JSON.stringify(antesNormalizado)}\n         depois ${JSON.stringify(depoisSemANova)}`,
    );
    conferir(
      "depois: o item do pedido continua sendo montado dentro de `items`",
      Array.isArray(depois.items) &&
        depois.items.length === 1 &&
        Number(depois.items[0].price) === 100,
      `items = ${JSON.stringify(depois.items)}`,
    );

    console.log("\n6. OS ATRIBUTOS SOBREVIVERAM ao CREATE OR REPLACE");
    const depoisDaFuncao = await estadoDaFuncao(client);
    conferir(
      "SECURITY DEFINER preservado",
      depoisDaFuncao.prosecdef === true && antesDaFuncao.prosecdef === true,
      `antes ${antesDaFuncao.prosecdef}, depois ${depoisDaFuncao.prosecdef}`,
    );
    conferir(
      "search_path preservado",
      JSON.stringify(depoisDaFuncao.proconfig) ===
        JSON.stringify(antesDaFuncao.proconfig),
      `antes ${JSON.stringify(antesDaFuncao.proconfig)}, depois ${JSON.stringify(depoisDaFuncao.proconfig)}`,
    );
    conferir(
      "tipo de retorno preservado (jsonb)",
      depoisDaFuncao.retorno === antesDaFuncao.retorno,
      `antes ${antesDaFuncao.retorno}, depois ${depoisDaFuncao.retorno}`,
    );
    conferir(
      "linguagem preservada (plpgsql)",
      depoisDaFuncao.linguagem === antesDaFuncao.linguagem,
      `antes ${antesDaFuncao.linguagem}, depois ${depoisDaFuncao.linguagem}`,
    );
    conferir(
      "permissoes (ACL) preservadas",
      depoisDaFuncao.acl === antesDaFuncao.acl,
      `antes ${antesDaFuncao.acl}, depois ${depoisDaFuncao.acl}`,
    );

    console.log(
      "\n7. O CONJUNTO DE ASSINATURAS NAO MUDOU (conjunto, nao contagem)",
    );
    const assinaturasDepois = await assinaturas(client);
    conferir(
      "nenhuma funcao nova com o mesmo nome foi criada",
      JSON.stringify(assinaturasAntes) === JSON.stringify(assinaturasDepois),
      `antes [${assinaturasAntes.join(" | ")}] vs depois [${assinaturasDepois.join(" | ")}]`,
    );

    console.log(
      "\n8. CONTROLE DO INSTRUMENTO — sabotagem tem de ficar VERMELHA",
    );
    await client.query("SAVEPOINT sabotagem");
    // Mesma funcao, mesmo corpo, SEM SECURITY DEFINER e SEM search_path: e
    // exatamente o que um CREATE OR REPLACE descuidado produz.
    await client.query(`
      CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1("p_email" "text", "p_otp" "text")
      RETURNS "jsonb" LANGUAGE plpgsql
      AS $sabotagem$ BEGIN RETURN jsonb_build_object('ok', false); END; $sabotagem$;
    `);
    const sabotada = await estadoDaFuncao(client);
    const pegouSecDef = sabotada.prosecdef === false;
    const pegouSearchPath =
      JSON.stringify(sabotada.proconfig) !==
      JSON.stringify(antesDaFuncao.proconfig);
    conferir(
      "a checagem de SECURITY DEFINER ACUSA quando ele some",
      pegouSecDef,
      `prosecdef da versao sabotada veio ${sabotada.prosecdef}`,
    );
    conferir(
      "a checagem de search_path ACUSA quando ele some",
      pegouSearchPath,
      `proconfig da versao sabotada veio ${JSON.stringify(sabotada.proconfig)}`,
    );
    await client.query("ROLLBACK TO SAVEPOINT sabotagem");
    await client.query("RELEASE SAVEPOINT sabotagem");

    const restaurada = await estadoDaFuncao(client);
    conferir(
      "a sabotagem foi desfeita (a versao boa voltou)",
      restaurada.prosecdef === true && restaurada.expoe_pagamento === true,
      `prosecdef ${restaurada.prosecdef}, expoe_pagamento ${restaurada.expoe_pagamento}`,
    );

    console.log("\n9. A VOLTA — a reversao escrita a mao desfaz a ida");
    // CONTROLE NEGATIVO DA VOLTA: so faz sentido reverter o que esta aplicado.
    // Sem esta assercao, uma reversao que nao faz nada "passaria" identica a uma
    // que funciona — as duas deixariam a chave ausente no fim.
    conferir(
      "antes de reverter: a chave payment_status ESTA presente (ha o que desfazer)",
      restaurada.expoe_pagamento === true,
      `expoe_pagamento veio ${restaurada.expoe_pagamento}`,
    );

    await client.query(lerReversao());
    const revertida = await estadoDaFuncao(client);

    conferir(
      "depois de reverter: a funcao volta a NAO expor payment_status",
      revertida.expoe_pagamento === false,
      `expoe_pagamento veio ${revertida.expoe_pagamento}`,
    );

    // A prova de comportamento, nao so de texto do corpo: um pedido pago volta
    // a chegar sem a chave, que e exatamente o estado de antes da ida.
    await montarCenario(client, {
      email: "prova-otp-revertido@exemplo.invalido",
      otp: "444444",
      paymentStatus: "pago",
    });
    const depoisDaVolta = await pedidoPeloCodigo(client, {
      email: "prova-otp-revertido@exemplo.invalido",
      otp: "444444",
    });
    conferir(
      "depois de reverter: o pedido pago volta SEM a chave, como antes da ida",
      !("payment_status" in depoisDaVolta),
      `chaves: ${Object.keys(depoisDaVolta).join(", ")}`,
    );
    conferir(
      "depois de reverter: o objeto e identico ao do estado original",
      JSON.stringify(semVolateis(depoisDaVolta)) ===
        JSON.stringify(antesNormalizado),
      `voltou ${JSON.stringify(semVolateis(depoisDaVolta))}`,
    );

    // 🔴 REVERTER NAO PODE SER MAIS PERIGOSO QUE APLICAR. A reversao tambem e
    // CREATE OR REPLACE, entao ela apaga em silencio o atributo que nao repetir.
    conferir(
      "depois de reverter: SECURITY DEFINER, search_path, retorno e ACL intactos",
      revertida.prosecdef === antesDaFuncao.prosecdef &&
        JSON.stringify(revertida.proconfig) ===
          JSON.stringify(antesDaFuncao.proconfig) &&
        revertida.retorno === antesDaFuncao.retorno &&
        revertida.acl === antesDaFuncao.acl,
      `prosecdef ${revertida.prosecdef}, proconfig ${JSON.stringify(revertida.proconfig)}, retorno ${revertida.retorno}`,
    );
    conferir(
      "depois de reverter: o conjunto de assinaturas continua o mesmo",
      JSON.stringify(await assinaturas(client)) ===
        JSON.stringify(assinaturasAntes),
      "a reversao criou ou removeu uma sobrecarga",
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  console.log(
    "ROLLBACK executado: nada foi gravado no banco — nem a migration, nem o cenario.",
  );
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

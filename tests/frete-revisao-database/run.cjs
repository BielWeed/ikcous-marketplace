"use strict";

/**
 * Ensaio local da migration 20261170000000_a_cotacao_de_frete_confere_a_revisao.sql
 * (R3-3 — a RPC confere a revisão das credenciais de frete). Ver README.md desta
 * pasta: NÃO é rodado pelo CI automático; roda um Postgres 17 efêmero e
 * descartável via Docker, criado e destruído por este próprio script.
 *
 * USO: node tests/frete-revisao-database/run.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os dois caminhos lidos aqui (migration e rollback desta pasta) são
 * montados só a partir de ROOT (__dirname) e de literais deste arquivo —
 * nunca de entrada de rede nem de terceiro. Mesma convenção de
 * tests/banco/aplicar-migrations.cjs. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..", "..");
const CONTAINER = `ikcous-frete-revisao-ci-${process.pid}-${Date.now()}`;

function log(msg) {
  console.log(`[frete-revisao] ${msg}`);
}

function achaPortaLivre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function rodar(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} falhou (status ${r.status}):\n${r.stderr || r.stdout}`,
    );
  }
  return r.stdout;
}

function rodarNode(scriptRelativo, args, env) {
  const r = spawnSync(process.execPath, [scriptRelativo, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
    timeout: 120000,
  });
  console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  if (r.status !== 0) {
    throw new Error(`${scriptRelativo} falhou (status ${r.status})`);
  }
}

async function esperarPostgresPronto(tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    const r = spawnSync(
      "docker",
      ["exec", CONTAINER, "pg_isready", "-U", "postgres"],
      {
        encoding: "utf8",
      },
    );
    if (r.status === 0) return;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  throw new Error("Postgres efêmero não ficou pronto a tempo.");
}

// Hash sha256 EXATO do prosrc que a 20261169000000 deixa (LF, medido contra
// um Postgres efêmero -- ver CHECKPOINT-M.txt). O rollback tem de devolver
// EXATAMENTE isto, não "qualquer coisa diferente do hash pós-apply".
const HASH_V23_20261169 =
  "5c52deac71558be252c5e8c1d382c2c072085aa47611213185935086863f2300";
const HASH_V24_20261169 =
  "e3789fb458a53bf687c8351ecd5d513664e47b09618825eec99bb6330e316117";

// ---- Fixtures determinísticos --------------------------------------------
const U_CLIENTE = "11111111-1111-1111-1111-111111111111";
const P_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORIGEM_CEP = "38500-000";
const DEST_NACIONAL = "01000-000"; // fora da faixa local de propósito -- caso 3
const DEST_CASO1 = "02000-000"; // caso 1 + caso 2 (mesma linha de cache)
const DEST_CASO5 = "03000-000"; // caso 5 (concorrência)
const DEST_CASO2B = "04000-000"; // caso 2b (edge velha, sem revisaoCredenciais)
const FAIXA_LOCAL = "38500000-38505000";

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId || "",
  ]);
}

async function garantirUsuario(cliente, userId) {
  await cliente.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'prova@example.com', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [userId],
  );
}

async function garantirLojaFixture(cliente, extra = {}) {
  await cliente.query(
    // FORMAS DE PAGAMENTO POR LOJA (25/09/2026, migration 20261174000000):
    // `pagamento_online = true` entrou na lista -- o invariante novo
    // (forma_de_pagamento_aceita) recusa 'online' com
    // FORMA_DE_PAGAMENTO_DESLIGADA quando a coluna está no padrão (false), e
    // este arquivo tem chamadas (:335+) com `pagamento: "online"`. Mesma
    // conexão privilegiada que já escreve outras colunas fora de RPC.
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage,
        enabled_shipping_methods, store_address, local_delivery_fee,
        pagamento_online)
     VALUES (1, $1, $2, 0, 'national', $3, $4, 0, true)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage,
           enabled_shipping_methods = EXCLUDED.enabled_shipping_methods,
           store_address = EXCLUDED.store_address,
           local_delivery_fee = EXCLUDED.local_delivery_fee,
           pagamento_online = true`,
    [
      ORIGEM_CEP,
      FAIXA_LOCAL,
      extra.enabledShippingMethods || null,
      extra.storeAddress || null,
    ],
  );
}

async function garantirProduto(cliente) {
  await cliente.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto de prova', 50.00, 999, true, false)
     ON CONFLICT (id) DO UPDATE SET estoque = 999, ativo = true`,
    [P_A],
  );
}

async function gravarRevisao(cliente, revisao) {
  await cliente.query(
    `INSERT INTO public.store_shipping_credentials (provider, credentials, updated_at)
     VALUES ('_revisao', jsonb_build_object('revisao', $1::text), now())
     ON CONFLICT (provider) DO UPDATE SET credentials = EXCLUDED.credentials, updated_at = now()`,
    [revisao],
  );
}

async function gravarCotacao(
  cliente,
  { destino, optId, preco, revisaoCredenciais },
) {
  const cartHash = `${P_A}::1`;
  const opcao = { id: optId, price: preco };
  if (revisaoCredenciais !== undefined)
    opcao.revisaoCredenciais = revisaoCredenciais;
  await cliente.query(
    `INSERT INTO public.shipping_quotes_cache (origin_cep, destination_cep, cart_hash, options, created_at)
     VALUES ($1, $2, $3, $4::jsonb, now())`,
    [ORIGEM_CEP, destino, cartHash, JSON.stringify([opcao])],
  );
}

function itensDoCarrinho() {
  return JSON.stringify([{ product_id: P_A, variant_id: null, quantity: 1 }]);
}

async function chamarRpc(
  cliente,
  fn,
  { optId, destino, total, pagamento, idempKey },
) {
  const params = [
    itensDoCarrinho(),
    total,
    0,
    pagamento,
    null,
    null,
    "Cliente de Prova",
    "5539000000000",
    null,
    JSON.stringify({ cep: destino, rua: "Rua da Prova", numero: "1" }),
    destino,
    optId,
    idempKey || null,
  ];
  return cliente.query(
    `SELECT public.${fn}(
       $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid,
       $6::text, $7::text, $8::text, $9::text, $10::jsonb,
       $11::text, $12::text, $13::uuid
     ) AS id`,
    params,
  );
}

async function contarPedidos(cliente) {
  const r = await cliente.query(
    "SELECT count(*)::int AS n FROM public.marketplace_orders",
  );
  return r.rows[0].n;
}

async function contarItens(cliente) {
  const r = await cliente.query(
    "SELECT count(*)::int AS n FROM public.marketplace_order_items",
  );
  return r.rows[0].n;
}

async function hashCorpo(cliente, fn) {
  const sig = `${fn}(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)`;
  const r = await cliente.query(
    "SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
    [`public.${sig}`],
  );
  return r.rows[0] ? r.rows[0].h : null;
}

async function assertRejeitado(promessa, regex, contexto) {
  try {
    await promessa;
    throw new Error(
      `Esperava rejeição em "${contexto}", mas a RPC teve sucesso.`,
    );
  } catch (erro) {
    const msg = erro.message || "";
    assert.match(msg, regex, `"${contexto}": mensagem inesperada: ${msg}`);
  }
}

async function main() {
  const dockerVersion = spawnSync("docker", ["version"], { encoding: "utf8" });
  if (dockerVersion.status !== 0) {
    log(
      "Docker não disponível nesta máquina -- ensaio não pode rodar aqui. " +
        "Escreva a migration como está e valide num ambiente com Docker (ou no CI, " +
        "quando esta suíte for cadastrada).",
    );
    process.exitCode = 1;
    return;
  }

  const porta = await achaPortaLivre();
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${porta}/postgres`;
  log(`subindo container ${CONTAINER} na porta ${porta}`);
  rodar("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=postgres",
    "-p",
    `${porta}:5432`,
    "postgres:17",
  ]);

  try {
    await esperarPostgresPronto();
    log("postgres efêmero pronto");

    const env = { DATABASE_URL: databaseUrl, CI_BANCO_EFEMERO: "1" };
    rodarNode("tests/banco/provisionar.cjs", [], env);
    rodarNode(
      "tests/banco/aplicar-migrations.cjs",
      ["supabase/migrations"],
      env,
    );

    const cliente = new Client({ connectionString: databaseUrl });
    // O container pode morrer no `finally` enquanto ainda há promessas
    // pendentes de um erro de asserção -- sem este handler, o socket
    // fechado abruptamente derruba o processo com um 'error' não tratado.
    cliente.on("error", () => {});
    await cliente.connect();

    await garantirProduto(cliente);
    await garantirUsuario(cliente, U_CLIENTE);
    await logar(cliente, U_CLIENTE);

    // ---- Hash logo após a raiz inteira: prova a migration nova instalada ----
    const hashV23DepoisDoApply = await hashCorpo(
      cliente,
      "create_marketplace_order_v23",
    );
    const hashV24DepoisDoApply = await hashCorpo(
      cliente,
      "create_marketplace_order_v24",
    );
    assert.ok(
      hashV23DepoisDoApply,
      "hash de v23 ausente após aplicar a raiz inteira",
    );
    assert.ok(
      hashV24DepoisDoApply,
      "hash de v24 ausente após aplicar a raiz inteira",
    );
    log(`hash v23 pós-apply: ${hashV23DepoisDoApply}`);
    log(`hash v24 pós-apply: ${hashV24DepoisDoApply}`);

    // =====================================================================
    // CASO 3 primeiro (SEM a linha '_revisao'): comportamento idêntico ao
    // de hoje -- roda ANTES de a loja ter qualquer revisão gravada.
    // =====================================================================
    await garantirLojaFixture(cliente);
    await gravarCotacao(cliente, {
      destino: DEST_NACIONAL,
      optId: "frenet-caso3",
      preco: 20,
      // revisaoCredenciais ausente -- a edge nunca escreveu uma, porque a
      // loja ainda não tem a linha '_revisao' (R3-1: "até lá a loja está em
      // legado sem revisão").
    });
    const r3 = await chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-caso3",
      destino: DEST_NACIONAL,
      total: 70,
      pagamento: "online",
      idempKey: "aaaaaaaa-1111-4111-8111-000000000003",
    });
    assert.ok(r3.rows[0].id, "CASO 3: pedido não nasceu sem a linha _revisao");
    log("PASS caso 3: sem a linha _revisao, pedido nasce normalmente (v24)");

    // =====================================================================
    // CASO 1: revisão igual -> pedido criado.
    // =====================================================================
    await gravarRevisao(cliente, "R1");
    await gravarCotacao(cliente, {
      destino: DEST_CASO1,
      optId: "frenet-caso1",
      preco: 22,
      revisaoCredenciais: "R1",
    });
    const antesPedidos1 = await contarPedidos(cliente);
    const r1 = await chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-caso1",
      destino: DEST_CASO1,
      total: 72,
      pagamento: "online",
      idempKey: "aaaaaaaa-1111-4111-8111-000000000001",
    });
    assert.ok(r1.rows[0].id, "CASO 1: pedido não nasceu com revisão igual");
    assert.equal(await contarPedidos(cliente), antesPedidos1 + 1);
    log("PASS caso 1: revisão igual -> pedido criado (v24)");

    // =====================================================================
    // CASO 2: revisão diferente -> FRETE_COTACAO_DESATUALIZADA, nenhum
    // pedido nem item gravado.
    // =====================================================================
    await gravarRevisao(cliente, "R2"); // a configuração "mudou"
    // A linha de cache do caso 1 continua com revisaoCredenciais:'R1' (TTL
    // de 24h, ainda válida) -- exatamente o cenário que R2-2/cache:'pendente'
    // não cobrem sozinhos.
    const antesPedidos2 = await contarPedidos(cliente);
    const antesItens2 = await contarItens(cliente);
    await assertRejeitado(
      chamarRpc(cliente, "create_marketplace_order_v24", {
        optId: "frenet-caso1",
        destino: DEST_CASO1,
        total: 72,
        pagamento: "online",
        idempKey: "aaaaaaaa-1111-4111-8111-000000000002",
      }),
      /^FRETE_COTACAO_DESATUALIZADA/,
      "caso 2 (v24)",
    );
    assert.equal(
      await contarPedidos(cliente),
      antesPedidos2,
      "CASO 2: um pedido foi gravado indevidamente",
    );
    assert.equal(
      await contarItens(cliente),
      antesItens2,
      "CASO 2: um item foi gravado indevidamente",
    );
    log(
      "PASS caso 2: revisão diferente -> FRETE_COTACAO_DESATUALIZADA, nada gravado (v24)",
    );

    // =====================================================================
    // CASO 2b (edge velha, pedido do revisor): a linha '_revisao' JÁ EXISTE
    // ('R2', setada acima), mas a opção de cache vem SEM o campo
    // `revisaoCredenciais` -- exatamente o que a edge 1.5.6 (anterior ao
    // pacote E) grava, porque ela nunca soube desse campo. `IS DISTINCT
    // FROM` trata NULL como diferente de 'R2', então isto TEM de recusar
    // com FRETE_COTACAO_DESATUALIZADA -- é a mesma garantia fail-closed do
    // caso 2, só que a "revisão velha" aqui é a AUSÊNCIA do campo, não um
    // valor antigo. É por isto que o rollback desta migration tem de rodar
    // ANTES de a loja voltar para a edge velha (ver o cabeçalho do
    // rollback-manual): com a checagem ainda ativa e a edge velha no ar,
    // TODO pedido de transportadora cairia aqui, e recotar não ajudaria.
    // =====================================================================
    await gravarCotacao(cliente, {
      destino: DEST_CASO2B,
      optId: "frenet-caso2b",
      preco: 30,
      // revisaoCredenciais OMITIDO de propósito -- o que a edge velha grava.
    });
    const antesPedidos2b = await contarPedidos(cliente);
    const antesItens2b = await contarItens(cliente);
    await assertRejeitado(
      chamarRpc(cliente, "create_marketplace_order_v24", {
        optId: "frenet-caso2b",
        destino: DEST_CASO2B,
        total: 80,
        pagamento: "online",
        idempKey: "aaaaaaaa-1111-4111-8111-00000000002b",
      }),
      /^FRETE_COTACAO_DESATUALIZADA/,
      "caso 2b (v24, edge velha sem revisaoCredenciais)",
    );
    assert.equal(
      await contarPedidos(cliente),
      antesPedidos2b,
      "CASO 2b: um pedido foi gravado indevidamente",
    );
    assert.equal(
      await contarItens(cliente),
      antesItens2b,
      "CASO 2b: um item foi gravado indevidamente",
    );
    log(
      "PASS caso 2b: _revisao existe e a opção não tem revisaoCredenciais (edge velha) -> FRETE_COTACAO_DESATUALIZADA, nada gravado (v24)",
    );

    // =====================================================================
    // CASO 5 (concorrência): uma cotação nova é gravada TARDIAMENTE com a
    // revisão VELHA (R1), depois que a configuração já virou R2 -- simula a
    // corrida em que a requisição de cotação em voo termina de gravar
    // depois do save. A linha de cache é nova (created_at agora), mas o
    // valor QUE ELA CARREGA é da revisão antiga.
    // =====================================================================
    await gravarCotacao(cliente, {
      destino: DEST_CASO5,
      optId: "frenet-caso5",
      preco: 25,
      revisaoCredenciais: "R1", // revisão que valia QUANDO a cotação foi calculada
    });
    // '_revisao' já é 'R2' neste ponto (setado no caso 2, ninguém mudou de volta).
    const antesPedidos5 = await contarPedidos(cliente);
    await assertRejeitado(
      chamarRpc(cliente, "create_marketplace_order_v24", {
        optId: "frenet-caso5",
        destino: DEST_CASO5,
        total: 75,
        pagamento: "online",
        idempKey: "aaaaaaaa-1111-4111-8111-000000000005",
      }),
      /^FRETE_COTACAO_DESATUALIZADA/,
      "caso 5 (v24, concorrência)",
    );
    assert.equal(
      await contarPedidos(cliente),
      antesPedidos5,
      "CASO 5: um pedido foi gravado indevidamente",
    );
    log(
      "PASS caso 5: cache gravado tardiamente com revisão velha -> recusa (v24)",
    );

    // =====================================================================
    // CASO 4: retirada e entrega local -> SEM checagem, mesmo com '_revisao'
    // divergente de tudo (a checagem não roda nesses ramos).
    // =====================================================================
    // local-delivery: dest CEP dentro da faixa local.
    const rLocal = await chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "local-delivery",
      destino: "38500-001",
      total: 50, // sem taxa de entrega local configurada (local_delivery_fee NULL -> 0)
      pagamento: "pix",
      idempKey: "aaaaaaaa-1111-4111-8111-000000000041",
    });
    assert.ok(rLocal.rows[0].id, "CASO 4 (local-delivery): pedido não nasceu");
    log("PASS caso 4a: local-delivery não é afetado pela revisão (v24)");

    // store-pickup: liga a retirada e dá endereço físico à loja.
    await garantirLojaFixture(cliente, {
      enabledShippingMethods: ["store-pickup"],
      storeAddress: "Rua da Loja, 123",
    });
    const rPickup = await chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "store-pickup",
      destino: "38500-002",
      total: 50,
      pagamento: "pix",
      idempKey: "aaaaaaaa-1111-4111-8111-000000000042",
    });
    assert.ok(rPickup.rows[0].id, "CASO 4 (store-pickup): pedido não nasceu");
    log("PASS caso 4b: store-pickup não é afetado pela revisão (v24)");

    // =====================================================================
    // CASO 6: as duas funções. v24 já foi exercitada nos 5 casos acima; v23
    // é a RPC do pagamento na entrega e recusa transportadora SEMPRE (bloco
    // 2-ter, migration 20261168000000 -- anterior a esta). O ramo novo
    // desta migration em v23 é código estruturalmente idêntico ao de v24
    // (mesmo patch), mas inalcançável no estado atual do sistema. Prova-se
    // aqui que v23 continua recusando pela mensagem PRÉ-EXISTENTE, com ou
    // sem revisão -- ou seja, sem regressão de comportamento.
    // =====================================================================
    await assertRejeitado(
      chamarRpc(cliente, "create_marketplace_order_v23", {
        optId: "frenet-caso1", // mesmo id do caso 1, revisão 'R1' != '_revisao' atual 'R2'
        destino: DEST_CASO1,
        total: 72,
        pagamento: "cash",
        idempKey: "aaaaaaaa-1111-4111-8111-000000000061",
      }),
      /^Envio por transportadora exige pagamento antecipado\./,
      "caso 6 (v23, transportadora sempre recusada -- pré-existente)",
    );
    // v23 continua servindo local-delivery e store-pickup normalmente,
    // exatamente como v24 -- os ramos que ESTA migration realmente altera
    // em v23, mesmo não sendo os que ficam inalcançáveis pelo 2-ter.
    const rLocalV23 = await chamarRpc(cliente, "create_marketplace_order_v23", {
      optId: "local-delivery",
      destino: "38500-003",
      total: 50,
      pagamento: "pix",
      idempKey: "aaaaaaaa-1111-4111-8111-000000000062",
    });
    assert.ok(
      rLocalV23.rows[0].id,
      "CASO 6 (v23, local-delivery): pedido não nasceu",
    );
    log(
      "PASS caso 6: v23 recusa transportadora pela mensagem pré-existente " +
        "(sem regressão) e continua servindo local-delivery normalmente",
    );

    // =====================================================================
    // Ciclo migration -> rollback -> reaplicação, pelo hash do prosrc.
    // =====================================================================
    const rollbackSql = fs.readFileSync(
      path.join(
        ROOT,
        "supabase/migrations/rollback-manual-20261170000000_a_cotacao_de_frete_confere_a_revisao.sql",
      ),
      "utf8",
    );
    await cliente.query(rollbackSql);
    const hashV23PosRollback = await hashCorpo(
      cliente,
      "create_marketplace_order_v23",
    );
    const hashV24PosRollback = await hashCorpo(
      cliente,
      "create_marketplace_order_v24",
    );
    assert.equal(
      hashV23PosRollback,
      HASH_V23_20261169,
      "rollback não devolveu o hash EXATO do corpo da 20261169000000 (v23)",
    );
    assert.equal(
      hashV24PosRollback,
      HASH_V24_20261169,
      "rollback não devolveu o hash EXATO do corpo da 20261169000000 (v24)",
    );
    log(`hash v23 pós-rollback: ${hashV23PosRollback} (== 20261169000000)`);
    log(`hash v24 pós-rollback: ${hashV24PosRollback} (== 20261169000000)`);

    // Repetir o rollback tem de ser no-op (mesmo hash).
    await cliente.query(rollbackSql);
    assert.equal(
      await hashCorpo(cliente, "create_marketplace_order_v23"),
      hashV23PosRollback,
    );
    log("PASS rollback repetido é idempotente (mesmo hash)");

    // Reaplicar a migration devolve o corpo exato de antes do rollback.
    const migrationSql = fs.readFileSync(
      path.join(
        ROOT,
        "supabase/migrations/20261170000000_a_cotacao_de_frete_confere_a_revisao.sql",
      ),
      "utf8",
    );
    await cliente.query(migrationSql);
    assert.equal(
      await hashCorpo(cliente, "create_marketplace_order_v23"),
      hashV23DepoisDoApply,
      "reaplicação não devolveu o corpo exato de v23",
    );
    assert.equal(
      await hashCorpo(cliente, "create_marketplace_order_v24"),
      hashV24DepoisDoApply,
      "reaplicação não devolveu o corpo exato de v24",
    );
    log(
      "PASS reaplicar a migration após o rollback devolve o hash exato de antes",
    );

    // Reaplicar de novo (migration já viva) tem de ser idempotente também.
    await cliente.query(migrationSql);
    assert.equal(
      await hashCorpo(cliente, "create_marketplace_order_v23"),
      hashV23DepoisDoApply,
    );
    log("PASS migration reaplicada duas vezes seguidas é idempotente");

    await cliente.end();
    console.log("\n[frete-revisao] TODOS OS CASOS PASSARAM.");
  } finally {
    log(`derrubando container ${CONTAINER}`);
    spawnSync("docker", ["rm", "-f", CONTAINER], { encoding: "utf8" });
  }
}

main().catch((erro) => {
  console.error(erro);
  spawnSync("docker", ["rm", "-f", CONTAINER], { encoding: "utf8" });
  process.exitCode = 1;
});

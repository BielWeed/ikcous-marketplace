"use strict";

/**
 * PROVA VIVA da migration 20261235000000_a_venda_repetida_do_balcao_devolve_a_venda_feita.sql
 * (dinheiro + estoque): a chamada de `registrar_venda_presencial` com a MESMA chave de
 * idempotência que chega ANTES de a primeira commitar espera a primeira e devolve a venda
 * feita (`ja_existia = true`) — nunca "Estoque insuficiente" por causa da última unidade que
 * a própria venda levou. Roda contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 *   (0) fixtures (commitadas: as provas de concorrência precisam enxergá-las de outra conexão)
 *       e AMARRAS DE TEXTO: o corpo do rollback é o da 20261199000000 byte a byte, o corpo da
 *       migration é o mesmo MAIS o bloco da trava (nada além), e os hashes escritos nos dois
 *       arquivos são o md5 real dos corpos.
 *   (1) catálogo e ACL: dono, SECURITY DEFINER, search_path, EXECUTE só para authenticated,
 *       comentário e uma única sobrecarga — o que o CREATE OR REPLACE tinha de preservar.
 *   (2) CONTROLE: com o corpo ANTIGO no banco (o do rollback), a corrida na última unidade
 *       reproduz o defeito (a repetição recebe 22023 "Estoque insuficiente", a venda existe e
 *       o estoque baixou); a migration é reaplicada no fim.
 *   (3) A CORRIDA (2 conexões reais, a 1ª segura a transação aberta, a 2ª comprovadamente parada
 *       numa trava CONSULTIVA): na última unidade a 2ª recebe `ja_existia` com o MESMO pedido.
 *   (4) estoque sobrando: continua `ja_existia`, com o estoque debitado UMA vez.
 *   (5) chaves DIFERENTES não se serializam (nem com a 1ª ainda aberta); e a mesma última
 *       unidade pedida por chaves diferentes continua recusando com "Estoque insuficiente"
 *       (venda de verdade diferente não vira `ja_existia`).
 *   (6) venda SEM chave não toma trava nenhuma e não espera ninguém.
 *   (7) mesma chave de OUTRO balconista e de OUTRO canal: 23505, nada gravado.
 *   (8) venda normal sem corrida inalterada: a resposta, o estoque, os itens e os históricos;
 *       a repetição em sequência devolve o mesmo pedido.
 *   (9) PERMISSÃO: rebaixado (só profiles, só auth.users, os dois), cliente, anon e service_role
 *       recusados como antes; e o gate vem ANTES da trava (com a chave presa por outra conexão,
 *       quem não é da loja recebe a recusa na hora, não espera).
 *  (11) MIGRATION: reaplicar é idempotente; o rollback devolve o corpo da 20261199000000 (md5),
 *       a ACL, o dono e o comentário; aplicar -> desfazer -> aplicar volta idêntico; nenhuma
 *       outra função é tocada; pré-voo recusa corpo estranho e ACL aberta SEM gravar.
 *  (12) MUTANTES: cada peça da correção tirada ou trocada deixa a prova certa VERMELHA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/venda-balcao-mesma-chave-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório, por nome fixo
 * (constantes abaixo), nunca entrada de rede nem de terceiro. */

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const NOME =
  "20261235000000_a_venda_repetida_do_balcao_devolve_a_venda_feita.sql";
const NOME_99 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const lerLF = (arquivo) =>
  fs.readFileSync(path.join(PASTA, arquivo), "utf8").replace(/\r/g, "");
const SQL_MIGRATION = lerLF(NOME);
const SQL_ROLLBACK = lerLF(`rollback-manual-${NOME}`);
const SQL_99 = lerLF(NOME_99);
// A 249 sucede a 235. Esta prova continua medindo a correção histórica da trava:
// desfaz SÓ a sucessora no clone antes das corridas e a repõe no fim, sem relaxar
// nenhum hash/assert da 235 nem trocar corpos enquanto outra conexão corre.
const NOME_SUCESSORA =
  "20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql";
const SQL_SUCESSORA = lerLF(NOME_SUCESSORA);
const RB_SUCESSORA = lerLF(`rollback-manual-${NOME_SUCESSORA}`);

const FN =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)";
const HASH_ANTIGO = "6a421904a7c99a0e17ca58f2f891c71d"; // corpo da 20261199000000
const HASH_NOVO = "996caf02505ac16a8bded73bcf8900aa"; // corpo desta migration
const MSG_NEGADO = "Acesso negado: só a loja registra venda no balcão.";
const MSG_CHAVE_ALHEIA = "Esta chave de venda já foi usada por outro pedido.";

const MARCADOR_FN =
  "CREATE OR REPLACE FUNCTION public.registrar_venda_presencial";

/** O bloco CREATE OR REPLACE FUNCTION de um arquivo (os mutantes trocam um pedaço e o recriam). */
function blocoDaFuncao(sql) {
  const ini = sql.indexOf(MARCADOR_FN);
  assert.ok(ini >= 0, "bloco da função não achado");
  const fim = sql.indexOf("\n$$;", ini) + "\n$$;".length;
  assert.ok(fim > ini, "fim do bloco da função não achado");
  return sql.slice(ini, fim);
}
/** O corpo (prosrc): o texto entre os `$$`, com o \n final antes do fecha. */
function corpoDaFuncao(sql) {
  const bloco = blocoDaFuncao(sql);
  const a = bloco.indexOf("$$") + 2;
  const b = bloco.lastIndexOf("\n$$;");
  return bloco.slice(a, b + 1);
}
const md5 = (t) => crypto.createHash("md5").update(t).digest("hex");

const SQL_FUNCAO = blocoDaFuncao(SQL_MIGRATION);
const SQL_FUNCAO_ANTIGA = blocoDaFuncao(SQL_ROLLBACK);

// O comando da trava, tal como está na migration (os mutantes o tiram ou o trocam).
const PERFORM_TRAVA = `        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('venda_presencial:' || p_idempotency_key::text, 0));
`;

const U_ADMIN = "c5000000-0000-4000-8000-000000000001";
const U_ADMIN_2 = "c5000000-0000-4000-8000-000000000002";
const U_REB_PERFIL = "c5000000-0000-4000-8000-000000000003";
const U_REB_AUTH = "c5000000-0000-4000-8000-000000000004";
const U_CLIENTE = "c5000000-0000-4000-8000-000000000005";
const U_REB_AMBOS = "c5000000-0000-4000-8000-000000000006";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

const QUEM = new Map(
  Object.entries({
    anon: { papel: "anon", uid: "", jwt: "" },
    cliente: {
      papel: "authenticated",
      uid: U_CLIENTE,
      jwt: claims(U_CLIENTE, null),
    },
    rebPerfil: {
      papel: "authenticated",
      uid: U_REB_PERFIL,
      jwt: claims(U_REB_PERFIL, "admin"),
    },
    rebAuth: {
      papel: "authenticated",
      uid: U_REB_AUTH,
      jwt: claims(U_REB_AUTH, "admin"),
    },
    rebAmbos: {
      papel: "authenticated",
      uid: U_REB_AMBOS,
      jwt: claims(U_REB_AMBOS, "admin"),
    },
    admin: {
      papel: "authenticated",
      uid: U_ADMIN,
      jwt: claims(U_ADMIN, "admin"),
    },
    admin2: {
      papel: "authenticated",
      uid: U_ADMIN_2,
      jwt: claims(U_ADMIN_2, "admin"),
    },
    service: { papel: "service_role", uid: "", jwt: "" },
  }),
);

// ---------------------------------------------------------------- utilitários

const novoUuid = () => crypto.randomUUID();

async function novaConexao() {
  const cl = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await cl.connect();
  return cl;
}

/** Roda `sql` COMO `quem` dentro da transação JÁ aberta de `cl` (SET LOCAL). */
async function comoNaConexao(cl, quem, sql, params = []) {
  const q = QUEM.get(quem);
  await cl.query(`SET LOCAL ROLE ${q.papel}`);
  await cl.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
  return cl.query(sql, params);
}

const SQL_VENDA =
  "SELECT public.registrar_venda_presencial($1::jsonb, $2, NULL::uuid, NULL, NULL, 0::numeric, NULL, $3::uuid) AS r";

/** Chama a RPC na transação aberta de `cl`; devolve {ok, r} ou {ok:false, code, message}. */
async function venderEm(cl, quem, itens, chave, pagamento = "cash") {
  try {
    const r = await comoNaConexao(cl, quem, SQL_VENDA, [
      JSON.stringify(itens),
      pagamento,
      chave,
    ]);
    return { ok: true, r: r.rows[0].r };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Uma venda completa numa transação própria (BEGIN ... COMMIT). */
async function venderEmTx(cl, quem, itens, chave) {
  await cl.query("BEGIN");
  const r = await venderEm(cl, quem, itens, chave);
  await cl.query(r.ok ? "COMMIT" : "ROLLBACK");
  return r;
}

async function novoProduto(c, estoque, preco = 25) {
  const id = novoUuid();
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
     VALUES ($1, $2, $3, $4, true, 5)`,
    [id, `Produto da corrida ${id.slice(0, 8)}`, preco, estoque],
  );
  return id;
}

const item = (produto, quantity = 1) => [
  { product_id: produto, variant_id: null, quantity },
];

const estoqueDe = async (c, produto) =>
  Number(
    (
      await c.query("SELECT estoque FROM public.produtos WHERE id = $1", [
        produto,
      ])
    ).rows[0].estoque,
  );

const contar = async (c, sql, params) =>
  Number((await c.query(sql, params)).rows[0].n);

const pedidosComAChave = (c, chave) =>
  contar(
    c,
    "SELECT count(*) AS n FROM public.marketplace_orders WHERE idempotency_key = $1",
    [chave],
  );

/** O tipo de trava em que a conexão `pid` está PARADA (ou null se não espera). */
async function esperaEm(monitor, pid) {
  const r = await monitor.query(
    "SELECT locktype FROM pg_locks WHERE pid = $1 AND NOT granted",
    [pid],
  );
  return r.rows[0]?.locktype ?? null;
}

/** Espera `pid` ficar parada numa trava (wait_event_type = Lock) e diz em qual tipo. */
async function esperarEspera(monitor, pid, ms = 15000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const r = await monitor.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return esperaEm(monitor, pid);
    await new Promise((res) => setTimeout(res, 40));
  }
  throw new assert.AssertionError({
    message: `a conexão ${pid} não ficou parada numa trava (Lock)`,
  });
}

const travasConsultivas = async (monitor, pid) =>
  Number(
    (
      await monitor.query(
        "SELECT count(*) AS n FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND granted",
        [pid],
      )
    ).rows[0].n,
  );

async function pidDe(cl) {
  return (await cl.query("SELECT pg_backend_pid() AS p")).rows[0].p;
}

/**
 * A corrida: A abre a transação e vende (SEM commitar); B chama com a MESMA chave e fica
 * parada; A commita; B termina. Devolve o que a prova precisa medir.
 */
async function corrida({
  estoque,
  qtd = 1,
  chave = novoUuid(),
  quemB = "admin",
}) {
  const c = await novaConexao();
  const A = await novaConexao();
  const B = await novaConexao();
  const M = await novaConexao();
  try {
    const produto = await novoProduto(c, estoque);
    const itens = item(produto, qtd);
    await A.query("BEGIN");
    const ra = await venderEm(A, "admin", itens, chave);
    assert.ok(ra.ok, `A (a 1ª venda) falhou: ${ra.message}`);
    assert.equal(ra.r.ja_existia, false, "A é a venda nova");

    await B.query("BEGIN");
    // Um teto para a espera: sem ele, um mutante que nunca solta a trava travaria a prova.
    await B.query("SET LOCAL lock_timeout = '8s'");
    const pidB = await pidDe(B);
    const pb = venderEm(B, quemB, itens, chave);
    const tipoDeTrava = await esperarEspera(M, pidB);
    await A.query("COMMIT");
    const rb = await pb;
    await B.query(rb.ok ? "COMMIT" : "ROLLBACK");
    return {
      produto,
      chave,
      ra,
      rb,
      tipoDeTrava,
      pedidos: await pedidosComAChave(c, chave),
      estoque: await estoqueDe(c, produto),
      itensDoPedido: await contar(
        c,
        "SELECT count(*) AS n FROM public.marketplace_order_items WHERE order_id = $1",
        [ra.r.order.id],
      ),
      historicos: await contar(
        c,
        "SELECT (SELECT count(*) FROM public.marketplace_order_history WHERE order_id = $1) + (SELECT count(*) FROM public.marketplace_order_payment_history WHERE order_id = $1) AS n",
        [ra.r.order.id],
      ),
    };
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await Promise.all([A.end(), B.end(), M.end(), c.end()]);
  }
}

// ---------------------------------------------------------------- as provas

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova("(0) fixtures e amarras de texto das migrations", async (c) => {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const id of [
    U_ADMIN,
    U_ADMIN_2,
    U_REB_PERFIL,
    U_REB_AUTH,
    U_CLIENTE,
    U_REB_AMBOS,
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@mesma-chave.teste', '{}'::jsonb)`,
      [id],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin Chave', 'admin'), ($2, 'Admin Chave 2', 'admin'),
       ($3, 'Reb Perfil', 'admin'), ($4, 'Reb Auth', 'admin'),
       ($5, 'Cliente Chave', 'customer'), ($6, 'Reb Ambos', 'admin')`,
    [U_ADMIN, U_ADMIN_2, U_REB_PERFIL, U_REB_AUTH, U_CLIENTE, U_REB_AMBOS],
  );
  // Rebaixamento pelo app (um admin muda o papel; o gatilho de sincronia leva a auth.users).
  await c.query("BEGIN");
  await c.query(
    "SELECT set_config('request.jwt.claims', $1, true), set_config('app.rpc.user_id', $2, true)",
    [claims(U_ADMIN, "admin"), U_ADMIN],
  );
  await c.query(
    "UPDATE public.profiles SET role = 'customer' WHERE id = ANY($1::uuid[])",
    [[U_REB_AMBOS, U_REB_PERFIL]],
  );
  await c.query("COMMIT");
  // Só profiles rebaixado: auth.users volta a dizer admin.
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1`,
    [U_REB_PERFIL],
  );
  // Só auth.users rebaixado (painel do Supabase): profiles continua admin.
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = $1`,
    [U_REB_AUTH],
  );
  const r = await c.query(
    `SELECT u.id::text, u.raw_app_meta_data ->> 'role' AS a, p.role AS p
       FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
      WHERE u.id::text LIKE 'c5000000-%' ORDER BY u.id`,
  );
  assert.deepEqual(
    r.rows.map((l) => [l.id, l.a, l.p]),
    [
      [U_ADMIN, "admin", "admin"],
      [U_ADMIN_2, "admin", "admin"],
      [U_REB_PERFIL, "admin", "customer"],
      [U_REB_AUTH, "customer", "admin"],
      [U_CLIENTE, "customer", "customer"],
      [U_REB_AMBOS, "customer", "customer"],
    ],
  );

  // AMARRAS DE TEXTO: os hashes que os arquivos carregam são o md5 real dos corpos.
  const corpoNovo = corpoDaFuncao(SQL_MIGRATION);
  const corpoVolta = corpoDaFuncao(SQL_ROLLBACK);
  const corpo99 = corpoDaFuncao(SQL_99);
  assert.equal(md5(corpoNovo), HASH_NOVO, "o corpo da migration mudou de hash");
  assert.equal(
    md5(corpoVolta),
    HASH_ANTIGO,
    "o corpo do rollback não é o vigente",
  );
  assert.equal(
    md5(corpo99),
    HASH_ANTIGO,
    "o vigente não é o da 20261199000000",
  );
  assert.equal(
    corpoVolta,
    corpo99,
    "rollback != corpo da 20261199000000 byte a byte",
  );
  // A migration é o corpo da 99 MAIS o bloco da trava — e nada além disso.
  const iTrava = corpoNovo.indexOf(
    "        -- A MESMA CHAVE ESPERA A PRIMEIRA TERMINAR",
  );
  const fTrava = corpoNovo.indexOf(PERFORM_TRAVA) + PERFORM_TRAVA.length;
  assert.ok(iTrava > 0 && fTrava > iTrava, "bloco da trava não achado");
  const semATrava =
    corpoNovo.slice(0, iTrava) + corpoNovo.slice(fTrava).replace(/^\n/, "");
  assert.equal(
    semATrava,
    corpo99,
    "o corpo novo difere do vigente em mais que o bloco da trava",
  );
  for (const [rotulo, sql, hashes] of [
    ["migration", SQL_MIGRATION, [HASH_ANTIGO, HASH_NOVO]],
    ["rollback", SQL_ROLLBACK, [HASH_ANTIGO, HASH_NOVO]],
  ]) {
    for (const h of hashes) {
      assert.ok(sql.includes(`'${h}'`), `${rotulo} não cita o hash ${h}`);
    }
    assert.ok(
      !/\bBEGIN;|\bCOMMIT;|^\s*ROLLBACK;/m.test(sql),
      `${rotulo} traz BEGIN/COMMIT de nível superior (regra da casa)`,
    );
  }
  assert.ok(
    SQL_MIGRATION.includes(`esperado: ${HASH_NOVO}`),
    "a ficha de verificação não tem o hash novo",
  );
});

async function defDaFuncao(c) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS corpo, pg_get_functiondef(oid) AS def,
            proacl::text AS acl, obj_description(oid, 'pg_proc') AS comentario,
            prosecdef, proconfig::text AS cfg, pg_get_userbyid(proowner) AS dono,
            provolatile, proisstrict
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [FN],
  );
  return r.rows[0] || null;
}

prova(
  "(1) catálogo e ACL: o que o CREATE OR REPLACE tinha de preservar",
  async (c) => {
    const f = await defDaFuncao(c);
    assert.ok(f, "a função não existe");
    assert.equal(f.corpo, HASH_NOVO, "o corpo vivo não é o da migration");
    assert.equal(f.dono, "postgres");
    assert.equal(f.prosecdef, true);
    assert.equal(f.cfg, '{"search_path=pg_catalog, pg_temp"}');
    assert.equal(f.provolatile, "v");
    assert.equal(f.proisstrict, false);
    assert.equal(f.acl, "{postgres=X/postgres,authenticated=X/postgres}");
    assert.match(
      f.comentario || "",
      /PDV\/balcão: grava a venda presencial INTEIRA/,
    );
    const r = await c.query(
      `SELECT count(*)::int AS n FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'registrar_venda_presencial'`,
    );
    assert.equal(r.rows[0].n, 1, "sobrecarga extra");
    const p = await c.query(
      `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth,
            has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS service`,
      [FN],
    );
    assert.deepEqual(p.rows[0], { anon: false, auth: true, service: false });
  },
);

/** A prova da corrida na última unidade — usada pela prova (3), pelo controle e pelos mutantes. */
async function corridaNaUltimaUnidade() {
  const x = await corrida({ estoque: 1 });
  assert.equal(
    x.tipoDeTrava,
    "advisory",
    `a 2ª chamada devia esperar numa trava CONSULTIVA (esperou em '${x.tipoDeTrava}')`,
  );
  assert.ok(
    x.rb.ok,
    `a repetição da MESMA chave recebeu erro (${x.rb.code}: ${x.rb.message}) em vez da venda feita`,
  );
  assert.equal(x.rb.r.ja_existia, true, "a repetição não diz ja_existia");
  assert.equal(
    x.rb.r.order.id,
    x.ra.r.order.id,
    "a repetição devolveu OUTRO pedido",
  );
  assert.equal(x.pedidos, 1, "nasceu mais de um pedido com a chave");
  assert.equal(x.estoque, 0, "o estoque não foi debitado exatamente uma vez");
  assert.equal(x.itensDoPedido, 1, "o pedido não tem exatamente um item");
  assert.equal(x.historicos, 2, "os históricos não nasceram uma vez só");
  assert.equal(
    x.rb.r.items.length,
    1,
    "a resposta da repetição não traz os itens do pedido feito",
  );
}
prova(
  "(3) A CORRIDA: na última unidade a repetição da mesma chave recebe ja_existia, o MESMO pedido",
  corridaNaUltimaUnidade,
);

async function corridaComEstoqueSobrando() {
  const x = await corrida({ estoque: 10, qtd: 2 });
  assert.ok(x.rb.ok, `B: ${x.rb.code} ${x.rb.message}`);
  assert.equal(x.rb.r.ja_existia, true);
  assert.equal(x.rb.r.order.id, x.ra.r.order.id);
  assert.equal(x.pedidos, 1);
  assert.equal(
    x.estoque,
    8,
    "o estoque foi debitado mais (ou menos) de uma vez",
  );
  assert.equal(x.tipoDeTrava, "advisory");
}
prova(
  "(4) estoque sobrando: continua ja_existia, estoque debitado UMA vez",
  corridaComEstoqueSobrando,
);

async function chavesDiferentesNaoSeSerializam() {
  const c = await novaConexao();
  const A = await novaConexao();
  const B = await novaConexao();
  const M = await novaConexao();
  try {
    const p1 = await novoProduto(c, 1);
    const p2 = await novoProduto(c, 1);
    const k1 = novoUuid();
    const k2 = novoUuid();
    await A.query("BEGIN");
    const ra = await venderEm(A, "admin", item(p1), k1);
    assert.ok(ra.ok, `A: ${ra.message}`);
    assert.equal(
      await travasConsultivas(M, await pidDe(A)),
      1,
      "a venda com chave devia segurar exatamente UMA trava consultiva",
    );
    // B, com OUTRA chave e outro produto, NÃO pode esperar a A (que segue aberta).
    await B.query("BEGIN");
    await B.query("SET LOCAL lock_timeout = '1500ms'");
    const t0 = Date.now();
    const rb = await venderEm(B, "admin", item(p2), k2);
    const gasto = Date.now() - t0;
    assert.ok(
      rb.ok,
      `chaves diferentes se serializaram (B: ${rb.code} ${rb.message})`,
    );
    assert.ok(
      gasto < 1200,
      `B esperou ${gasto} ms por uma chave que não é a dela`,
    );
    assert.equal(rb.r.ja_existia, false);
    assert.notEqual(rb.r.order.id, ra.r.order.id);
    await B.query("COMMIT");
    await A.query("COMMIT");
    assert.equal(await estoqueDe(c, p1), 0);
    assert.equal(await estoqueDe(c, p2), 0);
    assert.equal(await pedidosComAChave(c, k1), 1);
    assert.equal(await pedidosComAChave(c, k2), 1);
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await Promise.all([A.end(), B.end(), M.end(), c.end()]);
  }
}
prova(
  "(5a) chaves DIFERENTES em paralelo não se serializam (a 1ª segue aberta)",
  chavesDiferentesNaoSeSerializam,
);

prova(
  "(5b) a mesma última unidade com chaves DIFERENTES continua recusando 'Estoque insuficiente'",
  async (c) => {
    const A = await novaConexao();
    const B = await novaConexao();
    try {
      const p = await novoProduto(c, 1);
      const ra = await venderEmTx(A, "admin", item(p), novoUuid());
      assert.ok(ra.ok, ra.message);
      const rb = await venderEmTx(B, "admin2", item(p), novoUuid());
      assert.equal(
        rb.ok,
        false,
        "a 2ª venda (outra chave) não pode virar ja_existia",
      );
      assert.equal(rb.code, "22023");
      assert.match(rb.message, /^Estoque insuficiente para o produto /);
      assert.equal(await estoqueDe(c, p), 0);
    } finally {
      await A.end();
      await B.end();
    }
  },
);

async function semChaveNaoTravaNada() {
  const c = await novaConexao();
  const A = await novaConexao();
  const B = await novaConexao();
  const M = await novaConexao();
  try {
    const p1 = await novoProduto(c, 5);
    const p2 = await novoProduto(c, 5);
    await A.query("BEGIN");
    const ra = await venderEm(A, "admin", item(p1), null);
    assert.ok(ra.ok, `A: ${ra.message}`);
    assert.equal(
      await travasConsultivas(M, await pidDe(A)),
      0,
      "venda SEM chave tomou trava consultiva",
    );
    await B.query("BEGIN");
    await B.query("SET LOCAL lock_timeout = '1500ms'");
    const t0 = Date.now();
    const rb = await venderEm(B, "admin2", item(p2), null);
    assert.ok(
      rb.ok,
      `venda sem chave esperou outra (B: ${rb.code} ${rb.message})`,
    );
    assert.ok(
      Date.now() - t0 < 1200,
      "venda sem chave esperou outra venda sem chave",
    );
    assert.equal(rb.r.ja_existia, false);
    await B.query("COMMIT");
    await A.query("COMMIT");
    assert.equal(await estoqueDe(c, p1), 4);
    assert.equal(await estoqueDe(c, p2), 4);
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await Promise.all([A.end(), B.end(), M.end(), c.end()]);
  }
}
prova(
  "(6) venda SEM chave não toma trava e não espera ninguém",
  semChaveNaoTravaNada,
);

async function chaveDeOutroBalconista() {
  const x = await corrida({ estoque: 5, quemB: "admin2" });
  assert.equal(
    x.rb.ok,
    false,
    "a chave de um balconista devolveu o pedido a outro",
  );
  assert.equal(x.rb.code, "23505");
  assert.equal(x.rb.message, MSG_CHAVE_ALHEIA);
  assert.equal(x.pedidos, 1);
  assert.equal(x.estoque, 4, "o estoque mexeu além da venda do dono da chave");
  assert.equal(x.tipoDeTrava, "advisory");
}
prova(
  "(7a) mesma chave de OUTRO balconista (com a 1ª aberta): 23505 depois de esperar, nada gravado",
  chaveDeOutroBalconista,
);

prova("(7b) chave de pedido de OUTRO CANAL: 23505, sem gravar", async (c) => {
  const chave = novoUuid();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, status, canal, idempotency_key)
     VALUES ('Pedido da vitrine', '{}'::jsonb, 10.00, 10.00, 'pending', 'online', $1)`,
    [chave],
  );
  const p = await novoProduto(c, 3);
  const A = await novaConexao();
  try {
    const r = await venderEmTx(A, "admin", item(p), chave);
    assert.equal(r.ok, false);
    assert.equal(r.code, "23505");
    assert.equal(r.message, MSG_CHAVE_ALHEIA);
    assert.equal(
      await estoqueDe(c, p),
      3,
      "a recusa por chave alheia mexeu no estoque",
    );
    assert.equal(await pedidosComAChave(c, chave), 1);
  } finally {
    await A.end();
  }
});

prova(
  "(8) venda normal sem corrida: inalterada; a repetição em sequência devolve o mesmo pedido",
  async (c) => {
    const A = await novaConexao();
    try {
      const p = await novoProduto(c, 10, 25);
      const chave = novoUuid();
      const r1 = await venderEmTx(A, "admin", item(p, 2), chave);
      assert.ok(r1.ok, r1.message);
      assert.equal(r1.r.ja_existia, false);
      assert.equal(Number(r1.r.order.total), 50);
      assert.equal(r1.r.order.canal, "presencial");
      assert.equal(r1.r.order.status, "delivered");
      assert.equal(r1.r.order.payment_status, "recebido_na_entrega");
      assert.equal(r1.r.order.vendedor_id, U_ADMIN);
      assert.equal(r1.r.order.idempotency_key, chave);
      assert.equal(r1.r.items.length, 1);
      assert.equal(r1.r.items[0].quantity, 2);
      assert.equal(await estoqueDe(c, p), 8);

      const r2 = await venderEmTx(A, "admin", item(p, 2), chave);
      assert.ok(r2.ok, r2.message);
      assert.equal(r2.r.ja_existia, true);
      assert.equal(r2.r.order.id, r1.r.order.id);
      assert.deepEqual(r2.r.items, r1.r.items);
      assert.equal(await estoqueDe(c, p), 8, "a repetição debitou de novo");
      assert.equal(await pedidosComAChave(c, chave), 1);

      // Sem chave: duas vendas iguais são duas vendas (a trava não vira "tudo é a mesma").
      const s1 = await venderEmTx(A, "admin", item(p, 1), null);
      const s2 = await venderEmTx(A, "admin", item(p, 1), null);
      assert.ok(s1.ok && s2.ok);
      assert.notEqual(s1.r.order.id, s2.r.order.id);
      assert.equal(await estoqueDe(c, p), 6);

      // Última unidade em sequência (sem corrida): a repetição devolve o pedido, não recusa.
      const q = await novoProduto(c, 1);
      const k = novoUuid();
      const u1 = await venderEmTx(A, "admin", item(q), k);
      assert.ok(u1.ok, u1.message);
      const u2 = await venderEmTx(A, "admin", item(q), k);
      assert.ok(u2.ok, `${u2.code} ${u2.message}`);
      assert.equal(u2.r.ja_existia, true);
      assert.equal(u2.r.order.id, u1.r.order.id);
    } finally {
      await A.end();
    }
  },
);

/** As recusas de permissão (a mesma lista do que a versão anterior já recusava). */
async function permissao(c) {
  const A = await novaConexao();
  try {
    const p = await novoProduto(c, 3);
    for (const quem of ["rebPerfil", "rebAuth", "rebAmbos", "cliente"]) {
      const chave = novoUuid();
      const r = await venderEmTx(A, quem, item(p), chave);
      assert.equal(r.ok, false, `${quem} conseguiu vender`);
      assert.equal(r.code, "42501", `${quem}: ${r.code} ${r.message}`);
      assert.equal(r.message, MSG_NEGADO, quem);
      assert.equal(
        await pedidosComAChave(c, chave),
        0,
        `${quem} gravou pedido`,
      );
    }
    for (const quem of ["anon", "service"]) {
      const r = await venderEmTx(A, quem, item(p), novoUuid());
      assert.equal(r.ok, false, `${quem} conseguiu vender`);
      assert.equal(r.code, "42501", `${quem}: ${r.code} ${r.message}`);
      assert.match(
        r.message,
        /^permission denied for function registrar_venda_presencial$/,
      );
    }
    assert.equal(await estoqueDe(c, p), 3, "uma recusa mexeu no estoque");
    // O admin atual continua vendendo.
    const ok = await venderEmTx(A, "admin", item(p), novoUuid());
    assert.ok(ok.ok, ok.message);
  } finally {
    await A.end();
  }
}
prova(
  "(9a) permissão: rebaixados, cliente, anon e service_role recusados como antes",
  permissao,
);

/** O gate vem ANTES da trava: com a chave presa por OUTRA conexão, quem não é da loja não espera. */
async function gateAntesDaTrava() {
  const c = await novaConexao();
  const H = await novaConexao();
  const B = await novaConexao();
  try {
    const p = await novoProduto(c, 3);
    const chave = novoUuid();
    // H segura a trava consultiva EXATAMENTE como a função a toma (mesma receita de hash).
    await H.query("BEGIN");
    await H.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('venda_presencial:' || $1::text, 0))",
      [chave],
    );
    // CONTROLE POSITIVO: o admin atual, com a mesma chave, ESPERA a trava de H (fica sem resposta
    // até o lock_timeout) — prova que a receita do teste é a da função.
    await B.query("BEGIN");
    await B.query("SET LOCAL lock_timeout = '700ms'");
    const admin = await venderEm(B, "admin", item(p), chave);
    await B.query("ROLLBACK");
    assert.equal(
      admin.ok,
      false,
      "o admin passou por cima da trava presa por H",
    );
    assert.equal(admin.code, "55P03", `${admin.code} ${admin.message}`);
    // Quem NÃO é da loja recebe a recusa NA HORA: a trava não pode ser tomada antes do gate.
    for (const quem of ["rebPerfil", "rebAuth", "rebAmbos", "cliente"]) {
      await B.query("BEGIN");
      await B.query("SET LOCAL lock_timeout = '700ms'");
      const t0 = Date.now();
      const r = await venderEm(B, quem, item(p), chave);
      await B.query("ROLLBACK");
      assert.equal(
        r.code,
        "42501",
        `${quem}: devia ser recusado pelo gate (42501), veio ${r.code} ${r.message}`,
      );
      assert.equal(r.message, MSG_NEGADO, quem);
      assert.ok(
        Date.now() - t0 < 600,
        `${quem} esperou a trava antes de ser recusado`,
      );
    }
    await H.query("ROLLBACK");
  } finally {
    await H.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await Promise.all([H.end(), B.end(), c.end()]);
  }
}
prova(
  "(9b) o gate vem ANTES da trava: quem não é da loja é recusado na hora, sem esperar a chave",
  gateAntesDaTrava,
);

// ------------------------------------------------------------------ migration

/** Impressão digital de TODAS as outras funções de public (corpo, ACL, comentário). */
async function impressaoDasOutras(c) {
  return (
    await c.query(
      `SELECT count(*)::int AS n,
              md5(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid))
                  || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(obj_description(p.oid, 'pg_proc'), ''),
                  E'\\n' ORDER BY p.oid::regprocedure::text)) AS h
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'registrar_venda_presencial'`,
    )
  ).rows[0];
}

async function emTx(c, corpo) {
  await c.query("BEGIN");
  try {
    const r = await corpo();
    await c.query("ROLLBACK");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

async function tentarSql(c, sql) {
  await c.query("SAVEPOINT sp_sql");
  try {
    await c.query(sql);
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_sql");
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: false, message: e.message };
  }
}

prova(
  "(11a) reaplicar a migration é idempotente (mesma função, mesma ACL)",
  async (c) => {
    const antes = await defDaFuncao(c);
    await emTx(c, async () => {
      await c.query(SQL_MIGRATION);
      await c.query(SQL_MIGRATION);
      assert.deepEqual(await defDaFuncao(c), antes);
    });
    assert.deepEqual(await defDaFuncao(c), antes);
  },
);

prova(
  "(11b) rollback devolve o corpo da 20261199000000, a ACL, o dono e o comentário; ida, volta e ida idênticas",
  async (c) => {
    const novo = await defDaFuncao(c);
    const outras0 = await impressaoDasOutras(c);
    await emTx(c, async () => {
      await c.query(SQL_ROLLBACK);
      const velho = await defDaFuncao(c);
      assert.equal(
        velho.corpo,
        HASH_ANTIGO,
        "o rollback não devolveu o corpo vigente",
      );
      assert.equal(velho.acl, novo.acl);
      assert.equal(velho.dono, novo.dono);
      assert.equal(velho.comentario, novo.comentario);
      assert.equal(velho.cfg, novo.cfg);
      assert.equal(velho.prosecdef, novo.prosecdef);
      assert.notEqual(velho.def, novo.def);
      assert.deepEqual(
        await impressaoDasOutras(c),
        outras0,
        "o rollback mexeu em outra função",
      );
      // Rollback repetido é idempotente.
      await c.query(SQL_ROLLBACK);
      assert.deepEqual(await defDaFuncao(c), velho);
      await c.query(SQL_MIGRATION);
      assert.deepEqual(
        await defDaFuncao(c),
        novo,
        "reaplicar não voltou ao estado idêntico",
      );
      assert.deepEqual(
        await impressaoDasOutras(c),
        outras0,
        "a migration mexeu em outra função",
      );
    });
    assert.deepEqual(await defDaFuncao(c), novo);
  },
);

prova(
  "(11c) pré-voo da migration e do rollback recusam corpo estranho e ACL aberta, sem gravar",
  async (c) => {
    const antes = await defDaFuncao(c);
    const estranha = SQL_FUNCAO.replace(
      "    v_vendedor := auth.uid();",
      "    -- um comentário a mais\n    v_vendedor := auth.uid();",
    );
    assert.notEqual(estranha, SQL_FUNCAO);
    for (const [rotulo, sql] of [
      ["migration", SQL_MIGRATION],
      ["rollback", SQL_ROLLBACK],
    ]) {
      await emTx(c, async () => {
        await c.query(estranha);
        const gravado = await defDaFuncao(c);
        const r = await tentarSql(c, sql);
        assert.equal(r.ok, false, `${rotulo} aceitou um corpo estranho`);
        assert.match(r.message, /B1_BASELINE_DIVERGENT: corpo vivo/);
        assert.deepEqual(
          await defDaFuncao(c),
          gravado,
          `${rotulo} gravou apesar de recusar`,
        );
      });
      await emTx(c, async () => {
        await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
        const r = await tentarSql(c, sql);
        assert.equal(r.ok, false, `${rotulo} aceitou ACL aberta para anon`);
        assert.match(r.message, /B1_BASELINE_DIVERGENT: ACL/);
      });
      await emTx(c, async () => {
        await c.query(`DROP FUNCTION ${FN}`);
        const r = await tentarSql(c, sql);
        assert.equal(r.ok, false, `${rotulo} aceitou função ausente`);
        assert.match(r.message, /B1_BASELINE_DIVERGENT: .* não existe/);
      });
    }
    assert.deepEqual(await defDaFuncao(c), antes);
  },
);

// ------------------------------------------------- controle e mutantes (por último)

prova(
  "(2) CONTROLE: com o corpo ANTIGO no banco a mesma corrida reproduz o defeito (a venda existe e a repetição recebe 'Estoque insuficiente')",
  async (c) => {
    await c.query(SQL_FUNCAO_ANTIGA); // o corpo da 20261199000000, como está no rollback
    try {
      assert.equal((await defDaFuncao(c)).corpo, HASH_ANTIGO);
      const x = await corrida({ estoque: 1 });
      assert.notEqual(
        x.tipoDeTrava,
        "advisory",
        "o corpo antigo não devia ter trava consultiva",
      );
      assert.equal(
        x.rb.ok,
        false,
        "o defeito não reproduziu: a repetição não falhou",
      );
      assert.equal(x.rb.code, "22023");
      assert.match(
        x.rb.message,
        /^Estoque insuficiente para o produto .*Disponível: 0, Solicitado: 1/,
      );
      assert.equal(x.pedidos, 1, "a venda DEVIA existir (é o defeito)");
      assert.equal(x.estoque, 0, "o estoque DEVIA ter baixado (é o defeito)");
      // E a mesma prova (3) fica vermelha com o corpo antigo.
      await assert.rejects(corridaNaUltimaUnidade, assert.AssertionError);
    } finally {
      await c.query(SQL_FUNCAO);
    }
    assert.equal(
      (await defDaFuncao(c)).corpo,
      HASH_NOVO,
      "a migration não foi restaurada",
    );
  },
);

async function mutar(c, rotulo, mutada, proveCom) {
  assert.notEqual(mutada, SQL_FUNCAO, `mutante "${rotulo}": nada mudou`);
  await c.query(mutada);
  let morreuCom = null;
  try {
    for (const p of proveCom) {
      try {
        await p(c);
      } catch (e) {
        if (e instanceof assert.AssertionError || e.code === "ERR_ASSERTION") {
          morreuCom = e.message.split("\n")[0].slice(0, 120);
          break;
        }
        throw e;
      }
    }
  } finally {
    await c.query(SQL_FUNCAO); // restaura a função verdadeira
  }
  assert.notEqual(morreuCom, null, `MUTANTE SOBREVIVEU: ${rotulo}`);
  console.log(`      mutante morto: ${rotulo}  <-  ${morreuCom}`);
}

const UMA_VEZ = (texto, rotulo) => {
  assert.equal(
    SQL_FUNCAO.split(texto).length - 1,
    1,
    `mutante "${rotulo}": o trecho a trocar tem de aparecer UMA vez na função`,
  );
};

prova(
  "(12) mutantes: tirar ou trocar cada peça da correção deixa a prova certa vermelha",
  async (c) => {
    const antes = (await defDaFuncao(c)).def;

    UMA_VEZ(PERFORM_TRAVA, "sem a trava");
    await mutar(
      c,
      "sem a trava consultiva",
      SQL_FUNCAO.replace(PERFORM_TRAVA, () => ""),
      [corridaNaUltimaUnidade],
    );

    await mutar(
      c,
      "trava com chave CONSTANTE (serializa todas as vendas com chave)",
      SQL_FUNCAO.replace(
        "'venda_presencial:' || p_idempotency_key::text",
        () => "'venda_presencial'",
      ),
      [chavesDiferentesNaoSeSerializam],
    );

    await mutar(
      c,
      "trava de SESSÃO (não solta no commit)",
      SQL_FUNCAO.replace("pg_advisory_xact_lock", () => "pg_advisory_lock"),
      [corridaNaUltimaUnidade],
    );

    const travaSemGuarda = `    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('venda_presencial:' || COALESCE(p_idempotency_key::text, ''), 0));
`;
    const ancora =
      "    IF p_idempotency_key IS NOT NULL THEN\n        -- A MESMA CHAVE";
    UMA_VEZ(ancora, "trava com chave NULL");
    await mutar(
      c,
      "trava tomada também sem chave (venda sem chave serializa)",
      SQL_FUNCAO.replace(PERFORM_TRAVA, () => "").replace(
        ancora,
        () => travaSemGuarda + ancora,
      ),
      [semChaveNaoTravaNada],
    );

    const ancoraGate =
      "BEGIN\n    -- (1) O GATE VEM ANTES DE QUALQUER LEITURA.";
    UMA_VEZ(ancoraGate, "trava antes do gate");
    await mutar(
      c,
      "trava ANTES do gate de admin (quem não é da loja espera a chave)",
      SQL_FUNCAO.replace(PERFORM_TRAVA, () => "").replace(
        ancoraGate,
        () =>
          `BEGIN\n    IF p_idempotency_key IS NOT NULL THEN\n        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('venda_presencial:' || p_idempotency_key::text, 0));\n    END IF;\n    -- (1) O GATE VEM ANTES DE QUALQUER LEITURA.`,
      ),
      [gateAntesDaTrava],
    );

    assert.equal(
      (await defDaFuncao(c)).def,
      antes,
      "a função não foi restaurada",
    );
  },
);

// -------------------------------------------------------------------- runner

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  const resultados = [];
  let reporSucessora = false;
  let erroDaReposicao = null;
  try {
    const existe = await c.query("SELECT to_regprocedure($1) AS f", [FN]);
    if (!existe.rows[0].f) {
      falhar("FALHOU", `${FN} não existe: o banco não foi migrado.`);
    }
    let f = await defDaFuncao(c);
    const hashSucessora = md5(corpoDaFuncao(SQL_SUCESSORA));
    if (f.corpo === hashSucessora) {
      await c.query("BEGIN");
      try {
        await c.query(RB_SUCESSORA);
        await c.query("COMMIT");
        reporSucessora = true;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
      f = await defDaFuncao(c);
    }
    if (f.corpo !== HASH_NOVO) {
      falhar(
        "FALHOU",
        `o corpo vivo de registrar_venda_presencial (${f.corpo}) não é o da migration 20261235000000: ela não foi aplicada.`,
      );
    }
    // A ordem do arquivo, exceto que o controle (2) e os mutantes (12) trocam o corpo no banco
    // e rodam por último, depois das provas que medem a função verdadeira.
    const ordem = [...PROVAS].sort((a, b) => {
      const peso = (p) => (/^\((2|12)\)/.test(p.nome) ? 1 : 0);
      return peso(a) - peso(b);
    });
    for (const { nome, corpo } of ordem) {
      const t0 = Date.now();
      try {
        await corpo(c);
        resultados.push({ nome, ok: true });
        console.log(`  ok   ${nome} (${Date.now() - t0} ms)`);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        await c.query("RESET ROLE").catch(() => {});
        resultados.push({ nome, ok: false, erro: e.stack || String(e) });
        console.log(`  FAIL ${nome}\n${e.stack || e}`);
      }
    }
  } finally {
    try {
      if (reporSucessora) {
        await c.query("ROLLBACK");
        await c.query("RESET ROLE");
        await c.query("BEGIN");
        try {
          await c.query(SQL_SUCESSORA);
          await c.query("COMMIT");
          assert.equal(
            (await defDaFuncao(c)).corpo,
            md5(corpoDaFuncao(SQL_SUCESSORA)),
          );
        } catch (e) {
          await c.query("ROLLBACK");
          erroDaReposicao = e;
        }
      }
    } finally {
      await c.end();
    }
  }
  if (erroDaReposicao) throw erroDaReposicao;
  const falhas = resultados.filter((r) => !r.ok);
  const resumo = `${resultados.length - falhas.length}/${resultados.length} provas da venda repetida do balcão verdes.`;
  console.log(`\n[venda-balcao-mesma-chave] ${resumo}`);
  anexarAoSummary(
    "Prova viva: a venda repetida do balcão devolve a venda feita (20261235000000)",
    falhas.length
      ? `**${falhas.length} falha(s)**:\n\n${falhas.map((f) => `- ${f.nome}`).join("\n")}`
      : `**${resumo}**`,
  );
  if (falhas.length) process.exit(1);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));

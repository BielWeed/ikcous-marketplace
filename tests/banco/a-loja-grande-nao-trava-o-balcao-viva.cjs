"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante deste arquivo (QUEM, CONSULTA) ou do catalogo do Postgres efemero. */
/**
 * PROVA VIVA da migration 20261530000000_a_loja_grande_nao_trava_o_balcao_nem_os_avisos.sql contra o Postgres EFEMERO com as
 * migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de loja. Roda num CLONE (rodar-isolado.cjs): a fixture e
 * COMMITADA (a prova usa DUAS conexoes na trava) e o clone some no fim.
 *
 * O que prova (plano PLANO-LOJA-GRANDE-BANCO, T7):
 *  (a) DIFERENCIAL contra a porta antiga, no MESMO banco: para uma matriz de termos (NULL, vazio, espacos, nome, acento, e-mail,
 *      digitos com e sem o +55, telefone so da conta, cidade e UF do endereco PRINCIPAL, endereco nao principal, apostrofo, % e _,
 *      nada) e de tamanhos (1, 8, 50), buscar_clientes_do_balcao(termo, n) devolve os MESMOS ids, na MESMA ordem, com os MESMOS
 *      id/full_name/phone/email e o MESMO total que get_admin_customers_paged(termo, 'created_at', 'desc', 0, n). Inclui o perfil
 *      SEM linha em auth.users, o created_at NULL e o empate de created_at (desempate pelo id).
 *  (b) ZERO leitura de marketplace_orders (e de itens, historico, estornos, devolucoes, push), contada por pg_stat_xact_user_tables
 *      na propria transacao. CONTROLE: a antiga le marketplace_orders, e a nova le profiles (o contador funciona).
 *  (c) As guardas: admin atual passa; rebaixado so no profiles, rebaixado so no app_metadata (JWT velho dizendo admin) e cliente
 *      recebem a recusa da antiga (P0001); anon e service_role nao tem EXECUTE (42501); postgres passa. Teto 1..50 (NULL = 8).
 *  (d) EXPLAIN do sino/cron (historico) e da vitrine/painel (produtos) cita o indice novo, e antes dele (rollback) nao citava. E os
 *      TEMPOS, IMPRESSOS e nunca reprovados: com 10 mil produtos, a pagina 1 e a pagina 50 da vitrine (vw_produtos_public com as
 *      variacoes embutidas, OFFSET 0 e 9800, 200 por pagina) antes e depois do indice; com 20 mil perfis e 50 mil pedidos, a porta
 *      nova contra a antiga.
 *  (e) MUTANTES da porta (sem a busca por digitos, INNER JOIN em auth.users, ordem crescente, sem desempate, lendo pedidos, sem
 *      is_admin_atual, sem teto, termo NULL virando vazio, anon e service_role com EXECUTE, SECURITY INVOKER) morrem na prova certa;
 *      mutantes da migration (indice sem o id, sem o DESC, CONCURRENTLY, outro corpo, GRANT ao anon) sao recusados por ela mesma.
 *  (f) Reaplicar (LF, CRLF, LF) nao muda porta, indices nem dado; o rollback derruba so os 3 objetos e nao muda dado (2x igual);
 *      reaplicar depois volta; o pre-voo recusa nome ocupado por outro objeto (e o do rollback tambem); com outra conexao gravando no
 *      historico a migration desiste no lock_timeout de 5 s e NADA fica (nem o indice de produtos, construido antes: sem COMMIT
 *      escondido). Consultas 190a/190b EXECUTADAS como authenticated nos dois sentidos, com defeitos plantados.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-grande-nao-trava-o-balcao-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261530000000_a_loja_grande_nao_trava_o_balcao_nem_os_avisos.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const MIGRATION = ler(`supabase/migrations/${NOME}`);
const ROLLBACK = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const A190 = "190a-conferir-a-loja-grande-nao-trava-o-balcao-aplicado";
const B190 = "190b-antes-a-loja-grande-nao-trava-o-balcao-ausente";
const CONSULTA = {
  [A190]: ler(`scripts/publicacao/consultas/${A190}.sql`),
  [B190]: ler(`scripts/publicacao/consultas/${B190}.sql`),
};
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO = MIGRATION.match(
  /CREATE OR REPLACE FUNCTION public\.buscar_clientes_do_balcao\([^\n]*\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
)[1];
const MD5_PORTA = md5(CORPO);
const MD5_ANTIGA = "bdac47c59600f44cf59ac6c74e44a55e";
// A porta como esta no arquivo, do CREATE ate antes do COMMENT (com o REVOKE e o GRANT): os mutantes trocam um trecho dela.
const DDL_PORTA = MIGRATION.slice(
  MIGRATION.indexOf(
    "CREATE OR REPLACE FUNCTION public.buscar_clientes_do_balcao(",
  ),
  MIGRATION.indexOf("\nCOMMENT ON FUNCTION public.buscar_clientes_do_balcao"),
);
const PORTA = "public.buscar_clientes_do_balcao(text, integer)";
const INDICES = [
  "idx_produtos_data_cadastro_id",
  "idx_order_history_status_criado",
];

const U = (n) => `b5300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(9001);
const REB_PERFIL = U(9002);
const REB_AUTH = U(9003);
const CLIENTE = U(9004);
const T_EMPATE = "2026-03-01T12:00:00Z";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
// O SET ROLE do PostgREST, o login (auth.uid() desta suite le app.rpc.user_id) e o JWT.
const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  admin: { papel: "authenticated", uid: ADMIN, jwt: claims(ADMIN, "admin") },
  rebaixadoPerfil: {
    papel: "authenticated",
    uid: REB_PERFIL,
    jwt: claims(REB_PERFIL, "admin"),
  },
  rebaixadoAuth: {
    papel: "authenticated",
    uid: REB_AUTH,
    jwt: claims(REB_AUTH, "admin"),
  },
  cliente: { papel: "authenticated", uid: CLIENTE, jwt: claims(CLIENTE, null) },
  service: {
    papel: "service_role",
    uid: "",
    jwt: JSON.stringify({ role: "service_role" }),
  },
  postgres: { papel: "postgres", uid: "", jwt: "" },
};

async function entrar(c, quem) {
  const q = QUEM[quem];
  await c.query(`SET LOCAL ROLE ${q.papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
}
/** Roda `sql` como `quem` dentro de um SAVEPOINT sempre desfeito (vale dentro ou fora de uma transacao aberta pela prova). */
async function comoQuem(c, quem, sql, params = []) {
  await c.query("SAVEPOINT quem530");
  try {
    await entrar(c, quem);
    const r = await c.query(sql, params);
    return { ok: true, linhas: r.rows };
  } catch (erro) {
    return { ok: false, code: erro.code, message: erro.message };
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT quem530");
    await c.query("RELEASE SAVEPOINT quem530");
  }
}
async function emTransacao(c, acao) {
  await c.query("BEGIN");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK");
  }
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa530");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa530");
    await c.query("RELEASE SAVEPOINT recusa530");
  }
}
const nova = (c, termo, n, quem = "admin") =>
  comoQuem(
    c,
    quem,
    "SELECT public.buscar_clientes_do_balcao($1::text, $2::integer) AS r",
    [termo, n],
  );
const antiga = (c, termo, n) =>
  comoQuem(
    c,
    "admin",
    "SELECT public.get_admin_customers_paged($1::text, 'created_at', 'desc', 0, $2::integer) AS r",
    [termo, n],
  );
const resposta = (r, onde) => {
  assert.equal(r.ok, true, `${onde}: ${r.code} ${r.message}`);
  return r.linhas[0].r;
};

// ---------------------------------------------------------------------------
// Fixture (COMMITADA no clone)
// ---------------------------------------------------------------------------

// Clientes especiais: [id, nome, whatsapp, conta ({email, phone} ou null = SEM linha em auth.users), created_at].
const ESPECIAIS = [
  [
    U(1),
    "João Balcao530 Acento",
    "(34) 99876-1234",
    { email: "joao@balcao530.teste", phone: null },
    "2026-01-10T10:00:00Z",
  ],
  [
    U(2),
    "Balcao530 Telefone da Conta",
    null,
    { email: "tel@balcao530.teste", phone: "+5534988887777" },
    T_EMPATE,
  ],
  [U(3), "Balcao530 Sem Conta", "(11) 97777-0000", null, T_EMPATE],
  [
    U(4),
    "Balcao530 Data Nula",
    null,
    { email: "nula@balcao530.teste", phone: null },
    null,
  ],
  [
    U(5),
    "Balcao530 Empate A",
    "(34) 91111-0005",
    { email: "ea@balcao530.teste", phone: null },
    T_EMPATE,
  ],
  [
    U(6),
    "Balcao530 Empate B",
    "(34) 91111-0006",
    { email: "eb@balcao530.teste", phone: null },
    T_EMPATE,
  ],
  [
    U(7),
    "Maria D'Avila Balcao530",
    null,
    { email: "maria@balcao530.teste", phone: null },
    "2026-02-02T08:00:00Z",
  ],
  [
    U(8),
    "Pedro Cidade",
    null,
    { email: "pedro@outro530.teste", phone: null },
    "2026-02-03T08:00:00Z",
  ],
];
const COMUNS = Array.from({ length: 52 }, (_, i) => [
  U(100 + i),
  `Balcao530 Cliente ${String(i).padStart(2, "0")}`,
  `(34) 9${String(2000 + i).padStart(4, "0")}-${String(5300 + i)}`,
  { email: `c${i}@balcao530.teste`, phone: null },
  new Date(Date.UTC(2025, 6, 1) + i * 3600 * 1000).toISOString(),
]);

async function preparar(c) {
  await c.query("BEGIN");
  // O auth emulado do CI nao da USAGE nos schemas da plataforma (a loja da).
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const id of [ADMIN, REB_PERFIL, REB_AUTH, CLIENTE])
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@papel530.teste', '{}'::jsonb)",
      [id],
    );
  // O INSERT em profiles leva o papel a auth.users (gatilho de sincronia); as contradicoes vao direto em auth.users.
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 530', 'admin'), ($2, 'Rebaixado Perfil 530', 'customer'),
       ($3, 'Rebaixado Auth 530', 'admin'), ($4, 'Cliente 530', 'customer')`,
    [ADMIN, REB_PERFIL, REB_AUTH, CLIENTE],
  );
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1`,
    [REB_PERFIL],
  );
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = $1`,
    [REB_AUTH],
  );
  for (const [id, nome, whatsapp, conta, criado] of [...ESPECIAIS, ...COMUNS]) {
    if (conta) {
      await c.query(
        "INSERT INTO auth.users (id, email, phone, raw_app_meta_data) VALUES ($1, $2, $3, '{}'::jsonb)",
        [id, conta.email, conta.phone],
      );
      await c.query(
        "INSERT INTO public.profiles (id, full_name, role, whatsapp, created_at) VALUES ($1, $2, 'customer', $3, $4)",
        [id, nome, whatsapp, criado],
      );
    } else {
      // Perfil SEM linha em auth.users: a FK de profiles o impede hoje; a prova o planta (sem gatilhos nem FK) para fixar que a
      // porta nova, como a antiga, o acha (LEFT JOIN). Com INNER JOIN ele sumiria do balcao.
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query(
        "INSERT INTO public.profiles (id, full_name, role, whatsapp, created_at) VALUES ($1, $2, 'customer', $3, $4)",
        [id, nome, whatsapp, criado],
      );
      await c.query("SET LOCAL session_replication_role = origin");
    }
  }
  const endereco = (uid, cidade, uf, principal, criado) =>
    c.query(
      `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default, created_at)
       VALUES ($1, 'Casa', 'Fixture', '38400000', 'Rua', '1', 'Centro', $2, $3, $4, $5)`,
      [uid, cidade, uf, principal, criado],
    );
  // Pedro so e achado pela cidade/UF do endereco PRINCIPAL; a cidade do outro endereco nao acha ninguem.
  await endereco(U(8), "Uberlândia530", "MG", true, "2026-01-01T00:00:00Z");
  await endereco(U(8), "NaoPrincipal530", "SP", false, "2026-01-02T00:00:00Z");
  // Joao tem DOIS enderecos principais: vale o mais novo (Patos530), como na antiga.
  await endereco(U(1), "Araxá530", "MG", true, "2026-01-01T00:00:00Z");
  await endereco(U(1), "Patos530", "MG", true, "2026-01-05T00:00:00Z");
  // Pedidos de alguns clientes: a antiga junta todos eles; a nova nao le nenhum.
  await c.query("SET LOCAL session_replication_role = replica");
  for (const [uid, total] of [
    [U(1), 50],
    [U(100), 20],
    [U(101), 30],
  ])
    await c.query(
      `INSERT INTO public.marketplace_orders
         (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at)
       VALUES ($1, 'Fixture 530', '{}'::jsonb, $2, $2, 'delivered', 'online', 'online', 'pago', now())`,
      [uid, total],
    );
  await c.query("SET LOCAL session_replication_role = origin");
  await c.query("COMMIT");
}

// ---------------------------------------------------------------------------
// As provas de comportamento (reusadas pelos mutantes)
// ---------------------------------------------------------------------------

const TERMOS = [
  null,
  "",
  "   ",
  "Balcao530",
  "balcao530",
  "joao",
  "JOÃO",
  "@balcao530.teste",
  "99876",
  "34 99876-1234",
  "+55 (34) 99876-1234",
  "5534988887777",
  "988887777",
  "612",
  "6123",
  "Uberlandia530",
  "uberlândia530",
  "Patos530",
  "Araxa530",
  "NaoPrincipal530",
  "MG",
  "d'avila",
  "%",
  "_",
  "Sem Conta",
  "Data Nula",
  "Balcao530 Cliente 1",
  "zz-nada-530",
];
const LIMITES = [1, 8, 50];
const QUATRO = (l) => ({
  id: l.id,
  full_name: l.full_name,
  phone: l.phone,
  email: l.email,
});

async function diferencial(c, termos = TERMOS, limites = LIMITES) {
  let casos = 0;
  for (const termo of termos)
    for (const n of limites) {
      const onde = `termo ${JSON.stringify(termo)}, ${n} por pagina`;
      const a = resposta(await antiga(c, termo, n), `antiga, ${onde}`);
      const b = resposta(await nova(c, termo, n), `nova, ${onde}`);
      assert.deepEqual(Object.keys(b).sort(), ["data", "total_count"], onde);
      assert.equal(
        Number(b.total_count),
        Number(a.total_count),
        `total, ${onde}`,
      );
      assert.deepEqual(b.data, a.data.map(QUATRO), `linhas, ${onde}`);
      for (const l of b.data)
        assert.deepEqual(Object.keys(l).sort(), [
          "email",
          "full_name",
          "id",
          "phone",
        ]);
      casos += 1;
    }
  return casos;
}

/** Os casos que a matriz tem de cobrir de verdade (sem eles o diferencial poderia passar com as duas portas vazias). */
async function casosDeBorda(c) {
  // So os ids desta fixture: o clone pode trazer perfis de outras provas, e o diferencial ja cobre o resto.
  const ids = async (termo, n = 50) =>
    resposta(await nova(c, termo, n), JSON.stringify(termo))
      .data.map((l) => l.id)
      .filter((id) => id.startsWith("b5300000-"));
  const r = async (termo, n = 50) =>
    resposta(await nova(c, termo, n), JSON.stringify(termo));
  assert.deepEqual(
    await r(null),
    { data: [], total_count: 0 },
    "termo NULL nao acha ninguem (como a antiga)",
  );
  const vazio = await r("");
  assert.ok(vazio.total_count >= 64, "termo vazio acha todo mundo");
  assert.deepEqual(await r("   "), vazio, "espacos = vazio");
  assert.deepEqual(
    await ids("Sem Conta"),
    [U(3)],
    "o perfil sem auth.users aparece",
  );
  assert.equal((await r("Sem Conta")).data[0].email, null);
  assert.deepEqual(await ids("Data Nula"), [U(4)]);
  const todos = await ids("Balcao530");
  assert.equal((await r("Balcao530")).total_count, 59);
  assert.equal(
    todos[0],
    U(4),
    "created_at NULL vem primeiro (DESC poe NULL antes, como a antiga)",
  );
  const empatados = todos.filter((id) => [U(2), U(3), U(5), U(6)].includes(id));
  assert.deepEqual(
    empatados,
    [U(2), U(3), U(5), U(6)],
    "o empate de created_at sai pelo id crescente",
  );
  assert.deepEqual(await ids("joao"), [U(1)], "sem acento acha com acento");
  assert.deepEqual(
    await ids("+55 (34) 99876-1234"),
    [U(1)],
    "o +55 colado sai e os digitos acham o WhatsApp mascarado",
  );
  assert.deepEqual(
    await ids("988887777"),
    [U(2)],
    "o telefone so da conta acha pelos digitos",
  );
  // "6123" so aparece nos DIGITOS do WhatsApp de Joao ("(34) 99876-1234" -> 34998761234); com 3 digitos a regra nao vale.
  assert.deepEqual(await ids("6123"), [U(1)], "4 digitos acham pelo telefone");
  assert.deepEqual(await ids("612"), [], "3 digitos nao valem como telefone");
  assert.deepEqual(
    await ids("Uberlandia530"),
    [U(8)],
    "a cidade do endereco principal acha",
  );
  assert.deepEqual(
    await ids("NaoPrincipal530"),
    [],
    "a cidade do endereco nao principal nao acha",
  );
  assert.deepEqual(
    await ids("Patos530"),
    [U(1)],
    "dois principais: vale o mais novo",
  );
  assert.deepEqual(await ids("Araxa530"), []);
  assert.deepEqual(await ids("d'avila"), [U(7)]);
  assert.deepEqual(await ids("zz-nada-530"), []);
}

const TABELAS_DE_PEDIDO = [
  "marketplace_orders",
  "marketplace_order_items",
  "marketplace_order_history",
  "order_refunds",
  "devolucoes",
  "push_subscriptions",
];
async function contarLeituras(c) {
  const r = await c.query(
    `SELECT relname, (COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0))::bigint AS n
       FROM pg_stat_xact_user_tables WHERE schemaname = 'public' AND relname = ANY($1::text[])`,
    [[...TABELAS_DE_PEDIDO, "profiles"]],
  );
  return Object.fromEntries(r.rows.map((l) => [l.relname, Number(l.n)]));
}
/** Quantas vezes cada tabela foi lida (varredura ou indice) por UMA chamada, como admin, na propria transacao. */
async function leiturasDe(c, sql, params) {
  await c.query("SAVEPOINT leitura530");
  try {
    const antes = await contarLeituras(c);
    await entrar(c, "admin");
    await c.query(sql, params);
    await c.query("RESET ROLE");
    const depois = await contarLeituras(c);
    const delta = {};
    for (const t of [...TABELAS_DE_PEDIDO, "profiles"])
      delta[t] = (depois[t] ?? 0) - (antes[t] ?? 0);
    return delta;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT leitura530");
    await c.query("RELEASE SAVEPOINT leitura530");
  }
}
async function semPedidos(c, termos = ["Balcao530", "", "99876"]) {
  for (const termo of termos) {
    const n = await leiturasDe(
      c,
      "SELECT public.buscar_clientes_do_balcao($1::text, 8)",
      [termo],
    );
    for (const t of TABELAS_DE_PEDIDO)
      assert.equal(
        n[t],
        0,
        `a porta nova leu ${t} (${n[t]}x) com o termo ${JSON.stringify(termo)}`,
      );
    assert.ok(
      n.profiles > 0,
      "CONTROLE: o contador nao viu a leitura de profiles",
    );
    const v = await leiturasDe(
      c,
      "SELECT public.get_admin_customers_paged($1::text, 'created_at', 'desc', 0, 8)",
      [termo],
    );
    assert.ok(
      v.marketplace_orders > 0,
      "CONTROLE: a antiga deveria ler marketplace_orders",
    );
  }
}

const RECUSA_DE_ADMIN =
  /^Acesso negado: privilégios de administrador necessários\.$/;
async function guardas(c) {
  const adm = resposta(await nova(c, "Balcao530", 8), "admin atual");
  assert.equal(adm.total_count, 59);
  for (const quem of ["rebaixadoPerfil", "rebaixadoAuth", "cliente"]) {
    const r = await nova(c, "Balcao530", 8, quem);
    assert.equal(r.ok, false, `${quem} passou`);
    assert.equal(r.code, "P0001", `${quem}: ${r.code} ${r.message}`);
    assert.match(r.message, RECUSA_DE_ADMIN);
  }
  for (const quem of ["anon", "service"]) {
    const r = await nova(c, "Balcao530", 8, quem);
    assert.equal(r.ok, false, `${quem} passou`);
    assert.equal(r.code, "42501", `${quem}: ${r.code} ${r.message}`);
    assert.match(
      r.message,
      /permission denied for function buscar_clientes_do_balcao/,
    );
  }
  resposta(await nova(c, "Balcao530", 8, "postgres"), "postgres");
}
async function teto(c) {
  for (const [n, esperado] of [
    [null, 8],
    [0, 1],
    [-3, 1],
    [1, 1],
    [8, 8],
    [50, 50],
    [51, 50],
    [1000, 50],
  ]) {
    const r = resposta(await nova(c, "Balcao530", n), `limite ${n}`);
    assert.equal(r.data.length, esperado, `limite ${n}`);
    assert.equal(r.total_count, 59, `limite ${n}: o total nao depende do teto`);
  }
}

// ---------------------------------------------------------------------------
// Catalogo, dado, consultas
// ---------------------------------------------------------------------------

async function retrato(c) {
  const r = await c.query(
    `SELECT
       (SELECT to_jsonb(x) FROM (SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, p.proacl::text AS acl, p.proconfig,
                                        p.provolatile, p.prosecdef, p.proowner, pg_get_function_arguments(p.oid) AS args
                                   FROM pg_proc p WHERE p.oid = to_regprocedure($1)) x) AS porta,
       (SELECT jsonb_agg(jsonb_build_array(c.oid, pg_get_indexdef(c.oid)) ORDER BY c.relname)
          FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($2::text[])) AS indices,
       (SELECT to_jsonb(x) FROM (SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, p.proacl::text AS acl
                                   FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)')) x) AS antiga`,
    [PORTA, INDICES],
  );
  return r.rows[0];
}
async function dados(c) {
  const r = await c.query(
    `SELECT
       (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id)) FROM public.profiles p) AS perfis,
       (SELECT md5(string_agg(to_jsonb(u)::text, '|' ORDER BY u.id)) FROM auth.users u) AS contas,
       (SELECT md5(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id)) FROM public.user_addresses a) AS enderecos,
       (SELECT md5(string_agg(to_jsonb(o)::text, '|' ORDER BY o.id)) FROM public.marketplace_orders o) AS pedidos,
       (SELECT md5(string_agg(h.id::text, '|' ORDER BY h.id)) FROM public.marketplace_order_history h) AS historico,
       (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id)) FROM public.produtos p) AS produtos`,
  );
  return r.rows[0];
}
async function consulta(c, nome) {
  await c.query("SAVEPOINT consulta530");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const { rows } = await c.query(CONSULTA[nome]);
    const rol = CONF.ROL_FECHADO_POR_CONSULTA[nome];
    assert.equal(rows.length, rol.length, `${nome}: rol fechado`);
    assert.deepEqual(
      rows.map((l) => l.item).sort(),
      [...rol].sort(),
      `${nome}: itens`,
    );
    for (const l of rows)
      assert.equal(typeof l.ok, "boolean", `${nome}: ok nao booleano`);
    return rows
      .filter((l) => !l.ok)
      .map((l) => l.item)
      .sort();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT consulta530");
    await c.query("RELEASE SAVEPOINT consulta530");
  }
}
const ROL_A = CONF.ROL_FECHADO_POR_CONSULTA[A190];
const ROL_B = CONF.ROL_FECHADO_POR_CONSULTA[B190];
const SO = (rol, ...trechos) =>
  rol.filter((item) => trechos.some((t) => item.startsWith(t))).sort();

async function existe(c) {
  const r = await c.query(
    `SELECT to_regprocedure($1) IS NOT NULL AS porta,
            to_regclass('public.idx_produtos_data_cadastro_id') IS NOT NULL AS produtos,
            to_regclass('public.idx_order_history_status_criado') IS NOT NULL AS historico`,
    [PORTA],
  );
  return r.rows[0];
}

// ---------------------------------------------------------------------------
// As provas
// ---------------------------------------------------------------------------

const PROVAS = [];
const provar = (nome, corpo) => PROVAS.push({ nome, corpo });

provar(
  "(0) o banco nascido das migrations tem a porta e os 2 indices desta migration; 190a positiva, 190b reprova so a ausencia",
  async (c) => {
    const r = await retrato(c);
    assert.equal(r.porta.h, MD5_PORTA, "o corpo vivo nao e o desta migration");
    assert.equal(
      r.antiga.h,
      MD5_ANTIGA,
      "a get_admin_customers_paged nao e a da 20261412000000",
    );
    assert.equal(r.indices.length, 2);
    await emTransacao(c, async () => {
      assert.deepEqual(await consulta(c, A190), []);
      assert.deepEqual(
        await consulta(c, B190),
        SO(
          ROL_B,
          "buscar_clientes_do_balcao ainda NAO",
          "idx_produtos_data_cadastro_id e",
        ),
      );
    });
  },
);

provar(
  "(a) diferencial: a porta nova devolve os mesmos ids, ordem, campos e total da antiga, em toda a matriz",
  async (c) => {
    await emTransacao(c, async () => {
      const casos = await diferencial(c);
      await casosDeBorda(c);
      console.log(
        `   ${casos} combinacoes termo x tamanho iguais nas duas portas`,
      );
    });
  },
);

provar(
  "(b) a porta nova le ZERO vezes pedidos, itens, historico, estornos, devolucoes e push (controle: a antiga le pedidos)",
  async (c) => {
    await emTransacao(c, () => semPedidos(c));
  },
);

provar(
  "(c) guardas: admin atual passa; rebaixados e cliente P0001; anon e service_role sem EXECUTE; postgres passa; teto 1..50",
  async (c) => {
    await emTransacao(c, async () => {
      await guardas(c);
      await teto(c);
    });
  },
);

const MUTANTES_DA_PORTA = [
  {
    nome: "sem a busca por digitos",
    de: `                (length(v_search_digitos) >= 4 AND (
                    regexp_replace(COALESCE(p.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%' OR
                    regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%'
                )) OR
`,
    para: "",
    morre: diferencial,
  },
  {
    nome: "INNER JOIN em auth.users (o perfil sem conta some)",
    de: "LEFT JOIN auth.users u ON u.id = p.id",
    para: "JOIN auth.users u ON u.id = p.id",
    morre: diferencial,
  },
  {
    nome: "ordem crescente",
    de: "p.created_at DESC, p.id",
    para: "p.created_at ASC, p.id",
    todos: true,
    morre: diferencial,
  },
  {
    nome: "sem o desempate pelo id crescente",
    de: "p.created_at DESC, p.id",
    para: "p.created_at DESC, p.id DESC",
    todos: true,
    morre: diferencial,
  },
  {
    nome: "le pedidos",
    de: "    WITH achados AS (",
    para: "    PERFORM 1 FROM public.marketplace_orders LIMIT 1;\n    WITH achados AS (",
    morre: semPedidos,
  },
  {
    nome: "sem is_admin_atual",
    de: `    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
`,
    para: "",
    morre: guardas,
  },
  {
    nome: "sem teto",
    de: "v_limite := LEAST(GREATEST(COALESCE(p_limite, 8), 1), 50);",
    para: "v_limite := COALESCE(p_limite, 8);",
    morre: teto,
  },
  {
    nome: "termo NULL vira vazio (acharia todo mundo)",
    de: "v_clean_search := TRIM(p_search);",
    para: "v_clean_search := COALESCE(TRIM(p_search), '');",
    morre: diferencial,
  },
  {
    nome: "anon com EXECUTE",
    de: "TO authenticated;",
    para: "TO authenticated, anon;",
    morre: guardas,
  },
  {
    nome: "service_role com EXECUTE",
    de: "TO authenticated;",
    para: "TO authenticated, service_role;",
    morre: guardas,
  },
  {
    nome: "SECURITY INVOKER",
    de: " SECURITY DEFINER\n",
    para: " SECURITY INVOKER\n",
    morre: guardas,
  },
];

provar(
  `(e) ${MUTANTES_DA_PORTA.length} mutantes da porta morrem na prova certa`,
  async (c) => {
    for (const m of MUTANTES_DA_PORTA) {
      const mutante = m.todos
        ? DDL_PORTA.split(m.de).join(m.para)
        : DDL_PORTA.replace(m.de, m.para);
      assert.notEqual(mutante, DDL_PORTA, `mutante "${m.nome}" nao mudou nada`);
      let morreu = null;
      await emTransacao(c, async () => {
        await c.query(mutante);
        try {
          await m.morre(c);
        } catch (erro) {
          morreu = erro;
        }
      });
      assert.ok(morreu, `MUTANTE SOBREVIVEU: ${m.nome}`);
      console.log(
        `   mutante morto: ${m.nome} (${String(morreu.message).split("\n")[0].slice(0, 110)})`,
      );
    }
    // E o corpo vivo continua o desta migration.
    assert.equal((await retrato(c)).porta.h, MD5_PORTA);
  },
);

const MUTANTES_DA_MIGRATION = [
  {
    nome: "indice de produtos sem o id",
    de: "ON public.produtos (data_cadastro DESC, id);",
    para: "ON public.produtos (data_cadastro DESC);",
    erro: /B2_POSVOO_DIVERGENTE: public\.idx_produtos_data_cadastro_id/,
  },
  {
    nome: "indice do historico sem o DESC",
    de: "ON public.marketplace_order_history (new_status, created_at DESC);",
    para: "ON public.marketplace_order_history (new_status, created_at);",
    erro: /B2_POSVOO_DIVERGENTE: public\.idx_order_history_status_criado/,
  },
  {
    nome: "CONCURRENTLY",
    de: "CREATE INDEX IF NOT EXISTS idx_produtos_data_cadastro_id",
    para: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_produtos_data_cadastro_id",
    erro: { code: "25001" },
  },
  {
    nome: "outro corpo da porta",
    de: "v_limite := LEAST(GREATEST(COALESCE(p_limite, 8), 1), 50);",
    para: "v_limite := LEAST(GREATEST(COALESCE(p_limite, 8), 1), 500);",
    erro: /B2_POSVOO_DIVERGENTE: public\.buscar_clientes_do_balcao nao ficou com o corpo/,
  },
  {
    nome: "GRANT ao anon",
    de: "TO authenticated;",
    para: "TO authenticated, anon;",
    erro: /B2_POSVOO_DIVERGENTE: o EXECUTE de public\.buscar_clientes_do_balcao/,
  },
];

provar(
  `(e) ${MUTANTES_DA_MIGRATION.length} mutantes da migration sao recusados por ela mesma (pos-voo ou Postgres)`,
  async (c) => {
    for (const m of MUTANTES_DA_MIGRATION) {
      const mutante = MIGRATION.replace(m.de, m.para);
      assert.notEqual(mutante, MIGRATION, m.nome);
      await emTransacao(c, async () => {
        await c.query(ROLLBACK);
        await recusa(c, mutante, m.erro);
        assert.deepEqual(
          await existe(c),
          { porta: false, produtos: false, historico: false },
          m.nome,
        );
      });
      console.log(`   mutante recusado: ${m.nome}`);
    }
  },
);

provar(
  "(f) reaplicar (LF, CRLF, LF) nao muda porta, indices nem dado",
  async (c) => {
    await emTransacao(c, async () => {
      const antes = await retrato(c);
      const dado = await dados(c);
      for (const texto of [
        MIGRATION,
        MIGRATION.replace(/\n/g, "\r\n"),
        MIGRATION,
      ]) {
        await c.query(texto);
        assert.deepEqual(await retrato(c), antes);
        assert.deepEqual(await dados(c), dado);
      }
    });
  },
);

provar(
  "(f) rollback derruba so os 3 objetos, nao muda dado, 2x igual; 190b positiva e 190a reprova so os 4 itens novos; reaplicar volta",
  async (c) => {
    await emTransacao(c, async () => {
      const dado = await dados(c);
      const antes = await retrato(c);
      await c.query(ROLLBACK);
      assert.deepEqual(await existe(c), {
        porta: false,
        produtos: false,
        historico: false,
      });
      assert.deepEqual(await dados(c), dado, "o rollback mudou dado");
      const desfeito = await retrato(c);
      assert.deepEqual(
        desfeito.antiga,
        antes.antiga,
        "o rollback tocou na porta antiga",
      );
      await c.query(ROLLBACK);
      assert.deepEqual(await retrato(c), desfeito, "rollback 2x");
      assert.deepEqual(await consulta(c, B190), []);
      assert.deepEqual(
        await consulta(c, A190),
        SO(ROL_A, "buscar_clientes_do_balcao:", "idx_"),
      );
      await c.query(MIGRATION);
      assert.deepEqual(await consulta(c, A190), []);
      assert.equal((await retrato(c)).porta.h, MD5_PORTA);
      assert.deepEqual(await dados(c), dado, "reaplicar mudou dado");
      await diferencial(c, ["Balcao530", "Sem Conta", null], [8]);
    });
  },
);

const PLANTIOS_DO_PRE_VOO = [
  [
    "indice de produtos com outra coluna",
    "CREATE INDEX idx_produtos_data_cadastro_id ON public.produtos (nome)",
    /B1_BASELINE_DIVERGENT: public\.idx_produtos_data_cadastro_id ja existe/,
  ],
  [
    "o nome do indice do historico em outra tabela",
    "CREATE INDEX idx_order_history_status_criado ON public.produtos (data_cadastro DESC, id)",
    /B1_BASELINE_DIVERGENT: public\.idx_order_history_status_criado ja existe/,
  ],
  [
    "indice unico com as mesmas colunas",
    "CREATE UNIQUE INDEX idx_produtos_data_cadastro_id ON public.produtos (data_cadastro DESC, id)",
    /B1_BASELINE_DIVERGENT: public\.idx_produtos_data_cadastro_id ja existe/,
  ],
  [
    "indice parcial",
    "CREATE INDEX idx_order_history_status_criado ON public.marketplace_order_history (new_status, created_at DESC) WHERE new_status = 'cancelled'",
    /B1_BASELINE_DIVERGENT: public\.idx_order_history_status_criado ja existe/,
  ],
  [
    "NULLS LAST",
    "CREATE INDEX idx_order_history_status_criado ON public.marketplace_order_history (new_status, created_at DESC NULLS LAST)",
    /B1_BASELINE_DIVERGENT: public\.idx_order_history_status_criado ja existe/,
  ],
  [
    "uma tabela com o nome do indice",
    "CREATE TABLE public.idx_produtos_data_cadastro_id (x int)",
    /B1_BASELINE_DIVERGENT: public\.idx_produtos_data_cadastro_id ja existe/,
  ],
  [
    "a porta com outro corpo",
    "CREATE FUNCTION public.buscar_clientes_do_balcao(p_search text, p_limite integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
    /B1_BASELINE_DIVERGENT: public\.buscar_clientes_do_balcao ja existe/,
  ],
  [
    "uma sobrecarga da porta",
    "CREATE FUNCTION public.buscar_clientes_do_balcao(p_search text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
    /B1_BASELINE_DIVERGENT: public\.buscar_clientes_do_balcao ja existe/,
  ],
];

provar(
  `(f) o pre-voo recusa ${PLANTIOS_DO_PRE_VOO.length} nomes ocupados por outro objeto, antes de escrever; o do rollback recusa derrubar o que nao e dele`,
  async (c) => {
    for (const [nome, plantio, erro] of PLANTIOS_DO_PRE_VOO)
      await emTransacao(c, async () => {
        await c.query(ROLLBACK);
        await c.query(plantio);
        const antes = await existe(c);
        await recusa(c, MIGRATION, erro);
        assert.deepEqual(await existe(c), antes, `${nome}: escreveu`);
      });
    for (const [nome, plantio] of [
      [
        "indice unico no lugar do do historico",
        "DROP INDEX public.idx_order_history_status_criado; CREATE UNIQUE INDEX idx_order_history_status_criado ON public.marketplace_order_history (id)",
      ],
      [
        "porta com outro corpo",
        "CREATE OR REPLACE FUNCTION public.buscar_clientes_do_balcao(p_search text, p_limite integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
      ],
    ])
      await emTransacao(c, async () => {
        await c.query(plantio);
        await recusa(c, ROLLBACK, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await existe(c),
          { porta: true, produtos: true, historico: true },
          `${nome}: o rollback derrubou`,
        );
      });
  },
);

provar(
  "(f) consultas 190a/190b com defeitos plantados: cada defeito reprova exatamente o item certo",
  async (c) => {
    const corpoAntigoMexido = async () => {
      const def = (
        await c.query(
          "SELECT pg_get_functiondef('public.get_admin_customers_paged(text,text,text,integer,integer)'::regprocedure) AS d",
        )
      ).rows[0].d;
      const mexido = def.replace("\nBEGIN\n", "\nBEGIN \n");
      assert.notEqual(mexido, def);
      await c.query(mexido);
    };
    const defeitosA = [
      [
        "GRANT ao anon",
        `GRANT EXECUTE ON FUNCTION ${PORTA} TO anon`,
        "buscar_clientes_do_balcao: EXECUTE",
      ],
      [
        "GRANT ao service_role",
        `GRANT EXECUTE ON FUNCTION ${PORTA} TO service_role`,
        "buscar_clientes_do_balcao: EXECUTE",
      ],
      [
        "porta STABLE virou VOLATILE",
        `ALTER FUNCTION ${PORTA} VOLATILE`,
        "buscar_clientes_do_balcao: uma so",
      ],
      [
        "indice do historico NULLS LAST",
        "DROP INDEX public.idx_order_history_status_criado; CREATE INDEX idx_order_history_status_criado ON public.marketplace_order_history (new_status, created_at DESC NULLS LAST)",
        "idx_order_history_status_criado:",
      ],
      [
        "indice de produtos sem o id",
        "DROP INDEX public.idx_produtos_data_cadastro_id; CREATE INDEX idx_produtos_data_cadastro_id ON public.produtos (data_cadastro DESC)",
        "idx_produtos_data_cadastro_id:",
      ],
      [
        "porta antiga com outro search_path",
        "ALTER FUNCTION public.get_admin_customers_paged(text,text,text,integer,integer) SET search_path = public",
        "get_admin_customers_paged:",
      ],
      [
        "porta antiga com outro corpo",
        corpoAntigoMexido,
        "get_admin_customers_paged:",
      ],
    ];
    const defeitosB = [
      [
        "indice de produtos ja existe com outra definicao",
        "CREATE INDEX idx_produtos_data_cadastro_id ON public.produtos (nome)",
        "idx_produtos_data_cadastro_id e",
      ],
      [
        "porta ja existe",
        "CREATE FUNCTION public.buscar_clientes_do_balcao(p_search text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
        "buscar_clientes_do_balcao ainda NAO",
      ],
      [
        "porta antiga com outro corpo",
        corpoAntigoMexido,
        "get_admin_customers_paged:",
      ],
    ];
    const plantar = (p) => (typeof p === "function" ? p() : c.query(p));
    let n = 0;
    for (const [nome, plantio, item] of defeitosA)
      await emTransacao(c, async () => {
        await plantar(plantio);
        assert.deepEqual(
          await consulta(c, A190),
          SO(ROL_A, item),
          `190a, ${nome}`,
        );
        n += 1;
      });
    for (const [nome, plantio, item] of defeitosB)
      await emTransacao(c, async () => {
        await c.query(ROLLBACK);
        await plantar(plantio);
        assert.deepEqual(
          await consulta(c, B190),
          SO(ROL_B, item),
          `190b, ${nome}`,
        );
        n += 1;
      });
    console.log(`   ${n} defeitos plantados, cada um no item certo`);
  },
);

provar(
  "(f) com outra conexao gravando no historico, a migration desiste no lock_timeout de 5 s e NADA fica (nem o indice de produtos, construido antes)",
  async (c, url) => {
    await c.query("BEGIN");
    await c.query(ROLLBACK);
    await c.query("COMMIT");
    const outra = new Client({ connectionString: url });
    await outra.connect();
    try {
      await outra.query("BEGIN");
      await outra.query(
        "LOCK TABLE public.marketplace_order_history IN ROW EXCLUSIVE MODE",
      );
      await c.query("BEGIN");
      const t0 = Date.now();
      let erro = null;
      try {
        await c.query(MIGRATION);
      } catch (e) {
        erro = e;
      }
      const ms = Date.now() - t0;
      await c.query("ROLLBACK");
      assert.ok(erro, "a migration passou com a trava ocupada");
      assert.equal(erro.code, "55P03", `${erro.code} ${erro.message}`);
      assert.ok(ms >= 4500 && ms < 20000, `desistiu em ${ms} ms`);
      assert.deepEqual(
        await existe(c),
        { porta: false, produtos: false, historico: false },
        "ficou objeto (COMMIT escondido?)",
      );
      console.log(`   desistiu em ${ms} ms (55P03) e nada ficou`);
    } finally {
      await outra.query("ROLLBACK").catch(() => {});
      await outra.end();
    }
    // Devolve o clone ao estado da migration.
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("COMMIT");
    assert.equal((await retrato(c)).porta.h, MD5_PORTA);
    await emTransacao(c, async () =>
      assert.deepEqual(await consulta(c, A190), []),
    );
  },
);

// ---------------------------------------------------------------------------
// (d) volume: EXPLAIN e tempos (impressos, nunca reprovados)
// ---------------------------------------------------------------------------

const VOL = (prefixo, g) =>
  `('${prefixo}-0000-4000-8000-' || lpad((${g})::text, 12, '0'))::uuid`;
async function semearVolume(c) {
  const t0 = Date.now();
  await c.query("BEGIN");
  await c.query("SET LOCAL session_replication_role = replica");
  await c.query(
    `INSERT INTO auth.users (id, email, phone, raw_app_meta_data)
     SELECT ${VOL("b5310000", "g")}, 'volume' || g || '@volume530.teste', NULL, '{}'::jsonb FROM generate_series(1, 20000) g`,
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role, whatsapp, created_at)
     SELECT ${VOL("b5310000", "g")}, 'Volume530 ' || g, 'customer',
            '(34) 9' || lpad(((g * 7919) % 10000)::text, 4, '0') || '-' || lpad((g % 10000)::text, 4, '0'),
            now() - make_interval(mins => g)
       FROM generate_series(1, 20000) g`,
  );
  await c.query(
    `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default)
     SELECT ${VOL("b5310000", "g")}, 'Casa', 'Volume', '38400000', 'Rua', '1', 'Centro',
            CASE WHEN g % 3 = 0 THEN 'Uberlândia' ELSE 'Araxá' END, 'MG', true
       FROM generate_series(1, 20000, 2) g`,
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at, created_at)
     SELECT ${VOL("b5310000", "(g % 20000) + 1")}, 'Volume530', '{}'::jsonb, 100, 100, 'delivered', 'online', 'online', 'pago',
            now() - make_interval(hours => g % 4000), now() - make_interval(hours => g % 4000)
       FROM generate_series(1, 50000) g`,
  );
  await c.query(
    `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at, created_by)
     SELECT o.id, 'pending', 'processing', o.created_at, NULL FROM public.marketplace_orders o WHERE o.customer_name = 'Volume530'`,
  );
  await c.query(
    `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at, created_by)
     SELECT o.id, 'processing', 'cancelled', o.created_at + interval '1 hour', $1::uuid
       FROM (SELECT id, created_at, row_number() OVER (ORDER BY id) AS n FROM public.marketplace_orders WHERE customer_name = 'Volume530') o
      WHERE o.n % 20 = 0`,
    [ADMIN],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, data_cadastro)
     SELECT ${VOL("b5320000", "g")}, 'Produto Volume530 ' || g, 50, 10, true, 20, now() - make_interval(mins => g)
       FROM generate_series(1, 10000) g`,
  );
  await c.query(
    `INSERT INTO public.product_variants (product_id, name, value, stock_increment)
     SELECT ${VOL("b5320000", "g")}, 'Tamanho', 'M', 1 FROM generate_series(1, 10000, 2) g`,
  );
  await c.query("SET LOCAL session_replication_role = origin");
  await c.query("COMMIT");
  await c.query(
    "ANALYZE public.profiles, auth.users, public.user_addresses, public.marketplace_orders, public.marketplace_order_history, public.produtos, public.product_variants",
  );
  const n = (
    await c.query(
      `SELECT (SELECT count(*) FROM public.profiles) AS perfis, (SELECT count(*) FROM public.marketplace_orders) AS pedidos,
              (SELECT count(*) FROM public.marketplace_order_history) AS historico, (SELECT count(*) FROM public.produtos) AS produtos`,
    )
  ).rows[0];
  console.log(
    `   volume semeado em ${Date.now() - t0} ms: ${n.perfis} perfis, ${n.pedidos} pedidos, ${n.historico} linhas de historico, ${n.produtos} produtos`,
  );
  assert.ok(
    Number(n.perfis) >= 20000 &&
      Number(n.pedidos) >= 50000 &&
      Number(n.produtos) >= 10000,
  );
}

const mediana = (xs) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function cronometrar(vezes, acao) {
  const ms = [];
  for (let i = 0; i < vezes; i += 1) {
    const t0 = process.hrtime.bigint();
    await acao();
    ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return mediana(ms);
}
const fmt = (ms) => `${ms.toFixed(1)} ms`;

const SQL_SINO = `SELECT id, order_id, old_status, created_by, created_at FROM public.marketplace_order_history
                   WHERE new_status = 'cancelled' AND created_by IS NOT NULL AND created_at >= now() - interval '24 hours'
                   ORDER BY created_at DESC LIMIT 200`;
const SQL_LISTA_DE_PRODUTOS =
  "SELECT id FROM public.produtos WHERE deleted_at IS NULL ORDER BY data_cadastro DESC, id LIMIT 200";
const SQL_VITRINE = `SELECT v.*, COALESCE((SELECT jsonb_agg(to_jsonb(pv) ORDER BY pv.id) FROM public.product_variants pv WHERE pv.product_id = v.id), '[]'::jsonb) AS product_variants
                       FROM public.vw_produtos_public v
                      ORDER BY v.data_cadastro DESC, v.id ASC
                     OFFSET $1 LIMIT 200`;

async function plano(c, sql, { forcar = false } = {}) {
  await c.query("SAVEPOINT plano530");
  try {
    if (forcar) {
      // So para a pergunta "este indice serve esta consulta?": sem varredura e sem ordenacao, o planejador fica com o indice
      // que entrega a ordem pronta, se ele existir.
      await c.query("SET LOCAL enable_seqscan = off");
      await c.query("SET LOCAL enable_sort = off");
    }
    const r = await c.query(`EXPLAIN ${sql}`);
    return r.rows.map((l) => l["QUERY PLAN"]).join("\n");
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT plano530");
    await c.query("RELEASE SAVEPOINT plano530");
  }
}

provar(
  "(d) com 20 mil perfis e 50 mil pedidos: diferencial e zero pedido no volume; tempos da porta nova contra a antiga (impressos)",
  async (c) => {
    await semearVolume(c);
    await diferencial(
      c,
      ["Volume530 1999", "9912", "Uberlândia", "", null],
      [8],
    );
    await semPedidos(c, ["Volume530 1999", ""]);
    const linhas = [];
    for (const termo of ["Volume530 1999", "volume530", "9912", "ma"]) {
      const tAntiga = await cronometrar(3, async () =>
        resposta(await antiga(c, termo, 8), "antiga"),
      );
      const tNova = await cronometrar(3, async () =>
        resposta(await nova(c, termo, 8), "nova"),
      );
      linhas.push(
        `   termo ${JSON.stringify(termo).padEnd(18)} antiga ${fmt(tAntiga).padStart(10)}   nova ${fmt(tNova).padStart(10)}`,
      );
    }
    console.log(
      "   TEMPO DA BUSCA DO BALCAO (mediana de 3, 8 por pagina; impresso, nao reprova):",
    );
    for (const l of linhas) console.log(l);
  },
);

provar(
  "(d) EXPLAIN do sino/cron e da lista de produtos citam o indice novo e, antes dele, nao citavam; vitrine pagina 1 e 50 antes e depois (impressos)",
  async (c) => {
    const depois = {
      sino: await plano(c, SQL_SINO, { forcar: true }),
      produtos: await plano(c, SQL_LISTA_DE_PRODUTOS, { forcar: true }),
    };
    assert.match(depois.sino, /idx_order_history_status_criado/, depois.sino);
    assert.match(
      depois.produtos,
      /idx_produtos_data_cadastro_id/,
      depois.produtos,
    );
    const natural = {
      sino: (await plano(c, SQL_SINO)).split("\n").slice(0, 3).join(" | "),
      produtos: (await plano(c, SQL_LISTA_DE_PRODUTOS))
        .split("\n")
        .slice(0, 3)
        .join(" | "),
    };
    const vitrineDepois = {
      p1: await cronometrar(5, () => c.query(SQL_VITRINE, [0])),
      p50: await cronometrar(5, () => c.query(SQL_VITRINE, [9800])),
    };
    let vitrineAntes;
    let naturalAntes;
    await emTransacao(c, async () => {
      await c.query(ROLLBACK);
      for (const [nome, sql] of [
        ["sino", SQL_SINO],
        ["produtos", SQL_LISTA_DE_PRODUTOS],
      ]) {
        const p = await plano(c, sql, { forcar: true });
        assert.doesNotMatch(
          p,
          /idx_order_history_status_criado|idx_produtos_data_cadastro_id/,
          `${nome} antes: ${p}`,
        );
      }
      naturalAntes = {
        sino: (await plano(c, SQL_SINO)).split("\n").slice(0, 3).join(" | "),
        produtos: (await plano(c, SQL_LISTA_DE_PRODUTOS))
          .split("\n")
          .slice(0, 3)
          .join(" | "),
      };
      vitrineAntes = {
        p1: await cronometrar(5, () => c.query(SQL_VITRINE, [0])),
        p50: await cronometrar(5, () => c.query(SQL_VITRINE, [9800])),
      };
    });
    console.log(
      "   PLANO SEM FORCAR (as 3 primeiras linhas; impresso, nao reprova):",
    );
    console.log(`     sino     antes: ${naturalAntes.sino}`);
    console.log(`     sino    depois: ${natural.sino}`);
    console.log(`     produtos antes: ${naturalAntes.produtos}`);
    console.log(`     produtos depois: ${natural.produtos}`);
    console.log(
      "   VITRINE com 10 mil produtos, 200 por pagina com as variacoes (mediana de 5; impresso, nao reprova):",
    );
    console.log(
      `     pagina  1 (OFFSET    0): sem indice ${fmt(vitrineAntes.p1).padStart(10)}   com indice ${fmt(vitrineDepois.p1).padStart(10)}`,
    );
    console.log(
      `     pagina 50 (OFFSET 9800): sem indice ${fmt(vitrineAntes.p50).padStart(10)}   com indice ${fmt(vitrineDepois.p50).padStart(10)}`,
    );
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  assert.equal(
    new URL(url).pathname,
    "/prova_a_loja_grande_nao_trava_o_balcao_viva",
    "Rode somente no clone criado por rodar-isolado.cjs.",
  );
  const c = new Client({ connectionString: url });
  await c.connect();
  let falhas = 0;
  try {
    await preparar(c);
    for (const p of PROVAS) {
      try {
        await p.corpo(c, url);
        console.log(`[21530] OK   ${p.nome}`);
      } catch (erro) {
        falhas += 1;
        console.error(`[21530] FALHOU ${p.nome}\n${erro.stack || erro}`);
        await c.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await c.end();
  }
  console.log(`[21530] ${PROVAS.length - falhas}/${PROVAS.length} provas`);
  if (falhas > 0) process.exitCode = 1;
}

main().catch((erro) => {
  console.error("[21530]", erro);
  process.exitCode = 1;
});

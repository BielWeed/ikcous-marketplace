"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os da migration 20261550000000, do rollback dela e
 * das consultas 192a/192b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261550000000_o_admin_copia_e_apaga_as_fotos_da_loja.sql contra o Postgres EFÊMERO com as migrations aplicadas do
 * zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: a loja recém-instalada nasce sem política SELECT nos buckets `products` e `banners`. O remove do Storage roda
 * DELETE ... WHERE ... RETURNING e o copy lê a origem antes de inserir: sem política SELECT a linha some para o admin, o remove apaga 0
 * arquivo sem erro e o copy não acha a origem. A migration cria "Admin Select Access (products|banners)" (SELECT, TO authenticated,
 * bucket AND (SELECT public.rls_admin_atual())).
 *
 * O QUE SE PROVA (o Storage é imitado pelas MESMAS consultas que o serviço faz como o usuário, com o papel e o uid do JWT):
 *   (a) no banco recém-montado pela fila: admin de agora apaga (DELETE ... RETURNING = 1), copia (a origem é achada: 1) e lê (1) em
 *       products e banners; cliente, admin rebaixado (JWT ainda de admin) e visitante: 0; a foto de devolução do cliente segue legível;
 *   (b) CONTROLE do defeito: sem as políticas (estado do rollback), o admin apaga 0, copia 0 e lê 0; aplicar a migration cura;
 *   (c) lojas antigas: com a "Public Display" + "Public Read Banners Bucket" (IKCOUS) ou a "Leitura publica" (Savy) plantadas, a matriz
 *       inteira é IGUAL com e sem a migration: nada muda para elas;
 *   (d) reaplicar 2x (LF e CRLF): as políticas de storage.objects (menos o OID), a RLS, a ACL e os arquivos não mudam;
 *   (e) rollback (2x) tira SÓ as duas políticas e o admin volta a 0 (o defeito volta: o estado anterior é exato); reaplicar devolve;
 *   (f) pré-voo recusa (B1_BASELINE_DIVERGENT) sem escrever: política homônima alheia, rls_admin_atual com EXECUTE de anon, corpo trocado,
 *       storage.objects sem RLS; o rollback recusa política homônima alheia;
 *   (g) pós-voo recusa (B2) os mutantes is_admin_atual, TO public e sem bucket; a política com is_admin_atual (o guarda errado) derruba com
 *       42501 o SELECT do cliente na PRÓPRIA foto de devolução — o motivo de o guarda ser rls_admin_atual;
 *   (h) transação: sem COMMIT escondido; storage.objects travada por outra conexão faz a migration desistir no lock_timeout de 5 s;
 *   (i) consultas 192a/192b EXECUTADAS (como authenticated) antes, depois e com 3 defeitos plantados.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-admin-copia-e-apaga-as-fotos-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const NOME = "20261550000000_o_admin_copia_e_apaga_as_fotos_da_loja.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const A192 = "192a-conferir-o-admin-copia-e-apaga-as-fotos-aplicado";
const B192 = "192b-antes-o-admin-copia-e-apaga-as-fotos-ausente";
const POLITICAS = [
  "Admin Select Access (products)",
  "Admin Select Access (banners)",
];

const ADMIN = "f1550000-0000-4000-8000-000000000001";
const CLIENTE = "f1550000-0000-4000-8000-000000000002";
const REBAIXADO = "f1550000-0000-4000-8000-000000000003";
const PASTA = "prova-1550";
const FOTO = { products: `${PASTA}/foto.jpg`, banners: `${PASTA}/banner.jpg` };
const DEVOLUCAO = `${CLIENTE}/prova-1550.jpg`;

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "{}" },
  cliente: {
    papel: "authenticated",
    uid: CLIENTE,
    jwt: claims(CLIENTE, null),
  },
  admin: { papel: "authenticated", uid: ADMIN, jwt: claims(ADMIN, "admin") },
  // Rebaixado no profiles (auth.users ainda admin); o JWT velho ainda diz admin.
  rebaixado: {
    papel: "authenticated",
    uid: REBAIXADO,
    jwt: claims(REBAIXADO, "admin"),
  },
};

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1550_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Roda `fn` numa transação SEMPRE desfeita. */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
/** Roda `sql` como `quem` (num savepoint desfeito): o número de linhas, ou "erro <código>". */
async function como(c, quem, sql, params = []) {
  let saida = null;
  const e = await tentar(c, async () => {
    const q = QUEM[quem];
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    saida = (await c.query(sql, params)).rowCount;
  });
  return e ? `erro ${e.code}` : saida;
}
// As três operações do Storage, como o serviço as faz com o papel do usuário.
const APAGA =
  "DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2 RETURNING id";
const COPIA =
  "INSERT INTO storage.objects (bucket_id, name, owner, metadata) SELECT bucket_id, $2::text || '.copia', owner, metadata FROM storage.objects WHERE bucket_id = $1::text AND name = $2::text";
const LE = "SELECT id FROM storage.objects WHERE bucket_id = $1 AND name = $2";

/** A matriz inteira: quem consegue apagar, copiar e ler em cada bucket, e a foto de devolução do cliente. */
async function matriz(c) {
  const m = {};
  for (const quem of ["admin", "cliente", "rebaixado", "anon"]) {
    m[quem] = {};
    for (const bucket of ["products", "banners"]) {
      const p = [bucket, FOTO[bucket]];
      m[quem][`apaga ${bucket}`] = await como(c, quem, APAGA, p);
      m[quem][`copia ${bucket}`] = await como(c, quem, COPIA, p);
      m[quem][`le ${bucket}`] = await como(c, quem, LE, p);
    }
  }
  m.devolucaoDoCliente = await como(c, "cliente", LE, [
    "devolucoes",
    DEVOLUCAO,
  ]);
  return m;
}
const zero = () => ({
  "apaga products": 0,
  "copia products": 0,
  "le products": 0,
  "apaga banners": 0,
  "copia banners": 0,
  "le banners": 0,
});
const um = () => ({
  "apaga products": 1,
  "copia products": 1,
  "le products": 1,
  "apaga banners": 1,
  "copia banners": 1,
  "le banners": 1,
});
/** Loja nova DEPOIS da migration: só o admin de agora. */
const CURADA = () => ({
  admin: um(),
  cliente: zero(),
  rebaixado: zero(),
  anon: zero(),
  devolucaoDoCliente: 1,
});
/** Loja nova SEM as políticas: ninguém (o defeito). */
const DEFEITO = () => ({
  admin: zero(),
  cliente: zero(),
  rebaixado: zero(),
  anon: zero(),
  devolucaoDoCliente: 1,
});

/** As políticas de storage.objects (sem o OID, que o DROP+CREATE troca), a RLS e a ACL. */
async function catalogo(c) {
  await c.query("SAVEPOINT cat_1550");
  try {
    await c.query("SET LOCAL search_path = pg_catalog");
    const p = await c.query(
      `SELECT p.polname, p.polcmd::text AS cmd, p.polpermissive, p.polroles::regrole[]::text AS papeis,
              pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS chk
         FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass ORDER BY p.polname`,
    );
    const t = await c.query(
      `SELECT relrowsecurity, relforcerowsecurity, relacl::text AS acl FROM pg_class WHERE oid = 'storage.objects'::regclass`,
    );
    return { politicas: p.rows, tabela: t.rows[0] };
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT cat_1550");
    await c.query("RELEASE SAVEPOINT cat_1550");
  }
}
/** Os arquivos (linhas de storage.objects), para "nada foi lido nem escrito". */
async function arquivos(c) {
  return (
    await c.query(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(o)::text, '|' ORDER BY o.id), '')) AS h FROM storage.objects o`,
    )
  ).rows[0];
}
async function nossas(c) {
  return (
    await c.query(
      "SELECT polname FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = ANY($1) ORDER BY polname",
      [POLITICAS],
    )
  ).rows.map((r) => r.polname);
}
const semAsNossas = (cat) => ({
  ...cat,
  politicas: cat.politicas.filter((p) => !POLITICAS.includes(p.polname)),
});

// ---------------------------------------------------------------------------
// semente (gravada no clone exclusivo)
// ---------------------------------------------------------------------------
async function semente(c) {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const [id, papel, meta] of [
    [ADMIN, "admin", "admin"],
    [CLIENTE, "customer", "customer"],
    [REBAIXADO, "customer", "admin"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, ($1::uuid)::text || '@fotos.teste', jsonb_build_object('role', $2::text))",
      [id, meta],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Prova fotos', $2) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role",
      [id, papel],
    );
  }
  // O gatilho sincroniza profiles -> auth.users: recria a divergência do rebaixado depois do perfil.
  await c.query(
    "UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('role', 'admin') WHERE id = $1",
    [REBAIXADO],
  );
  const r = await c.query(
    `SELECT u.id::text, u.raw_app_meta_data ->> 'role' AS a, p.role AS p
       FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.id::text LIKE 'f1550000-%' ORDER BY u.id`,
  );
  assert.deepEqual(
    r.rows.map((l) => [l.id, l.a, l.p]),
    [
      [ADMIN, "admin", "admin"],
      [CLIENTE, "customer", "customer"],
      [REBAIXADO, "admin", "customer"],
    ],
    "fixtures de papel (admin atual, cliente, rebaixado no profiles)",
  );
  await c.query(
    "INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('products', $1, $3), ('banners', $2, $3), ('devolucoes', $4, $5)",
    [FOTO.products, FOTO.banners, ADMIN, DEVOLUCAO, CLIENTE],
  );
}

// ---------------------------------------------------------------------------
// (a) + (b) a loja nova
// ---------------------------------------------------------------------------
async function lojaNova(c) {
  assert.deepEqual(
    await nossas(c),
    [...POLITICAS].sort(),
    "a fila aplicou as duas políticas",
  );
  await desfeita(c, async () => {
    assert.deepEqual(
      await matriz(c),
      CURADA(),
      "depois da migration: só o admin de agora apaga, copia e lê",
    );
  });
}
async function defeitoECura(c) {
  await desfeita(c, async () => {
    await c.query(ROLLBACK);
    assert.deepEqual(await nossas(c), []);
    assert.deepEqual(
      await matriz(c),
      DEFEITO(),
      "CONTROLE: sem a política SELECT o admin apaga 0 (sem erro), não acha a origem da cópia e não lê",
    );
    await c.query(MIGRATION);
    assert.deepEqual(await matriz(c), CURADA(), "a migration cura");
  });
}

// ---------------------------------------------------------------------------
// (c) lojas antigas: a política larga de leitura convive, nada muda
// ---------------------------------------------------------------------------
const LARGAS = {
  ikcous: [
    `CREATE POLICY "Public Display" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'products'::text))`,
    `CREATE POLICY "Public Read Banners Bucket" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'banners'::text))`,
  ],
  savy: [
    `CREATE POLICY "Leitura publica (banners)" ON storage.objects AS PERMISSIVE FOR SELECT TO anon,authenticated USING ((bucket_id = 'banners'::text))`,
    `CREATE POLICY "Leitura publica (products)" ON storage.objects AS PERMISSIVE FOR SELECT TO anon,authenticated USING ((bucket_id = 'products'::text))`,
  ],
};
async function lojasAntigas(c) {
  for (const [loja, largas] of Object.entries(LARGAS)) {
    await desfeita(c, async () => {
      await c.query(ROLLBACK);
      for (const sql of largas) await c.query(sql);
      const antes = await matriz(c);
      const arqAntes = await arquivos(c);
      const catAntes = await catalogo(c);
      // a loja antiga já funcionava para o admin (é por isso que só a nova sentia o defeito)
      assert.equal(antes.admin["apaga products"], 1, `${loja}: admin apaga`);
      assert.equal(antes.admin["copia banners"], 1, `${loja}: admin copia`);
      await c.query(MIGRATION);
      assert.deepEqual(
        await matriz(c),
        antes,
        `${loja}: a matriz inteira (admin, cliente, rebaixado, visitante) é a mesma com a migration`,
      );
      assert.deepEqual(await arquivos(c), arqAntes, `${loja}: nenhum arquivo`);
      assert.deepEqual(
        semAsNossas(await catalogo(c)),
        catAntes,
        `${loja}: as políticas largas e as demais ficam como estavam`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// (d) reaplicar + (e) rollback
// ---------------------------------------------------------------------------
async function reaplicar(c) {
  await desfeita(c, async () => {
    const cat = await catalogo(c);
    const arq = await arquivos(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    assert.deepEqual(
      await catalogo(c),
      cat,
      "reaplicar (LF e CRLF): catálogo igual",
    );
    assert.deepEqual(await arquivos(c), arq, "nenhum arquivo lido ou escrito");
    assert.deepEqual(await matriz(c), CURADA());
  });
}
async function rollback(c) {
  await desfeita(c, async () => {
    const cat = await catalogo(c);
    const arq = await arquivos(c);
    await c.query(ROLLBACK);
    await c.query(ROLLBACK.replace(/\n/g, "\r\n"));
    assert.deepEqual(await nossas(c), [], "as duas saíram");
    assert.deepEqual(
      await catalogo(c),
      semAsNossas(cat),
      "só as duas saíram; o resto do catálogo de storage.objects fica",
    );
    assert.deepEqual(await arquivos(c), arq, "nenhum arquivo apagado");
    assert.deepEqual(
      await matriz(c),
      DEFEITO(),
      "depois do rollback o admin volta a 0 (o estado anterior, exato)",
    );
    await c.query(MIGRATION);
    assert.deepEqual(await catalogo(c), cat, "reaplicar devolve as duas");
    assert.deepEqual(await matriz(c), CURADA());
  });
}

// ---------------------------------------------------------------------------
// (f) pré-voo + (g) pós-voo e mutantes
// ---------------------------------------------------------------------------
const ALHEIA_PRODUCTS = `CREATE POLICY "Admin Select Access (products)" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'products')`;
async function recusa(c, preparo, sql, codigo, nome) {
  const e = await tentar(c, async () => {
    for (const p of preparo) await c.query(p);
    const antes = await catalogo(c);
    const erro = await tentar(c, async () => {
      await c.query(sql);
    });
    assert(erro, `${nome}: deveria recusar`);
    assert(
      String(erro.message).includes(codigo),
      `${nome}: esperava ${codigo}, veio ${erro.message}`,
    );
    assert.deepEqual(await catalogo(c), antes, `${nome}: nada escrito`);
  });
  if (e) throw e;
}
async function preVoo(c) {
  let n = 0;
  await desfeita(c, async () => {
    const casos = [
      [
        "política homônima alheia (migration)",
        [
          'DROP POLICY "Admin Select Access (products)" ON storage.objects',
          ALHEIA_PRODUCTS,
        ],
        MIGRATION,
      ],
      [
        "política homônima alheia (rollback)",
        [
          'DROP POLICY "Admin Select Access (products)" ON storage.objects',
          ALHEIA_PRODUCTS,
        ],
        ROLLBACK,
      ],
      [
        "rls_admin_atual com EXECUTE de anon",
        ["GRANT EXECUTE ON FUNCTION public.rls_admin_atual() TO anon"],
        MIGRATION,
      ],
      [
        "rls_admin_atual com corpo trocado",
        [
          "CREATE OR REPLACE FUNCTION public.rls_admin_atual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$ SELECT true $f$",
        ],
        MIGRATION,
      ],
      [
        "storage.objects sem RLS",
        ["ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY"],
        MIGRATION,
      ],
    ];
    for (const [nome, preparo, sql] of casos) {
      await recusa(c, preparo, sql, "B1_BASELINE_DIVERGENT", nome);
      n++;
    }
    // "nada escrito" (catálogo igual depois da recusa) prova também que a política alheia NÃO foi derrubada.
  });
  return n;
}
const MUTANTES = {
  "guarda is_admin_atual": (s) =>
    s.replace(
      /USING \(bucket_id = 'products' AND \(SELECT public\.rls_admin_atual\(\)\)\)/,
      "USING (bucket_id = 'products' AND (SELECT public.is_admin_atual()))",
    ),
  "TO public": (s) =>
    s.replace(
      /FOR SELECT TO authenticated USING \(bucket_id = 'banners'/,
      "FOR SELECT TO public USING (bucket_id = 'banners'",
    ),
  "sem o bucket": (s) =>
    s.replace(
      /USING \(bucket_id = 'products' AND \(SELECT public\.rls_admin_atual\(\)\)\)/,
      "USING ((SELECT public.rls_admin_atual()))",
    ),
};
async function mutantes(c) {
  let mortos = 0;
  await desfeita(c, async () => {
    await c.query(ROLLBACK);
    for (const [nome, mutar] of Object.entries(MUTANTES)) {
      const sql = mutar(MIGRATION);
      assert.notEqual(sql, MIGRATION, `${nome}: o mutante mudou o texto`);
      await recusa(c, [], sql, "B2_POSVOO_DIVERGENTE", `mutante ${nome}`);
      mortos++;
    }
    // O guarda errado, gravado à mão (sem o pós-voo): o cliente perde a PRÓPRIA foto de devolução com 42501.
    const e = await tentar(c, async () => {
      await c.query(
        `CREATE POLICY "Admin Select Access (products)" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'products' AND (SELECT public.is_admin_atual()))`,
      );
      assert.equal(
        await como(c, "cliente", LE, ["devolucoes", DEVOLUCAO]),
        "erro 42501",
        "is_admin_atual sem EXECUTE de authenticated: todo SELECT logado em storage.objects cai",
      );
    });
    if (e) throw e;
    assert.equal(
      await como(c, "cliente", LE, ["devolucoes", DEVOLUCAO]),
      1,
      "CONTROLE: sem o mutante, o cliente lê a própria foto",
    );
    mortos++;
  });
  return mortos;
}

// ---------------------------------------------------------------------------
// (h) transação e trava
// ---------------------------------------------------------------------------
async function transacao(c, url) {
  await desfeita(c, async () => {
    await c.query("SAVEPOINT antes_do_rollback");
    await c.query(ROLLBACK);
    // Um COMMIT escondido faria este ROLLBACK TO falhar (o savepoint some com a transação).
    await c.query("ROLLBACK TO SAVEPOINT antes_do_rollback");
    assert.deepEqual(
      await nossas(c),
      [...POLITICAS].sort(),
      "rollback sem COMMIT escondido",
    );
    await c.query(ROLLBACK);
    await c.query("SAVEPOINT antes_da_migration");
    await c.query(MIGRATION);
    await c.query("ROLLBACK TO SAVEPOINT antes_da_migration");
    assert.deepEqual(await nossas(c), [], "migration sem COMMIT escondido");
  });
  const cat = await desfeita(c, () => catalogo(c));
  const outro = new Client({ connectionString: url });
  await outro.connect();
  try {
    await outro.query("BEGIN");
    // uma leitura em voo (a vitrine lendo storage.objects) basta para segurar a trava exclusiva de CREATE/DROP POLICY
    await outro.query("LOCK TABLE storage.objects IN ACCESS SHARE MODE");
    const t0 = Date.now();
    let e = null;
    await c.query("BEGIN");
    try {
      await c.query(MIGRATION);
    } catch (err) {
      e = err;
    } finally {
      await c.query("ROLLBACK");
    }
    const ms = Date.now() - t0;
    assert.equal(
      e?.code,
      "55P03",
      `storage.objects travada: lock_timeout (${e?.message})`,
    );
    assert(
      ms >= 4500 && ms < 20000,
      `desistiu em ${ms} ms (lock_timeout de 5 s)`,
    );
    await outro.query("ROLLBACK");
  } finally {
    await outro.end();
  }
  assert.deepEqual(
    await desfeita(c, () => catalogo(c)),
    cat,
    "a desistência não escreveu nada",
  );
}

// ---------------------------------------------------------------------------
// (i) consultas 192a/192b
// ---------------------------------------------------------------------------
async function consulta(c, nome) {
  const sql = fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
  assert.equal(CONF.contarStatements(sql), 1);
  let rows = null;
  const e = await tentar(c, async () => {
    await c.query("SET LOCAL ROLE authenticated");
    rows = (await c.query(sql)).rows;
  });
  if (e) throw e;
  assert.equal(
    CONF.estruturaDoRolFechado(rows, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
    null,
    `${nome}: rol fechado`,
  );
  assert.match(
    CONF.veredictoDaConsulta({
      consulta: nome,
      ref: "efemero",
      sha: "local",
      linhas: rows,
    }),
    /rol=ok/,
  );
  return rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
}
const item = (rol, inicio) => {
  const x = CONF.ROL_FECHADO_POR_CONSULTA[rol].filter((i) =>
    i.startsWith(inicio),
  );
  assert.equal(x.length, 1, `item de ${rol}: ${inicio}`);
  return x[0];
};
async function portao(c) {
  const PROD_A = item(A192, "Admin Select Access (products)");
  const BAN_A = item(A192, "Admin Select Access (banners)");
  const RLS_A = item(A192, "storage.objects");
  const PROD_B = item(B192, "Admin Select Access (products)");
  const BAN_B = item(B192, "Admin Select Access (banners)");
  const PORTA_B = item(B192, "rls_admin_atual()");
  const RLS_B = item(B192, "storage.objects");
  let defeitos = 0;
  await desfeita(c, async () => {
    // Depois (o estado da fila): 192a positiva, 192b reprova só as duas "ainda NAO existe".
    assert.deepEqual(await consulta(c, A192), []);
    assert.deepEqual(await consulta(c, B192), [PROD_B, BAN_B].sort());
    // Defeito plantado: política homônima alheia (aberta a todo logado).
    let e = await tentar(c, async () => {
      await c.query(
        'DROP POLICY "Admin Select Access (products)" ON storage.objects',
      );
      await c.query(ALHEIA_PRODUCTS);
      assert.deepEqual(await consulta(c, A192), [PROD_A]);
      assert.deepEqual(await consulta(c, B192), [PROD_B, BAN_B].sort());
    });
    if (e) throw e;
    defeitos++;
    // Defeito plantado: RLS desligada.
    e = await tentar(c, async () => {
      await c.query("ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY");
      assert.deepEqual(await consulta(c, A192), [RLS_A]);
    });
    if (e) throw e;
    defeitos++;
    // Antes (estado do rollback): 192a reprova as duas políticas, 192b positiva.
    await c.query(ROLLBACK);
    assert.deepEqual(await consulta(c, A192), [PROD_A, BAN_A].sort());
    assert.deepEqual(await consulta(c, B192), []);
    // Defeito plantado na base do pré-voo: EXECUTE de anon na porta, e RLS desligada.
    e = await tentar(c, async () => {
      await c.query(
        "GRANT EXECUTE ON FUNCTION public.rls_admin_atual() TO anon",
      );
      await c.query("ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY");
      assert.deepEqual(await consulta(c, B192), [PORTA_B, RLS_B].sort());
    });
    if (e) throw e;
    defeitos++;
  });
  return defeitos;
}

// ---------------------------------------------------------------------------
async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    const r = await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
    return r;
  };
  try {
    await semente(c);
    await provar(
      "loja nova (fila): admin de agora apaga (RETURNING 1), copia e lê; cliente, rebaixado e visitante 0; devolução do cliente legível",
      () => lojaNova(c),
    );
    await provar(
      "CONTROLE do defeito (sem a política: admin apaga 0, copia 0, lê 0) e a cura",
      () => defeitoECura(c),
    );
    await provar(
      "lojas antigas (Public Display / Leitura publica): matriz, arquivos e políticas iguais com a migration",
      () => lojasAntigas(c),
    );
    await provar("reaplicar 2x (LF e CRLF): nada muda", () => reaplicar(c));
    await provar(
      "rollback (2x) tira só as duas e o admin volta a 0; reaplicar devolve",
      () => rollback(c),
    );
    const recusas = await provar(
      "pré-voo recusa estado divergente sem escrever; o rollback também",
      () => preVoo(c),
    );
    const mortos = await provar(
      "pós-voo mata os mutantes; o guarda is_admin_atual derruba o cliente com 42501",
      () => mutantes(c),
    );
    await provar(
      "transação: sem COMMIT escondido; storage.objects travada faz desistir em 5 s",
      () => transacao(c, url),
    );
    const defeitos = await provar(
      "consultas 192a/192b: antes, depois e defeitos plantados",
      () => portao(c),
    );
    console.log(
      `\no-admin-copia-e-apaga-as-fotos-viva: ${provas} provas ok; ${recusas} recusas do pré-voo; ${mortos} mutantes mortos; ${defeitos} defeitos plantados nas consultas`,
    );
    anexarAoSummary(
      "O admin copia e apaga as fotos da loja (PG17)",
      `${provas} provas, ${recusas} recusas do pré-voo, ${mortos} mutantes mortos, ${defeitos} defeitos plantados nas consultas 192a/192b.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) =>
  falhar("O_ADMIN_COPIA_E_APAGA_AS_FOTOS", e.stack || e.message),
);

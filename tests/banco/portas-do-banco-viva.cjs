"use strict";

/**
 * Prova VIVA do lote L2 da auditoria de 12/10/2026 (portas pequenas do banco), num Postgres EFEMERO
 * local, sem rede, com os papeis de verdade (anon, authenticated, service_role):
 *
 *   20261218000000  a foto e a capa do perfil tem teto de tamanho; a contagem do push e a view de
 *                   produtos do painel deixam de atender o visitante sem login;
 *   20261218000100  configuracoes da loja e codigos de verificacao so pelo servidor;
 *   20261219000000  a lista de perfis publicos so para quem esta logado, e so com quem escreveu.
 *
 * Cada caso roda numa transacao que termina em ROLLBACK. O banco e' o clone do rodar-isolado.cjs: a
 * arvore inteira migrada, com as tres migrations aplicadas (o estado DEPOIS). O estado ANTES e' o
 * banco com os tres rollback-manual aplicados na mesma transacao (o CONTROLE: sem ele, o "recusou
 * depois" pode ser vacuo).
 *
 *  PERFIS     visitante: ANTES lista todos (controle), DEPOIS zero linhas SEM erro; logado ve a si, o
 *             autor de avaliacao publicada e o de pergunta, e NAO ve o autor so de avaliacao pendente
 *             nem quem nunca escreveu; admin atual ve todos; admin rebaixado (cracha velho) nao ve quem
 *             nunca escreveu; a vitrine do visitante (views) continua com nome e foto do autor; toda
 *             avaliacao que o logado ve tem o autor visivel.
 *  IMAGEM     ANTES aceita foto de 200 KB (controle); DEPOIS: UPDATE direto e a RPC recusam foto acima
 *             de 128 KiB e capa acima de 512 KiB (23514), aceitam no limite, aceitam 'REMOVE'/NULL; o
 *             INSERT tambem confere; quem ja tinha imagem grande ANTES continua salvando nome,
 *             WhatsApp e CPF, e a sincronizacao com public_profiles acontece.
 *  PUSH       ANTES o visitante chega ao corpo (controle); DEPOIS recebe 42501; o admin atual conta; o
 *             logado sem ser admin cai na recusa do corpo (inalterada).
 *  VIEW       ANTES o visitante le a view do painel (controle); DEPOIS 42501; o admin continua lendo e
 *             cadastrando produto por ela.
 *  SERVIDOR   ANTES (o estado da loja que tinha os grants) anon/authenticated tem privilegio (controle);
 *             DEPOIS 42501 nos dois; service_role le e grava; o codigo do rastreio do convidado continua
 *             saindo (service_role) e sendo conferido (anon, pela funcao); numa loja ja fechada a
 *             migration e' no-op; grant de COLUNA some junto; grant dado por OUTRO grantor faz a
 *             conferencia recusar o apply inteiro.
 *  MIGRATION  reaplicar e CRLF = mesmo estado; o rollback devolve o estado de antes; o pre-voo de cada
 *             uma recusa um banco divergente sem escrever nada.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/portas-do-banco-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const LOTE = [
  "20261218000000_a_foto_do_perfil_tem_teto_e_o_painel_fecha_ao_visitante.sql",
  "20261218000100_configuracoes_e_codigos_so_do_servidor.sql",
  "20261219000000_perfil_publico_so_de_quem_escreveu.sql",
];
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const migration = (i) => ler(LOTE.at(i));
const rollback = (i) => ler(`rollback-manual-${LOTE.at(i)}`);

const U = {
  admin: "a1200000-0000-4000-8000-000000000001",
  rebaixado: "a1200000-0000-4000-8000-000000000002",
  terceiro: "a1200000-0000-4000-8000-000000000003",
  autorPub: "a1200000-0000-4000-8000-000000000004",
  autorPend: "a1200000-0000-4000-8000-000000000005",
  autorPerg: "a1200000-0000-4000-8000-000000000006",
  calado: "a1200000-0000-4000-8000-000000000007",
  grande: "a1200000-0000-4000-8000-000000000008",
};
const P_PROD = "a12aaaaa-0000-4000-8000-000000000001";
const P_NOVO = "a12aaaaa-0000-4000-8000-000000000002";
const R_PUB = "a12bbbbb-0000-4000-8000-000000000001";
const R_PEND = "a12bbbbb-0000-4000-8000-000000000002";
const Q_PERG = "a12ccccc-0000-4000-8000-000000000001";
const O_PEDIDO = "a12ddddd-0000-4000-8000-000000000001";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
const QUEM = new Map(
  Object.entries({
    anon: { papel: "anon", uid: "", jwt: "" },
    servico: { papel: "service_role", uid: "", jwt: "" },
    admin: {
      papel: "authenticated",
      uid: U.admin,
      jwt: claims(U.admin, "admin"),
    },
    rebaixado: {
      papel: "authenticated",
      uid: U.rebaixado,
      jwt: claims(U.rebaixado, "admin"),
    },
    terceiro: {
      papel: "authenticated",
      uid: U.terceiro,
      jwt: claims(U.terceiro, null),
    },
    autorPub: {
      papel: "authenticated",
      uid: U.autorPub,
      jwt: claims(U.autorPub, null),
    },
    grande: {
      papel: "authenticated",
      uid: U.grande,
      jwt: claims(U.grande, null),
    },
  }),
);

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita. */
async function emTransacao(fn) {
  await C.query("BEGIN");
  try {
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `quem`; o erro nao derruba a transacao: {ok, rows, n} ou {ok:false, code, message}. */
async function como(quem, sql, params = []) {
  const q = QUEM.get(quem);
  if (!q) throw new Error(`papel de prova desconhecido: ${quem}`);
  await C.query("SAVEPOINT sp_como");
  try {
    await C.query(`SET LOCAL ROLE ${q.papel}`);
    await C.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await C.query(sql, params);
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT sp_como");
    return { ok: true, n: r.rowCount, rows: r.rows };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT sp_como");
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT sp_como");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Roda SQL como o dono; erro vira {ok:false} sem derrubar a transacao. */
async function tentarComoDono(sql) {
  await C.query("SAVEPOINT sp_dono");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT sp_dono");
    return { ok: true };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT sp_dono");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** O estado ANTES do lote: os tres rollback-manual, na ordem inversa. */
async function voltarParaAntes() {
  for (const i of [2, 1, 0]) await C.query(rollback(i));
}

/** Fabrica do Supabase que o provisionar.cjs nao emula (so neste clone) + as pessoas da prova. */
async function semear() {
  await C.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await C.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const id of Object.values(U)) {
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@l2.teste', '{}'::jsonb)",
      [id],
    );
  }
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin Atual', 'admin'), ($2, 'Rebaixado', 'customer'), ($3, 'Terceiro', 'customer'),
       ($4, 'Autor Publicada', 'customer'), ($5, 'Autor Pendente', 'customer'),
       ($6, 'Autor Pergunta', 'customer'), ($7, 'Calado', 'customer')`,
    [
      U.admin,
      U.rebaixado,
      U.terceiro,
      U.autorPub,
      U.autorPend,
      U.autorPerg,
      U.calado,
    ],
  );
  // admin atual nas duas fontes; o rebaixado so tem o cracha velho (auth.users + JWT dizendo admin)
  await C.query(
    `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
      WHERE id IN ($1, $2)`,
    [U.admin, U.rebaixado],
  );
  await C.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
     VALUES ($1, 'Produto L2', 100, 10, true, 40)`,
    [P_PROD],
  );
  await C.query(
    `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES
       ($1, $3, $4, 5, 'boa', 'publicada'), ($2, $3, $5, 2, 'pendente', 'pendente')`,
    [R_PUB, R_PEND, P_PROD, U.autorPub, U.autorPend],
  );
  await C.query(
    "INSERT INTO public.questions (id, product_id, user_id, question) VALUES ($1, $2, $3, 'serve?')",
    [Q_PERG, P_PROD, U.autorPerg],
  );
  const r = await C.query(
    `SELECT u.id::text, u.raw_app_meta_data ->> 'role' AS a, p.role AS p
       FROM auth.users u JOIN public.profiles p ON p.id = u.id
      WHERE u.id IN ($1, $2) ORDER BY u.id`,
    [U.admin, U.rebaixado],
  );
  assert.deepEqual(
    r.rows.map((l) => [l.id, l.a, l.p]),
    [
      [U.admin, "admin", "admin"],
      [U.rebaixado, "admin", "customer"],
    ],
    "fixtures: admin atual e rebaixado",
  );
}

const nomesVistos = async (quem) => {
  const r = await como(
    quem,
    "SELECT full_name FROM public.public_profiles ORDER BY full_name",
  );
  assert.ok(r.ok, `${quem} leu public_profiles: ${r.message}`);
  return r.rows.map((l) => l.full_name);
};
const TODOS = [
  "Admin Atual",
  "Autor Pendente",
  "Autor Pergunta",
  "Autor Publicada",
  "Calado",
  "Rebaixado",
  "Terceiro",
];

// ---------------------------------------------------------------------------
// PERFIS (20261219000000)
// ---------------------------------------------------------------------------

prova(
  "PERFIS: CONTROLE — antes do lote o visitante lista todos os perfis",
  () =>
    emTransacao(async () => {
      await semear();
      await voltarParaAntes();
      assert.deepEqual(await nomesVistos("anon"), TODOS);
      assert.deepEqual(await nomesVistos("terceiro"), TODOS);
    }),
);

prova(
  "PERFIS: o visitante recebe ZERO linhas, sem erro (nem 42501 de rls_admin_atual)",
  () =>
    emTransacao(async () => {
      await semear();
      assert.deepEqual(await nomesVistos("anon"), []);
      const porId = await como(
        "anon",
        "SELECT id FROM public.public_profiles WHERE id = $1",
        [U.autorPub],
      );
      assert.ok(porId.ok, porId.message);
      assert.equal(porId.n, 0);
    }),
);

prova(
  "PERFIS: o logado ve a si, o autor de publicada e o de pergunta; NAO ve autor so de pendente nem quem nunca escreveu",
  () =>
    emTransacao(async () => {
      await semear();
      assert.deepEqual(await nomesVistos("terceiro"), [
        "Autor Pergunta",
        "Autor Publicada",
        "Terceiro",
      ]);
      // o autor da publicada ve a si e aos autores; o da pendente ve a si (a propria avaliacao)
      assert.deepEqual(await nomesVistos("autorPub"), [
        "Autor Pergunta",
        "Autor Publicada",
      ]);
    }),
);

prova(
  "PERFIS: o admin atual ve todos; o rebaixado com cracha velho NAO ve quem nunca escreveu",
  () =>
    emTransacao(async () => {
      await semear();
      assert.deepEqual(await nomesVistos("admin"), TODOS);
      const reb = await nomesVistos("rebaixado");
      assert.ok(!reb.includes("Calado"), `rebaixado viu: ${reb.join(", ")}`);
      assert.deepEqual(reb, ["Autor Pergunta", "Autor Publicada", "Rebaixado"]);
    }),
);

prova(
  "PERFIS: a vitrine do visitante (views) continua com nome e foto do autor",
  () =>
    emTransacao(async () => {
      await semear();
      await C.query(
        "UPDATE public.profiles SET avatar_url = 'data:image/svg+xml;utf8,<svg/>' WHERE id = $1",
        [U.autorPub],
      );
      const av = await como(
        "anon",
        "SELECT author_name, author_avatar_url FROM public.vw_reviews_public WHERE id = $1",
        [R_PUB],
      );
      assert.ok(av.ok, av.message);
      assert.deepEqual(av.rows, [
        {
          author_name: "Autor Publicada",
          author_avatar_url: "data:image/svg+xml;utf8,<svg/>",
        },
      ]);
      const pe = await como(
        "anon",
        "SELECT author_name FROM public.vw_questions_public WHERE id = $1",
        [Q_PERG],
      );
      assert.ok(pe.ok, pe.message);
      assert.deepEqual(pe.rows, [{ author_name: "Autor Pergunta" }]);
    }),
);

prova(
  "PERFIS: toda avaliacao e pergunta que o logado ve tem o autor visivel (o embed do app)",
  () =>
    emTransacao(async () => {
      await semear();
      for (const quem of ["terceiro", "autorPub", "admin"]) {
        const r = await como(
          quem,
          `SELECT 'r' AS k, r.id, pp.full_name FROM public.reviews r
           LEFT JOIN public.public_profiles pp ON pp.id = r.user_id
         UNION ALL
         SELECT 'q', q.id, pp.full_name FROM public.questions q
           LEFT JOIN public.public_profiles pp ON pp.id = q.user_id`,
        );
        assert.ok(r.ok, `${quem}: ${r.message}`);
        assert.ok(r.n >= 2, `${quem} ve avaliacao e pergunta`);
        assert.deepEqual(
          r.rows.filter((l) => l.full_name === null),
          [],
          `${quem}: autor nulo`,
        );
      }
    }),
);

// ---------------------------------------------------------------------------
// IMAGEM DO PERFIL (20261218000000)
// ---------------------------------------------------------------------------

const imagem = (bytes) => `data:image/jpeg;base64,${"A".repeat(bytes - 23)}`;
const FOTO_MAX = 131072;
const CAPA_MAX = 524288;
const SQL_RPC =
  "SELECT public.update_my_profile_secure($1::text, $2::text, $3::text, $4::text)";
const SQL_UPD_FOTO = "UPDATE public.profiles SET avatar_url = $2 WHERE id = $1";
const SQL_UPD_CAPA = "UPDATE public.profiles SET cover_url = $2 WHERE id = $1";

prova(
  "IMAGEM: CONTROLE — antes do lote a foto de 200 KB entra pelo UPDATE direto e pela RPC",
  () =>
    emTransacao(async () => {
      await semear();
      await voltarParaAntes();
      const d = await como("terceiro", SQL_UPD_FOTO, [
        U.terceiro,
        imagem(200000),
      ]);
      assert.ok(d.ok && d.n === 1, d.message);
      const r = await como("terceiro", SQL_RPC, [
        null,
        null,
        null,
        imagem(700000),
      ]);
      assert.ok(r.ok, r.message);
    }),
);

prova(
  "IMAGEM: UPDATE direto e RPC recusam acima do teto (23514) e aceitam no teto, 'REMOVE' e NULL",
  () =>
    emTransacao(async () => {
      await semear();
      const casos = [
        [
          "foto direta 1 byte acima",
          SQL_UPD_FOTO,
          [U.terceiro, imagem(FOTO_MAX + 1)],
          "23514",
        ],
        [
          "capa direta 1 byte acima",
          SQL_UPD_CAPA,
          [U.terceiro, imagem(CAPA_MAX + 1)],
          "23514",
        ],
        [
          "foto pela RPC (5 MB)",
          SQL_RPC,
          [null, null, imagem(5 * 1024 * 1024), null],
          "23514",
        ],
        [
          "capa pela RPC (600 KB)",
          SQL_RPC,
          [null, null, null, imagem(600000)],
          "23514",
        ],
        ["foto no teto", SQL_UPD_FOTO, [U.terceiro, imagem(FOTO_MAX)], null],
        ["capa no teto", SQL_UPD_CAPA, [U.terceiro, imagem(CAPA_MAX)], null],
        [
          "foto realista pela RPC (60 KB)",
          SQL_RPC,
          [null, null, imagem(60000), null],
          null,
        ],
        [
          "capa realista pela RPC (300 KB)",
          SQL_RPC,
          [null, null, null, imagem(300000)],
          null,
        ],
        [
          "foto pre-definida (SVG)",
          SQL_RPC,
          [null, null, "data:image/svg+xml;utf8,<svg/>", null],
          null,
        ],
        ["REMOVE pela RPC", SQL_RPC, [null, null, "REMOVE", "REMOVE"], null],
        ["NULL direto", SQL_UPD_FOTO, [U.terceiro, null], null],
      ];
      const sincronizado = async () =>
        (
          await C.query(
            "SELECT octet_length(avatar_url) AS f, octet_length(cover_url) AS c FROM public.public_profiles WHERE id = $1",
            [U.terceiro],
          )
        ).rows[0];
      for (const [rotulo, sql, params, codigo] of casos) {
        const antes = await sincronizado();
        const r = await como("terceiro", sql, params);
        if (codigo) {
          assert.equal(r.ok, false, `${rotulo}: passou`);
          assert.equal(r.code, codigo, `${rotulo}: ${r.message}`);
          assert.match(r.message, /grande demais/);
          assert.deepEqual(
            await sincronizado(),
            antes,
            `${rotulo}: nada mudou`,
          );
        } else {
          assert.ok(r.ok, `${rotulo}: ${r.message}`);
          if (rotulo === "foto no teto")
            assert.equal(
              (await sincronizado()).f,
              FOTO_MAX,
              "a foto no teto sincronizou",
            );
          if (rotulo === "capa no teto")
            assert.equal(
              (await sincronizado()).c,
              CAPA_MAX,
              "a capa no teto sincronizou",
            );
        }
      }
      assert.deepEqual(
        await sincronizado(),
        { f: null, c: null },
        "o REMOVE e o NULL sincronizaram",
      );
    }),
);

prova("IMAGEM: o INSERT de perfil tambem confere (foto e capa)", () =>
  emTransacao(async () => {
    await semear();
    const novo = "a1200000-0000-4000-8000-0000000000aa";
    await C.query(
      "INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'novo@l2.teste')",
      [novo],
    );
    const foto = await tentarComoDono(
      `INSERT INTO public.profiles (id, full_name, avatar_url) VALUES ('${novo}', 'Novo', '${imagem(FOTO_MAX + 1)}')`,
    );
    assert.equal(foto.code, "23514", foto.message);
    const capa = await tentarComoDono(
      `INSERT INTO public.profiles (id, full_name, cover_url) VALUES ('${novo}', 'Novo', '${imagem(CAPA_MAX + 1)}')`,
    );
    assert.equal(capa.code, "23514", capa.message);
    const ok = await tentarComoDono(
      `INSERT INTO public.profiles (id, full_name, avatar_url) VALUES ('${novo}', 'Novo', '${imagem(FOTO_MAX)}')`,
    );
    assert.ok(ok.ok, ok.message);
  }),
);

prova(
  "IMAGEM: quem ja tinha imagem GRANDE antes do lote continua salvando nome, WhatsApp e CPF, e a sincronizacao acontece",
  () =>
    emTransacao(async () => {
      await semear();
      // o estado de antes, uma linha com foto de 1 MB e capa de 2 MB, e o lote de volta por cima
      await voltarParaAntes();
      await C.query(
        "INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'grande@l2.teste') ON CONFLICT (id) DO NOTHING",
        [U.grande],
      );
      await C.query(
        "INSERT INTO public.profiles (id, full_name, role, avatar_url, cover_url) VALUES ($1, 'Grande', 'customer', $2, $3)",
        [U.grande, imagem(1024 * 1024), imagem(2 * 1024 * 1024)],
      );
      for (const i of [0, 1, 2]) await C.query(migration(i));
      const rpc = await como("grande", SQL_RPC, [
        "Grande Novo",
        "11977776666",
        null,
        null,
      ]);
      assert.ok(rpc.ok, `RPC sem imagem: ${rpc.message}`);
      // o app manda a mesma imagem de volta: nao mudou, nao e' conferida
      const mesma = await como("grande", SQL_RPC, [
        null,
        null,
        imagem(1024 * 1024),
        imagem(2 * 1024 * 1024),
      ]);
      assert.ok(mesma.ok, `RPC com a mesma imagem: ${mesma.message}`);
      const cpf = await como("grande", "SELECT public.set_my_cpf($1)", [
        "52998224725",
      ]);
      assert.ok(cpf.ok, `set_my_cpf: ${cpf.message}`);
      const direto = await como(
        "grande",
        "UPDATE public.profiles SET full_name = 'Grande Direto' WHERE id = $1",
        [U.grande],
      );
      assert.ok(direto.ok && direto.n === 1, direto.message);
      const pp = await C.query(
        "SELECT full_name, octet_length(avatar_url) AS f, octet_length(cover_url) AS c FROM public.public_profiles WHERE id = $1",
        [U.grande],
      );
      assert.deepEqual(pp.rows, [
        { full_name: "Grande Direto", f: 1024 * 1024, c: 2 * 1024 * 1024 },
      ]);
      // trocar a imagem por OUTRA grande, agora, e' recusado
      const outra = await como("grande", SQL_UPD_FOTO, [
        U.grande,
        imagem(1024 * 1024 + 1),
      ]);
      assert.equal(outra.code, "23514", outra.message);
    }),
);

prova(
  "IMAGEM: a funcao do gatilho nao e' SECURITY DEFINER e ninguem de fora a executa",
  () =>
    emTransacao(async () => {
      const r = await C.query(
        `SELECT p.prosecdef,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0) AS publico
         FROM pg_proc p WHERE p.oid = to_regprocedure('public.perfil_recusa_imagem_grande()')`,
      );
      assert.deepEqual(r.rows, [
        { prosecdef: false, anon: false, auth: false, publico: false },
      ]);
    }),
);

// ---------------------------------------------------------------------------
// CONTAGEM DO PUSH e VIEW DO PAINEL (20261218000000)
// ---------------------------------------------------------------------------

const SQL_PUSH = "SELECT public.get_segmented_push_count('all') AS n";

prova(
  "PUSH: CONTROLE — antes do lote o visitante chega ao corpo (recusa do corpo, nao de permissao)",
  () =>
    emTransacao(async () => {
      await semear();
      await voltarParaAntes();
      const r = await como("anon", SQL_PUSH);
      assert.equal(r.ok, false);
      assert.notEqual(
        r.code,
        "42501",
        "antes, a porta estava aberta ao visitante",
      );
      assert.match(r.message, /Acesso negado/);
    }),
);

prova(
  "PUSH: o visitante recebe 42501; o admin atual conta; o logado comum cai na recusa do corpo",
  () =>
    emTransacao(async () => {
      await semear();
      const anon = await como("anon", SQL_PUSH);
      assert.equal(anon.code, "42501", anon.message);
      const adm = await como("admin", SQL_PUSH);
      assert.ok(adm.ok, adm.message);
      assert.equal(typeof adm.rows[0].n, "string", "bigint");
      const cli = await como("terceiro", SQL_PUSH);
      assert.equal(cli.ok, false);
      assert.notEqual(cli.code, "42501");
      assert.match(cli.message, /Acesso negado/);
      const reb = await como("rebaixado", SQL_PUSH);
      assert.equal(reb.ok, false, "o rebaixado nao conta");
    }),
);

prova(
  "VIEW: CONTROLE antes (o visitante le, zero linhas); DEPOIS 42501; o admin le e cadastra produto pela view",
  () =>
    emTransacao(async () => {
      await semear();
      await C.query("SAVEPOINT antes_da_view");
      await require("./ex-admin-demais-tabelas-posterior.cjs").desfazerExAdminNaTransacao(
        C,
      );
      await voltarParaAntes();
      const antes = await como(
        "anon",
        "SELECT id FROM public.vw_produtos_admin",
      );
      assert.ok(antes.ok, antes.message);
      assert.equal(antes.n, 0);
      await C.query("ROLLBACK TO SAVEPOINT antes_da_view");
      const depois = await como(
        "anon",
        "SELECT id FROM public.vw_produtos_admin",
      );
      assert.equal(depois.code, "42501", depois.message);
      const le = await como(
        "admin",
        "SELECT id, custo FROM public.vw_produtos_admin WHERE id = $1",
        [P_PROD],
      );
      assert.ok(le.ok, le.message);
      assert.equal(le.n, 1);
      const cad = await como(
        "admin",
        "INSERT INTO public.vw_produtos_admin (id, nome, preco_venda, custo, estoque) VALUES ($1, 'Novo pela view', 10, 4, 0) RETURNING id",
        [P_NOVO],
      );
      assert.ok(cad.ok, `cadastro pela view: ${cad.message}`);
      const cli = await como(
        "terceiro",
        "SELECT id FROM public.vw_produtos_admin",
      );
      assert.ok(cli.ok, cli.message);
      assert.equal(
        cli.n,
        0,
        "o logado comum segue vendo zero (o WHERE da view)",
      );
    }),
);

// ---------------------------------------------------------------------------
// CONFIGURACOES E CODIGOS SO DO SERVIDOR (20261218000100)
// ---------------------------------------------------------------------------

const TABELAS = ["public.app_settings", "public.otp_verifications"];

prova(
  "SERVIDOR: CONTROLE — antes (o estado da loja que tinha os grants) anon e authenticated tinham privilegio",
  () =>
    emTransacao(async () => {
      await voltarParaAntes();
      for (const t of TABELAS) {
        for (const p of ["anon", "authenticated"]) {
          const r = await C.query(
            "SELECT has_table_privilege($1, $2, 'SELECT') AS s",
            [p, t],
          );
          assert.equal(r.rows[0].s, true, `${p} em ${t}`);
        }
        const r = await como("anon", `SELECT count(*) FROM ${t}`);
        assert.ok(
          r.ok,
          `antes, o anon passava do grant (a RLS devolvia zero): ${r.message}`,
        );
      }
    }),
);

prova(
  "SERVIDOR: anon e authenticated (ate o admin) recebem 42501; service_role le e grava",
  () =>
    emTransacao(async () => {
      await semear();
      for (const t of TABELAS) {
        for (const quem of ["anon", "terceiro", "admin"]) {
          const r = await como(quem, `SELECT count(*) FROM ${t}`);
          assert.equal(r.code, "42501", `${quem} em ${t}: ${r.message}`);
        }
        const ins = await como("anon", `DELETE FROM ${t}`);
        assert.equal(ins.code, "42501");
      }
      // Fabrica do Supabase que o provisionar.cjs nao emula: service_role tem BYPASSRLS (as edge
      // functions leem o cofre sem politica). ALTER ROLE e' transacional: o ROLLBACK do caso o desfaz.
      await C.query("ALTER ROLE service_role BYPASSRLS");
      const s = await como(
        "servico",
        `INSERT INTO public.app_settings (key, value) VALUES ('teste_l2', '"x"') RETURNING key`,
      );
      assert.ok(s.ok, `service_role grava: ${s.message}`);
      const u = await como(
        "servico",
        "UPDATE public.app_settings SET value = '\"y\"' WHERE key = 'teste_l2'",
      );
      assert.ok(u.ok && u.n === 1, u.message);
      const l = await como(
        "servico",
        "SELECT value FROM public.app_settings WHERE key = 'teste_l2'",
      );
      assert.ok(l.ok && l.n === 1, l.message);
      const d = await como(
        "servico",
        "DELETE FROM public.app_settings WHERE key = 'teste_l2'",
      );
      assert.ok(d.ok && d.n === 1, d.message);
      const o = await como(
        "servico",
        "SELECT count(*) FROM public.otp_verifications",
      );
      assert.ok(o.ok, o.message);
    }),
);

prova(
  "SERVIDOR: o codigo do rastreio do convidado continua saindo (service_role) e sendo conferido (anon)",
  () =>
    emTransacao(async () => {
      const email = "convidado@l2.teste";
      const fone = "11988887777";
      await C.query(
        `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_phone, customer_data, total, subtotal, payment_status)
       VALUES ($1, NULL, 'Convidado L2', $2, $3::jsonb, 100, 100, 'aguardando')`,
        [O_PEDIDO, fone, JSON.stringify({ email, whatsapp: fone })],
      );
      const frag = O_PEDIDO.slice(-6);
      const g = await como(
        "servico",
        "SELECT public.generate_order_otp_v2($1, $2, $3) AS r",
        [email, fone, frag],
      );
      assert.ok(g.ok, g.message);
      assert.equal(g.rows[0].r.ok, true, JSON.stringify(g.rows[0].r));
      const v = await como(
        "anon",
        "SELECT public.get_orders_by_otp_v2($1, $2, $3, $4) AS r",
        [email, fone, frag, g.rows[0].r.otp_code],
      );
      assert.ok(v.ok, v.message);
      assert.equal(v.rows[0].r.ok, true, JSON.stringify(v.rows[0].r));
      assert.equal(v.rows[0].r.orders[0].id, O_PEDIDO);
    }),
);

prova(
  "SERVIDOR: numa loja ja fechada a migration e' no-op (o mesmo estado)",
  () =>
    emTransacao(async () => {
      for (const t of TABELAS)
        await C.query(
          `REVOKE ALL ON TABLE ${t} FROM PUBLIC, anon, authenticated`,
        );
      const acl = async () =>
        (
          await C.query(
            "SELECT string_agg(c.relname || '=' || coalesce(c.relacl::text, ''), ';' ORDER BY c.relname) AS a FROM pg_class c WHERE c.oid IN ('public.app_settings'::regclass, 'public.otp_verifications'::regclass)",
          )
        ).rows[0].a;
      const antes = await acl();
      await C.query(migration(1));
      assert.equal(await acl(), antes);
    }),
);

prova(
  "SERVIDOR: grant de COLUNA ao anon some junto com o REVOKE de tabela",
  () =>
    emTransacao(async () => {
      await voltarParaAntes();
      await C.query("REVOKE ALL ON TABLE public.app_settings FROM anon");
      await C.query("GRANT SELECT (key) ON public.app_settings TO anon");
      const antes = await C.query(
        "SELECT has_any_column_privilege('anon', 'public.app_settings', 'SELECT') AS c",
      );
      assert.equal(
        antes.rows[0].c,
        true,
        "controle: o grant de coluna existia",
      );
      await C.query(migration(1));
      const depois = await C.query(
        "SELECT has_any_column_privilege('anon', 'public.app_settings', 'SELECT') AS c",
      );
      assert.equal(depois.rows[0].c, false);
    }),
);

prova(
  "SERVIDOR: grant dado por OUTRO grantor (o REVOKE so avisa) faz a conferencia recusar o apply inteiro",
  () =>
    emTransacao(async () => {
      await voltarParaAntes();
      await C.query(
        "GRANT ALL ON TABLE public.otp_verifications TO service_role WITH GRANT OPTION",
      );
      await C.query("SET LOCAL ROLE service_role");
      await C.query("GRANT SELECT ON TABLE public.otp_verifications TO anon");
      await C.query("RESET ROLE");
      const r = await tentarComoDono(migration(1));
      assert.equal(r.ok, false, "a migration passou com o anon ainda lendo");
      assert.match(
        r.message,
        /conferencia 20261218000100: anon ainda alcanca public\.otp_verifications/,
      );
    }),
);

// ---------------------------------------------------------------------------
// MIGRATION: reaplicar, CRLF, rollback, pre-voo
// ---------------------------------------------------------------------------

const DIGITAL = `
  SELECT string_agg(k || '=' || v, E'\\n' ORDER BY k) AS d FROM (
    SELECT 'fn ' || p.oid::regprocedure::text AS k,
           md5(replace(p.prosrc, chr(13), '')) || ' ' || p.prosecdef::text || ' ' ||
           coalesce((SELECT string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ','
                                       ORDER BY a.grantee::regrole::text || ':' || a.privilege_type)
                       FROM aclexplode(p.proacl) a), '') AS v
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    UNION ALL
    SELECT 'tg ' || t.tgname, pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text FROM pg_trigger t
     WHERE NOT t.tgisinternal AND t.tgrelid = 'public.profiles'::regclass
    UNION ALL
    SELECT 'pol ' || pol.polrelid::regclass::text || '.' || pol.polname,
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-') || ' ' || pol.polroles::regrole[]::text
      FROM pg_policy pol
    UNION ALL
    SELECT 'acl ' || c.oid::regclass::text,
           coalesce((SELECT string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ','
                                       ORDER BY a.grantee::regrole::text || ':' || a.privilege_type)
                       FROM aclexplode(c.relacl) a), '')
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v')
  ) x`;
const digital = async () => (await C.query(DIGITAL)).rows[0].d;

prova(
  "MIGRATION: reaplicar (LF e CRLF) = o mesmo estado; o rollback devolve o estado de antes; de novo = depois",
  () =>
    emTransacao(async () => {
      const depois = await digital();
      for (const i of [0, 1, 2]) await C.query(migration(i));
      assert.equal(await digital(), depois, "reaplicar");
      for (const i of [0, 1, 2])
        await C.query(migration(i).replace(/\r?\n/g, "\r\n"));
      assert.equal(await digital(), depois, "CRLF");
      await voltarParaAntes();
      const antes = await digital();
      assert.notEqual(antes, depois, "o rollback mudou alguma coisa");
      await voltarParaAntes();
      assert.equal(await digital(), antes, "rollback duas vezes");
      for (const i of [0, 1, 2]) await C.query(migration(i));
      assert.equal(await digital(), depois, "de novo");
      // o antes e' o banco das migrations ANTERIORES: a politica USING (true) de PUBLIC, sem gatilho
      await voltarParaAntes();
      const pol = await C.query(
        "SELECT pg_get_expr(polqual, polrelid) AS q, polroles::regrole[]::text AS r FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass",
      );
      assert.deepEqual(pol.rows, [{ q: "true", r: "{-}" }]);
    }),
);

prova(
  "MIGRATION: o pre-voo de cada uma recusa um banco divergente SEM escrever nada",
  () =>
    emTransacao(async () => {
      await voltarParaAntes();
      const antes = await digital();
      // 1: corpo da contagem do push diferente do vigente
      await C.query("SAVEPOINT div1");
      await C.query(
        "CREATE OR REPLACE FUNCTION public.get_segmented_push_count(p_segment text DEFAULT 'all'::text, p_min_ltv numeric DEFAULT 150, p_days_inactive integer DEFAULT 30) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$",
      );
      let r = await tentarComoDono(migration(0));
      assert.match(
        r.message || "",
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.get_segmented_push_count/,
      );
      await C.query("ROLLBACK TO SAVEPOINT div1");
      // 2: service_role sem DELETE em otp_verifications
      await C.query("SAVEPOINT div2");
      await C.query(
        "REVOKE DELETE ON public.otp_verifications FROM service_role",
      );
      r = await tentarComoDono(migration(1));
      assert.match(r.message || "", /B1_BASELINE_DIVERGENT: service_role sem/);
      await C.query("ROLLBACK TO SAVEPOINT div2");
      // 3: uma segunda politica em public_profiles
      await C.query("SAVEPOINT div3");
      await C.query(
        "CREATE POLICY outra ON public.public_profiles FOR SELECT TO anon USING (true)",
      );
      r = await tentarComoDono(migration(2));
      assert.match(
        r.message || "",
        /B1_BASELINE_DIVERGENT: public\.public_profiles tem 2 políticas/,
      );
      await C.query("ROLLBACK TO SAVEPOINT div3");
      // 3: a politica com outra expressao
      await C.query("SAVEPOINT div4");
      await C.query(
        "ALTER POLICY public_profiles_select_policy ON public.public_profiles USING (id IS NOT NULL)",
      );
      r = await tentarComoDono(migration(2));
      assert.match(
        r.message || "",
        /B1_BASELINE_DIVERGENT: política public_profiles_select_policy/,
      );
      await C.query("ROLLBACK TO SAVEPOINT div4");
      assert.equal(await digital(), antes, "nenhuma escrita sobrou");
    }),
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${String(e.message).split("\n").join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do lote L2 falharam.`,
    );
  }
  console.log(
    `\n[portas-do-banco] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

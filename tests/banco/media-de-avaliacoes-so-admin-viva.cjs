"use strict";

/**
 * Prova VIVA da migration 20261222000000 (a media de avaliacoes so responde ao administrador: o corpo de
 * `get_reviews_metrics` passa a exigir `public.is_admin()`; ordem do dono, 14/10/2026), num Postgres EFEMERO
 * local, sem rede, com os papeis de verdade (anon, authenticated, service_role).
 *
 * Cada caso roda numa transacao que termina em ROLLBACK (o da concorrencia usa duas conexoes reais, grava de
 * verdade e desfaz com o rollback-manual). O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a
 * arvore pode ou nao ja ter a 20261222 (em CI ela tem), TODO caso comeca pelo estado ANTES, montado com o
 * rollback-manual dela (CREATE OR REPLACE com o corpo antigo, idempotente) e conferido contra o corpo da
 * baseline LIDO DO ARQUIVO, byte a byte (as linhas com espaco no fim contam).
 *
 *  ANTES      controle: com o corpo antigo, uma conta logada que NAO e' admin le a media de TODAS as avaliacoes
 *             (o defeito); o visitante ja e' recusado (42501, a 20261221).
 *  DEPOIS     anon = 42501 (antes do corpo); authenticated NAO-admin = a excecao da guarda (P0001), com JWT de
 *             cliente, sem JWT e sem auth.uid(); admin pelo JWT (`app_metadata.role`), admin so no auth.users e
 *             service_role = a MESMA linha de antes, para as mesmas entradas, sobre avaliacoes que ja existiam
 *             (publicadas, pendentes, verificadas, respondidas, resposta so de espacos); a sessao `postgres` sem
 *             SET ROLE (GUC role = 'none') e' negada; o admin rebaixado com JWT ainda valido continua lendo
 *             (consequencia aceita e declarada no cabecalho da migration).
 *  SO O CORPO so o corpo dessa funcao muda (nenhuma outra funcao, nenhuma tabela, nenhuma ACL), o oid e a ACL
 *             da funcao ficam, nenhuma linha de avaliacao ou voto muda.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve o `prosrc` IDENTICO ao da baseline (mesmo
 *             md5) sem tocar a ACL (nunca abre anon nem PUBLIC), a ida e volta termina igual; o pre-voo recusa
 *             SEM escrever (corpo desconhecido, atributo diferente, sobrecarga, funcao ausente, is_admin ausente
 *             ou que o dono nao executa, ACL aberta ou sem a 20261221); as conferencias finais, rodadas sobre
 *             estados ruins, recusam.
 *  CONCORRENCIA uma chamada em voo nao segura o apply, e depois do commit a MESMA conexao, em transacao nova, ja
 *             responde pelo corpo novo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/media-de-avaliacoes-so-admin-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
const ARQ =
  "20261222000000_a_media_de_avaliacoes_so_responde_ao_administrador.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

// O corpo ANTIGO e' o da baseline, LIDO DO ARQUIVO (do `$$` ao `$$`), nunca copiado para ca.
const BASELINE = fs.readFileSync(
  path.join(MIGRATIONS, "20260806000000_baseline_do_schema_vivo.sql"),
  "utf8",
);
const _i = BASELINE.indexOf("CREATE FUNCTION public.get_reviews_metrics(");
const _a = BASELINE.indexOf("AS $$", _i) + 5;
const CORPO_ANTIGO = BASELINE.slice(_a, BASELINE.indexOf("$$;", _a));
const H_ANTIGO = "f7fb638c20dce1ae26509f4ffc563120";
assert.equal(md5(CORPO_ANTIGO), H_ANTIGO, "o corpo da baseline mudou");
assert.ok(
  /[ \t]\n/.test(CORPO_ANTIGO),
  "o corpo antigo tem linhas com espaco no fim (a armadilha do byte a byte)",
);

const FN = "public.get_reviews_metrics(text,integer)";
const SQL_METRICAS =
  "SELECT * FROM public.get_reviews_metrics($1::text, $2::integer)";
const MSG_GUARDA = /Acesso negado: privilégios de administrador necessários/;

// A ACL que a 20261221 deixa; a do 22 e' a MESMA (CREATE OR REPLACE nao a toca).
const ACL_FECHADA = [
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];

const U = {
  admin: "7e7e2220-0000-4000-8000-0000000000a1",
  cliente: "7e7e2220-0000-4000-8000-0000000000b2",
  rebaixado: "7e7e2220-0000-4000-8000-0000000000c3",
  autor1: "7e7e2220-0000-4000-8000-0000000000d4",
  autor2: "7e7e2220-0000-4000-8000-0000000000d5",
  autor3: "7e7e2220-0000-4000-8000-0000000000d6",
  autor4: "7e7e2220-0000-4000-8000-0000000000d7",
};
const PROD = "7e7e2220-0000-4000-8000-0000000000e1";
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const JWT_CLIENTE = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "customer" },
});

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita, ja no estado ANTES (o rollback-manual da 20261222). */
async function emTransacao(fn, { antes = true } = {}) {
  await C.query("BEGIN");
  try {
    if (antes) {
      await C.query(ROLLBACK);
      assert.equal(await hashVivo(), H_ANTIGO, "o estado ANTES nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`, com o JWT e o auth.uid() pedidos; devolve as linhas (o erro sobe). */
async function como(
  papel,
  sql,
  params = [],
  { uid = "", claims = "" } = {},
  conexao = C,
) {
  await conexao.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await conexao.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await conexao.query(sql, params)).rows;
  } finally {
    // transacao abortada nao aceita RESET ROLE e o erro dela esconderia o original
    await conexao.query("RESET ROLE").catch(() => {});
  }
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo}. */
async function tentar(papel, sql, params = [], id = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, id);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

const hashVivo = async () =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0].h;
const prosrcVivo = async () =>
  (
    await C.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0].prosrc;
const oidVivo = async () =>
  (await C.query("SELECT to_regprocedure($1)::oid::text AS o", [FN])).rows[0].o;
const aclBruto = async () =>
  (
    await C.query(
      "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0].a;
async function acl() {
  const r = await C.query(
    `SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a
       FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) AS x
      WHERE p.oid = to_regprocedure($1)`,
    [FN],
  );
  return r.rows[0].a;
}
const executa = async (papel) =>
  (
    await C.query(
      "SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS x",
      [papel, FN],
    )
  ).rows[0].x;
const publicTem = async () =>
  (
    await C.query(
      `SELECT EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = to_regprocedure($1) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) AS x`,
      [FN],
    )
  ).rows[0].x;

/** O que a migration nao pode tocar: ACL de TODA funcao e tabela de public, e o corpo de toda funcao. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl,
              md5(p.prosrc) AS corpo, p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  return { funcoes, tabelas };
}

/** As linhas de avaliacao e de voto, byte a byte (hash do conteudo inteiro). */
async function retratoDosDados() {
  const r = await C.query(
    `SELECT (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.reviews x) AS avaliacoes,
            (SELECT count(*)::int FROM public.reviews) AS n_avaliacoes,
            (SELECT coalesce(md5(string_agg(v::text, '|' ORDER BY v.id::text)), '') FROM public.review_votes v) AS votos`,
  );
  return r.rows[0];
}

/** Pessoas e avaliacoes que JA EXISTEM antes da migration (dentro da transacao do caso). */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@22.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 22', 'admin'), ($2, 'Cliente 22', 'customer'), ($3, 'Rebaixado 22', 'customer'),
       ($4, 'Marina Autora', 'customer'), ($5, 'Autor Dois', 'customer'), ($6, 'Autor Tres', 'customer'), ($7, 'Autor Quatro', 'customer')`,
    [U.admin, U.cliente, U.rebaixado, U.autor1, U.autor2, U.autor3, U.autor4],
  );
  // admin atual so no auth.users; o rebaixado NAO esta mais la (so o JWT velho diria admin)
  await C.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
    [U.admin],
  );
  await C.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta Azul 22', 100, 10, true, 40)",
    [PROD],
  );
  await C.query(
    `INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES
       ($1, $2, 5, 'otimo produto', 'publicada'), ($1, $3, 2, 'chegou amassado', 'pendente'),
       ($1, $4, 4, 'bom', 'publicada'), ($1, $5, 1, 'pessimo', 'pendente')`,
    [PROD, U.autor1, U.autor2, U.autor3, U.autor4],
  );
  // verificada e respondida: 2 verificadas, 2 respondidas (a de "   " so tem espacos: nao conta)
  await C.query(
    "UPDATE public.reviews SET verified = true, merchant_reply = 'obrigada' WHERE user_id = $1",
    [U.autor1],
  );
  await C.query(
    "UPDATE public.reviews SET verified = true, merchant_reply = '   ' WHERE user_id = $1",
    [U.autor3],
  );
  await C.query(
    "UPDATE public.reviews SET merchant_reply = 'sentimos muito' WHERE user_id = $1",
    [U.autor4],
  );
  const n = (await C.query("SELECT count(*)::int AS n FROM public.reviews"))
    .rows[0].n;
  assert.equal(n, 4, "fixtures: so as 4 avaliacoes da prova existem");
}

const ENTRADAS = [
  [null, null],
  [null, 5],
  [null, 2],
  [null, 3],
  ["otimo", null],
  ["amassado", 2],
  ["Marina", null],
  ["Camiseta", 1],
  ["Camiseta", null],
  ["nao existe em lugar nenhum", null],
  ["", null],
];

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe: o logado comum le tudo)
// ---------------------------------------------------------------------------

prova(
  "ANTES: com o corpo antigo (o da baseline, byte a byte) o logado que NAO e' admin le a media de TODAS as avaliacoes; o visitante ja e' recusado (42501)",
  () =>
    emTransacao(async () => {
      assert.equal(
        await prosrcVivo(),
        CORPO_ANTIGO,
        "prosrc identico ao da baseline",
      );
      assert.deepEqual(await acl(), ACL_FECHADA);
      await semear();
      const cliente = await tentar(
        "authenticated",
        SQL_METRICAS,
        [null, null],
        { uid: U.cliente, claims: JWT_CLIENTE },
      );
      assert.ok(
        cliente.linhas,
        `o defeito: o cliente comum devia ler. ${cliente.erro}`,
      );
      assert.deepEqual(cliente.linhas, [
        {
          average_rating: "3.0000000000000000",
          total_verified: "2",
          total_replied: "2",
        },
      ]);
      const anon = await tentar("anon", SQL_METRICAS, [null, null]);
      assert.equal(anon.codigo, "42501", anon.erro);
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: anon = 42501; authenticated NAO-admin = a excecao da guarda (P0001) com JWT de cliente, sem JWT e sem auth.uid(); a sessao postgres sem SET ROLE e' negada",
  () =>
    emTransacao(async () => {
      await semear();
      assert.equal(await aplicar(MIGRATION), null);
      const anon = await tentar("anon", SQL_METRICAS, [null, null]);
      assert.equal(anon.codigo, "42501", anon.erro);
      for (const [rotulo, papel, id] of [
        [
          "cliente com JWT de cliente e auth.uid()",
          "authenticated",
          { uid: U.cliente, claims: JWT_CLIENTE },
        ],
        ["cliente so com auth.uid()", "authenticated", { uid: U.cliente }],
        ["authenticated sem JWT e sem auth.uid()", "authenticated", {}],
        [
          "rebaixado so com auth.uid() (nao esta mais no auth.users)",
          "authenticated",
          { uid: U.rebaixado },
        ],
        ["sessao postgres sem SET ROLE (GUC role = none)", null, {}],
      ]) {
        const r = await tentar(papel, SQL_METRICAS, [null, null], id);
        assert.equal(r.codigo, "P0001", `${rotulo}: ${r.erro}`);
        assert.match(r.erro, MSG_GUARDA, rotulo);
      }
      // com filtros, a guarda vem ANTES: nenhuma entrada vaza nada a quem nao e' admin
      for (const [s, r] of ENTRADAS) {
        const x = await tentar("authenticated", SQL_METRICAS, [s, r], {
          uid: U.cliente,
          claims: JWT_CLIENTE,
        });
        assert.equal(x.codigo, "P0001", `${s}/${r}: ${x.erro}`);
      }
    }),
);

prova(
  "DEPOIS: o admin (pelo JWT, ou so pelo auth.users) e o service_role recebem a MESMA linha que o corpo antigo dava, para as mesmas entradas, sobre avaliacoes que ja existiam",
  () =>
    emTransacao(async () => {
      await semear();
      // a linha de ANTES (corpo antigo), por entrada
      const antes = [];
      for (const [s, r] of ENTRADAS) {
        const x = await tentar("authenticated", SQL_METRICAS, [s, r], {
          uid: U.cliente,
          claims: JWT_CLIENTE,
        });
        assert.ok(x.linhas, `${s}/${r}: ${x.erro}`);
        antes.push(x.linhas);
      }
      assert.deepEqual(antes[0], [
        {
          average_rating: "3.0000000000000000",
          total_verified: "2",
          total_replied: "2",
        },
      ]);
      assert.deepEqual(antes[1], [
        {
          average_rating: "5.0000000000000000",
          total_verified: "1",
          total_replied: "1",
        },
      ]);
      assert.deepEqual(antes[9], [
        { average_rating: "0.0", total_verified: "0", total_replied: "0" },
      ]);
      assert.equal(await aplicar(MIGRATION), null);
      for (const [rotulo, papel, id] of [
        ["admin pelo JWT", "authenticated", { claims: JWT_ADMIN }],
        ["admin so pelo auth.users", "authenticated", { uid: U.admin }],
        [
          "admin rebaixado com o JWT ainda valido (aceito: media, nao dinheiro)",
          "authenticated",
          { uid: U.rebaixado, claims: JWT_ADMIN },
        ],
        ["service_role", "service_role", {}],
      ]) {
        for (const [i, [s, r]] of ENTRADAS.entries()) {
          const x = await tentar(papel, SQL_METRICAS, [s, r], id);
          assert.ok(x.linhas, `${rotulo} ${s}/${r}: ${x.erro}`);
          assert.deepEqual(
            x.linhas,
            antes[i],
            `${rotulo} ${s}/${r}: a linha mudou`,
          );
        }
      }
    }),
);

prova(
  "DEPOIS: so o CORPO dessa funcao mudou (nenhuma outra funcao, nenhuma tabela, nenhuma ACL), o oid e a ACL ficam e nenhuma linha de avaliacao ou voto muda",
  () =>
    emTransacao(async () => {
      await semear();
      const esquemaAntes = await retratoDoSchema();
      const dadosAntes = await retratoDosDados();
      const oidAntes = await oidVivo();
      const aclAntes = await aclBruto();
      assert.equal(await aplicar(MIGRATION), null);
      const esquemaDepois = await retratoDoSchema();
      assert.deepEqual(await retratoDosDados(), dadosAntes, "dados intactos");
      assert.deepEqual(esquemaDepois.tabelas, esquemaAntes.tabelas);
      assert.equal(esquemaDepois.funcoes.length, esquemaAntes.funcoes.length);
      const mudaram = esquemaDepois.funcoes
        .filter(
          (f, i) =>
            JSON.stringify(f) !== JSON.stringify(esquemaAntes.funcoes[i]),
        )
        .map((f) => f.f);
      assert.deepEqual(mudaram, ["get_reviews_metrics(text,integer)"]);
      const a = esquemaAntes.funcoes.find((x) => x.f === mudaram[0]);
      const d = esquemaDepois.funcoes.find((x) => x.f === mudaram[0]);
      assert.notEqual(d.corpo, a.corpo, "o corpo mudou");
      assert.equal(d.acl, a.acl, "ACL intacta");
      assert.equal(d.oid, a.oid, "mesmo oid");
      assert.equal(d.prosecdef, true);
      assert.equal(d.provolatile, "v");
      assert.equal(d.cfg, a.cfg);
      assert.equal(await oidVivo(), oidAntes);
      assert.equal(await aclBruto(), aclAntes);
      assert.deepEqual(await acl(), ACL_FECHADA);
      assert.equal(await publicTem(), false);
      assert.equal(await executa("anon"), false);
      // o corpo novo = o antigo + a guarda (nada mais)
      const novo = await prosrcVivo();
      assert.ok(novo.includes("IF NOT public.is_admin() THEN"));
      const semGuarda = novo.replace(
        / {2}-- Só o administrador[\s\S]*? {2}END IF;\n\n/,
        "",
      );
      assert.equal(
        semGuarda,
        CORPO_ANTIGO,
        "tirando a guarda sobra o corpo antigo, byte a byte",
      );
    }),
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, rollback, pre-voo, conferencia
// ---------------------------------------------------------------------------

prova(
  "MIGRATION: reaplicar (2x) e em CRLF deixa o mesmo estado (hash, ACL, oid); o corpo novo e' reconhecido como segundo estado de entrada",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      const um = [await hashVivo(), await aclBruto(), await oidVivo()];
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(emCRLF(MIGRATION)), null);
      assert.deepEqual(
        [await hashVivo(), await aclBruto(), await oidVivo()],
        um,
      );
      assert.deepEqual(await acl(), ACL_FECHADA);
      // a guarda continua valendo depois do CRLF
      const r = await tentar("authenticated", SQL_METRICAS, [null, null], {
        uid: U.cliente,
      });
      assert.equal(r.codigo, "P0001", r.erro);
    }),
);

prova(
  "MIGRATION: o rollback devolve o prosrc IDENTICO ao da baseline (mesmo md5) sem tocar a ACL; ida e volta termina igual; rodar o rollback 2x (e em CRLF) nao muda nada; o anon continua fechado",
  () =>
    emTransacao(async () => {
      const aclAntes = await aclBruto();
      const oidAntes = await oidVivo();
      assert.equal(await aplicar(MIGRATION), null);
      assert.notEqual(await hashVivo(), H_ANTIGO);
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await prosrcVivo(), CORPO_ANTIGO, "prosrc byte a byte");
      assert.equal(md5(await prosrcVivo()), H_ANTIGO);
      assert.equal(await aclBruto(), aclAntes, "ACL intacta");
      assert.equal(await oidVivo(), oidAntes);
      assert.equal(await publicTem(), false);
      assert.equal(await executa("anon"), false);
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await aplicar(emCRLF(ROLLBACK)), null);
      assert.equal(
        await hashVivo(),
        H_ANTIGO,
        "o rollback em CRLF tambem fecha no mesmo hash (o prosrc ganha CR, o hash o tira)",
      );
      assert.equal(await aclBruto(), aclAntes);
      // ida e volta
      assert.equal(await aplicar(MIGRATION), null);
      const hNovo = await hashVivo();
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await hashVivo(), hNovo);
      // depois do rollback o comportamento volta junto: o logado comum volta a ler (o defeito), o visitante nao
      assert.equal(await aplicar(ROLLBACK), null);
      await semear();
      const c = await tentar("authenticated", SQL_METRICAS, [null, null], {
        uid: U.cliente,
      });
      assert.ok(c.linhas, c.erro);
      const a = await tentar("anon", SQL_METRICAS, [null, null]);
      assert.equal(a.codigo, "42501", a.erro);
    }),
);

prova(
  "MIGRATION: o pre-voo recusa SEM escrever (corpo desconhecido, STABLE, argumento diferente, search_path diferente, sobrecarga, funcao ausente, is_admin ausente ou que o dono nao executa, anon aberto, PUBLIC aberto, sem authenticated, sem service_role)",
  () =>
    emTransacao(async () => {
      const corpoAntes = await hashVivo();
      const aclAntes = await aclBruto();
      const casos = [
        [
          "corpo desconhecido (1 byte a mais)",
          /corpo vivo de .* não é nem o antigo/,
          async () => {
            await C.query(
              `CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
               RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
               LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
             AS $x$${CORPO_ANTIGO} $x$`,
            );
          },
        ],
        [
          "STABLE",
          /atributos de/,
          () => C.query(`ALTER FUNCTION ${FN} STABLE`),
        ],
        [
          "sem SECURITY DEFINER",
          /atributos de/,
          () => C.query(`ALTER FUNCTION ${FN} SECURITY INVOKER`),
        ],
        [
          "search_path diferente",
          /atributos de/,
          () =>
            C.query(
              `ALTER FUNCTION ${FN} SET search_path TO public, extensions`,
            ),
        ],
        [
          "sem search_path",
          /atributos de/,
          () => C.query(`ALTER FUNCTION ${FN} RESET search_path`),
        ],
        [
          "sobrecarga",
          /sobrecarga/,
          () =>
            C.query(
              "CREATE FUNCTION public.get_reviews_metrics(x text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
            ),
        ],
        ["funcao ausente", /não existe/, () => C.query(`DROP FUNCTION ${FN}`)],
        [
          "is_admin ausente",
          /is_admin\(\) não existe/,
          () =>
            C.query("ALTER FUNCTION public.is_admin() RENAME TO is_admin_zz"),
        ],
        [
          "anon aberto (a 20261221 nao aplicada)",
          /aplique a 20261221000000 antes/,
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
        ],
        [
          "PUBLIC aberto",
          /ACL de/,
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
        ],
        [
          "sem authenticated",
          /ACL de/,
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
        ],
        [
          "sem service_role",
          /ACL de/,
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`),
        ],
        [
          "dono sem EXECUTE em is_admin (papel nao-superusuario)",
          /o dono de .* não executa public.is_admin/,
          async () => {
            await C.query("CREATE ROLE zz_dono_222 NOLOGIN NOSUPERUSER");
            await C.query("GRANT CREATE ON SCHEMA public TO zz_dono_222");
            await C.query(`ALTER FUNCTION ${FN} OWNER TO zz_dono_222`);
            await C.query(
              "REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC",
            );
          },
        ],
      ];
      for (const [rotulo, esperado, mutar] of casos) {
        await C.query("SAVEPOINT s1");
        await mutar();
        const hashAntesDaTentativa = await hashVivo().catch(() => null);
        const aclAntesDaTentativa = await aclBruto().catch(() => null);
        const e = await aplicar(MIGRATION);
        assert.ok(e, `${rotulo}: o apply tinha de recusar`);
        assert.match(e.erro, /B1_BASELINE_DIVERGENT/, rotulo);
        assert.match(e.erro, esperado, rotulo);
        assert.equal(
          await hashVivo().catch(() => null),
          hashAntesDaTentativa,
          `${rotulo}: nada escrito (corpo)`,
        );
        assert.equal(
          await aclBruto().catch(() => null),
          aclAntesDaTentativa,
          `${rotulo}: nada escrito (ACL)`,
        );
        await C.query("ROLLBACK TO SAVEPOINT s1");
      }
      assert.equal(await hashVivo(), corpoAntes);
      assert.equal(await aclBruto(), aclAntes);
      // a base sem mexida aplica
      assert.equal(await aplicar(MIGRATION), null);
    }),
);

/** Extrai o bloco DO nomeado do arquivo (o texto do pre-voo ou da conferencia). */
function blocoDo(sql, etiqueta) {
  const i = sql.indexOf(`DO $${etiqueta}$`);
  const fim = sql.indexOf(`END $${etiqueta}$;`);
  assert.ok(i >= 0 && fim > i, `bloco ${etiqueta}`);
  return sql.slice(i, fim + `END $${etiqueta}$;`.length);
}

prova(
  "MIGRATION: a conferencia final da migration, rodada sobre estados ruins, recusa (corpo antigo, anon aberto, PUBLIC aberto, sem authenticated, sem service_role, atributo mudado); no estado certo passa",
  () =>
    emTransacao(async () => {
      const conferencia = blocoDo(MIGRATION, "conferencia_20261222");
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(conferencia), null, "estado certo passa");
      const casos = [
        [
          "corpo antigo",
          /conferencia 20261222: corpo vivo .* não é o novo/,
          () => C.query(ROLLBACK),
        ],
        [
          "anon aberto",
          /conferencia 20261222: anon executa/,
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
        ],
        [
          "PUBLIC aberto",
          /conferencia 20261222: .* alcancavel por PUBLIC/,
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
        ],
        [
          "sem authenticated",
          /conferencia 20261222: authenticated perdeu/,
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
        ],
        [
          "sem service_role",
          /conferencia 20261222: service_role perdeu/,
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`),
        ],
        [
          "STABLE",
          /conferencia 20261222: atributos/,
          () => C.query(`ALTER FUNCTION ${FN} STABLE`),
        ],
      ];
      for (const [rotulo, esperado, mutar] of casos) {
        await C.query("SAVEPOINT c1");
        await mutar();
        const e = await aplicar(conferencia);
        assert.ok(e, `${rotulo}: a conferencia tinha de recusar`);
        assert.match(e.erro, esperado, rotulo);
        await C.query("ROLLBACK TO SAVEPOINT c1");
      }
    }),
);

prova(
  "MIGRATION: o rollback recusa corpo desconhecido, funcao ausente, sobrecarga, PUBLIC aberto e ACL sem authenticated, sem escrever; e a conferencia dele recusa estado ruim; o anon aberto NAO o bloqueia (ordem inversa dos rollbacks) e ele nunca abre o anon",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      const casos = [
        [
          "corpo desconhecido",
          /corpo vivo de .* não é o novo/,
          () =>
            C.query(
              `CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
               RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
               LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
             AS $x$BEGIN RETURN QUERY SELECT 1::numeric, 1::bigint, 1::bigint; END;$x$`,
            ),
        ],
        ["funcao ausente", /não existe/, () => C.query(`DROP FUNCTION ${FN}`)],
        [
          "sobrecarga",
          /sobrecarga/,
          () =>
            C.query(
              "CREATE FUNCTION public.get_reviews_metrics(x text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
            ),
        ],
        [
          "PUBLIC aberto",
          /aberta para PUBLIC/,
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
        ],
        [
          "sem authenticated",
          /authenticated ou service_role sem EXECUTE/,
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
        ],
      ];
      for (const [rotulo, esperado, mutar] of casos) {
        await C.query("SAVEPOINT r1");
        await mutar();
        const antes = await hashVivo().catch(() => null);
        const e = await aplicar(ROLLBACK);
        assert.ok(e, `${rotulo}: o rollback tinha de recusar`);
        assert.match(e.erro, /B1_BASELINE_DIVERGENT/, rotulo);
        assert.match(e.erro, esperado, rotulo);
        assert.equal(
          await hashVivo().catch(() => null),
          antes,
          `${rotulo}: nada escrito`,
        );
        await C.query("ROLLBACK TO SAVEPOINT r1");
      }
      // a conferencia do rollback sobre estados ruins
      const conf = blocoDo(ROLLBACK, "conferencia_rollback_20261222");
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await aplicar(conf), null, "estado certo passa");
      for (const [rotulo, esperado, mutar] of [
        ["corpo novo", /não voltou ao antigo/, () => C.query(MIGRATION)],
        [
          "PUBLIC aberto",
          /aberta para PUBLIC/,
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
        ],
        ["STABLE", /atributos/, () => C.query(`ALTER FUNCTION ${FN} STABLE`)],
        [
          "sem authenticated",
          /sem EXECUTE/,
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
        ],
      ]) {
        await C.query("SAVEPOINT r2");
        await mutar();
        const e = await aplicar(conf);
        assert.ok(e, `${rotulo}: a conferencia do rollback tinha de recusar`);
        assert.match(e.erro, esperado, rotulo);
        await C.query("ROLLBACK TO SAVEPOINT r2");
      }
      // rollback da 20261221 ja rodado antes (anon aberto): este ainda roda e NAO mexe no anon
      assert.equal(await aplicar(MIGRATION), null);
      await C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
      const aclComAnon = await aclBruto();
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await aclBruto(), aclComAnon, "o rollback nao mexeu na ACL");
      assert.equal(await hashVivo(), H_ANTIGO);
    }),
);

// ---------------------------------------------------------------------------
// CONCORRENCIA
// ---------------------------------------------------------------------------

prova(
  "CONCORRENCIA: uma chamada em voo (transacao aberta) nao segura o apply, e depois do commit a MESMA conexao, em transacao nova, ja responde pelo corpo novo (nao-admin recusado, admin lendo)",
  async () => {
    const B = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await B.connect();
    try {
      await C.query(ROLLBACK); // estado ANTES, commitado
      await B.query("BEGIN");
      const antes = await como(
        "authenticated",
        SQL_METRICAS,
        [null, null],
        { claims: JWT_CLIENTE },
        B,
      );
      assert.equal(
        antes.length,
        1,
        "o logado comum le a media ANTES do apply (o defeito)",
      );
      // o apply (commit de verdade) nao pode ficar preso atras da transacao do outro
      await C.query("SET statement_timeout = '8s'");
      await C.query(MIGRATION);
      await C.query("RESET statement_timeout");
      assert.equal(await hashVivo(), md5Corpo(MIGRATION));
      // A transacao que JA estava em voo pode ainda terminar com o corpo que ja tinha na memoria (limite
      // documentado do Postgres: o catalogo novo so e' visto na fronteira da transacao).
      await B.query("ROLLBACK");
      await B.query("BEGIN");
      await assert.rejects(
        () =>
          como(
            "authenticated",
            SQL_METRICAS,
            [null, null],
            { claims: JWT_CLIENTE },
            B,
          ),
        (e) => e.code === "P0001" && MSG_GUARDA.test(e.message),
      );
      await B.query("ROLLBACK");
      await B.query("BEGIN");
      const admin = await como(
        "authenticated",
        SQL_METRICAS,
        [null, null],
        { claims: JWT_ADMIN },
        B,
      );
      assert.equal(admin.length, 1);
    } finally {
      await B.query("ROLLBACK").catch(() => {});
      await B.end().catch(() => {});
      await C.query("RESET statement_timeout").catch(() => {});
      await C.query(MIGRATION).catch(() => {}); // devolve a arvore ao estado migrado
    }
  },
);

/** md5 do corpo novo, tirado do proprio arquivo da migration (do `$$` ao `$$`). */
function md5Corpo(sql) {
  const i = sql.indexOf("AS $$") + 5;
  return md5(sql.slice(i, sql.indexOf("$$;", i)).replace(/\r/g, ""));
}

prova(
  "ARQUIVO: o corpo novo da migration tem o md5 que o pre-voo e a conferencia declaram, e o do rollback e' o do baseline",
  async () => {
    const h = md5Corpo(MIGRATION);
    assert.ok(
      MIGRATION.split(h).length - 1 >= 2,
      "o hash novo aparece no pre-voo e na conferencia",
    );
    assert.ok(MIGRATION.includes(H_ANTIGO));
    assert.equal(md5Corpo(ROLLBACK), H_ANTIGO);
    const iR = ROLLBACK.indexOf("AS $$") + 5;
    assert.equal(
      ROLLBACK.slice(iR, ROLLBACK.indexOf("$$;", iR)),
      CORPO_ANTIGO,
      "byte a byte, linhas com espaco no fim incluidas",
    );
  },
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
      `${falhas.length} de ${PROVAS.length} provas da media de avaliacoes so-admin falharam.`,
    );
  }
  console.log(
    `\n[media-de-avaliacoes-so-admin] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));

"use strict";

/**
 * Prova VIVA da migration 20261223000000 (o voto "util" so vale em avaliacao que o publico ve: o corpo de
 * `increment_helpful` passa a exigir `reviews.status = 'publicada'`; decisao do dono, 14/10/2026), num
 * Postgres EFEMERO local, sem rede, com os papeis de verdade (anon, authenticated, service_role).
 *
 * Cada caso roda numa transacao que termina em ROLLBACK (o da concorrencia usa duas conexoes reais, grava de
 * verdade e desfaz). O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore pode ou nao ja
 * ter a 20261223 (em CI ela tem), TODO caso comeca pelo estado ANTES, montado com o rollback-manual dela
 * (CREATE OR REPLACE com o corpo antigo, idempotente) e conferido contra o corpo da 20261050000000 LIDO DO
 * ARQUIVO, byte a byte.
 *
 *  ANTES      controle: com o corpo antigo, uma conta logada vota "util" numa avaliacao PENDENTE e o contador sobe
 *             (o defeito); o id inexistente e' no-op silencioso; o visitante ja e' recusado (42501, a 20261221).
 *  DEPOIS     anon = 42501 (antes do corpo); sem auth.uid() vale a excecao de login de antes; avaliacao PUBLICADA:
 *             o voto conta (+1, uma linha em review_votes), o segundo voto do mesmo usuario e' no-op sem excecao,
 *             outro usuario soma, o autor vota na propria publicada; avaliacao PENDENTE (do autor, de outro
 *             usuario, do admin) e id INEXISTENTE (inclui a avaliacao recusada = apagada): a MESMA excecao (mesmo
 *             codigo P0001, mesma mensagem) e NADA gravado (nem voto, nem contador); o CHECK barra 'recusada'.
 *  DADOS      o que ja existia antes da migration (votos e contadores, inclusive em avaliacao pendente) NAO muda;
 *             a memoria do voto numa avaliacao publicada sobrevive (o segundo voto segue sendo no-op).
 *  SO O CORPO so o corpo dessa funcao muda (nenhuma outra funcao, nenhuma tabela, nenhuma ACL), o oid e a ACL da
 *             funcao ficam, e o corpo novo = o antigo com a checagem de inexistente TROCADA pela guarda no mesmo lugar (byte a byte).
 *  MUTANTES   o mesmo comportamento esperado, rodado sobre corpos sabotados (sem a guarda, guarda invertida,
 *             guarda que so avisa, guarda que so olha a existencia, guarda depois do UPDATE), FICA VERMELHO: o
 *             comportamento esperado DISTINGUE o corpo certo de cada sabotagem.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve o `prosrc` IDENTICO (mesmo md5) sem tocar
 *             a ACL (nunca abre anon nem PUBLIC), a ida e volta termina igual; o pre-voo recusa SEM escrever
 *             (corpo desconhecido, atributo diferente, sobrecarga, funcao ausente, review_votes ou reviews.status
 *             ausentes, dono sem SELECT em reviews, ACL aberta ou sem a 20261221); as conferencias finais, rodadas
 *             sobre estados ruins, recusam.
 *  CONCORRENCIA uma chamada em voo nao segura o apply, e depois do commit a MESMA conexao, em transacao nova, ja
 *             responde pelo corpo novo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/voto-util-so-em-avaliacao-publica-viva.cjs
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
const ARQ = "20261223000000_o_voto_util_so_em_avaliacao_que_o_publico_ve.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** O corpo de um arquivo de migration: do `AS $function$` ao `$function$;`. */
const corpoDe = (sql) => {
  const i = sql.indexOf("AS $function$") + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
};

// O corpo ANTIGO e' o da 20261050000000, LIDO DO ARQUIVO, nunca copiado para ca.
const CORPO_ANTIGO = corpoDe(
  fs.readFileSync(
    path.join(
      MIGRATIONS,
      "20261050000000_o_voto_util_tem_memoria_no_servidor.sql",
    ),
    "utf8",
  ),
);
const H_ANTIGO = "25931ffa61160aa410e265f29c23532d";
assert.equal(md5(CORPO_ANTIGO), H_ANTIGO, "o corpo da 20261050000000 mudou");
const CORPO_NOVO = corpoDe(MIGRATION);
const H_NOVO = md5(CORPO_NOVO);
const GUARDA = CORPO_NOVO.slice(
  CORPO_NOVO.indexOf("    -- Só avaliação que o PÚBLICO VÊ"),
  CORPO_NOVO.indexOf(
    "    END IF;\n\n",
    CORPO_NOVO.indexOf("RAISE EXCEPTION 'Avaliação"),
  ) + "    END IF;\n\n".length,
);
assert.ok(GUARDA.includes("status = 'publicada'"), "a guarda foi extraida");
// A guarda TROCA, no mesmo lugar, a antiga checagem "inexistente = RETURN em silencio" (nada empilhado).
const BLOCO_ANTIGO =
  "    -- Avaliação inexistente: no-op silencioso, o MESMO contrato do corpo\n" +
  "    -- antigo (o UPDATE sem linha não fazia nada) — não deixa a FK violar\n" +
  "    -- onde antes não violava.\n" +
  "    IF NOT EXISTS (\n" +
  "        SELECT 1 FROM public.reviews WHERE id = v_review_id\n" +
  "    ) THEN\n" +
  "        RETURN;\n" +
  "    END IF;\n\n";
assert.equal(CORPO_ANTIGO.split(BLOCO_ANTIGO).length - 1, 1);
assert.equal(CORPO_NOVO.replace(GUARDA, BLOCO_ANTIGO), CORPO_ANTIGO);
assert.equal(CORPO_ANTIGO.replace(BLOCO_ANTIGO, GUARDA), CORPO_NOVO);

const FN = "public.increment_helpful(uuid)";
const SQL_VOTO = "SELECT public.increment_helpful($1::uuid)";
const MSG_GUARDA = /^Avaliação não encontrada\.$/;
const MSG_LOGIN = /Acesso negado: usuário não autenticado/;

// A ACL que a 20261221 deixa; a da 23 e' a MESMA (CREATE OR REPLACE nao a toca).
const ACL_FECHADA = [
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];

const U = {
  admin: "7e7e2230-0000-4000-8000-0000000000a1",
  autor1: "7e7e2230-0000-4000-8000-0000000000d4",
  autor2: "7e7e2230-0000-4000-8000-0000000000d5",
  autor3: "7e7e2230-0000-4000-8000-0000000000d6",
  voto1: "7e7e2230-0000-4000-8000-0000000000e7",
  voto2: "7e7e2230-0000-4000-8000-0000000000e8",
};
const PROD = "7e7e2230-0000-4000-8000-0000000000f0";
const R = {
  pub: "7e7e2230-0000-4000-8000-0000000000f1", // publicada, autor1
  pend: "7e7e2230-0000-4000-8000-0000000000f2", // pendente, autor2
  pub2: "7e7e2230-0000-4000-8000-0000000000f3", // publicada, autor3
  nada: "7e7e2230-0000-4000-8000-0000000000f9", // nao existe
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita, ja no estado ANTES (o rollback-manual da 20261223). */
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

/** O voto de `uid` (authenticated, auth.uid() = uid) na avaliacao `id`. */
const votar = (uid, id, extra = {}) =>
  tentar("authenticated", SQL_VOTO, [id], { uid, ...extra });

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
            (SELECT coalesce(md5(string_agg(v::text, '|' ORDER BY v.id::text)), '') FROM public.review_votes v) AS votos,
            (SELECT count(*)::int FROM public.review_votes) AS n_votos`,
  );
  return r.rows[0];
}

/** Contador e numero de votos de UMA avaliacao (lido como dono, por cima da RLS). */
async function situacao(id) {
  const r = await C.query(
    `SELECT (SELECT helpful FROM public.reviews WHERE id = $1) AS helpful,
            (SELECT count(*)::int FROM public.review_votes WHERE review_id = $1) AS votos`,
    [id],
  );
  return { helpful: r.rows[0].helpful, votos: r.rows[0].votos };
}

/** Pessoas e avaliacoes (duas publicadas e uma pendente) dentro da transacao do caso. */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@23.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 23', 'admin'), ($2, 'Marina Autora', 'customer'), ($3, 'Autor Dois', 'customer'),
       ($4, 'Autor Tres', 'customer')`,
    [U.admin, U.autor1, U.autor2, U.autor3],
  );
  await C.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
    [U.admin],
  );
  await C.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta Azul 23', 100, 10, true, 40)",
    [PROD],
  );
  await C.query(
    `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES
       ($1, $4, $5, 5, 'otimo produto', 'publicada'),
       ($2, $4, $6, 2, 'chegou amassado', 'pendente'),
       ($3, $4, $7, 4, 'bom', 'publicada')`,
    [R.pub, R.pend, R.pub2, PROD, U.autor1, U.autor2, U.autor3],
  );
  const n = (await C.query("SELECT count(*)::int AS n FROM public.reviews"))
    .rows[0].n;
  assert.equal(n, 3, "fixtures: so as 3 avaliacoes da prova existem");
  assert.deepEqual(await situacao(R.pub), { helpful: 0, votos: 0 });
  assert.deepEqual(await situacao(R.pend), { helpful: 0, votos: 0 });
}

/**
 * O COMPORTAMENTO que a migration promete, sobre o corpo que estiver vivo (precisa das fixtures de `semear`).
 * Levanta (assert) se qualquer parte falhar; devolve as mensagens para o chamador comparar.
 */
async function comportamentoEsperado() {
  // PUBLICADA: o voto conta uma vez, o segundo do mesmo usuario e' no-op SEM excecao, outro usuario soma
  const v1 = await votar(U.voto1, R.pub);
  assert.ok(v1.linhas, `voto em publicada recusado: ${v1.erro}`);
  assert.deepEqual(await situacao(R.pub), { helpful: 1, votos: 1 });
  const v1b = await votar(U.voto1, R.pub);
  assert.ok(v1b.linhas, `o segundo voto devia ser no-op: ${v1b.erro}`);
  assert.deepEqual(await situacao(R.pub), { helpful: 1, votos: 1 });
  const v2 = await votar(U.voto2, R.pub);
  assert.ok(v2.linhas, v2.erro);
  assert.deepEqual(await situacao(R.pub), { helpful: 2, votos: 2 });
  // o autor vota na propria publicada (a regra de antes nao muda)
  const proprio = await votar(U.autor1, R.pub);
  assert.ok(proprio.linhas, `autor na propria publicada: ${proprio.erro}`);
  assert.deepEqual(await situacao(R.pub), { helpful: 3, votos: 3 });

  // PENDENTE: a excecao da guarda e NADA gravado, de quem for
  const antes = await retratoDosDados();
  const mensagens = [];
  for (const [rotulo, uid, extra] of [
    ["outro usuario", U.voto1, {}],
    ["o proprio autor", U.autor2, {}],
    ["admin pelo JWT", U.admin, { claims: JWT_ADMIN }],
  ]) {
    const r = await votar(uid, R.pend, extra);
    assert.ok(!r.linhas, `${rotulo}: o voto em pendente devia ser recusado`);
    assert.equal(r.codigo, "P0001", `${rotulo}: ${r.erro}`);
    assert.match(r.erro, MSG_GUARDA, rotulo);
    mensagens.push(r);
  }
  // INEXISTENTE: a MESMA excecao, com a mesma mensagem (nao vaza se o id existe)
  const x = await votar(U.voto1, R.nada);
  assert.ok(!x.linhas, "inexistente devia ser recusado");
  assert.equal(x.codigo, mensagens[0].codigo);
  assert.equal(
    x.erro,
    mensagens[0].erro,
    "mesma mensagem para pendente e inexistente",
  );
  assert.deepEqual(await retratoDosDados(), antes, "recusa nao grava nada");
  assert.deepEqual(await situacao(R.pend), { helpful: 0, votos: 0 });
  return mensagens;
}

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------

prova(
  "ANTES: com o corpo antigo (o da 20261050000000, byte a byte) o logado vota numa avaliacao PENDENTE e o contador sobe (o defeito); inexistente e' no-op silencioso; o visitante ja e' recusado (42501)",
  () =>
    emTransacao(async () => {
      assert.equal(
        await prosrcVivo(),
        CORPO_ANTIGO,
        "prosrc identico ao da 20261050000000",
      );
      assert.deepEqual(await acl(), ACL_FECHADA);
      await semear();
      const pend = await votar(U.voto1, R.pend);
      assert.ok(
        pend.linhas,
        `o defeito: o voto em pendente devia passar. ${pend.erro}`,
      );
      assert.deepEqual(await situacao(R.pend), { helpful: 1, votos: 1 });
      const nada = await votar(U.voto1, R.nada);
      assert.ok(nada.linhas, `inexistente era no-op silencioso: ${nada.erro}`);
      const anon = await tentar("anon", SQL_VOTO, [R.pub]);
      assert.equal(anon.codigo, "42501", anon.erro);
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: anon = 42501 (antes do corpo, nada gravado); sem auth.uid() (authenticated sem sub, service_role sem sub) vale a excecao de login de antes, que vem ANTES da guarda nova",
  () =>
    emTransacao(async () => {
      await semear();
      assert.equal(await aplicar(MIGRATION), null);
      const antes = await retratoDosDados();
      for (const id of [R.pub, R.pend, R.nada]) {
        const anon = await tentar("anon", SQL_VOTO, [id]);
        assert.equal(anon.codigo, "42501", anon.erro);
        for (const papel of ["authenticated", "service_role"]) {
          const r = await tentar(papel, SQL_VOTO, [id], {});
          assert.equal(r.codigo, "P0001", `${papel}: ${r.erro}`);
          assert.match(r.erro, MSG_LOGIN, `${papel} ${id}`);
        }
      }
      assert.deepEqual(await retratoDosDados(), antes);
    }),
);

prova(
  "DEPOIS: o comportamento esperado vale com o corpo novo — publicada vota (+1 uma vez, no-op no segundo, outro soma, o autor vota na propria), pendente (de quem for) e inexistente levantam a MESMA excecao e nada e gravado",
  () =>
    emTransacao(async () => {
      await semear();
      assert.equal(await aplicar(MIGRATION), null);
      await comportamentoEsperado();
    }),
);

prova(
  "DEPOIS: service_role com auth.uid() vota em publicada como o corpo manda e e' recusado em pendente; a recusa do painel (apagar) e o CHECK: avaliacao apagada vira 'inexistente' (a mesma excecao) e 'recusada' nao e' status possivel",
  () =>
    emTransacao(async () => {
      await semear();
      assert.equal(await aplicar(MIGRATION), null);
      const s = await tentar("service_role", SQL_VOTO, [R.pub], {
        uid: U.voto1,
      });
      assert.ok(s.linhas, s.erro);
      assert.deepEqual(await situacao(R.pub), { helpful: 1, votos: 1 });
      const sp = await tentar("service_role", SQL_VOTO, [R.pend], {
        uid: U.voto1,
      });
      assert.equal(sp.codigo, "P0001");
      assert.match(sp.erro, MSG_GUARDA);
      // 'recusada' nao existe como status: o CHECK barra (a recusa do painel e' APAGAR)
      await C.query("SAVEPOINT chk");
      await assert.rejects(
        () =>
          C.query(
            "UPDATE public.reviews SET status = 'recusada' WHERE id = $1",
            [R.pend],
          ),
        (e) => e.code === "23514" && /reviews_status_check/.test(e.message),
      );
      await C.query("ROLLBACK TO SAVEPOINT chk");
      // apagar = recusar: o id passa a ser inexistente, a mesma excecao de sempre (e os votos caem em cascata)
      await C.query("DELETE FROM public.reviews WHERE id = $1", [R.pub]);
      assert.deepEqual(await situacao(R.pub), { helpful: null, votos: 0 });
      const apagada = await votar(U.voto2, R.pub);
      assert.equal(apagada.codigo, "P0001");
      assert.match(apagada.erro, MSG_GUARDA);
      // a avaliacao que passa de pendente a publicada (o admin aprova) passa a aceitar o voto
      await C.query(
        "UPDATE public.reviews SET status = 'publicada' WHERE id = $1",
        [R.pend],
      );
      const aprovada = await votar(U.voto2, R.pend);
      assert.ok(aprovada.linhas, aprovada.erro);
      assert.deepEqual(await situacao(R.pend), { helpful: 1, votos: 1 });
    }),
);

prova(
  "DEPOIS (dado que ja existia): votos e contadores gravados ANTES da migration (inclusive em avaliacao pendente) ficam como estao; a memoria do voto numa avaliacao publicada sobrevive (o segundo voto segue no-op); quem ja votara numa pendente agora recebe a excecao",
  () =>
    emTransacao(async () => {
      await semear();
      // com o corpo ANTIGO: um voto em publicada e um em pendente (o defeito deixa linha e contador)
      assert.ok((await votar(U.voto1, R.pub)).linhas);
      assert.ok((await votar(U.voto1, R.pend)).linhas);
      assert.deepEqual(await situacao(R.pub), { helpful: 1, votos: 1 });
      assert.deepEqual(await situacao(R.pend), { helpful: 1, votos: 1 });
      const dadosAntes = await retratoDosDados();
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(
        await retratoDosDados(),
        dadosAntes,
        "o apply nao toca dado",
      );
      // a memoria sobreviveu: o segundo voto na publicada e' no-op, SEM excecao
      const dup = await votar(U.voto1, R.pub);
      assert.ok(dup.linhas, dup.erro);
      assert.deepEqual(await situacao(R.pub), { helpful: 1, votos: 1 });
      // na pendente que ja tinha voto: excecao (nao e' no-op), e o dado velho fica
      const pend = await votar(U.voto1, R.pend);
      assert.equal(pend.codigo, "P0001", pend.erro);
      assert.match(pend.erro, MSG_GUARDA);
      assert.deepEqual(await situacao(R.pend), { helpful: 1, votos: 1 });
      assert.deepEqual(await retratoDosDados(), dadosAntes);
    }),
);

prova(
  "DEPOIS: so o CORPO dessa funcao mudou (nenhuma outra funcao, nenhuma tabela, nenhuma ACL), o oid e a ACL ficam e nenhuma linha de avaliacao ou voto muda; o corpo novo = o antigo com um bloco trocado, byte a byte",
  () =>
    emTransacao(async () => {
      await semear();
      assert.ok((await votar(U.voto1, R.pub)).linhas);
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
      assert.deepEqual(mudaram, ["increment_helpful(uuid)"]);
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
      // o corpo novo = o antigo com UM bloco trocado no mesmo lugar (a guarda no lugar da checagem de inexistente)
      const novo = await prosrcVivo();
      assert.equal(novo, CORPO_NOVO);
      assert.equal(novo.replace(GUARDA, BLOCO_ANTIGO), CORPO_ANTIGO);
      assert.equal(md5(novo), H_NOVO);
    }),
);

// ---------------------------------------------------------------------------
// MUTANTES: o comportamento esperado tem de FICAR VERMELHO sobre cada sabotagem
// ---------------------------------------------------------------------------

const recriar = (corpo) =>
  `CREATE OR REPLACE FUNCTION public.increment_helpful(review_id uuid)
     RETURNS void
     LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
   AS $x$${corpo}$x$`;

/** Tira a guarda do corpo novo e a poe de volta onde `onde` mandar (a partir do corpo ANTIGO). */
const comGuardaEm = (ancora, antesOuDepois, guarda = GUARDA) => {
  const i = CORPO_ANTIGO.indexOf(ancora);
  assert.ok(i >= 0, `ancora ausente: ${ancora}`);
  const corte = antesOuDepois === "depois" ? i + ancora.length : i;
  return CORPO_ANTIGO.slice(0, corte) + guarda + CORPO_ANTIGO.slice(corte);
};

const MUTANTES = [
  ["sem a guarda (o corpo antigo)", CORPO_ANTIGO],
  [
    "guarda invertida (status <> 'publicada')",
    CORPO_NOVO.replace("AND status = 'publicada'", "AND status <> 'publicada'"),
  ],
  [
    "guarda que so avisa e volta em silencio (RETURN no lugar da excecao)",
    CORPO_NOVO.replace(
      "RAISE EXCEPTION 'Avaliação não encontrada.';",
      "RETURN;",
    ),
  ],
  [
    "guarda que so olha a existencia (ignora o status)",
    CORPO_NOVO.replace("AND status = 'publicada'", "AND status IS NOT NULL"),
  ],
  [
    "guarda DEPOIS do UPDATE (o contador sobe antes de a excecao abortar)",
    comGuardaEm("     WHERE id = v_review_id;\n", "depois"),
  ],
  [
    "mensagem diferente para o inexistente (vaza se o id existe)",
    CORPO_NOVO.replace(
      GUARDA,
      `    IF NOT EXISTS (\n        SELECT 1 FROM public.reviews WHERE id = v_review_id\n    ) THEN\n        RAISE EXCEPTION 'Avaliação inexistente.';\n    END IF;\n\n${GUARDA}`,
    ),
  ],
];

prova(
  "MUTANTES: o comportamento esperado passa no corpo real e FICA VERMELHO sobre cada sabotagem (sem guarda, invertida, so avisa, so existencia, depois do UPDATE, mensagem que vaza); todo mutante difere do corpo real por md5",
  async () => {
    for (const [rotulo, corpo] of MUTANTES) {
      assert.notEqual(corpo, CORPO_NOVO, `${rotulo}: o mutante nao mudou nada`);
      assert.notEqual(md5(corpo), H_NOVO, rotulo);
    }
    // controle: o corpo real passa (senao um comportamento sempre-vermelho "mataria" qualquer mutante)
    await emTransacao(async () => {
      await semear();
      assert.equal(await aplicar(MIGRATION), null);
      await comportamentoEsperado();
    });
    const vivos = [];
    for (const [rotulo, corpo] of MUTANTES) {
      let vermelho = false;
      await emTransacao(async () => {
        await semear();
        await C.query(recriar(corpo));
        try {
          await comportamentoEsperado();
        } catch (e) {
          vermelho = e instanceof assert.AssertionError;
          if (!vermelho) throw e;
        }
      });
      if (!vermelho) vivos.push(rotulo);
    }
    assert.deepEqual(
      vivos,
      [],
      `mutantes que sobreviveram: ${vivos.join("; ")}`,
    );
  },
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, rollback, pre-voo, conferencia
// ---------------------------------------------------------------------------

prova(
  "MIGRATION: reaplicar (2x) e em CRLF deixa o mesmo estado (hash, ACL, oid); o corpo novo e' reconhecido como segundo estado de entrada",
  () =>
    emTransacao(async () => {
      await semear();
      assert.equal(await aplicar(MIGRATION), null);
      const um = [await hashVivo(), await aclBruto(), await oidVivo()];
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(emCRLF(MIGRATION)), null);
      assert.deepEqual(
        [await hashVivo(), await aclBruto(), await oidVivo()],
        um,
      );
      assert.equal(um[0], H_NOVO);
      assert.deepEqual(await acl(), ACL_FECHADA);
      // a guarda continua valendo depois do CRLF
      await comportamentoEsperado();
    }),
);

prova(
  "MIGRATION: o rollback devolve o prosrc IDENTICO ao da 20261050000000 (mesmo md5) sem tocar a ACL; ida e volta termina igual; rodar o rollback 2x (e em CRLF) nao muda nada; o anon continua fechado; o defeito volta junto",
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
      // depois do rollback o comportamento volta junto: o logado vota na pendente (o defeito), o visitante nao
      assert.equal(await aplicar(ROLLBACK), null);
      await semear();
      const p = await votar(U.voto1, R.pend);
      assert.ok(p.linhas, p.erro);
      assert.deepEqual(await situacao(R.pend), { helpful: 1, votos: 1 });
      const a = await tentar("anon", SQL_VOTO, [R.pub]);
      assert.equal(a.codigo, "42501", a.erro);
    }),
);

prova(
  "MIGRATION: o pre-voo recusa SEM escrever (corpo desconhecido, STABLE, sem SECURITY DEFINER, search_path diferente ou ausente, sobrecarga, funcao ausente, review_votes ausente, reviews.status ausente ou nulavel, dono sem SELECT em reviews, anon aberto, PUBLIC aberto, sem authenticated, sem service_role)",
  () =>
    emTransacao(async () => {
      const corpoAntes = await hashVivo();
      const aclAntes = await aclBruto();
      const casos = [
        [
          "corpo desconhecido (1 byte a mais)",
          /corpo vivo de .* não é nem o antigo/,
          () => C.query(recriar(`${CORPO_ANTIGO} `)),
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
              "CREATE FUNCTION public.increment_helpful(x text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
            ),
        ],
        ["funcao ausente", /não existe/, () => C.query(`DROP FUNCTION ${FN}`)],
        [
          "review_votes ausente",
          /review_votes não existe/,
          () => C.query("DROP TABLE public.review_votes"),
        ],
        [
          "constraint review_votes_um_voto_por_usuario ausente (o ON CONFLICT quebraria na execucao)",
          /constraint review_votes_um_voto_por_usuario não existe/,
          () =>
            C.query(
              "ALTER TABLE public.review_votes DROP CONSTRAINT review_votes_um_voto_por_usuario",
            ),
        ],
        [
          "CHECK reviews_status_check ausente",
          /CHECK reviews_status_check que aceita 'publicada' não existe/,
          () =>
            C.query(
              "ALTER TABLE public.reviews DROP CONSTRAINT reviews_status_check",
            ),
        ],
        [
          "CHECK reviews_status_check que nao aceita 'publicada'",
          /CHECK reviews_status_check que aceita 'publicada' não existe/,
          async () => {
            await C.query(
              "ALTER TABLE public.reviews DROP CONSTRAINT reviews_status_check",
            );
            await C.query(
              "ALTER TABLE public.reviews ADD CONSTRAINT reviews_status_check CHECK (status = 'pendente')",
            );
          },
        ],
        [
          "reviews.status ausente (renomeada)",
          /reviews\.status \(text NOT NULL\) não existe/,
          () =>
            C.query(
              "ALTER TABLE public.reviews RENAME COLUMN status TO status_zz",
            ),
        ],
        [
          "reviews.status aceita NULL",
          /reviews\.status \(text NOT NULL\) não existe/,
          () =>
            C.query(
              "ALTER TABLE public.reviews ALTER COLUMN status DROP NOT NULL",
            ),
        ],
        [
          "dono da funcao sem SELECT em reviews (papel nao-superusuario)",
          /o dono de .* não lê public\.reviews/,
          async () => {
            await C.query("CREATE ROLE zz_dono_223 NOLOGIN NOSUPERUSER");
            await C.query("GRANT CREATE ON SCHEMA public TO zz_dono_223");
            await C.query(`ALTER FUNCTION ${FN} OWNER TO zz_dono_223`);
          },
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
      const conferencia = blocoDo(MIGRATION, "conferencia_20261223");
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(conferencia), null, "estado certo passa");
      const casos = [
        [
          "corpo antigo",
          /conferencia 20261223: corpo vivo .* não é o novo/,
          () => C.query(ROLLBACK),
        ],
        [
          "anon aberto",
          /conferencia 20261223: anon executa/,
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
        ],
        [
          "PUBLIC aberto",
          /conferencia 20261223: .* alcancavel por PUBLIC/,
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
        ],
        [
          "sem authenticated",
          /conferencia 20261223: authenticated perdeu/,
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
        ],
        [
          "sem service_role",
          /conferencia 20261223: service_role perdeu/,
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`),
        ],
        [
          "STABLE",
          /conferencia 20261223: atributos/,
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
              recriar(
                "\nBEGIN\n    IF auth.uid() IS NULL THEN RETURN; END IF;\nEND;\n",
              ),
            ),
        ],
        ["funcao ausente", /não existe/, () => C.query(`DROP FUNCTION ${FN}`)],
        [
          "sobrecarga",
          /sobrecarga/,
          () =>
            C.query(
              "CREATE FUNCTION public.increment_helpful(x text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
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
      const conf = blocoDo(ROLLBACK, "conferencia_rollback_20261223");
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

const IDS_COMMITADOS = async () => {
  await C.query(
    "DELETE FROM public.review_votes WHERE review_id = ANY($1::uuid[])",
    [Object.values(R)],
  );
  await C.query("DELETE FROM public.reviews WHERE id = ANY($1::uuid[])", [
    Object.values(R),
  ]);
  await C.query("DELETE FROM public.produtos WHERE id = $1", [PROD]);
  await C.query("DELETE FROM public.profiles WHERE id = ANY($1::uuid[])", [
    Object.values(U),
  ]);
  await C.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
    Object.values(U),
  ]);
};

prova(
  "CONCORRENCIA: uma chamada em voo (transacao aberta, ja votou numa pendente pelo corpo antigo) nao segura o apply, e depois do commit a MESMA conexao, em transacao nova, ja responde pelo corpo novo (pendente recusada, publicada vota)",
  async () => {
    const B = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await B.connect();
    try {
      await C.query(ROLLBACK); // estado ANTES, commitado
      await semear(); // commitado (sem transacao aberta): a outra conexao precisa enxergar
      await B.query("BEGIN");
      const antes = await como(
        "authenticated",
        SQL_VOTO,
        [R.pend],
        { uid: U.voto1 },
        B,
      );
      assert.equal(
        antes.length,
        1,
        "o logado vota na pendente ANTES do apply (o defeito)",
      );
      // o apply (commit de verdade) nao pode ficar preso atras da transacao do outro
      await C.query("SET statement_timeout = '8s'");
      await C.query(MIGRATION);
      await C.query("RESET statement_timeout");
      assert.equal(await hashVivo(), H_NOVO);
      // A transacao que JA estava em voo pode ainda terminar com o corpo que ja tinha na memoria (limite
      // documentado do Postgres: o catalogo novo so e' visto na fronteira da transacao).
      await B.query("ROLLBACK");
      await B.query("BEGIN");
      await assert.rejects(
        () => como("authenticated", SQL_VOTO, [R.pend], { uid: U.voto1 }, B),
        (e) => e.code === "P0001" && MSG_GUARDA.test(e.message),
      );
      await B.query("ROLLBACK");
      await B.query("BEGIN");
      const publicada = await como(
        "authenticated",
        SQL_VOTO,
        [R.pub],
        { uid: U.voto1 },
        B,
      );
      assert.equal(publicada.length, 1);
      await B.query("ROLLBACK");
    } finally {
      await B.query("ROLLBACK").catch(() => {});
      await B.end().catch(() => {});
      await C.query("RESET statement_timeout").catch(() => {});
      await IDS_COMMITADOS().catch(() => {});
      await C.query(MIGRATION).catch(() => {}); // devolve a arvore ao estado migrado
    }
  },
);

prova(
  "ARQUIVO: o corpo novo da migration tem o md5 que o pre-voo e a conferencia declaram, e o do rollback e' o da 20261050000000",
  async () => {
    assert.ok(
      MIGRATION.split(H_NOVO).length - 1 >= 2,
      "o hash novo aparece no pre-voo e na conferencia",
    );
    assert.ok(MIGRATION.includes(H_ANTIGO));
    assert.ok(ROLLBACK.includes(H_ANTIGO) && ROLLBACK.includes(H_NOVO));
    assert.equal(md5(corpoDe(ROLLBACK).replace(/\r/g, "")), H_ANTIGO);
    assert.equal(corpoDe(ROLLBACK), CORPO_ANTIGO, "byte a byte");
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
      `${falhas.length} de ${PROVAS.length} provas do voto util so em avaliacao publica falharam.`,
    );
  }
  console.log(
    `\n[voto-util-so-em-avaliacao-publica] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));

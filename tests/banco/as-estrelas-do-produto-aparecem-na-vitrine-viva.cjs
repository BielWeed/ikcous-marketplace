"use strict";

/**
 * Prova VIVA da migration 20261399500000 (as estrelas do produto aparecem na vitrine: um gatilho AFTER em `reviews`
 * recalcula `produtos.rating` e `produtos.review_count` so das avaliacoes PUBLICADAS), num Postgres EFEMERO local, sem
 * rede, com os papeis de verdade (anon, authenticated, service_role).
 *
 * Os casos de comportamento rodam numa transacao que termina em ROLLBACK. Os de CONCORRENCIA usam conexoes reais com
 * COMMIT (fixtures committadas, apagadas no fim): o clone do rodar-isolado.cjs e' descartavel. Como a arvore pode ou nao
 * ja ter a 20261399500000 (em CI ela tem), os casos do estado ANTES montam esse estado com o rollback-manual dela.
 *
 *  ANTES      controle: sem o gatilho a avaliacao publicada nao mexe na nota do produto (o defeito); o COMPORTAMENTO
 *             ESPERADO desta prova REPROVA nesse estado.
 *  DEPOIS     pendente nao conta; aprovar, editar a nota, despublicar, excluir e trocar de produto recalculam; a ultima
 *             publicada que sai devolve 5 / 0; multi-linha; produto de controle intocado; a aprovacao feita por um
 *             administrador SEM privilegio em `produtos` (authenticated) funciona (SECURITY DEFINER); gravacao de coluna
 *             alheia (helpful, verified) nao escreve o produto.
 *  BORDA      a falha do gatilho (CHECK em produtos) NAO perde a avaliacao e a transacao segue viva; o proximo evento
 *             recalcula do zero e conserta; produto com avaliacao antiga (antes do apply) so e' recalculado no proximo evento.
 *  DADOS      o apply nao escreve em `produtos` nem em `reviews` (hash identico antes e depois, inclusive o produto
 *             com avaliacoes antigas e nota padrao); SO NOVO: funcoes, tabelas, policies e gatilhos irmaos intactos.
 *  MUTANTES   o mesmo comportamento esperado, rodado sobre corpos/gatilhos sabotados, FICA VERMELHO (e as sabotagens da
 *             concorrencia, rodadas com COMMIT: sem a trava do produto, sem a ordem global, sem o lock_timeout, sem o UPDATE OF).
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback apaga os DOIS objetos sem tocar dado nem os gatilhos irmaos,
 *             rodar de novo e' no-op, ida e volta termina igual; o pre-voo recusa SEM escrever; a conferencia final recusa
 *             estado ruim; o pre-voo do rollback recusa o que nao e' dele; consultas 121a/121b nos dois estados.
 *  CONCORRENCIA duas avaliacoes do mesmo produto ao mesmo tempo (nenhuma se perde da conta); trocas cruzadas de produto;
 *             compra segurando o produto (a nota espera 500 ms e desiste, a avaliacao fica); a compra NUNCA e' a vitima do
 *             deadlock; gravacao de coluna alheia nao espera produto; apply esperando gravacao em voo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/as-estrelas-do-produto-aparecem-na-vitrine-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (as migrations e as consultas), nunca de entrada de rede. */

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
const ARQ = "20261399500000_as_estrelas_do_produto_aparecem_na_vitrine.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const CONSULTAS = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "publicacao",
  "consultas",
);
const SQL_121A = fs.readFileSync(
  path.join(
    CONSULTAS,
    "121a-conferir-as-estrelas-do-produto-aparecem-na-vitrine-aplicado.sql",
  ),
  "utf8",
);
const SQL_121B = fs.readFileSync(
  path.join(
    CONSULTAS,
    "121b-antes-as-estrelas-do-produto-aparecem-na-vitrine-ausente.sql",
  ),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** O corpo de um arquivo de migration: do `AS $function$` ao `$function$;`. */
const corpoDe = (sql) => {
  const i = sql.indexOf("AS $function$") + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
};
const CORPO = corpoDe(MIGRATION);
const H_CORPO = md5(CORPO);

const FN = "public.avaliacao_atualiza_a_nota_do_produto()";
const GATILHO = "tr_avaliacao_atualiza_a_nota_do_produto";
const DEF_GATILHO =
  "AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id ON public.reviews FOR EACH ROW";
const TZ = "SET LOCAL TIME ZONE 'UTC'";

const uid = (n) => `7e7e2113-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = uid(1);
const PRODS = { P1: uid(901), P2: uid(902), P3: uid(903) };
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});

let C;
const AVISOS = [];
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uma transacao por caso, sempre desfeita; `antes` monta o estado ANTES (rollback-manual). */
async function emTransacao(fn, { antes = false } = {}) {
  await C.query("BEGIN");
  try {
    await C.query(TZ);
    if (antes) {
      await C.query(ROLLBACK);
      assert.equal(await funcaoExiste(), false, "o estado ANTES nao montou");
      assert.equal(await gatilhoExiste(), false, "o gatilho devia sumir");
    } else {
      await C.query(MIGRATION);
      assert.equal(await hashVivo(), H_CORPO, "o estado DEPOIS nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel` (null = sessao direta), com o JWT e o auth.uid() pedidos. */
async function como(papel, sql, params = [], { id = "", claims = "" } = {}) {
  await C.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [id, claims],
  );
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
  }
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo}. */
async function tentar(papel, sql, params = [], ident = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, ident);
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

const funcaoExiste = async () =>
  (await C.query("SELECT to_regprocedure($1) IS NOT NULL AS x", [FN])).rows[0]
    .x;
const gatilhoExiste = async () =>
  (
    await C.query(
      "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = $1) AS x",
      [GATILHO],
    )
  ).rows[0].x;
const hashVivo = async () =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.h;
const oidVivo = async () =>
  (await C.query("SELECT to_regprocedure($1)::oid::text AS o", [FN])).rows[0].o;
const aclFuncao = async () =>
  (
    await C.query(
      "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0].a;
const gatilhoDef = async () =>
  (
    await C.query(
      `SELECT tgrelid::regclass::text AS tabela, tgtype, tgenabled, tgfoid::regproc::text AS funcao,
              tgqual IS NULL AS sem_when, tgnargs, tgattr::text AS colunas, oid::text AS oid
         FROM pg_trigger WHERE tgname = $1`,
      [GATILHO],
    )
  ).rows;

/** Funcoes e tabelas (corpo e ACL), policies e gatilhos: o que a migration nao pode tocar. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl,
              md5(p.prosrc) AS corpo, p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname <> 'avaliacao_atualiza_a_nota_do_produto' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  const policies = (
    await C.query(
      `SELECT polrelid::regclass::text AS t, polname, polcmd, polroles::text AS roles,
              pg_get_expr(polqual, polrelid) AS q, pg_get_expr(polwithcheck, polrelid) AS wc
         FROM pg_policy WHERE polrelid IN ('public.reviews'::regclass, 'public.produtos'::regclass) ORDER BY 1, 2`,
    )
  ).rows;
  const gatilhos = (
    await C.query(
      `SELECT tgrelid::regclass::text AS t, tgname, tgtype, tgenabled FROM pg_trigger
        WHERE tgrelid IN ('public.reviews'::regclass, 'public.produtos'::regclass)
          AND NOT tgisinternal AND tgname <> $1 ORDER BY 1, 2`,
      [GATILHO],
    )
  ).rows;
  return { funcoes, tabelas, policies, gatilhos };
}

/** O conteudo inteiro de avaliacoes e produtos, byte a byte (hash). */
async function retratoDosDados() {
  const r = await C.query(
    `SELECT (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.reviews x) AS avaliacoes,
            (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.produtos x) AS produtos`,
  );
  return r.rows[0];
}

/** Pessoas e produtos da prova (em transacao; o ROLLBACK leva tudo). */
async function semear(nAutores = 8) {
  await C.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) SELECT uid, uid::text || '@121.teste', '{}'::jsonb FROM unnest($1::uuid[]) AS uid",
    [[ADMIN, ...Array.from({ length: nAutores }, (_, i) => uid(10 + i))]],
  );
  await C.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin 121', 'admin')",
    [ADMIN],
  );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role)
     SELECT uid, 'Autora ' || uid::text, 'customer' FROM unnest($1::uuid[]) AS uid`,
    [Array.from({ length: nAutores }, (_, i) => uid(10 + i))],
  );
  await C.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
    [ADMIN],
  );
  for (const [nome, id] of Object.entries(PRODS))
    await C.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, $2, 100, 10, true, 40)",
      [id, `Produto ${nome} 121`],
    );
}
const autora = (n) => uid(10 + n);

const nota = async (p) =>
  (
    await C.query(
      "SELECT rating::float8 AS rating, review_count, ctid::text AS ct FROM public.produtos WHERE id = $1",
      [p],
    )
  ).rows[0];
const par = async (p) => {
  const n = await nota(p);
  return [n.rating, n.review_count];
};

const SQL_INS = `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
  VALUES ($1::uuid, $2::uuid, $3::int, 'ok', $4) RETURNING id`;
const comoCliente = (n, produto, rating) =>
  como("authenticated", SQL_INS, [produto, autora(n), rating, "pendente"], {
    id: autora(n),
  }).then((r) => r[0].id);
const comoAdmin = (sql, params) =>
  como("authenticated", sql, params, { id: ADMIN, claims: JWT_ADMIN });
const publicar = (id) =>
  comoAdmin("UPDATE public.reviews SET status = 'publicada' WHERE id = $1", [
    id,
  ]);

/**
 * O comportamento que a migration promete, em ordem. Cada afirmacao leva um rotulo [X]: os mutantes sao
 * medidos pelo rotulo que os derruba. Roda no estado DEPOIS (ou sabotado), dentro de uma transacao.
 */
async function comportamentoEsperado() {
  await semear();
  const { P1, P2, P3 } = PRODS;
  const ct3 = (await nota(P3)).ct;

  // [A] pendente que nasce (cliente, authenticated) nao conta e nem escreve o produto
  const ct1 = (await nota(P1)).ct;
  const r1 = await comoCliente(0, P1, 5);
  assert.deepEqual(await par(P1), [5, 0], "[A] pendente contou na nota");
  assert.equal((await nota(P1)).ct, ct1, "[A] pendente escreveu o produto");

  // [B] aprovar (administrador, authenticated, SEM privilegio em produtos) conta: 1 avaliacao, nota 5
  await publicar(r1);
  assert.deepEqual(await par(P1), [5, 1], "[B] aprovar nao atualizou a nota");

  // [C] segunda publicada, nota 2: media 3.5
  const r2 = await comoCliente(1, P1, 2);
  await publicar(r2);
  assert.deepEqual(await par(P1), [3.5, 2], "[C] segunda publicada");

  // [D] terceira, nota 4: 11/3 = 3.666... -> 3.7 (1 casa decimal)
  const r3 = await comoCliente(2, P1, 4);
  await publicar(r3);
  assert.deepEqual(await par(P1), [3.7, 3], "[D] arredondamento a 1 casa");

  // [E] pendente ao lado nao conta e nao escreve
  const ctE = (await nota(P1)).ct;
  const r4 = await comoCliente(3, P1, 1);
  assert.deepEqual(await par(P1), [3.7, 3], "[E] pendente ao lado contou");
  assert.equal((await nota(P1)).ct, ctE, "[E] pendente ao lado escreveu");

  // [F] a nota de uma publicada muda (2 -> 5): (5+5+4)/3 = 4.666 -> 4.7
  await comoAdmin("UPDATE public.reviews SET rating = 5 WHERE id = $1", [r2]);
  assert.deepEqual(await par(P1), [4.7, 3], "[F] editar a nota nao recalculou");

  // [G] despublicar (publicada -> pendente) desconta: (5+4)/2 = 4.5
  await comoAdmin(
    "UPDATE public.reviews SET status = 'pendente' WHERE id = $1",
    [r1],
  );
  assert.deepEqual(await par(P1), [4.5, 2], "[G] despublicar nao descontou");

  // [H] excluir publicada desconta; excluir pendente nao escreve
  await comoAdmin("DELETE FROM public.reviews WHERE id = $1", [r3]);
  assert.deepEqual(
    await par(P1),
    [5, 1],
    "[H] excluir publicada nao descontou",
  );
  const ctH = (await nota(P1)).ct;
  await comoAdmin("DELETE FROM public.reviews WHERE id = $1", [r4]);
  assert.equal(
    (await nota(P1)).ct,
    ctH,
    "[H] excluir pendente escreveu o produto",
  );

  // [K] coluna alheia (helpful, verified, resposta da loja) nao escreve o produto
  const ctK = (await nota(P1)).ct;
  await C.query(
    "UPDATE public.reviews SET helpful = 3, verified = true, merchant_reply = 'obrigada' WHERE id = $1",
    [r2],
  );
  assert.equal(
    (await nota(P1)).ct,
    ctK,
    "[K] coluna alheia escreveu o produto",
  );

  // [I] a avaliacao publicada troca de produto: o antigo perde, o novo ganha
  await comoAdmin("UPDATE public.reviews SET product_id = $2 WHERE id = $1", [
    r2,
    P2,
  ]);
  assert.deepEqual(
    await par(P1),
    [5, 0],
    "[I] o produto antigo nao perdeu a avaliacao",
  );
  assert.deepEqual(
    await par(P2),
    [5, 1],
    "[I] o produto novo nao ganhou a avaliacao",
  );

  // [J] a ultima publicada sai: volta a 5 / 0 (o estado de quem nunca foi avaliado)
  await comoAdmin("DELETE FROM public.reviews WHERE id = $1", [r2]);
  assert.deepEqual(
    await par(P2),
    [5, 0],
    "[J] sem avaliacao publicada nao voltou a 5 / 0",
  );

  // [L] varias linhas num comando so (publicadas, gravacao direta do dono)
  await C.query(
    `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
     VALUES ($1, $2, 3, 'a', 'publicada'), ($1, $3, 4, 'b', 'publicada')`,
    [P1, autora(4), autora(5)],
  );
  assert.deepEqual(await par(P1), [3.5, 2], "[L] insert de varias linhas");

  // [N] gravacao direta ja publicada (servidor)
  await C.query(SQL_INS, [P1, autora(6), 5, "publicada"]);
  assert.deepEqual(await par(P1), [4, 3], "[N] insert direto publicado");

  // [O] quem grava a avaliacao SEM privilegio algum em produtos (rotina de servidor, cascata de outro papel): a nota
  //     muda do mesmo jeito -- e' o SECURITY DEFINER que faz isso, nao a sorte do papel de quem chama
  await C.query("CREATE ROLE r13_operador NOLOGIN BYPASSRLS");
  await C.query("GRANT USAGE ON SCHEMA public TO r13_operador");
  await C.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO r13_operador",
  );
  const rO = (await C.query(SQL_INS, [P2, autora(7), 2, "pendente"])).rows[0]
    .id;
  await como(
    "r13_operador",
    "UPDATE public.reviews SET status = 'publicada' WHERE id = $1",
    [rO],
  );
  assert.deepEqual(
    await par(P2),
    [2, 1],
    "[O] papel sem privilegio em produtos nao atualizou a nota",
  );
  await como("r13_operador", "DELETE FROM public.reviews WHERE id = $1", [rO]);
  assert.deepEqual(
    await par(P2),
    [5, 0],
    "[O] papel sem privilegio em produtos nao descontou a nota",
  );

  // [M] o produto de controle nunca foi tocado
  assert.equal((await nota(P3)).ct, ct3, "[M] produto de controle foi escrito");
  assert.deepEqual(await par(P3), [5, 0], "[M] produto de controle mudou");
}

// ---------------------------------------------------------------------------
// ANTES / DEPOIS
// ---------------------------------------------------------------------------

prova(
  "ANTES (controle): sem o gatilho o comportamento esperado REPROVA (o defeito: avaliacao publicada nao mexe na nota)",
  () =>
    emTransacao(
      async () => {
        await assert.rejects(
          () => comportamentoEsperado(),
          /\[B\] aprovar nao atualizou a nota/,
        );
        // e o defeito, dito direto: com 2 avaliacoes publicadas o produto segue 5 / 0
        assert.deepEqual(await par(PRODS.P1), [5, 0]);
      },
      { antes: true },
    ),
);

prova(
  "DEPOIS: pendente nao conta; aprovar, editar, despublicar, excluir e trocar de produto recalculam; ultima sai = 5 / 0; coluna alheia nao escreve; controle intacto",
  () => emTransacao(() => comportamentoEsperado()),
);

prova(
  "DEPOIS: so conta o status publicada do ENUM real (a restricao aceita so publicada e pendente)",
  () =>
    emTransacao(async () => {
      await semear();
      const r = await tentar(null, SQL_INS, [
        PRODS.P1,
        autora(0),
        5,
        "recusada",
      ]);
      assert.equal(
        r.codigo,
        "23514",
        "status fora da lista devia ser recusado pela restricao",
      );
      assert.deepEqual(await par(PRODS.P1), [5, 0]);
    }),
);

prova(
  "DEPOIS: a funcao do gatilho esta FECHADA (cliente, anon e service_role nao chamam), com os atributos desenhados",
  () =>
    emTransacao(async () => {
      for (const papel of ["anon", "authenticated", "service_role"]) {
        const r = await tentar(papel, `SELECT ${FN}`);
        assert.ok(r.erro, `${papel} conseguiu chamar a funcao do gatilho`);
        assert.match(
          r.erro,
          /permission denied|trigger functions can only be called as triggers/i,
        );
      }
      const a = (
        await C.query(
          `SELECT prosecdef, provolatile, proconfig::text AS cfg, prorettype::regtype::text AS ret
           FROM pg_proc WHERE oid = to_regprocedure($1)`,
          [FN],
        )
      ).rows[0];
      assert.deepEqual(a, {
        prosecdef: true,
        provolatile: "v",
        cfg: "{search_path=public,lock_timeout=500ms}",
        ret: "trigger",
      });
      const g = (await gatilhoDef())[0];
      assert.equal(g.tabela, "reviews");
      assert.equal(g.tgtype, 29);
      assert.equal(g.tgenabled, "O");
      assert.equal(g.sem_when, true);
    }),
);

// ---------------------------------------------------------------------------
// BORDA: a falha do gatilho, a avaliacao antiga, o apply
// ---------------------------------------------------------------------------

prova(
  "BORDA: a falha do gatilho (CHECK em produtos) NAO perde a avaliacao, avisa no log e a transacao segue viva; o proximo evento recalcula do zero",
  () =>
    emTransacao(async () => {
      await semear();
      const { P1 } = PRODS;
      await C.query(
        "ALTER TABLE public.produtos ADD CONSTRAINT r13_sem_avaliacao CHECK (review_count < 1)",
      );
      AVISOS.length = 0;
      const id = (await C.query(SQL_INS, [P1, autora(0), 4, "publicada"]))
        .rows[0].id;
      // a avaliacao entrou, a nota nao se mexeu, e a transacao nao abortou
      assert.equal(
        (
          await C.query(
            "SELECT count(*)::int AS n FROM public.reviews WHERE id = $1",
            [id],
          )
        ).rows[0].n,
        1,
        "a avaliacao se perdeu junto com a falha da nota",
      );
      assert.deepEqual(await par(P1), [5, 0]);
      const aviso = AVISOS.find((m) => /nao foi recalculada/.test(m.message));
      assert.ok(aviso, "a falha nao deixou WARNING no log");
      assert.match(aviso.message, /23514/);
      // some o obstaculo: o proximo evento do produto recalcula TUDO (a avaliacao que ficou para tras tambem)
      await C.query(
        "ALTER TABLE public.produtos DROP CONSTRAINT r13_sem_avaliacao",
      );
      await C.query(SQL_INS, [P1, autora(1), 2, "publicada"]);
      assert.deepEqual(
        await par(P1),
        [3, 2],
        "o recalculo do zero nao consertou a nota atrasada",
      );
    }),
);

prova(
  "BORDA: produto sumido no meio (avaliacao de produto apagado no mesmo comando) nao derruba nada",
  () =>
    emTransacao(async () => {
      await semear();
      const { P1 } = PRODS;
      await C.query(SQL_INS, [P1, autora(0), 5, "publicada"]);
      // exclusao do produto leva as avaliacoes (FK em cascata ou recusa): o que importa e' nao haver erro do gatilho
      const r = await tentar(
        null,
        "DELETE FROM public.produtos WHERE id = $1",
        [P1],
      );
      if (r.erro)
        assert.doesNotMatch(r.erro, /avaliacao_atualiza_a_nota_do_produto/);
    }),
);

prova(
  "DADOS: o apply NAO escreve em produtos nem em reviews; produto com avaliacoes antigas segue 5 / 0 ate o proximo evento, que o recalcula inteiro",
  () =>
    emTransacao(
      async () => {
        await semear();
        const { P1, P2 } = PRODS;
        // estado ANTES: 3 publicadas + 1 pendente em P1, nota padrao; P2 com nota "velha" manual
        for (const [n, rating, st] of [
          [0, 5, "publicada"],
          [1, 4, "publicada"],
          [2, 3, "publicada"],
          [3, 1, "pendente"],
        ])
          await C.query(SQL_INS, [P1, autora(n), rating, st]);
        await C.query(
          "UPDATE public.produtos SET rating = 4.2, review_count = 99 WHERE id = $1",
          [P2],
        );
        const foto = await retratoDosDados();
        const esquema = await retratoDoSchema();
        assert.equal(await aplicar(MIGRATION), null);
        assert.deepEqual(
          await retratoDosDados(),
          foto,
          "o apply escreveu em produtos ou reviews",
        );
        assert.deepEqual(
          await retratoDoSchema(),
          esquema,
          "o apply mexeu em objeto que nao e' dele",
        );
        assert.deepEqual(
          await par(P1),
          [5, 0],
          "a nota antiga devia seguir como estava",
        );
        // o proximo evento do produto recalcula tudo de uma vez
        await C.query(SQL_INS, [P1, autora(4), 5, "publicada"]);
        assert.deepEqual(
          await par(P1),
          [4.3, 4],
          "o recalculo nao contou as avaliacoes antigas",
        );
        // um produto com nota velha errada so e' consertado pelo seu proprio evento
        assert.deepEqual(await par(P2), [4.2, 99]);
      },
      { antes: true },
    ),
);

prova(
  "SO NOVO: o apply cria so a funcao e o gatilho; a funcao nasce FECHADA; nenhuma outra funcao, tabela, policy ou gatilho muda",
  () =>
    emTransacao(
      async () => {
        const antes = await retratoDoSchema();
        assert.equal(await aplicar(MIGRATION), null);
        assert.deepEqual(await retratoDoSchema(), antes);
        const acl = await aclFuncao();
        assert.ok(
          !/(^|[{,])(=|anon=|authenticated=|service_role=)/.test(acl ?? ""),
          `ACL aberta: ${acl}`,
        );
      },
      { antes: true },
    ),
);

const BACKFILL = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "..",
    "scripts",
    "publicacao",
    "pendente-as-estrelas-do-produto-backfill.sql.pendente",
  ),
  "utf8",
);

prova(
  "BACKFILL PENDENTE (o .sql.txt do dono): so escreve produto com review_count 0/NULL e avaliacao publicada; nada mais muda; a 2a rodada e' no-op",
  () =>
    emTransacao(
      async () => {
        await semear();
        const { P1, P2, P3 } = PRODS;
        const PD = uid(904);
        const PE = uid(905);
        for (const id of [PD, PE])
          await C.query(
            "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Produto extra 121', 100, 10, true, 40)",
            [id],
          );
        // P1: 3 publicadas (5, 4, 3) + 1 pendente; P2: nada; P3: so pendente; PD: ja tem contagem; PE: contagem NULL
        for (const [n, rating, st] of [
          [0, 5, "publicada"],
          [1, 4, "publicada"],
          [2, 3, "publicada"],
          [3, 1, "pendente"],
        ])
          await C.query(SQL_INS, [P1, autora(n), rating, st]);
        await C.query(SQL_INS, [P3, autora(4), 2, "pendente"]);
        await C.query(SQL_INS, [PD, autora(7), 1, "publicada"]);
        await C.query(
          "UPDATE public.produtos SET rating = 3.3, review_count = 2 WHERE id = $1",
          [PD],
        );
        await C.query(SQL_INS, [PE, autora(5), 4, "publicada"]);
        await C.query(SQL_INS, [PE, autora(6), 5, "publicada"]);
        await C.query(
          "UPDATE public.produtos SET review_count = NULL WHERE id = $1",
          [PE],
        );
        const avaliacoes = (await retratoDosDados()).avaliacoes;

        const res = await C.query(BACKFILL);
        const rodadas = res.filter(
          (r) => Array.isArray(r.rows) && r.command === "SELECT",
        );
        assert.equal(
          rodadas[0].rows.length,
          2,
          "o PASSO 1 devia listar so P1 e PE",
        );
        assert.deepEqual(
          await par(P1),
          [4, 3],
          "P1 devia ter 3 publicadas, media 4",
        );
        assert.deepEqual(
          await par(PE),
          [4.5, 2],
          "PE (contagem NULL) devia ser recalculado",
        );
        assert.deepEqual(
          await par(P2),
          [5, 0],
          "produto sem avaliacao nao se toca",
        );
        assert.deepEqual(
          await par(P3),
          [5, 0],
          "produto so com pendente nao se toca",
        );
        assert.deepEqual(
          await par(PD),
          [3.3, 2],
          "produto com contagem ja gravada nao se toca",
        );
        // o PASSO 3 so aponta o que o backfill deixa de fora de proposito (PD)
        assert.deepEqual(
          rodadas[rodadas.length - 1].rows.map((r) => r.id),
          [PD],
        );
        assert.equal(
          (await retratoDosDados()).avaliacoes,
          avaliacoes,
          "o backfill escreveu em reviews",
        );

        // 2a rodada: no-op (nenhum produto satisfaz mais o filtro)
        const foto = await retratoDosDados();
        const res2 = await C.query(BACKFILL);
        assert.equal(
          res2.filter((r) => r.command === "SELECT")[0].rows.length,
          0,
          "o PASSO 1 devia ficar vazio",
        );
        assert.deepEqual(await retratoDosDados(), foto, "a 2a rodada escreveu");
      },
      { antes: true },
    ),
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------

const criarFuncao = (corpo, { definer = true, timeout = "500ms" } = {}) =>
  `CREATE OR REPLACE FUNCTION public.avaliacao_atualiza_a_nota_do_produto()
 RETURNS trigger LANGUAGE plpgsql ${definer ? "SECURITY DEFINER" : ""} SET search_path TO 'public'${timeout ? ` SET lock_timeout TO '${timeout}'` : ""}
AS $function$${corpo}$function$`;
const recriarGatilho = (def) =>
  `DROP TRIGGER ${GATILHO} ON public.reviews;
   CREATE TRIGGER ${GATILHO} ${def} EXECUTE FUNCTION ${FN}`;

const MUTANTES_DE_CORPO = [
  [
    "conta tambem a avaliacao pendente",
    (c) => c.replace("AND r.status = 'publicada';", "AND true;"),
    /\[(F|G|H)\]/,
  ],
  [
    "sem arredondar a 1 casa",
    (c) => c.replace("round(avg(r.rating), 1)", "avg(r.rating)"),
    /\[D\] arredondamento/,
  ],
  [
    "sem avaliacao publicada vira 0 em vez de 5",
    (c) =>
      c.replace("round(avg(r.rating), 1), 5)", "round(avg(r.rating), 1), 0)"),
    /\[I\] o produto antigo/,
  ],
  [
    "so o produto NOVO na troca de produto",
    (c) =>
      c.replace(
        "ARRAY[OLD.product_id, NEW.product_id]",
        "ARRAY[NEW.product_id]",
      ),
    /\[I\] o produto antigo/,
  ],
];
for (const [rotulo, muta, esperada] of MUTANTES_DE_CORPO) {
  prova(
    `MUTANTE (${rotulo}): o comportamento esperado FICA VERMELHO, na linha certa`,
    () =>
      emTransacao(async () => {
        const corpo = muta(CORPO);
        assert.notEqual(
          corpo,
          CORPO,
          "o mutante nao mudou o corpo (o texto-alvo sumiu)",
        );
        await C.query(criarFuncao(corpo));
        assert.notEqual(await hashVivo(), H_CORPO);
        await assert.rejects(() => comportamentoEsperado(), esperada);
      }),
  );
}

prova(
  "MUTANTE (sem SECURITY DEFINER): quem grava a avaliacao sem privilegio em produtos nao atualiza a nota (a falha vira so um WARNING)",
  () =>
    emTransacao(async () => {
      await C.query(criarFuncao(CORPO, { definer: false }));
      await assert.rejects(
        () => comportamentoEsperado(),
        /\[O\] papel sem privilegio/,
      );
    }),
);

for (const [rotulo, def, esperada] of [
  [
    "sem o evento DELETE",
    "AFTER INSERT OR UPDATE OF status, rating, product_id ON public.reviews FOR EACH ROW",
    /\[H\] excluir publicada/,
  ],
  [
    "sem o evento UPDATE",
    "AFTER INSERT OR DELETE ON public.reviews FOR EACH ROW",
    /\[B\] aprovar/,
  ],
  [
    "sem o evento INSERT (a gravacao direta ja publicada)",
    "AFTER DELETE OR UPDATE OF status, rating, product_id ON public.reviews FOR EACH ROW",
    /\[L\] insert de varias linhas/,
  ],
  [
    "UPDATE OF sem a coluna rating",
    "AFTER INSERT OR DELETE OR UPDATE OF status, product_id ON public.reviews FOR EACH ROW",
    /\[F\] editar a nota/,
  ],
  [
    "UPDATE OF sem a coluna status",
    "AFTER INSERT OR DELETE OR UPDATE OF rating, product_id ON public.reviews FOR EACH ROW",
    /\[B\] aprovar/,
  ],
  [
    "UPDATE OF sem a coluna product_id",
    "AFTER INSERT OR DELETE OR UPDATE OF status, rating ON public.reviews FOR EACH ROW",
    /\[I\] o produto antigo/,
  ],
  [
    "gatilho BEFORE (a linha ainda nao existe para a conta)",
    "BEFORE INSERT OR DELETE OR UPDATE OF status, rating, product_id ON public.reviews FOR EACH ROW",
    /\[[A-N]\]|reviews|0 rows|undefined/,
  ],
]) {
  prova(
    `MUTANTE (gatilho ${rotulo}): o comportamento esperado FICA VERMELHO`,
    () =>
      emTransacao(async () => {
        await C.query(recriarGatilho(def));
        await assert.rejects(() => comportamentoEsperado(), esperada);
      }),
  );
}
prova(
  "MUTANTE (gatilho desligado, DISABLE TRIGGER): o comportamento esperado FICA VERMELHO",
  () =>
    emTransacao(async () => {
      await C.query(`ALTER TABLE public.reviews DISABLE TRIGGER ${GATILHO}`);
      await assert.rejects(
        () => comportamentoEsperado(),
        /\[B\] aprovar nao atualizou a nota/,
      );
    }),
);

/** A prova de que a avaliacao sobrevive a falha, rodada sobre o corpo SEM o bloco EXCEPTION: ela REPROVA. */
prova(
  "MUTANTE (sem o bloco EXCEPTION): a falha da nota derruba a avaliacao junto",
  () =>
    emTransacao(async () => {
      await semear();
      const sem = CORPO.replace(
        /\n {4}EXCEPTION WHEN OTHERS THEN[\s\S]*?SQLERRM;\n/,
        "\n",
      );
      assert.notEqual(sem, CORPO, "o mutante nao tirou o EXCEPTION");
      await C.query(criarFuncao(sem));
      await C.query(
        "ALTER TABLE public.produtos ADD CONSTRAINT r13_sem_avaliacao CHECK (review_count < 1)",
      );
      const r = await tentar(null, SQL_INS, [
        PRODS.P1,
        autora(0),
        4,
        "publicada",
      ]);
      assert.equal(
        r.codigo,
        "23514",
        "sem o EXCEPTION a falha da nota devia derrubar a gravacao",
      );
      assert.equal(
        (await C.query("SELECT count(*)::int AS n FROM public.reviews")).rows[0]
          .n,
        0,
      );
    }),
);

// ---------------------------------------------------------------------------
// MIGRATION: reaplicar, CRLF, rollback, pre-voo, conferencia
// ---------------------------------------------------------------------------

prova(
  "REAPLICAR (2x) e CRLF: mesmo estado (mesmo OID, mesma ACL, mesmo gatilho) e o comportamento segue",
  () =>
    emTransacao(async () => {
      const foto = {
        oid: await oidVivo(),
        acl: await aclFuncao(),
        gat: await gatilhoDef(),
        hash: await hashVivo(),
      };
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(emCRLF(MIGRATION)), null);
      assert.deepEqual(
        {
          oid: await oidVivo(),
          acl: await aclFuncao(),
          gat: await gatilhoDef(),
          hash: await hashVivo(),
        },
        foto,
      );
      await comportamentoEsperado();
    }),
);

prova(
  "ROLLBACK: apaga os DOIS objetos sem tocar dado nem os gatilhos irmaos; rodar de novo e' no-op; ida e volta termina igual",
  () =>
    emTransacao(async () => {
      await semear();
      await C.query(SQL_INS, [PRODS.P1, autora(0), 5, "publicada"]);
      const dados = await retratoDosDados();
      const irmaos = (await retratoDoSchema()).gatilhos;
      const depois = { oid: await oidVivo(), hash: await hashVivo() };
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await funcaoExiste(), false);
      assert.equal(await gatilhoExiste(), false);
      assert.deepEqual(await retratoDosDados(), dados, "o rollback tocou dado");
      assert.deepEqual(
        (await retratoDoSchema()).gatilhos,
        irmaos,
        "o rollback tocou os gatilhos irmaos",
      );
      assert.equal(
        await aplicar(ROLLBACK),
        null,
        "rodar o rollback de novo devia ser no-op",
      );
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await hashVivo(), depois.hash);
      assert.equal((await gatilhoDef()).length, 1);
    }),
);

function motivoEsperado(rotulo) {
  if (rotulo.startsWith("rollback: funcao redefinida"))
    return /não é o da 20261399500000/;
  if (rotulo.includes("coluna de reviews"))
    return /public\.reviews não tem product_id/;
  if (rotulo.includes("coluna de produtos"))
    return /public\.produtos não tem id/;
  if (rotulo.includes("reviews_status_check")) return /reviews_status_check/;
  if (rotulo.includes("gatilho")) return /NÃO é o desenhado/;
  if (rotulo.includes("corpo desconhecido"))
    return /já existe com corpo desconhecido/;
  if (rotulo.includes("outra assinatura")) return /com outra assinatura/;
  if (rotulo.includes("sobrecarga ao lado")) return /tem sobrecarga/;
  throw new Error(`sem motivo declarado para: ${rotulo}`);
}

/** Estado "sujo" -> o pre-voo recusa com B1_BASELINE_DIVERGENT e NAO deixa nada para tras. */
async function recusaSemEscrever(
  rotulo,
  montar,
  arquivo = MIGRATION,
  { antes = true } = {},
) {
  await emTransacao(
    async () => {
      await montar();
      const foto = {
        schema: await retratoDoSchema(),
        funcao: await funcaoExiste(),
        hash: await hashVivo(),
        gat: await gatilhoDef(),
        dados: await retratoDosDados(),
      };
      const r = await aplicar(arquivo);
      assert.ok(r, `${rotulo}: o pre-voo devia recusar`);
      assert.equal(r.codigo, "P0001", `${rotulo}: ${r.erro}`);
      assert.match(r.erro, /^B1_BASELINE_DIVERGENT/, rotulo);
      assert.match(
        r.erro,
        motivoEsperado(rotulo),
        `recusou, mas por OUTRO motivo: ${rotulo}`,
      );
      assert.deepEqual(
        {
          schema: await retratoDoSchema(),
          funcao: await funcaoExiste(),
          hash: await hashVivo(),
          gat: await gatilhoDef(),
          dados: await retratoDosDados(),
        },
        foto,
        `${rotulo}: o pre-voo recusou DEPOIS de escrever`,
      );
    },
    { antes },
  );
}

const FUNCAO_ALHEIA =
  "CREATE FUNCTION public.r13_alheia() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$";

prova(
  "PRE-VOO: recusa SEM escrever (corpo desconhecido, sobrecarga, gatilho fora do desenho, coluna ou restricao ausente)",
  async () => {
    await recusaSemEscrever("funcao existe com corpo desconhecido", () =>
      C.query(
        `CREATE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`,
      ),
    );
    await recusaSemEscrever("sobrecarga so com outra assinatura", () =>
      C.query(
        "CREATE FUNCTION public.avaliacao_atualiza_a_nota_do_produto(x int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
      ),
    );
    await recusaSemEscrever(
      "sobrecarga ao lado da funcao certa",
      () =>
        C.query(
          "CREATE FUNCTION public.avaliacao_atualiza_a_nota_do_produto(x int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        ),
      MIGRATION,
      { antes: false },
    );
    await recusaSemEscrever(
      "gatilho de mesmo nome em OUTRA tabela",
      async () => {
        await C.query(FUNCAO_ALHEIA);
        await C.query(
          `CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION public.r13_alheia()`,
        );
      },
    );
    for (const [rotulo, def] of [
      ["AFTER INSERT so", "AFTER INSERT ON public.reviews FOR EACH ROW"],
      [
        "sem DELETE",
        "AFTER INSERT OR UPDATE OF status, rating, product_id ON public.reviews FOR EACH ROW",
      ],
      [
        "UPDATE de qualquer coluna",
        "AFTER INSERT OR DELETE OR UPDATE ON public.reviews FOR EACH ROW",
      ],
      [
        "UPDATE OF com outras colunas",
        "AFTER INSERT OR DELETE OR UPDATE OF status, rating ON public.reviews FOR EACH ROW",
      ],
      [
        "BEFORE",
        "BEFORE INSERT OR DELETE OR UPDATE OF status, rating, product_id ON public.reviews FOR EACH ROW",
      ],
      [
        "com WHEN",
        "AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id ON public.reviews FOR EACH ROW WHEN (true)",
      ],
      [
        "por comando (FOR EACH STATEMENT)",
        "AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id ON public.reviews FOR EACH STATEMENT",
      ],
    ]) {
      // 'WHEN (true)' em INSERT OR DELETE OR UPDATE nao referencia OLD/NEW, e' aceito pelo Postgres
      await recusaSemEscrever(
        `gatilho no mesmo nome: ${rotulo}`,
        async () => {
          await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
          await C.query(
            `CREATE TRIGGER ${GATILHO} ${def} EXECUTE FUNCTION ${FN}`,
          );
        },
        MIGRATION,
        { antes: false },
      );
    }
    await recusaSemEscrever(
      "gatilho apontando para outra funcao",
      async () => {
        await C.query(FUNCAO_ALHEIA);
        await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
        await C.query(
          `CREATE TRIGGER ${GATILHO} ${DEF_GATILHO} EXECUTE FUNCTION public.r13_alheia()`,
        );
      },
      MIGRATION,
      { antes: false },
    );
    await recusaSemEscrever("coluna de reviews ausente (status)", () =>
      C.query("ALTER TABLE public.reviews RENAME COLUMN status TO status_x"),
    );
    await recusaSemEscrever("coluna de produtos ausente (review_count)", () =>
      C.query(
        "ALTER TABLE public.produtos RENAME COLUMN review_count TO review_count_x",
      ),
    );
    await recusaSemEscrever("restricao reviews_status_check ausente", () =>
      C.query(
        "ALTER TABLE public.reviews DROP CONSTRAINT reviews_status_check",
      ),
    );
  },
);

prova(
  "PRE-VOO do ROLLBACK: recusa SEM apagar o que nao e' dele (corpo redefinido, gatilho de outra tabela ou fora do desenho)",
  async () => {
    await recusaSemEscrever(
      "rollback: funcao redefinida por outra pessoa",
      () =>
        C.query(
          `CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN RETURN NULL; END $$`,
        ),
      ROLLBACK,
      { antes: false },
    );
    await recusaSemEscrever(
      "rollback: gatilho de mesmo nome em outra tabela",
      async () => {
        await C.query(FUNCAO_ALHEIA);
        await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
        await C.query(
          `CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        );
      },
      ROLLBACK,
      { antes: false },
    );
    await recusaSemEscrever(
      "rollback: gatilho com WHEN",
      async () => {
        await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
        await C.query(
          `CREATE TRIGGER ${GATILHO} ${DEF_GATILHO} WHEN (true) EXECUTE FUNCTION ${FN}`,
        );
      },
      ROLLBACK,
      { antes: false },
    );
  },
);

prova(
  "CONFERENCIA FINAL: recusa o apply quando a funcao nasce aberta ou o gatilho nasce fora do desenho (e nada fica)",
  () =>
    emTransacao(
      async () => {
        const semRevoke = MIGRATION.replace(
          /^REVOKE ALL ON FUNCTION[^\n]*\n/m,
          "",
        );
        assert.notEqual(semRevoke, MIGRATION);
        let r = await aplicar(semRevoke);
        assert.ok(r, "a funcao aberta devia ser recusada");
        assert.match(r.erro, /conferencia 20261399500000/);
        assert.equal(
          await funcaoExiste(),
          false,
          "a conferencia recusou mas deixou a funcao",
        );
        const gatilhoErrado = MIGRATION.replace(
          "UPDATE OF status, rating, product_id ON",
          "UPDATE OF status, rating ON",
        );
        assert.notEqual(gatilhoErrado, MIGRATION);
        r = await aplicar(gatilhoErrado);
        assert.ok(r, "o gatilho fora do desenho devia ser recusado");
        assert.match(r.erro, /conferencia 20261399500000/);
        assert.equal(await gatilhoExiste(), false);
      },
      { antes: true },
    ),
);

// ---------------------------------------------------------------------------
// CONSULTAS 121a / 121b
// ---------------------------------------------------------------------------

const rodarFicha = async (sql) => (await C.query(sql)).rows;
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
const ITENS_121A = 6;

prova(
  "FICHAS 121a/121b: DEPOIS a 121a e' toda positiva e a 121b reprova SO as duas linhas do objeto; ANTES o contrario",
  async () => {
    await emTransacao(async () => {
      const a = await rodarFicha(SQL_121A);
      const b = await rodarFicha(SQL_121B);
      assert.equal(a.length, ITENS_121A);
      assert.equal(b.length, 6);
      assert.deepEqual(reprovadas(a), [], "121a depois do apply");
      assert.equal(
        reprovadas(b).length,
        2,
        "121b depois do apply reprova so a funcao e o gatilho",
      );
      assert.ok(
        reprovadas(b).every((i) =>
          /funcao ainda NAO existe|gatilho ainda NAO existe/.test(i),
        ),
      );
    });
    await emTransacao(
      async () => {
        const a = await rodarFicha(SQL_121A);
        const b = await rodarFicha(SQL_121B);
        assert.equal(a.length, ITENS_121A);
        assert.equal(b.length, 6);
        assert.equal(
          reprovadas(a).length,
          ITENS_121A - 1,
          "121a antes: tudo reprova menos o controle",
        );
        assert.deepEqual(reprovadas(b), [], "121b antes");
      },
      { antes: true },
    );
  },
);

prova(
  "FICHAS 121a: cada estrago reprova a linha certa (gatilho desligado, gatilho fora, EXECUTE aberto, corpo trocado)",
  () =>
    emTransacao(async () => {
      const um = async (rotulo, sabotar, padrao) => {
        await C.query("SAVEPOINT estrago");
        try {
          await sabotar();
          const r = reprovadas(await rodarFicha(SQL_121A));
          assert.equal(
            r.length,
            1,
            `${rotulo}: reprovou ${r.length} linhas: ${r.join(" | ")}`,
          );
          assert.match(r[0], padrao, rotulo);
        } finally {
          await C.query("ROLLBACK TO SAVEPOINT estrago");
        }
      };
      await um(
        "gatilho desligado",
        () => C.query(`ALTER TABLE public.reviews DISABLE TRIGGER ${GATILHO}`),
        /^tr_avaliacao/,
      );
      await um(
        "gatilho fora do desenho",
        () =>
          C.query(
            recriarGatilho("AFTER INSERT ON public.reviews FOR EACH ROW"),
          ),
        /^tr_avaliacao/,
      );
      await um(
        "EXECUTE aberto a anon",
        () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
        /EXECUTE fechado/,
      );
      await um(
        "corpo trocado (round some)",
        () =>
          C.query(
            criarFuncao(
              CORPO.replace("round(avg(r.rating), 1)", "avg(r.rating)"),
            ),
          ),
        /corpo e o da/,
      );
      await um(
        "sem lock_timeout",
        () => C.query(criarFuncao(CORPO, { timeout: "" })),
        /atributos de sempre/,
      );
    }),
);

// ---------------------------------------------------------------------------
// CONCORRENCIA (COMMITADA; o clone e' descartavel, e cada caso apaga o que criou)
// ---------------------------------------------------------------------------

const PA = uid(951);
const PB = uid(952);
const PC = uid(953);
const N_USUARIOS = 60;

async function abrir() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  c.on("notice", (m) => AVISOS.push(m));
  c.pid = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  return c;
}
async function semearCommitado() {
  await limparCommitado();
  const ids = Array.from({ length: N_USUARIOS }, (_, i) => uid(100 + i));
  await C.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) SELECT u, u::text || '@121c.teste', '{}'::jsonb FROM unnest($1::uuid[]) AS u",
    [ids],
  );
  await C.query(
    "INSERT INTO public.profiles (id, full_name, role) SELECT u, 'Autora ' || u::text, 'customer' FROM unnest($1::uuid[]) AS u",
    [ids],
  );
  for (const id of [PA, PB, PC])
    await C.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Produto concorrencia 121', 100, 10, true, 40)",
      [id],
    );
}
async function limparCommitado() {
  await C.query(
    "DELETE FROM public.reviews WHERE product_id = ANY($1::uuid[])",
    [[PA, PB, PC]],
  );
  await C.query("DELETE FROM public.produtos WHERE id = ANY($1::uuid[])", [
    [PA, PB, PC],
  ]);
  await C.query("DELETE FROM public.profiles WHERE id::text LIKE '7e7e2113-%'");
  await C.query("DELETE FROM auth.users WHERE id::text LIKE '7e7e2113-%'");
}
const u = (i) => uid(100 + i);
const notaC = async (p) =>
  (
    await C.query(
      "SELECT rating::float8 AS rating, review_count FROM public.produtos WHERE id = $1",
      [p],
    )
  ).rows[0];
const contaReal = async (p) =>
  (
    await C.query(
      `SELECT count(*)::int AS review_count, coalesce(round(avg(rating), 1), 5)::float8 AS rating
         FROM public.reviews WHERE product_id = $1 AND status = 'publicada'`,
      [p],
    )
  ).rows[0];
async function esperaBloqueada(pid, ms = 4000) {
  for (let t = 0; t < ms; t += 20) {
    const r = await C.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return;
    await dorme(20);
  }
  throw new Error(`a conexao ${pid} nunca ficou esperando uma trava`);
}
const ins = (c, i, produto, rating, status = "publicada") =>
  c.query(SQL_INS, [produto, u(i), rating, status]);

/** Aplica uma sabotagem COMMITADA, roda `fn` e SEMPRE devolve a funcao e o gatilho originais (e confere a ficha). */
async function comSabotagemCommitada(sql, fn) {
  await C.query(sql);
  try {
    return await fn();
  } finally {
    await C.query(criarFuncao(CORPO));
    await C.query(`DROP TRIGGER IF EXISTS ${GATILHO} ON public.reviews`);
    await C.query(
      `CREATE TRIGGER ${GATILHO} ${DEF_GATILHO} EXECUTE FUNCTION ${FN}`,
    );
    assert.equal(await hashVivo(), H_CORPO, "a funcao nao voltou ao original");
    assert.deepEqual(
      reprovadas(await rodarFicha(SQL_121A)),
      [],
      "a 121a nao voltou toda positiva",
    );
  }
}

/** Duas avaliacoes publicadas do MESMO produto, a segunda esperando a primeira dentro do gatilho. */
async function corridaDeDuas() {
  const a = await abrir();
  const b = await abrir();
  try {
    await a.query("BEGIN");
    await ins(a, 0, PA, 5); // A: trava o produto e recalcula (1 / 5), ainda sem commit
    await b.query("BEGIN");
    const pb = ins(b, 1, PA, 3).then(
      () => "ok",
      (e) => `erro ${e.code}: ${e.message}`,
    );
    await esperaBloqueada(b.pid); // B: espera a linha do produto dentro do gatilho
    await a.query("COMMIT");
    assert.equal(await pb, "ok");
    await b.query("COMMIT");
    return await notaC(PA);
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
}

prova(
  "CONCORRENCIA (corrida): duas avaliacoes publicadas do mesmo produto ao mesmo tempo -> a segunda ESPERA a primeira e a conta fecha em 2 / 4 (nenhuma se perde)",
  async () => {
    await semearCommitado();
    try {
      assert.deepEqual(await corridaDeDuas(), { rating: 4, review_count: 2 });
    } finally {
      await limparCommitado();
    }
  },
);

prova(
  "MUTANTE (sem a trava do produto antes de ler): a corrida PERDE uma avaliacao da conta",
  async () => {
    await semearCommitado();
    try {
      const sem = CORPO.replace(
        /\n {8}PERFORM 1\n[\s\S]*?FOR NO KEY UPDATE;\n/,
        "\n",
      );
      assert.notEqual(sem, CORPO, "o mutante nao tirou a trava");
      const r = await comSabotagemCommitada(criarFuncao(sem), corridaDeDuas);
      assert.equal(
        r.review_count,
        1,
        `sem a trava a corrida devia perder uma avaliacao, deu ${JSON.stringify(r)}`,
      );
    } finally {
      await limparCommitado();
    }
  },
);

prova(
  "CONCORRENCIA (carga): 4 conexoes x 5 avaliacoes publicadas ao mesmo tempo -> a nota do produto e' EXATAMENTE a das 20 avaliacoes, sem aviso de falha",
  async () => {
    await semearCommitado();
    const conns = await Promise.all([1, 2, 3, 4].map(() => abrir()));
    try {
      AVISOS.length = 0;
      await Promise.all(
        conns.map(async (c, k) => {
          for (let j = 0; j < 5; j++)
            await ins(c, k * 5 + j, PB, ((k + j) % 5) + 1);
        }),
      );
      const real = await contaReal(PB);
      assert.equal(real.review_count, 20);
      assert.deepEqual(await notaC(PB), real);
      assert.equal(
        AVISOS.filter((m) => /nao foi recalculada/.test(m.message)).length,
        0,
      );
    } finally {
      await Promise.all(conns.map((c) => c.end().catch(() => {})));
      await limparCommitado();
    }
  },
);

/** Duas trocas de produto CRUZADAS ao mesmo tempo: P1 -> P2 e P2 -> P1. */
async function trocasCruzadas() {
  const [pLow, pHigh] = [PA, PB].sort();
  const ra = (await ins(C, 0, pLow, 5)).rows[0].id;
  const rb = (await ins(C, 1, pHigh, 1)).rows[0].id;
  const a = await abrir();
  const b = await abrir();
  try {
    AVISOS.length = 0;
    await Promise.all([
      a.query("UPDATE public.reviews SET product_id = $2 WHERE id = $1", [
        ra,
        pHigh,
      ]),
      b.query("UPDATE public.reviews SET product_id = $2 WHERE id = $1", [
        rb,
        pLow,
      ]),
    ]);
    return {
      baixo: await notaC(pLow),
      alto: await notaC(pHigh),
      reais: [await contaReal(pLow), await contaReal(pHigh)],
      avisos: AVISOS.filter((m) => /nao foi recalculada/.test(m.message))
        .length,
    };
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
}

prova(
  "CONCORRENCIA (trocas cruzadas): duas avaliacoes trocam de produto em sentidos opostos ao mesmo tempo -> as duas notas fecham, sem deadlock nem aviso",
  async () => {
    await semearCommitado();
    try {
      const r = await trocasCruzadas();
      assert.equal(r.avisos, 0);
      assert.deepEqual([r.baixo, r.alto], r.reais);
      assert.deepEqual(r.baixo, { rating: 1, review_count: 1 });
      assert.deepEqual(r.alto, { rating: 5, review_count: 1 });
    } finally {
      await limparCommitado();
    }
  },
);

prova(
  "MUTANTE (trava o antigo, espera, trava o novo: sem a ordem global): as trocas cruzadas deixam uma nota ATRASADA",
  async () => {
    await semearCommitado();
    try {
      const sem = CORPO.replace(
        /PERFORM 1\n\s+FROM public\.produtos p\n\s+WHERE p\.id = ANY \(v_produtos\)\n\s+ORDER BY p\.id\n\s+FOR NO KEY UPDATE;/,
        `PERFORM 1 FROM public.produtos p WHERE p.id = v_produtos[1] FOR NO KEY UPDATE;
        PERFORM pg_sleep(0.2);
        PERFORM 1 FROM public.produtos p WHERE p.id = v_produtos[2] FOR NO KEY UPDATE;`,
      );
      assert.notEqual(sem, CORPO, "o mutante nao trocou a trava");
      const r = await comSabotagemCommitada(criarFuncao(sem), trocasCruzadas);
      assert.ok(
        r.avisos > 0 ||
          JSON.stringify([r.baixo, r.alto]) !== JSON.stringify(r.reais),
        `sem a ordem global as trocas cruzadas deviam falhar: ${JSON.stringify(r)}`,
      );
    } finally {
      await limparCommitado();
    }
  },
);

prova(
  "CONCORRENCIA (compra segurando o produto): a nota espera ate 500 ms e DESISTE; a avaliacao fica gravada; o proximo evento recalcula do zero",
  async () => {
    await semearCommitado();
    const compra = await abrir();
    try {
      await compra.query("BEGIN");
      await compra.query(
        "SELECT 1 FROM public.produtos WHERE id = $1 FOR NO KEY UPDATE",
        [PA],
      );
      AVISOS.length = 0;
      const t0 = Date.now();
      const a = await abrir();
      try {
        await ins(a, 0, PA, 4); // autocommit: espera a compra, desiste e grava
        const gasto = Date.now() - t0;
        assert.ok(
          gasto >= 400,
          `devia esperar ~500 ms pela compra, esperou ${gasto} ms`,
        );
        assert.ok(gasto < 3000, `esperou demais: ${gasto} ms`);
        assert.equal(
          (
            await C.query(
              "SELECT count(*)::int AS n FROM public.reviews WHERE product_id = $1",
              [PA],
            )
          ).rows[0].n,
          1,
        );
        assert.deepEqual(
          await notaC(PA),
          { rating: 5, review_count: 0 },
          "a nota devia ficar para tras",
        );
        const aviso = AVISOS.find((m) => /nao foi recalculada/.test(m.message));
        assert.ok(
          aviso && /55P03/.test(aviso.message),
          "faltou o WARNING com 55P03 (lock_not_available)",
        );
        await compra.query("COMMIT");
        await ins(a, 1, PA, 2); // sem a compra: recalcula tudo
        assert.deepEqual(await notaC(PA), { rating: 3, review_count: 2 });
      } finally {
        await a.end().catch(() => {});
      }
    } finally {
      await compra.query("ROLLBACK").catch(() => {});
      await compra.end().catch(() => {});
      await limparCommitado();
    }
  },
);

/**
 * A MODERACAO segura a avaliacao e espera o produto; o PAGAMENTO segura o produto e espera a avaliacao (o selo
 * "verificado"). Quem chega primeiro ao deadlock_timeout (1 s) e' derrubado: tem de ser a nota, nunca o pagamento.
 */
async function pagamentoNaoEVitima() {
  const rv = (await ins(C, 0, PA, 5, "pendente")).rows[0].id;
  const moderacao = await abrir();
  const pagamento = await abrir();
  try {
    AVISOS.length = 0;
    await moderacao.query("BEGIN");
    await moderacao.query(
      "SELECT 1 FROM public.reviews WHERE id = $1 FOR UPDATE",
      [rv],
    );
    await pagamento.query("BEGIN");
    await pagamento.query(
      "SELECT 1 FROM public.produtos WHERE id = $1 FOR NO KEY UPDATE",
      [PA],
    );
    const pg = pagamento
      .query("UPDATE public.reviews SET verified = true WHERE id = $1", [rv])
      .then(
        () => "ok",
        (e) => `erro ${e.code}`,
      );
    await esperaBloqueada(pagamento.pid); // o pagamento espera a avaliacao
    const t0 = Date.now();
    const mod = moderacao
      .query("UPDATE public.reviews SET status = 'publicada' WHERE id = $1", [
        rv,
      ])
      .then(
        () => "ok",
        (e) => `erro ${e.code}`,
      );
    const rMod = await mod; // a nota espera o produto (do pagamento) e desiste em ~500 ms
    const gasto = Date.now() - t0;
    await moderacao.query("COMMIT").catch(() => {});
    const rPag = await pg;
    await pagamento.query("COMMIT").catch(() => {});
    return { rMod, rPag, gasto };
  } finally {
    await moderacao.end().catch(() => {});
    await pagamento.end().catch(() => {});
  }
}

prova(
  "CONCORRENCIA (o pagamento nunca e' a vitima): moderacao e pagamento se cruzam -> a NOTA desiste em ~500 ms, a avaliacao e' aprovada e o pagamento termina sem 40P01",
  async () => {
    await semearCommitado();
    try {
      const r = await pagamentoNaoEVitima();
      assert.equal(r.rPag, "ok", `o pagamento foi derrubado: ${r.rPag}`);
      assert.equal(r.rMod, "ok");
      assert.ok(
        r.gasto < 1500,
        `a nota devia desistir antes do deadlock_timeout, levou ${r.gasto} ms`,
      );
      const linha = (
        await C.query(
          "SELECT status, verified FROM public.reviews WHERE product_id = $1",
          [PA],
        )
      ).rows[0];
      assert.deepEqual(linha, { status: "publicada", verified: true });
    } finally {
      await limparCommitado();
    }
  },
);

prova(
  "MUTANTE (sem lock_timeout na funcao): o cruzamento moderacao x pagamento DERRUBA o pagamento (40P01)",
  async () => {
    await semearCommitado();
    try {
      const r = await comSabotagemCommitada(
        criarFuncao(CORPO, { timeout: "" }),
        pagamentoNaoEVitima,
      );
      assert.equal(
        r.rPag,
        "erro 40P01",
        `sem o lock_timeout o pagamento devia ser a vitima, deu ${JSON.stringify(r)}`,
      );
    } finally {
      await limparCommitado();
    }
  },
);

/** Coluna alheia (selo, util) com o produto preso: tem de passar na hora; a nota (relevante) espera. */
async function colunaAlheiaNaoEspera() {
  const rv = (await ins(C, 0, PA, 5)).rows[0].id;
  const compra = await abrir();
  const a = await abrir();
  try {
    await compra.query("BEGIN");
    await compra.query(
      "SELECT 1 FROM public.produtos WHERE id = $1 FOR NO KEY UPDATE",
      [PA],
    );
    const t0 = Date.now();
    await a.query(
      "UPDATE public.reviews SET verified = true, helpful = helpful + 1 WHERE id = $1",
      [rv],
    );
    return Date.now() - t0;
  } finally {
    await compra.query("ROLLBACK").catch(() => {});
    await compra.end().catch(() => {});
    await a.end().catch(() => {});
  }
}

prova(
  "CONCORRENCIA (coluna alheia): selo e voto util passam na hora mesmo com o produto preso pela compra (nao ganharam aresta nova de trava)",
  async () => {
    await semearCommitado();
    try {
      const gasto = await colunaAlheiaNaoEspera();
      assert.ok(
        gasto < 450,
        `a gravacao de coluna alheia esperou o produto (${gasto} ms)`,
      );
    } finally {
      await limparCommitado();
    }
  },
);

prova(
  "MUTANTE (gatilho em TODO UPDATE e funcao sem o filtro): a coluna alheia passa a esperar o produto preso",
  async () => {
    await semearCommitado();
    try {
      const sem = CORPO.replace(
        /ELSIF \(OLD\.status = 'publicada' OR NEW\.status = 'publicada'\)\n\s+AND \([\s\S]*?\) THEN/,
        "ELSIF true THEN",
      );
      assert.notEqual(sem, CORPO, "o mutante nao tirou o filtro");
      const gasto = await comSabotagemCommitada(
        `${criarFuncao(sem)};\n${recriarGatilho("AFTER INSERT OR DELETE OR UPDATE ON public.reviews FOR EACH ROW")}`,
        colunaAlheiaNaoEspera,
      );
      assert.ok(
        gasto >= 450,
        `sem o filtro a coluna alheia devia esperar ~500 ms, levou ${gasto} ms`,
      );
    } finally {
      await limparCommitado();
    }
  },
);

prova(
  "CONCORRENCIA (apply): uma gravacao em voo segura o CREATE TRIGGER; o apply espera e conclui; a avaliacao em voo (nasceu antes do gatilho) NAO ganha nota ate o proximo evento",
  async () => {
    await semearCommitado();
    const voo = await abrir();
    const aplicador = await abrir();
    try {
      await C.query("BEGIN");
      await C.query(ROLLBACK); // estado ANTES, commitado
      await C.query("COMMIT");
      await voo.query("BEGIN");
      await ins(voo, 0, PA, 5); // em voo, sem commit
      const apply = aplicador.query(`BEGIN;\n${MIGRATION}\nCOMMIT;`).then(
        () => "ok",
        (e) => `erro: ${e.message}`,
      );
      await esperaBloqueada(aplicador.pid); // o CREATE TRIGGER espera a gravacao em voo
      assert.equal(
        await gatilhoExiste(),
        false,
        "o gatilho nao pode existir antes do commit do apply",
      );
      await voo.query("COMMIT");
      assert.equal(await apply, "ok");
      assert.equal(await hashVivo(), H_CORPO);
      assert.deepEqual(
        await notaC(PA),
        { rating: 5, review_count: 0 },
        "a avaliacao em voo nasceu antes do gatilho",
      );
      await ins(C, 1, PA, 3); // proximo evento: recalcula tudo
      assert.deepEqual(await notaC(PA), { rating: 4, review_count: 2 });
    } finally {
      await voo.query("ROLLBACK").catch(() => {});
      await voo.end().catch(() => {});
      await aplicador.end().catch(() => {});
      await C.query("ROLLBACK").catch(() => {});
      await limparCommitado();
      // o estado de saida e' sempre o DEPOIS
      if (!(await funcaoExiste()))
        await C.query(`BEGIN;\n${MIGRATION}\nCOMMIT;`);
    }
  },
);

// ---------------------------------------------------------------------------

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  C.on("notice", (m) => AVISOS.push(m));
  let falhas = 0;
  try {
    for (const t of ["public.reviews", "public.produtos", "public.questions"])
      assert.ok(
        (await C.query("SELECT to_regclass($1) IS NOT NULL AS x", [t])).rows[0]
          .x,
        `a arvore nao tem ${t}`,
      );
    // a arvore sai e termina no DEPOIS (em CI ela ja vem com a migration aplicada)
    if (!(await funcaoExiste())) await C.query(`BEGIN;\n${MIGRATION}\nCOMMIT;`);
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`ok   ${nome}`);
      } catch (e) {
        falhas += 1;
        console.log(
          `FALHOU ${nome}\n     ${String(e.stack || e)
            .split("\n")
            .slice(0, 6)
            .join("\n     ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  console.log(`\n${PROVAS.length - falhas}/${PROVAS.length} provas passaram.`);
  if (falhas) falhar("REPROVADO", `${falhas} prova(s) falharam`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));

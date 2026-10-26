"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261391000000_a_foto_da_devolucao_e_a_pergunta_tem_teto.sql contra o Postgres EFEMERO
 * com as migrations aplicadas do zero (rpc-ci). Nunca banco de loja. O storage.objects daqui e' o minimo do
 * provisionar.cjs (RLS ligada como na plataforma): prova a POLITICA, nao o servico de Storage.
 *
 * O que prova:
 *  (A1) A conta grava ate 30 fotos SOLTAS na propria pasta; a 31a e' recusada pela RLS; outra conta segue gravando;
 *       a pasta alheia continua recusada; foto que uma devolucao referencia NAO conta (a cliente com 6 fotos em uso
 *       grava de novo); apagar uma solta (politica de DELETE da 20261216) libera uma vaga. A funcao da contagem roda
 *       com a RLS de quem chama: outra conta conta zero.
 *  (A2) Controle: com a condicao anterior (rollback) a 31a passa — o teto e' a guarda.
 *  (B1) Pergunta de 500 caracteres passa; 501 e' recusada (23514); 500 emojis (1000 unidades UTF-16) passam (o banco
 *       conta caracteres, nunca e' mais estrito que a tela); pergunta vazia passa (registrado: nada no banco a barra).
 *  (B2) Linha ANTIGA com mais de 500 caracteres: a migration aplica (NOT VALID) e a linha fica; UPDATE dela para outro
 *       texto longo e' recusado, para um curto passa. Controle: sem o CHECK (rollback) 501 passa.
 *  (3)  Reaplicar 2x nao muda a politica, a funcao nem o CHECK; rollback devolve a condicao da 20261175000000 byte a
 *       byte no catalogo e tira a funcao e o CHECK; o segundo rollback recusa; reaplicar volta. Nenhum objeto nem pergunta muda.
 *  (4)  Pre-voo recusa sem escrever: outra politica de INSERT alcancando o bucket, condicao desconhecida, CHECK com outra
 *       regra.
 *  (5)  Consultas 98a/98b nos dois sentidos, com o rol fechado do conferir-banco.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-foto-da-devolucao-e-a-pergunta-tem-teto-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME = "20261391000000_a_foto_da_devolucao_e_a_pergunta_tem_teto.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const C98A = "98a-conferir-a-foto-da-devolucao-e-a-pergunta-tem-teto-aplicado";
const C98B = "98b-antes-a-foto-da-devolucao-e-a-pergunta-tem-teto-base-vigente";
// A condicao que a 20261175000000 deixou, como o catalogo a devolve (pg_get_expr), medida no efemero.
const CONDICAO_175 =
  "((bucket_id = 'devolucoes'::text) AND (split_part(name, '/'::text, 1) = (( SELECT auth.uid() AS uid))::text))";
const TETO = 30;

const U_A = "a1391000-0000-4000-8000-00000000000a";
const U_B = "a1391000-0000-4000-8000-00000000000b";
const PRODUTO = "a1391000-0000-4000-8000-0000000000f1";
const RLS = /new row violates row-level security policy/;

async function isolado(c, acao) {
  await c.query("SAVEPOINT caso391a");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso391a");
    await c.query("RELEASE SAVEPOINT caso391a");
  }
}
/** Roda `sql` como a conta `uid` (authenticated + auth.uid() emulado), num savepoint proprio: erro nao derruba a transacao. */
async function como(c, uid, sql, params = []) {
  await c.query("SAVEPOINT como391a");
  try {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
    await c.query("SET LOCAL ROLE authenticated");
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT como391a");
    return { ok: true, r };
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT como391a");
    await c.query("RELEASE SAVEPOINT como391a");
    return { ok: false, erro };
  }
}
const foto = (c, uid, nome, dono = uid) =>
  como(
    c,
    uid,
    "INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('devolucoes', $1, $2)",
    [`${dono}/pedido391/${nome}.jpg`, uid],
  );
const pergunta = (c, uid, texto) =>
  como(
    c,
    uid,
    "INSERT INTO public.questions (product_id, user_id, question) VALUES ($1, $2, $3) RETURNING id",
    [PRODUTO, uid, texto],
  );
async function politica(c) {
  return (
    await c.query(
      `SELECT polname, polcmd, polpermissive, polroles::regrole[]::text AS papeis, pg_get_expr(polwithcheck, polrelid) AS chk
         FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'devolucoes_cliente_insert_policy'`,
    )
  ).rows[0];
}
async function funcao(c) {
  return (
    await c.query(
      `SELECT p.oid::text AS oid, md5(replace(p.prosrc, chr(13), '')) AS md5, p.prosecdef, p.provolatile, p.proconfig,
              p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS dono,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autenticado,
              EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
         FROM pg_proc p WHERE p.oid = to_regprocedure('public.devolucao__fotos_soltas_da_conta(uuid, integer)')`,
    )
  ).rows[0];
}
async function restricao(c) {
  return (
    await c.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
        WHERE conrelid = 'public.questions'::regclass AND conname = 'questions_question_ate_500_caracteres'`,
    )
  ).rows[0];
}
async function dados(c) {
  return (
    await c.query(
      `SELECT (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]') FROM storage.objects) AS objetos,
              (SELECT COALESCE(jsonb_agg(md5(question) ORDER BY id), '[]') FROM public.questions) AS perguntas`,
    )
  ).rows[0];
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa391a");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa391a");
    await c.query("RELEASE SAVEPOINT recusa391a");
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    // Fixture como dono da conexao, sem chaves estrangeiras (perfil e produto nao interessam aqui).
    await c.query("SET LOCAL session_replication_role = replica");
    for (const uid of [U_A, U_B])
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@teto391.invalid', '{}'::jsonb)`,
        [uid],
      );

    // ---- 0. O topo instalado pelo CI e' o desta migration. ----
    const topo = await politica(c);
    assert.match(
      topo.chk,
      /AND \(\( SELECT devolucao__fotos_soltas_da_conta\(\( SELECT auth\.uid\(\) AS uid\), 30\) AS devolucao__fotos_soltas_da_conta\) < 30\)\)$/,
      "a politica instalada nao e a desta migration",
    );
    assert.equal(topo.papeis, "{authenticated}");
    assert.equal(topo.polcmd, "a");
    assert.ok(topo.polpermissive);
    const topoRestricao = await restricao(c);
    assert.deepEqual(topoRestricao, {
      conname: "questions_question_ate_500_caracteres",
      def: "CHECK ((char_length(question) <= 500)) NOT VALID",
      convalidated: false,
    });
    const topoFuncao = await funcao(c);
    assert.equal(topoFuncao.md5, "0becd6ad09d4fad564a6622654cf0bc6");
    assert.deepEqual(
      [
        topoFuncao.prosecdef,
        topoFuncao.provolatile,
        topoFuncao.proconfig,
        topoFuncao.anon,
        topoFuncao.autenticado,
        topoFuncao.publico,
      ],
      [false, "s", ["search_path=public"], false, true, false],
      "a funcao da contagem nao e SECURITY INVOKER/STABLE/search_path fixo com EXECUTE so de authenticated e service_role",
    );
    console.log(
      "  PASSOU o topo instalado (politica com o teto, funcao SECURITY INVOKER e CHECK NOT VALID)",
    );

    // ---- A1. O teto das fotos soltas. ----
    const cenarioFotos = async () => {
      const r = {};
      for (let i = 1; i <= TETO; i += 1) {
        const f = await foto(c, U_A, `f${i}`);
        if (!f.ok)
          throw new Error(
            `a foto ${i} (dentro do teto) foi recusada: ${f.erro.message}`,
          );
      }
      r.trigesimaPrimeira = await foto(c, U_A, "f31");
      const contar = async (quem, deQuem) =>
        (
          await como(
            c,
            quem,
            "SELECT public.devolucao__fotos_soltas_da_conta($1, 100) AS n",
            [deQuem],
          )
        ).r?.rows[0].n;
      r.contaA = await contar(U_A, U_A);
      r.contaBAntes = await contar(U_B, U_B);
      // Chamada direta com o uid de OUTRA conta: a RLS de quem chama esconde a pasta alheia.
      r.bContandoA = await contar(U_B, U_A);
      r.outraConta = await foto(c, U_B, "b1");
      r.pastaAlheia = await foto(c, U_B, "intrusa", U_A);
      // 6 fotos da A passam a ser evidencia de uma devolucao: deixam de contar.
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query(
        `INSERT INTO public.devolucoes
           (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, valor_itens,
            prazo_ate, politica, fotos)
         VALUES ('DV391A', gen_random_uuid(), $1, 'vicio', 'defeito', 'troca', 'nacional', 'envio_proprio', 0,
                 current_date, '{}'::jsonb, $2::text[])`,
        [U_A, [1, 2, 3, 4, 5, 6].map((i) => `${U_A}/pedido391/f${i}.jpg`)],
      );
      r.liberadas = [];
      for (let i = 1; i <= 7; i += 1)
        r.liberadas.push((await foto(c, U_A, `g${i}`)).ok);
      // Apagar uma solta (a propria cliente, pela politica de DELETE) abre uma vaga.
      r.apagou = await como(
        c,
        U_A,
        "DELETE FROM storage.objects WHERE bucket_id = 'devolucoes' AND name = $1",
        [`${U_A}/pedido391/f30.jpg`],
      );
      r.depoisDeApagar = await foto(c, U_A, "h1");
      r.depoisDaVaga = await foto(c, U_A, "h2");
      return r;
    };
    const novo = await isolado(c, cenarioFotos);
    assert.equal(novo.trigesimaPrimeira.ok, false, "a 31a foto solta passou");
    assert.match(novo.trigesimaPrimeira.erro.message, RLS);
    assert.equal(
      novo.outraConta.ok,
      true,
      "outra conta foi barrada pelo teto da primeira",
    );
    assert.equal(novo.contaA, TETO, "a contagem da propria conta");
    assert.equal(
      novo.contaBAntes,
      0,
      "a contagem da segunda conta (vazia) nao deu zero",
    );
    assert.equal(
      novo.bContandoA,
      0,
      "chamando direto com o uid da primeira, a segunda conta enxergou as fotos dela (a funcao tem de rodar com a RLS de quem chama)",
    );
    assert.equal(novo.pastaAlheia.ok, false, "gravou na pasta de outra conta");
    assert.deepEqual(
      novo.liberadas,
      [true, true, true, true, true, true, false],
      "as 6 fotos em uso por devolucao deviam liberar 6 vagas, e so 6",
    );
    assert.equal(novo.apagou.ok, true);
    assert.equal(
      novo.apagou.r.rowCount,
      1,
      "a cliente nao apagou a propria foto solta",
    );
    assert.equal(
      novo.depoisDeApagar.ok,
      true,
      "apagar uma solta nao liberou a vaga",
    );
    assert.equal(novo.depoisDaVaga.ok, false, "liberou mais de uma vaga");
    console.log(
      "  PASSOU teto: 30 soltas passam, a 31a nao; outra conta segue; foto em uso nao conta; apagar libera uma vaga",
    );

    // ---- A2. Controle: com a condicao anterior (rollback) a 31a passa. ----
    const antigo = await isolado(c, async () => {
      await c.query(rollback);
      assert.equal((await politica(c)).chk, CONDICAO_175);
      return cenarioFotos();
    });
    assert.equal(
      antigo.trigesimaPrimeira.ok,
      true,
      "controle: sem o teto a 31a passava",
    );
    assert.equal(
      antigo.pastaAlheia.ok,
      false,
      "controle: a pasta alheia ja era recusada antes",
    );
    console.log(
      "  PASSOU controle: com a condicao da 20261175000000 a 31a foto passa (o teto e' a guarda)",
    );

    // ---- B1. O teto da pergunta. ----
    const cenarioPerguntas = async () => ({
      p500: (await pergunta(c, U_A, "a".repeat(500))).ok,
      p501: await pergunta(c, U_A, "a".repeat(501)),
      emoji500: (await pergunta(c, U_A, "😀".repeat(500))).ok,
      vazia: (await pergunta(c, U_A, "")).ok,
      espacos: (await pergunta(c, U_A, "   ")).ok,
    });
    const pNovo = await isolado(c, cenarioPerguntas);
    assert.equal(
      pNovo.p500,
      true,
      "a pergunta de 500 caracteres (o teto da tela) foi recusada",
    );
    assert.equal(pNovo.p501.ok, false, "a pergunta de 501 caracteres passou");
    assert.equal(pNovo.p501.erro.code, "23514");
    assert.equal(
      pNovo.emoji500,
      true,
      "500 emojis (1000 unidades UTF-16) foram recusados: o banco ficou mais estrito que a tela",
    );
    // Registrado, nao corrigido aqui: nada no banco recusa pergunta vazia ou so de espacos (a tela barra).
    assert.equal(pNovo.vazia, true);
    assert.equal(pNovo.espacos, true);
    const pAntigo = await isolado(c, async () => {
      await c.query(rollback);
      return cenarioPerguntas();
    });
    assert.equal(
      pAntigo.p501.ok,
      true,
      "controle: sem o CHECK 501 caracteres passavam",
    );
    console.log(
      "  PASSOU pergunta: 500 passa, 501 recusa (23514), 500 emojis passam; controle sem o CHECK aceita 501",
    );

    // ---- B2. Linha ANTIGA longa: NOT VALID nao a reprova; UPDATE longo recusa, curto passa. ----
    await isolado(c, async () => {
      await c.query(rollback);
      const id = (
        await c.query(
          "INSERT INTO public.questions (product_id, user_id, question) VALUES ($1, $2, $3) RETURNING id",
          [PRODUTO, U_A, "x".repeat(900)],
        )
      ).rows[0].id;
      await c.query(migration);
      const linha = (
        await c.query(
          "SELECT char_length(question) AS n FROM public.questions WHERE id = $1",
          [id],
        )
      ).rows[0];
      assert.equal(linha.n, 900, "a pergunta antiga longa foi mexida");
      assert.equal((await restricao(c)).convalidated, false);
      await recusa(
        c,
        `UPDATE public.questions SET question = repeat('y', 600) WHERE id = '${id}'`,
        /questions_question_ate_500_caracteres/,
      );
      await c.query(
        "UPDATE public.questions SET question = 'curta' WHERE id = $1",
        [id],
      );
    });
    console.log(
      "  PASSOU linha antiga de 900 caracteres fica (NOT VALID); UPDATE longo recusa, curto passa",
    );

    // ---- 3. Reaplicar, rollback byte a byte, segundo rollback recusa, reaplicar volta; dados intactos. ----
    await isolado(c, async () => {
      await foto(c, U_A, "existente");
      await pergunta(c, U_A, "Pergunta que ja existia?");
      const d0 = await dados(c);
      await c.query(migration);
      await c.query(migration);
      assert.deepEqual(
        await politica(c),
        topo,
        "reaplicar 2x mudou a politica",
      );
      assert.deepEqual(
        await funcao(c),
        topoFuncao,
        "reaplicar 2x mudou a funcao (OID, dono, ACL ou corpo)",
      );
      assert.deepEqual(
        await restricao(c),
        topoRestricao,
        "reaplicar 2x mudou o CHECK",
      );
      await c.query(rollback);
      const volta = await politica(c);
      assert.deepEqual(
        volta,
        { ...topo, chk: CONDICAO_175 },
        "o rollback nao devolveu a condicao da 20261175000000 byte a byte",
      );
      assert.equal(
        await restricao(c),
        undefined,
        "o rollback nao tirou o CHECK",
      );
      assert.equal(
        await funcao(c),
        undefined,
        "o rollback nao tirou a funcao que a migration criou",
      );
      await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      await c.query(migration);
      assert.deepEqual(
        await politica(c),
        topo,
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
      assert.deepEqual(await restricao(c), topoRestricao);
      assert.deepEqual(
        { ...(await funcao(c)), oid: null },
        { ...topoFuncao, oid: null },
        "reaplicar depois do rollback nao recriou a mesma funcao",
      );
      assert.deepEqual(
        await dados(c),
        d0,
        "aplicar/desfazer mexeu em objeto ou pergunta",
      );
    });
    console.log(
      "  PASSOU reaplicar 2x, rollback byte a byte, segundo rollback recusa, reaplicar volta, dados intactos",
    );

    // ---- 4. Pre-voo recusa sem escrever. ----
    const sabotagens = [
      [
        "outra politica de INSERT alcanca o bucket",
        "CREATE POLICY prova391_intrusa ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'devolucoes')",
      ],
      [
        "condicao desconhecida",
        "ALTER POLICY devolucoes_cliente_insert_policy ON storage.objects WITH CHECK (bucket_id = 'devolucoes')",
      ],
      [
        "CHECK com outra regra",
        "ALTER TABLE public.questions DROP CONSTRAINT questions_question_ate_500_caracteres; " +
          "ALTER TABLE public.questions ADD CONSTRAINT questions_question_ate_500_caracteres CHECK (char_length(question) <= 5000) NOT VALID",
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await c.query(sabotar);
        const antes = [await politica(c), await restricao(c)];
        await recusa(c, migration, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          [await politica(c), await restricao(c)],
          antes,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
      });
    }
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens)`,
    );

    // ---- 5. Consultas 98a/98b nos dois sentidos, com o rol fechado. ----
    const consulta = async (nome) => {
      const rows = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item)
        .sort();
    };
    const daMigration = (nome) =>
      ROL.get(nome)
        .filter((i) => !/controle|nenhuma outra/.test(i))
        .sort();
    assert.equal(daMigration(C98A).length, 3);
    assert.deepEqual(await consulta(C98A), []);
    assert.deepEqual(await consulta(C98B), daMigration(C98B));
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C98B), []);
      assert.deepEqual(await consulta(C98A), daMigration(C98A));
    });
    await isolado(c, async () => {
      await c.query(sabotagens[0][1]);
      assert.deepEqual(await consulta(C98A), [
        "devolucoes: nenhuma outra politica INSERT/ALL alcanca o bucket",
      ]);
    });
    console.log(
      "  PASSOU consultas 98a/98b nos dois sentidos, rol fechado, e a politica intrusa reprova a 98a",
    );

    console.log(
      "\n[a-foto-da-devolucao-e-a-pergunta-tem-teto] todas as provas passaram.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

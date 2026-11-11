"use strict";

/**
 * Isolamento de get_my_cpf() e set_my_cpf(text) no Postgres EFEMERO migrado (migration 20261173000000_o_cpf_mora_na_conta).
 * O CPF e' dado pessoal (LGPD): as duas RPCs SECURITY DEFINER escolhem a conta SOZINHAS, por auth.uid(), e nunca pelo argumento.
 * Hoje so ha teste de TEXTO da migration e provas que chamam como a PROPRIA dona; nada provava que A nao le nem sobrescreve o
 * CPF de B, nem o CPF03 (sessao valida sem linha em profiles: o UPDATE de zero linhas "passa" e o CPF se perderia calado).
 *
 *  1. A grava um CPF valido, e depois LIMPA o seu: o CPF de B continua o mesmo, so o de A mudou (duas provas)
 *  2. get_my_cpf() de A devolve o de A (ou NULL se A nao tem), nunca o de B
 *  3. sessao autenticada cujo uid NAO tem linha em profiles: set_my_cpf(valido) e set_my_cpf('') falham com CPF03 e profiles
 *     NAO ganha linha (duas provas); com a linha existindo, o mesmo CPF grava (controle: o CPF03 nao e' recusa generica)
 *  4. sem sessao: anon nem entra na funcao (42501, REVOKE); authenticated sem auth.uid() recebe CPF02 e get_my_cpf devolve NULL
 *
 * MUTANTES (MUTANTE_R107R=<nome>; nome desconhecido da ERRO). Cada um reaplica o corpo VIVO (pg_get_functiondef) com UMA troca
 * de texto cuja ocorrencia e' conferida (exatamente uma por alvo), dentro da transacao do caso (o ROLLBACK desfaz):
 *   cpf-set-sem-where           set_my_cpf sem o WHERE id = v_user_id nos DOIS UPDATEs (atualiza todos os perfis)
 *   cpf-set-sem-where-gravar    so o UPDATE de gravar            cpf-set-sem-where-limpar    so o UPDATE de limpar
 *   cpf-get-sem-filtro          get_my_cpf sem o WHERE id = auth.uid()
 *   cpf-set-sem-notfound        set_my_cpf sem o IF NOT FOUND ... CPF03 nos DOIS UPDATEs
 *   cpf-set-sem-notfound-gravar / cpf-set-sem-notfound-limpar   so um dos dois
 *
 * Somente o clone descartavel de rodar-isolado.cjs. Sem Docker:
 * CI_BANCO_EFEMERO=1 DATABASE_URL=... node tests/banco/rodar-isolado.cjs tests/banco/o-cpf-so-mexe-na-propria-conta-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const A = "b107a000-0000-4000-8000-000000000001";
const B = "b107a000-0000-4000-8000-000000000002";
const SEM_PERFIL = "b107a000-0000-4000-8000-000000000003";
// CPFs ficticios e matematicamente validos (digitos verificadores corretos); nenhum e' de pessoa real.
const CPF_B = "52998224725";
const CPF_A_ANTIGO = "11144477735";
const CPF_A_NOVO_FORMATADO = "390.533.447-05";
const CPF_A_NOVO = "39053344705";

const sessao = (uid) => ({
  uid,
  claims: JSON.stringify({ sub: uid, role: "authenticated" }),
});

// ---- mutantes: [assinatura, [[regex (exatamente 1 ocorrencia), substituto], ...]] ----
const SET = "public.set_my_cpf(text)";
const GET = "public.get_my_cpf()";
const SEM_WHERE_LIMPAR = [
  /(SET cpf = NULL, updated_at = now\(\))\s+WHERE id = v_user_id;/g,
  "$1;",
];
const SEM_WHERE_GRAVAR = [
  /(SET cpf = v_digitos, updated_at = now\(\))\s+WHERE id = v_user_id;/g,
  "$1;",
];
const SEM_NOTFOUND_LIMPAR = [
  /\n {8}IF NOT FOUND THEN[\s\S]*?END IF;\n {8}RETURN;/g,
  "\n        RETURN;",
];
const SEM_NOTFOUND_GRAVAR = [
  /\n {4}IF NOT FOUND THEN[\s\S]*?END IF;\nEND;/g,
  "\nEND;",
];
const MUTANTES = new Map(
  Object.entries({
    "cpf-set-sem-where": [SET, [SEM_WHERE_LIMPAR, SEM_WHERE_GRAVAR]],
    "cpf-set-sem-where-gravar": [SET, [SEM_WHERE_GRAVAR]],
    "cpf-set-sem-where-limpar": [SET, [SEM_WHERE_LIMPAR]],
    "cpf-get-sem-filtro": [
      GET,
      [
        [
          /(SELECT cpf INTO v_cpf FROM public\.profiles) WHERE id = auth\.uid\(\);/g,
          "$1;",
        ],
      ],
    ],
    "cpf-set-sem-notfound": [SET, [SEM_NOTFOUND_LIMPAR, SEM_NOTFOUND_GRAVAR]],
    "cpf-set-sem-notfound-gravar": [SET, [SEM_NOTFOUND_GRAVAR]],
    "cpf-set-sem-notfound-limpar": [SET, [SEM_NOTFOUND_LIMPAR]],
  }),
);
const MUTANTE = process.env.MUTANTE_R107R;
if (MUTANTE !== undefined && !MUTANTES.has(MUTANTE)) {
  throw new Error(
    `MUTANTE_R107R=${MUTANTE} desconhecido (validos: ${[...MUTANTES.keys()].join(", ")})`,
  );
}

const defVivo = async (assinatura) =>
  (
    await P.conexao().query(
      "SELECT pg_get_functiondef($1::regprocedure) AS d",
      [assinatura],
    )
  ).rows[0].d.replace(/\r/g, "");

/** Reaplica o corpo vivo da funcao-alvo do mutante pedido, SO se a funcao e' a que o mutante sabota. */
async function mutar(funcao) {
  if (MUTANTE === undefined) return;
  const [assinatura, trocas] = MUTANTES.get(MUTANTE);
  if (assinatura !== funcao) return;
  const original = await defVivo(assinatura);
  let alterado = original;
  for (const [alvo, substituto] of trocas) {
    assert.equal(
      [...alterado.matchAll(alvo)].length,
      1,
      `mutante ${MUTANTE}: o alvo ${alvo} deve ocorrer exatamente uma vez`,
    );
    alterado = alterado.replace(alvo, substituto);
  }
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await P.conexao().query(alterado);
  assert.equal(
    await defVivo(assinatura),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
}

async function conta(uid, { perfil = true, cpf = null } = {}) {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
    [uid, `${uid}@r107.fixture.invalid`],
  );
  if (perfil) {
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role, cpf) VALUES ($1, 'Pessoa Ficticia', 'customer', $2)",
      [uid, cpf],
    );
  }
}

/** B entra ANTES de A: sem filtro, a leitura/escrita "pega o primeiro" e cai em B (o erro fica visivel). */
async function semear({ cpfA = CPF_A_ANTIGO } = {}) {
  await conta(B, { cpf: CPF_B });
  await conta(A, { cpf: cpfA });
}

const cpfsGravados = async () =>
  new Map(
    (
      await P.conexao().query(
        "SELECT id, cpf FROM public.profiles WHERE id = ANY ($1::uuid[])",
        [[A, B, SEM_PERFIL]],
      )
    ).rows.map((r) => [r.id, r.cpf]),
  );

const comoA = (sql, params = []) =>
  P.tentar("authenticated", sql, params, sessao(A));

prova(
  "A grava um CPF valido: o CPF de B continua o mesmo, so o de A mudou",
  () =>
    P.emTransacao(async () => {
      await semear();
      await mutar(SET);
      const r = await comoA("SELECT public.set_my_cpf($1)", [
        CPF_A_NOVO_FORMATADO,
      ]);
      assert.ok(r.linhas, `set_my_cpf de A devia gravar: ${r.erro}`);
      assert.deepEqual(
        await cpfsGravados(),
        new Map([
          [A, CPF_A_NOVO],
          [B, CPF_B],
        ]),
        "gravar o CPF de A mexeu no CPF de B (so os digitos de A podem mudar)",
      );
    }),
);

prova(
  "A limpa o seu CPF (''): o CPF de B continua o mesmo, so o de A zerou",
  () =>
    P.emTransacao(async () => {
      await semear();
      await mutar(SET);
      const r = await comoA("SELECT public.set_my_cpf($1)", [""]);
      assert.ok(r.linhas, `set_my_cpf('') de A devia limpar: ${r.erro}`);
      assert.deepEqual(
        await cpfsGravados(),
        new Map([
          [A, null],
          [B, CPF_B],
        ]),
        "limpar o CPF de A zerou o CPF de B (so o de A pode zerar)",
      );
    }),
);

prova("get_my_cpf() de A devolve o CPF de A, nunca o de B", () =>
  P.emTransacao(async () => {
    await semear();
    await mutar(GET);
    const r = await comoA("SELECT public.get_my_cpf() AS cpf");
    assert.ok(r.linhas, `get_my_cpf de A devia responder: ${r.erro}`);
    assert.deepEqual(
      r.linhas,
      [{ cpf: CPF_A_ANTIGO }],
      "get_my_cpf devolveu o CPF de outra conta",
    );
    // B enxerga o proprio (controle: a leitura funciona nos dois sentidos)
    const b = await P.tentar(
      "authenticated",
      "SELECT public.get_my_cpf() AS cpf",
      [],
      sessao(B),
    );
    assert.deepEqual(b.linhas, [{ cpf: CPF_B }]);
  }),
);

prova("A SEM CPF cadastrado le NULL, nunca o CPF de B", () =>
  P.emTransacao(async () => {
    await semear({ cpfA: null });
    await mutar(GET);
    const r = await comoA("SELECT public.get_my_cpf() AS cpf");
    assert.ok(r.linhas, `get_my_cpf de A devia responder: ${r.erro}`);
    assert.deepEqual(
      r.linhas,
      [{ cpf: null }],
      "A nao tem CPF e recebeu o de outra conta",
    );
  }),
);

for (const [rotulo, argumento, mutante] of [
  ["gravar um CPF valido", CPF_A_NOVO, "gravar"],
  ["limpar com ''", "", "limpar"],
]) {
  prova(
    `sessao sem linha em profiles: set_my_cpf para ${rotulo} falha com CPF03 e nao cria linha`,
    () =>
      P.emTransacao(async () => {
        await conta(B, { cpf: CPF_B });
        await conta(SEM_PERFIL, { perfil: false });
        await mutar(SET);
        const antes = await cpfsGravados();
        const r = await P.tentar(
          "authenticated",
          "SELECT public.set_my_cpf($1)",
          [argumento],
          sessao(SEM_PERFIL),
        );
        assert.ok(
          r.erro,
          `sem linha em profiles o set_my_cpf devia FALHAR (${mutante}); passou calado e o CPF se perderia`,
        );
        assert.equal(r.codigo, "CPF03", r.erro);
        assert.match(r.erro, /Perfil n.o encontrado/);
        assert.equal(
          (
            await P.conexao().query(
              "SELECT count(*)::int AS n FROM public.profiles WHERE id = $1",
              [SEM_PERFIL],
            )
          ).rows[0].n,
          0,
          "a recusa nao pode deixar uma linha de perfil para tras",
        );
        assert.deepEqual(
          await cpfsGravados(),
          antes,
          "a recusa mexeu em outro perfil",
        );
      }),
  );
}

prova(
  "controle do CPF03: a MESMA sessao COM linha em profiles grava o CPF",
  () =>
    P.emTransacao(async () => {
      await conta(SEM_PERFIL, { perfil: true });
      const r = await P.tentar(
        "authenticated",
        "SELECT public.set_my_cpf($1)",
        [CPF_A_NOVO],
        sessao(SEM_PERFIL),
      );
      assert.ok(r.linhas, `com perfil devia gravar: ${r.erro}`);
      assert.equal((await cpfsGravados()).get(SEM_PERFIL), CPF_A_NOVO);
    }),
);

prova(
  "sem sessao: authenticated sem uid recebe CPF02 (e nada grava); get_my_cpf devolve NULL",
  () =>
    P.emTransacao(async () => {
      await semear();
      const sem = { uid: "", claims: "" };
      const antes = await cpfsGravados();
      const grava = await P.tentar(
        "authenticated",
        "SELECT public.set_my_cpf($1)",
        [CPF_A_NOVO],
        sem,
      );
      assert.equal(grava.codigo, "CPF02", grava.erro);
      const le = await P.tentar(
        "authenticated",
        "SELECT public.get_my_cpf() AS cpf",
        [],
        sem,
      );
      assert.deepEqual(le.linhas, [{ cpf: null }]);
      assert.deepEqual(await cpfsGravados(), antes);
    }),
);

prova(
  "anon nem entra nas duas funcoes (REVOKE): 42501, e o CPF de ninguem muda",
  () =>
    P.emTransacao(async () => {
      await semear();
      const antes = await cpfsGravados();
      for (const [sql, params] of [
        ["SELECT public.set_my_cpf($1)", [CPF_A_NOVO]],
        ["SELECT public.get_my_cpf()", []],
      ]) {
        const r = await P.tentar("anon", sql, params, { uid: "", claims: "" });
        assert.equal(r.codigo, "42501", `${sql}: ${r.erro}`);
      }
      assert.deepEqual(await cpfsGravados(), antes);
    }),
);

async function main() {
  await P.conectar();
  // auth.uid() do provisionar le app.rpc.user_id; o GRANT so permite conferir a identidade como authenticated/anon neste clone.
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("o CPF so mexe na propria conta");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.stack || erro.message));

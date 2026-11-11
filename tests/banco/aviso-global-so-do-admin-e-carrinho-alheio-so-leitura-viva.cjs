"use strict";

/**
 * Duas politicas de RLS que protegem dado de cliente e nunca tiveram prova viva:
 *
 *  1. public.notificacoes / notificacoes_insert_policy (ultima definicao: 20261340000000):
 *     WITH CHECK (uid = usuario_id OR rls_admin_atual()). A linha com usuario_id NULL e o "recado para todas" e
 *     notificacoes_select_policy a mostra a QUALQUER conta logada; so o admin atual pode cria-la. Se o cliente
 *     conseguisse inserir usuario_id NULL, mandaria um aviso falso (titulo, mensagem e `acao` jsonb a escolha,
 *     vetor de phishing) para o sino de todas as contas.
 *  2. public.cart_items / cart_items_update_policy (baseline, nunca alterada): USING e WITH CHECK
 *     uid = user_id. O cliente so altera as linhas do proprio carrinho e nao move linha para o carrinho de outra.
 *
 * Cenarios (cada prova numa transacao desfeita; SAVEPOINT por tentativa; INSERT sem RETURNING, para a recusa vir do
 * WITH CHECK e nao da policy de SELECT):
 *   (a) cliente comum insere aviso GLOBAL (usuario_id NULL, `acao` com url): 42501, zero linha, e outra conta logada nao o ve;
 *   (b) cliente insere aviso em nome de OUTRA conta: 42501;
 *   (c) controles: cliente insere para si e passa; admin atual insere o global e uma conta qualquer o ve;
 *   (d) B nao altera o carrinho de A: com WHERE na linha de A afeta 0 linhas; E sem WHERE nenhum (a forma que nao le
 *       coluna, logo nao aciona a policy de SELECT) afeta 0 linhas e sem erro. A quantidade de A fica intacta;
 *   (e) A nao move a propria linha para o carrinho de B: 42501 (WITH CHECK) e a linha continua de A;
 *   (f) controle: A altera a propria quantidade e afeta 1 linha.
 *
 * NOTA sobre (d) e (e): a policy de SELECT do carrinho (dono OU admin) tambem vale num UPDATE que LE coluna (WHERE) e
 * para a linha nova. Entao, com WHERE, a linha de A some para B MESMO com a policy de UPDATE sabotada para USING (true),
 * e a linha movida para B e recusada MESMO com WITH CHECK (true): a SELECT mascara a sabotagem. So o UPDATE sem WHERE
 * (SET de constante, nenhuma coluna lida) chega a policy de UPDATE sozinha. Por isso (d) e (e) tem as duas formas, e os
 * mutantes carrinho-update-using-true e carrinho-update-check-true caem na forma sem WHERE.
 *
 * So Postgres EFEMERO ja migrado, pelo rodar-isolado.cjs. Fixtures e mutantes terminam em ROLLBACK.
 *
 * MUTANTE_R111B (nome desconhecido = ERRO):
 *   notificacao-insert-aceita-global         WITH CHECK (uid = usuario_id OR usuario_id IS NULL OR rls_admin_atual())   -> vermelho em (a)
 *   notificacao-insert-aceita-qualquer-logado WITH CHECK (true)                                                          -> vermelho em (a) e (b)
 *   carrinho-update-using-true               USING (true), WITH CHECK intacta                                           -> vermelho em (d)
 *   carrinho-update-check-true               USING intacta, WITH CHECK (true)                                           -> vermelho em (e)
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const A = "b111b000-0000-4000-8000-0000000000a1";
const B = "b111b000-0000-4000-8000-0000000000b2";
const ADMIN = "b111b000-0000-4000-8000-0000000000ad";
const ITEM_A = "b111b000-0000-4000-8000-000000000a10";
const ITEM_B = "b111b000-0000-4000-8000-000000000b20";

const MUTANTES_CONHECIDOS = [
  "notificacao-insert-aceita-global",
  "notificacao-insert-aceita-qualquer-logado",
  "carrinho-update-using-true",
  "carrinho-update-check-true",
];
const MUTANTE = process.env.MUTANTE_R111B;

const sessao = (uid, papel = "customer") => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel === "admin" ? { role: "admin" } : {},
  }),
});
const SESSAO_A = sessao(A);
const SESSAO_B = sessao(B);
const SESSAO_ADMIN = sessao(ADMIN, "admin");

/** Contas ficticias; o admin e admin nas DUAS fontes (profiles e auth.users), que e o que rls_admin_atual() le. */
async function semear() {
  const c = P.conexao();
  await c.query(
    "GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role",
  );
  for (const id of [A, B, ADMIN])
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $2, $3::jsonb)",
      [
        id,
        `${id}@r111b.fixture.invalid`,
        id === ADMIN ? '{"role":"admin"}' : "{}",
      ],
    );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente A ficticia', 'customer'),
       ($2, 'Cliente B ficticia', 'customer'),
       ($3, 'Admin ficticio', 'admin')`,
    [A, B, ADMIN],
  );
}

async function semearCarrinho() {
  await P.conexao().query(
    `INSERT INTO public.cart_items (id, user_id, product_id, variant_id, quantity) VALUES
       ($1, $3, 'produto-ficticio-r111b', 'azul-m', 2),
       ($2, $4, 'produto-ficticio-r111b', 'azul-m', 5)`,
    [ITEM_A, ITEM_B, A, B],
  );
}

const politica = async (tabela, nome) => {
  const r = await P.conexao().query(
    `SELECT cmd, roles::text AS roles, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = $1 AND policyname = $2`,
    [tabela, nome],
  );
  assert.equal(r.rowCount, 1, `a policy ${nome} precisa existir UMA vez`);
  return r.rows[0];
};

/** Sabota a policy VIVA dentro da transacao desfeita; confirma que o trecho existe 1 vez e que a sabotagem pegou. */
async function mutar() {
  if (!MUTANTE) return;
  const c = P.conexao();
  if (MUTANTE.startsWith("notificacao-")) {
    const antes = await politica("notificacoes", "notificacoes_insert_policy");
    assert.equal(antes.cmd, "INSERT");
    assert.equal(
      antes.with_check.split("rls_admin_atual()").length - 1,
      1,
      "o WITH CHECK vivo precisa citar rls_admin_atual() uma vez",
    );
    assert.ok(!antes.with_check.includes("IS NULL"));
    const novo =
      MUTANTE === "notificacao-insert-aceita-global"
        ? "((( SELECT auth.uid() AS uid) = usuario_id) OR (usuario_id IS NULL) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))"
        : "true";
    await c.query(
      `ALTER POLICY notificacoes_insert_policy ON public.notificacoes WITH CHECK (${novo})`,
    );
    const depois = await politica("notificacoes", "notificacoes_insert_policy");
    assert.notEqual(
      depois.with_check,
      antes.with_check,
      "o mutante deve aplicar",
    );
    if (novo === "true") assert.equal(depois.with_check, "true");
    else assert.ok(depois.with_check.includes("IS NULL"));
  } else {
    const antes = await politica("cart_items", "cart_items_update_policy");
    assert.equal(antes.cmd, "UPDATE");
    assert.equal(antes.qual.split("user_id").length - 1, 1);
    assert.equal(antes.with_check.split("user_id").length - 1, 1);
    const clausula =
      MUTANTE === "carrinho-update-using-true"
        ? "USING (true)"
        : "WITH CHECK (true)";
    await c.query(
      `ALTER POLICY cart_items_update_policy ON public.cart_items ${clausula}`,
    );
    const depois = await politica("cart_items", "cart_items_update_policy");
    if (MUTANTE === "carrinho-update-using-true") {
      assert.equal(depois.qual, "true", "o mutante deve abrir o USING");
      assert.equal(depois.with_check, antes.with_check);
    } else {
      assert.equal(depois.with_check, "true", "o mutante deve abrir o CHECK");
      assert.equal(depois.qual, antes.qual);
    }
  }
  console.log(`MUTANTE aplicado: ${MUTANTE}`);
}

const INSERIR_AVISO = `INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, acao)
  VALUES ($1, 'info', $2, 'Mensagem ficticia r111b', $3::jsonb)`;
const ACAO = JSON.stringify({ url: "https://exemplo.invalid" });
const TITULO_GLOBAL = "Aviso global r111b";

const contarAviso = async (titulo) =>
  (
    await P.conexao().query(
      "SELECT count(*)::int AS n FROM public.notificacoes WHERE titulo = $1",
      [titulo],
    )
  ).rows[0].n;

/** Como `P.tentar`, mas devolve tambem o rowCount (UPDATE sem RETURNING: RETURNING aciona a policy de SELECT). */
async function tentarContando(sql, params, identidade) {
  const c = P.conexao();
  await c.query("SAVEPOINT contando");
  try {
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [identidade.uid, identidade.claims],
    );
    await c.query("SET LOCAL ROLE authenticated");
    try {
      const r = await c.query(sql, params);
      return { n: r.rowCount };
    } finally {
      await c.query("RESET ROLE").catch(() => {});
      await c.query("RELEASE SAVEPOINT contando").catch(() => {});
    }
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT contando");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT contando");
    return { erro: e.message, codigo: e.code };
  }
}

const quantidade = async (id) =>
  (
    await P.conexao().query(
      "SELECT quantity, user_id FROM public.cart_items WHERE id = $1",
      [id],
    )
  ).rows[0];

prova("(a) cliente nao cria aviso GLOBAL; outra conta nao o ve", () =>
  P.emTransacao(async () => {
    await semear();
    await mutar();
    assert.equal(await contarAviso(TITULO_GLOBAL), 0, "comeca sem o aviso");
    // Sessao e papel confirmados: authenticated, nao admin.
    assert.deepEqual(
      await P.como(
        "authenticated",
        "SELECT current_user AS papel, auth.uid() AS uid, public.rls_admin_atual() AS admin",
        [],
        SESSAO_A,
      ),
      [{ papel: "authenticated", uid: A, admin: false }],
    );
    const t = await P.tentar(
      "authenticated",
      INSERIR_AVISO,
      [null, TITULO_GLOBAL, ACAO],
      SESSAO_A,
    );
    assert.equal(
      t.codigo,
      "42501",
      "notificacoes_insert_policy deixou o cliente criar o recado para todas as contas",
    );
    assert.match(t.erro, /new row violates row-level security policy/);
    assert.equal(
      await contarAviso(TITULO_GLOBAL),
      0,
      "a tentativa deixou aviso gravado",
    );
    assert.deepEqual(
      await P.como(
        "authenticated",
        "SELECT id FROM public.notificacoes WHERE titulo = $1",
        [TITULO_GLOBAL],
        SESSAO_B,
      ),
      [],
      "outra conta logada viu o aviso falso",
    );
  }),
);

prova("(b) cliente nao cria aviso em nome de OUTRA conta", () =>
  P.emTransacao(async () => {
    await semear();
    await mutar();
    const titulo = "Aviso em nome de B r111b";
    const t = await P.tentar(
      "authenticated",
      INSERIR_AVISO,
      [B, titulo, ACAO],
      SESSAO_A,
    );
    assert.equal(
      t.codigo,
      "42501",
      "o cliente criou aviso no sino de outra conta",
    );
    assert.match(t.erro, /new row violates row-level security policy/);
    assert.equal(await contarAviso(titulo), 0, "a tentativa deixou aviso");
  }),
);

prova("(c) controles: cliente avisa a si; admin atual cria o global", () =>
  P.emTransacao(async () => {
    await semear();
    await mutar();
    // So usuario_id muda em relacao a (b): descarta falha de fixture, CHECK de tipo ou privilegio.
    const proprio = "Aviso proprio r111b";
    const t = await P.tentar(
      "authenticated",
      INSERIR_AVISO,
      [A, proprio, ACAO],
      SESSAO_A,
    );
    assert.equal(t.codigo, undefined, t.erro);
    assert.equal(await contarAviso(proprio), 1, "o aviso proprio devia entrar");
    assert.equal(
      (
        await P.conexao().query(
          "SELECT usuario_id FROM public.notificacoes WHERE titulo = $1",
          [proprio],
        )
      ).rows[0].usuario_id,
      A,
    );
    assert.deepEqual(
      await P.como(
        "authenticated",
        "SELECT public.rls_admin_atual() AS admin",
        [],
        SESSAO_ADMIN,
      ),
      [{ admin: true }],
      "controle: o admin da fixture precisa ser admin atual",
    );
    const g = await P.tentar(
      "authenticated",
      INSERIR_AVISO,
      [null, TITULO_GLOBAL, ACAO],
      SESSAO_ADMIN,
    );
    assert.equal(g.codigo, undefined, g.erro);
    assert.equal(await contarAviso(TITULO_GLOBAL), 1, "global do admin entra");
    assert.equal(
      (
        await P.como(
          "authenticated",
          "SELECT id FROM public.notificacoes WHERE titulo = $1",
          [TITULO_GLOBAL],
          SESSAO_B,
        )
      ).length,
      1,
      "uma conta qualquer precisa ver o recado do admin",
    );
  }),
);

prova("(d) B nao altera o carrinho de A (com e sem WHERE)", () =>
  P.emTransacao(async () => {
    await semear();
    await semearCarrinho();
    await mutar();
    // Forma com WHERE: a policy de SELECT ja esconde a linha de A (ver NOTA no cabecalho).
    const comWhere = await tentarContando(
      "UPDATE public.cart_items SET quantity = 99 WHERE id = $1",
      [ITEM_A],
      SESSAO_B,
    );
    assert.equal(comWhere.erro, undefined, comWhere.erro);
    assert.equal(comWhere.n, 0, "B alterou a linha de A");
    // Forma sem coluna lida: so a policy de UPDATE decide. Sem erro e sem linha: nada a alterar no carrinho de B vazio.
    await P.conexao().query("DELETE FROM public.cart_items WHERE id = $1", [
      ITEM_B,
    ]);
    const semWhere = await tentarContando(
      "UPDATE public.cart_items SET quantity = 99",
      [],
      SESSAO_B,
    );
    assert.equal(
      semWhere.erro,
      undefined,
      `cart_items_update_policy deixou B alcancar a linha de A: ${semWhere.erro}`,
    );
    assert.equal(semWhere.n, 0, "B alterou linhas que nao sao dele");
    assert.deepEqual(
      await quantidade(ITEM_A),
      { quantity: 2, user_id: A },
      "a linha de A mudou",
    );
  }),
);

prova("(e) A nao move a propria linha para o carrinho de B", () =>
  P.emTransacao(async () => {
    await semear();
    await semearCarrinho();
    await mutar();
    // Forma com WHERE: a policy de SELECT tambem vale para a linha NOVA (nao e' do dono, nao e' visivel) e recusa sozinha.
    const comWhere = await tentarContando(
      "UPDATE public.cart_items SET user_id = $2 WHERE id = $1",
      [ITEM_A, B],
      SESSAO_A,
    );
    assert.equal(comWhere.codigo, "42501", "A despejou item no carrinho de B");
    // Forma sem coluna lida (a unica linha de A e' a ITEM_A): so o WITH CHECK da policy de UPDATE decide.
    const t = await tentarContando(
      "UPDATE public.cart_items SET user_id = $1",
      [B],
      SESSAO_A,
    );
    assert.equal(
      t.codigo,
      "42501",
      "o WITH CHECK de cart_items_update_policy deixou A despejar item no carrinho de B",
    );
    assert.match(t.erro, /new row violates row-level security policy/);
    assert.deepEqual(
      await quantidade(ITEM_A),
      { quantity: 2, user_id: A },
      "a linha saiu do carrinho de A",
    );
    assert.equal(
      (
        await P.conexao().query(
          "SELECT count(*)::int AS n FROM public.cart_items WHERE user_id = $1",
          [B],
        )
      ).rows[0].n,
      1,
      "B deve ter so a linha dele",
    );
  }),
);

prova("(f) controle: A altera a propria quantidade", () =>
  P.emTransacao(async () => {
    await semear();
    await semearCarrinho();
    await mutar();
    const t = await tentarContando(
      "UPDATE public.cart_items SET quantity = 7 WHERE id = $1",
      [ITEM_A],
      SESSAO_A,
    );
    assert.equal(t.erro, undefined, t.erro);
    assert.equal(t.n, 1, "A devia alterar a propria linha");
    assert.deepEqual(await quantidade(ITEM_A), { quantity: 7, user_id: A });
    assert.deepEqual(
      await quantidade(ITEM_B),
      { quantity: 5, user_id: B },
      "a linha de B nao pode mudar",
    );
  }),
);

async function main() {
  if (MUTANTE && !MUTANTES_CONHECIDOS.includes(MUTANTE))
    P.falhar(
      "ERRO",
      `MUTANTE_R111B desconhecido: ${MUTANTE} (validos: ${MUTANTES_CONHECIDOS.join(", ")})`,
    );
  await P.conectar();
  try {
    await P.executar("aviso global so do admin e carrinho alheio so leitura");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.stack || erro.message));

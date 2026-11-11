"use strict";

/**
 * `public_profiles` (a copia publica de nome e foto: 20261219000000_perfil_publico_so_de_quem_escreveu.sql:140-150 deixou uma unica
 * policy, `public_profiles_select_policy`, FOR SELECT TO authenticated). A tabela nao tem REVOKE proprio: `authenticated` e `anon`
 * mantem o privilegio PADRAO de escrita do Supabase, e so a RLS barra. A AUSENCIA de policy de INSERT/UPDATE/DELETE e' a guarda.
 *
 * O que protege: o nome e a foto que aparecem sob cada avaliacao e pergunta na vitrine publica (`vw_reviews_public.author_name`
 * e `author_avatar_url`) vem desta tabela, e hoje so o gatilho `sync_public_profile` (profiles -> public_profiles) escreve ali.
 * Com uma policy de escrita larga, uma cliente trocaria nome e foto de outra na vitrine de TODAS as lojas, falsificando autoria de
 * avaliacao e pergunta. Guarda unica, sem REVOKE por tras e sem teste de comportamento: os testes de banco so escreviam ali pela
 * conexao dona (o-nome-do-perfil-tem-teto-no-banco-viva.cjs) ou conferiam o texto da policy (portas-do-banco-viva.cjs).
 *
 * Cenarios (cada um e' uma prova). A e B sao compradoras comuns (SEM serem admin); a B tem avaliacao PUBLICADA, entao a policy de
 * leitura deixa A ver a linha dela (a recusa abaixo nao e' "linha invisivel"):
 *  1. A faz UPDATE da linha da B (nome e foto) e de todas as OUTRAS linhas: 42501 ou 0 linhas, e a linha da B continua igual byte a byte;
 *  2. A faz DELETE da linha da B e de todas as outras: 42501 ou 0 linhas, a linha da B continua igual;
 *  3. A faz INSERT de linha com o id da B e com um id novo: 42501 (a RLS recusa antes da chave e da FK) e a tabela igual;
 *  4. A nem altera nem apaga a PROPRIA linha (o caminho certo e' profiles + gatilho): recusado, linha igual;
 *  5. o visitante (anon, que tem o privilegio padrao mas nenhuma policy) tambem nao escreve: recusado, tabela igual;
 *  6. depois de tudo isso, como anon, `vw_reviews_public.author_name` da B continua o nome real e a foto continua a dela;
 *  7. controle: UPDATE em `profiles` (o caminho legitimo, pela dona) PROPAGA pelo gatilho para public_profiles e para a vitrine,
 *     o que mostra que a tabela nao esta so "congelada" e que as recusas acima sao da RLS;
 *  8. camadas: a unica policy viva de public_profiles e' a de leitura, FOR SELECT TO authenticated, e a RLS esta ligada
 *     (policies permissivas se somam por OR: uma de escrita, ou de qualquer comando para PUBLIC, abriria a porta).
 *
 * UPDATE/DELETE com privilegio e sem policy FILTRAM para 0 linhas (nao erram); o INSERT erra 42501 pelo WITH CHECK. Qualquer outro
 * erro (23505 chave repetida, 23503 FK) significaria que a RLS DEIXOU PASSAR e so a restricao seguraria: tambem e' vermelho.
 *
 * So Postgres EFEMERO (rodar-isolado.cjs). Fixtures e mutantes ficam numa transacao sempre desfeita.
 *
 * MUTANTE_R134D (nome desconhecido = ERRO):
 *   update-de-qualquer-logado     CREATE POLICY FOR UPDATE TO authenticated USING (true)                -> vermelho no 1 e no 4 (e no 6: a foto muda)
 *   delete-de-qualquer-logado     CREATE POLICY FOR DELETE TO authenticated USING (true)                -> vermelho no 2, no 4 e no 6
 *   insert-de-qualquer-logado     CREATE POLICY FOR INSERT TO authenticated WITH CHECK (true)           -> vermelho no 3 e no 4 (o INSERT com o proprio id)
 *   tudo-de-qualquer-um           CREATE POLICY FOR ALL USING (id = auth.uid() OR true) (sem TO)        -> vermelho no 1, 2, 3, 4, 5 e 6
 *   escrita-so-na-propria-linha   CREATE POLICY FOR UPDATE TO authenticated USING (id = auth.uid())     -> vermelho no 4 (o 1 segue verde: a trava das OUTRAS linhas)
 *   (todos tambem derrubam o 8)
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-cliente-nao-escreve-no-perfil-publico-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const U_A = "b134d000-0000-4000-8000-0000000002a1";
const U_B = "b134d000-0000-4000-8000-0000000002b2";
const U_NOVO = "b134d000-0000-4000-8000-0000000002c3"; // sem conta nenhuma: o id "novo" do INSERT
const PRODUTO = "b134d000-0000-4000-8000-0000000002d1";
const R_B = "b134d000-0000-4000-8000-0000000002e1";
const NOME_B = "Autora B Ficticia";
const FOTO_B = "data:image/svg+xml;utf8,<svg/>";

const POLITICA = "public_profiles_select_policy";
const MUTANTES_CONHECIDOS = [
  "update-de-qualquer-logado",
  "delete-de-qualquer-logado",
  "insert-de-qualquer-logado",
  "tudo-de-qualquer-um",
  "escrita-so-na-propria-linha",
];
const MUTANTE = process.env.MUTANTE_R134D;

const identidade = (uid) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: "customer" },
  }),
});
const A = identidade(U_A);
const B = identidade(U_B);

const q = async (sql, params = []) =>
  (await P.conexao().query(sql, params)).rows;

async function semear() {
  const c = P.conexao();
  await c.query("GRANT USAGE ON SCHEMA auth TO anon, authenticated");
  await c.query("GRANT USAGE ON SCHEMA extensions TO anon, authenticated");
  for (const id of [U_A, U_B]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $2, '{}'::jsonb)",
      [id, `${id}@perfil-publico.fixture.invalid`],
    );
  }
  // O gatilho sync_public_profile copia profiles -> public_profiles: e' o caminho de producao da linha publica.
  await c.query(
    `INSERT INTO public.profiles (id, full_name, avatar_url, role) VALUES
       ($1, 'Compradora A Ficticia', NULL, 'customer'), ($2, $3, $4, 'customer')`,
    [U_A, U_B, NOME_B, FOTO_B],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
     VALUES ($1, 'Produto Perfil Ficticio', 100, 10, true, 40)`,
    [PRODUTO],
  );
  await c.query(
    `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status)
     VALUES ($1, $2, $3, 5, 'avaliacao publicada fixture', 'publicada')`,
    [R_B, PRODUTO, U_B],
  );
}

/** A linha inteira como texto (byte a byte), lida pela conexao dona do clone (nao passa por RLS). */
const linha = async (id) =>
  (
    await q(
      "SELECT p::text AS t FROM public.public_profiles p WHERE p.id = $1",
      [id],
    )
  )[0]?.t ?? null;
const tabela = async () =>
  (
    await q(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM public.public_profiles t`,
    )
  )[0];
const politicas = async () =>
  q(
    `SELECT polname, polcmd, polroles::regrole[]::text AS roles, pg_get_expr(polqual, polrelid) AS qual,
            pg_get_expr(polwithcheck, polrelid) AS chk
       FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass ORDER BY polname`,
  );

/** Sabota a trava VIVA (so existe policy de leitura) dentro da transacao desfeita e confere que a sabotagem pegou. */
async function mutar() {
  if (!MUTANTE) return;
  const c = P.conexao();
  const antes = await politicas();
  assert.deepEqual(
    antes.map((p) => [p.polname, p.polcmd]),
    [[POLITICA, "r"]],
    "o mutante precisa partir da unica policy viva (a de leitura)",
  );
  const criar = new Map([
    ["update-de-qualquer-logado", "FOR UPDATE TO authenticated USING (true)"],
    ["delete-de-qualquer-logado", "FOR DELETE TO authenticated USING (true)"],
    [
      "insert-de-qualquer-logado",
      "FOR INSERT TO authenticated WITH CHECK (true)",
    ],
    ["tudo-de-qualquer-um", "FOR ALL USING (id = auth.uid() OR true)"],
    [
      "escrita-so-na-propria-linha",
      "FOR UPDATE TO authenticated USING (id = auth.uid())",
    ],
  ]).get(MUTANTE);
  await c.query(
    `CREATE POLICY mutante_r134d ON public.public_profiles ${criar}`,
  );
  assert.equal((await politicas()).length, 2, "o mutante devia somar a policy");
}

const cenario = (fn) =>
  P.emTransacao(async () => {
    await semear();
    await mutar();
    const base = {
      tabela: await tabela(),
      b: await linha(U_B),
      a: await linha(U_A),
    };
    assert.equal(base.tabela.n, 2, "devia comecar com as linhas de A e B");
    assert.ok(
      base.b.includes(NOME_B) && base.a,
      "as linhas publicas de A e B devem existir (gatilho)",
    );
    await fn(base);
  });

/** Recusa = 42501, ou ZERO linhas quando ha privilegio e nao ha policy (a RLS filtra, nao erra). Outro erro ou linha afetada = vermelho. */
async function recusada(
  rotulo,
  papel,
  id,
  sql,
  params = [],
  { insercao = false } = {},
) {
  const t = await P.tentar(papel, sql, params, id);
  if (t.erro !== undefined) {
    assert.equal(
      t.codigo,
      "42501",
      `${rotulo}: devia ser recusado pela RLS (42501), veio ${t.codigo}: ${t.erro}`,
    );
    return;
  }
  assert.equal(insercao, false, `${rotulo}: o INSERT GRAVOU (devia dar 42501)`);
  assert.deepEqual(
    t.linhas,
    [],
    `${rotulo}: alterou ${t.linhas.length} linha(s)`,
  );
}

const UPD =
  "UPDATE public.public_profiles SET full_name = 'Nome Forjado', avatar_url = 'data:image/svg+xml;utf8,<svg id=\"forjada\"/>' WHERE id = $1 RETURNING id";
// "todas as OUTRAS": a propria linha de A e' assunto do cenario 4, e misturar os dois esconderia qual guarda caiu.
const UPD_OUTRAS =
  "UPDATE public.public_profiles SET full_name = 'Nome Forjado', avatar_url = 'forjada' WHERE id <> auth.uid() RETURNING id";
const UPD_TODAS_ANON =
  "UPDATE public.public_profiles SET full_name = 'Nome Forjado', avatar_url = 'forjada' RETURNING id";
const DEL = "DELETE FROM public.public_profiles WHERE id = $1 RETURNING id";
const DEL_OUTRAS =
  "DELETE FROM public.public_profiles WHERE id <> auth.uid() RETURNING id";
const INS =
  "INSERT INTO public.public_profiles (id, full_name, avatar_url) VALUES ($1, 'Perfil Forjado', 'forjada')";

prova(
  "1. a cliente nao troca nome e foto publicos de outra (nem das outras): recusado e a linha da B igual byte a byte",
  () =>
    cenario(async (base) => {
      await recusada("UPDATE da linha da B", "authenticated", A, UPD, [U_B]);
      await recusada(
        "UPDATE das outras linhas",
        "authenticated",
        A,
        UPD_OUTRAS,
      );
      assert.equal(await linha(U_B), base.b, "a linha publica da B mudou");
      assert.deepEqual(await tabela(), base.tabela);
    }),
);

prova(
  "2. a cliente nao apaga o perfil publico de outra (nem das outras): recusado e a linha da B igual",
  () =>
    cenario(async (base) => {
      await recusada("DELETE da linha da B", "authenticated", A, DEL, [U_B]);
      await recusada(
        "DELETE das outras linhas",
        "authenticated",
        A,
        DEL_OUTRAS,
      );
      assert.equal(
        await linha(U_B),
        base.b,
        "a linha publica da B mudou ou sumiu",
      );
      assert.deepEqual(await tabela(), base.tabela);
    }),
);

prova(
  "3. a cliente nao insere linha publica (com o id da B nem com id novo): 42501 e a tabela igual",
  () =>
    cenario(async (base) => {
      await recusada("INSERT com o id da B", "authenticated", A, INS, [U_B], {
        insercao: true,
      });
      await recusada("INSERT com id novo", "authenticated", A, INS, [U_NOVO], {
        insercao: true,
      });
      assert.deepEqual(await tabela(), base.tabela);
      assert.equal(await linha(U_B), base.b);
    }),
);

prova(
  "4. a cliente nem altera nem apaga a PROPRIA linha publica (o caminho certo e' profiles + gatilho)",
  () =>
    cenario(async (base) => {
      await recusada("UPDATE da propria linha", "authenticated", A, UPD, [U_A]);
      await recusada("DELETE da propria linha", "authenticated", A, DEL, [U_A]);
      await recusada(
        "INSERT com o proprio id",
        "authenticated",
        A,
        INS,
        [U_A],
        { insercao: true },
      );
      assert.equal(await linha(U_A), base.a, "a propria linha publica mudou");
      assert.deepEqual(await tabela(), base.tabela);
    }),
);

prova(
  "5. o visitante (anon) tambem nao escreve em public_profiles: recusado e a tabela igual",
  () =>
    cenario(async (base) => {
      await recusada("UPDATE como anon", "anon", {}, UPD, [U_B]);
      await recusada("UPDATE de todas como anon", "anon", {}, UPD_TODAS_ANON);
      await recusada("DELETE como anon", "anon", {}, DEL, [U_B]);
      await recusada("INSERT como anon", "anon", {}, INS, [U_NOVO], {
        insercao: true,
      });
      assert.deepEqual(await tabela(), base.tabela);
      assert.equal(await linha(U_B), base.b);
    }),
);

const vitrineDaB = async () => {
  const t = await P.tentar(
    "anon",
    "SELECT author_name, author_avatar_url FROM public.vw_reviews_public WHERE id = $1",
    [R_B],
    {},
  );
  assert.equal(t.erro, undefined, `anon devia ler a vitrine: ${t.erro}`);
  return t.linhas;
};

prova(
  "6. depois das tentativas de A, o visitante continua vendo o nome e a foto REAIS da B na vitrine",
  () =>
    cenario(async () => {
      assert.deepEqual(
        await vitrineDaB(),
        [{ author_name: NOME_B, author_avatar_url: FOTO_B }],
        "controle: antes",
      );
      await recusada("UPDATE da linha da B", "authenticated", A, UPD, [U_B]);
      await recusada(
        "UPDATE das outras linhas",
        "authenticated",
        A,
        UPD_OUTRAS,
      );
      await recusada("DELETE da linha da B", "authenticated", A, DEL, [U_B]);
      assert.deepEqual(
        await vitrineDaB(),
        [{ author_name: NOME_B, author_avatar_url: FOTO_B }],
        "a vitrine mostra outro nome ou outra foto da B",
      );
    }),
);

prova(
  "7. controle: o UPDATE da dona em profiles propaga pelo gatilho para public_profiles e para a vitrine",
  () =>
    cenario(async () => {
      const t = await P.tentar(
        "authenticated",
        "UPDATE public.profiles SET full_name = 'Autora B Renomeada' WHERE id = $1 RETURNING id",
        [U_B],
        B,
      );
      assert.equal(
        t.erro,
        undefined,
        `a dona devia alterar o proprio perfil: ${t.erro}`,
      );
      assert.deepEqual(t.linhas, [{ id: U_B }]);
      assert.equal(
        (
          await q(
            "SELECT full_name FROM public.public_profiles WHERE id = $1",
            [U_B],
          )
        )[0].full_name,
        "Autora B Renomeada",
        "o gatilho nao propagou o nome para public_profiles",
      );
      assert.deepEqual(await vitrineDaB(), [
        { author_name: "Autora B Renomeada", author_avatar_url: FOTO_B },
      ]);
    }),
);

prova(
  "8. camadas: a unica policy viva de public_profiles e' a de leitura (FOR SELECT TO authenticated) e a RLS esta ligada",
  () =>
    cenario(async () => {
      const lista = await politicas();
      assert.deepEqual(
        lista.map((p) => [p.polname, p.polcmd, p.roles]),
        [[POLITICA, "r", "{authenticated}"]],
        `policies permissivas se somam por OR: ${JSON.stringify(lista.map((p) => p.polname))}`,
      );
      assert.equal(
        (
          await q(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.public_profiles'::regclass",
          )
        )[0].relrowsecurity,
        true,
        "RLS desligada em public_profiles",
      );
    }),
);

async function main() {
  if (MUTANTE && !MUTANTES_CONHECIDOS.includes(MUTANTE))
    P.falhar(
      "ERRO",
      `MUTANTE_R134D desconhecido: ${MUTANTE} (validos: ${MUTANTES_CONHECIDOS.join(", ")})`,
    );
  await P.conectar();
  try {
    await P.executar("o cliente nao escreve no perfil publico");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));

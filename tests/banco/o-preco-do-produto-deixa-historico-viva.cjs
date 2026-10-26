"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os unicos caminhos lidos sao os arquivos desta migration e das consultas 91a/91b, montados daqui (nunca entrada de rede). */
// SOMENTE Postgres efêmero do CI (rodar-isolado.cjs: clone descartável); nunca banco de loja.
// Migration 20261386000000: o preço do produto passa a deixar histórico (passo 1 da promoção sem "De" digitado).
//
// Parte 1 (conexões reais, com COMMIT, no clone): o estado de ANTES, a trava de 5 s sem deixar nada pela metade, o pós-voo
// que desfaz o arquivo inteiro numa transação (como o aplicador), e a janela entre "li os produtos" e "o gatilho existe"
// (um salvamento que chega no meio espera e depois nasce COM linha).
// Parte 2 (uma transação, desfeita no fim): o backfill do que já existia, o gatilho em todos os caminhos de gravação do
// preço (INSERT, UPDATE, mesmo preço, outro campo, em massa, upsert, salvar_produto_com_grade), quem lê e quem escreve,
// a guarda do preço NULL, o ON DELETE CASCADE, os dois rollbacks e o pré-voo. Três mutantes do gatilho reprovam a matriz.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const ROOT = path.resolve(__dirname, "../..");
const ARQ = "20261386000000_o_preco_do_produto_deixa_historico.sql";
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = ler(`supabase/migrations/${ARQ}`);
const rollback = ler(`supabase/migrations/rollback-manual-${ARQ}`);
const destrutivo = ler(`supabase/migrations/rollback-manual-destrutivo-${ARQ}`);
const CONSULTA_A = ler(
  "scripts/publicacao/consultas/91a-conferir-o-preco-do-produto-deixa-historico-aplicado.sql",
);
const CONSULTA_B = ler(
  "scripts/publicacao/consultas/91b-antes-o-preco-do-produto-deixa-historico-ausente.sql",
);
const CONFIRMA =
  "SET LOCAL app.confirmo_apagar_historico_de_preco = 'APAGAR';\n";

const ADMIN = "38600000-0000-4000-8000-000000000001";
const CLIENTE = "38600000-0000-4000-8000-000000000002";
const EX_ADMIN = "38600000-0000-4000-8000-000000000003";
const url = lerDatabaseUrlEfemera();
const novoCliente = async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
};

async function tentar(c, sql, params = []) {
  await c.query("SAVEPOINT tentativa");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT tentativa");
    return { linhas: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa");
    return { codigo: e.code, erro: e.message };
  }
}

// Entra como um papel do Supabase (anon/authenticated/service_role) com a pessoa dada; sempre sai do papel no fim.
async function como(c, papel, uid, acao) {
  await c.query("RESET ROLE");
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid ?? ""]);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      role: papel,
      sub: uid ?? undefined,
      app_metadata: { role: uid === ADMIN ? "admin" : "customer" },
    }),
  ]);
  // Só literais fechados deste teste, nunca identificador recebido de rede.
  if (papel === "anon") await c.query("SET LOCAL ROLE anon");
  else if (papel === "authenticated")
    await c.query("SET LOCAL ROLE authenticated");
  else if (papel === "service_role")
    await c.query("SET LOCAL ROLE service_role");
  try {
    return await acao();
  } finally {
    await c.query("RESET ROLE");
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [""]);
  }
}

async function estado(c) {
  return (
    await c.query(`SELECT
      to_regclass('public.produto_historico_preco') IS NOT NULL AS tabela,
      to_regprocedure('public.registrar_historico_de_preco()') IS NOT NULL AS funcao,
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.produtos'::regclass
               AND tgname = 'tr_produto_historico_de_preco' AND NOT tgisinternal) AS gatilho,
      COALESCE((SELECT count(*) FROM pg_policy
                 WHERE polrelid = to_regclass('public.produto_historico_preco')), 0)::int AS politicas`)
  ).rows[0];
}

// As consultas de publicacao (91a depois, 91b antes): devolvem as linhas {item, ok}. Antes do apply a 91a responde "nao", nunca erro.
async function conferir(c, sql, linhas, passa) {
  const r = (await c.query(sql)).rows;
  assert.equal(r.length, linhas);
  const controle = "controle: catalogo publico visivel";
  assert.equal(r.find((x) => x.item === controle).ok, true);
  assert.equal(
    r.filter((x) => x.item !== controle).every((x) => x.ok === true),
    passa,
    JSON.stringify(r.filter((x) => x.ok !== true)),
  );
  return r;
}

async function semHistorico(c) {
  // O estado de ANTES da migration, no clone descartável: tira o comum e depois a tabela.
  await c.query(rollback);
  await c.query(CONFIRMA + destrutivo);
}

async function esperarBloqueio(c, pid) {
  for (let i = 0; i < 60; i++) {
    const r = await c.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("o salvamento concorrente não esperou o lock da migration");
}

// ---------- A matriz do gatilho: o que cada caminho de gravação do preço deixa no histórico ----------
const funcaoComCorpo = (corpo, definer = true) => `
  CREATE OR REPLACE FUNCTION public.registrar_historico_de_preco()
   RETURNS trigger LANGUAGE plpgsql ${definer ? "SECURITY DEFINER" : ""}
   SET search_path = pg_catalog, pg_temp
  AS $f$ BEGIN ${corpo} RETURN NULL; END; $f$`;

const CORPO_CERTO = `
  IF NEW.preco_venda IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.produto_historico_preco (produto_id, preco, preco_anterior, mudado_em, mudado_por, origem)
    VALUES (NEW.id, NEW.preco_venda, NULL, clock_timestamp(), auth.uid(), 'cadastro');
  ELSIF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda THEN
    INSERT INTO public.produto_historico_preco (produto_id, preco, preco_anterior, mudado_em, mudado_por, origem)
    VALUES (NEW.id, NEW.preco_venda, OLD.preco_venda, clock_timestamp(), auth.uid(), 'mudanca');
  END IF;`;
// Mutantes: cada um tem de reprovar a matriz (ou, o terceiro, quebrar o salvamento de quem não tem escrita na tabela).
const MUTANTES = {
  "sem a guarda de valor (grava a cada UPDATE OF)": CORPO_CERTO.replace(
    "ELSIF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda THEN",
    "ELSIF TRUE THEN",
  ),
  "sem o registro do cadastro": CORPO_CERTO.replace(
    "IF TG_OP = 'INSERT' THEN",
    "IF TG_OP = 'INSERT' THEN NULL; ELSIF FALSE THEN",
  ),
};

async function matriz(c, nomeBase) {
  const hist = async (ids) =>
    (
      await c.query(
        `SELECT p.nome || ':' || h.origem || ':' || h.preco::text || ':' || COALESCE(h.preco_anterior::text, 'null') AS s
           FROM public.produto_historico_preco h JOIN public.produtos p ON p.id = h.produto_id
          WHERE h.produto_id = ANY($1::uuid[]) ORDER BY h.mudado_em, h.id`,
        [ids],
      )
    ).rows.map((r) => r.s);
  const admin = (acao) => como(c, "authenticated", ADMIN, acao);
  const passos = {};
  let visto = [];
  const novas = async (ids) => {
    const todas = await hist(ids);
    const delta = todas.slice(visto.length);
    visto = todas;
    return delta;
  };

  const P = (
    await admin(() =>
      c.query(
        "INSERT INTO public.produtos (nome, custo, preco_venda) VALUES ($1, 1, 10) RETURNING id",
        [`${nomeBase} P`],
      ),
    )
  ).rows[0].id;
  passos["1 cadastro"] = await novas([P]);
  const upd = (sql, params = []) => admin(() => c.query(sql, [P, ...params]));
  await upd("UPDATE public.produtos SET preco_venda = 12.5 WHERE id = $1");
  passos["2 mudou o preco"] = await novas([P]);
  await upd("UPDATE public.produtos SET nome = $2 WHERE id = $1", [
    `${nomeBase} P`,
  ]);
  passos["3 mudou outro campo"] = await novas([P]);
  await upd("UPDATE public.produtos SET preco_venda = 12.5 WHERE id = $1");
  passos["4 mesmo preco"] = await novas([P]);
  await upd(
    "UPDATE public.produtos SET nome = $2, preco_venda = 12.50 WHERE id = $1",
    [`${nomeBase} P`],
  );
  passos["5 mesmo preco e outro campo"] = await novas([P]);
  await admin(async () => {
    await c.query("UPDATE public.produtos SET preco_venda = 13 WHERE id = $1", [
      P,
    ]);
    await c.query("UPDATE public.produtos SET preco_venda = 14 WHERE id = $1", [
      P,
    ]);
  });
  passos["6 dois precos na mesma transacao"] = await novas([P]);

  const A = (
    await c.query(
      "INSERT INTO public.produtos (nome, custo, preco_venda) VALUES ($1, 1, 10) RETURNING id",
      [`${nomeBase} A`],
    )
  ).rows[0].id;
  const B = (
    await c.query(
      "INSERT INTO public.produtos (nome, custo, preco_venda) VALUES ($1, 1, 20) RETURNING id",
      [`${nomeBase} B`],
    )
  ).rows[0].id;
  const Cc = (
    await c.query(
      "INSERT INTO public.produtos (nome, custo, preco_venda) VALUES ($1, 1, 30) RETURNING id",
      [`${nomeBase} C`],
    )
  ).rows[0].id;
  const tres = [A, B, Cc];
  visto = await hist([P, ...tres]);
  await c.query(
    "UPDATE public.produtos SET preco_venda = CASE WHEN id = $2 THEN preco_venda ELSE preco_venda + 1 END WHERE id = ANY($1::uuid[])",
    [tres, B],
  );
  passos["7 em massa (3 produtos, 2 mudam)"] = (
    await novas([P, ...tres])
  ).sort();
  await c.query(
    "UPDATE public.produtos SET preco_venda = preco_venda WHERE id = ANY($1::uuid[])",
    [tres],
  );
  passos["8 em massa sem mudar"] = await novas([P, ...tres]);

  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda) VALUES ($1, 'x', 1, 20)
       ON CONFLICT (id) DO UPDATE SET preco_venda = EXCLUDED.preco_venda`,
    [P],
  );
  passos["9 upsert que cai no UPDATE"] = await novas([P, ...tres]);

  const salvar = (patch) =>
    admin(() =>
      c.query(
        "SELECT public.salvar_produto_com_grade($1::uuid, NULL::timestamptz, $2::jsonb, '[]'::jsonb, ARRAY[]::uuid[])",
        [P, JSON.stringify(patch)],
      ),
    );
  await salvar({ preco_venda: 21 });
  passos["10 salvar_produto_com_grade com preco novo"] = await novas([
    P,
    ...tres,
  ]);
  await salvar({ preco_venda: 21 });
  passos["11 salvar_produto_com_grade com o mesmo preco"] = await novas([
    P,
    ...tres,
  ]);
  await salvar({ nome: `${nomeBase} P` });
  passos["12 salvar_produto_com_grade sem preco no payload"] = await novas([
    P,
    ...tres,
  ]);
  return passos;
}

const ESPERADO = (nome) => ({
  "1 cadastro": [`${nome} P:cadastro:10.00:null`],
  "2 mudou o preco": [`${nome} P:mudanca:12.50:10.00`],
  "3 mudou outro campo": [],
  "4 mesmo preco": [],
  "5 mesmo preco e outro campo": [],
  "6 dois precos na mesma transacao": [
    `${nome} P:mudanca:13.00:12.50`,
    `${nome} P:mudanca:14.00:13.00`,
  ],
  "7 em massa (3 produtos, 2 mudam)": [
    `${nome} A:mudanca:11.00:10.00`,
    `${nome} C:mudanca:31.00:30.00`,
  ],
  "8 em massa sem mudar": [],
  "9 upsert que cai no UPDATE": [`${nome} P:mudanca:20.00:14.00`],
  "10 salvar_produto_com_grade com preco novo": [
    `${nome} P:mudanca:21.00:20.00`,
  ],
  "11 salvar_produto_com_grade com o mesmo preco": [],
  "12 salvar_produto_com_grade sem preco no payload": [],
});

async function main() {
  const C = await novoCliente();
  const extras = [];
  try {
    // ================= PARTE 1: conexões reais, com COMMIT (clone descartável) =================
    await C.query("RESET ROLE");
    for (const [id, papelAuth, papelPerfil] of [
      [ADMIN, "admin", "admin"],
      [CLIENTE, "customer", "customer"],
      [EX_ADMIN, "admin", "customer"], // ex-admin: só auth.users ainda diz admin
    ]) {
      await C.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@preco386.invalid', $2::jsonb)`,
        [id, JSON.stringify(papelAuth === "admin" ? { role: "admin" } : {})],
      );
      await C.query(
        `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Ficticio 386', $2)
           ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papelPerfil],
      );
      await C.query(
        "UPDATE auth.users SET raw_app_meta_data = $2::jsonb WHERE id = $1::uuid",
        [id, JSON.stringify(papelAuth === "admin" ? { role: "admin" } : {})],
      );
    }

    // Em CI a migration já veio no apply do zero: o estado de ANTES se obtém desfazendo (rollback comum + destrutivo).
    await semHistorico(C);
    assert.deepEqual(await estado(C), {
      tabela: false,
      funcao: false,
      gatilho: false,
      politicas: 0,
    });

    await conferir(C, CONSULTA_B, 4, true); // a 91b positiva antes do apply
    await conferir(C, CONSULTA_A, 8, false); // a 91a negativa antes do apply: responde "nao", nao da erro

    // Produtos que JÁ existiam antes da migration (um ativo, um pausado, um na lixeira).
    const antesDaMigration = [];
    for (const [nome, preco, ativo, lixeira] of [
      ["Prova386 Existente Ativo", "10.00", true, false],
      ["Prova386 Existente Pausado", "25.50", false, false],
      ["Prova386 Existente Lixeira", "7.00", true, true],
    ]) {
      antesDaMigration.push(
        (
          await C.query(
            `INSERT INTO public.produtos (nome, custo, preco_venda, ativo, deleted_at)
             VALUES ($1, 1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END) RETURNING id`,
            [nome, preco, ativo, lixeira],
          )
        ).rows[0].id,
      );
    }
    const totalAntes = Number(
      (await C.query("SELECT count(*) AS n FROM public.produtos")).rows[0].n,
    );
    const precosAntes = (
      await C.query(
        "SELECT id::text, preco_venda::text FROM public.produtos ORDER BY id",
      )
    ).rows;

    // ---- 1A. Salvamento em andamento: a migration FALHA em ~5 s e não deixa nada pela metade ----
    const C1 = await novoCliente();
    const C2 = await novoCliente();
    const C3 = await novoCliente();
    extras.push(C1, C2, C3);
    await C1.query("BEGIN");
    await C1.query(
      "UPDATE public.produtos SET nome = nome || '' WHERE id = $1",
      [antesDaMigration[0]],
    );
    await C2.query("BEGIN");
    const t0 = Date.now();
    const trava = await tentar(C2, migration);
    const gasto = Date.now() - t0;
    assert.equal(
      trava.codigo,
      "55P03",
      `esperava lock_timeout, veio ${trava.codigo} ${trava.erro}`,
    );
    assert(
      gasto >= 4000 && gasto < 15000,
      `a espera de ${gasto} ms nao e a de 5 s`,
    );
    await C2.query("ROLLBACK");
    await C1.query("ROLLBACK");
    assert.deepEqual(
      await estado(C),
      { tabela: false, funcao: false, gatilho: false, politicas: 0 },
      "nada pela metade",
    );

    // ---- 1B. A janela: o salvamento que chega NO MEIO da migration espera e depois nasce com linha ----
    await C2.query("BEGIN");
    await C2.query(migration);
    const tMigracao = (await C2.query("SELECT now()::text AS t")).rows[0].t;
    // A leitura de produtos (a vitrine) NAO espera a migration: so a escrita espera (SHARE ROW EXCLUSIVE, nao ACCESS EXCLUSIVE).
    const L = await novoCliente();
    extras.push(L);
    await L.query("SET lock_timeout = '2s'");
    assert.equal(
      Number(
        (await L.query("SELECT count(*) AS n FROM public.produtos")).rows[0].n,
      ),
      totalAntes,
      "ler produtos durante a migration nao espera",
    );
    const insercao = C3.query(
      "INSERT INTO public.produtos (nome, custo, preco_venda) VALUES ('Prova386 Durante', 1, 33.33) RETURNING id",
    );
    insercao.catch(() => {});
    await esperarBloqueio(C, C3.processID);
    await C2.query("COMMIT");
    const idDurante = (await insercao).rows[0].id;
    assert.deepEqual(await estado(C), {
      tabela: true,
      funcao: true,
      gatilho: true,
      politicas: 1,
    });
    await conferir(C, CONSULTA_A, 8, true); // a 91a positiva depois do apply
    // Reaplicar (o gatilho JA existe) tambem nao trava a leitura da vitrine: CREATE OR REPLACE TRIGGER, nao DROP TRIGGER (ACCESS EXCLUSIVE).
    await C2.query("BEGIN");
    await C2.query(migration);
    assert.equal(
      Number(
        (await L.query("SELECT count(*) AS n FROM public.produtos")).rows[0].n,
      ),
      totalAntes + 1,
      "ler produtos durante a REAPLICACAO nao espera",
    );
    await C2.query("ROLLBACK");
    assert.equal(
      (await conferir(C, CONSULTA_B, 4, false)).filter((x) => x.ok !== true)
        .length,
      1,
      "depois do apply so a linha dos objetos novos da 91b vira nao",
    );
    const linhas = (
      await C.query(
        `SELECT produto_id::text AS id, origem, preco::text, preco_anterior::text AS anterior, mudado_por::text AS por,
                (mudado_em = $1::timestamptz) AS data_da_migracao, (mudado_em > $1::timestamptz) AS depois
           FROM public.produto_historico_preco ORDER BY mudado_em, id`,
        [tMigracao],
      )
    ).rows;
    assert.equal(
      linhas.length,
      totalAntes + 1,
      "uma linha por produto, nem a mais nem a menos",
    );
    for (const p of precosAntes) {
      const l = linhas.filter((x) => x.id === p.id);
      assert.equal(l.length, 1, `produto ${p.id} sem exatamente uma linha`);
      assert.deepEqual(
        {
          o: l[0].origem,
          p: l[0].preco,
          a: l[0].anterior,
          por: l[0].por,
          d: l[0].data_da_migracao,
        },
        { o: "migracao", p: p.preco_venda, a: null, por: null, d: true },
        "o que ja existia: preco de hoje, sem anterior, sem autor, data da migration (nenhuma data inventada)",
      );
    }
    const durante = linhas.filter((x) => x.id === idDurante);
    assert.deepEqual(
      durante.map((x) => [x.origem, x.preco, x.anterior, x.depois]),
      [["cadastro", "33.33", null, true]],
      "o produto salvo durante a migration nasceu com a linha de cadastro",
    );

    // ---- 1C. Pós-voo que falha: o arquivo inteiro se desfaz (transação do aplicador), nada fica ----
    await C.query(rollback); // fica a tabela com as linhas, sem gatilho/funcao/politica
    await C.query(
      "CREATE POLICY sabotagem_386 ON public.produto_historico_preco FOR INSERT TO authenticated WITH CHECK (true)",
    );
    const totalLinhas = Number(
      (
        await C.query(
          "SELECT count(*) AS n FROM public.produto_historico_preco",
        )
      ).rows[0].n,
    );
    await C2.query("BEGIN");
    const posvoo = await tentar(C2, migration);
    assert.match(posvoo.erro ?? "", /B2_POSVOO_DIVERGENTE/);
    await C2.query("ROLLBACK");
    assert.deepEqual(
      await estado(C),
      { tabela: true, funcao: false, gatilho: false, politicas: 1 },
      "so a sabotagem ficou",
    );
    await C.query(
      "DROP POLICY sabotagem_386 ON public.produto_historico_preco",
    );
    // Reaplicar depois do rollback comum religa tudo, sem duplicar linha (o produto que ja tinha linha nao ganha outra).
    await C.query(migration);
    assert.deepEqual(await estado(C), {
      tabela: true,
      funcao: true,
      gatilho: true,
      politicas: 1,
    });
    assert.equal(
      Number(
        (
          await C.query(
            "SELECT count(*) AS n FROM public.produto_historico_preco",
          )
        ).rows[0].n,
      ),
      totalLinhas,
    );

    // ================= PARTE 2: uma transação, desfeita no fim =================
    await C.query("BEGIN");
    try {
      // ---- 2A. Reaplicar duas vezes: idempotente, nenhuma linha nova, mesmos ids ----
      const ids0 = (
        await C.query(
          "SELECT id::text FROM public.produto_historico_preco ORDER BY id",
        )
      ).rows;
      await C.query(migration);
      await C.query(migration);
      assert.deepEqual(
        (
          await C.query(
            "SELECT id::text FROM public.produto_historico_preco ORDER BY id",
          )
        ).rows,
        ids0,
      );

      // ---- 2B. Cada caminho de gravação do preço (admin autenticado, pela RLS, como o painel) ----
      const OK = ESPERADO("Prova386 M0");
      assert.deepEqual(await matriz(C, "Prova386 M0"), OK);
      const autoria = (
        await C.query(
          `SELECT h.origem, h.mudado_por::text AS por FROM public.produto_historico_preco h
             JOIN public.produtos p ON p.id = h.produto_id WHERE p.nome = 'Prova386 M0 P' ORDER BY h.mudado_em, h.id`,
        )
      ).rows;
      assert.deepEqual(
        autoria.map((r) => [r.origem, r.por]),
        [
          ["cadastro", ADMIN],
          ["mudanca", ADMIN],
          ["mudanca", ADMIN],
          ["mudanca", ADMIN],
          ["mudanca", null], // o upsert do passo 9 rodou sem sessao
          ["mudanca", ADMIN], // salvar_produto_com_grade pelo admin
        ],
        "mudado_por e quem salvou (auth.uid() atravessa o SECURITY DEFINER); sem sessao fica NULL",
      );
      const estritos = (
        await C.query(
          `SELECT count(*) = count(DISTINCT h.mudado_em) AS estrito FROM public.produto_historico_preco h
             JOIN public.produtos p ON p.id = h.produto_id WHERE p.nome = 'Prova386 M0 P'`,
        )
      ).rows[0].estrito;
      assert.equal(
        estritos,
        true,
        "duas mudancas na mesma transacao saem em ordem (mudado_em estritamente crescente)",
      );
      // Sem sessao (SQL direto/servico): grava com mudado_por NULL.
      const semAutor = (
        await C.query(
          `INSERT INTO public.produtos (nome, custo, preco_venda) VALUES ('Prova386 Sem Autor', 1, 5) RETURNING id`,
        )
      ).rows[0].id;
      assert.deepEqual(
        (
          await C.query(
            "SELECT origem, mudado_por FROM public.produto_historico_preco WHERE produto_id = $1",
            [semAutor],
          )
        ).rows,
        [{ origem: "cadastro", mudado_por: null }],
      );

      // ---- 2C. Mutantes: cada defeito do gatilho reprova a matriz; sem SECURITY DEFINER o salvamento QUEBRA ----
      for (const [rotulo, corpo] of Object.entries(MUTANTES)) {
        await C.query("SAVEPOINT mutante");
        await C.query(funcaoComCorpo(corpo));
        const obtido = await matriz(C, "Prova386 MX");
        assert.notDeepEqual(
          obtido,
          ESPERADO("Prova386 MX"),
          `o mutante '${rotulo}' passou despercebido`,
        );
        await C.query("ROLLBACK TO SAVEPOINT mutante");
      }
      await C.query("SAVEPOINT mutante");
      await C.query(funcaoComCorpo(CORPO_CERTO, false));
      const semDefiner = await como(C, "authenticated", ADMIN, () =>
        tentar(
          C,
          "INSERT INTO public.produtos (nome, custo, preco_venda) VALUES ('Prova386 Invoker', 1, 1)",
        ),
      );
      assert.equal(
        semDefiner.codigo,
        "42501",
        "sem SECURITY DEFINER o admin nao conseguiria nem salvar o produto",
      );
      await C.query("ROLLBACK TO SAVEPOINT mutante");
      assert.deepEqual(
        await matriz(C, "Prova386 M1"),
        ESPERADO("Prova386 M1"),
        "a funcao verdadeira voltou",
      );

      // ---- 2D. Quem lê e quem escreve ----
      const alvo = antesDaMigration[0]; // o produto "Existente Ativo": tem linha e nao e apagado adiante
      const lerComo = (papel, uid) =>
        como(C, papel, uid, () =>
          tentar(
            C,
            "SELECT count(*)::int AS n FROM public.produto_historico_preco",
          ),
        );
      assert.equal(
        (await lerComo("anon", null)).codigo,
        "42501",
        "visitante nao le o historico",
      );
      assert.deepEqual(
        (await lerComo("authenticated", CLIENTE)).linhas,
        [{ n: 0 }],
        "cliente logado nao le (RLS)",
      );
      assert.deepEqual(
        (await lerComo("authenticated", EX_ADMIN)).linhas,
        [{ n: 0 }],
        "ex-admin nao le",
      );
      assert(
        (await lerComo("authenticated", ADMIN)).linhas[0].n > 0,
        "admin atual le",
      );
      // A emulacao de service_role nao tem o BYPASSRLS do Supabase (a politica e so para authenticated): aqui so se prova que o
      // GRANT de SELECT existe (sem 42501); que ele enxerga as linhas depende do BYPASSRLS real da plataforma.
      assert.equal(
        (await lerComo("service_role", null)).codigo,
        undefined,
        "servico tem SELECT",
      );
      const escritas = [
        [
          "INSERT",
          "INSERT INTO public.produto_historico_preco (produto_id, preco, origem) VALUES ($1, 1, 'mudanca')",
        ],
        [
          "UPDATE",
          "UPDATE public.produto_historico_preco SET preco = 1 WHERE produto_id = $1",
        ],
        [
          "DELETE",
          "DELETE FROM public.produto_historico_preco WHERE produto_id = $1",
        ],
        ["TRUNCATE", "TRUNCATE public.produto_historico_preco"],
      ];
      for (const [papel, uid] of [
        ["anon", null],
        ["authenticated", CLIENTE],
        ["authenticated", ADMIN],
        ["service_role", null],
      ]) {
        for (const [verbo, sql] of escritas) {
          const r = await como(C, papel, uid, () =>
            tentar(C, sql, verbo === "TRUNCATE" ? [] : [alvo]),
          );
          assert.equal(
            r.codigo,
            "42501",
            `${papel}${uid === ADMIN ? " (admin)" : ""} nao pode ${verbo}`,
          );
        }
      }
      const direta = await como(C, "authenticated", ADMIN, () =>
        tentar(C, "SELECT public.registrar_historico_de_preco()"),
      );
      assert.equal(
        direta.codigo,
        "42501",
        "a funcao do gatilho nao e chamavel por ninguem de aplicacao",
      );
      const acl = (
        await C.query(
          `SELECT relacl::text AS acl, relrowsecurity FROM pg_class WHERE oid = 'public.produto_historico_preco'::regclass`,
        )
      ).rows[0];
      assert.equal(acl.relrowsecurity, true);
      assert.doesNotMatch(
        acl.acl,
        /(^|[{,])(anon|=)/,
        "nenhum grant a anon nem a PUBLIC",
      );
      assert.match(acl.acl, /authenticated=r\/postgres/);
      assert.match(acl.acl, /service_role=r\/postgres/);

      // ---- 2E. Preço NULL (se o NOT NULL de produtos um dia cair): o salvamento segue e nao grava linha ----
      await C.query("SAVEPOINT nulo");
      await C.query(
        "ALTER TABLE public.produtos ALTER COLUMN preco_venda DROP NOT NULL",
      );
      const nuloId = (
        await C.query(
          "INSERT INTO public.produtos (nome, custo, preco_venda) VALUES ('Prova386 Nulo', 1, NULL) RETURNING id",
        )
      ).rows[0].id;
      await C.query(
        "UPDATE public.produtos SET preco_venda = NULL WHERE id = $1",
        [semAutor],
      );
      assert.equal(
        (
          await C.query(
            "SELECT preco_venda FROM public.produtos WHERE id = $1",
            [semAutor],
          )
        ).rows[0].preco_venda,
        null,
        "o produto salvou com preco NULL",
      );
      assert.equal(
        Number(
          (
            await C.query(
              "SELECT count(*) AS n FROM public.produto_historico_preco WHERE produto_id = $1",
              [nuloId],
            )
          ).rows[0].n,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await C.query(
              "SELECT count(*) AS n FROM public.produto_historico_preco WHERE produto_id = $1 AND preco IS NULL",
              [semAutor],
            )
          ).rows[0].n,
        ),
        0,
      );
      await C.query("ROLLBACK TO SAVEPOINT nulo");

      // ---- 2F. Apagar o produto de vez leva o historico dele junto ----
      await C.query("DELETE FROM public.produtos WHERE id = $1", [semAutor]);
      assert.equal(
        Number(
          (
            await C.query(
              "SELECT count(*) AS n FROM public.produto_historico_preco WHERE produto_id = $1",
              [semAutor],
            )
          ).rows[0].n,
        ),
        0,
      );

      // ---- 2G. Os rollbacks ----
      const semConfirmar = await tentar(C, destrutivo);
      assert.match(semConfirmar.erro ?? "", /HISTORICO_DE_PRECO_SO_COM_O_DONO/);
      const comGatilho = await tentar(C, CONFIRMA + destrutivo);
      assert.match(
        comGatilho.erro ?? "",
        /HISTORICO_DE_PRECO_ROLLBACK_COMUM_PRIMEIRO/,
      );
      const linhasAntes = Number(
        (
          await C.query(
            "SELECT count(*) AS n FROM public.produto_historico_preco",
          )
        ).rows[0].n,
      );
      await C.query(rollback);
      await C.query(rollback); // repetir e no-op
      assert.deepEqual(await estado(C), {
        tabela: true,
        funcao: false,
        gatilho: false,
        politicas: 0,
      });
      assert.equal(
        Number(
          (
            await C.query(
              "SELECT count(*) AS n FROM public.produto_historico_preco",
            )
          ).rows[0].n,
        ),
        linhasAntes,
        "o rollback comum nao apaga linha",
      );
      assert.equal(
        (
          await C.query(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.produto_historico_preco'::regclass",
          )
        ).rows[0].relrowsecurity,
        true,
      );
      assert.deepEqual(
        (await lerComo("authenticated", ADMIN)).linhas,
        [{ n: 0 }],
        "selada: nem o admin le sem politica",
      );
      // O salvamento volta a ser o de antes: muda o preco e nao grava nada.
      await C.query(
        "UPDATE public.produtos SET preco_venda = preco_venda + 1 WHERE id = $1",
        [alvo],
      );
      assert.equal(
        Number(
          (
            await C.query(
              "SELECT count(*) AS n FROM public.produto_historico_preco",
            )
          ).rows[0].n,
        ),
        linhasAntes,
      );
      await C.query(CONFIRMA + destrutivo);
      assert.deepEqual(await estado(C), {
        tabela: false,
        funcao: false,
        gatilho: false,
        politicas: 0,
      });

      // ---- 2H. Pré-voo: tabela de mesmo nome com outra forma e recusada sem escrever nada ----
      await C.query("CREATE TABLE public.produto_historico_preco (id integer)");
      const recusada = await tentar(C, migration);
      assert.match(recusada.erro ?? "", /B1_BASELINE_DIVERGENT/);
      assert.deepEqual(await estado(C), {
        tabela: true,
        funcao: false,
        gatilho: false,
        politicas: 0,
      });
      await C.query("DROP TABLE public.produto_historico_preco");

      // ---- 2I. Da estaca zero outra vez: tudo volta e todo produto existente ganha a linha ----
      await C.query(migration);
      assert.deepEqual(await estado(C), {
        tabela: true,
        funcao: true,
        gatilho: true,
        politicas: 1,
      });
      assert.equal(
        (
          await C.query(`SELECT count(*)::int AS n FROM public.produtos p
                         WHERE NOT EXISTS (SELECT 1 FROM public.produto_historico_preco h WHERE h.produto_id = p.id)`)
        ).rows[0].n,
        0,
      );
    } finally {
      await C.query("ROLLBACK");
    }
    console.log(
      "[preco-historico] PASSOU: antes/trava 5 s/pos-voo atomico/janela, backfill sem data inventada, 12 caminhos do gatilho, 2 mutantes + definer, ACL/RLS por papel, NULL, cascade, rollbacks e pre-voo",
    );
  } finally {
    for (const x of extras) await x.end().catch(() => {});
    await C.end().catch(() => {});
  }
}
main().catch((e) => {
  console.error("[preco-historico] FALHOU:", e.stack || e.message);
  process.exitCode = 1;
});

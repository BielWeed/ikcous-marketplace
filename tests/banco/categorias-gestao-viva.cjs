"use strict";

/**
 * Prova VIVA da migration 20261237000000 (a lojista renomeia e apaga categoria sem deixar produto orfao), num
 * Postgres EFEMERO local, sem rede, com os papeis de verdade (anon, authenticated, service_role).
 *
 * A categoria do produto e' guardada pelo NOME (texto, sem chave estrangeira) e o mesmo nome aparece em quatro
 * lugares: a linha de `categorias`, `produtos.categoria`, o link do banner (`/?category=<nome>`, codificado ou cru)
 * e a lista "sem troca por gosto" da politica de devolucao. Cada caso roda numa transacao que termina em ROLLBACK.
 *
 *  RENOMEAR   a troca chega nos QUATRO lugares (com a chave da vitrine: maiuscula e espaco nas pontas), conta quantos
 *             de cada, preserva os outros parametros do link, a ordem e o resto da lista; nome parecido e outra
 *             categoria nao sao tocados; banner inativo tambem; so maiuscula ("brinquedo" -> "Brinquedo") passa;
 *             mesmo nome e' no-op.
 *  ATOMICO    uma falha no meio (no banner ou na politica) nao deixa NADA trocado.
 *  RECUSAS    nome repetido (maiuscula, acento, pontuacao, espaco), vazio, so simbolos e grande demais; duas linhas
 *             quase iguais; categoria inexistente.
 *  APAGAR     recusa com o motivo e as contagens enquanto houver produto, banner (ativo ou nao) ou regra de
 *             devolucao; vazia, apaga so ela.
 *  PERMISSAO  anon = sem EXECUTE (42501); logado comum, admin rebaixado (JWT velho) e admin so numa das duas fontes
 *             = "Acesso negado" sem escrever; admin atual e service_role passam; as auxiliares sao fechadas.
 *  LINK       a codificacao do nome e' a de encodeURIComponent (ate emoji) e a leitura do link e' a de
 *             destino-do-banner.ts.
 *  IDA E VOLTA o rollback-manual apaga as onze funcoes e so elas; reaplicar devolve o mesmo corpo e a mesma ACL.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/categorias-gestao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

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
const ARQ =
  "20261237000000_a_lojista_renomeia_e_apaga_categoria_sem_deixar_produto_orfao.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);

const PORTAS = [
  "public.categorias_com_uso()",
  "public.renomear_categoria(uuid,text)",
  "public.apagar_categoria_vazia(uuid)",
];
const AUXILIARES = [
  "public.categoria__chave(text)",
  "public.categoria__slug(text)",
  "public.categoria__url_codifica(text)",
  "public.categoria__url_decodifica(text)",
  "public.categoria__partes_do_link(text)",
  "public.categoria__nome_do_link(text)",
  "public.categoria__mesma(text,text,boolean)",
  "public.categoria__usos(uuid)",
];

const uuid = (n) => `c47e6000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = {
  admin: uuid(901),
  cliente: uuid(902),
  rebaixado: uuid(903),
  soAuth: uuid(904),
  soProfile: uuid(905),
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const JWT_CLIENTE = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "customer" },
});
const ADMIN = { uid: U.admin, claims: JWT_ADMIN };

const CAT = {
  brinq: uuid(1),
  cama: uuid(2),
  intimos: uuid(3),
  vazia: uuid(4),
  oculta: uuid(5),
};

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

/** Roda `sql` como `papel`, com o JWT e o auth.uid() pedidos; devolve as linhas (o erro sobe). */
async function como(papel, sql, params = [], { uid = "", claims = "" } = {}) {
  await C.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
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

const renomear = (id, nome, ident = ADMIN, papel = "authenticated") =>
  tentar(
    papel,
    "SELECT public.renomear_categoria($1, $2) AS r",
    [id, nome],
    ident,
  );
const apagar = (id, ident = ADMIN, papel = "authenticated") =>
  tentar(papel, "SELECT public.apagar_categoria_vazia($1) AS r", [id], ident);

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

/** Pessoas, categorias, produtos, banners e a politica de devolucao que JA EXISTEM (dentro da transacao do caso). */
async function semear({
  categorias = [],
  produtos = [],
  banners = [],
  lista = [],
} = {}) {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@cat.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin Cat', 'admin'), ($2, 'Cliente Cat', 'customer'), ($3, 'Rebaixado Cat', 'customer'),
       ($4, 'So Auth Cat', 'customer'), ($5, 'So Profile Cat', 'admin')`,
    [U.admin, U.cliente, U.rebaixado, U.soAuth, U.soProfile],
  );
  // admin ATUAL = nas duas fontes; so no auth.users = nao; so no profiles = nao; o rebaixado so tem o JWT velho.
  // O gatilho tr_sync_profile_role_to_auth copia o papel do profiles para o auth.users ao inserir: o papel de cada
  // um e' fixado DEPOIS dele, direto no auth.users, para existir a contradicao que a prova precisa.
  await C.query(
    `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = ANY($1::uuid[])`,
    [[U.admin, U.soAuth]],
  );
  await C.query(
    `UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE id = ANY($1::uuid[])`,
    [[U.cliente, U.rebaixado, U.soProfile]],
  );

  await C.query("DELETE FROM public.categorias");
  for (const [id, nome, slug, ativo = true] of categorias)
    await C.query(
      "INSERT INTO public.categorias (id, nome, slug, ativo) VALUES ($1, $2, $3, $4)",
      [id, nome, slug, ativo],
    );

  let n = 100;
  for (const [nome, categoria] of produtos)
    await C.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, categoria)
       VALUES ($1, $2, 100, 10, true, 40, $3)`,
      [uuid(n++), nome, categoria],
    );

  n = 500;
  for (const [link, active = true] of banners)
    await C.query(
      "INSERT INTO public.banners (id, image_url, title, link, active) VALUES ($1, 'https://x.teste/b.png', $2, $3, $4)",
      [uuid(n++), `banner ${n}`, link, active],
    );

  await C.query(
    "INSERT INTO public.politica_devolucao (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  await C.query(
    "UPDATE public.politica_devolucao SET categorias_sem_troca = $1::text[] WHERE id = 1",
    [lista],
  );
}

const categoriasDosProdutos = async () =>
  (
    await C.query(
      "SELECT nome, categoria FROM public.produtos WHERE id >= $1 ORDER BY id",
      [uuid(100)],
    )
  ).rows.map((r) => r.categoria);
const linksDosBanners = async () =>
  (
    await C.query(
      "SELECT link FROM public.banners WHERE id >= $1 ORDER BY id",
      [uuid(500)],
    )
  ).rows.map((r) => r.link);
const listaDaPolitica = async () =>
  (
    await C.query(
      "SELECT categorias_sem_troca AS l FROM public.politica_devolucao WHERE id = 1",
    )
  ).rows[0].l;
const linhaDaCategoria = async (id) =>
  (
    await C.query(
      "SELECT nome, slug, ativo FROM public.categorias WHERE id = $1",
      [id],
    )
  ).rows[0];

/** O retrato dos quatro lugares: se nada mudou, e' igual byte a byte. */
async function retrato() {
  return (
    await C.query(
      `SELECT (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.categorias x) AS cats,
              (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.produtos x) AS prods,
              (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.banners x) AS bans,
              (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.politica_devolucao x) AS pol`,
    )
  ).rows[0];
}

const FIXTURE_COMPLETA = () => ({
  categorias: [
    [CAT.brinq, "brinquedo", "brinquedo"],
    [CAT.cama, "Cama & Banho", "cama-banho"],
    [CAT.intimos, "Íntimos", "intimos"],
  ],
  produtos: [
    ["P1", "brinquedo"],
    ["P2", "brinquedo"],
    ["P3 caixa e espaco", " Brinquedo "],
    ["P4 outra categoria", "Cama & Banho"],
    ["P5 nome parecido", "brinquedos"],
    ["P6 sem categoria", null],
  ],
  banners: [
    ["/?category=brinquedo"],
    ["/?category=Brinquedo&utm_source=x"],
    ["/?category=Cama%20%26%20Banho"],
    ["/produtos"],
    ["/"],
    [null],
    ["/?category=brinquedos"],
    ["/?category=BRINQUEDO", false],
  ],
  lista: ["brinquedo", "Calçados", "Cama & Banho"],
});

// ---------------------------------------------------------------------------
// RENOMEAR: a troca chega nos quatro lugares
// ---------------------------------------------------------------------------

prova(
  "RENOMEAR: o nome troca na linha, nos produtos, nos links de banner (com os outros parametros) e na regra de devolucao, e conta cada um",
  () =>
    emTransacao(async () => {
      await semear(FIXTURE_COMPLETA());
      const r = await renomear(CAT.brinq, "  Brinquedos   de Montar ");
      assert.ok(r.linhas, r.erro);
      assert.deepEqual(r.linhas[0].r, {
        id: CAT.brinq,
        nome_antigo: "brinquedo",
        nome: "Brinquedos de Montar",
        slug: "brinquedos-de-montar",
        mudou: true,
        produtos: 3,
        banners: 3,
        regra_devolucao: 1,
      });

      assert.deepEqual(await linhaDaCategoria(CAT.brinq), {
        nome: "Brinquedos de Montar",
        slug: "brinquedos-de-montar",
        ativo: true,
      });
      assert.deepEqual(await categoriasDosProdutos(), [
        "Brinquedos de Montar",
        "Brinquedos de Montar",
        "Brinquedos de Montar",
        "Cama & Banho", // outra categoria: intacta
        "brinquedos", // nome PARECIDO: intacto
        null,
      ]);
      assert.deepEqual(await linksDosBanners(), [
        "/?category=Brinquedos%20de%20Montar",
        "/?category=Brinquedos%20de%20Montar&utm_source=x",
        "/?category=Cama%20%26%20Banho",
        "/produtos",
        "/",
        null,
        "/?category=brinquedos",
        "/?category=Brinquedos%20de%20Montar", // banner INATIVO tambem
      ]);
      assert.deepEqual(await listaDaPolitica(), [
        "Brinquedos de Montar",
        "Calçados",
        "Cama & Banho",
      ]);
      // a troca da politica e' uma edicao dela: carimba quem e quando
      const pol = (
        await C.query(
          "SELECT updated_by::text AS quem, updated_at >= now() - interval '1 minute' AS agora FROM public.politica_devolucao WHERE id = 1",
        )
      ).rows[0];
      assert.deepEqual(pol, { quem: U.admin, agora: true });
    }),
);

prova(
  "RENOMEAR: o link do banner nos DOIS formatos (codificado e cru) vira o codificado de encodeURIComponent, com nome de simbolos e acento",
  () =>
    emTransacao(async () => {
      await semear({
        categorias: [[CAT.cama, "Cama & Banho", "cama-banho"]],
        produtos: [["Lencol", "Cama & Banho"]],
        banners: [
          ["/?category=Cama%20%26%20Banho"], // como o painel grava hoje
          ["/?category=Cama & Banho"], // como versoes antigas gravavam (cru)
          ["/?category=Cama & Banho&utm=1&ref=a"], // cru, com parametros depois
          ["/?category=cama%20%26%20banho"], // outra caixa
        ],
        lista: ["Cama & Banho"],
      });
      const novo = "Cama, Mesa & Banho (50% off) – já!";
      const r = await renomear(CAT.cama, novo);
      assert.ok(r.linhas, r.erro);
      assert.equal(r.linhas[0].r.banners, 4);
      const esperado = `/?category=${encodeURIComponent(novo)}`;
      assert.deepEqual(await linksDosBanners(), [
        esperado,
        esperado,
        `${esperado}&utm=1&ref=a`,
        esperado,
      ]);
      assert.deepEqual(await categoriasDosProdutos(), [novo]);
      assert.deepEqual(await listaDaPolitica(), [novo]);
    }),
);

prova(
  "RENOMEAR: so maiuscula ('brinquedo' -> 'Brinquedo') e' a mesma linha e passa; o mesmo texto e' no-op sem escrever nada",
  () =>
    emTransacao(async () => {
      await semear(FIXTURE_COMPLETA());
      const antes = await retrato();
      const igual = await renomear(CAT.brinq, "  brinquedo ");
      assert.ok(igual.linhas, igual.erro);
      assert.equal(igual.linhas[0].r.mudou, false);
      assert.deepEqual(
        [
          igual.linhas[0].r.produtos,
          igual.linhas[0].r.banners,
          igual.linhas[0].r.regra_devolucao,
        ],
        [0, 0, 0],
      );
      assert.deepEqual(await retrato(), antes, "no-op nao escreve");

      const caixa = await renomear(CAT.brinq, "Brinquedo");
      assert.ok(caixa.linhas, caixa.erro);
      assert.deepEqual(
        [
          caixa.linhas[0].r.mudou,
          caixa.linhas[0].r.produtos,
          caixa.linhas[0].r.banners,
          caixa.linhas[0].r.regra_devolucao,
        ],
        [true, 3, 3, 1],
      );
      assert.equal((await linhaDaCategoria(CAT.brinq)).slug, "brinquedo");
      assert.deepEqual(await listaDaPolitica(), [
        "Brinquedo",
        "Calçados",
        "Cama & Banho",
      ]);
    }),
);

prova(
  "RENOMEAR: a lista da politica nao ganha repetido (o nome novo ja la escrito) e guarda a ordem",
  () =>
    emTransacao(async () => {
      await semear({
        categorias: [[CAT.brinq, "brinquedo", "brinquedo"]],
        lista: ["Calçados", "BRINQUEDO", "Jogos", "Brinquedos 2", "brinquedo "],
      });
      const r = await renomear(CAT.brinq, "Brinquedos 2");
      assert.ok(r.linhas, r.erro);
      assert.equal(r.linhas[0].r.regra_devolucao, 2);
      assert.deepEqual(await listaDaPolitica(), [
        "Calçados",
        "Brinquedos 2",
        "Jogos",
      ]);
    }),
);

// ---------------------------------------------------------------------------
// ATOMICO
// ---------------------------------------------------------------------------

async function injetarFalhaEm(tabela, nome) {
  await C.query(
    `CREATE FUNCTION public.${nome}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha injetada em ${tabela}'; END $$`,
  );
  await C.query(
    `CREATE TRIGGER ${nome} BEFORE UPDATE ON public.${tabela} FOR EACH ROW EXECUTE FUNCTION public.${nome}()`,
  );
}

for (const [tabela, nome] of [
  ["banners", "falha_nos_banners"],
  ["politica_devolucao", "falha_na_politica"],
]) {
  prova(
    `ATOMICO: se a troca falha no meio (${tabela}), NADA muda: nem a linha, nem os produtos, nem os banners, nem a regra`,
    () =>
      emTransacao(async () => {
        await semear(FIXTURE_COMPLETA());
        await injetarFalhaEm(tabela, nome);
        const antes = await retrato();
        const r = await renomear(CAT.brinq, "Brinquedos de Montar");
        assert.ok(
          (r.erro ?? "").includes(`falha injetada em ${tabela}`),
          `a falha injetada em ${tabela} nao foi a causa: ${r.erro}`,
        );
        assert.deepEqual(await retrato(), antes, "tudo igual depois da falha");
        assert.equal((await linhaDaCategoria(CAT.brinq)).nome, "brinquedo");

        // controle: sem o gatilho de falha a MESMA chamada troca tudo (a falha era a unica diferenca)
        await C.query(`DROP TRIGGER ${nome} ON public.${tabela}`);
        const ok = await renomear(CAT.brinq, "Brinquedos de Montar");
        assert.ok(ok.linhas, ok.erro);
        assert.notDeepEqual(await retrato(), antes);
      }),
  );
}

// ---------------------------------------------------------------------------
// RECUSAS
// ---------------------------------------------------------------------------

prova(
  "RECUSAS: nome repetido (maiuscula, acento, pontuacao, espaco, a chave da vitrine) = 23505 sem escrever",
  () =>
    emTransacao(async () => {
      await semear(FIXTURE_COMPLETA());
      const antes = await retrato();
      for (const nome of [
        "Cama & Banho",
        "cama & banho",
        "CAMA & BANHO",
        "Çama & Bánho",
        "Cama  Banho",
        "cama-banho",
        "Cama, Banho!",
        "  Cama & Banho  ",
        "INTIMOS",
        "íntimos",
      ]) {
        const r = await renomear(CAT.brinq, nome);
        assert.equal(r.codigo, "23505", `${nome}: ${r.erro}`);
        assert.match(r.erro, /Já existe uma categoria chamada "/);
      }
      assert.deepEqual(await retrato(), antes);
    }),
);

prova(
  "RECUSAS: nome vazio, so espaco, so simbolos e com mais de 80 letras = 22023; categoria inexistente = P0002; id nulo = 22023",
  () =>
    emTransacao(async () => {
      await semear(FIXTURE_COMPLETA());
      const antes = await retrato();
      for (const [nome, frase] of [
        ["", /Escreva o novo nome/],
        ["    ", /Escreva o novo nome/],
        [null, /Escreva o novo nome/],
        ["###", /pelo menos uma letra ou um número/],
        ["🙂🙂", /pelo menos uma letra ou um número/],
        ["x".repeat(81), /no máximo 80 letras/],
      ]) {
        const r = await renomear(CAT.brinq, nome);
        assert.equal(r.codigo, "22023", `${nome}: ${r.erro}`);
        assert.match(r.erro, frase);
      }
      assert.deepEqual(await retrato(), antes, "as recusas nao escrevem");

      const inexistente = await renomear(uuid(77), "Qualquer");
      assert.equal(inexistente.codigo, "P0002");
      assert.match(inexistente.erro, /Categoria não encontrada/);
      assert.equal((await renomear(null, "Qualquer")).codigo, "22023");
      assert.deepEqual(await retrato(), antes);

      const limite = await renomear(CAT.brinq, "x".repeat(80));
      assert.ok(limite.linhas, `80 letras passa: ${limite.erro}`);
    }),
);

prova(
  "RECUSAS: com DUAS linhas que so diferem por maiuscula/espaco, renomear recusa (55006) sem escrever; ninguem e adivinhado",
  () =>
    emTransacao(async () => {
      await semear({
        categorias: [
          [CAT.brinq, "brinquedo", "brinquedo"],
          [CAT.oculta, "Brinquedo ", "brinquedo-antigo"],
        ],
        produtos: [
          ["P1", "brinquedo"],
          ["P2", "Brinquedo "],
        ],
        banners: [["/?category=brinquedo"]],
        lista: ["brinquedo"],
      });
      const antes = await retrato();
      const r = await renomear(CAT.brinq, "Brinquedos");
      assert.equal(r.codigo, "55006", r.erro);
      assert.match(r.erro, /quase o mesmo nome/);
      assert.deepEqual(await retrato(), antes);
    }),
);

// ---------------------------------------------------------------------------
// APAGAR
// ---------------------------------------------------------------------------

prova(
  "APAGAR: com produto, banner (ativo ou nao) ou regra de devolucao a categoria NAO sai, e o motivo conta cada um",
  () =>
    emTransacao(async () => {
      await semear(FIXTURE_COMPLETA());
      const antes = await retrato();
      const r = await apagar(CAT.brinq);
      assert.equal(r.codigo, "55006", r.erro);
      assert.match(
        r.erro,
        /A categoria "brinquedo" ainda está em uso: 3 produtos, 3 banners, a regra de devolução\./,
      );
      assert.match(r.erro, /Se só quer tirá-la da vitrine, esconda/);
      assert.deepEqual(await retrato(), antes, "nada saiu");
    }),
);

for (const [rotulo, montagem, frase] of [
  [
    "so produto (um, escrito com outra caixa e espaco)",
    { produtos: [["P1", " BRINQUEDO"]] },
    /em uso: 1 produto\. /,
  ],
  [
    "so banner INATIVO",
    { banners: [["/?category=brinquedo&x=1", false]] },
    /em uso: 1 banner\. /,
  ],
  [
    "so a regra de devolucao",
    { lista: ["Brinquedo"] },
    /em uso: a regra de devolução\. /,
  ],
]) {
  prova(`APAGAR: recusa por ${rotulo}`, () =>
    emTransacao(async () => {
      await semear({
        categorias: [[CAT.brinq, "brinquedo", "brinquedo"]],
        ...montagem,
      });
      const r = await apagar(CAT.brinq);
      assert.equal(r.codigo, "55006", r.erro);
      assert.match(r.erro, frase);
      assert.equal((await linhaDaCategoria(CAT.brinq)).nome, "brinquedo");
    }),
  );
}

prova(
  "APAGAR: categoria vazia sai (so ela); os outros banners, produtos e a regra seguem como estavam; inexistente = P0002",
  () =>
    emTransacao(async () => {
      await semear({
        ...FIXTURE_COMPLETA(),
        categorias: [
          ...FIXTURE_COMPLETA().categorias,
          [CAT.vazia, "Em breve", "em-breve"],
        ],
      });
      const antes = await retrato();
      const r = await apagar(CAT.vazia);
      assert.ok(r.linhas, r.erro);
      assert.deepEqual(r.linhas[0].r, {
        id: CAT.vazia,
        nome: "Em breve",
        apagada: true,
      });
      const depois = await retrato();
      assert.notEqual(depois.cats, antes.cats);
      assert.deepEqual(
        [depois.prods, depois.bans, depois.pol],
        [antes.prods, antes.bans, antes.pol],
      );
      assert.equal(await linhaDaCategoria(CAT.vazia), undefined);
      assert.equal(
        (await C.query("SELECT count(*)::int AS n FROM public.categorias"))
          .rows[0].n,
        3,
      );
      assert.equal((await apagar(CAT.vazia)).codigo, "P0002");
      assert.equal((await apagar(null)).codigo, "22023");
    }),
);

prova(
  "APAGAR: com duas linhas quase iguais compara o texto EXATO: a que nenhum produto usa sai, a que algum produto usa fica",
  () =>
    emTransacao(async () => {
      await semear({
        categorias: [
          [CAT.brinq, "brinquedo", "brinquedo"],
          [CAT.oculta, "Brinquedo", "brinquedo-2"],
        ],
        produtos: [["P1", "brinquedo"]],
      });
      const usada = await apagar(CAT.brinq);
      assert.equal(usada.codigo, "55006", usada.erro);
      const livre = await apagar(CAT.oculta);
      assert.ok(livre.linhas, livre.erro);
      assert.equal(await linhaDaCategoria(CAT.oculta), undefined);
    }),
);

// ---------------------------------------------------------------------------
// LISTA COM USO / ESCONDER
// ---------------------------------------------------------------------------

prova(
  "LISTA: categorias_com_uso traz todas (tambem a escondida) com a contagem de cada uma; esconder nao mexe em produto",
  () =>
    emTransacao(async () => {
      await semear({
        ...FIXTURE_COMPLETA(),
        categorias: [
          ...FIXTURE_COMPLETA().categorias,
          [CAT.oculta, "Outlet", "outlet", false],
        ],
        produtos: [...FIXTURE_COMPLETA().produtos, ["P7 outlet", "Outlet"]],
      });
      const r = await tentar(
        "authenticated",
        "SELECT public.categorias_com_uso() AS r",
        [],
        ADMIN,
      );
      assert.ok(r.linhas, r.erro);
      assert.deepEqual(
        r.linhas[0].r.map((c) => [
          c.nome,
          c.ativo,
          c.produtos,
          c.banners,
          c.regra_devolucao,
        ]),
        [
          ["brinquedo", true, 3, 3, 1],
          ["Cama & Banho", true, 1, 1, 1],
          ["Íntimos", true, 0, 0, 0],
          ["Outlet", false, 1, 0, 0],
        ],
      );

      // esconder e' so a coluna `ativo`: nenhum produto, banner ou regra muda
      const antes = await retrato();
      await C.query(
        "UPDATE public.categorias SET ativo = false WHERE id = $1",
        [CAT.brinq],
      );
      const depois = await retrato();
      assert.deepEqual(
        [depois.prods, depois.bans, depois.pol],
        [antes.prods, antes.bans, antes.pol],
      );
      const de = await tentar(
        "authenticated",
        "SELECT public.categorias_com_uso() AS r",
        [],
        ADMIN,
      );
      assert.equal(
        de.linhas[0].r.find((c) => c.nome === "brinquedo").ativo,
        false,
      );
    }),
);

// ---------------------------------------------------------------------------
// PERMISSAO
// ---------------------------------------------------------------------------

const CHAMADAS = [
  [
    "renomear",
    (id) => ["SELECT public.renomear_categoria($1, 'Novo Nome') AS r", [id]],
  ],
  ["apagar", (id) => ["SELECT public.apagar_categoria_vazia($1) AS r", [id]]],
  ["listar", () => ["SELECT public.categorias_com_uso() AS r", []]],
];

prova(
  "PERMISSAO: o visitante (anon) nao executa nenhuma das tres (42501) e nada muda",
  () =>
    emTransacao(async () => {
      await semear(FIXTURE_COMPLETA());
      const antes = await retrato();
      for (const [nome, monta] of CHAMADAS) {
        const [sql, params] = monta(CAT.brinq);
        const r = await tentar("anon", sql, params);
        assert.equal(r.codigo, "42501", `${nome}: ${r.erro}`);
        assert.match(r.erro, /permission denied for function/);
      }
      assert.deepEqual(await retrato(), antes);
    }),
);

prova(
  "PERMISSAO: logado comum, admin REBAIXADO (JWT velho) e admin so numa das duas fontes recebem 'Acesso negado' (42501) sem escrever; sem sessao tambem",
  () =>
    emTransacao(async () => {
      await semear(FIXTURE_COMPLETA());
      const antes = await retrato();
      const identidades = {
        cliente: { uid: U.cliente, claims: JWT_CLIENTE },
        "rebaixado (JWT diz admin; profiles e auth.users nao)": {
          uid: U.rebaixado,
          claims: JWT_ADMIN,
        },
        "admin so no auth.users": { uid: U.soAuth, claims: JWT_ADMIN },
        "admin so no profiles": { uid: U.soProfile, claims: JWT_ADMIN },
        "sem sessao e sem JWT": { uid: "", claims: "" },
      };
      // controle da fixture: a primeira guarda (JWT) cai nas tres contradicoes e SO a segunda (papel de agora) as barra
      for (const quem of [
        "rebaixado (JWT diz admin; profiles e auth.users nao)",
        "admin so no auth.users",
        "admin so no profiles",
      ]) {
        const [g] = await como(
          null,
          "SELECT public.is_admin() AS jwt, public.is_admin_atual() AS agora",
          [],
          identidades[quem],
        );
        assert.deepEqual(g, { jwt: true, agora: false }, quem);
      }
      const [ok] = await como(
        null,
        "SELECT public.is_admin() AS jwt, public.is_admin_atual() AS agora",
        [],
        ADMIN,
      );
      assert.deepEqual(
        ok,
        { jwt: true, agora: true },
        "o admin atual passa nas duas",
      );
      for (const [quem, ident] of Object.entries(identidades)) {
        for (const [nome, monta] of CHAMADAS) {
          const [sql, params] = monta(CAT.brinq);
          const r = await tentar("authenticated", sql, params, ident);
          assert.equal(r.codigo, "42501", `${quem} / ${nome}: ${r.erro}`);
          assert.equal(r.erro, "Acesso negado.", `${quem} / ${nome}`);
        }
      }
      assert.deepEqual(await retrato(), antes);
    }),
);

prova(
  "PERMISSAO: o admin atual (as duas fontes) e o service_role passam nas tres; a auxiliar nao e' executavel pelo logado nem pelo visitante",
  () =>
    emTransacao(async () => {
      await semear(FIXTURE_COMPLETA());
      const l = await tentar(
        "authenticated",
        "SELECT public.categorias_com_uso() AS r",
        [],
        ADMIN,
      );
      assert.ok(l.linhas, l.erro);
      const s = await tentar(
        "service_role",
        "SELECT public.categorias_com_uso() AS r",
        [],
        { uid: "", claims: "" },
      );
      assert.ok(s.linhas, s.erro);
      const sr = await tentar(
        "service_role",
        "SELECT public.renomear_categoria($1, 'Via Servico') AS r",
        [CAT.brinq],
      );
      assert.ok(sr.linhas, sr.erro);
      assert.equal((await linhaDaCategoria(CAT.brinq)).nome, "Via Servico");
      const sa = await tentar(
        "service_role",
        "SELECT public.apagar_categoria_vazia($1) AS r",
        [CAT.intimos],
      );
      assert.ok(sa.linhas, sa.erro);

      for (const papel of ["authenticated", "anon"]) {
        for (const aux of AUXILIARES) {
          const args = aux.endsWith("(text)")
            ? "'x'"
            : aux.endsWith("(uuid)")
              ? `'${CAT.brinq}'::uuid`
              : aux.endsWith("(text,text,boolean)")
                ? "'x', 'x', false"
                : "";
          const nome = aux.replace(/\(.*/, "");
          const r = await tentar(
            papel,
            `SELECT ${nome}(${args}) AS r`,
            [],
            ADMIN,
          );
          assert.equal(r.codigo, "42501", `${papel} / ${aux}: ${r.erro}`);
        }
      }
    }),
);

prova(
  "PERMISSAO: ACL, SECURITY DEFINER e search_path de cada funcao sao os do contrato (nenhuma aberta a anon/PUBLIC; so as 3 portas ao authenticated)",
  async () => {
    const linhas = (
      await C.query(
        `SELECT p.oid::regprocedure::text AS f, p.prosecdef, p.proconfig::text AS cfg,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS srv
           FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND (p.proname LIKE 'categoria\\_\\_%' OR p.proname IN ('renomear_categoria','apagar_categoria_vazia','categorias_com_uso'))
          ORDER BY 1`,
      )
    ).rows;
    assert.equal(linhas.length, 11, linhas.map((l) => l.f).join(", "));
    const semEsquema = (f) => f.replace(/^public\./, "");
    for (const l of linhas) {
      const porta = PORTAS.some((p) => semEsquema(l.f) === semEsquema(p));
      assert.equal(l.anon, false, `${l.f}: anon`);
      assert.equal(l.pub, false, `${l.f}: PUBLIC`);
      assert.equal(l.auth, porta, `${l.f}: authenticated`);
      assert.equal(l.srv, porta, `${l.f}: service_role`);
      assert.equal(
        l.prosecdef,
        porta,
        `${l.f}: SECURITY DEFINER so nas portas`,
      );
      assert.match(l.cfg, /search_path=public/, `${l.f}: search_path`);
    }
  },
);

// ---------------------------------------------------------------------------
// LINK
// ---------------------------------------------------------------------------

prova(
  "LINK: categoria__url_codifica e' encodeURIComponent byte a byte (ascii, simbolos, acento, emoji de 4 bytes, apostrofo, til)",
  async () => {
    const textos = [
      "",
      "Brinquedos",
      "Cama & Banho",
      "Íntimos (50%)",
      "Calçados e Acessórios",
      "a/b?c=d#e+f g",
      "!~*'()-_.",
      "100% algodão",
      "Café ☕ 🧸 日本",
      "tab\there",
    ];
    for (const t of textos) {
      const r = (
        await C.query("SELECT public.categoria__url_codifica($1) AS v", [t])
      ).rows[0].v;
      assert.equal(r, encodeURIComponent(t), JSON.stringify(t));
      const volta = (
        await C.query("SELECT public.categoria__url_decodifica($1) AS v", [r])
      ).rows[0].v;
      assert.equal(volta, t, `ida e volta de ${JSON.stringify(t)}`);
    }
  },
);

prova(
  "LINK: categoria__nome_do_link le o link como destino-do-banner.ts (codificado so quando ja esta codificado; parametros depois do nome; o que nao e' categoria = NULL)",
  async () => {
    const casos = [
      ["/?category=brinquedo", "brinquedo"],
      ["/?category=Cama%20%26%20Banho", "Cama & Banho"],
      ["/?category=Cama & Banho", "Cama & Banho"],
      ["/?category=Cama & Banho&utm=1", "Cama & Banho"],
      ["/?category=A&B", "A&B"],
      ["/?category=Promo%2050%25", "Promo 50%"],
      ["/?category=100%", "100%"],
      ["/?category=a+b", "a+b"],
      ["/?category=%E0%A4%A", "%E0%A4%A"],
      ["/?category=", null],
      ["/produtos", null],
      ["/", null],
      ["https://loja.teste/?category=a", null],
      ["/?Category=x", null],
    ];
    for (const [link, esperado] of casos) {
      const r = (
        await C.query("SELECT public.categoria__nome_do_link($1) AS v", [link])
      ).rows[0].v;
      assert.equal(r, esperado, link);
    }
    const partes = (
      await C.query("SELECT public.categoria__partes_do_link($1) AS v", [
        "/?category=Cama & Banho&utm=1&ref=a",
      ])
    ).rows[0].v;
    assert.deepEqual(partes, ["Cama & Banho", "utm=1&ref=a"]);
  },
);

// ---------------------------------------------------------------------------
// IDA E VOLTA
// ---------------------------------------------------------------------------

const retratoDasFuncoes = async () =>
  (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, md5(p.prosrc) AS corpo, p.proacl::text AS acl
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND (p.proname LIKE 'categoria\\_\\_%' OR p.proname IN ('renomear_categoria','apagar_categoria_vazia','categorias_com_uso'))
        ORDER BY 1`,
    )
  ).rows;
const totalDeFuncoes = async () =>
  (
    await C.query(
      "SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace",
    )
  ).rows[0].n;

prova(
  "IDA E VOLTA: o rollback apaga as onze funcoes e so elas; reaplicar (2x) devolve o mesmo corpo e a mesma ACL",
  () =>
    emTransacao(async () => {
      const antes = await retratoDasFuncoes();
      assert.equal(antes.length, 11);
      const total = await totalDeFuncoes();

      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal((await retratoDasFuncoes()).length, 0);
      assert.equal(await totalDeFuncoes(), total - 11, "so as onze saem");
      assert.equal(await aplicar(ROLLBACK), null, "rollback e' idempotente");

      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retratoDasFuncoes(), antes, "volta igual");
      assert.equal(await aplicar(MIGRATION), null, "reaplicar nao falha");
      assert.deepEqual(
        await retratoDasFuncoes(),
        antes,
        "reaplicar nao muda nada",
      );
      assert.equal(await totalDeFuncoes(), total);
    }),
);

prova(
  "PRE-VOO: a migration recusa (B1_BASELINE_DIVERGENT) sem escrever quando falta uma coluna ou funcao de que depende",
  () =>
    emTransacao(async () => {
      await C.query(
        "ALTER TABLE public.politica_devolucao RENAME COLUMN categorias_sem_troca TO sem_troca_tmp",
      );
      const r = await aplicar(MIGRATION);
      assert.match(
        r?.erro ?? "",
        /B1_BASELINE_DIVERGENT.*politica_devolucao\.categorias_sem_troca/,
      );
      await C.query(
        "ALTER TABLE public.politica_devolucao RENAME COLUMN sem_troca_tmp TO categorias_sem_troca",
      );

      await C.query(
        "ALTER FUNCTION public.f_unaccent(text) RENAME TO f_unaccent_tmp",
      );
      const r2 = await aplicar(MIGRATION);
      assert.match(r2?.erro ?? "", /B1_BASELINE_DIVERGENT.*f_unaccent/);
    }),
);

prova(
  "CONTRATO: o gatilho que avisa a vitrine do produto trocado (set_ultima_atualizacao) existe e esta ligado — a troca de categoria depende dele",
  async () => {
    const r = (
      await C.query(
        `SELECT t.tgenabled FROM pg_trigger t
          WHERE t.tgrelid = 'public.produtos'::regclass AND t.tgname = 'set_ultima_atualizacao' AND NOT t.tgisinternal`,
      )
    ).rows;
    assert.equal(r.length, 1);
    assert.equal(r[0].tgenabled, "O");
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
      `${falhas.length} de ${PROVAS.length} provas da gestao de categorias falharam.`,
    );
  }
  console.log(
    `\n[categorias-gestao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));

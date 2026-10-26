"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261392000000_a_lista_de_clientes_nao_repete_nem_esconde_ninguem_entre_as_paginas.sql
 * (public.get_admin_customers_paged, desempate pelo id no fim do ORDER BY) contra o Postgres EFEMERO com as
 * migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de loja. Roda num CLONE (rodar-isolado.cjs):
 * a fixture e as trocas de corpo sao COMMITADAS, porque a prova usa DUAS conexoes (o pool do PostgREST).
 *
 * O que prova:
 *  (1) Com 30 clientes EMPATADAS no total comprado (0) e 2 compradoras, as paginas 0, 1 e 2 (12 por pagina, a tela
 *      Clientes) devolvem os 32 ids UMA vez cada, na mesma ordem, lidas por duas conexoes com planos DIFERENTES
 *      (uma prefere agregar por hash, a outra por ordenacao) e misturando as conexoes pagina a pagina. A ordem e a
 *      escolhida (as compradoras primeiro) e, entre empatadas, id crescente. Vale tambem para "Mais recentes"
 *      (created_at igual), campo desconhecido e "Nome" (sem empate, a ordem do nome).
 *  (2) CONTROLE: o corpo anterior (o da 20261230000000, pelo rollback-manual) nas MESMAS duas conexoes repete
 *      cliente e esconde outra (o defeito medido); um mutante que desempata por created_at (que nao e unico) tambem.
 *  (3) So a ordem muda: para varios termos (vazio, nome, numero, +55, nada), o CONJUNTO de ids e o total_count
 *      sao iguais no corpo novo e no anterior; as estatisticas tambem.
 *  (4) Reaplicar 2x deixa OID, dono, ACL, atributos e texto iguais; rollback devolve o corpo da 20261230000000
 *      byte a byte; rodar o rollback de novo deixa o mesmo estado; reaplicar depois do rollback volta.
 *  (5) Pre-voo recusa sem escrever: corpo desconhecido, ACL aberta para anon, sobrecarga; o rollback recusa corpo
 *      desconhecido. A migration inteira, mandada numa conexao SEM BEGIN com a conferencia final sabotada, nao
 *      deixa nada gravado (o envelope e uma transacao so).
 *  (6) Consultas 101a/101b leem o estado certo nos dois sentidos, com o rol fechado do conferir-banco.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-lista-de-clientes-nao-repete-ninguem-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261392000000_a_lista_de_clientes_nao_repete_nem_esconde_ninguem_entre_as_paginas.sql";
const NOME_ANTERIOR =
  "20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const RE_CABECALHO =
  /CREATE OR REPLACE FUNCTION public\.get_admin_customers_paged\([^\n]*\)[\s\S]*?\nAS \$\$/;
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.get_admin_customers_paged\([^\n]*\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_ANTERIOR}`));
const CORPO_NOVO = corpoDe(migration);
const HASH_ANTES = "d6c092c3e0d8069891af795147d65e9e";
const HASH_NOVO = "1c71829d75e3d8f17bf7fb01019c05ec";
const ASSINATURA =
  "public.get_admin_customers_paged(text,text,text,integer,integer)";
const C101A = "101a-conferir-a-lista-de-clientes-nao-repete-ninguem-aplicado";
const C101B = "101b-antes-a-lista-de-clientes-nao-repete-ninguem-base-vigente";
const CABECALHO_DA_FUNCAO = migration.match(RE_CABECALHO)[0];
const trocarCorpo = (c, corpo) => c.query(`${CABECALHO_DA_FUNCAO}${corpo}$$;`);

// Ids FIXOS (a ordem de hash e a de id ficam as mesmas em todo run). As 30 empatadas tem nome "Empate NN" e as duas
// compradoras "Empate Compradora X": o termo "Empate" acha as 32 e so elas.
const ADMIN = "e3920000-1392-4000-8000-000000000001";
const COMPRADORA_A = "e3920000-1392-4000-8000-0000000000a1";
const COMPRADORA_B = "e3920000-1392-4000-8000-0000000000b2";
const EMPATADAS = Array.from({ length: 30 }, (_, i) => {
  const h = crypto.createHash("md5").update(`empate-${i}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
});
const TOTAL = 32;
const POR_PAGINA = 12;

async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa392");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa392");
    await c.query("RELEASE SAVEPOINT recusa392");
  }
}
async function isolado(c, acao) {
  await c.query("BEGIN");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK");
  }
}

async function fixture(c) {
  await c.query("BEGIN");
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@lista392.teste', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Lista', 'admin')",
    [ADMIN],
  );
  const clientes = [
    [COMPRADORA_A, "Empate Compradora A"],
    [COMPRADORA_B, "Empate Compradora B"],
    ...EMPATADAS.map((id, i) => [id, `Empate ${String(i).padStart(2, "0")}`]),
  ];
  for (const [id, nome] of clientes) {
    await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
      id,
      `${id.slice(0, 8)}@lista392.teste`,
    ]);
    // O mesmo created_at para todas (o mesmo instante da transacao): "Mais recentes" tambem empata.
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, $2, 'customer')",
      [id, nome],
    );
  }
  // Duas compradoras com dinheiro reconhecido (50 e 20): o total comprado continua mandando na ordem.
  await c.query("SET LOCAL session_replication_role = replica");
  for (const [uid, total] of [
    [COMPRADORA_A, 50],
    [COMPRADORA_B, 20],
  ])
    await c.query(
      `INSERT INTO public.marketplace_orders
         (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at)
       VALUES ($1, 'x', '{}'::jsonb, $2, $2, 'delivered', 'online', 'online', 'pago', now())`,
      [uid, total],
    );
  await c.query("COMMIT");
}

/** Uma conexao do "pool", logada como admin, com o planejador empurrado para um lado. */
async function conexao(url, ajustes) {
  const c = new Client({ connectionString: url });
  await c.connect();
  for (const a of ajustes) await c.query(a);
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [ADMIN]);
  return c;
}
async function pagina(c, termo, campo, direcao, n) {
  const r = (
    await c.query(
      "SELECT public.get_admin_customers_paged($1, $2, $3, $4, $5) AS r",
      [termo, campo, direcao, n, POR_PAGINA],
    )
  ).rows[0].r;
  return r;
}
/** As 3 paginas, cada uma pela conexao da vez (`quem[i]`). Devolve os ids na ordem em que a tela os mostraria. */
async function tresPaginas(quem, campo, direcao, termo = "Empate") {
  const ids = [];
  for (const [n, conexao] of quem.slice(0, 3).entries()) {
    const r = await pagina(conexao, termo, campo, direcao, n);
    assert.equal(r.total_count, TOTAL, "total_count tem de ser o mesmo");
    ids.push(...r.data.map((l) => l.id));
  }
  return ids;
}
const porId = (ids) => [...ids].sort();

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  const abertas = [c];
  try {
    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o da 20261230000000. ----
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o da 20261392000000",
    );
    assert.equal(md5(topo.prosrc), HASH_NOVO);
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o anterior nao e o da 20261230000000",
    );
    assert.equal(
      CORPO_NOVO.replace(
        "            END DESC,\n            -- Desempate pelo id (unico): sem ele, quem empata no criterio escolhido (toda conta nova\n            -- tem total 0) sai numa ordem que pode mudar de uma chamada para outra, e a paginacao por\n            -- OFFSET repete a mesma cliente em duas paginas e esconde outra (20261392000000).\n            id\n    ),",
        "            END DESC\n    ),",
      ),
      CORPO_ANTES,
      "o corpo novo tem de ser o anterior mais o desempate, e nada mais",
    );
    console.log(
      "  PASSOU o topo instalado e o corpo desta migration (md5 conhecido; so o desempate mudou)",
    );

    await fixture(c);
    // Duas conexoes com planos diferentes para o MESMO texto: uma agrega por hash (sem ordenar antes), a outra
    // ordena para agregar. No PostgREST cada pagina pode cair numa conexao diferente do pool, cada uma com o
    // proprio plano em cache.
    const hash = await conexao(url, ["SET enable_sort = off"]);
    const ordena = await conexao(url, ["SET enable_hashagg = off"]);
    abertas.push(hash, ordena);

    // ---- 1. Corpo novo: 32 ids, uma vez cada, a mesma ordem por qualquer combinacao de conexoes. ----
    const esperado = [COMPRADORA_A, COMPRADORA_B, ...porId(EMPATADAS)];
    for (const [rotulo, quem] of [
      ["so a conexao de hash", [hash, hash, hash]],
      ["so a conexao que ordena", [ordena, ordena, ordena]],
      ["misturadas (hash, ordena, hash)", [hash, ordena, hash]],
      ["misturadas (ordena, hash, ordena)", [ordena, hash, ordena]],
    ]) {
      const ids = await tresPaginas(quem, "total_spent", "desc");
      assert.deepEqual(
        ids,
        esperado,
        `Maior total comprado (${rotulo}): as compradoras primeiro e as empatadas por id`,
      );
    }
    // "Mais recentes": todas nasceram no mesmo instante -> so o id decide; campo desconhecido idem.
    for (const [campo, direcao] of [
      ["created_at", "desc"],
      ["created_at", "asc"],
      ["campo_que_nao_existe", "desc"],
    ]) {
      const a = await tresPaginas([hash, ordena, hash], campo, direcao);
      assert.deepEqual(a, porId([COMPRADORA_A, COMPRADORA_B, ...EMPATADAS]));
    }
    // "Nome": sem empate, a ordem e a do nome (o desempate nao atrapalha).
    // ("Empate 00".."Empate 29" vem antes de "Empate Compradora A/B": digito antes de letra.)
    assert.deepEqual(
      await tresPaginas([ordena, hash, ordena], "full_name", "asc"),
      [...EMPATADAS, COMPRADORA_A, COMPRADORA_B],
      "Nome: a ordem do nome, sem empate",
    );
    console.log(
      "  PASSOU as paginas 0, 1 e 2 devolvem os 32 ids uma vez cada, na mesma ordem, por qualquer mistura de conexoes",
    );

    // ---- 2. CONTROLE: o corpo anterior e um desempate que nao e unico repetem e escondem clientes. ----
    const defeito = async (rotulo) => {
      const ids = await tresPaginas(
        [hash, ordena, hash],
        "total_spent",
        "desc",
      );
      const distintos = new Set(ids).size;
      assert.ok(
        distintos < TOTAL,
        `${rotulo}: as 3 paginas deveriam repetir alguem (vieram ${distintos} distintos de ${TOTAL})`,
      );
      return TOTAL - distintos;
    };
    await c.query(rollback);
    assert.equal(md5((await funcao(c)).prosrc), HASH_ANTES);
    const sumidasAntes = await defeito("corpo da 20261230000000");
    await trocarCorpo(
      c,
      CORPO_NOVO.replace(
        "            id\n    ),",
        "            created_at\n    ),",
      ),
    );
    await defeito("mutante: desempate por created_at");
    // O mutante e um corpo desconhecido (o pre-voo recusaria): volta ao da 230 e aplica a migration por cima.
    await trocarCorpo(c, CORPO_ANTES);
    await c.query(migration);
    assert.equal(md5((await funcao(c)).prosrc), HASH_NOVO);
    assert.deepEqual(
      await tresPaginas([hash, ordena, hash], "total_spent", "desc"),
      esperado,
    );
    console.log(
      `  PASSOU controle: o corpo anterior esconde ${sumidasAntes} cliente(s) nas mesmas 3 paginas (e repete outras); o mutante tambem`,
    );

    // ---- 3. So a ordem muda: o conjunto achado, o total e as estatisticas sao os mesmos. ----
    const foto = async () => {
      const out = [];
      for (const termo of [
        "",
        "Empate",
        "Compradora",
        "Empate 0",
        "zzzqq",
        "+55 34 99999-1234",
        "1392",
      ]) {
        const r = await pagina(hash, termo, "total_spent", "desc", 0);
        const todos = await hash.query(
          "SELECT public.get_admin_customers_paged($1, 'total_spent', 'desc', 0, 1000) AS r",
          [termo],
        );
        out.push({
          termo,
          total: r.total_count,
          stats: r.stats,
          ids: porId(todos.rows[0].r.data.map((l) => l.id)),
        });
      }
      return out;
    };
    const novo = await foto();
    await c.query(rollback);
    const antigo = await foto();
    await c.query(migration);
    assert.deepEqual(novo, antigo, "o conjunto achado ou o total mudou");
    console.log(
      "  PASSOU o conjunto achado, o total e as estatisticas sao os mesmos do corpo anterior (7 termos)",
    );

    // ---- 4. Reaplicar, rollback byte a byte, rollback de novo, reaplicar depois do rollback. ----
    await isolado(c, async () => {
      await c.query(migration);
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar 2x mudou OID, dono, ACL, atributos ou texto",
      );
      await c.query(rollback);
      const volta = await funcao(c);
      assert.equal(
        volta.prosrc,
        CORPO_ANTES,
        "o rollback nao devolveu o corpo da 20261230000000 byte a byte",
      );
      assert.deepEqual(
        { ...volta, prosrc: null },
        { ...topo, prosrc: null },
        "o rollback mexeu em atributo, dono ou ACL",
      );
      await c.query(rollback);
      assert.deepEqual(
        await funcao(c),
        volta,
        "rodar o rollback de novo mudou o estado",
      );
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
    });
    console.log(
      "  PASSOU reaplicar 2x, rollback byte a byte, rollback 2x igual e reaplicar volta",
    );

    // ---- 5. Pre-voo recusa sem escrever; a conferencia que falha desfaz o arquivo inteiro. ----
    const sabotagens = [
      [
        "corpo desconhecido",
        () =>
          trocarCorpo(c, CORPO_NOVO.replace("-- Desempate", "-- desempate")),
      ],
      [
        "ACL aberta para anon",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`),
      ],
      [
        "sobrecarga",
        () =>
          c.query(
            "CREATE FUNCTION public.get_admin_customers_paged(p_search text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
          ),
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await sabotar();
        const antes = await funcao(c);
        await recusa(c, migration, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await funcao(c),
          antes,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
        if (nome === "corpo desconhecido")
          await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      });
    }
    // Sem BEGIN: o estado de partida e o da 230; a conferencia sabotada derruba o arquivo inteiro.
    await c.query(rollback);
    const conferenciaSabotada = migration.replace(
      `IF v_hash IS DISTINCT FROM '${HASH_NOVO}' THEN\n    RAISE EXCEPTION 'conferencia 20261392`,
      `IF v_hash IS DISTINCT FROM 'nao-e-este' THEN\n    RAISE EXCEPTION 'conferencia 20261392`,
    );
    assert.notEqual(conferenciaSabotada, migration);
    await assert.rejects(
      () => c.query(conferenciaSabotada),
      /conferencia 20261392/,
    );
    assert.equal(
      md5((await funcao(c)).prosrc),
      HASH_ANTES,
      "a migration que falhou na conferencia deixou o corpo novo gravado",
    );
    await c.query(migration);
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens) e a conferencia que falha nao deixa nada (conexao sem BEGIN)`,
    );

    // ---- 6. Consultas 101a/101b nos dois sentidos, com o rol fechado. ----
    const consulta = async (nome) => {
      const rows = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows.filter((r) => r.ok !== true).map((r) => r.item);
    };
    assert.deepEqual(await consulta(C101A), []);
    assert.deepEqual(await consulta(C101B), [
      "get_admin_customers_paged: corpo exato (md5)",
    ]);
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C101B), []);
      assert.deepEqual(await consulta(C101A), [
        "get_admin_customers_paged: corpo exato (md5)",
      ]);
    });
    // Os portoes vizinhos que medem esta funcao (8e do lote 92-202 e 32a do lote da busca) aceitam o corpo novo E o da 230,
    // e reprovam um corpo estranho.
    const reprovadasDe = async (nome) =>
      (await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))).rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item);
    const VIZINHOS = [
      "8e-conferir-92-a-202-aplicado",
      "32a-conferir-busca-de-clientes-aplicado",
    ];
    for (const v of VIZINHOS)
      assert.deepEqual(
        await reprovadasDe(v),
        [],
        `${v}: reprovou o corpo da 392`,
      );
    await isolado(c, async () => {
      await c.query(rollback);
      for (const v of VIZINHOS)
        assert.deepEqual(
          await reprovadasDe(v),
          [],
          `${v}: reprovou o corpo da 230`,
        );
    });
    await isolado(c, async () => {
      await trocarCorpo(c, `${CORPO_NOVO} `);
      for (const v of VIZINHOS)
        assert.ok(
          (await reprovadasDe(v)).length > 0,
          `${v}: aceitou um corpo estranho`,
        );
    });
    console.log(
      "  PASSOU consultas 101a/101b nos dois sentidos, rol fechado; 8e e 32a aceitam o corpo da 230 e o da 392 e reprovam corpo estranho",
    );

    console.log(
      "\n[a-lista-de-clientes-nao-repete-ninguem] todas as provas passaram.",
    );
  } finally {
    for (const x of abertas) await x.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

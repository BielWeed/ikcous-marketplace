"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// 20261385: somente Postgres descartavel do rpc-ci, nunca banco de loja.
// A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: a busca de Produtos do painel (get_admin_products_paged, p_search) acha o produto pelo codigo de
// barras dele, pelo codigo de barras de uma variacao ATIVA e pelo SKU de uma variacao ATIVA (mesmo criterio do codigo
// do produto), sem perder nome, codigo, categoria, status, estoque baixo, paginacao, total_count nem a porta de admin.
// Codigo de barras casa por IGUALDADE: um EAN que e prefixo de outro NAO traz o outro, e um pedaco de EAN nao acha nada.
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/busca-do-painel-por-codigo-viva.cjs
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261385000000_a_busca_de_produtos_do_painel_acha_pelo_codigo_de_barras_e_da_variacao.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const migration81 = ler(
  "supabase/migrations/20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql",
);
const ASSINATURA =
  "public.get_admin_products_paged(text,text,text,text,integer,integer)";
const FIM_DA_FUNCAO = "$function$;";
// A definicao da funcao como a migration a escreve, do CREATE ate o fecha-corpo.
const definicao = (sql) => {
  const ini = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_products_paged(",
  );
  assert.ok(ini >= 0, "definicao de get_admin_products_paged nao encontrada");
  return sql.slice(ini, sql.indexOf(FIM_DA_FUNCAO, ini) + FIM_DA_FUNCAO.length);
};
const corpoDe = (def) =>
  def.split("AS $function$")[1].slice(0, -FIM_DA_FUNCAO.length);
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const DEF_NOVA = definicao(migration);
// A definicao viva ANTES desta migration: a da 20261381 (a ultima que redefine a funcao).
const DEF_ANTES = definicao(migration81);
const HASH_ANTES = "d204becede7d249e0a1871038f854a46";
const HASH_NOVO = md5(corpoDe(DEF_NOVA));

const ADMIN = "5e385000-0000-4000-8000-000000000001";
const CLIENTE = "5e385000-0000-4000-8000-000000000002";
const EX_ADMIN = "5e385000-0000-4000-8000-000000000003";
// Codigos de barras de fixture (13/14 digitos). EAN_CAMISA e prefixo de EAN_TENIS DE PROPOSITO.
const EAN = {
  camisa: "7850000000011",
  tenis: "78500000000112",
  variacaoBranco: "7852000000028",
  variacaoPreto: "7852000000035",
  variacaoInativa: "7852000000042",
  bone: "7853000000019",
  apagado: "7854000000015",
  inativo: "7855000000012",
  baixo: "7856000000019",
};

const nomes = (r) => r.data.map((p) => p.nome).sort();
async function buscar(c, o = {}) {
  const r = (
    await c.query(
      "SELECT public.get_admin_products_paged($1, $2, $3, $4, $5, $6) AS r",
      [
        o.search ?? "",
        o.category ?? "all",
        o.status ?? "all",
        o.stock ?? "all",
        o.page ?? 0,
        o.size ?? 50,
      ],
    )
  ).rows[0].r;
  // O total e SEMPRE o da lista inteira: numa pagina so, ele tem de ser o tamanho dela.
  if (r.data.length < (o.size ?? 50) && (o.page ?? 0) === 0) {
    assert.equal(
      Number(r.total_count),
      r.data.length,
      `total_count diverge da lista para ${JSON.stringify(o)}`,
    );
  }
  return r;
}
async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso385");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso385");
    await c.query("RELEASE SAVEPOINT caso385");
  }
}
async function comoUsuario(c, id, acao) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [id]);
  try {
    return await acao();
  } finally {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
  }
}

// O CONJUNTO de verificacoes de comportamento. Passa no corpo novo; tem de FALHAR no anterior e em cada mutante.
async function verificar(c) {
  // 1. O codigo de barras do produto.
  let r = await buscar(c, { search: EAN.camisa });
  assert.deepEqual(nomes(r), ["Prova385 Camisa"], "EAN do produto nao achou");
  assert.equal(Number(r.total_count), 1);
  r = await buscar(c, { search: `  ${EAN.camisa}  ` });
  assert.deepEqual(nomes(r), ["Prova385 Camisa"], "EAN com espacos nao achou");

  // 2. IGUALDADE: pedaco de EAN nao acha; EAN que e prefixo de outro nao traz o outro.
  for (const parcial of [
    EAN.camisa.slice(0, -1),
    EAN.camisa.slice(1),
    EAN.camisa.slice(3, 9),
    EAN.variacaoBranco.slice(0, -1),
  ]) {
    r = await buscar(c, { search: parcial });
    assert.deepEqual(nomes(r), [], `EAN parcial ${parcial} achou produto`);
    assert.equal(Number(r.total_count), 0);
  }
  assert.ok(
    EAN.tenis.startsWith(EAN.camisa),
    "fixture: um EAN tem de ser prefixo do outro",
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: EAN.camisa })),
    ["Prova385 Camisa"],
    "o EAN prefixo trouxe tambem o outro produto",
  );
  assert.deepEqual(nomes(await buscar(c, { search: EAN.tenis })), [
    "Prova385 Tenis",
  ]);

  // 3. O codigo de barras da variacao ATIVA: acha o produto pai, com TODAS as variacoes na resposta.
  r = await buscar(c, { search: EAN.variacaoBranco });
  assert.deepEqual(nomes(r), ["Prova385 Tenis"], "EAN da variacao nao achou");
  assert.equal(r.data[0].product_variants.length, 3);
  assert.deepEqual(nomes(await buscar(c, { search: EAN.variacaoPreto })), [
    "Prova385 Tenis",
  ]);

  // 4. O SKU da variacao: mesmo criterio do codigo do produto (sem caixa, sem acento, pedaco).
  for (const sku of ["P385-TEN-BR", "p385-ten-br", "TEN-PT", "p385-ten-p"]) {
    assert.deepEqual(
      nomes(await buscar(c, { search: sku })),
      ["Prova385 Tenis"],
      `SKU ${sku} nao achou`,
    );
  }
  assert.deepEqual(
    nomes(await buscar(c, { search: "p385-agua" })),
    ["Prova385 Garrafa"],
    "SKU com acento (P385-ÁGUA) nao achou sem o acento",
  );
  // O codigo do produto, como hoje: criterio igual ao do SKU.
  assert.deepEqual(nomes(await buscar(c, { search: "p385-cam" })), [
    "Prova385 Camisa",
  ]);

  // 5. Variacao INATIVA nao entra (codigo de barras nem SKU).
  for (const inativa of [EAN.variacaoInativa, "P385-TEN-INAT"]) {
    r = await buscar(c, { search: inativa });
    assert.deepEqual(
      nomes(r),
      [],
      `variacao inativa ${inativa} achou o produto`,
    );
    assert.equal(Number(r.total_count), 0);
  }

  // 6. Produto apagado nunca; produto inativo segue o filtro de status.
  assert.deepEqual(nomes(await buscar(c, { search: EAN.apagado })), []);
  assert.deepEqual(nomes(await buscar(c, { search: EAN.inativo })), [
    "Prova385 Inativo",
  ]);
  assert.deepEqual(
    nomes(await buscar(c, { search: EAN.inativo, status: "active" })),
    [],
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: EAN.inativo, status: "inactive" })),
    ["Prova385 Inativo"],
  );

  // 7. As outras clausulas valem JUNTO com o codigo: estoque baixo e categoria.
  assert.deepEqual(
    nomes(await buscar(c, { search: EAN.baixo, stock: "low" })),
    ["Prova385 Estoque Baixo"],
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: EAN.camisa, stock: "low" })),
    [],
    "o filtro de estoque baixo foi perdido",
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: EAN.camisa, category: "Roupas385" })),
    ["Prova385 Camisa"],
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: EAN.camisa, category: "Outra385" })),
    [],
    "o filtro de categoria foi perdido",
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: "P385-TEN-BR", category: "Outra385" })),
    [],
  );

  // 8. Nome e codigo, como sempre.
  assert.deepEqual(nomes(await buscar(c, { search: "prova385 camisa" })), [
    "Prova385 Camisa",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "prova385 bone" })), [
    "Prova385 Boné Preto",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "P385-BON" })), [
    "Prova385 Boné Preto",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: EAN.bone })), [
    "Prova385 Boné Preto",
  ]);
  assert.deepEqual(
    nomes(await buscar(c, { search: "zzz-nao-existe-385" })),
    [],
  );

  // 9. Varias variacoes casando: o produto sai UMA vez, no total e na lista.
  r = await buscar(c, { search: "P385-MULTI" });
  assert.deepEqual(nomes(r), ["Prova385 Multi"]);
  assert.equal(Number(r.total_count), 1);
  assert.equal(r.data.length, 1);

  // 10. Paginacao: cinco produtos achados so pelo SKU da variacao, em paginas de 2.
  const paginas = [];
  for (const pagina of [0, 1, 2]) {
    paginas.push(
      await buscar(c, { search: "P385-LOTE", page: pagina, size: 2 }),
    );
  }
  assert.deepEqual(
    paginas.map((p) => [p.data.length, Number(p.total_count)]),
    [
      [2, 5],
      [2, 5],
      [1, 5],
    ],
    "paginacao ou total_count errados na busca por SKU",
  );
  const todos = paginas.flatMap((p) => p.data.map((x) => x.nome));
  assert.deepEqual(
    todos,
    [5, 4, 3, 2, 1].map((n) => `Prova385 Lote ${n}`),
    "a ordem (data_cadastro DESC) ou a divisao das paginas mudou",
  );
  assert.equal(new Set(todos).size, 5);

  // 11. A porta de admin: cliente, ex-admin (so profiles rebaixado) e sessao ausente seguem recusados, buscando o EAN.
  for (const [rotulo, id] of [
    ["cliente comum", CLIENTE],
    ["ex-admin", EX_ADMIN],
    ["sem sessao", ""],
  ]) {
    await isolado(c, () =>
      comoUsuario(c, id, async () => {
        // A recusa e um erro SQL: sem savepoint ela aborta a transacao da prova inteira.
        await c.query("SAVEPOINT porta385");
        await assert.rejects(
          () => buscar(c, { search: EAN.camisa }),
          /Acesso negado/,
          `${rotulo} conseguiu buscar por codigo de barras`,
        );
        await c.query("ROLLBACK TO SAVEPOINT porta385");
      }),
    );
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // O topo instalado pelo CI (todas as migrations do zero) e o desta migration.
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      corpoDe(DEF_NOVA),
      "o topo instalado nao e o corpo da 385",
    );
    assert.equal(
      md5(corpoDe(DEF_ANTES)),
      HASH_ANTES,
      "o corpo anterior nao e o da 381",
    );
    assert.equal(md5(topo.prosrc), HASH_NOVO);

    // ---- Atores ----
    for (const [id, papelAuth, papelPerfil] of [
      [ADMIN, "admin", "admin"],
      [CLIENTE, "customer", "customer"],
      // Ex-admin: ainda admin em auth.users, rebaixado em profiles (o JWT velho nao conta).
      [EX_ADMIN, "admin", "customer"],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@busca385.invalid', $2::jsonb)`,
        [id, JSON.stringify(papelAuth === "admin" ? { role: "admin" } : {})],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 385', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papelPerfil],
      );
      // O gatilho de profiles sincroniza auth.users: o papel contraditorio do ex-admin nasce DEPOIS dele.
      await c.query(
        "UPDATE auth.users SET raw_app_meta_data = $2::jsonb WHERE id = $1::uuid",
        [id, JSON.stringify(papelAuth === "admin" ? { role: "admin" } : {})],
      );
    }
    assert.deepEqual(
      (
        await c.query(
          `SELECT u.id::text AS id, p.role AS perfil, u.raw_app_meta_data->>'role' AS papel_auth
             FROM auth.users u JOIN public.profiles p ON p.id = u.id
            WHERE u.id = ANY($1::uuid[]) ORDER BY u.id`,
          [[ADMIN, CLIENTE, EX_ADMIN]],
        )
      ).rows.map((r) => [r.perfil, r.papel_auth]),
      [
        ["admin", "admin"],
        ["customer", null],
        ["customer", "admin"],
      ],
      "os atores nasceram como o teste declara (o ex-admin e admin so em auth.users)",
    );
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);

    // ---- Fixture: produtos e variacoes que JA existiam antes da migration ----
    let dia = 0;
    const produto = async (o) => {
      dia += 1;
      return (
        await c.query(
          `INSERT INTO public.produtos
             (nome, codigo, codigo_barras, categoria, custo, preco_venda, estoque, estoque_minimo, ativo, deleted_at, data_cadastro)
           VALUES ($1, $2, $3, $4, 10, 20, $5, $6, $7, $8, TIMESTAMPTZ '2031-01-01 00:00:00+00' + make_interval(secs => $9::int))
           RETURNING id`,
          [
            o.nome,
            o.codigo ?? null,
            o.ean ?? null,
            o.categoria ?? "Geral385",
            o.estoque ?? 100,
            o.minimo ?? 5,
            o.ativo ?? true,
            o.apagado ? new Date().toISOString() : null,
            dia,
          ],
        )
      ).rows[0].id;
    };
    const variacao = async (produtoId, o) => {
      await c.query(
        `INSERT INTO public.product_variants (product_id, name, value, sku, codigo_barras, active, stock_increment)
         VALUES ($1, 'Cor', $2, $3, $4, $5, $6)`,
        [
          produtoId,
          o.valor,
          o.sku ?? null,
          o.ean ?? null,
          o.ativa ?? true,
          o.estoque ?? 10,
        ],
      );
    };
    await produto({
      nome: "Prova385 Camisa",
      codigo: "P385-CAM-001",
      ean: EAN.camisa,
      categoria: "Roupas385",
    });
    const tenis = await produto({
      nome: "Prova385 Tenis",
      codigo: "P385-TEN-002",
      ean: EAN.tenis,
      categoria: "Roupas385",
    });
    await variacao(tenis, {
      valor: "Branco",
      sku: "P385-TEN-BR",
      ean: EAN.variacaoBranco,
    });
    await variacao(tenis, {
      valor: "Preto",
      sku: "P385-TEN-PT",
      ean: EAN.variacaoPreto,
    });
    await variacao(tenis, {
      valor: "Inativo",
      sku: "P385-TEN-INAT",
      ean: EAN.variacaoInativa,
      ativa: false,
    });
    const bone = await produto({
      nome: "Prova385 Boné Preto",
      codigo: "P385-BON-003",
    });
    await variacao(bone, { valor: "M", sku: "P385-BONE-M", ean: EAN.bone });
    await produto({
      nome: "Prova385 Apagado",
      ean: EAN.apagado,
      apagado: true,
    });
    await produto({ nome: "Prova385 Inativo", ean: EAN.inativo, ativo: false });
    await produto({
      nome: "Prova385 Estoque Baixo",
      ean: EAN.baixo,
      estoque: 1,
      minimo: 5,
    });
    const garrafa = await produto({ nome: "Prova385 Garrafa" });
    await variacao(garrafa, { valor: "Azul", sku: "P385-ÁGUA-01" });
    const multi = await produto({ nome: "Prova385 Multi" });
    for (const letra of ["A", "B", "C"]) {
      await variacao(multi, { valor: letra, sku: `P385-MULTI-${letra}` });
    }
    for (const n of [1, 2, 3, 4, 5]) {
      const id = await produto({ nome: `Prova385 Lote ${n}` });
      await variacao(id, { valor: `L${n}`, sku: `P385-LOTE-${n}` });
    }
    const contar = async (sql) => Number((await c.query(sql)).rows[0].n);
    const produtosAntes = await contar(
      "SELECT count(*) AS n FROM public.produtos",
    );
    const variantesAntes = await contar(
      "SELECT count(*) AS n FROM public.product_variants",
    );
    const dumpAntes = (
      await c.query(
        `SELECT md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)) AS h FROM public.produtos x`,
      )
    ).rows[0].h;
    const dumpVarAntes = (
      await c.query(
        `SELECT md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)) AS h FROM public.product_variants x`,
      )
    ).rows[0].h;

    // ---- CONTROLE: com o corpo ANTERIOR (o rollback desta migration) o defeito aparece NESTA fixture ----
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(
      anterior.prosrc,
      corpoDe(DEF_ANTES),
      "o rollback nao devolveu o corpo da 381 byte a byte",
    );
    assert.equal(md5(anterior.prosrc), HASH_ANTES);
    assert.deepEqual(
      { ...anterior, prosrc: null },
      { ...topo, prosrc: null },
      "o rollback mudou OID, dono, ACL ou atributo",
    );
    assert.deepEqual(nomes(await buscar(c, { search: "prova385 camisa" })), [
      "Prova385 Camisa",
    ]);
    assert.deepEqual(nomes(await buscar(c, { search: "P385-CAM" })), [
      "Prova385 Camisa",
    ]);
    for (const termo of [
      EAN.camisa,
      EAN.variacaoBranco,
      "P385-TEN-BR",
      EAN.bone,
    ]) {
      assert.deepEqual(
        nomes(await buscar(c, { search: termo })),
        [],
        `controle: o corpo anterior ja achava ${termo}`,
      );
    }
    await assert.rejects(
      () => verificar(c),
      "controle: o corpo anterior passou na prova inteira",
    );
    // O que o corpo anterior devolve em buscas que NAO envolvem codigo de barras nem SKU: referencia de paridade.
    const TERMOS_IGUAIS = [
      "",
      "   ",
      "prova385",
      "prova385 camisa",
      "P385-CAM",
      "p385-bon",
      "bone",
      "Prova385 Lote",
      "zzz-nao-existe-385",
      "Prova385 Boné",
    ];
    const FILTROS = [
      {},
      { status: "active" },
      { status: "inactive" },
      { stock: "low" },
      { category: "Roupas385" },
    ];
    const normalizar = (r) => ({
      total_count: Number(r.total_count),
      data: [...r.data].sort((a, b) => (a.id < b.id ? -1 : 1)),
    });
    const referencia = new Map();
    for (const termo of TERMOS_IGUAIS) {
      for (const filtro of FILTROS) {
        referencia.set(
          JSON.stringify([termo, filtro]),
          normalizar(await buscar(c, { search: termo, ...filtro })),
        );
      }
    }
    const nulaAntes = (
      await c.query("SELECT public.get_admin_products_paged(NULL) AS r")
    ).rows[0].r;
    const vazioAntes = await buscar(c, {});
    console.log(
      "  PASSOU controle: o corpo anterior acha nome e codigo mas NAO acha EAN do produto, EAN da variacao nem SKU da variacao",
    );

    // ---- A MIGRATION, sobre a fixture que ja existia ----
    await c.query(migration);
    assert.deepEqual(
      await funcao(c),
      topo,
      "apply nao reproduziu o topo instalado pelo CI",
    );
    assert.equal(
      await contar("SELECT count(*) AS n FROM public.produtos"),
      produtosAntes,
    );
    assert.equal(
      await contar("SELECT count(*) AS n FROM public.product_variants"),
      variantesAntes,
    );
    assert.equal(
      (
        await c.query(
          `SELECT md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)) AS h FROM public.produtos x`,
        )
      ).rows[0].h,
      dumpAntes,
      "apply alterou produto que ja existia",
    );
    assert.equal(
      (
        await c.query(
          `SELECT md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)) AS h FROM public.product_variants x`,
        )
      ).rows[0].h,
      dumpVarAntes,
      "apply alterou variacao que ja existia",
    );
    await verificar(c);
    console.log(
      "  PASSOU acha pelo EAN do produto, EAN e SKU da variacao ativa; EAN parcial e variacao inativa nao; total/paginacao batem; porta de admin intacta",
    );

    // ---- PARIDADE: tudo que o corpo anterior respondia sem codigo/SKU continua IGUAL ----
    for (const termo of TERMOS_IGUAIS) {
      for (const filtro of FILTROS) {
        assert.deepEqual(
          normalizar(await buscar(c, { search: termo, ...filtro })),
          referencia.get(JSON.stringify([termo, filtro])),
          `a resposta mudou para ${JSON.stringify([termo, filtro])}`,
        );
      }
    }
    assert.deepEqual(
      (await c.query("SELECT public.get_admin_products_paged(NULL) AS r"))
        .rows[0].r,
      nulaAntes,
      "busca NULL mudou",
    );
    assert.deepEqual(await buscar(c, {}), vazioAntes, "a busca vazia mudou");
    assert.deepEqual(
      await buscar(c, { search: "   " }),
      await buscar(c, { search: "" }),
    );
    console.log(
      "  PASSOU busca vazia, em branco, NULL, nome e codigo respondem IGUAL ao corpo anterior (10 termos x 5 filtros)",
    );

    // ---- PERMISSOES: nada de ACL mudou ----
    for (const [papel, esperado] of [
      ["anon", false],
      ["authenticated", true],
      ["service_role", true],
    ]) {
      assert.equal(
        (
          await c.query(
            `SELECT has_function_privilege($1, '${ASSINATURA}', 'EXECUTE') AS x`,
            [papel],
          )
        ).rows[0].x,
        esperado,
        `EXECUTE de ${papel}`,
      );
    }
    assert.equal(
      (
        await c.query(`SELECT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
          WHERE p.oid = '${ASSINATURA}'::regprocedure AND g.grantee = 0 AND g.privilege_type = 'EXECUTE') AS x`)
      ).rows[0].x,
      false,
      "PUBLIC ganhou EXECUTE",
    );
    console.log(
      "  PASSOU anon e PUBLIC sem EXECUTE; authenticated e service_role com",
    );

    // ---- MUTANTES: cada pedaco da correcao, tirado, derruba a prova ----
    const SEM_VARIACOES =
      / *EXISTS \(\n *SELECT 1 FROM public\.product_variants vc[\s\S]*?\n *\)\n/g;
    const mutantes = [
      [
        "sem o EAN do produto",
        (d) => d.replaceAll("p.codigo_barras = v_clean_search OR\n", ""),
      ],
      ["sem as variacoes", (d) => d.replace(SEM_VARIACOES, "FALSE\n")],
      [
        "so a pagina, sem o total (total_count igual ao de antes)",
        (d) =>
          d.replace(
            /(SELECT COUNT\(p\.id\) INTO v_total_count[\s\S]*?)p\.codigo_barras = v_clean_search OR\n *EXISTS \([\s\S]*?\n *\)\n/,
            "$1FALSE\n",
          ),
      ],
      [
        "EAN do produto parcial (ILIKE no lugar da igualdade)",
        (d) =>
          d.replaceAll(
            "p.codigo_barras = v_clean_search",
            "p.codigo_barras ILIKE '%' || v_clean_search || '%'",
          ),
      ],
      [
        "EAN da variacao parcial",
        (d) =>
          d.replaceAll(
            "vc.codigo_barras = v_clean_search",
            "vc.codigo_barras ILIKE '%' || v_clean_search || '%'",
          ),
      ],
      ["variacao inativa entra", (d) => d.replaceAll(" AND vc.active", "")],
      [
        "SKU so por igualdade",
        (d) =>
          d.replaceAll(
            "unaccent(vc.sku) ILIKE unaccent('%' || v_clean_search || '%')",
            "vc.sku = v_clean_search",
          ),
      ],
      [
        "SKU sem unaccent",
        (d) =>
          d.replaceAll(
            "unaccent(vc.sku) ILIKE unaccent('%' || v_clean_search || '%')",
            "vc.sku ILIKE '%' || v_clean_search || '%'",
          ),
      ],
      [
        "sem a porta de admin",
        (d) =>
          d.replace(
            /IF NOT public\.is_admin_atual\(\) THEN[\s\S]*?END IF;/,
            "",
          ),
      ],
      [
        "a porta volta a ser is_admin() (JWT)",
        (d) =>
          d.replace(
            "IF NOT public.is_admin_atual() THEN",
            "IF NOT public.is_admin() THEN",
          ),
      ],
    ];
    for (const [rotulo, mutar] of mutantes) {
      await isolado(c, async () => {
        const mutado = mutar(DEF_NOVA);
        assert.notEqual(mutado, DEF_NOVA, `mutante "${rotulo}" nao mudou nada`);
        await c.query(mutado);
        await assert.rejects(
          () => verificar(c),
          `o mutante "${rotulo}" passou na prova`,
        );
      });
    }
    console.log(
      `  PASSOU ${mutantes.length} mutantes derrubados (EAN do produto, variacoes, total_count, igualdade x parcial, variacao inativa, SKU, porta de admin)`,
    );

    // ---- REAPLICAR e PRE-VOO: corpo/atributo/ACL/coluna desconhecidos derrubam a migration sem gravar ----
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo, "reaplicar mudou algo");
    await verificar(c);
    const sabotagens = [
      [
        "corpo desconhecido",
        () =>
          c.query(
            `CREATE OR REPLACE FUNCTION ${ASSINATURA.replace("(text,text,text,text,integer,integer)", "")}(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $x$ BEGIN RETURN '{}'::jsonb; END; $x$`,
          ),
      ],
      [
        "search_path diferente",
        () => c.query(`ALTER FUNCTION ${ASSINATURA} SET search_path = public`),
      ],
      [
        "sem SECURITY DEFINER",
        () => c.query(`ALTER FUNCTION ${ASSINATURA} SECURITY INVOKER`),
      ],
      ["STABLE", () => c.query(`ALTER FUNCTION ${ASSINATURA} STABLE`)],
      [
        "anon com EXECUTE",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`),
      ],
      [
        "PUBLIC com EXECUTE",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO PUBLIC`),
      ],
      [
        "service_role sem EXECUTE",
        () =>
          c.query(`REVOKE EXECUTE ON FUNCTION ${ASSINATURA} FROM service_role`),
      ],
      [
        "sku sumiu",
        () =>
          c.query(
            "ALTER TABLE public.product_variants RENAME COLUMN sku TO sku_x",
          ),
      ],
      [
        "codigo_barras da variacao sumiu",
        () =>
          c.query(
            "ALTER TABLE public.product_variants RENAME COLUMN codigo_barras TO codigo_barras_x",
          ),
      ],
      [
        "codigo_barras do produto sumiu",
        () =>
          c.query(
            "ALTER TABLE public.produtos RENAME COLUMN codigo_barras TO codigo_barras_x",
          ),
      ],
      [
        "active da variacao sumiu",
        () =>
          c.query(
            "ALTER TABLE public.product_variants RENAME COLUMN active TO active_x",
          ),
      ],
    ];
    for (const [rotulo, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await sabotar();
        const estranho = await funcao(c);
        await c.query("SAVEPOINT recusa385");
        await assert.rejects(
          () => c.query(migration),
          /B1_BASELINE_DIVERGENT/,
          `a migration aceitou a sabotagem "${rotulo}"`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa385");
        assert.deepEqual(
          await funcao(c),
          estranho,
          `a recusa de "${rotulo}" gravou algo`,
        );
      });
    }
    // Loja que ainda nao recebeu a 20261381 (gate is_admin(), corpo d3a111...): recusada, sem gravar.
    await isolado(c, async () => {
      const def213 = DEF_ANTES.replace(
        "IF NOT public.is_admin_atual() THEN",
        "IF NOT public.is_admin() THEN",
      );
      assert.notEqual(def213, DEF_ANTES);
      assert.equal(
        md5(corpoDe(def213)),
        "d3a111d95dabb52efe7af6f3ce66fb7e",
        "fixture: o corpo anterior a 20261381 nao e o da 20261213",
      );
      await c.query(def213);
      const antesDaRecusa = await funcao(c);
      await c.query("SAVEPOINT recusa385b");
      await assert.rejects(() => c.query(migration), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT recusa385b");
      assert.deepEqual(await funcao(c), antesDaRecusa);
    });
    console.log(
      `  PASSOU reaplicar nao muda nada; ${sabotagens.length + 1} estados desconhecidos (corpo, atributos, ACL, colunas, loja sem a 20261381) derrubam a migration sem gravar`,
    );

    // ---- ROLLBACK: devolve a 381 byte a byte; o segundo recusa; ida e volta nao toca nos dados ----
    await c.query(rollback);
    assert.equal((await funcao(c)).prosrc, corpoDe(DEF_ANTES));
    await c.query("SAVEPOINT segundo385");
    await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT segundo385");
    assert.equal((await funcao(c)).prosrc, corpoDe(DEF_ANTES));
    // A 20261381 so se desfaz com o corpo dela: o rollback dela aceita o estado que o nosso rollback deixa.
    await c.query("SAVEPOINT rb81");
    await c.query(
      ler(
        "supabase/migrations/rollback-manual-20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql",
      ),
    );
    await c.query("ROLLBACK TO SAVEPOINT rb81");
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    await verificar(c);
    assert.equal(
      (
        await c.query(
          `SELECT md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)) AS h FROM public.produtos x`,
        )
      ).rows[0].h,
      dumpAntes,
      "ida e volta alterou produto",
    );
    assert.equal(
      (
        await c.query(
          `SELECT md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)) AS h FROM public.product_variants x`,
        )
      ).rows[0].h,
      dumpVarAntes,
      "ida e volta alterou variacao",
    );
    console.log(
      "  PASSOU rollback devolve a 381 byte a byte, o segundo rollback recusa, o rollback da 381 roda sobre o estado devolvido, e a ida e volta nao toca em produto nem variacao",
    );

    // ---- CONSULTAS 90a/90b: so catalogo, rol fechado de 4 linhas; positivas/negativas do lado certo ----
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
    const C90A = "90a-conferir-busca-do-painel-por-codigo-aplicado";
    const C90B = "90b-antes-busca-do-painel-por-codigo-base-vigente";
    const rol = [
      "controle: funcoes de public visiveis a este papel",
      "get_admin_products_paged: corpo exato (md5)",
      "get_admin_products_paged: assinatura e atributos conhecidos",
      "get_admin_products_paged: EXECUTE authenticated e service_role, sem PUBLIC ou anon",
    ];
    const rodar = async (nome) => (await c.query(consulta(nome))).rows;
    const todasOk = (rows) => rows.every((x) => x.ok === true);
    for (const [nome, ladoCerto] of [
      [C90A, "depois"],
      [C90B, "antes"],
    ]) {
      const depois = await rodar(nome);
      assert.deepEqual(
        depois.map((x) => x.item).sort(),
        [...rol].sort(),
        `${nome}: rol mudou`,
      );
      assert.equal(
        todasOk(depois),
        ladoCerto === "depois",
        `${nome}: errada com o corpo novo`,
      );
    }
    await isolado(c, async () => {
      await c.query(rollback);
      assert.equal(
        todasOk(await rodar(C90A)),
        false,
        "90a positiva com o corpo anterior",
      );
      assert.equal(
        todasOk(await rodar(C90B)),
        true,
        "90b negativa com o corpo anterior",
      );
      // O controle da linha 1 nao some: a falha vem so das linhas do md5.
      const a = await rodar(C90A);
      assert.equal(a.find((x) => x.item === rol[0]).ok, true);
      assert.equal(a.find((x) => x.item === rol[1]).ok, false);
    });
    await isolado(c, async () => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`);
      const a = await rodar(C90A);
      assert.equal(
        a.find((x) => x.item === rol[3]).ok,
        false,
        "90a nao viu o EXECUTE do anon",
      );
    });
    console.log(
      "  PASSOU consultas 90a (positiva so com o corpo novo) e 90b (positiva so com o anterior): 4 linhas fechadas, EXECUTE do anon reprova",
    );

    // ---- PORTOES VIZINHOS: a 17a (lote 17) e a 86a (a 381) aceitam o corpo da 381 E o desta, e reprovam so a linha desta
    // funcao com qualquer outro corpo. Sem este passo a 385 deixaria os dois portoes vermelhos numa loja que a recebeu. ----
    const PORTOES = [
      [
        "17a-conferir-estoque-do-painel-aplicado",
        /^get_admin_products_paged: corpo e o da 20261213000000/,
      ],
      [
        "86a-conferir-ex-admin-no-resto-do-painel-aplicado",
        /^RPC: public\.get_admin_products_paged/,
      ],
    ];
    const rodarPortao = async ([nome, linhaDaFuncao]) => {
      const rows = await rodar(nome);
      const dela = rows.filter((r) => linhaDaFuncao.test(r.item));
      assert.equal(
        dela.length,
        1,
        `${nome}: a linha da funcao sumiu ou duplicou`,
      );
      return { dela: dela[0], resto: rows.filter((r) => r !== dela[0]) };
    };
    for (const portao of PORTOES) {
      // corpo desta migration no ar (estado da arvore inteira)
      let r = await rodarPortao(portao);
      assert.equal(r.dela.ok, true, `${portao[0]}: reprovou o corpo da 385`);
      assert.equal(
        r.resto.every((x) => x.ok),
        true,
        `${portao[0]}: outra linha reprovou`,
      );
      // corpo da 381 no ar (loja que ainda nao recebeu a 385)
      await isolado(c, async () => {
        await c.query(rollback);
        r = await rodarPortao(portao);
        assert.equal(r.dela.ok, true, `${portao[0]}: reprovou o corpo da 381`);
        assert.equal(
          r.resto.every((x) => x.ok),
          true,
        );
      });
      // corpo estranho (um comentario a mais) no ar: reprova a linha da funcao, so ela
      await isolado(c, async () => {
        const estranho = (await funcao(c)).prosrc.replace(
          "BEGIN",
          "BEGIN -- estranho",
        );
        assert.notEqual(estranho, (await funcao(c)).prosrc);
        await c.query(
          `CREATE OR REPLACE FUNCTION ${ASSINATURA.replace("(text,text,text,text,integer,integer)", "")}(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $corpo$${estranho}$corpo$`,
        );
        r = await rodarPortao(portao);
        assert.equal(
          r.dela.ok,
          false,
          `${portao[0]}: aceitou um corpo estranho`,
        );
        assert.equal(
          r.resto.every((x) => x.ok),
          true,
          `${portao[0]}: reprovou fora da funcao`,
        );
      });
    }
    console.log(
      "  PASSOU 17a e 86a aceitam o corpo da 381 e o da 385 e reprovam so a linha de get_admin_products_paged com corpo estranho",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  // ---- ATOMICIDADE: o aplicador manda o arquivo inteiro numa consulta so; falhar no fim nao deixa NADA gravado ----
  // Conexao propria, SEM BEGIN: o estado e commitado de verdade (no clone descartavel), e restaurado no fim.
  const d = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await d.connect();
  try {
    const hash = async () =>
      (
        await d.query(
          `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = '${ASSINATURA}'::regprocedure`,
        )
      ).rows[0].h;
    assert.equal(await hash(), HASH_NOVO);
    await d.query(rollback);
    assert.equal(await hash(), HASH_ANTES);
    await assert.rejects(
      () => d.query(`${migration}\nSELECT 1/0;`),
      /division by zero/,
    );
    assert.equal(
      await hash(),
      HASH_ANTES,
      "a migration que falhou no fim deixou o corpo novo gravado pela metade",
    );
    await d.query(migration);
    assert.equal(await hash(), HASH_NOVO);
    console.log(
      "  PASSOU migration que falha no fim (SELECT 1/0 depois do CREATE) nao deixa nada gravado; reaplicada, vira o corpo novo",
    );
  } finally {
    // Garante o estado final do clone: o corpo novo.
    await d.query(migration).catch(() => {});
    await d.end();
  }
  console.log("[busca-do-painel] prova viva concluida (20261385).");
}

main().catch((erro) => {
  console.error(`[busca-do-painel] FALHOU: ${erro.stack || erro.message}`);
  process.exit(1);
});

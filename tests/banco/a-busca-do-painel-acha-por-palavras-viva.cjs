"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// 20261399200000: somente Postgres descartavel do rpc-ci, nunca banco de loja.
// A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: a busca de Produtos do painel e do balcao (get_admin_products_paged, p_search) quebra o texto em palavras e exige
// TODAS (AND, em qualquer ordem, sem caixa nem acento) no texto junto de nome + codigo + SKU, nome e valor das variacoes ATIVAS.
// "camiseta branca P" acha a camiseta; variacao inativa nao entra; % _ e a barra invertida valem como as letras que sao; o codigo de
// barras segue por igualdade do texto inteiro; texto vazio/em branco/NULL nao filtra; total_count e paginacao batem com a lista.
// Um ORACULO em JavaScript (calculado dos dados, nao da funcao) confere centenas de buscas de 1 a 3 palavras contra o banco.
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/a-busca-do-painel-acha-por-palavras-viva.cjs
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261399200000_a_busca_de_produtos_do_painel_acha_por_palavras.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const migration85 = ler(
  "supabase/migrations/20261385000000_a_busca_de_produtos_do_painel_acha_pelo_codigo_de_barras_e_da_variacao.sql",
);
const rollback85 = ler(
  "supabase/migrations/rollback-manual-20261385000000_a_busca_de_produtos_do_painel_acha_pelo_codigo_de_barras_e_da_variacao.sql",
);
const ASSINATURA =
  "public.get_admin_products_paged(text,text,text,text,integer,integer)";
const FIM_DA_FUNCAO = "$function$;";
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
const DEF_ANTES = definicao(migration85);
const HASH_ANTES = "39db382689def5fac3b263a66f84ede1";
const HASH_NOVO = "346063e900b8b7b63dfbeffe5070eedc";

const ADMIN = "5e399200-0000-4000-8000-000000000001";
const CLIENTE = "5e399200-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399200-0000-4000-8000-000000000003";
const CAT = "Cat3992";
// Codigos de barras de fixture. EAN.camiseta e prefixo de EAN.meia DE PROPOSITO.
const EAN = {
  camiseta: "7992000000011",
  meia: "79920000000119",
  varBranca: "7992100000028",
  varInativa: "7992100000042",
  apagado: "7992400000015",
};

const nomes = (r) => r.data.map((p) => p.nome).sort();
async function buscar(c, o = {}) {
  const r = (
    await c.query(
      "SELECT public.get_admin_products_paged($1, $2, $3, $4, $5, $6) AS r",
      [
        o.search ?? "",
        o.category ?? CAT,
        o.status ?? "all",
        o.stock ?? "all",
        o.page ?? 0,
        o.size ?? 100,
      ],
    )
  ).rows[0].r;
  // O total e SEMPRE o da lista inteira: numa pagina so, ele tem de ser o tamanho dela.
  if (r.data.length < (o.size ?? 100) && (o.page ?? 0) === 0) {
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
  await c.query("SAVEPOINT caso3992");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3992");
    await c.query("RELEASE SAVEPOINT caso3992");
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
// Sem caixa e sem acento, como o unaccent + ILIKE do banco (as letras da fixture sao as do portugues).
const sem = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// O ORACULO: o que a busca DEVE devolver, calculado so dos dados (produtos + variacoes ATIVAS), sem chamar a funcao.
async function oraculo(c) {
  const prods = (
    await c.query(
      "SELECT id, nome, codigo FROM public.produtos WHERE deleted_at IS NULL AND categoria = $1",
      [CAT],
    )
  ).rows;
  const vars = (
    await c.query(
      "SELECT product_id, sku, name, value FROM public.product_variants WHERE active AND product_id = ANY($1::uuid[])",
      [prods.map((p) => p.id)],
    )
  ).rows;
  const texto = new Map(
    prods.map((p) => [
      p.nome,
      sem(
        [
          p.nome,
          p.codigo,
          ...vars
            .filter((v) => v.product_id === p.id)
            .flatMap((v) => [v.sku, v.name, v.value]),
        ]
          .filter((x) => x != null && x !== "")
          .join(" "),
      ),
    ]),
  );
  return (consulta) => {
    const palavras = consulta.split(/\s+/).filter(Boolean).map(sem);
    return [...texto.entries()]
      .filter(([, t]) => palavras.every((w) => t.includes(w)))
      .map(([nome]) => nome)
      .sort();
  };
}

// O CONJUNTO de verificacoes de comportamento. Passa no corpo novo; tem de FALHAR no anterior e em cada mutante.
async function verificar(c) {
  let r;
  // 1. O exemplo do balcao: "camiseta branca P". Em qualquer ordem, caixa, acento e quantidade de espacos.
  for (const frase of [
    "camiseta branca P",
    "P branca camiseta",
    "branca P camiseta",
    "CAMISETA   BRANCA   p",
    "camiseta\tbranca\tp",
    "  camiseta branca p  ",
    "camíseta bránca P",
    "BÁSICA branca p",
  ]) {
    r = await buscar(c, { search: frase });
    assert.deepEqual(
      nomes(r),
      ["Camiseta Básica 3992"],
      `"${frase.replace(/\t/g, "\\t")}" nao achou a camiseta`,
    );
    assert.equal(Number(r.total_count), 1);
    // A resposta traz TODAS as variacoes do produto (ate a inativa), como sempre.
    assert.equal(r.data[0].product_variants.length, 5);
  }
  // Sem filtro de categoria o exemplo continua achando (a fixture nao depende do filtro).
  assert.ok(
    nomes(
      await buscar(c, { search: "camiseta branca P", category: "all" }),
    ).includes("Camiseta Básica 3992"),
  );

  // 2. TODAS as palavras: faltou uma, nao acha.
  for (const frase of [
    "camiseta branca GG",
    "camiseta azul",
    "camiseta xyzxyz",
    "branca xyzxyz",
  ]) {
    assert.deepEqual(nomes(await buscar(c, { search: frase })), [], frase);
  }
  // O texto e do PRODUTO: a camiseta tem uma variacao branca e outra de tamanho P (documentado).
  assert.deepEqual(nomes(await buscar(c, { search: "preta M" })), [
    "Camiseta Básica 3992",
  ]);
  // A calca tem a variacao branca mas nao o P nem a camiseta no nome.
  assert.deepEqual(nomes(await buscar(c, { search: "calca branca" })), [
    "Calça Jeans 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "calça branca P" })), []);

  // 3. Uma palavra so: acha por nome, codigo, SKU, e agora por nome e valor da variacao ativa.
  assert.deepEqual(nomes(await buscar(c, { search: "branca" })), [
    "Calça Jeans 3992",
    "Camiseta Básica 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "tamanho" })), [
    "Calça Jeans 3992",
    "Camiseta Básica 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "CAM3992-PT" })), [
    "Camiseta Básica 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "agua" })), [
    "Garrafa Água 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "ÁGUA3992-az" })), [
    "Garrafa Água 3992",
  ]);
  // Campos diferentes na mesma frase: nome + codigo + SKU.
  assert.deepEqual(
    nomes(await buscar(c, { search: "camiseta CAM-3992 cam3992-br" })),
    ["Camiseta Básica 3992"],
  );

  // 4. Variacao INATIVA nao entra (nome, valor, SKU nem codigo de barras).
  for (const frase of [
    "vermelha",
    "estampa",
    "camiseta vermelha",
    "CAM3992-VM",
    EAN.varInativa,
  ]) {
    r = await buscar(c, { search: frase });
    assert.deepEqual(nomes(r), [], `variacao inativa: "${frase}" achou`);
    assert.equal(Number(r.total_count), 0);
  }

  // 5. Uma palavra NAO atravessa campos: "992cam" so existiria colando o nome com o codigo.
  for (const colado of [
    "992cam",
    "3992CAM",
    "brcor",
    "ptcor",
    "brancacam",
    "pretacam",
  ]) {
    assert.deepEqual(
      nomes(await buscar(c, { search: colado })),
      [],
      `"${colado}" achou atravessando campos`,
    );
  }

  // 6. % _ e \ valem como as letras que sao.
  assert.deepEqual(nomes(await buscar(c, { search: "50%" })), [
    "Desconto 50% 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "5%0" })), []);
  assert.deepEqual(nomes(await buscar(c, { search: "%" })), [
    "Desconto 50% 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "Item_sub" })), [
    "Item_sub 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "_" })), ["Item_sub 3992"]);
  assert.deepEqual(nomes(await buscar(c, { search: "Item%" })), []);
  assert.deepEqual(nomes(await buscar(c, { search: "Barra\\" })), [
    "Barra\\ 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: "\\" })), ["Barra\\ 3992"]);
  assert.deepEqual(nomes(await buscar(c, { search: "a\\b" })), []);
  assert.deepEqual(nomes(await buscar(c, { search: "50% desconto" })), [
    "Desconto 50% 3992",
  ]);

  // 7. Codigo de barras: IGUALDADE do texto inteiro; pedaco nao acha; prefixo nao traz o outro.
  assert.ok(EAN.meia.startsWith(EAN.camiseta), "fixture: EAN prefixo do outro");
  assert.deepEqual(nomes(await buscar(c, { search: EAN.camiseta })), [
    "Camiseta Básica 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: `  ${EAN.camiseta} ` })), [
    "Camiseta Básica 3992",
  ]);
  assert.deepEqual(nomes(await buscar(c, { search: EAN.meia })), ["Meia 3992"]);
  for (const parcial of [
    EAN.camiseta.slice(0, -1),
    EAN.camiseta.slice(1),
    EAN.camiseta.slice(3, 9),
    EAN.varBranca.slice(0, -1),
  ]) {
    assert.deepEqual(
      nomes(await buscar(c, { search: parcial })),
      [],
      `EAN parcial ${parcial} achou produto`,
    );
  }
  r = await buscar(c, { search: EAN.varBranca });
  assert.deepEqual(nomes(r), ["Camiseta Básica 3992"]);
  assert.equal(r.data[0].product_variants.length, 5);
  assert.deepEqual(nomes(await buscar(c, { search: EAN.apagado })), []);
  assert.deepEqual(
    nomes(await buscar(c, { search: EAN.camiseta, stock: "low" })),
    [],
    "o filtro de estoque baixo foi perdido no ramo do EAN",
  );
  // O EAN so vale sozinho (igualdade do texto inteiro): com outra palavra junto nao acha, como antes.
  assert.deepEqual(
    nomes(await buscar(c, { search: `${EAN.camiseta} camiseta` })),
    [],
  );

  // 8. Produto apagado nunca; inativo segue o filtro de status.
  assert.deepEqual(nomes(await buscar(c, { search: "camiseta apagada" })), []);
  assert.deepEqual(nomes(await buscar(c, { search: "camiseta inativa" })), [
    "Camiseta Inativa 3992",
  ]);
  assert.deepEqual(
    nomes(await buscar(c, { search: "camiseta", status: "active" })),
    ["Camiseta Básica 3992"],
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: "camiseta", status: "inactive" })),
    ["Camiseta Inativa 3992"],
  );

  // 9. Categoria e estoque baixo valem JUNTO com as palavras.
  assert.deepEqual(
    nomes(
      await buscar(c, { search: "camiseta branca P", category: "Outra3992" }),
    ),
    [],
    "o filtro de categoria foi perdido",
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: "estoque baixo", stock: "low" })),
    ["Estoque Baixo 3992"],
  );
  assert.deepEqual(
    nomes(await buscar(c, { search: "camiseta branca P", stock: "low" })),
    [],
    "o filtro de estoque baixo foi perdido",
  );

  // 10. Varias variacoes casando: o produto sai UMA vez, no total e na lista.
  r = await buscar(c, { search: "multi azul" });
  assert.deepEqual(nomes(r), ["Multi3992"]);
  assert.equal(Number(r.total_count), 1);
  assert.equal(r.data.length, 1);

  // 11. Paginacao: cinco canecas achadas pela palavra da VARIACAO ("azul"), em paginas de 2; ordem e total intactos.
  const paginas = [];
  for (const pagina of [0, 1, 2]) {
    paginas.push(
      await buscar(c, { search: "caneca3992 azul", page: pagina, size: 2 }),
    );
  }
  assert.deepEqual(
    paginas.map((p) => [p.data.length, Number(p.total_count)]),
    [
      [2, 5],
      [2, 5],
      [1, 5],
    ],
    "paginacao ou total_count errados",
  );
  const todos = paginas.flatMap((p) => p.data.map((x) => x.nome));
  assert.deepEqual(
    todos,
    [5, 4, 3, 2, 1].map((n) => `Caneca3992 ${n}`),
    "a ordem (data_cadastro DESC) ou a divisao das paginas mudou",
  );

  // 12. Texto vazio, so de espacos/tabulacao e NULL: sem filtro, a lista inteira da categoria.
  const inteira = Number(
    (
      await c.query(
        "SELECT count(*) AS n FROM public.produtos WHERE deleted_at IS NULL AND categoria = $1",
        [CAT],
      )
    ).rows[0].n,
  );
  assert.ok(inteira >= 15, "fixture: a categoria tem de ter varios produtos");
  for (const vazio of ["", "   ", "\t", " \t \n ", "\t\t"]) {
    r = await buscar(c, { search: vazio });
    assert.equal(
      Number(r.total_count),
      inteira,
      `texto ${JSON.stringify(vazio)} filtrou a lista`,
    );
    assert.equal(r.data.length, inteira);
  }
  r = (
    await c.query(
      "SELECT public.get_admin_products_paged(NULL, $1, 'all', 'all', 0, 100) AS r",
      [CAT],
    )
  ).rows[0].r;
  assert.equal(Number(r.total_count), inteira, "NULL filtrou a lista");
  assert.equal(r.data.length, inteira);

  // 13. ORACULO: centenas de buscas de 1 a 3 palavras, conferidas contra o calculo feito so dos dados.
  const esperado = await oraculo(c);
  const vocab = [
    "camiseta",
    "branca",
    "p",
    "preta",
    "m",
    "tamanho",
    "cor",
    "jeans",
    "azul",
    "vermelha",
    "3992",
    "caneca3992",
    "basica",
    "agua",
    "calca",
    "cam3992-pt",
    "multi",
  ];
  const consultas = [];
  for (const a of vocab) consultas.push(a);
  for (const a of vocab) for (const b of vocab) consultas.push(`${a} ${b}`);
  let semente = 3992;
  const sorteia = (n) => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente % n;
  };
  for (let i = 0; i < 200; i++) {
    consultas.push(
      `${vocab[sorteia(vocab.length)]} ${vocab[sorteia(vocab.length)]} ${vocab[sorteia(vocab.length)]}`,
    );
  }
  let achouAlgo = 0;
  for (const q of consultas) {
    const dado = nomes(await buscar(c, { search: q }));
    assert.deepEqual(dado, esperado(q), `oraculo diverge para "${q}"`);
    if (dado.length) achouAlgo += 1;
  }
  assert.ok(
    achouAlgo > 100,
    "o oraculo precisa de muitas buscas que ACHAM algo",
  );

  // 14. A porta de admin: cliente, ex-admin (so profiles rebaixado) e sessao ausente seguem recusados, com a frase nova.
  for (const [rotulo, id] of [
    ["cliente comum", CLIENTE],
    ["ex-admin", EX_ADMIN],
    ["sem sessao", ""],
  ]) {
    await isolado(c, () =>
      comoUsuario(c, id, async () => {
        await c.query("SAVEPOINT porta3992");
        await assert.rejects(
          () => buscar(c, { search: "camiseta branca P" }),
          /Acesso negado/,
          `${rotulo} conseguiu buscar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT porta3992");
      }),
    );
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // A 20261399980000 (as listas do painel desempatam por id) sucede esta no MESMO get_admin_products_paged: sai PRIMEIRO
    // (so se no ar, so nesta transacao). Definicao em as-listas-do-painel-posterior.cjs.
    await require("./as-listas-do-painel-posterior.cjs").desfazerListasDoPainelNaTransacao(
      c,
    );
    // O topo instalado pelo CI (sem a 3998) e o desta migration.
    const topo = await funcao(c);
    assert.equal(md5(topo.prosrc), HASH_NOVO, "o topo nao e o corpo da 3992");
    assert.equal(topo.prosrc, corpoDe(DEF_NOVA));
    assert.equal(md5(corpoDe(DEF_ANTES)), HASH_ANTES);

    // ---- Atores ----
    for (const [id, papelAuth, papelPerfil] of [
      [ADMIN, "admin", "admin"],
      [CLIENTE, "customer", "customer"],
      // Ex-admin: ainda admin em auth.users, rebaixado em profiles (o JWT velho nao conta).
      [EX_ADMIN, "admin", "customer"],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@busca3992.invalid', $2::jsonb)`,
        [id, JSON.stringify(papelAuth === "admin" ? { role: "admin" } : {})],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 3992', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papelPerfil],
      );
      await c.query(
        "UPDATE auth.users SET raw_app_meta_data = $2::jsonb WHERE id = $1::uuid",
        [id, JSON.stringify(papelAuth === "admin" ? { role: "admin" } : {})],
      );
    }
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
            o.categoria ?? CAT,
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
         VALUES ($1, $2, $3, $4, $5, $6, 10)`,
        [
          produtoId,
          o.nome ?? "Cor",
          o.valor,
          o.sku ?? null,
          o.ean ?? null,
          o.ativa ?? true,
        ],
      );
    };
    const camiseta = await produto({
      nome: "Camiseta Básica 3992",
      codigo: "CAM-3992",
      ean: EAN.camiseta,
    });
    await variacao(camiseta, {
      valor: "Branca",
      sku: "CAM3992-BR",
      ean: EAN.varBranca,
    });
    await variacao(camiseta, { valor: "Preta", sku: "CAM3992-PT" });
    await variacao(camiseta, {
      nome: "Tamanho",
      valor: "P",
      sku: "CAM3992-P",
    });
    await variacao(camiseta, {
      nome: "Tamanho",
      valor: "M",
      sku: "CAM3992-M",
    });
    await variacao(camiseta, {
      nome: "Estampa",
      valor: "Vermelha",
      sku: "CAM3992-VM",
      ean: EAN.varInativa,
      ativa: false,
    });
    const calca = await produto({
      nome: "Calça Jeans 3992",
      codigo: "CAL-3992",
    });
    await variacao(calca, { valor: "Branca", sku: "CAL3992-BR" });
    await variacao(calca, { nome: "Tamanho", valor: "42", sku: "CAL3992-42" });
    await produto({ nome: "Meia 3992", ean: EAN.meia });
    await produto({ nome: "Desconto 50% 3992" });
    await produto({ nome: "Item_sub 3992" });
    await produto({ nome: "ItemXsub 3992" });
    await produto({ nome: "Barra\\ 3992" });
    const garrafa = await produto({ nome: "Garrafa Água 3992" });
    await variacao(garrafa, { valor: "Azul", sku: "ÁGUA3992-AZ" });
    await produto({ nome: "Estoque Baixo 3992", estoque: 1, minimo: 5 });
    await produto({
      nome: "Camiseta Inativa 3992",
      codigo: "CAI-3992",
      ativo: false,
    });
    await produto({
      nome: "Camiseta Apagada 3992",
      ean: EAN.apagado,
      apagado: true,
    });
    const multi = await produto({ nome: "Multi3992" });
    for (const letra of ["A", "B", "C"]) {
      await variacao(multi, { valor: "Azul", sku: `MULTI3992-${letra}` });
    }
    for (const n of [1, 2, 3, 4, 5]) {
      const id = await produto({ nome: `Caneca3992 ${n}` });
      await variacao(id, { valor: "Azul", sku: `CAN3992-${n}` });
    }
    const contar = async (sql) => Number((await c.query(sql)).rows[0].n);
    const dump = async (tabela) =>
      (
        await c.query(
          `SELECT md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)) AS h FROM public.${tabela} x`,
        )
      ).rows[0].h;
    const produtosAntes = await contar(
      "SELECT count(*) AS n FROM public.produtos",
    );
    const variantesAntes = await contar(
      "SELECT count(*) AS n FROM public.product_variants",
    );
    const dumpAntes = await dump("produtos");
    const dumpVarAntes = await dump("product_variants");

    // ---- CONTROLE: com o corpo ANTERIOR (o rollback desta migration) o defeito aparece NESTA fixture ----
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(
      anterior.prosrc,
      corpoDe(DEF_ANTES),
      "o rollback nao devolveu o corpo da 385 byte a byte",
    );
    assert.equal(md5(anterior.prosrc), HASH_ANTES);
    assert.deepEqual(
      { ...anterior, prosrc: null },
      { ...topo, prosrc: null },
      "o rollback mudou OID, dono, ACL ou atributo",
    );
    for (const frase of [
      "camiseta branca P",
      "P branca camiseta",
      "camiseta preta",
    ]) {
      assert.deepEqual(
        nomes(await buscar(c, { search: frase })),
        [],
        `controle: o corpo anterior ja achava "${frase}"`,
      );
    }
    await assert.rejects(
      () => verificar(c),
      "controle: o corpo anterior passou na prova inteira",
    );
    // O que o corpo anterior devolve com UMA palavra de nome/codigo/SKU (nada de nome/valor de variacao): referencia de paridade.
    const TERMOS_IGUAIS = [
      "",
      "   ",
      "camiseta",
      "Camiseta Básica",
      "CAM-3992",
      "cam3992-pt",
      "cam3992-vm",
      "caneca",
      "Caneca3992",
      "calca",
      "calça",
      "3992",
      "zzz-nao-existe-3992",
      EAN.camiseta,
      EAN.varBranca,
      EAN.meia,
    ];
    const FILTROS = [
      {},
      { status: "active" },
      { status: "inactive" },
      { stock: "low" },
      { category: "all" },
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
    console.log(
      "  PASSOU controle: o corpo anterior NAO acha 'camiseta branca P' (o exemplo do balcao) nem as palavras fora de ordem",
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
    assert.equal(await dump("produtos"), dumpAntes, "apply alterou produto");
    assert.equal(
      await dump("product_variants"),
      dumpVarAntes,
      "apply alterou variacao",
    );
    await verificar(c);
    console.log(
      "  PASSOU 'camiseta branca P' acha a camiseta (qualquer ordem, caixa, acento, espaco, tab); variacao inativa nao; % _ \\ literais; EAN por igualdade; vazio/NULL sem filtro; oraculo de ~500 buscas; paginacao e total; porta de admin",
    );

    // ---- PARIDADE: o que o corpo anterior respondia com uma palavra de nome/codigo/SKU continua IGUAL ----
    for (const termo of TERMOS_IGUAIS) {
      for (const filtro of FILTROS) {
        assert.deepEqual(
          normalizar(await buscar(c, { search: termo, ...filtro })),
          referencia.get(JSON.stringify([termo, filtro])),
          `a resposta mudou para ${JSON.stringify([termo, filtro])}`,
        );
      }
    }
    console.log(
      `  PASSOU ${TERMOS_IGUAIS.length} termos x ${FILTROS.length} filtros respondem IGUAL ao corpo anterior`,
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
    const PADROES =
      "replace(replace(replace(unaccent(w.palavra), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_')";
    const TODAS =
      "NOT EXISTS (SELECT 1 FROM unnest(v_padroes) AS w(padrao) WHERE t.texto NOT ILIKE w.padrao)";
    const BLOCO_PALAVRAS =
      /EXISTS \(\n\s*SELECT 1\n\s*FROM \(SELECT unaccent\(concat_ws[\s\S]*?\n\s*\)\n/g;
    const mutantes = [
      [
        "qualquer palavra basta (OR no lugar de AND)",
        (d) =>
          d.replaceAll(
            TODAS,
            "EXISTS (SELECT 1 FROM unnest(v_padroes) AS w(padrao) WHERE t.texto ILIKE w.padrao)",
          ),
      ],
      [
        "so a pagina tem o filtro de palavras (total_count sem ele)",
        (d) => {
          let n = 0;
          return d.replace(BLOCO_PALAVRAS, (m) => (++n === 1 ? "FALSE\n" : m));
        },
      ],
      [
        "so o total tem o filtro de palavras (pagina sem ele)",
        (d) => {
          let n = 0;
          return d.replace(BLOCO_PALAVRAS, (m) => (++n === 2 ? "FALSE\n" : m));
        },
      ],
      [
        "sem unaccent no texto do produto",
        (d) => d.replaceAll("unaccent(concat_ws(", "(concat_ws("),
      ],
      [
        "sem unaccent nas palavras",
        (d) =>
          d.replaceAll(
            PADROES,
            PADROES.replace("unaccent(w.palavra)", "w.palavra"),
          ),
      ],
      [
        "% sem escape",
        (d) =>
          d.replaceAll(
            PADROES,
            "replace(replace(unaccent(w.palavra), chr(92), chr(92) || chr(92)), '_', chr(92) || '_')",
          ),
      ],
      [
        "_ sem escape",
        (d) =>
          d.replaceAll(
            PADROES,
            "replace(replace(unaccent(w.palavra), chr(92), chr(92) || chr(92)), '%', chr(92) || '%')",
          ),
      ],
      [
        "barra invertida sem escape",
        (d) =>
          d.replaceAll(
            PADROES,
            "replace(replace(unaccent(w.palavra), '%', chr(92) || '%'), '_', chr(92) || '_')",
          ),
      ],
      [
        "so o espaco simples separa palavras (tab nao)",
        (d) => d.replaceAll("'[[:space:]]+'", "' '"),
      ],
      [
        "palavras coladas sem separador entre os campos",
        (d) =>
          d.replaceAll(
            "concat_ws(' ', p.nome, p.codigo,",
            "concat(p.nome, p.codigo,",
          ),
      ],
      [
        "variacoes coladas sem separador",
        (d) =>
          d.replaceAll(
            "vt.value), ' ') FROM public.product_variants vt",
            "vt.value), '') FROM public.product_variants vt",
          ),
      ],
      [
        "sem o valor e o nome da variacao",
        (d) =>
          d.replaceAll("concat_ws(' ', vt.sku, vt.name, vt.value)", "vt.sku"),
      ],
      [
        "sem o SKU da variacao",
        (d) =>
          d.replaceAll(
            "concat_ws(' ', vt.sku, vt.name, vt.value)",
            "concat_ws(' ', vt.name, vt.value)",
          ),
      ],
      [
        "sem o codigo do produto",
        (d) =>
          d.replaceAll(
            "concat_ws(' ', p.nome, p.codigo,",
            "concat_ws(' ', p.nome,",
          ),
      ],
      [
        "variacao inativa entra no texto",
        (d) => d.replaceAll(" AND vt.active", ""),
      ],
      [
        "sem o EAN do produto",
        (d) => d.replaceAll("p.codigo_barras = v_clean_search OR\n", ""),
      ],
      [
        "sem o EAN da variacao",
        (d) =>
          d.replaceAll(
            /EXISTS \(\n\s*SELECT 1 FROM public\.product_variants vc[\s\S]*?\n\s*\) OR\n/g,
            "",
          ),
      ],
      [
        "EAN do produto parcial",
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
      [
        "EAN de variacao inativa entra",
        (d) =>
          d.replaceAll("vc.active AND vc.codigo_barras", "vc.codigo_barras"),
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
      [
        "sem o filtro de categoria na pagina",
        (d) => {
          let n = 0;
          return d.replace(
            /AND \(p_category = 'all' OR p\.categoria = p_category\)/g,
            (m) => (++n === 2 ? "" : m),
          );
        },
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
      `  PASSOU ${mutantes.length} mutantes derrubados (OR, total x pagina, acento, % _ barra, separadores, campos, variacao inativa, EAN, porta de admin, categoria)`,
    );

    // ---- REAPLICAR (LF e CRLF) e PRE-VOO: corpo/atributo/ACL/coluna desconhecidos derrubam a migration sem gravar ----
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo, "reaplicar mudou algo");
    await verificar(c);
    await c.query(migration.replace(/\n/g, "\r\n"));
    assert.deepEqual(
      await funcao(c),
      topo,
      "reaplicar o arquivo em CRLF mudou algo (alem dos CR)",
    );
    await verificar(c);
    await c.query(migration);
    assert.equal(
      (
        await c.query(
          `SELECT position(E'\\r' in prosrc) AS pos FROM pg_proc WHERE oid = '${ASSINATURA}'::regprocedure`,
        )
      ).rows[0].pos,
      0,
      "reaplicar o arquivo em LF nao devolveu o corpo sem CR",
    );
    const nomeSemAssinatura = ASSINATURA.replace(
      "(text,text,text,text,integer,integer)",
      "",
    );
    const sabotagens = [
      [
        "corpo desconhecido",
        () =>
          c.query(
            `CREATE OR REPLACE FUNCTION ${nomeSemAssinatura}(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $x$ BEGIN RETURN '{}'::jsonb; END; $x$`,
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
        "name da variacao sumiu",
        () =>
          c.query(
            "ALTER TABLE public.product_variants RENAME COLUMN name TO name_x",
          ),
      ],
      [
        "value da variacao sumiu",
        () =>
          c.query(
            "ALTER TABLE public.product_variants RENAME COLUMN value TO value_x",
          ),
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
        "active da variacao sumiu",
        () =>
          c.query(
            "ALTER TABLE public.product_variants RENAME COLUMN active TO active_x",
          ),
      ],
      [
        "codigo do produto sumiu",
        () =>
          c.query(
            "ALTER TABLE public.produtos RENAME COLUMN codigo TO codigo_x",
          ),
      ],
      [
        "codigo_barras do produto sumiu",
        () =>
          c.query(
            "ALTER TABLE public.produtos RENAME COLUMN codigo_barras TO codigo_barras_x",
          ),
      ],
    ];
    for (const [rotulo, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await sabotar();
        const estranho = await funcao(c);
        await c.query("SAVEPOINT recusa3992");
        await assert.rejects(
          () => c.query(migration),
          /B1_BASELINE_DIVERGENT/,
          `a migration aceitou a sabotagem "${rotulo}"`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa3992");
        assert.deepEqual(
          await funcao(c),
          estranho,
          `a recusa de "${rotulo}" gravou algo`,
        );
      });
    }
    // Loja que ainda nao recebeu a 20261385 (corpo da 381): recusada, sem gravar.
    await isolado(c, async () => {
      const def381 = definicao(
        ler(
          "supabase/migrations/20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql",
        ),
      );
      assert.notEqual(md5(corpoDe(def381)), HASH_ANTES);
      await c.query(def381);
      const antesDaRecusa = await funcao(c);
      await c.query("SAVEPOINT recusa3992b");
      await assert.rejects(() => c.query(migration), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT recusa3992b");
      assert.deepEqual(await funcao(c), antesDaRecusa);
    });
    console.log(
      `  PASSOU reaplicar (LF e CRLF) nao muda nada; ${sabotagens.length + 1} estados desconhecidos (corpo, atributos, ACL, colunas, loja sem a 20261385) derrubam a migration sem gravar`,
    );

    // ---- ROLLBACK: devolve a 385 byte a byte; o segundo recusa; o rollback da 385 roda sobre o estado devolvido; ida e volta nao toca nos dados ----
    await c.query(rollback);
    assert.equal((await funcao(c)).prosrc, corpoDe(DEF_ANTES));
    await c.query("SAVEPOINT segundo3992");
    await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT segundo3992");
    assert.equal((await funcao(c)).prosrc, corpoDe(DEF_ANTES));
    // Rollback sobre um corpo desconhecido (qualquer coisa que nao seja o da 3992) tambem recusa e nao grava.
    await c.query(migration);
    await isolado(c, async () => {
      await c.query(`ALTER FUNCTION ${ASSINATURA} SET search_path = public`);
      const estranho = await funcao(c);
      await c.query("SAVEPOINT rbrecusa3992");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3992");
      assert.deepEqual(
        await funcao(c),
        estranho,
        "a recusa do rollback gravou algo",
      );
    });
    await c.query(rollback);
    await c.query("SAVEPOINT rb85");
    await c.query(rollback85);
    assert.equal(
      md5((await funcao(c)).prosrc),
      "d204becede7d249e0a1871038f854a46",
      "o rollback da 385 nao devolveu o corpo da 381",
    );
    await c.query("ROLLBACK TO SAVEPOINT rb85");
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    await verificar(c);
    assert.equal(
      await dump("produtos"),
      dumpAntes,
      "ida e volta alterou produto",
    );
    assert.equal(
      await dump("product_variants"),
      dumpVarAntes,
      "ida e volta alterou variacao",
    );
    console.log(
      "  PASSOU rollback devolve a 385 byte a byte, o segundo rollback recusa, o rollback da 385 roda sobre o estado devolvido, e a ida e volta nao toca em produto nem variacao",
    );

    // ---- CONSULTAS 119a/119b (linhas desta funcao), 90a, 17a, 86a: aceitam a 385 e a 3992; so a linha desta funcao reprova corpo estranho ----
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
    const C119A =
      "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado";
    const C119B =
      "119b-antes-a-busca-por-palavras-e-o-estorno-fora-do-vencido-base-vigente";
    const rodar = async (nome) => (await c.query(consulta(nome))).rows;
    const dela = (rows) =>
      rows.filter((x) => x.item.startsWith("get_admin_products_paged"));
    const ROL119 = [
      "controle: funcoes de public visiveis a este papel",
      "get_admin_products_paged: corpo exato (md5)",
      "get_admin_products_paged: assinatura e atributos conhecidos",
      "get_admin_products_paged: EXECUTE authenticated e service_role, sem PUBLIC ou anon",
      "painel_inicio: corpo exato (md5)",
      "painel_inicio: assinatura e atributos conhecidos",
      "painel_inicio: EXECUTE authenticated e service_role, sem PUBLIC ou anon",
      "fin_resumo: corpo exato (md5)",
      "fin_resumo: assinatura e atributos conhecidos",
      "fin_resumo: EXECUTE authenticated, sem PUBLIC ou anon",
    ];
    for (const nome of [C119A, C119B]) {
      assert.deepEqual(
        (await rodar(nome)).map((x) => x.item).sort(),
        [...ROL119].sort(),
        `${nome}: rol mudou`,
      );
    }
    // Com a 3992 no ar: a 119a aprova as 3 linhas desta funcao; a 119b reprova so o md5.
    let a = dela(await rodar(C119A));
    assert.equal(a.length, 3);
    assert.equal(
      a.every((x) => x.ok),
      true,
      "119a reprovou o corpo novo",
    );
    let b = dela(await rodar(C119B));
    assert.deepEqual(
      b.map((x) => [x.item, x.ok]).sort(),
      [
        [
          "get_admin_products_paged: EXECUTE authenticated e service_role, sem PUBLIC ou anon",
          true,
        ],
        ["get_admin_products_paged: assinatura e atributos conhecidos", true],
        ["get_admin_products_paged: corpo exato (md5)", false],
      ],
      "119b nao reprovou o corpo novo (so o md5)",
    );
    await isolado(c, async () => {
      await c.query(rollback);
      a = dela(await rodar(C119A));
      assert.equal(
        a.find((x) => x.item.endsWith("(md5)")).ok,
        false,
        "119a aprovou o corpo anterior",
      );
      assert.equal(a.filter((x) => x.ok).length, 2);
      b = dela(await rodar(C119B));
      assert.equal(
        b.every((x) => x.ok),
        true,
        "119b reprovou o corpo anterior",
      );
    });
    await isolado(c, async () => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`);
      a = dela(await rodar(C119A));
      assert.equal(
        a.find((x) => x.item.includes("EXECUTE")).ok,
        false,
        "119a nao viu o EXECUTE do anon",
      );
    });
    const PORTOES = [
      [
        "90a-conferir-busca-do-painel-por-codigo-aplicado",
        /^get_admin_products_paged: corpo exato/,
      ],
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
      const d = rows.filter((x) => linhaDaFuncao.test(x.item));
      assert.equal(d.length, 1, `${nome}: a linha da funcao sumiu ou duplicou`);
      return { dela: d[0], resto: rows.filter((x) => x !== d[0]) };
    };
    for (const portao of PORTOES) {
      let r = await rodarPortao(portao);
      assert.equal(r.dela.ok, true, `${portao[0]}: reprovou o corpo da 3992`);
      assert.equal(
        r.resto.every((x) => x.ok),
        true,
        `${portao[0]}: outra linha reprovou`,
      );
      await isolado(c, async () => {
        await c.query(rollback);
        r = await rodarPortao(portao);
        assert.equal(r.dela.ok, true, `${portao[0]}: reprovou o corpo da 385`);
        assert.equal(
          r.resto.every((x) => x.ok),
          true,
        );
      });
      await isolado(c, async () => {
        const estranho = (await funcao(c)).prosrc.replace(
          "BEGIN",
          "BEGIN -- estranho",
        );
        assert.notEqual(estranho, (await funcao(c)).prosrc);
        await c.query(
          `CREATE OR REPLACE FUNCTION ${nomeSemAssinatura}(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $corpo$${estranho}$corpo$`,
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
      "  PASSOU 119a/119b (rol de 10 linhas; 3 desta funcao do lado certo), 90a, 17a e 86a aceitam o corpo da 385 e o da 3992 e reprovam so a linha desta funcao com corpo estranho",
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
    // A 20261399980000 (desempate por id) sucede esta no mesmo corpo: sai primeiro, nesta conexao propria, no clone descartavel.
    await require("./as-listas-do-painel-posterior.cjs").desfazerListasDoPainelNaTransacao(
      d,
    );
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
    // O rollback que falha no fim tambem nao deixa nada gravado.
    await assert.rejects(
      () => d.query(`${rollback}\nSELECT 1/0;`),
      /division by zero/,
    );
    assert.equal(
      await hash(),
      HASH_NOVO,
      "o rollback que falhou no fim deixou o corpo anterior gravado pela metade",
    );
    console.log(
      "  PASSOU migration e rollback que falham no fim (SELECT 1/0 depois do CREATE) nao deixam nada gravado; reaplicada, vira o corpo novo",
    );
  } finally {
    // Garante o estado final do clone: o corpo novo.
    await d.query(migration).catch(() => {});
    await d.end();
  }
  console.log("[busca-por-palavras] prova viva concluida (20261399200).");
}

main().catch((erro) => {
  console.error(`[busca-por-palavras] FALHOU: ${erro.stack || erro.message}`);
  process.exit(1);
});

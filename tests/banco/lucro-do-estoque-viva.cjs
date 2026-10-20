"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Caminhos e chaves constantes da prova; so clone efemero, dados inventados. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const {
  lerDatabaseUrlEfemera,
  falhar,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const ROOT = path.join(__dirname, "..", "..");
const NOME = "20261251000000_o_lucro_do_estoque_usa_o_preco_da_variante.sql";
const ler = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MIGRATION = ler(`supabase/migrations/${NOME}`);
const ROLLBACK = ler(`supabase/migrations/rollback-manual-${NOME}`);
const ANTES = "5746d8a1df216ca4a5569901c45a2a07";
const DEPOIS = "060c9ab5b1505dc375b41e4436e9d3a8";
const ASSINATURA = "public.get_admin_analytics_v2(integer)";
const A = "54a-conferir-lucro-do-estoque-aplicado";
const B = "54b-antes-lucro-do-estoque-base-vigente";
const ANCESTRAIS = [
  "8e-conferir-92-a-202-aplicado",
  "17a-conferir-estoque-do-painel-aplicado",
  "35a-conferir-lucro-so-com-custo-aplicado",
  "45a-conferir-custo-do-dia-aplicado",
  "48a-conferir-lucro-com-desconto-aplicado",
  "53a-conferir-faturamento-potencial-aplicado",
];
const ADMIN = "d1510000-0000-4000-8000-000000000001";
const CLIENTE = "d1510000-0000-4000-8000-000000000002";
const GESTOR = "d1510000-0000-4000-8000-000000000003";
const REF = "abcdefghijklmnopqrst";
const SHA = "a".repeat(40);
const idProduto = (i) =>
  `d1510000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`;
function definicao(s) {
  const i = s.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(",
  );
  assert.ok(i >= 0);
  return s.slice(i, s.indexOf("$$;", i) + 3);
}
const DEF = definicao(MIGRATION);
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");
assert.equal(md5(DEF.slice(DEF.indexOf("AS $$") + 5, -3)), DEPOIS);

async function isolado(c, f) {
  await c.query("SAVEPOINT caso");
  try {
    return await f();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso");
    await c.query("RELEASE SAVEPOINT caso");
  }
}
async function como(c, uid, role, f) {
  await c.query("SAVEPOINT papel");
  try {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
      [
        uid,
        JSON.stringify({
          sub: uid,
          role,
          app_metadata: { role: uid === ADMIN ? "admin" : "customer" },
        }),
      ],
    );
    return await f();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT papel");
    await c.query("RELEASE SAVEPOINT papel");
  }
}
const analytics = (c) =>
  como(
    c,
    ADMIN,
    "authenticated",
    async () =>
      (await c.query("SELECT public.get_admin_analytics_v2(1) AS r")).rows[0].r,
  );
async function catalogo(c) {
  return (
    await c.query(`SELECT oid, prosrc, proacl::text AS acl, proowner,
    proconfig, provolatile, prosecdef, proisstrict, proretset, pronargdefaults,
    pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS retorno
    FROM pg_proc WHERE oid=to_regprocedure('${ASSINATURA}')`)
  ).rows;
}
async function dados(c) {
  return (
    await c.query(`SELECT
    (SELECT md5(COALESCE(string_agg(row_to_json(p)::text, '' ORDER BY p.id),'')) FROM public.produtos p) AS produtos,
    (SELECT md5(COALESCE(string_agg(row_to_json(p)::text, '' ORDER BY p.id),'')) FROM public.product_variants p) AS variantes,
    (SELECT md5(COALESCE(string_agg(row_to_json(p)::text, '' ORDER BY p.id),'')) FROM public.marketplace_orders p) AS pedidos`)
  ).rows[0];
}
function conferirInventario(r, esperado) {
  assert.deepEqual(r.inventory, esperado);
  assert.equal(
    Number(r.inventory.totalRevenue),
    Number(r.inventory.totalValue) + Number(r.inventory.revenueWithoutCost),
    "toda receita se reparte entre custo conhecido e ausente",
  );
}
const INVENTARIO = {
  totalCost: 131,
  totalValue: 245,
  totalRevenue: 645,
  revenueWithoutCost: 400,
  productsWithoutCost: 3,
  productsWithCost: 7,
};
function numeros(r) {
  return {
    ...r,
    inventory: Object.fromEntries(
      Object.entries(r.inventory).map(([k, v]) => [k, Number(v)]),
    ),
  };
}
async function evidencia(PORTAO, consulta, linhas) {
  const quando = Date.parse("2026-10-20T12:00:00Z");
  return PORTAO.evidenciaDaProva({
    consulta,
    projeto: "fixture",
    ref: REF,
    sha: SHA,
    topo: SHA,
    validadeHoras: 6,
    agora: quando + 60000,
    deps: {
      listarRuns: async (wf) =>
        wf === "conferir-banco-da-loja.yml"
          ? [
              {
                databaseId: 1,
                displayTitle: `conferir ${consulta} em fixture`,
                headSha: SHA,
                createdAt: new Date(quando).toISOString(),
                conclusion: "success",
                status: "completed",
              },
            ]
          : [],
      logDoRun: async () =>
        CONF.veredictoDaConsulta({ consulta, ref: REF, sha: SHA, linhas }),
      arvoreIgual: async () => true,
    },
  });
}
async function consulta(c, PORTAO, nome, positiva) {
  const linhas = (
    await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
  ).rows;
  assert.equal(
    CONF.estruturaDoRolFechado(linhas, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
    null,
    nome,
  );
  assert.equal(
    linhas.every((l) => l.ok === true),
    positiva,
    nome,
  );
  const e = await evidencia(PORTAO, nome, linhas);
  assert.equal(e.estado, positiva ? "POSITIVA" : "NEGATIVA", nome);
  return { linhas, e };
}
async function recusaSemEscrever(c, sql) {
  const foto = await catalogo(c);
  const linhas = await dados(c);
  await isolado(c, async () =>
    assert.rejects(c.query(sql), /B1_BASELINE_DIVERGENT/),
  );
  assert.deepEqual(await catalogo(c), foto);
  assert.deepEqual(await dados(c), linhas);
}
async function main() {
  const url = lerDatabaseUrlEfemera();
  assert.equal(
    new URL(url).pathname,
    "/prova_lucro_do_estoque_viva",
    "So aceita o clone proprio de rodar-isolado.cjs",
  );
  const PORTAO = await import(
    pathToFileURL(path.join(ROOT, "scripts/frota/publicar-release.mjs")).href
  );
  const lote = PORTAO.lerCanais().provasDeObjetos.find((l) => l.consulta === A);
  assert.deepEqual(lote.versoes, ["20261251000000"]);
  assert.equal(lote.ausenciaConfirmadaPor, B);
  assert.equal(lote.backfillLedger, undefined);
  assert.equal(lote.nuncaAplicar, undefined);
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("BEGIN");
  const passou = [];
  const marcar = (s) => {
    passou.push(s);
    console.log(`PASSOU ${s}`);
  };
  try {
    await c.query(
      `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
      ($1,'admin@lucro.invalid','{"role":"admin"}'),($2,'cliente@lucro.invalid','{}'),
      ($3,'gestor@lucro.invalid','{"role":"admin"}')`,
      [ADMIN, CLIENTE, GESTOR],
    );
    await c.query(
      `INSERT INTO public.profiles(id,full_name,role) VALUES
      ($1,'Admin fixture','admin'),($2,'Cliente fixture','customer'),($3,'Gestor fixture','admin')`,
      [ADMIN, CLIENTE, GESTOR],
    );
    await c.query("UPDATE public.produtos SET ativo=false");
    const estado = await catalogo(c);
    const vazio = numeros(await analytics(c));
    conferirInventario(vazio, {
      totalCost: 0,
      totalValue: 0,
      totalRevenue: 0,
      revenueWithoutCost: 0,
      productsWithoutCost: 0,
      productsWithCost: 0,
    });
    marcar("estoque ativo vazio: montantes e contagens zero");
    const produtos = [
      // preco, custo, pai, ativo, apagado, variantes [estoque, ativa, preco proprio]
      [25, 10, 2, true, false, []],
      [100, null, 3, true, false, []],
      [
        20,
        5,
        999,
        true,
        false,
        [
          [2, true, 30],
          [1, true, null],
          [1000, false, 500],
        ],
      ],
      [100, 1, 100, false, false, []],
      [100, 1, 100, true, true, []],
      [10, 0, 4, true, false, []],
      [5, 2, 7, true, false, [[100, false, null]]],
      [100, 1, 9, true, false, [[0, true, null]]],
      [100, 1, 50, true, false, [[2, true, 0]]],
      [
        70,
        null,
        999,
        true,
        false,
        [
          [2, true, 15],
          [1, true, null],
          [100, false, 900],
        ],
      ],
      [0, 0, 1, true, false, []],
      [50, null, 0, true, false, []],
      [30, null, 90, true, false, [[0, true, null]]],
      [0, null, 2, true, false, []],
      [20, 40, 2, true, false, []],
      [100, null, 100, false, false, []],
      [100, null, 100, true, true, []],
    ];
    for (const [
      i,
      [preco, custo, estoque, ativo, apagado, variantes],
    ] of produtos.entries()) {
      await c.query(
        `INSERT INTO public.produtos(id,nome,preco_venda,custo,estoque,ativo,deleted_at)
        VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN now() ELSE NULL END)`,
        [
          idProduto(i),
          `Produto fixture ${i}`,
          preco,
          custo,
          estoque,
          ativo,
          apagado,
        ],
      );
      for (const [j, [quantidade, ativa, precoProprio]] of variantes.entries())
        await c.query(
          `INSERT INTO public.product_variants(product_id,name,value,stock_increment,active,price_override)
          VALUES($1,'Tamanho',$2,$3,$4,$5)`,
          [idProduto(i), `V${j}`, quantidade, ativa, precoProprio],
        );
    }
    const novo = numeros(await analytics(c));
    conferirInventario(novo, INVENTARIO);
    assert.equal(
      novo.productsWithoutCost,
      vazio.productsWithoutCost,
      "o contador da raiz e de VENDAS e nao recebe os 3 produtos do estoque sem custo",
    );
    marcar(
      "receita645 = conhecida245 + semcusto400; custo131, variantes e filtros corretos",
    );
    for (const [ids, esp] of [
      [
        [8],
        {
          totalCost: 2,
          totalValue: 0,
          totalRevenue: 0,
          revenueWithoutCost: 0,
          productsWithoutCost: 0,
          productsWithCost: 1,
        },
      ],
      [
        [14],
        {
          totalCost: 80,
          totalValue: 40,
          totalRevenue: 40,
          revenueWithoutCost: 0,
          productsWithoutCost: 0,
          productsWithCost: 1,
        },
      ],
      [
        [1, 10],
        {
          totalCost: 0,
          totalValue: 0,
          totalRevenue: 300,
          revenueWithoutCost: 300,
          productsWithoutCost: 1,
          productsWithCost: 1,
        },
      ],
      [
        [1, 9, 13],
        {
          totalCost: 0,
          totalValue: 0,
          totalRevenue: 400,
          revenueWithoutCost: 400,
          productsWithoutCost: 3,
          productsWithCost: 0,
        },
      ],
      [
        [7, 11, 12],
        {
          totalCost: 0,
          totalValue: 0,
          totalRevenue: 0,
          revenueWithoutCost: 0,
          productsWithoutCost: 0,
          productsWithCost: 0,
        },
      ],
    ])
      await isolado(c, async () => {
        await c.query("UPDATE public.produtos SET ativo=false");
        await c.query(
          "UPDATE public.produtos SET ativo=true WHERE id=ANY($1::uuid[])",
          [ids.map(idProduto)],
        );
        const r = numeros(await analytics(c));
        conferirInventario(r, esp);
        if (ids.length === 1)
          assert.ok(
            r.inventory.totalValue - r.inventory.totalCost < 0,
            "prejuizo nao e cortado em zero",
          );
      });
    marcar(
      "prejuizo, override0, custo0/receita0 misturado, todo semcusto e estoque efetivo0",
    );

    const linhasAntes = await dados(c);
    await consulta(c, PORTAO, A, true);
    await consulta(c, PORTAO, B, false);
    for (const nome of ANCESTRAIS) await consulta(c, PORTAO, nome, true);
    await c.query(MIGRATION);
    await c.query(MIGRATION);
    assert.deepEqual(await catalogo(c), estado);
    assert.deepEqual(await dados(c), linhasAntes);
    marcar(
      "reaplicar duas vezes preserva OID/dono/ACL/atributos e todos os dados medidos",
    );

    await c.query(ROLLBACK);
    await c.query(ROLLBACK);
    const base = await catalogo(c);
    assert.equal(md5(base[0].prosrc), ANTES);
    const antigo = numeros(await analytics(c));
    assert.equal(
      antigo.inventory.totalValue,
      425,
      "corpo antigo reproduz o erro do preco pai",
    );
    assert.deepEqual(antigo.inventory, {
      totalCost: 131,
      totalValue: 425,
      totalRevenue: 645,
    });
    const semNovos = {
      ...novo,
      inventory: {
        totalCost: novo.inventory.totalCost,
        totalValue: antigo.inventory.totalValue,
        totalRevenue: novo.inventory.totalRevenue,
      },
    };
    assert.deepEqual(
      semNovos,
      antigo,
      "todos os campos historicos e os outros calculos iguais",
    );
    const aAntes = await consulta(c, PORTAO, A, false);
    const bAntes = await consulta(c, PORTAO, B, true);
    for (const nome of ANCESTRAIS) await consulta(c, PORTAO, nome, true);
    assert.equal(
      PORTAO.decidirLote({
        lote,
        faltam: lote.versoes,
        exigeProva: true,
        prova: aAntes.e,
        diagnostico: new Map([[B, bAntes.e]]),
      }).acao,
      "APLICAR",
    );
    await c.query(MIGRATION.replace(/\r?\n/g, "\r\n"));
    assert.deepEqual(numeros(await analytics(c)), novo);
    await c.query(MIGRATION);
    assert.deepEqual(await catalogo(c), estado);
    assert.deepEqual(await dados(c), linhasAntes);
    marcar(
      "rollback250 exato/idempotente, historico identico, ida-volta-ida CRLF e ancestrais",
    );

    const aDepois = await consulta(c, PORTAO, A, true);
    assert.equal(
      PORTAO.decidirLote({
        lote,
        faltam: [],
        exigeProva: true,
        prova: aDepois.e,
      }).acao,
      "NADA",
    );
    assert.equal(
      PORTAO.decidirLote({
        lote,
        faltam: lote.versoes,
        exigeProva: true,
        prova: aDepois.e,
      }).acao,
      "PARAR",
    );
    for (const rows of [
      aDepois.linhas.slice(1),
      [...aDepois.linhas, aDepois.linhas[0]],
    ])
      assert.equal((await evidencia(PORTAO, A, rows)).estado, "SEM_EVIDENCIA");
    marcar(
      "ferramenta/portao reais: APLICAR/NADA/PARAR e resposta parcial/duplicada invalida",
    );

    // Cada alteracao reprova no seu item e bloqueia APPLY E rollback sem escrita.
    const rol = CONF.ROL_FECHADO_POR_CONSULTA[A];
    const itemCorpo = rol.find((x) => x.includes("corpo e o"));
    const itemAtributos = rol.find((x) => x.includes("uma assinatura"));
    const itemAcl = rol.find((x) => x.includes("EXECUTE so"));
    for (const [sql, item] of [
      [
        DEF.replace("RETURN result;", "RETURN result; -- corpo estranho"),
        itemCorpo,
      ],
      [
        "ALTER FUNCTION public.get_admin_analytics_v2(integer) SECURITY INVOKER",
        itemAtributos,
      ],
      [
        "ALTER FUNCTION public.get_admin_analytics_v2(integer) SET search_path=public,extensions",
        itemAtributos,
      ],
      [
        "ALTER FUNCTION public.get_admin_analytics_v2(integer) STABLE",
        itemAtributos,
      ],
      [
        "CREATE FUNCTION public.get_admin_analytics_v2() RETURNS json LANGUAGE sql AS 'SELECT null::json'",
        itemAtributos,
      ],
      [
        "GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) TO PUBLIC",
        itemAcl,
      ],
      [
        "GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) TO anon",
        itemAcl,
      ],
      [
        "REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) FROM authenticated",
        itemAcl,
      ],
      [
        "REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) FROM service_role",
        itemAcl,
      ],
    ])
      await isolado(c, async () => {
        await c.query(sql);
        const { linhas } = await consulta(c, PORTAO, A, false);
        assert.equal(linhas.find((l) => l.item === item).ok, false, item);
        await consulta(c, PORTAO, B, false);
        await recusaSemEscrever(c, MIGRATION);
        await recusaSemEscrever(c, ROLLBACK);
      });
    await isolado(c, async () => {
      await c.query(
        "ALTER FUNCTION public.get_admin_analytics_v2(integer) RENAME TO analytics_ausente_fixture",
      );
      await consulta(c, PORTAO, A, false);
      await consulta(c, PORTAO, B, false);
      await recusaSemEscrever(c, MIGRATION);
      await recusaSemEscrever(c, ROLLBACK);
    });
    // Corpo de antes da 250 e desconhecido para a 251 e nao autoriza regressao.
    await isolado(c, async () => {
      await c.query(
        definicao(
          ler(
            "supabase/migrations/20261245000000_o_lucro_desconta_o_cupom_do_pedido.sql",
          ),
        ),
      );
      const aa = await consulta(c, PORTAO, A, false);
      const bb = await consulta(c, PORTAO, B, false);
      assert.equal(
        PORTAO.decidirLote({
          lote,
          faltam: lote.versoes,
          exigeProva: true,
          prova: aa.e,
          diagnostico: new Map([[B, bb.e]]),
        }).acao,
        "PARAR",
      );
      await recusaSemEscrever(c, MIGRATION);
      await recusaSemEscrever(c, ROLLBACK);
    });
    await recusaSemEscrever(
      c,
      MIGRATION.replace(
        "RETURN result;",
        "RETURN result; -- hash posvoo incorreto",
      ),
    );
    await recusaSemEscrever(
      c,
      ROLLBACK.replace(
        "RETURN result;",
        "RETURN result; -- hash posvoo incorreto",
      ),
    );
    marcar(
      "pre/pos-voos recusam corpo estranho/anterior, ausencia, sobrecarga, atributos e ACL sem escrever",
    );

    for (const role of ["authenticated", "anon"])
      await assert.rejects(
        como(c, CLIENTE, role, () =>
          c.query("SELECT public.get_admin_analytics_v2(1)"),
        ),
        /Acesso negado|permission denied/i,
      );
    for (const fonte of ["profiles", "auth"])
      await isolado(c, async () => {
        await c.query(
          "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
          [
            GESTOR,
            JSON.stringify({
              sub: GESTOR,
              role: "authenticated",
              app_metadata: { role: "admin" },
            }),
          ],
        );
        if (fonte === "profiles") {
          await c.query(
            "UPDATE public.profiles SET role='customer' WHERE id=$1",
            [ADMIN],
          );
          await c.query(
            `UPDATE auth.users SET raw_app_meta_data='{"role":"admin"}' WHERE id=$1`,
            [ADMIN],
          );
        } else
          await c.query(
            `UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=$1`,
            [ADMIN],
          );
        await assert.rejects(analytics(c), /Acesso negado/i);
      });
    marcar("cliente/anon e admin rebaixado em cada fonte continuam recusados");

    const mutantes = [
      [
        "SUM(faturamento) FILTER (WHERE custo IS NOT NULL)",
        "SUM(preco_venda * estoque) FILTER (WHERE custo IS NOT NULL)",
      ],
      ["WHERE custo IS NOT NULL), 0)", "WHERE custo > 0), 0)"],
      [
        "COALESCE(pv.price_override, p.preco_venda)",
        "COALESCE(NULLIF(pv.price_override,0), p.preco_venda)",
      ],
      [
        "SUM(faturamento) FILTER (WHERE custo IS NULL)",
        "SUM(preco_venda * estoque) FILTER (WHERE custo IS NULL)",
      ],
      [
        "COUNT(*) FILTER (WHERE custo IS NULL AND estoque > 0)",
        "COUNT(*) FILTER (WHERE custo IS NULL)",
      ],
      [
        "COUNT(*) FILTER (WHERE custo IS NOT NULL AND estoque > 0)",
        "COUNT(*) FILTER (WHERE custo > 0 AND estoque > 0)",
      ],
      [
        "COUNT(*) FILTER (WHERE custo IS NOT NULL AND estoque > 0)",
        "COUNT(*) FILTER (WHERE custo IS NOT NULL)",
      ],
      ["WHERE p.deleted_at IS NULL AND p.ativo = true", "WHERE true"],
      ["FILTER (WHERE pv.active)", "FILTER (WHERE true)"],
    ];
    for (const [a, b] of mutantes)
      await isolado(c, async () => {
        const mutante = DEF.replaceAll(a, b);
        assert.notEqual(mutante, DEF, a);
        await c.query(mutante);
        const ruim = numeros(await analytics(c));
        assert.throws(() => conferirInventario(ruim, INVENTARIO), undefined, a);
        await consulta(c, PORTAO, A, false);
      });
    marcar(
      "9 controles negativos detectam preco pai, zero perdido, contagens e filtros incorretos",
    );
    console.log(
      `[lucro-do-estoque] ${passou.length}/${passou.length} provas passaram.`,
    );
    anexarAoSummary(
      "Lucro do estoque",
      passou.map((s) => `- PASSOU ${s}`).join("\n"),
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}
main().catch((e) => falhar("FALHOU", e.message));

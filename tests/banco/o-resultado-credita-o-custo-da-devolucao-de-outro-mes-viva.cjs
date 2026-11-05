"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// Lote 122 / 20261399600000: somente Postgres descartavel do rpc-ci, nunca banco de loja.
// A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: o CMV do Resultado (fin_dre) e' o custo das vendas do periodo MENOS o custo que voltou
// por devolucao no periodo, SEM piso em zero. Quando a devolucao de um mes (venda de OUTRO mes) custa
// mais que as vendas do proprio mes, o CMV daquele mes fica NEGATIVO (credito de custo), o lucro bruto
// daquele mes sobe pelo mesmo valor e a soma dos meses fecha com o periodo inteiro. O corpo anterior
// (o da 20261382000000) cortava o credito em zero: o controle desta prova o reproduz na MESMA fixture.
//
// FIXTURE (2031, nenhuma outra prova escreve nesse ano; custo do dia gravado pelo gatilho da venda):
//   marco  M1 F x3 a 15 (custo 36)  +  M2 G x1 a 50 (custo 20)           -> CMV 56, sem devolucao
//   abril  A1 F x1 a 15 (custo 12)  +  D1 devolve 2 F de M1 (custo 24)   -> CMV 12 - 24 = -12  (antes: 0)
//   maio   (nenhuma venda)          +  D2 devolve 1 G de M2 (custo 20)   -> CMV -20            (antes: 0)
//   junho  vazio                                                         -> CMV 0, sem linhas
//   julho  J1 F x1 a 15 (custo 12)  +  D3 devolve 1 F de J1 (custo 12)   -> CMV exatamente 0
//   setembro S1 F x2 a 15 (custo 24) + D4 devolve 1 F de S1 (custo 12)   -> CMV 12, devolucao MENOR que o CMV
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/o-resultado-credita-o-custo-da-devolucao-de-outro-mes-viva.cjs
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261399600000_o_resultado_credita_o_custo_da_devolucao_de_outro_mes.sql";
const NOME_382 =
  "20261382000000_o_resultado_mostra_tarifa_juro_e_quebra_como_despesa.sql";
const NOME_242 = "20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const rollback382 = ler(`supabase/migrations/rollback-manual-${NOME_382}`);
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.fin_dre\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
// O corpo que estava no ar antes: o da 20261382000000 (a ultima que redefine fin_dre antes desta).
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_382}`));
const CORPO_242 = corpoDe(ler(`supabase/migrations/${NOME_242}`));
const CORPO_NOVO = corpoDe(migration);
const HASH_242 = "afc3e13805ce37819cfdcd094043087c";
const HASH_ANTES = "2d191bc8120a9b188c04eeaaa0263110";
const HASH_NOVO = "eafc6a2c4663e33f5459791c6601b848";

const ADMIN = "5e399600-0000-4000-8000-000000000001";
const CLIENTE = "5e399600-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399600-0000-4000-8000-000000000003";
const PROD_F = "5e399600-0000-4000-8000-0000000000f1";
const PROD_G = "5e399600-0000-4000-8000-0000000000f2";

const cent = (v) => Math.round(Number(v) * 100);
const JANELAS = [
  ["mar", "2031-03-01", "2031-03-31"],
  ["abr", "2031-04-01", "2031-04-30"],
  ["mai", "2031-05-01", "2031-05-31"],
  ["jun", "2031-06-01", "2031-06-30"],
  ["jul", "2031-07-01", "2031-07-31"],
  ["set", "2031-09-01", "2031-09-30"],
  ["marMai", "2031-03-01", "2031-05-31"],
  ["marJul", "2031-03-01", "2031-07-31"],
];
// Em centavos. cmv, receita_bruta, deducoes, receita_liquida, lucro_bruto.
const linhaEsperada = (cmv, bruta, ded, liq, lucroBruto) => ({
  cmv,
  receita_bruta: bruta,
  deducoes: ded,
  receita_liquida: liq,
  lucro_bruto: lucroBruto,
});
const ESPERADO_NOVO = new Map([
  ["mar", linhaEsperada(5600, 9500, 0, 9500, 3900)],
  ["abr", linhaEsperada(-1200, 1500, 3000, -1500, -300)],
  ["mai", linhaEsperada(-2000, 0, 5000, -5000, -3000)],
  ["jun", linhaEsperada(0, 0, 0, 0, 0)],
  ["jul", linhaEsperada(0, 1500, 1500, 0, 0)],
  ["set", linhaEsperada(1200, 3000, 1500, 1500, 300)],
  ["marMai", linhaEsperada(2400, 11000, 8000, 3000, 600)],
  ["marJul", linhaEsperada(2400, 12500, 9500, 3000, 600)],
]);
// O corpo anterior: iguais, menos o credito cortado em zero (abril e maio) e o que decorre dele.
const ESPERADO_ANTES = new Map(ESPERADO_NOVO);
ESPERADO_ANTES.set("abr", linhaEsperada(0, 1500, 3000, -1500, -1500));
ESPERADO_ANTES.set("mai", linhaEsperada(0, 0, 5000, -5000, -5000));
const CHAVES_QUE_MUDAM = [
  "cmv",
  "linhas",
  "lucro_bruto",
  "lucro_liquido",
  "margem_contribuicao",
  "resultado_operacional",
];

const dre = async (c, ini, fim) =>
  (await c.query("SELECT public.fin_dre($1, $2) AS r", [ini, fim])).rows[0].r;
async function medir(c) {
  const m = new Map();
  for (const [nome, ini, fim] of JANELAS) m.set(nome, await dre(c, ini, fim));
  return m;
}
// Leitura de campo por nome sem indexar o objeto (a regra de seguranca do lint reprova obj[chave]).
const campoDe = (obj, campo) => new Map(Object.entries(obj)).get(campo);
const linhaCmv = (d) => d.linhas.filter((l) => l.grupo === "cmv");
const chavesDiferentes = (a, b) => {
  const mb = new Map(Object.entries(b));
  return Object.entries(a)
    .filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(mb.get(k)))
    .map(([k]) => k)
    .sort();
};

async function funcao(c) {
  const a = (
    await c.query(`SELECT to_jsonb(p) AS a FROM pg_proc p
      WHERE oid = 'public.fin_dre(date,date)'::regprocedure`)
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
// Retrato dos dados da fixture (o que JA existia antes da migration): nada disso pode mudar ao aplicar.
async function retrato(c) {
  return (
    await c.query(`SELECT md5(concat_ws('|',
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.marketplace_orders x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.marketplace_order_items x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.item_id), '[]')::text FROM public.marketplace_order_item_custo x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucoes x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucao_itens x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.fin_lancamentos x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.produtos x))) AS h`)
  ).rows[0].h;
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso3996");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3996");
    await c.query("RELEASE SAVEPOINT caso3996");
  }
}
const instalar = (c, corpo) =>
  c.query(`CREATE OR REPLACE FUNCTION public.fin_dre(p_inicio date, p_fim date) RETURNS jsonb
     LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
     AS $corpo$${corpo}$corpo$`);
const ts = (dia) => `${dia} 12:00:00-03`;

async function pedido(c, dia, itens) {
  const total = itens.reduce((s, [, q, p]) => s + q * p, 0);
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ('Cliente 3996', '{}'::jsonb, $1, $1, 'delivered', 'online', 'online', 'pago', $2::timestamptz, $2::timestamptz)
     RETURNING id`,
    [total, ts(dia)],
  );
  const ids = [];
  for (const [produto, quantidade, preco] of itens) {
    ids.push(
      (
        await c.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
           VALUES ($1, $2, 'item 3996', $3, $4) RETURNING id`,
          [r.rows[0].id, produto, quantidade, preco],
        )
      ).rows[0].id,
    );
  }
  return { id: r.rows[0].id, itens: ids };
}
// Devolucao concluida: o dinheiro sai como deducao (reembolso manual) no dia, e o item volta a prateleira no mesmo dia.
async function devolver(c, ped, quantidade, produto, preco, dia, protocolo) {
  const dev = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual, prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
       'local', 'entrega_na_loja', 'concluida', $5::numeric, $5::numeric, true, current_date + 7, '{}'::jsonb, $6::timestamptz)`,
    [dev, protocolo, ped.id, CLIENTE, quantidade * preco, ts(dia)],
  );
  await c.query(
    `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, reestocado_em)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
    [dev, ped.itens[0], produto, quantidade, preco, ts(dia)],
  );
}

/** O comportamento que a migration promete, sobre a fixture inteira. Lanca no primeiro desvio. */
async function conferirCreditoDoCmv(c) {
  const m = await medir(c);
  for (const [nome, esperado] of ESPERADO_NOVO) {
    const d = m.get(nome);
    for (const [campo, valor] of Object.entries(esperado))
      assert.equal(
        cent(campoDe(d, campo)),
        valor,
        `${nome}: ${campo} devia ser ${valor / 100}`,
      );
    // A conta do lucro bruto fecha com a receita liquida e o CMV, com o sinal que o CMV tiver.
    assert.equal(cent(d.lucro_bruto), cent(d.receita_liquida) - cent(d.cmv));
    assert.equal(
      cent(d.lucro_liquido),
      cent(d.resultado_operacional) + cent(d.resultado_financeiro),
    );
    assert.equal(
      d.cmv_estimado,
      false,
      `${nome}: o custo do dia estava gravado`,
    );
  }
  // A linha 'cmv' do resultado: aparece com o sinal certo quando o CMV nao e zero; some quando e zero.
  assert.deepEqual(linhaCmv(m.get("abr")), [
    { grupo: "cmv", categoria: "Custo das mercadorias vendidas", valor: -12 },
  ]);
  assert.deepEqual(linhaCmv(m.get("mai")), [
    { grupo: "cmv", categoria: "Custo das mercadorias vendidas", valor: -20 },
  ]);
  assert.equal(linhaCmv(m.get("mar"))[0].valor, 56);
  assert.deepEqual(
    linhaCmv(m.get("jul")),
    [],
    "CMV exatamente zero: sem linha",
  );
  assert.deepEqual(m.get("jun").linhas, [], "mes vazio: sem linhas");
  // A soma dos meses fecha com o periodo inteiro (o que o corpo anterior nao fazia).
  const soma = (campo, meses) =>
    meses.reduce((s, n) => s + cent(campoDe(m.get(n), campo)), 0);
  for (const campo of [
    "cmv",
    "lucro_bruto",
    "lucro_liquido",
    "receita_liquida",
  ]) {
    assert.equal(
      soma(campo, ["mar", "abr", "mai"]),
      cent(campoDe(m.get("marMai"), campo)),
      `${campo}: mar+abr+mai nao fecha com mar-mai`,
    );
    assert.equal(
      soma(campo, ["mar", "abr", "mai", "jun", "jul"]),
      cent(campoDe(m.get("marJul"), campo)),
      `${campo}: mar..jul nao fecha com o periodo inteiro`,
    );
  }
  return m;
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
      CORPO_NOVO,
      "o topo instalado nao e o corpo da 3996",
    );
    assert.equal(md5(CORPO_NOVO), HASH_NOVO, "o corpo novo nao e o pinado");
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o corpo anterior nao e o da 382",
    );
    assert.equal(md5(CORPO_242), HASH_242, "o corpo da 242 mudou");

    for (const [id, papel, metaAdmin] of [
      [ADMIN, "admin", true],
      [CLIENTE, "customer", false],
      // Ex-admin: ainda admin no auth.users (JWT velho), mas ja customer em profiles.
      [EX_ADMIN, "customer", true],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@dre3996.invalid', $2::jsonb)`,
        [id, JSON.stringify(metaAdmin ? { role: "admin" } : {})],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 3996', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );
    }
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
    await c.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
       VALUES ($1, 'F 3996', 15, 12, 1000, true, false), ($2, 'G 3996', 50, 20, 1000, true, false)`,
      [PROD_F, PROD_G],
    );

    // Fixture (dado que JA existia antes da migration).
    const m1 = await pedido(c, "2031-03-10", [[PROD_F, 3, 15]]);
    const m2 = await pedido(c, "2031-03-12", [[PROD_G, 1, 50]]);
    await pedido(c, "2031-04-05", [[PROD_F, 1, 15]]);
    await devolver(c, m1, 2, PROD_F, 15, "2031-04-10", "D1-3996");
    await devolver(c, m2, 1, PROD_G, 50, "2031-05-10", "D2-3996");
    const j1 = await pedido(c, "2031-07-05", [[PROD_F, 1, 15]]);
    await devolver(c, j1, 1, PROD_F, 15, "2031-07-20", "D3-3996");
    const s1 = await pedido(c, "2031-09-05", [[PROD_F, 2, 15]]);
    await devolver(c, s1, 1, PROD_F, 15, "2031-09-15", "D4-3996");
    // O custo de HOJE do produto sobe: o credito tem de usar o custo do DIA da venda (12 e 20), nao o de hoje.
    await c.query(
      "UPDATE public.produtos SET custo = 99 WHERE id IN ($1, $2)",
      [PROD_F, PROD_G],
    );
    const dadosAntes = await retrato(c);

    // CONTROLE: com o corpo ANTERIOR (o rollback desta migration) o defeito aparece nesta mesma fixture.
    // Sem isto o resto da prova poderia passar por acaso.
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(
      anterior.prosrc,
      CORPO_ANTES,
      "o rollback nao devolveu o corpo da 382 byte a byte",
    );
    assert.equal(md5(anterior.prosrc), HASH_ANTES);
    assert.deepEqual(
      { ...anterior, prosrc: null },
      { ...topo, prosrc: null },
      "o rollback mudou OID, dono, ACL ou atributo",
    );
    const antes = await medir(c);
    for (const [nome, esperado] of ESPERADO_ANTES) {
      for (const [campo, valor] of Object.entries(esperado))
        assert.equal(
          cent(campoDe(antes.get(nome), campo)),
          valor,
          `controle ${nome}: ${campo} do corpo anterior`,
        );
    }
    assert.deepEqual(
      linhaCmv(antes.get("abr")),
      [],
      "controle: sem linha de CMV em abril",
    );
    // O defeito, em numeros: a soma dos meses NAO fecha com o periodo inteiro no corpo anterior.
    assert.equal(
      cent(antes.get("mar").cmv) +
        cent(antes.get("abr").cmv) +
        cent(antes.get("mai").cmv),
      5600,
    );
    assert.notEqual(
      cent(antes.get("marMai").cmv),
      5600,
      "controle: o periodo inteiro (24,00) nao fecha com a soma dos meses (56,00)",
    );
    // E a conferencia do comportamento novo REPROVA no corpo anterior (o teste falha pelo motivo certo).
    await assert.rejects(
      () => conferirCreditoDoCmv(c),
      /abr: cmv devia ser -12/,
    );
    console.log(
      "  PASSOU controle: o corpo anterior mostrava CMV 0 em abril e maio (devia ser -12,00 e -20,00); a soma dos meses (56,00) nao fechava com o periodo inteiro (24,00)",
    );

    // A migration, sobre a fixture que ja existia.
    await c.query(migration);
    assert.deepEqual(
      await funcao(c),
      topo,
      "apply nao reproduziu o topo instalado pelo CI",
    );
    assert.equal(
      await retrato(c),
      dadosAntes,
      "apply alterou dado que ja existia",
    );
    const depois = await conferirCreditoDoCmv(c);
    console.log(
      "  PASSOU abril CMV -12,00 e maio CMV -20,00 (credito do custo DO DIA, nao o de hoje 99); lucro bruto sobe pelo mesmo valor; mar+abr+mai fecha com mar-mai (24,00)",
    );

    // 1. Mes sem devolucao maior que o CMV: o JSON inteiro e' IGUAL ao do corpo anterior.
    for (const nome of ["mar", "jun", "jul", "set", "marMai", "marJul"]) {
      assert.deepEqual(
        depois.get(nome),
        antes.get(nome),
        `${nome}: mudou, e nao devia`,
      );
    }
    // 2. Onde muda, muda so o que decorre do CMV; receita, deducoes, despesas e as outras linhas ficam.
    for (const nome of ["abr", "mai"]) {
      assert.deepEqual(
        chavesDiferentes(depois.get(nome), antes.get(nome)),
        CHAVES_QUE_MUDAM,
        `${nome}: so o CMV e o que decorre dele podem mudar`,
      );
      assert.deepEqual(
        depois.get(nome).linhas.filter((l) => l.grupo !== "cmv"),
        antes.get(nome).linhas.filter((l) => l.grupo !== "cmv"),
      );
      assert.equal(
        cent(depois.get(nome).lucro_liquido) -
          cent(antes.get(nome).lucro_liquido),
        -cent(depois.get(nome).cmv),
        `${nome}: o lucro sobe exatamente o credito`,
      );
    }
    console.log(
      "  PASSOU marco, junho (vazio), julho (CMV 0), setembro (devolucao menor que o CMV) e os periodos inteiros ficam IGUAIS ao corpo anterior; em abril e maio mudam so CMV, lucro e linha do CMV",
    );

    // 3. Porta e permissoes: nada de ACL mudou; quem nao e admin atual continua barrado.
    const priv = async (papel) =>
      (
        await c.query(
          "SELECT has_function_privilege($1, 'public.fin_dre(date,date)', 'EXECUTE') AS x",
          [papel],
        )
      ).rows[0].x;
    assert.equal(await priv("anon"), false);
    assert.equal(await priv("authenticated"), true);
    assert.equal(
      (
        await c.query(`SELECT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
        WHERE p.oid = 'public.fin_dre(date,date)'::regprocedure AND g.grantee = 0 AND g.privilege_type = 'EXECUTE') AS x`)
      ).rows[0].x,
      false,
    );
    for (const quem of [CLIENTE, EX_ADMIN]) {
      await isolado(c, async () => {
        await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [quem]);
        await assert.rejects(
          () => dre(c, "2031-04-01", "2031-04-30"),
          (e) => e.code === "42501",
        );
      });
    }
    await isolado(c, async () => {
      await assert.rejects(
        () => dre(c, "2031-04-30", "2031-04-01"),
        /Período inválido/,
      );
    });
    await isolado(c, async () => {
      await assert.rejects(
        () => dre(c, "2030-01-01", "2031-12-31"),
        /Período inválido/,
      );
    });
    console.log(
      "  PASSOU anon/PUBLIC sem EXECUTE, authenticated com; cliente comum e ex-admin recebem 42501; periodo invertido e maior que 400 dias recusam",
    );

    // 4. Reaplicar e inofensivo (LF e CRLF); o pre-voo recusa o desconhecido SEM escrever.
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    await c.query(migration.replace(/\n/g, "\r\n"));
    assert.equal(
      md5((await funcao(c)).prosrc),
      HASH_NOVO,
      "o hash e' o do corpo sem CR mesmo aplicado em CRLF",
    );
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    const estranhos = [
      [
        "corpo desconhecido",
        async () => instalar(c, "BEGIN RETURN '{}'::jsonb; END;"),
      ],
      ["o corpo da 242 (pulou a 382)", async () => instalar(c, CORPO_242)],
      [
        "atributo diferente (VOLATILE)",
        async () => {
          await instalar(c, CORPO_ANTES);
          await c.query("ALTER FUNCTION public.fin_dre(date,date) VOLATILE");
        },
      ],
      [
        "anon com EXECUTE",
        async () => {
          await instalar(c, CORPO_ANTES);
          await c.query(
            "GRANT EXECUTE ON FUNCTION public.fin_dre(date,date) TO anon",
          );
        },
      ],
      [
        "PUBLIC com EXECUTE",
        async () => {
          await instalar(c, CORPO_ANTES);
          await c.query(
            "GRANT EXECUTE ON FUNCTION public.fin_dre(date,date) TO PUBLIC",
          );
        },
      ],
    ];
    for (const [rotulo, preparar] of estranhos) {
      await isolado(c, async () => {
        await preparar();
        const estranho = await funcao(c);
        await c.query("SAVEPOINT recusa3996");
        await assert.rejects(
          () => c.query(migration),
          /B1_BASELINE_DIVERGENT/,
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa3996");
        assert.deepEqual(
          await funcao(c),
          estranho,
          `${rotulo}: a recusa gravou algo`,
        );
      });
    }
    // Sem controle de transacao no arquivo: o aplicador fornece a transacao inteira (AGENTS.md).
    assert.equal(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(migration), false);
    assert.equal(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(rollback), false);
    // Falha DEPOIS do CREATE OR REPLACE (o pos-voo): nada fica. Aqui, uma conferencia que nao bate.
    await isolado(c, async () => {
      await assert.rejects(() =>
        c.query(
          `${migration}\nDO $x$ BEGIN RAISE EXCEPTION 'falha depois da troca'; END $x$;`,
        ),
      );
    });
    assert.deepEqual(
      await funcao(c),
      topo,
      "a falha no fim deixou o corpo trocado",
    );
    console.log(
      "  PASSOU reaplicar (LF e CRLF) nao muda nada; corpo desconhecido, 242, atributo e ACL diferentes derrubam a migration sem gravar; sem BEGIN/COMMIT no arquivo",
    );

    // 5. MUTANTES: cada um deixa a conferencia do comportamento VERMELHA.
    const mutantes = [
      [
        "piso em zero de volta (o defeito)",
        "v_cmv := v_cmv - v_cmv_volta;",
        "v_cmv := GREATEST(v_cmv - v_cmv_volta, 0);",
      ],
      [
        "linha do CMV so quando positivo",
        "WHERE v_cmv <> 0",
        "WHERE v_cmv > 0",
      ],
      ["linha do CMV sempre, ate com zero", "WHERE v_cmv <> 0", "WHERE true"],
      [
        "sem o credito da devolucao",
        "v_cmv := v_cmv - v_cmv_volta;",
        "v_cmv := v_cmv;",
      ],
      [
        "credito em valor absoluto",
        "v_cmv := v_cmv - v_cmv_volta;",
        "v_cmv := abs(v_cmv - v_cmv_volta);",
      ],
      [
        "credito em dobro",
        "v_cmv := v_cmv - v_cmv_volta;",
        "v_cmv := v_cmv - 2 * v_cmv_volta;",
      ],
      [
        "credito pelo custo de hoje trocado por zero",
        "COALESCE(oic.custo, p.custo, 0)), 0)\n       FROM public.devolucao_itens di",
        "0), 0)\n       FROM public.devolucao_itens di",
      ],
    ];
    for (const [rotulo, de, para] of mutantes) {
      await isolado(c, async () => {
        const n = CORPO_NOVO.split(de).length - 1;
        assert.equal(
          n,
          1,
          `mutante "${rotulo}": o trecho aparece ${n}x no corpo`,
        );
        await instalar(
          c,
          CORPO_NOVO.replace(de, () => para),
        );
        await assert.rejects(
          () => conferirCreditoDoCmv(c),
          // Reprova por EXPECTATIVA nao cumprida, nunca por erro de SQL do mutante.
          (e) => e.code === "ERR_ASSERTION",
          `mutante "${rotulo}" sobreviveu`,
        );
      });
    }
    // O mutante nao deixou nada: o corpo novo continua intacto.
    assert.deepEqual(await funcao(c), topo);
    console.log(
      `  PASSOU ${mutantes.length} mutantes reprovam (piso em zero, linha so se positivo, linha com zero, sem credito, valor absoluto, credito em dobro, credito de custo zero)`,
    );

    // 6. Rollback: devolve o corpo da 382; o segundo recusa; e a migration volta limpa.
    await c.query(rollback);
    assert.equal((await funcao(c)).prosrc, CORPO_ANTES);
    assert.equal(md5((await funcao(c)).prosrc), HASH_ANTES);
    await c.query("SAVEPOINT segundo3996");
    await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT segundo3996");
    assert.equal((await funcao(c)).prosrc, CORPO_ANTES);
    const voltou = await medir(c);
    for (const [nome] of ESPERADO_NOVO)
      assert.deepEqual(
        voltou.get(nome),
        antes.get(nome),
        `${nome}: rollback nao devolveu o numero de antes`,
      );
    // O rollback recusa corpo desconhecido.
    await isolado(c, async () => {
      await instalar(c, "BEGIN RETURN '{}'::jsonb; END;");
      await c.query("SAVEPOINT rbrecusa3996");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3996");
    });
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    await conferirCreditoDoCmv(c);
    assert.equal(await retrato(c), dadosAntes, "ida e volta alterou dado");
    console.log(
      "  PASSOU rollback devolve a 382 byte a byte (os numeros de antes voltam), o segundo e o corpo desconhecido recusam, e a ida e volta nao toca nos dados",
    );

    // 7. Os portoes de publicacao que fixam o hash de fin_dre aceitam o corpo novo como SUCESSOR.
    //    8e (rol 92-202), 45a (custo do dia) e 87a (382) aceitam o corpo novo; a 122a o espera e a 122b
    //    espera o anterior. Corpo estranho reprova so a linha do fin_dre.
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
    const A122 =
      "122a-conferir-o-resultado-credita-o-custo-da-devolucao-de-outro-mes-aplicado";
    const B122 =
      "122b-antes-o-resultado-credita-o-custo-da-devolucao-de-outro-mes-base-vigente";
    const PORTOES = [
      ["8e-conferir-92-a-202-aplicado", /^corpo final fin_dre/],
      [
        "45a-conferir-custo-do-dia-aplicado",
        /^fin_dre: corpo e o da 20261242000000/,
      ],
      [
        "87a-conferir-resultado-mostra-tarifa-juro-e-quebra-como-despesa-aplicado",
        /^fin_dre: corpo exato/,
      ],
      [A122, /^fin_dre: corpo exato/],
      [B122, /^fin_dre: corpo exato/],
    ];
    const rodar = async ([nome, linhaDoDre]) => {
      const rows = (await c.query(consulta(nome))).rows;
      const dela = rows.filter((r) => linhaDoDre.test(r.item));
      assert.equal(
        dela.length,
        1,
        `${nome}: a linha do fin_dre sumiu ou duplicou`,
      );
      return { dela: dela[0], resto: rows.filter((r) => r !== dela[0]) };
    };
    const noEstado = async (estado, esperaOk) => {
      // esperaOk: Map nome -> true/false para a linha do fin_dre; o resto da consulta tem de estar sempre ok.
      for (const portao of PORTOES) {
        const r = await rodar(portao);
        const esperado = esperaOk.get(portao[0]);
        assert.equal(
          r.dela.ok,
          esperado,
          `${portao[0]} com ${estado}: linha do fin_dre`,
        );
        assert.equal(
          r.resto.every((x) => x.ok),
          true,
          `${portao[0]} com ${estado}: outra linha reprovou`,
        );
      }
    };
    const ESPERA = (novo, antes382) =>
      new Map([
        ["8e-conferir-92-a-202-aplicado", true],
        ["45a-conferir-custo-do-dia-aplicado", true],
        [
          "87a-conferir-resultado-mostra-tarifa-juro-e-quebra-como-despesa-aplicado",
          novo || antes382,
        ],
        [A122, novo],
        [B122, antes382],
      ]);
    // (a) corpo novo no ar (estado da arvore inteira)
    await noEstado("o corpo da 3996", ESPERA(true, false));
    // (b) corpo da 382 no ar (loja que ainda nao recebeu a 3996)
    await isolado(c, async () => {
      await c.query(rollback);
      await noEstado("o corpo da 382", ESPERA(false, true));
      // (c) corpo da 242 no ar (loja que ainda nao recebeu nem a 382)
      await c.query(rollback382);
      assert.equal(md5((await funcao(c)).prosrc), HASH_242);
      for (const portao of PORTOES.slice(0, 2)) {
        const r = await rodar(portao);
        assert.equal(r.dela.ok, true, `${portao[0]} com o corpo da 242`);
        assert.equal(
          r.resto.every((x) => x.ok),
          true,
        );
      }
    });
    // (d) corpo estranho no ar: reprova a linha do fin_dre, so ela, em TODAS as consultas
    await isolado(c, async () => {
      const estranho = (await funcao(c)).prosrc.replace(
        "BEGIN",
        "BEGIN -- estranho",
      );
      await instalar(c, estranho);
      await noEstado(
        "um corpo estranho",
        new Map(PORTOES.map(([nome]) => [nome, false])),
      );
    });
    console.log(
      "  PASSOU 8e, 45a e 87a aceitam o corpo novo (e o da 382/242); 122a espera o novo e 122b o anterior; corpo estranho reprova so a linha do fin_dre",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
  console.log(
    "[o-resultado-credita-o-custo] prova viva concluida (20261399600000).",
  );
}

main().catch((erro) => {
  console.error(
    `[o-resultado-credita-o-custo] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});

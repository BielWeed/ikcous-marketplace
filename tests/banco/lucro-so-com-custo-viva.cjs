"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste ou do JSON da
 * própria RPC no Postgres efêmero; nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA da migration 20261234000000_o_lucro_so_conta_produto_com_custo.sql
 * (public.get_admin_analytics_v2) contra o Postgres EFÊMERO com as migrations
 * aplicadas do zero (rpc-ci).
 *
 * O DEFEITO: em CRM > Visão geral, o gráfico "Lucro acumulado" e o "Top 5
 * produtos mais lucrativos" tratavam produto SEM custo (`custo IS NULL`) como
 * lucro = preço inteiro (COALESCE(custo, 0)). A decisão do dono (20261024:
 * "custo ausente NÃO pode virar margem 100%") só tinha chegado à lista de
 * produtos e ao "Lucro se vender tudo".
 *
 * A SEMENTE (loja limpa; tudo por produto/dia, em America/Sao_Paulo):
 *   A "Anel"     custo 10  preço 50   (com custo)
 *   B "Brinco"   custo NULL preço 30  (SEM custo: ninguém mediu)
 *   C "Colar"    custo 0   preço 40   (custo ZERO medido: o brinde; CONTA, margem 100% é verdade)
 *   D "Apagado"  custo NULL, soft-deletado, uma venda
 *   E "Esmeralda" custo NULL, só em pedidos que NÃO contam (cancelado, estornado, aguardando)
 *   dia -3 12h: O1 = A x2 + B x1 (R$ 130), O2 = C x1 + B x2 (R$ 100), O4 = D x1 (R$ 20)
 *   dia -3 13h: pedidos FORA (cancelado pago, pago e estornado, aguardando) com A, B e E
 *   dia -2 22h: O3 = B x1 (R$ 30) e O5 = A x1 (R$ 45, COM custo)  -> pertencem ao dia -2 (America/Sao_Paulo), não ao -1 (UTC)
 *   dias -1 e 0: sem venda
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS: dia -3 receita 250 e lucro 120 (A 80 + C 40; B e D FORA), custo vendido 20;
 *       dia -2 (22h SP) receita 75 e lucro 35 (só o Anel); dia -1 e hoje sem venda (lucro 0, receita 0); o top 5 é
 *       [Anel 115, Colar 40] (sem Brinco, sem Apagado, sem Esmeralda); `productsWithoutCost` = 1
 *       (só o Brinco: apagado e pedido que não conta ficam de fora).
 *   (2) CONTROLE (o corpo antigo, rollback-manual numa transação desfeita): o lucro do dia -3 era
 *       230, o do dia -2 era 65, o top 5 era [Brinco 120, Anel 115, Colar 40] e `productsWithoutCost`
 *       não existia; a RECEITA (dia a dia, hoje, mês, executivo) é IDÊNTICA antes e depois; o
 *       produto com custo (A e C) tem a mesma linha do ranking byte a byte; o JSON inteiro, tirado o
 *       que a migration muda, é IGUAL; as chaves novas são só `productsWithoutCost`.
 *   (3) a porta: cliente comum, admin rebaixado e anon recusados; ACL e atributos iguais.
 *   (4) dado existente: aplicar a migration por cima não muda nenhuma linha de produto, pedido ou item.
 *   (5) idempotência e preflight: reaplicar 2x não muda a impressão digital; corpo vivo divergente,
 *       corpo da 20261199 (a 14 não aplicada) e ACL aberta recusam SEM escrever.
 *   (6) rollback-manual: volta ao md5 da 20261214 com atributos e ACL iguais; o 2o rollback não muda nada.
 *   (7) leitura concorrente durante troca do corpo nunca vê estado misto.
 *   (8) MUTANTES: cada guarda tirada do corpo novo deixa a prova (1) vermelha.
 *
 * Toda prova que mexe em corpo de função roda numa transação DESFEITA no fim.
 * LUCRO_SO=comportamento roda só (1) — usado para ver o VERMELHO antes de a
 * migration estar no ar.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/lucro-so-com-custo-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const {
  devolverAoEstadoAnteriorAoCustoDoDia,
} = require("./sucessoras-da-99.cjs");

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
const SO_COMPORTAMENTO = process.env.LUCRO_SO === "comportamento";

const NOME_14 =
  "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql";
const NOME_34 = "20261234000000_o_lucro_so_conta_produto_com_custo.sql";
const ANALYTICS = "public.get_admin_analytics_v2(integer)";

// Os hashes (md5 de prosrc sem \r) lidos do PREFLIGHT de cada migration.
function hashesDoPreflight(sql, assinatura) {
  const ini = sql.indexOf(`('${assinatura}', '`);
  const tupla = ini < 0 ? "" : sql.slice(ini, sql.indexOf("')", ini) + 2);
  const hs = tupla.match(/[0-9a-f]{32}/g);
  assert.ok(hs, `o preflight não cita os hashes de ${assinatura}`);
  return { primeiro: hs[0], segundo: hs[1] };
}

const U_ADMIN = "c0570000-0000-4000-8000-0000000000b1";
const U_CLIENTE = "c0570000-0000-4000-8000-0000000000b2";
const U_REBAIXADO = "c0570000-0000-4000-8000-0000000000b3";
const P = {
  A: "c0570000-0000-4000-8000-0000000000c1",
  B: "c0570000-0000-4000-8000-0000000000c2",
  C: "c0570000-0000-4000-8000-0000000000c3",
  D: "c0570000-0000-4000-8000-0000000000c4",
  E: "c0570000-0000-4000-8000-0000000000c5",
};

async function logar(c, uid) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [uid]);
}

/** O JSON inteiro de get_admin_analytics_v2(30), como o admin o lê. */
async function analytics(c) {
  await logar(c, U_ADMIN);
  const r = await c.query("SELECT public.get_admin_analytics_v2(30) AS r");
  return r.rows[0].r;
}

const num = (v) => Math.round(Number(v) * 100) / 100;

/** A linha do gráfico do dia (-n em relação a hoje, em America/Sao_Paulo). */
async function diaDe(c, json, n) {
  const r = await c.query(
    "SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int, 'YYYY-MM-DD') AS d",
    [n],
  );
  const linha = json.revenueHistory.find((h) => h.date === r.rows[0].d);
  assert.ok(linha, `o dia -${n} (${r.rows[0].d}) não está no gráfico`);
  return {
    receita: num(linha.revenue),
    pedidos: linha.orders,
    lucro: num(linha.profit),
    custoVendido: num(linha.cost_sold),
  };
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, pg_get_functiondef(oid) AS def,
            prosecdef, coalesce(array_to_string(proconfig, ','), '') AS proconfig,
            coalesce(proacl::text, '') AS proacl, provolatile::text AS volatil,
            proowner::regrole::text AS dono
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

// Impressão digital: funções (public, auth), gatilhos, políticas e ACL de
// tabela/coluna — deparseadas com search_path = pg_catalog.
async function digital(c) {
  await c.query("SET search_path = pg_catalog");
  try {
    const r = await c.query(`
      SELECT 'fn ' || p.oid::regprocedure::text AS k,
             concat_ws(' | ', md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, ''),
                       p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                       p.provolatile::text, p.proowner::regrole::text,
                       pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)) AS v
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'tg ' || c.oid::regclass::text || '.' || t.tgname,
             concat_ws(' | ', pg_get_triggerdef(t.oid), t.tgenabled::text, t.tgtype::text)
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'pol ' || pol.polrelid::regclass::text || '.' || pol.polname,
             concat_ws(' | ', coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
                       coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'),
                       pol.polroles::regrole[]::text, pol.polcmd::text, pol.polpermissive::text)
        FROM pg_policy pol
      UNION ALL
      SELECT 'acl ' || c.oid::regclass::text, coalesce(c.relacl::text, '')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
      UNION ALL
      SELECT 'col ' || a.attrelid::regclass::text || '.' || a.attname, a.attacl::text
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND a.attacl IS NOT NULL`);
    return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
  } finally {
    await c.query("RESET search_path");
  }
}

/** Resumo md5 das linhas que a migration NÃO pode tocar. */
async function dados(c) {
  const r = await c.query(`
    SELECT 'produtos' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.produtos x
    UNION ALL SELECT 'pedidos', count(*)::int, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.marketplace_orders x
    UNION ALL SELECT 'itens', count(*)::int, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.marketplace_order_items x`);
  return r.rows;
}

/** Os caminhos de chave de um JSON (formato), sem os valores. */
function formato(v, prefixo = "") {
  if (Array.isArray(v))
    return v.length ? formato(v[0], `${prefixo}[]`) : [`${prefixo}[]`];
  if (v && typeof v === "object")
    return Object.keys(v)
      .sort()
      .flatMap((k) => formato(v[k], `${prefixo}.${k}`));
  return [prefixo];
}

/** Roda `sql` (uma ou mais migrations) numa transação e devolve o que `fn` mediu; sempre desfaz. */
async function numaTransacao(c, sqls, fn) {
  await c.query("BEGIN");
  try {
    for (const sql of sqls) await c.query(sql);
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

const PROVAS = [];
const fx = {};
// Os md5 da cadeia 99 -> 14 -> 34, lidos dos preflights no main().
const H = { n99: "", n14: "", n34: "" };

// ---------------------------------------------------------------- semente

async function pedido(c, o) {
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ('Cliente lucro', '{}'::jsonb, $1, $1, $2, 'online', 'online', $3,
             CASE WHEN $3 = 'aguardando' THEN NULL ELSE ((now() AT TIME ZONE 'America/Sao_Paulo')::date - $4::int + $5::time) AT TIME ZONE 'America/Sao_Paulo' END,
             ((now() AT TIME ZONE 'America/Sao_Paulo')::date - $4::int + $5::time) AT TIME ZONE 'America/Sao_Paulo')
     RETURNING id`,
    [o.total, o.status, o.pagamento, o.dia, o.hora],
  );
  for (const [produto, quantidade, preco] of o.itens) {
    await c.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'item lucro', $3, $4)`,
      [r.rows[0].id, produto, quantidade, preco],
    );
  }
}

/** Esperar o relógio de São Paulo sair da janela de 3 min em volta da meia-noite (o "-n dias" muda de dia). */
async function evitarVirada(c) {
  for (let i = 0; i < 40; i++) {
    const r = await c.query(
      "SELECT extract(epoch FROM ((now() AT TIME ZONE 'America/Sao_Paulo')::time)) AS s",
    );
    const s = Number(r.rows[0].s);
    if (s > 180 && s < 86400 - 180) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

PROVAS.push({
  nome: "(0) semente: loja LIMPA (nenhum pedido), 3 usuários, 5 produtos (com custo, sem custo, custo 0, apagado sem custo, só em pedido que não conta) e os pedidos dos dias -3 e -2",
  corpo: async (c) => {
    await evitarVirada(c);
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@lucro.teste', '{"role":"admin"}'::jsonb),
         ($2, 'cliente@lucro.teste', '{}'::jsonb),
         ($3, 'rebaixado@lucro.teste', '{"role":"admin"}'::jsonb)`,
      [U_ADMIN, U_CLIENTE, U_REBAIXADO],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Lucro', 'admin'), ($2, 'Cliente Lucro', 'customer'), ($3, 'Rebaixado Lucro', 'customer')`,
      [U_ADMIN, U_CLIENTE, U_REBAIXADO],
    );
    const limpa = await c.query(
      "SELECT (SELECT count(*) FROM public.marketplace_orders)::int AS pedidos, (SELECT count(*) FROM public.marketplace_order_items)::int AS itens",
    );
    assert.deepEqual(
      limpa.rows[0],
      { pedidos: 0, itens: 0 },
      "a prova mede o ranking exato: a loja de partida tem de estar LIMPA",
    );
    for (const [id, nome, custo, preco, apagado] of [
      [P.A, "Anel", 10, 50, false],
      [P.B, "Brinco", null, 30, false],
      [P.C, "Colar", 0, 40, false],
      [P.D, "Apagado", null, 20, true],
      [P.E, "Esmeralda", null, 70, false],
    ]) {
      await c.query(
        `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, deleted_at)
         VALUES ($1, $2, $3, $4, 5, true, CASE WHEN $5 THEN now() END)`,
        [id, `Lucro ${nome}`, preco, custo, apagado],
      );
    }
    const semCusto = await c.query(
      "SELECT custo IS NULL AS nulo FROM public.produtos WHERE id = $1",
      [P.B],
    );
    assert.equal(
      semCusto.rows[0].nulo,
      true,
      "o Brinco tinha de nascer SEM custo",
    );
    const zero = await c.query(
      "SELECT custo = 0 AS zero FROM public.produtos WHERE id = $1",
      [P.C],
    );
    assert.equal(
      zero.rows[0].zero,
      true,
      "o Colar tinha de nascer com custo ZERO",
    );

    const pago = {
      status: "delivered",
      pagamento: "pago",
      dia: 3,
      hora: "12:00",
    };
    await pedido(c, {
      ...pago,
      total: 130,
      itens: [
        [P.A, 2, 50],
        [P.B, 1, 30],
      ],
    });
    await pedido(c, {
      ...pago,
      total: 100,
      itens: [
        [P.C, 1, 40],
        [P.B, 2, 30],
      ],
    });
    await pedido(c, { ...pago, total: 20, itens: [[P.D, 1, 20]] });
    // O de 22h de São Paulo (01h UTC do dia seguinte): pertence ao dia -2.
    await pedido(c, {
      ...pago,
      dia: 2,
      hora: "22:00",
      total: 30,
      itens: [[P.B, 1, 30]],
    });
    // O caso de fuso NO LUCRO: outro pedido das 22h de São Paulo, agora com produto COM custo (Anel, a R$ 45):
    // o lucro dele (45 - 10 = 35) tem de cair no dia -2, não no -1 (UTC).
    await pedido(c, {
      ...pago,
      dia: 2,
      hora: "22:00",
      total: 45,
      itens: [[P.A, 1, 45]],
    });
    // Os que NÃO contam, no MESMO dia -3 (se contassem, mudariam o dia e o ranking).
    await pedido(c, {
      status: "cancelled",
      pagamento: "pago",
      dia: 3,
      hora: "13:00",
      total: 120,
      itens: [
        [P.A, 1, 50],
        [P.E, 1, 70],
      ],
    });
    await pedido(c, {
      status: "delivered",
      pagamento: "estornado",
      dia: 3,
      hora: "13:00",
      total: 70,
      itens: [[P.E, 1, 70]],
    });
    await pedido(c, {
      status: "pending",
      pagamento: "aguardando",
      dia: 3,
      hora: "13:00",
      total: 30,
      itens: [[P.B, 1, 30]],
    });
  },
});

// ---------------------------------------------------- (1) o comportamento

/** O que o corpo NOVO tem de devolver. Lança se o JSON não for esse. */
async function provaDoCorpoNovo(c) {
  const json = await analytics(c);
  const d3 = await diaDe(c, json, 3);
  assert.deepEqual(
    d3,
    { receita: 250, pedidos: 3, lucro: 120, custoVendido: 20 },
    "dia -3: receita 250 (os 3 pedidos que contam), lucro 120 (A 80 + C 40; Brinco e Apagado FORA), custo vendido 20",
  );
  const d2 = await diaDe(c, json, 2);
  assert.deepEqual(
    d2,
    { receita: 75, pedidos: 2, lucro: 35, custoVendido: 10 },
    "dia -2 (22h SP): receita 75 (Brinco 30 + Anel 45) no dia certo; lucro 35 SÓ do Anel (45 - custo 10), o Brinco fica de fora",
  );
  for (const n of [1, 0]) {
    assert.deepEqual(
      await diaDe(c, json, n),
      { receita: 0, pedidos: 0, lucro: 0, custoVendido: 0 },
      `dia -${n} sem venda: tudo zero`,
    );
  }
  assert.deepEqual(
    json.topProducts.map((t) => [t.name, num(t.total), t.quantity]),
    [
      ["Lucro Anel", 115, 3],
      ["Lucro Colar", 40, 1],
    ],
    "o ranking de lucro: só produto COM custo (o zero medido conta); sem Brinco, Apagado nem Esmeralda; o Anel soma o pedido das 22h",
  );
  assert.equal(
    json.productsWithoutCost,
    1,
    "productsWithoutCost: só o Brinco (o apagado e o que só está em pedido que não conta ficam de fora)",
  );
  assert.equal(
    num(json.executive.totalRevenue),
    325,
    "receita total = 250 + 75",
  );
  return json;
}

PROVAS.push({
  nome: "(1) DEPOIS: lucro e ranking só de produto com custo (custo 0 conta), receita do dia intacta, dia sem venda zerado, 22h SP no dia certo, productsWithoutCost = 1",
  corpo: async (c) => {
    fx.novo = await provaDoCorpoNovo(c);
    console.log(
      `    lucro por dia (-3, -2): ${JSON.stringify([await diaDe(c, fx.novo, 3), await diaDe(c, fx.novo, 2)])}`,
    );
  },
});

// -------------------------------------------------------------- controle

PROVAS.push({
  nome: "(2) CONTROLE: o corpo antigo (rollback-manual na transação) dá o lucro inflado e o Brinco no topo; a RECEITA e o produto com custo são IGUAIS; só `productsWithoutCost` é chave nova",
  corpo: async (c) => {
    const antigo = await numaTransacao(
      c,
      [ler(`rollback-manual-${NOME_34}`)],
      async () => {
        assert.equal((await catalogo(c, ANALYTICS)).hash, H.n14);
        const json = await analytics(c);
        return {
          json,
          d3: await diaDe(c, json, 3),
          d2: await diaDe(c, json, 2),
        };
      },
    );
    const { json } = antigo;
    assert.equal(
      antigo.d3.lucro,
      230,
      "CONTROLE: o corpo antigo tinha de inventar a margem do Brinco e do Apagado (120 + 90 + 20)",
    );
    assert.equal(
      antigo.d2.lucro,
      65,
      "CONTROLE: o antigo contava o Brinco das 22h como lucro (30 + 35 do Anel)",
    );
    assert.deepEqual(
      json.topProducts.map((t) => [t.name, num(t.total)]),
      [
        ["Lucro Brinco", 120],
        ["Lucro Anel", 115],
        ["Lucro Colar", 40],
      ],
      "CONTROLE: o corpo antigo punha o Brinco (sem custo) no topo, empatado com a receita",
    );
    assert.equal(json.productsWithoutCost, undefined);

    // A RECEITA é a mesma, dia a dia e nos totais.
    for (const n of [3, 2, 1, 0]) {
      const a = await diaDe(c, json, n);
      const d = await diaDe(c, fx.novo, n);
      assert.equal(a.receita, d.receita, `receita do dia -${n} mudou`);
      assert.equal(a.pedidos, d.pedidos, `pedidos do dia -${n} mudaram`);
      assert.equal(
        a.custoVendido,
        d.custoVendido,
        `custo vendido do dia -${n} mudou`,
      );
    }
    // O produto com custo (A e C): a MESMA linha do ranking, byte a byte.
    for (const nome of ["Lucro Anel", "Lucro Colar"]) {
      assert.equal(
        JSON.stringify(json.topProducts.find((t) => t.name === nome)),
        JSON.stringify(fx.novo.topProducts.find((t) => t.name === nome)),
        `${nome}: a linha do ranking mudou`,
      );
    }
    // O JSON inteiro, tirado SÓ o que a migration muda, é igual.
    const reduzir = (j) => {
      const { productsWithoutCost: _n, ...copia } = JSON.parse(
        JSON.stringify(j),
      );
      copia.revenueHistory = copia.revenueHistory.map((h) => {
        const { profit: _p, ...resto } = h;
        return resto;
      });
      copia.topProducts = copia.topProducts.filter(
        (t) => t.name !== "Lucro Brinco",
      );
      return copia;
    };
    assert.deepEqual(
      reduzir(fx.novo),
      reduzir(json),
      "algo além do lucro, do ranking e do campo novo mudou no JSON",
    );
    assert.deepEqual(
      formato(fx.novo).filter((k) => !formato(json).includes(k)),
      [".productsWithoutCost"],
      "a única chave nova é productsWithoutCost",
    );
    assert.deepEqual(
      formato(json).filter((k) => !formato(fx.novo).includes(k)),
      [],
      "nenhuma chave sumiu",
    );

    // TEXTO CRU (sem JSON.parse): numa loja onde TODO produto tem custo, o texto que o servidor devolve só
    // difere do antigo pela chave nova no fim. Dentro de uma transação desfeita, o custo vazio vira 5.
    const cru = (sqls) =>
      numaTransacao(c, sqls, async () => {
        await c.query(
          "UPDATE public.produtos SET custo = 5 WHERE custo IS NULL",
        );
        await logar(c, U_ADMIN);
        const r = await c.query(
          "SELECT public.get_admin_analytics_v2(30)::text AS t",
        );
        return r.rows[0].t;
      });
    const textoNovo = await cru([]);
    const textoAntigo = await cru([ler(`rollback-manual-${NOME_34}`)]);
    const textoNovoSemCampo = textoNovo.replace(
      /,\s*"productsWithoutCost"\s*:\s*0/,
      "",
    );
    assert.notEqual(
      textoNovoSemCampo,
      textoNovo,
      "loja só com produto com custo: o campo novo tem de vir com 0",
    );
    assert.equal(
      textoNovoSemCampo,
      textoAntigo,
      "loja só com produto com custo: o TEXTO do servidor só difere do antigo pela chave nova",
    );
  },
});

// ----------------------------------------------------------------- porta

PROVAS.push({
  nome: "(3) a porta: cliente comum e admin rebaixado recusados; anon sem EXECUTE; o corpo vivo é o que o preflight declara; atributos e ACL iguais ao corpo antigo",
  corpo: async (c) => {
    assert.equal((await catalogo(c, ANALYTICS)).hash, H.n34);
    for (const uid of [U_CLIENTE, U_REBAIXADO]) {
      await logar(c, uid);
      await assert.rejects(
        c.query("SELECT public.get_admin_analytics_v2(30)"),
        /Acesso negado: privilégios de administrador necessários\./,
        uid,
      );
    }
    const r = await c.query(
      `SELECT has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') AS anon,
              has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') AS auth`,
      [ANALYTICS],
    );
    assert.deepEqual(r.rows[0], { anon: false, auth: true });
    const novo = await catalogo(c, ANALYTICS);
    const antigo = await numaTransacao(
      c,
      [ler(`rollback-manual-${NOME_34}`)],
      () => catalogo(c, ANALYTICS),
    );
    for (const k of ["prosecdef", "proconfig", "proacl", "volatil", "dono"]) {
      assert.equal(novo[k], antigo[k], `${k} mudou`);
    }
    assert.notEqual(novo.hash, antigo.hash);
  },
});

// ---------------------------------------------------------- dado existente

PROVAS.push({
  nome: "(4) dado que já existia: aplicar a migration por cima NÃO muda nenhuma linha de produto, pedido ou item (a única coisa que muda é o corpo de uma função)",
  corpo: async (c) => {
    const antes = await dados(c);
    assert.ok(
      antes.every((l) => l.n > 0),
      "a semente tinha de ter linhas",
    );
    const depois = await numaTransacao(
      c,
      [ler(`rollback-manual-${NOME_34}`), ler(NOME_34)],
      () => dados(c),
    );
    assert.deepEqual(depois, antes, "uma linha de dado mudou ao aplicar");
  },
});

// ----------------------------------------------------- idempotência/preflight

PROVAS.push({
  nome: "(5) reaplicar 2x não muda a impressão digital; preflight recusa SEM escrever: corpo divergente, corpo da 20261199 (a 14 não aplicada), ACL aberta (PUBLIC)",
  corpo: async (c) => {
    const antes = await digital(c);
    await numaTransacao(c, [ler(NOME_34), ler(NOME_34)], async () => {
      assert.deepEqual(await digital(c), antes, "reaplicar mudou alguma coisa");
    });
    // aplicar, desfazer e aplicar de novo volta idêntico
    await numaTransacao(
      c,
      [ler(`rollback-manual-${NOME_34}`), ler(NOME_34)],
      async () => {
        assert.deepEqual(
          await digital(c),
          antes,
          "desfazer e aplicar não voltou idêntico",
        );
      },
    );

    const recusa = async (preparar, esperado) => {
      await c.query("BEGIN");
      try {
        await preparar();
        const estado = await digital(c);
        await c.query("SAVEPOINT aplicar");
        await assert.rejects(c.query(ler(NOME_34)), esperado);
        await c.query("ROLLBACK TO SAVEPOINT aplicar");
        assert.deepEqual(await digital(c), estado, "a recusa escreveu algo");
      } finally {
        await c.query("ROLLBACK");
      }
    };
    // 1. corpo divergente (um comentário a mais)
    await recusa(async () => {
      const def = (await catalogo(c, ANALYTICS)).def;
      const divergente = def.replace(
        "-- 0. Security Check",
        "-- 0. Security Check (divergente)",
      );
      assert.notEqual(divergente, def);
      await c.query(divergente);
    }, /B1_BASELINE_DIVERGENT: corpo vivo de public\.get_admin_analytics_v2\(integer\)/);
    // 2. a loja ainda no corpo da 20261199 (a 14 não aplicada): recusa, pede a 14 antes
    await recusa(async () => {
      await c.query(ler(`rollback-manual-${NOME_34}`));
      await c.query(ler(`rollback-manual-${NOME_14}`));
      assert.equal((await catalogo(c, ANALYTICS)).hash, H.n99);
    }, /B1_BASELINE_DIVERGENT: corpo vivo de public\.get_admin_analytics_v2\(integer\)/);
    // 3. ACL aberta (PUBLIC com EXECUTE)
    await recusa(async () => {
      await c.query(ler(`rollback-manual-${NOME_34}`));
      await c.query(
        "GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) TO PUBLIC",
      );
    }, /B1_BASELINE_DIVERGENT: ACL de public\.get_admin_analytics_v2\(integer\)/);
  },
});

// ---------------------------------------------------------------- rollback

PROVAS.push({
  nome: "(6) rollback-manual: volta ao md5 da 20261214 com SECURITY DEFINER, search_path, ACL e dono iguais; o 2o rollback não muda nada; corpo de redefinição posterior recusa o rollback; reaplicar volta ao corpo desta",
  corpo: async (c) => {
    const com = await catalogo(c, ANALYTICS);
    assert.equal(com.hash, H.n34);
    const rb = ler(`rollback-manual-${NOME_34}`);
    await numaTransacao(c, [rb], async () => {
      const sem = await catalogo(c, ANALYTICS);
      assert.equal(sem.hash, H.n14, "não voltou ao corpo da 20261214000000");
      for (const k of ["prosecdef", "proconfig", "proacl", "volatil", "dono"]) {
        assert.equal(sem[k], com[k], `${k} mudou no rollback`);
      }
      const semDigital = await digital(c);
      await c.query(rb);
      assert.deepEqual(
        await digital(c),
        semDigital,
        "o 2o rollback mudou algo",
      );
      await c.query(ler(NOME_34));
      assert.equal((await catalogo(c, ANALYTICS)).hash, H.n34);
    });
    // O rollback recusa corpo de OUTRA redefinição (posterior) em vez de apagá-la.
    await c.query("BEGIN");
    try {
      const def = com.def.replace(
        "-- 0. Security Check",
        "-- 0. Security Check (posterior)",
      );
      await c.query(def);
      await c.query("SAVEPOINT rollback");
      await assert.rejects(c.query(rb), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rollback");
      assert.notEqual((await catalogo(c, ANALYTICS)).hash, H.n14);
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

// ---------------------------------------------------------- concorrência

PROVAS.push({
  nome: "(7) leitura concorrente durante a troca do corpo (commits reais, ida e volta): cada leitura é do corpo ANTIGO inteiro ou do NOVO inteiro, nunca mista",
  corpo: async (c) => {
    const leitor = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await leitor.connect();
    try {
      await logar(leitor, U_ADMIN);
      let rodando = true;
      const vistos = { antigo: 0, novo: 0, misto: [] };
      const lendo = (async () => {
        while (rodando) {
          const r = await leitor.query(
            "SELECT public.get_admin_analytics_v2(30) AS r",
          );
          const json = r.rows[0].r;
          const dia = json.revenueHistory.find(
            (h) => Number(h.profit) > 0 && Number(h.revenue) === 250,
          );
          const lucro3 = dia ? Number(dia.profit) : null;
          const tem = Object.hasOwn(json, "productsWithoutCost");
          if (tem && lucro3 === 120 && json.topProducts.length === 2)
            vistos.novo++;
          else if (!tem && lucro3 === 230 && json.topProducts.length === 3)
            vistos.antigo++;
          else
            vistos.misto.push({
              tem,
              lucro3,
              ranking: json.topProducts.length,
            });
        }
      })();
      const rb = ler(`rollback-manual-${NOME_34}`);
      const mig = ler(NOME_34);
      for (let i = 0; i < 12; i++) {
        await c.query(rb);
        await c.query(mig);
      }
      rodando = false;
      await lendo;
      assert.deepEqual(vistos.misto, [], "uma leitura viu estado misto");
      assert.ok(vistos.antigo + vistos.novo > 0, "o leitor não leu nada");
      console.log(
        `    leituras: ${vistos.novo} do corpo novo, ${vistos.antigo} do antigo, 0 mistas`,
      );
      assert.equal((await catalogo(c, ANALYTICS)).hash, H.n34);
    } finally {
      await leitor.end().catch(() => {});
    }
  },
});

// --------------------------------------------------------------- mutantes

/** O corpo vivo com UM trecho trocado; a prova (1) PRECISA falhar com ele. */
async function mataMutante(c, nome, de, para) {
  const def = (await catalogo(c, ANALYTICS)).def;
  assert.equal(
    def.split(de).length - 1,
    1,
    `o trecho do mutante tem de aparecer 1x (achei ${def.split(de).length - 1}): ${de.slice(0, 60)}`,
  );
  await c.query("BEGIN");
  let passou = false;
  let motivo = "";
  try {
    await c.query(def.replace(de, para));
    try {
      await provaDoCorpoNovo(c);
      passou = true;
    } catch (e) {
      motivo = `a prova viu ${JSON.stringify(e.actual)?.slice(0, 80)}`;
    }
  } finally {
    await c.query("ROLLBACK");
  }
  assert.ok(!passou, `MUTANTE SOBREVIVEU: ${nome}`);
  console.log(`    mutante morto: ${nome} (${motivo})`);
}

PROVAS.push({
  nome: "(8) MUTANTES: sem o filtro do lucro por dia, sem o filtro do ranking, custo 0 tratado como ausência, contagem que inclui produto apagado — cada um deixa a prova (1) vermelha",
  corpo: async (c) => {
    await mataMutante(
      c,
      "lucro por dia volta a inventar margem (COALESCE(custo, 0) sem o FILTER)",
      "SUM(oi.quantity * (oi.price - p.custo)) FILTER (WHERE p.custo IS NOT NULL)",
      "SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0)))",
    );
    await mataMutante(
      c,
      "ranking sem o filtro de custo (o Brinco volta ao topo)",
      "AND p.custo IS NOT NULL\n        GROUP BY p.id",
      "AND true\n        GROUP BY p.id",
    );
    await mataMutante(
      c,
      "custo 0 tratado como ausência (o brinde medido some do lucro)",
      "FILTER (WHERE p.custo IS NOT NULL), 0) AS profit",
      "FILTER (WHERE COALESCE(p.custo, 0) > 0), 0) AS profit",
    );
    await mataMutante(
      c,
      "contagem inclui produto apagado",
      "AND p.deleted_at IS NULL\n    AND p.custo IS NULL;",
      "AND p.custo IS NULL;",
    );
    await mataMutante(
      c,
      "contagem inclui o pedido cancelado",
      "WHERE o.status NOT IN ('cancelled', 'returned')\n    AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))\n    AND p.deleted_at IS NULL\n    AND p.custo IS NULL;",
      "WHERE (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))\n    AND p.deleted_at IS NULL\n    AND p.custo IS NULL;",
    );
  },
});

// ------------------------------------------------------------------- main

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo = "Prova viva do lucro só com custo (rpc-ci)";
  try {
    // A 20261242000000 (o custo do dia) sucede a 34 no mesmo corpo e o rollback da 34 recusa com ela no ar:
    // esta prova mede o estado "34 no ar", então devolve o clone descartável a ele antes (idempotente).
    await devolverAoEstadoAnteriorAoCustoDoDia(cliente);
    if (!SO_COMPORTAMENTO) {
      // Cadeia 99 -> 14 -> 34, lida dos PREFLIGHTS (a prova de texto amarra cada um ao md5 real).
      const h14 = hashesDoPreflight(ler(NOME_14), ANALYTICS);
      const h34 = hashesDoPreflight(ler(NOME_34), ANALYTICS);
      assert.equal(
        h34.primeiro,
        h14.segundo,
        "o vigente da 34 é o que a 14 deixa",
      );
      H.n99 = h14.primeiro;
      H.n14 = h34.primeiro;
      H.n34 = h34.segundo;
    }
    const provas = SO_COMPORTAMENTO ? PROVAS.slice(0, 2) : PROVAS;
    for (const { nome, corpo } of provas) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        if (erro.actual !== undefined) {
          console.error(
            `    visto:    ${JSON.stringify(erro.actual)}\n    esperado: ${JSON.stringify(erro.expected)}`,
          );
        }
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(titulo, linhas.join("\n"));
        falhar(
          "FALHOU",
          "O lucro voltou a contar produto sem custo — ver acima qual.",
        );
      }
    }
    console.log(
      `\n[lucro-so-com-custo] ${provas.length}/${provas.length} provas passaram.`,
    );
    anexarAoSummary(
      titulo,
      `${linhas.join("\n")}\n\n**${provas.length}/${provas.length} provas** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();

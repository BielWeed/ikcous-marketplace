"use strict";

/**
 * Prova VIVA da migration 20261397000000 (o desconto do cupom de PORCENTAGEM e' arredondado ao centavo, meio centavo para cima, ANTES de
 * subtrair; `create_marketplace_order_v23`, `create_marketplace_order_v24` e `validate_coupon_secure_v2` trocam UMA linha cada; DINHEIRO),
 * num Postgres EFEMERO local, sem rede, com os papeis de verdade (anon, authenticated).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada (ja com a 20261397000000). TODO caso comeca numa transacao que termina em
 * ROLLBACK e monta o estado ANTES (os tres corpos de antes, reinstalados por CREATE OR REPLACE do texto das migrations anteriores, byte a
 * byte) ou DEPOIS (a propria migration, por cima do ANTES).
 *
 *  CONTAS      pelas DUAS portas do pedido (v23 "pagar na retirada/entrega" como visitante; v24 "pagar pelo app" como cliente logada) e
 *              pela validacao: 29,95 x 10% -> desconto 3,00, total 26,95; 49,95 x 10% -> 5,00 / 44,95; 99,90 x 15% -> 14,99 / 84,91;
 *              10,00 x 15% (sem fracao) -> 1,50 / 8,50; 3 x 29,95 x 10% -> 8,99 / 80,86; e SEMPRE subtotal - desconto + frete = total na
 *              LINHA GRAVADA, e a validacao devolve o MESMO desconto que o pedido grava (3,00, nunca 2,995).
 *  FIXO/TETO   cupom de valor fixo nao muda; o desconto nunca passa do subtotal (fixo de R$ 500, 150%); 100% zera.
 *  CONTROLE    no estado ANTES o defeito existe (29,95 x 10%: total 26,96 e a ficha nao fecha; a validacao devolve 2,995): a mesma
 *              verificacao fica VERMELHA, e tambem com dois mutantes (truncar em vez de arredondar; arredondar so a decimos).
 *  DADO        um pedido gravado ANTES (total 26,96) fica identico depois da migration (nenhuma linha e' lida ou reescrita).
 *  MIGRATION   reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL, atributos); o rollback devolve cada corpo byte a byte (md5, sha256 e
 *              texto) e a mesma ACL; o segundo rollback RECUSA; ida e volta termina igual; o pre-voo recusa SEM escrever em cada corpo
 *              desconhecido (as tres funcoes); o pos-voo reprovando desfaz TUDO (atomicidade: nenhuma das tres fica pela metade).
 *  CONSULTAS   115a/115b: rol fechado de 13 linhas, positivas no estado certo, desvios nas linhas certas.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-desconto-do-cupom-e-arredondado-ao-centavo-viva.cjs
 */

/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Os indices vem de contadores e de listas fechadas deste arquivo; os caminhos sao montados de literais (as migrations do repositorio). */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const { DESCONTO_DO_CUPOM } = require("./o-desconto-do-cupom-posterior.cjs");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const ARQ = DESCONTO_DO_CUPOM.nome;
const lerLF = (nome) =>
  fs.readFileSync(path.join(PASTA, nome), "utf8").replace(/\r\n/g, "\n");
const MIG = lerLF(ARQ);
const RB = lerLF(`rollback-manual-${ARQ}`);
const A115 =
  "115a-conferir-o-desconto-do-cupom-e-arredondado-ao-centavo-aplicado";
const B115 =
  "115b-antes-o-desconto-do-cupom-e-arredondado-ao-centavo-base-vigente";
const lerConsulta = (n) =>
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "scripts",
      "publicacao",
      "consultas",
      `${n}.sql`,
    ),
    "utf8",
  );

const FUNCOES = () => DESCONTO_DO_CUPOM.funcoes;
const [F23, F24, FVAL] = DESCONTO_DO_CUPOM.funcoes;
const V23 = F23.nome;
const V24 = F24.nome;
const sha256 = (s) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, ""), "utf8").digest("hex");

let C = null; // a conexao unica da prova

// ---------------------------------------------------------------------------
// Texto das funcoes: a definicao da migration e o corpo de cada uma
// ---------------------------------------------------------------------------
/** O CREATE OR REPLACE inteiro de `f` dentro de `texto` (a migration ou o rollback). */
function definicaoEm(texto, f) {
  const ini = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${f.nome}(`);
  assert.ok(ini >= 0, `sem ${f.nome}`);
  const fecha = texto.indexOf(`\n${f.delim};`, ini);
  assert.ok(fecha > ini);
  return texto.slice(ini, fecha + 1 + f.delim.length + 1);
}
const corpoDe = (definicao, f) => {
  const a = definicao.indexOf(`AS ${f.delim}`) + `AS ${f.delim}`.length;
  return definicao.slice(a, definicao.length - f.delim.length - 1);
};
const DEF_ANTES = Object.fromEntries(
  DESCONTO_DO_CUPOM.funcoes.map((f) => [
    f.nome,
    DESCONTO_DO_CUPOM.definicaoDe(f),
  ]),
);
const DEF_DEPOIS = Object.fromEntries(
  DESCONTO_DO_CUPOM.funcoes.map((f) => [f.nome, definicaoEm(MIG, f)]),
);
assert.equal(md5(corpoDe(DEF_ANTES[V23], F23)), F23.hashAntes);
assert.equal(md5(corpoDe(DEF_DEPOIS[V23], F23)), F23.hashDesta);
assert.equal(md5(corpoDe(DEF_DEPOIS[V24], F24)), F24.hashDesta);
assert.equal(md5(corpoDe(DEF_DEPOIS[FVAL.nome], FVAL)), FVAL.hashDesta);

const instalarAntes = async () => {
  for (const f of FUNCOES()) await C.query(DEF_ANTES[f.nome]);
};
const instalarDepois = async () => {
  await instalarAntes();
  await C.query(MIG);
};
const hashes = async () => {
  const r = {};
  for (const f of FUNCOES())
    r[f.nome] = (
      await C.query(
        "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [f.assinatura],
      )
    ).rows[0]?.h;
  return r;
};
const prosrcs = async () => {
  const r = {};
  for (const f of FUNCOES())
    r[f.nome] = (
      await C.query(
        "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
        [f.assinatura],
      )
    ).rows[0]?.prosrc;
  return r;
};
const retrato = async () => {
  const r = {};
  for (const f of FUNCOES())
    r[f.nome] = (
      await C.query(
        "SELECT p.oid::int AS oid, p.proacl::text AS acl, p.proowner::regrole::text AS dono, (to_jsonb(p) - 'prosrc')::text AS atributos FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
        [f.assinatura],
      )
    ).rows[0];
  return r;
};
const esperarHashes = async (estado, rotulo) => {
  const h = await hashes();
  for (const f of FUNCOES())
    assert.equal(
      h[f.nome],
      estado === "antes" ? f.hashAntes : f.hashDesta,
      `${rotulo}: ${f.nome} nao esta no estado ${estado}`,
    );
};

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

/** Uma transacao por caso, sempre desfeita, ja no estado pedido ("antes", "depois" ou "nenhum"). */
async function emTransacao(f, { estado = "antes", semente = false } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes" || estado === "depois") {
      await instalarAntes();
      await esperarHashes("antes", "montagem");
    }
    if (estado === "depois") {
      await C.query(MIG);
      await esperarHashes("depois", "montagem");
    }
    if (semente) await semear();
    return await f();
  } finally {
    await C.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// Semente, chamadas e leitura do pedido
// ---------------------------------------------------------------------------
const U = { cliente: "7e7e2397-2000-4000-8000-0000000000d1" };
const P = {
  p2995: "7e7e2397-2000-4000-8000-0000000000f1",
  p4995: "7e7e2397-2000-4000-8000-0000000000f2",
  p9990: "7e7e2397-2000-4000-8000-0000000000f3",
  p1000: "7e7e2397-2000-4000-8000-0000000000f4",
};
const PRECOS = { p2995: 29.95, p4995: 49.95, p9990: 99.9, p1000: 10 };
const CUPONS = [
  ["PCT10", "percentage", 10],
  ["PCT15", "percentage", 15],
  ["PCT100", "percentage", 100],
  ["PCT150", "percentage", 150],
  ["FIXO5", "fixed", 5],
  ["FIXO500", "fixed", 500],
];
const DIGITADO = {
  cep: "38500-120",
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
};
const CEP_LOCAL = "38500-100";

/** Roda `sql` como `papel`, com o auth.uid() pedido; devolve as linhas (o erro sobe). */
async function como(papel, sql, params = [], uid = "") {
  await C.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
  }
}
/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo, detalhe}. */
async function tentar(papel, sql, params = [], uid = "") {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, uid);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code, detalhe: e.detail };
  }
}

async function semear() {
  await C.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@3970.teste', '{}'::jsonb)",
    [U.cliente],
  );
  await C.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente Prova', 'customer')",
    [U.cliente],
  );
  await C.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true,
        true, ARRAY['pix', 'card', 'cash'], 'Rua da Loja, 100 - Centro', ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`,
  );
  for (const [chave, id] of Object.entries(P))
    await C.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, $2, $3, 1000, true, 1, false)",
      [id, `Produto ${chave} 3970`, PRECOS[chave]],
    );
  for (const [codigo, tipo, valor] of CUPONS)
    await C.query(
      `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
       VALUES ($1, $2, $3, 0, NULL, 0, NULL, true)`,
      [codigo, tipo, valor],
    );
}

const SQL_PEDIDO = (rpc) =>
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, $10::uuid, $5::text,
     'Comprador Prova', '5534999990000', NULL::text, $6::jsonb, $7::text, $8::text, $9::uuid) AS id`;
const reais = (centavos) => (centavos / 100).toFixed(2);

/**
 * Faz o pedido pelo CAMINHO do checkout. `porta` 'v23' = visitante, "pagar na entrega" (cash); 'v24' = cliente logada, "pagar pelo app"
 * (online). `total` e' o que a TELA mandaria (subtotal - desconto, em centavos): o banco recalcula e grava o dele.
 */
async function pedir({ porta, prod, qtd, cupom, totalCentavos }) {
  const logado = porta === "v24";
  return tentar(
    logado ? "authenticated" : "anon",
    SQL_PEDIDO(logado ? V24 : V23),
    [
      JSON.stringify([
        { product_id: P[prod], variant_id: null, quantity: qtd },
      ]),
      reais(totalCentavos),
      0,
      logado ? "online" : "cash",
      cupom,
      logado ? null : JSON.stringify(DIGITADO),
      logado ? CEP_LOCAL : DIGITADO.cep,
      "local-delivery",
      crypto.randomUUID(),
      null,
    ],
    logado ? U.cliente : "",
  );
}
const lerPedido = async (id) =>
  (
    await C.query(
      `SELECT subtotal::text AS subtotal, discount::text AS discount, shipping::text AS shipping, total::text AS total,
              (subtotal - discount + shipping = total) AS fecha, to_jsonb(o) - 'id' AS tudo
         FROM public.marketplace_orders o WHERE o.id = $1`,
      [id],
    )
  ).rows[0];
const descontoDaValidacao = async (codigo, subtotalCentavos) =>
  (
    await como(
      "anon",
      "SELECT (public.validate_coupon_secure_v2($1, $2::numeric)->>'discount_value')::numeric::text AS d",
      [codigo, reais(subtotalCentavos)],
    )
  )[0].d;

// ---------------------------------------------------------------------------
// O COMPORTAMENTO esperado. Cada caso: subtotal, desconto e total em CENTAVOS (frete zero).
// ---------------------------------------------------------------------------
const CASOS = [
  {
    r: "29,95 x 10%",
    prod: "p2995",
    qtd: 1,
    cupom: "PCT10",
    sub: 2995,
    desc: 300,
    total: 2695,
  },
  {
    r: "49,95 x 10%",
    prod: "p4995",
    qtd: 1,
    cupom: "PCT10",
    sub: 4995,
    desc: 500,
    total: 4495,
  },
  {
    r: "99,90 x 15%",
    prod: "p9990",
    qtd: 1,
    cupom: "PCT15",
    sub: 9990,
    desc: 1499,
    total: 8491,
  },
  {
    r: "10,00 x 15% (sem fracao)",
    prod: "p1000",
    qtd: 1,
    cupom: "PCT15",
    sub: 1000,
    desc: 150,
    total: 850,
  },
  {
    r: "3 x 29,95 x 10%",
    prod: "p2995",
    qtd: 3,
    cupom: "PCT10",
    sub: 8985,
    desc: 899,
    total: 8086,
  },
  {
    r: "29,95 com cupom de valor FIXO de R$ 5",
    prod: "p2995",
    qtd: 1,
    cupom: "FIXO5",
    sub: 2995,
    desc: 500,
    total: 2495,
  },
  {
    r: "29,95 com 100%",
    prod: "p2995",
    qtd: 1,
    cupom: "PCT100",
    sub: 2995,
    desc: 2995,
    total: 0,
    soEntrega: true,
  },
  {
    r: "10,00 com valor fixo de R$ 500 (teto)",
    prod: "p1000",
    qtd: 1,
    cupom: "FIXO500",
    sub: 1000,
    desc: 1000,
    total: 0,
    soEntrega: true,
  },
  {
    r: "10,00 com 150% (teto)",
    prod: "p1000",
    qtd: 1,
    cupom: "PCT150",
    sub: 1000,
    desc: 1000,
    total: 0,
    soEntrega: true,
  },
];

/** Devolve a lista de falhas (vazia = passou). E' a MESMA que roda no estado DEPOIS (tem de dar vazio) e nos controles/mutantes (nao vazio). */
async function verificarContas() {
  const f = [];
  for (const c of CASOS) {
    // A validacao: o mesmo desconto que o pedido vai gravar.
    const dv = await descontoDaValidacao(c.cupom, c.sub);
    if (Number(dv) !== c.desc / 100)
      f.push(`validacao(${c.r}): devolveu ${dv}, esperado ${reais(c.desc)}`);
    for (const porta of c.soEntrega ? ["v23"] : ["v23", "v24"]) {
      const r = await pedir({
        porta,
        prod: c.prod,
        qtd: c.qtd,
        cupom: c.cupom,
        totalCentavos: c.total,
      });
      if (!r.linhas) {
        f.push(`${porta}(${c.r}): pedido recusado: ${r.erro}`);
        continue;
      }
      const o = await lerPedido(r.linhas[0].id);
      if (o.subtotal !== reais(c.sub))
        f.push(
          `${porta}(${c.r}): subtotal ${o.subtotal}, esperado ${reais(c.sub)}`,
        );
      if (o.discount !== reais(c.desc))
        f.push(
          `${porta}(${c.r}): desconto ${o.discount}, esperado ${reais(c.desc)}`,
        );
      if (o.total !== reais(c.total))
        f.push(
          `${porta}(${c.r}): total ${o.total}, esperado ${reais(c.total)}`,
        );
      if (o.fecha !== true)
        f.push(
          `${porta}(${c.r}): a ficha NAO fecha (subtotal ${o.subtotal} - desconto ${o.discount} + frete ${o.shipping} != total ${o.total})`,
        );
    }
  }
  return f;
}

/** Os corpos da migration com a conta do desconto sabotada (ainda SQL valido): `de` -> `para` na linha do desconto percentual. */
function definicoesSabotadas(de, para) {
  const r = {};
  for (const f of FUNCOES()) {
    const d = DEF_DEPOIS[f.nome];
    const m =
      f.nome === FVAL.nome
        ? "round((p_subtotal * v_coupon.value) / 100, 2)"
        : "round((v_calculated_subtotal * v_coupon_val) / 100, 2)";
    assert.equal(d.split(m).length - 1, 1);
    r[f.nome] = d.replace(m, () => m.replace(de, para));
    assert.notEqual(r[f.nome], d, "a sabotagem nao mudou a definicao");
  }
  return r;
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

// ---------------------------------------------------------------------------
// As provas
// ---------------------------------------------------------------------------
prova(
  "CONTAS (DEPOIS): v23, v24 e a validacao arredondam o desconto ao centavo e a ficha fecha nos casos medidos; fixo, teto e 100% corretos",
  () =>
    emTransacao(
      async () => {
        const falhas = await verificarContas();
        assert.deepEqual(falhas, []);
      },
      { estado: "depois", semente: true },
    ),
);

prova(
  "CONTROLE (ANTES): sem a migration o defeito existe — 29,95 x 10% grava total 26,96 (a ficha nao fecha) e a validacao devolve 2,995; a MESMA verificacao fica vermelha",
  () =>
    emTransacao(
      async () => {
        const dv = await descontoDaValidacao("PCT10", 2995);
        assert.equal(
          Number(dv),
          2.995,
          "no estado ANTES a validacao devolve 2,995",
        );
        const r = await pedir({
          porta: "v23",
          prod: "p2995",
          qtd: 1,
          cupom: "PCT10",
          totalCentavos: 2695,
        });
        assert.ok(r.linhas, `o pedido devia nascer: ${r.erro}`);
        const o = await lerPedido(r.linhas[0].id);
        assert.equal(o.discount, "3.00");
        assert.equal(o.total, "26.96", "o defeito: total 1 centavo acima");
        assert.equal(o.fecha, false, "o defeito: a ficha nao fecha");
        const falhas = await verificarContas();
        assert.ok(
          falhas.length > 0,
          "a verificacao NAO ficou vermelha no estado ANTES",
        );
        assert.ok(falhas.some((x) => x.startsWith("validacao(29,95 x 10%)")));
        assert.ok(falhas.some((x) => x.startsWith("v23(29,95 x 10%)")));
        assert.ok(falhas.some((x) => x.startsWith("v24(29,95 x 10%)")));
      },
      { estado: "antes", semente: true },
    ),
);

for (const [rotulo, de, para] of [
  ["truncar em vez de arredondar (trunc)", "round(", "trunc("],
  ["arredondar so a decimos de real (round(x, 1))", "/ 100, 2)", "/ 100, 1)"],
]) {
  prova(`MUTANTE vermelho — ${rotulo}`, async () => {
    await C.query("BEGIN");
    try {
      await instalarDepois();
      const sab = definicoesSabotadas(de, para);
      for (const f of FUNCOES()) await C.query(sab[f.nome]);
      await semear();
      const falhas = await verificarContas();
      assert.ok(falhas.length > 0, `o mutante "${rotulo}" NAO ficou vermelho`);
      assert.ok(
        falhas.some((x) => x.startsWith("validacao(")),
        `o mutante "${rotulo}" devia reprovar a validacao`,
      );
      assert.ok(
        falhas.some((x) => x.startsWith("v23(")),
        `o mutante "${rotulo}" devia reprovar a v23`,
      );
      assert.ok(
        falhas.some((x) => x.startsWith("v24(")),
        `o mutante "${rotulo}" devia reprovar a v24`,
      );
    } finally {
      await C.query("ROLLBACK");
    }
  });
}

prova(
  "DADO: um pedido gravado ANTES (29,95 x 10%, total 26,96) fica identico depois da migration; nenhuma linha de pedido, item, produto ou cupom muda",
  () =>
    emTransacao(
      async () => {
        const r = await pedir({
          porta: "v23",
          prod: "p2995",
          qtd: 1,
          cupom: "PCT10",
          totalCentavos: 2695,
        });
        assert.ok(r.linhas, r.erro);
        const id = r.linhas[0].id;
        const foto = async () => ({
          pedido: (await lerPedido(id)).tudo,
          itens: (
            await C.query(
              "SELECT to_jsonb(i) AS i FROM public.marketplace_order_items i WHERE i.order_id = $1 ORDER BY i.id",
              [id],
            )
          ).rows,
          contagens: (
            await C.query(
              `SELECT (SELECT count(*) FROM public.marketplace_orders) AS pedidos, (SELECT count(*) FROM public.marketplace_order_items) AS itens,
                    (SELECT sum(estoque) FROM public.produtos) AS estoque, (SELECT sum(usage_count) FROM public.coupons) AS usos`,
            )
          ).rows[0],
        });
        const antes = await foto();
        assert.equal(Number(antes.pedido.total), 26.96);
        assert.equal(await aplicar(MIG), null);
        await esperarHashes("depois", "apos aplicar");
        assert.deepEqual(await foto(), antes, "a migration mexeu em dado");
      },
      { estado: "antes", semente: true },
    ),
);

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL, atributos); atributos, OID, dono e ACL iguais ao ANTES",
  () =>
    emTransacao(
      async () => {
        const antes = await retrato();
        assert.equal(await aplicar(MIG), null);
        const d1 = await retrato();
        assert.equal(await aplicar(MIG), null, "reaplicar 2x falhou");
        assert.deepEqual(await retrato(), d1);
        assert.equal(
          await aplicar(MIG.replace(/\n/g, "\r\n")),
          null,
          "a migration em CRLF falhou",
        );
        await esperarHashes("depois", "CRLF");
        assert.deepEqual(await retrato(), d1);
        assert.deepEqual(d1, antes, "oid, dono, ACL ou atributos mudaram");
        // O mesmo vale para o rollback em CRLF (o aplicador pode entregar o arquivo com CR).
        assert.equal(
          await aplicar(RB.replace(/\n/g, "\r\n")),
          null,
          "o rollback em CRLF falhou",
        );
        await esperarHashes("antes", "rollback CRLF");
      },
      { estado: "antes" },
    ),
);

prova(
  "ROLLBACK: devolve cada corpo byte a byte (md5, sha256 e texto) e a mesma ACL; o segundo rollback RECUSA sem escrever; ida e volta termina igual",
  () =>
    emTransacao(
      async () => {
        const antes = await prosrcs();
        const retratoAntes = await retrato();
        assert.equal(await aplicar(MIG), null);
        const d1 = await prosrcs();
        const retratoDepois = await retrato();
        assert.equal(await aplicar(RB), null, "o rollback falhou");
        await esperarHashes("antes", "rollback");
        const volta = await prosrcs();
        for (const f of FUNCOES()) {
          assert.equal(
            volta[f.nome],
            antes[f.nome],
            `${f.nome}: o rollback nao devolve o texto byte a byte`,
          );
          assert.equal(sha256(volta[f.nome]), sha256(antes[f.nome]));
          assert.equal(
            volta[f.nome],
            corpoDe(DEF_ANTES[f.nome], f),
            `${f.nome}: o rollback != texto da migration anterior`,
          );
        }
        assert.deepEqual(await retrato(), retratoAntes);
        const recusa = await aplicar(RB);
        assert.ok(recusa, "o segundo rollback devia recusar");
        assert.match(recusa.erro, /B1_BASELINE_DIVERGENT/);
        await esperarHashes("antes", "segundo rollback");
        assert.equal(await aplicar(MIG), null);
        assert.deepEqual(await prosrcs(), d1, "ida e volta nao termina igual");
        assert.deepEqual(await retrato(), retratoDepois);
      },
      { estado: "antes" },
    ),
);

for (const alvo of FUNCOES()) {
  prova(
    `PRE-VOO: com o corpo de ${alvo.nome} desconhecido, a migration RECUSA (B1_BASELINE_DIVERGENT) e o rollback tambem, sem escrever nada`,
    () =>
      emTransacao(
        async () => {
          const f = alvo;
          const d = DEF_ANTES[f.nome].replace(
            `AS ${f.delim}\n`,
            () => `AS ${f.delim}\n    -- corpo desconhecido\n`,
          );
          assert.notEqual(d, DEF_ANTES[f.nome]);
          await C.query(d);
          const foto = await prosrcs();
          const r = await aplicar(MIG);
          assert.ok(r, "a migration devia recusar");
          assert.match(r.erro, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(await prosrcs(), foto, "o pre-voo escreveu");
          // O rollback recusa com o corpo vigente de antes (nao e' o desta migration).
          const rr = await aplicar(RB);
          assert.ok(rr, "o rollback devia recusar");
          assert.match(rr.erro, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await prosrcs(),
            foto,
            "o pre-voo do rollback escreveu",
          );
        },
        { estado: "antes" },
      ),
  );
}

prova(
  "POS-VOO: se uma das tres funcoes sair com o corpo errado, o pos-voo RECUSA e a transacao desfaz TUDO (nenhuma das tres fica pela metade)",
  () =>
    emTransacao(
      async () => {
        // Migration sabotada: a v24 e' instalada SEM o round (o corpo vigente). O pre-voo passa; o pos-voo reprova pelo hash.
        const velho = definicaoEm(MIG, F24);
        const mut = MIG.replace(velho, () => DEF_ANTES[V24]);
        assert.notEqual(mut, MIG);
        const antes = await prosrcs();
        const r = await aplicar(mut);
        assert.ok(r, "o pos-voo devia recusar");
        assert.match(r.erro, /POSVOO_20261397/);
        assert.deepEqual(
          await prosrcs(),
          antes,
          "a migration ficou pela metade",
        );
        await esperarHashes("antes", "apos o pos-voo recusar");
      },
      { estado: "antes" },
    ),
);

prova(
  "CONSULTAS: 115a/115b tem rol fechado de 13 linhas, positivas no estado certo; no outro estado reprovam EXATAMENTE a linha do corpo e a da conta arredondada, das tres funcoes",
  () =>
    emTransacao(
      async () => {
        const rodar = async (n) => (await C.query(lerConsulta(n))).rows;
        const ruins = (linhas) =>
          linhas
            .filter((l) => l.ok !== true)
            .map((l) => l.item)
            .sort();
        const esperadasRuins = FUNCOES()
          .flatMap((f) => [
            `${f.nome}: corpo exato (md5)`,
            `${f.nome}: o corpo traz o desconto de porcentagem arredondado ao centavo (uma vez)`,
          ])
          .sort();
        for (const [estado, boa, ma] of [
          ["antes", B115, A115],
          ["depois", A115, B115],
        ]) {
          await instalarAntes();
          if (estado === "depois") await C.query(MIG);
          const b = await rodar(boa);
          const m = await rodar(ma);
          assert.equal(b.length, 13, "rol fechado de 13 linhas");
          assert.equal(new Set(b.map((l) => l.item)).size, 13);
          assert.deepEqual(
            ruins(b),
            [],
            `a consulta certa para o estado ${estado} devia aprovar tudo`,
          );
          assert.deepEqual(
            ruins(m),
            esperadasRuins,
            `a consulta do outro estado devia reprovar so os corpos (estado ${estado})`,
          );
        }
        // ACL aberta (PUBLIC executa) reprova a linha de EXECUTE da funcao certa; atributos trocados reprovam a linha de atributos.
        await C.query("SAVEPOINT acl");
        await C.query(`GRANT EXECUTE ON FUNCTION ${FVAL.assinatura} TO PUBLIC`);
        assert.deepEqual(ruins(await rodar(A115)), [
          "validate_coupon_secure_v2: EXECUTE para authenticated, sem PUBLIC",
        ]);
        await C.query("ROLLBACK TO SAVEPOINT acl");
        await C.query("SAVEPOINT attr");
        await C.query(`ALTER FUNCTION ${F24.assinatura} SECURITY INVOKER`);
        assert.deepEqual(ruins(await rodar(A115)), [
          "create_marketplace_order_v24: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)",
        ]);
        await C.query("ROLLBACK TO SAVEPOINT attr");
      },
      { estado: "antes" },
    ),
);

// ---------------------------------------------------------------------------
async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  let falhou = 0;
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok   ${nome}`);
      } catch (e) {
        falhou += 1;
        console.log(
          `  FALHOU ${nome}\n    ${String(e?.stack ? e.stack : e)
            .split("\n")
            .slice(0, 8)
            .join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  console.log(`\n${PROVAS.length - falhou}/${PROVAS.length} provas passaram`);
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

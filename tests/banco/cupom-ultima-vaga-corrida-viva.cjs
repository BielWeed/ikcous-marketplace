"use strict";

/* eslint-disable security/detect-non-literal-fs-filename --
 * O unico arquivo lido e uma migration fixa deste repositorio, nunca entrada externa. */

/**
 * O ultimo uso do cupom pertence a UMA compra, nao a duas.
 * Prova o corpo VIVO da v23/v24 (ultima recriacao: 20261399997000), sem
 * desfazer sucessoras nem alterar arquivo de producao.
 *
 * A cria o pedido e segura a transacao aberta; B compra OUTRO produto com
 * OUTRA chave. A espera real de B por A e medida no catalogo, nao por um
 * pg_sleep que torce para sobrepor chamadas. Sem FOR UPDATE, B le o cupom
 * ainda disponivel, espera so ao escrever e ambas gastam a ultima vaga.
 * Cada RPC passa por VERDE -> VERMELHO (mutante) -> VERDE restaurado.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cupom-ultima-vaga-corrida-viva.cjs
 * Apenas clone prova_* do Postgres efemero; fixtures ficticias COMMITADAS.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const URL_BANCO = lerDatabaseUrlEfemera();
assert.match(
  new URL(URL_BANCO).pathname,
  /^\/prova_[a-z0-9_]+$/,
  "a mutacao so pode ocorrer no clone prova_* do rodar-isolado.cjs",
);
const MIGRATION = "20261399997000_o_pedido_guarda_quem_vai_receber.sql";
const SQL_VIGENTE = fs
  .readFileSync(
    path.join(__dirname, "../../supabase/migrations", MIGRATION),
    "utf8",
  )
  .replace(/\r\n/g, "\n");
const RPCS = ["create_marketplace_order_v23", "create_marketplace_order_v24"];
const ASSINATURA =
  "(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const CLIENTE = "ad397099-0000-4000-8000-000000000001";
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A ancora inclui a consulta de validacao inteira: nao remove o FOR SHARE
// do diagnostico da recusa nem qualquer outra trava da funcao.
const ANCORA =
  /SELECT id, value, type INTO v_coupon_id, v_coupon_val, v_coupon_type\s+FROM public\.coupons\s+WHERE UPPER\(code\) = UPPER\(p_coupon_code\)\s+AND active = true\s+AND \(valid_until IS NULL OR valid_until > now\(\)\)\s+AND \(usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit\)\s+AND \(min_purchase IS NULL OR v_calculated_subtotal >= min_purchase\)\s+FOR UPDATE;/g;

async function sessao(compradora = false) {
  const c = new Client({ connectionString: URL_BANCO });
  await c.connect();
  await c.query("SET statement_timeout = '15s'");
  c.pid = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  if (compradora) {
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, false), set_config('request.jwt.claims', $2, false)",
      [
        CLIENTE,
        JSON.stringify({
          role: "authenticated",
          app_metadata: { role: "customer" },
        }),
      ],
    );
    await c.query("SET ROLE authenticated");
  }
  return c;
}

async function semear(c) {
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'cliente@ultima-vaga.test', '{}')",
    [CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente ficticia', 'customer') ON CONFLICT (id) DO NOTHING",
    [CLIENTE],
  );
  await c.query(`
    INSERT INTO public.store_config
      (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage,
       enable_coupons, pagamento_online, formas_pagamento_entrega,
       store_address, enabled_shipping_methods)
    VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national',
       true, true, ARRAY['cash'], 'Rua Ficticia, 100',
       ARRAY['local-delivery', 'store-pickup'])
    ON CONFLICT (id) DO UPDATE SET
      origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
      free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
      enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
      formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
      store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods
  `);
}

async function cenario(c) {
  const produtoA = crypto.randomUUID();
  const produtoB = crypto.randomUUID();
  const chaveA = crypto.randomUUID();
  const chaveB = crypto.randomUUID();
  const codigo = `ULTIMA${crypto.randomUUID().replace(/-/g, "")}`;
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
     VALUES ($1, 'Produto ficticio A', 100, 5, true, 40, false),
            ($2, 'Produto ficticio B', 100, 5, true, 40, false)`,
    [produtoA, produtoB],
  );
  const cupom = (
    await c.query(
      `INSERT INTO public.coupons
       (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
       VALUES ($1, 'fixed', 10, 0, 1, 0, NULL, true) RETURNING id`,
      [codigo],
    )
  ).rows[0].id;
  assert.notEqual(produtoA, produtoB);
  assert.notEqual(chaveA, chaveB);
  return { produtoA, produtoB, chaveA, chaveB, cupom, codigo };
}

function comprar(c, rpc, produto, chave, codigo) {
  assert.ok(RPCS.includes(rpc));
  return c.query(
    `SELECT public.${rpc}($1::jsonb, 90::numeric, 0::numeric, $2::text,
       NULL::uuid, $3::text, 'Cliente ficticia', '5534999990000', NULL::text,
       NULL::jsonb, '38500-100', 'local-delivery', $4::uuid) AS id`,
    [
      JSON.stringify([{ product_id: produto, quantity: 1 }]),
      rpc === "create_marketplace_order_v24" ? "online" : "cash",
      codigo,
      chave,
    ],
  );
}

function observar(promessa) {
  const estado = { fim: false };
  estado.p = promessa
    .then(
      (r) => ({ id: r.rows[0].id }),
      (e) => ({ erro: e.message, codigo: e.code }),
    )
    .then((r) => {
      estado.fim = true;
      return r;
    });
  return estado;
}

async function esperarPorA(admin, a, b, estado) {
  for (let i = 0; i < 120; i++) {
    const r = await admin.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE pid = $1 AND wait_event_type = 'Lock'
         AND wait_event IN ('transactionid', 'tuple')
         AND $2::int = ANY(pg_blocking_pids(pid))`,
      [b.pid, a.pid],
    );
    if (r.rowCount) return;
    assert.equal(estado.fim, false, "B terminou sem disputar a vaga com A");
    await dormir(25);
  }
  assert.fail("B nao esperou a transacao A: sobreposicao nao demonstrada");
}

async function corrida(admin, rpc) {
  const f = await cenario(admin);
  const a = await sessao(true);
  const b = await sessao(true);
  try {
    await a.query("BEGIN");
    const resultadoA = await comprar(a, rpc, f.produtoA, f.chaveA, f.codigo);
    const resultadoB = observar(
      comprar(b, rpc, f.produtoB, f.chaveB, f.codigo),
    );
    await esperarPorA(admin, a, b, resultadoB);
    assert.equal(resultadoB.fim, false, "B nao pode terminar antes do COMMIT");
    await a.query("COMMIT");
    const segunda = await resultadoB.p;
    const foto = (
      await admin.query(
        `SELECT
          (SELECT count(*)::int FROM public.marketplace_orders
           WHERE idempotency_key IN ($1, $2)) AS pedidos,
          (SELECT count(*)::int FROM public.marketplace_order_items
           WHERE product_id IN ($3, $4)) AS itens,
          (SELECT count(*)::int FROM public.marketplace_order_items
           WHERE product_id = $4) AS itens_b,
          (SELECT estoque FROM public.produtos WHERE id = $3) AS estoque_a,
          (SELECT estoque FROM public.produtos WHERE id = $4) AS estoque_b,
          (SELECT usage_count FROM public.coupons WHERE id = $5) AS usos`,
        [f.chaveA, f.chaveB, f.produtoA, f.produtoB, f.cupom],
      )
    ).rows[0];
    return { primeira: resultadoA.rows[0].id, segunda, foto };
  } finally {
    // Libera A primeiro, inclusive quando uma assercao falha com B bloqueada.
    await a.query("ROLLBACK").catch(() => {});
    await b.query("ROLLBACK").catch(() => {});
    await a.end();
    await b.end();
  }
}

function conferir(r) {
  assert.equal(
    Number(Boolean(r.primeira)) + Number(Boolean(r.segunda.id)),
    1,
    "exatamente uma compra deve ser aceita na ultima vaga",
  );
  assert.equal(r.segunda.codigo, "P0001", "a recusa e de negocio, nao timeout");
  assert.match(r.segunda.erro, /já atingiu o limite de usos/);
  assert.deepEqual(r.foto, {
    pedidos: 1,
    itens: 1,
    itens_b: 0,
    estoque_a: 4,
    estoque_b: 5,
    usos: 1,
  });
}

function relatar(estado, rpc, r) {
  console.log(
    `[${estado}] ${rpc}: aceitas=${Number(Boolean(r.primeira)) + Number(Boolean(r.segunda.id))}; ${JSON.stringify(r.foto)}; B=${r.segunda.erro ?? "aceita"}`,
  );
}

async function original(admin, rpc) {
  const r = (
    await admin.query(
      `SELECT pg_get_functiondef(oid) AS ddl, prosrc
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
      [`public.${rpc}${ASSINATURA}`],
    )
  ).rows[0];
  assert.ok(r, `funcao viva ausente: ${rpc}`);
  const inicio = SQL_VIGENTE.indexOf(
    `CREATE OR REPLACE FUNCTION public.${rpc}(`,
  );
  assert.ok(inicio >= 0);
  const abre = SQL_VIGENTE.indexOf("$function$", inicio) + "$function$".length;
  const fecha = SQL_VIGENTE.indexOf("$function$", abre);
  assert.equal(
    r.prosrc.replace(/\r\n/g, "\n"),
    SQL_VIGENTE.slice(abre, fecha),
    `o corpo vivo de ${rpc} diverge da ultima recriacao ${MIGRATION}; atualize a prova`,
  );
  console.log(`[VIVO] ${rpc}: corpo igual a ${MIGRATION}`);
  return r;
}

async function main() {
  const admin = await sessao();
  try {
    await semear(admin);
    for (const rpc of RPCS) {
      const vivo = await original(admin, rpc);
      const verde = await corrida(admin, rpc);
      conferir(verde);
      relatar("VERDE", rpc, verde);

      assert.equal(
        [...vivo.ddl.matchAll(ANCORA)].length,
        1,
        "ancora deve ser unica",
      );
      const mutante = vivo.ddl.replace(ANCORA, (s) =>
        s.replace("FOR UPDATE", ""),
      );
      assert.notEqual(mutante, vivo.ddl, "a mutacao precisa ser aplicada");
      try {
        await admin.query(mutante);
        const vermelho = await corrida(admin, rpc);
        // Nao aceita timeout, erro SQL ou outra recusa como mutante morto.
        assert.ok(vermelho.primeira);
        assert.ok(
          vermelho.segunda.id,
          `MUTANTE SOBREVIVEU ou falhou por outro motivo: ${JSON.stringify(vermelho)}`,
        );
        assert.deepEqual(vermelho.foto, {
          pedidos: 2,
          itens: 2,
          itens_b: 1,
          estoque_a: 4,
          estoque_b: 4,
          usos: 2,
        });
        assert.throws(
          () => conferir(vermelho),
          /exatamente uma compra deve ser aceita na ultima vaga/,
        );
        relatar(
          "VERMELHO: assercao da ultima vaga reprovou sem FOR UPDATE",
          rpc,
          vermelho,
        );
      } finally {
        await admin.query(vivo.ddl);
        const restaurado = (
          await admin.query(
            "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
            [`public.${rpc}${ASSINATURA}`],
          )
        ).rows[0].prosrc;
        assert.equal(
          restaurado,
          vivo.prosrc,
          "restauracao byte a byte do corpo vivo",
        );
      }
      const restaurado = await corrida(admin, rpc);
      conferir(restaurado);
      relatar("VERDE RESTAURADO", rpc, restaurado);
    }
    console.log(
      "[OK] v23 e v24: 2 corridas verdes, 2 mutantes mortos, 2 corridas restauradas.",
    );
  } finally {
    await admin.end();
  }
}

main().catch((e) => {
  console.error(`[FALHOU] ${e.stack}`);
  process.exitCode = 1;
});

"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Só migrations fixas deste repositório são lidas. */
/**
 * Total conferido do PDV: só PG efêmero local (efemero.cjs); nunca .env ou loja.
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/pdv-total-conferido-viva.cjs
 * Fixture + chamadas reais + rollback. Não prova PostgREST nem Supabase remoto.
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const NOME = "20261280000000_o_balcao_registra_so_o_total_conferido.sql";
const ANTIGA =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)";
const NOVA =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)";
const ler = (n) =>
  fs.readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8");
const ADMIN = "e2800000-0000-4000-8000-000000000001";

async function vender(
  c,
  itens,
  esperado,
  chave = randomUUID(),
  desconto = 0,
  legado = false,
) {
  await c.query("SAVEPOINT venda");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [
        ADMIN,
        JSON.stringify({
          sub: ADMIN,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ],
    );
    const args = [JSON.stringify(itens), desconto, chave];
    if (!legado) args.push(esperado);
    const sql = `SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL, 'Cliente Teste', NULL, $2::numeric, 'Fidelidade', $3::uuid${legado ? "" : ", $4::numeric"}) AS r`;
    const { rows } = await c.query(sql, args);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT venda");
    return { ok: true, r: rows[0].r };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT venda");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT venda");
    return { ok: false, code: e.code, message: e.message, details: e.detail };
  }
}
async function fotografia(c, p, v, chave) {
  return (
    await c.query(
      `SELECT
    (SELECT estoque FROM public.produtos WHERE id=$1) AS estoque,
    (SELECT stock_increment FROM public.product_variants WHERE id=$2) AS variante,
    (SELECT count(*)::int FROM public.marketplace_orders) AS vendas,
    (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
    (SELECT count(*)::int FROM public.marketplace_order_history) AS historicos,
    (SELECT count(*)::int FROM public.marketplace_order_payment_history) AS pagamentos,
    (SELECT count(*)::int FROM public.marketplace_order_internal_notes) AS notas,
    (SELECT count(*)::int FROM public.marketplace_orders WHERE idempotency_key=$3) AS chave,
    (SELECT coalesce(sum(usage_count),0)::text FROM public.coupons) AS cupons`,
      [p, v, chave],
    )
  ).rows[0];
}
async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("GRANT USAGE ON SCHEMA auth TO authenticated");
    await c.query(
      "INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES ($1,'admin@pdv-total.teste','{\"role\":\"admin\"}')",
      [ADMIN],
    );
    await c.query(
      "INSERT INTO public.profiles(id,full_name,role) VALUES ($1,'Admin Teste','admin') ON CONFLICT(id) DO UPDATE SET role='admin'",
      [ADMIN],
    );
    const p = randomUUID();
    const pai = randomUUID();
    const v = randomUUID();
    await c.query(
      "INSERT INTO public.produtos(id,nome,preco_venda,estoque,ativo,custo) VALUES ($1,'Simples',120,10,true,60),($2,'Com variante',100,10,true,60)",
      [p, pai],
    );
    await c.query(
      "INSERT INTO public.product_variants(id,product_id,name,value,sku,stock_increment,price_override,active) VALUES ($1,$2,'Tamanho','M','PDV-TOTAL',10,150,true)",
      [v, pai],
    );
    const simples = [{ product_id: p, quantity: 1 }];
    const chave = randomUUID();
    const antes = await fotografia(c, p, v, chave);
    const recusada = await vender(c, simples, 100, chave);
    assert.equal(recusada.ok, false);
    assert.equal(recusada.code, "PDV01", recusada.message);
    assert.deepEqual(JSON.parse(recusada.details), {
      total: 120,
      itens: [{ product_id: p, variant_id: null, price: 120 }],
    });
    assert.deepEqual(
      await fotografia(c, p, v, chave),
      antes,
      "recusa escreveu venda, estoque, cupom ou chave",
    );
    const corrigida = await vender(c, simples, 120, chave);
    assert.equal(corrigida.ok, true, corrigida.message);
    assert.equal(corrigida.r.order.total, 120);
    await c.query(
      "UPDATE public.produtos SET preco_venda=140,estoque=0 WHERE id=$1",
      [p],
    );
    const repetida = await vender(c, simples, 1, chave);
    assert.equal(repetida.ok, true, repetida.message);
    assert.equal(repetida.r.ja_existia, true);
    assert.equal(repetida.r.order.id, corrigida.r.order.id);
    assert.equal(repetida.r.order.total, 120);

    // Preço de variante, desconto, queda de preço e os dois lados da tolerância.
    const itens = [{ product_id: pai, variant_id: v, quantity: 2 }];
    for (const esperado of [290.02, 289.98]) {
      const k = randomUUID();
      const foto = await fotografia(c, pai, v, k);
      const r = await vender(c, itens, esperado, k, 10);
      assert.equal(r.code, "PDV01", r.message);
      assert.deepEqual(JSON.parse(r.details), {
        total: 290,
        itens: [{ product_id: pai, variant_id: v, price: 150 }],
      });
      assert.deepEqual(await fotografia(c, pai, v, k), foto);
    }
    // Controle negativo: sem a comparação, a MESMA prova deixa de recusar.
    await c.query("SAVEPOINT controle");
    try {
      const definicao = (
        await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          NOVA,
        ])
      ).rows[0].d;
      const mutada = definicao.replace(
        "IF p_total_esperado IS NOT NULL AND abs(v_total - p_total_esperado) > 0.01 THEN",
        "IF false THEN",
      );
      assert.notEqual(mutada, definicao, "controle não alterou a guarda");
      await c.query(mutada);
      // Exigir venda GRAVADA com total divergente prova a ausência da guarda.
      // Um erro qualquer (SQL, permissão ou estoque) não é controle válido.
      const k = randomUUID();
      const r = await vender(c, itens, 100, k, 10);
      assert.equal(r.ok, true, r.message);
      assert.equal(r.r.order.total, 290);
      const gravada = (
        await c.query(
          "SELECT total::text FROM public.marketplace_orders WHERE idempotency_key=$1",
          [k],
        )
      ).rows;
      assert.equal(gravada.length, 1);
      assert.equal(Number(gravada[0].total), 290);
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT controle");
      await c.query("RELEASE SAVEPOINT controle");
    }

    for (const esperado of [290.01, 289.99, null]) {
      const r = await vender(c, itens, esperado, randomUUID(), 10);
      assert.equal(r.ok, true, r.message);
      assert.equal(r.r.order.total, 290);
      assert.equal(r.r.items[0].price, 150);
    }
    const antiga = await vender(
      c,
      [{ product_id: pai, variant_id: v, quantity: 1 }],
      null,
      randomUUID(),
      0,
      true,
    );
    assert.equal(antiga.ok, true, antiga.message);
    for (const esperado of [-1, "NaN", "Infinity", "-Infinity"]) {
      const r = await vender(
        c,
        [{ product_id: pai, variant_id: v, quantity: 1 }],
        esperado,
      );
      assert.equal(r.code, "22023", r.message);
    }
    assert.equal(
      (await c.query("SELECT to_regprocedure($1) IS NULL AS sim", [ANTIGA]))
        .rows[0].sim,
      true,
    );
    const atributos = (
      await c.query(
        `SELECT p.prosecdef, p.proconfig,
      p.proowner::regrole::text AS dono,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
      has_function_privilege('service_role',p.oid,'EXECUTE') AS servico
      FROM pg_proc p WHERE p.oid=to_regprocedure($1)`,
        [NOVA],
      )
    ).rows[0];
    assert.equal(atributos.prosecdef, true);
    assert.deepEqual(atributos.proconfig, ["search_path=pg_catalog, pg_temp"]);
    assert.equal(atributos.auth, true);
    assert.equal(atributos.anon, false);
    assert.equal(atributos.servico, false);
    assert.equal(
      atributos.dono,
      (
        await c.query(
          "SELECT relowner::regrole::text AS dono FROM pg_class WHERE oid='public.marketplace_orders'::regclass",
        )
      ).rows[0].dono,
    );
    // A porta também preserva chamadas antigas só com os dois obrigatórios
    // e aceita o parâmetro novo POR NOME, como o PostgREST faz.
    await c.query("SET LOCAL ROLE authenticated");
    const nomeados = await c.query(
      "SELECT public.registrar_venda_presencial(p_itens=>$1::jsonb,p_pagamento=>'cash',p_total_esperado=>150) AS r",
      [JSON.stringify([{ product_id: pai, variant_id: v, quantity: 1 }])],
    );
    assert.equal(nomeados.rows[0].r.order.total, 150);
    const dois = await c.query(
      "SELECT public.registrar_venda_presencial($1::jsonb,'cash') AS r",
      [JSON.stringify([{ product_id: pai, variant_id: v, quantity: 1 }])],
    );
    assert.equal(dois.rows[0].r.order.total, 150);
    await c.query("RESET ROLE");
    // As provas de objetos ancestrais não podem perder a função pela troca de assinatura.
    for (const nome of [
      "36a-conferir-venda-repetida-do-balcao-aplicado.sql",
      "52a-conferir-motivo-do-balcao-privado-aplicado.sql",
      "9a-conferir-60-a-66-aplicado.sql",
    ]) {
      const sql = fs.readFileSync(
        path.join(__dirname, "../../scripts/publicacao/consultas", nome),
        "utf8",
      );
      const linhas = (await c.query(sql)).rows;
      assert(linhas.length > 0);
      assert.deepEqual(
        linhas.filter((l) => l.ok !== true),
        [],
        nome,
      );
    }
    await c.query(ler(NOME)); // reaplicação
    await c.query(ler(`rollback-manual-${NOME}`));
    const corpo = (
      await c.query(
        "SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure($1)",
        [ANTIGA],
      )
    ).rows[0].prosrc;
    const fonte = ler(
      "20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql",
    ).replace(/\r/g, "");
    assert.equal(
      corpo.replace(/\r/g, ""),
      fonte.split("AS $$")[1].split("$$;")[0],
    );
    await c.query(ler(NOME));
    console.log(
      "[pdv-total] recusa sem escrita; mesma chave corrigida; ja_existia; variante/desconto; tolerância; legado; ACL; reaplicar/rollback: OK",
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}
main().catch((e) => falhar("FALHOU", e.stack || e.message));

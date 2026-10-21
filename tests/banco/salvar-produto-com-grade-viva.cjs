"use strict";

/**
 * Prova VIVA da migration 20261352000000 (`salvar_produto_com_grade`: o painel salva o produto, apaga e grava as
 * variações NUMA transação, sob as travas da compra online; ESTOQUE = DINHEIRO), num Postgres EFÊMERO, com os papéis
 * de verdade e CONEXÕES REAIS em paralelo (a espera é medida em pg_stat_activity, nunca por dormir e torcer).
 *
 * O defeito (P1 dos PRs 1043/1044): o painel gravava o produto (com `ultima_atualizacao = base`) e, em OUTRA requisição,
 * as variações com o estoque do formulário. Uma compra que terminava entre as duas era DESFEITA pelo upsert.
 *
 *  A  DEFEITO   o caminho ANTIGO (duas requisições) restaura o estoque vendido: reproduzido.
 *  B  CORREÇÃO  a RPC, com a compra aberta no meio, ESPERA (medido), vê a versão mudada, recusa com PRD01 e NÃO escreve
 *               nada; a venda fica. Controles (mutantes): sem a conferência da versão, ou sem as travas, a venda é
 *               desfeita — a prova de que cada guarda é necessária.
 *  C  CAMINHO   sem compra no meio: produto + variações gravados, nova variação inserida, apagada removida; o valor
 *               devolvido é a versão do banco.
 *  D  SEM ESTOQUE   versão nula e item sem `stock_increment`: o estoque do banco (já vendido) sobrevive.
 *  E  EXCLUSÃO  variação que está num pedido (FK) vai para `recusadas` e o resto grava; SKU de variação apagada
 *               reaproveitado na mesma chamada; variação de OUTRO produto não é reparentada.
 *  F  PERMISSÃO anon sem EXECUTE; cliente e admin rebaixado recusados (42501) sem escrever; chave fora da lista
 *               branca recusada (22023) sem escrever; produto excluído não achado.
 *  G  TRAVAS    20 rodadas da RPC contra compras online de carrinho misto em ordem oposta: nenhum deadlock (40P01).
 *  H  MIGRATION reaplicar 2x e CRLF = mesmo estado; rollback apaga só a função e repetido é no-op; a sobrecarga
 *               recusa; ACL e atributos.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/salvar-produto-com-grade-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório (as migrations); os índices vêm de contadores deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(RAIZ, "supabase", "migrations");
const ARQ = "20261352000000_o_produto_e_a_grade_salvam_numa_transacao_so.sql";
const ler = (n) => fs.readFileSync(path.join(MIGRATIONS, n), "utf8");
const MIGRATION = ler(ARQ).replace(/\r\n/g, "\n");
const ROLLBACK = ler(`rollback-manual-${ARQ}`).replace(/\r\n/g, "\n");
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

const FN =
  "public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])";
const V24 = "create_marketplace_order_v24";
const SQL_RPC =
  "SELECT public.salvar_produto_com_grade($1::uuid, $2::timestamptz, $3::jsonb, $4::jsonb, $5::uuid[]) AS r";
const SQL_PEDIDO = `SELECT public.${V24}($1::jsonb, $2::numeric, $3::numeric, 'online', NULL::uuid, NULL::text,
     'Comprador Prova', '5534999990000', NULL::text, NULL::jsonb, $4::text, 'local-delivery', $5::uuid) AS id`;

const U_ADMIN = "7e352000-0000-4000-8000-0000000000a1";
const U_CLIENTE = "7e352000-0000-4000-8000-0000000000c1";
const U_REBAIXADO = "7e352000-0000-4000-8000-0000000000b1";
const CEP_LOCAL = "38500-100";
const JWT = (role) =>
  JSON.stringify({ role: "authenticated", app_metadata: { role } });

let ADM; // autocommit: semeia e troca o corpo (COMMITADO no clone)
let seq = 0;
const uid = (n) => `7e352000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

// ---- semente ---------------------------------------------------------------------------------------------------

async function semearBase(c) {
  for (const [id, papel, jwtRole] of [
    [U_ADMIN, "admin", "admin"],
    [U_CLIENTE, "customer", "customer"],
    [U_REBAIXADO, "customer", "admin"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@352.teste', $2::jsonb) ON CONFLICT DO NOTHING",
      [id, JSON.stringify({ role: jwtRole })],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Prova 352', $2) ON CONFLICT DO NOTHING",
      [id, papel],
    );
  }
  await c.query(
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
}
/** Produto com N variações (estoque 50 cada), tudo COMMITADO. Devolve { id, vars: [ids] }. */
async function novoProduto(n = 1, { estoque = 1000, estoqueVar = 50 } = {}) {
  seq += 1;
  const id = uid(100 + seq);
  await ADM.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, $2, 100, $3, true, 40, false)",
    [id, `Produto 352 ${seq}`, estoque],
  );
  const vars = [];
  for (let i = 0; i < n; i++) {
    const v = uid(5000 + seq * 10 + i);
    await ADM.query(
      "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active, sku) VALUES ($1, $2, 'Tamanho', $3, $4, true, $5)",
      [v, id, `T${i}`, estoqueVar, `SKU352-${seq}-${i}`],
    );
    vars.push(v);
  }
  return { id, vars };
}
const versao = async (id) =>
  (
    await ADM.query(
      "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
      [id],
    )
  ).rows[0].v;
const estoqueDa = async (v) =>
  (
    await ADM.query(
      "SELECT stock_increment AS e FROM public.product_variants WHERE id = $1",
      [v],
    )
  ).rows[0]?.e;
const nomeDe = async (id) =>
  (await ADM.query("SELECT nome FROM public.produtos WHERE id = $1", [id]))
    .rows[0].nome;
const foto = async (id) =>
  (
    await ADM.query(
      `SELECT md5(coalesce((SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.produtos p WHERE p.id = $1), '')
              || coalesce((SELECT string_agg(v::text, '|' ORDER BY v.id) FROM public.product_variants v WHERE v.product_id = $1), '')) AS h`,
      [id],
    )
  ).rows[0].h;

// ---- sessões ---------------------------------------------------------------------------------------------------

async function sessao(quem) {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  c.pid = (await c.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  if (quem) {
    const [uidQuem, jwt] =
      quem === "admin"
        ? [U_ADMIN, JWT("admin")]
        : quem === "rebaixado"
          ? [U_REBAIXADO, JWT("admin")]
          : [U_CLIENTE, JWT("customer")];
    if (quem === "anon") {
      await c.query(
        "SELECT set_config('app.rpc.user_id', '', false), set_config('request.jwt.claims', '', false)",
      );
      await c.query("SET ROLE anon");
    } else {
      await c.query(
        "SELECT set_config('app.rpc.user_id', $1, false), set_config('request.jwt.claims', $2, false)",
        [uidQuem, jwt],
      );
      await c.query("SET ROLE authenticated");
    }
  }
  return c;
}
async function fechar(...cs) {
  for (const c of cs) {
    if (!c) continue;
    await c.query("ROLLBACK").catch(() => {});
    await c.end().catch(() => {});
  }
}
const comprar = (c, itens, chave) =>
  c.query(SQL_PEDIDO, [
    JSON.stringify(
      itens.map(([prod, v]) => ({
        product_id: prod.id,
        variant_id: v ?? null,
        quantity: 1,
      })),
    ),
    100 * itens.length,
    0,
    CEP_LOCAL,
    chave,
  ]);
const chaveNova = () => {
  seq += 1;
  return uid(900000 + seq);
};
/** O item de variação como o formulário o manda (`stock` ausente = a lojista não mexeu). */
const item = (id, valor, extra = {}) => ({
  ...(id ? { id } : {}),
  name: "Tamanho",
  value: valor,
  sku: null,
  codigo_barras: null,
  price_override: null,
  active: true,
  image_url: null,
  ...extra,
});
const rpc = (c, id, base, produto, variantes, apagar = []) =>
  c.query(SQL_RPC, [
    id,
    base,
    JSON.stringify(produto),
    JSON.stringify(variantes),
    apagar,
  ]);
function observar(promessa) {
  const e = { fim: false };
  e.p = promessa
    .then(
      (r) => ({ ok: r.rows[0].r ?? r.rows[0].id }),
      (x) => ({ erro: x.message, codigo: x.code }),
    )
    .then((r) => {
      e.fim = true;
      return r;
    });
  return e;
}
async function emEspera(pid) {
  for (let i = 0; i < 200; i++) {
    const r = await ADM.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
      [pid],
    );
    if (r.rowCount) return true;
    await dormir(50);
  }
  return false;
}
async function falhaCom(promessa) {
  try {
    await promessa;
  } catch (e) {
    return e;
  }
  return null;
}

// ---- a coreografia do defeito: a compra termina ENTRE a conferência e a gravação da grade -------------------------

/**
 * O painel leu a versão; uma compra online da variação 0 está ABERTA (segura as travas); o painel manda salvar com o
 * estoque do formulário (50). Devolve { resposta, estoque, nome } depois da compra terminar.
 */
async function salvarComCompraNoMeio() {
  const prod = await novoProduto(2);
  const base = await versao(prod.id);
  const comprador = await sessao("cliente");
  const painel = await sessao("admin");
  try {
    await comprador.query("BEGIN");
    await comprar(comprador, [[prod, prod.vars[0]]], chaveNova());
    const e = observar(
      rpc(painel, prod.id, base, { nome: "Nome novo do painel", estoque: 7 }, [
        item(prod.vars[0], "T0", { stock_increment: 50 }),
        item(prod.vars[1], "T1"),
      ]),
    );
    assert.ok(
      await emEspera(painel.pid),
      "o painel deveria ESPERAR a compra (travas)",
    );
    assert.equal(e.fim, false, "o painel não pode terminar antes da compra");
    await comprador.query("COMMIT");
    const resposta = await e.p;
    return {
      resposta,
      prod,
      estoque: await estoqueDa(prod.vars[0]),
      nome: await nomeDe(prod.id),
    };
  } finally {
    await fechar(comprador, painel);
  }
}

// ---- corpos de controle (mutantes) ------------------------------------------------------------------------------

function corpoDaMigration() {
  const ini = MIGRATION.indexOf(
    "CREATE OR REPLACE FUNCTION public.salvar_produto_com_grade(",
  );
  const fim = MIGRATION.indexOf("$function$;", ini) + "$function$;".length;
  return MIGRATION.slice(ini, fim);
}
const SEM_CONFERENCIA = () => {
  const t = corpoDaMigration();
  const r = t.replace(
    /IF p_base_atualizado_em IS NOT NULL[\s\S]*?END IF;\n/,
    "",
  );
  assert.notEqual(r, t, "o mutante sem conferência não mudou nada");
  return r;
};
const SEM_TRAVAS = () => {
  const t = corpoDaMigration();
  const r1 = t.replace(
    /PERFORM id FROM public\.product_variants\n\s+WHERE product_id = p_produto_id\n\s+ORDER BY id FOR NO KEY UPDATE;/,
    "",
  );
  assert.notEqual(r1, t, "o mutante sem a trava das variações não mudou nada");
  const r2 = r1.replace(
    /deleted_at IS NULL FOR NO KEY UPDATE;/,
    "deleted_at IS NULL;",
  );
  assert.notEqual(r2, r1, "o mutante sem a trava do produto não mudou nada");
  return r2;
};
/** Volta ao estado da migration, qualquer que seja o corpo vivo (o pré-voo recusa reaplicar por cima de outro corpo). */
async function restaurarTudo() {
  await ADM.query(`DROP FUNCTION IF EXISTS ${FN}`);
  await ADM.query(MIGRATION);
}
async function comCorpo(sql, fn) {
  await ADM.query(sql);
  try {
    return await fn();
  } finally {
    await restaurarTudo();
  }
}

// ---- provas ----------------------------------------------------------------------------------------------------

prova(
  "A. DEFEITO: no caminho antigo (duas requisições) a compra do meio é DESFEITA",
  async () => {
    const prod = await novoProduto(1);
    const base = await versao(prod.id);
    const painel = await sessao("admin");
    const comprador = await sessao("cliente");
    try {
      // 1ª requisição: produto com a versão conferida (como `updateProduct` fazia).
      const r1 = await painel.query(
        "UPDATE public.vw_produtos_admin SET nome = 'Salvo pelo painel' WHERE id = $1 AND ultima_atualizacao = $2::timestamptz RETURNING id",
        [prod.id, base],
      );
      assert.equal(r1.rowCount, 1, "a conferência da versão passou");
      // A compra termina ENTRE as duas requisições.
      await comprar(comprador, [[prod, prod.vars[0]]], chaveNova());
      assert.equal(
        await estoqueDa(prod.vars[0]),
        49,
        "a venda baixou o estoque",
      );
      // 2ª requisição: o upsert de variações com o estoque do formulário (50), sem condição nenhuma.
      await painel.query(
        `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active)
       VALUES ($1, $2, 'Tamanho', 'T0', 50, true)
       ON CONFLICT (id) DO UPDATE SET stock_increment = EXCLUDED.stock_increment`,
        [prod.vars[0], prod.id],
      );
      assert.equal(
        await estoqueDa(prod.vars[0]),
        50,
        "DEFEITO reproduzido: o estoque vendido foi restaurado (venda a mais)",
      );
    } finally {
      await fechar(painel, comprador);
    }
  },
);

prova(
  "B. CORREÇÃO: a RPC espera a compra, vê a versão mudada, recusa com PRD01 e NÃO escreve nada",
  async () => {
    const antes = (await ADM.query("SELECT 1")).rowCount; // aquece a conexão
    assert.equal(antes, 1);
    const r = await salvarComCompraNoMeio();
    assert.equal(r.resposta.codigo, "PRD01", JSON.stringify(r.resposta));
    assert.match(r.resposta.erro, /produto mudou/i);
    assert.equal(r.estoque, 49, "a venda fica: o estoque NÃO volta a 50");
    assert.notEqual(
      r.nome,
      "Nome novo do painel",
      "nada do produto foi gravado",
    );
    const e = await ADM.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [r.prod.id],
    );
    assert.notEqual(e.rows[0].estoque, 7, "o estoque do produto também ficou");
  },
);

prova(
  "B2. MUTANTE sem a conferência da versão: a venda do meio é desfeita (a conferência é necessária)",
  async () => {
    const r = await comCorpo(SEM_CONFERENCIA(), salvarComCompraNoMeio);
    assert.ok(r.resposta.ok, JSON.stringify(r.resposta));
    assert.equal(
      r.estoque,
      50,
      "sem a conferência o estoque vendido é restaurado",
    );
  },
);

prova(
  "B3. MUTANTE sem as travas: a compra aberta NÃO é esperada e o defeito volta",
  async () => {
    const prod = await novoProduto(2);
    const base = await versao(prod.id);
    await comCorpo(SEM_TRAVAS(), async () => {
      const comprador = await sessao("cliente");
      const painel = await sessao("admin");
      try {
        await comprador.query("BEGIN");
        await comprar(comprador, [[prod, prod.vars[0]]], chaveNova());
        // Sem travas, a conferência lê a versão ANTIGA (a compra ainda não comitou) e passa; a gravação do produto então
        // espera a linha da compra, e quando ela comita o upsert da variação desfaz a venda.
        const e = observar(
          rpc(painel, prod.id, base, { nome: "Sem travas" }, [
            item(prod.vars[0], "T0", { stock_increment: 50 }),
          ]),
        );
        await emEspera(painel.pid);
        await comprador.query("COMMIT");
        const resposta = await e.p;
        assert.ok(resposta.ok, JSON.stringify(resposta));
        assert.equal(await estoqueDa(prod.vars[0]), 50);
      } finally {
        await fechar(comprador, painel);
      }
    });
  },
);

prova(
  "C. CAMINHO FELIZ: produto + variações gravados, nova inserida, apagada removida, versão devolvida",
  async () => {
    const prod = await novoProduto(3);
    const base = await versao(prod.id);
    const painel = await sessao("admin");
    try {
      const r = (
        await rpc(
          painel,
          prod.id,
          base,
          {
            nome: "Nome C",
            descricao: null,
            tags: ["a", "b"],
            imagem_urls: ["http://x/1.png"],
            preco_venda: 120.5,
            estoque: 33,
            ativo: true,
          },
          [
            item(prod.vars[0], "T0-novo", {
              stock_increment: 12,
              sku: "SKU-C-0",
            }),
            item(null, "TNOVA", { stock_increment: 8, sku: "SKU-C-NOVA" }),
          ],
          [prod.vars[2]],
        )
      ).rows[0].r;
      assert.deepEqual(r.apagadas, [prod.vars[2]]);
      assert.deepEqual(r.recusadas, []);
      assert.equal(await nomeDe(prod.id), "Nome C");
      const p = (
        await ADM.query(
          "SELECT descricao, tags, imagem_urls, preco_venda, estoque, ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
          [prod.id],
        )
      ).rows[0];
      assert.equal(p.descricao, null);
      assert.deepEqual(p.tags, ["a", "b"]);
      assert.deepEqual(p.imagem_urls, ["http://x/1.png"]);
      assert.equal(Number(p.preco_venda), 120.5);
      assert.equal(p.estoque, 33);
      assert.equal(
        new Date(r.ultima_atualizacao).getTime(),
        new Date(p.v).getTime(),
      );
      assert.equal(await estoqueDa(prod.vars[0]), 12);
      assert.equal(await estoqueDa(prod.vars[2]), undefined, "a apagada saiu");
      const nova = await ADM.query(
        "SELECT stock_increment, value FROM public.product_variants WHERE product_id = $1 AND sku = 'SKU-C-NOVA'",
        [prod.id],
      );
      assert.equal(nova.rowCount, 1);
      assert.equal(nova.rows[0].stock_increment, 8);
      // Segundo salvar com a versão NOVA (devolvida) passa; com a velha, recusa.
      await rpc(painel, prod.id, p.v, { nome: "Nome C2" }, []);
      const velha = await falhaCom(
        rpc(painel, prod.id, base, { nome: "Nome C3" }, []),
      );
      assert.equal(velha?.code, "PRD01");
      assert.equal(await nomeDe(prod.id), "Nome C2");
    } finally {
      await fechar(painel);
    }
  },
);

prova(
  "D. SEM ESTOQUE: versão nula e item sem stock_increment — o estoque do banco (já vendido) sobrevive",
  async () => {
    const prod = await novoProduto(1);
    const comprador = await sessao("cliente");
    const painel = await sessao("admin");
    try {
      await comprar(comprador, [[prod, prod.vars[0]]], chaveNova());
      assert.equal(await estoqueDa(prod.vars[0]), 49);
      await rpc(painel, prod.id, null, { nome: "Só o nome" }, [
        item(prod.vars[0], "T0", { price_override: 99 }),
      ]);
      assert.equal(
        await estoqueDa(prod.vars[0]),
        49,
        "o estoque do banco sobrevive",
      );
      assert.equal(await nomeDe(prod.id), "Só o nome");
      // Estoque só grava com a versão conferida: base nula + estoque de linha existente ou do produto = recusa.
      const antesD = await foto(prod.id);
      for (const [produto, variantes] of [
        [{ estoque: 5 }, []],
        [{}, [item(prod.vars[0], "T0", { stock_increment: 50 })]],
        [{}, [item(prod.vars[0], "T0", { stock_increment: null })]],
      ]) {
        const g = await falhaCom(
          rpc(painel, prod.id, null, produto, variantes),
        );
        assert.equal(g?.code, "22023", g?.message);
        assert.match(g.message, /versão/);
      }
      assert.equal(await foto(prod.id), antesD, "a recusa não escreveu nada");
      assert.equal(await estoqueDa(prod.vars[0]), 49);
      // Variação NOVA (sem id) só insere: passa sem versão.
      await rpc(painel, prod.id, null, {}, [
        item(null, "SEM-VERSAO", { stock_increment: 4 }),
      ]);
    } finally {
      await fechar(comprador, painel);
    }
  },
);

prova(
  "E. EXCLUSÃO: a variação num pedido vai para recusadas, o resto grava, SKU reaproveitado, sem reparentar",
  async () => {
    const prod = await novoProduto(3);
    const outro = await novoProduto(1);
    const comprador = await sessao("cliente");
    const painel = await sessao("admin");
    try {
      await comprar(comprador, [[prod, prod.vars[1]]], chaveNova()); // T1 entra num pedido
      const skuApagada = `SKU352-${seq}-X`;
      await ADM.query(
        "UPDATE public.product_variants SET sku = $2 WHERE id = $1",
        [prod.vars[2], skuApagada],
      );
      const r = (
        await rpc(
          painel,
          prod.id,
          null,
          { nome: "Com recusa" },
          [item(null, "REUSA", { sku: skuApagada, stock_increment: 3 })],
          [prod.vars[1], prod.vars[2]],
        )
      ).rows[0].r;
      assert.deepEqual(r.recusadas, [prod.vars[1]]);
      assert.deepEqual(r.apagadas, [prod.vars[2]]);
      assert.equal(await nomeDe(prod.id), "Com recusa", "o resto gravou");
      assert.equal(
        await estoqueDa(prod.vars[1]),
        49,
        "a recusada segue, com a venda",
      );
      const reusa = await ADM.query(
        "SELECT 1 FROM public.product_variants WHERE product_id = $1 AND sku = $2",
        [prod.id, skuApagada],
      );
      assert.equal(
        reusa.rowCount,
        1,
        "o SKU da apagada foi reaproveitado na mesma chamada",
      );
      const antes = await foto(outro.id);
      const rep = await falhaCom(
        rpc(painel, prod.id, null, {}, [
          item(outro.vars[0], "T0", { stock_increment: 1 }),
        ]),
      );
      assert.equal(rep?.code, "22023", rep?.message);
      assert.equal(
        await foto(outro.id),
        antes,
        "a variação do outro produto não mudou",
      );
      const alheia = (await rpc(painel, prod.id, null, {}, [], [outro.vars[0]]))
        .rows[0].r;
      assert.deepEqual(
        alheia.apagadas,
        [],
        "variação de outro produto não é apagada",
      );
      assert.equal(
        await foto(outro.id),
        antes,
        "a variação do outro produto segue lá",
      );
    } finally {
      await fechar(comprador, painel);
    }
  },
);

prova(
  "F. PERMISSÃO: anon sem EXECUTE; cliente e admin rebaixado recusados; chave fora da lista e produto excluído",
  async () => {
    const prod = await novoProduto(1);
    const antes = await foto(prod.id);
    const ANON = await sessao("anon");
    const CLI = await sessao("cliente");
    const REB = await sessao("rebaixado");
    const ADMIN = await sessao("admin");
    try {
      const a = await falhaCom(rpc(ANON, prod.id, null, { nome: "X" }, []));
      assert.equal(a?.code, "42501", a?.message);
      for (const c of [CLI, REB]) {
        const e = await falhaCom(rpc(c, prod.id, null, { nome: "X" }, []));
        assert.equal(e?.code, "42501", e?.message);
        assert.match(e.message, /Acesso negado/);
      }
      for (const chave of [
        "sold",
        "deleted_at",
        "fornecedor_id",
        "id",
        "ultima_atualizacao",
      ]) {
        const e = await falhaCom(
          rpc(
            ADMIN,
            prod.id,
            null,
            { [chave]: chave === "sold" ? 99 : null },
            [],
          ),
        );
        assert.equal(e?.code, "22023", `${chave}: ${e?.message}`);
        assert.match(e.message, new RegExp(chave));
      }
      for (const [p, v, ap] of [
        [[], [], []],
        [{}, {}, []],
        [{}, [], null],
      ]) {
        const e = await falhaCom(
          ADMIN.query(SQL_RPC, [
            prod.id,
            null,
            JSON.stringify(p),
            JSON.stringify(v),
            ap,
          ]),
        );
        assert.equal(e?.code, "22023", e?.message);
      }
      assert.equal(await foto(prod.id), antes, "nada foi escrito");
      await ADM.query(
        "UPDATE public.produtos SET deleted_at = now() WHERE id = $1",
        [prod.id],
      );
      const e = await falhaCom(rpc(ADMIN, prod.id, null, { nome: "X" }, []));
      assert.equal(e?.code, "P0002", e?.message);
      const e2 = await falhaCom(
        rpc(ADMIN, uid(999999), null, { nome: "X" }, []),
      );
      assert.equal(e2?.code, "P0002");
    } finally {
      await fechar(ANON, CLI, REB, ADMIN);
    }
  },
);

prova(
  "G. TRAVAS: 20 rodadas da RPC contra compras de carrinho misto em ordem oposta — sem deadlock (40P01)",
  async () => {
    const a = await novoProduto(2, { estoqueVar: 100000 });
    const b = await novoProduto(2, { estoqueVar: 100000 });
    const erros = [];
    for (let i = 0; i < 20; i++) {
      const c1 = await sessao("cliente");
      const c2 = await sessao("cliente");
      const painel = await sessao("admin");
      try {
        const [alvo, outro] = i % 2 ? [a, b] : [b, a];
        const ordemA =
          i % 3
            ? [
                [a, a.vars[0]],
                [b, b.vars[1]],
              ]
            : [
                [b, b.vars[1]],
                [a, a.vars[0]],
              ];
        const rs = await Promise.all([
          comprar(c1, ordemA, chaveNova()).then(
            () => "ok",
            (e) => e,
          ),
          comprar(
            c2,
            [
              [outro, outro.vars[1]],
              [alvo, alvo.vars[0]],
            ],
            chaveNova(),
          ).then(
            () => "ok",
            (e) => e,
          ),
          rpc(painel, alvo.id, null, { nome: `Rodada ${i}` }, [
            item(alvo.vars[0], "T0"),
            item(alvo.vars[1], "T1"),
          ]).then(
            () => "ok",
            (e) => e,
          ),
        ]);
        for (const r of rs) if (r !== "ok") erros.push(r.code || r.message);
      } finally {
        await fechar(c1, c2, painel);
      }
    }
    assert.deepEqual(erros, [], `nenhuma falha esperada: ${erros.join(",")}`);
  },
);

prova(
  "G2. MUTANTE com a ordem invertida (produto antes das variações): deadlock com a compra — a ordem global é necessária",
  async () => {
    const t = corpoDaMigration();
    const sem = t.replace(
      /PERFORM id FROM public\.product_variants\n\s+WHERE product_id = p_produto_id\n\s+ORDER BY id FOR NO KEY UPDATE;/,
      "",
    );
    assert.notEqual(sem, t);
    const invertido = sem.replace(
      "IF p_base_atualizado_em IS NOT NULL",
      "PERFORM pg_sleep(0.5);\n  PERFORM id FROM public.product_variants WHERE product_id = p_produto_id ORDER BY id FOR NO KEY UPDATE;\n  IF p_base_atualizado_em IS NOT NULL",
    );
    assert.notEqual(invertido, sem);
    const prod = await novoProduto(1);
    await comCorpo(invertido, async () => {
      const comprador = await sessao("cliente");
      const painel = await sessao("admin");
      try {
        const e1 = observar(
          rpc(painel, prod.id, null, { nome: "Ordem invertida" }, [
            item(prod.vars[0], "T0"),
          ]),
        );
        await dormir(150);
        const e2 = observar(
          comprar(comprador, [[prod, prod.vars[0]]], chaveNova()),
        );
        const rs = await Promise.all([e1.p, e2.p]);
        assert.ok(
          rs.some((r) => r.codigo === "40P01"),
          `a ordem invertida deveria dar deadlock: ${JSON.stringify(rs)}`,
        );
      } finally {
        await fechar(comprador, painel);
      }
    });
  },
);

prova(
  "H. MIGRATION: reaplicar 2x e CRLF, ACL e atributos, sobrecarga recusa, rollback e rollback repetido",
  async () => {
    const atributos = async () =>
      (
        await ADM.query(
          `SELECT l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proconfig,
                pg_get_function_result(p.oid) AS ret,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS srv,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
           FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure($1)`,
          [FN],
        )
      ).rows[0];
    const hash = async () =>
      (
        await ADM.query(
          "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
          [FN],
        )
      ).rows[0]?.h;
    const base = await atributos();
    assert.deepEqual(
      {
        l: base.lanname,
        d: base.prosecdef,
        v: base.provolatile,
        s: base.proisstrict,
        c: base.proconfig,
        r: base.ret,
      },
      {
        l: "plpgsql",
        d: true,
        v: "v",
        s: false,
        c: ["search_path=public"],
        r: "jsonb",
      },
    );
    assert.deepEqual(
      [base.anon, base.authenticated ?? base.auth, base.srv, base.publico],
      [false, true, true, false],
    );
    const h0 = await hash();
    await ADM.query(MIGRATION);
    await ADM.query(emCRLF(MIGRATION));
    assert.equal(await hash(), h0, "reaplicar (LF e CRLF) deixa o mesmo corpo");
    assert.deepEqual(await atributos(), base);

    // Sobrecarga: o pré-voo recusa sem escrever.
    await ADM.query(
      "CREATE FUNCTION public.salvar_produto_com_grade(integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
    );
    const sob = await falhaCom(ADM.query(MIGRATION));
    assert.match(sob?.message ?? "", /B1_BASELINE_DIVERGENT/);
    await ADM.query("DROP FUNCTION public.salvar_produto_com_grade(integer)");

    // Corpo diferente do conhecido: o rollback recusa e não apaga.
    await ADM.query(
      corpoDaMigration().replace("Acesso negado.", "Acesso negado!"),
    );
    const rec = await falhaCom(ADM.query(ROLLBACK));
    assert.match(rec?.message ?? "", /B1_BASELINE_DIVERGENT/);
    assert.ok(await hash(), "a função segue lá");
    const reaplica = await falhaCom(ADM.query(MIGRATION));
    assert.match(
      reaplica?.message ?? "",
      /B1_BASELINE_DIVERGENT/,
      "o pré-voo recusa reaplicar por cima de outro corpo",
    );
    await restaurarTudo();

    await ADM.query(ROLLBACK);
    assert.equal(await hash(), undefined, "o rollback apaga a função");
    await ADM.query(ROLLBACK); // repetido: no-op
    await ADM.query(MIGRATION);
    assert.equal(
      await hash(),
      h0,
      "reaplicar depois do rollback devolve o mesmo corpo",
    );
  },
);

prova(
  "I. CONSULTAS 82a/82b: rol exato, positivas no estado certo e cada desvio no item certo",
  async () => {
    const {
      ROL_FECHADO_POR_CONSULTA,
      estruturaDoRolFechado,
    } = require("../../scripts/publicacao/conferir-banco.cjs");
    const consulta = (n) =>
      fs.readFileSync(
        path.join(RAIZ, "scripts", "publicacao", "consultas", `${n}.sql`),
        "utf8",
      );
    const A = "82a-conferir-produto-com-grade-aplicado";
    const B = "82b-antes-produto-com-grade-ausente";
    const rodar = async (n) => (await ADM.query(consulta(n))).rows;
    const itensVerdes = (rows) => rows.filter((r) => r.ok).map((r) => r.item);
    const itensVermelhos = (rows) =>
      rows.filter((r) => !r.ok).map((r) => r.item);
    // DEPOIS: a 82a positiva com o rol exato; a 82b negativa SO no item da funcao.
    const a1 = await rodar(A);
    assert.equal(estruturaDoRolFechado(a1, ROL_FECHADO_POR_CONSULTA[A]), null);
    assert.deepEqual(itensVermelhos(a1), []);
    const b1 = await rodar(B);
    assert.equal(estruturaDoRolFechado(b1, ROL_FECHADO_POR_CONSULTA[B]), null);
    assert.deepEqual(itensVermelhos(b1), [
      "salvar_produto_com_grade: ainda NAO existe",
    ]);
    // Desvios na 82a: corpo trocado, ACL aberta ao anon, gatilho desligado.
    await ADM.query(
      corpoDaMigration().replace("Acesso negado.", "Acesso negado!"),
    );
    assert.deepEqual(itensVermelhos(await rodar(A)), [
      "salvar_produto_com_grade: uma so, com o corpo da 20261352000000 (md5)",
    ]);
    await restaurarTudo();
    await ADM.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
    assert.deepEqual(itensVermelhos(await rodar(A)), [
      "salvar_produto_com_grade: EXECUTE so para authenticated e service_role (PUBLIC e anon nao)",
    ]);
    await ADM.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM anon`);
    await ADM.query(
      "ALTER TABLE public.product_variants DISABLE TRIGGER sync_produto_ultima_atualizacao",
    );
    try {
      assert.equal(itensVermelhos(await rodar(A)).length, 1);
      assert.equal(itensVermelhos(await rodar(B)).length, 2);
    } finally {
      await ADM.query(
        "ALTER TABLE public.product_variants ENABLE TRIGGER sync_produto_ultima_atualizacao",
      );
    }
    // ANTES (depois do rollback): a 82b positiva; a 82a negativa em tudo que depende da funcao.
    await ADM.query(ROLLBACK);
    try {
      const b2 = await rodar(B);
      assert.equal(
        estruturaDoRolFechado(b2, ROL_FECHADO_POR_CONSULTA[B]),
        null,
      );
      assert.deepEqual(itensVermelhos(b2), []);
      const a2 = await rodar(A);
      assert.equal(
        estruturaDoRolFechado(a2, ROL_FECHADO_POR_CONSULTA[A]),
        null,
      );
      assert.equal(
        itensVerdes(a2).length,
        2,
        "so o controle e os gatilhos seguem verdes sem a funcao",
      );
    } finally {
      await ADM.query(MIGRATION);
    }
  },
);

async function main() {
  ADM = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await ADM.connect();
  await semearBase(ADM);
  await ADM.query(MIGRATION); // garante o estado "depois" mesmo num clone onde o rollback rodou
  let ok = 0;
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        ok++;
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push({ nome, erro: e });
        console.log(
          `  FALHOU  ${nome}\n      ${String(e.stack || e.message)
            .split("\n")
            .join("\n      ")}`,
        );
        await restaurarTudo().catch(() => {});
      }
    }
  } finally {
    await ADM.end().catch(() => {});
  }
  console.log(`\n${ok}/${PROVAS.length} provas passaram.`);
  if (falhas.length) falhar("FALHOU", `${falhas.length} prova(s) reprovadas.`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));

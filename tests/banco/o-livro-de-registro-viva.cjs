"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do proprio teste (as 17 tabelas, os mutantes); os unicos caminhos de arquivo sao os da
 * migration 20261510 e dos dois rollbacks dela dentro do repositorio. */
/**
 * PROVA VIVA da migration 20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql contra o Postgres EFEMERO com as migrations
 * aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O QUE A MIGRATION FAZ: antes de uma linha de 17 tabelas de dinheiro ser ALTERADA ou APAGADA, o banco guarda a versao antiga em
 * public.livro_de_registro (U: so as colunas que mudaram, com o valor antigo; D: a linha inteira), por 90 dias, com gatilhos POR
 * COMANDO que nunca derrubam a gravacao original.
 *
 * O QUE SE PROVA (cada parte numa transacao DESFEITA, salvo onde a trava de outra conexao exige o estado gravado):
 *   (A) acesso: anon, authenticated, service_role e um papel sem grant nenhum recebem 42501 nas 3 tabelas e nas 2 funcoes; RLS
 *       ligada, 0 politicas, fora do realtime; a chave nasce ligada com os tetos 200000 e 400;
 *   (B) o que se anota: diff SO da coluna (valor antigo), UPDATE sem mudanca = 0, UPDATE que so mexe no carimbo = 0, DELETE = linha
 *       inteira, INSERT = 0, quem/papel/transacao, UPDATE de 3 linhas = 3 anotacoes e de 10.000 linhas = 10.000, chave desligada = 0;
 *   (C) as 17 tabelas (UPDATE e DELETE de cada uma, com o titular dos 4 modos) + cascatas (produto -> variacoes, pedido -> itens e
 *       historico de pagamento) + create_marketplace_order_v24 anota a baixa de estoque e o cupom e NAO o pedido novo +
 *       confirmar_pagamento anota o payment_status antigo e o webhook repetido anota 0;
 *   (D) limpeza: 91 dias sai e 30 fica, lotes de 5000 (12.000 velhas), teto de linhas corta as mais antigas, disjuntor desliga a chave
 *       com motivo, falhas velhas saem, o job agendado;
 *   (E) aplicar 2x (LF e CRLF) nao muda nada; reaplicar nao religa a chave; sem COMMIT escondido; pre-voo recusa 6 estados divergentes
 *       sem escrever; com escrita aberta em coupons a migration falha 55P03 em menos de 1 s; rollback comum (2x) para de anotar e
 *       preserva as linhas; reaplicar volta; destrutivo sem confirmacao e antes do comum recusa;
 *   (F) nunca no caminho de quem compra: (f1) livro quebrado (CHECK (false) NOT VALID) e o UPDATE do cupom grava, falhas +1 com 23514;
 *       (f2) outra conexao com ACCESS EXCLUSIVE no livro e a create_marketplace_order_v24 (statement_timeout 3 s) nasce em menos de
 *       1 s, falhas com 55P03; (f3) a chave travada nao segura; (f4) livro e falhas quebrados e a gravacao segue com WARNING; (f5)
 *       custo de 2000 UPDATEs desligado x ligado (imprime microssegundos; reprova so acima de 0,5 ms por comando); (f6) ROLLBACK nao
 *       deixa anotacao;
 *   (M) 13 MUTANTES da migration morrem pelo motivo certo (sem-excecao, sem-lock-timeout, anota-insert, guarda-o-novo,
 *       delete-so-diferenca, sem-filtro-de-carimbo, ignora-a-chave, sem-titular, limpa-com-9-dias, limpa-invertido, sem-agenda,
 *       grant-select-authenticated, gatilho-por-linha).
 *
 * MUTANTE_LIVRO=<nome>: aplica (gravado, no clone) UM mutante antes de tudo; a execucao TEM de ficar vermelha. Nome desconhecido e' erro.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-livro-de-registro-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const NOME = "20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);

// As 17 tabelas e de onde vem o titular (o contrato da migration).
const ORIGEM = {
  marketplace_orders: "user_id",
  marketplace_order_items: "order_id",
  order_refunds: "order_id",
  marketplace_order_payment_history: "order_id",
  devolucoes: "user_id",
  devolucao_itens: "devolucao_id",
  produtos: "",
  product_variants: "",
  categorias: "",
  coupons: "",
  fornecedores: "",
  fin_lancamentos: "",
  fin_contas: "",
  fin_categorias: "",
  store_config: "",
  config_pagamento_cartao: "",
  politica_devolucao: "",
};
const TABELAS = Object.keys(ORIGEM);
const LIVROS = [
  "livro_de_registro",
  "livro_de_registro_chave",
  "livro_de_registro_falhas",
];
const U1 = "15100000-0000-4000-8000-000000000001"; // a cliente
const CLIENTE_V24 = "15100000-0000-4000-8000-000000000002";
const PRODUTO_V24 = "15100000-0000-4000-8000-0000000000a1";
const CUPOM_V24 = "L1510V24";
const PAPEL_APP = "prova_1510_app";
const PAPEL_NENHUM = "prova_1510_nenhum";

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1510_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Roda `fn` num SAVEPOINT sempre desfeito; o erro SOBE (a asserção de dentro reprova a prova). */
async function isolado(c, fn) {
  const sp = `iso_1510_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    return await fn();
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Uma transacao SEMPRE desfeita, em UTC. */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
/** Tenta `sql` como `papel`; devolve o codigo do erro ("ok" se passou). Sempre desfeito. */
async function como(c, papel, sql, params = [], uid = "") {
  let linhas = null;
  const e = await tentar(c, async () => {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
    await c.query(`SET LOCAL ROLE ${papel}`);
    linhas = (await c.query(sql, params)).rows;
  });
  return { codigo: e ? e.code : "ok", linhas, erro: e };
}
/** Roda `sql` como `papel` e MANTEM o efeito (o erro sobe). */
async function comoGravando(c, papel, sql, params = [], uid = "") {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
  await c.query(`SET LOCAL ROLE ${papel}`);
  try {
    return await c.query(sql, params);
  } finally {
    await c.query("RESET ROLE").catch(() => {});
    await c
      .query("SELECT set_config('app.rpc.user_id', '', true)")
      .catch(() => {});
  }
}
const um = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];
/** O maior id do livro agora: as anotacoes de um passo sao as de id maior. */
const marca = async (c) =>
  (
    await um(
      c,
      "SELECT coalesce(max(id), 0)::text AS m FROM public.livro_de_registro",
    )
  ).m;
async function desde(c, m, { tabela = null, linha = null } = {}) {
  return (
    await c.query(
      `SELECT id::text AS id, tabela, linha_id, titular::text AS titular, operacao, antes, quem::text AS quem, papel,
              transacao::text AS transacao
         FROM public.livro_de_registro
        WHERE id > $1::bigint AND ($2::text IS NULL OR tabela = $2) AND ($3::text IS NULL OR linha_id = $3)
        ORDER BY id`,
      [m, tabela, linha],
    )
  ).rows;
}
const linhaJson = async (c, tabela, id) =>
  (
    await um(
      c,
      `SELECT to_jsonb(t) AS j FROM public.${tabela} t WHERE t.id::text = $1`,
      [String(id)],
    )
  )?.j;
const falhasDe = async (c, tabela, sqlstate) =>
  Number(
    (
      await um(
        c,
        "SELECT coalesce(sum(vezes), 0)::int AS n FROM public.livro_de_registro_falhas WHERE tabela = $1 AND sqlstate = $2",
        [tabela, sqlstate],
      )
    ).n,
  );

async function usuario(c, id) {
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}') ON CONFLICT (id) DO NOTHING",
    [id, `l1510-${id.slice(-4)}@prova.invalid`],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa ficticia L1510', 'customer') ON CONFLICT (id) DO NOTHING",
    [id],
  );
}
async function configDaLoja(c) {
  await c.query(`INSERT INTO public.store_config
    (id, origin_cep, local_cep_range, free_shipping_min, local_delivery_fee,
     local_delivery_enabled, shipping_coverage, enable_coupons, pagamento_online,
     formas_pagamento_entrega, enabled_shipping_methods, store_address)
    VALUES (1,'38500-000','38500000-38505000',0,20,true,'national',true,true,
      ARRAY['pix','card','cash'],ARRAY['local-delivery','store-pickup'],'Rua Ficticia, 1')
    ON CONFLICT (id) DO UPDATE SET
      origin_cep=EXCLUDED.origin_cep, local_cep_range=EXCLUDED.local_cep_range,
      free_shipping_min=EXCLUDED.free_shipping_min, local_delivery_fee=EXCLUDED.local_delivery_fee,
      local_delivery_enabled=EXCLUDED.local_delivery_enabled,
      shipping_coverage=EXCLUDED.shipping_coverage, enable_coupons=EXCLUDED.enable_coupons,
      pagamento_online=EXCLUDED.pagamento_online, formas_pagamento_entrega=EXCLUDED.formas_pagamento_entrega,
      enabled_shipping_methods=EXCLUDED.enabled_shipping_methods, store_address=EXCLUDED.store_address`);
}
async function cupom(c, codigo, valor = 5) {
  return (
    await um(
      c,
      "INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit) VALUES ($1, 'fixed', $2, true, 0, 10) RETURNING id::text AS id",
      [codigo, valor],
    )
  ).id;
}

/** Uma linha em cada uma das 17 tabelas (as de linha unica ja existem ou sao gravadas aqui). Devolve os ids. */
async function semear17(c) {
  await usuario(c, U1);
  const id = async (sql, p = []) =>
    (await um(c, `${sql} RETURNING id::text AS id`, p)).id;
  const ids = {};
  ids.categorias = await id(
    "INSERT INTO public.categorias (nome, slug) VALUES ('Categoria L1510', 'categoria-l1510')",
  );
  ids.produtos = await id(
    "INSERT INTO public.produtos (nome, custo, preco_venda, estoque, ativo, frete_gratis) VALUES ('Produto L1510', 5, 10, 20, true, false)",
  );
  ids.product_variants = await id(
    "INSERT INTO public.product_variants (product_id, name, value, stock_increment, active) VALUES ($1, 'Cor', 'Azul', 3, true)",
    [ids.produtos],
  );
  ids.coupons = await cupom(c, "L1510CUPOM17");
  ids.fornecedores = await id(
    "INSERT INTO public.fornecedores (nome) VALUES ('Fornecedor L1510')",
  );
  ids.fin_contas = await id(
    "INSERT INTO public.fin_contas (nome, tipo) VALUES ('Conta L1510', 'banco')",
  );
  ids.fin_categorias = await id(
    "INSERT INTO public.fin_categorias (nome, natureza, grupo_dre) VALUES ('Categoria fin L1510', 'despesa', 'despesa_fixa')",
  );
  ids.fin_lancamentos = await id(
    `INSERT INTO public.fin_lancamentos (tipo, status, valor, conta_id, categoria_id, descricao, data_competencia)
     VALUES ('saida', 'previsto', 12, $1, $2, 'Lancamento L1510', current_date)`,
    [ids.fin_contas, ids.fin_categorias],
  );
  await configDaLoja(c);
  ids.store_config = "1";
  await c.query(
    "INSERT INTO public.config_pagamento_cartao (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  ids.config_pagamento_cartao = "1";
  await c.query(
    "INSERT INTO public.politica_devolucao (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  ids.politica_devolucao = "1";
  ids.marketplace_orders = await id(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_phone, customer_data, status, total, subtotal, shipping, payment_method, notes)
     VALUES ($1, 'Cliente L1510', '34999990000', '{}'::jsonb, 'delivered', 20, 20, 0, 'pix', 'nota antiga')`,
    [U1],
  );
  ids.marketplace_order_items = await id(
    "INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, 'Item L1510', 2, 10)",
    [ids.marketplace_orders, ids.produtos],
  );
  ids.order_refunds = await id(
    "INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status) VALUES ($1, 5, 'lojista', 'recusado')",
    [ids.marketplace_orders],
  );
  ids.marketplace_order_payment_history = await id(
    "INSERT INTO public.marketplace_order_payment_history (order_id, acao) VALUES ($1, 'recebido')",
    [ids.marketplace_orders],
  );
  ids.devolucoes = await id(
    `INSERT INTO public.devolucoes
       (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno,
        status, valor_itens, valor_frete_ida, prazo_ate, politica)
     VALUES ('DEV-L1510', $1, $2, 'arrependimento', 'desisti', 'reembolso', 'nacional', 'envio_proprio',
             'recebida', 10, 0, current_date + 7, '{}'::jsonb)`,
    [ids.marketplace_orders, U1],
  );
  ids.devolucao_itens = await id(
    "INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, quantidade, valor_unitario) VALUES ($1, $2, 1, 10)",
    [ids.devolucoes, ids.marketplace_order_items],
  );
  return ids;
}
// O UPDATE de cada tabela: a coluna que muda e a expressao nova.
const ALTERAR = {
  marketplace_orders: ["notes", "'nota nova L1510'"],
  marketplace_order_items: ["product_name", "'Item L1510 novo'"],
  order_refunds: ["tentativas", "tentativas + 1"],
  marketplace_order_payment_history: ["acao", "'desfeito'"],
  devolucoes: ["valor_frete_ida", "valor_frete_ida + 1"],
  devolucao_itens: ["valor_unitario", "valor_unitario - 1"],
  produtos: ["nome", "'Produto L1510 novo'"],
  product_variants: ["value", "'Verde'"],
  categorias: ["nome", "'Categoria L1510 nova'"],
  coupons: ["value", "value + 1"],
  fornecedores: ["nome", "'Fornecedor L1510 novo'"],
  fin_lancamentos: ["descricao", "'Lancamento L1510 novo'"],
  fin_contas: ["nome", "'Conta L1510 nova'"],
  fin_categorias: ["nome", "'Categoria fin L1510 nova'"],
  store_config: ["store_address", "'Rua Nova L1510, 2'"],
  config_pagamento_cartao: [
    "parcelas_max",
    "CASE WHEN parcelas_max = 12 THEN 11 ELSE parcelas_max + 1 END",
  ],
  politica_devolucao: [
    "prazo_troca_dias",
    "CASE WHEN prazo_troca_dias = 365 THEN 364 ELSE prazo_troca_dias + 1 END",
  ],
};
// Ordem de apagar que respeita as chaves estrangeiras (filhos antes dos pais).
const ORDEM_DE_APAGAR = [
  "devolucao_itens",
  "devolucoes",
  "marketplace_order_payment_history",
  "order_refunds",
  "marketplace_order_items",
  "marketplace_orders",
  "product_variants",
  "produtos",
  "categorias",
  "coupons",
  "fornecedores",
  "fin_lancamentos",
  "fin_contas",
  "fin_categorias",
  "store_config",
  "config_pagamento_cartao",
  "politica_devolucao",
];
const titularEsperado = (t) => (ORIGEM[t] === "" ? null : U1);

async function semearV24(c) {
  await usuario(c, CLIENTE_V24);
  await configDaLoja(c);
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
     VALUES ($1, 'Produto ficticio L1510', 100, 50, true, 40, false)`,
    [PRODUTO_V24],
  );
  await c.query(
    `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active, alcance)
     VALUES ($1, 'fixed', 10, 0, NULL, 0, now() + interval '1 day', true, 'vitrine')`,
    [CUPOM_V24],
  );
}
async function comprarV24(c) {
  const r = await comoGravando(
    c,
    "authenticated",
    `SELECT public.create_marketplace_order_v24(
       $1::jsonb, 110::numeric, 20::numeric, 'online'::text, NULL::uuid, $2::text,
       'Pessoa ficticia L1510', '5534000000000', NULL::text, NULL::jsonb,
       '38500-100', 'local-delivery', $3::uuid) AS id`,
    [
      JSON.stringify([
        { product_id: PRODUTO_V24, variant_id: null, quantity: 1 },
      ]),
      CUPOM_V24,
      randomUUID(),
    ],
    CLIENTE_V24,
  );
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// (A) acesso
// ---------------------------------------------------------------------------
async function acesso(c) {
  await c.query(`CREATE ROLE ${PAPEL_NENHUM} NOLOGIN`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${PAPEL_NENHUM}`);
  for (const papel of ["anon", "authenticated", "service_role", PAPEL_NENHUM]) {
    for (const t of LIVROS) {
      for (const [verbo, sql] of [
        ["SELECT", `SELECT count(*) FROM public.${t}`],
        ["DELETE", `DELETE FROM public.${t}`],
        [
          "UPDATE",
          `UPDATE public.${t} SET ${t === "livro_de_registro" ? "papel = papel" : t === "livro_de_registro_chave" ? "ligado = false" : "vezes = vezes"}`,
        ],
      ]) {
        const r = await como(c, papel, sql);
        assert.equal(
          r.codigo,
          "42501",
          `${papel} ${verbo} em ${t}: ${r.codigo}`,
        );
      }
    }
    const ins = await como(
      c,
      papel,
      "INSERT INTO public.livro_de_registro (tabela, linha_id, operacao, antes) VALUES ('coupons', 'x', 'U', '{}')",
    );
    assert.equal(ins.codigo, "42501", `${papel} INSERT no livro`);
    const lim = await como(
      c,
      papel,
      "SELECT public.livro_de_registro_limpar()",
    );
    assert.equal(lim.codigo, "42501", `${papel} executa limpar`);
    for (const f of [
      "livro_de_registro_anotar()",
      "livro_de_registro_limpar()",
    ])
      assert.equal(
        (
          await um(c, "SELECT has_function_privilege($1, $2, 'EXECUTE') AS x", [
            papel,
            `public.${f}`,
          ])
        ).x,
        false,
        `${papel} sem EXECUTE em ${f}`,
      );
  }
  for (const t of LIVROS) {
    const r = await um(
      c,
      `SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas,
              EXISTS (SELECT 1 FROM pg_publication_tables pt WHERE pt.schemaname = 'public' AND pt.tablename = c.relname) AS realtime
         FROM pg_class c WHERE c.oid = $1::regclass`,
      [`public.${t}`],
    );
    assert.deepEqual(r, { rls: true, politicas: 0, realtime: false }, t);
  }
  assert.deepEqual(
    await um(
      c,
      "SELECT ligado, teto_linhas, teto_banco_mb, motivo, (SELECT count(*)::int FROM public.livro_de_registro_chave) AS n FROM public.livro_de_registro_chave",
    ),
    {
      ligado: true,
      teto_linhas: 200000,
      teto_banco_mb: 400,
      motivo: null,
      n: 1,
    },
    "chave padrao",
  );
}

// ---------------------------------------------------------------------------
// (B)+(C)+(D)+(f1)+(f4): o comportamento (o MESMO que os mutantes tem de derrubar). Roda dentro da transacao do chamador.
// ---------------------------------------------------------------------------
async function comportamento(c) {
  // (a) a porta fechada: authenticated nao le o livro.
  const leitura = await como(
    c,
    "authenticated",
    "SELECT count(*) FROM public.livro_de_registro",
  );
  assert.equal(leitura.codigo, "42501", "authenticated le o livro");
  await c.query(
    "UPDATE public.livro_de_registro_chave SET ligado = true, teto_linhas = 200000, teto_banco_mb = 400 WHERE id = 1",
  );

  // (b) INSERT nao anota.
  let m = await marca(c);
  const cup = await cupom(c, "L1510B");
  assert.deepEqual(await desde(c, m), [], "INSERT nao anota");

  // (c) diff SO da coluna, com o valor ANTIGO.
  m = await marca(c);
  await c.query("UPDATE public.coupons SET value = 7 WHERE id = $1", [cup]);
  let a = await desde(c, m);
  assert.equal(a.length, 1, "UPDATE de 1 linha = 1 anotacao");
  assert.deepEqual(
    [a[0].tabela, a[0].linha_id, a[0].operacao, a[0].antes],
    ["coupons", cup, "U", { value: 5 }],
    "antes guarda o valor ANTIGO so da coluna que mudou",
  );

  // (d) sem mudanca = 0.
  m = await marca(c);
  await c.query("UPDATE public.coupons SET value = value WHERE id = $1", [cup]);
  assert.deepEqual(await desde(c, m), [], "UPDATE sem mudanca nao anota");

  // (e) so o carimbo = 0 (updated_at mudado de proposito; e produtos com o carimbo do gatilho dele).
  const conta = (
    await um(
      c,
      "INSERT INTO public.fin_contas (nome, tipo) VALUES ('Conta carimbo L1510', 'banco') RETURNING id::text AS id",
    )
  ).id;
  m = await marca(c);
  await c.query(
    "UPDATE public.fin_contas SET updated_at = updated_at + interval '1 minute' WHERE id = $1",
    [conta],
  );
  assert.deepEqual(
    await desde(c, m),
    [],
    "UPDATE que so muda o carimbo (updated_at) nao anota",
  );
  await c.query(
    "UPDATE public.fin_contas SET nome = 'Conta carimbo L1510 b', updated_at = updated_at + interval '2 minutes' WHERE id = $1",
    [conta],
  );
  a = await desde(c, m);
  assert.equal(a.length, 1, "nome + carimbo anota");
  assert.deepEqual(
    Object.keys(a[0].antes).sort(),
    ["nome", "updated_at"],
    "com mudanca de verdade, o carimbo antigo vai junto",
  );

  // (f) UPDATE de 3 linhas = 3 anotacoes (gatilho por comando, nao por linha).
  const tres = [];
  for (const k of [1, 2, 3]) tres.push(await cupom(c, `L1510TRES${k}`));
  m = await marca(c);
  await c.query(
    "UPDATE public.coupons SET value = 8 WHERE code LIKE 'L1510TRES%'",
  );
  a = await desde(c, m);
  assert.equal(
    a.length,
    3,
    `UPDATE de 3 linhas = 3 anotacoes (vieram ${a.length})`,
  );
  assert.deepEqual(a.map((x) => x.linha_id).sort(), [...tres].sort());

  // (g) DELETE = a linha inteira.
  const inteira = await linhaJson(c, "coupons", cup);
  m = await marca(c);
  await c.query("DELETE FROM public.coupons WHERE id = $1", [cup]);
  a = await desde(c, m);
  assert.equal(a.length, 1);
  assert.equal(a[0].operacao, "D");
  assert.deepEqual(a[0].antes, inteira, "DELETE guarda a linha inteira");

  // (h) chave desligada = 0; religada volta.
  await c.query(
    "UPDATE public.livro_de_registro_chave SET ligado = false, motivo = 'prova' WHERE id = 1",
  );
  m = await marca(c);
  await c.query("UPDATE public.coupons SET value = 9 WHERE id = $1", [tres[0]]);
  assert.deepEqual(await desde(c, m), [], "chave desligada nao anota");
  await c.query(
    "UPDATE public.livro_de_registro_chave SET ligado = true, motivo = NULL WHERE id = 1",
  );
  await c.query("UPDATE public.coupons SET value = 10 WHERE id = $1", [
    tres[0],
  ]);
  assert.equal((await desde(c, m)).length, 1, "religada, volta a anotar");

  // (i) quem, papel e transacao.
  await isolado(c, async () => {
    await c.query(`CREATE ROLE ${PAPEL_APP} NOLOGIN BYPASSRLS`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${PAPEL_APP}`);
    await c.query(`GRANT SELECT, UPDATE ON public.coupons TO ${PAPEL_APP}`);
    const xid = (await um(c, "SELECT pg_current_xact_id()::text AS x")).x;
    m = await marca(c);
    await comoGravando(
      c,
      PAPEL_APP,
      "UPDATE public.coupons SET value = 11 WHERE id = $1",
      [tres[1]],
      U1,
    );
    a = await desde(c, m);
    assert.deepEqual(
      a.map((x) => [x.quem, x.papel, x.transacao]),
      [[U1, PAPEL_APP, xid]],
      "quem = auth.uid(), papel = o SET ROLE, transacao = a do comando",
    );
    m = await marca(c);
    await c.query("UPDATE public.coupons SET value = 12 WHERE id = $1", [
      tres[1],
    ]);
    const sessao = (await um(c, "SELECT session_user::text AS s")).s;
    assert.deepEqual(
      (await desde(c, m)).map((x) => [x.quem, x.papel]),
      [[null, sessao]],
      "sem SET ROLE: papel = usuario da sessao, quem vazio",
    );
  });

  // (j) as 17 tabelas: UPDATE e DELETE de cada uma, com o titular.
  await isolado(c, async () => {
    const ids = await semear17(c);
    assert.deepEqual(Object.keys(ids).sort(), [...TABELAS].sort());
    for (const t of TABELAS) {
      const [col, expr] = ALTERAR[t];
      const antes = await linhaJson(c, t, ids[t]);
      m = await marca(c);
      const r = await c.query(
        `UPDATE public.${t} SET ${col} = ${expr} WHERE id::text = $1`,
        [ids[t]],
      );
      assert.equal(r.rowCount, 1, `${t}: UPDATE pegou a linha`);
      const depois = await linhaJson(c, t, ids[t]);
      a = await desde(c, m, { tabela: t, linha: ids[t] });
      assert.equal(a.length, 1, `${t}: UPDATE = 1 anotacao`);
      assert.equal(a[0].operacao, "U");
      assert.deepEqual(
        a[0].antes[col],
        antes[col],
        `${t}: o valor antigo de ${col}`,
      );
      for (const k of Object.keys(a[0].antes))
        assert.notDeepEqual(
          a[0].antes[k],
          depois[k],
          `${t}: ${k} nao mudou e entrou no antes`,
        );
      assert.equal(
        a[0].titular,
        titularEsperado(t),
        `${t}: titular (${ORIGEM[t] || "sem"})`,
      );
    }
    for (const t of ORDEM_DE_APAGAR) {
      const inteira = await linhaJson(c, t, ids[t]);
      m = await marca(c);
      const r = await c.query(`DELETE FROM public.${t} WHERE id::text = $1`, [
        ids[t],
      ]);
      assert.equal(r.rowCount, 1, `${t}: DELETE pegou a linha`);
      a = await desde(c, m, { tabela: t, linha: ids[t] });
      assert.equal(a.length, 1, `${t}: DELETE = 1 anotacao`);
      assert.equal(a[0].operacao, "D");
      assert.deepEqual(
        a[0].antes,
        inteira,
        `${t}: DELETE guarda a linha inteira`,
      );
      assert.equal(a[0].titular, titularEsperado(t), `${t}: titular do DELETE`);
    }
  });

  // (k) cascatas: produto -> variacoes; pedido -> itens e historico de pagamento.
  await isolado(c, async () => {
    await usuario(c, U1);
    const prod = (
      await um(
        c,
        "INSERT INTO public.produtos (nome, custo, preco_venda, estoque, ativo, frete_gratis) VALUES ('Produto cascata L1510', 5, 10, 0, true, false) RETURNING id::text AS id",
      )
    ).id;
    for (const v of ["P", "M"])
      await c.query(
        "INSERT INTO public.product_variants (product_id, name, value, stock_increment, active) VALUES ($1, 'Tamanho', $2, 1, true)",
        [prod, v],
      );
    const ped = (
      await um(
        c,
        `INSERT INTO public.marketplace_orders (user_id, customer_name, customer_data, status, total, subtotal, shipping, payment_method)
         VALUES ($1, 'Cliente cascata L1510', '{}'::jsonb, 'delivered', 10, 10, 0, 'pix') RETURNING id::text AS id`,
        [U1],
      )
    ).id;
    await c.query(
      "INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, 'Item cascata', 1, 10)",
      [ped, prod],
    );
    await c.query(
      "INSERT INTO public.marketplace_order_payment_history (order_id, acao) VALUES ($1, 'recebido')",
      [ped],
    );
    m = await marca(c);
    await c.query("DELETE FROM public.marketplace_orders WHERE id = $1", [ped]);
    a = await desde(c, m);
    const contagem = (t, op) =>
      a.filter((x) => x.tabela === t && x.operacao === op).length;
    assert.deepEqual(
      [
        contagem("marketplace_orders", "D"),
        contagem("marketplace_order_items", "D"),
        contagem("marketplace_order_payment_history", "D"),
      ],
      [1, 1, 1],
      "pedido apagado leva itens e historico, e os tres anotam",
    );
    assert.equal(
      a.find((x) => x.tabela === "marketplace_orders").titular,
      U1,
      "o pedido apagado tem titular",
    );
    m = await marca(c);
    await c.query("DELETE FROM public.produtos WHERE id = $1", [prod]);
    a = await desde(c, m);
    assert.deepEqual(
      [
        a.filter((x) => x.tabela === "produtos" && x.operacao === "D").length,
        a.filter((x) => x.tabela === "product_variants" && x.operacao === "D")
          .length,
      ],
      [1, 2],
      "produto apagado leva as duas variacoes, e as tres anotam",
    );
  });

  // (l) a compra: v24 anota a baixa de estoque e o cupom, e NAO o pedido novo.
  await isolado(c, async () => {
    await semearV24(c);
    m = await marca(c);
    const pedido = await comprarV24(c);
    assert.ok(pedido, "a v24 criou o pedido");
    a = await desde(c, m);
    const tabelas = [...new Set(a.map((x) => x.tabela))];
    assert.ok(
      !tabelas.includes("marketplace_orders"),
      `o pedido novo nao anota (${tabelas})`,
    );
    assert.ok(
      !tabelas.includes("marketplace_order_items"),
      "os itens novos nao anotam",
    );
    const estoque = a.find(
      (x) => x.tabela === "produtos" && x.linha_id === PRODUTO_V24,
    );
    assert.equal(
      estoque?.antes?.estoque,
      50,
      "a baixa de estoque anota o estoque antigo",
    );
    const uso = a.find((x) => x.tabela === "coupons" && x.operacao === "U");
    assert.equal(
      uso?.antes?.usage_count,
      0,
      "o uso do cupom anota o contador antigo",
    );
    assert.equal(estoque.quem, CLIENTE_V24, "quem comprou");
    assert.equal(estoque.papel, "authenticated");
  });

  // (m) o pagamento: confirmar_pagamento anota o payment_status antigo; o webhook repetido anota 0.
  await isolado(c, async () => {
    await usuario(c, U1);
    const prod = (
      await um(
        c,
        "INSERT INTO public.produtos (nome, custo, preco_venda, estoque, ativo, frete_gratis) VALUES ('Produto pago L1510', 10, 50, 5, true, false) RETURNING id::text AS id",
      )
    ).id;
    const ped = (
      await um(
        c,
        `INSERT INTO public.marketplace_orders
           (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status,
            expires_at, metodo_online, gateway_payment_id)
         VALUES ($1, 'Cliente pago L1510', '{}'::jsonb, 50, 50, 'pending', 'online', 'online', 'aguardando',
                 now() + interval '30 minutes', 'pix', 'L1510VAGA') RETURNING id::text AS id`,
        [U1],
      )
    ).id;
    await c.query(
      "INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, 'Produto pago L1510', 1, 50)",
      [ped, prod],
    );
    m = await marca(c);
    const r1 = await um(
      c,
      "SELECT public.confirmar_pagamento($1::uuid, 'L1510VAGA', 'pago') AS r",
      [ped],
    );
    assert.equal(r1.r, "pago", "confirmar_pagamento confirmou");
    a = await desde(c, m, { tabela: "marketplace_orders", linha: ped });
    assert.equal(a.length, 1, "uma anotacao do pedido pago");
    assert.equal(
      a[0].antes.payment_status,
      "aguardando",
      "o payment_status antigo",
    );
    assert.equal(a[0].titular, U1);
    m = await marca(c);
    const r2 = await um(
      c,
      "SELECT public.confirmar_pagamento($1::uuid, 'L1510VAGA', 'pago') AS r",
      [ped],
    );
    assert.equal(r2.r, "ja_pago", "o webhook repetido cai na idempotencia");
    assert.deepEqual(
      await desde(c, m),
      [],
      "o webhook repetido nao anota nada",
    );
  });

  // (n) 10.000 linhas num comando = 10.000 anotacoes, em menos de 10 s. Os UPDATEs pequenos de cima ja firmaram o plano generico do
  // gatilho (estimativa de 1 linha), como numa conexao de producao: casar antigo/novo por JOIN virava laco aninhado (n x n, mais de
  // 30 s aqui). O SET LOCAL volta no ROLLBACK TO SAVEPOINT do isolado.
  await isolado(c, async () => {
    await c.query(
      "INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit) SELECT 'L1510M' || g, 'fixed', 1, true, 0, 10 FROM generate_series(1, 10000) g",
    );
    m = await marca(c);
    await c.query("SET LOCAL statement_timeout = '10s'");
    let r = null;
    try {
      r = await c.query(
        "UPDATE public.coupons SET value = 2 WHERE code LIKE 'L1510M%'",
      );
    } catch (e) {
      assert.fail(
        `10.000 linhas num comando em menos de 10 s (veio ${e.code}: ${e.message})`,
      );
    }
    assert.equal(r.rowCount, 10000);
    const n = await um(
      c,
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE antes = '{"value": 1}'::jsonb AND operacao = 'U')::int AS certas,
              count(DISTINCT transacao)::int AS transacoes
         FROM public.livro_de_registro WHERE id > $1::bigint`,
      [m],
    );
    assert.deepEqual(
      n,
      { n: 10000, certas: 10000, transacoes: 1 },
      "10.000 linhas = 10.000 anotacoes",
    );
  });

  // (f1) livro quebrado: o UPDATE do cupom GRAVA e a falha e' contada (23514).
  await isolado(c, async () => {
    const quebrado = await cupom(c, "L1510F1");
    await c.query(
      "ALTER TABLE public.livro_de_registro ADD CONSTRAINT livro_l1510_quebrado CHECK (false) NOT VALID",
    );
    const antes = await falhasDe(c, "coupons", "23514");
    // Primeiro num SAVEPOINT: sem o EXCEPTION da funcao, o erro do livro sobe e a assercao diz o codigo.
    const e = await tentar(c, () =>
      c.query("UPDATE public.coupons SET value = 3 WHERE id = $1", [quebrado]),
    );
    assert.equal(
      e,
      null,
      `o UPDATE do cupom grava com o livro quebrado (veio ${e?.code}: ${e?.message})`,
    );
    const r = await c.query(
      "UPDATE public.coupons SET value = 4 WHERE id = $1",
      [quebrado],
    );
    assert.equal(r.rowCount, 1, "o UPDATE do cupom grava com o livro quebrado");
    assert.equal(
      Number(
        (
          await um(
            c,
            "SELECT value::int AS v FROM public.coupons WHERE id = $1",
            [quebrado],
          )
        ).v,
      ),
      4,
    );
    assert.equal(
      await falhasDe(c, "coupons", "23514"),
      antes + 1,
      "falhas +1 com 23514",
    );
  });

  // (f4) livro E falhas quebrados: a gravacao segue, com WARNING.
  await isolado(c, async () => {
    const quebrado = await cupom(c, "L1510F4");
    await c.query(
      "ALTER TABLE public.livro_de_registro ADD CONSTRAINT livro_l1510_quebrado CHECK (false) NOT VALID",
    );
    await c.query(
      "ALTER TABLE public.livro_de_registro_falhas ADD CONSTRAINT falhas_l1510_quebradas CHECK (false) NOT VALID",
    );
    const avisos = [];
    const ouvir = (msg) => avisos.push(msg);
    c.on("notice", ouvir);
    try {
      const r = await c.query(
        "UPDATE public.coupons SET value = 6 WHERE id = $1",
        [quebrado],
      );
      assert.equal(r.rowCount, 1, "livro e falhas quebrados: o UPDATE grava");
    } finally {
      c.removeListener("notice", ouvir);
    }
    assert.ok(
      avisos.some(
        (x) =>
          x.severity === "WARNING" &&
          /livro_de_registro: a anotacao de coupons falhou \(23514\)/.test(
            x.message,
          ),
      ),
      `WARNING com o codigo (avisos: ${avisos.map((x) => x.message).join(" | ")})`,
    );
    assert.ok(
      !avisos.some((x) => /L1510F4/.test(x.message)),
      "o aviso nao carrega valor da linha",
    );
  });

  // (D) limpeza, teto, disjuntor, falhas velhas e o job.
  await isolado(c, async () => {
    await c.query("DELETE FROM public.livro_de_registro");
    await c.query(
      `INSERT INTO public.livro_de_registro (tabela, linha_id, operacao, antes, quando)
       VALUES ('coupons', 'velha', 'U', '{}', clock_timestamp() - interval '91 days'),
              ('coupons', 'recente', 'U', '{}', clock_timestamp() - interval '30 days')`,
    );
    const r = (await um(c, "SELECT public.livro_de_registro_limpar() AS r")).r;
    const ficou = (
      await c.query("SELECT linha_id FROM public.livro_de_registro ORDER BY id")
    ).rows.map((x) => x.linha_id);
    assert.ok(!ficou.includes("velha"), "a limpeza apaga o de 91 dias");
    assert.ok(ficou.includes("recente"), "a limpeza guarda o de 30 dias");
    assert.equal(r.velhas, 1);
  });
  await isolado(c, async () => {
    await c.query("DELETE FROM public.livro_de_registro");
    await c.query(
      `INSERT INTO public.livro_de_registro (tabela, linha_id, operacao, antes, quando)
       SELECT 'coupons', 'lote' || g, 'U', '{}', clock_timestamp() - interval '100 days' FROM generate_series(1, 12000) g`,
    );
    const r = (await um(c, "SELECT public.livro_de_registro_limpar() AS r")).r;
    assert.equal(r.velhas, 12000, "12.000 velhas em lotes de 5000");
    assert.equal(
      Number(
        (await um(c, "SELECT count(*)::int AS n FROM public.livro_de_registro"))
          .n,
      ),
      0,
    );
  });
  await isolado(c, async () => {
    await c.query("DELETE FROM public.livro_de_registro");
    await c.query(
      "UPDATE public.livro_de_registro_chave SET teto_linhas = 2 WHERE id = 1",
    );
    await c.query(
      `INSERT INTO public.livro_de_registro (tabela, linha_id, operacao, antes)
       SELECT 'coupons', 'teto' || g, 'U', '{}' FROM generate_series(1, 5) g ORDER BY g`,
    );
    const r = (await um(c, "SELECT public.livro_de_registro_limpar() AS r")).r;
    assert.equal(r.cortadas, 3, "teto de 2 corta 3");
    assert.deepEqual(
      (
        await c.query(
          "SELECT linha_id FROM public.livro_de_registro ORDER BY id",
        )
      ).rows.map((x) => x.linha_id),
      ["teto4", "teto5"],
      "o teto corta as MAIS ANTIGAS",
    );
  });
  await isolado(c, async () => {
    await c.query(
      "UPDATE public.livro_de_registro_chave SET teto_banco_mb = 1 WHERE id = 1",
    );
    const r = (await um(c, "SELECT public.livro_de_registro_limpar() AS r")).r;
    assert.equal(r.desligou, true, "o disjuntor desligou");
    const ch = await um(
      c,
      "SELECT ligado, motivo FROM public.livro_de_registro_chave WHERE id = 1",
    );
    assert.equal(ch.ligado, false);
    assert.match(
      ch.motivo,
      /^disjuntor: o banco tem \d+ MB, acima do teto de 1 MB$/,
    );
    assert.equal(
      (await um(c, "SELECT public.livro_de_registro_limpar() AS r")).r.desligou,
      false,
      "ja desligado",
    );
  });
  await isolado(c, async () => {
    await c.query("DELETE FROM public.livro_de_registro_falhas");
    await c.query(
      `INSERT INTO public.livro_de_registro_falhas (dia, tabela, sqlstate, vezes, ultima)
       VALUES (current_date - 91, 'coupons', '55P03', 1, now()), (current_date - 10, 'coupons', '55P03', 2, now())`,
    );
    const r = (await um(c, "SELECT public.livro_de_registro_limpar() AS r")).r;
    assert.equal(r.falhas, 1);
    assert.deepEqual(
      (
        await c.query(
          "SELECT (current_date - dia) AS d FROM public.livro_de_registro_falhas",
        )
      ).rows,
      [{ d: 10 }],
      "falhas de mais de 90 dias saem",
    );
  });
  assert.deepEqual(
    (
      await c.query(
        "SELECT schedule, command FROM cron.job WHERE jobname = 'limpar-livro-de-registro'",
      )
    ).rows,
    [
      {
        schedule: "17 6 * * *",
        command:
          "SET statement_timeout = 60000; SELECT public.livro_de_registro_limpar()",
      },
    ],
    "job agendado",
  );
}

// ---------------------------------------------------------------------------
// (F) nunca no caminho de quem compra: as travas de outra conexao, o custo e o ROLLBACK.
// ---------------------------------------------------------------------------
async function comOutra(url, fn) {
  const outra = new Client({ connectionString: url });
  await outra.connect();
  try {
    return await fn(outra);
  } finally {
    await outra.query("ROLLBACK").catch(() => {});
    await outra.end().catch(() => {});
  }
}
/** (f2) livro travado por outra conexao: a v24 nasce em menos de 1 s e a falha 55P03 fica contada. */
async function travaNoLivro(c, url) {
  await comOutra(url, async (outra) => {
    await outra.query("BEGIN");
    await outra.query(
      "LOCK TABLE public.livro_de_registro IN ACCESS EXCLUSIVE MODE",
    );
    await desfeita(c, async () => {
      await semearV24(c);
      await c.query("SET LOCAL statement_timeout = '3s'");
      const antes = await falhasDe(c, "produtos", "55P03");
      const sp = "sp_1510_v24_travada";
      await c.query(`SAVEPOINT ${sp}`);
      const t0 = Date.now();
      let id = null;
      let e = null;
      try {
        id = await comprarV24(c);
      } catch (err) {
        e = err;
        await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      }
      const ms = Date.now() - t0;
      assert.equal(
        e,
        null,
        `a v24 nasce com o livro travado (veio ${e?.code}: ${e?.message})`,
      );
      assert.ok(id, "a v24 nasce com o livro travado e devolve o pedido");
      assert.ok(
        ms < 1000,
        `a v24 nasce em menos de 1 s com o livro travado (levou ${ms} ms)`,
      );
      assert.ok(
        (await falhasDe(c, "produtos", "55P03")) > antes,
        "a falha 55P03 foi contada",
      );
      console.log(`    v24 com o livro travado: ${ms} ms`);
    });
  });
}
async function nuncaNoCaminho(c, url) {
  await travaNoLivro(c, url);

  // (f3) a chave travada (ACCESS EXCLUSIVE por outra conexao) nao segura a gravacao.
  await comOutra(url, async (outra) => {
    await outra.query("BEGIN");
    await outra.query(
      "LOCK TABLE public.livro_de_registro_chave IN ACCESS EXCLUSIVE MODE",
    );
    await desfeita(c, async () => {
      const id = await cupom(c, "L1510F3");
      const antes = await falhasDe(c, "coupons", "55P03");
      const t0 = Date.now();
      const r = await c.query(
        "UPDATE public.coupons SET value = 9 WHERE id = $1",
        [id],
      );
      const ms = Date.now() - t0;
      assert.equal(r.rowCount, 1, "a chave travada nao segura o UPDATE");
      assert.ok(ms < 1000, `a chave travada segurou ${ms} ms`);
      assert.equal(
        await falhasDe(c, "coupons", "55P03"),
        antes + 1,
        "a chave travada vira 55P03 contado",
      );
    });
  });

  // (f6) ROLLBACK nao deixa anotacao.
  await c.query("BEGIN");
  let id;
  let m;
  try {
    id = await cupom(c, "L1510F6");
    m = await marca(c);
    await c.query("UPDATE public.coupons SET value = 9 WHERE id = $1", [id]);
    assert.equal(
      (await desde(c, m)).length,
      1,
      "dentro da transacao a anotacao existe",
    );
  } finally {
    await c.query("ROLLBACK");
  }
  assert.deepEqual(
    await desde(c, m, { linha: id }),
    [],
    "ROLLBACK nao deixa anotacao",
  );

  // (f5) custo: 2000 UPDATEs (cada um na sua transacao), desligado x ligado.
  const custo = await cupom(c, "L1510CUSTO");
  const rodar = async () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 2000; i++)
      await c.query(
        "UPDATE public.coupons SET value = value + 1 WHERE id = $1",
        [custo],
      );
    return Number(process.hrtime.bigint() - t0) / 1000; // microssegundos
  };
  try {
    await rodar(); // aquecimento
    await c.query(
      "UPDATE public.livro_de_registro_chave SET ligado = false WHERE id = 1",
    );
    const desligado = await rodar();
    await c.query(
      "UPDATE public.livro_de_registro_chave SET ligado = true WHERE id = 1",
    );
    const ligado = await rodar();
    const porComando = (ligado - desligado) / 2000;
    console.log(
      `    custo: desligado ${(desligado / 2000).toFixed(1)} us/UPDATE, ligado ${(ligado / 2000).toFixed(1)} us/UPDATE, diferenca ${porComando.toFixed(1)} us`,
    );
    assert.ok(
      porComando <= 500,
      `o livro custou ${porComando.toFixed(1)} us por UPDATE (teto 500)`,
    );
  } finally {
    await c.query(
      "UPDATE public.livro_de_registro_chave SET ligado = true WHERE id = 1",
    );
    await c.query("DELETE FROM public.coupons WHERE id = $1", [custo]);
    await c.query("DELETE FROM public.livro_de_registro WHERE linha_id = $1", [
      custo,
    ]);
  }
}

// ---------------------------------------------------------------------------
// (E) aplicar, pre-voo, trava da migration, rollbacks
// ---------------------------------------------------------------------------
async function foto(c) {
  return (
    await um(
      c,
      `SELECT jsonb_build_object(
         'tabelas', (SELECT jsonb_agg(jsonb_build_array(c.relname, c.relacl::text, c.relrowsecurity,
             (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(a.attacl::text, '-'), ',' ORDER BY a.attnum)
                FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid),
             (SELECT string_agg(pg_get_indexdef(i.indexrelid), ' | ' ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid = c.oid),
             (SELECT string_agg(pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid))
             ORDER BY c.relname)
           FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'livro\\_de\\_registro%'),
         'gatilhos', (SELECT jsonb_agg(jsonb_build_array(t.tgrelid::regclass::text, t.tgname, t.tgtype, t.tgenabled, t.tgfoid::int,
             t.tgoldtable, t.tgnewtable, encode(t.tgargs, 'hex')) ORDER BY t.tgrelid::regclass::text, t.tgname)
           FROM pg_trigger t WHERE t.tgname LIKE 'tr\\_livro\\_%'),
         'funcoes', (SELECT jsonb_agg(jsonb_build_array(p.proname, p.oid::int, md5(replace(p.prosrc, chr(13), '')), p.proacl::text,
             p.proconfig::text, p.prosecdef) ORDER BY p.proname)
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'livro\\_de\\_registro%'),
         'job', (SELECT jsonb_agg(jsonb_build_array(j.jobid, j.schedule, j.command)) FROM cron.job j WHERE j.jobname = 'limpar-livro-de-registro'),
         'chave', (SELECT jsonb_agg(to_jsonb(k)) FROM public.livro_de_registro_chave k),
         'livro', (SELECT jsonb_build_array(count(*), md5(coalesce(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))) FROM public.livro_de_registro l),
         'falhas', (SELECT count(*) FROM public.livro_de_registro_falhas)) AS f`,
    )
  ).f;
}
const gatilhosVivos = async (c) =>
  Number(
    (
      await um(
        c,
        "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('tr_livro_alteracao', 'tr_livro_exclusao') AND NOT tgisinternal",
      )
    ).n,
  );
const agendado = async (c) =>
  Number(
    (
      await um(
        c,
        "SELECT count(*)::int AS n FROM cron.job WHERE jobname = 'limpar-livro-de-registro'",
      )
    ).n,
  );

async function aplicacao(c, url) {
  // Sem COMMIT escondido: desfazer e aplicar numa transacao desfeita nao deixa nada.
  const base = await foto(c);
  await desfeita(c, async () => {
    await c.query(ROLLBACK);
    assert.equal(await gatilhosVivos(c), 0);
  });
  assert.deepEqual(
    await foto(c),
    base,
    "o rollback desfeito nao deixou nada: sem COMMIT escondido",
  );

  // Aplicar 2x (LF e CRLF) nao muda nada; reaplicar nao religa a chave.
  await desfeita(c, async () => {
    const antes = await foto(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    assert.deepEqual(
      await foto(c),
      antes,
      "reaplicar (LF e CRLF) nao muda nada",
    );
    await c.query(
      "UPDATE public.livro_de_registro_chave SET ligado = false, motivo = 'desligado a mao' WHERE id = 1",
    );
    await c.query(MIGRATION);
    assert.deepEqual(
      await um(c, "SELECT ligado, motivo FROM public.livro_de_registro_chave"),
      { ligado: false, motivo: "desligado a mao" },
      "reaplicar nao religa a chave",
    );
  });

  // Pre-voo recusa estado divergente sem escrever.
  let recusas = 0;
  await desfeita(c, async () => {
    for (const [nome, sabotagem] of [
      [
        "tabela ausente",
        "ALTER TABLE public.fornecedores RENAME TO fornecedores_l1510",
      ],
      [
        "chave primaria de duas colunas",
        "ALTER TABLE public.politica_devolucao DROP CONSTRAINT politica_devolucao_pkey; ALTER TABLE public.politica_devolucao ADD PRIMARY KEY (id, prazo_troca_dias)",
      ],
      [
        "sem a coluna do titular",
        "ALTER TABLE public.devolucao_itens RENAME COLUMN devolucao_id TO devolucao_l1510",
      ],
      [
        "sem cron.schedule",
        "ALTER FUNCTION cron.schedule(text, text, text) RENAME TO schedule_l1510",
      ],
      ["sem auth.uid()", "ALTER FUNCTION auth.uid() RENAME TO uid_l1510"],
      [
        "livro com outra forma",
        "ALTER TABLE public.livro_de_registro ADD COLUMN extra integer",
      ],
    ]) {
      const e = await tentar(c, async () => {
        await c.query(sabotagem);
        const antes = await foto(c);
        const r = await tentar(c, () => c.query(MIGRATION));
        assert.match(
          r?.message ?? "(aplicou)",
          /B1_BASELINE_DIVERGENT/,
          `pre-voo deveria recusar: ${nome}`,
        );
        assert.deepEqual(
          await foto(c),
          antes,
          `a recusa escreveu algo: ${nome}`,
        );
      });
      assert.equal(e, null, e?.message);
      recusas++;
    }
  });

  // Escrita aberta em coupons: a migration falha NA HORA (NOWAIT), sem fila.
  await comOutra(url, async (outra) => {
    await outra.query("BEGIN");
    await outra.query("LOCK TABLE public.coupons IN ROW EXCLUSIVE MODE");
    const antes = await foto(c);
    await c.query("BEGIN");
    const t0 = Date.now();
    let e = null;
    try {
      await c.query(MIGRATION);
    } catch (err) {
      e = err;
    } finally {
      await c.query("ROLLBACK");
    }
    const ms = Date.now() - t0;
    assert.equal(
      e?.code,
      "55P03",
      `escrita aberta em coupons: ${e?.code} ${e?.message}`,
    );
    assert.ok(ms < 1000, `desistiu em ${ms} ms (NOWAIT)`);
    await outra.query("ROLLBACK");
    assert.deepEqual(await foto(c), antes, "a desistencia nao escreveu nada");
  });

  // Rollback comum (2x) para de anotar e preserva; reaplicar volta.
  await desfeita(c, async () => {
    const id = await cupom(c, "L1510RB");
    await c.query("UPDATE public.coupons SET value = 6 WHERE id = $1", [id]);
    const linhas = (await foto(c)).livro;
    await c.query(ROLLBACK);
    await c.query(ROLLBACK);
    assert.equal(await gatilhosVivos(c), 0, "o rollback tira os 34 gatilhos");
    assert.equal(await agendado(c), 0, "o rollback desagenda o job");
    assert.equal(
      (
        await um(
          c,
          "SELECT to_regprocedure('public.livro_de_registro_anotar()') IS NULL AS x",
        )
      ).x,
      true,
    );
    const m = await marca(c);
    await c.query("UPDATE public.coupons SET value = 7 WHERE id = $1", [id]);
    assert.deepEqual(await desde(c, m), [], "depois do rollback nao anota");
    assert.deepEqual(
      (await foto(c)).livro,
      linhas,
      "o rollback preserva as linhas",
    );
    await c.query(MIGRATION);
    assert.equal(await gatilhosVivos(c), 34, "reaplicar volta os 34");
    assert.equal(await agendado(c), 1);
    await c.query("UPDATE public.coupons SET value = 8 WHERE id = $1", [id]);
    assert.equal((await desde(c, m)).length, 1, "reaplicado, volta a anotar");
  });

  // Destrutivo: sem confirmacao recusa; antes do comum recusa; com os dois apaga; a migration recria.
  await desfeita(c, async () => {
    let e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(e?.message ?? "(apagou)", /LIVRO_SO_COM_O_DONO/);
    await c.query("SET LOCAL app.confirmo_apagar_livro = 'APAGAR'");
    e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(e?.message ?? "(apagou)", /LIVRO_ROLLBACK_COMUM_PRIMEIRO/);
    await c.query(ROLLBACK);
    await c.query(DESTRUTIVO);
    await c.query(DESTRUTIVO); // idempotente
    for (const t of LIVROS)
      assert.equal(
        (await um(c, "SELECT to_regclass($1) IS NULL AS x", [`public.${t}`])).x,
        true,
        `${t} apagada`,
      );
    await c.query(MIGRATION);
    assert.equal(
      await gatilhosVivos(c),
      34,
      "a migration recria depois do destrutivo",
    );
    assert.deepEqual(
      await um(
        c,
        "SELECT ligado, (SELECT count(*)::int FROM public.livro_de_registro) AS n FROM public.livro_de_registro_chave",
      ),
      { ligado: true, n: 0 },
    );
  });
  return recusas;
}

// ---------------------------------------------------------------------------
// (M) MUTANTES: a MESMA prova de comportamento tem de cair, pelo motivo certo.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql
    .replace(
      /DO \$preflight_20261510000000\$[\s\S]*?END \$preflight_20261510000000\$;\n?/,
      "",
    )
    .replace(
      /DO \$posvoo_20261510000000\$[\s\S]*?END \$posvoo_20261510000000\$;\n?/,
      "",
    );
const trocar = (sql, de, para) => {
  assert.equal(
    sql.split(de).length,
    2,
    `mutante: o trecho tem de aparecer UMA vez: ${de.slice(0, 70)}`,
  );
  return sql.replace(de, () => para);
};
const CUPONS_ALTERACAO =
  "AFTER UPDATE ON public.coupons\n  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos FOR EACH STATEMENT";
const CUPONS_EXCLUSAO =
  "CREATE OR REPLACE TRIGGER tr_livro_exclusao AFTER DELETE ON public.coupons\n  REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();";
const MUTANTES = {
  "sem-excecao": {
    muta: (s) =>
      trocar(
        s,
        "WHEN OTHERS THEN\n      -- Nunca no caminho",
        "WHEN division_by_zero THEN\n      -- Nunca no caminho",
      ),
    motivo: "o UPDATE do cupom grava com o livro quebrado",
  },
  "sem-lock-timeout": {
    muta: (s) => trocar(s, " SET lock_timeout = '200ms'\n", ""),
    motivo: "a v24 nasce",
    trava: true,
  },
  "anota-insert": {
    muta: (s) =>
      trocar(
        trocar(
          s,
          "ELSIF TG_OP = 'DELETE' THEN",
          "ELSIF TG_OP IN ('DELETE', 'INSERT') THEN",
        ),
        CUPONS_EXCLUSAO,
        `${CUPONS_EXCLUSAO}\nCREATE OR REPLACE TRIGGER tr_livro_insercao AFTER INSERT ON public.coupons\n  REFERENCING NEW TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar();`,
      ),
    motivo: "INSERT nao anota",
  },
  "guarda-o-novo": {
    muta: (s) =>
      trocar(
        trocar(s, "jsonb_each(par.velha) AS k", "jsonb_each(par.nova) AS k"),
        "(par.nova -> k.key)",
        "(par.velha -> k.key)",
      ),
    motivo: "antes guarda o valor ANTIGO",
  },
  "delete-so-diferenca": {
    muta: (s) =>
      trocar(
        s,
        "'D', a.j, auth.uid()",
        "'D', jsonb_build_object('id', a.j -> 'id'), auth.uid()",
      ),
    motivo: "DELETE guarda a linha inteira",
  },
  "sem-filtro-de-carimbo": {
    muta: (s) =>
      trocar(
        s,
        "\n         AND (d.antes - ARRAY['updated_at', 'ultima_atualizacao']) <> '{}'::jsonb;",
        ";",
      ),
    motivo: "so muda o carimbo",
  },
  "ignora-a-chave": {
    muta: (s) =>
      trocar(
        s,
        "IF NOT COALESCE((SELECT c.ligado FROM public.livro_de_registro_chave c WHERE c.id = 1), false) THEN",
        "IF false THEN",
      ),
    motivo: "chave desligada nao anota",
  },
  "sem-titular": {
    muta: (s) =>
      trocar(
        s,
        "v_origem text := COALESCE(TG_ARGV[0], '');",
        "v_origem text := '';",
      ),
    motivo: "titular",
  },
  "limpa-com-9-dias": {
    muta: (s) => trocar(s, "interval '90 days'", "interval '9 days'"),
    motivo: "a limpeza guarda o de 30 dias",
  },
  "limpa-invertido": {
    muta: (s) =>
      trocar(s, "v.quando < clock_timestamp()", "v.quando > clock_timestamp()"),
    motivo: "a limpeza apaga o de 91 dias",
  },
  "sem-agenda": {
    muta: (s) =>
      trocar(
        s,
        "SELECT cron.schedule('limpar-livro-de-registro', '17 6 * * *', 'SET statement_timeout = 60000; SELECT public.livro_de_registro_limpar()');",
        "",
      ),
    motivo: "job agendado",
  },
  "grant-select-authenticated": {
    muta: (s) =>
      trocar(
        s,
        "REVOKE ALL ON TABLE public.livro_de_registro FROM PUBLIC, anon, authenticated, service_role;",
        "REVOKE ALL ON TABLE public.livro_de_registro FROM PUBLIC, anon, authenticated, service_role;\nGRANT SELECT ON TABLE public.livro_de_registro TO authenticated;",
      ),
    motivo: "authenticated le o livro",
  },
  "gatilho-por-linha": {
    muta: (s) =>
      trocar(
        s,
        CUPONS_ALTERACAO,
        CUPONS_ALTERACAO.replace("FOR EACH STATEMENT", "FOR EACH ROW"),
      ),
    motivo: "UPDATE de 3 linhas = 3 anotacoes",
  },
};
/** Aplica `sql` (gravado) por cima do estado do rollback comum: o clone fica com ESSA versao. */
async function gravar(c, sql) {
  await c.query("BEGIN");
  try {
    await c.query(ROLLBACK);
    await c.query(sql);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
async function mutantes(c, url) {
  const rodar = (sql) =>
    desfeita(c, async () => {
      await c.query(ROLLBACK);
      await c.query(sql);
      await comportamento(c);
    });
  await rodar(SEM_CONFERENCIA(MIGRATION)); // controle: verde
  let mortos = 0;
  for (const [nome, { muta, motivo, trava }] of Object.entries(MUTANTES)) {
    const alterada = SEM_CONFERENCIA(muta(MIGRATION));
    assert.notEqual(
      alterada,
      SEM_CONFERENCIA(MIGRATION),
      `mutante "${nome}" nao mudou nada`,
    );
    let erro = null;
    if (trava) {
      await gravar(c, alterada);
      try {
        await travaNoLivro(c, url);
      } catch (e) {
        erro = e;
      } finally {
        await gravar(c, MIGRATION);
      }
    } else {
      try {
        await rodar(alterada);
      } catch (e) {
        erro = e;
      }
    }
    assert(erro, `MUTANTE SOBREVIVEU: ${nome}`);
    assert.equal(
      erro.code,
      "ERR_ASSERTION",
      `mutante "${nome}" morreu por erro inesperado (e nao por assercao): ${erro.message}`,
    );
    assert(
      erro.message.includes(motivo),
      `mutante "${nome}" morreu pelo motivo errado: ${erro.message.split("\n")[0]}`,
    );
    mortos++;
    console.log(
      `    mutante morto: ${nome}: ${erro.message.split("\n")[0].slice(0, 150)}`,
    );
  }
  return mortos;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    const r = await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
    return r;
  };
  try {
    assert.equal(
      (
        await um(
          c,
          "SELECT to_regprocedure('public.livro_de_registro_anotar()') IS NOT NULL AS x",
        )
      ).x,
      true,
      "o clone deve estar com a migration nova",
    );
    assert.equal(await gatilhosVivos(c), 34);
    // A v24 roda como authenticated e le auth.* (mesma preparacao das provas de cupom).
    await c.query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
    const mutante = process.env.MUTANTE_LIVRO;
    if (mutante) {
      if (!Object.hasOwn(MUTANTES, mutante))
        falhar(
          "ERRO",
          `MUTANTE_LIVRO desconhecido: ${mutante}. Validos: ${Object.keys(MUTANTES).join(", ")}`,
        );
      await gravar(c, SEM_CONFERENCIA(MUTANTES[mutante].muta(MIGRATION)));
      console.log(
        `MUTANTE_LIVRO aplicado: ${mutante} (a execucao TEM de ficar vermelha)`,
      );
    }
    await provar(
      "acesso: anon, authenticated, service_role e papel sem grant recebem 42501 nas 3 tabelas e nas 2 funcoes; RLS, 0 politicas, fora do realtime, chave padrao",
      () => desfeita(c, () => acesso(c)),
    );
    await provar(
      "o que se anota + as 17 tabelas + cascatas + v24 + confirmar_pagamento + 10.000 linhas + livro quebrado + limpeza/teto/disjuntor/job",
      () => desfeita(c, () => comportamento(c)),
    );
    await provar(
      "nunca no caminho: livro travado (v24 < 1 s), chave travada, ROLLBACK sem anotacao, custo de 2000 UPDATEs",
      () => nuncaNoCaminho(c, url),
    );
    if (mutante) {
      console.log(
        `MUTANTE_LIVRO ${mutante}: a execucao ficou VERDE e devia ficar vermelha`,
      );
      falhar("MUTANTE_SOBREVIVEU", mutante);
    }
    const recusas = await provar(
      "aplicar 2x (LF e CRLF), reaplicar nao religa, sem COMMIT escondido, pre-voo recusa 6, escrita aberta = 55P03 em < 1 s, rollback 2x, reaplicar, destrutivo",
      () => aplicacao(c, url),
    );
    const mortos = await provar("13 mutantes da migration", () =>
      mutantes(c, url),
    );
    console.log(
      `\no-livro-de-registro-viva: ${provas} provas ok; ${recusas} recusas do pre-voo; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Livro de registro (PG17)",
      `${provas} provas, ${recusas} recusas do pre-voo, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("LIVRO_DE_REGISTRO", e.stack || e.message));

"use strict";

/**
 * PROVA VIVA da migration 20261174000000_formas_de_pagamento_por_loja.sql —
 * até aqui ela só tinha sido provada por LEITURA DE TEXTO
 * (tests/migration_formas_de_pagamento_por_loja_test.ts). Este script roda o
 * SQL de verdade contra o Postgres EFÊMERO do job (o mesmo provisionado por
 * provisionar.cjs e migrado do zero por aplicar-migrations.cjs) e observa o
 * comportamento — mesmo estilo e travas de tests/banco/invariantes-dinheiro.cjs.
 *
 * O QUE SE PROVA, NA ORDEM DO DESPACHO:
 *   (1) linha nova de store_config nasce com formas_pagamento_entrega =
 *       {pix,card,cash} (o DEFAULT da coluna).
 *   (2) as duas CHECK constraints: elemento fora de (pix,card,cash) e
 *       duplicata são recusados.
 *   (3) a trigger store_config_exige_forma_de_pagamento: lista vazia SEM
 *       pagamento_online é recusada (LOJA_SEM_FORMA_DE_PAGAMENTO); lista
 *       vazia COM pagamento_online é aceita (a Savy: só pelo app).
 *   (4) achado B1: upsert_store_config numa linha JÁ EXISTENTE (ON CONFLICT
 *       DO UPDATE), com lista vazia + online ligado, e payload que NÃO manda
 *       o campo — não pode ser travado pelo disparo BEFORE INSERT do
 *       candidato fantasma.
 *   (5) create_marketplace_order_v23 E _v24 (as duas RPCs — mesma
 *       assinatura, mesmo 0-bis): forma desligada recusa com o texto exato;
 *       forma ligada passa; pagamento online com online ligado é aceito.
 *   (5-upsert) o CAMINHO REAL do painel (StoreContext.tsx:995-1001):
 *       upsert_store_config grava formas_pagamento_entrega e a checagem
 *       observa o valor GRAVADO POR ELE — nunca por INSERT/UPDATE direto.
 *   (6) padrão (as três formas ligadas, nada mexido): pix/card/cash na
 *       entrega continuam se comportando como antes da migration.
 *   (7) IDEMPOTÊNCIA + ROLLBACK MANUAL: reaplica a migration sobre o
 *       estado JÁ MIGRADO (idempotência de verdade, não a reaplicação sobre
 *       o estado revertido) e confere que não erra; aplica o rollback e
 *       PROVA que os CORPOS de v23/v24/upsert_store_config voltaram ao
 *       anterior via sha256(prosrc) (não só "existe"/"não existe"), e que
 *       v_store_config não expõe a coluna nova; observa o comportamento
 *       antigo voltar nas duas RPCs; e REAPLICA a migration por cima
 *       (idempotência pós-rollback) — deixa o banco migrado para qualquer
 *       passo de CI que rode depois deste.
 *
 * USO: node tests/banco/formas-de-pagamento-viva.cjs
 * (mesma DATABASE_URL efêmera do job — ver tests/banco/efemero.cjs)
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os dois únicos caminhos de arquivo daqui (CAMINHO_MIGRATION,
 * CAMINHO_ROLLBACK) são montados com path.join a partir de __dirname —
 * fixos no repositório, nunca entrada de rede nem de terceiro. Mesma
 * convenção de tests/banco/aplicar-migrations.cjs. */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const MIGRATIONS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const CAMINHO_MIGRATION = path.join(
  MIGRATIONS_DIR,
  "20261174000000_formas_de_pagamento_por_loja.sql",
);
const CAMINHO_ROLLBACK = path.join(
  MIGRATIONS_DIR,
  "rollback-manual-20261174000000_formas_de_pagamento_por_loja.sql",
);

const MENSAGEM_FORMA_DESLIGADA =
  "Esta forma de pagamento não está disponível nesta loja. Escolha outra.";

// Assinaturas exatas usadas pelo preflight da própria migration (mesmo
// `to_regprocedure` das linhas ~160-168 de 20261174000000) — é como se
// pergunta ao pg_proc "qual é o corpo desta função AGORA".
const ASSINATURA_V23 =
  "public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const ASSINATURA_V24 =
  "public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const ASSINATURA_UPSERT = "public.upsert_store_config(jsonb)";

// Hashes copiados LITERALMENTE do preflight da migration (linhas ~172-198
// de 20261174000000_formas_de_pagamento_por_loja.sql) — cada lista tem 4
// hashes aceitos: o corpo ANTERIOR (que a 20261172000000/20261171000000
// deixou, LF|CRLF) e o corpo QUE ESTA MIGRATION deixa (LF|CRLF —
// reaplicação idempotente). Membership nesta lista, por si só, NÃO prova
// que o rollback restaurou o corpo anterior (2 das 4 entradas são o corpo
// NOVO) — é por isso que a prova (7) também exige que o hash pós-rollback
// seja DIFERENTE do hash capturado ao vivo ANTES do rollback (o corpo
// migrado de verdade nesta rodada). As duas condições juntas isolam o
// corpo anterior sem precisar decidir manualmente qual das 4 é qual.
const HASHES_ACEITOS_V23 = [
  "e9f3075a42404fbd54369059c7bc736a8a3d0e4dea47c4956e455612c425aab5",
  "9cfc00feee72e9e228211e3c7c0c3f0e9d86b82e06783d1e26fccdac281d3168",
  "88b2ca0a30dc8105ce6fff88459652db48186b8496351a3a92b1517fe180e809",
  "2a5ef2c732793032f400e9caacc13c677d47d6590827a761e5d210f3ab4ebf54",
];
const HASHES_ACEITOS_V24 = [
  "770b1e9d576531c86473640057654ad2ef2250a75b5b76474e7f3824bc2d0b39",
  "fbd60e3e2d0211b2447a67032b95572f68bae4a7fbac6ea26a14551922dbd439",
  "000404f0811788dbd5e7bf13390b0de2a7e67453cba1520ae325173b405c30ed",
  "bf949408077a0a0974eb2bde591908dfaf0b5a0dc90744eb187dcb6f7595507d",
];
const HASHES_ACEITOS_UPSERT = [
  "99d4b7e8a104f25b155732a8a2fbe8a6f9f4707cb643ce351e7eb80ce25d4ca6",
  "5b832604ae8eead6c73cd0d0594348cf9e3b538163d396324fbeabca4947493d",
  "27bdea8d7e85336cc1a4f9be3a154985efb767a835709c270aad5992fa9623fb",
  "b9a54a47a8672ac2ac78b868d75e2029c72cc622047ff9652ad8ed5571e7d046",
];

// ---- Fixtures determinísticos (uuids fixos, nunca gerados por round-trip) --
const U_CLIENTE = "33333333-3333-3333-3333-333333333333";
const U_ADMIN = "33333333-3333-3333-3333-333333333334";
const P_PADRAO = "cccccccc-0000-0000-0000-000000000001";
const P_LIGADA = "cccccccc-0000-0000-0000-000000000002";
const P_ONLINE = "cccccccc-0000-0000-0000-000000000003";
const P_ROLLBACK = "cccccccc-0000-0000-0000-000000000004";
// Mesmo trio da v23, em produtos PRÓPRIOS (v24 é a RPC do pagamento
// antecipado — a mesma checagem 0-bis, mas nunca compartilha fixture de
// produto com a v23, para as duas provas não colidirem em estoque).
const P_PADRAO_V24 = "cccccccc-0000-0000-0000-000000000005";
const P_LIGADA_V24 = "cccccccc-0000-0000-0000-000000000006";
const P_ONLINE_V24 = "cccccccc-0000-0000-0000-000000000007";
const P_ROLLBACK_V24 = "cccccccc-0000-0000-0000-000000000008";
// Produto da prova (5-upsert): o caminho REAL do painel administrativo
// (StoreContext.tsx:995-1001), que grava por upsert_store_config, nunca
// por UPDATE/INSERT direto na tabela.
const P_UPSERT = "cccccccc-0000-0000-0000-000000000009";

// ids de store_config usados só para provar coluna/CHECK/trigger sem tocar
// na loja id=1 (a que as RPCs de pedido leem de verdade).
const LOJA_TESTE_DEFAULT = 90001;
const LOJA_TESTE_CHECK_INVALIDO = 90002;
const LOJA_TESTE_CHECK_DUPLICATA = 90003;
const LOJA_TESTE_TRIGGER_RECUSA = 90004;
const LOJA_TESTE_TRIGGER_ACEITA = 90005;

// ---- Helpers de sessão (mesmos de invariantes-dinheiro.cjs) -----------------
async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}

async function valorUnico(cliente, sql, params = []) {
  const resultado = await cliente.query(sql, params);
  return resultado.rows[0][Object.keys(resultado.rows[0])[0]];
}

// O hash de verdade do CORPO ao vivo agora — mesma expressão do preflight
// da migration (sha256(convert_to(prosrc,'UTF8')), hex), contra a
// assinatura exata via to_regprocedure. É isto que prova RESTAURAÇÃO, e
// não só ausência/presença do objeto.
async function hashCorpo(cliente, assinatura) {
  return valorUnico(
    cliente,
    `SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
}

// A loja id=1, com CEP/faixa local fixos (mesmos de invariantes-dinheiro.cjs)
// + controle direto de formas_pagamento_entrega/pagamento_online — é o que
// cada prova de RPC precisa MUDAR entre uma chamada e outra.
async function configurarLoja(cliente, { formas, online }) {
  await cliente.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage,
        formas_pagamento_entrega, pagamento_online)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', $1::text[], $2::boolean)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           pagamento_online = EXCLUDED.pagamento_online`,
    [formas, online],
  );
}

async function criarProduto(cliente, id, nome) {
  await cliente.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, $2, 10.00, 30.00, 50, true, false)
     ON CONFLICT (id) DO UPDATE SET estoque = 50, ativo = true`,
    [id, nome],
  );
}

async function garantirCliente(cliente) {
  await cliente.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'cliente-formas@prova.teste', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_CLIENTE],
  );
}

async function garantirAdmin(cliente) {
  await cliente.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'admin-formas@prova.teste', '{"role":"admin"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_ADMIN],
  );
}

// Pedido via local-delivery — o mesmo desenho de criarPedido/
// criarPedidoComFrete em invariantes-dinheiro.cjs, com a RPC (v23 ou v24 —
// as duas têm a MESMA assinatura de 13 parâmetros na migration, confirmado
// em `grep -n "CREATE OR REPLACE FUNCTION public.create_marketplace_order_v2"`),
// o produto e o meio de pagamento como parâmetro (é o que cada prova varia).
async function criarPedido(cliente, { rpc, produtoId, metodo, total }) {
  const itens = [{ product_id: produtoId, variant_id: null, quantity: 1 }];
  const resultado = await cliente.query(
    `SELECT public.${rpc}(
        $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid,
        $6::text, $7::text, $8::text, $9::text, $10::jsonb,
        $11::text, $12::text, $13::uuid
      ) AS id`,
    [
      JSON.stringify(itens),
      total,
      0,
      metodo,
      null,
      null,
      "Cliente de Prova Formas",
      "5539000000000",
      null,
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      "38500-000",
      "local-delivery",
      null,
    ],
  );
  return resultado.rows[0].id;
}

const criarPedidoV23 = (cliente, args) =>
  criarPedido(cliente, { ...args, rpc: "create_marketplace_order_v23" });
const criarPedidoV24 = (cliente, args) =>
  criarPedido(cliente, { ...args, rpc: "create_marketplace_order_v24" });

const ehUuid = (valor) => /^[0-9a-f-]{36}$/i.test(valor);

// ---- Provas -----------------------------------------------------------------
const PROVAS = [];

// (1) Coluna nova nasce com o DEFAULT — linha GENUINAMENTE nova (id fora do
// que qualquer outra prova toca), sem mandar a coluna no INSERT.
PROVAS.push({
  nome: "(1) store_config nova nasce com formas_pagamento_entrega = {pix,card,cash}",
  corpo: async (cliente) => {
    await cliente.query("DELETE FROM public.store_config WHERE id = $1", [
      LOJA_TESTE_DEFAULT,
    ]);
    await cliente.query("INSERT INTO public.store_config (id) VALUES ($1)", [
      LOJA_TESTE_DEFAULT,
    ]);
    const formas = await valorUnico(
      cliente,
      "SELECT formas_pagamento_entrega FROM public.store_config WHERE id = $1",
      [LOJA_TESTE_DEFAULT],
    );
    assert.deepEqual(
      formas,
      ["pix", "card", "cash"],
      "o default da coluna tem de ser exatamente {pix,card,cash}, nesta ordem",
    );
  },
});

// (2) As duas CHECK constraints.
PROVAS.push({
  nome: "(2) CHECK recusa elemento fora de (pix,card,cash) e recusa duplicata",
  corpo: async (cliente) => {
    await cliente.query("DELETE FROM public.store_config WHERE id = $1", [
      LOJA_TESTE_CHECK_INVALIDO,
    ]);
    await assert.rejects(
      () =>
        cliente.query(
          "INSERT INTO public.store_config (id, formas_pagamento_entrega) VALUES ($1, $2::text[])",
          [LOJA_TESTE_CHECK_INVALIDO, ["pix", "boleto"]],
        ),
      (erro) => {
        assert.equal(erro.code, "23514", "violação de CHECK (23514)");
        assert.equal(
          erro.constraint,
          "store_config_formas_pagamento_entrega_check",
          "constraint certa deve reprovar 'boleto'",
        );
        return true;
      },
      "elemento fora de (pix,card,cash) deve ser recusado",
    );

    await cliente.query("DELETE FROM public.store_config WHERE id = $1", [
      LOJA_TESTE_CHECK_DUPLICATA,
    ]);
    await assert.rejects(
      () =>
        cliente.query(
          "INSERT INTO public.store_config (id, formas_pagamento_entrega) VALUES ($1, $2::text[])",
          [LOJA_TESTE_CHECK_DUPLICATA, ["pix", "pix"]],
        ),
      (erro) => {
        assert.equal(erro.code, "23514", "violação de CHECK (23514)");
        assert.equal(
          erro.constraint,
          "store_config_formas_pagamento_sem_duplicata_check",
          "constraint de duplicata deve reprovar {pix,pix}",
        );
        return true;
      },
      "duplicata {pix,pix} deve ser recusada",
    );
  },
});

// (3) A trigger: pelo menos uma forma (entrega OU app).
PROVAS.push({
  nome: "(3) trigger exige ao menos uma forma: lista vazia recusa sem online, aceita com online",
  corpo: async (cliente) => {
    await cliente.query("DELETE FROM public.store_config WHERE id = $1", [
      LOJA_TESTE_TRIGGER_RECUSA,
    ]);
    await assert.rejects(
      () =>
        cliente.query(
          `INSERT INTO public.store_config (id, formas_pagamento_entrega, pagamento_online)
           VALUES ($1, '{}'::text[], false)`,
          [LOJA_TESTE_TRIGGER_RECUSA],
        ),
      /LOJA_SEM_FORMA_DE_PAGAMENTO/,
      "lista vazia com pagamento_online desligado deve ser recusada pela trigger",
    );

    await cliente.query("DELETE FROM public.store_config WHERE id = $1", [
      LOJA_TESTE_TRIGGER_ACEITA,
    ]);
    await cliente.query(
      `INSERT INTO public.store_config (id, formas_pagamento_entrega, pagamento_online)
       VALUES ($1, '{}'::text[], true)`,
      [LOJA_TESTE_TRIGGER_ACEITA],
    );
    const formas = await valorUnico(
      cliente,
      "SELECT formas_pagamento_entrega FROM public.store_config WHERE id = $1",
      [LOJA_TESTE_TRIGGER_ACEITA],
    );
    assert.deepEqual(
      formas,
      [],
      "lista vazia com pagamento_online ligado (Savy: só pelo app) deve ser aceita",
    );
  },
});

// (4) Achado B1: upsert_store_config em linha JÁ EXISTENTE não pode ser
// travado pelo candidato fantasma do BEFORE INSERT.
PROVAS.push({
  nome: "(4) B1: upsert_store_config em loja já existente (lista vazia + online) não trava no BEFORE INSERT",
  corpo: async (cliente) => {
    await logar(cliente, U_CLIENTE);
    await garantirCliente(cliente);
    // id=1 nasce (ou é atualizada) com lista vazia + pagamento_online=true —
    // estado válido (a loja só vende pelo app). Como o candidato final
    // satisfaz o invariante (online=true), este INSERT/UPDATE passa mesmo
    // que id=1 ainda não exista.
    await configurarLoja(cliente, { formas: [], online: true });
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT pagamento_online FROM public.store_config WHERE id = 1",
      ),
      true,
      "pré-condição: loja com pagamento_online ligado",
    );

    // Payload NÃO manda formas_pagamento_entrega — é o caminho que o B1
    // corrige: sem a correção, o candidato do INSERT (pagamento_online cai
    // no DEFAULT false, formas_pagamento_entrega no fallback teria de usar
    // o valor ATUAL {} ) dispararia LOJA_SEM_FORMA_DE_PAGAMENTO no BEFORE
    // INSERT mesmo o destino real sendo um UPDATE inofensivo.
    // upsert_store_config exige is_admin() — logar como admin só para esta
    // chamada, voltando ao cliente comum depois (mesmo padrão de
    // invariantes-dinheiro.cjs ao alternar cliente/admin).
    await garantirAdmin(cliente);
    await logar(cliente, U_ADMIN);
    const resultado = await cliente.query(
      "SELECT public.upsert_store_config($1::jsonb) AS cfg",
      [JSON.stringify({ free_shipping_min: 10 })],
    );
    await logar(cliente, U_CLIENTE);
    assert.ok(
      resultado.rows[0].cfg,
      "upsert_store_config deve retornar a config",
    );

    const depois = await cliente.query(
      `SELECT formas_pagamento_entrega, pagamento_online, free_shipping_min
         FROM public.store_config WHERE id = 1`,
    );
    assert.deepEqual(
      depois.rows[0].formas_pagamento_entrega,
      [],
      "formas_pagamento_entrega não pode ser tocada por um payload que não a manda",
    );
    assert.equal(
      depois.rows[0].pagamento_online,
      true,
      "pagamento_online (fora do upsert) permanece intacto",
    );
    assert.equal(
      Number(depois.rows[0].free_shipping_min),
      10,
      "o campo que o payload mandou foi salvo",
    );
  },
});

// (5) create_marketplace_order_v23 E _v24: forma desligada recusa; forma
// ligada passa; online com pagamento_online ligado é aceito. O 0-bis é o
// MESMO bloco copiado nas duas RPCs (mesmo texto de erro, mesma posição) —
// provar as duas é o que o despacho original pedia e o script só cobria
// a v23.
PROVAS.push({
  nome: "(5) create_marketplace_order_v23: recusa forma desligada, aceita forma ligada, aceita online quando online está ligado",
  corpo: async (cliente) => {
    await logar(cliente, U_CLIENTE);
    await garantirCliente(cliente);
    await criarProduto(cliente, P_PADRAO, "Produto Prova Formas Desligada");
    await criarProduto(cliente, P_LIGADA, "Produto Prova Formas Ligada");
    await criarProduto(cliente, P_ONLINE, "Produto Prova Formas Online");

    // pix DESLIGADO (só card/cash na entrega) — a loja mantém o invariante
    // (2 formas > 0), então a recusa é ESPECIFICAMENTE da forma, não do
    // invariante da loja.
    await configurarLoja(cliente, { formas: ["card", "cash"], online: false });
    await assert.rejects(
      () =>
        criarPedidoV23(cliente, {
          produtoId: P_PADRAO,
          metodo: "pix",
          total: "30.00",
        }),
      (erro) => {
        assert.equal(
          erro.message,
          MENSAGEM_FORMA_DESLIGADA,
          "a mensagem tem de ser EXATAMENTE o texto amigável, sem prefixo de código",
        );
        return true;
      },
      "pix desligado na loja deve recusar o pedido",
    );

    // pix LIGADO (as três formas): o mesmo pedido nasce.
    await configurarLoja(cliente, {
      formas: ["pix", "card", "cash"],
      online: false,
    });
    const pedidoLigado = await criarPedidoV23(cliente, {
      produtoId: P_LIGADA,
      metodo: "pix",
      total: "30.00",
    });
    assert.ok(ehUuid(pedidoLigado), "pix ligado deve deixar o pedido nascer");

    // online: loja só pelo app (lista vazia + pagamento_online ligado) — a
    // mesma configuração da Savy.
    await configurarLoja(cliente, { formas: [], online: true });
    const pedidoOnline = await criarPedidoV23(cliente, {
      produtoId: P_ONLINE,
      metodo: "online",
      total: "30.00",
    });
    assert.ok(
      ehUuid(pedidoOnline),
      "pagamento online com pagamento_online ligado deve deixar o pedido nascer",
    );
  },
});

// (5-v24) A MESMA prova de cima, contra create_marketplace_order_v24 — a
// RPC do pagamento antecipado. O 0-bis dela é uma cópia byte a byte do da
// v23 (mesma posição, depois da idempotência e antes do passo 1), então o
// roteiro é idêntico: só troca a RPC e os produtos (fixture própria, para
// não competir por estoque com a prova (5) acima).
PROVAS.push({
  nome: "(5-v24) create_marketplace_order_v24: recusa forma desligada, aceita forma ligada, aceita online quando online está ligado",
  corpo: async (cliente) => {
    await logar(cliente, U_CLIENTE);
    await garantirCliente(cliente);
    await criarProduto(
      cliente,
      P_PADRAO_V24,
      "Produto Prova Formas Desligada v24",
    );
    await criarProduto(
      cliente,
      P_LIGADA_V24,
      "Produto Prova Formas Ligada v24",
    );
    await criarProduto(
      cliente,
      P_ONLINE_V24,
      "Produto Prova Formas Online v24",
    );

    await configurarLoja(cliente, { formas: ["card", "cash"], online: false });
    await assert.rejects(
      () =>
        criarPedidoV24(cliente, {
          produtoId: P_PADRAO_V24,
          metodo: "pix",
          total: "30.00",
        }),
      (erro) => {
        assert.equal(
          erro.message,
          MENSAGEM_FORMA_DESLIGADA,
          "a mensagem tem de ser EXATAMENTE o texto amigável, sem prefixo de código (v24)",
        );
        return true;
      },
      "v24: pix desligado na loja deve recusar o pedido",
    );

    await configurarLoja(cliente, {
      formas: ["pix", "card", "cash"],
      online: false,
    });
    const pedidoLigado = await criarPedidoV24(cliente, {
      produtoId: P_LIGADA_V24,
      metodo: "pix",
      total: "30.00",
    });
    assert.ok(
      ehUuid(pedidoLigado),
      "v24: pix ligado deve deixar o pedido nascer",
    );

    await configurarLoja(cliente, { formas: [], online: true });
    const pedidoOnline = await criarPedidoV24(cliente, {
      produtoId: P_ONLINE_V24,
      metodo: "online",
      total: "30.00",
    });
    assert.ok(
      ehUuid(pedidoOnline),
      "v24: pagamento online com pagamento_online ligado deve deixar o pedido nascer",
    );
  },
});

// (5-upsert) O CAMINHO REAL do painel administrativo: StoreContext.tsx
// (linhas 995-1001) grava formas_pagamento_entrega chamando
// public.upsert_store_config({ config_json: {...} }), NUNCA por UPDATE/
// INSERT direto na tabela — as provas (1)-(4) e (5)/(5-v24) até aqui só
// tinham exercitado a coluna via INSERT direto (configurarLoja). Achado
// do revisor Opus (26/09/2026): sem esta prova, um upsert_store_config que
// ignorasse a chave (ex.: `CASE WHEN false` no lugar de `CASE WHEN
// v_has_formas_pagamento`) passava verde.
PROVAS.push({
  nome: "(5-upsert) caminho do painel: upsert_store_config grava formas_pagamento_entrega e a checagem observa o valor GRAVADO POR ELE",
  corpo: async (cliente) => {
    await logar(cliente, U_CLIENTE);
    await garantirCliente(cliente);
    await garantirAdmin(cliente);
    await criarProduto(cliente, P_UPSERT, "Produto Prova Upsert Painel");

    // Estado inicial determinístico, independente do que a prova anterior
    // deixou: 3 formas ligadas, pagamento_online desligado.
    await configurarLoja(cliente, {
      formas: ["pix", "card", "cash"],
      online: false,
    });

    // upsert_store_config exige is_admin() — é a mesma trava do painel de
    // verdade (só admin salva configuração da loja).
    await logar(cliente, U_ADMIN);
    await cliente.query("SELECT public.upsert_store_config($1::jsonb) AS cfg", [
      JSON.stringify({ formas_pagamento_entrega: ["card"] }),
    ]);
    await logar(cliente, U_CLIENTE);

    assert.deepEqual(
      await valorUnico(
        cliente,
        "SELECT formas_pagamento_entrega FROM public.store_config WHERE id = 1",
      ),
      ["card"],
      "upsert_store_config tem de gravar EXATAMENTE o array que o painel mandou (nunca ignorar a chave)",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT public.forma_de_pagamento_aceita('pix')",
      ),
      false,
      "forma_de_pagamento_aceita tem de observar o valor GRAVADO PELO UPSERT, não um estado paralelo",
    );
    await assert.rejects(
      () =>
        criarPedidoV23(cliente, {
          produtoId: P_UPSERT,
          metodo: "pix",
          total: "30.00",
        }),
      (erro) => {
        assert.equal(erro.message, MENSAGEM_FORMA_DESLIGADA);
        return true;
      },
      "pedido com pix deve ser recusado depois que o painel desligou pix via upsert_store_config",
    );

    // Desligar a ÚLTIMA forma pelo upsert, com pagamento_online desligado:
    // a mesma trigger que protege o INSERT/UPDATE direto (prova 3) também
    // protege o caminho do painel — o BEFORE UPDATE que o ON CONFLICT
    // aciona valida a linha FINAL de verdade.
    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        cliente.query("SELECT public.upsert_store_config($1::jsonb) AS cfg", [
          JSON.stringify({ formas_pagamento_entrega: [] }),
        ]),
      /LOJA_SEM_FORMA_DE_PAGAMENTO/,
      "o painel não pode desligar a última forma de pagamento sem pagamento_online ligado",
    );
    await logar(cliente, U_CLIENTE);
  },
});

// (6) Padrão: as três formas ligadas, nada mexido — comportamento idêntico
// ao de antes da migration para pix, card e cash na entrega.
PROVAS.push({
  nome: "(6) padrão (pix,card,cash ligados): as três formas na entrega continuam aceitas como antes",
  corpo: async (cliente) => {
    await logar(cliente, U_CLIENTE);
    await configurarLoja(cliente, {
      formas: ["pix", "card", "cash"],
      online: false,
    });
    for (const metodo of ["pix", "card", "cash"]) {
      const produtoId = `cccccccc-0000-0000-0000-0000000000${metodo === "pix" ? "10" : metodo === "card" ? "11" : "12"}`;
      await criarProduto(cliente, produtoId, `Produto Prova Padrão ${metodo}`);
      const pedidoId = await criarPedidoV23(cliente, {
        produtoId,
        metodo,
        total: "30.00",
      });
      assert.ok(
        ehUuid(pedidoId),
        `${metodo} deve continuar aceito no padrão de fábrica (3 formas ligadas)`,
      );
    }
  },
});

// (7) ROLLBACK MANUAL + IDEMPOTÊNCIA: aplica a migration sobre o estado JÁ
// migrado (idempotência de verdade, achado #2 do revisor), depois aplica o
// rollback e prova que os CORPOS foram RESTAURADOS de verdade (hash de
// prosrc — achado #1: antes disto, "trigger ausente" e "coluna permanece"
// passavam mesmo com o rollback deixando v23/v24/upsert_store_config/
// v_store_config intocados), e por fim REAPLICA a migration (idempotência
// pós-rollback) — deixa o banco migrado para qualquer passo de CI que rode
// depois deste script. Fica por ÚLTIMO de propósito: é a única prova que
// muda o SCHEMA, e não deve interferir nas provas (1)-(6) acima.
PROVAS.push({
  nome: "(7) idempotência + rollback manual: reaplicar sobre o estado migrado não quebra, o rollback restaura os CORPOS de verdade, e a migration reaplica depois",
  corpo: async (cliente) => {
    await logar(cliente, U_CLIENTE);
    await criarProduto(cliente, P_ROLLBACK, "Produto Prova Rollback");
    await criarProduto(cliente, P_ROLLBACK_V24, "Produto Prova Rollback v24");

    await configurarLoja(cliente, {
      formas: ["pix", "card", "cash"],
      online: false,
    });

    // FIX #2 (revisão Opus): idempotência de VERDADE é reaplicar a migration
    // sobre o estado JÁ MIGRADO — não sobre o estado revertido (isso é outra
    // prova, mais abaixo). Se faltasse algum IF NOT EXISTS/CREATE OR REPLACE/
    // DROP IF EXISTS na migration, é AQUI que ela quebraria.
    const sqlMigrationParaReaplicar = fs.readFileSync(
      CAMINHO_MIGRATION,
      "utf8",
    );
    await cliente.query('SET search_path = "$user", public, extensions');
    await cliente.query(sqlMigrationParaReaplicar); // não deve lançar

    // Sanidade ANTES do rollback (e DEPOIS da reaplicação acima): um método
    // forjado (fora de pix/card/cash/online) é recusado pela fonte única —
    // prova ao mesmo tempo que a checagem está ativa E que o comportamento
    // não mudou depois de reaplicar a migration. Nas DUAS RPCs — o 0-bis é a
    // mesma cópia nas duas.
    await assert.rejects(
      () =>
        criarPedidoV23(cliente, {
          produtoId: P_ROLLBACK,
          metodo: "boleto-forjado",
          total: "30.00",
        }),
      (erro) => {
        assert.equal(erro.message, MENSAGEM_FORMA_DESLIGADA);
        return true;
      },
      "depois de reaplicar sobre o estado JÁ migrado, o método desconhecido continua recusado (v23)",
    );
    await assert.rejects(
      () =>
        criarPedidoV24(cliente, {
          produtoId: P_ROLLBACK_V24,
          metodo: "boleto-forjado",
          total: "30.00",
        }),
      (erro) => {
        assert.equal(erro.message, MENSAGEM_FORMA_DESLIGADA);
        return true;
      },
      "depois de reaplicar sobre o estado JÁ migrado, o método desconhecido continua recusado (v24)",
    );

    // Hash dos corpos AGORA — o corpo "novo" (migrado), capturado ao vivo,
    // ANTES do rollback. É contra ISTO que a prova de restauração (FIX #1,
    // abaixo) compara depois de rodar o rollback.
    const hashNovoV23 = await hashCorpo(cliente, ASSINATURA_V23);
    const hashNovoV24 = await hashCorpo(cliente, ASSINATURA_V24);
    const hashNovoUpsert = await hashCorpo(cliente, ASSINATURA_UPSERT);
    assert.ok(hashNovoV23, "v23 tem de existir com corpo antes do rollback");
    assert.ok(hashNovoV24, "v24 tem de existir com corpo antes do rollback");
    assert.ok(
      hashNovoUpsert,
      "upsert_store_config tem de existir com corpo antes do rollback",
    );

    // Aplica o rollback manual — um único statement multi-comando na mesma
    // conexão (protocolo simples do Postgres roda tudo em transação
    // implícita: qualquer erro no meio desfaz o arquivo inteiro, mesma
    // mecânica que tests/banco/aplicar-migrations.cjs já usa para as
    // migrations, sem BEGIN/COMMIT de texto — regra da casa).
    const sqlRollback = fs.readFileSync(CAMINHO_ROLLBACK, "utf8");
    await cliente.query('SET search_path = "$user", public, extensions');
    await cliente.query(sqlRollback);

    // FIX #1 (revisão Opus): não basta a função "existir" ou "não existir"
    // — o rollback tem de ter RESTAURADO o CORPO anterior de v23, v24 e
    // upsert_store_config. Prova: o hash pós-rollback (a) está entre os
    // hashes aceitos pelo preflight da própria migration (LF|CRLF do corpo
    // anterior OU do corpo novo — union das duas variantes) e (b) é
    // DIFERENTE do hash capturado ao vivo ANTES do rollback (o corpo
    // migrado). As duas condições juntas só sobram para o corpo ANTERIOR —
    // sem (b), um rollback que não tocasse a função passaria (a) porque a
    // lista também contém o corpo novo.
    const hashDepoisV23 = await hashCorpo(cliente, ASSINATURA_V23);
    assert.ok(
      HASHES_ACEITOS_V23.includes(hashDepoisV23),
      `v23 pós-rollback tem de ter um dos hashes conhecidos do preflight (obtido: ${hashDepoisV23})`,
    );
    assert.notEqual(
      hashDepoisV23,
      hashNovoV23,
      "v23 pós-rollback não pode ter o MESMO corpo de antes do rollback — o rollback tem de ter restaurado, não deixado como estava",
    );

    const hashDepoisV24 = await hashCorpo(cliente, ASSINATURA_V24);
    assert.ok(
      HASHES_ACEITOS_V24.includes(hashDepoisV24),
      `v24 pós-rollback tem de ter um dos hashes conhecidos do preflight (obtido: ${hashDepoisV24})`,
    );
    assert.notEqual(
      hashDepoisV24,
      hashNovoV24,
      "v24 pós-rollback não pode ter o MESMO corpo de antes do rollback — o rollback tem de ter restaurado a v24, não só a v23",
    );

    const hashDepoisUpsert = await hashCorpo(cliente, ASSINATURA_UPSERT);
    assert.ok(
      HASHES_ACEITOS_UPSERT.includes(hashDepoisUpsert),
      `upsert_store_config pós-rollback tem de ter um dos hashes conhecidos do preflight (obtido: ${hashDepoisUpsert})`,
    );
    assert.notEqual(
      hashDepoisUpsert,
      hashNovoUpsert,
      "upsert_store_config pós-rollback não pode ter o MESMO corpo de antes do rollback",
    );

    // FIX #1, continuação: v_store_config pós-rollback não pode expor
    // formas_pagamento_entrega — a view tem de ter voltado às 34 colunas
    // (DROP VIEW + CREATE VIEW do rollback, não a view da migration).
    const colunaNaView = await valorUnico(
      cliente,
      `SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'v_store_config'
          AND column_name = 'formas_pagamento_entrega'`,
    );
    assert.equal(
      Number(colunaNaView),
      0,
      "v_store_config pós-rollback NÃO pode expor formas_pagamento_entrega — a view tem de ter sido restaurada",
    );

    // DEPOIS do rollback: a trigger não existe mais — lista vazia SEM
    // pagamento_online não é mais recusada.
    await cliente.query(
      `UPDATE public.store_config
          SET formas_pagamento_entrega = '{}'::text[], pagamento_online = false
        WHERE id = 1`,
    );
    assert.deepEqual(
      await valorUnico(
        cliente,
        "SELECT formas_pagamento_entrega FROM public.store_config WHERE id = 1",
      ),
      [],
      "a COLUNA permanece (rollback nunca dropa dado da lojista)",
    );

    const colunaExiste = await valorUnico(
      cliente,
      `SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'store_config'
          AND column_name = 'formas_pagamento_entrega'`,
    );
    assert.equal(
      Number(colunaExiste),
      1,
      "information_schema confirma que a coluna não foi dropada",
    );

    const funcaoExiste = await valorUnico(
      cliente,
      `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'forma_de_pagamento_aceita'`,
    );
    assert.equal(
      Number(funcaoExiste),
      0,
      "forma_de_pagamento_aceita deve ter sido dropada pelo rollback",
    );

    // Comportamento antigo: qualquer método, mesmo forjado, é aceito de
    // volta — não há mais checagem de forma de pagamento nenhuma. Nas DUAS
    // RPCs: o rollback restaura os DOIS corpos (v23 e v24) para o que a
    // 20261172000000 deixou, sem a checagem de forma de pagamento em
    // nenhuma delas.
    await configurarLoja(cliente, { formas: [], online: false });
    const pedidoAntigo = await criarPedidoV23(cliente, {
      produtoId: P_ROLLBACK,
      metodo: "boleto-forjado",
      total: "30.00",
    });
    assert.ok(
      ehUuid(pedidoAntigo),
      "DEPOIS do rollback: qualquer método de pagamento volta a ser aceito (v23)",
    );
    const pedidoAntigoV24 = await criarPedidoV24(cliente, {
      produtoId: P_ROLLBACK_V24,
      metodo: "boleto-forjado",
      total: "30.00",
    });
    assert.ok(
      ehUuid(pedidoAntigoV24),
      "DEPOIS do rollback: qualquer método de pagamento volta a ser aceito (v24)",
    );

    // Reaplica a migration original — prova a IDEMPOTÊNCIA (o preflight
    // aceita tanto o corpo anterior quanto o próprio corpo desta migration).
    const sqlMigration = fs.readFileSync(CAMINHO_MIGRATION, "utf8");
    await cliente.query('SET search_path = "$user", public, extensions');
    await cliente.query(sqlMigration);

    assert.equal(
      Number(
        await valorUnico(
          cliente,
          `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'forma_de_pagamento_aceita'`,
        ),
      ),
      1,
      "reaplicar a migration recria forma_de_pagamento_aceita",
    );

    // Restaura id=1 para um estado válido (3 formas ligadas) — deixa o
    // banco no mesmo padrão que as provas (5)/(5-v24)/(6) e qualquer passo
    // de CI seguinte esperam.
    await configurarLoja(cliente, {
      formas: ["pix", "card", "cash"],
      online: false,
    });
    await assert.rejects(
      () =>
        criarPedidoV23(cliente, {
          produtoId: P_ROLLBACK,
          metodo: "boleto-forjado",
          total: "30.00",
        }),
      (erro) => {
        assert.equal(erro.message, MENSAGEM_FORMA_DESLIGADA);
        return true;
      },
      "depois de reaplicar a migration, o método forjado volta a ser recusado (v23)",
    );
    await assert.rejects(
      () =>
        criarPedidoV24(cliente, {
          produtoId: P_ROLLBACK_V24,
          metodo: "boleto-forjado",
          total: "30.00",
        }),
      (erro) => {
        assert.equal(erro.message, MENSAGEM_FORMA_DESLIGADA);
        return true;
      },
      "depois de reaplicar a migration, o método forjado volta a ser recusado (v24)",
    );
  },
});

// ---- Orquestração ------------------------------------------------------------
async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }

  const linhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva: formas de pagamento por loja (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma prova viva da migration de formas de pagamento foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }

  console.log(
    `\n[formas-de-pagamento-viva] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva: formas de pagamento por loja (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas vivas** contra a migration 20261174000000 e o rollback manual, no Postgres efêmero.`,
  );
}

main();

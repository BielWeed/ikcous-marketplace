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
 *   (5) create_marketplace_order_v23: forma desligada recusa com o texto
 *       exato; forma ligada passa; pagamento online com online ligado é
 *       aceito.
 *   (6) padrão (as três formas ligadas, nada mexido): pix/card/cash na
 *       entrega continuam se comportando como antes da migration.
 *   (7) ROLLBACK MANUAL: aplica, observa o comportamento antigo voltar
 *       (qualquer forma aceita, trigger ausente, coluna permanece), e
 *       REAPLICA a migration (idempotência) — deixa o banco no estado
 *       migrado para qualquer passo de CI que rode depois deste.
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

// ---- Fixtures determinísticos (uuids fixos, nunca gerados por round-trip) --
const U_CLIENTE = "33333333-3333-3333-3333-333333333333";
const U_ADMIN = "33333333-3333-3333-3333-333333333334";
const P_PADRAO = "cccccccc-0000-0000-0000-000000000001";
const P_LIGADA = "cccccccc-0000-0000-0000-000000000002";
const P_ONLINE = "cccccccc-0000-0000-0000-000000000003";
const P_ROLLBACK = "cccccccc-0000-0000-0000-000000000004";

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

// Pedido pela v23 (pagamento na entrega OU online) via local-delivery — o
// mesmo desenho de criarPedido em invariantes-dinheiro.cjs, com o produto e
// o meio de pagamento como parâmetro (é o que cada prova aqui varia).
async function criarPedidoV23(cliente, { produtoId, metodo, total }) {
  const itens = [{ product_id: produtoId, variant_id: null, quantity: 1 }];
  const resultado = await cliente.query(
    `SELECT public.create_marketplace_order_v23(
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

// (5) create_marketplace_order_v23: forma desligada recusa; forma ligada
// passa; online com pagamento_online ligado é aceito.
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

// (7) ROLLBACK MANUAL: aplica, observa o comportamento antigo voltar, e
// REAPLICA a migration (idempotência) — deixa o banco migrado para qualquer
// passo de CI que rode depois deste script. Fica por ÚLTIMO de propósito:
// é a única prova que muda o SCHEMA (dropa trigger/função/CHECK), e não deve
// interferir nas provas (1)-(6) acima.
PROVAS.push({
  nome: "(7) rollback manual: comportamento antigo volta, coluna permanece, e a migration reaplica (idempotência)",
  corpo: async (cliente) => {
    await logar(cliente, U_CLIENTE);
    await criarProduto(cliente, P_ROLLBACK, "Produto Prova Rollback");

    // Sanidade ANTES do rollback: um método forjado (fora de pix/card/cash/
    // online) é recusado pela fonte única — prova que a checagem está
    // realmente ativa antes de provar que ela some depois do rollback.
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
      "ANTES do rollback: método desconhecido deve ser recusado",
    );

    // Aplica o rollback manual — um único statement multi-comando na mesma
    // conexão (protocolo simples do Postgres roda tudo em transação
    // implícita: qualquer erro no meio desfaz o arquivo inteiro, mesma
    // mecânica que tests/banco/aplicar-migrations.cjs já usa para as
    // migrations, sem BEGIN/COMMIT de texto — regra da casa).
    const sqlRollback = fs.readFileSync(CAMINHO_ROLLBACK, "utf8");
    await cliente.query('SET search_path = "$user", public, extensions');
    await cliente.query(sqlRollback);

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
    // volta — não há mais checagem de forma de pagamento nenhuma.
    await configurarLoja(cliente, { formas: [], online: false });
    const pedidoAntigo = await criarPedidoV23(cliente, {
      produtoId: P_ROLLBACK,
      metodo: "boleto-forjado",
      total: "30.00",
    });
    assert.ok(
      ehUuid(pedidoAntigo),
      "DEPOIS do rollback: qualquer método de pagamento volta a ser aceito",
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
    // banco no mesmo padrão que as provas (5)/(6) e qualquer passo de CI
    // seguinte esperam.
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
      "depois de reaplicar a migration, o método forjado volta a ser recusado",
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

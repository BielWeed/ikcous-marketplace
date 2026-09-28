"use strict";

/**
 * PROVA VIVA da migration 20261187000000_o_checkout_mostra_os_cupons_da_cliente
 * (e da 20261188000000_o_contador_duplicado_do_cupom_morre) contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero — frente B de
 * docs/superpowers/plans/2026-09-28-sessoes-paralelas.md.
 *
 * O contrato que esta prova segura é o do pedido do dono: o checkout mostra
 * os cupons liberados, "inclusive os exclusivos" — e NENHUM cupom exclusivo
 * ou secreto vaza para outra pessoa. Por isso cada lado é provado pelos dois
 * caminhos que existem:
 *   - a LISTA (`cupons_do_checkout`), como anon, como a dona do exclusivo e
 *     como outra cliente;
 *   - a VALIDAÇÃO antecipada (`validate_coupon_secure_v2`) e a GARANTIA
 *     final (gatilho no INSERT do pedido, pela v24 de verdade e pela v23 do
 *     convidado) — o exclusivo de outra conta responde "não existe", mesmo
 *     vencido;
 *   - os GRANTS/RLS com `SET ROLE anon|authenticated` (a prova roda como
 *     superusuário, que passaria por cima de tudo).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cupons-do-checkout-viva.cjs
 * (depois de provisionar.cjs e aplicar-migrations.cjs, como no rpc-ci.yml)
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

// Fixtures FICTÍCIAS (nenhum dado real).
const U_DONA = "c0c0c0c0-0000-0000-0000-000000000001";
const U_OUTRA = "c0c0c0c0-0000-0000-0000-000000000002";
const U_ADMIN = "c0c0c0c0-0000-0000-0000-00000000000a";
const P_PRODUTO = "c0c0c0c0-1111-0000-0000-000000000001";

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId ?? "",
  ]);
}

/** Roda `fn` com o papel do app (anon/authenticated) numa transação que
 * sempre volta — é aqui que grant e RLS valem de verdade. */
async function comoPapel(cliente, papel, userId, fn) {
  await cliente.query("BEGIN");
  try {
    await cliente.query("SELECT set_config('app.rpc.user_id', $1, true)", [
      userId ?? "",
    ]);
    // Explícito: é o padrão do Postgres do Supabase, e a prova não pode
    // depender do default do servidor efêmero.
    await cliente.query("SET LOCAL row_security = on");
    await cliente.query(`SET LOCAL ROLE ${papel}`);
    return await fn();
  } finally {
    await cliente.query("ROLLBACK");
  }
}

async function lista(cliente, subtotal) {
  return (
    await cliente.query(
      "SELECT * FROM public.cupons_do_checkout($1::numeric)",
      [subtotal],
    )
  ).rows;
}

async function validar(cliente, codigo, subtotal) {
  return (
    await cliente.query(
      "SELECT public.validate_coupon_secure_v2($1, $2::numeric) AS r",
      [codigo, subtotal],
    )
  ).rows[0].r;
}

async function criarPedido(cliente, { rpc, cupom, total, metodo }) {
  const itens = [{ product_id: P_PRODUTO, variant_id: null, quantity: 2 }];
  const r = await cliente.query(
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
      cupom,
      "Cliente de Prova Cupom",
      "5539000000000",
      null,
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      "38500-000",
      "local-delivery",
      null,
    ],
  );
  return r.rows[0].id;
}

async function esperaRecusa(promessa, frase, contexto) {
  let erro = null;
  try {
    await promessa;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `${contexto}: deveria ter sido recusado`);
  assert.equal(erro.message, frase, `${contexto}: frase da recusa`);
}

async function usos(cliente, codigo) {
  return (
    await cliente.query(
      "SELECT usage_count FROM public.coupons WHERE code = $1",
      [codigo],
    )
  ).rows[0].usage_count;
}

async function prepararLoja(cliente) {
  await cliente.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = true`,
  );
  await cliente.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto Prova Cupons do Checkout', 20.00, 50.00, 1000, true, false)
     ON CONFLICT (id) DO NOTHING`,
    [P_PRODUTO],
  );
  await cliente.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
       ($1, 'dona@prova.teste', '{}'::jsonb),
       ($2, 'outra@prova.teste', '{}'::jsonb),
       ($3, 'admin-cupom@prova.teste', '{"role":"admin"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_DONA, U_OUTRA, U_ADMIN],
  );
  await cliente.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Dona do Exclusivo', 'customer'),
       ($2, 'Outra Cliente', 'customer'),
       ($3, 'Admin da Prova', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U_DONA, U_OUTRA, U_ADMIN],
  );
  // Um cupom de cada caso. Valores fictícios.
  await cliente.query(
    `INSERT INTO public.coupons
       (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active, alcance)
     VALUES
       ('VITRINE10',   'percentage', 10, 0,   NULL, 0, NULL,                        true,  'vitrine'),
       ('VITRINE100',  'fixed',      30, 150, NULL, 0, now() + interval '5 days',   true,  'vitrine'),
       ('SEGREDO50',   'fixed',      50, 0,   NULL, 0, NULL,                        true,  'codigo'),
       ('SOPRADONA',   'fixed',      15, 0,   1,    0, NULL,                        true,  'exclusivo'),
       ('DONAVENCIDO', 'fixed',      15, 0,   NULL, 0, now() - interval '1 day',    true,  'exclusivo'),
       ('VITRINEOFF',  'fixed',      10, 0,   NULL, 0, NULL,                        false, 'vitrine'),
       ('VITRINEVENC', 'fixed',      10, 0,   NULL, 0, now() - interval '1 minute', true,  'vitrine'),
       ('VITRINEESGO', 'fixed',      10, 0,   2,    2, NULL,                        true,  'vitrine'),
       ('EXCLUVAZIO',  'fixed',      10, 0,   NULL, 0, NULL,                        true,  'exclusivo')`,
  );
}

const PROVAS = [];

PROVAS.push({
  nome: "admin_cupom_definir_clientes: só admin; recusa id desconhecido; troca a lista inteira sem duplicar",
  corpo: async (cliente) => {
    await prepararLoja(cliente);
    const idDona = (
      await cliente.query(
        "SELECT id FROM public.coupons WHERE code = 'SOPRADONA'",
      )
    ).rows[0].id;
    const idVencido = (
      await cliente.query(
        "SELECT id FROM public.coupons WHERE code = 'DONAVENCIDO'",
      )
    ).rows[0].id;

    await logar(cliente, U_DONA);
    await esperaRecusa(
      cliente.query(
        "SELECT public.admin_cupom_definir_clientes($1, ARRAY[$2]::uuid[])",
        [idDona, U_DONA],
      ),
      "Não autorizado",
      "cliente comum definindo a lista",
    );

    await logar(cliente, U_ADMIN);
    await esperaRecusa(
      cliente.query(
        "SELECT public.admin_cupom_definir_clientes($1, ARRAY[$2, $3]::uuid[])",
        [idDona, U_DONA, "c0c0c0c0-9999-0000-0000-000000000000"],
      ),
      "Cliente não encontrado (1 de 2).",
      "id que não é conta",
    );

    // Primeiro com as duas, depois só a dona: a outra SAI da lista.
    const n1 = (
      await cliente.query(
        "SELECT public.admin_cupom_definir_clientes($1, ARRAY[$2, $3, $2, NULL]::uuid[]) AS n",
        [idDona, U_DONA, U_OUTRA],
      )
    ).rows[0].n;
    assert.equal(n1, 2, "dedup e sem nulo: 2 clientes");
    const n2 = (
      await cliente.query(
        "SELECT public.admin_cupom_definir_clientes($1, ARRAY[$2]::uuid[]) AS n",
        [idDona, U_DONA],
      )
    ).rows[0].n;
    assert.equal(n2, 1);
    await cliente.query(
      "SELECT public.admin_cupom_definir_clientes($1, ARRAY[$2]::uuid[])",
      [idVencido, U_DONA],
    );

    const lidos = (
      await cliente.query("SELECT * FROM public.admin_cupom_clientes($1)", [
        idDona,
      ])
    ).rows;
    assert.deepEqual(
      lidos.map((l) => [l.user_id, l.nome, l.email]),
      [[U_DONA, "Dona do Exclusivo", "dona@prova.teste"]],
      "o painel lê só a dona, com nome e e-mail",
    );
    assert.deepEqual(
      Object.keys(lidos[0]).sort(),
      ["email", "nome", "user_id"],
      "nada de CPF nem outro dado na leitura do painel",
    );

    await logar(cliente, U_OUTRA);
    await esperaRecusa(
      cliente.query("SELECT * FROM public.admin_cupom_clientes($1)", [idDona]),
      "Não autorizado",
      "cliente comum lendo a lista",
    );
  },
});

PROVAS.push({
  nome: "cupons_do_checkout: anon vê só a vitrine; a dona vê o exclusivo dela; a outra não; secreto nunca",
  corpo: async (cliente) => {
    const codigos = (linhas) => linhas.map((l) => l.codigo).sort();

    const anon = await comoPapel(cliente, "anon", null, () =>
      lista(cliente, 100),
    );
    assert.deepEqual(
      codigos(anon),
      ["VITRINE10", "VITRINE100"],
      "anon: só vitrine ativa, válida e não esgotada",
    );

    const dona = await comoPapel(cliente, "authenticated", U_DONA, () =>
      lista(cliente, 100),
    );
    assert.deepEqual(
      codigos(dona),
      ["SOPRADONA", "VITRINE10", "VITRINE100"],
      "dona: vitrine + o exclusivo DELA (o vencido não)",
    );
    assert.equal(
      dona.find((l) => l.codigo === "SOPRADONA").exclusivo,
      true,
      "o exclusivo chega marcado",
    );

    const outra = await comoPapel(cliente, "authenticated", U_OUTRA, () =>
      lista(cliente, 100),
    );
    assert.deepEqual(
      codigos(outra),
      ["VITRINE10", "VITRINE100"],
      "outra cliente: nunca o exclusivo da dona",
    );

    // Nenhuma coluna de identificação, contador ou pessoa.
    assert.deepEqual(Object.keys(dona[0]).sort(), [
      "aplica",
      "codigo",
      "desconto",
      "exclusivo",
      "falta",
      "minimo",
      "tipo",
      "valido_ate",
      "valor",
    ]);

    // Conta do subtotal 100: SOPRADONA 15 fixo, VITRINE10 10%, VITRINE100
    // não vale (falta 50). Ordem: aplica, desconto maior primeiro.
    assert.deepEqual(
      dona.map((l) => [
        l.codigo,
        l.aplica,
        Number(l.desconto),
        Number(l.falta),
      ]),
      [
        ["SOPRADONA", true, 15, 0],
        ["VITRINE10", true, 10, 0],
        ["VITRINE100", false, 0, 50],
      ],
    );

    // Desconto nunca passa do subtotal; subtotal negativo/nulo vira 0.
    const pequeno = await comoPapel(cliente, "anon", null, () =>
      lista(cliente, 5),
    );
    assert.equal(
      Number(pequeno.find((l) => l.codigo === "VITRINE10").desconto),
      0.5,
    );
    const nulo = await comoPapel(cliente, "anon", null, () =>
      lista(cliente, null),
    );
    assert.equal(
      Number(nulo.find((l) => l.codigo === "VITRINE100").falta),
      150,
    );

    // Cupom esgotado some da lista da dona (limite 1 alcançado).
    await cliente.query(
      "UPDATE public.coupons SET usage_count = 1 WHERE code = 'SOPRADONA'",
    );
    const esgotado = await comoPapel(cliente, "authenticated", U_DONA, () =>
      lista(cliente, 100),
    );
    assert.ok(!codigos(esgotado).includes("SOPRADONA"), "esgotado some");
    await cliente.query(
      "UPDATE public.coupons SET usage_count = 0 WHERE code = 'SOPRADONA'",
    );

    // Loja com cupons desligados: lista vazia.
    await cliente.query(
      "UPDATE public.store_config SET enable_coupons = false WHERE id = 1",
    );
    const desligada = await comoPapel(cliente, "authenticated", U_DONA, () =>
      lista(cliente, 100),
    );
    assert.equal(desligada.length, 0, "loja desligada não lista nada");
    await cliente.query(
      "UPDATE public.store_config SET enable_coupons = true WHERE id = 1",
    );
  },
});

PROVAS.push({
  nome: "validate_coupon_secure_v2: exclusivo de outra conta responde 'inválido' antes de qualquer motivo; mínimo diz quanto falta",
  corpo: async (cliente) => {
    await logar(cliente, U_OUTRA);
    assert.deepEqual(await validar(cliente, "SOPRADONA", 100), {
      is_valid: false,
      discount_value: 0,
      error_message: "Cupom inválido ou expirado.",
    });
    assert.equal(
      (await validar(cliente, "donavencido", 100)).error_message,
      "Cupom inválido ou expirado.",
      "vencido de outra conta não revela 'expirou'",
    );
    assert.equal(
      (await validar(cliente, "EXCLUVAZIO", 100)).error_message,
      "Cupom inválido ou expirado.",
      "exclusivo sem ninguém vale para ninguém",
    );

    await logar(cliente, null);
    assert.equal(
      (await validar(cliente, "SOPRADONA", 100)).error_message,
      "Cupom inválido ou expirado.",
      "anon com o código do exclusivo",
    );

    await logar(cliente, U_DONA);
    const ok = await validar(cliente, "sopradona", 100);
    assert.equal(ok.is_valid, true, "a dona valida o dela");
    assert.equal(Number(ok.discount_value), 15);
    assert.equal(
      (await validar(cliente, "DONAVENCIDO", 100)).error_message,
      "Este cupom expirou.",
      "para a dona, o motivo real",
    );
    assert.equal(
      (await validar(cliente, "VITRINE100", 129.5)).error_message,
      "Faltam R$ 20,50 em produtos para usar este cupom (mínimo de R$ 150,00).",
    );
    assert.equal(
      (await validar(cliente, "SEGREDO50", 100)).is_valid,
      true,
      "o secreto continua valendo para quem digita",
    );

    await cliente.query(
      "UPDATE public.store_config SET enable_coupons = false WHERE id = 1",
    );
    assert.equal(
      (await validar(cliente, "VITRINE10", 100)).error_message,
      "Esta loja não está aceitando cupons no momento.",
    );
    await cliente.query(
      "UPDATE public.store_config SET enable_coupons = true WHERE id = 1",
    );
  },
});

PROVAS.push({
  nome: "gatilho do pedido: exclusivo só nasce no pedido da dona; convidado e outra conta recusados sem gastar a vaga; loja desligada recusa",
  corpo: async (cliente) => {
    // Outra conta, v24, com o código do exclusivo.
    await logar(cliente, U_OUTRA);
    await esperaRecusa(
      criarPedido(cliente, {
        rpc: "create_marketplace_order_v24",
        cupom: "SOPRADONA",
        total: "85.00",
        metodo: "pix",
      }),
      "O cupom SOPRADONA não existe. Confira o código.",
      "outra conta pela v24",
    );
    assert.equal(await usos(cliente, "SOPRADONA"), 0, "vaga intacta");

    // Convidado (sem conta), v23.
    await logar(cliente, null);
    await esperaRecusa(
      criarPedido(cliente, {
        rpc: "create_marketplace_order_v23",
        cupom: "SOPRADONA",
        total: "85.00",
        metodo: "cash",
      }),
      "O cupom SOPRADONA não existe. Confira o código.",
      "convidado pela v23",
    );
    assert.equal(await usos(cliente, "SOPRADONA"), 0, "vaga intacta");

    // A dona: nasce, com o desconto de sempre e a vaga gasta.
    await logar(cliente, U_DONA);
    const pedido = await criarPedido(cliente, {
      rpc: "create_marketplace_order_v24",
      cupom: "SOPRADONA",
      total: "85.00",
      metodo: "pix",
    });
    const linha = (
      await cliente.query(
        "SELECT user_id, discount, total, coupon_code FROM public.marketplace_orders WHERE id = $1",
        [pedido],
      )
    ).rows[0];
    assert.equal(linha.user_id, U_DONA);
    assert.equal(Number(linha.discount), 15);
    assert.equal(Number(linha.total), 85);
    assert.equal(await usos(cliente, "SOPRADONA"), 1, "a vaga foi gasta");

    // Cupom de vitrine e secreto continuam valendo para qualquer conta.
    await logar(cliente, U_OUTRA);
    await criarPedido(cliente, {
      rpc: "create_marketplace_order_v24",
      cupom: "VITRINE10",
      total: "90.00",
      metodo: "pix",
    });

    // Loja desliga os cupons: nem pedido montado à mão ganha desconto.
    await cliente.query(
      "UPDATE public.store_config SET enable_coupons = false WHERE id = 1",
    );
    await esperaRecusa(
      criarPedido(cliente, {
        rpc: "create_marketplace_order_v24",
        cupom: "SEGREDO50",
        total: "50.00",
        metodo: "pix",
      }),
      "O cupom SEGREDO50 está desativado pela loja.",
      "loja com cupons desligados",
    );
    assert.equal(await usos(cliente, "SEGREDO50"), 0);
    // Sem cupom, a loja desligada segue vendendo.
    await criarPedido(cliente, {
      rpc: "create_marketplace_order_v24",
      cupom: null,
      total: "100.00",
      metodo: "pix",
    });
    await cliente.query(
      "UPDATE public.store_config SET enable_coupons = true WHERE id = 1",
    );
  },
});

PROVAS.push({
  nome: "grants e RLS: cupom_clientes só o admin lê e ninguém escreve; coupons segue fechado; used_count morreu",
  corpo: async (cliente) => {
    // Cliente comum lê 0 linhas da lista (RLS) e não escreve (grant).
    const linhasCliente = await comoPapel(
      cliente,
      "authenticated",
      U_DONA,
      async () =>
        (await cliente.query("SELECT * FROM public.cupom_clientes")).rows,
    );
    assert.equal(linhasCliente.length, 0, "cliente não lê a lista");

    const linhasAdmin = await comoPapel(
      cliente,
      "authenticated",
      U_ADMIN,
      async () =>
        (await cliente.query("SELECT * FROM public.cupom_clientes")).rows,
    );
    assert.ok(linhasAdmin.length >= 2, "admin lê a lista");

    for (const [papel, uid] of [
      ["authenticated", U_ADMIN],
      ["authenticated", U_DONA],
      ["anon", null],
    ]) {
      let recusou = false;
      await comoPapel(cliente, papel, uid, async () => {
        try {
          await cliente.query(
            "INSERT INTO public.cupom_clientes (coupon_id, user_id) SELECT id, $1 FROM public.coupons WHERE code = 'SEGREDO50'",
            [U_OUTRA],
          );
        } catch (e) {
          recusou = /permission denied/.test(e.message);
        }
      });
      assert.ok(recusou, `${papel}/${uid}: INSERT direto recusado por grant`);
    }

    // A tabela coupons continua fechada para quem não é admin (20261052).
    const cuponsDaCliente = await comoPapel(
      cliente,
      "authenticated",
      U_DONA,
      async () => (await cliente.query("SELECT code FROM public.coupons")).rows,
    );
    assert.equal(cuponsDaCliente.length, 0, "coupons segue fechado");

    // Anon não executa as RPCs do painel.
    for (const sql of [
      "SELECT * FROM public.admin_cupom_clientes(gen_random_uuid())",
      "SELECT public.admin_cupom_definir_clientes(gen_random_uuid(), '{}'::uuid[])",
    ]) {
      let negado = false;
      await comoPapel(cliente, "anon", null, async () => {
        try {
          await cliente.query(sql);
        } catch (e) {
          negado = /permission denied/.test(e.message);
        }
      });
      assert.ok(negado, `anon sem EXECUTE: ${sql}`);
    }

    const colunaMorta = (
      await cliente.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'coupons'
            AND column_name = 'used_count'`,
      )
    ).rows[0].n;
    assert.equal(colunaMorta, 0, "used_count não existe mais (P4)");
  },
});

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
        anexarAoSummary("Cupons do checkout (rpc-ci)", linhas.join("\n"));
        falhar(
          "FALHOU",
          "Uma prova dos cupons do checkout quebrou — ver acima.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }

  console.log(
    `\n[cupons-do-checkout] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Cupons do checkout (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();

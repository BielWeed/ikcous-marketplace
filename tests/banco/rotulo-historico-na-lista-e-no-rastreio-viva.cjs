"use strict";

// Somente o clone descartável do RPC CI; nenhuma fixture chega a uma loja.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  ROL_FECHADO_POR_CONSULTA,
  estruturaDoRolFechado,
} = require("../../scripts/publicacao/conferir-banco.cjs");
const {
  PAINEL,
  RASTREIO,
  desfazerRotulosHistoricosNaTransacao,
} = require("./rotulo-historico-posterior.cjs");

const ADMIN = "21410000-0000-4000-8000-000000000001";
const PRODUTO = "21410000-0000-4000-8000-000000000002";
const VARIACAO = "21410000-0000-4000-8000-000000000003";
const COM_HISTORICO = "21410000-0000-4000-8000-000000000004";
const SEM_HISTORICO = "21410000-0000-4000-8000-000000000005";
const EMAIL = "rotulos@exemplo.test";
const FONE = "11999990000";
const CONSULTA_PAINEL =
  "SELECT public.get_admin_orders_paged(p_search => $1) AS r";
const CONSULTA_OTP = "SELECT public.get_orders_by_otp_v2($1, $2, $3, $4) AS r";
const APLICADO =
  "166a-conferir-a-lista-do-painel-e-o-rastreio-levam-o-nome-antigo-da-opcao-aplicado";
const BASE =
  "166b-antes-a-lista-do-painel-e-o-rastreio-levam-o-nome-antigo-da-opcao-base-vigente";

const ler = (nome) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminhos fixos do repositório, definidos pelo teste.
  readFileSync(path.join(__dirname, "../..", nome), "utf8");

async function como(c, papel, acao) {
  await c.query("SAVEPOINT papel");
  try {
    await c.query(papel);
    const resultado = await acao();
    await c.query("RESET ROLE");
    return resultado;
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT papel");
    throw erro;
  } finally {
    await c.query("RELEASE SAVEPOINT papel");
  }
}

async function fixture(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
      VALUES ($1, 'admin-rotulos@exemplo.test', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Rótulos', 'admin')",
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo) VALUES ($1, 'Camiseta', 50, 100, true)",
    [PRODUTO],
  );
  await c.query(
    "INSERT INTO public.product_variants (id, product_id, name, value) VALUES ($1, $2, 'Cor', 'Azul')",
    [VARIACAO, PRODUTO],
  );
  const inserir = async (pedido) => {
    await c.query(
      `INSERT INTO public.marketplace_orders
       (id, customer_name, customer_phone, customer_data, total, subtotal, notes)
       VALUES ($1, 'Convidado Rótulos', $2, $3::jsonb, 50, 50, 'Nota interna da fixture')`,
      [pedido, FONE, JSON.stringify({ email: EMAIL, whatsapp: FONE })],
    );
    await c.query(
      `INSERT INTO public.marketplace_order_items
       (order_id, product_id, variant_id, product_name, quantity, price)
       VALUES ($1, $2, $3, 'Camiseta', 1, 50)`,
      [pedido, PRODUTO, VARIACAO],
    );
  };
  await inserir(COM_HISTORICO);
  await c.query(
    "UPDATE public.product_variants SET name = 'Tom', value = 'Verde' WHERE id = $1",
    [VARIACAO],
  );
  await inserir(SEM_HISTORICO);
}

async function painel(c, pedido) {
  const {
    rows: [{ r }],
  } = await como(c, "SET LOCAL ROLE authenticated", async () => {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
    return c.query(CONSULTA_PAINEL, [pedido]);
  });
  assert.equal(Number(r.total_count), 1);
  assert.deepEqual(
    r.data.map((linha) => linha.id),
    [pedido],
  );
  return r.data[0];
}

async function rastreio(c, pedido) {
  const fragmento = pedido.slice(-6);
  const {
    rows: [{ r: codigo }],
  } = await como(c, "SET LOCAL ROLE service_role", () =>
    c.query("SELECT public.generate_order_otp_v2($1, $2, $3) AS r", [
      EMAIL,
      FONE,
      fragmento,
    ]),
  );
  assert.equal(codigo.ok, true, "a fixture precisa gerar um código válido");
  const params = [EMAIL, FONE, fragmento];
  const lerComoConvidado = async (otp) =>
    (
      await como(c, "SET LOCAL ROLE anon", () =>
        c.query(CONSULTA_OTP, [...params, otp]),
      )
    ).rows[0].r;

  const incorreto = await lerComoConvidado(
    codigo.otp_code === "000000" ? "000001" : "000000",
  );
  assert.equal(incorreto.ok, false);
  assert.equal("orders" in incorreto, false);
  const r = await lerComoConvidado(codigo.otp_code);
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.orders.map((linha) => linha.id),
    [pedido],
  );
  assert.equal("notes" in r.orders[0], false);
  return r.orders[0];
}

function conferirItem(pedido, nome, valor) {
  assert.equal(pedido.items.length, 1);
  assert.equal(pedido.items[0].variant_id, VARIACAO);
  assert.equal(pedido.items[0].variacao_nome_na_compra, nome);
  assert.equal(pedido.items[0].variacao_valor_na_compra, valor);
}

async function conferirPortao(c, consulta, positivo) {
  const { rows } = await c.query(
    ler(`scripts/publicacao/consultas/${consulta}.sql`),
  );
  const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(consulta);
  assert.ok(rol, `rol ausente para ${consulta}`);
  assert.equal(estruturaDoRolFechado(rows, rol), null);
  assert.ok(rows.every((r) => typeof r.ok === "boolean"));
  assert.equal(
    rows.every((r) => r.ok),
    positivo,
    JSON.stringify(rows),
  );
}

async function atributos(c) {
  const { rows } = await c.query(
    `SELECT oid, to_jsonb(p) - 'prosrc' - 'proargdefaults' AS atributos,
            pg_get_function_arguments(oid) AS argumentos
     FROM pg_proc p WHERE oid IN (to_regprocedure($1), to_regprocedure($2))
     ORDER BY oid`,
    [PAINEL.assinatura, RASTREIO.assinatura],
  );
  assert.equal(rows.length, 2);
  return rows;
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    const topo = await atributos(c);
    await conferirPortao(c, APLICADO, true);
    await fixture(c);
    await assert.rejects(
      () =>
        como(c, "SET LOCAL ROLE anon", () =>
          c.query(CONSULTA_PAINEL, [COM_HISTORICO]),
        ),
      { code: "42501" },
    );
    await assert.rejects(
      () =>
        como(c, "SET LOCAL ROLE authenticated", () =>
          c.query(CONSULTA_PAINEL, [COM_HISTORICO]),
        ),
      /Acesso negado/,
    );
    conferirItem(await painel(c, COM_HISTORICO), "Cor", "Azul");
    conferirItem(await painel(c, SEM_HISTORICO), null, null);
    conferirItem(await rastreio(c, COM_HISTORICO), "Cor", "Azul");
    conferirItem(await rastreio(c, SEM_HISTORICO), null, null);

    await desfazerRotulosHistoricosNaTransacao(c);
    assert.deepEqual(
      await atributos(c),
      topo,
      "rollback preserva atributos, dono e ACL",
    );
    await conferirPortao(c, BASE, true);
    await conferirPortao(c, APLICADO, false);
    conferirItem(await painel(c, COM_HISTORICO), undefined, undefined);
    await c.query(
      ler(
        "supabase/migrations/20261410000000_a_lista_do_painel_e_o_rastreio_levam_o_nome_antigo_da_opcao.sql",
      ),
    );
    assert.deepEqual(
      await atributos(c),
      topo,
      "apply preserva atributos, dono e ACL",
    );
    await conferirPortao(c, APLICADO, true);
    conferirItem(await painel(c, COM_HISTORICO), "Cor", "Azul");
    console.log(
      "PASSOU: histórico, nulos, acesso, consultas de catálogo e rollback.",
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});

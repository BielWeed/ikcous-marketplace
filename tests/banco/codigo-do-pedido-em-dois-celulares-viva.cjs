"use strict";

// O RPC CI aplica todas as migrations e entrega um clone descartável.
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const PEDIDO = "21665000-0000-4000-8000-000000000001";
const TRIO = ["dois-celulares@exemplo.test", "11999990001", "000001"];
const GERAR = "SELECT public.generate_order_otp_v2($1, $2, $3) AS r";
const VERIFICAR = "SELECT public.get_orders_by_otp_v2($1, $2, $3, $4) AS r";
const INVALIDO = { ok: false, error: "Código inválido ou expirado." };

async function como(c, papel, sql, params) {
  await c.query(papel);
  try {
    return (await c.query(sql, params)).rows[0].r;
  } finally {
    await c.query("RESET ROLE").catch(() => {});
  }
}

const gerar = (c) => como(c, "SET LOCAL ROLE service_role", GERAR, TRIO);
const verificar = (c, codigo, trio = TRIO) =>
  como(c, "SET LOCAL ROLE anon", VERIFICAR, [...trio, codigo]);

async function fixture(c) {
  const [email, whatsapp] = TRIO;
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, customer_name, customer_phone, customer_data, total, subtotal)
     VALUES ($1, 'Convidado', $2, $3::jsonb, 50, 50)`,
    [PEDIDO, whatsapp, JSON.stringify({ email, whatsapp })],
  );
}

async function otp(c) {
  return (
    await c.query(
      `SELECT id, attempts, verified FROM public.otp_verifications
        WHERE order_id = $1 ORDER BY created_at DESC, id DESC`,
      [PEDIDO],
    )
  ).rows;
}

// Simula a passagem da janela de reenvio sem dormir nem mexer na validade.
const liberarReenvio = (c) =>
  c.query(
    "UPDATE public.otp_verifications SET created_at = now() - interval '61 seconds' WHERE order_id = $1",
    [PEDIDO],
  );

const outro = (codigo) => (codigo === "000000" ? "000001" : "000000");

async function doisCelulares(c) {
  const a = await gerar(c);
  assert.equal(a.ok, true);
  assert.equal((await gerar(c)).motivo, "muito_recente");
  const inicial = await otp(c);
  await liberarReenvio(c);

  const b = await gerar(c);
  assert.equal(b.ok, true);
  // A mesma linha e o mesmo prazo também tornam a prova imune à coincidência
  // acidental de o sorteio antigo gerar duas vezes os mesmos seis dígitos.
  assert.equal(b.otp_code, a.otp_code, "o segundo e-mail traz o mesmo código");
  assert.equal(b.expira_em, a.expira_em);
  assert.deepEqual(await otp(c), inicial, "o reenvio não abre outra credencial");
  assert.equal((await gerar(c)).motivo, "muito_recente");

  const r = await verificar(c, a.otp_code);
  assert.equal(r.ok, true);
  assert.deepEqual(r.orders.map((pedido) => pedido.id), [PEDIDO]);
  assert.deepEqual(await otp(c), [{ ...inicial[0], verified: true }]);
  assert.deepEqual(await verificar(c, b.otp_code), INVALIDO, "uso único");
}

async function limiteCompartilhado(c) {
  const a = await gerar(c);
  assert.equal(a.ok, true);
  const errado = outro(a.otp_code);
  const trioIncorreto = ["outra-pessoa@exemplo.test", ...TRIO.slice(1)];
  assert.deepEqual(await verificar(c, errado, trioIncorreto), INVALIDO);
  assert.equal((await otp(c))[0].attempts, 0);
  assert.deepEqual(await verificar(c, errado), { ...INVALIDO, restantes: 4 });

  await liberarReenvio(c);
  const b = await gerar(c);
  assert.equal(b.ok, true);
  assert.equal(b.otp_code, a.otp_code);
  for (const restantes of [3, 2, 1, 0]) {
    const r = await verificar(c, errado);
    assert.equal(r.ok, false);
    assert.equal(r.restantes, restantes);
  }
  const bloqueado = await verificar(c, a.otp_code);
  assert.equal(bloqueado.ok, false);
  assert.equal(bloqueado.motivo, "bloqueado_ate_expirar");
  assert.equal((await otp(c))[0].attempts, 5);
}

async function expirado(c) {
  const a = await gerar(c);
  assert.equal(a.ok, true);
  await c.query(
    "UPDATE public.otp_verifications SET expires_at = now() - interval '1 second' WHERE order_id = $1",
    [PEDIDO],
  );
  assert.deepEqual(await verificar(c, a.otp_code), INVALIDO);
  assert.equal((await otp(c))[0].attempts, 0);
  // O último envio ainda foi há menos de 60 s, mesmo com o código vencido.
  assert.equal((await gerar(c)).motivo, "muito_recente");
}

// A fixture é visível a duas conexões do clone; rodar-isolado descarta o clone.
async function simultaneos(c, connectionString) {
  await c.query("BEGIN");
  await fixture(c);
  const inicial = await gerar(c);
  assert.equal(inicial.ok, true);
  const errado = outro(inicial.otp_code);
  for (let i = 0; i < 4; i++) await verificar(c, errado);
  await liberarReenvio(c);
  await c.query("COMMIT");

  const outroCelular = new Client({ connectionString });
  await outroCelular.connect();
  const emTransacao = async (cliente, consultar) => {
    await cliente.query("BEGIN");
    try {
      const resultado = await consultar(cliente);
      await cliente.query("COMMIT");
      return resultado;
    } catch (erro) {
      await cliente.query("ROLLBACK");
      throw erro;
    }
  };
  try {
    const envios = await Promise.all([
      emTransacao(c, gerar),
      emTransacao(outroCelular, gerar),
    ]);
    assert.equal(envios.filter((r) => r.ok).length, 1);
    assert.equal(envios.find((r) => r.ok).otp_code, inicial.otp_code);
    assert.equal(envios.find((r) => !r.ok).motivo, "muito_recente");
    assert.equal((await otp(c))[0].attempts, 4);

    const resultados = await Promise.all([
      emTransacao(c, (sessao) => verificar(sessao, errado)),
      emTransacao(outroCelular, (sessao) => verificar(sessao, errado)),
    ]);
    assert.ok(resultados.every((r) => r.motivo === "bloqueado_ate_expirar"));
    assert.equal(resultados.filter((r) => r.restantes === 0).length, 1);
    assert.equal((await otp(c))[0].attempts, 5);
  } finally {
    await outroCelular.end();
  }
}

async function main() {
  const connectionString = lerDatabaseUrlEfemera();
  assert.match(new URL(connectionString).pathname, /^\/prova_/);
  const c = new Client({ connectionString });
  await c.connect();
  try {
    for (const caso of [doisCelulares, limiteCompartilhado, expirado]) {
      await c.query("BEGIN");
      try {
        await fixture(c);
        await caso(c);
      } finally {
        await c.query("ROLLBACK");
      }
    }
    await simultaneos(c, connectionString);
    console.log("PASSOU: reenvio, validade, uso único e limite compartilhado.");
  } finally {
    await c.end();
  }
}

main().catch((erro) => falhar("CÓDIGO DO PEDIDO", erro.stack ?? String(erro)));

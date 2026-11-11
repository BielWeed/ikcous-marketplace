"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja. SO TESTE: nenhum SQL de producao muda.
//
// PROVA VIVA de public.get_admin_customers_paged (corpo vivo da 20261392000000): o "Total comprado" de cada cliente
// (`total_spent`) e o LTV global (`stats.global_ltv`) so somam pagamento RECONHECIDO (pago, pago_apos_expirar,
// recebido_na_entrega) de pedido nao cancelado/devolvido. Sem o filtro, um pedido PIX aguardando ou recusado inflaria o
// "melhor cliente" da tela Clientes. Os vizinhos criam todo pedido como delivered+pago, entao o ramo ELSE nunca rodava.
//
// Cenario (valores exatos):
//   A: pago 100 + aguardando 70 (pending)      -> total_spent 100, orders_count 2
//   B: recusado 500 (pending)                  -> total_spent 0,   orders_count 1
//   C: pago_apos_expirar 40, CANCELADO         -> total_spent 0,   orders_count 0 (cancelado fica fora)
//   CONTROLE: A ganha recebido_na_entrega 30   -> total_spent 130, orders_count 3
// global_ltv e' medido por DIFERENCA (antes/depois da semente, na mesma transacao): +100 e depois +130, qualquer que seja
// o resto do banco. "Maior total comprado" (total_spent desc) poe A antes de B (e de C).
//
// Mutantes (MUTANTE_R108A=<nome>; nome desconhecido da ERRO), aplicados no clone dentro da transacao da prova, que e' desfeita:
//   ltv-sem-filtro-de-pagamento  o CASE de total_spent soma o.total de qualquer pedido
//   global-ltv-sem-filtro        v_global_ltv sem o `AND payment_status IN (...)`
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/o-total-comprado-do-cliente-so-conta-pagamento-reconhecido-viva.cjs
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const FN = "public.get_admin_customers_paged(text,text,text,integer,integer)";
const ADMIN = "e1080000-0000-4000-8000-0000000000ad";
const CLIENTE_A = "e1080000-0000-4000-8000-0000000000a1";
const CLIENTE_B = "e1080000-0000-4000-8000-0000000000b2";
const CLIENTE_C = "e1080000-0000-4000-8000-0000000000c3";
const TERMO = "R108A Fixture";

// Trechos EXATOS do corpo vivo que cada mutante remove (cada um tem de ocorrer UMA vez no pg_get_functiondef).
const MUTANTES = new Map(
  Object.entries({
    "ltv-sem-filtro-de-pagamento": [
      "WHEN o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
      "WHEN true",
    ],
    "global-ltv-sem-filtro": [
      "AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))",
      "AND true",
    ],
  }),
);

async function mutar() {
  const nome = process.env.MUTANTE_R108A;
  if (!nome) return;
  const troca = MUTANTES.get(nome);
  if (!troca) throw new Error(`MUTANTE_R108A desconhecido: ${nome}`);
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(
    original.split(troca[0]).length - 1,
    1,
    `mutante ${nome}: o alvo tem de ocorrer UMA vez no corpo vivo`,
  );
  const alterado = original.replace(troca[0], troca[1]);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function semearPessoas(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@r108a.fixture.invalid', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin R108A', 'admin')",
    [ADMIN],
  );
  for (const [id, nome] of [
    [CLIENTE_A, `${TERMO} A`],
    [CLIENTE_B, `${TERMO} B`],
    [CLIENTE_C, `${TERMO} C`],
  ]) {
    await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
      id,
      `${id.slice(0, 8)}-${id.slice(-2)}@r108a.fixture.invalid`,
    ]);
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, $2, 'customer')",
      [id, nome],
    );
  }
}

/** Um pedido: `pagamento` e' o payment_status; `status` o do pedido (pending = vivo, cancelled = fora). */
async function pedido(c, uid, total, pagamento, status = "pending") {
  const reconhecido = [
    "pago",
    "pago_apos_expirar",
    "recebido_na_entrega",
  ].includes(pagamento);
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at)
     VALUES ($1, 'x', '{}'::jsonb, $2, $2, $3, 'online', 'online', $4, CASE WHEN $5::boolean THEN now() END)`,
    [uid, total, status, pagamento, reconhecido],
  );
}

/** Chama a RPC como o admin da fixture (sessao direta, como os vizinhos). */
async function lista(termo, campo = "total_spent", direcao = "desc") {
  const [{ r }] = await P.como(
    null,
    "SELECT public.get_admin_customers_paged($1, $2, $3, 0, 1000) AS r",
    [termo, campo, direcao],
    { uid: ADMIN },
  );
  return r;
}
const linha = (r, id) => r.data.find((l) => l.id === id);
const num = (v) => Number(v);

prova(
  "total comprado e LTV global so contam pagamento reconhecido de pedido nao cancelado",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await semearPessoas(c);
      await c.query("SET LOCAL session_replication_role = replica");
      await mutar();

      // Linha de base do universo (outros pedidos do banco entram igual antes e depois da semente).
      const base = num((await lista("")).stats.global_ltv);

      await pedido(c, CLIENTE_A, 100, "pago");
      await pedido(c, CLIENTE_A, 70, "aguardando");
      await pedido(c, CLIENTE_B, 500, "recusado");
      await pedido(c, CLIENTE_C, 40, "pago_apos_expirar", "cancelled");

      const r = await lista(TERMO);
      assert.equal(r.total_count, 3, "o termo da fixture acha so A, B e C");
      const [a, b, cc] = [CLIENTE_A, CLIENTE_B, CLIENTE_C].map((id) =>
        linha(r, id),
      );
      assert.equal(
        num(a.total_spent),
        100,
        "A: so o pago conta (o aguardando de 70 nao)",
      );
      assert.equal(
        num(b.total_spent),
        0,
        "B: pedido recusado de 500 nao pode virar total comprado",
      );
      assert.equal(
        num(cc.total_spent),
        0,
        "C: pago_apos_expirar CANCELADO fica fora",
      );
      // orders_count e' do corpo vivo: conta todo pedido nao cancelado/devolvido, pago ou nao (a coluna "Pedidos").
      assert.equal(num(a.orders_count), 2);
      assert.equal(num(b.orders_count), 1);
      assert.equal(num(cc.orders_count), 0);

      // LTV global: soma so os pagos nao cancelados do universo da fixture (+100: nem 70, nem 500, nem os 40 cancelados).
      assert.equal(
        num(r.stats.global_ltv) - base,
        100,
        "global_ltv tem de crescer so com o pago nao cancelado (100)",
      );

      // "Maior total comprado": quem pagou (A) vem antes de quem so tentou (B) e de C; B e C empatam em 0 (desempate pelo id).
      assert.deepEqual(
        r.data.map((l) => l.id),
        [CLIENTE_A, CLIENTE_B, CLIENTE_C],
        "Maior total comprado: A antes de B e C",
      );
      // Na lista inteira (sem termo), A tambem tem de vir antes de B.
      const todos = await lista("");
      const pos = (id) => todos.data.findIndex((l) => l.id === id);
      assert.ok(
        pos(CLIENTE_A) >= 0 && pos(CLIENTE_A) < pos(CLIENTE_B),
        "lista inteira: A antes de B",
      );

      // CONTROLE: dinheiro recebido na entrega ENTRA.
      await pedido(c, CLIENTE_A, 30, "recebido_na_entrega");
      const r2 = await lista(TERMO);
      assert.equal(num(linha(r2, CLIENTE_A).total_spent), 130);
      assert.equal(num(linha(r2, CLIENTE_A).orders_count), 3);
      assert.equal(num(linha(r2, CLIENTE_B).total_spent), 0);
      assert.equal(num(linha(r2, CLIENTE_C).total_spent), 0);
      assert.equal(
        num(r2.stats.global_ltv) - base,
        130,
        "global_ltv: o recebido_na_entrega de 30 entra",
      );
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.executar(
      "o total comprado do cliente so conta pagamento reconhecido",
    );
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

"use strict";

/**
 * Guardas do corpo VIVO de solicitar_estorno (20261241000000), sem reaplicar
 * nem alterar migrations. Só clone do Postgres efêmero, com admin válido.
 *
 * Cada comportamento roda VERDE, VERMELHO sem a guarda, VERDE restaurado.
 * Os mutantes são publicados SOMENTE no clone descartável: a segunda conexão
 * precisa enxergar o corpo sem FOR UPDATE. O finally restaura a definição exata.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/solicitar-estorno-recusas-e-corrida-viva.cjs
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const SIG = "public.solicitar_estorno(uuid,numeric,text)";
const ADMIN = "7e7e970e-0000-4000-8000-0000000000a1";
const CLIENTE = "7e7e970e-0000-4000-8000-0000000000c1";
const CLAIMS = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
let C;
let D;

async function definicao() {
  return (
    await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [SIG])
  ).rows[0].d;
}

async function semearPessoas() {
  for (const [id, meta, papel] of [
    [ADMIN, '{"role":"admin"}', "admin"],
    [CLIENTE, "{}", "customer"],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@r97.invalid', $2::jsonb)`,
      [id, meta],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa fictícia R97', $2) ON CONFLICT (id) DO NOTHING`,
      [id, papel],
    );
  }
}

async function pedido({
  pagamento = "pago",
  status = "cancelled",
  enviado = false,
  retornou = false,
} = {}) {
  const id = randomUUID();
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping,
        status, canal, payment_method, payment_status, paid_at,
        gateway_payment_id, valor_estornado, cancelled_after_shipping, returned_to_seller_at)
     VALUES ($1, $2, 'Pessoa fictícia R97', '{}'::jsonb, 100, 100, 0,
             $3, 'online', 'online', $4,
             CASE WHEN $4 IN ('pago', 'pago_apos_expirar') THEN now() END,
             $5, 0, $6, CASE WHEN $7 THEN now() END)`,
    [id, CLIENTE, status, pagamento, `ORD-R97-${id}`, enviado, retornou],
  );
  return id;
}

/** A recusa volta ao savepoint, não derruba a transação da prova. */
async function solicitar(id, conexao = C) {
  await conexao.query("SAVEPOINT tentativa");
  try {
    await conexao.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ADMIN, CLAIMS],
    );
    await conexao.query("SET LOCAL ROLE authenticated");
    const r = await conexao.query(
      "SELECT public.solicitar_estorno($1::uuid, 60, 'Prova R97') AS r",
      [id],
    );
    await conexao.query("RESET ROLE");
    await conexao.query("RELEASE SAVEPOINT tentativa");
    return { resposta: r.rows[0].r };
  } catch (e) {
    await conexao.query("ROLLBACK TO SAVEPOINT tentativa");
    await conexao.query("RESET ROLE");
    await conexao.query("RELEASE SAVEPOINT tentativa");
    return { erro: e.message, codigo: e.code };
  }
}

async function linhas(id) {
  return (
    await C.query(
      "SELECT id, amount, status FROM public.order_refunds WHERE order_id = $1 ORDER BY id",
      [id],
    )
  ).rows;
}

async function recusa(id, frase, marcador) {
  assert.deepEqual(await linhas(id), [], "fixture já tem estorno");
  const r = await solicitar(id);
  assert.deepEqual(
    await linhas(id),
    [],
    `${marcador}: a RPC criou uma linha sem poder devolver dinheiro`,
  );
  assert.equal(r.codigo, "P0001", `${marcador}: faltou a recusa da guarda`);
  assert.match(r.erro, frase);
}

async function aceita(id) {
  const r = await solicitar(id);
  assert.equal(r.erro, undefined, `admin válido recusado: ${r.erro}`);
  assert.equal(Number(r.resposta.amount), 60);
  assert.deepEqual(await linhas(id), [
    { id: r.resposta.refund_id, amount: "60.00", status: "solicitado" },
  ]);
}

async function emTransacao(corpo) {
  await C.query("BEGIN");
  try {
    await corpo();
  } finally {
    await C.query("ROLLBACK");
  }
}

async function pagamentoInelegivel() {
  await emTransacao(async () => {
    for (const pagamento of [
      "aguardando",
      "recusado",
      "expirado",
      "estornado",
      "recebido_na_entrega",
      null,
    ]) {
      await recusa(
        await pedido({ pagamento }),
        /não está pago: não há dinheiro do Mercado Pago para devolver/,
        `PAGAMENTO_INELEGIVEL (${pagamento})`,
      );
    }
    for (const pagamento of ["pago", "pago_apos_expirar"]) {
      await aceita(await pedido({ pagamento }));
    }
  });
}

async function pedidoNaoCancelado() {
  await emTransacao(async () => {
    await recusa(
      await pedido({ status: "delivered" }),
      /Cancele o pedido antes de devolver o dinheiro/,
      "PEDIDO_NAO_CANCELADO",
    );
    await aceita(await pedido());
  });
}

async function produtoNaoRetornou() {
  await emTransacao(async () => {
    await recusa(
      await pedido({ enviado: true }),
      /A devolução espera o produto: ele ainda não voltou para a loja/,
      "PRODUTO_NAO_RETORNOU",
    );
    await aceita(await pedido({ enviado: true, retornou: true }));
  });
}

/** Observa a espera REAL da RPC de D pela transação de C, não um sleep otimista. */
async function esperandoTrava(pidD, pidC, terminou) {
  for (let i = 0; i < 200; i++) {
    const r = await C.query(
      `SELECT wait_event_type = 'Lock' AND $2::int = ANY(pg_blocking_pids(pid)) AS espera
         FROM pg_stat_activity WHERE pid = $1`,
      [pidD, pidC],
    );
    if (r.rows[0]?.espera) return true;
    if (terminou()) return false;
    await new Promise((resolver) => setTimeout(resolver, 25));
  }
  return false;
}

async function saldoSerializado() {
  // A fixture fica visível nas DUAS conexões antes da corrida; só no clone.
  const id = await pedido();
  const pidC = (await C.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  const pidD = (await D.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  assert.notEqual(pidC, pidD, "a corrida precisa de duas conexões reais");
  let abertaC = false;
  let abertaD = false;
  let pendente;
  let terminou = false;
  try {
    await C.query("BEGIN");
    abertaC = true;
    const primeira = await solicitar(id);
    assert.equal(primeira.erro, undefined);
    assert.equal(Number(primeira.resposta.amount), 60);
    await D.query("BEGIN");
    abertaD = true;
    pendente = solicitar(id, D).then(
      (r) => {
        terminou = true;
        return r;
      },
      (e) => {
        terminou = true;
        throw e;
      },
    );
    // Registra a falha sem deixar uma rejeição solta durante a sondagem.
    pendente.catch(() => {});
    const esperou = await esperandoTrava(pidD, pidC, () => terminou);
    await C.query("COMMIT");
    abertaC = false;
    const segunda = await pendente;
    await D.query("COMMIT");
    abertaD = false;
    const reservas = await linhas(id);
    const total = reservas.reduce((soma, r) => soma + Number(r.amount), 0);
    assert.ok(
      total <= 100,
      `SALDO_SERIALIZADO: duas chamadas de 60 reservaram ${total} num saldo de 100`,
    );
    assert.ok(
      esperou,
      "SALDO_SERIALIZADO: a segunda RPC não esperou a primeira",
    );
    assert.equal(segunda.codigo, "P0001");
    assert.match(segunda.erro, /maior que o valor disponível para devolver/);
    assert.deepEqual(reservas, [
      {
        id: primeira.resposta.refund_id,
        amount: "60.00",
        status: "solicitado",
      },
    ]);
    const saldo = await C.query(
      "SELECT public.pedido__saldo_a_estornar($1) AS s",
      [id],
    );
    assert.equal(Number(saldo.rows[0].s), 40);
  } finally {
    // Solta C ANTES de aguardar D: também limpa quando uma asserção falha.
    if (abertaC) await C.query("ROLLBACK");
    if (pendente) await pendente.catch(() => {});
    if (abertaD) await D.query("ROLLBACK");
  }
}

const GUARDAS = [
  {
    nome: "pagamento inelegível ou nulo não cria estorno; pago e pago após expirar passam",
    testar: pagamentoInelegivel,
    marcador: /^PAGAMENTO_INELEGIVEL/,
    de: `    IF v_payment_status IS NULL
       OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
        RAISE EXCEPTION 'Este pedido não está pago: não há dinheiro do Mercado Pago para devolver.'
            USING ERRCODE = 'P0001';
    END IF;`,
    para: "",
  },
  {
    nome: "pagamento NULL é recusado mesmo com os outros estados filtrados",
    testar: pagamentoInelegivel,
    marcador: /^PAGAMENTO_INELEGIVEL \(null\)/,
    de: "IF v_payment_status IS NULL\n       OR v_payment_status NOT IN",
    para: "IF v_payment_status NOT IN",
  },
  {
    nome: "pedido entregue e pago não cria estorno; cancelado passa",
    testar: pedidoNaoCancelado,
    marcador: /^PEDIDO_NAO_CANCELADO/,
    de: `    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Cancele o pedido antes de devolver o dinheiro.';
    END IF;`,
    para: "",
  },
  {
    nome: "produto enviado sem retorno não cria estorno; devolvido passa",
    testar: produtoNaoRetornou,
    marcador: /^PRODUTO_NAO_RETORNOU/,
    de: `    IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN
        RAISE EXCEPTION 'A devolução espera o produto: ele ainda não voltou para a loja.'
            USING ERRCODE = 'P0001';
    END IF;`,
    para: "",
  },
  {
    nome: "duas solicitações de 60 disputam saldo 100: a segunda espera e recusa",
    testar: saldoSerializado,
    marcador: /^SALDO_SERIALIZADO: duas chamadas de 60 reservaram 120/,
    de: "       FOR UPDATE;",
    para: ";",
  },
];

async function provarGuarda(g, original) {
  await g.testar();
  console.log(`  VERDE    ${g.nome}`);
  const normalizada = original.replace(/\r\n/g, "\n");
  assert.equal(
    normalizada.split(g.de).length - 1,
    1,
    `mutante: a âncora precisa casar exatamente 1x: ${g.nome}`,
  );
  const mutante = normalizada.replace(g.de, () => g.para);
  assert.notEqual(mutante, normalizada);
  let pego;
  try {
    // COMMIT implícito apenas no CLONE; o corpo precisa ser visto pela RPC de D.
    await C.query(mutante);
    assert.equal(await definicao(), mutante, "o mutante não entrou no banco");
    try {
      await g.testar();
    } catch (e) {
      pego = e;
    }
  } finally {
    await C.query(original);
    assert.equal(
      await definicao(),
      original,
      "o corpo vivo não foi restaurado",
    );
  }
  assert.ok(
    pego instanceof assert.AssertionError,
    `MUTANTE SOBREVIVEU ou erro SQL: ${pego?.stack}`,
  );
  assert.match(pego.message, g.marcador, "o mutante caiu pelo motivo errado");
  console.log(`  VERMELHO mutante: ${pego.message.split("\n")[0]}`);
  await g.testar();
  console.log(`  VERDE    restaurado: ${g.nome}`);
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url, statement_timeout: 10000 });
  D = new Client({ connectionString: url, statement_timeout: 10000 });
  try {
    await C.connect();
    const db = (await C.query("SELECT current_database() AS d")).rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    await D.connect();
    const original = await definicao();
    const hash = await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    );
    console.log(`Corpo VIVO de solicitar_estorno: ${hash.rows[0].h}`);
    await semearPessoas();
    for (const g of GUARDAS) await provarGuarda(g, original);
    console.log(
      "\nsolicitar-estorno-recusas-e-corrida-viva: 5/5 controles mortos; verde/vermelho/verde",
    );
  } finally {
    await C.end().catch(() => {});
    await D.end().catch(() => {});
  }
}

main().catch((erro) => falhar("SOLICITAR-ESTORNO", erro.stack ?? String(erro)));

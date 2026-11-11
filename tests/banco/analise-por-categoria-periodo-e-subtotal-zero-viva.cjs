"use strict";

/**
 * RPC VIVA: get_category_analytics (ultima redefinicao: 20261199000000).
 * Periodo fechado nos dois extremos e subtotal zero sem dividir por zero.
 * Somente clone prova_*; fixtures e mutante desfeitos no ROLLBACK de cada caso.
 *
 * node tests/banco/rodar-isolado.cjs tests/banco/analise-por-categoria-periodo-e-subtotal-zero-viva.cjs
 * MUTANTE=0 (padrao): corpo vivo.
 * MUTANTE=1 + GUARDA_CATEGORIA=inicio|fim|receita|ticket: sabota UMA guarda
 * dentro da transacao, comprova a instalacao e deixa a mesma prova VERMELHA.
 * Nunca edita a migration nem aceita banco real (efemero.cjs).
 */

const { randomUUID } = require("node:crypto");
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const SIG =
  "public.get_category_analytics(timestamp with time zone,timestamp with time zone)";
const ADMIN = "ca100000-0000-4000-8000-000000000001";
const CLIENTE = "ca100000-0000-4000-8000-000000000002";
const CATEGORIA = "Categoria ficticia periodo e zero";
const INICIO = "2026-03-10T12:00:00.000Z";
const FIM = "2026-03-10T13:00:00.000Z";
const DENTRO = "2026-03-10T12:30:00.000Z";
const SQL =
  "SELECT * FROM public.get_category_analytics($1::timestamptz, $2::timestamptz)";
const IDENTIDADE = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};
const MUTANTE = process.env.MUTANTE || "0";
const GUARDA = process.env.GUARDA_CATEGORIA || "";
let original;

async function definicao() {
  const r = await P.conexao().query(
    "SELECT pg_get_functiondef(to_regprocedure($1)) AS d",
    [SIG],
  );
  assert.equal(typeof r.rows[0].d, "string", "RPC viva nao encontrada");
  return r.rows[0].d;
}

async function mutar() {
  const corpo = P.norm(original);
  let alterado;
  if (GUARDA === "inicio" || GUARDA === "fim") {
    const trecho =
      GUARDA === "inicio"
        ? "o.created_at >= start_date"
        : "o.created_at <= end_date";
    assert.equal(
      corpo.split(trecho).length - 1,
      1,
      "mutante: filtro do periodo precisa casar exatamente uma vez",
    );
    alterado = corpo.replace(trecho, "true");
  } else {
    const denominador = "NULLIF(f.subtotal_pedido, 0)";
    const partes = corpo.split(denominador);
    assert.equal(
      partes.length,
      3,
      "mutante: precisam existir exatamente dois NULLIF no corpo vivo",
    );
    // A primeira ocorrencia protege a receita; a segunda protege o ticket.
    // Preserva integralmente a outra ocorrencia, sem mutacao dupla.
    alterado =
      GUARDA === "receita"
        ? `${partes[0]}f.subtotal_pedido${partes[1]}${denominador}${partes[2]}`
        : `${partes[0]}${denominador}${partes[1]}f.subtotal_pedido${partes[2]}`;
  }
  assert.notEqual(alterado, corpo, "mutante nao alterou o corpo");
  await P.conexao().query(alterado);
  assert.equal(
    P.norm(await definicao()),
    alterado,
    "mutante nao entrou no clone",
  );
  console.log(`  MUTANTE APLICADO: ${GUARDA}`);
}

async function semear() {
  const c = P.conexao();
  for (const [id, papel] of [
    [ADMIN, "admin"],
    [CLIENTE, "customer"],
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@categoria.example.invalid', $2::jsonb)`,
      [id, JSON.stringify({ role: papel })],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa ficticia', $2) ON CONFLICT (id) DO NOTHING`,
      [id, papel],
    );
  }
  const produto = randomUUID();
  await c.query(
    `INSERT INTO public.produtos
       (id, nome, categoria, preco_venda, custo, estoque, ativo)
     VALUES ($1, 'Produto ficticio', $2, 100, 40, 100, true)`,
    [produto, CATEGORIA],
  );
  return produto;
}

async function pedido(produto, data, valor) {
  const id = randomUUID();
  await P.conexao().query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping,
        discount, status, canal, payment_method, payment_status, created_at)
     VALUES ($1, $2, 'Pessoa ficticia', '{}'::jsonb, $3, $3, 0,
             0, 'delivered', 'online', 'online', 'pago', $4::timestamptz)`,
    [id, CLIENTE, valor, data],
  );
  await P.conexao().query(
    `INSERT INTO public.marketplace_order_items
       (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Produto ficticio', 1, $3)`,
    [id, produto, valor],
  );
}

async function consultar() {
  // SAVEPOINT permite transformar o 22012 em falha de assercao identificada,
  // sem esconder o erro original num RESET ROLE de transacao abortada.
  const r = await P.tentar("authenticated", SQL, [INICIO, FIM], IDENTIDADE);
  assert.equal(
    r.codigo,
    undefined,
    `RPC_SEM_DIVISAO_POR_ZERO: ${r.codigo}: ${r.erro}`,
  );
  // Nao converter null em Number(null) = 0: esse seria um falso verde.
  const linhas = r.linhas.map((linha) => ({
    categoria: linha.name,
    receita: linha.value === null ? null : Number(linha.value),
    pedidos: Number(linha.orders),
    ticket: linha.avg_ticket === null ? null : Number(linha.avg_ticket),
  }));
  console.log(`  RPC OBSERVADA: ${JSON.stringify(linhas)}`);
  return linhas;
}

function caso(nome, executar) {
  prova(nome, async () => {
    try {
      await P.emTransacao(async () => {
        if (MUTANTE === "1") await mutar();
        const produto = await semear();
        await executar(produto);
      });
    } finally {
      assert.equal(
        await definicao(),
        original,
        "ROLLBACK nao restaurou o corpo vivo",
      );
    }
  });
}

caso(
  "periodo inclui os dois limites, mas exclui pagos antes e depois",
  async (produto) => {
    // Todos pagos e da mesma categoria: so a data pode excluir os extremos.
    // Valores distintos: sem inicio -> 650/4; sem fim -> 1100/4.
    for (const [data, valor] of [
      ["2026-03-10T11:59:59.999Z", 50],
      [INICIO, 100],
      [DENTRO, 200],
      [FIM, 300],
      ["2026-03-10T13:00:00.001Z", 500],
    ]) {
      await pedido(produto, data, valor);
    }
    assert.deepEqual(
      await consultar(),
      [{ categoria: CATEGORIA, receita: 600, pedidos: 3, ticket: 200 }],
      "PERIODO_FECHADO: so 100 + 200 + 300, tres pedidos, ticket 200",
    );
  },
);

caso(
  "subtotal zero nao falha nem apaga as outras vendas da categoria",
  async (produto) => {
    await pedido(produto, DENTRO, 0);
    // Caracterizacao do corpo atual: 0/NULL e SUM so de NULL devolvem NULL,
    // mas COUNT continua incluindo o pedido. Nao normalizar isso para zero.
    assert.deepEqual(
      await consultar(),
      [{ categoria: CATEGORIA, receita: null, pedidos: 1, ticket: null }],
      "RATEIO_NULO: pedido sem subtotal deve ser contado sem receita inventada",
    );
    await pedido(produto, DENTRO, 100);
    await pedido(produto, DENTRO, 200);
    // SUM ignora o rateio NULL; COUNT inclui o pedido zero: 300 / 3 = 100.
    assert.deepEqual(
      await consultar(),
      [{ categoria: CATEGORIA, receita: 300, pedidos: 3, ticket: 100 }],
      "VENDAS_PRESERVADAS: subtotal zero nao pode apagar os 300 das vendas",
    );
  },
);

async function main() {
  assert.ok(["0", "1"].includes(MUTANTE), "MUTANTE deve ser 0 ou 1");
  if (MUTANTE === "1") {
    assert.ok(
      ["inicio", "fim", "receita", "ticket"].includes(GUARDA),
      "MUTANTE=1 exige GUARDA_CATEGORIA=inicio|fim|receita|ticket",
    );
  }
  await P.conectar();
  try {
    const db = (await P.conexao().query("SELECT current_database() AS d"))
      .rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    original = await definicao();
    await P.executar("analise por categoria: periodo e subtotal zero");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) =>
  P.falhar("ANALISE-POR-CATEGORIA", erro.stack ?? String(erro)),
);

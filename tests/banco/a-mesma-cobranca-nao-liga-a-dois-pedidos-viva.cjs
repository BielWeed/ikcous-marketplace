"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja. SO TESTE: nenhum SQL de producao muda.
//
// PROVA VIVA do indice idx_marketplace_orders_gateway_payment_id (20260807000000_reserva_com_expiracao.sql:27):
//   CREATE UNIQUE INDEX ... ON marketplace_orders (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL
// Uma cobranca do Mercado Pago (gateway_payment_id) pertence a UM unico pedido. Sem o indice, o webhook/a reconciliacao poderia
// marcar como pago um pedido que nao recebeu o dinheiro, e o cancelamento poderia estornar a cobranca errada. Ate aqui so havia
// um comentario em cancelar-pedido-viva.cjs; nenhum teste provocava a colisao nem esperava o 23505 deste indice.
//
// Cenarios (cada um numa transacao DESFEITA; a gravacao que falha roda em SAVEPOINT, so ela e' desfeita):
//   1  P1 grava 'R110B-0001' (ok); gravar o MESMO valor em P2 (UPDATE) e num P3 novo (INSERT) -> 23505 nesse indice;
//      P1 continua com o valor e P2 com NULL (nada de P3)
//   2  CONTROLE: ids diferentes em P1 e P2 passam
//   3  CONTROLE: dois pedidos com gateway_payment_id NULL passam (e um terceiro com valor tambem)
//   4  o mesmo valor reaplicado no PROPRIO P1 (UPDATE idempotente) passa; e o valor de P1 liberado (NULL) pode ir a P2
//   5  o indice existe, e' UNIQUE, parcial (WHERE gateway_payment_id IS NOT NULL), de uma coluna so, sem NULLS NOT DISTINCT
//
// Mutantes (MUTANTE_R110B=<nome>; nome desconhecido da ERRO), aplicados no clone dentro da transacao da prova, que e' desfeita:
//   sem-indice-da-cobranca       DROP INDEX             -> vermelho nos cenarios 1 e 5 (a colisao deixa de dar 23505)
//   indice-nao-unico             recria sem UNIQUE      -> vermelho nos cenarios 1 e 5
//   indice-nao-parcial           recria sem o WHERE     -> vermelho no cenario 5 (so ele: no Postgres, NULL nunca colide num
//                                                          UNIQUE comum, entao o comportamento dos cenarios 1-4 nao muda)
//   indice-nulls-nao-distintos   sem o WHERE e com NULLS NOT DISTINCT (PG15+) -> vermelho nos cenarios 3 e 5: dois NULL colidem
//                                (e' o mutante que faz o cenario 3 cair de verdade; o "sem WHERE" puro e' equivalente em comportamento)
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/a-mesma-cobranca-nao-liga-a-dois-pedidos-viva.cjs
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const INDICE = "idx_marketplace_orders_gateway_payment_id";
const USUARIO = "e1100000-0000-4000-8000-0000000000a1";
const COBRANCA = "R110B-0001";
const OUTRA_COBRANCA = "R110B-0002";

const LER_INDICE =
  "SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1";

// Trechos EXATOS da definicao viva (pg_get_indexdef) que cada mutante troca (cada um tem de ocorrer UMA vez).
const SEM_WHERE = " WHERE (gateway_payment_id IS NOT NULL)";
const MUTANTES = new Map(
  Object.entries({
    "sem-indice-da-cobranca": null,
    "indice-nao-unico": [["CREATE UNIQUE INDEX", "CREATE INDEX"]],
    "indice-nao-parcial": [[SEM_WHERE, ""]],
    "indice-nulls-nao-distintos": [
      [SEM_WHERE, ""],
      ["(gateway_payment_id)", "(gateway_payment_id) NULLS NOT DISTINCT"],
    ],
  }),
);

async function mutar() {
  const nome = process.env.MUTANTE_R110B;
  if (!nome) return;
  if (!MUTANTES.has(nome))
    throw new Error(`MUTANTE_R110B desconhecido: ${nome}`);
  const c = P.conexao();
  const [{ def: original }] = (await c.query(LER_INDICE, [INDICE])).rows;
  assert.ok(original, `mutante ${nome}: o indice vivo tem de existir antes`);
  const trocas = MUTANTES.get(nome);
  await c.query(`DROP INDEX public.${INDICE}`);
  if (trocas) {
    // pg_get_indexdef nao tem \r, mas a regra do vizinho vale: o alvo tem de aparecer UMA vez.
    let alterado = original;
    for (const [alvo, novo] of trocas) {
      assert.equal(
        alterado.split(alvo).length - 1,
        1,
        `mutante ${nome}: o alvo '${alvo}' tem de ocorrer UMA vez em ${original}`,
      );
      alterado = alterado.replace(alvo, novo);
    }
    assert.notEqual(alterado, original, "sabotagem nao aplicada");
    await c.query(alterado);
  }
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function semearUsuario(c) {
  await c.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'cliente@r110b.fixture.invalid')",
    [USUARIO],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente R110B', 'customer')",
    [USUARIO],
  );
}

const INSERIR = `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, gateway_payment_id)
     VALUES ($1, 'x', '{}'::jsonb, 100, 100, 'pending', 'online', 'online', 'aguardando', $2)`;

/** Um pedido valido (campos NOT NULL e CHECKs vivos, como os vizinhos); `cobranca` = gateway_payment_id (null = sem cobranca). */
async function pedido(c, cobranca = null) {
  const { rows } = await c.query(`${INSERIR} RETURNING id`, [
    USUARIO,
    cobranca,
  ]);
  return rows[0].id;
}

const gravar = (id, cobranca) =>
  P.tentar(
    null,
    "UPDATE public.marketplace_orders SET gateway_payment_id = $2 WHERE id = $1",
    [id, cobranca],
  );

const cobrancaDe = async (c, id) =>
  (
    await c.query(
      "SELECT gateway_payment_id AS g FROM public.marketplace_orders WHERE id = $1",
      [id],
    )
  ).rows[0].g;

/** A colisao tem de ser 23505 e NESTE indice (nao outra restricao que por acaso recuse). */
function colidiu(r, quem) {
  assert.ok(
    !r.linhas,
    `${quem}: gravar a cobranca repetida devia ser recusado`,
  );
  assert.equal(r.codigo, "23505", `${quem}: ${r.erro}`);
  assert.equal(r.restricao, INDICE, `${quem}: o 23505 tem de ser deste indice`);
}

/** Transacao desfeita com o usuario semeado, gatilhos fora (como os vizinhos) e o mutante (se pedido) ja aplicado. */
const emTransacao = (fn) =>
  P.emTransacao(async () => {
    const c = P.conexao();
    await semearUsuario(c);
    await c.query("SET LOCAL session_replication_role = replica");
    await mutar();
    await fn(c);
  });

prova("1: a mesma cobranca em dois pedidos e recusada (23505 no indice)", () =>
  emTransacao(async (c) => {
    const p1 = await pedido(c);
    const p2 = await pedido(c);
    const ok = await gravar(p1, COBRANCA);
    assert.ok(ok.linhas, `P1 tem de aceitar a cobranca: ${ok.erro}`);

    colidiu(await gravar(p2, COBRANCA), "UPDATE em P2");
    // Pela via do INSERT direto (o pedido nasce ja com a cobranca repetida).
    const ins = await P.tentar(null, INSERIR, [USUARIO, COBRANCA]);
    colidiu(ins, "INSERT de P3");

    assert.equal(await cobrancaDe(c, p1), COBRANCA, "P1 segue com a cobranca");
    assert.equal(await cobrancaDe(c, p2), null, "P2 segue sem cobranca");
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM public.marketplace_orders WHERE gateway_payment_id = $1",
      [COBRANCA],
    );
    assert.equal(rows[0].n, 1, "so um pedido do clone liga a esta cobranca");
  }),
);

prova("2: controle - cobrancas diferentes em pedidos diferentes passam", () =>
  emTransacao(async (c) => {
    const p1 = await pedido(c);
    const p2 = await pedido(c);
    assert.ok((await gravar(p1, COBRANCA)).linhas);
    assert.ok((await gravar(p2, OUTRA_COBRANCA)).linhas);
    assert.equal(await cobrancaDe(c, p1), COBRANCA);
    assert.equal(await cobrancaDe(c, p2), OUTRA_COBRANCA);
  }),
);

prova("3: controle - pedidos sem cobranca (NULL) nao colidem entre si", () =>
  emTransacao(async (c) => {
    // Dois (e um terceiro) pedidos sem cobranca: o indice e' parcial, NULL nunca e' "a mesma cobranca".
    const p1 = await pedido(c, null);
    const segundo = await P.tentar(null, INSERIR, [USUARIO, null]);
    assert.ok(
      segundo.linhas,
      `dois pedidos sem cobranca nao podem colidir: ${segundo.erro}`,
    );
    const p3 = await pedido(c, COBRANCA);
    assert.equal(await cobrancaDe(c, p1), null);
    assert.equal(await cobrancaDe(c, p3), COBRANCA);
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM public.marketplace_orders WHERE user_id = $1 AND gateway_payment_id IS NULL",
      [USUARIO],
    );
    assert.equal(rows[0].n, 2, "P1 e o segundo pedido, ambos sem cobranca");
    // Voltar uma cobranca a NULL tambem e' livre, mesmo havendo outro NULL.
    assert.ok((await gravar(p3, null)).linhas);
    assert.equal(await cobrancaDe(c, p3), null);
  }),
);

prova(
  "4: o mesmo valor no proprio pedido passa (idempotente) e a cobranca liberada pode mudar de pedido",
  () =>
    emTransacao(async (c) => {
      const p1 = await pedido(c);
      const p2 = await pedido(c);
      assert.ok((await gravar(p1, COBRANCA)).linhas);
      // O webhook repete a notificacao: regravar a mesma cobranca no MESMO pedido nao e' colisao.
      const de_novo = await gravar(p1, COBRANCA);
      assert.ok(de_novo.linhas, `reaplicar no proprio P1: ${de_novo.erro}`);
      assert.equal(await cobrancaDe(c, p1), COBRANCA);
      // Solta de P1 e liga a P2: so a vaga liberada e' reaproveitavel (nao e' uma segunda ligacao simultanea).
      assert.ok((await gravar(p1, null)).linhas);
      assert.ok((await gravar(p2, COBRANCA)).linhas);
      assert.equal(await cobrancaDe(c, p2), COBRANCA);
      colidiu(await gravar(p1, COBRANCA), "P1 de volta com a cobranca de P2");
    }),
);

prova("5: o indice existe, e UNIQUE e e parcial em gateway_payment_id", () =>
  emTransacao(async (c) => {
    const { rows } = await c.query(
      `SELECT i.indisunique, i.indnatts, a.attname,
              pg_get_expr(i.indpred, i.indrelid) AS predicado,
              pg_get_indexdef(i.indexrelid) AS def,
              t.relname AS tabela
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
        WHERE n.nspname = 'public' AND c.relname = $1`,
      [INDICE],
    );
    assert.equal(rows.length, 1, `o indice ${INDICE} tem de existir`);
    const [ix] = rows;
    assert.equal(ix.tabela, "marketplace_orders");
    assert.equal(ix.indnatts, 1, "o indice cobre uma coluna so");
    assert.equal(ix.attname, "gateway_payment_id");
    assert.equal(ix.indisunique, true, "o indice tem de ser UNIQUE");
    assert.ok(ix.predicado, "o indice tem de ser parcial (WHERE)");
    assert.match(ix.predicado, /^\(?gateway_payment_id IS NOT NULL\)?$/);
    assert.doesNotMatch(
      ix.def,
      /NULLS NOT DISTINCT/i,
      "NULL repetido nao pode contar como colisao",
    );
  }),
);

async function main() {
  await P.conectar();
  try {
    await P.executar("a mesma cobranca nao liga a dois pedidos");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

"use strict";

// Corpo VIVO da 20261280 (nove argumentos; nenhuma sucessora redefine a RPC do balcao).
// So clone descartavel do rodar-isolado.cjs (CI_BANCO_EFEMERO=1 + localhost); tudo volta no ROLLBACK.
// Sem a guarda de desconto negativo, a venda de R$100 com desconto -10 nasceria por R$110.
// Sem a guarda da forma de pagamento, 'misto' nasceria como venda do balcao.
// MUTANTE_R100=<nome> remove SOMENTE a guarda da prova correspondente (alvo unico, instalacao confirmada).
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b102c000-0000-4000-8000-000000000001";
const PRODUTO = "b102c000-0000-4000-8000-000000000010";
const SIG =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)";
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};
const ITENS = JSON.stringify([
  { product_id: PRODUTO, variant_id: null, quantity: 1 },
]);
const MENSAGEM_DESCONTO = "O desconto não pode ser negativo.";
const MENSAGEM_PAGAMENTO = "Forma de pagamento inválida para venda no balcão.";
const MUTANTES = new Map(
  Object.entries({
    "balcao-aceita-desconto-negativo": `        IF v_desconto < 0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='${MENSAGEM_DESCONTO}';
        END IF;
`,
    "balcao-aceita-qualquer-forma-de-pagamento": `        IF p_pagamento IS NULL OR p_pagamento NOT IN ('cash','pix','card') THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='${MENSAGEM_PAGAMENTO}';
        END IF;
`,
  }),
);

async function mutar(nome) {
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [SIG])
  ).rows[0].d.replace(/\r/g, "");
  assert.ok(
    original.includes("p_total_esperado"),
    "a prova exige o corpo vivo da 280 (nove argumentos)",
  );
  const trecho = MUTANTES.get(nome);
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, "");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [SIG])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function semear() {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,'admin@r102c.fixture.invalid',$2::jsonb)",
    [ADMIN, JSON.stringify({ role: "admin" })],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Admin ficticio','admin')",
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo,custo) VALUES ($1,'Produto ficticio',100,10,true,40)",
    [PRODUTO],
  );
}

// Tudo o que uma venda do balcao escreve: se algo mudar, a recusa nao foi limpa.
async function fotografar() {
  return (
    await P.conexao().query(`SELECT
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.produtos p) AS produtos,
      (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.product_variants v) AS grade,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.marketplace_orders o) AS pedidos,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.marketplace_order_items i) AS itens,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.marketplace_order_history h) AS historico,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.marketplace_order_payment_history h) AS pagamentos,
      (SELECT jsonb_agg(to_jsonb(n) ORDER BY order_id) FROM public.marketplace_order_internal_notes n) AS notas,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.fin_lancamentos l) AS financeiro`)
  ).rows[0];
}

let sequencia = 0;
const chave = () =>
  `b102c000-0000-4000-9000-${String(++sequencia).padStart(12, "0")}`;

const SQL = `SELECT public.registrar_venda_presencial(
  $1::jsonb, $2::text, NULL::uuid, 'Cliente ficticio', NULL,
  $3::numeric, $4::text, $5::uuid, NULL::numeric) AS r`;
const vender = (pagamento, desconto, motivo) =>
  P.tentar(
    "authenticated",
    SQL,
    [ITENS, pagamento, desconto, motivo, chave()],
    SESSAO,
  );
const totalGravado = (r) => r.linhas?.[0]?.r?.order?.total;

prova(
  "desconto negativo recusa 22023 sem escrever nada; desconto positivo e zero seguem aceitos",
  () =>
    P.emTransacao(async () => {
      await semear();
      const antes = await fotografar();
      await mutar("balcao-aceita-desconto-negativo");

      const negativo = await vender("cash", -10, null);
      assert.equal(
        negativo.codigo,
        "22023",
        `desconto -10 foi aceito e a venda de R$100 nasceu por R$${totalGravado(negativo)} (erro: ${negativo.erro})`,
      );
      assert.equal(negativo.erro, MENSAGEM_DESCONTO);
      assert.deepEqual(
        await fotografar(),
        antes,
        "a recusa escreveu pedido, estoque ou historico",
      );

      // Borda: o menor desconto negativo representavel (um centavo) tambem recusa.
      const centavo = await vender("cash", -0.01, null);
      assert.equal(centavo.codigo, "22023", centavo.erro);
      assert.equal(centavo.erro, MENSAGEM_DESCONTO);
      assert.deepEqual(
        await fotografar(),
        antes,
        "o centavo negativo escreveu",
      );

      // Controles: mesma chamada, so o sinal do desconto muda.
      const comDesconto = await vender("cash", 10, "Fidelidade ficticia");
      assert.equal(comDesconto.codigo, undefined, comDesconto.erro);
      assert.equal(Number(totalGravado(comDesconto)), 90);
      const semDesconto = await vender("cash", 0, null);
      assert.equal(semDesconto.codigo, undefined, semDesconto.erro);
      assert.equal(Number(totalGravado(semDesconto)), 100);
      const depois = await fotografar();
      assert.equal(depois.pedidos.length, 2, "so as duas vendas validas");
      assert.equal(depois.produtos[0].estoque, 8);
    }),
);

prova(
  "forma de pagamento fora de cash/pix/card recusa 22023 sem escrever nada; as tres validas seguem aceitas",
  () =>
    P.emTransacao(async () => {
      await semear();
      const antes = await fotografar();
      await mutar("balcao-aceita-qualquer-forma-de-pagamento");

      const misto = await vender("misto", 0, null);
      assert.equal(
        misto.codigo,
        "22023",
        `pagamento 'misto' foi aceito e a venda nasceu (erro: ${misto.erro})`,
      );
      assert.equal(misto.erro, MENSAGEM_PAGAMENTO);
      assert.deepEqual(
        await fotografar(),
        antes,
        "a recusa escreveu pedido, estoque ou historico",
      );

      // Bordas da mesma guarda: caixa diferente, forma legada e ausente.
      for (const invalida of ["CASH", "na_entrega", null]) {
        const r = await vender(invalida, 0, null);
        assert.equal(r.codigo, "22023", `${invalida}: ${r.erro}`);
        assert.equal(r.erro, MENSAGEM_PAGAMENTO);
      }
      assert.deepEqual(await fotografar(), antes, "uma borda escreveu");

      for (const valida of ["cash", "pix", "card"]) {
        const r = await vender(valida, 0, null);
        assert.equal(r.codigo, undefined, `${valida}: ${r.erro}`);
        assert.equal(r.linhas[0].r.order.payment_method, valida);
        assert.equal(Number(totalGravado(r)), 100);
      }
      const depois = await fotografar();
      assert.equal(depois.pedidos.length, 3, "so as tres vendas validas");
      assert.equal(depois.produtos[0].estoque, 7);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("balcao recusa desconto negativo e pagamento invalido");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

"use strict";

// Corpo VIVO de `create_marketplace_order_v23` (a porta do "pagar na entrega ou na retirada"), sem migration nova.
// So clone descartavel do rodar-isolado.cjs (CI_BANCO_EFEMERO=1 + localhost); tudo volta no ROLLBACK de cada caso.
// Sem a guarda do endereco fisico da loja, um pedido de RETIRADA nasceria sem local de retirada: o cliente iria buscar
// onde ninguem sabe, e o retrato `pickup_address` do pedido ficaria vazio.
// Quem tinha prova da recusa por endereco ausente era so a v24 (invariantes-dinheiro.cjs); a v23 so tinha o caso feliz.
// MUTANTE_R106O=<nome> remove SOMENTE a guarda da prova (alvo unico, instalacao confirmada, nome desconhecido recusa).
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const U = "b106c000-0000-4000-8000-000000000001";
const PRODUTO = "b106c000-0000-4000-8000-000000000010";
const SIG =
  "public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const ENDERECO = "Rua Ficticia da Loja, 100 - Centro";
const ESTOQUE_INICIAL = 10;
const FRASE =
  "Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.";
const DETAIL =
  "Retirada na loja exige o endereço físico da loja (store_address) preenchido.";

const GUARDA = `        IF NULLIF(btrim(COALESCE(v_store_config.store_address, '')), '') IS NULL THEN
            RAISE EXCEPTION '${FRASE}'
                USING DETAIL = '${DETAIL}';
        END IF;
`;
const MUTANTES = new Map([["retirada-sem-guarda-de-endereco", GUARDA]]);
const MUTANTE = process.env.MUTANTE_R106O;
// Nome desconhecido passaria em silencio como "sem mutante": aqui ele e' erro.
assert.ok(
  !MUTANTE || MUTANTES.has(MUTANTE),
  `MUTANTE_R106O desconhecido: ${MUTANTE}`,
);

async function mutar() {
  if (!MUTANTE) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [SIG])
  ).rows[0].d.replace(/\r/g, "");
  const trecho = MUTANTES.get(MUTANTE);
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${MUTANTE}: a guarda deve ocorrer uma vez na v23 viva`,
  );
  const alterado = original.replace(trecho, () => "");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [SIG])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${MUTANTE}`);
}

/** Pessoa, produto e a loja em "Entrego e retiro" (a retirada esta habilitada), com o endereco pedido. */
async function semear(endereco) {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'cliente@r106o.fixture.invalid', '{}'::jsonb)",
    [U],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente ficticio', 'customer')",
    [U],
  );
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national',
        true, ARRAY['pix', 'card', 'cash'], $1, ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`,
    [endereco],
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Produto ficticio', 100, $2, true, 40, false)",
    [PRODUTO, ESTOQUE_INICIAL],
  );
  await mutar();
}

const definirEndereco = (endereco) =>
  P.conexao().query(
    "UPDATE public.store_config SET store_address = $1 WHERE id = 1",
    [endereco],
  );

/** Tudo o que uma compra escreve: se algo mudar, a recusa nao foi limpa. */
async function fotografar() {
  return (
    await P.conexao().query(`SELECT
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.produtos p) AS produtos,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.marketplace_orders o) AS pedidos,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.marketplace_order_items i) AS itens,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.marketplace_order_history h) AS historico`)
  ).rows[0];
}
const estoque = async () =>
  Number(
    (
      await P.conexao().query(
        "SELECT estoque FROM public.produtos WHERE id=$1",
        [PRODUTO],
      )
    ).rows[0].estoque,
  );

let sequencia = 0;
const chave = () =>
  `b106c000-0000-4000-9000-${String(++sequencia).padStart(12, "0")}`;

// A v23 DIRETAMENTE (nao a v24): retirada, pagamento em dinheiro, CEP da area local, uma unidade de R$ 100.
const SQL = `SELECT public.create_marketplace_order_v23(
  $1::jsonb, 100::numeric, 0::numeric, 'cash', NULL::uuid, NULL::text,
  'Comprador ficticio', '5534999990000', NULL::text, NULL::jsonb, '38500-100', 'store-pickup', $2::uuid) AS id`;
const itens = (quantidade = 1) =>
  JSON.stringify([
    { product_id: PRODUTO, variant_id: null, quantity: quantidade },
  ]);
const retirar = () =>
  P.tentar("authenticated", SQL, [itens(), chave()], {
    uid: U,
    claims: JSON.stringify({ sub: U, role: "authenticated" }),
  });

const SEM_ENDERECO = [
  ["NULL", null],
  ["vazio", ""],
  ["so espacos", "   "],
];

for (const [rotulo, valor] of SEM_ENDERECO) {
  prova(
    `v23 + retirada + endereco da loja ${rotulo}: recusa P0001 sem criar pedido nem baixar estoque; com o endereco preenchido a MESMA chamada aceita`,
    () =>
      P.emTransacao(async () => {
        await semear(valor);
        const antes = await fotografar();
        assert.equal(await estoque(), ESTOQUE_INICIAL);

        const recusada = await retirar();
        assert.ok(
          recusada.erro,
          `a retirada com endereco ${rotulo} foi ACEITA: pedido ${recusada.linhas?.[0]?.id} nasceu sem local de retirada`,
        );
        assert.equal(recusada.codigo, "P0001", recusada.erro);
        assert.equal(recusada.erro, FRASE);
        assert.equal(recusada.detalhe, DETAIL);
        assert.deepEqual(
          await fotografar(),
          antes,
          "a recusa escreveu pedido, item, historico ou estoque",
        );
        assert.equal(
          await estoque(),
          ESTOQUE_INICIAL,
          "a recusa baixou estoque",
        );

        // Controle: so o endereco muda. Com ele (e com espacos nas pontas) a mesma compra nasce, e leva o retrato limpo.
        await definirEndereco(`  ${ENDERECO}  `);
        const aceita = await retirar();
        assert.equal(aceita.erro, undefined, aceita.erro);
        const pedido = (
          await P.conexao().query(
            `SELECT shipping, total, customer_data->>'shipping_option_id' AS opcao,
                    customer_data->>'pickup_address' AS retirada
               FROM public.marketplace_orders WHERE id = $1`,
            [aceita.linhas[0].id],
          )
        ).rows[0];
        assert.equal(Number(pedido.shipping), 0, "retirada nasce com frete 0");
        assert.equal(Number(pedido.total), 100);
        assert.equal(pedido.opcao, "store-pickup");
        assert.equal(pedido.retirada, ENDERECO, "o retrato vai sem as pontas");
        assert.equal(
          await estoque(),
          ESTOQUE_INICIAL - 1,
          "o pedido aceito baixa uma unidade",
        );
      }),
  );
}

prova(
  "v23 + retirada com o endereco da loja preenchido desde o inicio nasce (controle sem nenhuma edicao no meio)",
  () =>
    P.emTransacao(async () => {
      await semear(ENDERECO);
      const r = await retirar();
      assert.equal(r.erro, undefined, r.erro);
      assert.equal(await estoque(), ESTOQUE_INICIAL - 1);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("retirada sem endereco da loja e recusada na v23");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

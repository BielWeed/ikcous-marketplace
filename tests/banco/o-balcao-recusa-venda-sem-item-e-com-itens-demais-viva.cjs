"use strict";

// Onda 150, lote E (SEM migration): registrar_venda_presencial recusa lista de itens vazia, que nao e lista e com mais de 200 linhas.
// Corpo VIVO da 20261280 (nove argumentos; nenhuma sucessora redefine a RPC do balcao). So clone descartavel do rodar-isolado.cjs
// (CI_BANCO_EFEMERO=1 + localhost); tudo volta no ROLLBACK. Dados inventados.
//
// Sem a recusa de lista vazia, a RPC gravaria um pedido entregue e pago de R$ 0,00 sem nenhum item (venda fantasma que entra no Financeiro e nos
// numeros de pedidos, sem estoque baixado e sem peca para estornar). Sem o teto, uma venda de 200+ linhas seguraria 200+ travas de estoque numa transacao.
// A frase e' conferida LITERALMENTE: sem a guarda de tipo, '{}' ainda recusa com 22023, mas pela mensagem do Postgres ("cannot get array length..."), nao
// pela da loja; a prova vermelha pelo motivo certo depende da frase exata.
//
// MUTANTE_R150E=<nome> sabota SOMENTE a funcao viva, no clone, antes das recusas (instalacao confirmada; alvo unico):
//   balcao-aceita-lista-vazia | balcao-aceita-o-que-nao-e-lista | balcao-aceita-itens-demais
// Nome desconhecido e ERRO.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b150e000-0000-4000-8000-000000000001";
const PRODUTO = "b150e000-0000-4000-8000-000000000010";
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
const FRASE_SEM_ITEM = "A venda precisa de pelo menos um item.";
const FRASE_DEMAIS = "Venda com itens demais.";
const LINHA = { product_id: PRODUTO, variant_id: null, quantity: 1 };
const lista = (n) => JSON.stringify(Array.from({ length: n }, () => LINHA));

const MUTANTES = new Map(
  Object.entries({
    "balcao-aceita-lista-vazia": [
      "OR jsonb_array_length(p_itens) = 0 THEN",
      "THEN",
    ],
    "balcao-aceita-o-que-nao-e-lista": [
      "IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens) = 0 THEN",
      "IF jsonb_array_length(p_itens) = 0 THEN",
    ],
    "balcao-aceita-itens-demais": [
      `        IF jsonb_array_length(p_itens) > 200 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='${FRASE_DEMAIS}';
        END IF;
`,
      "",
    ],
  }),
);

async function mutar(nome) {
  if (process.env.MUTANTE_R150E === undefined) return;
  if (!MUTANTES.has(process.env.MUTANTE_R150E))
    throw new Error(`MUTANTE_R150E desconhecido: ${process.env.MUTANTE_R150E}`);
  if (process.env.MUTANTE_R150E !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [SIG])
  ).rows[0].d.replace(/\r/g, "");
  assert.ok(
    original.includes("p_total_esperado"),
    "a prova exige o corpo vivo da 280 (nove argumentos)",
  );
  const [de, para] = MUTANTES.get(nome);
  assert.equal(
    original.split(de).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(de, () => para);
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
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,'admin@r150e.fixture.invalid',$2::jsonb)",
    [ADMIN, JSON.stringify({ role: "admin" })],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Admin ficticio','admin')",
    [ADMIN],
  );
  // Estoque de sobra: 201 linhas de 1 unidade nao podem recusar por estoque (a recusa certa tem de ser a do teto).
  await c.query(
    "INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo,custo) VALUES ($1,'Produto ficticio',10,1000,true,4)",
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
  `b150e000-0000-4000-9000-${String(++sequencia).padStart(12, "0")}`;
const SQL = `SELECT public.registrar_venda_presencial(
  $1::jsonb, 'cash'::text, NULL::uuid, 'Cliente ficticio', NULL,
  0::numeric, NULL::text, $2::uuid, NULL::numeric) AS r`;
const vender = (itens) =>
  P.tentar("authenticated", SQL, [itens, chave()], SESSAO);

async function contarPedidos() {
  return Number(
    (
      await P.conexao().query(
        "SELECT count(*) AS n FROM public.marketplace_orders",
      )
    ).rows[0].n,
  );
}

async function recusa(itens, frase, rotulo, antes) {
  const r = await vender(itens);
  assert.equal(
    r.codigo,
    "22023",
    `${rotulo}: a venda foi ACEITA ou recusada por outro motivo (erro: ${r.erro}; pedidos agora: ${await contarPedidos()}; total gravado: ${r.linhas?.[0]?.r?.order?.total})`,
  );
  assert.equal(r.erro, frase, `${rotulo}: recusou com a frase errada`);
  assert.deepEqual(
    await fotografar(),
    antes,
    `${rotulo}: a recusa escreveu pedido, item, historico, financeiro ou estoque`,
  );
}

prova(
  "lista vazia, objeto, null, escalar e SQL NULL recusam 22023 com a frase da loja, sem escrever nada",
  () =>
    P.emTransacao(async () => {
      await semear();
      const antes = await fotografar();
      await mutar("balcao-aceita-lista-vazia");
      await mutar("balcao-aceita-o-que-nao-e-lista");
      await recusa("[]", FRASE_SEM_ITEM, "lista vazia []", antes);
      await recusa("{}", FRASE_SEM_ITEM, "objeto {}", antes);
      await recusa("null", FRASE_SEM_ITEM, "JSON null", antes);
      await recusa("5", FRASE_SEM_ITEM, "escalar numerico", antes);
      await recusa('"x"', FRASE_SEM_ITEM, "escalar texto", antes);
      // SQL NULL (parametro ausente): o IS DISTINCT FROM trata NULL como "nao e lista".
      const nulo = await P.tentar(
        "authenticated",
        SQL.replace("$1::jsonb", "NULL::jsonb").replace("$2::uuid", "$1::uuid"),
        [chave()],
        SESSAO,
      );
      assert.equal(nulo.codigo, "22023", `SQL NULL: ${nulo.erro}`);
      assert.equal(nulo.erro, FRASE_SEM_ITEM);
      assert.deepEqual(await fotografar(), antes, "o SQL NULL escreveu");

      // Controle: o mesmo pedido com UM item entra normalmente (a recusa e' do que falta, nao da chamada).
      const um = await vender(lista(1));
      assert.equal(um.codigo, undefined, um.erro);
      assert.equal(Number(um.linhas[0].r.order.total), 10);
      const depois = await fotografar();
      assert.equal(depois.pedidos.length, 1, "so a venda valida de 1 item");
      assert.equal(depois.itens.length, 1);
    }),
);

prova(
  "201 itens recusam 22023 com a frase do teto sem escrever nada; 200 (o limite) entram",
  () =>
    P.emTransacao(async () => {
      await semear();
      const antes = await fotografar();
      await mutar("balcao-aceita-itens-demais");
      await recusa(lista(201), FRASE_DEMAIS, "201 itens", antes);
      await recusa(lista(500), FRASE_DEMAIS, "500 itens", antes);

      // Borda: exatamente 200 linhas ainda e' venda valida (o teto e' '> 200', nao '>= 200').
      const limite = await vender(lista(200));
      assert.equal(
        limite.codigo,
        undefined,
        `200 itens recusados: ${limite.erro}`,
      );
      assert.equal(Number(limite.linhas[0].r.order.total), 2000);
      const depois = await fotografar();
      assert.equal(depois.pedidos.length, 1, "a venda de 200 itens nao nasceu");
      assert.equal(
        depois.itens.length,
        200,
        "a venda de 200 itens nao gravou as 200 linhas",
      );
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("balcao recusa venda sem item e com itens demais");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

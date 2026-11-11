"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// Sem a guarda de estoque nulo, uma versao VALIDA deixa NULL apagar o saldo 49.
// MUTANTE_R100 remove somente essa guarda; fixtures e mutante voltam no ROLLBACK.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b101d000-0000-4000-8000-000000000001";
const PRODUTO = "b101d000-0000-4000-8000-000000000010";
const VARIANTE = "b101d000-0000-4000-8000-000000000011";
const FN =
  "public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])";

async function mutar() {
  const nome = "ajuste-de-estoque-aceita-nulo";
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  const trecho = `    IF v_item ? 'stock_increment' THEN
      IF v_item->>'stock_increment' IS NULL THEN
        RAISE EXCEPTION 'stock_increment não pode ser nulo.' USING ERRCODE = '22023';
      END IF;
    END IF;
`;
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, "");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${nome}`);
}

prova(
  "estoque nulo com versao atual recusa sem apagar saldo 49; ajuste numerico aceita",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await c.query(
        "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,$3::jsonb)",
        [
          ADMIN,
          "admin@r101d.fixture.invalid",
          JSON.stringify({ role: "admin" }),
        ],
      );
      await c.query(
        "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Admin ficticio','admin')",
        [ADMIN],
      );
      await c.query(
        "INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo) VALUES ($1,'Produto ficticio',100,80,true)",
        [PRODUTO],
      );
      await c.query(
        `INSERT INTO public.product_variants
          (id,product_id,name,value,sku,codigo_barras,price_override,active,image_url,stock_increment)
        VALUES ($1,$2,'Tamanho','M','SKU-R101D','7890000000012',95,true,'https://fixture.invalid/antes.png',49)`,
        [VARIANTE, PRODUTO],
      );
      const base = (
        await c.query(
          "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id=$1",
          [PRODUTO],
        )
      ).rows[0].v;
      assert.ok(
        base,
        "a prova precisa da versao atual, nao da guarda de versao nula",
      );
      const foto = async () =>
        (
          await c.query(
            `SELECT
              (SELECT to_jsonb(p) FROM public.produtos p WHERE id=$1) AS produto,
              (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.product_variants v WHERE product_id=$1) AS variantes`,
            [PRODUTO],
          )
        ).rows[0];
      const antes = await foto();
      assert.equal(antes.variantes[0].stock_increment, 49);
      const item = {
        id: VARIANTE,
        name: "Cor",
        value: "Azul",
        sku: "SKU-R101D-EDITADO",
        codigo_barras: "7890000000029",
        price_override: 90,
        active: false,
        image_url: "https://fixture.invalid/depois.png",
      };
      const salvar = (estoque) =>
        P.tentar(
          "authenticated",
          "SELECT public.salvar_produto_com_grade($1::uuid,$2::timestamptz,$3::jsonb,$4::jsonb,$5::uuid[]) AS r",
          [
            PRODUTO,
            base,
            JSON.stringify({ nome: "Produto editado" }),
            JSON.stringify([{ ...item, stock_increment: estoque }]),
            [],
          ],
          {
            uid: ADMIN,
            claims: JSON.stringify({
              sub: ADMIN,
              role: "authenticated",
              app_metadata: { role: "admin" },
            }),
          },
        );
      await mutar();
      const recusa = await salvar(null);
      assert.equal(
        recusa.codigo,
        "22023",
        "stock_increment:null com versao atual foi aceito e apagou o saldo",
      );
      assert.equal(recusa.erro, "stock_increment não pode ser nulo.");
      assert.deepEqual(
        await foto(),
        antes,
        "a recusa alterou o produto, o saldo ou os demais dados da variante",
      );

      // Mesma sessao, versao e payload: so o estoque muda de null para numero.
      const ok = await salvar(45);
      assert.equal(ok.codigo, undefined, ok.erro);
      assert.deepEqual(ok.linhas[0].r.apagadas, []);
      assert.deepEqual(ok.linhas[0].r.recusadas, []);
      const depois = await foto();
      assert.equal(depois.produto.nome, "Produto editado");
      assert.equal(depois.variantes.length, 1);
      assert.equal(depois.variantes[0].stock_increment, 45);
      const {
        id,
        name,
        value,
        sku,
        codigo_barras,
        price_override,
        active,
        image_url,
      } = depois.variantes[0];
      assert.deepEqual(
        {
          id,
          name,
          value,
          sku,
          codigo_barras,
          price_override,
          active,
          image_url,
        },
        item,
        "ajuste numerico nao gravou os demais dados",
      );
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("ajuste de estoque nulo nao apaga o saldo");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

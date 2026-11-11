"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// Corpo VIVO: pedido__mudar_status da 20261198000000 (ultima que a redefine; update_order_status_atomic
// e' so a casca que a chama com auth.uid() e is_admin_atual()). A guarda provada: quem NAO e' admin so
// pode levar o PROPRIO pedido a 'cancelled'. MUTANTE_R100 remove somente ela; fixtures e mutante
// voltam no ROLLBACK de cada caso.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b102b000-0000-4000-8000-000000000001";
const COMPRADOR = "b102b000-0000-4000-8000-000000000002";
const PEDIDO = "b102b000-0000-4000-8000-000000000010";
const PEDIDO_CANCELA = "b102b000-0000-4000-8000-000000000011";
const FN = "public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)";
const MENSAGEM =
  "Operação não permitida: Usuários só podem cancelar seus próprios pedidos.";

async function mutar() {
  const nome = "comprador-avanca-o-proprio-pedido";
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  const trecho = `        IF p_new_status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION '${MENSAGEM}';
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

const identidade = (uid, cargo) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: cargo },
  }),
});

async function pessoa(uid, cargo) {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,$3::jsonb)",
    [uid, `${uid}@r102b.fixture.invalid`, JSON.stringify({ role: cargo })],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia',$2)",
    [uid, cargo],
  );
}

async function pedido(oid) {
  await P.conexao().query(
    `INSERT INTO public.marketplace_orders
    (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,payment_method,payment_status)
    VALUES ($1,$2,'Pessoa ficticia','{}',100,100,0,'pending','online','aguardando')`,
    [oid, COMPRADOR],
  );
}

async function foto(oid) {
  return (
    await P.conexao().query(
      `SELECT to_jsonb(o) AS pedido,
        (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id), '[]'::jsonb)
           FROM public.marketplace_order_history h WHERE h.order_id = o.id) AS historico,
        (SELECT count(*)::int FROM public.order_refunds r WHERE r.order_id = o.id) AS estornos
       FROM public.marketplace_orders o WHERE o.id = $1`,
      [oid],
    )
  ).rows[0];
}

const AVANCAR =
  "SELECT public.update_order_status_atomic($1::uuid,$2::text,$3::text) AS r";
const como = (uid, cargo, oid, status) =>
  P.tentar(
    "authenticated",
    AVANCAR,
    [oid, status, null],
    identidade(uid, cargo),
  );

prova(
  "comprador nao leva o proprio pedido a nenhum status que nao seja cancelar; cancelar o proprio e admin avancar passam",
  () =>
    P.emTransacao(async () => {
      await pessoa(ADMIN, "admin");
      await pessoa(COMPRADOR, "customer");
      await pedido(PEDIDO);
      await pedido(PEDIDO_CANCELA);
      await mutar();

      const antes = await foto(PEDIDO);
      assert.equal(antes.pedido.status, "pending");
      assert.deepEqual(antes.historico, []);
      for (const status of ["delivered", "processing", "shipping", "pending"]) {
        const r = await como(COMPRADOR, "customer", PEDIDO, status);
        assert.equal(
          r.erro,
          MENSAGEM,
          `o comprador levou o proprio pedido a '${status}' (ou foi recusado por outro motivo)`,
        );
        assert.equal(r.codigo, "P0001");
        assert.deepEqual(
          await foto(PEDIDO),
          antes,
          `a recusa de '${status}' alterou o pedido, o historico ou os estornos`,
        );
      }

      // Controle positivo 1: o MESMO comprador cancela o PROPRIO pedido.
      const cancela = await como(
        COMPRADOR,
        "customer",
        PEDIDO_CANCELA,
        "cancelled",
      );
      assert.equal(cancela.erro, undefined, cancela.erro);
      const cancelado = await foto(PEDIDO_CANCELA);
      assert.equal(cancelado.pedido.status, "cancelled");
      assert.equal(cancelado.historico.length, 1);
      assert.equal(cancelado.historico[0].old_status, "pending");
      assert.equal(cancelado.historico[0].new_status, "cancelled");
      assert.equal(cancelado.historico[0].created_by, COMPRADOR);

      // Controle positivo 2: o admin avanca o mesmo pedido que o comprador nao conseguiu mexer.
      const avanca = await como(ADMIN, "admin", PEDIDO, "processing");
      assert.equal(avanca.erro, undefined, avanca.erro);
      const avancado = await foto(PEDIDO);
      assert.equal(avancado.pedido.status, "processing");
      assert.equal(avancado.historico.length, 1);
      assert.equal(avancado.historico[0].new_status, "processing");
      assert.equal(avancado.historico[0].created_by, ADMIN);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("comprador nao avanca o proprio pedido");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

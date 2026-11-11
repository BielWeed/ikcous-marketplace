"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// Corpo VIVO: pedido__mudar_status da 20261198000000 (a ULTIMA que a redefine; as 20261199/04/09/45 so a citam;
// update_order_status_atomic e' a casca do front e cancelar_pedido_com_cobranca a da edge). Duas guardas do
// ramo "quem NAO e' admin", ate aqui sem prova viva:
//   (1) POSSE: so o dono leva o pedido (convidado, user_id NULL, nao tem dono) -> 'permissao para alterar este pedido'.
//   (2) ORIGEM: so pending/processing/shipping se cancelam; ENTREGUE e' devolucao -> 'nao pode mais ser cancelado por voce'.
// Toda recusa e' provada com FOTO antes/depois (pedido inteiro, historico, estoque, order_refunds), SAVEPOINT por tentativa
// e valores exatos. Mutantes (MUTANTE_R115A=<nome>): troca unica de texto no corpo vivo, dentro da transacao desfeita:
//   sem-guarda-de-posse | entregue-pode-cancelar | sem-shipping
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const ADMIN = "b115a000-0000-4000-8000-000000000001";
const COMPRADOR_A = "b115a000-0000-4000-8000-000000000002";
const COMPRADOR_B = "b115a000-0000-4000-8000-000000000003";
const FN = "public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)";
const QTD = 2;
const ESTOQUE_INICIAL = 10;
const MSG_POSSE =
  "Não autorizado: Você não tem permissão para alterar este pedido.";
const MSG_ENTREGUE = "Este pedido não pode mais ser cancelado por você.";

const TRECHO_POSSE = `    IF v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION '${MSG_POSSE}';
    END IF;
`;
const LISTA =
  "IF v_old_status NOT IN ('pending', 'processing', 'shipping') THEN";
const MUTANTES = new Map(
  Object.entries({
    "sem-guarda-de-posse": [TRECHO_POSSE, ""],
    "entregue-pode-cancelar": [
      LISTA,
      "IF v_old_status NOT IN ('pending', 'processing', 'shipping', 'delivered') THEN",
    ],
    "sem-shipping": [
      LISTA,
      "IF v_old_status NOT IN ('pending', 'processing') THEN",
    ],
  }),
);

async function corpoVivo() {
  return (
    await P.conexao().query(
      "SELECT pg_get_functiondef($1::regprocedure) AS d",
      [FN],
    )
  ).rows[0].d.replace(/\r/g, "");
}

async function mutar() {
  const nome = process.env.MUTANTE_R115A;
  if (!nome) return;
  const alvo = MUTANTES.get(nome);
  if (!alvo) throw new Error(`MUTANTE_R115A desconhecido: ${nome}`);
  const [trecho, troca] = alvo;
  const original = await corpoVivo();
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: o alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, () => troca);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await P.conexao().query(alterado);
  assert.equal(
    await corpoVivo(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
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
    [uid, `${uid}@r115a.fixture.invalid`, JSON.stringify({ role: cargo })],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia',$2)",
    [uid, cargo],
  );
}

let seq = 0;
const novoId = (prefixo) => {
  seq += 1;
  return `${prefixo}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/** Pedido com UM produto proprio (estoque ESTOQUE_INICIAL), para medir a devolucao de estoque de verdade. */
async function pedido({
  dono,
  status,
  pagamento = "online",
  situacao = "aguardando",
  vaga = null,
  metodo = null,
  paidAt = null,
}) {
  const c = P.conexao();
  const id = novoId("b115aaaa");
  const produto = novoId("b115bbbb");
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto 115a', 10.00, 50.00, $2, true, false)`,
    [produto, ESTOQUE_INICIAL],
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, expires_at, metodo_online, gateway_payment_id, paid_at)
     VALUES ($1, $2, 'Pessoa ficticia', '{}'::jsonb, 100, 100, $3, 'online',
             $4, $5, now() + interval '30 minutes', $6, $7, $8)`,
    [id, dono, status, pagamento, situacao, metodo, vaga, paidAt],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Produto 115a', $3, 50.00)`,
    [id, produto, QTD],
  );
  return id;
}

/** Tudo o que uma recusa NAO pode mexer: o pedido inteiro, o historico, o estoque do produto e o ledger de estorno. */
async function foto(oid) {
  return (
    await P.conexao().query(
      `SELECT to_jsonb(o) AS pedido,
        (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id), '[]'::jsonb)
           FROM public.marketplace_order_history h WHERE h.order_id = o.id) AS historico,
        (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
           FROM public.order_refunds r WHERE r.order_id = o.id) AS estornos,
        (SELECT coalesce(jsonb_agg(pr.estoque ORDER BY pr.id), '[]'::jsonb)
           FROM public.marketplace_order_items i JOIN public.produtos pr ON pr.id = i.product_id
          WHERE i.order_id = o.id) AS estoque
       FROM public.marketplace_orders o WHERE o.id = $1`,
      [oid],
    )
  ).rows[0];
}

const SQL_FRONT =
  "SELECT public.update_order_status_atomic($1::uuid,$2::text,$3::text) AS r";
const cancelaComo = (uid, cargo, oid) =>
  P.tentar(
    "authenticated",
    SQL_FRONT,
    [oid, "cancelled", null],
    identidade(uid, cargo),
  );

/** A porta da edge, como a edge a chama: service_role, com o ator autenticado por parametro. */
const SQL_EDGE =
  "SELECT public.cancelar_pedido_com_cobranca($1::uuid,$2::uuid,$3::text,$4::text,NULL) AS r";
const edgeComo = (ator, oid, vaga, pagamento) =>
  P.tentar("service_role", SQL_EDGE, [oid, ator, vaga, pagamento]);

/** A recusa exata (P0001 + texto inteiro) e a foto IGUAL a de antes. */
async function recusada(rotulo, tentativa, oid, mensagem, antes) {
  assert.equal(
    tentativa.erro,
    mensagem,
    `${rotulo}: devia recusar com a mensagem exata`,
  );
  assert.equal(tentativa.codigo, "P0001", `${rotulo}: codigo da recusa`);
  assert.deepEqual(
    await foto(oid),
    antes,
    `${rotulo}: a recusa alterou o pedido, o historico, o estoque ou os estornos`,
  );
}

const hoje = () => new Date().toISOString();

prova(
  "A: so o dono cancela o pedido; outra conta e o pedido de convidado sao recusados sem mexer em nada (dono e admin passam)",
  () =>
    P.emTransacao(async () => {
      await pessoa(ADMIN, "admin");
      await pessoa(COMPRADOR_A, "customer");
      await pessoa(COMPRADOR_B, "customer");
      const deA = await pedido({ dono: COMPRADOR_A, status: "pending" });
      const deAParaAdmin = await pedido({
        dono: COMPRADOR_A,
        status: "pending",
      });
      const deAProprio = await pedido({ dono: COMPRADOR_A, status: "pending" });
      const convidado = await pedido({ dono: null, status: "pending" });
      const convidadoAdmin = await pedido({ dono: null, status: "pending" });
      await mutar();

      for (const [rotulo, oid] of [
        ["B no pedido de A", deA],
        ["B no pedido de convidado", convidado],
      ]) {
        const antes = await foto(oid);
        assert.equal(antes.pedido.status, "pending");
        assert.deepEqual(antes.historico, []);
        assert.deepEqual(antes.estornos, []);
        assert.deepEqual(antes.estoque, [ESTOQUE_INICIAL]);
        await recusada(
          rotulo,
          await cancelaComo(COMPRADOR_B, "customer", oid),
          oid,
          MSG_POSSE,
          antes,
        );
      }

      // Controle 1: A cancela o PROPRIO (pending, nao enviado: o estoque volta, o historico leva o autor).
      const meu = await cancelaComo(COMPRADOR_A, "customer", deAProprio);
      assert.equal(meu.erro, undefined, meu.erro);
      const depoisMeu = await foto(deAProprio);
      assert.equal(depoisMeu.pedido.status, "cancelled");
      assert.deepEqual(depoisMeu.estoque, [ESTOQUE_INICIAL + QTD]);
      assert.equal(depoisMeu.historico.length, 1);
      assert.equal(depoisMeu.historico[0].created_by, COMPRADOR_A);
      assert.equal(depoisMeu.historico[0].old_status, "pending");

      // Controle 2: o ADMIN cancela o pedido ALHEIO e o de convidado (o que B nao conseguiu).
      for (const oid of [deAParaAdmin, convidadoAdmin]) {
        const adm = await cancelaComo(ADMIN, "admin", oid);
        assert.equal(adm.erro, undefined, adm.erro);
        const depois = await foto(oid);
        assert.equal(depois.pedido.status, "cancelled");
        assert.equal(depois.historico.length, 1);
        assert.equal(depois.historico[0].created_by, ADMIN);
        assert.deepEqual(depois.estoque, [ESTOQUE_INICIAL + QTD]);
      }
    }),
);

prova(
  "B (porta do front): entregue nao se cancela como cliente (pago online e dinheiro na entrega); pending e shipping cancelam; admin cancela o entregue",
  () =>
    P.emTransacao(async () => {
      await pessoa(ADMIN, "admin");
      await pessoa(COMPRADOR_A, "customer");
      const entreguePago = await pedido({
        dono: COMPRADOR_A,
        status: "delivered",
        situacao: "pago",
        paidAt: hoje(),
        vaga: "ORD115AENTREGUE",
        metodo: "pix",
      });
      const entregueDinheiro = await pedido({
        dono: COMPRADOR_A,
        status: "delivered",
        pagamento: "cash",
        situacao: null,
      });
      const entregueAdmin = await pedido({
        dono: COMPRADOR_A,
        status: "delivered",
        pagamento: "cash",
        situacao: null,
      });
      const pendente = await pedido({ dono: COMPRADOR_A, status: "pending" });
      const enviado = await pedido({
        dono: COMPRADOR_A,
        status: "shipping",
        pagamento: "cash",
        situacao: null,
      });
      await mutar();

      for (const [rotulo, oid] of [
        ["entregue pago online", entreguePago],
        ["entregue em dinheiro", entregueDinheiro],
      ]) {
        const antes = await foto(oid);
        assert.equal(antes.pedido.status, "delivered");
        assert.equal(antes.pedido.cancelled_after_shipping, false);
        assert.deepEqual(antes.historico, []);
        assert.deepEqual(antes.estornos, []);
        await recusada(
          `cliente cancela ${rotulo}`,
          await cancelaComo(COMPRADOR_A, "customer", oid),
          oid,
          MSG_ENTREGUE,
          antes,
        );
      }

      // Controle: pending do mesmo cliente cancela (estoque volta, historico do cliente).
      const pend = await cancelaComo(COMPRADOR_A, "customer", pendente);
      assert.equal(
        pend.erro,
        undefined,
        `pending devia cancelar: ${pend.erro}`,
      );
      const depoisPend = await foto(pendente);
      assert.equal(depoisPend.pedido.status, "cancelled");
      assert.deepEqual(depoisPend.estoque, [ESTOQUE_INICIAL + QTD]);
      assert.equal(depoisPend.historico[0].created_by, COMPRADOR_A);

      // Controle: shipping do mesmo cliente cancela; a peca saiu, entao o estoque NAO volta e o carimbo e' gravado.
      const env = await cancelaComo(COMPRADOR_A, "customer", enviado);
      assert.equal(env.erro, undefined, `shipping devia cancelar: ${env.erro}`);
      const depoisEnv = await foto(enviado);
      assert.equal(depoisEnv.pedido.status, "cancelled");
      assert.equal(depoisEnv.pedido.cancelled_after_shipping, true);
      assert.deepEqual(depoisEnv.estoque, [ESTOQUE_INICIAL]);
      assert.equal(depoisEnv.historico[0].old_status, "shipping");
      assert.deepEqual(depoisEnv.estornos, []);

      // Controle: o ADMIN cancela o entregue (o que o cliente nao pode).
      const adm = await cancelaComo(ADMIN, "admin", entregueAdmin);
      assert.equal(adm.erro, undefined, adm.erro);
      const depoisAdm = await foto(entregueAdmin);
      assert.equal(depoisAdm.pedido.status, "cancelled");
      assert.equal(depoisAdm.pedido.cancelled_after_shipping, true);
      assert.equal(depoisAdm.historico[0].created_by, ADMIN);
    }),
);

prova(
  "B (porta da edge): cancelar_pedido_com_cobranca com o cliente de ator recusa o entregue sem mexer em nada; o mesmo cliente no pending e o admin no entregue passam",
  () =>
    P.emTransacao(async () => {
      await pessoa(ADMIN, "admin");
      await pessoa(COMPRADOR_A, "customer");
      const entreguePago = await pedido({
        dono: COMPRADOR_A,
        status: "delivered",
        situacao: "pago",
        paidAt: hoje(),
        vaga: "ORD115EENTREGUE",
        metodo: "pix",
      });
      const entregueAdmin = await pedido({
        dono: COMPRADOR_A,
        status: "delivered",
        situacao: "pago",
        paidAt: hoje(),
        vaga: "ORD115EADMIN",
        metodo: "pix",
      });
      const pendente = await pedido({ dono: COMPRADOR_A, status: "pending" });
      await mutar();

      const antes = await foto(entreguePago);
      assert.equal(antes.pedido.status, "delivered");
      // vaga e pagamento batem com o pedido: so a guarda de origem pode recusar (nao o CAS 'cobranca_mudou').
      await recusada(
        "edge: cliente cancela entregue pago online",
        await edgeComo(COMPRADOR_A, entreguePago, "ORD115EENTREGUE", "pago"),
        entreguePago,
        MSG_ENTREGUE,
        antes,
      );

      // Controle: o mesmo cliente cancela o pending pela edge (prova que o cenario da edge e' montavel).
      const pend = await edgeComo(COMPRADOR_A, pendente, null, "aguardando");
      assert.equal(pend.erro, undefined, pend.erro);
      assert.equal(pend.linhas[0].r.cancelado, true);
      assert.equal(pend.linhas[0].r.ja_estava, false);
      assert.equal((await foto(pendente)).pedido.status, "cancelled");

      // Controle: o admin cancela o MESMO tipo de entregue pela edge.
      const adm = await edgeComo(ADMIN, entregueAdmin, "ORD115EADMIN", "pago");
      assert.equal(adm.erro, undefined, adm.erro);
      assert.equal(adm.linhas[0].r.cancelado, true);
      assert.equal((await foto(entregueAdmin)).pedido.status, "cancelled");
    }),
);

async function main() {
  const nome = process.env.MUTANTE_R115A;
  if (nome && !MUTANTES.has(nome))
    throw new Error(`MUTANTE_R115A desconhecido: ${nome}`);
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    if (nome) console.log(`MUTANTE aplicado: ${nome}`);
    await P.executar(
      "o comprador so cancela o proprio pedido e so antes da entrega",
    );
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

"use strict";

/**
 * Prova VIVA do selo "Compra Verificada" (migration 20261073000000, que refez as duas funcoes da 20261030000000):
 * `reviews.verified` so vale para quem tem um pedido PAGO e VIVO (nao cancelado) do produto, na hora em que a avaliacao nasce
 * (`marca_avaliacao_nasce_verificada`, gatilho AFTER INSERT de reviews) e retroativamente quando o pedido passa a pago
 * (`marca_avaliacoes_do_pedido_verificadas`, gatilho AFTER INSERT OR UPDATE OF payment_status de marketplace_orders).
 *
 * Somente o clone descartavel de rodar-isolado.cjs. Nenhum SQL de producao muda: cada caso roda numa transacao desfeita.
 * Os gatilhos do selo ficam ATIVOS o tempo todo (nada de session_replication_role); a avaliacao entra como `authenticated`,
 * pela mesma RLS do app. MUTANTE_R109C=<nome> sabota UMA guarda viva (troca de texto unica no corpo vivo) dentro da transacao.
 *
 *  - NAO PAGO     pedido aguardando/recusado/expirado/estornado/sem status de pagamento, ou pago e CANCELADO, e depois a
 *                 avaliacao: sem selo. (O CHECK de status do pedido NAO aceita 'returned': o ramo 'returned' do filtro
 *                 e' inalcancavel hoje; a prova fixa isso e quebra se o CHECK passar a aceitar, para o caso entrar.)
 *  - RETROATIVO   avaliacao ANTES, depois UPDATE do pedido para pago: o selo vira true (as tres formas de pago); com status
 *                 'cancelled' no mesmo UPDATE: continua false; UPDATE para pagamento nao reconhecido: continua false.
 *  - OUTRA CONTA  pedido sem dono (user_id NULL), pedido de outra conta ou de outro produto: nao marca. (Avaliacao sem
 *                 autora nao existe: reviews.user_id e' NOT NULL no banco vivo, entao esse caso nao e' alcancavel.)
 *  - CONTROLES    pago_apos_expirar, recebido_na_entrega e pago em qualquer status vivo marcam, nos dois caminhos.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres:postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-selo-de-compra-verificada-so-vale-com-pedido-pago-e-vivo-viva.cjs
 */

/* eslint-disable security/detect-object-injection --
 * A chave de MUTANTES vem da variavel de ambiente, mas so depois de validada contra a lista fechada deste arquivo. */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const ID = (grupo) => `b1090c00-0000-4000-8000-${grupo}`;
const CLIENTE = ID("000000000001"); // quem compra e avalia
const OUTRA = ID("000000000002"); // outra conta
const PROD_P = ID("000000000010"); // o produto comprado
const PROD_Q = ID("000000000011"); // outro produto
let contador = 0;
const proximo = (letra) =>
  ID(`0000000${letra}${String(++contador).padStart(4, "0")}`);

const FN_INSERT = "public.marca_avaliacao_nasce_verificada()";
const FN_UPDATE = "public.marca_avaliacoes_do_pedido_verificadas()";
const PAGOS = ["pago", "pago_apos_expirar", "recebido_na_entrega"];
// valores vivos do CHECK que NAO sao pagamento reconhecido (NULL tambem vale)
const NAO_PAGOS = ["aguardando", "recusado", "expirado", "estornado", null];
const STATUS_VIVOS = ["pending", "processing", "shipping", "delivered", "new"];

// ---------------------------------------------------------------------------
// MUTANTES: [funcao, trecho (1 vez no corpo vivo), troca]
// ---------------------------------------------------------------------------
const FILTRO_INSERT =
  "\n          AND o.status NOT IN ('cancelled', 'returned')";
const FILTRO_UPDATE =
  "\n       AND NEW.status NOT IN ('cancelled', 'returned')";
const PAGAMENTO_INSERT =
  "\n          AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')";
const PAGAMENTO_UPDATE =
  "\n       AND NEW.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')";
const MUTANTES = {
  "sem-filtro-cancelado-devolvido-no-insert": [[FN_INSERT, FILTRO_INSERT, ""]],
  "sem-filtro-cancelado-no-update": [[FN_UPDATE, FILTRO_UPDATE, ""]],
  "sem-recebido-na-entrega": [
    [FN_INSERT, ", 'recebido_na_entrega'", ""],
    [FN_UPDATE, ", 'recebido_na_entrega'", ""],
  ],
  "pagamento-qualquer-no-update": [[FN_UPDATE, PAGAMENTO_UPDATE, ""]],
  // extras (alem dos quatro do brief): o espelho do pagamento no INSERT e a forma pago_apos_expirar
  "pagamento-qualquer-no-insert": [[FN_INSERT, PAGAMENTO_INSERT, ""]],
  "sem-pago-apos-expirar": [
    [FN_INSERT, ", 'pago_apos_expirar'", ""],
    [FN_UPDATE, ", 'pago_apos_expirar'", ""],
  ],
};
const MUTANTE = process.env.MUTANTE_R109C;
if (MUTANTE && !Object.hasOwn(MUTANTES, MUTANTE))
  P.falhar(
    "MUTANTE DESCONHECIDO",
    `MUTANTE_R109C='${MUTANTE}' nao existe. Validos: ${Object.keys(MUTANTES).join(", ")}`,
  );

/** Roda no inicio de cada transacao: aplica a sabotagem escolhida (ou nada). */
async function aplicarMutante() {
  if (!MUTANTE) return;
  const c = P.conexao();
  for (const [fn, trecho, troca] of MUTANTES[MUTANTE]) {
    const def = (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [fn])
    ).rows[0].d;
    assert.equal(
      def.split(trecho).length - 1,
      1,
      `mutante ${MUTANTE}: o alvo deve ocorrer 1 vez em ${fn}`,
    );
    const nova = def.split(trecho).join(troca);
    assert.notEqual(nova, def, "a sabotagem nao mudou o corpo");
    await c.query(nova);
    const vivo = (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [fn])
    ).rows[0].d;
    assert.ok(
      !vivo.includes(trecho),
      `mutante ${MUTANTE}: o banco nao instalou a sabotagem em ${fn}`,
    );
  }
  console.log(`MUTANTE aplicado: ${MUTANTE}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function semear() {
  const c = P.conexao();
  for (const [id, nome] of [
    [CLIENTE, "Cliente ficticia"],
    [OUTRA, "Outra ficticia"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,'{}'::jsonb)",
      [id, `${id}@r109c.fixture.invalid`],
    );
    await c.query(
      "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,$2,'customer')",
      [id, nome],
    );
  }
  for (const id of [PROD_P, PROD_Q])
    await c.query(
      "INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo,custo) VALUES ($1,'Produto ficticio',100,10,true,40)",
      [id],
    );
  // a policy de INSERT de reviews le enable_reviews (linha criada se faltar)
  await c.query(`INSERT INTO public.store_config (id,enable_reviews) VALUES (1,true)
    ON CONFLICT (id) DO UPDATE SET enable_reviews = true`);
}

/** Pedido (como dono, gatilhos ligados) com UM item de `produto`. */
async function pedido({
  user = CLIENTE,
  pagamento,
  status = "delivered",
  produto = PROD_P,
}) {
  const c = P.conexao();
  const id = proximo("e");
  await c.query(
    `INSERT INTO public.marketplace_orders (id,user_id,customer_data,customer_name,subtotal,total,payment_status,status)
     VALUES ($1,$2,'{}'::jsonb,'Pessoa ficticia',100,100,$3,$4)`,
    [id, user, pagamento, status],
  );
  await c.query(
    "INSERT INTO public.marketplace_order_items (order_id,product_id,quantity,price) VALUES ($1,$2,1,100)",
    [id, produto],
  );
  return id;
}

/** A avaliacao entra como o app faz: `authenticated`, pela RLS (verified=false, pendente). */
async function avaliar(uid = CLIENTE, produto = PROD_P) {
  const id = proximo("f");
  const r = await P.tentar(
    "authenticated",
    `INSERT INTO public.reviews (id,product_id,user_id,rating,comment,verified,status)
     VALUES ($1,$2,$3,4,'Produto ficticio chegou bem',false,'pendente')`,
    [id, produto, uid],
    { uid },
  );
  assert.equal(r.codigo, undefined, `a avaliacao devia entrar: ${r.erro}`);
  return id;
}

const selo = async (id) =>
  (
    await P.conexao().query("SELECT verified FROM public.reviews WHERE id=$1", [
      id,
    ])
  ).rows[0].verified;

async function esperaSelo(id, esperado, rotulo) {
  assert.equal(await selo(id), esperado, rotulo);
}

const atualizar = (idPedido, pagamento, status) =>
  P.conexao().query(
    status === undefined
      ? "UPDATE public.marketplace_orders SET payment_status=$2 WHERE id=$1"
      : "UPDATE public.marketplace_orders SET payment_status=$2, status=$3 WHERE id=$1",
    status === undefined
      ? [idPedido, pagamento]
      : [idPedido, pagamento, status],
  );

/** Cada volta roda dentro de um savepoint desfeito: as fixtures de uma nao enxergam as da outra. */
async function porVolta(valores, corpo) {
  const c = P.conexao();
  for (const v of valores) {
    await c.query("SAVEPOINT volta");
    try {
      await corpo(v);
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT volta");
      await c.query("RELEASE SAVEPOINT volta");
    }
  }
}

const emCaso = (fn) =>
  P.emTransacao(async () => {
    await semear();
    await fn();
  }, aplicarMutante);

// ---------------------------------------------------------------------------
// (a) pedido nao pago ou cancelado + avaliacao depois: sem selo
// ---------------------------------------------------------------------------

prova(
  "(a) pedido com pagamento nao reconhecido: a avaliacao nasce SEM selo",
  () =>
    emCaso(() =>
      porVolta(NAO_PAGOS, async (pagamento) => {
        await pedido({ pagamento });
        const rev = await avaliar();
        await esperaSelo(rev, false, `pagamento ${pagamento}: marcou o selo`);
      }),
    ),
);

prova("(a) pedido pago mas CANCELADO: a avaliacao nasce SEM selo", () =>
  emCaso(() =>
    porVolta(PAGOS, async (pagamento) => {
      await pedido({ pagamento, status: "cancelled" });
      const rev = await avaliar();
      await esperaSelo(
        rev,
        false,
        `${pagamento} + cancelled: o pedido morto deu selo`,
      );
    }),
  ),
);

prova(
  "(a) o CHECK de status do pedido recusa 'returned' (o ramo 'returned' do filtro e' inalcancavel)",
  () =>
    emCaso(async () => {
      const r = await P.tentar(
        null,
        `INSERT INTO public.marketplace_orders (id,user_id,customer_data,customer_name,subtotal,total,payment_status,status)
       VALUES ($1,$2,'{}'::jsonb,'Pessoa ficticia',100,100,'pago','returned')`,
        [proximo("e"), CLIENTE],
      );
      assert.equal(r.codigo, "23514", r.erro);
      assert.equal(r.restricao, "marketplace_orders_status_check");
    }),
);

// ---------------------------------------------------------------------------
// (b)/(c) avaliacao ANTES, depois o UPDATE do pedido
// ---------------------------------------------------------------------------

prova(
  "(b) avaliacao antes e UPDATE do pedido para pago: o selo VIRA true (so da avaliacao do produto comprado, da dona do pedido); repetir o UPDATE e' inocuo",
  () =>
    emCaso(() =>
      porVolta(PAGOS, async (pagamento) => {
        const pedidoId = await pedido({ pagamento: "aguardando" });
        const dela = await avaliar(CLIENTE, PROD_P);
        const outroProduto = await avaliar(CLIENTE, PROD_Q);
        const deOutra = await avaliar(OUTRA, PROD_P);
        await esperaSelo(dela, false, "controle: antes do pagamento, sem selo");
        await atualizar(pedidoId, pagamento);
        await esperaSelo(
          dela,
          true,
          `UPDATE para ${pagamento}: o selo nao veio`,
        );
        await esperaSelo(outroProduto, false, "produto fora do pedido marcou");
        await esperaSelo(deOutra, false, "avaliacao de outra conta marcou");
        await atualizar(pedidoId, pagamento); // de novo: nada muda, nada quebra
        await esperaSelo(dela, true, "o segundo UPDATE tirou o selo");
        await esperaSelo(deOutra, false, "o segundo UPDATE marcou outra conta");
      }),
    ),
);

prova(
  "(c) o mesmo UPDATE para pago com status 'cancelled' no mesmo comando: continua SEM selo",
  () =>
    emCaso(() =>
      porVolta(PAGOS, async (pagamento) => {
        const pedidoId = await pedido({ pagamento: "aguardando" });
        const rev = await avaliar();
        await atualizar(pedidoId, pagamento, "cancelled");
        await esperaSelo(
          rev,
          false,
          `UPDATE ${pagamento} + cancelled: o pedido morto deu selo`,
        );
      }),
    ),
);

prova(
  "(c) UPDATE do pagamento para valor nao reconhecido (recusado, expirado, estornado, NULL): continua SEM selo",
  () =>
    emCaso(() =>
      porVolta(
        ["recusado", "expirado", "estornado", null, "aguardando"],
        async (pagamento) => {
          const pedidoId = await pedido({ pagamento: "aguardando" });
          const rev = await avaliar();
          await atualizar(pedidoId, pagamento);
          await esperaSelo(
            rev,
            false,
            `UPDATE para ${pagamento}: o pagamento nao reconhecido deu selo`,
          );
        },
      ),
    ),
);

// ---------------------------------------------------------------------------
// (d) pedido de ninguem / de outra conta / avaliacao de ninguem
// ---------------------------------------------------------------------------

prova(
  "(d) pedido pago SEM dono (user_id NULL) e avaliacao de OUTRA conta: nao marca, nem na criacao nem no UPDATE",
  () =>
    emCaso(async () => {
      // caminho da criacao: o pedido sem dono ja esta pago quando a avaliacao nasce
      await pedido({ user: null, pagamento: "pago" });
      await esperaSelo(
        await avaliar(OUTRA),
        false,
        "criacao: pedido sem dono deu selo",
      );
      // caminho do UPDATE: a avaliacao ja existe quando o pedido sem dono passa a pago
      const semDono = await pedido({ user: null, pagamento: "aguardando" });
      const antes = await avaliar(CLIENTE);
      await atualizar(semDono, "pago");
      await esperaSelo(antes, false, "UPDATE: pedido sem dono deu selo");
    }),
);

prova(
  "(d) pedido pago de OUTRA conta ou de OUTRO produto nao da selo a quem nao comprou (criacao e UPDATE); os compradores de verdade marcam",
  () =>
    emCaso(async () => {
      await pedido({ user: OUTRA, pagamento: "pago" }); // a OUTRA comprou P
      await pedido({ user: CLIENTE, pagamento: "pago", produto: PROD_Q }); // a CLIENTE comprou Q
      const naoComprou = await avaliar(CLIENTE, PROD_P);
      await esperaSelo(naoComprou, false, "criacao: compra alheia deu selo");
      // o UPDATE: um segundo pedido de P da OUTRA passa a pago com a avaliacao da CLIENTE ja existindo
      const alheio = await pedido({ user: OUTRA, pagamento: "aguardando" });
      await atualizar(alheio, "pago");
      await esperaSelo(
        naoComprou,
        false,
        "UPDATE: pedido de outra conta deu selo",
      );
      // controles: quem comprou de verdade marca
      await esperaSelo(await avaliar(OUTRA, PROD_P), true, "a OUTRA comprou P");
      await esperaSelo(
        await avaliar(CLIENTE, PROD_Q),
        true,
        "a CLIENTE comprou Q",
      );
    }),
);

// ---------------------------------------------------------------------------
// (e) controles: o que TEM de marcar
// ---------------------------------------------------------------------------

prova(
  "(e) controle: pago, pago_apos_expirar e recebido_na_entrega com pedido vivo marcam na criacao",
  () =>
    emCaso(() =>
      porVolta(PAGOS, async (pagamento) => {
        await pedido({ pagamento });
        const rev = await avaliar();
        await esperaSelo(rev, true, `${pagamento} + delivered: nao marcou`);
      }),
    ),
);

prova(
  "(e) controle: pago em qualquer status vivo do pedido marca na criacao",
  () =>
    emCaso(() =>
      porVolta(STATUS_VIVOS, async (status) => {
        await pedido({ pagamento: "pago", status });
        const rev = await avaliar();
        await esperaSelo(rev, true, `pago + ${status}: nao marcou`);
      }),
    ),
);

prova(
  "(e) controle: item inserido DEPOIS do pedido e da avaliacao nao confere o selo; o UPDATE do pagamento (recebido_na_entrega) e' que confere",
  () =>
    emCaso(async () => {
      // o pedido existe sem item ainda: nada para conferir quando a avaliacao nasce
      const pedidoId = proximo("e");
      await P.conexao().query(
        `INSERT INTO public.marketplace_orders (id,user_id,customer_data,customer_name,subtotal,total,payment_status,status)
       VALUES ($1,$2,'{}'::jsonb,'Pessoa ficticia',100,100,'aguardando','pending')`,
        [pedidoId, CLIENTE],
      );
      const rev = await avaliar();
      await P.conexao().query(
        "INSERT INTO public.marketplace_order_items (order_id,product_id,quantity,price) VALUES ($1,$2,1,100)",
        [pedidoId, PROD_P],
      );
      await esperaSelo(rev, false, "inserir o item nao confere selo");
      await atualizar(pedidoId, "recebido_na_entrega");
      await esperaSelo(
        rev,
        true,
        "o UPDATE para recebido_na_entrega nao conferiu",
      );
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar(
      "o selo de compra verificada so vale com pedido pago e vivo",
    );
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

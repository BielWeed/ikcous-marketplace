"use strict";

/**
 * Prova VIVA da migration 20261395200000 (a conclusao da devolucao tranca o estoque na MESMA ordem da compra: `admin_devolucao_concluir`
 * tranca as variacoes dos itens por id e depois os produtos por id, ANTES do laco que credita), num Postgres EFEMERO local, com os
 * papeis de verdade e DUAS CONEXOES REAIS com COMMIT (clone descartavel do rodar-isolado.cjs). Esqueleto de migration em
 * `prova-de-troca-de-corpo.cjs`.
 *
 *  O DEFEITO   com o corpo da 20261343000000 duas conexoes reais cruzam travas e o banco derruba uma com 40P01 em tres cenarios
 *              deterministas (variacao x variacao, produto x variacao, produto x produto): a compra (representada pela mesma sequencia
 *              de travas dela, em dois passos controlados) e a conclusao da devolucao com os itens em ordem contraria.
 *  A CORRECAO  com o corpo desta migration, nos MESMOS cenarios, ninguem e derrubado e o estoque e creditado uma vez.
 *  O COMPORTAMENTO IGUAL  uma matriz de 12 casos (so produto, so variacao, misto, ausente/danificada/sem reestocar, pedido ja devolvido,
 *              item ja reestocado, reembolso/troca/vale, condicao faltando, item de outra devolucao, devolucao fora de ordem, pagamento
 *              ausente) da o MESMO retorno, o MESMO estoque, as MESMAS linhas de devolucao e de reembolso nos dois corpos.
 *  MUTANTES    sem a trava das variacoes, sem a dos produtos, sem ORDER BY e com o bloco depois do laco voltam a dar 40P01.
 *  MIGRATION   ver o esqueleto.
 *
 * COMO A COMPRA E' REPRESENTADA: a compra (create_marketplace_order_v23/v24) tranca, em ordem global, TODAS as variacoes do carrinho (um
 * SELECT ... ORDER BY id FOR NO KEY UPDATE) e depois TODOS os produtos. Um SELECT assim nao pode ser parado no meio, entao o teste o
 * parte em dois passos na mesma ordem e os separa pelo tempo que a outra conexao precisa para pedir a sua primeira trava.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-viva.cjs
 */

/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo (nomes de casos e de cenarios), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const { criar } = require("./prova-de-troca-de-corpo.cjs");

const ARQ =
  "20261395200000_a_conclusao_da_devolucao_tranca_na_mesma_ordem_da_compra.sql";
const FN = "admin_devolucao_concluir";
const SIG = "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)";
const H_ANTES = "ea651d52157521c0fe7ffccc948b4b1a";
const H_DEPOIS = "a152c8dcd7cf6d1e05e5aff128d6c45e";

// ---- o inverso, escrito a parte: tira o bloco e as duas variaveis ------------------------------------------------------
function inverso(corpo) {
  const ini = corpo.indexOf(
    "  -- >>> ordem global das travas (20261395200000)",
  );
  const marcaFim = "  -- <<< ordem global das travas (20261395200000)\n\n";
  const fim = corpo.indexOf(marcaFim) + marcaFim.length;
  assert.ok(ini > 0 && fim > ini, "o bloco novo nao foi achado");
  const semBloco = corpo.slice(0, ini) + corpo.slice(fim);
  const decl =
    "  -- 20261395200000: ids a trancar de uma vez, na ordem global (bloco abaixo).\n" +
    "  v_trava_variantes uuid[];\n  v_trava_produtos uuid[];\n";
  assert.equal(
    semBloco.split(decl).length - 1,
    1,
    "as variaveis novas nao sao unicas",
  );
  return semBloco.replace(decl, () => "");
}

const ESTRAGOS = [];
const T = criar({
  arq: ARQ,
  origem: {
    arquivo: "20261343000000_o_reembolso_manual_respeita_a_reserva.sql",
  },
  fn: FN,
  delim: "$$",
  sig: SIG,
  hAntes: H_ANTES,
  hDepois: H_DEPOIS,
  volatil: "v",
  aclDeSempre: [
    "authenticated=X/postgres",
    "postgres=X/postgres",
    "service_role=X/postgres",
  ],
  consulta: {
    a: "110a-conferir-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-aplicado",
    b: "110b-antes-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-base-vigente",
    rotulos: [
      "controle: funcoes de public visiveis a este papel",
      "admin_devolucao_concluir: corpo exato (md5)",
      "admin_devolucao_concluir: o corpo traz a ordem global das travas (uma vez)",
      "admin_devolucao_concluir: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
    ],
    fixos: [
      "controle: funcoes de public visiveis a este papel",
      "admin_devolucao_concluir: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
    ],
    attr: "admin_devolucao_concluir: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
  },
  inverso,
  estragosDaConsulta: ESTRAGOS,
});
ESTRAGOS.push([
  T.decl(
    T.NOVA,
    T.NOVA.corpo.replace(
      "  -- >>> ordem global das travas (20261395200000)",
      () =>
        "  -- >>> ordem global das travas (20261395200000)\n  -- >>> ordem global das travas (20261395200000)",
    ),
  ),
  "admin_devolucao_concluir: o corpo traz a ordem global das travas (uma vez)",
]);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const url = lerDatabaseUrlEfemera();
const novoCliente = async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
};
const ADMIN = "7e395200-0000-4000-8000-0000000000a1";
const CLIENTE = "7e395200-0000-4000-8000-0000000000c1";
const id = (grupo, n) =>
  `7e395200-${grupo}-4000-8000-${String(n).padStart(12, "0")}`;
// Os ids crescem na ordem em que a COMPRA os tranca (a < b).
const P_A = id("0001", 1); // pai da variacao V_A
const P_B = id("0001", 2); // pai da variacao V_B
const P_Q1 = id("0001", 3); // produto simples
const P_Q2 = id("0001", 4); // produto simples
const V_A = id("0002", 1);
const V_B = id("0002", 2);
const CLAIMS_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});

async function semearBase(c) {
  await c.query(
    `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
       ($1,'admin395a@fixture.test','{"role":"admin"}'),($2,'cliente395a@fixture.test','{}')
     ON CONFLICT DO NOTHING`,
    [ADMIN, CLIENTE],
  );
  await c.query(
    `INSERT INTO public.profiles(id,full_name,role) VALUES
       ($1,'Admin fixture','admin'),($2,'Cliente fixture','customer')
     ON CONFLICT DO NOTHING`,
    [ADMIN, CLIENTE],
  );
}
/** Produtos e variacoes entram em ordem DECRESCENTE de id, para que uma leitura sem ORDER BY volte "ao contrario". */
async function semearEstoque(c) {
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES
       ($1,'Q2 395a',10,100,true,5,false),($2,'Q1 395a',10,100,true,5,false),($3,'B 395a',10,0,true,5,false),($4,'A 395a',10,0,true,5,false)
     ON CONFLICT (id) DO NOTHING`,
    [P_Q2, P_Q1, P_B, P_A],
  );
  await c.query(
    `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES
       ($1,$2,'Tam','G',10,true),($3,$4,'Tam','P',10,true)
     ON CONFLICT (id) DO NOTHING`,
    [V_B, P_B, V_A, P_A],
  );
}
const SEQ = {}; // contador por faixa (cada faixa conta a sua; as desfeitas recomecam em 0)
// Faixa de ids de pedido/devolucao: os cenarios de deadlock COMMITAM as suas linhas, a matriz e a porta rodam em transacao desfeita; faixas
// diferentes nao colidem.
let FAIXA = 0;
/**
 * Um pedido entregue e pago pelo app, com os itens `itens` = [{p, v, q}] (produto, variacao ou null, quantidade), e uma devolucao
 * `recebida` com um devolucao_itens por item, NA ORDEM dada. Devolve { order, dev, di: [ids dos devolucao_itens] }.
 */
async function montar(
  c,
  tag,
  itens,
  { extraPedido = "", status = "recebida", pagamento = "pago" } = {},
) {
  const seqOrdem = (SEQ[FAIXA] = (SEQ[FAIXA] ?? 0) + 1);
  const order = id(`0${FAIXA}03`, seqOrdem);
  const dev = id(`0${FAIXA}04`, seqOrdem);
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,payment_method,payment_status,paid_at,
        pagamento_recebido_em,gateway_payment_id,valor_estornado)
     VALUES ($1,$2,'Fixture 395a','{}',100,100,0,'delivered','online','online',$3,now(),now(),$4,0)`,
    [order, CLIENTE, pagamento, `ORD395A-${tag}-${seqOrdem}`],
  );
  await c.query(
    `INSERT INTO public.devolucoes
       (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,modalidade,metodo_retorno,status,valor_itens,valor_frete_ida,prazo_ate,politica)
     VALUES ($1,$2,$3,$4,'arrependimento','outro','reembolso','nacional','envio_proprio',$5,40,0,current_date+7,'{}')`,
    [dev, `DEV395A-${tag}-${seqOrdem}`, order, CLIENTE, status],
  );
  const di = [];
  for (const { p, v, q } of itens) {
    const oi = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
         VALUES ($1,$2,$3,'Item 395a',$4,10) RETURNING id`,
        [order, p, v, q],
      )
    ).rows[0].id;
    di.push(
      (
        await c.query(
          `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, variant_id, product_name, quantidade, valor_unitario)
           VALUES ($1,$2,$3,$4,'Item 395a',$5,10) RETURNING id`,
          [dev, oi, p, v, q],
        )
      ).rows[0].id,
    );
  }
  if (extraPedido) await c.query(extraPedido, [order]);
  return { order, dev, di };
}
const corpoItens = (di, over = {}) =>
  di.map((item_id, i) => ({
    item_id,
    condicao: "nova",
    reestocar: true,
    ...(over[i] ?? {}),
  }));

/** Chama a funcao como o admin atual, numa conexao ja dentro de BEGIN. */
async function concluirNaConexao(c, dev, resolucao, itens, valor = null) {
  await c.query(
    "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
    [ADMIN, CLAIMS_ADMIN],
  );
  await c.query("SET LOCAL ROLE authenticated");
  return c.query(
    "SELECT public.admin_devolucao_concluir($1::uuid,$2,$3::jsonb,$4::numeric,NULL) AS r",
    [dev, resolucao, JSON.stringify(itens), valor],
  );
}

async function esperarBloqueio(monitor, pid) {
  for (let i = 0; i < 100; i++) {
    const r = await monitor.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("a conclusao da devolucao nao esperou a trava da compra");
}

// ---------------------------------------------------------------------------
// Os cenarios de duas conexoes: c1 = a compra (trava em ordem global, em passos); c2 = a conclusao da devolucao
// ---------------------------------------------------------------------------
const trancaVariacoes = (ids) => ({
  sql: "SELECT 1 FROM public.product_variants v WHERE v.id = ANY($1::uuid[]) ORDER BY v.id FOR NO KEY UPDATE",
  params: [ids],
});
const trancaProdutos = (ids) => ({
  sql: "SELECT 1 FROM public.produtos p WHERE p.id = ANY($1::uuid[]) ORDER BY p.id FOR NO KEY UPDATE",
  params: [ids],
});
const CENARIOS = {
  // A compra de [V_A, V_B] tranca V_A e depois V_B. A devolucao [V_B, V_A] (corpo antigo) tranca V_B e espera V_A.
  "variação x variação": {
    itens: [
      { p: P_B, v: V_B, q: 2 },
      { p: P_A, v: V_A, q: 1 },
    ],
    passo1: trancaVariacoes([V_A]),
    passo2: trancaVariacoes([V_B]),
    credito: {
      produtos: [0, 0, 100, 100],
      variacoes: [11, 12],
      reestocados: 3,
    },
  },
  // A compra de [V_A] + o produto P_Q1 tranca V_A e depois os produtos. A devolucao [P_Q1, V_A] (antigo) tranca P_Q1 e espera V_A.
  "produto x variação": {
    itens: [
      { p: P_Q1, v: null, q: 2 },
      { p: P_A, v: V_A, q: 1 },
    ],
    passo1: trancaVariacoes([V_A]),
    passo2: trancaProdutos([P_A, P_Q1]),
    credito: {
      produtos: [0, 0, 102, 100],
      variacoes: [11, 10],
      reestocados: 3,
    },
  },
  // A compra de dois produtos tranca P_Q1 e depois P_Q2. A devolucao [P_Q2, P_Q1] (antigo) tranca P_Q2 e espera P_Q1.
  "produto x produto": {
    itens: [
      { p: P_Q2, v: null, q: 2 },
      { p: P_Q1, v: null, q: 1 },
    ],
    passo1: trancaProdutos([P_Q1]),
    passo2: trancaProdutos([P_Q2]),
    credito: {
      produtos: [0, 0, 101, 102],
      variacoes: [10, 10],
      reestocados: 3,
    },
  },
};

async function estoques(c) {
  const p = (
    await c.query(
      "SELECT estoque FROM public.produtos WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[P_A, P_B, P_Q1, P_Q2]],
    )
  ).rows.map((x) => Number(x.estoque));
  const v = (
    await c.query(
      "SELECT stock_increment FROM public.product_variants WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[V_A, V_B]],
    )
  ).rows.map((x) => Number(x.stock_increment));
  return { produtos: p, variacoes: v };
}

/** Volta o estoque e o estado da devolucao ao ponto de partida (tudo COMMITADO no clone). */
async function reiniciar(c, montada) {
  await c.query(
    "UPDATE public.produtos SET estoque = CASE WHEN id IN ($1, $2) THEN 100 ELSE 0 END WHERE id IN ($1, $2, $3, $4)",
    [P_Q1, P_Q2, P_A, P_B],
  );
  await c.query(
    "UPDATE public.product_variants SET stock_increment = 10 WHERE id IN ($1, $2)",
    [V_A, V_B],
  );
  await c.query(
    "UPDATE public.devolucoes SET status = 'recebida', resolucao_final = NULL, concluida_em = NULL, valor_reembolso = NULL, refund_id = NULL WHERE id = $1",
    [montada.dev],
  );
  await c.query(
    "UPDATE public.devolucao_itens SET condicao = NULL, reestocar = NULL, reestocado_em = NULL WHERE devolucao_id = $1",
    [montada.dev],
  );
  await c.query(
    "UPDATE public.marketplace_orders SET stock_returned_at = NULL WHERE id = $1",
    [montada.order],
  );
}

async function cruzar(montada, cenario) {
  const [c1, c2, monitor] = [
    await novoCliente(),
    await novoCliente(),
    await novoCliente(),
  ];
  const resultado = { c1: "ok", c2: "ok", retorno: null };
  try {
    await reiniciar(monitor, montada);
    const pid2 = (await c2.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await c1.query("BEGIN");
    await c1.query(cenario.passo1.sql, cenario.passo1.params); // a compra tranca a PRIMEIRA linha da ordem global
    await c2.query("BEGIN");
    const emVoo = concluirNaConexao(
      c2,
      montada.dev,
      "troca",
      corpoItens(montada.di),
    ).then(
      (r) => ({ r: r.rows[0].r }),
      (e) => ({ codigo: e.code }),
    );
    await esperarBloqueio(monitor, pid2); // a conclusao ficou esperando a trava que a compra segura
    try {
      await c1.query(cenario.passo2.sql, cenario.passo2.params); // a compra pede a SEGUNDA trava
    } catch (e) {
      resultado.c1 = e.code;
    }
    if (resultado.c1 === "ok") await c1.query("COMMIT");
    else await c1.query("ROLLBACK");
    const fim = await emVoo;
    if (fim.codigo) {
      resultado.c2 = fim.codigo;
      await c2.query("ROLLBACK");
    } else {
      resultado.retorno = fim.r;
      await c2.query("COMMIT");
    }
  } finally {
    await Promise.all([c1, c2, monitor].map((x) => x.end().catch(() => {})));
  }
  return resultado;
}

/** Roda os tres cenarios. `esperaDeadlock`: exatamente um dos dois e' derrubado (40P01); senao ninguem e o estoque e' creditado uma vez. */
async function provaDosCenarios(
  esperaDeadlock,
  rotulo,
  quais = Object.keys(CENARIOS),
) {
  const falhas = [];
  FAIXA = 0;
  for (const nome of quais) {
    const cenario = CENARIOS[nome];
    const montada = await montar(T.C, nome, cenario.itens);
    const r = await cruzar(montada, cenario);
    const derrubados = [r.c1, r.c2].filter((x) => x === "40P01").length;
    if (esperaDeadlock) {
      if (derrubados !== 1)
        falhas.push(
          `${rotulo} / ${nome}: o banco tinha de derrubar exatamente um (40P01), deu ${JSON.stringify(r)}`,
        );
    } else {
      if (r.c1 !== "ok" || r.c2 !== "ok")
        falhas.push(
          `${rotulo} / ${nome}: ninguem pode ser derrubado: ${JSON.stringify(r)}`,
        );
      else {
        if (r.retorno?.reestocados !== cenario.credito.reestocados)
          falhas.push(
            `${rotulo} / ${nome}: reestocados ${r.retorno?.reestocados}`,
          );
        const e = await estoques(T.C);
        if (
          JSON.stringify(e.produtos) !==
          JSON.stringify(cenario.credito.produtos)
        )
          falhas.push(
            `${rotulo} / ${nome}: produtos ${JSON.stringify(e.produtos)}`,
          );
        if (
          JSON.stringify(e.variacoes) !==
          JSON.stringify(cenario.credito.variacoes)
        )
          falhas.push(
            `${rotulo} / ${nome}: variacoes ${JSON.stringify(e.variacoes)}`,
          );
        const d = (
          await T.C.query(
            "SELECT status FROM public.devolucoes WHERE id = $1",
            [montada.dev],
          )
        ).rows[0];
        if (d.status !== "concluida")
          falhas.push(`${rotulo} / ${nome}: status ${d.status}`);
      }
    }
  }
  return falhas;
}

/** Instala o corpo (COMMITADO, sem transacao) e roda os cenarios. */
async function comCorpoCommitado(corpoSql, f) {
  await T.C.query(corpoSql);
  try {
    return await f();
  } finally {
    await T.C.query(T.decl(T.NOVA));
  }
}

// ---------------------------------------------------------------------------
// O DEFEITO e a CORRECAO (duas conexoes reais, COMMIT)
// ---------------------------------------------------------------------------
T.prova(
  "DEFEITO: com o corpo da 20261343000000 (byte a byte) duas conexoes reais cruzam travas e o banco derruba exatamente UMA com 40P01 nos tres cenarios (variacao x variacao, produto x variacao, produto x produto)",
  async () => {
    await semearBase(T.C);
    await semearEstoque(T.C);
    const falhas = await comCorpoCommitado(T.decl(T.ANTIGA), () =>
      provaDosCenarios(true, "corpo da 343"),
    );
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

T.prova(
  "CORRECAO: com o corpo desta migration, nos MESMOS tres cenarios, ninguem e derrubado e cada unidade e creditada uma vez (estoque, retorno e status da devolucao)",
  async () => {
    const falhas = await comCorpoCommitado(
      T.MUTADO ? T.decl(T.NOVA) : T.MIGRATION,
      () => provaDosCenarios(false, "corpo novo"),
    );
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

// ---------------------------------------------------------------------------
// A matriz diferencial: o mesmo caso da o mesmo resultado nos dois corpos (transacao desfeita)
// ---------------------------------------------------------------------------
async function foto(c, m) {
  const dev = (
    await c.query(
      `SELECT status, resolucao_final, valor_reembolso::text AS valor, reembolso_manual, (refund_id IS NOT NULL) AS tem_refund,
              (concluida_em IS NOT NULL) AS concluida_em, observacao_inspecao
         FROM public.devolucoes WHERE id = $1`,
      [m.dev],
    )
  ).rows[0];
  const itens = (
    await c.query(
      `SELECT condicao, reestocar, (reestocado_em IS NOT NULL) AS reestocado
         FROM public.devolucao_itens WHERE devolucao_id = $1 ORDER BY product_id, variant_id NULLS FIRST`,
      [m.dev],
    )
  ).rows;
  const refunds = (
    await c.query(
      "SELECT amount::text AS amount, status, solicitado_por FROM public.order_refunds WHERE order_id = $1 ORDER BY amount",
      [m.order],
    )
  ).rows;
  const eventos = (
    await c.query(
      "SELECT de_status, para_status, ator, nota FROM public.devolucao_eventos WHERE devolucao_id = $1 ORDER BY id",
      [m.dev],
    )
  ).rows;
  return { dev, itens, refunds, eventos, estoque: await estoques(c) };
}

const MATRIZ = {
  "so produto, troca": async (c) => {
    const m = await montar(c, "m1", [
      { p: P_Q1, v: null, q: 2 },
      { p: P_Q2, v: null, q: 1 },
    ]);
    return { m, args: ["troca", corpoItens(m.di)] };
  },
  "so variacao, vale": async (c) => {
    const m = await montar(c, "m2", [
      { p: P_B, v: V_B, q: 2 },
      { p: P_A, v: V_A, q: 3 },
    ]);
    return { m, args: ["vale", corpoItens(m.di)] };
  },
  "misto, reembolso (valor padrao)": async (c) => {
    const m = await montar(c, "m3", [
      { p: P_Q1, v: null, q: 1 },
      { p: P_B, v: V_B, q: 2 },
      { p: P_A, v: V_A, q: 1 },
    ]);
    return { m, args: ["reembolso", corpoItens(m.di)] };
  },
  "misto, reembolso com valor": async (c) => {
    const m = await montar(c, "m4", [
      { p: P_Q1, v: null, q: 1 },
      { p: P_A, v: V_A, q: 1 },
    ]);
    return { m, args: ["reembolso", corpoItens(m.di), 12.34] };
  },
  "ausente, danificada e sem reestocar: nada volta, o resto segue": async (
    c,
  ) => {
    const m = await montar(c, "m5", [
      { p: P_Q1, v: null, q: 1 },
      { p: P_B, v: V_B, q: 1 },
      { p: P_A, v: V_A, q: 1 },
    ]);
    return {
      m,
      args: [
        "troca",
        corpoItens(m.di, {
          0: { condicao: "ausente" },
          1: { condicao: "danificada" },
          2: { reestocar: false },
        }),
      ],
    };
  },
  "pedido ja devolvido (carimbo): condicao grava, estoque nao volta": async (
    c,
  ) => {
    const m = await montar(
      c,
      "m6",
      [
        { p: P_Q1, v: null, q: 2 },
        { p: P_A, v: V_A, q: 1 },
      ],
      {
        extraPedido:
          "UPDATE public.marketplace_orders SET stock_returned_at = now() WHERE id = $1",
      },
    );
    return { m, args: ["troca", corpoItens(m.di)] };
  },
  "item ja reestocado antes: nao credita de novo": async (c) => {
    const m = await montar(c, "m7", [
      { p: P_Q1, v: null, q: 2 },
      { p: P_A, v: V_A, q: 1 },
    ]);
    await c.query(
      "UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = $1",
      [m.di[1]],
    );
    return { m, args: ["troca", corpoItens(m.di)] };
  },
  "lista de itens vazia: recusa a condicao faltando": async (c) => {
    const m = await montar(c, "m8", [{ p: P_Q1, v: null, q: 1 }]);
    return { m, args: ["troca", []] };
  },
  "condicao invalida": async (c) => {
    const m = await montar(c, "m9", [{ p: P_Q1, v: null, q: 1 }]);
    return {
      m,
      args: ["troca", corpoItens(m.di, { 0: { condicao: "quebrada" } })],
    };
  },
  "item de outra devolucao": async (c) => {
    const outra = await montar(c, "m10b", [{ p: P_Q2, v: null, q: 1 }]);
    const m = await montar(c, "m10", [{ p: P_Q1, v: null, q: 1 }]);
    return { m, args: ["troca", corpoItens([outra.di[0]])] };
  },
  "devolucao fora de ordem (ainda solicitada)": async (c) => {
    const m = await montar(c, "m11", [{ p: P_Q1, v: null, q: 1 }], {
      status: "solicitada",
    });
    return { m, args: ["troca", corpoItens(m.di)] };
  },
  "pedido sem pagamento registrado": async (c) => {
    const m = await montar(c, "m12", [{ p: P_Q1, v: null, q: 1 }], {
      pagamento: "aguardando",
    });
    return { m, args: ["troca", corpoItens(m.di)] };
  },
};

/** Roda a matriz inteira no estado pedido; `mutado` (opcional) troca o corpo novo por uma sabotagem DENTRO da transacao desfeita. */
async function rodarMatriz(estado, mutado = null) {
  const saida = {};
  for (const [nome, preparar] of Object.entries(MATRIZ)) {
    saida[nome] = await T.emTransacao(
      async () => {
        if (mutado) await T.C.query(T.decl(T.NOVA, mutado));
        FAIXA = 1;
        await semearBase(T.C);
        await semearEstoque(T.C);
        SEQ[1] = 0;
        const { m, args } = await preparar(T.C);
        await T.C.query("SAVEPOINT caso");
        let resultado;
        try {
          const r = await concluirNaConexao(T.C, m.dev, ...args);
          const j = r.rows[0].r;
          resultado = { ...j, refund_id: j.refund_id ? "tem" : null };
        } catch (e) {
          resultado = { erro: e.message, codigo: e.code };
          await T.C.query("ROLLBACK TO SAVEPOINT caso");
        }
        await T.C.query("RESET ROLE");
        return { resultado, foto: await foto(T.C, m) };
      },
      { estado },
    );
  }
  return saida;
}

T.prova(
  "DIFERENCIAL: 12 casos (so produto, so variacao, misto, reembolso com e sem valor, ausente/danificada/sem reestocar, pedido ja devolvido, item ja reestocado, condicao faltando ou invalida, item de outra devolucao, devolucao fora de ordem, pagamento ausente) dao o MESMO retorno, estoque, linhas de devolucao, reembolso e eventos nos dois corpos",
  async () => {
    const antes = await rodarMatriz("antes");
    const depois = await rodarMatriz("depois");
    for (const nome of Object.keys(MATRIZ))
      assert.deepEqual(depois[nome], antes[nome], `caso "${nome}" mudou`);
    // E a matriz prova que os casos exercitam de verdade: ha credito, ha recusa, ha reembolso.
    assert.equal(depois["so produto, troca"].resultado.reestocados, 3);
    assert.equal(
      depois["misto, reembolso (valor padrao)"].resultado.reembolso_manual,
      false,
    );
    assert.ok(
      depois["misto, reembolso (valor padrao)"].foto.refunds.length === 1,
      "o reembolso do app nasceu",
    );
    assert.equal(depois["condicao invalida"].resultado.codigo, "22023");
    assert.equal(depois["item de outra devolucao"].resultado.codigo, "22023");
    assert.equal(
      depois["devolucao fora de ordem (ainda solicitada)"].resultado.codigo,
      "22023",
    );
    assert.equal(
      depois["pedido sem pagamento registrado"].resultado.codigo,
      "22023",
    );
    assert.equal(
      depois["pedido ja devolvido (carimbo): condicao grava, estoque nao volta"]
        .resultado.reestocados,
      0,
    );
    assert.equal(
      depois["item ja reestocado antes: nao credita de novo"].resultado
        .reestocados,
      2,
    );
  },
);

T.prova(
  "PORTA: so o admin ATUAL conclui (cliente comum 42501; anon sem EXECUTE); a recusa vem ANTES de qualquer trava (a conexao do cliente nao espera uma compra que segura o estoque)",
  () =>
    T.emTransacao(
      async () => {
        FAIXA = 2;
        SEQ[2] = 0;
        await semearBase(T.C);
        await semearEstoque(T.C);
        const m = await montar(T.C, "porta", [{ p: P_Q1, v: null, q: 1 }]);
        for (const [rotulo, quem, claims, papel] of [
          ["cliente", CLIENTE, { role: "authenticated" }, "authenticated"],
          ["anon", CLIENTE, { role: "anon" }, "anon"],
        ]) {
          await T.C.query("SAVEPOINT p");
          await T.C.query(
            "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
            [quem, JSON.stringify(claims)],
          );
          await T.C.query(`SET LOCAL ROLE ${papel}`);
          let codigo = "passou";
          try {
            await T.C.query(
              "SELECT public.admin_devolucao_concluir($1::uuid,'troca',$2::jsonb,NULL,NULL)",
              [m.dev, JSON.stringify(corpoItens(m.di))],
            );
          } catch (e) {
            codigo = e.code;
          }
          await T.C.query("ROLLBACK TO SAVEPOINT p");
          await T.C.query("RESET ROLE");
          assert.equal(codigo, "42501", `${rotulo}: ${codigo}`);
        }
      },
      { estado: "depois" },
    ),
);

// O DIFERENCIAL nao e' vacuo: um corpo novo que muda o credito (do produto ou da variacao) torna a matriz vermelha.
const CREDITO_PRODUTO =
  "UPDATE public.produtos SET estoque = estoque + v_di.quantidade WHERE id = v_di.product_id;";
const CREDITO_VARIACAO =
  "UPDATE public.product_variants SET stock_increment = stock_increment + v_di.quantidade";
for (const [nome, de, para] of [
  [
    "credita o dobro no produto",
    CREDITO_PRODUTO,
    CREDITO_PRODUTO.replace("+ v_di.quantidade", "+ 2 * v_di.quantidade"),
  ],
  [
    "credita um a menos na variacao",
    CREDITO_VARIACAO,
    CREDITO_VARIACAO.replace("+ v_di.quantidade", "+ v_di.quantidade - 1"),
  ],
]) {
  T.prova(
    `MUTANTE do diferencial vermelho — ${nome}: a matriz enxerga a diferenca`,
    async () => {
      const mutado = trocar(de, para)(T.NOVA.corpo);
      assert.notEqual(mutado, T.NOVA.corpo);
      const antes = await rodarMatriz("antes");
      const depois = await rodarMatriz("depois", mutado);
      const diferentes = Object.keys(MATRIZ).filter(
        (n) => JSON.stringify(depois[n]) !== JSON.stringify(antes[n]),
      );
      assert.ok(
        diferentes.length > 0,
        `o mutante "${nome}" NAO deixou a matriz vermelha`,
      );
      console.log(
        `    (a matriz viu a diferenca em ${diferentes.length} caso(s))`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// MUTANTES: cada trava tirada volta a dar 40P01 nos cenarios que ela previne
// ---------------------------------------------------------------------------
const trocar = (de, para) => (corpo) => {
  assert.equal(
    corpo.split(de).length - 1,
    1,
    `a ancora do mutante nao e unica: ${de}`,
  );
  return corpo.replace(de, () => para);
};
const PERFORM_VARIANTES =
  "      PERFORM 1\n        FROM public.product_variants v\n       WHERE v.id = ANY(v_trava_variantes)\n       ORDER BY v.id\n         FOR NO KEY UPDATE;\n";
const PERFORM_PRODUTOS =
  "      PERFORM 1\n        FROM public.produtos p\n       WHERE p.id = ANY(v_trava_produtos)\n       ORDER BY p.id\n         FOR NO KEY UPDATE;\n";
const MUTANTES = {
  "sem a trava das variacoes": {
    aplica: trocar(PERFORM_VARIANTES, ""),
    deadlockEm: ["variação x variação", "produto x variação"],
  },
  "sem a trava dos produtos": {
    aplica: trocar(PERFORM_PRODUTOS, ""),
    deadlockEm: ["produto x produto"],
  },
  "sem o ORDER BY das variacoes (a ordem do heap, decrescente)": {
    aplica: trocar(
      PERFORM_VARIANTES,
      PERFORM_VARIANTES.replace("       ORDER BY v.id\n", ""),
    ),
    deadlockEm: ["variação x variação"],
  },
  "sem o ORDER BY dos produtos (a ordem do heap, decrescente)": {
    aplica: trocar(
      PERFORM_PRODUTOS,
      PERFORM_PRODUTOS.replace("       ORDER BY p.id\n", ""),
    ),
    deadlockEm: ["produto x produto"],
  },
  "o bloco inteiro DEPOIS do laco (as travas vem tarde demais)": {
    aplica: (corpo) => {
      const ini = corpo.indexOf(
        "  -- >>> ordem global das travas (20261395200000)",
      );
      const marcaFim = "  -- <<< ordem global das travas (20261395200000)\n\n";
      const fim = corpo.indexOf(marcaFim) + marcaFim.length;
      const bloco = corpo.slice(ini, fim);
      const semBloco = corpo.slice(0, ini) + corpo.slice(fim);
      const ancora =
        "  IF EXISTS (SELECT 1 FROM public.devolucao_itens WHERE devolucao_id = p_id AND condicao IS NULL) THEN";
      assert.equal(semBloco.split(ancora).length - 1, 1);
      return semBloco.replace(ancora, () => bloco + ancora);
    },
    deadlockEm: [
      "variação x variação",
      "produto x variação",
      "produto x produto",
    ],
  },
};
for (const [nome, { aplica, deadlockEm }] of Object.entries(MUTANTES)) {
  T.prova(
    `MUTANTE vermelho — ${nome}: volta o 40P01 nos cenarios que a trava previne`,
    async () => {
      const mutado = aplica(T.NOVA.corpo);
      assert.notEqual(mutado, T.NOVA.corpo, "a sabotagem nao mudou o corpo");
      const falhas = await comCorpoCommitado(T.decl(T.NOVA, mutado), () =>
        provaDosCenarios(false, nome, deadlockEm),
      );
      assert.ok(falhas.length > 0, `o mutante "${nome}" NAO ficou vermelho`);
      for (const cen of deadlockEm)
        assert.ok(
          falhas.some((x) => x.includes(`/ ${cen}`) && x.includes("40P01")),
          `o mutante "${nome}" devia dar 40P01 em "${cen}"; deu: ${falhas.join(" | ")}`,
        );
      console.log(
        `    (40P01 em ${deadlockEm.length} cenario(s); ex.: ${falhas[0].slice(0, 120)})`,
      );
    },
  );
}

T.main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});

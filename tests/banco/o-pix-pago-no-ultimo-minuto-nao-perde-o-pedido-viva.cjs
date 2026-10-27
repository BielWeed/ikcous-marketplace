"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261393000000_o_pix_pago_no_ultimo_minuto_nao_perde_o_pedido.sql (public.expirar_pedidos_vencidos,
 * a folga de 10 minutos do PIX com cobranca na vaga) contra o Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci, job
 * do dinheiro). Nunca banco de loja. Quase tudo numa transacao desfeita no fim; a prova de TRAVA (duas conexoes) grava de
 * verdade, por isso so roda via rodar-isolado.cjs (o clone some no fim).
 *
 * O que prova:
 *  (1) A bateria de pedidos (cada um com o estoque de um produto proprio, varredura UMA vez): PIX com vaga vencido ha 60 s e
 *      ha 599 s NAO expira; ha 600 s (a borda, `<=`), 601 s e 11 min expira e devolve o estoque UMA vez; PIX sem vaga, PIX com
 *      vaga e metodo NULL (pedido legado) expiram no horario de sempre; o sentinela 'verificando:' (com 'pix' ou sem metodo)
 *      e o cartao com vaga seguem a regra de 24 h; cartao sem vaga expira; pedido cancelado ou ja pago nao e tocado. Segunda
 *      varredura: nada novo. Passado o tempo (o PIX em folga vence ha 11 min), a varredura seguinte o expira e devolve UMA vez.
 *  (2) O DEFEITO, ponta a ponta: o QR venceu ha 40 s, a varredura roda e o aviso do Mercado Pago chega depois. Corpo novo: a
 *      varredura poupa o pedido e o aviso vira 'pago' (estoque reservado). CONTROLE com o corpo da 20261186000000 (rollback):
 *      a varredura cancela, devolve o estoque e o aviso vira 'pago_apos_expirar'.
 *  (3) Vaga liberada (liberar_cobranca_do_pedido zera id e metodo): o PIX em folga expira na varredura seguinte.
 *  (4) Mutantes (sem o predicado, sem o COALESCE, metodo trocado, folga de 24 h) deixam a bateria vermelha; o corpo anterior
 *      reprova a bateria. (O mutante "sem o NOT LIKE 'verificando:%'" e EQUIVALENTE: o predicado do cartao ja segura o
 *      sentinela por 24 h, mais que os 10 minutos do PIX; a clausula so documenta a intencao.)
 *  (5) Reaplicar 2x deixa OID, dono, ACL, atributos e texto iguais; o rollback devolve o corpo da 20261186000000 byte a byte;
 *      rodar o rollback de novo deixa o mesmo estado; reaplicar depois volta.
 *  (6) Pre-voo recusa sem escrever (corpo desconhecido, ACL aberta para anon, sobrecarga, atributo trocado, coluna ausente);
 *      o rollback recusa corpo desconhecido; a conferencia final sabotada derruba o arquivo inteiro.
 *  (7) Duas conexoes reais: a varredura PULA a linha que outra transacao segura (SKIP LOCKED continua valendo) e a pega na
 *      varredura seguinte; o aviso 'pago' que chega DURANTE a folga nao disputa a linha com a varredura.
 *  (8) Consultas 103a/103b leem o estado certo nos dois sentidos, com o rol fechado do conferir-banco; a prova somente leitura
 *      da release (verificar-pagamentos-ikcous) pina o md5 desta migration.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261393000000_o_pix_pago_no_ultimo_minuto_nao_perde_o_pedido.sql";
const NOME_ANTERIOR = "20261186000000_cartao_em_analise_segura_a_expiracao.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.expirar_pedidos_vencidos\(\)[\s\S]*?AS \$expirar\$([\s\S]*?)\$expirar\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_ANTERIOR}`));
const CORPO_NOVO = corpoDe(migration);
const HASH_ANTES = "4e6b4c105ee2eaaecd9c2e19a5c535af";
const HASH_NOVO = "463086667b8d20b327c37faac9a9b16f";
const ASSINATURA = "public.expirar_pedidos_vencidos()";
const C103A =
  "103a-conferir-o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-aplicado";
const C103B =
  "103b-antes-o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-base-vigente";
const CABECALHO_DA_FUNCAO = migration.match(
  /CREATE OR REPLACE FUNCTION public\.expirar_pedidos_vencidos\(\)[\s\S]*?\nAS \$expirar\$/,
)[0];
const trocarCorpo = (c, corpo) =>
  c.query(`${CABECALHO_DA_FUNCAO}${corpo}$expirar$;`);

const U_CLIENTE = "e3931000-1393-4000-8000-000000000001";
const ESTOQUE = 10;
const QTD = 3;
let contador = 0;
const uuid = (prefixo) =>
  `${prefixo}-1393-4000-8000-${String(++contador).padStart(12, "0")}`;

async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso1393");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso1393");
    await c.query("RELEASE SAVEPOINT caso1393");
  }
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa1393");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa1393");
    await c.query("RELEASE SAVEPOINT recusa1393");
  }
}

async function usuario(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'cliente@pix1393.teste', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_CLIENTE],
  );
}

/**
 * Um pedido 'aguardando'/'pending' com UM produto proprio (estoque 10) e 1 item de 3 unidades. `vencidoSeg`: ha quantos
 * segundos o prazo venceu (negativo = ainda no prazo). Devolve { id, produto, vaga }.
 */
async function pedido(c, o) {
  const id = uuid("a3931000");
  const produto = uuid("b3931000");
  const vaga = o.vaga === undefined ? `ORD-1393-${contador}` : o.vaga;
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto Pix1393', 10.00, 25.00, $2, true, false)`,
    [produto, ESTOQUE],
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, expires_at, metodo_online, gateway_payment_id)
     VALUES ($1, $2, 'Cliente Pix1393', '{}'::jsonb, 75, 75, $3, 'online',
             'online', $4, now() - make_interval(secs => $5::int), $6, $7)`,
    [
      id,
      U_CLIENTE,
      o.status ?? "pending",
      o.paymentStatus ?? "aguardando",
      o.vencidoSeg,
      o.metodo === undefined ? null : o.metodo,
      vaga,
    ],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Produto Pix1393', $3, 25.00)`,
    [id, produto, QTD],
  );
  return { id, produto, vaga };
}
const estoque = async (c, p) =>
  Number(
    (
      await c.query("SELECT estoque FROM public.produtos WHERE id = $1", [
        p.produto,
      ])
    ).rows[0].estoque,
  );
const estado = async (c, p) =>
  (
    await c.query(
      "SELECT status, payment_status FROM public.marketplace_orders WHERE id = $1",
      [p.id],
    )
  ).rows[0];
const varrer = async (c) =>
  Number(
    (await c.query("SELECT public.expirar_pedidos_vencidos() AS n")).rows[0].n,
  );

const VIVO = { status: "pending", payment_status: "aguardando" };
const EXPIRADO = { status: "cancelled", payment_status: "expirado" };
// [rotulo, opcoes do pedido, expira?]
const MIN = 60;
const CASOS = [
  [
    "PIX com vaga, vencido ha 60 s: NAO expira",
    { metodo: "pix", vencidoSeg: 60 },
    false,
  ],
  [
    "PIX com vaga, vencido ha 599 s: NAO expira",
    { metodo: "pix", vencidoSeg: 599 },
    false,
  ],
  [
    "PIX com vaga, vencido ha 600 s (a borda, <=): expira",
    { metodo: "pix", vencidoSeg: 600 },
    true,
  ],
  [
    "PIX com vaga, vencido ha 601 s: expira",
    { metodo: "pix", vencidoSeg: 601 },
    true,
  ],
  [
    "PIX com vaga, vencido ha 11 min: expira",
    { metodo: "pix", vencidoSeg: 11 * MIN },
    true,
  ],
  [
    "PIX sem vaga (id NULL), vencido ha 60 s: expira no horario de sempre",
    { metodo: "pix", vaga: null, vencidoSeg: 60 },
    true,
  ],
  [
    "metodo NULL com id de gateway (pedido legado), vencido ha 60 s: expira no horario de sempre",
    { metodo: null, vencidoSeg: 60 },
    true,
  ],
  [
    "pedido sem metodo e sem id (NULL/NULL), vencido ha 60 s: expira",
    { metodo: null, vaga: null, vencidoSeg: 60 },
    true,
  ],
  [
    "sentinela do cartao com metodo 'pix', vencido ha 31 min: NAO expira (24 h)",
    { metodo: "pix", vaga: "verificando:s1", vencidoSeg: 31 * MIN },
    false,
  ],
  [
    "sentinela com metodo NULL, vencido ha 31 min: NAO expira (24 h)",
    { metodo: null, vaga: "verificando:s2", vencidoSeg: 31 * MIN },
    false,
  ],
  [
    "sentinela com metodo 'pix', vencido ha 24 h + 1 min: expira (passou do teto)",
    { metodo: "pix", vaga: "verificando:s3", vencidoSeg: (24 * 60 + 1) * MIN },
    true,
  ],
  [
    "credito com vaga, vencido ha 31 min: NAO expira (24 h)",
    { metodo: "credito", vencidoSeg: 31 * MIN },
    false,
  ],
  [
    "debito com vaga, vencido ha 31 min: NAO expira (24 h)",
    { metodo: "debito", vencidoSeg: 31 * MIN },
    false,
  ],
  [
    "credito com vaga, vencido ha 24 h + 1 min: expira (passou do teto)",
    { metodo: "credito", vencidoSeg: (24 * 60 + 1) * MIN },
    true,
  ],
  [
    "credito sem vaga, vencido ha 60 s: expira",
    { metodo: "credito", vaga: null, vencidoSeg: 60 },
    true,
  ],
  [
    "PIX com vaga ainda no prazo (vence daqui a 5 min): nao e tocado",
    { metodo: "pix", vencidoSeg: -5 * MIN },
    false,
  ],
];
// Pedidos que a varredura nunca pega, em qualquer corpo: ficam EXATAMENTE como estao.
const INTOCAVEIS = [
  [
    "PIX com vaga ja cancelado pelo cliente (status cancelled), vencido ha 11 min",
    { metodo: "pix", vencidoSeg: 11 * MIN, status: "cancelled" },
    { status: "cancelled", payment_status: "aguardando" },
  ],
  [
    "PIX com vaga ja pago, vencido ha 11 min",
    { metodo: "pix", vencidoSeg: 11 * MIN, paymentStatus: "pago" },
    { status: "pending", payment_status: "pago" },
  ],
];

/** A bateria inteira numa varredura. Devolve a lista de erros (vazia = tudo certo). */
async function bateria(c) {
  const erros = [];
  const vivos = [];
  for (const [rotulo, op, expira] of CASOS)
    vivos.push({ rotulo, expira, p: await pedido(c, op) });
  const intocaveis = [];
  for (const [rotulo, op, esperado] of INTOCAVEIS)
    intocaveis.push({ rotulo, esperado, p: await pedido(c, op) });
  const n = await varrer(c);
  const esperadoN = vivos.filter((v) => v.expira).length;
  if (n !== esperadoN)
    erros.push(`varredura expirou ${n}, esperava ${esperadoN}`);
  for (const { rotulo, expira, p } of vivos) {
    const e = await estado(c, p);
    const s = await estoque(c, p);
    const [eEsp, sEsp] = expira ? [EXPIRADO, ESTOQUE + QTD] : [VIVO, ESTOQUE];
    if (JSON.stringify(e) !== JSON.stringify(eEsp) || s !== sEsp)
      erros.push(
        `${rotulo}: estado ${JSON.stringify(e)} estoque ${s}, esperava ${JSON.stringify(eEsp)} / ${sEsp}`,
      );
  }
  for (const { rotulo, esperado, p } of intocaveis) {
    const e = await estado(c, p);
    const s = await estoque(c, p);
    if (JSON.stringify(e) !== JSON.stringify(esperado) || s !== ESTOQUE)
      erros.push(`${rotulo}: foi tocado (${JSON.stringify(e)} / ${s})`);
  }
  // Segunda varredura: nada novo e nenhum estoque devolvido de novo.
  const n2 = await varrer(c);
  if (n2 !== 0) erros.push(`segunda varredura expirou ${n2}, esperava 0`);
  for (const { rotulo, expira, p } of vivos)
    if ((await estoque(c, p)) !== (expira ? ESTOQUE + QTD : ESTOQUE))
      erros.push(`${rotulo}: o estoque mudou na segunda varredura`);
  return erros;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await usuario(c);

    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o da 20261186000000. ----
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o da 20261393",
    );
    assert.equal(md5(topo.prosrc), HASH_NOVO);
    assert.equal(md5(CORPO_ANTES), HASH_ANTES);
    assert.equal(topo.prosecdef, true);
    assert.deepEqual(topo.proconfig, ["search_path=public"]);
    console.log(
      "  PASSOU o topo instalado e o corpo desta migration (md5 conhecido)",
    );

    // ---- 1. A bateria inteira no corpo novo. ----
    const verde = await isolado(c, () => bateria(c));
    assert.deepEqual(verde, [], verde.join("\n"));
    console.log(
      `  PASSOU a bateria: ${CASOS.length} pedidos varridos de uma vez (PIX em folga poupado, borda de 600 s, sem vaga/legado/sentinela/cartao como pede a regra) e ${INTOCAVEIS.length} intocaveis`,
    );

    // ---- 1b. Passa o tempo: o PIX em folga vence ha 11 min e a varredura seguinte o expira, UMA vez. ----
    await isolado(c, async () => {
      const p = await pedido(c, { metodo: "pix", vencidoSeg: 60 });
      assert.equal(await varrer(c), 0);
      await c.query(
        "UPDATE public.marketplace_orders SET expires_at = now() - interval '11 minutes' WHERE id = $1",
        [p.id],
      );
      assert.equal(await varrer(c), 1);
      assert.deepEqual(await estado(c, p), EXPIRADO);
      assert.equal(await estoque(c, p), ESTOQUE + QTD);
      assert.equal(await varrer(c), 0);
      assert.equal(await estoque(c, p), ESTOQUE + QTD, "devolveu duas vezes");
    });
    console.log(
      "  PASSOU o PIX em folga expira quando completa 10 min e o estoque volta uma vez so",
    );

    // ---- 2. O defeito, ponta a ponta, com o controle no corpo da 20261186000000. ----
    const cenario = async () => {
      const p = await pedido(c, { metodo: "pix", vencidoSeg: 40 });
      const varridos = await varrer(c);
      const aviso = (
        await c.query(
          "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
          [p.id, p.vaga],
        )
      ).rows[0].r;
      return {
        varridos,
        aviso,
        estoque: await estoque(c, p),
        estado: await estado(c, p),
      };
    };
    const novo = await isolado(c, cenario);
    assert.equal(
      novo.varridos,
      0,
      "a varredura cancelou o PIX pago no ultimo minuto",
    );
    assert.equal(novo.aviso, "pago");
    assert.equal(novo.estoque, ESTOQUE, "a mercadoria voltou a prateleira");
    assert.equal(novo.estado.payment_status, "pago");
    const antigo = await isolado(c, async () => {
      await c.query(rollback);
      return cenario();
    });
    assert.equal(
      antigo.varridos,
      1,
      "controle: o corpo anterior devia cancelar",
    );
    assert.equal(antigo.aviso, "pago_apos_expirar", "controle: o defeito");
    assert.equal(
      antigo.estoque,
      ESTOQUE + QTD,
      "controle: a mercadoria voltou",
    );
    console.log(
      "  PASSOU o cenario do defeito: corpo novo -> aviso vira 'pago' e o estoque fica reservado; corpo anterior (controle) -> 'pago_apos_expirar' e o estoque voltou",
    );

    // ---- 3. Vaga liberada: o PIX em folga expira na varredura seguinte. ----
    await isolado(c, async () => {
      const p = await pedido(c, { metodo: "pix", vencidoSeg: 60 });
      assert.equal(await varrer(c), 0);
      const lib = (
        await c.query(
          "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2::text) AS r",
          [p.id, p.vaga],
        )
      ).rows[0].r;
      assert.equal(lib, true);
      assert.equal(await varrer(c), 1);
      assert.deepEqual(await estado(c, p), EXPIRADO);
      assert.equal(await estoque(c, p), ESTOQUE + QTD);
    });
    console.log(
      "  PASSOU vaga liberada (cobranca recusada ou cancelada): o PIX expira na varredura seguinte",
    );

    // ---- 4. Controle e mutantes. ----
    const MUTANTES = [
      [
        "sem o predicado do PIX (folga zero)",
        (s) =>
          s.replace(
            /\n {10}-- PIX com cobranca na vaga ganha[\s\S]*?\n {10}AND \(\n {16}expires_at <= now\(\) - interval '10 minutes'[\s\S]*?\n {14}\)\n(?= {8}FOR UPDATE SKIP LOCKED)/,
            "\n",
          ),
      ],
      [
        "sem o COALESCE (PIX sem metodo some da varredura)",
        (s) =>
          s.replace(
            /OR NOT COALESCE\(\n {21}gateway_payment_id IS NOT NULL\n {21}AND gateway_payment_id NOT LIKE 'verificando:%'\n {21}AND metodo_online = 'pix',\n {21}false\n {19}\)/,
            "OR NOT (gateway_payment_id IS NOT NULL AND gateway_payment_id NOT LIKE 'verificando:%' AND metodo_online = 'pix')",
          ),
      ],
      [
        "metodo trocado ('pix' por 'credito')",
        (s) =>
          s.replace(
            "AND metodo_online = 'pix',",
            "AND metodo_online = 'credito',",
          ),
      ],
      [
        "folga de 24 h no lugar de 10 minutos",
        (s) => s.replace("interval '10 minutes'", "interval '24 hours'"),
      ],
      [
        "folga de 10 minutos para TODO pedido (sem olhar vaga nem metodo)",
        (s) =>
          s.replace(
            /OR NOT COALESCE\(\n {21}gateway_payment_id IS NOT NULL\n {21}AND gateway_payment_id NOT LIKE 'verificando:%'\n {21}AND metodo_online = 'pix',\n {21}false\n {19}\)/,
            "OR false",
          ),
      ],
      [
        "folga para todo PIX, tenha vaga ou nao (sem olhar o id do gateway)",
        (s) =>
          s.replace(
            "gateway_payment_id IS NOT NULL\n                     AND gateway_payment_id NOT LIKE 'verificando:%'\n                     AND metodo_online = 'pix',",
            "metodo_online = 'pix',",
          ),
      ],
    ];
    for (const [nome, mutar] of MUTANTES) {
      const corpo = mutar(CORPO_NOVO);
      assert.notEqual(corpo, CORPO_NOVO, `o mutante "${nome}" nao mudou nada`);
      const erros = await isolado(c, async () => {
        await trocarCorpo(c, corpo);
        return bateria(c);
      });
      assert.ok(erros.length > 0, `o mutante "${nome}" sobreviveu`);
    }
    const errosAnterior = await isolado(c, async () => {
      await c.query(rollback);
      return bateria(c);
    });
    assert.ok(
      errosAnterior.length >= 2,
      `o corpo anterior teria de reprovar a bateria (${errosAnterior.length})`,
    );
    console.log(
      `  PASSOU controle: o corpo anterior reprova a bateria (${errosAnterior.length} achados); ${MUTANTES.length} mutantes reprovam`,
    );

    // ---- 5. Reaplicar, rollback byte a byte, rollback de novo, reaplicar depois do rollback. ----
    await isolado(c, async () => {
      await c.query(migration);
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar 2x mudou OID, dono, ACL, atributos ou texto",
      );
      await c.query(rollback);
      const volta = await funcao(c);
      assert.equal(
        volta.prosrc,
        CORPO_ANTES,
        "o rollback nao devolveu o corpo da 20261186000000 byte a byte",
      );
      assert.deepEqual(
        { ...volta, prosrc: null },
        { ...topo, prosrc: null },
        "o rollback mexeu em atributo, dono ou ACL",
      );
      await c.query(rollback);
      assert.deepEqual(
        await funcao(c),
        volta,
        "rodar o rollback de novo mudou o estado",
      );
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
    });
    console.log(
      "  PASSOU reaplicar 2x, rollback byte a byte, rollback 2x igual e reaplicar volta",
    );

    // ---- 6. Pre-voo recusa sem escrever; a conferencia que falha desfaz o arquivo inteiro. ----
    const sabotagens = [
      [
        "corpo desconhecido",
        () =>
          trocarCorpo(
            c,
            CORPO_NOVO.replace("-- PIX com cobranca", "-- pix com cobranca"),
          ),
      ],
      [
        "ACL aberta para anon",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`),
      ],
      [
        "ACL aberta para authenticated",
        () =>
          c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated`),
      ],
      [
        "sobrecarga",
        () =>
          c.query(
            "CREATE FUNCTION public.expirar_pedidos_vencidos(p_x integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$",
          ),
      ],
      [
        "atributo trocado (SECURITY INVOKER)",
        () => c.query(`ALTER FUNCTION ${ASSINATURA} SECURITY INVOKER`),
      ],
      [
        "coluna que o corpo le ausente",
        () =>
          c.query(
            "ALTER TABLE public.marketplace_orders RENAME COLUMN metodo_online TO metodo_online_sumiu",
          ),
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await sabotar();
        const antes = await funcao(c);
        await recusa(c, migration, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await funcao(c),
          antes,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
        if (nome === "corpo desconhecido")
          await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      });
    }
    await isolado(c, async () => {
      await c.query(rollback);
      const conferenciaSabotada = migration.replace(
        `IF v_hash IS DISTINCT FROM '${HASH_NOVO}' THEN\n    RAISE EXCEPTION 'conferencia 20261393000000`,
        `IF v_hash IS DISTINCT FROM 'nao-e-este' THEN\n    RAISE EXCEPTION 'conferencia 20261393000000`,
      );
      assert.notEqual(conferenciaSabotada, migration);
      await recusa(c, conferenciaSabotada, /conferencia 20261393000000/);
      assert.equal(
        md5((await funcao(c)).prosrc),
        HASH_ANTES,
        "a migration que falhou na conferencia deixou o corpo novo gravado",
      );
    });
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens) e a conferencia que falha nao deixa nada`,
    );

    // ---- 8. Consultas 103a/103b nos dois sentidos, com o rol fechado. ----
    const consulta = async (nome) => {
      const rows = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows.filter((r) => r.ok !== true).map((r) => r.item);
    };
    assert.deepEqual(await consulta(C103A), []);
    assert.deepEqual(await consulta(C103B), [
      "expirar_pedidos_vencidos: corpo exato (md5)",
    ]);
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C103B), []);
      assert.deepEqual(await consulta(C103A), [
        "expirar_pedidos_vencidos: corpo exato (md5)",
      ]);
    });
    await isolado(c, async () => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`);
      assert.deepEqual(await consulta(C103A), [
        "expirar_pedidos_vencidos: sem EXECUTE para PUBLIC, anon nem authenticated",
      ]);
    });
    // A prova somente leitura do publicar-functions pina o corpo DESTA migration.
    // eslint-disable-next-line security/detect-non-literal-require -- caminho montado pelo proprio teste
    const { hashesEsperados } = require(
      path.join(
        RAIZ,
        "scripts",
        "publicacao",
        "verificar-pagamentos-ikcous.cjs",
      ),
    );
    assert.equal(hashesEsperados().expirar, HASH_NOVO);
    console.log(
      "  PASSOU consultas 103a/103b nos dois sentidos, rol fechado; a prova da release pina o md5 desta migration",
    );

    await c.query("ROLLBACK");

    // ---- 7. Duas conexoes reais (fixture COMMITADA; so roda no clone descartavel de rodar-isolado). ----
    if (process.env.PROVA_1393_SEM_CONCORRENCIA !== "1") {
      const a = new Client({ connectionString: url });
      const b = new Client({ connectionString: url });
      await a.connect();
      await b.connect();
      try {
        await usuario(a);
        const dentro = await pedido(a, { metodo: "pix", vencidoSeg: 60 });
        const fora = await pedido(a, { metodo: "pix", vencidoSeg: 11 * MIN });
        const dentro2 = await pedido(a, { metodo: "pix", vencidoSeg: 30 });
        // B segura a linha do pedido que JA passou da folga (transacao aberta).
        await b.query("BEGIN");
        await b.query(
          "SELECT id FROM public.marketplace_orders WHERE id = $1 FOR UPDATE",
          [fora.id],
        );
        // B tambem trata o aviso 'pago' do pedido em folga, sem COMMIT ainda.
        const aviso = (
          await b.query(
            "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
            [dentro2.id, dentro2.vaga],
          )
        ).rows[0].r;
        assert.equal(aviso, "pago");
        // A varre enquanto B segura as duas linhas: nao espera, nao expira nenhuma.
        const t0 = Date.now();
        assert.equal(
          await varrer(a),
          0,
          "a varredura nao pulou a linha travada",
        );
        assert.ok(
          Date.now() - t0 < 5000,
          "a varredura ficou esperando a trava",
        );
        assert.deepEqual(await estado(a, fora), VIVO);
        assert.deepEqual(await estado(a, dentro), VIVO);
        await b.query("COMMIT");
        // Liberada a linha, a varredura seguinte expira SO o que passou da folga; o pago fica pago.
        assert.equal(await varrer(a), 1);
        assert.deepEqual(await estado(a, fora), EXPIRADO);
        assert.equal(await estoque(a, fora), ESTOQUE + QTD);
        assert.deepEqual(await estado(a, dentro), VIVO);
        assert.equal(await estoque(a, dentro), ESTOQUE);
        assert.equal((await estado(a, dentro2)).payment_status, "pago");
        assert.equal(await estoque(a, dentro2), ESTOQUE);
        assert.equal(await varrer(a), 0);
      } finally {
        await b.query("ROLLBACK").catch(() => {});
        await a.end().catch(() => {});
        await b.end().catch(() => {});
      }
      console.log(
        "  PASSOU duas conexoes: a varredura pula a linha travada (SKIP LOCKED), expira so o que passou da folga e o aviso 'pago' dentro da folga fica pago",
      );
    }

    console.log(
      "\n[o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido] todas as provas passaram.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

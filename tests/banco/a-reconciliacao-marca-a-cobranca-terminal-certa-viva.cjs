"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs (CI_BANCO_EFEMERO=1).
//
// O que prova (DINHEIRO): a fila da reconciliacao (pagamentos_a_reconciliar) pula o pedido
// ENQUANTO a vaga tem a cobranca que o Mercado Pago ja deu como terminal; uma cobranca NOVA na
// vaga (outro id) volta a fila na hora. E a funcao que grava esse carimbo
// (marcar_visitas_da_reconciliacao, so service_role) casa o pedido com a cobranca CERTA, recusa
// listas de tamanhos diferentes e ignora NULL e pedido que sumiu.
//   - sem o "volta na hora": o cliente que teve a 1a cobranca recusada, tentou de novo, pagou e
//     teve o aviso do webhook perdido fica para sempre fora da fila (dinheiro sem pedido pago);
//   - com o pareamento errado: um pedido saudavel sai da fila com a cobranca de outro.
// Os vizinhos (reconciliacao-do-entregue-viva, pagamentos-rpc-viva) gravam o carimbo por INSERT
// direto com o MESMO id da vaga: nunca passam pela funcao nem testam a cobranca diferente.
//
// MUTANTE_R114C instala UMA troca de texto no corpo VIVO (pg_get_functiondef, o trecho aparece
// 1 vez); a transacao e' sempre desfeita (ROLLBACK). Nome desconhecido => ERRO.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const uuid = (n) => `c114c000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = uuid(1);
const B = uuid(2);
const C = uuid(3);
const D = uuid(4);
const SUMIU = uuid(99);
const FILA = "public.pagamentos_a_reconciliar()";
const MARCAR = "public.marcar_visitas_da_reconciliacao(uuid[],uuid[],text[])";

const MUTANTES = {
  "fila-so-is-null": {
    funcao: FILA,
    trecho:
      "AND (v.cobranca_terminal IS NULL OR v.cobranca_terminal <> o.gateway_payment_id)",
    substituto: "AND (v.cobranca_terminal IS NULL)",
  },
  "marca-com-arrays-trocados": {
    funcao: MARCAR,
    trecho: "unnest(p_terminais, p_cobrancas_terminais) AS t(id, cobranca)",
    substituto:
      "unnest(p_terminais, ARRAY(SELECT u.c FROM unnest(p_cobrancas_terminais) WITH ORDINALITY AS u(c, n) ORDER BY u.n DESC)) AS t(id, cobranca)",
  },
  "marca-sem-guarda-de-tamanho": {
    funcao: MARCAR,
    trecho:
      "IF COALESCE(cardinality(p_terminais), 0) <> COALESCE(cardinality(p_cobrancas_terminais), 0) THEN",
    substituto: "IF false THEN",
  },
  "marca-sem-exists": {
    funcao: MARCAR,
    trecho:
      "AND EXISTS (SELECT 1 FROM public.marketplace_orders mo WHERE mo.id = t.id)",
    substituto: "",
  },
  "marca-sem-cobranca-not-null": {
    funcao: MARCAR,
    trecho: "AND t.cobranca IS NOT NULL",
    substituto: "",
  },
};

async function mutar() {
  const nome = process.env.MUTANTE_R114C;
  if (!nome) return;
  const alvo = new Map(Object.entries(MUTANTES)).get(nome);
  if (alvo === undefined) {
    throw new Error(`MUTANTE_R114C desconhecido: ${nome}`);
  }
  const c = P.conexao();
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        alvo.funcao,
      ])
    ).rows[0].d.replace(/\r/g, "");
  const original = await ler();
  assert.equal(
    original.split(alvo.trecho).length - 1,
    1,
    `mutante ${nome}: o alvo deve ocorrer uma vez no corpo vivo`,
  );
  const alterado = original.replace(alvo.trecho, alvo.substituto);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    await ler(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function pedido(id, gateway) {
  await P.conexao().query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, gateway_payment_id, metodo_online, expires_at)
     VALUES ($1, NULL, 'Cliente R114C', '{}'::jsonb, 75, 75, 'pending', 'online',
             'online', 'aguardando', $2, 'pix', now() + interval '20 minutes')`,
    [id, gateway],
  );
}

/** Fixtures que ja existiam no clone saem da fila (o LIMIT 100 nao pode esconder a medida); depois nasce o cenario. */
async function montar() {
  await P.conexao().query(`INSERT INTO public.reconciliacao_visitas (order_id, visitado_em, cobranca_terminal)
    SELECT id, now(), gateway_payment_id FROM public.marketplace_orders WHERE gateway_payment_id IS NOT NULL
    ON CONFLICT (order_id) DO UPDATE SET cobranca_terminal = EXCLUDED.cobranca_terminal`);
  await pedido(A, "MP-1");
  await pedido(B, "MP-B1");
  await pedido(C, "MP-A");
  await pedido(D, "MP-B");
  await mutar();
}

const emFila = async () =>
  new Set(
    (await P.como("service_role", `SELECT order_id FROM ${FILA}`)).map(
      (r) => r.order_id,
    ),
  );

const carimbo = async (id) =>
  (
    await P.conexao().query(
      "SELECT cobranca_terminal, visitado_em IS NOT NULL AS visitado FROM public.reconciliacao_visitas WHERE order_id = $1",
      [id],
    )
  ).rows[0];

const tudoGravado = async () =>
  (
    await P.conexao().query(
      "SELECT md5(coalesce(string_agg(to_jsonb(v)::text, '|' ORDER BY v.order_id), '')) AS h, count(*)::int AS n FROM public.reconciliacao_visitas v",
    )
  ).rows[0];

/** marcar_visitas_da_reconciliacao como o servidor (service_role); erro nao derruba a transacao. */
const marcar = (visitados, terminais, cobrancas) =>
  P.tentar(
    "service_role",
    "SELECT public.marcar_visitas_da_reconciliacao($1::uuid[], $2::uuid[], $3::text[]) AS n",
    [visitados, terminais, cobrancas],
  );

const ok = (r, rotulo) =>
  assert.equal(r.erro, undefined, `${rotulo}: recusou (${r.erro})`);

prova(
  "(1) terminal=[A] com 'MP-1' grava a linha e A sai da fila; (3) so p_visitados=[A] nao apaga a cobranca",
  () =>
    P.emTransacao(async () => {
      await montar();
      const antes = await emFila();
      for (const id of [A, B, C, D])
        assert.ok(antes.has(id), `controle: ${id} devia estar na fila`);

      ok(await marcar([], [A], ["MP-1"]), "marcar terminal A");
      assert.deepEqual(
        await carimbo(A),
        { cobranca_terminal: "MP-1", visitado: true },
        "TERMINAL: a linha de A nao ficou com a cobranca MP-1",
      );
      const depois = await emFila();
      assert.equal(
        depois.has(A),
        false,
        "FILA: A continua na fila com a vaga na cobranca terminal",
      );
      for (const id of [B, C, D])
        assert.ok(depois.has(id), `FILA: ${id} saiu sem ter sido marcado`);
      assert.equal(
        await carimbo(B),
        undefined,
        "B ganhou linha sem ser marcado",
      );

      // (3) A visita sem terminal nao apaga o carimbo (nem devolve A a fila).
      const r = await marcar([A], [], []);
      ok(r, "visita simples de A");
      assert.equal(Number(r.linhas[0].n), 1, "a visita de A devia contar 1");
      assert.deepEqual(
        await carimbo(A),
        { cobranca_terminal: "MP-1", visitado: true },
        "VISITA: a chamada so com p_visitados apagou a cobranca terminal",
      );
      assert.equal(
        (await emFila()).has(A),
        false,
        "VISITA: a visita simples devolveu A a fila",
      );
    }),
);

prova(
  "(2) vaga trocada para 'MP-2' (cobranca nova): A VOLTA a fila; terminal 'MP-2' tira de novo",
  () =>
    P.emTransacao(async () => {
      await montar();
      ok(await marcar([], [A], ["MP-1"]), "marcar terminal A");
      assert.equal((await emFila()).has(A), false, "controle: A fora da fila");

      // O pedido adota uma cobranca NOVA na vaga (outro id): o carimbo velho nao vale mais.
      await P.conexao().query(
        "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-2' WHERE id = $1",
        [A],
      );
      assert.equal(
        (await carimbo(A)).cobranca_terminal,
        "MP-1",
        "o carimbo velho nao devia mudar sozinho",
      );
      assert.equal(
        (await emFila()).has(A),
        true,
        "VOLTA: a cobranca nova na vaga NAO devolveu o pedido a fila",
      );

      // O MP da a cobranca nova como terminal tambem: o carimbo e' REGRAVADO e A sai de novo.
      ok(await marcar([], [A], ["MP-2"]), "marcar terminal A (MP-2)");
      assert.equal(
        (await carimbo(A)).cobranca_terminal,
        "MP-2",
        "REGRAVA: o carimbo nao passou para MP-2",
      );
      assert.equal(
        (await emFila()).has(A),
        false,
        "REGRAVA: A continua na fila com a vaga ja terminal",
      );
    }),
);

prova(
  "(6) dois pedidos no mesmo lote: cada um recebe a SUA cobranca (pareamento do unnest)",
  () =>
    P.emTransacao(async () => {
      await montar();
      ok(await marcar([], [C, D], ["MP-A", "MP-B"]), "marcar C e D");
      assert.deepEqual(
        await carimbo(C),
        { cobranca_terminal: "MP-A", visitado: true },
        "PAREAMENTO: C ficou com a cobranca de outro pedido",
      );
      assert.deepEqual(
        await carimbo(D),
        { cobranca_terminal: "MP-B", visitado: true },
        "PAREAMENTO: D ficou com a cobranca de outro pedido",
      );
      const fila = await emFila();
      assert.equal(fila.has(C), false, "PAREAMENTO: C continua na fila");
      assert.equal(fila.has(D), false, "PAREAMENTO: D continua na fila");
      assert.ok(fila.has(A) && fila.has(B), "os nao marcados seguem na fila");
    }),
);

prova("(4) listas de tamanhos diferentes: 22023 e nada gravado", () =>
  P.emTransacao(async () => {
    await montar();
    const antes = await tudoGravado();
    const casos = [
      ["terminais sem cobrancas", [], [A], []],
      ["cobrancas sem terminais", [], [], ["MP-1"]],
      ["2 terminais, 1 cobranca", [], [A, B], ["MP-1"]],
      ["1 terminal, 2 cobrancas", [], [A], ["MP-1", "MP-B1"]],
      // O pedido visitado no mesmo ciclo tambem nao pode gravar quando o par esta torto.
      ["visita junto de par torto", [C], [A], []],
    ];
    for (const [nome, visitados, terminais, cobrancas] of casos) {
      const r = await marcar(visitados, terminais, cobrancas);
      assert.equal(
        r.codigo,
        "22023",
        `TAMANHO: "${nome}" nao foi recusada com 22023 (codigo ${r.codigo}, erro ${r.erro})`,
      );
      assert.match(r.erro, /tamanhos diferentes/);
    }
    assert.deepEqual(
      await tudoGravado(),
      antes,
      "TAMANHO: a recusa gravou alguma linha",
    );
    assert.equal((await emFila()).has(A), true, "A saiu da fila na recusa");
  }),
);

prova(
  "(5) NULL em p_cobrancas_terminais, NULL em p_terminais e pedido inexistente: ignorados sem erro e sem linha",
  () =>
    P.emTransacao(async () => {
      await montar();
      const antes = await tudoGravado();

      // Cobranca NULL: o par de B e' ignorado, o de A (valido) grava.
      ok(await marcar([], [B, A], [null, "MP-1"]), "cobranca NULL");
      assert.equal(
        await carimbo(B),
        undefined,
        "NULL: o par com cobranca NULL gravou linha",
      );
      assert.deepEqual(
        await carimbo(A),
        { cobranca_terminal: "MP-1", visitado: true },
        "NULL: o par valido ao lado do NULL nao gravou",
      );

      // Terminal NULL (id NULL) e pedido que nao existe: nada grava, nada estoura (nem a FK).
      ok(await marcar([], [null], ["MP-Q"]), "terminal NULL");
      ok(await marcar([], [SUMIU], ["MP-Z"]), "pedido inexistente");
      ok(await marcar([SUMIU, null], [], []), "visitado inexistente ou NULL");
      assert.equal(
        await carimbo(SUMIU),
        undefined,
        "INEXISTENTE: gravou linha para pedido que nao existe",
      );
      const depois = await tudoGravado();
      assert.equal(
        depois.n,
        antes.n + 1,
        "IGNORADOS: o numero de linhas gravadas nao e' so a de A",
      );
      assert.equal(
        (await emFila()).has(B),
        true,
        "IGNORADOS: B saiu da fila sem terminal",
      );
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.executar("a reconciliacao marca a cobranca terminal certa");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));

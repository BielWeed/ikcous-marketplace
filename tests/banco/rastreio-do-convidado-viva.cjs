"use strict";

/**
 * Prova VIVA das migrations 20261341000000 (o codigo do convidado trava a linha na tentativa) e 20261342000000 (o
 * rastreio do convidado nao devolve a nota do pedido), num Postgres EFEMERO local, sem rede.
 *
 * Os casos de CORRIDA usam conexoes reais e gravam de verdade (o banco e' o clone do rodar-isolado.cjs, descartado no
 * fim); trocam o corpo da funcao so para injetar uma pausa na janela da leitura e o RESTAURAM no fim. Os demais rodam
 * numa transacao que termina em ROLLBACK.
 *
 *  CORRIDA    30 chamadas ao mesmo tempo com o codigo ERRADO avaliam o codigo no MAXIMO 5 vezes e deixam attempts = 5
 *             (com e sem pausa na janela); 10 chamadas com o codigo CERTO deixam entrar UMA so (uso unico); 29 erradas
 *             + 1 certa no meio nunca passam de 5 avaliacoes. CONTROLE: o corpo da 20261217000000 com a mesma pausa
 *             avalia as 30 e deixa as 10 entrarem (o defeito e' real e o teste o enxerga).
 *  TRAVA      a chamada espera a linha do CODIGO (e so ela): com a linha travada por outra transacao a v2 do mesmo
 *             pedido espera; a de outro pedido nao; e a linha do PEDIDO continua livre para quem a atualiza.
 *  FLUXO      o caminho legitimo (trio -> codigo -> pedido) e' o mesmo; errado = mesma mensagem e `restantes`; o 6o
 *             erro e o codigo certo depois dele = bloqueado; sem o trio = a resposta de "nao ha codigo"; codigo
 *             usado = nao entra de novo. Codigo que JA tinha tentativas antes da migration segue de onde estava.
 *  NOTA       a chave `notes` e o TEXTO da nota nao saem no JSON; o CPF continua fora; as demais chaves e valores sao os
 *             MESMOS do corpo da 20261341000000 (CONTROLE: o corpo anterior devolve a nota).
 *  MIGRATION  reaplicar e' o mesmo estado; cadeia 1217 -> 1341 -> 1342 e volta (md5 e prosrc byte a byte, atributos e
 *             ACL iguais, nenhuma linha de pedido ou de codigo mexida); 2o rollback e pre-voos (corpo estranho,
 *             atributo, EXECUTE, 1341 por cima da 1342) recusam SEM escrever.
 *  CONSULTAS  65a/65b/66a/66b: rol fechado de 3 linhas, positivas so no seu estado, cada defeito reprova so a sua linha.
 *  INVENTARIO portas-do-visitante-permitidas.json nao muda: a ACL da v2 e' a mesma.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/rastreio-do-convidado-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations e as consultas), nunca de entrada de rede; as chaves de objeto
 * vem de constantes e mapas fechados deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  desfazerRastreioDoConvidadoNaTransacao,
  CORPO_1217,
  CORPO_1341,
  CORPO_1342,
} = require("./rastreio-do-convidado-posterior.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const ARQ_1341 =
  "20261341000000_o_codigo_do_convidado_trava_a_linha_na_tentativa.sql";
const ARQ_1342 =
  "20261342000000_o_rastreio_do_convidado_nao_devolve_a_nota_do_pedido.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const M1341 = ler(ARQ_1341);
const M1342 = ler(ARQ_1342);
const RB1341 = ler(`rollback-manual-${ARQ_1341}`);
const RB1342 = ler(`rollback-manual-${ARQ_1342}`);

const V2 = "public.get_orders_by_otp_v2(text,text,text,text)";
const SQL_V2 = "SELECT public.get_orders_by_otp_v2($1, $2, $3, $4) AS r";
const SQL_GERAR = "SELECT public.generate_order_otp_v2($1, $2, $3) AS r";

const ESTADO = { 1217: CORPO_1217, 1341: CORPO_1341, 1342: CORPO_1342 };

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

// ---------------------------------------------------------------------------
// ajudas
// ---------------------------------------------------------------------------

async function emTransacao(fn) {
  await C.query("BEGIN");
  try {
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel` (SET LOCAL: so dentro de transacao) e devolve a 1a linha. */
async function como(papel, sql, params = [], conexao = C) {
  await conexao.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await conexao.query(sql, params)).rows[0];
  } finally {
    await conexao.query("RESET ROLE");
  }
}

/** Como `como`, mas um erro nao derruba a transacao: devolve {linha} ou {erro}. */
async function tentar(fn) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linha = await fn();
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linha };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message };
  }
}

const md5Vivo = async (conexao = C) =>
  (
    await conexao.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [V2],
    )
  ).rows[0]?.h;
const prosrcVivo = async (conexao = C) =>
  (
    await conexao.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [V2],
    )
  ).rows[0]?.prosrc;
const atributos = async (conexao = C) =>
  (
    await conexao.query(
      `SELECT p.prosecdef, p.provolatile, p.proisstrict, p.proretset, p.proconfig::text AS config,
              p.proowner::regrole::text AS dono, l.lanname, pg_get_function_result(p.oid) AS retorno,
              p.proacl::text AS acl
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure($1)`,
      [V2],
    )
  ).rows[0];

async function estadoDoCorpo(conexao = C) {
  const h = await md5Vivo(conexao);
  return (
    Object.entries(ESTADO).find(([, m]) => m === h)?.[0] ?? `desconhecido:${h}`
  );
}

/** Fotografia das linhas de pedido e de codigo (nada disso pode mudar ao aplicar/desfazer as migrations). */
const retrato = async (conexao = C) =>
  (
    await conexao.query(
      `SELECT (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id::text), '')) FROM public.otp_verifications t) AS codigos,
              (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id::text), '')) FROM public.marketplace_orders t) AS pedidos`,
    )
  ).rows[0];

let seq = 0;
const novoId = () => {
  seq += 1;
  return `7e8e0000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};
const fragmento = (id) => id.slice(-6);

/** Pedido de convidado com o e-mail e o WhatsApp do checkout. */
async function pedido({ email, fone, notes = null, dados = {}, conexao = C }) {
  const id = novoId();
  await conexao.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_phone, customer_data, total, subtotal, payment_status, notes)
     VALUES ($1, NULL, 'Convidado Sintetico', $2, $3::jsonb, 100, 100, 'aguardando', $4)`,
    [id, fone, JSON.stringify({ email, whatsapp: fone, ...dados }), notes],
  );
  return id;
}
const gerar = (email, fone, id, conexao = C) =>
  como("service_role", SQL_GERAR, [email, fone, fragmento(id)], conexao);
const v2 = async (email, fone, id, codigo, conexao = C) =>
  (await como("anon", SQL_V2, [email, fone, fragmento(id), codigo], conexao)).r;
const errado = (codigo) => (codigo === "000000" ? "000001" : "000000");
const tentativasDe = async (id, conexao = C) =>
  (
    await conexao.query(
      "SELECT attempts, verified FROM public.otp_verifications WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
      [id],
    )
  ).rows[0];

/** Pedido + codigo. */
async function comCodigo(email, fone, opcoes = {}) {
  const id = await pedido({ email, fone, ...opcoes });
  const g = (await gerar(email, fone, id)).r;
  assert.equal(g.ok, true, JSON.stringify(g));
  return { id, codigo: g.otp_code, email, fone };
}

const avaliou = (r) => r.ok === true || typeof r.restantes === "number";
const bloqueou = (r) => r.ok === false && /bloqueado/.test(r.error ?? "");

// ---------------------------------------------------------------------------
// corrida: conexoes reais, estado COMMITADO, corpo trocado so para a pausa
// ---------------------------------------------------------------------------

const ANCORA_DA_PAUSA = "    IF v_rec.attempts >= v_max_tentativas THEN";

/** Executa `fn` com o corpo vivo trocado por ele mesmo + `pg_sleep` antes da conferencia de tentativas; restaura sempre. */
async function comPausaNaJanela(segundos, fn) {
  const original = (
    await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [V2])
  ).rows[0].d;
  assert.equal(
    original.split(ANCORA_DA_PAUSA).length,
    2,
    "a ancora da pausa tem de aparecer UMA vez no corpo",
  );
  const comPausa = original.replace(
    ANCORA_DA_PAUSA,
    `    PERFORM pg_sleep(${segundos});\n${ANCORA_DA_PAUSA}`,
  );
  await C.query(comPausa);
  try {
    return await fn();
  } finally {
    await C.query(original);
  }
}

/** `n` conexoes ja abertas como anon; devolve {clientes, fechar}. */
async function abrirConexoes(n) {
  const url = lerDatabaseUrlEfemera();
  const clientes = [];
  for (let i = 0; i < n; i++) {
    const k = new Client({ connectionString: url });
    await k.connect();
    await k.query("SET ROLE anon");
    clientes.push(k);
  }
  return {
    clientes,
    fechar: () => Promise.all(clientes.map((k) => k.end().catch(() => {}))),
  };
}

/** Cria (COMMITADO) um pedido com codigo, roda a corrida e limpa. `codigos(i, certo)` devolve o codigo da chamada i. */
async function corrida({ n, codigos }) {
  const email = `corrida${n}-${Math.random().toString(16).slice(2, 8)}@teste.invalid`;
  const fone = `1199${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  let c;
  const { clientes, fechar } = await abrirConexoes(n);
  try {
    await C.query("BEGIN");
    c = await comCodigo(email, fone);
    await C.query("COMMIT");
    const saidas = await Promise.all(
      clientes.map((k, i) =>
        k
          .query(SQL_V2, [email, fone, fragmento(c.id), codigos(i, c.codigo)])
          .then((r) => r.rows[0].r),
      ),
    );
    const estado = await tentativasDe(c.id);
    return { saidas, estado, c };
  } finally {
    await fechar();
    if (c) {
      await C.query(
        "DELETE FROM public.otp_verifications WHERE order_id = $1",
        [c.id],
      );
      await C.query("DELETE FROM public.marketplace_orders WHERE id = $1", [
        c.id,
      ]);
    }
  }
}

const N = 30;

prova(
  "CORRIDA: 30 chamadas ao mesmo tempo com o codigo ERRADO avaliam o codigo no maximo 5 vezes e deixam attempts = 5",
  async () => {
    assert.equal(
      await estadoDoCorpo(),
      "1342",
      "a arvore tem de estar com a 1342 no ar",
    );
    const { saidas, estado } = await corrida({
      n: N,
      codigos: (_i, certo) => errado(certo),
    });
    const avaliadas = saidas.filter(avaliou).length;
    assert.ok(avaliadas <= 5, `${avaliadas} avaliacoes (limite 5)`);
    assert.equal(avaliadas, 5, "as 5 primeiras avaliam (uma por vaga)");
    assert.equal(
      saidas.filter(bloqueou).length,
      N - 5,
      "as outras 25 recebem o bloqueio",
    );
    assert.equal(estado.attempts, 5, "attempts = 5, nunca mais");
    assert.equal(estado.verified, false);
    // `restantes` das 5 que avaliaram: 4, 3, 2, 1, 0 (cada uma viu a contagem da anterior)
    assert.deepEqual(
      saidas
        .filter(avaliou)
        .map((r) => r.restantes)
        .sort(),
      [0, 1, 2, 3, 4],
    );
  },
);

prova(
  "CORRIDA: com uma PAUSA na janela da leitura (corpo vivo + pg_sleep), ainda no maximo 5 avaliacoes",
  async () => {
    await comPausaNaJanela(0.1, async () => {
      const { saidas, estado } = await corrida({
        n: N,
        codigos: (_i, certo) => errado(certo),
      });
      assert.equal(
        saidas.filter(avaliou).length,
        5,
        JSON.stringify(saidas.map((r) => r.restantes ?? r.error)),
      );
      assert.equal(estado.attempts, 5);
    });
    assert.equal(await estadoDoCorpo(), "1342", "o corpo foi restaurado");
  },
);

prova(
  "CORRIDA: 10 chamadas com o codigo CERTO ao mesmo tempo deixam entrar UMA so (uso unico); as outras recebem a mesma resposta de 'nao ha codigo'",
  async () => {
    await comPausaNaJanela(0.1, async () => {
      const { saidas, estado } = await corrida({
        n: 10,
        codigos: (_i, certo) => certo,
      });
      const entraram = saidas.filter((r) => r.ok === true);
      assert.equal(entraram.length, 1, JSON.stringify(saidas));
      assert.equal(entraram[0].orders.length, 1);
      const outras = saidas.filter((r) => r.ok !== true);
      for (const r of outras)
        assert.deepEqual(r, {
          ok: false,
          error: "Código inválido ou expirado.",
        });
      assert.equal(estado.verified, true);
      assert.equal(estado.attempts, 0, "ninguem errou");
    });
  },
);

prova(
  "CORRIDA: 29 erradas + 1 certa no meio nunca passam de 5 avaliacoes e a certa entra no maximo uma vez",
  async () => {
    const { saidas, estado } = await corrida({
      n: N,
      codigos: (i, certo) => (i === 17 ? certo : errado(certo)),
    });
    assert.ok(saidas.filter(avaliou).length <= 5);
    assert.ok(saidas.filter((r) => r.ok === true).length <= 1);
    assert.ok(estado.attempts <= 5);
    // ou a certa entrou (e o resto nao encontra mais o codigo), ou ficou atras das 5 erradas e foi bloqueada
    const entrou = saidas.some((r) => r.ok === true);
    assert.equal(estado.verified, entrou);
  },
);

prova(
  "CONTROLE: o corpo da 20261217000000 com a MESMA pausa avalia as 30 erradas (attempts passa de 5) e deixa as 10 certas entrarem — o defeito e real e o teste o enxerga; depois o corpo e restaurado",
  async () => {
    assert.equal(await estadoDoCorpo(), "1342");
    const retratoAntes = await retrato();
    // Volta, COMMITADO, para o corpo da 1217 (rollbacks-manuais) e injeta a pausa.
    await desfazerRastreioDoConvidadoNaTransacao(C);
    assert.equal(await estadoDoCorpo(), "1217");
    try {
      await comPausaNaJanela(0.1, async () => {
        const erradas = await corrida({
          n: N,
          codigos: (_i, certo) => errado(certo),
        });
        const avaliadas = erradas.saidas.filter(avaliou).length;
        assert.ok(
          avaliadas > 5,
          `o controle nao reproduziu o defeito (${avaliadas} avaliacoes)`,
        );
        assert.ok(erradas.estado.attempts > 5, "attempts passou do teto");
        const certas = await corrida({ n: 10, codigos: (_i, certo) => certo });
        assert.ok(
          certas.saidas.filter((r) => r.ok === true).length > 1,
          "o controle nao reproduziu o uso duplo do mesmo codigo",
        );
      });
    } finally {
      // Para a frente de novo: 1341 e 1342 (COMMITADO) — a arvore volta ao que era.
      await C.query(M1341);
      await C.query(M1342);
    }
    assert.equal(
      await estadoDoCorpo(),
      "1342",
      "a arvore voltou ao corpo da 1342",
    );
    assert.deepEqual(
      await retrato(),
      retratoAntes,
      "pedidos e codigos nao mudaram",
    );
  },
);

// ---------------------------------------------------------------------------
// a trava e' so da linha do codigo
// ---------------------------------------------------------------------------

prova(
  "TRAVA: a v2 espera a linha do CODIGO (so ela): travada por outra transacao, a v2 do mesmo pedido espera, a de OUTRO pedido nao, e a linha do PEDIDO segue livre",
  async () => {
    const url = lerDatabaseUrlEfemera();
    const dono = new Client({ connectionString: url }); // segura a trava
    const espera = new Client({ connectionString: url }); // v2 do pedido travado
    const livre = new Client({ connectionString: url }); // v2 de outro pedido
    const escritor = new Client({ connectionString: url }); // atualiza a linha do pedido
    const sonda = new Client({ connectionString: url });
    for (const k of [dono, espera, livre, escritor, sonda]) await k.connect();
    await espera.query("SET ROLE anon");
    await livre.query("SET ROLE anon");
    let a;
    let b;
    try {
      await C.query("BEGIN");
      a = await comCodigo("trava.a@teste.invalid", "11977770001");
      b = await comCodigo("trava.b@teste.invalid", "11977770002");
      await C.query("COMMIT");

      await dono.query("BEGIN");
      await dono.query(
        "SELECT 1 FROM public.otp_verifications WHERE order_id = $1 FOR UPDATE",
        [a.id],
      );
      const pidEspera = (await espera.query("SELECT pg_backend_pid() AS p"))
        .rows[0].p;
      const emVoo = espera
        .query(SQL_V2, [a.email, a.fone, fragmento(a.id), errado(a.codigo)])
        .then((r) => ({ r: r.rows[0].r }));
      let parada = false;
      for (let i = 0; i < 100 && !parada; i++) {
        const w = await sonda.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
          [pidEspera],
        );
        parada = w.rows[0]?.wait_event_type === "Lock";
        if (!parada) await new Promise((ok) => setTimeout(ok, 30));
      }
      assert.ok(
        parada,
        "a v2 do pedido travado nao parou na trava da linha do codigo",
      );

      // outro pedido: responde na hora
      await livre.query("SET lock_timeout = '2s'");
      const outro = (
        await livre.query(SQL_V2, [
          b.email,
          b.fone,
          fragmento(b.id),
          errado(b.codigo),
        ])
      ).rows[0].r;
      assert.equal(
        outro.restantes,
        4,
        "a v2 de outro pedido nao espera a trava alheia",
      );

      // a linha do PEDIDO nao esta travada pela v2 que espera: um UPDATE passa
      await escritor.query("SET lock_timeout = '2s'");
      const upd = await escritor.query(
        "UPDATE public.marketplace_orders SET observation = 'atualizado durante a espera' WHERE id = $1",
        [a.id],
      );
      assert.equal(upd.rowCount, 1);

      await dono.query("COMMIT");
      const liberada = await emVoo;
      assert.equal(
        liberada.r.restantes,
        4,
        "depois de liberada, a v2 avalia normalmente",
      );
      assert.equal((await tentativasDe(a.id)).attempts, 1);
    } finally {
      await dono.query("ROLLBACK").catch(() => {});
      for (const x of [a, b].filter(Boolean)) {
        await C.query(
          "DELETE FROM public.otp_verifications WHERE order_id = $1",
          [x.id],
        );
        await C.query("DELETE FROM public.marketplace_orders WHERE id = $1", [
          x.id,
        ]);
      }
      await Promise.all(
        [dono, espera, livre, escritor, sonda].map((k) =>
          k.end().catch(() => {}),
        ),
      );
    }
  },
);

// ---------------------------------------------------------------------------
// o fluxo legitimo (o bem maior)
// ---------------------------------------------------------------------------

prova(
  "FLUXO: trio -> codigo -> codigo certo -> o pedido (itens, endereco, totais); o mesmo codigo nao serve duas vezes",
  () =>
    emTransacao(async () => {
      const c = await comCodigo("fluxo@teste.invalid", "11988880001");
      await C.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_name, quantity, price)
         VALUES ($1, 'Camiseta de teste', 2, 50)`,
        [c.id],
      );
      const r = await v2(c.email, "(11) 98888-0001", c.id, c.codigo);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.orders.length, 1);
      const o = r.orders[0];
      assert.equal(o.id, c.id);
      assert.equal(Number(o.total), 100);
      assert.equal(o.items.length, 1);
      assert.equal(o.items[0].product_name, "Camiseta de teste");
      assert.equal(o.customer_data.email, c.email);
      const deNovo = await v2(c.email, c.fone, c.id, c.codigo);
      assert.deepEqual(deNovo, {
        ok: false,
        error: "Código inválido ou expirado.",
      });
    }),
);

prova(
  "FLUXO: errado = mesma mensagem e `restantes` 4..0; o 6o erro e o codigo CERTO depois dele = bloqueado; sem o trio = a resposta de 'nao ha codigo' (nao gasta tentativa)",
  () =>
    emTransacao(async () => {
      const c = await comCodigo("limite@teste.invalid", "11987650001");
      // sem o trio (WhatsApp de outra pessoa): igual a "nao ha codigo" e nao conta
      const semTrio = await v2(c.email, "11900000000", c.id, errado(c.codigo));
      assert.deepEqual(semTrio, {
        ok: false,
        error: "Código inválido ou expirado.",
      });
      assert.equal((await tentativasDe(c.id)).attempts, 0);
      const restantes = [];
      for (let i = 0; i < 5; i++) {
        const r = await v2(c.email, c.fone, c.id, errado(c.codigo));
        assert.equal(r.ok, false);
        assert.equal(r.error, "Código inválido ou expirado.");
        restantes.push(r.restantes);
      }
      assert.deepEqual(restantes, [4, 3, 2, 1, 0]);
      const certo = await v2(c.email, c.fone, c.id, c.codigo);
      assert.equal(certo.ok, false);
      assert.match(certo.error, /bloqueado/);
      assert.equal((await tentativasDe(c.id)).attempts, 5);
    }),
);

prova(
  "FLUXO: codigo EXPIRADO e codigo de OUTRO pedido nao entram, nao gastam tentativa de ninguem",
  () =>
    emTransacao(async () => {
      const c = await comCodigo("expira@teste.invalid", "11987650002");
      await C.query(
        "UPDATE public.otp_verifications SET expires_at = now() - interval '1 minute' WHERE order_id = $1",
        [c.id],
      );
      const r = await v2(c.email, c.fone, c.id, c.codigo);
      assert.deepEqual(r, { ok: false, error: "Código inválido ou expirado." });
      assert.equal((await tentativasDe(c.id)).attempts, 0);
      // fragmento de OUTRO pedido do mesmo e-mail: nao acha este codigo
      const outro = await pedido({ email: c.email, fone: c.fone });
      const r2 = await v2(c.email, c.fone, outro, c.codigo);
      assert.deepEqual(r2, {
        ok: false,
        error: "Código inválido ou expirado.",
      });
    }),
);

prova(
  "DADO EXISTENTE: codigo que JA tinha 3 tentativas ANTES da migration segue de onde estava (2 erros restam) e nada e' reiniciado",
  () =>
    emTransacao(async () => {
      await desfazerRastreioDoConvidadoNaTransacao(C); // loja que ainda esta na 20261217
      const c = await comCodigo("existente@teste.invalid", "11987650003");
      for (let i = 0; i < 3; i++)
        await v2(c.email, c.fone, c.id, errado(c.codigo));
      assert.equal((await tentativasDe(c.id)).attempts, 3);
      const antes = await retrato();
      await C.query(M1341);
      await C.query(M1342);
      assert.deepEqual(
        await retrato(),
        antes,
        "aplicar as migrations nao mexeu em nenhum pedido nem codigo",
      );
      const r4 = await v2(c.email, c.fone, c.id, errado(c.codigo));
      assert.equal(r4.restantes, 1);
      const r5 = await v2(c.email, c.fone, c.id, errado(c.codigo));
      assert.equal(r5.restantes, 0);
      const r6 = await v2(c.email, c.fone, c.id, c.codigo);
      assert.match(r6.error, /bloqueado/);
    }),
);

// ---------------------------------------------------------------------------
// a nota do pedido (e o CPF) nao saem
// ---------------------------------------------------------------------------

const NOTA = "NOTA-INTERNA-ZXQ-nao-pode-sair";
const CPF = "12345678909";

async function entrarComOCorpo(estado, c) {
  // Reabre o codigo (a v2 o marca como usado) para chamar a mesma funcao com outro corpo.
  await C.query(
    "UPDATE public.otp_verifications SET verified = false, attempts = 0 WHERE order_id = $1",
    [c.id],
  );
  assert.equal(await estadoDoCorpo(), estado);
  return v2(c.email, c.fone, c.id, c.codigo);
}

prova(
  "NOTA: o JSON nao traz a chave `notes` nem o texto da nota; o CPF segue fora; as demais chaves e valores sao os MESMOS do corpo da 20261341000000 (CONTROLE: o corpo anterior devolve a nota)",
  () =>
    emTransacao(async () => {
      const c = await comCodigo("nota@teste.invalid", "11987650004", {
        notes: `${NOTA} | cliente pediu embrulho`,
        dados: { cpf: CPF, address: { cpf: CPF, rua: "Rua Um", numero: "10" } },
      });
      assert.equal(await estadoDoCorpo(), "1342");
      const depois = await entrarComOCorpo("1342", c);
      assert.equal(depois.ok, true, JSON.stringify(depois));
      const o = depois.orders[0];
      assert.ok(!("notes" in o), "a chave notes saiu");
      assert.ok(
        !JSON.stringify(depois).includes(NOTA),
        "o texto da nota saiu do JSON inteiro",
      );
      assert.ok(
        !JSON.stringify(depois).includes(CPF),
        "o CPF segue fora do JSON",
      );
      assert.equal(
        o.customer_data.address.rua,
        "Rua Um",
        "o resto do endereco fica",
      );

      // CONTROLE: o corpo da 1341 (rollback da 1342, na transacao) devolve a nota e o CPF continua fora.
      await C.query(RB1342);
      const antes = await entrarComOCorpo("1341", c);
      assert.equal(antes.ok, true);
      assert.ok(
        JSON.stringify(antes).includes(NOTA),
        "o controle nao reproduziu a nota no retorno",
      );
      assert.ok(!JSON.stringify(antes).includes(CPF));
      // So a chave notes muda: o resto do pedido devolvido e' igual, valor a valor.
      const { notes, ...resto } = antes.orders[0];
      assert.ok(notes.includes(NOTA));
      assert.deepEqual(resto, o);
    }),
);

prova(
  "NOTA: pedido com notes NULL e customer_data escalar continuam entrando (sem erro) e sem a chave notes",
  () =>
    emTransacao(async () => {
      const c = await comCodigo("nota.nula@teste.invalid", "11987650005");
      const r = await entrarComOCorpo("1342", c);
      assert.equal(r.ok, true);
      assert.ok(!("notes" in r.orders[0]));
    }),
);

// ---------------------------------------------------------------------------
// as migrations: idempotencia, cadeia, rollback, pre-voo
// ---------------------------------------------------------------------------

prova(
  "MIGRATION: cadeia 1217 -> 1341 -> 1342 e volta: md5 e prosrc byte a byte, atributos e ACL iguais, pedidos e codigos intactos; reaplicar nao muda nada",
  () =>
    emTransacao(async () => {
      const fim = {
        prosrc: await prosrcVivo(),
        attr: await atributos(),
        retrato: await retrato(),
      };
      assert.equal(await estadoDoCorpo(), "1342");

      await C.query(RB1342);
      assert.equal(await estadoDoCorpo(), "1341");
      const prosrc1341 = await prosrcVivo();
      await C.query(RB1341);
      assert.equal(await estadoDoCorpo(), "1217");
      const prosrc1217 = await prosrcVivo();
      assert.equal(await md5Vivo(), CORPO_1217);
      const attr1217 = await atributos();
      assert.deepEqual(
        attr1217,
        fim.attr,
        "atributos e ACL iguais depois dos dois rollbacks",
      );

      // para a frente, duas vezes cada
      await C.query(M1341);
      await C.query(M1341);
      assert.equal(await estadoDoCorpo(), "1341");
      assert.equal(
        await prosrcVivo(),
        prosrc1341,
        "prosrc da 1341 identico ao de antes do rollback",
      );
      await C.query(M1342);
      await C.query(M1342);
      assert.equal(await estadoDoCorpo(), "1342");
      assert.equal(await prosrcVivo(), fim.prosrc);
      assert.deepEqual(await atributos(), fim.attr);
      assert.deepEqual(
        await retrato(),
        fim.retrato,
        "nenhuma linha de pedido ou de codigo mudou",
      );
      // a diferenca 1217 -> 1341 e' SO a trava e o comentario; 1341 -> 1342 e' SO a nota e o comentario
      const linhas = (s) => s.split("\n");
      const so = (a, b) => linhas(b).filter((l) => !linhas(a).includes(l));
      assert.deepEqual(
        so(prosrc1217, prosrc1341)
          .map((l) => l.trim())
          .filter((l) => !l.startsWith("--")),
        ["LIMIT 1", "FOR UPDATE OF v;"],
      );
      assert.deepEqual(
        linhas(prosrc1341)
          .filter((l) => !linhas(fim.prosrc).includes(l))
          .map((l) => l.trim()),
        ["'notes', o.notes,"],
      );
    }),
);

prova(
  "MIGRATION: 2o rollback recusa sem escrever; rollback da 1341 por cima da 1342 recusa; 1341 por cima da 1342 recusa (reaplicar voltaria a expor a nota)",
  () =>
    emTransacao(async () => {
      // 1342 no ar: o rollback da 1341 nao se aplica (o corpo vivo nao e o da 1341)
      const antes = { h: await md5Vivo(), retrato: await retrato() };
      for (const [rotulo, sql] of [
        ["rollback 1341 sobre a 1342", RB1341],
        ["migration 1341 sobre a 1342", M1341],
      ]) {
        const r = await tentar(() => C.query(sql));
        assert.match(r.erro ?? "", /B1_BASELINE_DIVERGENT/, rotulo);
        assert.equal(await md5Vivo(), antes.h, `${rotulo}: escreveu`);
      }
      // 1217 no ar: o rollback da 1342 e o da 1341 recusam (nada a desfazer)
      await C.query(RB1342);
      await C.query(RB1341);
      for (const [rotulo, sql] of [
        ["2o rollback da 1341", RB1341],
        ["rollback da 1342 sobre a 1217", RB1342],
        ["migration 1342 sobre a 1217", M1342],
      ]) {
        const r = await tentar(() => C.query(sql));
        assert.match(r.erro ?? "", /B1_BASELINE_DIVERGENT/, rotulo);
        assert.equal(await md5Vivo(), CORPO_1217, `${rotulo}: escreveu`);
      }
      assert.deepEqual((await retrato()).codigos, antes.retrato.codigos);
    }),
);

prova(
  "MIGRATION: pre-voo recusa SEM escrever: corpo estranho, SECURITY INVOKER, EXECUTE de anon revogado, EXECUTE aberto a PUBLIC, search_path diferente",
  () =>
    emTransacao(async () => {
      const casos = [
        [
          "corpo estranho",
          `CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v2(p_email text, p_whatsapp text, p_fragmento text, p_otp text)
             RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
             AS $x$ BEGIN RETURN jsonb_build_object('ok', false); END; $x$`,
        ],
        ["SECURITY INVOKER", `ALTER FUNCTION ${V2} SECURITY INVOKER`],
        [
          "EXECUTE de anon revogado",
          `REVOKE EXECUTE ON FUNCTION ${V2} FROM anon`,
        ],
        [
          "EXECUTE aberto a PUBLIC",
          `GRANT EXECUTE ON FUNCTION ${V2} TO PUBLIC`,
        ],
        [
          "search_path diferente",
          `ALTER FUNCTION ${V2} SET search_path TO public, extensions`,
        ],
      ];
      for (const [rotulo, quebra] of casos) {
        // Cada defeito sobre o corpo de ANTES (1217) para a 1341 e sobre o da 1341 para a 1342.
        for (const [nome, base, sql] of [
          ["1341", RB1342 + RB1341, M1341],
          ["1342", RB1342, M1342],
        ]) {
          await C.query("SAVEPOINT caso");
          await C.query(base);
          await C.query(quebra);
          const antes = {
            h: await md5Vivo(),
            a: await atributos(),
            r: await retrato(),
          };
          await C.query("SAVEPOINT recusa");
          let erro = null;
          try {
            await C.query(sql);
          } catch (e) {
            erro = e.message;
          }
          await C.query("ROLLBACK TO SAVEPOINT recusa");
          assert.match(
            erro ?? "NAO RECUSOU",
            /B1_BASELINE_DIVERGENT/,
            `${rotulo} / ${nome}`,
          );
          assert.equal(
            await md5Vivo(),
            antes.h,
            `${rotulo} / ${nome}: escreveu o corpo`,
          );
          assert.deepEqual(
            await atributos(),
            antes.a,
            `${rotulo} / ${nome}: escreveu atributos`,
          );
          assert.deepEqual(await retrato(), antes.r);
          await C.query("ROLLBACK TO SAVEPOINT caso");
        }
      }
    }),
);

prova(
  "MIGRATION: as duas sao so troca de corpo: sem GRANT/REVOKE, sem transacao propria, com conferencia final e terminando no NOTIFY; a ACL e a mesma depois da cadeia",
  () =>
    emTransacao(async () => {
      await C.query(RB1342);
      await C.query(RB1341);
      for (const [nome, sql] of [
        ["1341", M1341],
        ["1342", M1342],
      ]) {
        assert.match(sql, /DO \$conferencia_2026134[12]\$/, nome);
        assert.ok(
          !/\bGRANT\b|\bREVOKE\b/.test(sql.replace(/--[^\n]*/g, "")),
          `${nome}: nao mexe em permissao`,
        );
        assert.ok(
          !/\bBEGIN;|\bCOMMIT;/.test(sql.replace(/--[^\n]*/g, "")),
          `${nome}: sem transacao propria`,
        );
        assert.match(
          sql.trimEnd(),
          /NOTIFY pgrst, 'reload schema';$/,
          `${nome}: termina com o NOTIFY`,
        );
      }
      const acl = (await atributos()).acl;
      await C.query(M1341);
      await C.query(M1342);
      assert.equal((await atributos()).acl, acl, "a ACL nao mudou na cadeia");
    }),
);

prova(
  "INVENTARIO: a ACL da v2 e' a mesma de sempre e portas-do-visitante-permitidas.json nao precisa mudar (anon, authenticated e service_role executam; PUBLIC nao)",
  () =>
    emTransacao(async () => {
      const r = (
        await C.query(
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                  has_function_privilege('service_role', $1, 'EXECUTE') AS servico,
                  EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                           WHERE p.oid = to_regprocedure($1) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) AS public`,
          [V2],
        )
      ).rows[0];
      assert.deepEqual(r, {
        anon: true,
        auth: true,
        servico: true,
        public: false,
      });
      const inventario = JSON.parse(
        fs.readFileSync(
          path.join(
            REPO,
            "tests",
            "banco",
            "portas-do-visitante-permitidas.json",
          ),
          "utf8",
        ),
      );
      const texto = JSON.stringify(inventario);
      assert.ok(
        texto.includes("get_orders_by_otp_v2"),
        "a v2 e' porta permitida do visitante",
      );
      // As migrations nao tocam na ACL: o inventario nao tem o que mudar.
      for (const sql of [M1341, M1342, RB1341, RB1342])
        assert.ok(!/\bGRANT\b|\bREVOKE\b/.test(sql.replace(/--[^\n]*/g, "")));
    }),
);

// ---------------------------------------------------------------------------
// as consultas 65a/65b/66a/66b
// ---------------------------------------------------------------------------

const Q = {
  "65a": "65a-conferir-codigo-do-convidado-trava-a-linha-aplicado",
  "65b": "65b-antes-codigo-do-convidado-corpo-da-1217",
  "66a": "66a-conferir-rastreio-do-convidado-sem-nota-aplicado",
  "66b": "66b-antes-rastreio-do-convidado-corpo-da-1341",
};
const L_CORPO = {
  "65a":
    "get_orders_by_otp_v2: corpo trava a linha do codigo (20261341000000 ou sucessora, md5)",
  "65b": "get_orders_by_otp_v2: corpo da 20261217000000 (base anterior, md5)",
  "66a":
    "get_orders_by_otp_v2: corpo sem a nota do pedido (20261342000000, md5)",
  "66b": "get_orders_by_otp_v2: corpo da 20261341000000 (base anterior, md5)",
};
const L_ATRIBUTOS =
  "get_orders_by_otp_v2: assinatura, atributos e EXECUTE preservados";
const sqlDe = (k) =>
  fs.readFileSync(path.join(CONSULTAS, `${Q[k]}.sql`), "utf8");

/** Roda a consulta como `authenticated` numa transacao SOMENTE LEITURA (savepoint) e devolve as linhas. */
async function rodarQ(k) {
  await C.query("SAVEPOINT leituraq");
  try {
    await C.query("SET LOCAL ROLE authenticated");
    await C.query("SET LOCAL transaction_read_only = on");
    const r = await C.query(sqlDe(k));
    assert.deepEqual(
      r.fields.map((x) => x.name),
      ["item", "esperado", "vivo", "ok"],
    );
    return r.rows;
  } finally {
    await C.query("RESET ROLE");
    await C.query("ROLLBACK TO SAVEPOINT leituraq");
  }
}
const reprovadasQ = (linhas) =>
  linhas
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();
const veredito = (k, linhas) =>
  CONF.veredictoDaConsulta({
    consulta: Q[k],
    ref: "abcdefghijklmnopqrst",
    sha: "0".repeat(40),
    linhas,
  });

prova(
  "CONSULTAS 65/66: rol fechado de 3 linhas; cada consulta e' positiva so no seu estado (1217 / 1341 / 1342) e a 65a aceita a sucessora; reprova so a linha do corpo nos outros",
  () =>
    emTransacao(async () => {
      for (const k of Object.keys(Q)) {
        const rol = CONF.ROL_FECHADO_POR_CONSULTA[Q[k]];
        assert.equal(rol.length, 3, k);
        const sql = sqlDe(k);
        for (const m of sql.matchAll(
          /(?<!DISTINCT\s+)\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi,
        ))
          assert.ok(
            [
              "pg_proc",
              "pg_language",
              "pg_namespace",
              "aclexplode",
              "fn",
              "itens",
            ].includes(m[1].toLowerCase()),
            `${Q[k]}: le de ${m[1]}`,
          );
      }
      // esperado[estado] = quais consultas ficam positivas
      const positivas = {
        1217: ["65b"],
        1341: ["65a", "66b"],
        1342: ["65a", "66a"],
      };
      const montar = {
        1342: async () => {},
        1341: async () => C.query(RB1342),
        1217: async () => {
          await C.query(RB1342);
          await C.query(RB1341);
        },
      };
      for (const estado of ["1342", "1341", "1217"]) {
        await C.query("SAVEPOINT estado");
        await montar[estado]();
        assert.equal(await estadoDoCorpo(), estado);
        for (const k of Object.keys(Q)) {
          const linhas = await rodarQ(k);
          assert.deepEqual(
            linhas.map((l) => l.item).sort(),
            [...CONF.ROL_FECHADO_POR_CONSULTA[Q[k]]].sort(),
            `${k} em ${estado}: rol`,
          );
          const falhas = reprovadasQ(linhas);
          if (positivas[estado].includes(k)) {
            assert.deepEqual(
              falhas,
              [],
              `${k} em ${estado} tinha de ser positiva`,
            );
            assert.match(
              veredito(k, linhas),
              / linhas=3 ok_false=0 ok_nao_booleano=0 rol=ok$/,
            );
          } else {
            assert.deepEqual(
              falhas,
              [L_CORPO[k]],
              `${k} em ${estado} tinha de reprovar SO o corpo`,
            );
            assert.match(
              veredito(k, linhas),
              / linhas=3 ok_false=1 ok_nao_booleano=0 rol=ok$/,
            );
          }
        }
        await C.query("ROLLBACK TO SAVEPOINT estado");
      }
      // Uma linha a menos nao e' o rol
      assert.match(
        veredito("65a", (await rodarQ("65a")).slice(1)),
        / rol=invalido$/,
      );
    }),
);

prova(
  "CONSULTAS 65/66, NEGATIVOS: corpo estranho, funcao ausente, EXECUTE de anon revogado, PUBLIC aberto, SECURITY INVOKER reprovam SO a linha certa; o corpo com CRLF (checkout no Windows) e' aceito",
  () =>
    emTransacao(async () => {
      const casos = [
        [
          "corpo estranho",
          `CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v2(p_email text, p_whatsapp text, p_fragmento text, p_otp text)
           RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
           AS $x$ BEGIN RETURN jsonb_build_object('ok', false); END; $x$`,
          "corpo",
        ],
        [
          "anon sem EXECUTE",
          `REVOKE EXECUTE ON FUNCTION ${V2} FROM anon`,
          "atributos",
        ],
        [
          "PUBLIC aberto",
          `GRANT EXECUTE ON FUNCTION ${V2} TO PUBLIC`,
          "atributos",
        ],
        [
          "SECURITY INVOKER",
          `ALTER FUNCTION ${V2} SECURITY INVOKER`,
          "atributos",
        ],
        ["funcao ausente", `DROP FUNCTION ${V2}`, "ambas"],
      ];
      for (const [rotulo, quebra, onde] of casos) {
        for (const [k, estado] of [
          ["65a", "1341"],
          ["65b", "1217"],
          ["66a", "1342"],
          ["66b", "1341"],
        ]) {
          await C.query("SAVEPOINT neg");
          if (estado === "1341") await C.query(RB1342);
          if (estado === "1217") {
            await C.query(RB1342);
            await C.query(RB1341);
          }
          await C.query(quebra);
          const falhas = reprovadasQ(await rodarQ(k));
          const esperado =
            onde === "corpo"
              ? [L_CORPO[k]]
              : onde === "atributos"
                ? [L_ATRIBUTOS]
                : [L_CORPO[k], L_ATRIBUTOS].sort();
          assert.deepEqual(falhas, esperado, `${k} / ${rotulo}`);
          await C.query("ROLLBACK TO SAVEPOINT neg");
        }
      }
      // CRLF: o mesmo corpo da 1342 gravado com \r\n (md5 sem CR igual) continua positivo na 66a.
      const def = (
        await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          V2,
        ])
      ).rows[0].d;
      await C.query(def.replace(/\n/g, "\r\n"));
      assert.ok(
        (await prosrcVivo()).includes("\r"),
        "o corpo gravado leva \\r",
      );
      assert.deepEqual(reprovadasQ(await rodarQ("66a")), []);
      assert.deepEqual(reprovadasQ(await rodarQ("65a")), []);
    }),
);

// ---------------------------------------------------------------------------

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  try {
    await C.connect();
  } catch (e) {
    falhar("INDETERMINADO", `Nao conectei no banco efemero: ${e.message}`);
  }
  const falhas = [];
  try {
    // As provas medem a arvore COM as duas migrations no ar (o banco do rpc-ci vem de todas as migrations aplicadas).
    assert.equal(
      await estadoDoCorpo(),
      "1342",
      "a arvore tem de ter a 20261342 no ar",
    );
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${String(e.message).split("\n").join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
        // garante o estado de partida para as provas seguintes, mesmo depois de uma falha no meio de uma troca de corpo
        await C.query("RESET ROLE").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do rastreio do convidado falharam.`,
    );
  }
  console.log(
    `\n[rastreio-do-convidado] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

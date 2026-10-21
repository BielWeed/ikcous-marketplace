"use strict";

/**
 * Prova VIVA da migration 20261349000000 (o pedido ENTREGUE antes da confirmação do PIX entra na fila de reconciliação:
 * `pagamentos_a_reconciliar` passa a trazer 'delivered' + 'aguardando'; DINHEIRO), num Postgres EFÊMERO local, sem rede,
 * com os papéis de verdade (anon, authenticated, service_role).
 *
 * O banco é o clone do rodar-isolado.cjs: a árvore migrada (a 20261349 já está no ar). Cada caso roda numa transação
 * que termina em ROLLBACK.
 *
 *  CORPOS     o corpo novo é o da 20261270000000 (lido do ARQUIVO) mais SÓ as edições combinadas: o diff de linhas tem
 *             exatamente as duas linhas de código do desenho ('delivered' no filtro e na ordenação) e duas de comentário;
 *             o rollback devolve o corpo da 270 BYTE A BYTE (md5 e sha256 do `prosrc` vivo) e a declaração é idêntica.
 *  CONTROLE   com o corpo da 270 o pedido entregue NÃO entra na fila (o defeito); com o novo entra. A borda: fora da
 *             janela de 24 h, sem cobrança, já pago, cobrança terminal, cancelado e pending seguem como antes.
 *  DADOS      o pedido entregue que JÁ existia antes da migration entra sem ser reescrito (nenhuma linha muda; o
 *             md5 da tabela é o mesmo antes e depois de aplicar).
 *  PERMISSÃO  só o servidor executa (anon e authenticated recebem permission denied); atributos e ACL iguais antes/depois.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback é recusado se repetido (corpo já desfeito); o pré-voo
 *             recusa SEM escrever (corpo desconhecido, atributo trocado, ACL aberta, sobrecarga); o pós-voo reprovando
 *             desfaz tudo.
 *  CONSULTAS  80a/80b: rol exato de 4 linhas, positivas no estado certo e reprovando no outro e a cada desvio.
 *  TROCA COM SESSÃO ABERTA  a migration troca o corpo enquanto outra sessão está no meio de uma transação que já chamou a
 *             fila: nenhuma das duas erra nem espera (CREATE OR REPLACE não trava a vitrine); a sessão vê o corpo novo depois.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/reconciliacao-do-entregue-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório (as migrations), nunca de entrada de rede; os índices
 * vêm de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const CONSULTAS = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "publicacao",
  "consultas",
);
const ARQ =
  "20261349000000_o_pedido_entregue_antes_da_confirmacao_entra_na_reconciliacao.sql";
const ARQ_270 =
  "20261270000000_pagamento_adiantado_e_estorno_antes_da_confirmacao.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, nome), "utf8");
const MIGRATION = ler(ARQ);
const ROLLBACK = ler(`rollback-manual-${ARQ}`);
const SRC_270 = ler(ARQ_270);
const A80 = lerConsulta(
  "80a-conferir-pedido-entregue-na-reconciliacao-aplicado.sql",
);
const B80 = lerConsulta(
  "80b-antes-pedido-entregue-na-reconciliacao-base-vigente.sql",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const FN = "public.pagamentos_a_reconciliar()";
const HASH_270 = "aed09ec910825168a3217b2e308824c5";
const HASH_NOVO = "350e732dbae6ba45bede77c08e0db6d8";

/** Da ÚLTIMA `CREATE OR REPLACE FUNCTION public.<fn>(` ao `$candidatos$;`: { cabeca (até o delimitador), corpo }. */
function funcaoDe(sql, fn) {
  const delim = "$candidatos$";
  const ini = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaração de ${fn} não achada`);
  const ab = sql.indexOf(delim, ini);
  const corpoIni = ab + delim.length;
  const fim = sql.indexOf(delim, corpoIni);
  return { cabeca: sql.slice(ini, corpoIni), corpo: sql.slice(corpoIni, fim) };
}
const ANTIGA = funcaoDe(SRC_270, "pagamentos_a_reconciliar");
const NOVA = funcaoDe(MIGRATION, "pagamentos_a_reconciliar");
const ROLL = funcaoDe(ROLLBACK, "pagamentos_a_reconciliar");
const MUTADO = process.env.PROVA_ARQUIVO_MUTADO === "1";

assert.equal(md5(ANTIGA.corpo), HASH_270, "o corpo da 270 mudou");
assert.equal(
  ROLL.corpo,
  ANTIGA.corpo,
  "o rollback não é o corpo da 270 byte a byte",
);
assert.equal(ROLL.cabeca, ANTIGA.cabeca, "a declaração do rollback mudou");
assert.equal(
  NOVA.cabeca,
  ANTIGA.cabeca,
  "a declaração mudou (assinatura, atributos)",
);
if (!MUTADO) assert.equal(md5(NOVA.corpo), HASH_NOVO, "o corpo novo mudou");

/** Diff por LCS: { removidas, adicionadas } (linhas aparadas, em multiconjunto). */
function diffDeLinhas(antigo, novo) {
  const a = antigo.split("\n").map((l) => l.trim());
  const b = novo.split("\n").map((l) => l.trim());
  const n = a.length;
  const m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i][j] =
        a[i] === b[j]
          ? t[i + 1][j + 1] + 1
          : Math.max(t[i + 1][j], t[i][j + 1]);
  const removidas = [];
  const adicionadas = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) removidas.push(a[i++]);
    else adicionadas.push(b[j++]);
  }
  while (i < n) removidas.push(a[i++]);
  while (j < m) adicionadas.push(b[j++]);
  return { removidas, adicionadas };
}

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });
let sequencia = 0;
const uuid = (n) => `7e349000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const prosrcVivo = async () =>
  (
    await C.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.prosrc;
const hashVivo = async () =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.h;
async function acl() {
  const r = await C.query(
    `SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a
       FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) AS x
      WHERE p.oid = to_regprocedure($1)`,
    [FN],
  );
  return r.rows[0].a;
}
async function atributos() {
  const r = await C.query(
    `SELECT l.lanname, p.prosecdef, p.provolatile, p.proretset, p.proisstrict, p.pronargs, p.proconfig,
            pg_get_function_result(p.oid) AS retorno, pg_get_function_arguments(p.oid) AS args,
            pg_get_userbyid(p.proowner) AS dono
       FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure($1)`,
    [FN],
  );
  return r.rows[0];
}

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

/** Uma transação por caso, sempre desfeita, no estado pedido: "antes" (rollback-manual: corpo da 270) ou "depois". */
async function emTransacao(fn, { estado = "depois" } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes") {
      await C.query(ROLLBACK);
      assert.equal(await hashVivo(), HASH_270, "ANTES: corpo da 270");
    } else if (!MUTADO) {
      assert.equal(
        await hashVivo(),
        HASH_NOVO,
        "DEPOIS: corpo desta migration",
      );
    } else {
      await C.query(`${NOVA.cabeca}${NOVA.corpo}$candidatos$;`);
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`; devolve as linhas (o erro sobe). */
async function como(papel, sql, params = []) {
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
  }
}
async function tentar(papel, sql, params = []) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

/** Um pedido de fixture (sem usuário: convidado). paga=true grava paid_at. vencidoHaMin: minutos desde o expires_at. */
async function pedido({
  status = "delivered",
  paymentStatus = "aguardando",
  gateway = null,
  vencidoHaMin = 60,
  metodoOnline = "pix",
  paga = false,
} = {}) {
  sequencia += 1;
  const id = uuid(sequencia);
  const g =
    gateway === null
      ? `ORD-349-${sequencia}`
      : gateway === false
        ? null
        : gateway;
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, gateway_payment_id, metodo_online, expires_at, paid_at)
     VALUES ($1, NULL, 'Cliente 349', '{}'::jsonb, 75, 75, $2, 'online', 'online', $3, $4, $5,
             now() - make_interval(mins => $6::int), CASE WHEN $7::boolean THEN now() ELSE NULL END)`,
    [id, status, paymentStatus, g, metodoOnline, vencidoHaMin, paga],
  );
  return { id, gateway: g };
}

/** Tira da fila as fixtures que já existiam no clone (só este clone): o LIMIT 100 não pode esconder a medida. */
async function limparFila() {
  await C.query(`INSERT INTO public.reconciliacao_visitas (order_id, visitado_em, cobranca_terminal)
    SELECT id, now(), gateway_payment_id FROM public.marketplace_orders WHERE gateway_payment_id IS NOT NULL
    ON CONFLICT (order_id) DO UPDATE SET cobranca_terminal = EXCLUDED.cobranca_terminal`);
}
const fila = async (papel = "service_role") =>
  new Set(
    (
      await como(
        papel,
        "SELECT order_id FROM public.pagamentos_a_reconciliar()",
      )
    ).map((r) => r.order_id),
  );
const tabela = async () =>
  (
    await C.query(
      "SELECT md5(string_agg(to_jsonb(o)::text, '|' ORDER BY o.id)) AS h, count(*)::int AS n FROM public.marketplace_orders o",
    )
  ).rows[0];

const positivo = async (sql, n) => {
  const r = await C.query(sql);
  assert.equal(r.rows.length, n, JSON.stringify(r.rows));
  assert.ok(
    r.rows.every((l) => l.ok === true),
    JSON.stringify(r.rows),
  );
};
const negativoEm = async (sql, itens, n) => {
  const r = await C.query(sql);
  assert.equal(r.rows.length, n, JSON.stringify(r.rows));
  const falhos = r.rows
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();
  assert.deepEqual(falhos, [...itens].sort(), JSON.stringify(r.rows));
};
const ITEM_CORPO = "pagamentos_a_reconciliar: corpo exato (md5)";
const ITEM_DELIVERED =
  "pagamentos_a_reconciliar: delivered nas duas listas de status";
const ITEM_ATRIBUTOS =
  "pagamentos_a_reconciliar: assinatura, atributos e EXECUTE so do servidor";

// ---------------------------------------------------------------------------

prova(
  "CORPOS: o corpo novo é o da 270 + só as edições combinadas; o rollback é a 270 byte a byte",
  async () => {
    const { removidas, adicionadas } = diffDeLinhas(ANTIGA.corpo, NOVA.corpo);
    const soCodigo = (l) =>
      l.filter((x) => x !== "" && !x.startsWith("--")).sort();
    assert.deepEqual(soCodigo(removidas), [
      "OR (o.payment_status = 'aguardando' AND o.status IN ('pending', 'processing', 'shipping'))",
      "ORDER BY (o.status IN ('pending', 'processing', 'shipping')) DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC",
    ]);
    assert.deepEqual(soCodigo(adicionadas), [
      "OR (o.payment_status = 'aguardando' AND o.status IN ('pending', 'processing', 'shipping', 'delivered'))",
      "ORDER BY (o.status IN ('pending', 'processing', 'shipping', 'delivered')) DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC",
    ]);
    assert.equal(
      adicionadas.filter((l) => l.startsWith("--")).length,
      2,
      "só duas linhas de comentário a mais",
    );
    assert.equal(removidas.filter((l) => l.startsWith("--")).length, 0);
    assert.equal((NOVA.corpo.match(/'delivered'/g) ?? []).length, 2);
    assert.equal((ANTIGA.corpo.match(/'delivered'/g) ?? []).length, 0);
    // O corpo vivo é o do arquivo (o prosrc, byte a byte, com CRLF normalizado).
    assert.equal((await prosrcVivo()).replace(/\r/g, ""), NOVA.corpo);
    assert.equal(sha256(NOVA.corpo).length, 64);
  },
);

prova(
  "CONTROLE + BORDA: com o corpo da 270 o entregue não entra; com o novo entra; a borda não muda",
  async () => {
    const casos = async () => {
      await limparFila();
      const entregue = await pedido({ status: "delivered" });
      const entregue14 = await pedido({
        status: "delivered",
        metodoOnline: "credito",
        vencidoHaMin: 5 * 24 * 60,
      });
      const velho = await pedido({
        status: "delivered",
        vencidoHaMin: 25 * 60,
      });
      const semCobranca = await pedido({ status: "delivered", gateway: false });
      const jaPago = await pedido({
        status: "delivered",
        paymentStatus: "pago",
        paga: true,
      });
      const pagoSemData = await pedido({
        status: "delivered",
        paymentStatus: "pago",
      });
      const terminal = await pedido({ status: "delivered" });
      await C.query(
        "INSERT INTO public.reconciliacao_visitas (order_id, visitado_em, cobranca_terminal) VALUES ($1, now(), $2)",
        [terminal.id, terminal.gateway],
      );
      const recusado = await pedido({
        status: "delivered",
        paymentStatus: "recusado",
      });
      const pending = await pedido({ status: "pending" });
      const processing = await pedido({ status: "processing" });
      const shipping = await pedido({ status: "shipping" });
      const cancelado = await pedido({ status: "cancelled" });
      const expirado = await pedido({
        status: "cancelled",
        paymentStatus: "expirado",
      });
      const novo = await pedido({ status: "new" });
      const f = await fila();
      return {
        entregue: f.has(entregue.id),
        entregue14: f.has(entregue14.id),
        velho: f.has(velho.id),
        semCobranca: f.has(semCobranca.id),
        jaPago: f.has(jaPago.id),
        pagoSemData: f.has(pagoSemData.id),
        terminal: f.has(terminal.id),
        recusado: f.has(recusado.id),
        pending: f.has(pending.id),
        processing: f.has(processing.id),
        shipping: f.has(shipping.id),
        cancelado: f.has(cancelado.id),
        expirado: f.has(expirado.id),
        novo: f.has(novo.id),
      };
    };
    const velhoNaBorda = {
      entregue: false, // O DEFEITO: o entregue nunca entra.
      entregue14: false,
      velho: false,
      semCobranca: false,
      jaPago: false,
      pagoSemData: false,
      terminal: false,
      recusado: false,
      pending: true,
      processing: true,
      shipping: true,
      cancelado: true,
      expirado: true,
      novo: false,
    };
    const antes = await emTransacao(casos, { estado: "antes" });
    assert.deepEqual(antes, velhoNaBorda, "ANTES (270)");
    const depois = await emTransacao(casos, { estado: "depois" });
    // SÓ o entregue (aguardando, com cobrança, dentro da janela) muda de resposta; o cartão de 5 dias fora da janela
    // do PIX (24 h) mas dentro da do cartão (14 dias) também entra: o filtro de status é que mudou, a janela não.
    assert.deepEqual(depois, {
      ...velhoNaBorda,
      entregue: true,
      entregue14: true,
    });
  },
);

prova(
  "ORDEM: o entregue conta como vivo (vem antes do cancelado/expirado), e o rodízio dos 100 continua",
  async () => {
    await emTransacao(async () => {
      await limparFila();
      const expirado = await pedido({
        status: "cancelled",
        paymentStatus: "expirado",
        vencidoHaMin: 5,
      });
      const entregue = await pedido({ status: "delivered", vencidoHaMin: 600 });
      const processing = await pedido({
        status: "processing",
        vencidoHaMin: 300,
      });
      const ordem = (
        await como(
          "service_role",
          "SELECT order_id FROM public.pagamentos_a_reconciliar()",
        )
      ).map((r) => r.order_id);
      // vivo primeiro (entregue e processing, o mais novo expires_at primeiro entre iguais), o morto depois.
      assert.deepEqual(ordem, [processing.id, entregue.id, expirado.id]);
      // 105 vivos, metade entregues: dois ciclos cobrem todos (o LIMIT 100 não monopoliza a fila).
      const ids = new Set();
      for (let i = 0; i < 105; i++)
        ids.add((await pedido({ status: i % 2 ? "delivered" : "pending" })).id);
      const um = (
        await como(
          "service_role",
          "SELECT order_id FROM public.pagamentos_a_reconciliar()",
        )
      ).map((r) => r.order_id);
      assert.equal(um.length, 100);
      await C.query(
        "SELECT public.marcar_visitas_da_reconciliacao($1::uuid[], '{}'::uuid[], '{}'::text[])",
        [um],
      );
      const dois = (
        await como(
          "service_role",
          "SELECT order_id FROM public.pagamentos_a_reconciliar()",
        )
      ).map((r) => r.order_id);
      assert.equal(dois.length, 100);
      const vistos = new Set([...um, ...dois]);
      for (const id of ids)
        assert.ok(
          vistos.has(id),
          "todo vivo (inclusive o entregue) é visitado em dois ciclos",
        );
    });
  },
);

prova(
  "DADOS: o entregue que já estava preso entra SEM ser reescrito — a tabela é a mesma antes e depois de aplicar",
  async () => {
    await emTransacao(
      async () => {
        await limparFila();
        const preso = await pedido({ status: "delivered" });
        assert.ok(!(await fila()).has(preso.id), "preso na 270");
        const antes = await tabela();
        assert.equal(await aplicar(MIGRATION), null);
        assert.equal(await hashVivo(), HASH_NOVO);
        const depois = await tabela();
        assert.deepEqual(
          depois,
          antes,
          "nenhuma linha de marketplace_orders mudou",
        );
        assert.ok(
          (await fila()).has(preso.id),
          "o preso volta à fila no ciclo seguinte",
        );
        // E o que a reconsulta faz com ele: o pagamento confirmado vira entrada, sem tocar status nem estoque.
        const r = await como(
          "service_role",
          "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
          [preso.id, preso.gateway],
        );
        assert.equal(r[0].r, "pago");
        const o = (
          await C.query(
            "SELECT status, payment_status, paid_at FROM public.marketplace_orders WHERE id = $1",
            [preso.id],
          )
        ).rows[0];
        assert.equal(o.status, "delivered");
        assert.equal(o.payment_status, "pago");
        assert.ok(o.paid_at);
      },
      { estado: "antes" },
    );
  },
);

prova(
  "PERMISSÃO: só o servidor executa; atributos e ACL iguais antes e depois",
  async () => {
    const doAntes = await emTransacao(
      async () => ({ acl: await acl(), attr: await atributos() }),
      {
        estado: "antes",
      },
    );
    const doDepois = await emTransacao(async () => ({
      acl: await acl(),
      attr: await atributos(),
    }));
    assert.deepEqual(
      doDepois,
      doAntes,
      "ACL, dono, linguagem, SECURITY DEFINER, search_path, retorno: nada mudou",
    );
    assert.equal(doDepois.attr.prosecdef, true);
    assert.deepEqual(doDepois.attr.proconfig, ["search_path=public"]);
    assert.ok(
      !doDepois.acl.some((a) => a.startsWith("=")),
      "PUBLIC sem EXECUTE",
    );
    await emTransacao(async () => {
      for (const papel of ["anon", "authenticated"]) {
        const r = await tentar(
          papel,
          "SELECT * FROM public.pagamentos_a_reconciliar()",
        );
        assert.ok(
          r.erro && r.codigo === "42501",
          `${papel}: permission denied (${r.erro})`,
        );
      }
      const ok = await tentar(
        "service_role",
        "SELECT count(*)::int AS n FROM public.pagamentos_a_reconciliar()",
      );
      assert.ok(ok.linhas, "service_role executa");
    });
  },
);

prova(
  "MIGRATION: reaplicar (2x) e CRLF = mesmo estado; o rollback ida e volta; rollback repetido é recusado",
  async () => {
    await emTransacao(async () => {
      assert.equal(
        await aplicar(MIGRATION),
        null,
        "reaplicar no estado DEPOIS",
      );
      assert.equal(await aplicar(MIGRATION), null, "reaplicar de novo");
      assert.equal(await hashVivo(), HASH_NOVO);
      const antesAcl = await acl();
      // CRLF no arquivo → o corpo vivo fica com CR; o hash normalizado (e o pré-voo) continuam batendo.
      assert.equal(
        await aplicar(emCRLF(MIGRATION)),
        null,
        "migration com CRLF",
      );
      assert.equal(
        await hashVivo(),
        HASH_NOVO,
        "hash normalizado = pós-migration",
      );
      assert.notEqual(
        md5(await prosrcVivo()),
        HASH_NOVO,
        "o corpo vivo tem CRLF de verdade",
      );
      // Rollback: o `prosrc` volta IDÊNTICO ao da 270 (md5 e sha256 do texto do arquivo).
      assert.equal(await aplicar(ROLLBACK), null, "rollback aplica");
      const prosrc = (await prosrcVivo()).replace(/\r/g, "");
      assert.equal(prosrc, ANTIGA.corpo, "byte a byte");
      assert.equal(md5(prosrc), HASH_270);
      assert.equal(sha256(prosrc), sha256(ANTIGA.corpo));
      assert.deepEqual(await acl(), antesAcl, "o rollback não mexe na ACL");
      // O rollback repetido (corpo já desfeito) é recusado e não escreve nada.
      const r2 = await aplicar(ROLLBACK);
      assert.match(r2?.erro ?? "", /B1_BASELINE_DIVERGENT/);
      assert.equal(await hashVivo(), HASH_270);
      // E a migration volta.
      assert.equal(
        await aplicar(MIGRATION),
        null,
        "reaplicar depois do rollback",
      );
      assert.equal(await hashVivo(), HASH_NOVO);
    });
  },
);

prova(
  "PRÉ-VOO: corpo desconhecido, atributo trocado, ACL aberta e sobrecarga recusam SEM escrever",
  async () => {
    // Parte do estado ANTES (corpo da 270): a migration é que vai escrever.
    const recusa = async (sabotar, padrao, { esperaCorpo = HASH_270 } = {}) =>
      emTransacao(
        async () => {
          await sabotar();
          const antesProsrc = await prosrcVivo();
          const antesAcl = await acl();
          const r = await aplicar(MIGRATION);
          assert.match(
            r?.erro ?? "",
            padrao,
            `a migration devia recusar (${padrao})`,
          );
          assert.equal(
            await prosrcVivo(),
            antesProsrc,
            "recusou SEM escrever o corpo",
          );
          assert.deepEqual(await acl(), antesAcl);
          if (esperaCorpo) assert.notEqual(await hashVivo(), HASH_NOVO);
        },
        { estado: "antes" },
      );
    // (a) corpo desconhecido: o da 270 com uma linha a mais.
    await recusa(async () => {
      const f = (
        await C.query(
          "SELECT pg_get_functiondef(p.oid) AS ddl, p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
          [FN],
        )
      ).rows[0];
      await C.query(f.ddl.replace(f.prosrc, `${f.prosrc}\n`));
    }, /B1_BASELINE_DIVERGENT/);
    // (b) o corpo antigo de ANTES da 270 (a 20261190): a migration exige a 270 primeiro.
    await recusa(async () => {
      const f190 = ler(
        "20261190000000_a_reconciliacao_alcanca_o_cartao_tardio.sql",
      );
      const corpo = funcaoDe(f190, "pagamentos_a_reconciliar");
      await C.query(`${corpo.cabeca}${corpo.corpo}$candidatos$;`);
    }, /B1_BASELINE_DIVERGENT.*20261270000000/);
    // (c) atributo trocado: SECURITY INVOKER.
    await recusa(async () => {
      await C.query(
        "ALTER FUNCTION public.pagamentos_a_reconciliar() SECURITY INVOKER",
      );
    }, /B1_BASELINE_DIVERGENT.*atributos/);
    // (d) search_path diferente.
    await recusa(async () => {
      await C.query(
        "ALTER FUNCTION public.pagamentos_a_reconciliar() SET search_path = public, pg_temp",
      );
    }, /B1_BASELINE_DIVERGENT.*atributos/);
    // (e) ACL aberta ao anonimo.
    await recusa(async () => {
      await C.query(
        "GRANT EXECUTE ON FUNCTION public.pagamentos_a_reconciliar() TO anon",
      );
    }, /B1_BASELINE_DIVERGENT.*ACL/);
    // (f) ACL aberta a PUBLIC.
    await recusa(async () => {
      await C.query(
        "GRANT EXECUTE ON FUNCTION public.pagamentos_a_reconciliar() TO PUBLIC",
      );
    }, /B1_BASELINE_DIVERGENT.*ACL/);
    // (g) servidor sem EXECUTE.
    await recusa(async () => {
      await C.query(
        "REVOKE EXECUTE ON FUNCTION public.pagamentos_a_reconciliar() FROM service_role",
      );
    }, /B1_BASELINE_DIVERGENT.*ACL/);
    // (h) sobrecarga em public.
    await recusa(async () => {
      await C.query(
        "CREATE FUNCTION public.pagamentos_a_reconciliar(p int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
      );
    }, /B1_BASELINE_DIVERGENT.*sobrecarga/);
    // (i) função ausente.
    await recusa(
      async () => {
        await C.query("DROP FUNCTION public.pagamentos_a_reconciliar()");
      },
      /B1_BASELINE_DIVERGENT.*nao existe/,
      { esperaCorpo: null },
    );
  },
);

prova(
  "PÓS-VOO: se o corpo gravado não é o que o pós-voo espera, a migration inteira cai (nada fica gravado)",
  async () => {
    await emTransacao(
      async () => {
        const antes = await prosrcVivo();
        // Sabota o arquivo: a ordenação sem 'delivered' → corpo gravado ≠ hash esperado → POSVOO_ → exceção.
        const sabotada = MIGRATION.replace(
          "ORDER BY (o.status IN ('pending', 'processing', 'shipping', 'delivered')) DESC",
          "ORDER BY (o.status IN ('pending', 'processing', 'shipping')) DESC",
        );
        assert.notEqual(sabotada, MIGRATION);
        const r = await aplicar(sabotada);
        assert.match(r?.erro ?? "", /POSVOO_20261349000000/);
        assert.equal(
          await prosrcVivo(),
          antes,
          "o pós-voo reprovando desfez a troca de corpo",
        );
      },
      { estado: "antes" },
    );
  },
);

prova(
  "CONSULTAS 80a/80b: rol exato; positivas no estado certo; cada desvio reprova o item certo",
  async () => {
    const rol = [
      "controle: funcoes de public visiveis a este papel",
      ITEM_CORPO,
      ITEM_DELIVERED,
      ITEM_ATRIBUTOS,
    ];
    // DEPOIS: a 80a positiva; a 80b reprova corpo e contagem.
    await emTransacao(async () => {
      await positivo(A80, 4);
      await negativoEm(B80, [ITEM_CORPO, ITEM_DELIVERED], 4);
      assert.deepEqual(
        (await C.query(A80)).rows.map((l) => l.item).sort(),
        [...rol].sort(),
      );
      // Desvios do DEPOIS.
      await C.query("SAVEPOINT d");
      await C.query(
        "ALTER FUNCTION public.pagamentos_a_reconciliar() SECURITY INVOKER",
      );
      await negativoEm(A80, [ITEM_ATRIBUTOS], 4);
      await C.query("ROLLBACK TO SAVEPOINT d");
      await C.query(
        "GRANT EXECUTE ON FUNCTION public.pagamentos_a_reconciliar() TO authenticated",
      );
      await negativoEm(A80, [ITEM_ATRIBUTOS], 4);
      await C.query("ROLLBACK TO SAVEPOINT d");
      const f = (
        await C.query(
          "SELECT pg_get_functiondef(p.oid) AS ddl, p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
          [FN],
        )
      ).rows[0];
      await C.query(f.ddl.replace(f.prosrc, `${f.prosrc}\n`));
      await negativoEm(A80, [ITEM_CORPO], 4);
      await C.query("ROLLBACK TO SAVEPOINT d");
      await positivo(A80, 4);
    });
    // ANTES (corpo da 270): a 80b positiva; a 80a reprova corpo e contagem.
    await emTransacao(
      async () => {
        await positivo(B80, 4);
        await negativoEm(A80, [ITEM_CORPO, ITEM_DELIVERED], 4);
        // A 57a (a consulta da 270) segue positiva nos DOIS estados: o corpo novo é sucessor aceito.
        const a57 = lerConsulta(
          "57a-conferir-pagamento-adiantado-e-estorno-aplicado.sql",
        );
        assert.equal(
          (await C.query(a57)).rows.every((l) => l.ok === true),
          true,
          "57a positiva com o corpo da 270",
        );
      },
      { estado: "antes" },
    );
    await emTransacao(async () => {
      const a57 = lerConsulta(
        "57a-conferir-pagamento-adiantado-e-estorno-aplicado.sql",
      );
      const r = (await C.query(a57)).rows;
      assert.equal(r.length, 5);
      assert.ok(
        r.every((l) => l.ok === true),
        `57a positiva com o corpo NOVO (sucessor): ${JSON.stringify(r)}`,
      );
    });
  },
);

prova(
  "TROCA COM SESSÃO ABERTA: a migration troca o corpo enquanto outra sessão está no meio da transação — nenhuma das duas erra",
  async () => {
    // A sessão B chama a fila segurando uma transação aberta com a função já resolvida; a A reaplica a migration.
    // No Postgres, o corpo SQL é lido na chamada: B termina e a chamada seguinte vê o corpo vigente.
    const url = lerDatabaseUrlEfemera();
    const B = new Client({ connectionString: url });
    await B.connect();
    try {
      await B.query("BEGIN");
      const r1 = await B.query(
        "SELECT count(*)::int AS n FROM public.pagamentos_a_reconciliar()",
      );
      assert.ok(Number.isInteger(r1.rows[0].n));
      // A reaplica (mesmo texto): CREATE OR REPLACE não espera a transação de B de ler.
      const A = new Client({ connectionString: url });
      await A.connect();
      try {
        await A.query("BEGIN");
        await A.query(MIGRATION);
        await A.query("COMMIT");
      } finally {
        await A.end().catch(() => {});
      }
      const r2 = await B.query(
        "SELECT count(*)::int AS n FROM public.pagamentos_a_reconciliar()",
      );
      assert.ok(Number.isInteger(r2.rows[0].n));
      await B.query("ROLLBACK");
    } finally {
      await B.end().catch(() => {});
    }
    assert.equal(await hashVivo(), HASH_NOVO);
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  try {
    await C.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await C.query("ROLLBACK").catch(() => {});
        await corpo();
        console.log(`  PASSOU ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.stack || erro.message}`);
        await C.end().catch(() => {});
        falhar(
          "FALHOU",
          "A fila de reconciliação do pedido entregue (20261349000000) quebrou uma regra — ver acima qual.",
        );
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  console.log(
    `\n[reconciliacao-do-entregue] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));

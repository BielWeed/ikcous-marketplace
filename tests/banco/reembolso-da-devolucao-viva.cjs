"use strict";

/**
 * Prova VIVA da migration 20261225000000 (o reembolso da devolucao so e' "liberado" quando o dinheiro sai;
 * decisao do dono, 14/10/2026) num Postgres EFEMERO local, sem rede, com os papeis de verdade
 * (anon, authenticated, service_role) e com o fluxo REAL do painel (`admin_devolucao_concluir`,
 * `concluir_estorno`).
 *
 * Cada caso roda numa transacao que termina em ROLLBACK (o da corrida usa duas conexoes reais, grava de
 * verdade e desfaz). O banco e' o clone do rodar-isolado.cjs: a arvore migrada.
 *
 *  ANTES      controle: com o corpo antigo do gatilho, a devolucao concluida diz "foi liberado" com o reembolso ainda
 *             SOLICITADO (o defeito) e a linha 'falhou' tambem diz "liberado".
 *  AVISO      o aviso da conclusao segue o estado REAL do reembolso (processamento, nao liberado, combinado com a
 *             loja); o "liberado" nasce so quando `concluir_estorno` vira a linha para 'concluido', UMA vez (repetir
 *             concluir_estorno, concluir de novo e duas conexoes em corrida nao dobram), tambem quando e' a linha
 *             'falhou' que e' concluida pela consulta; um aviso que falha NUNCA desfaz o dinheiro; troca, vale e os
 *             outros status seguem iguais.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve o `prosrc` IDENTICO (mesmo md5) e apaga so o
 *             que a migration criou, a ida e volta termina igual; o pre-voo recusa SEM escrever; a conferencia
 *             final, rodada sobre estados ruins, recusa; so 3 corpos e o gatilho novo mudam (nenhuma tabela,
 *             nenhuma ACL de objeto antigo); nenhum dado existente muda.
 *  MUTANTES   o mesmo comportamento esperado, rodado sobre corpos sabotados (aviso "liberado" na conclusao,
 *             "liberado" com a linha 'falhou', gatilho sem a virada para 'concluido', auxiliar sem dedup, EXECUTE
 *             para authenticated), FICA VERMELHO.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/reembolso-da-devolucao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

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
const ARQ =
  "20261225000000_o_reembolso_da_devolucao_so_e_liberado_quando_o_dinheiro_sai.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");

// O corpo ANTIGO do gatilho e' o da 20261175000000, LIDO DO ARQUIVO, nunca copiado para ca.
const M175 = fs.readFileSync(
  path.join(MIGRATIONS, "20261175000000_a_devolucao_nasce_no_pedido.sql"),
  "utf8",
);
const CORPO_ANTIGO = (() => {
  const i = M175.indexOf(
    "CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()",
  );
  const a = M175.indexOf("AS $$", i) + "AS $$".length;
  return M175.slice(a, M175.indexOf("$$;", a));
})();
const H_ANTIGO = "0bf0bf168c1c0db817220329c47b64ef";
assert.equal(md5(CORPO_ANTIGO), H_ANTIGO, "o corpo da 20261175000000 mudou");

/** O CREATE OR REPLACE FUNCTION inteiro de uma funcao da migration, pelo marcador de dolar-quote. */
const statementDe = (tag) => {
  const fim = MIGRATION.indexOf(`$${tag}$;`);
  assert.ok(fim > 0, `tag ${tag} nao achada`);
  const ini = MIGRATION.lastIndexOf("CREATE OR REPLACE FUNCTION", fim);
  return MIGRATION.slice(ini, fim + `$${tag}$;`.length);
};
const corpoDaTag = (tag) => {
  const a = MIGRATION.indexOf(`AS $${tag}$`) + `AS $${tag}$`.length;
  return MIGRATION.slice(a, MIGRATION.indexOf(`$${tag}$;`, a));
};
const FUNCOES = {
  avisa: { tag: "avisa_o_cliente", sig: "public.devolucao_avisa_o_cliente()" },
  avisar: {
    tag: "avisar_reembolso",
    sig: "public.devolucao__avisar_reembolso(uuid,text,text,text,text)",
  },
  liberado: {
    tag: "avisa_liberado",
    sig: "public.devolucao_avisa_reembolso_liberado()",
  },
};
const H = Object.fromEntries(
  Object.entries(FUNCOES).map(([k, v]) => [k, md5(corpoDaTag(v.tag))]),
);

const U = {
  cliente: "7e7e2240-0000-4000-8000-0000000000c1",
  outro: "7e7e2240-0000-4000-8000-0000000000c2",
  admin: "7e7e2240-0000-4000-8000-0000000000a1",
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
let SEQ = 0;
const idDe = (prefixo) =>
  `7e7e2240-${prefixo}-4000-8000-${String(++SEQ).padStart(12, "0")}`;

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashDe = async (sig) =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.h ?? null;

/** Uma transacao por caso, sempre desfeita, no estado DEPOIS (a migration aplicada, idempotente) ou ANTES (rollback). */
async function emTransacao(fn, { estado = "depois" } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes") {
      await C.query(ROLLBACK);
      assert.equal(
        await hashDe(FUNCOES.avisa.sig),
        H_ANTIGO,
        "o estado ANTES nao montou",
      );
    } else {
      await C.query(MIGRATION);
      assert.equal(
        await hashDe(FUNCOES.avisa.sig),
        H.avisa,
        "o estado DEPOIS nao montou",
      );
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`, com o JWT e o auth.uid() pedidos; devolve as linhas (o erro sobe). */
async function como(
  papel,
  sql,
  params = [],
  { uid = "", claims = "" } = {},
  conexao = C,
) {
  await conexao.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await conexao.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await conexao.query(sql, params)).rows;
  } finally {
    await conexao.query("RESET ROLE").catch(() => {});
  }
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo}. */
async function tentar(papel, sql, params = [], id = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, id);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

/** Aplica um texto dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
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

// ---------------------------------------------------------------------------
// Fixtures: pessoas, pedido entregue e pago pelo app, devolucao 'recebida'
// ---------------------------------------------------------------------------

async function semearPessoas() {
  for (const [id, meta] of [
    [U.cliente, "{}"],
    [U.outro, "{}"],
    [U.admin, '{"role":"admin"}'],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@24.teste', $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, meta],
    );
  }
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente 24', 'customer'), ($2, 'Outro 24', 'customer'), ($3, 'Admin 24', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U.cliente, U.outro, U.admin],
  );
}

/** Pedido entregue e pago; `o` muda o que o caso precisa. Devolve o id. */
async function pedido(o = {}) {
  const id = o.id ?? idDe("0001");
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal,
        payment_method, payment_status, paid_at, pagamento_recebido_em, gateway_payment_id, valor_estornado)
     VALUES ($1, $2, 'Cliente 24', '{"whatsapp":"5534999990000"}'::jsonb, $3, $3, 0, $4, 'online',
             $5, $6, now() - make_interval(days => $7::int), now() - make_interval(days => $7::int), $8, $9)`,
    [
      id,
      o.userId ?? U.cliente,
      o.total ?? 300,
      o.status ?? "delivered",
      o.metodo ?? "online",
      o.pagamento ?? "pago",
      o.pagoHaDias ?? 3,
      o.gateway === undefined ? `ORD24-AUTO-${SEQ}` : o.gateway,
      o.valorEstornado ?? 0,
    ],
  );
  return id;
}

/** Devolucao 'recebida' (pronta para o lojista concluir). */
async function devolucaoRecebida(
  orderId,
  { valor = 100, userId = U.cliente } = {},
) {
  const id = idDe("0002");
  await C.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno,
        status, valor_itens, valor_frete_ida, prazo_ate, politica)
     VALUES ($1::uuid, 'DEV-24-' || substr($1::text, 31), $2::uuid, $3::uuid, 'arrependimento', 'desisti', 'reembolso', 'nacional',
             'envio_proprio', 'recebida', $4, 0, current_date + 7, '{}'::jsonb)`,
    [id, orderId, userId, valor],
  );
  return id;
}

/** O lojista conclui pelo painel (RPC real). Devolve {devolucao, refund}. */
async function concluirComReembolso(devolucaoId, valor) {
  const r = await como(
    "authenticated",
    "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', '[]'::jsonb, $2::numeric, NULL) AS r",
    [devolucaoId, valor ?? null],
    { uid: U.admin, claims: JWT_ADMIN },
  );
  return { devolucao: devolucaoId, refund: r[0].r.refund_id };
}

/** Um cenario inteiro: pedido + devolucao concluida pelo painel (linha do reembolso 'solicitado'). */
async function cenario(o = {}) {
  await semearPessoas();
  const orderId = await pedido(o.pedido);
  const dev = await devolucaoRecebida(orderId, { valor: o.valor ?? 100 });
  const { refund } = await concluirComReembolso(dev, o.valor ?? 100);
  return { orderId, dev, refund };
}

const mudarLinha = (refund, status, extras = "") =>
  C.query(
    `UPDATE public.order_refunds SET status = $2 ${extras} WHERE id = $1`,
    [refund, status],
  );

const avisos = async (dev, evento) =>
  (
    await C.query(
      `SELECT tipo, titulo, mensagem, dados FROM public.notificacoes
        WHERE dados ->> 'devolucao_id' = $1 ${evento ? "AND dados ->> 'evento' = $2" : ""} ORDER BY created_at, id`,
      evento ? [dev, evento] : [dev],
    )
  ).rows;

const concluirEstorno = (refund) =>
  como(
    "service_role",
    "SELECT public.concluir_estorno($1::uuid, 'REF-24', 'refunded', NULL) AS r",
    [refund],
  );

const linha = async (id) =>
  (await C.query("SELECT * FROM public.order_refunds WHERE id = $1", [id]))
    .rows[0];
/** A mensagem PROMETE que o dinheiro saiu ("foi liberado", sem "nao" antes). */
const promete = (m) => /(?<!não )foi liberado/.test(m);

// ---------------------------------------------------------------------------
// O COMPORTAMENTO que a migration promete — sobre os corpos que estiverem vivos. Levanta (assert) se falhar.
// ---------------------------------------------------------------------------

async function comportamentoDoAviso() {
  // 1. Concluir com reembolso: a cliente le "em processamento" (nunca "liberado"); UM aviso.
  const c1 = await cenario();
  let a = await avisos(c1.dev);
  assert.equal(a.length, 1, "um aviso na conclusao");
  assert.equal(a[0].dados.evento, "reembolso_em_processamento");
  assert.equal(a[0].tipo, "info");
  assert.match(a[0].mensagem, /em processamento/);
  assert.ok(
    !/liberado/.test(a[0].mensagem.replace(/quando ele for liberado/, "")),
    "nada de promessa de liberado",
  );
  // 2. O dinheiro SAI (concluir_estorno): nasce o "liberado", uma vez; concluir de novo nao dobra.
  await concluirEstorno(c1.refund);
  a = await avisos(c1.dev, "reembolso_liberado");
  assert.equal(a.length, 1, "o liberado nasce quando o dinheiro sai");
  assert.equal(a[0].tipo, "success");
  assert.match(a[0].mensagem, /foi liberado pelo Mercado Pago/);
  assert.equal(a[0].dados.order_id, c1.orderId);
  await concluirEstorno(c1.refund);
  assert.equal(
    (await avisos(c1.dev, "reembolso_liberado")).length,
    1,
    "concluir_estorno repetido nao dobra o aviso",
  );
  assert.equal((await avisos(c1.dev)).length, 2, "processamento + liberado");
  return c1;
}

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------

prova(
  "ANTES: com o corpo antigo (o da 20261175000000, byte a byte) a cliente le 'foi liberado' com o reembolso ainda SOLICITADO — e tambem com a linha 'falhou' (o defeito)",
  () =>
    emTransacao(
      async () => {
        assert.equal(await hashDe(FUNCOES.avisa.sig), H_ANTIGO);
        assert.equal(
          (
            await C.query(
              "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
              [FUNCOES.avisa.sig],
            )
          ).rows[0].prosrc,
          CORPO_ANTIGO,
          "prosrc identico ao da 20261175000000",
        );
        const c = await cenario();
        assert.equal(
          (await linha(c.refund)).status,
          "solicitado",
          "o dinheiro ainda nao saiu",
        );
        const a = await avisos(c.dev);
        assert.equal(a.length, 1);
        assert.match(
          a[0].mensagem,
          /foi liberado/,
          "o defeito: promete liberado antes do dinheiro sair",
        );
      },
      { estado: "antes" },
    ),
);

// ---------------------------------------------------------------------------
// AVISO
// ---------------------------------------------------------------------------

prova(
  "AVISO: concluir com reembolso = 'em processamento' (info); o 'liberado' (success) nasce SO quando concluir_estorno vira a linha, UMA vez, mesmo repetindo",
  () => emTransacao(comportamentoDoAviso),
);

prova(
  "AVISO: linha 'falhou' ou 'recusado' ou sem linha na conclusao = 'ainda nao foi liberado' (warning), NUNCA 'liberado'; reembolso manual = 'combinado com a loja'",
  () =>
    emTransacao(async () => {
      await semearPessoas();
      for (const [rotulo, montar, evento, tipo, regex] of [
        [
          "falhou",
          (r) => mudarLinha(r, "falhou", ", ultimo_erro = 'x'"),
          "reembolso_nao_liberado",
          "warning",
          /ainda não foi liberado/,
        ],
        [
          "recusado",
          (r) => mudarLinha(r, "recusado"),
          "reembolso_nao_liberado",
          "warning",
          /ainda não foi liberado/,
        ],
      ]) {
        // a linha ja esta no estado ruim QUANDO a devolucao conclui: monta o pedido, a linha e conclui na mao
        const orderId = await pedido({ id: idDe("0001") });
        const dev = await devolucaoRecebida(orderId);
        const refund = (
          await C.query(
            "INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status) VALUES ($1, 100, 'lojista', 'solicitado') RETURNING id",
            [orderId],
          )
        ).rows[0].id;
        await montar(refund);
        await C.query(
          "UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'reembolso', valor_reembolso = 100, refund_id = $2 WHERE id = $1",
          [dev, refund],
        );
        const a = await avisos(dev);
        assert.equal(a.length, 1, `${rotulo}: um aviso`);
        assert.equal(a[0].dados.evento, evento, rotulo);
        assert.equal(a[0].tipo, tipo, rotulo);
        assert.match(a[0].mensagem, regex, rotulo);
        assert.ok(!promete(a[0].mensagem), `${rotulo}: nenhuma promessa`);
      }
      // sem linha nenhuma (refund_id NULL e nao manual)
      const o2 = await pedido({ id: idDe("0001") });
      const d2 = await devolucaoRecebida(o2);
      await C.query(
        "UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'reembolso', valor_reembolso = 100 WHERE id = $1",
        [d2],
      );
      const a2 = await avisos(d2);
      assert.equal(a2[0].dados.evento, "reembolso_nao_liberado");
      // manual
      const o3 = await pedido({ id: idDe("0001") });
      const d3 = await devolucaoRecebida(o3);
      await C.query(
        "UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'reembolso', valor_reembolso = 100, reembolso_manual = true WHERE id = $1",
        [d3],
      );
      const a3 = await avisos(d3);
      assert.equal(a3.length, 1);
      assert.equal(a3[0].dados.evento, "reembolso_combinado");
      assert.match(a3[0].mensagem, /combinado com a loja/);
      assert.ok(!/liberado/.test(a3[0].mensagem));
    }),
);

prova(
  "AVISO: reembolso JA concluido quando a devolucao conclui (ordem invertida) = 'liberado' direto, e o gatilho de order_refunds depois nao dobra",
  () =>
    emTransacao(async () => {
      await semearPessoas();
      const orderId = await pedido();
      const dev = await devolucaoRecebida(orderId);
      const refund = (
        await C.query(
          "INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, concluido_em) VALUES ($1, 100, 'lojista', 'concluido', now()) RETURNING id",
          [orderId],
        )
      ).rows[0].id;
      await C.query(
        "UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'reembolso', valor_reembolso = 100, refund_id = $2 WHERE id = $1",
        [dev, refund],
      );
      const a = await avisos(dev);
      assert.equal(a.length, 1);
      assert.equal(a[0].dados.evento, "reembolso_liberado");
      assert.match(a[0].mensagem, /foi liberado pelo Mercado Pago/);
      // passar o status por falhou -> concluido (a consulta que acha) nao dobra o aviso
      await C.query(
        "UPDATE public.order_refunds SET status = 'falhou' WHERE id = $1",
        [refund],
      );
      await C.query(
        "UPDATE public.order_refunds SET status = 'concluido' WHERE id = $1",
        [refund],
      );
      assert.equal(
        (await avisos(dev, "reembolso_liberado")).length,
        1,
        "dedup",
      );
    }),
);

prova(
  "AVISO: troca, vale e os outros status seguem com o texto de sempre (sem 'evento'); linha de reembolso SEM devolucao (cancelamento, rastreio do sistema) conclui sem aviso e sem erro",
  () =>
    emTransacao(async () => {
      await semearPessoas();
      const orderId = await pedido();
      const dev = await devolucaoRecebida(orderId);
      await C.query(
        "UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'troca' WHERE id = $1",
        [dev],
      );
      let a = await avisos(dev);
      assert.equal(a.length, 1);
      assert.equal(
        a[0].mensagem,
        `A troca da devolução DEV-24-${dev.slice(30)} foi confirmada.`.replace(
          /DEV-24-.*? foi/,
          (m) => m,
        ),
      );
      assert.equal(
        a[0].dados.evento,
        undefined,
        "sem evento nos avisos antigos",
      );
      const o2 = await pedido({ id: idDe("0001") });
      const d2 = await devolucaoRecebida(o2);
      await C.query(
        "UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'vale' WHERE id = $1",
        [d2],
      );
      a = await avisos(d2);
      assert.match(a[0].mensagem, /O vale-troca da devolução .* foi emitido\./);
      const o3 = await pedido({ id: idDe("0001") });
      const d3 = await devolucaoRecebida(o3);
      await C.query(
        "UPDATE public.devolucoes SET status = 'reprovada' WHERE id = $1",
        [d3],
      );
      a = await avisos(d3);
      assert.equal(a[0].titulo, "Produto não aceito na inspeção");
      assert.equal(a[0].tipo, "warning");
      // linha de reembolso de um CANCELAMENTO (nenhuma devolucao aponta para ela): concluir nao quebra nada
      const o4 = await pedido({ id: idDe("0001"), status: "cancelled" });
      const solta = (
        await C.query(
          "INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status) VALUES ($1, 50, 'lojista', 'em_processamento') RETURNING id",
          [o4],
        )
      ).rows[0].id;
      const r = await concluirEstorno(solta);
      assert.equal(r[0].r.concluido, true);
      assert.equal((await linha(solta)).status, "concluido");
    }),
);

prova(
  "AVISO: um aviso que FALHA nunca desfaz o dinheiro (concluir_estorno conclui, valor_estornado sobe) — so um WARNING; e a trava e do gatilho, nao de quem a chama",
  () =>
    emTransacao(async () => {
      const c = await cenario();
      // qualquer INSERT de aviso 'Reembolso liberado' passa a violar uma constraint
      await C.query(
        "ALTER TABLE public.notificacoes ADD CONSTRAINT bloqueia_liberado_24 CHECK (titulo <> 'Reembolso liberado') NOT VALID",
      );
      const r = await concluirEstorno(c.refund);
      assert.equal(r[0].r.concluido, true, "o dinheiro concluiu");
      assert.equal((await linha(c.refund)).status, "concluido");
      const o = (
        await C.query(
          "SELECT valor_estornado FROM public.marketplace_orders WHERE id = $1",
          [c.orderId],
        )
      ).rows[0];
      assert.equal(Number(o.valor_estornado), 100, "valor_estornado somou");
      assert.equal(
        (await avisos(c.dev, "reembolso_liberado")).length,
        0,
        "o aviso nao nasceu",
      );
    }),
);

prova(
  "AVISO: a auxiliar e interna (nem anon, nem authenticated, nem service_role executam), devolve false no segundo aviso do mesmo evento e nao levanta com devolucao inexistente",
  () =>
    emTransacao(async () => {
      const c = await cenario();
      for (const papel of ["anon", "authenticated", "service_role"]) {
        const r = await tentar(
          papel,
          "SELECT public.devolucao__avisar_reembolso($1::uuid, 'x', 'info', 't', 'm') AS r",
          [c.dev],
          { uid: U.admin, claims: JWT_ADMIN },
        );
        assert.equal(r.codigo, "42501", `${papel}: ${r.erro}`);
      }
      const um = await C.query(
        "SELECT public.devolucao__avisar_reembolso($1::uuid, 'teste_evento', 'info', 't', 'm') AS r",
        [c.dev],
      );
      const dois = await C.query(
        "SELECT public.devolucao__avisar_reembolso($1::uuid, 'teste_evento', 'info', 't', 'm') AS r",
        [c.dev],
      );
      assert.equal(um.rows[0].r, true);
      assert.equal(dois.rows[0].r, false);
      const nada = await C.query(
        "SELECT public.devolucao__avisar_reembolso($1::uuid, 'teste_evento', 'info', 't', 'm') AS r",
        [idDe("0009")],
      );
      assert.equal(nada.rows[0].r, false);
    }),
);

// ---------------------------------------------------------------------------
// REEMISSAO: quem pode
// ---------------------------------------------------------------------------

prova(
  "CONCORRENCIA: duas conexoes concluindo a MESMA linha (concluir_estorno) ao mesmo tempo dao UM aviso 'liberado' e somam UMA vez",
  async () => {
    const B = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await B.connect();
    let ids = null;
    try {
      await C.query("BEGIN");
      await C.query(MIGRATION);
      await semearPessoas();
      const orderId = await pedido({
        id: idDe("0001"),
        gateway: "ORD24-CONC2",
      });
      const dev = await devolucaoRecebida(orderId);
      const { refund } = await concluirComReembolso(dev, 100);
      await C.query("COMMIT");
      ids = { orderId, dev, refund };
      const chamar = async (conexao) => {
        await conexao.query("BEGIN");
        await conexao.query("SET LOCAL ROLE service_role");
        const r = await conexao.query(
          "SELECT public.concluir_estorno($1::uuid, 'REF-C', 'refunded', NULL) AS r",
          [refund],
        );
        await conexao.query("COMMIT");
        return r.rows[0].r;
      };
      const [x, y] = await Promise.all([chamar(C), chamar(B)]);
      assert.deepEqual([x.ja_concluida, y.ja_concluida].sort(), [false, true]);
      assert.equal((await avisos(dev, "reembolso_liberado")).length, 1);
      const o = (
        await C.query(
          "SELECT valor_estornado FROM public.marketplace_orders WHERE id = $1",
          [orderId],
        )
      ).rows[0];
      assert.equal(Number(o.valor_estornado), 100);
    } finally {
      await B.end().catch(() => {});
      await C.query("ROLLBACK").catch(() => {});
      if (ids) {
        await C.query(
          "UPDATE public.devolucoes SET refund_id = NULL WHERE order_id = $1",
          [ids.orderId],
        ).catch(() => {});
        await C.query(
          "DELETE FROM public.notificacoes WHERE dados ->> 'devolucao_id' = $1",
          [ids.dev],
        ).catch(() => {});
        await C.query("DELETE FROM public.devolucoes WHERE order_id = $1", [
          ids.orderId,
        ]).catch(() => {});
        await C.query("DELETE FROM public.order_refunds WHERE order_id = $1", [
          ids.orderId,
        ]).catch(() => {});
        await C.query("DELETE FROM public.marketplace_orders WHERE id = $1", [
          ids.orderId,
        ]).catch(() => {});
        await C.query(
          "DELETE FROM public.profiles WHERE id = ANY($1::uuid[])",
          [Object.values(U)],
        ).catch(() => {});
        await C.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
          Object.values(U),
        ]).catch(() => {});
      }
    }
  },
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, rollback, pre-voo, conferencia, so o que devia mudar
// ---------------------------------------------------------------------------

/** O retrato do schema `public` (corpo, ACL, atributos de funcao; ACL de tabela; gatilhos) para comparar antes/depois. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.proacl::text AS acl, md5(p.prosrc) AS corpo, p.prosecdef,
              p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  const gatilhos = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, g.tgname, pg_get_triggerdef(g.oid) AS def, g.tgenabled
         FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT g.tgisinternal ORDER BY 1, 2`,
    )
  ).rows;
  return { funcoes, tabelas, gatilhos };
}
const porChave = (linhas, k) => new Map(linhas.map((l) => [l[k], l]));

prova(
  "MIGRATION: do ANTES (rollback) ao DEPOIS muda so o corpo do gatilho de aviso, 2 funcoes nascem e 1 gatilho novo — nenhuma tabela, nenhuma ACL de objeto que ja existia, nenhum outro corpo; o rollback devolve o prosrc IDENTICO e a ida e volta termina igual",
  () =>
    emTransacao(async () => {
      await C.query(ROLLBACK);
      const antes = await retratoDoSchema();
      assert.equal(await hashDe(FUNCOES.avisa.sig), H_ANTIGO);
      assert.equal(
        (
          await C.query(
            "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
            [FUNCOES.avisa.sig],
          )
        ).rows[0].prosrc,
        CORPO_ANTIGO,
        "byte a byte",
      );
      await C.query(MIGRATION);
      const depois = await retratoDoSchema();
      assert.deepEqual(
        depois.tabelas,
        antes.tabelas,
        "nenhuma tabela muda (nem a ACL)",
      );
      const fa = porChave(antes.funcoes, "f");
      const fd = porChave(depois.funcoes, "f");
      const novas = [...fd.keys()].filter((k) => !fa.has(k)).sort();
      assert.deepEqual(
        novas,
        [
          "devolucao__avisar_reembolso(uuid,text,text,text,text)",
          "devolucao_avisa_reembolso_liberado()",
        ].sort(),
      );
      assert.deepEqual(
        [...fa.keys()].filter((k) => !fd.has(k)),
        [],
        "nenhuma funcao some",
      );
      const mudaram = [...fa.keys()].filter(
        (k) => JSON.stringify(fa.get(k)) !== JSON.stringify(fd.get(k)),
      );
      assert.deepEqual(
        mudaram,
        ["devolucao_avisa_o_cliente()"],
        "so o gatilho de aviso muda de corpo",
      );
      // a ACL dele nao mudou (CREATE OR REPLACE)
      assert.equal(
        fa.get("devolucao_avisa_o_cliente()").acl,
        fd.get("devolucao_avisa_o_cliente()").acl,
      );
      const ga = new Set(antes.gatilhos.map((g) => `${g.t}|${g.tgname}`));
      const gd = depois.gatilhos
        .map((g) => `${g.t}|${g.tgname}`)
        .filter((g) => !ga.has(g));
      assert.deepEqual(gd, [
        "order_refunds|tr_order_refunds_avisa_reembolso_liberado",
      ]);
      // ida e volta: rollback devolve o retrato de antes, igual
      await C.query(ROLLBACK);
      assert.deepEqual(
        await retratoDoSchema(),
        antes,
        "rollback = estado de antes",
      );
      await C.query(MIGRATION);
      assert.deepEqual(
        await retratoDoSchema(),
        depois,
        "reaplicar = estado de depois",
      );
    }),
);

prova(
  "MIGRATION: reaplicar 2x e em CRLF = o mesmo estado (corpo, ACL, gatilho)",
  () =>
    emTransacao(async () => {
      const um = await retratoDoSchema();
      await C.query(MIGRATION);
      assert.deepEqual(await retratoDoSchema(), um, "reaplicar nao muda nada");
      await C.query(emCRLF(MIGRATION));
      const crlf = await retratoDoSchema();
      // o CRLF muda o texto do prosrc (so \r), nunca o md5 SEM \r: o estado funcional e o mesmo
      for (const f of Object.values(FUNCOES))
        assert.equal(
          await hashDe(f.sig),
          H[Object.keys(FUNCOES).find((k) => FUNCOES[k] === f)],
        );
      assert.deepEqual(
        crlf.funcoes.map((f) => [
          f.f,
          f.acl,
          f.prosecdef,
          f.provolatile,
          f.cfg,
        ]),
        um.funcoes.map((f) => [f.f, f.acl, f.prosecdef, f.provolatile, f.cfg]),
      );
      assert.deepEqual(crlf.gatilhos, um.gatilhos);
      assert.deepEqual(crlf.tabelas, um.tabelas);
    }),
);

prova(
  "MIGRATION: nenhum dado existente muda no apply nem no rollback (devolucoes, order_refunds, pedidos, avisos, trilha)",
  () =>
    emTransacao(async () => {
      const c = await cenario();
      await mudarLinha(c.refund, "falhou");
      const foto = async () =>
        (
          await C.query(
            `SELECT (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.devolucoes x) AS d,
                    (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.order_refunds x) AS r,
                    (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.marketplace_orders x) AS o,
                    (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.notificacoes x) AS n,
                    (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id)), '') FROM public.devolucao_eventos x) AS e`,
          )
        ).rows[0];
      const antes = await foto();
      await C.query(ROLLBACK);
      assert.deepEqual(await foto(), antes, "rollback nao toca dado");
      await C.query(MIGRATION);
      assert.deepEqual(await foto(), antes, "apply nao toca dado");
    }),
);

prova(
  "MIGRATION: o pre-voo RECUSA (B1_BASELINE_DIVERGENT) sem escrever: corpo desconhecido do gatilho, gatilho desligado, funcao nova com outro corpo, sobrecarga, coluna ausente",
  () =>
    emTransacao(async () => {
      const recusa = async (
        rotulo,
        preparar,
        regex = /B1_BASELINE_DIVERGENT/,
      ) => {
        await C.query("SAVEPOINT estado_ruim");
        try {
          await preparar();
          const antes = await retratoDoSchema();
          const e = await aplicar(MIGRATION);
          assert.ok(e, `${rotulo}: devia recusar`);
          assert.match(e.erro, regex, rotulo);
          assert.deepEqual(
            await retratoDoSchema(),
            antes,
            `${rotulo}: a recusa nao escreveu`,
          );
        } finally {
          await C.query("ROLLBACK TO SAVEPOINT estado_ruim");
        }
      };
      await recusa("corpo desconhecido do gatilho (1 byte)", () =>
        C.query(`CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
                 AS $x$ BEGIN RETURN NEW; END; $x$`),
      );
      await recusa("gatilho tr_devolucao_avisa_o_cliente desligado", () =>
        C.query(
          "ALTER TABLE public.devolucoes DISABLE TRIGGER tr_devolucao_avisa_o_cliente",
        ),
      );
      await recusa("gatilho tr_devolucao_avisa_o_cliente ausente", () =>
        C.query(
          "DROP TRIGGER tr_devolucao_avisa_o_cliente ON public.devolucoes",
        ),
      );
      await recusa("auxiliar com outro corpo", () =>
        C.query(`CREATE OR REPLACE FUNCTION public.devolucao__avisar_reembolso(p_devolucao_id uuid, p_evento text, p_tipo text,
                   p_titulo text, p_mensagem text) RETURNS boolean LANGUAGE sql AS $x$ SELECT true $x$`),
      );
      await recusa("sobrecarga da auxiliar", () =>
        C.query(
          "CREATE FUNCTION public.devolucao__avisar_reembolso(uuid) RETURNS int LANGUAGE sql AS $x$ SELECT 1 $x$",
        ),
      );
      await recusa("funcao do gatilho de order_refunds com outro corpo", () =>
        C.query(`CREATE OR REPLACE FUNCTION public.devolucao_avisa_reembolso_liberado() RETURNS trigger LANGUAGE plpgsql
                 AS $x$ BEGIN RETURN NEW; END; $x$`),
      );
      await recusa(
        "coluna que a funcao le ausente (devolucoes.reembolso_manual)",
        async () => {
          await C.query(
            "ALTER TABLE public.devolucoes DROP COLUMN reembolso_manual CASCADE",
          );
        },
      );
      await recusa("tabela ausente (notificacoes)", () =>
        C.query("ALTER TABLE public.notificacoes RENAME TO notificacoes_x"),
      );
      // antes de recusar por corpo, o estado ANTES conhecido APLICA (nao e um falso-positivo)
      await C.query(ROLLBACK);
      assert.equal(await aplicar(MIGRATION), null);
    }),
);

prova(
  "MIGRATION: a conferencia final RECUSA estado ruim — rodada sozinha sobre ACL aberta (anon, authenticated, PUBLIC), auxiliar executavel, gatilho desligado/sem WHEN, corpo trocado",
  () =>
    emTransacao(async () => {
      const i = MIGRATION.indexOf("DO $conferencia_20261225$");
      const conferencia = MIGRATION.slice(i);
      assert.equal(
        await aplicar(conferencia),
        null,
        "a conferencia passa no estado certo",
      );
      const ruim = async (rotulo, preparar, regex = /conferencia 20261225/) => {
        await C.query("SAVEPOINT estado_ruim");
        try {
          await preparar();
          const e = await aplicar(conferencia);
          assert.ok(e, `${rotulo}: devia recusar`);
          assert.match(e.erro, regex, rotulo);
        } finally {
          await C.query("ROLLBACK TO SAVEPOINT estado_ruim");
        }
      };
      await ruim("authenticated executa a funcao do gatilho", () =>
        C.query(
          `GRANT EXECUTE ON FUNCTION ${FUNCOES.liberado.sig} TO authenticated`,
        ),
      );
      await ruim("anon executa a auxiliar interna", () =>
        C.query(`GRANT EXECUTE ON FUNCTION ${FUNCOES.avisar.sig} TO anon`),
      );
      await ruim("PUBLIC executa a auxiliar interna", () =>
        C.query(`GRANT EXECUTE ON FUNCTION ${FUNCOES.avisar.sig} TO PUBLIC`),
      );
      await ruim("service_role executa a auxiliar interna", () =>
        C.query(
          `GRANT EXECUTE ON FUNCTION ${FUNCOES.avisar.sig} TO service_role`,
        ),
      );
      await ruim("gatilho de order_refunds desligado", () =>
        C.query(
          "ALTER TABLE public.order_refunds DISABLE TRIGGER tr_order_refunds_avisa_reembolso_liberado",
        ),
      );
      await ruim(
        "gatilho de order_refunds sem WHEN (dispara em toda mudanca)",
        async () => {
          await C.query(
            "DROP TRIGGER tr_order_refunds_avisa_reembolso_liberado ON public.order_refunds",
          );
          await C.query(`CREATE TRIGGER tr_order_refunds_avisa_reembolso_liberado AFTER UPDATE OF status ON public.order_refunds
                       FOR EACH ROW EXECUTE FUNCTION public.devolucao_avisa_reembolso_liberado()`);
        },
      );
      await ruim("corpo da funcao do gatilho trocado", () =>
        C.query(`CREATE OR REPLACE FUNCTION public.devolucao_avisa_reembolso_liberado() RETURNS trigger LANGUAGE plpgsql
                 SECURITY DEFINER SET search_path = public AS $x$ BEGIN RETURN NEW; END; $x$`),
      );
      await ruim("SECURITY INVOKER na funcao do gatilho", () =>
        C.query(`ALTER FUNCTION ${FUNCOES.liberado.sig} SECURITY INVOKER`),
      );
      await ruim("sem search_path na auxiliar", () =>
        C.query(`ALTER FUNCTION ${FUNCOES.avisar.sig} RESET search_path`),
      );
    }),
);

prova(
  "ARQUIVO: os hashes que o pre-voo, a conferencia e o rollback declaram sao os dos corpos que o arquivo carrega; o rollback tem o corpo antigo byte a byte",
  async () => {
    for (const k of Object.keys(FUNCOES)) {
      assert.ok(
        MIGRATION.split(H[k]).length - 1 >= 2,
        `${k}: o hash aparece no pre-voo e na conferencia`,
      );
    }
    assert.ok(MIGRATION.includes(H_ANTIGO));
    for (const k of ["avisa", "avisar", "liberado"])
      assert.ok(ROLLBACK.includes(H[k]), `rollback cita ${k}`);
    assert.ok(ROLLBACK.includes(H_ANTIGO));
    const a =
      ROLLBACK.indexOf("AS $rollback_avisa$") + "AS $rollback_avisa$".length;
    const corpoRollback = ROLLBACK.slice(
      a,
      ROLLBACK.indexOf("$rollback_avisa$;", a),
    );
    assert.equal(corpoRollback, CORPO_ANTIGO, "byte a byte");
    assert.ok(
      !/^\s*(BEGIN|COMMIT)\s*;/im.test(MIGRATION),
      "sem BEGIN/COMMIT de nivel superior",
    );
    assert.ok(
      !/^\s*(BEGIN|COMMIT)\s*;/im.test(ROLLBACK),
      "rollback sem BEGIN/COMMIT de nivel superior",
    );
  },
);

// ---------------------------------------------------------------------------
// MUTANTES: o comportamento esperado, sobre corpos sabotados, FICA VERMELHO
// ---------------------------------------------------------------------------

/** Aplica o `CREATE OR REPLACE` de uma funcao com UMA troca de texto (que tem de existir) e roda o comportamento. */
async function mutante(rotulo, tagDaFuncao, de, para, comportamento) {
  await C.query("BEGIN");
  try {
    await C.query(MIGRATION);
    let sql = statementDe(tagDaFuncao);
    assert.ok(
      sql.includes(de),
      `${rotulo}: o texto a sabotar nao existe (${de.slice(0, 40)})`,
    );
    sql = sql.replace(de, para);
    assert.notEqual(sql, statementDe(tagDaFuncao));
    await C.query(sql);
    let passou = true;
    try {
      await comportamento();
    } catch {
      passou = false;
    }
    assert.equal(passou, false, `MUTANTE SOBREVIVEU: ${rotulo}`);
  } finally {
    await C.query("ROLLBACK");
  }
}

const comportamentoDoAvisoDeConclusao = async () => {
  const c = await cenario();
  const a = await avisos(c.dev);
  assert.ok(!promete(a[0].mensagem));
};
const comportamentoDoLiberadoUmaVez = async () => {
  const c = await cenario();
  await concluirEstorno(c.refund);
  await concluirEstorno(c.refund);
  // a linha sai e volta a 'concluido' (a consulta que acha de novo): o gatilho dispara outra vez; so a auxiliar segura
  await mudarLinha(c.refund, "falhou");
  await mudarLinha(c.refund, "concluido");
  assert.equal((await avisos(c.dev, "reembolso_liberado")).length, 1);
};

prova("MUTANTES: cada guarda tirada deixa a prova vermelha", async () => {
  const roteiro = [
    [
      "o aviso da conclusao promete 'liberado' (o defeito)",
      "avisa_o_cliente",
      "WHEN 'solicitado', 'em_processamento' THEN\n            v_evento := 'reembolso_em_processamento';\n            v_tipo := 'info';\n            v_msg := 'A loja concluiu a devolução ' || NEW.protocolo || '. O reembolso está em processamento no Mercado Pago; você recebe um novo aviso quando ele for liberado.';",
      "WHEN 'solicitado', 'em_processamento' THEN\n            v_evento := 'reembolso_liberado';\n            v_msg := 'O reembolso da devolução ' || NEW.protocolo || ' foi liberado pelo Mercado Pago.';",
      comportamentoDoAvisoDeConclusao,
    ],
    [
      "a linha 'falhou' diz 'liberado'",
      "avisa_o_cliente",
      "v_evento := 'reembolso_nao_liberado';\n            v_tipo := 'warning';\n            v_msg := 'A loja concluiu a devolução ' || NEW.protocolo || ', mas o reembolso ainda não foi liberado. A loja está resolvendo e vai falar com você.';",
      "v_evento := 'reembolso_liberado';\n            v_msg := 'O reembolso da devolução ' || NEW.protocolo || ' foi liberado pelo Mercado Pago.';",
      async () => {
        const c = await cenario();
        await mudarLinha(c.refund, "falhou");
        // a conclusao ja aconteceu; remonta a devolucao como 'recebida' e conclui com a linha ruim
        await C.query(
          "UPDATE public.devolucoes SET status = 'recebida', resolucao_final = NULL WHERE id = $1",
          [c.dev],
        );
        await C.query(
          "DELETE FROM public.notificacoes WHERE dados ->> 'devolucao_id' = $1",
          [c.dev],
        );
        await C.query(
          "UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'reembolso' WHERE id = $1",
          [c.dev],
        );
        const a = await avisos(c.dev);
        assert.ok(!promete(a[0].mensagem));
      },
    ],
    [
      "o gatilho de order_refunds avisa em toda virada de status, nao so na de 'concluido'",
      "avisa_liberado",
      "IF NEW.status IS DISTINCT FROM 'concluido' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN\n    RETURN NEW;\n  END IF;",
      "IF OLD.status IS NOT DISTINCT FROM NEW.status THEN\n    RETURN NEW;\n  END IF;",
      async () => {
        // o WHEN do CREATE TRIGGER ja filtra; aqui o corpo e testado direto pela chamada de um UPDATE que o WHEN deixaria passar
        const c = await cenario();
        // recria o gatilho SEM o WHEN para que a guarda do CORPO seja a unica defesa
        await C.query(
          "DROP TRIGGER tr_order_refunds_avisa_reembolso_liberado ON public.order_refunds",
        );
        await C.query(`CREATE TRIGGER tr_order_refunds_avisa_reembolso_liberado AFTER UPDATE OF status ON public.order_refunds
                       FOR EACH ROW EXECUTE FUNCTION public.devolucao_avisa_reembolso_liberado()`);
        await mudarLinha(c.refund, "em_processamento");
        assert.equal(
          (await avisos(c.dev, "reembolso_liberado")).length,
          0,
          "so a virada para concluido avisa",
        );
      },
    ],
    [
      "a auxiliar nao deduplica (o aviso dobra)",
      "avisar_reembolso",
      "    IF EXISTS (\n      SELECT 1 FROM public.notificacoes n\n       WHERE n.usuario_id = v_d.user_id\n         AND n.dados ->> 'devolucao_id' = p_devolucao_id::text\n         AND n.dados ->> 'evento' = p_evento\n    ) THEN\n      RETURN false;\n    END IF;\n",
      "",
      comportamentoDoLiberadoUmaVez,
    ],
  ];
  for (const [rotulo, tag, de, para, comp] of roteiro) {
    await mutante(rotulo, tag, de, para, async () => {
      await comp();
    });
  }
  // o mutante de ACL: EXECUTE da auxiliar interna para authenticated (a prova "a auxiliar e interna" exige 42501)
  await C.query("BEGIN");
  try {
    await C.query(MIGRATION);
    await C.query(
      `GRANT EXECUTE ON FUNCTION ${FUNCOES.avisar.sig} TO authenticated`,
    );
    const c = await cenario();
    const r = await tentar(
      "authenticated",
      "SELECT public.devolucao__avisar_reembolso($1::uuid, 'x', 'info', 't', 'm') AS r",
      [c.dev],
      { uid: U.admin, claims: JWT_ADMIN },
    );
    assert.notEqual(
      r.codigo,
      "42501",
      "MUTANTE SOBREVIVEU: com o GRANT o authenticated deveria chegar ao corpo",
    );
  } finally {
    await C.query("ROLLBACK");
  }
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${String(e.stack || e.message)
            .split("\n")
            .join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do reembolso da devolucao falharam.`,
    );
  }
  console.log(
    `\n[reembolso-da-devolucao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));

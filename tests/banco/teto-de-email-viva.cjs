"use strict";

/**
 * Prova VIVA da migration 20261217000000 (o e-mail da loja tem teto e o codigo do convidado nao se
 * queima; auditoria de 12/10/2026, lote L1: R1, R2, R3), num Postgres EFEMERO local, sem rede.
 *
 * Cada caso roda numa transacao que termina em ROLLBACK (o da corrida usa duas conexoes reais,
 * grava de verdade e limpa o que gravou). O banco e' o clone do rodar-isolado.cjs: a arvore
 * inteira migrada, com a 20261217000000 aplicada.
 *
 *  FLUXO      o caminho legitimo continua igual: trio -> codigo -> codigo certo -> o pedido (pela v2
 *             com o trio, e pela v1 com e-mail + codigo); o comprovante sai uma vez por pedido.
 *  CODIGO     teto por PEDIDO (5), por DESTINATARIO (10, normalizado: +apelido, pontos do Gmail,
 *             googlemail) e da LOJA (60) em 24 h que andam; estourou = ERRO generico sem e-mail na
 *             mensagem e nada gravado; a janela de 60 s continua respondendo muito_recente; pedido que
 *             nao confere nao gasta vaga; falha do contador fecha.
 *  COMPROVANTE teto da loja (120, contador SO dele) e o do destinatario (o mesmo do codigo); sem vaga =
 *             false e o pedido sem marca; pedido pago fura; reserva repetida nao gasta; a vaga de um
 *             contador volta quando o outro recusa; falha do contador abre.
 *  CORRIDA    duas reservas ao mesmo tempo na ultima vaga: a segunda espera a trava e e' recusada.
 *  RASTREIO   v2: so conta tentativa quando o trio confere, e sem o trio a resposta e a mesma; um codigo de outro
 *             pedido com o mesmo e-mail nao atrapalha o do cliente; o limite de 5 continua para quem tem o
 *             trio. v1: a mesma de antes, sem `restantes`.
 *  MIGRATION  reaplicar e' o mesmo estado; o pre-voo (e o do rollback) recusa corpo desconhecido; o
 *             rollback devolve os tres corpos de antes (md5) e, com eles, os defeitos voltam (CONTROLE);
 *             privilegios das pecas novas.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/teto-de-email-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const ARQ =
  "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql";
const lerSeExiste = (nome) => {
  const p = path.join(MIGRATIONS, nome);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};
const MIGRATION = lerSeExiste(ARQ);
const ROLLBACK = lerSeExiste(`rollback-manual-${ARQ}`);

// md5(replace(prosrc, E'\r', '')) dos corpos VIGENTES antes da 20261217000000 (20260820000000,
// 20260821000000 e 20261181000000) -- os mesmos do pre-voo da migration.
const CORPOS_DE_ANTES = {
  "public.generate_order_otp_v2(text,text,text)":
    "8fab5091db4a380bf07592f7dc896856",
  "public.reivindicar_email_de_confirmacao(uuid)":
    "45be19bf714f266f8234f11df820b76b",
  "public.get_orders_by_otp_v1(text,text)": "b472f00d6b36002522b25bf04113a035",
};
const NOVAS = [
  "public.get_orders_by_otp_v2(text,text,text,text)",
  "public.reservar_vaga_de_email(text,integer)",
  "public.chave_do_destinatario(text)",
];

const SQL_GERAR = "SELECT public.generate_order_otp_v2($1, $2, $3) AS r";
const SQL_V1 = "SELECT public.get_orders_by_otp_v1($1, $2) AS r";
const SQL_V2 = "SELECT public.get_orders_by_otp_v2($1, $2, $3, $4) AS r";
const SQL_RESERVAR =
  "SELECT public.reivindicar_email_de_confirmacao($1::uuid) AS r";
const SQL_LIBERAR = "SELECT public.liberar_email_de_confirmacao($1::uuid)";
const TETO = /teto de envio de codigo atingido/;

let C;

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita. */
async function emTransacao(fn) {
  await C.query("BEGIN");
  try {
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel` e devolve a 1a linha. */
async function como(papel, sql, params = [], conexao = C) {
  await conexao.query(`SET LOCAL ROLE ${papel}`);
  const r = await conexao.query(sql, params);
  await conexao.query("RESET ROLE");
  return r.rows[0];
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linha} ou {erro, codigo}. */
async function tentar(papel, sql, params = []) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linha = await como(papel, sql, params);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linha };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

let seq = 0;
const novoId = () => {
  seq += 1;
  return `7e7e0000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/** Pedido de convidado com o e-mail e o WhatsApp que a pessoa digitou no checkout. */
async function pedido({
  email,
  fone,
  id,
  userId = null,
  pago = false,
  conexao = C,
}) {
  const orderId = id || novoId();
  await conexao.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_phone, customer_data, total, subtotal, payment_status)
     VALUES ($1, $2, 'Convidado Sintetico', $3, $4::jsonb, 100, 100, $5)`,
    [
      orderId,
      userId,
      fone,
      JSON.stringify(email === undefined ? {} : { email, whatsapp: fone }),
      pago ? "pago" : "aguardando",
    ],
  );
  return orderId;
}

const fragmento = (orderId) => orderId.slice(-6);
const gerar = (email, fone, orderId, conexao = C) =>
  como("service_role", SQL_GERAR, [email, fone, fragmento(orderId)], conexao);
const tentarGerar = (email, fone, orderId) =>
  tentar("service_role", SQL_GERAR, [email, fone, fragmento(orderId)]);
const reivindicar = async (orderId) =>
  (await como("service_role", SQL_RESERVAR, [orderId])).r;

/** A janela de 60 s do pedido fica para tras (o tempo passa). */
const passarUmMinuto = (orderId) =>
  C.query(
    "UPDATE public.otp_verifications SET created_at = created_at - interval '2 minutes' WHERE order_id = $1",
    [orderId],
  );

const chave = async (email) =>
  (await C.query("SELECT public.chave_do_destinatario($1) AS h", [email]))
    .rows[0].h;

/** Vagas ja gastas numa chave, numa hora anterior da janela (o que outra pessoa gastou antes). */
async function gasto(chaveDoContador, n, haQuanto = "2 hours") {
  await C.query(
    `INSERT INTO public.email_da_loja_contadores (chave, hora, n)
     VALUES ($1, date_trunc('hour', now() - $2::interval), $3)`,
    [chaveDoContador, haQuanto, n],
  );
}

const somaDe = async (chaveDoContador) =>
  Number(
    (
      await C.query(
        "SELECT coalesce(sum(n), 0) AS n FROM public.email_da_loja_contadores WHERE chave = $1",
        [chaveDoContador],
      )
    ).rows[0].n,
  );
const totalDeContadores = async () =>
  Number(
    (
      await C.query(
        "SELECT coalesce(sum(n), 0) AS n FROM public.email_da_loja_contadores",
      )
    ).rows[0].n,
  );
const codigosDoPedido = async (orderId) =>
  (
    await C.query(
      "SELECT count(*)::int AS n FROM public.otp_verifications WHERE order_id = $1",
      [orderId],
    )
  ).rows[0].n;
const reservadoEm = async (orderId) =>
  (
    await C.query(
      "SELECT confirmation_email_sent_at AS em FROM public.marketplace_orders WHERE id = $1",
      [orderId],
    )
  ).rows[0].em;
const md5DoCorpo = async (assinatura) => {
  const r = await C.query(
    "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
    [assinatura],
  );
  return r.rows[0] ? r.rows[0].h : null;
};

function exigirArquivos() {
  assert.ok(MIGRATION, `migration ausente: ${ARQ}`);
  assert.ok(ROLLBACK, `rollback-manual ausente: rollback-manual-${ARQ}`);
}

// ---------------------------------------------------------------------------
// FLUXO LEGITIMO (o bem maior: tem de continuar identico)
// ---------------------------------------------------------------------------

prova(
  "FLUXO: trio -> codigo -> v2 com o trio e o codigo certo -> o pedido",
  () =>
    emTransacao(async () => {
      const email = "fluxo@teste.invalid";
      const fone = "11988880001";
      const id = await pedido({ email, fone });
      const g = (await gerar(email, "(11) 98888-0001", id)).r;
      assert.equal(g.ok, true, JSON.stringify(g));
      assert.match(g.otp_code, /^\d{6}$/);
      const v = (
        await como("anon", SQL_V2, [
          email,
          "(11) 98888-0001",
          fragmento(id),
          g.otp_code,
        ])
      ).r;
      assert.equal(v.ok, true, JSON.stringify(v));
      assert.equal(v.orders.length, 1);
      assert.equal(v.orders[0].id, id);
      const deNovo = (
        await como("anon", SQL_V2, [email, fone, fragmento(id), g.otp_code])
      ).r;
      assert.equal(deNovo.ok, false, "o mesmo codigo nao serve duas vezes");
    }),
);

prova(
  "FLUXO: v2 aceita o e-mail com maiuscula/espaco, o WhatsApp so com digitos e o fragmento maiusculo",
  () =>
    emTransacao(async () => {
      const email = "mascara@teste.invalid";
      const id = await pedido({ email, fone: "(11) 98888-0002" });
      const g = (await gerar(email, "11988880002", id)).r;
      assert.equal(g.ok, true, JSON.stringify(g));
      const v = (
        await como("anon", SQL_V2, [
          "  Mascara@Teste.Invalid ",
          "11988880002",
          fragmento(id).toUpperCase(),
          g.otp_code,
        ])
      ).r;
      assert.equal(v.ok, true, JSON.stringify(v));
    }),
);

prova("FLUXO: a v1 (e-mail + codigo) continua funcionando como antes", () =>
  emTransacao(async () => {
    const email = "v1@teste.invalid";
    const id = await pedido({ email, fone: "11988880003" });
    const g = (await gerar(email, "11988880003", id)).r;
    const errou = (
      await como("anon", SQL_V1, [
        email,
        g.otp_code === "000000" ? "000001" : "000000",
      ])
    ).r;
    assert.deepEqual(errou, {
      ok: false,
      error: "Código inválido ou expirado.",
    });
    const v = (await como("anon", SQL_V1, [email, g.otp_code])).r;
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.orders[0].id, id);
  }),
);

prova(
  "FLUXO: o comprovante sai uma vez por pedido; liberado, pode sair de novo; pedido inexistente = false",
  () =>
    emTransacao(async () => {
      const id = await pedido({
        email: "comprovante@teste.invalid",
        fone: "11988880004",
      });
      assert.equal(await reivindicar(id), true);
      assert.ok(await reservadoEm(id));
      assert.equal(await reivindicar(id), false);
      await como("service_role", SQL_LIBERAR, [id]);
      assert.equal(await reservadoEm(id), null);
      assert.equal(await reivindicar(id), true);
      assert.equal(
        await reivindicar("7e7e0000-0000-4000-8000-ffffffffffff"),
        false,
      );
    }),
);

prova("FLUXO: pedido sem e-mail no pedido conta no destinatario da CONTA", () =>
  emTransacao(async () => {
    const uid = "7e7e0000-0000-4000-9000-000000000001";
    await C.query(
      "INSERT INTO auth.users (id, email) VALUES ($1, 'conta@teste.invalid')",
      [uid],
    );
    const id = await pedido({
      email: undefined,
      fone: "11988880005",
      userId: uid,
    });
    assert.equal(await reivindicar(id), true);
    assert.equal(
      await somaDe(`destinatario:${await chave("conta@teste.invalid")}`),
      1,
    );
    assert.equal(await somaDe("comprovante:loja"), 1);
  }),
);

// ---------------------------------------------------------------------------
// CODIGO: os tetos
// ---------------------------------------------------------------------------

prova(
  "CODIGO: a chave do destinatario junta +apelido, pontos do Gmail e googlemail; outros dominios mantem os pontos",
  () =>
    emTransacao(async () => {
      const a = await chave("A.B+x@GMAIL.com");
      assert.equal(await chave("ab@gmail.com"), a);
      assert.equal(await chave("ab@googlemail.com"), a);
      assert.equal(await chave("  ab+loja@gmail.com "), a);
      assert.notEqual(
        await chave("a.b@exemplo.test"),
        await chave("ab@exemplo.test"),
      );
      assert.equal(
        await chave("a.b+x@exemplo.test"),
        await chave("A.B@Exemplo.Test"),
      );
      assert.match(a, /^[0-9a-f]{64}$/);
    }),
);

prova(
  "CODIGO: a janela de 60 s continua respondendo muito_recente (e nao gasta vaga)",
  () =>
    emTransacao(async () => {
      const email = "janela60@teste.invalid";
      const id = await pedido({ email, fone: "11977770001" });
      assert.equal((await gerar(email, "11977770001", id)).r.ok, true);
      const antes = await totalDeContadores();
      const r = (await gerar(email, "11977770001", id)).r;
      assert.equal(r.ok, false);
      assert.equal(r.motivo, "muito_recente");
      assert.equal(await totalDeContadores(), antes);
    }),
);

prova(
  "CODIGO: o 6o codigo do MESMO pedido no dia da' erro generico e nada e' gravado",
  () =>
    emTransacao(async () => {
      const email = "pedido.teto@teste.invalid";
      const fone = "11977770002";
      const id = await pedido({ email, fone });
      for (let i = 1; i <= 5; i++) {
        const g = (await gerar(email, fone, id)).r;
        assert.equal(g.ok, true, `codigo ${i}: ${JSON.stringify(g)}`);
        await passarUmMinuto(id);
      }
      const antes = await totalDeContadores();
      const t = await tentarGerar(email, fone, id);
      assert.ok(t.erro, `o 6o passou: ${JSON.stringify(t.linha)}`);
      assert.match(t.erro, TETO);
      assert.ok(
        !t.erro.includes(email) && !t.erro.includes(id),
        "a mensagem leva e-mail ou pedido",
      );
      assert.equal(await codigosDoPedido(id), 5, "o 6o codigo nao foi gravado");
      assert.equal(
        await totalDeContadores(),
        antes,
        "o erro desfaz as vagas desta chamada",
      );
    }),
);

prova(
  "CODIGO: o 11o e-mail para o MESMO destinatario (escrito de jeitos diferentes) da' erro",
  () =>
    emTransacao(async () => {
      const jeitos = [
        "A.B+x@GMAIL.com",
        "ab@gmail.com",
        "ab@googlemail.com",
        "a.b@gmail.com",
        "AB+loja@gmail.com",
      ];
      for (let i = 1; i <= 10; i++) {
        const email = jeitos[i % jeitos.length];
        const fone = `119666600${String(i).padStart(2, "0")}`;
        const id = await pedido({ email: email.toLowerCase(), fone });
        const g = (await gerar(email, fone, id)).r;
        assert.equal(g.ok, true, `envio ${i}: ${JSON.stringify(g)}`);
      }
      const id11 = await pedido({ email: "ab@gmail.com", fone: "11966660011" });
      const t = await tentarGerar("ab@gmail.com", "11966660011", id11);
      assert.match(String(t.erro), TETO);
      // outro destinatario segue recebendo
      const outro = await pedido({
        email: "outra@teste.invalid",
        fone: "11966660012",
      });
      assert.equal(
        (await gerar("outra@teste.invalid", "11966660012", outro)).r.ok,
        true,
      );
    }),
);

prova(
  "CODIGO: a loja inteira para em 60 codigos nas ultimas 24 h; o contador do comprovante nao conta",
  () =>
    emTransacao(async () => {
      await gasto("codigo:loja", 59, "20 hours");
      await gasto("comprovante:loja", 500, "3 hours");
      const a = await pedido({ email: "a@teste.invalid", fone: "11955550001" });
      assert.equal(
        (await gerar("a@teste.invalid", "11955550001", a)).r.ok,
        true,
        "o 60o passa",
      );
      const b = await pedido({ email: "b@teste.invalid", fone: "11955550002" });
      assert.match(
        String((await tentarGerar("b@teste.invalid", "11955550002", b)).erro),
        TETO,
      );
    }),
);

prova("CODIGO: vagas de mais de 24 h nao contam (a janela anda)", () =>
  emTransacao(async () => {
    const email = "janela@teste.invalid";
    await gasto(`destinatario:${await chave(email)}`, 50, "25 hours");
    await gasto("codigo:loja", 500, "26 hours");
    const id = await pedido({ email, fone: "11944440001" });
    assert.equal((await gerar(email, "11944440001", id)).r.ok, true);
  }),
);

prova("CODIGO: pedido que NAO confere nao gasta vaga nenhuma", () =>
  emTransacao(async () => {
    const id = await pedido({
      email: "confere@teste.invalid",
      fone: "11944440002",
    });
    for (const [e, f, frag] of [
      ["confere@teste.invalid", "11900000000", fragmento(id)],
      ["outro@teste.invalid", "11944440002", fragmento(id)],
      ["confere@teste.invalid", "11944440002", "abcdef"],
      ["confere@teste.invalid", "11944440002", "%%%%%%"],
    ]) {
      const r = (await como("service_role", SQL_GERAR, [e, f, frag])).r;
      assert.equal(r.motivo, "nao_confere", JSON.stringify(r));
    }
    assert.equal(await totalDeContadores(), 0);
  }),
);

prova("CODIGO: falha do contador FECHA (erro, nenhum codigo gravado)", () =>
  emTransacao(async () => {
    const email = "contador.fora@teste.invalid";
    const id = await pedido({ email, fone: "11944440003" });
    await C.query(
      "ALTER TABLE public.email_da_loja_contadores RENAME TO email_da_loja_contadores_fora",
    );
    const t = await tentarGerar(email, "11944440003", id);
    assert.ok(t.erro, "gerou codigo sem contador");
    assert.equal(await codigosDoPedido(id), 0);
  }),
);

// ---------------------------------------------------------------------------
// COMPROVANTE: os tetos
// ---------------------------------------------------------------------------

prova(
  "COMPROVANTE: a loja para em 120; o pedido fica sem marca e pode receber quando a vaga voltar; o codigo segue",
  () =>
    emTransacao(async () => {
      await gasto("comprovante:loja", 120, "5 hours");
      const id = await pedido({
        email: "comp@teste.invalid",
        fone: "11933330001",
      });
      assert.equal(await reivindicar(id), false);
      assert.equal(await reservadoEm(id), null);
      assert.equal(
        await somaDe(`destinatario:${await chave("comp@teste.invalid")}`),
        0,
        "a vaga do destinatario voltou",
      );
      const outro = await pedido({
        email: "cod@teste.invalid",
        fone: "11933330002",
      });
      assert.equal(
        (await gerar("cod@teste.invalid", "11933330002", outro)).r.ok,
        true,
        "o codigo tem contador proprio",
      );
      await C.query(
        "UPDATE public.email_da_loja_contadores SET hora = hora - interval '1 day' WHERE chave = 'comprovante:loja'",
      );
      assert.equal(await reivindicar(id), true);
    }),
);

prova("COMPROVANTE: pedido PAGO fura o teto (conta, mas nao e' recusado)", () =>
  emTransacao(async () => {
    await gasto("comprovante:loja", 120, "5 hours");
    const email = "pago@teste.invalid";
    await gasto(`destinatario:${await chave(email)}`, 10, "1 hour");
    const id = await pedido({ email, fone: "11933330003", pago: true });
    assert.equal(await reivindicar(id), true);
    assert.equal(await somaDe("comprovante:loja"), 121);
  }),
);

prova(
  "COMPROVANTE: o destinatario e' o MESMO contador do codigo (10 somados)",
  () =>
    emTransacao(async () => {
      const email = "alvo.comprovante@teste.invalid";
      for (let i = 1; i <= 10; i++) {
        const id = await pedido({
          email,
          fone: `119222200${String(i).padStart(2, "0")}`,
        });
        assert.equal(await reivindicar(id), true, `pedido ${i}`);
      }
      const id11 = await pedido({ email, fone: "11922220011" });
      assert.equal(await reivindicar(id11), false);
      assert.equal(await reservadoEm(id11), null);
      assert.match(
        String((await tentarGerar(email, "11922220011", id11)).erro),
        TETO,
      );
      const outro = await pedido({
        email: "outro.comp@teste.invalid",
        fone: "11922220012",
      });
      assert.equal(await reivindicar(outro), true);
    }),
);

prova(
  "COMPROVANTE: chamada repetida de pedido ja reservado nao gasta vaga",
  () =>
    emTransacao(async () => {
      const id = await pedido({
        email: "uma.vez@teste.invalid",
        fone: "11911110001",
      });
      assert.equal(await reivindicar(id), true);
      for (let i = 0; i < 5; i++) assert.equal(await reivindicar(id), false);
      assert.equal(await somaDe("comprovante:loja"), 1);
    }),
);

prova(
  "COMPROVANTE: falha do contador ABRE (o comprovante sai), ao contrario do codigo",
  () =>
    emTransacao(async () => {
      const id = await pedido({
        email: "abre@teste.invalid",
        fone: "11911110002",
      });
      await C.query(
        "ALTER TABLE public.email_da_loja_contadores RENAME TO email_da_loja_contadores_fora",
      );
      assert.equal(await reivindicar(id), true);
      assert.ok(await reservadoEm(id));
    }),
);

// ---------------------------------------------------------------------------
// CORRIDA na ultima vaga (duas conexoes reais)
// ---------------------------------------------------------------------------

prova(
  "CORRIDA: duas reservas ao mesmo tempo na ultima vaga da loja: a segunda espera e e' recusada",
  async () => {
    const url = lerDatabaseUrlEfemera();
    const C2 = new Client({ connectionString: url });
    const C3 = new Client({ connectionString: url });
    await C2.connect();
    await C3.connect();
    const ids = [];
    try {
      // fixtures COMMITADAS (as duas conexoes precisam enxergar)
      await gasto("codigo:loja", 59, "3 hours");
      await C.query(
        "UPDATE public.email_da_loja_contadores SET hora = date_trunc('hour', now()) WHERE chave = 'codigo:loja'",
      );
      ids.push(
        await pedido({ email: "corrida1@teste.invalid", fone: "11900000001" }),
      );
      ids.push(
        await pedido({ email: "corrida2@teste.invalid", fone: "11900000002" }),
      );

      await C.query("BEGIN");
      const r1 = (await gerar("corrida1@teste.invalid", "11900000001", ids[0]))
        .r;
      assert.equal(r1.ok, true, "a primeira pega a ultima vaga");
      await C2.query("BEGIN");
      const pid2 = (await C2.query("SELECT pg_backend_pid() AS p")).rows[0].p;
      const segunda = gerar(
        "corrida2@teste.invalid",
        "11900000002",
        ids[1],
        C2,
      ).then(
        (x) => ({ linha: x }),
        (e) => ({ erro: e.message }),
      );
      let esperando = false;
      for (let i = 0; i < 100 && !esperando; i++) {
        const w = await C3.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
          [pid2],
        );
        esperando = w.rows[0] && w.rows[0].wait_event_type === "Lock";
        if (!esperando) await new Promise((ok) => setTimeout(ok, 30));
      }
      assert.ok(
        esperando,
        "a segunda reserva nao parou na trava da linha do contador",
      );
      await C.query("COMMIT");
      const r2 = await segunda;
      await C2.query("ROLLBACK");
      assert.ok(r2.erro, `as duas passaram: ${JSON.stringify(r2.linha)}`);
      assert.match(r2.erro, TETO);
      const n = await somaDe("codigo:loja");
      assert.equal(n, 60, "o contador passou do teto");
    } finally {
      await C.query("ROLLBACK").catch(() => {});
      await C2.query("ROLLBACK").catch(() => {});
      await C.query(
        "DELETE FROM public.otp_verifications WHERE order_id = ANY($1::uuid[])",
        [ids],
      );
      await C.query(
        "DELETE FROM public.marketplace_orders WHERE id = ANY($1::uuid[])",
        [ids],
      );
      await C.query("DELETE FROM public.email_da_loja_contadores").catch(
        () => {},
      );
      await C2.end().catch(() => {});
      await C3.end().catch(() => {});
    }
  },
);

// ---------------------------------------------------------------------------
// RASTREIO: v2 amarrada ao trio; v1 sem `restantes`
// ---------------------------------------------------------------------------

async function codigoDoCliente(email, fone) {
  const id = await pedido({ email, fone });
  const g = (await gerar(email, fone, id)).r;
  assert.equal(g.ok, true, JSON.stringify(g));
  return { id, codigo: g.otp_code };
}
const errado = (codigo) => (codigo === "000000" ? "000001" : "000000");
const tentativasDe = async (orderId) =>
  (
    await C.query(
      "SELECT max(attempts) AS n FROM public.otp_verifications WHERE order_id = $1",
      [orderId],
    )
  ).rows[0].n;

prova(
  "RASTREIO v2: tentativa sem o trio que confere nao conta; o cliente entra com o codigo certo",
  () =>
    emTransacao(async () => {
      const email = "cliente.a1@teste.invalid";
      const fone = "11987650001";
      const { id, codigo } = await codigoDoCliente(email, fone);
      for (let i = 0; i < 10; i++) {
        const r = (
          await como("anon", SQL_V2, [
            email,
            "11900000000",
            "abcdef",
            errado(codigo),
          ])
        ).r;
        assert.equal(r.ok, false);
      }
      assert.equal(
        await tentativasDe(id),
        0,
        "tentativa sem o trio foi contada",
      );
      const v = (
        await como("anon", SQL_V2, [email, fone, fragmento(id), codigo])
      ).r;
      assert.equal(v.ok, true, JSON.stringify(v));
    }),
);

prova(
  "RASTREIO v2: sem o trio, a resposta e' a MESMA com e sem codigo ativo",
  () =>
    emTransacao(async () => {
      const email = "tem.codigo@teste.invalid";
      const { codigo } = await codigoDoCliente(email, "11987650002");
      const comCodigo = (
        await como("anon", SQL_V2, [
          email,
          "11900000000",
          "abcdef",
          errado(codigo),
        ])
      ).r;
      const semCodigo = (
        await como("anon", SQL_V2, [
          "nao.tem@teste.invalid",
          "11900000000",
          "abcdef",
          "123456",
        ])
      ).r;
      const fragInvalido = (
        await como("anon", SQL_V2, [email, "11987650002", "%%%%%%", codigo])
      ).r;
      assert.deepEqual(comCodigo, semCodigo);
      assert.deepEqual(fragInvalido, semCodigo);
      assert.deepEqual(semCodigo, {
        ok: false,
        error: "Código inválido ou expirado.",
      });
    }),
);

prova(
  "RASTREIO v2: com o trio, o limite de 5 continua (o 6o, mesmo certo, nao entra)",
  () =>
    emTransacao(async () => {
      const email = "chute@teste.invalid";
      const fone = "11987650003";
      const { id, codigo } = await codigoDoCliente(email, fone);
      const r1 = (
        await como("anon", SQL_V2, [email, fone, fragmento(id), errado(codigo)])
      ).r;
      assert.equal(r1.restantes, 4);
      for (let i = 0; i < 4; i++)
        await como("anon", SQL_V2, [
          email,
          fone,
          fragmento(id),
          errado(codigo),
        ]);
      const v = (
        await como("anon", SQL_V2, [email, fone, fragmento(id), codigo])
      ).r;
      assert.equal(v.ok, false);
      assert.match(v.error, /bloqueado/);
    }),
);

prova(
  "RASTREIO v2: um codigo mais novo de OUTRO pedido com o mesmo e-mail nao atrapalha o do cliente",
  () =>
    emTransacao(async () => {
      const email = "sombra@teste.invalid";
      const fone = "11987650005";
      const { id, codigo } = await codigoDoCliente(email, fone);
      const idDeOutroPedido = await pedido({ email, fone: "11900009999" });
      assert.equal(
        (await gerar(email, "11900009999", idDeOutroPedido)).r.ok,
        true,
      );
      const v = (
        await como("anon", SQL_V2, [email, fone, fragmento(id), codigo])
      ).r;
      assert.equal(v.ok, true, JSON.stringify(v));
      assert.equal(v.orders[0].id, id);
    }),
);

prova(
  "RASTREIO v1: a falha nao traz mais `restantes`; o bloqueio de 5 continua como antes",
  () =>
    emTransacao(async () => {
      const email = "v1.restantes@teste.invalid";
      const { codigo } = await codigoDoCliente(email, "11987650006");
      const r = (await como("anon", SQL_V1, [email, errado(codigo)])).r;
      assert.equal("restantes" in r, false, JSON.stringify(r));
      for (let i = 0; i < 4; i++)
        await como("anon", SQL_V1, [email, errado(codigo)]);
      const v = (await como("anon", SQL_V1, [email, codigo])).r;
      assert.equal(v.ok, false);
    }),
);

// ---------------------------------------------------------------------------
// A MIGRATION: idempotencia, pre-voo, rollback (CONTROLE) e privilegios
// ---------------------------------------------------------------------------

prova(
  "MIGRATION: reaplicar (2x) deixa os mesmos corpos e o fluxo continua",
  () =>
    emTransacao(async () => {
      exigirArquivos();
      const antes = new Map();
      for (const a of [...Object.keys(CORPOS_DE_ANTES), ...NOVAS])
        antes.set(a, await md5DoCorpo(a));
      await C.query(MIGRATION);
      await C.query(MIGRATION);
      for (const [a, h] of antes) assert.equal(await md5DoCorpo(a), h, a);
      const id = await pedido({
        email: "reaplicar@teste.invalid",
        fone: "11955559999",
      });
      assert.equal(
        (await gerar("reaplicar@teste.invalid", "11955559999", id)).r.ok,
        true,
      );
    }),
);

prova(
  "MIGRATION: o pre-voo (e o do rollback) recusa corpo desconhecido, antes de escrever",
  () =>
    emTransacao(async () => {
      exigirArquivos();
      await C.query(`CREATE OR REPLACE FUNCTION public.reivindicar_email_de_confirmacao(p_order_id uuid)
      RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
      AS $x$ SELECT false $x$`);
      await C.query("SAVEPOINT pv");
      await assert.rejects(C.query(MIGRATION), /B1_BASELINE_DIVERGENT/);
      await C.query("ROLLBACK TO SAVEPOINT pv");
      await assert.rejects(C.query(ROLLBACK), /B1_BASELINE_DIVERGENT/);
      await C.query("ROLLBACK TO SAVEPOINT pv");
    }),
);

prova(
  "CONTROLE: o rollback devolve os tres corpos de antes (md5) e, com eles, os defeitos voltam; e volta de novo",
  () =>
    emTransacao(async () => {
      exigirArquivos();
      await C.query(ROLLBACK);
      for (const [assinatura, h] of Object.entries(CORPOS_DE_ANTES))
        assert.equal(await md5DoCorpo(assinatura), h, assinatura);
      // a v2 fica (o front novo depende dela)
      assert.ok(await md5DoCorpo(NOVAS[0]));
      // sem a correcao: o 6o codigo do mesmo pedido SAI (o teste do teto pegaria)
      const email = "controle@teste.invalid";
      const fone = "11933331001";
      const id = await pedido({ email, fone });
      for (let i = 1; i <= 6; i++) {
        assert.equal(
          (await gerar(email, fone, id)).r.ok,
          true,
          `controle ${i}`,
        );
        await passarUmMinuto(id);
      }
      // sem a correcao: a v1 volta a dizer quantas tentativas restam
      const g = (
        await C.query(
          "SELECT otp_code FROM public.otp_verifications WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
          [id],
        )
      ).rows[0].otp_code;
      const r = (await como("anon", SQL_V1, [email, errado(g)])).r;
      assert.equal(
        typeof r.restantes,
        "number",
        "o controle nao reproduziu o `restantes`",
      );
      // sem a correcao: o comprovante passa do teto da loja
      await gasto("comprovante:loja", 500, "1 hour");
      const c = await pedido({
        email: "controle.c@teste.invalid",
        fone: "11933331002",
      });
      assert.equal(await reivindicar(c), true);
      // ida e volta
      await C.query(MIGRATION);
      const c2 = await pedido({
        email: "controle.d@teste.invalid",
        fone: "11933331003",
      });
      assert.equal(await reivindicar(c2), false);
    }),
);

prova(
  "PRIVILEGIOS: contadores e funcoes de apoio so do servidor; as portas do convidado abertas a anon",
  () =>
    emTransacao(async () => {
      const r = await C.query(`SELECT
        has_function_privilege('anon', 'public.reservar_vaga_de_email(text,integer)', 'EXECUTE') AS a,
        has_function_privilege('authenticated', 'public.reservar_vaga_de_email(text,integer)', 'EXECUTE') AS b,
        has_function_privilege('service_role', 'public.reservar_vaga_de_email(text,integer)', 'EXECUTE') AS c,
        has_function_privilege('anon', 'public.chave_do_destinatario(text)', 'EXECUTE') AS d,
        has_function_privilege('authenticated', 'public.chave_do_destinatario(text)', 'EXECUTE') AS e,
        has_function_privilege('anon', 'public.generate_order_otp_v2(text,text,text)', 'EXECUTE') AS f,
        has_function_privilege('service_role', 'public.generate_order_otp_v2(text,text,text)', 'EXECUTE') AS g,
        has_function_privilege('anon', 'public.reivindicar_email_de_confirmacao(uuid)', 'EXECUTE') AS h,
        has_function_privilege('anon', 'public.get_orders_by_otp_v1(text,text)', 'EXECUTE') AS i,
        has_function_privilege('anon', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE') AS j,
        has_function_privilege('authenticated', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE') AS k,
        has_table_privilege('anon', 'public.email_da_loja_contadores', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS l,
        has_table_privilege('authenticated', 'public.email_da_loja_contadores', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS m,
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_da_loja_contadores'::regclass) AS n,
        (SELECT count(*)::int FROM pg_proc p
           CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
          WHERE p.oid IN ('public.reservar_vaga_de_email(text,integer)'::regprocedure,
                          'public.chave_do_destinatario(text)'::regprocedure,
                          'public.get_orders_by_otp_v2(text,text,text,text)'::regprocedure)
            AND x.privilege_type = 'EXECUTE' AND x.grantee = 0) AS o`);
      assert.deepEqual(r.rows[0], {
        a: false,
        b: false,
        c: true,
        d: false,
        e: false,
        f: false,
        g: true,
        h: false,
        i: true,
        j: true,
        k: true,
        l: false,
        m: false,
        n: true,
        o: 0,
      });
      const t = await tentar(
        "anon",
        "SELECT count(*) FROM public.email_da_loja_contadores",
      );
      assert.equal(t.codigo, "42501");
      const t2 = await tentar(
        "anon",
        "SELECT public.reservar_vaga_de_email('codigo:loja', 1)",
      );
      assert.equal(t2.codigo, "42501");
    }),
);

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
          `  FALHOU  ${nome}\n    ${String(e.message).split("\n").join("\n    ")}`,
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
      `${falhas.length} de ${PROVAS.length} provas do teto de e-mail falharam.`,
    );
  }
  console.log(
    `\n[teto-de-email] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

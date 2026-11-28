"use strict";

/**
 * Prova VIVA da migration 20261656000000 (a visitante deixa o e-mail depois da compra) num Postgres EFEMERO, com os papeis de
 * verdade (anon, authenticated, service_role). O clone (rodar-isolado.cjs) e' a arvore migrada: a 20261656000000 ja esta no ar.
 * Cada caso roda numa transacao que termina em ROLLBACK, menos a CORRIDA (duas conexoes reais, fixture commitada e apagada no fim).
 *
 *  PORTA        informar_email_da_visitante (como anon): grava customer_data.email no pedido de visitante recem-criado (as outras
 *               chaves ficam); o MESMO e-mail de novo (outra caixa) responde ja_gravado sem reescrever a linha; outro e-mail e'
 *               recusado e o primeiro fica; pedido de conta, do balcao, pago pelo app, com customer_data que nao e' objeto e que nao
 *               existe: nao_aceita, nada escrito; 14 min grava, 15 e 16 min fora_do_prazo; formato invalido (sem dominio, com
 *               espaco, virgula, quebra de linha, longo demais) recusa ANTES de ler o pedido; a marca do comprovante nao e' tocada.
 *  CORRIDA      duas conexoes, dois e-mails ao mesmo tempo no mesmo pedido: a segunda ESPERA a trava da linha e e' recusada; fica o
 *               primeiro.
 *  RESERVA      reivindicar_comprovante_da_visitante (como service_role): pedido PAGO com o contador do comprovante da loja cheio e'
 *               RECUSADO (controle: a reivindicar_email_de_confirmacao da 20261217000000 deixa o mesmo pedido pago passar); teto do
 *               destinatario tambem; sem a vaga da loja a vaga do destinatario volta; com vaga reserva, marca e conta 1 em cada; a
 *               segunda chamada nao marca nem conta; pedido de conta, do balcao, sem e-mail: false sem contar; contador que falha =
 *               erro (nada marcado).
 *  PERMISSAO    a porta: anon e authenticated sim, service_role nao; a reserva: so o service_role.
 *  MIGRATION    reaplicar 2x e em CRLF = mesmos corpos e ACL; o pre-voo recusa corpo estranho; o rollback tira as duas, repetido e'
 *               no-op, e o e-mail gravado fica.
 *  MUTANTES     sem cada condicao da porta (conta, balcao, janela, sobrescrever), sem a trava da linha (a corrida sobrescreve), sem
 *               o teto da reserva (o pago passa) e sem o filtro de visitante da reserva: vermelho.
 *  CONSULTAS    212a e 212b positivas depois; antes (rollback aplicado) 212a negativa so nas duas funcoes e 212b positiva; corpo
 *               estranho reprova a linha dele nas duas.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-visitante-deixa-o-email-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (migrations e consultas), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const ARQ = "20261656000000_a_visitante_deixa_o_email_depois_da_compra.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const lerConsulta = (n) =>
  fs.readFileSync(path.join(CONSULTAS, `${n}.sql`), "utf8");
const C212A = lerConsulta("212a-conferir-a-visitante-deixa-o-email-aplicado");
const C212B = lerConsulta("212b-antes-a-visitante-deixa-o-email-ausente");
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");

const SIG_INF = "public.informar_email_da_visitante(uuid,text)";
const SIG_REI = "public.reivindicar_comprovante_da_visitante(uuid)";
const SIG_1217 = "public.reivindicar_email_de_confirmacao(uuid)";
const H_INF = "4ab021c0ff86fbecf36e4c4702a04398";
const H_REI = "37c9cd2bd0d16c466bb824d0f3a2887c";

/** O CREATE OR REPLACE da funcao no texto, do cabecalho ao delimitador de fecho (sem pre-voo nem pos-voo). */
function definicao(texto, nome, tag) {
  const i = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert.ok(i >= 0, `${nome} ausente do texto`);
  const a = texto.indexOf(`AS ${tag}`, i) + `AS ${tag}`.length;
  const fim = texto.indexOf(`${tag};`, a) + `${tag};`.length;
  return texto.slice(i, fim);
}
const corpoDe = (texto, nome, tag) => {
  const d = definicao(texto, nome, tag);
  const a = d.indexOf(`AS ${tag}`) + `AS ${tag}`.length;
  return d.slice(a, d.lastIndexOf(tag));
};
assert.equal(
  md5(corpoDe(MIGRATION, "informar_email_da_visitante", "$informar$")),
  H_INF,
  "o arquivo mudou (informar)",
);
assert.equal(
  md5(
    corpoDe(
      MIGRATION,
      "reivindicar_comprovante_da_visitante",
      "$reivindicar_visitante$",
    ),
  ),
  H_REI,
  "o arquivo mudou (reserva)",
);
const DEF_INF = definicao(
  MIGRATION,
  "informar_email_da_visitante",
  "$informar$",
);
const DEF_REI = definicao(
  MIGRATION,
  "reivindicar_comprovante_da_visitante",
  "$reivindicar_visitante$",
);

const U = { conta: "1656cafe-0000-4000-8000-0000000000c1" };
const EMAIL = "visitante.1656@exemplo.test";
const FONE = "34900001656";

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashDe = async (sig, conexao = C) =>
  (
    await conexao.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.h ?? null;
/** Tudo que a funcao e' no catalogo, menos o corpo (OID, dono, ACL, atributos). */
const catalogo = async (sig) =>
  (
    await C.query(
      "SELECT (to_jsonb(p) - 'prosrc')::text AS j FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.j ?? null;

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

/** Uma transacao por caso, sempre desfeita, no estado DEPOIS (o clone) ou ANTES (o rollback-manual aplicado). */
async function emTransacao(fn, { estado = "depois" } = {}) {
  await C.query("BEGIN");
  try {
    assert.equal(
      await hashDe(SIG_INF),
      H_INF,
      "o clone tem de estar com a 20261656000000 no ar",
    );
    assert.equal(
      await hashDe(SIG_REI),
      H_REI,
      "o clone tem de estar com a 20261656000000 no ar",
    );
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@1656.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U.conta],
    );
    if (estado === "antes") {
      assert.equal(await aplicar(ROLLBACK), null, "o rollback nao aplicou");
      assert.equal(await hashDe(SIG_INF), null, "o estado ANTES nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`; devolve {linhas} ou {erro, codigo} sem derrubar a transacao. */
async function tentar(papel, sql, params = []) {
  await C.query("SAVEPOINT tentativa");
  try {
    await C.query(`SET LOCAL ROLE ${papel}`);
    const linhas = (await C.query(sql, params)).rows;
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

let seq = 0;
const novoId = () => {
  seq += 1;
  return `1656beef-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/** Um pedido sintetico. Padrao: visitante (sem conta), loja online, na entrega, sem e-mail, criado ha 1 minuto. */
async function pedido({
  userId = null,
  canal = "online",
  forma = "cash",
  pago = false,
  email,
  dados,
  criadoHa = "1 minute",
  conexao = C,
} = {}) {
  const id = novoId();
  const customerData =
    dados !== undefined
      ? dados
      : email === undefined
        ? { whatsapp: FONE, address: { city: "Cidade Teste" } }
        : { email, whatsapp: FONE, address: { city: "Cidade Teste" } };
  await conexao.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_phone, customer_data, total, subtotal, payment_status, payment_method, canal, created_at)
     VALUES ($1, $2, 'Visitante Sintetica', $3, $4::jsonb, 50, 50, $5, $6, $7, now() - $8::interval)`,
    [
      id,
      userId,
      FONE,
      JSON.stringify(customerData),
      pago ? "pago" : "aguardando",
      forma,
      canal,
      criadoHa,
    ],
  );
  return id;
}

const linhaDo = async (id) =>
  (
    await C.query(
      `SELECT customer_data, customer_data ->> 'email' AS email, confirmation_email_sent_at AS marca, xmin::text AS xmin
         FROM public.marketplace_orders WHERE id = $1`,
      [id],
    )
  ).rows[0];

/** A porta, como a tela chama (anon). */
async function informar(id, email, papel = "anon") {
  const r = await tentar(
    papel,
    "SELECT public.informar_email_da_visitante($1::uuid, $2) AS r",
    [id, email],
  );
  assert.ok(r.linhas, `a porta falhou: ${JSON.stringify(r)}`);
  return r.linhas[0].r;
}
/** A reserva da visitante, como a edge chama (service_role). */
async function reservar(id) {
  const r = await tentar(
    "service_role",
    "SELECT public.reivindicar_comprovante_da_visitante($1::uuid) AS r",
    [id],
  );
  assert.ok(r.linhas, `a reserva falhou: ${JSON.stringify(r)}`);
  return r.linhas[0].r;
}

async function gasto(chave, n, haQuanto = "3 hours") {
  await C.query(
    `INSERT INTO public.email_da_loja_contadores (chave, hora, n)
     VALUES ($1, date_trunc('hour', now() - $2::interval), $3)`,
    [chave, haQuanto, n],
  );
}
const somaDe = async (chave) =>
  Number(
    (
      await C.query(
        "SELECT coalesce(sum(n), 0) AS n FROM public.email_da_loja_contadores WHERE chave = $1",
        [chave],
      )
    ).rows[0].n,
  );
const chaveDoDestinatario = async (email) =>
  `destinatario:${(await C.query("SELECT public.chave_do_destinatario($1) AS h", [email])).rows[0].h}`;

const NAO_ACEITA = { ok: false, motivo: "nao_aceita" };

// ---------------------------------------------------------------------------
// As verificacoes (os mutantes reusam)
// ---------------------------------------------------------------------------

/** So pedido de visitante: conta e balcao recusados, nada escrito. */
async function soPedidoDeVisitante() {
  const conta = await pedido({ userId: U.conta });
  const balcao = await pedido({ canal: "presencial" });
  for (const id of [conta, balcao]) {
    assert.deepEqual(await informar(id, EMAIL), NAO_ACEITA, id);
    assert.equal((await linhaDo(id)).email, null, `${id}: gravou`);
  }
}

/** So nos primeiros 15 minutos: 14 grava; 15 e 16 nao. */
async function soNaJanela() {
  for (const criadoHa of ["15 minutes", "16 minutes", "2 days"]) {
    const id = await pedido({ criadoHa });
    assert.deepEqual(
      await informar(id, EMAIL),
      { ok: false, motivo: "fora_do_prazo" },
      criadoHa,
    );
    assert.equal((await linhaDo(id)).email, null, `${criadoHa}: gravou`);
  }
  const dentro = await pedido({ criadoHa: "14 minutes" });
  assert.deepEqual(await informar(dentro, EMAIL), {
    ok: true,
    motivo: "gravado",
  });
  assert.equal((await linhaDo(dentro)).email, EMAIL);
}

/** Uma vez so, sem sobrescrever: o mesmo e-mail e' ok sem escrever; outro e' recusado. */
async function semSobrescrever() {
  const id = await pedido();
  assert.deepEqual(await informar(id, ` ${EMAIL} `), {
    ok: true,
    motivo: "gravado",
  });
  const antes = await linhaDo(id);
  assert.equal(antes.email, EMAIL, "o e-mail vai aparado");
  assert.deepEqual(await informar(id, EMAIL.toUpperCase()), {
    ok: true,
    motivo: "ja_gravado",
  });
  assert.equal(
    (await linhaDo(id)).xmin,
    antes.xmin,
    "o mesmo e-mail reescreveu a linha",
  );
  assert.deepEqual(await informar(id, "outra.pessoa@exemplo.test"), NAO_ACEITA);
  assert.equal(
    (await linhaDo(id)).email,
    EMAIL,
    "o segundo e-mail sobrescreveu",
  );
}

/** Pedido PAGO de visitante com a cota do comprovante da loja cheia: a reserva da visitante recusa. */
async function tetoValeComPedidoPago() {
  await C.query("DELETE FROM public.email_da_loja_contadores");
  await gasto("comprovante:loja", 40);
  const id = await pedido({ email: EMAIL, pago: true });
  assert.equal(await reservar(id), false, "o pedido pago furou o teto");
  assert.equal((await linhaDo(id)).marca, null, "marcou sem enviar");
  assert.equal(
    await somaDe("comprovante:loja"),
    40,
    "o contador passou do teto",
  );
  return id;
}

/** A reserva da visitante so serve pedido de visitante. */
async function reservaSoDaVisitante() {
  await C.query("DELETE FROM public.email_da_loja_contadores");
  const conta = await pedido({ userId: U.conta, email: EMAIL });
  const balcao = await pedido({ canal: "presencial", email: EMAIL });
  for (const id of [conta, balcao]) {
    assert.equal(await reservar(id), false, id);
    assert.equal((await linhaDo(id)).marca, null, `${id}: marcou`);
  }
  assert.equal(
    await somaDe("comprovante:loja"),
    0,
    "contou pedido que nao e' de visitante",
  );
}

/** Duas conexoes, dois e-mails ao mesmo tempo: a segunda espera a trava e e' recusada; fica o primeiro. */
async function corrida() {
  const url = lerDatabaseUrlEfemera();
  const C2 = new Client({ connectionString: url });
  const C3 = new Client({ connectionString: url });
  await C2.connect();
  await C3.connect();
  let id;
  try {
    id = await pedido(); // COMMITADO (fora de transacao): as duas conexoes enxergam
    await C.query("BEGIN");
    await C.query("SET LOCAL ROLE anon");
    const r1 = (
      await C.query(
        "SELECT public.informar_email_da_visitante($1::uuid, $2) AS r",
        [id, "primeira@exemplo.test"],
      )
    ).rows[0].r;
    assert.deepEqual(r1, { ok: true, motivo: "gravado" });
    await C2.query("BEGIN");
    await C2.query("SET LOCAL ROLE anon");
    const pid2 = (await C2.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const segunda = C2.query(
      "SELECT public.informar_email_da_visitante($1::uuid, $2) AS r",
      [id, "segunda@exemplo.test"],
    ).then(
      (x) => ({ r: x.rows[0].r }),
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
      "a segunda chamada nao parou na trava da linha do pedido",
    );
    await C.query("COMMIT");
    const r2 = await segunda;
    await C2.query("COMMIT");
    const final = (
      await C.query(
        "SELECT customer_data ->> 'email' AS e FROM public.marketplace_orders WHERE id = $1",
        [id],
      )
    ).rows[0].e;
    assert.equal(
      final,
      "primeira@exemplo.test",
      "a segunda sobrescreveu o primeiro e-mail",
    );
    assert.deepEqual(r2, { r: NAO_ACEITA }, JSON.stringify(r2));
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C2.query("ROLLBACK").catch(() => {});
    if (id) {
      await C.query("DELETE FROM public.marketplace_orders WHERE id = $1", [
        id,
      ]).catch(() => {});
    }
    await C2.end().catch(() => {});
    await C3.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// PORTA
// ---------------------------------------------------------------------------

prova(
  "PORTA: a visitante grava o e-mail uma vez; as outras chaves e a marca do comprovante ficam",
  () =>
    emTransacao(async () => {
      const id = await pedido();
      const antes = await linhaDo(id);
      assert.deepEqual(await informar(id, EMAIL), {
        ok: true,
        motivo: "gravado",
      });
      const depois = await linhaDo(id);
      assert.deepEqual(depois.customer_data, {
        ...antes.customer_data,
        email: EMAIL,
      });
      assert.equal(depois.marca, null, "a porta tocou a marca do comprovante");
      // authenticated (a pessoa logou depois) tambem pode: a capacidade e' o id.
      const outro = await pedido();
      assert.deepEqual(await informar(outro, EMAIL, "authenticated"), {
        ok: true,
        motivo: "gravado",
      });
    }),
);

prova("PORTA: so pedido de visitante (conta e balcao recusados)", () =>
  emTransacao(soPedidoDeVisitante),
);

prova(
  "PORTA: pago pelo app, customer_data que nao e' objeto e pedido que nao existe: nao_aceita, nada escrito",
  () =>
    emTransacao(async () => {
      const app = await pedido({ forma: "online" });
      const lista = await pedido({ dados: [] });
      for (const id of [app, lista, novoId()]) {
        assert.deepEqual(await informar(id, EMAIL), NAO_ACEITA, id);
      }
      assert.equal((await linhaDo(app)).email, null);
      assert.deepEqual((await linhaDo(lista)).customer_data, []);
    }),
);

prova("PORTA: so nos primeiros 15 minutos", () => emTransacao(soNaJanela));

prova(
  "PORTA: uma vez so, sem sobrescrever; o mesmo e-mail de novo nao reescreve a linha",
  () => emTransacao(semSobrescrever),
);

prova(
  "PORTA: formato invalido recusa ANTES de ler o pedido (nem o pedido que nao existe responde outra coisa)",
  () =>
    emTransacao(async () => {
      const id = await pedido();
      for (const ruim of [
        "",
        "   ",
        "sem-arroba.exemplo.test",
        "a@b",
        "a b@exemplo.test",
        "a,b@exemplo.test",
        "a@exemplo.test\nBcc: x@exemplo.test",
        `${"a".repeat(250)}@exemplo.test`,
        null,
      ]) {
        for (const alvo of [id, novoId()]) {
          assert.deepEqual(
            await informar(alvo, ruim),
            { ok: false, motivo: "email_invalido" },
            JSON.stringify(ruim),
          );
        }
      }
      assert.equal((await linhaDo(id)).email, null);
    }),
);

// ---------------------------------------------------------------------------
// CORRIDA
// ---------------------------------------------------------------------------

prova(
  "CORRIDA: duas conexoes, dois e-mails ao mesmo tempo: a segunda espera a trava da linha e e' recusada",
  corrida,
);

// ---------------------------------------------------------------------------
// RESERVA
// ---------------------------------------------------------------------------

prova(
  "RESERVA: pedido PAGO com a cota do comprovante cheia e' recusado (CONTROLE: a reserva da 20261217000000 deixa o mesmo pedido passar)",
  () =>
    emTransacao(async () => {
      const id = await tetoValeComPedidoPago();
      const r = await tentar(
        "service_role",
        `SELECT ${SIG_1217.replace("(uuid)", "")}($1::uuid) AS r`,
        [id],
      );
      assert.ok(r.linhas, JSON.stringify(r));
      assert.equal(
        r.linhas[0].r,
        true,
        "controle: a reserva de sempre deixa o pago passar",
      );
    }),
);

prova(
  "RESERVA: teto do destinatario; sem a vaga da loja, a vaga do destinatario volta",
  () =>
    emTransacao(async () => {
      await C.query("DELETE FROM public.email_da_loja_contadores");
      const chave = await chaveDoDestinatario(EMAIL);
      await gasto(chave, 10);
      const cheio = await pedido({ email: EMAIL, pago: true });
      assert.equal(
        await reservar(cheio),
        false,
        "o destinatario passou do teto",
      );
      assert.equal(await somaDe("comprovante:loja"), 0);

      await C.query("DELETE FROM public.email_da_loja_contadores");
      await gasto("comprovante:loja", 40);
      const semLoja = await pedido({ email: EMAIL });
      assert.equal(await reservar(semLoja), false);
      assert.equal(await somaDe(chave), 0, "a vaga do destinatario nao voltou");
    }),
);

prova(
  "RESERVA: com vaga reserva, marca e conta 1 em cada contador; a segunda chamada nao marca nem conta",
  () =>
    emTransacao(async () => {
      await C.query("DELETE FROM public.email_da_loja_contadores");
      const chave = await chaveDoDestinatario(EMAIL);
      const id = await pedido({ email: EMAIL, pago: true });
      assert.equal(await reservar(id), true);
      const marca = (await linhaDo(id)).marca;
      assert.ok(marca, "nao marcou");
      assert.equal(await somaDe("comprovante:loja"), 1);
      assert.equal(await somaDe(chave), 1);
      assert.equal(await reservar(id), false, "reservou duas vezes");
      assert.equal(await somaDe("comprovante:loja"), 1);
      assert.equal(await somaDe(chave), 1);
    }),
);

prova(
  "RESERVA: pedido de conta, do balcao e sem e-mail: false sem contar nada",
  () =>
    emTransacao(async () => {
      await reservaSoDaVisitante();
      const semEmail = await pedido();
      assert.equal(await reservar(semEmail), false);
      assert.equal(await somaDe("comprovante:loja"), 0);
    }),
);

prova(
  "RESERVA: contador que falha e' ERRO (nada marcado), nunca 'o comprovante segue'",
  () =>
    emTransacao(async () => {
      const id = await pedido({ email: EMAIL });
      await C.query(`CREATE OR REPLACE FUNCTION public.reservar_vaga_de_email(p_chave text, p_teto integer)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $$ BEGIN RAISE EXCEPTION 'contador fora do ar'; END; $$`);
      const r = await tentar(
        "service_role",
        "SELECT public.reivindicar_comprovante_da_visitante($1::uuid) AS r",
        [id],
      );
      assert.ok(r.erro, `a falha do contador nao subiu: ${JSON.stringify(r)}`);
      assert.equal((await linhaDo(id)).marca, null);
    }),
);

// ---------------------------------------------------------------------------
// PERMISSAO
// ---------------------------------------------------------------------------

prova(
  "PERMISSAO: a porta para anon e authenticated (nao service_role); a reserva so para o service_role",
  () =>
    emTransacao(async () => {
      const tem = async (papel, sig) =>
        (
          await C.query(
            "SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS t",
            [papel, sig],
          )
        ).rows[0].t;
      assert.equal(await tem("anon", SIG_INF), true);
      assert.equal(await tem("authenticated", SIG_INF), true);
      assert.equal(await tem("service_role", SIG_INF), false);
      assert.equal(await tem("anon", SIG_REI), false);
      assert.equal(await tem("authenticated", SIG_REI), false);
      assert.equal(await tem("service_role", SIG_REI), true);
      const id = await pedido({ email: EMAIL });
      for (const papel of ["anon", "authenticated"]) {
        const r = await tentar(
          papel,
          "SELECT public.reivindicar_comprovante_da_visitante($1::uuid) AS r",
          [id],
        );
        assert.equal(
          r.codigo,
          "42501",
          `${papel} reservou: ${JSON.stringify(r)}`,
        );
      }
    }),
);

// ---------------------------------------------------------------------------
// MIGRATION
// ---------------------------------------------------------------------------

prova(
  "MIGRATION: reaplicar 2x e em CRLF deixa os mesmos corpos, OID, dono e ACL",
  () =>
    emTransacao(async () => {
      const antes = [await catalogo(SIG_INF), await catalogo(SIG_REI)];
      for (const texto of [MIGRATION, MIGRATION, emCRLF(MIGRATION)]) {
        assert.equal(await aplicar(texto), null, "a reaplicacao recusou");
        assert.equal(await hashDe(SIG_INF), H_INF);
        assert.equal(await hashDe(SIG_REI), H_REI);
        assert.deepEqual(
          [await catalogo(SIG_INF), await catalogo(SIG_REI)],
          antes,
        );
      }
    }),
);

prova("MIGRATION: o pre-voo recusa corpo estranho sem escrever", () =>
  emTransacao(async () => {
    await C.query(
      DEF_INF.replace(
        "RETURN jsonb_build_object('ok', true, 'motivo', 'gravado');",
        "RETURN jsonb_build_object('ok', true);",
      ),
    );
    const h = await hashDe(SIG_INF);
    assert.notEqual(h, H_INF, "o corpo estranho nao ficou estranho");
    const r = await aplicar(MIGRATION);
    assert.ok(r && /B1_BASELINE_DIVERGENT/.test(r.erro), JSON.stringify(r));
    assert.equal(await hashDe(SIG_INF), h, "o pre-voo deixou escrever");
  }),
);

prova(
  "MIGRATION: o rollback tira as duas, repetido e' no-op, e o e-mail gravado fica",
  () =>
    emTransacao(async () => {
      const id = await pedido();
      assert.deepEqual(await informar(id, EMAIL), {
        ok: true,
        motivo: "gravado",
      });
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await hashDe(SIG_INF), null);
      assert.equal(await hashDe(SIG_REI), null);
      assert.equal(
        await aplicar(ROLLBACK),
        null,
        "o rollback repetido recusou",
      );
      assert.equal(
        (await linhaDo(id)).email,
        EMAIL,
        "o rollback apagou o e-mail",
      );
      // e a migration volta por cima do rollback
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await hashDe(SIG_INF), H_INF);
    }),
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------

function mutar(texto, de, para) {
  assert.equal(
    texto.split(de).length - 1,
    1,
    `o trecho do mutante nao e' unico: ${de}`,
  );
  return texto.replace(de, para);
}
async function vermelho(nome, verificacao) {
  let passou = false;
  try {
    await verificacao();
    passou = true;
  } catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;
  }
  assert.equal(passou, false, `o mutante "${nome}" sobreviveu`);
}

prova(
  "MUTANTES: sem cada condicao da porta e da reserva, a verificacao fica vermelha",
  async () => {
    const daPorta = [
      [
        "sem o filtro de conta",
        "     OR v_pedido.user_id IS NOT NULL\n",
        "",
        soPedidoDeVisitante,
      ],
      [
        "sem o filtro do balcao",
        "     OR v_pedido.canal IS DISTINCT FROM 'online'\n",
        "",
        soPedidoDeVisitante,
      ],
      [
        "sem a janela",
        "IF v_pedido.created_at <= now() - v_janela THEN",
        "IF false THEN",
        soNaJanela,
      ],
      [
        "sobrescrevendo",
        "IF v_pedido.email <> '' THEN",
        "IF false THEN",
        semSobrescrever,
      ],
    ];
    for (const [nome, de, para, verificacao] of daPorta) {
      await emTransacao(async () => {
        await C.query(mutar(DEF_INF, de, para));
        await vermelho(nome, verificacao);
      });
    }
    const daReserva = [
      [
        "sem o teto da loja",
        "public.reservar_vaga_de_email('comprovante:loja', v_teto_do_comprovante_na_loja)",
        "public.reservar_vaga_de_email('comprovante:loja', NULL)",
        tetoValeComPedidoPago,
      ],
      [
        "sem o filtro de visitante",
        "     AND o.user_id IS NULL\n",
        "",
        reservaSoDaVisitante,
      ],
    ];
    for (const [nome, de, para, verificacao] of daReserva) {
      await emTransacao(async () => {
        await C.query(mutar(DEF_REI, de, para));
        await vermelho(nome, verificacao);
      });
    }
  },
);

prova(
  "MUTANTES: sem a trava da linha, a corrida sobrescreve o primeiro e-mail (vermelho)",
  async () => {
    // A corrida precisa do corpo mutado COMMITADO (a outra conexao tem de ve-lo); o original volta no finally.
    await C.query(mutar(DEF_INF, "\n     FOR UPDATE;", ";"));
    try {
      assert.notEqual(await hashDe(SIG_INF), H_INF);
      await vermelho("sem FOR UPDATE", corrida);
    } finally {
      await C.query(DEF_INF);
      assert.equal(await hashDe(SIG_INF), H_INF, "o corpo original nao voltou");
    }
  },
);

// ---------------------------------------------------------------------------
// CONSULTAS
// ---------------------------------------------------------------------------

const linhasDaConsulta = async (sql) => {
  await C.query("SAVEPOINT consulta");
  try {
    await C.query("SET LOCAL transaction_read_only = on");
    return (await C.query(sql)).rows;
  } finally {
    await C.query("ROLLBACK TO SAVEPOINT consulta");
  }
};
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
const LINHA_INF =
  "informar_email_da_visitante: corpo exato (md5), uma so, plpgsql SECURITY DEFINER VOLATILE, search_path=public, EXECUTE de anon e authenticated (nem PUBLIC nem service_role)";
const LINHA_REI =
  "reivindicar_comprovante_da_visitante: corpo exato (md5), uma so, plpgsql SECURITY DEFINER VOLATILE, search_path=public, EXECUTE so do service_role";

prova(
  "CONSULTAS: 212a e 212b positivas depois; antes, 212a negativa so nas duas funcoes e 212b positiva; corpo estranho reprova a linha dele",
  async () => {
    await emTransacao(async () => {
      for (const c of [C212A, C212B]) {
        const rows = await linhasDaConsulta(c);
        assert.equal(rows.length, 4);
        assert.deepEqual(reprovadas(rows), []);
      }
    });
    await emTransacao(
      async () => {
        assert.deepEqual(
          reprovadas(await linhasDaConsulta(C212A)),
          [LINHA_INF, LINHA_REI].sort(),
        );
        assert.deepEqual(reprovadas(await linhasDaConsulta(C212B)), []);
      },
      { estado: "antes" },
    );
    await emTransacao(async () => {
      await C.query(
        mutar(
          DEF_REI,
          "RETURN coalesce(v_reservado, false);",
          "RETURN coalesce(v_reservado, true);",
        ),
      );
      assert.deepEqual(reprovadas(await linhasDaConsulta(C212A)), [LINHA_REI]);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C212B)), [LINHA_REI]);
    });
  },
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
      `${falhas.length} de ${PROVAS.length} provas da visitante que deixa o e-mail falharam.`,
    );
  }
  console.log(
    `\n[a-visitante-deixa-o-email] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));

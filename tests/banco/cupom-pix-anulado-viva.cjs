"use strict";

/**
 * PROVA VIVA do cupom preso depois de "cancelou com o PIX gerado" (09/10/2026), num Postgres
 * EFEMERO local -- nada de rede, nada de loja. O arquivo tem BLOCOS, um por migration:
 *
 *   BLOCO DA FOTO  -- migration 20261209000000_a_foto_da_cobranca_no_cancelamento.sql (esta
 *                     peca): no instante em que um pedido vira 'cancelled' um gatilho grava a
 *                     FOTO da cobranca dele (id na vaga, tentativas, metodo online,
 *                     payment_status) numa tabela fechada. Ninguem le a foto ainda.
 *   BLOCO DA VAGA  -- migration 20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql
 *                     (a peca seguinte): a varredura do cupom, o auxiliar e a RPC do checkout
 *                     passam a ler a foto; o cupom de um pedido cancelado com o PIX gerado volta
 *                     no prazo do PIX, e nao em 24 h, quando a foto prova que nunca houve cartao.
 *                     O detalhe do que afirma esta no comentario do bloco, mais abaixo.
 *
 * O QUE O BLOCO DA FOTO AFIRMA, EXECUTANDO (cada caso num banco CLONADO do estado "pre": a
 * arvore inteira de migrations de versao MENOR que a 20261209000000, ja com pedidos, usuarios
 * e produto de teste, que e o estado de uma loja antes do apply):
 *  CATALOGO     a tabela tem a forma exata (colunas, chave, FK com CASCADE), seguranca por linha
 *               ligada, nenhuma politica, nenhum privilegio para PUBLIC/anon/authenticated/
 *               service_role (nem SELECT, nem escrita: 42501 para cada um); a funcao do gatilho e
 *               SECURITY DEFINER, search_path = public, sem EXECUTE de fora; o gatilho e AFTER
 *               UPDATE OF status, por linha, com o WHEN, ativo.
 *  CAMINHOS     a foto existe, com os valores do MOMENTO do cancelamento, em todos os caminhos
 *               reais: v24 + PIX + cancelar_pedido_com_cobranca (edge) e depois liberar (a foto
 *               NAO muda); cliente e admin por update_order_status_atomic; pedido pago cancelado;
 *               cartao em analise (metodo credito + sentinela verificando:); expiracao pelo
 *               agendador (sai com payment_status 'expirado'); v23 "na entrega"; pedido__mudar_status
 *               direto; UPDATE cru de superusuario; UPDATE direto do service_role (sem privilegio na tabela da foto). O cliente (papel
 *               authenticated, sem privilegio na tabela) cancela sem erro.
 *  RECANCELAR   recancelar um pedido ja cancelado nao grava foto nova (a linha fisica nem e
 *               reescrita: mesmo xmin); reativar e cancelar de novo SOBRESCREVE pelo estado do
 *               segundo cancelamento (um cartao tentado no meio aparece).
 *  NAO DISPARA  UPDATE que nao mexe em status, transicoes que nao levam a cancelled, status
 *               repetido: nenhuma foto.
 *  SIMULTANEO   dois cancelamentos ao mesmo tempo (UPDATE cru e update_order_status_atomic, 2
 *               conexoes reais) geram UMA foto, a do primeiro.
 *  CASCATA      apagar o pedido apaga a foto.
 *  DADO ANTIGO  pedido cancelado ANTES da migration nao ganha foto (nem ao ser "recancelado"),
 *               nada e preenchido retroativamente e nenhuma linha de pedido muda.
 *  ENVELOPE     o envelope de producao (aplicar-migrations.yml: BEGIN ISOLATION LEVEL REPEATABLE
 *               READ + uma leitura de marketplace_orders, a foto da impressao digital, ANTES do
 *               LOCK): aplica sem concorrente; com um pedido em andamento ESPERA e aplica; com a
 *               tabela ocupada por mais de 4 s RECUSA (55P03) sem gravar; com DOIS pedidos
 *               cruzados (um segura a tabela de pedidos e quer a linha do cupom, o outro segura a
 *               linha do cupom e quer a tabela) a migration que espera a trava NAO para o
 *               checkout (o pedido que chega com ela esperando termina em milissegundos) e nao
 *               ha deadlock (40P01) -- o mutante com `LOCK` simples (que espera na fila) deixa o
 *               pedido parado; e um pedido que chega DEPOIS da trava espera o COMMIT e ja
 *               encontra o gatilho.
 *  IDA E VOLTA  aplicar, rollback, reaplicar, reaplicar de novo, rollback duas vezes: o catalogo
 *               volta EXATO ao do estado pre; os pedidos nao mudam; atomicidade (falha depois da
 *               ultima peca desfaz tudo; BEGIN ... ROLLBACK nao deixa rastro; CRLF aplica).
 *  PRE-VOO      recusa, nomeando o problema e sem gravar nada: coluna ausente em
 *               marketplace_orders; tabela com o nome mas outra forma / sem chave / sem FK /
 *               com politica; funcao com o nome em outra assinatura ou com outro corpo; gatilho
 *               com o nome e outra definicao. O rollback recusa funcao que cite a tabela (a
 *               20261210000000), tabela/funcao/gatilho que nao sao os da migration, e visao
 *               dependente (DROP sem CASCADE).
 *  POS-VOO      cada peca quebrada de proposito (sem RLS, privilegio sobrando, EXECUTE sobrando,
 *               corpo diferente, gatilho diferente, sem gatilho) faz a migration inteira falhar.
 *  MUTANTES     cada guarda retirada do texto da migration/rollback deixa um caso VERMELHO (a
 *               saida vermelha de cada um e' impressa).
 *
 * LIMITES DECLARADOS: (1) o Postgres e o 17 LOCAL; o Postgres 15/17 da Supabase, o papel
 * `postgres` real e a ACL real das lojas nao foram medidos aqui. (2) O envelope do workflow e
 * simulado por BEGIN ISOLATION LEVEL REPEATABLE READ / leitura / corpo / COMMIT em texto, nao pelo
 * aplicar-migrations.yml nem pelo impressao-digital.sql. (3) O `SET LOCAL lock_timeout` da
 * migration e cinto de seguranca: com a trava pega por NOWAIT nao ha espera alcancavel que ele
 * limite, entao nenhum mutante o distingue. (4) O comportamento do Mercado Pago (PIX cancelado
 * pago depois) nao e coberto: esta peca so grava a foto.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres:...@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/cupom-pix-anulado-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp --
 * Os caminhos vem do proprio repositorio (as migrations) e os trechos regex dos mutantes vem
 * de constantes deste arquivo, nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");

// ---------------------------------------------------------------------------
// Os arquivos (leitura SOB DEMANDA: com a migration ainda ausente a prova falha por
// asserção clara, nunca por ENOENT solto no carregar)
// ---------------------------------------------------------------------------
const ARQ = "20261209000000_a_foto_da_cobranca_no_cancelamento.sql";
const ARQ_RB = `rollback-manual-${ARQ}`;
const lerLF = (arq) => {
  const f = path.join(MIGRATIONS, arq);
  assert.ok(
    fs.existsSync(f),
    `o arquivo ${arq} nao existe em supabase/migrations`,
  );
  return fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};
const lerMig = () => lerLF(ARQ);
const lerRb = () => lerLF(ARQ_RB);

const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;

const urlBase = lerDatabaseUrlEfemera();
const urlDe = (db) => {
  const u = new URL(urlBase);
  u.pathname = `/${db}`;
  return u.toString();
};
async function usar(db, fn) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}
const clones = [];
let PRE = null;
async function criarBanco(nome, de = null) {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      await usar("template1", (a) =>
        a.query(
          de
            ? `CREATE DATABASE "${nome}" TEMPLATE "${de}"`
            : `CREATE DATABASE "${nome}"`,
        ),
      );
      break;
    } catch (e) {
      // 55006: o molde ainda esta sendo liberado pela conexao que acabou de fechar.
      if (e.code !== "55006" || tentativa >= 40) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  clones.push(nome);
  return nome;
}
const clonar = (rotulo, de = PRE) =>
  criarBanco(`pa_${SUF}_${clones.length}_${rotulo}`.slice(0, 60), de);

let resultados = 0;
function ok(msg) {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function rodarScriptNode(argv, env) {
  const r = spawnSync(process.execPath, argv, { env, encoding: "utf8" });
  assert.equal(
    r.status,
    0,
    `${path.basename(argv[0])} falhou:\n${(r.stdout || "").slice(-600)}\n${(r.stderr || "").slice(-600)}`,
  );
}
/** Monta um banco NOVO com as migrations que passam no filtro, pelos mesmos scripts do
 * rpc-ci.yml, num diretorio temporario exclusivo desta execucao. */
async function montarBase(nome, filtro) {
  await criarBanco(nome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-"));
  try {
    for (const e of fs.readdirSync(MIGRATIONS, { withFileTypes: true })) {
      if (
        e.isFile() &&
        e.name.endsWith(".sql") &&
        !e.name.startsWith("rollback-") &&
        filtro(e.name)
      )
        fs.copyFileSync(path.join(MIGRATIONS, e.name), path.join(dir, e.name));
    }
    const env = { ...process.env, DATABASE_URL: urlDe(nome) };
    rodarScriptNode([path.join(__dirname, "provisionar.cjs")], env);
    rodarScriptNode([path.join(__dirname, "aplicar-migrations.cjs"), dir], env);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return nome;
}

// ---------------------------------------------------------------------------
// Fixtures: usuarios, produto, cupom, pedidos pelos caminhos REAIS
// ---------------------------------------------------------------------------
const U_COMPRADOR = "c9000000-0000-4000-8000-000000000001";
const U_OUTRO = "c9000000-0000-4000-8000-000000000002";
const U_ADMIN = "c9000000-0000-4000-8000-000000000003";
const P_PRODUTO = "c9aaaaaa-0000-4000-8000-000000000001";
const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
const QUEM = new Map(
  Object.entries({
    anon: { papel: "anon", uid: "", jwt: "" },
    comprador: {
      papel: "authenticated",
      uid: U_COMPRADOR,
      jwt: claims(U_COMPRADOR, null),
    },
    outro: { papel: "authenticated", uid: U_OUTRO, jwt: claims(U_OUTRO, null) },
    admin: {
      papel: "authenticated",
      uid: U_ADMIN,
      jwt: claims(U_ADMIN, "admin"),
    },
    service: { papel: "service_role", uid: "", jwt: "" },
  }),
);

/** Roda `sql` COMO `quem`, numa transacao PROPRIA (COMMIT no fim); erro vira {ok:false}. */
async function como(c, quem, sql, params = []) {
  const q = QUEM.get(quem);
  await c.query("BEGIN");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { ok: false, code: e.code, message: e.message };
  }
}
function exigir(r, rotulo) {
  assert.ok(r.ok, `${rotulo}: ${r.code} ${r.message}`);
  return r.rows;
}

async function semearBase(db) {
  await usar(db, async (c) => {
    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    for (const [id, papel] of [
      [U_COMPRADOR, null],
      [U_OUTRO, null],
      [U_ADMIN, "admin"],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@pixanulado.teste', $2::jsonb)`,
        [id, JSON.stringify(papel ? { role: papel } : {})],
      );
    }
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Comprador Foto', 'customer'), ($2, 'Outro Foto', 'customer'), ($3, 'Admin Foto', 'admin')`,
      [U_COMPRADOR, U_OUTRO, U_ADMIN],
    );
    await c.query(
      `INSERT INTO public.store_config
         (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
       VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
       ON CONFLICT (id) DO UPDATE
         SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
             free_shipping_min = EXCLUDED.free_shipping_min,
             shipping_coverage = EXCLUDED.shipping_coverage,
             enable_coupons = EXCLUDED.enable_coupons`,
    );
    await c.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
       VALUES ($1, 'Produto foto', 100, 100000, true, 40, false)`,
      [P_PRODUTO],
    );
    await c.query(
      `INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit)
       VALUES ('FOTOK', 'fixed', 10, true, 0, 50)`,
    );
  });
}

/** Pedido criado pelo caminho de producao (v23 = "na entrega", v24 = PIX). */
async function novoPedido(
  c,
  rpc = "create_marketplace_order_v24",
  quem = "comprador",
) {
  const metodo = rpc === "create_marketplace_order_v24" ? "pix" : "cash";
  const r = await como(
    c,
    quem,
    `SELECT public.${rpc}($1::jsonb, $2::numeric, 0::numeric, $3::text, NULL::uuid, NULL::text,
       'Comprador', '5539000000000', NULL::text, $4::jsonb, '38500-000', 'local-delivery', $5::uuid) AS id`,
    [
      JSON.stringify([
        { product_id: P_PRODUTO, variant_id: null, quantity: 1 },
      ]),
      100,
      metodo,
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      crypto.randomUUID(),
    ],
  );
  return exigir(r, `${rpc} como ${quem}`)[0].id;
}
const COLUNAS_DA_COBRANCA = `status, payment_status, gateway_payment_id,
  tentativas_de_pagamento, metodo_online`;
const estado = async (c, id) =>
  (
    await c.query(
      `SELECT ${COLUNAS_DA_COBRANCA} FROM public.marketplace_orders WHERE id = $1`,
      [id],
    )
  ).rows[0];
const foto = async (c, id) =>
  (
    await c.query(
      `SELECT order_id, gateway_payment_id, tentativas, metodo_online, payment_status,
              cancelado_em, xmin::text AS xmin
         FROM public.pedido_cobranca_ao_cancelar WHERE order_id = $1`,
      [id],
    )
  ).rows[0];
const totalFotos = async (c) =>
  Number(
    (
      await c.query(
        "SELECT count(*) AS n FROM public.pedido_cobranca_ao_cancelar",
      )
    ).rows[0].n,
  );
/** A foto tem de ser a cobranca do pedido NO instante anterior ao cancelamento. */
function mesmaCobranca(f, antes, rotulo) {
  assert.ok(f, `${rotulo}: nao ha foto`);
  assert.deepEqual(
    {
      gateway_payment_id: f.gateway_payment_id,
      tentativas: f.tentativas,
      metodo_online: f.metodo_online,
      payment_status: f.payment_status,
    },
    {
      gateway_payment_id: antes.gateway_payment_id,
      tentativas: antes.tentativas_de_pagamento,
      metodo_online: antes.metodo_online,
      payment_status: antes.payment_status,
    },
    `${rotulo}: a foto nao e a cobranca do instante do cancelamento`,
  );
}
const cancelarComo = async (c, quem, id) =>
  exigir(
    await como(
      c,
      quem,
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled') AS r",
      [id],
    ),
    `cancelar como ${quem}`,
  );
/** O que a edge criar-pagamento grava ao gerar o PIX: o id na vaga e o metodo. */
async function gravarPix(c, id, g = "MP-PIX-A") {
  await c.query(
    "UPDATE public.marketplace_orders SET gateway_payment_id = $2, metodo_online = 'pix' WHERE id = $1",
    [id, g],
  );
}
const cancelarPelaEdge = async (c, id, ator, vaga, pagamento) =>
  como(
    c,
    "service",
    "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, $3::text, $4::text) AS r",
    [id, ator, vaga, pagamento],
  );

// ---------------------------------------------------------------------------
// Fotografia do catalogo (para "nada gravado" e para "volta exata")
// ---------------------------------------------------------------------------
async function fotografia(db) {
  return usar(db, async (c) => {
    const q = async (sql) => (await c.query(sql)).rows;
    return {
      tabela: await q(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text AS acl,
                c.relowner::regrole::text AS dono, obj_description(c.oid, 'pg_class') AS comentario
           FROM pg_class c WHERE c.oid = to_regclass('public.pedido_cobranca_ao_cancelar')`,
      ),
      colunas: await q(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull,
                pg_get_expr(d.adbin, d.adrelid) AS padrao
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = to_regclass('public.pedido_cobranca_ao_cancelar')
            AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      ),
      restricoes: await q(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = to_regclass('public.pedido_cobranca_ao_cancelar') ORDER BY conname`,
      ),
      politicas: await q(
        `SELECT polname FROM pg_policy WHERE polrelid = to_regclass('public.pedido_cobranca_ao_cancelar')`,
      ),
      funcoes: (
        await q(`SELECT md5(string_agg(p.oid::regprocedure::text || '|' || p.prosrc || '|'
                 || coalesce(p.proacl::text, '') || '|' || p.proowner::regrole::text
                 || '|' || coalesce(obj_description(p.oid, 'pg_proc'), ''),
                 E'\\n' ORDER BY p.oid::regprocedure::text)) AS h
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'`)
      )[0].h,
      gatilhos: (
        await q(`SELECT md5(string_agg(t.tgrelid::regclass::text || '|' || pg_get_triggerdef(t.oid)
                   || '|' || t.tgenabled::text, E'\\n' ORDER BY t.tgrelid::regclass::text, t.tgname)) AS h
                   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace`)
      )[0].h,
      relacoes: (
        await q(`SELECT md5(string_agg(c.relname || '|' || c.relkind::text || '|' || c.relrowsecurity::text
                   || '|' || coalesce(c.relacl::text, ''), E'\\n' ORDER BY c.relname)) AS h
                   FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                    AND c.relkind IN ('r', 'v', 'm', 'p', 'S')`)
      )[0].h,
      politicasTodas: (
        await q(`SELECT md5(string_agg(polrelid::regclass::text || '|' || polname, E'\\n'
                   ORDER BY polrelid::regclass::text, polname)) AS h FROM pg_policy`)
      )[0].h,
      pedidos: (
        await q(`SELECT md5(string_agg(to_jsonb(o)::text, E'\\n' ORDER BY o.id)) AS h
                   FROM public.marketplace_orders o`)
      )[0].h,
    };
  });
}

/** Aplica um texto SQL como o aplicar-migrations.cjs: UMA consulta com o arquivo todo. */
async function aplicar(db, texto, { papel = null } = {}) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    if (papel) await c.query(`SET ROLE ${papel}`);
    await c.query(texto);
    return { ok: true };
  } catch (erro) {
    return { erro };
  } finally {
    await c.end().catch(() => {});
  }
}
const crlf = (s) => s.replace(/\n/g, "\r\n");
/** O envelope de producao: UMA transacao REPEATABLE READ, a foto da impressao digital (leitura
 * de marketplace_orders) ANTES do corpo, COMMIT no fim. `depoisDaFoto` roda entre a foto e o
 * corpo (sem esperar o corpo). */
async function emEnvelopeRR(db, sql, depoisDaFoto = null) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await c.query("SELECT count(*) FROM public.marketplace_orders");
    if (depoisDaFoto) await depoisDaFoto();
    await c.query(sql);
    await c.query("COMMIT");
    return { ok: true };
  } catch (erro) {
    await c.query("ROLLBACK").catch(() => {});
    return { erro };
  } finally {
    await c.end().catch(() => {});
  }
}
function recusou(r, trecho, rotulo, codigo = "P0001") {
  assert.ok(
    r.erro,
    `${rotulo}: devia RECUSAR e aplicou (a migration passou por cima de algo que nao e dela)`,
  );
  assert.equal(
    r.erro.code,
    codigo,
    `${rotulo}: ${r.erro.code} ${r.erro.message}`,
  );
  assert.match(r.erro.message, trecho, `${rotulo}: recusou por OUTRO motivo`);
}
async function nadaGravado(db, antes, rotulo) {
  assert.deepEqual(
    await fotografia(db),
    antes,
    `${rotulo}: algo mudou no banco`,
  );
}
async function clonarComM1(rotulo, sql = lerMig()) {
  const db = await clonar(rotulo);
  const r = await aplicar(db, sql);
  assert.ok(
    !r.erro,
    `aplicar a migration falhou: ${r.erro?.code} ${r.erro?.message}`,
  );
  return db;
}

/** `pg_stat_activity`: espera ate `ms` por `n` sessoes bloqueadas em trava neste banco. */
async function esperarBloqueio(db, ms, n = 1) {
  const fim = Date.now() + ms;
  for (;;) {
    const bloqueada = await usar(
      db,
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND pid <> pg_backend_pid()`,
          )
        ).rows[0].n,
    );
    if (bloqueada >= n) return;
    if (Date.now() > fim)
      throw new assert.AssertionError({
        message: `nenhuma sessao chegou a esperar uma trava (esperava ${n})`,
      });
    await dormir(40);
  }
}
/** Espera a migration estar DORMINDO no laco do NOWAIT (pg_sleep), sinal de que ela viu a tabela ocupada. */
async function esperarDormindo(db, ms) {
  const fim = Date.now() + ms;
  for (;;) {
    const n = await usar(
      db,
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event = 'PgSleep'
                AND pid <> pg_backend_pid()`,
          )
        ).rows[0].n,
    );
    if (n >= 1) return;
    if (Date.now() > fim)
      throw new assert.AssertionError({
        message: "a migration nao chegou a ficar tentando a trava (pg_sleep)",
      });
    await dormir(30);
  }
}
const comTempo = (p, ms, rotulo) =>
  Promise.race([
    p,
    dormir(ms).then(() => {
      throw new assert.AssertionError({
        message: `${rotulo}: nao terminou em ${ms} ms (travou)`,
      });
    }),
  ]);

// ---------------------------------------------------------------------------
// Mutacao do texto da migration/rollback
// ---------------------------------------------------------------------------
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function trocar(sql, de, para) {
  assert.ok(
    sql.includes(de),
    `o trecho a mutar nao existe: ${de.slice(0, 90)}`,
  );
  const novo = sql.replace(de, () => para);
  assert.notEqual(novo, sql);
  return novo;
}
/** Troca por `NULL;` o RAISE EXCEPTION cuja mensagem comeca em `inicio`. */
function semRaise(sql, inicio) {
  const re = new RegExp(`RAISE EXCEPTION '${escRe(inicio)}[^']*'(?:, [^;]*)?;`);
  assert.ok(re.test(sql), `nao achei o RAISE "${inicio}"`);
  return sql.replace(re, "NULL;");
}
const MSG = {
  coluna: "PREFLIGHT_20261209: public.marketplace_orders.%",
  forma:
    "PREFLIGHT_20261209: ja existe public.pedido_cobranca_ao_cancelar com outra forma",
  pk: "PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave primaria",
  fk: "PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave estrangeira",
  politica:
    "PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar tem politica",
  assinatura:
    "PREFLIGHT_20261209: ja existe public.pedido__foto_da_cobranca_ao_cancelar com outra assinatura",
  corpo:
    "PREFLIGHT_20261209: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente",
  gatilho:
    "PREFLIGHT_20261209: ja existe o gatilho tr_pedido_foto_da_cobranca_ao_cancelar",
  apareceuAgora:
    "PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar apareceu agora",
  posTabela: "POSVOO_20261209: public.pedido_cobranca_ao_cancelar nao existe",
  posRls:
    "POSVOO_20261209: public.pedido_cobranca_ao_cancelar saiu sem seguranca",
  posAclTabela:
    "POSVOO_20261209: public.pedido_cobranca_ao_cancelar saiu com privilegio",
  posAclFuncao:
    "POSVOO_20261209: public.pedido__foto_da_cobranca_ao_cancelar() saiu com EXECUTE",
  posCorpo:
    "POSVOO_20261209: public.pedido__foto_da_cobranca_ao_cancelar() saiu com o corpo",
  posGatilho:
    "POSVOO_20261209: o gatilho tr_pedido_foto_da_cobranca_ao_cancelar nao ficou",
  rbForma:
    "ROLLBACK_20261209: public.pedido_cobranca_ao_cancelar tem outra forma",
  rbChaves:
    "ROLLBACK_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave primaria",
  rbAssinatura:
    "ROLLBACK_20261209: existe public.pedido__foto_da_cobranca_ao_cancelar com outra assinatura",
  rbCorpo:
    "ROLLBACK_20261209: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente",
  rbGatilho:
    "ROLLBACK_20261209: o gatilho tr_pedido_foto_da_cobranca_ao_cancelar chama outra funcao",
  rbFuncoes: "ROLLBACK_20261209: % funcao(oes) citam",
  rbDepois: "ROLLBACK_20261209: algum objeto da 20261209000000 ainda existe",
};
const T = {
  lockNowait:
    "LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE NOWAIT;",
  lockEspera:
    "LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE;",
  orcamento: "IF v_tentativa >= 40 THEN",
  orcamentoGrande: "IF v_tentativa >= 4000 THEN",
  when: "WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')\n",
  whenSemOld: "WHEN (NEW.status = 'cancelled')\n",
  upsert:
    "ON CONFLICT (order_id) DO UPDATE\n     SET gateway_payment_id = EXCLUDED.gateway_payment_id,\n         tentativas = EXCLUDED.tentativas,\n         metodo_online = EXCLUDED.metodo_online,\n         payment_status = EXCLUDED.payment_status,\n         cancelado_em = EXCLUDED.cancelado_em;",
  doNothing: "ON CONFLICT (order_id) DO NOTHING;",
  secDef: "SECURITY DEFINER\nSET search_path = public\nAS $foto_da_cobranca$",
  semSecDef: "SET search_path = public\nAS $foto_da_cobranca$",
  semPath: "SECURITY DEFINER\nAS $foto_da_cobranca$",
  newPay: "NEW.payment_status, now())",
  oldPay: "OLD.payment_status, now())",
  rls: "ALTER TABLE public.pedido_cobranca_ao_cancelar ENABLE ROW LEVEL SECURITY;\n",
  revTabela:
    "REVOKE ALL ON TABLE public.pedido_cobranca_ao_cancelar FROM PUBLIC, anon, authenticated, service_role;\n",
  revFuncao:
    "REVOKE ALL ON FUNCTION public.pedido__foto_da_cobranca_ao_cancelar() FROM PUBLIC, anon, authenticated, service_role;\n",
  cascade: "REFERENCES public.marketplace_orders (id) ON DELETE CASCADE",
  semCascade: "REFERENCES public.marketplace_orders (id)",
  retorno: "  RETURN NULL;\n",
  retornoNew: "  RETURN NEW;\n",
};
/** O gatilho inteiro (de CREATE OR REPLACE TRIGGER ate o `;`), para tirar ou trocar. */
function gatilhoDe(sql) {
  const ini = sql.indexOf(
    "CREATE OR REPLACE TRIGGER tr_pedido_foto_da_cobranca_ao_cancelar",
  );
  assert.ok(ini >= 0, "gatilho nao achado");
  const fim = sql.indexOf(";\n", ini) + 2;
  return sql.slice(ini, fim);
}

/** Um MUTANTE tem de ser PEGO: o caso, rodado com o texto mutado, LANCA AssertionError. */
async function mutante(rotulo, caso, sqlMutado) {
  let pego = null;
  try {
    await caso(sqlMutado);
  } catch (e) {
    assert.ok(
      e instanceof assert.AssertionError,
      `${rotulo}: o mutante falhou por erro que nao e de asserção: ${e?.stack}`,
    );
    pego = e;
  }
  assert.ok(
    pego,
    `${rotulo}: o MUTANTE passou despercebido (a prova ficaria VERDE)`,
  );
  console.log(
    `     mutante "${rotulo}" -> VERMELHO: ${String(pego.message).split("\n")[0].slice(0, 200)}`,
  );
  ok(`mutante "${rotulo}" deixa a prova VERMELHA`);
}

// ===========================================================================
// BLOCO DA FOTO -- os casos (cada um recebe o texto da migration, para os mutantes)
// ===========================================================================

async function casoCatalogo(sql = lerMig()) {
  const db = await clonarComM1("catalogo", sql);
  await usar(db, async (c) => {
    const col = await c.query(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull,
              pg_get_expr(d.adbin, d.adrelid) AS padrao
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
    );
    assert.deepEqual(
      col.rows.map((l) => [l.attname, l.tipo, l.attnotnull, l.padrao]),
      [
        ["order_id", "uuid", true, null],
        ["gateway_payment_id", "text", false, null],
        ["tentativas", "integer", true, null],
        ["metodo_online", "text", false, null],
        ["payment_status", "text", false, null],
        ["cancelado_em", "timestamp with time zone", true, "now()"],
      ],
      "colunas da tabela da foto",
    );
    const ch = await c.query(
      `SELECT contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.pedido_cobranca_ao_cancelar'::regclass ORDER BY contype`,
    );
    assert.deepEqual(
      ch.rows.map((l) => l.contype),
      ["f", "p"],
      "so a chave estrangeira e a primaria",
    );
    assert.match(
      ch.rows[0].def,
      /FOREIGN KEY \(order_id\) REFERENCES marketplace_orders\(id\) ON DELETE CASCADE/,
    );
    assert.match(ch.rows[1].def, /PRIMARY KEY \(order_id\)/);

    const t = (
      await c.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas,
                obj_description(c.oid, 'pg_class') IS NOT NULL AS comentada,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                         WHERE a.grantee = 0) AS publico
           FROM pg_class c WHERE c.oid = 'public.pedido_cobranca_ao_cancelar'::regclass`,
      )
    ).rows[0];
    assert.equal(t.relrowsecurity, true, "seguranca por linha desligada");
    assert.equal(t.politicas, 0, "a tabela nao pode ter politica");
    assert.equal(t.publico, false, "PUBLIC com privilegio na tabela");
    assert.equal(t.comentada, true, "a tabela tem COMMENT");
    for (const papel of ["anon", "authenticated", "service_role"]) {
      for (const priv of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        const p = (
          await c.query(
            "SELECT has_table_privilege($1, 'public.pedido_cobranca_ao_cancelar', $2) AS p",
            [papel, priv],
          )
        ).rows[0].p;
        assert.equal(p, false, `${papel} tem ${priv} na tabela da foto`);
      }
    }
    const f = (
      await c.query(
        `SELECT p.prosecdef, p.proconfig::text AS config, p.prorettype::regtype::text AS ret,
                p.pronargs, p.provolatile,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
                obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentada
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')`,
      )
    ).rows[0];
    assert.equal(
      f.prosecdef,
      true,
      "a funcao do gatilho precisa ser SECURITY DEFINER",
    );
    assert.equal(f.config, "{search_path=public}", "search_path da funcao");
    assert.equal(f.ret, "trigger");
    assert.equal(f.pronargs, 0);
    assert.deepEqual(
      [f.publico, f.anon, f.auth, f.service],
      [false, false, false, false],
      "EXECUTE de fora na funcao do gatilho",
    );
    assert.equal(f.comentada, true, "a funcao tem COMMENT");
    const g = (
      await c.query(
        `SELECT t.tgenabled, t.tgtype, t.tgattr::text AS attr, t.tgfoid::regprocedure::text AS fn,
                a.attnum::text AS status_attnum,
                regexp_replace(lower(substring(pg_get_triggerdef(t.oid) from ' WHEN (.*) EXECUTE FUNCTION')), '[()[:space:]]', '', 'g') AS quando
           FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attname = 'status'
          WHERE t.tgrelid = 'public.marketplace_orders'::regclass AND NOT t.tgisinternal
            AND t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'`,
      )
    ).rows;
    assert.equal(g.length, 1, "o gatilho nao existe (ou existe em dobro)");
    assert.equal(g[0].tgenabled, "O");
    assert.equal(g[0].tgtype, 17, "AFTER, por linha, UPDATE");
    assert.equal(g[0].attr, g[0].status_attnum, "UPDATE OF status");
    assert.equal(
      g[0].fn,
      "pedido__foto_da_cobranca_ao_cancelar()",
      "a funcao do gatilho",
    );
    assert.equal(
      g[0].quando,
      "new.status='cancelled'::textandold.statusisdistinctfrom'cancelled'::text",
      "o WHEN do gatilho",
    );

    // ninguem de fora toca na tabela: 42501 para cada papel e cada comando
    const id = await novoPedido(c);
    for (const quem of ["anon", "comprador", "admin", "service"]) {
      for (const cmd of [
        "SELECT count(*) FROM public.pedido_cobranca_ao_cancelar",
        `INSERT INTO public.pedido_cobranca_ao_cancelar (order_id, tentativas) VALUES ('${id}', 0)`,
        "UPDATE public.pedido_cobranca_ao_cancelar SET tentativas = 9",
        "DELETE FROM public.pedido_cobranca_ao_cancelar",
        "TRUNCATE public.pedido_cobranca_ao_cancelar",
      ]) {
        const r = await como(c, quem, cmd);
        assert.equal(r.ok, false, `${quem} executou: ${cmd}`);
        assert.equal(r.code, "42501", `${quem}/${cmd}: ${r.code} ${r.message}`);
      }
      const e = await como(
        c,
        quem,
        "SELECT public.pedido__foto_da_cobranca_ao_cancelar()",
      );
      assert.equal(e.ok, false, `${quem} executou a funcao do gatilho`);
      assert.equal(e.code, "42501", `${quem} funcao: ${e.code} ${e.message}`);
    }
  });
}

async function casoCaminhos(sql = lerMig()) {
  const db = await clonarComM1("caminhos", sql);
  await usar(db, async (c) => {
    // 1. A edge: v24 + PIX gravado + cancelar_pedido_com_cobranca; depois o webhook libera a vaga.
    const a = await novoPedido(c);
    await gravarPix(c, a, "MP-PIX-A");
    const antesA = await estado(c, a);
    assert.deepEqual(
      [
        antesA.payment_status,
        antesA.tentativas_de_pagamento,
        antesA.metodo_online,
      ],
      ["aguardando", 0, "pix"],
      "pre-condicao: o PIX gerado e o que o desenho descreve",
    );
    const rA = exigir(
      await cancelarPelaEdge(c, a, U_COMPRADOR, "MP-PIX-A", "aguardando"),
      "cancelar pela edge",
    )[0].r;
    assert.equal(rA.cancelado, true, JSON.stringify(rA));
    const fA = await foto(c, a);
    mesmaCobranca(fA, antesA, "edge (PIX)");
    assert.deepEqual(
      [
        fA.gateway_payment_id,
        fA.tentativas,
        fA.metodo_online,
        fA.payment_status,
      ],
      ["MP-PIX-A", 0, "pix", "aguardando"],
      "a foto do PIX cancelado pela edge",
    );
    assert.ok(fA.cancelado_em instanceof Date);
    // o webhook consulta o MP, ve `canceled` e libera a vaga: o pedido muda, a foto NAO
    assert.equal(
      (
        await c.query(
          "SELECT public.liberar_cobranca_do_pedido($1::uuid, 'MP-PIX-A') AS ok",
          [a],
        )
      ).rows[0].ok,
      true,
      "liberar_cobranca_do_pedido nao liberou",
    );
    const depoisA = await estado(c, a);
    assert.deepEqual(
      [
        depoisA.gateway_payment_id,
        depoisA.tentativas_de_pagamento,
        depoisA.metodo_online,
      ],
      [null, 1, null],
      "pre-condicao: liberar esvazia a vaga e conta a tentativa",
    );
    assert.deepEqual(await foto(c, a), fA, "liberar mexeu na foto");

    // 2. cliente cancela o proprio pedido PIX ainda sem id (papel authenticated, sem privilegio na tabela)
    const b = await novoPedido(c);
    const antesB = await estado(c, b);
    await cancelarComo(c, "comprador", b);
    mesmaCobranca(
      await foto(c, b),
      antesB,
      "cliente cancela (sem id de cobranca)",
    );

    // 3. pedido PAGO cancelado pelo admin
    const p = await novoPedido(c);
    await c.query(
      "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-PAGO-1' WHERE id = $1",
      [p],
    );
    assert.equal(
      (
        await c.query(
          "SELECT public.confirmar_pagamento($1::uuid, 'MP-PAGO-1', 'pago') AS r",
          [p],
        )
      ).rows[0].r,
      "pago",
    );
    const antesP = await estado(c, p);
    await cancelarComo(c, "admin", p);
    const fP = await foto(c, p);
    mesmaCobranca(fP, antesP, "admin cancela pedido pago");
    assert.equal(fP.payment_status, "pago");

    // 4. cartao em analise: metodo credito + sentinela; so o admin cancela
    const k = await novoPedido(c);
    await c.query(
      `UPDATE public.marketplace_orders
          SET gateway_payment_id = 'verificando:abc123', metodo_online = 'credito',
              updated_at = now() - interval '10 minutes'
        WHERE id = $1`,
      [k],
    );
    await c.query(
      "UPDATE public.marketplace_orders SET updated_at = now() - interval '10 minutes' WHERE id = $1",
      [k],
    );
    const antesK = await estado(c, k);
    const rK = exigir(
      await cancelarPelaEdge(c, k, U_ADMIN, "verificando:abc123", "aguardando"),
      "admin cancela cartao em analise",
    )[0].r;
    assert.equal(rK.cancelado, true, JSON.stringify(rK));
    const fK = await foto(c, k);
    mesmaCobranca(fK, antesK, "cartao em analise");
    assert.deepEqual(
      [fK.gateway_payment_id, fK.metodo_online],
      ["verificando:abc123", "credito"],
    );

    // 5. expiracao pelo agendador: sai com payment_status 'expirado'
    const e = await novoPedido(c);
    await c.query(
      "UPDATE public.marketplace_orders SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [e],
    );
    const n = await c.query("SELECT public.expirar_pedidos_vencidos() AS n");
    assert.equal(Number(n.rows[0].n), 1, "expirar_pedidos_vencidos");
    const antesE = await estado(c, e);
    assert.equal(antesE.status, "cancelled");
    assert.equal(antesE.payment_status, "expirado");
    const fE = await foto(c, e);
    assert.ok(fE, "expiracao: sem foto");
    assert.equal(
      fE.payment_status,
      "expirado",
      "a foto da expiracao tem de ser a do NEW (expirado), nao a do OLD",
    );
    assert.equal(fE.tentativas, 0);

    // 6. "na entrega" (v23): sem PIX, sem metodo online
    const v = await novoPedido(c, "create_marketplace_order_v23");
    const antesV = await estado(c, v);
    await cancelarComo(c, "comprador", v);
    const fV = await foto(c, v);
    mesmaCobranca(fV, antesV, "v23 na entrega");
    assert.deepEqual([fV.gateway_payment_id, fV.metodo_online], [null, null]);

    // 7. pedido__mudar_status direto
    const m = await novoPedido(c);
    await gravarPix(c, m, "MP-QR-1");
    const antesM = await estado(c, m);
    await c.query(
      "SELECT public.pedido__mudar_status($1::uuid, 'cancelled', NULL, $2::uuid, false, true)",
      [m, U_COMPRADOR],
    );
    mesmaCobranca(await foto(c, m), antesM, "pedido__mudar_status");

    // 8. UPDATE cru de superusuario (sem passar por RPC nenhuma)
    const u = await novoPedido(c);
    const antesU = await estado(c, u);
    await c.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      [u],
    );
    mesmaCobranca(await foto(c, u), antesU, "UPDATE cru");

    // 9. UPDATE direto (sem RPC) por um papel SEM privilegio na tabela da foto, como faz o
    //    PostgREST ou uma edge: quem grava a foto e a funcao do gatilho (SECURITY DEFINER).
    //    No Supabase o service_role tem BYPASSRLS; o provisionar.cjs nao o da, entao a prova o da.
    const d = await novoPedido(c);
    await c.query("ALTER ROLE service_role BYPASSRLS");
    try {
      const antesD = await estado(c, d);
      const rD = exigir(
        await como(
          c,
          "service",
          "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1 RETURNING id",
          [d],
        ),
        "UPDATE direto como service_role",
      );
      assert.equal(rD.length, 1, "o UPDATE direto nao alcancou o pedido");
      mesmaCobranca(await foto(c, d), antesD, "UPDATE direto do service_role");
    } finally {
      await c.query("ALTER ROLE service_role NOBYPASSRLS");
    }

    assert.equal(
      await totalFotos(c),
      9,
      "uma foto por pedido cancelado, nenhuma a mais",
    );
  });
}

async function casoRecancelar(sql = lerMig()) {
  const db = await clonarComM1("recancelar", sql);
  await usar(db, async (c) => {
    const id = await novoPedido(c);
    await gravarPix(c, id, "MP-PIX-R");
    exigir(
      await cancelarPelaEdge(c, id, U_COMPRADOR, "MP-PIX-R", "aguardando"),
      "cancelar",
    );
    const f1 = await foto(c, id);
    assert.ok(f1, "sem foto no primeiro cancelamento");
    // o webhook libera a vaga: o pedido muda (vaga vazia, tentativas 1), a foto deve ficar
    await c.query(
      "SELECT public.liberar_cobranca_do_pedido($1::uuid, 'MP-PIX-R')",
      [id],
    );
    await dormir(30);
    // (a) UPDATE cru com o mesmo status, mudando outra coluna na mesma instrucao
    await c.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled', notes = 'de novo' WHERE id = $1",
      [id],
    );
    assert.deepEqual(
      await foto(c, id),
      f1,
      "UPDATE com status repetido regravou a foto",
    );
    // (b) a RPC do cliente/admin sobre pedido ja cancelado (recusa ou ja-estava, tanto faz)
    await como(
      c,
      "comprador",
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled')",
      [id],
    );
    await como(
      c,
      "admin",
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled')",
      [id],
    );
    assert.deepEqual(
      await foto(c, id),
      f1,
      "recancelar pela RPC regravou a foto",
    );
    // (c) a edge de novo
    await cancelarPelaEdge(c, id, U_COMPRADOR, null, "aguardando");
    assert.deepEqual(
      await foto(c, id),
      f1,
      "recancelar pela edge regravou a foto",
    );
    assert.equal(await totalFotos(c), 1);
  });
}

async function casoReativar(sql = lerMig()) {
  const db = await clonarComM1("reativar", sql);
  await usar(db, async (c) => {
    const id = await novoPedido(c);
    await gravarPix(c, id, "MP-PIX-V");
    exigir(
      await cancelarPelaEdge(c, id, U_COMPRADOR, "MP-PIX-V", "aguardando"),
      "1o cancelamento",
    );
    const f1 = await foto(c, id);
    assert.deepEqual(
      [
        f1.gateway_payment_id,
        f1.tentativas,
        f1.metodo_online,
        f1.payment_status,
      ],
      ["MP-PIX-V", 0, "pix", "aguardando"],
    );
    // o admin reativa o pedido (pedido__mudar_status nao barra o admin saindo de cancelled)
    exigir(
      await como(
        c,
        "admin",
        "SELECT public.update_order_status_atomic($1::uuid, 'pending') AS r",
        [id],
      ),
      "admin reativa",
    );
    assert.equal((await estado(c, id)).status, "pending");
    assert.deepEqual(
      await foto(c, id),
      f1,
      "reativar nao muda a foto (so o proximo cancelamento)",
    );
    // no meio, um cartao e tentado (vaga com sentinela, tentativas somadas)
    await c.query(
      `UPDATE public.marketplace_orders
          SET gateway_payment_id = 'verificando:zzz', metodo_online = 'credito',
              tentativas_de_pagamento = 2, payment_status = 'aguardando'
        WHERE id = $1`,
      [id],
    );
    await c.query(
      "UPDATE public.marketplace_orders SET updated_at = now() - interval '10 minutes' WHERE id = $1",
      [id],
    );
    const antes2 = await estado(c, id);
    // cobranca de cartao aberta (sentinela): so a edge cancela, pelo admin
    const r2 = exigir(
      await cancelarPelaEdge(c, id, U_ADMIN, "verificando:zzz", "aguardando"),
      "2o cancelamento",
    )[0].r;
    assert.equal(r2.cancelado, true, JSON.stringify(r2));
    const f2 = await foto(c, id);
    mesmaCobranca(f2, antes2, "2o cancelamento");
    assert.deepEqual(
      [f2.gateway_payment_id, f2.tentativas, f2.metodo_online],
      ["verificando:zzz", 2, "credito"],
      "a foto nova tem de mostrar o cartao tentado (lado seguro)",
    );
    assert.ok(f2.cancelado_em > f1.cancelado_em, "cancelado_em nao avancou");
    assert.equal(await totalFotos(c), 1, "uma foto por pedido, sobrescrita");
  });
}

async function casoNaoDispara(sql = lerMig()) {
  const db = await clonarComM1("naodispara", sql);
  await usar(db, async (c) => {
    const id = await novoPedido(c);
    await c.query(
      "UPDATE public.marketplace_orders SET notes = 'x', tracking_code = 'AB123' WHERE id = $1",
      [id],
    );
    await c.query(
      "UPDATE public.marketplace_orders SET payment_status = 'aguardando', gateway_payment_id = 'G1' WHERE id = $1",
      [id],
    );
    await c.query(
      "UPDATE public.marketplace_orders SET status = status WHERE id = $1",
      [id],
    );
    await c.query(
      "UPDATE public.marketplace_orders SET status = 'pending' WHERE id = $1",
      [id],
    );
    exigir(
      await como(
        c,
        "admin",
        "SELECT public.update_order_status_atomic($1::uuid, 'processing') AS r",
        [id],
      ),
      "processing",
    );
    exigir(
      await como(
        c,
        "admin",
        "SELECT public.update_order_status_atomic($1::uuid, 'shipping') AS r",
        [id],
      ),
      "shipping",
    );
    assert.equal(
      await totalFotos(c),
      0,
      "algo que nao e cancelamento gravou foto",
    );
    // um pedido que nasce e nao e cancelado nao tem foto; o INSERT de um pedido ja cancelado tambem nao
    const novo = await c.query(
      `INSERT INTO public.marketplace_orders (customer_name, customer_data, total, subtotal, status)
       VALUES ('Nasce cancelado', '{}'::jsonb, 10, 10, 'cancelled') RETURNING id`,
    );
    assert.equal(await foto(c, novo.rows[0].id), undefined);
    assert.equal(await totalFotos(c), 0);
    // e depois do cancelamento real, so UPDATE de outras colunas: a linha da foto nao e reescrita
    const outro = await novoPedido(c);
    await cancelarComo(c, "comprador", outro);
    const f = await foto(c, outro);
    await c.query(
      "UPDATE public.marketplace_orders SET notes = 'depois', tracking_code = 'ZZ' WHERE id = $1",
      [outro],
    );
    assert.deepEqual(
      await foto(c, outro),
      f,
      "UPDATE de outra coluna mexeu na foto",
    );
  });
}

async function casoSimultaneo(sql = lerMig()) {
  const db = await clonarComM1("simultaneo", sql);
  const a = new Client({ connectionString: urlDe(db) });
  const b = new Client({ connectionString: urlDe(db) });
  await a.connect();
  await b.connect();
  try {
    // (1) UPDATE cru: o segundo espera a linha do primeiro e, depois do COMMIT, ve o pedido ja cancelado
    const id = await novoPedido(a);
    await gravarPix(a, id, "MP-SIM-1");
    await a.query("BEGIN");
    await a.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      [id],
    );
    await b.query("BEGIN");
    const emB = b
      .query(
        "UPDATE public.marketplace_orders SET status = 'cancelled', payment_status = 'expirado' WHERE id = $1",
        [id],
      )
      .then(
        () => ({ ok: true }),
        (erro) => ({ erro }),
      );
    await esperarBloqueio(db, 4000);
    await a.query("COMMIT");
    const rB = await comTempo(emB, 8000, "2o cancelamento");
    assert.ok(!rB.erro, `o 2o cancelamento falhou: ${rB.erro?.message}`);
    await b.query("COMMIT");
    const fs1 = (
      await a.query(
        "SELECT * FROM public.pedido_cobranca_ao_cancelar WHERE order_id = $1",
        [id],
      )
    ).rows;
    assert.equal(fs1.length, 1, "dois cancelamentos geraram mais de uma foto");
    assert.equal(
      fs1[0].payment_status,
      "aguardando",
      "a foto tem de ser a do PRIMEIRO cancelamento (o segundo nao dispara o gatilho)",
    );
    assert.equal(fs1[0].gateway_payment_id, "MP-SIM-1");
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    await b.query("ROLLBACK").catch(() => {});
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
  // (2) a RPC do cliente chamada ao mesmo tempo de duas sessoes
  await usar(db, async (c) => {
    const id = await novoPedido(c);
    const c1 = new Client({ connectionString: urlDe(db) });
    const c2 = new Client({ connectionString: urlDe(db) });
    await c1.connect();
    await c2.connect();
    try {
      const [r1, r2] = await comTempo(
        Promise.all([
          como(
            c1,
            "comprador",
            "SELECT public.update_order_status_atomic($1::uuid, 'cancelled') AS r",
            [id],
          ),
          como(
            c2,
            "comprador",
            "SELECT public.update_order_status_atomic($1::uuid, 'cancelled') AS r",
            [id],
          ),
        ]),
        10000,
        "duas RPCs",
      );
      assert.ok(r1.ok || r2.ok, "nenhuma das duas cancelou");
      const n = await c.query(
        "SELECT count(*)::int AS n FROM public.pedido_cobranca_ao_cancelar WHERE order_id = $1",
        [id],
      );
      assert.equal(
        n.rows[0].n,
        1,
        "duas RPCs simultaneas geraram mais de uma foto",
      );
    } finally {
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }
  });
}

async function casoCascata(sql = lerMig()) {
  const db = await clonarComM1("cascata", sql);
  await usar(db, async (c) => {
    const r = await c.query(
      `INSERT INTO public.marketplace_orders (customer_name, customer_data, total, subtotal, status)
       VALUES ('Apagavel', '{}'::jsonb, 10, 10, 'pending') RETURNING id`,
    );
    const id = r.rows[0].id;
    await c.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      [id],
    );
    assert.ok(await foto(c, id), "sem foto antes de apagar");
    try {
      await c.query("DELETE FROM public.marketplace_orders WHERE id = $1", [
        id,
      ]);
    } catch (e) {
      throw new assert.AssertionError({
        message: `apagar o pedido falhou por causa da foto (sem CASCADE): ${e.code} ${e.message}`,
      });
    }
    assert.equal(
      await foto(c, id),
      undefined,
      "apagar o pedido nao apagou a foto (CASCADE)",
    );
  });
}

/** Dado que JA existia antes da migration: pedido cancelado, pedido em andamento. */
async function casoDadoAntigo(sql = lerMig()) {
  const db = await clonar("dadoantigo");
  let velho;
  let pendente;
  await usar(db, async (c) => {
    velho = await novoPedido(c);
    await gravarPix(c, velho, "MP-VELHO");
    // a edge ja anulou a cobranca no MP (p_pela_edge) e o pedido vira cancelled
    await c.query(
      "SELECT public.pedido__mudar_status($1::uuid, 'cancelled', NULL, $2::uuid, false, true)",
      [velho, U_COMPRADOR],
    );
    assert.equal((await estado(c, velho)).status, "cancelled");
    pendente = await novoPedido(c);
    assert.equal(
      (
        await c.query(
          "SELECT to_regclass('public.pedido_cobranca_ao_cancelar') AS t",
        )
      ).rows[0].t,
      null,
      "pre-condicao: o estado pre nao tem a tabela",
    );
  });
  const pedidosAntes = (await fotografia(db)).pedidos;
  const r = await aplicar(db, sql);
  assert.ok(!r.erro, `aplicar com dado antigo falhou: ${r.erro?.message}`);
  await usar(db, async (c) => {
    assert.equal(
      await totalFotos(c),
      0,
      "a migration preencheu foto retroativamente",
    );
    assert.equal(
      (await fotografia(db)).pedidos,
      pedidosAntes,
      "a migration mexeu em pedido",
    );
    // "recancelar" o pedido que ja estava cancelado antes: nao dispara, segue sem foto (prazo de hoje)
    await c.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      [velho],
    );
    assert.equal(
      await foto(c, velho),
      undefined,
      "pedido cancelado antes ganhou foto ao ser recancelado",
    );
    // o pedido que estava em andamento ganha foto quando for cancelado agora
    const antes = await estado(c, pendente);
    await cancelarComo(c, "comprador", pendente);
    mesmaCobranca(
      await foto(c, pendente),
      antes,
      "pedido em andamento antes da migration",
    );
    assert.equal(await totalFotos(c), 1);
  });
}

// ----------------------------------------------------------- ida e volta, atomicidade
async function casoIdempotente(sql = lerMig()) {
  const db = await clonar("idempotente");
  const r1 = await aplicar(db, sql);
  assert.ok(!r1.erro, `1a aplicacao falhou: ${r1.erro?.message}`);
  await usar(db, async (c) => {
    const id = await novoPedido(c);
    await gravarPix(c, id, "MP-IDEM");
    exigir(
      await cancelarPelaEdge(c, id, U_COMPRADOR, "MP-IDEM", "aguardando"),
      "cancelar pela edge",
    );
  });
  const meio = await fotografia(db);
  const fotoAntes = await usar(
    db,
    async (c) =>
      (await c.query("SELECT * FROM public.pedido_cobranca_ao_cancelar")).rows,
  );
  // o texto com fim de linha CRLF (checkout Windows) grava o corpo da funcao em CRLF: so o
  // md5 das funcoes muda (o pre-voo aceita os dois corpos); o LF seguinte restaura tudo
  for (const [rot, texto, igual] of [
    ["2a", sql, true],
    ["3a (CRLF)", crlf(sql), false],
    ["4a (LF de novo)", sql, true],
  ]) {
    const r = await aplicar(db, texto);
    assert.ok(
      !r.erro,
      `${rot} aplicacao falhou: ${r.erro?.code} ${r.erro?.message}`,
    );
    const agora = await fotografia(db);
    assert.deepEqual(
      igual ? agora : { ...agora, funcoes: meio.funcoes },
      meio,
      `${rot} aplicacao mudou algo`,
    );
  }
  const fotoDepois = await usar(
    db,
    async (c) =>
      (await c.query("SELECT * FROM public.pedido_cobranca_ao_cancelar")).rows,
  );
  assert.deepEqual(fotoDepois, fotoAntes, "reaplicar mexeu nas fotos gravadas");
}
async function casoAtomico(sql = lerMig()) {
  const db = await clonar("atomico");
  const antes = await fotografia(db);
  const r = await aplicar(db, `${sql}\nSELECT 1/0;\n`);
  assert.ok(r.erro, "a divisao por zero tem de falhar");
  assert.equal(r.erro.code, "22012", r.erro.message);
  await nadaGravado(db, antes, "falha depois da ultima peca");
  const r2 = await aplicar(db, `BEGIN;\n${sql}\nROLLBACK;\n`);
  assert.ok(!r2.erro, r2.erro?.message);
  await nadaGravado(db, antes, "BEGIN ... ROLLBACK");
  const r3 = await aplicar(db, `BEGIN;\n${sql}\nCOMMIT;\n`);
  assert.ok(!r3.erro, r3.erro?.message);
  assert.equal(
    await usar(
      db,
      async (c) =>
        (
          await c.query(
            "SELECT to_regclass('public.pedido_cobranca_ao_cancelar') AS t",
          )
        ).rows[0].t,
    ),
    "pedido_cobranca_ao_cancelar",
  );
}
async function casoIdaEVolta(sql = lerMig(), rb = lerRb()) {
  const db = await clonar("idavolta");
  const pre = await fotografia(db);
  assert.equal(pre.tabela.length, 0, "pre-condicao: sem a tabela");
  let aplicada = null;
  for (let volta = 1; volta <= 2; volta += 1) {
    const r = await aplicar(db, sql);
    assert.ok(
      !r.erro,
      `aplicar (volta ${volta}): ${r.erro?.code} ${r.erro?.message}`,
    );
    const noAr = await fotografia(db);
    if (aplicada)
      assert.deepEqual(
        { ...noAr, pedidos: null },
        { ...aplicada, pedidos: null },
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
    aplicada = noAr;
    // cria foto de verdade em cada volta
    await usar(db, async (c) => {
      const id = await novoPedido(c);
      await gravarPix(c, id, `MP-IV-${volta}`);
      exigir(
        await cancelarPelaEdge(
          c,
          id,
          U_COMPRADOR,
          `MP-IV-${volta}`,
          "aguardando",
        ),
        "cancelar",
      );
      assert.ok(await foto(c, id), "sem foto depois de reaplicar");
    });
    const pedidosComFoto = (await fotografia(db)).pedidos;
    const rr = await aplicar(db, rb);
    assert.ok(
      !rr.erro,
      `rollback (volta ${volta}): ${rr.erro?.code} ${rr.erro?.message}`,
    );
    const volt = await fotografia(db);
    assert.deepEqual(
      { ...volt, pedidos: null },
      { ...pre, pedidos: null },
      "o catalogo nao voltou EXATO ao do estado pre",
    );
    assert.equal(volt.pedidos, pedidosComFoto, "o rollback mexeu em pedido");
    // rollback repetido: no-op
    const rr2 = await aplicar(db, rb);
    assert.ok(!rr2.erro, `rollback repetido: ${rr2.erro?.message}`);
    assert.deepEqual(
      await fotografia(db),
      volt,
      "rollback repetido mudou algo",
    );
    // CRLF tambem
    const rr3 = await aplicar(db, crlf(rb));
    assert.ok(!rr3.erro, `rollback CRLF: ${rr3.erro?.message}`);
  }
  // por fim: aplica, e ainda reaplica a migration de novo (idempotente por cima)
  const r = await aplicar(db, sql);
  assert.ok(!r.erro);
  const r2 = await aplicar(db, sql);
  assert.ok(!r2.erro);
}

// ----------------------------------------------------------- pre-voo e rollback que recusam
async function casoPreVooColuna(sql = lerMig()) {
  const db = await clonar("pvcol");
  await usar(db, (c) =>
    c.query(
      "ALTER TABLE public.marketplace_orders RENAME COLUMN tentativas_de_pagamento TO tentativas_x",
    ),
  );
  const antes = await fotografia(db);
  recusou(
    await aplicar(db, sql),
    /tentativas_de_pagamento \(integer\) ausente ou em outra forma/,
    "coluna ausente",
  );
  await nadaGravado(db, antes, "coluna ausente");
}
async function casoPreVooTabela(sql = lerMig(), so = null) {
  const variantes = [
    [
      "forma",
      "CREATE TABLE public.pedido_cobranca_ao_cancelar (order_id uuid PRIMARY KEY, x integer)",
      /ja existe public\.pedido_cobranca_ao_cancelar com outra forma de colunas/,
      MSG.forma,
    ],
    [
      "pk",
      "CREATE TABLE public.pedido_cobranca_ao_cancelar (order_id uuid NOT NULL REFERENCES public.marketplace_orders (id) ON DELETE CASCADE, gateway_payment_id text, tentativas integer NOT NULL, metodo_online text, payment_status text, cancelado_em timestamptz NOT NULL DEFAULT now())",
      /nao tem a chave primaria em order_id/,
      MSG.pk,
    ],
    [
      "fk",
      "CREATE TABLE public.pedido_cobranca_ao_cancelar (order_id uuid PRIMARY KEY REFERENCES public.marketplace_orders (id), gateway_payment_id text, tentativas integer NOT NULL, metodo_online text, payment_status text, cancelado_em timestamptz NOT NULL DEFAULT now())",
      /nao tem a chave estrangeira para marketplace_orders com ON DELETE CASCADE/,
      MSG.fk,
    ],
  ].filter((v) => !so || v[0] === so);
  for (const [rot, ddl, trecho] of variantes) {
    const db = await clonar("pvtab");
    await usar(db, (c) => c.query(ddl));
    const antes = await fotografia(db);
    recusou(await aplicar(db, sql), trecho, `tabela ${rot}`);
    await nadaGravado(db, antes, `tabela ${rot}`);
  }
}
async function casoPreVooPolitica(sql = lerMig()) {
  const db = await clonar("pvpol");
  const r0 = await aplicar(db, lerMig());
  assert.ok(!r0.erro, r0.erro?.message);
  await usar(db, (c) =>
    c.query(
      "CREATE POLICY p_alheia ON public.pedido_cobranca_ao_cancelar FOR SELECT USING (true)",
    ),
  );
  const antes = await fotografia(db);
  recusou(
    await aplicar(db, sql),
    /pedido_cobranca_ao_cancelar tem politica de seguranca por linha/,
    "politica",
  );
  await nadaGravado(db, antes, "politica");
}
async function casoPreVooFuncao(sql = lerMig(), so = null) {
  const variantes = [
    [
      "assinatura",
      "CREATE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar(p integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$",
      /ja existe public\.pedido__foto_da_cobranca_ao_cancelar com outra assinatura/,
    ],
    [
      "corpo",
      "CREATE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$",
      /pedido__foto_da_cobranca_ao_cancelar\(\) tem corpo diferente do desta migration/,
    ],
  ].filter((v) => !so || v[0] === so);
  for (const [rot, ddl, trecho] of variantes) {
    const db = await clonar("pvfn");
    await usar(db, (c) => c.query(ddl));
    const antes = await fotografia(db);
    recusou(await aplicar(db, sql), trecho, `funcao ${rot}`);
    await nadaGravado(db, antes, `funcao ${rot}`);
  }
}
async function casoPreVooGatilho(sql = lerMig()) {
  const db = await clonar("pvtg");
  await usar(db, async (c) => {
    await c.query(
      "CREATE FUNCTION public.fn_alheia_pa() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$",
    );
    await c.query(
      "CREATE TRIGGER tr_pedido_foto_da_cobranca_ao_cancelar AFTER UPDATE ON public.marketplace_orders FOR EACH ROW EXECUTE FUNCTION public.fn_alheia_pa()",
    );
  });
  const antes = await fotografia(db);
  recusou(
    await aplicar(db, sql),
    /ja existe o gatilho tr_pedido_foto_da_cobranca_ao_cancelar em marketplace_orders com outra definicao/,
    "gatilho alheio",
  );
  await nadaGravado(db, antes, "gatilho alheio");
}

/** Pos-voo: cada peca quebrada de proposito derruba a migration inteira (nada fica). */
async function casoPosvoo(sqlQuebrado, trecho, rotulo) {
  const db = await clonar("posvoo");
  const antes = await fotografia(db);
  const r = await aplicar(db, sqlQuebrado);
  recusou(r, trecho, `pos-voo: ${rotulo}`);
  await nadaGravado(db, antes, `pos-voo: ${rotulo}`);
}
function quebras(base = lerMig()) {
  return [
    {
      rotulo: "sem seguranca por linha",
      msg: MSG.posRls,
      trecho: /saiu sem seguranca por linha ligada ou com politica/,
      sql: trocar(base, T.rls, ""),
    },
    {
      rotulo: "privilegio sobrando na tabela",
      msg: MSG.posAclTabela,
      trecho:
        /saiu com privilegio para PUBLIC, anon, authenticated ou service_role/,
      sql: trocar(base, T.revTabela, ""),
    },
    {
      rotulo: "EXECUTE sobrando na funcao",
      msg: MSG.posAclFuncao,
      trecho:
        /saiu com EXECUTE para PUBLIC, anon, authenticated ou service_role/,
      sql: trocar(base, T.revFuncao, ""),
    },
    {
      rotulo: "corpo da funcao diferente",
      msg: MSG.posCorpo,
      trecho: /saiu com o corpo \(hash/,
      sql: trocar(base, T.retorno, T.retornoNew),
    },
    {
      rotulo: "gatilho sem o WHEN",
      msg: MSG.posGatilho,
      trecho:
        /o gatilho tr_pedido_foto_da_cobranca_ao_cancelar nao ficou como esperado/,
      sql: trocar(base, T.when, ""),
    },
    {
      rotulo: "sem gatilho",
      msg: MSG.posGatilho,
      trecho:
        /o gatilho tr_pedido_foto_da_cobranca_ao_cancelar nao ficou como esperado/,
      sql: trocar(base, gatilhoDe(base), ""),
    },
  ];
}

// ----------------------------------------------------------- rollback que recusa
async function casoRollbackRecusa(rb = lerRb(), so = null) {
  const prepara = async (rot) => {
    const db = await clonar(`rb${rot}`);
    const r = await aplicar(db, lerMig());
    assert.ok(!r.erro, r.erro?.message);
    return db;
  };
  const variantes = [
    {
      rot: "funcao",
      ddl: `CREATE FUNCTION public.fn_le_a_foto_pa() RETURNS bigint LANGUAGE plpgsql AS $f$
              BEGIN RETURN (SELECT count(*) FROM public.pedido_cobranca_ao_cancelar); END $f$`,
      trecho:
        /1 funcao\(oes\) citam pedido_cobranca_ao_cancelar \(public\.fn_le_a_foto_pa\)/,
    },
    {
      rot: "funcao fora de public",
      ddl: `CREATE SCHEMA priv_pa;
            CREATE FUNCTION priv_pa.f() RETURNS bigint LANGUAGE plpgsql AS $f$
              BEGIN RETURN (SELECT count(*) FROM public.pedido_cobranca_ao_cancelar); END $f$`,
      trecho: /funcao\(oes\) citam pedido_cobranca_ao_cancelar \(priv_pa\.f\)/,
    },
    {
      rot: "tabela alheia",
      ddl: `DROP TABLE public.pedido_cobranca_ao_cancelar CASCADE;
            CREATE TABLE public.pedido_cobranca_ao_cancelar (order_id uuid PRIMARY KEY, x integer)`,
      trecho: /pedido_cobranca_ao_cancelar tem outra forma de colunas/,
    },
    {
      rot: "funcao com outra assinatura",
      ddl: "CREATE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar(p integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$",
      trecho:
        /existe public\.pedido__foto_da_cobranca_ao_cancelar com outra assinatura/,
    },
    {
      rot: "gatilho alheio",
      ddl: `CREATE FUNCTION public.fn_alheia_pa() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$;
            DROP TRIGGER tr_pedido_foto_da_cobranca_ao_cancelar ON public.marketplace_orders;
            CREATE TRIGGER tr_pedido_foto_da_cobranca_ao_cancelar AFTER UPDATE ON public.marketplace_orders
              FOR EACH ROW EXECUTE FUNCTION public.fn_alheia_pa()`,
      trecho:
        /o gatilho tr_pedido_foto_da_cobranca_ao_cancelar chama outra funcao/,
    },
  ].filter((v) => !so || v.rot === so);
  for (const v of variantes) {
    const db = await prepara(v.rot.replace(/\W/g, ""));
    await usar(db, (c) => c.query(v.ddl));
    const antes = await fotografia(db);
    const r = await aplicar(db, rb);
    recusou(r, v.trecho, `rollback com ${v.rot}`);
    await nadaGravado(db, antes, `rollback com ${v.rot}`);
  }
  // visao dependente: o DROP TABLE sem CASCADE recusa e nada e apagado
  if (!so || so === "visao") {
    const db = await prepara("visao");
    await usar(db, (c) =>
      c.query(
        "CREATE VIEW public.vw_foto_pa AS SELECT order_id FROM public.pedido_cobranca_ao_cancelar",
      ),
    );
    const antes = await fotografia(db);
    const r = await aplicar(db, rb);
    assert.ok(r.erro, "o rollback apagou a tabela que uma visao usa");
    assert.equal(r.erro.code, "2BP01", `${r.erro.code} ${r.erro.message}`);
    await nadaGravado(db, antes, "rollback com visao dependente");
  }
}
/** O ultimo guarda do rollback: depois dele nao pode sobrar objeto (a conferencia final). */
async function casoRollbackConfere(rb = lerRb()) {
  const db = await clonarComM1("rbconfere");
  const quebrado = trocar(
    rb,
    "DROP TABLE IF EXISTS public.pedido_cobranca_ao_cancelar;",
    "-- DROP removido pelo caso",
  );
  const antes = await fotografia(db);
  const r = await aplicar(db, quebrado);
  recusou(
    r,
    /algum objeto da 20261209000000 ainda existe depois do rollback/,
    "rollback que deixa a tabela",
  );
  await nadaGravado(db, antes, "rollback que deixa a tabela");
}

// ----------------------------------------------------------- envelope de producao, trava e deadlock
async function casoEnvelopeFeliz(sql = lerMig()) {
  const db = await clonar("rrok");
  const r = await emEnvelopeRR(db, sql);
  assert.ok(
    !r.erro,
    `no envelope REPEATABLE READ sem concorrente falhou: ${r.erro?.code} ${r.erro?.message}`,
  );
  const g = await usar(
    db,
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'",
        )
      ).rows[0].n,
  );
  assert.equal(g, 1);
}
/** Um pedido em andamento segura a tabela: a migration ESPERA (dormindo, sem entrar na fila) e aplica. */
async function casoEnvelopeEspera(sql = lerMig()) {
  const db = await clonar("rrespera");
  const ped = await usar(db, (c) => novoPedido(c));
  const p = new Client({ connectionString: urlDe(db) });
  await p.connect();
  try {
    await p.query("BEGIN");
    await p.query(
      "UPDATE public.marketplace_orders SET notes = 'em andamento' WHERE id = $1",
      [ped],
    );
    const t0 = Date.now();
    const emM = emEnvelopeRR(db, sql);
    await esperarDormindo(db, 6000);
    await dormir(400);
    await p.query("COMMIT");
    const r = await comTempo(emM, 15000, "migration esperando o pedido");
    assert.ok(
      !r.erro,
      `a migration devia esperar o pedido e aplicar: ${r.erro?.code} ${r.erro?.message}`,
    );
    assert.ok(Date.now() - t0 >= 400, "a migration nao esperou o pedido");
  } finally {
    await p.query("ROLLBACK").catch(() => {});
    await p.end().catch(() => {});
  }
  const n = await usar(
    db,
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'",
        )
      ).rows[0].n,
  );
  assert.equal(n, 1, "a migration nao aplicou depois do pedido");
}
/** A tabela ocupada por mais de 4 s: recusa (55P03) sem gravar nada. */
async function casoEnvelopeOcupada(sql = lerMig()) {
  const db = await clonar("rrocupada");
  const ped = await usar(db, (c) => novoPedido(c));
  const antes = await fotografia(db);
  const p = new Client({ connectionString: urlDe(db) });
  await p.connect();
  try {
    await p.query("BEGIN");
    await p.query(
      "UPDATE public.marketplace_orders SET notes = 'preso' WHERE id = $1",
      [ped],
    );
    const t0 = Date.now();
    const r = await emEnvelopeRR(db, sql);
    const ms = Date.now() - t0;
    assert.ok(r.erro, "com a tabela presa a migration tem de recusar");
    assert.equal(
      r.erro.code,
      "55P03",
      `esperava 55P03: ${r.erro.code} ${r.erro.message}`,
    );
    assert.match(
      r.erro.message,
      /marketplace_orders ficou ocupada por mais de 4 s/,
    );
    assert.ok(ms >= 3500 && ms < 15000, `orcamento de 4 s: levou ${ms} ms`);
  } finally {
    await p.query("ROLLBACK").catch(() => {});
    await p.end().catch(() => {});
  }
  await nadaGravado(db, antes, "tabela ocupada");
}
/**
 * O CHECKOUT NAO PARA ENQUANTO A MIGRATION ESPERA. T1 segura a tabela de pedidos (gravou num
 * pedido, em transacao aberta); a migration chega e nao consegue a trava; T2 (outro pedido,
 * que ja segura a linha do cupom) quer gravar em `marketplace_orders`. Se a migration ESPERA NA
 * FILA da trava, T2 fica parado atras dela ate T1 acabar (ou, com o cruzamento abaixo, ate o
 * Postgres desfazer o ciclo "mole" depois de deadlock_timeout = 1 s). Se ela so TENTA (NOWAIT)
 * e dorme, T2 passa na hora. Depois T1 pede a linha do cupom que T2 segura (o cruzamento que
 * fecha o ciclo no mutante): nenhum dos dois pode levar 40P01, os dois dao COMMIT e a migration
 * aplica no fim.
 */
async function casoCruzado(sql = lerMig()) {
  const db = await clonar("cruzado");
  const [x, y] = await usar(db, async (c) => [
    await novoPedido(c),
    await novoPedido(c),
  ]);
  const t1 = new Client({ connectionString: urlDe(db) });
  const t2 = new Client({ connectionString: urlDe(db) });
  await t1.connect();
  await t2.connect();
  const erros = [];
  const registrar = (rotulo) => (erro) => {
    erros.push(`${rotulo}: ${erro.code} ${erro.message}`);
    return { erro };
  };
  try {
    await t1.query("BEGIN");
    await t1.query(
      "UPDATE public.marketplace_orders SET notes = 't1' WHERE id = $1",
      [x],
    );
    await t2.query("BEGIN");
    await t2.query(
      "SELECT id FROM public.coupons WHERE code = 'FOTOK' FOR UPDATE",
    );
    const emM = emEnvelopeRR(db, sql).then((r) => {
      if (r.erro) erros.push(`migration: ${r.erro.code} ${r.erro.message}`);
      return r;
    });
    await dormir(700); // a migration ja chegou e nao tem a trava (T1 segura a tabela)
    // T2 quer a tabela de pedidos agora
    const t0 = Date.now();
    const p2 = t2
      .query(
        "UPDATE public.marketplace_orders SET notes = 't2' WHERE id = $1",
        [y],
      )
      .then(() => ({ ok: true }), registrar("pedido T2 (quer a tabela)"));
    const r2 = await comTempo(p2, 9000, "T2");
    const ms2 = Date.now() - t0;
    assert.ok(
      ms2 < 1500,
      `o pedido que chegou com a migration esperando ficou parado ${ms2} ms (a migration esta na fila da trava: o checkout para)`,
    );
    // T1 pede a linha do cupom que T2 segura: T2 precisa dar COMMIT para T1 seguir
    const p1 = t1
      .query("SELECT id FROM public.coupons WHERE code = 'FOTOK' FOR UPDATE")
      .then(() => ({ ok: true }), registrar("pedido T1 (quer o cupom)"));
    await dormir(200);
    if (!r2.erro) await t2.query("COMMIT").catch(registrar("commit T2"));
    const r1 = await comTempo(p1, 9000, "T1");
    if (!r1.erro) await t1.query("COMMIT").catch(registrar("commit T1"));
    const rM = await comTempo(emM, 20000, "migration");
    assert.deepEqual(
      erros,
      [],
      `houve erro no cruzamento (40P01 = deadlock): ${erros.join(" | ")}`,
    );
    assert.ok(!rM.erro, "a migration devia aplicar no fim");
  } finally {
    await t1.query("ROLLBACK").catch(() => {});
    await t2.query("ROLLBACK").catch(() => {});
    await t1.end().catch(() => {});
    await t2.end().catch(() => {});
  }
  const n = await usar(
    db,
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'",
        )
      ).rows[0].n,
  );
  assert.equal(n, 1, "a migration nao aplicou depois do cruzamento");
}
/**
 * DUAS APLICACOES AO MESMO TEMPO (o workflow serializa; se acontecer): em READ COMMITTED as
 * duas dao certo (a segunda reaplica); no envelope REPEATABLE READ, com as duas ja tendo tirado
 * a foto, UMA aplica e a outra RECUSA nomeando o problema ("apareceu agora": a transacao dela
 * nao enxerga a tabela que a outra criou) sem gravar nada. Em qualquer caso o catalogo final
 * e o de uma aplicacao so.
 */
async function casoDuasAplicacoes(sql = lerMig()) {
  const unica = await clonarComM1("umaaplic", sql);
  const referencia = await fotografia(unica);
  // READ COMMITTED
  const rc = await clonar("duasrc");
  const [a1, a2] = await Promise.all([aplicar(rc, sql), aplicar(rc, sql)]);
  assert.ok(!a1.erro, `RC, 1a: ${a1.erro?.code} ${a1.erro?.message}`);
  assert.ok(!a2.erro, `RC, 2a: ${a2.erro?.code} ${a2.erro?.message}`);
  assert.deepEqual(await fotografia(rc), referencia, "RC: catalogo final");
  // REPEATABLE READ: as duas tiram a foto antes de qualquer uma comecar a migration
  const rr = await clonar("duasrr");
  let chegou = 0;
  let liberar;
  const portao = new Promise((r) => {
    liberar = r;
  });
  const barreira = async () => {
    chegou += 1;
    if (chegou === 2) liberar();
    await portao;
  };
  const [b1, b2] = await comTempo(
    Promise.all([
      emEnvelopeRR(rr, sql, barreira),
      emEnvelopeRR(rr, sql, barreira),
    ]),
    30000,
    "duas aplicacoes em RR",
  );
  const ok_ = [b1, b2].filter((r) => !r.erro);
  const recusadas = [b1, b2].filter((r) => r.erro);
  assert.equal(ok_.length, 1, "RR: exatamente uma aplica");
  assert.equal(recusadas.length, 1, "RR: a outra recusa");
  recusou(
    recusadas[0],
    /apareceu agora \(outra aplicacao desta migration ao mesmo tempo\?\)/,
    "RR: a segunda aplicacao",
  );
  assert.deepEqual(await fotografia(rr), referencia, "RR: catalogo final");
}

/** Um pedido que chega DEPOIS da trava espera o COMMIT e ja encontra o gatilho (a foto existe). */
async function casoChegaDepois(sql = lerMig()) {
  const db = await clonar("chegadepois");
  const [ped, ins] = await usar(db, async (c) => [await novoPedido(c), 0]);
  void ins;
  const m = new Client({ connectionString: urlDe(db) });
  const t = new Client({ connectionString: urlDe(db) });
  await m.connect();
  await t.connect();
  try {
    await m.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await m.query("SELECT count(*) FROM public.marketplace_orders");
    await m.query(sql); // pegou a trava; ainda nao deu COMMIT
    const emT = t
      .query(
        "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
        [ped],
      )
      .then(
        () => ({ ok: true }),
        (erro) => ({ erro }),
      );
    await esperarBloqueio(db, 4000);
    await m.query("COMMIT");
    const r = await comTempo(emT, 8000, "pedido que chegou depois");
    assert.ok(
      !r.erro,
      `o pedido que esperou falhou: ${r.erro?.code} ${r.erro?.message}`,
    );
  } finally {
    await m.query("ROLLBACK").catch(() => {});
    await m.end().catch(() => {});
    await t.end().catch(() => {});
  }
  const f = await usar(db, (c) => foto(c, ped));
  assert.ok(
    f,
    "o pedido que esperou o COMMIT da migration nao encontrou o gatilho",
  );
}
async function casoRollbackEnvelope(rb = lerRb()) {
  const db = await clonarComM1("rbenvelope");
  const ped = await usar(db, (c) => novoPedido(c));
  const p = new Client({ connectionString: urlDe(db) });
  await p.connect();
  try {
    await p.query("BEGIN");
    await p.query(
      "UPDATE public.marketplace_orders SET notes = 'preso' WHERE id = $1",
      [ped],
    );
    const t0 = Date.now();
    const antes = await fotografia(db);
    const r = await emEnvelopeRR(db, rb);
    const ms = Date.now() - t0;
    assert.ok(r.erro, "rollback com a tabela presa tem de recusar");
    assert.equal(r.erro.code, "55P03", `${r.erro.code} ${r.erro.message}`);
    assert.match(
      r.erro.message,
      /ROLLBACK_20261209: public\.marketplace_orders ficou ocupada por mais de 4 s/,
    );
    assert.ok(ms >= 3500 && ms < 15000, `orcamento de 4 s: levou ${ms} ms`);
    await p.query("COMMIT");
    // (o pedido preso gravou a nota dele ao dar COMMIT: so as linhas de pedido diferem)
    assert.deepEqual(
      { ...(await fotografia(db)), pedidos: null },
      { ...antes, pedidos: null },
      "rollback com a tabela ocupada: algo mudou no banco",
    );
  } finally {
    await p.query("ROLLBACK").catch(() => {});
    await p.end().catch(() => {});
  }
  // livre, o mesmo envelope desfaz
  const r2 = await emEnvelopeRR(db, rb);
  assert.ok(
    !r2.erro,
    `rollback em envelope RR livre: ${r2.erro?.code} ${r2.erro?.message}`,
  );
}

/** Rollback de quem ja foi desfeito: nao pede trava nenhuma (nao para o checkout a toa). */
async function casoRollbackJaDesfeito(rb = lerRb()) {
  const db = await clonar("rbjadesfeito");
  const ped = await usar(db, (c) => novoPedido(c));
  const p = new Client({ connectionString: urlDe(db) });
  await p.connect();
  try {
    await p.query("BEGIN");
    await p.query(
      "UPDATE public.marketplace_orders SET notes = 'preso' WHERE id = $1",
      [ped],
    );
    const t0 = Date.now();
    const r = await emEnvelopeRR(db, rb);
    const ms = Date.now() - t0;
    assert.ok(
      !r.erro,
      `rollback de quem ja foi desfeito, com a tabela presa, devia passar sem esperar: ${r.erro?.code} ${r.erro?.message}`,
    );
    assert.ok(ms < 2000, `o rollback ja-desfeito esperou ${ms} ms pela trava`);
  } finally {
    await p.query("ROLLBACK").catch(() => {});
    await p.end().catch(() => {});
  }
}

// ----------------------------------------------------------------- o bloco
async function blocoDaFoto() {
  const sql = lerMig();
  const rb = lerRb();
  const hashes = {
    mig: crypto.createHash("sha256").update(sql).digest("hex"),
    rb: crypto.createHash("sha256").update(rb).digest("hex"),
  };
  console.log(`  sha256 da migration (LF): ${hashes.mig}`);
  console.log(`  sha256 do rollback  (LF): ${hashes.rb}`);

  await casoCatalogo();
  ok(
    "catalogo: tabela com a forma exata, RLS ligada, sem politica, sem privilegio (nem SELECT, INSERT, UPDATE, DELETE, TRUNCATE) para PUBLIC/anon/authenticated/service_role (42501 para cada um); funcao SECURITY DEFINER, search_path = public, sem EXECUTE de fora; gatilho AFTER UPDATE OF status, por linha, com o WHEN, ativo",
  );
  await casoCaminhos();
  ok(
    "caminhos reais: a foto tem os valores do momento do cancelamento em v24+PIX+cancelar_pedido_com_cobranca (e liberar depois nao a muda), cliente, admin (pedido pago), cartao em analise, expiracao ('expirado' do NEW), v23, pedido__mudar_status, UPDATE cru; o cliente (authenticated) cancela sem erro; UPDATE direto de um papel sem privilegio na tabela da foto; 9 pedidos, 9 fotos",
  );
  await casoRecancelar();
  ok(
    "recancelar: UPDATE com status repetido, RPC do cliente e do admin e a edge de novo NAO regravam a foto (mesma linha fisica)",
  );
  await casoReativar();
  ok(
    "reativar e cancelar de novo SOBRESCREVE a foto pelo estado do 2o cancelamento (cartao tentado no meio aparece); uma foto por pedido",
  );
  await casoNaoDispara();
  ok(
    "nao dispara: UPDATE que nao mexe em status, status repetido, processing/shipping, INSERT ja cancelado e UPDATE de outra coluna depois do cancelamento nao criam nem mexem em foto",
  );
  await casoSimultaneo();
  ok(
    "dois cancelamentos simultaneos (UPDATE cru com 2 conexoes reais e duas RPCs do cliente) geram UMA foto, a do primeiro",
  );
  await casoCascata();
  ok("apagar o pedido apaga a foto (ON DELETE CASCADE)");
  await casoDadoAntigo();
  ok(
    "dado antigo: pedido cancelado antes da migration NAO ganha foto (nem ao ser recancelado), nada preenchido retroativamente, nenhum pedido muda; o pedido em andamento ganha foto quando for cancelado",
  );
  await casoIdempotente();
  ok(
    "idempotente: 2a aplicacao, 3a (CRLF, so o corpo da funcao muda de fim de linha) e 4a (LF) deixam o catalogo e as fotos ja gravadas IGUAIS",
  );
  await casoAtomico();
  ok(
    "atomico: falha DEPOIS da ultima peca desfaz tudo; BEGIN ... ROLLBACK nao deixa rastro; o envelope BEGIN ... COMMIT aplica",
  );
  await casoIdaEVolta();
  ok(
    "ida e volta: aplicar, rollback, reaplicar, rollback, reaplicar 2x: o catalogo volta EXATO ao do estado pre (tabelas, funcoes, gatilhos, ACL, politicas), pedidos intactos, foto funciona a cada reaplicacao; rollback repetido e CRLF sao no-op",
  );
  await casoPreVooColuna();
  ok(
    "pre-voo recusa coluna ausente de marketplace_orders, nomeando-a, sem gravar",
  );
  await casoPreVooTabela();
  ok(
    "pre-voo recusa tabela de outra pessoa com o nome (outra forma, sem chave primaria, sem FK com CASCADE), sem gravar",
  );
  await casoPreVooPolitica();
  ok("pre-voo recusa a tabela com politica de seguranca por linha, sem gravar");
  await casoPreVooFuncao();
  ok(
    "pre-voo recusa funcao com o nome em outra assinatura ou com outro corpo, sem gravar",
  );
  await casoPreVooGatilho();
  ok("pre-voo recusa gatilho com o nome e outra definicao, sem gravar");
  for (const q of quebras()) {
    await casoPosvoo(q.sql, q.trecho, q.rotulo);
  }
  ok(
    "pos-voo: sem RLS, privilegio sobrando na tabela, EXECUTE sobrando na funcao, corpo diferente, gatilho sem WHEN e sem gatilho fazem a migration inteira falhar sem deixar nada",
  );
  await casoRollbackRecusa();
  ok(
    "rollback recusa (sem apagar nada) funcao que cite a tabela (em public e fora), tabela alheia, funcao de outra assinatura, gatilho alheio e visao dependente (2BP01)",
  );
  await casoRollbackConfere();
  ok("rollback confere no fim: se a tabela sobrasse, falharia");
  await casoEnvelopeFeliz();
  ok("envelope REPEATABLE READ sem concorrente: aplica");
  await casoEnvelopeEspera();
  ok(
    "envelope RR com pedido em andamento: a migration ESPERA (dormindo no NOWAIT), o pedido da COMMIT e ela aplica; sem 40P01 nem 40001",
  );
  await casoEnvelopeOcupada();
  ok(
    "envelope RR com a tabela ocupada por mais de 4 s: recusa 55P03 nomeando o problema, NADA gravado",
  );
  await casoCruzado();
  ok(
    "DOIS pedidos cruzados (um segura a tabela de pedidos e quer a linha do cupom, o outro segura a linha do cupom e quer a tabela) com a migration esperando a trava: o pedido que chega com ela esperando NAO fica parado (< 1,5 s), nenhum 40P01, os dois dao COMMIT e a migration aplica no fim",
  );
  await casoDuasAplicacoes();
  ok(
    "duas aplicacoes ao mesmo tempo (2 conexoes reais): em READ COMMITTED as duas dao certo; no envelope REPEATABLE READ uma aplica e a outra recusa com 'apareceu agora' sem gravar; o catalogo final e o de uma aplicacao so",
  );
  await casoChegaDepois();
  ok(
    "pedido que chega DEPOIS da trava da migration espera o COMMIT e ja encontra o gatilho (a foto existe)",
  );
  await casoRollbackEnvelope();
  ok(
    "rollback no envelope RR: tabela ocupada recusa 55P03 sem apagar nada; livre, desfaz",
  );
  await casoRollbackJaDesfeito();
  ok(
    "rollback de quem ja foi desfeito nao pede trava (passa sem esperar mesmo com a tabela de pedidos presa)",
  );

  // ------------------------------------------------------------ mutantes
  console.log(
    "\n  --- MUTANTES DO BLOCO DA FOTO (cada guarda retirada tem de deixar a prova VERMELHA) ---",
  );
  // o gatilho/funcao mutados precisam passar pelo pos-voo (senao quem pega e o pos-voo): tira-se o raise
  const sPosGatilho = (s) => semRaise(s, MSG.posGatilho);
  const sPosCorpo = (s) => semRaise(s, MSG.posCorpo);
  await mutante(
    "gatilho sem o WHEN (todo UPDATE OF status fotografa)",
    casoRecancelar,
    sPosGatilho(trocar(sql, T.when, "")),
  );
  await mutante(
    "WHEN sem o `OLD.status IS DISTINCT FROM` (recancelar regrava)",
    casoRecancelar,
    sPosGatilho(trocar(sql, T.when, T.whenSemOld)),
  );
  await mutante(
    "ON CONFLICT DO NOTHING (reativar e cancelar de novo nao sobrescreve)",
    casoReativar,
    sPosCorpo(trocar(sql, T.upsert, T.doNothing)),
  );
  await mutante(
    "funcao do gatilho sem SECURITY DEFINER (o cliente nao cancela)",
    casoCaminhos,
    sPosCorpo(trocar(sql, T.secDef, T.semSecDef)),
  );
  await mutante(
    "funcao do gatilho sem search_path",
    casoCatalogo,
    sPosCorpo(trocar(sql, T.secDef, T.semPath)),
  );
  await mutante(
    "foto lida do OLD em vez do NEW (a expiracao sai 'aguardando')",
    casoCaminhos,
    sPosCorpo(trocar(sql, T.newPay, T.oldPay)),
  );
  await mutante(
    "sem seguranca por linha",
    casoCatalogo,
    semRaise(trocar(sql, T.rls, ""), MSG.posRls),
  );
  await mutante(
    "sem REVOKE da tabela (os papeis do Supabase leem e escrevem)",
    casoCatalogo,
    semRaise(trocar(sql, T.revTabela, ""), MSG.posAclTabela),
  );
  await mutante(
    "sem REVOKE da funcao (EXECUTE de fora)",
    casoCatalogo,
    semRaise(trocar(sql, T.revFuncao, ""), MSG.posAclFuncao),
  );
  await mutante(
    "FK sem ON DELETE CASCADE",
    casoCascata,
    trocar(sql, T.cascade, T.semCascade),
  );
  await mutante(
    "sem gatilho",
    casoCaminhos,
    sPosGatilho(trocar(sql, gatilhoDe(sql), "")),
  );
  await mutante(
    "LOCK que espera na fila (em vez de NOWAIT): o checkout para atras da migration",
    casoCruzado,
    trocar(sql, T.lockNowait, T.lockEspera),
  );
  await mutante(
    "orcamento do NOWAIT 100 vezes maior (a migration nunca recusa a tabela ocupada)",
    casoEnvelopeOcupada,
    trocar(sql, T.orcamento, T.orcamentoGrande),
  );
  for (const [rotulo, msg, caso_] of [
    ["sem pre-voo da coluna", MSG.coluna, casoPreVooColuna],
    [
      "sem pre-voo da forma da tabela",
      MSG.forma,
      (s) => casoPreVooTabela(s, "forma"),
    ],
    ["sem pre-voo da chave primaria", MSG.pk, (s) => casoPreVooTabela(s, "pk")],
    ["sem pre-voo da FK", MSG.fk, (s) => casoPreVooTabela(s, "fk")],
    ["sem pre-voo da politica", MSG.politica, casoPreVooPolitica],
    [
      "sem a guarda 'apareceu agora' (duas aplicacoes ao mesmo tempo)",
      MSG.apareceuAgora,
      casoDuasAplicacoes,
    ],
    [
      "sem pre-voo da assinatura da funcao",
      MSG.assinatura,
      (s) => casoPreVooFuncao(s, "assinatura"),
    ],
    [
      "sem pre-voo do corpo da funcao",
      MSG.corpo,
      (s) => casoPreVooFuncao(s, "corpo"),
    ],
    ["sem pre-voo do gatilho", MSG.gatilho, casoPreVooGatilho],
  ]) {
    await mutante(rotulo, caso_, semRaise(sql, msg));
  }
  for (const q of quebras()) {
    await mutante(
      `sem a conferencia do pos-voo (${q.rotulo})`,
      (s) => casoPosvoo(s, q.trecho, q.rotulo),
      semRaise(q.sql, q.msg),
    );
  }
  for (const [rotulo, msg, so] of [
    [
      "rollback sem a conferencia das funcoes que citam a tabela",
      MSG.rbFuncoes,
      "funcao",
    ],
    [
      "rollback sem a conferencia da forma da tabela",
      MSG.rbForma,
      "tabela alheia",
    ],
    [
      "rollback sem a conferencia da assinatura da funcao",
      MSG.rbAssinatura,
      "funcao com outra assinatura",
    ],
    ["rollback sem a conferencia do gatilho", MSG.rbGatilho, "gatilho alheio"],
  ]) {
    await mutante(rotulo, (r) => casoRollbackRecusa(r, so), semRaise(rb, msg));
  }
  await mutante(
    "rollback sem a conferencia final",
    casoRollbackConfere,
    semRaise(rb, MSG.rbDepois),
  );
  await mutante(
    "rollback com DROP TABLE ... CASCADE (leva a visao embora)",
    (r) => casoRollbackRecusa(r, "visao"),
    trocar(
      rb,
      "DROP TABLE IF EXISTS public.pedido_cobranca_ao_cancelar;",
      "DROP TABLE IF EXISTS public.pedido_cobranca_ao_cancelar CASCADE;",
    ),
  );
  await mutante(
    "rollback sem o RETURN do ja-desfeito (um rollback repetido pede a trava e para o checkout)",
    casoRollbackJaDesfeito,
    trocar(
      rb,
      "    RETURN; -- ja desfeito: nada a conferir nem a apagar\n",
      "",
    ),
  );
}

// ===========================================================================
// BLOCO DA VAGA -- migration 20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql
//
// A migration ensina a varredura do cupom (devolver_cupons_de_pedidos_mortos), o auxiliar
// (cupom__vaga_volta_em, que passa de 9 a 13 parametros) e a RPC do checkout
// (vaga_do_cupom_presa) a LER a foto da cobranca que a 20261209000000 grava. Depois dela, o cupom
// de um pedido cancelado com o PIX gerado volta no prazo do PIX (~45 min no maximo depois da
// criacao do pedido), e nao em 24 h, SE E SOMENTE SE o historico do pedido prova que nunca houve
// cobranca por cartao: foto com id de PIX na vaga, zero tentativas, metodo 'pix' e 'aguardando';
// agora o pedido esta cancelado, 'aguardando', com a vaga vazia e exatamente uma tentativa.
//
// O QUE O BLOCO AFIRMA, EXECUTANDO (cada caso num banco CLONADO do estado "pre-M2": a arvore ate a
// 20261209000000 inclusive, com usuarios, produto e cupom de teste):
//  TABELA       33 pedidos montados pelos caminhos reais (v24, v23, edge de cancelamento, liberar,
//               confirmar_pagamento, admin) e o resto forjado so quando o caminho real nao alcanca
//               (cada condicao da pista violada SOZINHA volta para 24 h, 45 min ou nunca): o
//               auxiliar diz "volta antes de agora" SE E SOMENTE SE a varredura devolve o pedido, a
//               RPC diz "presa" SE E SOMENTE SE a varredura vai devolver um dia, os minutos batem, a
//               vaga volta de verdade (a validacao do cupom recusa antes e aceita depois) e a
//               segunda varredura nao devolve em dobro.
//  PRAZO        a pista devolve p_expires_at, nunca '-infinity' (ajuste A2 do critico): o admin que
//               reativa o pedido cancelado antes do prazo do PIX nao encontra o cupom ja devolvido.
//  FANTASMA     depois que a varredura devolveu, confirmar_pagamento do PIX velho da `divergente` e o
//               usage_count nao muda; no estado A (vaga ainda no PIX) o pagamento tardio vira
//               `pago_apos_expirar` e a varredura NAO devolveu (nenhum cupom em dobro).
//  CONCORRENCIA 2 conexoes reais: varredura x confirmar_pagamento (as duas ordens), varredura x
//               liberar, tentativa nova durante a varredura, duas varreduras (uma devolucao so),
//               varredura rodando no meio da migration.
//  ENVELOPE     o envelope de producao (BEGIN ISOLATION LEVEL REPEATABLE READ + leitura de
//               marketplace_orders ANTES do corpo): com pedido em andamento segurando a tabela a
//               migration aplica sem esperar (ela nao pede trava de tabela) ou recusa 55P03 sem
//               gravar, NUNCA 40P01/40001; nas duas ordens; e o cruzamento de dois pedidos.
//  MIGRATION    catalogo (13 parametros, sem EXECUTE de fora, ACL da RPC e da varredura intactas),
//               corpos iguais ao arquivo, nada mais muda, idempotente (CRLF), atomica (falha no meio,
//               depois do DROP, devolve o banco inteiro), ida e volta byte a byte (rollback devolve
//               os corpos da 1206 e da 1205), pre-voo que recusa SEM gravar (inclusive 1 byte a mais
//               em cada corpo travado), pos-voo, rollback que recusa, ordem de desfazer.
//  MUTANTES     cada guarda retirada deixa um caso VERMELHO.
// ===========================================================================

const ARQ2 =
  "20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql";
const ARQ2_RB = `rollback-manual-${ARQ2}`;
const ARQ_1205 = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";
const ARQ_1206 =
  "20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql";
const lerMig2 = () => lerLF(ARQ2);
const lerRb2 = () => lerLF(ARQ2_RB);

const FN_AUX9 =
  "public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)";
const FN_AUX13 =
  "public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)";
const FN_RPC = "public.vaga_do_cupom_presa(text)";
const FN_VAR = "public.devolver_cupons_de_pedidos_mortos()";
const CAB_AUX = "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(";
const CAB_RPC = "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(";
const CAB_VAR =
  "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()";
const TAG_FN = "$function$";
const TAG_VAR = "$devolver_cupons_mortos$";
const sha256 = (s) =>
  crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
/** O corpo de uma funcao dentro de um arquivo, entre `AS $tag$` e `$tag$;` (LF). */
function corpoDe(texto, cabecalho, tag) {
  const ini = texto.indexOf(cabecalho);
  assert.ok(ini >= 0, `cabecalho nao achado: ${cabecalho}`);
  const abre = texto.indexOf(`AS ${tag}`, ini) + `AS ${tag}`.length;
  return texto.slice(abre, texto.indexOf(`${tag};`, abre));
}
const corpos1205 = () => {
  const t = lerLF(ARQ_1205);
  return { aux: corpoDe(t, CAB_AUX, TAG_FN), rpc: corpoDe(t, CAB_RPC, TAG_FN) };
};
const corpos1206 = () => {
  const t = lerLF(ARQ_1206);
  return {
    aux: corpoDe(t, CAB_AUX, TAG_FN),
    var: corpoDe(t, CAB_VAR, TAG_VAR),
  };
};
const corposM2 = (t = lerMig2()) => ({
  aux: corpoDe(t, CAB_AUX, TAG_FN),
  rpc: corpoDe(t, CAB_RPC, TAG_FN),
  var: corpoDe(t, CAB_VAR, TAG_VAR),
});
const corpoVivo = (db, assinatura) =>
  usar(
    db,
    async (c) =>
      (
        await c.query(
          "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
          [assinatura],
        )
      ).rows[0]?.prosrc ?? null,
  );

let PRE2 = null;
const clonar2 = (rotulo) => clonar(rotulo, PRE2);
/** O estado "pre-M2": a arvore ate a 20261209000000 (foto) inclusive. */
async function prepararPre2() {
  PRE2 = await clonar("pre2");
  const r = await aplicar(PRE2, lerMig());
  assert.ok(
    !r.erro,
    `montar o estado pre-M2 (aplicar a 20261209000000): ${r.erro?.code} ${r.erro?.message}`,
  );
}
async function clonarComM2(rotulo, sql = lerMig2()) {
  const db = await clonar2(rotulo);
  const r = await aplicar(db, sql);
  assert.ok(!r.erro, `aplicar a M2 falhou: ${r.erro?.code} ${r.erro?.message}`);
  return db;
}
const conexao = async (db) => {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  return c;
};
const outrasFuncoes = (db) =>
  usar(
    db,
    async (c) =>
      (
        await c.query(`SELECT md5(string_agg(p.oid::regprocedure::text || '|' || p.prosrc || '|'
               || coalesce(p.proacl::text, '') || '|' || p.proowner::regrole::text
               || '|' || coalesce(obj_description(p.oid, 'pg_proc'), ''),
               E'\\n' ORDER BY p.oid::regprocedure::text)) AS h
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname NOT IN ('cupom__vaga_volta_em', 'vaga_do_cupom_presa',
                                      'devolver_cupons_de_pedidos_mortos')`)
      ).rows[0].h,
  );

// ---------------------------------------------------------------------------
// Pedidos pelos caminhos REAIS (cada um com o PROPRIO cupom de limite 1)
// ---------------------------------------------------------------------------
let seqCupom = 0;
async function cupomNovo(c) {
  seqCupom += 1;
  const codigo = `PIXA${seqCupom.toString(36)}${SUF}`.toUpperCase();
  const id = (
    await c.query(
      `INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit)
       VALUES ($1, 'fixed', 10, true, 0, 1) RETURNING id`,
      [codigo],
    )
  ).rows[0].id;
  return { id, codigo };
}
async function pedidoComCupom(c, codigo, rpc = "create_marketplace_order_v24") {
  const metodo = rpc === "create_marketplace_order_v24" ? "pix" : "cash";
  const r = await como(
    c,
    "comprador",
    `SELECT public.${rpc}($1::jsonb, $2::numeric, 0::numeric, $3::text, NULL::uuid, $4::text,
       'Comprador', '5539000000000', NULL::text, $5::jsonb, '38500-000', 'local-delivery', $6::uuid) AS id`,
    [
      JSON.stringify([
        { product_id: P_PRODUTO, variant_id: null, quantity: 1 },
      ]),
      codigo ? 90 : 100,
      metodo,
      codigo,
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      crypto.randomUUID(),
    ],
  );
  return exigir(r, `${rpc} com cupom`)[0].id;
}
const estadoCompleto = async (c, id) =>
  (
    await c.query(
      `SELECT status, payment_status, gateway_payment_id, tentativas_de_pagamento,
              coupon_usage_returned, expires_at, paid_at, metodo_online
         FROM public.marketplace_orders WHERE id = $1`,
      [id],
    )
  ).rows[0];
const usosDo = async (c, cupomId) =>
  Number(
    (
      await c.query("SELECT usage_count FROM public.coupons WHERE id = $1", [
        cupomId,
      ])
    ).rows[0].usage_count,
  );
const validar = async (c, codigo) =>
  (
    await c.query(
      "SELECT public.validate_coupon_secure_v2($1, 100::numeric) AS r",
      [codigo],
    )
  ).rows[0].r;
const vagaPresa = async (c, codigo) =>
  exigir(
    await como(c, "comprador", "SELECT public.vaga_do_cupom_presa($1) AS r", [
      codigo,
    ]),
    `vaga_do_cupom_presa(${codigo})`,
  )[0].r;
const varrer = async (c) =>
  Number((await c.query(`SELECT ${FN_VAR} AS n`)).rows[0].n);
/** O que o auxiliar diz de UM pedido, chamado com as colunas dele e as da foto (13 argumentos). */
async function veredictoAux(c, id) {
  return (
    await c.query(
      `SELECT v < now() AS volta_antes_de_agora, v = 'infinity'::timestamptz AS nunca
         FROM (SELECT public.cupom__vaga_volta_em(
                 o.coupon_id, o.status, o.payment_status, o.coupon_usage_returned,
                 o.expires_at, o.cancelled_after_shipping, o.returned_to_seller_at,
                 o.gateway_payment_id, o.tentativas_de_pagamento,
                 f.gateway_payment_id, f.tentativas, f.metodo_online, f.payment_status) AS v
                 FROM public.marketplace_orders o
                 LEFT JOIN public.pedido_cobranca_ao_cancelar f ON f.order_id = o.id
                WHERE o.id = $1) t`,
      [id],
    )
  ).rows[0];
}

/** Os passos que montam o historico de um pedido, em ordem. */
const G = "MP-PIX-A";
/** O id de cobranca de UM pedido: o indice de gateway_payment_id e unico entre os pedidos. */
const gwDe = (g, id) => (g === null ? null : `${g}-${id.slice(0, 8)}`);
const P = {
  pix:
    (g = G) =>
    (c, id) =>
      gravarPix(c, id, gwDe(g, id)),
  gateway: (g, extra) => (c, id) =>
    c.query(
      `UPDATE public.marketplace_orders SET gateway_payment_id = $2, ${extra} WHERE id = $1`,
      [id, gwDe(g, id)],
    ),
  cancelarEdge:
    (g = G, ator = U_COMPRADOR) =>
    async (c, id) => {
      const r = exigir(
        await cancelarPelaEdge(c, id, ator, gwDe(g, id), "aguardando"),
        "cancelar pela edge",
      )[0].r;
      assert.equal(r.cancelado, true, JSON.stringify(r));
    },
  cancelarCliente: () => (c, id) => cancelarComo(c, "comprador", id),
  cancelarAdmin: () => (c, id) => cancelarComo(c, "admin", id),
  liberar:
    (g = G) =>
    async (c, id) => {
      const r = await c.query(
        "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2::text) AS ok",
        [id, gwDe(g, id)],
      );
      assert.equal(
        r.rows[0].ok,
        true,
        `liberar_cobranca_do_pedido(${g}) nao liberou`,
      );
    },
  confirmar: (g, esperado) => async (c, id) => {
    const r = await c.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
      [id, gwDe(g, id)],
    );
    assert.equal(r.rows[0].r, esperado, `confirmar_pagamento(${g})`);
  },
  reativarAdmin: () => async (c, id) => {
    exigir(
      await como(
        c,
        "admin",
        "SELECT public.update_order_status_atomic($1::uuid, 'pending') AS r",
        [id],
      ),
      "o admin reativa o pedido cancelado",
    );
  },
  foto: (set) => (c, id) =>
    c.query(
      `UPDATE public.pedido_cobranca_ao_cancelar SET ${set} WHERE order_id = $1`,
      [id],
    ),
  semFoto: () => async (c, id) => {
    const r = await c.query(
      "DELETE FROM public.pedido_cobranca_ao_cancelar WHERE order_id = $1",
      [id],
    );
    assert.equal(r.rowCount, 1, "o pedido devia ter foto para ser apagada");
  },
  pedido: (set) => (c, id) =>
    c.query(`UPDATE public.marketplace_orders SET ${set} WHERE id = $1`, [id]),
};
const BASE_B = () => [P.pix(), P.cancelarEdge(), P.liberar()];
const PRE_B = ["cancelled", "aguardando", false, 1]; // o estado B: vaga vazia, 1 tentativa
const PRE_A = ["cancelled", "aguardando", true, 0]; // o estado A: vaga ainda no PIX
const H24 = 24 * 3600;
/** Minutos que a RPC promete: espera ate a hora (para CIMA) + 15 min do ciclo da varredura. */
const aMin = (seg) => Math.ceil(Math.max(seg, 0) / 60) + 15;
const cs = (
  id,
  nome,
  passos,
  exp,
  pre,
  devolve,
  presa,
  minutos,
  extra = {},
) => ({
  id,
  nome,
  passos,
  exp,
  pre,
  devolve,
  presa,
  minutos,
  ...extra,
});

/**
 * A TABELA DE CASOS. `exp`: segundos A PARTIR DE AGORA em que o PIX vence (negativo = ja venceu;
 * null = deixa como nasceu). `pre`: [status, payment_status, vaga ocupada, tentativas] que o pedido
 * TEM de ter depois de montado (senao o caso mente). `devolve`: a varredura devolve AGORA. `presa`:
 * a varredura VAI devolver um dia (a RPC diz presa). `minutos`: o que a RPC promete.
 */
const CASOS_PIX = [
  cs(
    "C01",
    "PIX anulado, vaga ja vazia, prazo do PIX vencido: volta no proximo ciclo",
    BASE_B(),
    -60,
    PRE_B,
    true,
    true,
    15,
  ),
  cs(
    "C02",
    "mesmo, prazo do PIX ainda correndo (10 min): volta quando o prazo acabar, nao antes",
    BASE_B(),
    600,
    PRE_B,
    false,
    true,
    aMin(600),
  ),
  cs(
    "C03",
    "fronteira: o prazo do PIX acaba em 2 min",
    BASE_B(),
    120,
    PRE_B,
    false,
    true,
    aMin(120),
  ),
  cs(
    "C04",
    "fronteira: o prazo do PIX acabou ha 1 s",
    BASE_B(),
    -1,
    PRE_B,
    true,
    true,
    15,
  ),
  cs(
    "C05",
    "estado A (o MP ainda nao confirmou; vaga ainda no PIX): segue as 24 h de hoje",
    [P.pix(), P.cancelarEdge()],
    -60,
    PRE_A,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C06",
    "estado A, 24 h e 1 min depois do prazo: volta (como hoje)",
    [P.pix(), P.cancelarEdge()],
    -(H24 + 60),
    PRE_A,
    true,
    true,
    15,
  ),
  cs(
    "C07",
    "estado A, 23 h depois do prazo: ainda espera",
    [P.pix(), P.cancelarEdge()],
    -23 * 3600,
    PRE_A,
    false,
    true,
    aMin(3600),
  ),
  cs(
    "C08",
    "sem foto (cancelado antes da migration da foto): 24 h",
    [...BASE_B(), P.semFoto()],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C09",
    "foto sem id (cancelado sem PIX gravado) e uma recusa contada depois: 24 h",
    [P.cancelarCliente(), P.liberar(null)],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C10",
    "foto com id de cartao em analise (verificando:) SOZINHA: 24 h",
    [...BASE_B(), P.foto("gateway_payment_id = 'verificando:abc123'")],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C11",
    "foto com tentativa anterior (1) SOZINHA: 24 h",
    [...BASE_B(), P.foto("tentativas = 1")],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C12",
    "foto com metodo credito SOZINHA: 24 h",
    [...BASE_B(), P.foto("metodo_online = 'credito'")],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C13",
    "foto com metodo vazio SOZINHA: 24 h",
    [...BASE_B(), P.foto("metodo_online = NULL")],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C14",
    "foto com payment_status expirado SOZINHA: 24 h",
    [...BASE_B(), P.foto("payment_status = 'expirado'")],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C15",
    "foto com payment_status vazio SOZINHA: 24 h",
    [...BASE_B(), P.foto("payment_status = NULL")],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C16",
    "foto sem id de cobranca (vazio) SOZINHA: 24 h",
    [...BASE_B(), P.foto("gateway_payment_id = NULL")],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C17",
    "agora: duas tentativas (uma recusa a mais depois da anulacao): 24 h",
    [...BASE_B(), P.liberar(null)],
    -60,
    ["cancelled", "aguardando", false, 2],
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C18",
    "agora: a vaga foi ocupada de novo (outro PIX) com 1 tentativa: 24 h",
    [...BASE_B(), P.pix("MP-PIX-B")],
    -60,
    ["cancelled", "aguardando", true, 1],
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C19",
    "agora: payment_status expirado SOZINHO: 24 h",
    [...BASE_B(), P.pedido("payment_status = 'expirado'")],
    -60,
    ["cancelled", "expirado", false, 1],
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C20",
    "PIX pago DEPOIS de cancelar (pago_apos_expirar): nunca devolve",
    [P.pix(), P.cancelarEdge(), P.confirmar(G, "pago_apos_expirar")],
    -60,
    ["cancelled", "pago_apos_expirar", true, 0],
    false,
    false,
    null,
  ),
  cs(
    "C21",
    "pedido pago e cancelado pelo admin: nunca devolve",
    [P.pix(), P.confirmar(G, "pago"), P.cancelarAdmin()],
    -60,
    ["cancelled", "pago", true, 0],
    false,
    false,
    null,
  ),
  cs(
    "C22",
    "cupom ja devolvido: nunca devolve de novo",
    [...BASE_B(), P.pedido("coupon_usage_returned = true")],
    -60,
    PRE_B,
    false,
    false,
    null,
    { returnedDepois: true },
  ),
  cs(
    "C23",
    "cancelado depois do envio, produto nao voltou: nunca devolve",
    [...BASE_B(), P.pedido("cancelled_after_shipping = true")],
    -60,
    PRE_B,
    false,
    false,
    null,
  ),
  cs(
    "C24",
    "cancelado depois do envio, produto voltou: volta como a pista manda",
    [
      ...BASE_B(),
      P.pedido(
        "cancelled_after_shipping = true, returned_to_seller_at = now()",
      ),
    ],
    -60,
    PRE_B,
    true,
    true,
    15,
  ),
  cs(
    "C25",
    "o admin reativou o pedido (pending): nunca devolve",
    [...BASE_B(), P.reativarAdmin()],
    -60,
    ["pending", "aguardando", false, 1],
    false,
    false,
    null,
  ),
  cs(
    "C26",
    "sem prazo (expires_at vazio), como hoje: volta na hora",
    [...BASE_B(), P.pedido("expires_at = NULL")],
    null,
    PRE_B,
    true,
    true,
    15,
  ),
  cs(
    "C27",
    "nunca cobrado (sem PIX, zero tentativas), venceu ha 46 min: volta (pista de 45 min da 1206)",
    [P.cancelarCliente()],
    -46 * 60,
    ["cancelled", "aguardando", false, 0],
    true,
    true,
    15,
  ),
  cs(
    "C28",
    "nunca cobrado, venceu ha 44 min: ainda espera 1 min",
    [P.cancelarCliente()],
    -44 * 60,
    ["cancelled", "aguardando", false, 0],
    false,
    true,
    aMin(60),
  ),
  cs(
    "C29",
    "na entrega (v23, sem prazo): volta na hora, como hoje",
    [P.cancelarCliente()],
    null,
    ["cancelled", null, false, 0],
    true,
    true,
    15,
    { rpc: "create_marketplace_order_v23" },
  ),
  cs(
    "C30",
    "sem cupom: nunca entra",
    [...BASE_B()],
    -60,
    PRE_B,
    false,
    false,
    null,
    { semCupom: true },
  ),
  cs(
    "C31",
    "cartao tentado antes e PIX anulado depois (foto com 1 tentativa): 24 h",
    [
      P.pix("MP-CARD-0"),
      P.liberar("MP-CARD-0"),
      P.pix("MP-PIX-B"),
      P.cancelarEdge("MP-PIX-B"),
      P.liberar("MP-PIX-B"),
    ],
    -60,
    ["cancelled", "aguardando", false, 2],
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C32",
    "cartao autorizado (id real do MP, metodo credito) e anulado: 24 h",
    [
      P.gateway("MP-CARD-1", "metodo_online = 'credito'"),
      P.cancelarEdge("MP-CARD-1"),
      P.liberar("MP-CARD-1"),
    ],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
  cs(
    "C33",
    "cartao em analise (verificando:) cancelado pelo admin e liberado: 24 h",
    [
      P.gateway(
        "verificando:abc123",
        "metodo_online = 'credito', updated_at = now() - interval '10 minutes'",
      ),
      P.pedido("updated_at = now() - interval '10 minutes'"),
      P.cancelarEdge("verificando:abc123", U_ADMIN),
      P.liberar("verificando:abc123"),
    ],
    -60,
    PRE_B,
    false,
    true,
    aMin(H24 - 60),
  ),
];

/** Monta UM pedido do caso. Devolve {id, cup}. */
async function montarPix(c, cas, rotulo = cas.id) {
  const cup = cas.semCupom ? null : await cupomNovo(c);
  const id = await pedidoComCupom(
    c,
    cup?.codigo ?? null,
    cas.rpc ?? "create_marketplace_order_v24",
  );
  for (const passo of cas.passos) await passo(c, id);
  if (cas.exp !== null && cas.exp !== undefined)
    await c.query(
      "UPDATE public.marketplace_orders SET expires_at = now() + make_interval(secs => $2) WHERE id = $1",
      [id, cas.exp],
    );
  const e = await estadoCompleto(c, id);
  assert.deepEqual(
    [
      e.status,
      e.payment_status,
      e.gateway_payment_id !== null,
      e.tentativas_de_pagamento,
    ],
    cas.pre,
    `${rotulo}: pre-condicao do caso (o pedido nao e o que o caso diz)`,
  );
  return { id, cup };
}
/** O pedido do estado B, pronto para a varredura (vaga vazia, 1 tentativa, prazo do PIX vencido). */
const CASO_ELEGIVEL = cs(
  "EL",
  "elegivel",
  BASE_B(),
  -60,
  PRE_B,
  true,
  true,
  15,
);

/**
 * A tabela inteira, num banco com a M2 aplicada. A ORDEM importa: a RPC e o auxiliar LEEM antes
 * de a varredura escrever; depois a varredura decide, e os dois tem de concordar com ela.
 * `ids` restringe aos casos pedidos (os mutantes rodam so os que os pegam).
 */
async function casoVagaTabela(sql = lerMig2(), ids = null) {
  const db = await clonarComM2("vgtabela", sql);
  const sel = CASOS_PIX.filter((x) => !ids || ids.includes(x.id));
  assert.ok(sel.length > 0, "nenhum caso selecionado");
  await usar(db, async (c) => {
    const feitos = [];
    for (const cas of sel) {
      const ro = `${cas.id} ${cas.nome}`;
      const { id, cup } = await montarPix(c, cas, ro);
      if (cup) {
        const v0 = await validar(c, cup.codigo);
        assert.equal(v0.is_valid, false, `${ro}: a vaga devia estar segurada`);
        const r = await vagaPresa(c, cup.codigo);
        assert.equal(r.presa, cas.presa, `${ro}: a RPC diz presa=${r.presa}`);
        assert.equal(
          r.volta_em_minutos,
          cas.presa ? cas.minutos : null,
          `${ro}: minutos que a RPC promete`,
        );
      }
      const aux = await veredictoAux(c, id);
      assert.equal(
        aux.volta_antes_de_agora,
        cas.devolve,
        `${ro}: o auxiliar diz volta_antes_de_agora=${aux.volta_antes_de_agora}`,
      );
      assert.equal(
        aux.nunca,
        !cas.presa,
        `${ro}: o auxiliar diz nunca=${aux.nunca}`,
      );
      feitos.push({ cas, id, cup, ro });
    }
    const n = await varrer(c);
    for (const { cas, id, cup, ro } of feitos) {
      const depois = await estadoCompleto(c, id);
      const devolvidoPelaVarredura = cas.devolve && cup !== null;
      assert.equal(
        depois.coupon_usage_returned,
        cas.returnedDepois ?? devolvidoPelaVarredura,
        `${ro}: a varredura ${cas.devolve ? "devia devolver" : "NAO devia devolver"}`,
      );
      if (cup) {
        assert.equal(
          await usosDo(c, cup.id),
          devolvidoPelaVarredura ? 0 : 1,
          `${ro}: usage_count`,
        );
        assert.equal(
          (await validar(c, cup.codigo)).is_valid,
          devolvidoPelaVarredura,
          `${ro}: a vaga voltou de verdade?`,
        );
        if (devolvidoPelaVarredura) {
          assert.deepEqual(
            await vagaPresa(c, cup.codigo),
            { presa: false, volta_em_minutos: null },
            `${ro}: depois de devolver a RPC ainda diz presa`,
          );
          const aux2 = await veredictoAux(c, id);
          assert.equal(
            aux2.nunca,
            true,
            `${ro}: devolvido, o auxiliar nao diz nunca`,
          );
        }
      }
    }
    assert.equal(
      n,
      feitos.filter((f) => f.cas.devolve && f.cup).length,
      "quantos a varredura devolveu",
    );
    assert.equal(await varrer(c), 0, "a 2a varredura devolveu em dobro");
    for (const { cas, cup, ro } of feitos) {
      if (cup)
        assert.equal(
          await usosDo(c, cup.id),
          cas.devolve ? 0 : 1,
          `${ro}: usage_count depois da 2a varredura`,
        );
    }
  });
}

/**
 * O PRAZO (ajuste A2): a pista devolve p_expires_at, nunca '-infinity'. O admin que reativa o
 * pedido cancelado (update_order_status_atomic(id, 'pending'): o servidor nao barra o admin saindo
 * de cancelled) ENQUANTO o PIX ainda vale encontra o cupom ainda seguro; reativado, o pedido nunca
 * entra na varredura (status deixou de ser cancelled), nem depois do prazo.
 */
async function casoVagaReativacao(sql = lerMig2()) {
  const db = await clonarComM2("vgreativ", sql);
  await usar(db, async (c) => {
    const cas = cs(
      "RE",
      "reativacao",
      BASE_B(),
      600,
      PRE_B,
      false,
      true,
      aMin(600),
    );
    const { id, cup } = await montarPix(c, cas);
    assert.equal(
      await varrer(c),
      0,
      "o prazo do PIX ainda corre: nada a devolver",
    );
    assert.equal(
      await usosDo(c, cup.id),
      1,
      "o cupom devia seguir seguro durante o prazo do PIX",
    );
    const r = await vagaPresa(c, cup.codigo);
    assert.deepEqual(r, { presa: true, volta_em_minutos: aMin(600) });
    // o admin reativa dentro do prazo: o cupom segue seguro, o pedido volta a ser dele
    await P.reativarAdmin()(c, id);
    assert.equal((await estadoCompleto(c, id)).status, "pending");
    assert.equal(
      await usosDo(c, cup.id),
      1,
      "reativar nao pode devolver o cupom",
    );
    assert.equal(await varrer(c), 0);
    // passa o prazo do PIX: o pedido reativado NUNCA entra na varredura
    await c.query(
      "UPDATE public.marketplace_orders SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [id],
    );
    assert.equal(await varrer(c), 0, "pedido reativado entrou na varredura");
    assert.equal(
      await usosDo(c, cup.id),
      1,
      "o cupom do pedido reativado foi devolvido",
    );
    assert.deepEqual(await vagaPresa(c, cup.codigo), {
      presa: false,
      volta_em_minutos: null,
    });
  });
}

/**
 * O PAGAMENTO FANTASMA. Depois que a varredura devolve o cupom (vaga de cobranca vazia), um
 * pagamento que apareca para o PIX velho NAO se liga ao pedido (`divergente`) e o cupom do
 * proximo cliente segue valendo. No estado A (vaga ainda no PIX) o pagamento tardio e aceito como
 * `pago_apos_expirar` -- e justamente por isso a varredura NAO devolveu o cupom ali.
 */
async function casoVagaFantasma(sql = lerMig2()) {
  const db = await clonarComM2("vgfantasma", sql);
  await usar(db, async (c) => {
    // 1. estado B: a varredura devolve; o pagamento fantasma e divergente
    const { id, cup } = await montarPix(c, CASO_ELEGIVEL);
    assert.equal(await usosDo(c, cup.id), 1, "a vaga esta segurada");
    assert.equal(await varrer(c), 1, "a pista nova devolveu a vaga");
    assert.equal(await usosDo(c, cup.id), 0);
    assert.equal((await estadoCompleto(c, id)).coupon_usage_returned, true);
    const fotoAntes = await foto(c, id);
    for (const idPagamento of [gwDe(G, id), "MP-OUTRO", null]) {
      const r = await c.query(
        "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
        [id, idPagamento],
      );
      assert.equal(
        r.rows[0].r,
        "divergente",
        `confirmar_pagamento(${idPagamento})`,
      );
    }
    const p = await estadoCompleto(c, id);
    assert.equal(p.payment_status, "aguardando", "o pedido virou pago");
    assert.equal(p.status, "cancelled");
    assert.equal(p.gateway_payment_id, null);
    assert.equal(p.paid_at, null);
    assert.equal(await usosDo(c, cup.id), 0, "o uso do cupom mudou");
    assert.deepEqual(
      await foto(c, id),
      fotoAntes,
      "o pagamento fantasma mexeu na foto",
    );
    // o proximo cliente usa o cupom; o pagamento fantasma continua divergente e o uso nao muda
    assert.equal(
      (await validar(c, cup.codigo)).is_valid,
      true,
      "a vaga devolvida nao valida",
    );
    const outro = await pedidoComCupom(c, cup.codigo);
    assert.equal(await usosDo(c, cup.id), 1);
    const r2 = await c.query(
      "SELECT public.confirmar_pagamento($1::uuid, 'MP-FANTASMA-2', 'pago') AS r",
      [id],
    );
    assert.equal(r2.rows[0].r, "divergente");
    assert.equal(
      await usosDo(c, cup.id),
      1,
      "o pagamento fantasma mexeu no uso do cupom",
    );
    assert.equal((await estadoCompleto(c, outro)).coupon_usage_returned, false);

    // 2. estado A: a varredura NAO devolve e o pagamento tardio e aceito: nenhum cupom em dobro
    const a = await montarPix(
      c,
      cs(
        "FA",
        "estado A",
        [P.pix(), P.cancelarEdge()],
        -60,
        PRE_A,
        false,
        true,
        aMin(H24 - 60),
      ),
    );
    assert.equal(
      await varrer(c),
      0,
      "no estado A a varredura devolveu (cupom em dobro se o PIX for pago)",
    );
    assert.equal(await usosDo(c, a.cup.id), 1);
    const tarde = await c.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
      [a.id, gwDe(G, a.id)],
    );
    assert.equal(tarde.rows[0].r, "pago_apos_expirar");
    assert.equal(
      await usosDo(c, a.cup.id),
      1,
      "o pagamento tardio nao pode devolver nem consumir o cupom",
    );
    assert.equal(await varrer(c), 0, "pago_apos_expirar entrou na varredura");

    // 3. estado B ainda dentro do prazo do PIX: pagamento tardio e divergente E o cupom segue seguro
    const b = await montarPix(
      c,
      cs(
        "FB",
        "estado B no prazo",
        BASE_B(),
        600,
        PRE_B,
        false,
        true,
        aMin(600),
      ),
    );
    const r3 = await c.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
      [b.id, gwDe(G, b.id)],
    );
    assert.equal(r3.rows[0].r, "divergente");
    assert.equal(await varrer(c), 0);
    assert.equal(
      await usosDo(c, b.cup.id),
      1,
      "dentro do prazo o cupom segue seguro",
    );
  });
}

// ----------------------------------------------------------- duas conexoes reais
const sweepSql = `SELECT ${FN_VAR} AS n`;
const numero = (r) => Number(r.rows[0].n);

/** varredura x confirmar_pagamento, nas duas ordens. */
async function casoVagaConcorrenciaConfirmar(sql = lerMig2()) {
  const db = await clonarComM2("vgconf", sql);
  const A = await conexao(db);
  const B = await conexao(db);
  try {
    // ordem 1: a varredura segura a linha; o pagamento chega, ESPERA e e divergente
    const x = await usar(db, (c) => montarPix(c, CASO_ELEGIVEL));
    await A.query("BEGIN");
    assert.equal(
      numero(await A.query(sweepSql)),
      1,
      "a varredura devolve o pedido",
    );
    await B.query("BEGIN");
    const pend = B.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
      [x.id, gwDe(G, x.id)],
    ).then(
      (r) => ({ r: r.rows[0].r }),
      (erro) => ({ erro }),
    );
    await esperarBloqueio(db, 4000);
    await A.query("COMMIT");
    const rc = await comTempo(
      pend,
      8000,
      "confirmar_pagamento esperando a varredura",
    );
    assert.ok(!rc.erro, `confirmar_pagamento: ${rc.erro?.message}`);
    assert.equal(rc.r, "divergente", "o pagamento tardio depois da devolucao");
    await B.query("COMMIT");
    const px = await usar(db, (c) => estadoCompleto(c, x.id));
    assert.equal(px.payment_status, "aguardando");
    assert.equal(px.coupon_usage_returned, true);
    assert.equal(px.paid_at, null);
    assert.equal(await usar(db, (c) => usosDo(c, x.cup.id)), 0);

    // ordem 2: o pagamento chega PRIMEIRO e segura a linha; a varredura PULA (SKIP LOCKED)
    const y = await usar(db, (c) => montarPix(c, CASO_ELEGIVEL));
    await B.query("BEGIN");
    const rb = await B.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
      [y.id, gwDe(G, y.id)],
    );
    assert.equal(rb.rows[0].r, "divergente");
    await A.query("BEGIN");
    await A.query("SET LOCAL lock_timeout = '1500ms'");
    let n;
    try {
      n = numero(await A.query(sweepSql));
    } catch (e) {
      assert.fail(
        `a varredura ESPEROU a linha do pagamento (sem SKIP LOCKED): ${e.message}`,
      );
    }
    assert.equal(n, 0, "a varredura devia pular a linha presa pelo pagamento");
    await B.query("COMMIT");
    await A.query("COMMIT");
    assert.equal(
      await usar(db, (c) => usosDo(c, y.cup.id)),
      1,
      "nada devolvido ainda",
    );
    assert.equal(
      await usar(db, (c) => varrer(c)),
      1,
      "a varredura seguinte devolve",
    );
    assert.equal(await usar(db, (c) => usosDo(c, y.cup.id)), 0);
    const py = await usar(db, (c) => estadoCompleto(c, y.id));
    assert.equal(py.payment_status, "aguardando");
    assert.equal(py.paid_at, null);
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await A.end().catch(() => {});
    await B.end().catch(() => {});
  }
}

/** varredura x liberar, e uma tentativa nova durante a varredura. */
async function casoVagaConcorrenciaLiberar(sql = lerMig2()) {
  const db = await clonarComM2("vglib", sql);
  const w = await usar(db, (c) =>
    montarPix(
      c,
      cs(
        "WA",
        "estado A",
        [P.pix(), P.cancelarEdge()],
        -60,
        PRE_A,
        false,
        true,
        aMin(H24 - 60),
      ),
    ),
  );
  const v = await usar(db, (c) => montarPix(c, CASO_ELEGIVEL));
  const A = await conexao(db);
  const B = await conexao(db);
  try {
    // 1. o webhook esta liberando a vaga (UPDATE nao confirmado); a varredura ve o estado antigo
    await B.query("BEGIN");
    const lib = await B.query(
      "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2::text) AS ok",
      [w.id, gwDe(G, w.id)],
    );
    assert.equal(lib.rows[0].ok, true);
    await A.query("BEGIN");
    await A.query("SET LOCAL lock_timeout = '1500ms'");
    const t0 = Date.now();
    // (o V esta elegivel: a varredura devolve so ele)
    assert.equal(numero(await A.query(sweepSql)), 1, "so o elegivel");
    assert.ok(Date.now() - t0 < 1400, "a varredura esperou a liberacao");
    await A.query("COMMIT");
    assert.equal(
      (await usar(db, (c) => estadoCompleto(c, w.id))).coupon_usage_returned,
      false,
      "a varredura devolveu o pedido cuja vaga ainda nao tinha sido liberada",
    );
    await B.query("COMMIT");
    // liberada: agora a pista vale e a varredura seguinte devolve
    assert.equal(await usar(db, (c) => varrer(c)), 1);
    assert.equal(await usar(db, (c) => usosDo(c, w.cup.id)), 0);
    assert.equal(await usar(db, (c) => usosDo(c, v.cup.id)), 0);

    // 2. uma tentativa NOVA durante a varredura: a linha esta presa, a varredura pula, e depois
    //    do COMMIT (2 tentativas) a pista deixa de valer: o cupom segue as 24 h de hoje
    const u = await usar(db, (c) => montarPix(c, CASO_ELEGIVEL));
    await B.query("BEGIN");
    const lib2 = await B.query(
      "SELECT public.liberar_cobranca_do_pedido($1::uuid, NULL) AS ok",
      [u.id],
    );
    assert.equal(lib2.rows[0].ok, true);
    await A.query("BEGIN");
    await A.query("SET LOCAL lock_timeout = '1500ms'");
    assert.equal(
      numero(await A.query(sweepSql)),
      0,
      "a varredura devia pular a linha presa",
    );
    await A.query("COMMIT");
    await B.query("COMMIT");
    assert.equal(
      await usar(db, (c) => varrer(c)),
      0,
      "com 2 tentativas a pista nao vale",
    );
    assert.equal(await usar(db, (c) => usosDo(c, u.cup.id)), 1);
    await usar(db, (c) =>
      c.query(
        "UPDATE public.marketplace_orders SET expires_at = now() - interval '25 hours' WHERE id = $1",
        [u.id],
      ),
    );
    assert.equal(
      await usar(db, (c) => varrer(c)),
      1,
      "passadas as 24 h o cupom volta como hoje",
    );
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await A.end().catch(() => {});
    await B.end().catch(() => {});
  }
}

/** Duas varreduras em conexoes reais: uma devolucao so (SKIP LOCKED). */
async function casoVagaDuasVarreduras(sql = lerMig2()) {
  const db = await clonarComM2("vg2var", sql);
  const { id, cup } = await usar(db, (c) => montarPix(c, CASO_ELEGIVEL));
  const A = await conexao(db);
  const B = await conexao(db);
  try {
    await A.query("BEGIN");
    assert.equal(
      numero(await A.query(sweepSql)),
      1,
      "a 1a varredura devolve o pedido",
    );
    await B.query("BEGIN");
    await B.query("SET LOCAL lock_timeout = '1500ms'");
    let rb;
    try {
      rb = await B.query(sweepSql);
    } catch (e) {
      assert.fail(
        `a 2a varredura ESPEROU a linha da 1a (sem SKIP LOCKED): ${e.message}`,
      );
    }
    assert.equal(numero(rb), 0, "a 2a varredura pulou a linha travada");
    await A.query("COMMIT");
    assert.equal(
      numero(await B.query(sweepSql)),
      0,
      "depois do commit, nada a devolver de novo",
    );
    await B.query("COMMIT");
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await A.end().catch(() => {});
    await B.end().catch(() => {});
  }
  assert.equal(
    await usar(db, (c) => usosDo(c, cup.id)),
    0,
    "devolvida exatamente UMA vez (nunca negativo)",
  );
  assert.equal(
    (await usar(db, (c) => estadoCompleto(c, id))).coupon_usage_returned,
    true,
  );
}

/**
 * A varredura (o agendador) roda NO MEIO da aplicacao: com a migration ja executada e ainda sem
 * COMMIT, a varredura segue funcionando com o catalogo antigo (nao trava, nao erra); depois do
 * COMMIT, com o novo.
 */
async function casoVagaVarreduraNoMeio(sql = lerMig2()) {
  const db = await clonar2("vgmeio");
  const mkNunca = (c) =>
    montarPix(
      c,
      cs(
        "NC",
        "nunca cobrado",
        [P.cancelarCliente()],
        -46 * 60,
        ["cancelled", "aguardando", false, 0],
        true,
        true,
        15,
      ),
    );
  const a = await usar(db, mkNunca);
  const m = await conexao(db);
  try {
    await m.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await m.query("SELECT count(*) FROM public.marketplace_orders");
    await m.query(sql); // executada, ainda sem COMMIT
    const t0 = Date.now();
    const n = await comTempo(
      usar(db, (c) => varrer(c)),
      8000,
      "a varredura durante a migration",
    );
    assert.equal(n, 1, "a varredura antiga devolve o pedido nunca cobrado");
    assert.ok(
      Date.now() - t0 < 3000,
      `a varredura esperou a migration ${Date.now() - t0} ms`,
    );
    assert.equal(await usar(db, (c) => usosDo(c, a.cup.id)), 0);
    await m.query("COMMIT");
  } finally {
    await m.query("ROLLBACK").catch(() => {});
    await m.end().catch(() => {});
  }
  // depois do COMMIT a varredura nova funciona
  const b = await usar(db, mkNunca);
  assert.equal(await usar(db, (c) => varrer(c)), 1);
  assert.equal(await usar(db, (c) => usosDo(c, b.cup.id)), 0);
}

// ----------------------------------------------------------- o envelope de producao
const temAux13 = (db) =>
  usar(
    db,
    async (c) =>
      (
        await c.query("SELECT to_regprocedure($1) IS NOT NULL AS ok", [
          FN_AUX13,
        ])
      ).rows[0].ok,
  );
/**
 * O envelope REPEATABLE READ de producao. A M2 nao le nem escreve LINHA de tabela e nao pede trava
 * de tabela: nenhum pedido (em andamento ou que chega durante a aplicacao) espera por ela ou a
 * espera, e ninguem leva 40P01 (deadlock) nem 40001. Quatro ordens: (1) livre; (2) o pedido em
 * andamento segura a tabela ANTES; (3) a migration executa ANTES (ainda sem COMMIT) e o pedido
 * chega depois; (4) o cruzamento de dois pedidos (um segura a tabela e quer a linha do cupom, o
 * outro segura a linha do cupom e quer a tabela) com a migration no envelope.
 */
async function casoVagaEnvelope(sql = lerMig2()) {
  // (1) livre
  const livre = await clonar2("vgrrok");
  const r1 = await emEnvelopeRR(livre, sql);
  assert.ok(
    !r1.erro,
    `envelope RR sem concorrente: ${r1.erro?.code} ${r1.erro?.message}`,
  );
  assert.equal(await temAux13(livre), true);

  // (2) o pedido em andamento segura a tabela antes
  const db2 = await clonar2("vgrrped");
  const ped = await usar(db2, (c) => novoPedido(c));
  const antes2 = await fotografia(db2);
  const p = await conexao(db2);
  try {
    await p.query("BEGIN");
    await p.query(
      "UPDATE public.marketplace_orders SET notes = 'em andamento' WHERE id = $1",
      [ped],
    );
    const t0 = Date.now();
    const r = await comTempo(
      emEnvelopeRR(db2, sql),
      15000,
      "migration com pedido em andamento",
    );
    const ms = Date.now() - t0;
    assert.ok(
      !r.erro,
      `a M2 nao pede trava de tabela: devia aplicar sem esperar o pedido (esperar ou 55P03 sem gravar seriam aceitaveis; 40P01/40001 nunca): ${r.erro?.code} ${r.erro?.message}`,
    );
    assert.equal(await temAux13(db2), true);
    assert.ok(ms < 3000, `a migration esperou o pedido ${ms} ms`);
    assert.notEqual(
      antes2.funcoes,
      (await fotografia(db2)).funcoes,
      "a migration nao gravou nada?",
    );
    await p.query("COMMIT");
  } finally {
    await p.query("ROLLBACK").catch(() => {});
    await p.end().catch(() => {});
  }

  // (3) a migration executa antes (sem COMMIT); o pedido chega depois e NAO fica parado
  const db3 = await clonar2("vgrrdepois");
  const [ped3, ped3b] = await usar(db3, async (c) => [
    await novoPedido(c),
    await novoPedido(c),
  ]);
  const m = await conexao(db3);
  const t = await conexao(db3);
  try {
    await m.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await m.query("SELECT count(*) FROM public.marketplace_orders");
    await m.query(sql);
    const t0 = Date.now();
    await comTempo(
      t.query(
        "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
        [ped3],
      ),
      5000,
      "cancelar durante a migration",
    );
    await comTempo(
      t.query(
        "UPDATE public.marketplace_orders SET notes = 'x' WHERE id = $1",
        [ped3b],
      ),
      5000,
      "gravar durante a migration",
    );
    assert.ok(
      Date.now() - t0 < 1500,
      `o pedido que chegou com a migration aberta ficou parado ${Date.now() - t0} ms`,
    );
    await m.query("COMMIT");
  } finally {
    await m.query("ROLLBACK").catch(() => {});
    await m.end().catch(() => {});
    await t.end().catch(() => {});
  }
  assert.equal(await temAux13(db3), true);
  assert.ok(
    await usar(db3, (c) => foto(c, ped3)),
    "o cancelamento durante a migration nao gravou a foto",
  );

  // (4) o cruzamento
  const db4 = await clonar2("vgcruz");
  const [x, y] = await usar(db4, async (c) => [
    await novoPedido(c),
    await novoPedido(c),
  ]);
  const t1 = await conexao(db4);
  const t2 = await conexao(db4);
  const erros = [];
  const registrar = (rotulo) => (erro) => {
    erros.push(`${rotulo}: ${erro.code} ${erro.message}`);
    return { erro };
  };
  try {
    await t1.query("BEGIN");
    await t1.query(
      "UPDATE public.marketplace_orders SET notes = 't1' WHERE id = $1",
      [x],
    );
    await t2.query("BEGIN");
    await t2.query(
      "SELECT id FROM public.coupons WHERE code = 'FOTOK' FOR UPDATE",
    );
    const emM = emEnvelopeRR(db4, sql).then((r) => {
      if (r.erro) erros.push(`migration: ${r.erro.code} ${r.erro.message}`);
      return r;
    });
    await dormir(700);
    const t0 = Date.now();
    const p2 = t2
      .query(
        "UPDATE public.marketplace_orders SET notes = 't2' WHERE id = $1",
        [y],
      )
      .then(() => ({ ok: true }), registrar("pedido T2 (quer a tabela)"));
    const r2 = await comTempo(p2, 9000, "T2");
    const ms2 = Date.now() - t0;
    assert.ok(
      ms2 < 1500,
      `o pedido que chegou com a migration esperando ficou parado ${ms2} ms (a migration esta na fila da trava: o checkout para)`,
    );
    const p1 = t1
      .query("SELECT id FROM public.coupons WHERE code = 'FOTOK' FOR UPDATE")
      .then(() => ({ ok: true }), registrar("pedido T1 (quer o cupom)"));
    await dormir(200);
    if (!r2.erro) await t2.query("COMMIT").catch(registrar("commit T2"));
    const r1b = await comTempo(p1, 9000, "T1");
    if (!r1b.erro) await t1.query("COMMIT").catch(registrar("commit T1"));
    const rM = await comTempo(emM, 20000, "migration");
    assert.deepEqual(
      erros,
      [],
      `houve erro no cruzamento (40P01 = deadlock): ${erros.join(" | ")}`,
    );
    assert.ok(!rM.erro, "a migration devia aplicar");
  } finally {
    await t1.query("ROLLBACK").catch(() => {});
    await t2.query("ROLLBACK").catch(() => {});
    await t1.end().catch(() => {});
    await t2.end().catch(() => {});
  }
  assert.equal(
    await temAux13(db4),
    true,
    "a migration nao aplicou depois do cruzamento",
  );
}

// ----------------------------------------------------------- catalogo, idempotencia, ida e volta
const aclDe = async (c, assinatura) =>
  (
    await c.query(
      `SELECT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [assinatura],
    )
  ).rows[0];

async function casoVagaCatalogo(sql = lerMig2()) {
  const db = await clonarComM2("vgcat", sql);
  const pre = await fotografia(PRE2);
  const aclAntes = await usar(
    PRE2,
    async (c) =>
      (
        await c.query(
          `SELECT proname, proacl::text AS acl FROM pg_proc
          WHERE oid IN (to_regprocedure($1), to_regprocedure($2)) ORDER BY proname`,
          [FN_RPC, FN_VAR],
        )
      ).rows,
  );
  await usar(db, async (c) => {
    const q = async (s, p = []) => (await c.query(s, p)).rows;
    // so a geracao nova das tres funcoes
    for (const [nome, n] of [
      ["cupom__vaga_volta_em", 1],
      ["vaga_do_cupom_presa", 1],
      ["devolver_cupons_de_pedidos_mortos", 1],
    ]) {
      const r = await q(
        "SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = $1",
        [nome],
      );
      assert.equal(r[0].n, n, `${nome}: ${r[0].n} sobrecarga(s)`);
    }
    assert.equal(
      (await q("SELECT to_regprocedure($1) AS f", [FN_AUX9]))[0].f,
      null,
      "a funcao de 9 parametros sobrou",
    );
    assert.notEqual(
      (await q("SELECT to_regprocedure($1) AS f", [FN_AUX13]))[0].f,
      null,
      "a de 13 parametros nao existe",
    );
    const aux = (
      await q(
        `SELECT p.provolatile, p.proconfig::text AS config, p.prorettype::regtype::text AS ret,
                p.prosecdef, p.pronargs, obj_description(p.oid, 'pg_proc') AS comentario
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [FN_AUX13],
      )
    )[0];
    assert.equal(
      aux.provolatile,
      "s",
      "o auxiliar tem de ser STABLE (le now())",
    );
    assert.equal(aux.config, "{search_path=public}");
    assert.equal(aux.ret, "timestamp with time zone");
    assert.equal(aux.prosecdef, false, "o auxiliar nao e SECURITY DEFINER");
    assert.equal(aux.pronargs, 13);
    assert.match(aux.comentario, /20261210000000/);
    assert.deepEqual(
      await aclDe(c, FN_AUX13),
      { publico: false, anon: false, auth: false, service: false },
      "EXECUTE de fora no auxiliar",
    );
    const rpc = (
      await q(
        `SELECT p.prosecdef, p.proconfig::text AS config, p.prorettype::regtype::text AS ret,
                obj_description(p.oid, 'pg_proc') AS comentario
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [FN_RPC],
      )
    )[0];
    assert.equal(rpc.prosecdef, true);
    assert.equal(rpc.config, "{search_path=public}");
    assert.equal(rpc.ret, "jsonb");
    assert.match(rpc.comentario, /20261210000000/);
    assert.deepEqual(
      await aclDe(c, FN_RPC),
      { publico: false, anon: false, auth: true, service: false },
      "ACL da RPC",
    );
    const varr = (
      await q(
        `SELECT p.prosecdef, p.proconfig::text AS config, p.prorettype::regtype::text AS ret,
                obj_description(p.oid, 'pg_proc') AS comentario
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [FN_VAR],
      )
    )[0];
    assert.equal(varr.prosecdef, true);
    assert.equal(varr.config, "{search_path=public}");
    assert.equal(varr.ret, "integer");
    assert.match(varr.comentario, /20261210000000/);
    const av = await aclDe(c, FN_VAR);
    assert.deepEqual(
      [av.publico, av.anon, av.auth],
      [false, false, false],
      "a varredura segue fechada",
    );
    const aclDepois = await q(
      `SELECT proname, proacl::text AS acl FROM pg_proc
        WHERE oid IN (to_regprocedure($1), to_regprocedure($2)) ORDER BY proname`,
      [FN_RPC, FN_VAR],
    );
    assert.deepEqual(aclDepois, aclAntes, "a ACL da RPC ou da varredura mudou");
    // continua agendada a cada 15 minutos
    const job = await q(
      "SELECT count(*)::int AS n FROM cron.job WHERE jobname = 'devolver-cupons-de-pedidos-mortos' AND schedule = '*/15 * * * *'",
    );
    assert.equal(job[0].n, 1, "a varredura deixou de estar agendada");
    // os corpos vivos SAO os do arquivo
    const m2 = corposM2(sql);
    assert.equal(await corpoVivo(db, FN_AUX13), m2.aux, "corpo do auxiliar");
    assert.equal(await corpoVivo(db, FN_RPC), m2.rpc, "corpo da RPC");
    assert.equal(await corpoVivo(db, FN_VAR), m2.var, "corpo da varredura");
  });
  // nada mais mudou: as outras funcoes, tabelas, politicas, gatilhos e pedidos
  assert.equal(
    await outrasFuncoes(db),
    await outrasFuncoes(PRE2),
    "outra funcao mudou",
  );
  const agora = await fotografia(db);
  assert.deepEqual(
    { ...agora, funcoes: null },
    { ...pre, funcoes: null },
    "algo alem das tres funcoes mudou",
  );
}

async function casoVagaIdempotente(sql = lerMig2()) {
  const db = await clonar2("vgidem");
  const r1 = await aplicar(db, sql);
  assert.ok(!r1.erro, `1a aplicacao falhou: ${r1.erro?.message}`);
  const meio = await fotografia(db);
  // o texto com fim de linha CRLF grava os corpos em CRLF: so o md5 das funcoes muda (o pre-voo
  // e o pos-voo aceitam os dois); a aplicacao em LF seguinte restaura tudo
  for (const [rot, texto, igual] of [
    ["2a", sql, true],
    ["3a (CRLF)", crlf(sql), false],
    ["4a (CRLF de novo)", crlf(sql), false],
    ["5a (LF de novo)", sql, true],
  ]) {
    const r = await aplicar(db, texto);
    assert.ok(
      !r.erro,
      `${rot} aplicacao falhou: ${r.erro?.code} ${r.erro?.message}`,
    );
    const agora = await fotografia(db);
    assert.deepEqual(
      igual ? agora : { ...agora, funcoes: meio.funcoes },
      meio,
      `${rot} aplicacao mudou algo`,
    );
  }
}
async function casoVagaAtomico(sql = lerMig2()) {
  const db = await clonar2("vgatomico");
  const antes = await fotografia(db);
  // falha DEPOIS da ultima peca
  const r = await aplicar(db, `${sql}\nSELECT 1/0;\n`);
  assert.ok(r.erro, "a divisao por zero tem de falhar");
  assert.equal(r.erro.code, "22012", r.erro.message);
  await nadaGravado(db, antes, "falha depois da ultima peca");
  // falha no MEIO, depois do DROP da funcao de 9 parametros e da criacao da de 13: o banco volta
  // inteiro (a funcao de 9 parametros continua la; nenhuma metade gravada)
  const ini = sql.indexOf("COMMENT ON FUNCTION public.cupom__vaga_volta_em(");
  assert.ok(ini > 0, "comentario do auxiliar nao achado");
  const fim = sql.indexOf("';\n", ini) + 3;
  const meio = `${sql.slice(0, fim)}SELECT 1/0;\n${sql.slice(fim)}`;
  const r1 = await aplicar(db, meio);
  assert.ok(r1.erro, "a falha no meio tem de falhar");
  assert.equal(r1.erro.code, "22012", r1.erro.message);
  await nadaGravado(db, antes, "falha no meio, depois do DROP");
  assert.equal(
    await usar(
      db,
      async (c) =>
        (
          await c.query("SELECT to_regprocedure($1) IS NOT NULL AS ok", [
            FN_AUX9,
          ])
        ).rows[0].ok,
    ),
    true,
    "a funcao de 9 parametros sumiu com a migration que falhou",
  );
  const r2 = await aplicar(db, `BEGIN;\n${sql}\nROLLBACK;\n`);
  assert.ok(!r2.erro, r2.erro?.message);
  await nadaGravado(db, antes, "BEGIN ... ROLLBACK");
  const r3 = await aplicar(db, `BEGIN;\n${sql}\nCOMMIT;\n`);
  assert.ok(!r3.erro, r3.erro?.message);
  assert.equal(await temAux13(db), true);
}
/** Aplicar, rollback, reaplicar: o catalogo volta EXATO ao do estado pre; corpos da 1206 e da 1205 byte a byte. */
async function casoVagaIdaEVolta(sql = lerMig2(), rb = lerRb2()) {
  const db = await clonar2("vgidavolta");
  const pre = await fotografia(db);
  const c1206 = corpos1206();
  const c1205 = corpos1205();
  let aplicada = null;
  for (let volta = 1; volta <= 2; volta += 1) {
    const r = await aplicar(db, sql);
    assert.ok(
      !r.erro,
      `aplicar (volta ${volta}): ${r.erro?.code} ${r.erro?.message}`,
    );
    const noAr = await fotografia(db);
    if (aplicada)
      assert.deepEqual(
        { ...noAr, pedidos: null },
        { ...aplicada, pedidos: null },
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
    aplicada = noAr;
    // a pista funciona depois de cada aplicacao: um pedido do estado B volta
    await usar(db, async (c) => {
      const { id, cup } = await montarPix(c, CASO_ELEGIVEL);
      assert.equal(await varrer(c), 1, `volta ${volta}: a pista nao devolveu`);
      assert.equal(await usosDo(c, cup.id), 0);
      assert.equal((await estadoCompleto(c, id)).coupon_usage_returned, true);
    });
    const comPedido = (await fotografia(db)).pedidos;
    const rr = await aplicar(db, rb);
    assert.ok(
      !rr.erro,
      `rollback (volta ${volta}): ${rr.erro?.code} ${rr.erro?.message}`,
    );
    const volt = await fotografia(db);
    assert.deepEqual(
      { ...volt, pedidos: null },
      { ...pre, pedidos: null },
      "o catalogo nao voltou EXATO ao do estado pre-M2",
    );
    assert.equal(volt.pedidos, comPedido, "o rollback mexeu em pedido");
    // os corpos voltaram aos da 1206 (auxiliar de 9 parametros, varredura) e da 1205 (RPC), byte a byte
    assert.equal(
      sha256(await corpoVivo(db, FN_AUX9)),
      sha256(c1206.aux),
      "auxiliar nao voltou ao da 1206",
    );
    assert.equal(
      sha256(await corpoVivo(db, FN_VAR)),
      sha256(c1206.var),
      "varredura nao voltou a da 1206",
    );
    assert.equal(
      sha256(await corpoVivo(db, FN_RPC)),
      sha256(c1205.rpc),
      "RPC nao voltou a da 1205",
    );
    assert.equal(await temAux13(db), false, "a funcao de 13 parametros sobrou");
    // rollback repetido: no-op; CRLF tambem
    const rr2 = await aplicar(db, rb);
    assert.ok(!rr2.erro, `rollback repetido: ${rr2.erro?.message}`);
    assert.deepEqual(
      await fotografia(db),
      volt,
      "rollback repetido mudou algo",
    );
    const rr3 = await aplicar(db, crlf(rb));
    assert.ok(!rr3.erro, `rollback CRLF: ${rr3.erro?.message}`);
    assert.deepEqual(
      { ...(await fotografia(db)), funcoes: null },
      { ...volt, funcoes: null },
    );
    // o corpo gravado em CRLF volta a LF na proxima aplicacao em LF
    const rr4 = await aplicar(db, rb);
    assert.ok(!rr4.erro, `rollback LF depois do CRLF: ${rr4.erro?.message}`);
    assert.deepEqual(
      await fotografia(db),
      volt,
      "o rollback em LF nao restaurou o estado exato",
    );
  }
  const r = await aplicar(db, sql);
  assert.ok(!r.erro);
  const r2 = await aplicar(db, sql);
  assert.ok(!r2.erro);
}

// ----------------------------------------------------------- pre-voo que recusa
async function umByteAMais(c, assinatura) {
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
      assinatura,
    ])
  ).rows[0].d;
  const i = def.lastIndexOf("$function$");
  assert.ok(i > 0, "fecho da funcao nao achado");
  await c.query(`${def.slice(0, i)} ${def.slice(i)}`);
}
const ddlAlheia = {
  aux13:
    "CREATE FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text) RETURNS timestamptz LANGUAGE sql AS $f$ SELECT NULL::timestamptz $f$",
  auxOutra:
    "CREATE FUNCTION public.cupom__vaga_volta_em(p integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$",
  varOutra:
    "CREATE FUNCTION public.devolver_cupons_de_pedidos_mortos(p integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$",
  rpcOutra:
    "CREATE FUNCTION public.vaga_do_cupom_presa(p integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$",
};
/** As variantes do pre-voo: `base` = de onde clonar ("pre" sem a foto, "pre2" com a foto, "m2" com a M2 aplicada). */
const VARIANTES_PREVOO = [
  {
    id: "foto",
    base: "pre",
    trecho: /falta a foto da cobranca/,
    preparo: async () => {},
  },
  {
    id: "forma",
    base: "pre2",
    trecho: /pedido_cobranca_ao_cancelar tem outra forma de colunas/,
    preparo: (c) =>
      c.query(
        "ALTER TABLE public.pedido_cobranca_ao_cancelar RENAME COLUMN tentativas TO tentativas_x",
      ),
  },
  {
    id: "fotofn",
    base: "pre2",
    trecho:
      /pedido__foto_da_cobranca_ao_cancelar\(\) tem corpo diferente do da 20261209000000/,
    preparo: (c) =>
      c.query(
        "CREATE OR REPLACE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN NEW; END $f$",
      ),
  },
  {
    id: "fotofnsem",
    base: "pre2",
    trecho: /pedido__foto_da_cobranca_ao_cancelar\(\) nao existe/,
    preparo: (c) =>
      c.query(
        "DROP FUNCTION public.pedido__foto_da_cobranca_ao_cancelar() CASCADE",
      ),
  },
  {
    id: "pk",
    base: "pre2",
    trecho: /pedido_cobranca_ao_cancelar nao tem a chave primaria em order_id/,
    preparo: (c) =>
      c.query(
        "ALTER TABLE public.pedido_cobranca_ao_cancelar DROP CONSTRAINT pedido_cobranca_ao_cancelar_pkey",
      ),
  },
  {
    id: "auxsozinha",
    base: "pre2",
    trecho:
      /a unica cupom__vaga_volta_em que existe nao tem 9 nem 13 parametros/,
    preparo: async (c) => {
      await c.query(
        "DROP FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)",
      );
      await c.query(ddlAlheia.auxOutra);
    },
  },
  {
    id: "gatilho",
    base: "pre2",
    trecho:
      /gatilho tr_pedido_foto_da_cobranca_ao_cancelar ausente, desligado ou com outra definicao/,
    preparo: (c) =>
      c.query(
        "ALTER TABLE public.marketplace_orders DISABLE TRIGGER tr_pedido_foto_da_cobranca_ao_cancelar",
      ),
  },
  {
    id: "coluna",
    base: "pre2",
    trecho:
      /falta a coluna public\.marketplace_orders\.tentativas_de_pagamento/,
    preparo: (c) =>
      c.query(
        "ALTER TABLE public.marketplace_orders RENAME COLUMN tentativas_de_pagamento TO tentativas_x",
      ),
  },
  {
    id: "sem1206",
    base: "pre2",
    trecho:
      /corpo vivo de devolver_cupons_de_pedidos_mortos\(\) \(hash [0-9a-f]{64}\) nao e o da 20261206000000/,
    preparo: async (c) => {
      await c.query(lerLF(`rollback-manual-${ARQ_1206}`));
    },
  },
  {
    id: "aux9corpo",
    base: "pre2",
    trecho:
      /corpo vivo de cupom__vaga_volta_em de 9 parametros \(hash [0-9a-f]{64}\)/,
    preparo: (c) => umByteAMais(c, FN_AUX9),
  },
  {
    id: "rpccorpo",
    base: "pre2",
    trecho: /corpo vivo de vaga_do_cupom_presa \(hash [0-9a-f]{64}\)/,
    preparo: (c) => umByteAMais(c, FN_RPC),
  },
  {
    id: "varcorpo",
    base: "pre2",
    trecho:
      /corpo vivo de devolver_cupons_de_pedidos_mortos\(\) \(hash [0-9a-f]{64}\) nao e o da 20261206000000 nem o desta migration/,
    preparo: (c) => umByteAMais(c, FN_VAR),
  },
  {
    id: "aux13corpo",
    base: "m2",
    trecho:
      /corpo vivo de cupom__vaga_volta_em de 13 parametros \(hash [0-9a-f]{64}\)/,
    preparo: (c) => umByteAMais(c, FN_AUX13),
  },
  {
    id: "auxdupla",
    base: "pre2",
    trecho: /esperava exatamente uma versao de cupom__vaga_volta_em/,
    preparo: (c) => c.query(ddlAlheia.aux13),
  },
  {
    id: "auxoutra",
    base: "pre2",
    trecho: /esperava exatamente uma versao de cupom__vaga_volta_em/,
    preparo: (c) => c.query(ddlAlheia.auxOutra),
  },
  {
    id: "varuma",
    base: "pre2",
    trecho:
      /esperava exatamente uma versao de devolver_cupons_de_pedidos_mortos\(\)/,
    preparo: (c) => c.query(ddlAlheia.varOutra),
  },
  {
    id: "rpcuma",
    base: "pre2",
    trecho: /esperava exatamente uma versao de vaga_do_cupom_presa\(text\)/,
    preparo: (c) => c.query(ddlAlheia.rpcOutra),
  },
  {
    id: "falta",
    base: "pre2",
    trecho: /falta a funcao public\.devolver_uso_cupom\(uuid\)/,
    preparo: (c) => c.query("DROP FUNCTION public.devolver_uso_cupom(uuid)"),
  },
];
async function casoVagaPreVoo(sql = lerMig2(), so = null) {
  const sel = VARIANTES_PREVOO.filter((v) => !so || so.includes(v.id));
  assert.ok(sel.length > 0, "nenhuma variante de pre-voo");
  for (const v of sel) {
    const db =
      v.base === "pre"
        ? await clonar(`pv${v.id}`)
        : v.base === "m2"
          ? await clonarComM2(`pv${v.id}`)
          : await clonar2(`pv${v.id}`);
    await usar(db, v.preparo);
    const antes = await fotografia(db);
    recusou(await aplicar(db, sql), v.trecho, `pre-voo: ${v.id}`);
    await nadaGravado(db, antes, `pre-voo: ${v.id}`);
  }
}
/** A funcao de 9 parametros tem quem dependa dela: o DROP (sem CASCADE) recusa e nada e gravado. */
async function casoVagaDependente(sql = lerMig2()) {
  const db = await clonar2("vgdep");
  await usar(db, (c) =>
    c.query(
      `CREATE FUNCTION public.dep_aux_pa() RETURNS timestamptz LANGUAGE sql
         BEGIN ATOMIC
           SELECT public.cupom__vaga_volta_em(NULL::uuid, NULL::text, NULL::text, NULL::boolean,
             NULL::timestamptz, NULL::boolean, NULL::timestamptz, NULL::text, NULL::integer);
         END`,
    ),
  );
  const antes = await fotografia(db);
  const r = await aplicar(db, sql);
  assert.ok(r.erro, "a migration apagou a funcao que outra usa");
  assert.equal(r.erro.code, "2BP01", `${r.erro.code} ${r.erro.message}`);
  assert.match(r.erro.message, /cupom__vaga_volta_em/);
  await nadaGravado(db, antes, "funcao dependente");
}

/** Pos-voo: cada peca quebrada de proposito derruba a migration inteira (nada fica). */
async function casoVagaPosvoo(sqlQuebrado, trecho, rotulo) {
  const db = await clonar2("vgposvoo");
  const antes = await fotografia(db);
  recusou(await aplicar(db, sqlQuebrado), trecho, `pos-voo: ${rotulo}`);
  await nadaGravado(db, antes, `pos-voo: ${rotulo}`);
}
const antesDoPosvoo = (sql, extra) =>
  trocar(sql, "DO $posvoo_20261210$", `${extra}DO $posvoo_20261210$`);
function quebrasM2(base = lerMig2()) {
  return [
    {
      rotulo: "corpo do auxiliar diferente",
      msg: MSG2.posCorpo,
      trecho: /saiu da migration com o corpo \(hash/,
      sql: trocar(
        base,
        T2.entao,
        "        THEN p_expires_at + interval '1 second'\n",
      ),
    },
    {
      rotulo: "corpo da varredura diferente",
      msg: MSG2.posCorpo,
      trecho: /saiu da migration com o corpo \(hash/,
      sql: trocar(base, T2.varLock, T2.varLockSemSkip),
    },
    {
      rotulo: "corpo da RPC diferente",
      msg: MSG2.posCorpo,
      trecho: /saiu da migration com o corpo \(hash/,
      sql: trocar(base, T2.rpcMais15, "::integer + 16;"),
    },
    {
      rotulo: "EXECUTE sobrando no auxiliar",
      msg: MSG2.posAclAux,
      trecho: /public\.cupom__vaga_volta_em saiu com EXECUTE/,
      sql: trocar(base, T2.revAux13, ""),
    },
    {
      rotulo: "a funcao de 9 parametros continua",
      msg: MSG2.posSobrecarga,
      trecho: /cupom__vaga_volta_em ficou com 2 sobrecargas/,
      sql: trocar(base, T2.dropAux9, ""),
    },
    {
      rotulo: "a RPC perde o EXECUTE do authenticated",
      msg: MSG2.posAclRpc,
      trecho: /vaga_do_cupom_presa saiu com a permissao diferente/,
      sql: antesDoPosvoo(
        base,
        "REVOKE EXECUTE ON FUNCTION public.vaga_do_cupom_presa(text) FROM authenticated;\n",
      ),
    },
    {
      rotulo: "a RPC ganha EXECUTE para anon",
      msg: MSG2.posAclRpc,
      trecho: /vaga_do_cupom_presa saiu com a permissao diferente/,
      sql: antesDoPosvoo(
        base,
        "GRANT EXECUTE ON FUNCTION public.vaga_do_cupom_presa(text) TO anon;\n",
      ),
    },
    {
      rotulo: "a varredura ganha EXECUTE para authenticated",
      msg: MSG2.posAclVar,
      trecho:
        /devolver_cupons_de_pedidos_mortos saiu com a permissao diferente/,
      sql: antesDoPosvoo(
        base,
        "GRANT EXECUTE ON FUNCTION public.devolver_cupons_de_pedidos_mortos() TO authenticated;\n",
      ),
    },
  ];
}

// ----------------------------------------------------------- rollback que recusa e a ordem de desfazer
const VARIANTES_ROLLBACK = [
  {
    id: "aux",
    trecho:
      /ROLLBACK_20261210: corpo vivo de cupom__vaga_volta_em de 13 parametros \(hash [0-9a-f]{64}\)/,
    preparo: (c) => umByteAMais(c, FN_AUX13),
  },
  {
    id: "rpc",
    trecho:
      /ROLLBACK_20261210: corpo vivo de vaga_do_cupom_presa \(hash [0-9a-f]{64}\)/,
    preparo: (c) => umByteAMais(c, FN_RPC),
  },
  {
    id: "var",
    trecho:
      /ROLLBACK_20261210: corpo vivo de devolver_cupons_de_pedidos_mortos\(\) \(hash [0-9a-f]{64}\)/,
    preparo: (c) => umByteAMais(c, FN_VAR),
  },
  {
    id: "uma",
    trecho:
      /ROLLBACK_20261210: esperava exatamente uma versao de cupom__vaga_volta_em/,
    preparo: (c) => c.query(ddlAlheia.auxOutra),
  },
];
async function casoVagaRollbackRecusa(rb = lerRb2(), so = null) {
  const sel = VARIANTES_ROLLBACK.filter((v) => !so || so.includes(v.id));
  assert.ok(sel.length > 0);
  for (const v of sel) {
    const db = await clonarComM2(`rb${v.id}`);
    await usar(db, v.preparo);
    const antes = await fotografia(db);
    recusou(await aplicar(db, rb), v.trecho, `rollback: ${v.id}`);
    await nadaGravado(db, antes, `rollback: ${v.id}`);
  }
}
/** A conferencia final do rollback: sem o DROP de 13 parametros sobraria a sobrecarga. */
async function casoVagaRollbackConfere(rb = lerRb2(), qual = "drop13") {
  const db = await clonarComM2("vgrbconfere");
  const quebrado =
    qual === "drop13"
      ? trocar(rb, T2.rbDrop13, "-- DROP removido pelo caso\n")
      : trocar(
          rb,
          blocoDe(rb, CAB_VAR, TAG_VAR),
          "-- varredura removida pelo caso",
        );
  const trecho =
    qual === "drop13"
      ? /ROLLBACK_20261210: cupom__vaga_volta_em de 13 parametros ainda existe/
      : /ROLLBACK_20261210: public\.devolver_cupons_de_pedidos_mortos\(\) nao voltou ao corpo anterior/;
  const antes = await fotografia(db);
  recusou(await aplicar(db, quebrado), trecho, `rollback incompleto (${qual})`);
  await nadaGravado(db, antes, `rollback incompleto (${qual})`);
}
/**
 * A ORDEM DE DESFAZER: 1210 -> 1209 -> 1206 -> 1205. Com a 1210 aplicada, o rollback da 1209 (a
 * tabela da foto) recusa nomeando as funcoes que a citam, e os da 1206 e da 1205 recusam (as funcoes
 * vivas nao sao as deles). Desfeita a 1210, a descida inteira funciona.
 */
async function casoVagaOrdemDeDesfazer(rb = lerRb2()) {
  const db = await clonarComM2("vgordem");
  const rbM1 = lerLF(`rollback-manual-${ARQ}`);
  const rb1206 = lerLF(`rollback-manual-${ARQ_1206}`);
  const rb1205 = lerLF(`rollback-manual-${ARQ_1205}`);
  const antes = await fotografia(db);
  recusou(
    await aplicar(db, rbM1),
    /ROLLBACK_20261209: \d+ funcao\(oes\) citam pedido_cobranca_ao_cancelar \(.*devolver_cupons_de_pedidos_mortos.*vaga_do_cupom_presa/,
    "rollback da 1209 com a 1210 aplicada",
  );
  await nadaGravado(db, antes, "rollback da 1209 com a 1210 aplicada");
  recusou(
    await aplicar(db, rb1206),
    /a varredura devolver_cupons_de_pedidos_mortos \(hash [0-9a-f]{64}\) nao e a da 20261206000000/,
    "rollback da 1206 com a 1210 aplicada",
  );
  await nadaGravado(db, antes, "rollback da 1206 com a 1210 aplicada");
  recusou(
    await aplicar(db, rb1205),
    /corpo vivo de vaga_do_cupom_presa \(hash [0-9a-f]{64}\) nao e o da 20261205000000/,
    "rollback da 1205 com a 1210 aplicada",
  );
  await nadaGravado(db, antes, "rollback da 1205 com a 1210 aplicada");
  // a descida na ordem certa
  for (const [rot, texto] of [
    ["1210", rb],
    ["1209", rbM1],
    ["1206", rb1206],
    ["1205", rb1205],
  ]) {
    const r = await aplicar(db, texto);
    assert.ok(!r.erro, `desfazer a ${rot}: ${r.erro?.code} ${r.erro?.message}`);
  }
  await usar(db, async (c) => {
    const q = async (s, p = []) => (await c.query(s, p)).rows[0];
    assert.equal(
      (await q("SELECT to_regclass('public.pedido_cobranca_ao_cancelar') AS t"))
        .t,
      null,
    );
    assert.equal(
      (await q("SELECT to_regprocedure($1) AS f", [FN_AUX9])).f,
      null,
    );
    assert.equal(
      (await q("SELECT to_regprocedure($1) AS f", [FN_RPC])).f,
      null,
    );
  });
  const f970 = corpoDe(
    lerLF("20260970000000_cancelamento_respeita_o_envio.sql"),
    CAB_VAR,
    TAG_VAR,
  );
  assert.equal(
    sha256(await corpoVivo(db, FN_VAR)),
    sha256(f970),
    "a varredura nao voltou a da 20260970",
  );
}
async function casoVagaRollbackEnvelope(rb = lerRb2()) {
  const db = await clonarComM2("vgrbenv");
  const ped = await usar(db, (c) => novoPedido(c));
  const p = await conexao(db);
  try {
    await p.query("BEGIN");
    await p.query(
      "UPDATE public.marketplace_orders SET notes = 'preso' WHERE id = $1",
      [ped],
    );
    const t0 = Date.now();
    const r = await comTempo(
      emEnvelopeRR(db, rb),
      15000,
      "rollback com pedido em andamento",
    );
    assert.ok(
      !r.erro,
      `rollback em envelope RR com pedido em andamento: ${r.erro?.code} ${r.erro?.message}`,
    );
    assert.ok(Date.now() - t0 < 3000, "o rollback esperou o pedido");
    await p.query("COMMIT");
  } finally {
    await p.query("ROLLBACK").catch(() => {});
    await p.end().catch(() => {});
  }
  assert.equal(await temAux13(db), false);
}

// ----------------------------------------------------------- textos e mensagens (para os mutantes)
const MSG2 = {
  preFoto: "PREFLIGHT_20261210: falta a foto da cobranca",
  preForma:
    "PREFLIGHT_20261210: public.pedido_cobranca_ao_cancelar tem outra forma",
  preFotoFn:
    "PREFLIGHT_20261210: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente",
  preFotoFnSem:
    "PREFLIGHT_20261210: public.pedido__foto_da_cobranca_ao_cancelar() nao existe",
  prePk:
    "PREFLIGHT_20261210: public.pedido_cobranca_ao_cancelar nao tem a chave primaria",
  preAuxNenhuma:
    "PREFLIGHT_20261210: a unica cupom__vaga_volta_em que existe nao tem 9 nem 13",
  preGatilho:
    "PREFLIGHT_20261210: o gatilho tr_pedido_foto_da_cobranca_ao_cancelar ausente",
  preColuna: "PREFLIGHT_20261210: falta a coluna public.marketplace_orders",
  preVarUma:
    "PREFLIGHT_20261210: esperava exatamente uma versao de devolver_cupons_de_pedidos_mortos()",
  preVarCorpo:
    "PREFLIGHT_20261210: corpo vivo de devolver_cupons_de_pedidos_mortos()",
  preFalta: "PREFLIGHT_20261210: falta a funcao",
  preRpcUma:
    "PREFLIGHT_20261210: esperava exatamente uma versao de vaga_do_cupom_presa(text)",
  preRpcCorpo: "PREFLIGHT_20261210: corpo vivo de vaga_do_cupom_presa",
  preAuxUma:
    "PREFLIGHT_20261210: esperava exatamente uma versao de cupom__vaga_volta_em",
  preAux9:
    "PREFLIGHT_20261210: corpo vivo de cupom__vaga_volta_em de 9 parametros",
  preAux13:
    "PREFLIGHT_20261210: corpo vivo de cupom__vaga_volta_em de 13 parametros",
  posCorpo: "POSVOO_20261210: % saiu da migration com o corpo",
  posSobrecarga: "POSVOO_20261210: cupom__vaga_volta_em ficou com",
  posAclAux: "POSVOO_20261210: public.cupom__vaga_volta_em saiu com EXECUTE",
  posAclRpc: "POSVOO_20261210: public.vaga_do_cupom_presa saiu com a permissao",
  posAclVar:
    "POSVOO_20261210: public.devolver_cupons_de_pedidos_mortos saiu com a permissao",
  rbAuxUma:
    "ROLLBACK_20261210: esperava exatamente uma versao de cupom__vaga_volta_em",
  rbAux:
    "ROLLBACK_20261210: corpo vivo de cupom__vaga_volta_em de 13 parametros",
  rbRpc: "ROLLBACK_20261210: corpo vivo de vaga_do_cupom_presa",
  rbVar: "ROLLBACK_20261210: corpo vivo de devolver_cupons_de_pedidos_mortos()",
  rbFinal13:
    "ROLLBACK_20261210: cupom__vaga_volta_em de 13 parametros ainda existe",
  rbFinalCorpo: "ROLLBACK_20261210: % nao voltou ao corpo anterior",
};
const T2 = {
  dropAux9: `DROP FUNCTION IF EXISTS ${FN_AUX9};\n`,
  dropAux9Seco: `DROP FUNCTION ${FN_AUX9};\n`,
  dropAux9Cascade: `DROP FUNCTION IF EXISTS ${FN_AUX9} CASCADE;\n`,
  revAux13: `REVOKE ALL ON FUNCTION ${FN_AUX13} FROM PUBLIC, anon, authenticated, service_role;\n`,
  trava: "SET LOCAL statement_timeout = '30s';\n",
  travaMutante:
    "SET LOCAL statement_timeout = '30s';\nLOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE;\n",
  pistaPrimeira:
    "        WHEN p_gateway_payment_id IS NULL\n         AND p_tentativas = 1\n",
  pistaSemVaga: "        WHEN p_tentativas = 1\n",
  pistaSoFoto: "        WHEN true\n",
  tent1: "         AND p_tentativas = 1\n",
  pagAg: "         AND p_payment_status = 'aguardando'\n",
  fotoNaoNula: "         AND p_foto_gateway IS NOT NULL\n",
  fotoSentinela:
    "         AND (p_foto_gateway LIKE 'verificando:%') IS NOT TRUE\n",
  fotoT0: "         AND p_foto_tentativas = 0\n",
  fotoPix: "         AND p_foto_metodo = 'pix'\n",
  fotoAg: "         AND p_foto_payment_status = 'aguardando'\n",
  entao: "        THEN p_expires_at\n",
  entaoMenosInf: "        THEN '-infinity'::timestamptz\n",
  guardas: {
    cupom: "        WHEN p_coupon_id IS NULL THEN 'infinity'::timestamptz\n",
    status:
      "        WHEN p_status IS DISTINCT FROM 'cancelled' THEN 'infinity'::timestamptz\n",
    pago: "        WHEN p_payment_status IN ('pago', 'pago_apos_expirar') THEN 'infinity'::timestamptz\n",
    devolvido:
      "        WHEN p_coupon_usage_returned IS DISTINCT FROM false THEN 'infinity'::timestamptz\n",
    envio:
      "        WHEN (p_cancelled_after_shipping = false OR p_returned_to_seller_at IS NOT NULL) IS NOT TRUE THEN 'infinity'::timestamptz\n",
    semPrazo:
      "        WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz\n",
    nuncaCobrado:
      "        WHEN p_gateway_payment_id IS NULL AND p_tentativas = 0 THEN p_expires_at + interval '45 minutes'\n",
  },
  varJoin:
    "        FROM public.marketplace_orders o\n        LEFT JOIN public.pedido_cobranca_ao_cancelar f ON f.order_id = o.id\n",
  varJoinTrue:
    "        FROM public.marketplace_orders o\n        LEFT JOIN public.pedido_cobranca_ao_cancelar f ON true\n",
  varFotoArgs:
    "                f.gateway_payment_id, f.tentativas, f.metodo_online, f.payment_status) < now()\n",
  varFotoNula:
    "                NULL::text, NULL::integer, NULL::text, NULL::text) < now()\n",
  varLock: "        FOR UPDATE OF o SKIP LOCKED\n",
  varLockSemSkip: "        FOR UPDATE OF o\n",
  varDevolve: "        PERFORM public.devolver_uso_cupom(v_pedido.id);\n",
  varMarca:
    "        UPDATE public.marketplace_orders\n           SET coupon_usage_returned = TRUE\n         WHERE id = v_pedido.id;\n",
  rpcJoin:
    "      FROM public.marketplace_orders o\n      LEFT JOIN public.pedido_cobranca_ao_cancelar f ON f.order_id = o.id\n",
  rpcJoinTrue:
    "      FROM public.marketplace_orders o\n      LEFT JOIN public.pedido_cobranca_ao_cancelar f ON true\n",
  rpcFotoArgs:
    "               f.gateway_payment_id, f.tentativas, f.metodo_online, f.payment_status))\n",
  rpcFotoNula:
    "               NULL::text, NULL::integer, NULL::text, NULL::text))\n",
  rpcMais15: "::integer + 15;",
  rbDrop13: `DROP FUNCTION IF EXISTS ${FN_AUX13};\n`,
};
/** O bloco inteiro de uma funcao (do cabecalho ate `$tag$;`), para tirar. */
function blocoDe(texto, cabecalho, tag) {
  const ini = texto.indexOf(cabecalho);
  assert.ok(ini >= 0, `bloco nao achado: ${cabecalho}`);
  const abre = texto.indexOf(`AS ${tag}`, ini);
  return texto.slice(ini, texto.indexOf(`${tag};`, abre) + `${tag};`.length);
}

// ----------------------------------------------------------------- o bloco
async function blocoDaVaga() {
  await prepararPre2();
  ok(
    "estado PRE-M2 montado (arvore ate a 20261209000000 inclusive, com a tabela da foto)",
  );
  const sql = lerMig2();
  const rb = lerRb2();
  console.log(`  sha256 da migration (LF): ${sha256(sql)}`);
  console.log(`  sha256 do rollback  (LF): ${sha256(rb)}`);
  const m2 = corposM2(sql);
  console.log(`  sha256 do corpo do auxiliar (LF): ${sha256(m2.aux)}`);
  console.log(`  sha256 do corpo da RPC      (LF): ${sha256(m2.rpc)}`);
  console.log(`  sha256 do corpo da varredura(LF): ${sha256(m2.var)}`);

  await casoVagaCatalogo();
  ok(
    "catalogo: UMA sobrecarga de cada funcao (o auxiliar so com 13 parametros), STABLE, sem EXECUTE de fora no auxiliar, ACL da RPC (so authenticated) e da varredura intactas, varredura ainda agendada a cada 15 min, corpos vivos IGUAIS aos do arquivo, nenhuma outra funcao/tabela/politica/gatilho/pedido mudou",
  );
  await casoVagaTabela();
  ok(
    `tabela de ${CASOS_PIX.length} casos (cada condicao da pista violada SOZINHA): o auxiliar diz 'volta antes de agora' SE E SOMENTE SE a varredura devolve, a RPC diz 'presa' SE E SOMENTE SE a varredura vai devolver um dia, os minutos batem, a vaga volta de verdade e a 2a varredura nao devolve em dobro`,
  );
  await casoVagaReativacao();
  ok(
    "o prazo (A2): a pista devolve p_expires_at; o admin que reativa o pedido cancelado dentro do prazo do PIX encontra o cupom seguro, e o pedido reativado nunca entra na varredura",
  );
  await casoVagaFantasma();
  ok(
    "pagamento fantasma: depois da varredura devolver, confirmar_pagamento do PIX velho da `divergente` e o uso do cupom nao muda; no estado A o pagamento tardio vira pago_apos_expirar e a varredura NAO devolveu",
  );
  await casoVagaConcorrenciaConfirmar();
  ok(
    "2 conexoes reais, varredura x confirmar_pagamento nas duas ordens: o pagamento que chega com a linha presa espera e e divergente; o que chega primeiro faz a varredura pular (SKIP LOCKED) e a seguinte devolve",
  );
  await casoVagaConcorrenciaLiberar();
  ok(
    "2 conexoes reais, varredura x liberar: liberacao nao confirmada nao e vista pela varredura; tentativa nova durante a varredura faz a varredura pular e a pista deixar de valer (24 h de hoje)",
  );
  await casoVagaDuasVarreduras();
  ok("duas varreduras em conexoes reais (SKIP LOCKED): uma devolucao so");
  await casoVagaVarreduraNoMeio();
  ok(
    "a varredura (agendador) roda no meio da aplicacao: com a migration ja executada e sem COMMIT ela segue com o catalogo antigo sem esperar nem errar; depois do COMMIT, com o novo",
  );
  await casoVagaIdempotente();
  ok(
    "idempotente: 2a, 3a (CRLF), 4a (CRLF) e 5a (LF) aplicacoes deixam o catalogo igual (so o corpo em CRLF difere no md5)",
  );
  await casoVagaAtomico();
  ok(
    "atomico: falha DEPOIS da ultima peca e falha NO MEIO (depois do DROP da funcao de 9 parametros) desfazem tudo e a funcao antiga continua la; BEGIN ... ROLLBACK nao deixa rastro; o envelope BEGIN ... COMMIT aplica",
  );
  await casoVagaIdaEVolta();
  ok(
    "ida e volta: aplicar, rollback, reaplicar, rollback, reaplicar 2x: o catalogo volta EXATO ao do estado pre-M2 (corpos da 1206 e da 1205 byte a byte por sha256, comentarios e ACL), a pista funciona a cada reaplicacao, rollback repetido e CRLF sao no-op e o LF seguinte restaura o estado exato",
  );
  await casoVagaPreVoo();
  ok(
    `pre-voo recusa SEM gravar (${VARIANTES_PREVOO.length} variantes): foto da cobranca ausente / forma da tabela / funcao e gatilho da foto; coluna ausente; 1206 nao aplicada; 1 byte a mais no auxiliar de 9 parametros, na RPC e na varredura (e no auxiliar de 13 numa reaplicacao); sobrecargas alheias; devolver_uso_cupom ausente`,
  );
  await casoVagaDependente();
  ok(
    "a funcao de 9 parametros tem quem dependa dela: o DROP sem CASCADE recusa (2BP01) e nada e gravado",
  );
  for (const q of quebrasM2()) await casoVagaPosvoo(q.sql, q.trecho, q.rotulo);
  ok(
    "pos-voo: corpo diferente (auxiliar, varredura, RPC), EXECUTE sobrando no auxiliar, funcao de 9 parametros que sobra, ACL da RPC e da varredura alterada fazem a migration inteira falhar sem deixar nada",
  );
  await casoVagaRollbackRecusa();
  ok(
    "rollback recusa (sem apagar nada) corpo vivo diferente do auxiliar, da RPC e da varredura, e sobrecarga alheia",
  );
  await casoVagaRollbackConfere();
  ok(
    "rollback confere no fim: se a funcao de 13 parametros sobrasse, falharia",
  );
  await casoVagaRollbackConfere(rb, "var");
  ok(
    "rollback confere no fim: se a varredura nao voltasse ao corpo da 1206, falharia",
  );
  await casoVagaOrdemDeDesfazer();
  ok(
    "ordem de desfazer 1210 -> 1209 -> 1206 -> 1205: com a 1210 aplicada os rollbacks da 1209, da 1206 e da 1205 RECUSAM sem gravar; desfeita a 1210, a descida inteira funciona",
  );
  await casoVagaRollbackEnvelope();
  ok("rollback no envelope RR com pedido em andamento: aplica sem esperar");
  await casoVagaEnvelope();
  ok(
    "envelope REPEATABLE READ: livre aplica; com pedido em andamento segurando a tabela aplica sem esperar; a migration executada e sem COMMIT nao para o pedido que chega; o cruzamento de dois pedidos nao da 40P01 e a migration aplica",
  );

  // ------------------------------------------------------------ mutantes
  console.log(
    "\n  --- MUTANTES DO BLOCO DA VAGA (cada guarda retirada tem de deixar a prova VERMELHA) ---",
  );
  const semPos = (s) => semRaise(s, MSG2.posCorpo);
  const tabela = (ids) => (s) => casoVagaTabela(s, ids);
  for (const [rotulo, de, para, ids] of [
    [
      "pista sem 'a vaga de cobranca esta vazia'",
      T2.pistaPrimeira,
      T2.pistaSemVaga,
      ["C18"],
    ],
    ["pista sem 'exatamente uma tentativa agora'", T2.tent1, "", ["C17"]],
    ["pista sem 'payment_status agora e aguardando'", T2.pagAg, "", ["C19"]],
    ["pista sem 'a foto tem id de cobranca'", T2.fotoNaoNula, "", ["C16"]],
    [
      "pista sem barrar a sentinela verificando: da foto",
      T2.fotoSentinela,
      "",
      ["C10"],
    ],
    ["pista sem 'a foto tem zero tentativas'", T2.fotoT0, "", ["C11"]],
    ["pista sem 'a foto e de PIX'", T2.fotoPix, "", ["C12", "C13"]],
    ["pista sem 'a foto era aguardando'", T2.fotoAg, "", ["C14", "C15"]],
    [
      "pista devolve '-infinity' em vez de p_expires_at (A2)",
      T2.entao,
      T2.entaoMenosInf,
      ["C02"],
    ],
    ["guarda herdada 'sem cupom' retirada", T2.guardas.cupom, "", ["C30"]],
    [
      "guarda herdada 'status cancelado' retirada",
      T2.guardas.status,
      "",
      ["C25"],
    ],
    [
      "guarda herdada 'pago / pago_apos_expirar' retirada",
      T2.guardas.pago,
      "",
      ["C20"],
    ],
    [
      "guarda herdada 'ja devolvido' retirada",
      T2.guardas.devolvido,
      "",
      ["C22"],
    ],
    [
      "guarda herdada 'cancelado depois do envio' retirada",
      T2.guardas.envio,
      "",
      ["C23"],
    ],
    [
      "guarda herdada 'sem prazo volta na hora' retirada",
      T2.guardas.semPrazo,
      "",
      ["C26"],
    ],
    ["pista de 45 min da 1206 retirada", T2.guardas.nuncaCobrado, "", ["C27"]],
  ]) {
    await mutante(rotulo, tabela(ids), semPos(trocar(sql, de, para)));
  }
  await mutante(
    "pista olha so a foto (sem 'vaga vazia' nem 'uma tentativa'): devolve o estado A (cupom em dobro se o PIX for pago)",
    casoVagaFantasma,
    semPos(trocar(sql, T2.pistaPrimeira, T2.pistaSoFoto)),
  );
  await mutante(
    "pista devolve '-infinity' (reativacao)",
    casoVagaReativacao,
    semPos(trocar(sql, T2.entao, T2.entaoMenosInf)),
  );
  await mutante(
    "varredura sem ler a foto (argumentos nulos)",
    tabela(["C01"]),
    semPos(trocar(sql, T2.varFotoArgs, T2.varFotoNula)),
  );
  await mutante(
    "varredura liga a foto por ON true",
    tabela(["C01", "C10"]),
    semPos(trocar(sql, T2.varJoin, T2.varJoinTrue)),
  );
  await mutante(
    "varredura sem SKIP LOCKED",
    casoVagaDuasVarreduras,
    semPos(trocar(sql, T2.varLock, T2.varLockSemSkip)),
  );
  await mutante(
    "varredura sem devolver o uso do cupom",
    tabela(["C01"]),
    semPos(trocar(sql, T2.varDevolve, "")),
  );
  await mutante(
    "varredura sem marcar coupon_usage_returned",
    tabela(["C01"]),
    semPos(trocar(sql, T2.varMarca, "")),
  );
  await mutante(
    "RPC sem ler a foto (argumentos nulos)",
    tabela(["C01"]),
    semPos(trocar(sql, T2.rpcFotoArgs, T2.rpcFotoNula)),
  );
  await mutante(
    "RPC liga a foto por ON true",
    tabela(["C01", "C10"]),
    semPos(trocar(sql, T2.rpcJoin, T2.rpcJoinTrue)),
  );
  await mutante(
    "DROP da funcao de 9 parametros com CASCADE (leva a funcao dependente embora)",
    casoVagaDependente,
    trocar(sql, T2.dropAux9, T2.dropAux9Cascade),
  );
  await mutante(
    "DROP sem IF EXISTS (a reaplicacao quebra)",
    casoVagaIdempotente,
    trocar(sql, T2.dropAux9, T2.dropAux9Seco),
  );
  await mutante(
    "a migration pede trava de tabela (LOCK em marketplace_orders): o pedido em andamento a segura",
    casoVagaEnvelope,
    trocar(sql, T2.trava, T2.travaMutante),
  );
  for (const [rotulo, msg, ids] of [
    ["sem pre-voo da foto (tabela ausente)", MSG2.preFoto, ["foto"]],
    ["sem pre-voo da forma da tabela da foto", MSG2.preForma, ["forma"]],
    ["sem pre-voo da funcao do gatilho da foto", MSG2.preFotoFn, ["fotofn"]],
    [
      "sem pre-voo da existencia da funcao do gatilho",
      MSG2.preFotoFnSem,
      ["fotofnsem"],
    ],
    ["sem pre-voo da chave primaria da foto", MSG2.prePk, ["pk"]],
    [
      "sem pre-voo do auxiliar que nao tem 9 nem 13 parametros",
      MSG2.preAuxNenhuma,
      ["auxsozinha"],
    ],
    ["sem pre-voo do gatilho da foto", MSG2.preGatilho, ["gatilho"]],
    ["sem pre-voo das colunas", MSG2.preColuna, ["coluna"]],
    [
      "sem pre-voo do corpo da varredura (1206 nao aplicada, 1 byte a mais)",
      MSG2.preVarCorpo,
      ["sem1206", "varcorpo"],
    ],
    [
      "sem pre-voo do corpo do auxiliar de 9 parametros",
      MSG2.preAux9,
      ["aux9corpo"],
    ],
    [
      "sem pre-voo do corpo do auxiliar de 13 parametros",
      MSG2.preAux13,
      ["aux13corpo"],
    ],
    ["sem pre-voo do corpo da RPC", MSG2.preRpcCorpo, ["rpccorpo"]],
    [
      "sem pre-voo das sobrecargas do auxiliar",
      MSG2.preAuxUma,
      ["auxdupla", "auxoutra"],
    ],
    ["sem pre-voo da varredura (uma versao so)", MSG2.preVarUma, ["varuma"]],
    ["sem pre-voo da RPC (uma versao so)", MSG2.preRpcUma, ["rpcuma"]],
    ["sem pre-voo de devolver_uso_cupom", MSG2.preFalta, ["falta"]],
  ]) {
    await mutante(rotulo, (s) => casoVagaPreVoo(s, ids), semRaise(sql, msg));
  }
  for (const q of quebrasM2()) {
    await mutante(
      `sem a conferencia do pos-voo (${q.rotulo})`,
      (s) => casoVagaPosvoo(s, q.trecho, q.rotulo),
      semRaise(q.sql, q.msg),
    );
  }
  for (const [rotulo, msg, ids] of [
    [
      "rollback sem a conferencia do corpo do auxiliar de 13 parametros",
      MSG2.rbAux,
      ["aux"],
    ],
    ["rollback sem a conferencia do corpo da RPC", MSG2.rbRpc, ["rpc"]],
    ["rollback sem a conferencia do corpo da varredura", MSG2.rbVar, ["var"]],
    ["rollback sem a conferencia das sobrecargas", MSG2.rbAuxUma, ["uma"]],
  ]) {
    await mutante(
      rotulo,
      (r) => casoVagaRollbackRecusa(r, ids),
      semRaise(rb, msg),
    );
  }
  await mutante(
    "rollback sem a conferencia final da funcao de 13 parametros",
    casoVagaRollbackConfere,
    semRaise(rb, MSG2.rbFinal13),
  );
  await mutante(
    "rollback sem a conferencia final dos corpos restaurados",
    (r) => casoVagaRollbackConfere(r, "var"),
    semRaise(rb, MSG2.rbFinalCorpo),
  );
}

const BLOCOS = [
  { nome: "foto", corpo: blocoDaFoto },
  { nome: "vaga", corpo: blocoDaVaga },
];

async function main() {
  // o estado PRE: a arvore de migrations ANTERIOR a esta peca, com usuarios, produto e cupom
  PRE = await montarBase(
    `pa_${SUF}_pre`,
    (nome) => nome < ARQ && !nome.startsWith("rollback-"),
  );
  await semearBase(PRE);
  const sonda = await usar(PRE, async (c) => ({
    tabela: (
      await c.query(
        "SELECT to_regclass('public.pedido_cobranca_ao_cancelar') AS t",
      )
    ).rows[0].t,
    eu: (
      await c.query(
        "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
      )
    ).rows[0].rolsuper,
  }));
  assert.equal(
    sonda.tabela,
    null,
    "precondicao: o estado pre NAO tem a tabela da foto",
  );
  assert.equal(
    sonda.eu,
    true,
    "precondicao: a conexao da prova e superusuario",
  );
  ok(
    "estado PRE montado (arvore anterior a 20261209000000, sem a tabela da foto), com usuarios, produto e cupom de teste",
  );
  // PIX_ANULADO_BLOCOS=vaga roda so um bloco (iteracao local); sem a variavel, todos (CI).
  const soEstes = process.env.PIX_ANULADO_BLOCOS?.split(",");
  for (const b of BLOCOS) {
    if (soEstes && !soEstes.includes(b.nome)) continue;
    console.log(`\n  === BLOCO: ${b.nome} ===`);
    await b.corpo();
  }
  console.log(`\n[cupom-pix-anulado-viva] ${resultados} provas ok`);
}

main()
  .catch((erro) => {
    console.error("\n[FALHOU]", erro?.stack ? erro.stack : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const n of clones) {
      await usar("template1", (a) =>
        a.query(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`),
      ).catch(() => {});
    }
  });

"use strict";

/**
 * PROVA VIVA da migration 20261243000000_desfazer_recebimento_recusa_com_devolucao.sql
 * (dinheiro; 15/10/2026): "Desfazer recebimento" (`registrar_pagamento_recebido(id, false)`) RECUSA o
 * pedido que tem devolução viva — qualquer status que não seja recusada/cancelada/reprovada, o critério
 * da anulação do balcão (20261204000000, item 8) — contra o Postgres EFÊMERO com as migrations aplicadas
 * do zero.
 *
 *   (0) fixtures: admin atual, rebaixado, cliente; produto.
 *   (1) catálogo e ACL: o corpo vivo é o desta migration (md5), SECURITY DEFINER, search_path=public,
 *       ACL = a de antes (authenticated e service_role; nem PUBLIC nem anon).
 *   (2) CAMINHO FELIZ sem devolução: desfazer funciona, "Recebi" de novo funciona, o histórico do
 *       pagamento tem uma linha por transição.
 *   (3) DEVOLUÇÃO VIVA (solicitada, aprovada, em_transito, recebida, concluida): recusa com a frase
 *       exata, e NADA muda (pedido, histórico do pagamento, Financeiro).
 *   (4) DEVOLUÇÃO MORTA (recusada, cancelada, reprovada): desfazer passa; e "Recebi" de novo depois.
 *   (5) BORDAS: uma viva entre mortas recusa; só mortas passa; devolução de OUTRO pedido não bloqueia;
 *       a devolução REAL (solicitar_devolucao) recusa; o Financeiro mantém a venda.
 *   (6) O QUE NÃO MUDA: "Recebi" com devolução viva = ja_estava; desfazer sem pagamento recebido com
 *       devolução viva = ja_estava (sem recusar, sem escrever); ordem das recusas (não-admin, NULL 22004,
 *       cancelado) preservada — quem não é da loja não aprende que há devolução.
 *   (7) CONCORRÊNCIA com duas conexões reais e COMMIT, nos DOIS sentidos: a devolução que chega primeiro
 *       (a função espera a trava do pedido e RECUSA) e o desfazer que chega primeiro (solicitar_devolucao
 *       espera e vê o pagamento vazio) — nunca devolução viva COM pagamento desfeito.
 *   (8) MIGRATION: reaplicar é idempotente (função e ACL idênticas); pré-voo recusa SEM gravar; rollback
 *       devolve o corpo da 20261197000000 byte a byte (md5 conhecido), é idempotente, recusa corpo
 *       posterior e, aplicar -> desfazer -> aplicar, volta idêntico; sem a migration o defeito existe
 *       (controle: a venda some do Financeiro).
 *   (9) MUTANTES: cada peça da checagem tirada (ou trocada) deixa a prova certa VERMELHA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/desfazer-recebimento-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório, por nome fixo
 * (constantes abaixo), nunca entrada de rede nem de terceiro. */

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const NOME = "20261243000000_desfazer_recebimento_recusa_com_devolucao.sql";
const NOME_97 = "20261197000000_dinheiro_exige_admin_atual.sql";
const SQL_MIGRATION = fs.readFileSync(path.join(PASTA, NOME), "utf8");
const SQL_ROLLBACK = fs.readFileSync(
  path.join(PASTA, `rollback-manual-${NOME}`),
  "utf8",
);
const SQL_97 = fs.readFileSync(path.join(PASTA, NOME_97), "utf8");

const FN = "public.registrar_pagamento_recebido(uuid, boolean)";
const HASH_97 = "6584d62da7815a913b1e0cb86c108b0f";
const MSG_DEVOLUCAO =
  "Este pedido tem devolução: conclua, recuse ou cancele a devolução antes de desfazer o recebimento";
const ACL_CONHECIDA =
  "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}";

// A venda do balcão no Financeiro (origem venda_balcao) só existe com pagamento marcado E data.
const ENTRADA_DA_VENDA = /^venda\w*:entrada:/;

// O balcão não tem prazo de arrependimento (só canal online): a devolução REAL dele é por defeito, com foto.
const SOLICITAR_SQL =
  "SELECT public.solicitar_devolucao($1::uuid, $2::jsonb, 'defeito', NULL, 'reembolso', 'entrega_na_loja', $3::text[]) AS r";
const argsSolicitar = (id, item) => [
  id,
  JSON.stringify([{ order_item_id: item, quantidade: 1 }]),
  [`${U_CLIENTE}/${id}/costura.jpg`],
];

const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");

// O bloco CREATE OR REPLACE da função, tal como está na migration (os mutantes trocam um pedaço dele e o
// recriam no banco).
const CAB_FN =
  "CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(";
const INI_FN = SQL_MIGRATION.indexOf(CAB_FN);
const FIM_FN = SQL_MIGRATION.indexOf("$$;", INI_FN) + "$$;".length;
const SQL_FUNCAO = SQL_MIGRATION.slice(INI_FN, FIM_FN);
assert.ok(INI_FN > 0 && FIM_FN > INI_FN, "bloco da função não achado");
const HASH_DESTA = md5(
  SQL_FUNCAO.slice(
    SQL_FUNCAO.indexOf("AS $$") + "AS $$".length,
    SQL_FUNCAO.lastIndexOf("$$;"),
  ),
);

const U_ADMIN = "d3000000-0000-4000-8000-000000000001";
const U_REB = "d3000000-0000-4000-8000-000000000002";
const U_CLIENTE = "d3000000-0000-4000-8000-000000000003";
const P_SIMPLES = "d3aaaaaa-0000-4000-8000-000000000001";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

const QUEM = new Map(
  Object.entries({
    anon: { papel: "anon", uid: "", jwt: "" },
    cliente: {
      papel: "authenticated",
      uid: U_CLIENTE,
      jwt: claims(U_CLIENTE, null),
    },
    reb: { papel: "authenticated", uid: U_REB, jwt: claims(U_REB, "admin") },
    admin: {
      papel: "authenticated",
      uid: U_ADMIN,
      jwt: claims(U_ADMIN, "admin"),
    },
  }),
);

// ---------------------------------------------------------------- utilitários

/** Roda `sql` COMO `quem` dentro da transação aberta; um erro não aborta a transação. */
async function como(c, quem, sql, params = []) {
  const q = QUEM.get(quem);
  await c.query("SAVEPOINT sp_como");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_como");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Uma transação que SEMPRE desfaz (ou commita, se pedido). */
async function emTx(c, corpo, { commit = false } = {}) {
  await c.query("BEGIN");
  try {
    const r = await corpo();
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

const registrar = (c, quem, id, recebido) =>
  como(
    c,
    quem,
    "SELECT public.registrar_pagamento_recebido($1::uuid, $2::boolean) AS r",
    [id, recebido],
  );

/** Impressão digital de TUDO que a função pode escrever. */
async function foto(c, id) {
  return (
    await c.query(
      `SELECT md5(concat_ws('|',
         (SELECT o::text FROM public.marketplace_orders o WHERE o.id = $1),
         (SELECT COALESCE(string_agg(h::text, ';' ORDER BY h.id), '') FROM public.marketplace_order_payment_history h WHERE h.order_id = $1),
         (SELECT COALESCE(string_agg(h::text, ';' ORDER BY h.id), '') FROM public.marketplace_order_history h WHERE h.order_id = $1),
         (SELECT COALESCE(string_agg(d::text, ';' ORDER BY d.id), '') FROM public.devolucoes d WHERE d.order_id = $1),
         (SELECT COALESCE(string_agg(r::text, ';' ORDER BY r.id), '') FROM public.order_refunds r WHERE r.order_id = $1))) AS h`,
      [id],
    )
  ).rows[0].h;
}

const pedido = async (c, id) =>
  (await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [id]))
    .rows[0];

// O id do histórico é uuid e as linhas da mesma transação têm o MESMO created_at: ordem estável = (acao, antes, depois).
const porAcao = (l) =>
  [...l].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
const historicoDoPagamento = async (c, id) =>
  (
    await c.query(
      `SELECT acao, payment_status_antes AS antes, payment_status_depois AS depois
         FROM public.marketplace_order_payment_history WHERE order_id = $1
        ORDER BY acao, payment_status_antes NULLS FIRST, payment_status_depois NULLS FIRST`,
      [id],
    )
  ).rows;

/** Venda REAL do balcão (recebida na hora), pelo caminho de produção (admin atual). */
async function vender(c, o = {}) {
  const r = await como(
    c,
    "admin",
    "SELECT public.registrar_venda_presencial($1::jsonb, $2, $3::uuid, NULL, NULL, 0::numeric, NULL, NULL) AS r",
    [
      JSON.stringify([
        { product_id: P_SIMPLES, variant_id: null, quantity: o.qtd || 2 },
      ]),
      o.pagamento || "cash",
      o.cliente === undefined ? U_CLIENTE : o.cliente,
    ],
  );
  assert.ok(r.ok, `registrar_venda_presencial falhou: ${r.message}`);
  return r.rows[0].r.order.id;
}

/** Devolução montada direto (um status qualquer; a real vem de solicitar_devolucao). */
async function devolucao(c, id, status) {
  const item = (
    await c.query(
      "SELECT id FROM public.marketplace_order_items WHERE order_id = $1 LIMIT 1",
      [id],
    )
  ).rows[0].id;
  const d = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade,
        metodo_retorno, status, valor_itens, prazo_ate, politica)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'reembolso', 'local',
             'entrega_na_loja', $5, 30, current_date + 7, '{}'::jsonb)`,
    [d, `DES-${d.slice(0, 8)}`, id, U_CLIENTE, status],
  );
  await c.query(
    `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, product_name, quantidade, valor_unitario)
     VALUES ($1, $2, $3, 'Item', 1, 15)`,
    [d, item, P_SIMPLES],
  );
  return d;
}

/** Linhas do Financeiro deste pedido (a venda só existe com pagamento marcado E data). */
async function financeiro(c, id) {
  const r = await c.query(
    `SELECT origem, tipo, valor::numeric AS valor
       FROM public.fin__movimentos(NULL, NULL) WHERE pedido_id = $1 ORDER BY origem`,
    [id],
  );
  return r.rows.map((l) => `${l.origem}:${l.tipo}:${Number(l.valor)}`);
}

async function novoCliente() {
  const url = lerDatabaseUrlEfemera();
  const cl = new Client({ connectionString: url });
  await cl.connect();
  return cl;
}

async function esperarEspera(monitor, pid, ms = 15000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const r = await monitor.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`a conexão ${pid} não ficou parada numa trava (Lock)`);
}

async function defDaFuncao(c) {
  const r = await c.query(
    `SELECT pg_get_functiondef(oid) AS def, proacl::text AS acl,
            obj_description(oid, 'pg_proc') AS comentario, prosecdef, proconfig::text AS cfg,
            md5(replace(prosrc, E'\\r', '')) AS hash
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [FN],
  );
  return r.rows[0] || null;
}

async function impressao(c) {
  return (
    await c.query(
      `SELECT count(*)::int AS n,
              md5(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid))
                  || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(obj_description(p.oid, 'pg_proc'), ''),
                  E'\\n' ORDER BY p.oid::regprocedure::text)) AS h
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'registrar_pagamento_recebido'`,
    )
  ).rows[0];
}

async function tentarSql(c, sql) {
  await c.query("SAVEPOINT sp_sql");
  try {
    await c.query(sql);
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_sql");
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: false, message: e.message };
  }
}

// ---------------------------------------------------------------- as provas

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova("(0) fixtures", async (c) => {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const id of [U_ADMIN, U_REB, U_CLIENTE]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@desfazer.teste', '{}'::jsonb)`,
      [id],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin Desfazer', 'admin'), ($2, 'Reb Desfazer', 'admin'), ($3, 'Cliente Desfazer', 'customer')`,
    [U_ADMIN, U_REB, U_CLIENTE],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
     VALUES ($1, 'Produto desfazer', 15, 1000, true, 5)`,
    [P_SIMPLES],
  );
  // Rebaixamento pelo app: o profiles vira customer (o gatilho leva a auth.users) e o JWT dele ainda diz admin.
  await c.query("BEGIN");
  await c.query(
    "SELECT set_config('request.jwt.claims', $1, true), set_config('app.rpc.user_id', $2, true)",
    [claims(U_ADMIN, "admin"), U_ADMIN],
  );
  await c.query("UPDATE public.profiles SET role = 'customer' WHERE id = $1", [
    U_REB,
  ]);
  await c.query("COMMIT");
});

prova(
  "(1) catálogo e ACL: o corpo é o da migration, a ACL é a de antes",
  async (c) => {
    const d = await defDaFuncao(c);
    assert.ok(d, "a função não existe");
    assert.equal(
      d.hash,
      HASH_DESTA,
      "o corpo vivo não é o do arquivo da migration (aplicada?)",
    );
    assert.equal(d.prosecdef, true);
    assert.equal(d.cfg, "{search_path=public}");
    assert.equal(d.acl, ACL_CONHECIDA);
    const r = await c.query(
      `SELECT has_function_privilege('anon', oid, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', oid, 'EXECUTE') AS auth,
            has_function_privilege('service_role', oid, 'EXECUTE') AS service,
            EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
            pg_get_function_result(oid) AS ret
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
      [FN],
    );
    assert.deepEqual(r.rows[0], {
      anon: false,
      auth: true,
      service: true,
      publico: false,
      ret: "jsonb",
    });
  },
);

async function caminhoFeliz(c) {
  await emTx(c, async () => {
    const id = await vender(c);
    const ped0 = await pedido(c, id);
    assert.equal(ped0.payment_status, "recebido_na_entrega");
    assert.ok(ped0.pagamento_recebido_em);
    const h0 = await historicoDoPagamento(c, id);

    const d = await registrar(c, "admin", id, false);
    assert.ok(d.ok, `desfazer sem devolução falhou: ${d.message}`);
    assert.equal(d.rows[0].r.payment_status, null);
    assert.equal(d.rows[0].r.ja_estava, false);
    const ped1 = await pedido(c, id);
    assert.equal(ped1.payment_status, null);
    assert.equal(ped1.pagamento_recebido_em, null);
    assert.equal(ped1.pagamento_recebido_por, null);

    // (e) marcar de novo depois continua funcionando.
    const de_novo = await registrar(c, "admin", id, true);
    assert.ok(de_novo.ok, `marcar de novo falhou: ${de_novo.message}`);
    assert.equal(de_novo.rows[0].r.payment_status, "recebido_na_entrega");
    assert.equal(de_novo.rows[0].r.ja_estava, false);
    const ped2 = await pedido(c, id);
    assert.equal(ped2.payment_status, "recebido_na_entrega");
    assert.ok(ped2.pagamento_recebido_em);
    assert.equal(ped2.pagamento_recebido_por, U_ADMIN);

    // Cada transição grava UMA linha de histórico (comparação sem depender da ordem das linhas).
    assert.deepEqual(
      porAcao(await historicoDoPagamento(c, id)),
      porAcao([
        ...h0,
        { acao: "desfeito", antes: "recebido_na_entrega", depois: null },
        { acao: "recebido", antes: null, depois: "recebido_na_entrega" },
      ]),
    );
  });
  await emTx(c, async () => {
    const id = await vender(c);
    assert.ok((await registrar(c, "admin", id, false)).ok);
    const antes = await foto(c, id);
    const rep = await registrar(c, "admin", id, false);
    assert.ok(rep.ok);
    assert.equal(
      rep.rows[0].r.ja_estava,
      true,
      "desfazer o já desfeito = ja_estava",
    );
    assert.equal(await foto(c, id), antes, "ja_estava não escreve");
  });
}
prova(
  "(2) caminho feliz sem devolução: desfazer, refazer, repetir",
  caminhoFeliz,
);

const VIVAS = [
  "solicitada",
  "aprovada",
  "em_transito",
  "recebida",
  "concluida",
];
const MORTAS = ["recusada", "cancelada", "reprovada"];

async function recusaComDevolucaoViva(c) {
  for (const status of VIVAS) {
    await emTx(c, async () => {
      const id = await vender(c);
      await devolucao(c, id, status);
      const antes = await foto(c, id);
      const finAntes = await financeiro(c, id);
      assert.ok(
        finAntes.some((l) => ENTRADA_DA_VENDA.test(l)),
        `a venda tem de estar no Financeiro antes (${finAntes.join(",")})`,
      );
      const r = await registrar(c, "admin", id, false);
      assert.equal(r.ok, false, `devolução ${status} devia recusar o desfazer`);
      assert.equal(r.message, MSG_DEVOLUCAO);
      assert.equal(r.code, "P0001");
      assert.equal(await foto(c, id), antes, `devolução ${status}: algo mudou`);
      assert.deepEqual(
        await financeiro(c, id),
        finAntes,
        `devolução ${status}: o Financeiro mudou`,
      );
      assert.equal((await pedido(c, id)).payment_status, "recebido_na_entrega");
    });
  }
}
prova(
  "(3) devolução viva (solicitada, aprovada, em_transito, recebida, concluida): recusa com a frase exata e nada muda",
  recusaComDevolucaoViva,
);

async function permiteComDevolucaoMorta(c) {
  for (const status of MORTAS) {
    await emTx(c, async () => {
      const id = await vender(c);
      await devolucao(c, id, status);
      const r = await registrar(c, "admin", id, false);
      assert.ok(
        r.ok,
        `devolução ${status} devia deixar desfazer: ${r.message}`,
      );
      assert.equal(r.rows[0].r.payment_status, null);
      assert.equal(r.rows[0].r.ja_estava, false);
      const ped = await pedido(c, id);
      assert.equal(ped.payment_status, null);
      assert.equal(ped.pagamento_recebido_em, null);
      // (e) e marcar de novo depois continua funcionando.
      const de_novo = await registrar(c, "admin", id, true);
      assert.ok(
        de_novo.ok,
        `devolução ${status}: marcar de novo: ${de_novo.message}`,
      );
      assert.equal((await pedido(c, id)).payment_status, "recebido_na_entrega");
    });
  }
}
prova(
  "(4) devolução morta (recusada, cancelada, reprovada): desfazer passa, e marcar de novo também",
  permiteComDevolucaoMorta,
);

async function bordas(c) {
  // Uma viva ENTRE mortas recusa; só mortas passa.
  await emTx(c, async () => {
    const id = await vender(c);
    await devolucao(c, id, "recusada");
    await devolucao(c, id, "cancelada");
    const viva = await devolucao(c, id, "aprovada");
    await devolucao(c, id, "reprovada");
    const antes = await foto(c, id);
    const r = await registrar(c, "admin", id, false);
    assert.equal(r.ok, false);
    assert.equal(r.message, MSG_DEVOLUCAO);
    assert.equal(await foto(c, id), antes);
    // A viva é cancelada: o desfazer passa (o caminho que a mensagem manda seguir).
    await c.query(
      "UPDATE public.devolucoes SET status = 'cancelada' WHERE id = $1",
      [viva],
    );
    const depois = await registrar(c, "admin", id, false);
    assert.ok(depois.ok, `depois de cancelar a devolução: ${depois.message}`);
  });
  // Devolução de OUTRO pedido do mesmo cliente não bloqueia este.
  await emTx(c, async () => {
    const a = await vender(c);
    const b = await vender(c);
    await devolucao(c, b, "solicitada");
    const r = await registrar(c, "admin", a, false);
    assert.ok(r.ok, `devolução de outro pedido bloqueou: ${r.message}`);
    const rb = await registrar(c, "admin", b, false);
    assert.equal(rb.ok, false);
    assert.equal(rb.message, MSG_DEVOLUCAO);
  });
  // A devolução REAL (solicitar_devolucao, pelo cliente) recusa, e o Financeiro mantém a venda.
  await emTx(c, async () => {
    const id = await vender(c);
    const item = (
      await c.query(
        "SELECT id FROM public.marketplace_order_items WHERE order_id = $1 LIMIT 1",
        [id],
      )
    ).rows[0].id;
    const s = await como(c, "cliente", SOLICITAR_SQL, argsSolicitar(id, item));
    assert.ok(s.ok, `solicitar_devolucao real falhou: ${s.message}`);
    const antes = await foto(c, id);
    const finAntes = await financeiro(c, id);
    const r = await registrar(c, "admin", id, false);
    assert.equal(r.ok, false);
    assert.equal(r.message, MSG_DEVOLUCAO);
    assert.equal(await foto(c, id), antes);
    assert.deepEqual(await financeiro(c, id), finAntes);
    assert.ok(finAntes.some((l) => ENTRADA_DA_VENDA.test(l)));
  });
}
prova(
  "(5) bordas: viva entre mortas, outro pedido, devolução REAL; o Financeiro mantém a venda",
  bordas,
);

async function oQueNaoMuda(c) {
  // "Recebi" com devolução viva e pagamento já recebido: ja_estava, sem recusar.
  await emTx(c, async () => {
    const id = await vender(c);
    await devolucao(c, id, "aprovada");
    const antes = await foto(c, id);
    const r = await registrar(c, "admin", id, true);
    assert.ok(r.ok, r.message);
    assert.equal(r.rows[0].r.ja_estava, true);
    assert.equal(await foto(c, id), antes);
  });
  // Desfazer com devolução viva, mas o pagamento NÃO está recebido: ja_estava (a checagem fica no ramo que escreve).
  await emTx(c, async () => {
    const id = await vender(c);
    assert.ok((await registrar(c, "admin", id, false)).ok);
    await devolucao(c, id, "aprovada");
    const antes = await foto(c, id);
    const r = await registrar(c, "admin", id, false);
    assert.ok(r.ok, `no-op recusado: ${r.message}`);
    assert.equal(r.rows[0].r.ja_estava, true);
    assert.equal(await foto(c, id), antes);
  });
  // Ordem das recusas: quem não é da loja não aprende que há devolução; NULL; cancelado.
  await emTx(c, async () => {
    const id = await vender(c);
    await devolucao(c, id, "aprovada");
    const antes = await foto(c, id);
    for (const quem of ["cliente", "reb", "anon"]) {
      const r = await registrar(c, quem, id, false);
      assert.equal(r.ok, false, quem);
      assert.notEqual(
        r.message,
        MSG_DEVOLUCAO,
        `${quem} aprendeu que há devolução`,
      );
      assert.match(r.message, /Não autorizado|permission denied/, quem);
    }
    const nulo = await registrar(c, "admin", id, null);
    assert.equal(nulo.ok, false);
    assert.equal(nulo.code, "22004");
    assert.notEqual(nulo.message, MSG_DEVOLUCAO);
    assert.equal(await foto(c, id), antes);
  });
  await emTx(c, async () => {
    const id = await vender(c);
    await devolucao(c, id, "aprovada");
    await c.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      [id],
    );
    const r = await registrar(c, "admin", id, false);
    assert.equal(r.ok, false);
    assert.equal(r.message, "Pedido cancelado não recebe pagamento.");
  });
  await emTx(c, async () => {
    const r = await registrar(c, "admin", crypto.randomUUID(), false);
    assert.equal(r.ok, false);
    assert.equal(r.message, "Pedido não encontrado.");
  });
}
prova(
  "(6) o que não muda: ja_estava, ordem das recusas, nada vaza para quem não é da loja",
  oQueNaoMuda,
);

// ------------------------------------------------------------- concorrência

async function corrida(c) {
  // Pedido COMMITADO (as duas conexões enxergam), uma venda real do balcão de um cliente.
  const prepara = async () => {
    await c.query("BEGIN");
    const id = await vender(c);
    await c.query("COMMIT");
    const item = (
      await c.query(
        "SELECT id FROM public.marketplace_order_items WHERE order_id = $1 LIMIT 1",
        [id],
      )
    ).rows[0].id;
    return { id, item };
  };
  const abrirComo = async (cl, quem) => {
    const q = QUEM.get(quem);
    await cl.query("BEGIN");
    await cl.query(`SET LOCAL ROLE ${q.papel}`);
    await cl.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
  };
  const pid = async (cl) =>
    (await cl.query("SELECT pg_backend_pid() AS p")).rows[0].p;

  // ---- (a) a devolução chega PRIMEIRO (segura a trava do pedido, ainda sem commit): o desfazer espera e RECUSA.
  {
    const { id, item } = await prepara();
    const A = await novoCliente(); // o cliente pede a devolução
    const B = await novoCliente(); // a loja desfaz o recebimento
    const M = await novoCliente(); // monitor
    try {
      await abrirComo(A, "cliente");
      const s = await A.query(SOLICITAR_SQL, argsSolicitar(id, item));
      assert.ok(s.rows[0].r, "solicitar_devolucao real falhou");
      await abrirComo(B, "admin");
      const pidB = await pid(B);
      const pb = B.query(
        "SELECT public.registrar_pagamento_recebido($1::uuid, false) AS r",
        [id],
      ).then(
        (r) => ({ ok: true, r }),
        (e) => ({ ok: false, e }),
      );
      await esperarEspera(M, pidB); // B comprovadamente parada na trava do pedido
      await A.query("COMMIT");
      const resB = await pb;
      assert.equal(
        resB.ok,
        false,
        "o desfazer passou por cima de uma devolução recém-aberta (corrida)",
      );
      assert.equal(resB.e.message, MSG_DEVOLUCAO);
      await B.query("ROLLBACK");
      const ped = await pedido(c, id);
      assert.equal(ped.payment_status, "recebido_na_entrega");
      assert.ok(ped.pagamento_recebido_em);
      const n = await c.query(
        "SELECT count(*)::int AS n FROM public.devolucoes WHERE order_id = $1",
        [id],
      );
      assert.equal(n.rows[0].n, 1);
    } finally {
      await A.query("ROLLBACK").catch(() => {});
      await B.query("ROLLBACK").catch(() => {});
      await A.end();
      await B.end();
      await M.end();
    }
  }

  // ---- (b) o desfazer chega PRIMEIRO (sem commit): a devolução espera, e ao entrar vê o pagamento vazio.
  {
    const { id, item } = await prepara();
    const A = await novoCliente();
    const B = await novoCliente();
    const M = await novoCliente();
    try {
      await abrirComo(B, "admin");
      const d = await B.query(
        "SELECT public.registrar_pagamento_recebido($1::uuid, false) AS r",
        [id],
      );
      assert.equal(d.rows[0].r.payment_status, null);
      await abrirComo(A, "cliente");
      const pidA = await pid(A);
      const pa = A.query(SOLICITAR_SQL, argsSolicitar(id, item)).then(
        (r) => ({ ok: true, r }),
        (e) => ({ ok: false, e }),
      );
      await esperarEspera(M, pidA);
      await B.query("COMMIT");
      const resA = await pa;
      assert.equal(
        resA.ok,
        false,
        "a devolução nasceu com o pagamento já desfeito (corrida do outro sentido)",
      );
      assert.match(resA.e.message, /não tem pagamento a devolver/);
      await A.query("ROLLBACK");
      const n = await c.query(
        "SELECT count(*)::int AS n FROM public.devolucoes WHERE order_id = $1",
        [id],
      );
      assert.equal(n.rows[0].n, 0, "devolução viva com pagamento desfeito");
      assert.equal((await pedido(c, id)).payment_status, null);
    } finally {
      await A.query("ROLLBACK").catch(() => {});
      await B.query("ROLLBACK").catch(() => {});
      await A.end();
      await B.end();
      await M.end();
    }
  }
}
prova(
  "(7) concorrência real nos DOIS sentidos: nunca devolução viva COM pagamento desfeito",
  corrida,
);

// ------------------------------------------------------------------ migration

prova(
  "(8a) reaplicar a migration é idempotente (mesma função, mesma ACL)",
  async (c) => {
    const antes = await defDaFuncao(c);
    assert.ok(antes);
    await emTx(c, async () => {
      await c.query(SQL_MIGRATION);
      await c.query(SQL_MIGRATION);
      assert.deepEqual(await defDaFuncao(c), antes);
    });
    assert.deepEqual(await defDaFuncao(c), antes);
  },
);

prova(
  "(8b) pré-voo recusa SEM gravar, com o nome do que diverge",
  async (c) => {
    const quebras = [
      [
        "função ausente",
        `ALTER FUNCTION ${FN} RENAME TO registrar_pagamento_recebido_x`,
        /não existe/,
      ],
      [
        "tabela devolucoes",
        "ALTER TABLE public.devolucoes RENAME TO devolucoes_x",
        /public\.devolucoes/,
      ],
      [
        "coluna devolucoes.status",
        "ALTER TABLE public.devolucoes RENAME COLUMN status TO st",
        /devolucoes\.status/,
      ],
      [
        "tabela do histórico",
        "ALTER TABLE public.marketplace_order_payment_history RENAME TO mophx",
        /marketplace_order_payment_history/,
      ],
      [
        "is_admin_atual",
        "ALTER FUNCTION public.is_admin_atual() RENAME TO is_admin_atual_x",
        /is_admin_atual/,
      ],
      [
        "search_path diferente",
        `ALTER FUNCTION ${FN} SET search_path = public, pg_temp`,
        /atributos de/,
      ],
      [
        "SECURITY INVOKER",
        `ALTER FUNCTION ${FN} SECURITY INVOKER`,
        /atributos de/,
      ],
      [
        "sobrecarga",
        "CREATE FUNCTION public.registrar_pagamento_recebido(p_a uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
        /sobrecarga/,
      ],
    ];
    for (const [rotulo, quebra, esperado] of quebras) {
      await emTx(c, async () => {
        const antes = await defDaFuncao(c);
        await c.query(quebra);
        const r = await tentarSql(c, SQL_MIGRATION);
        assert.equal(r.ok, false, `${rotulo}: a migration passou`);
        assert.match(r.message, /B1_BASELINE_DIVERGENT/, rotulo);
        assert.match(r.message, esperado, rotulo);
        // O corpo continua o de antes: nada foi reescrito (a recusa vem antes do CREATE OR REPLACE).
        const depois = await c.query(
          `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc
          WHERE pronamespace = 'public'::regnamespace
            AND proname IN ('registrar_pagamento_recebido', 'registrar_pagamento_recebido_x')
            AND pronargs = 2`,
        );
        assert.deepEqual(
          depois.rows.map((l) => l.h),
          [antes.hash],
          `${rotulo}: reescreveu o corpo`,
        );
      });
    }
    // Corpo vivo de OUTRA migration (posterior, ou drift na loja): não sobrescreve.
    await emTx(c, async () => {
      await c.query(
        `CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(p_order_id uuid, p_recebido boolean)
         RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
         AS $$ BEGIN RETURN '{"posterior":true}'::jsonb; END; $$`,
      );
      const r = await tentarSql(c, SQL_MIGRATION);
      assert.equal(r.ok, false);
      assert.match(r.message, /B1_BASELINE_DIVERGENT: corpo vivo de/);
      const h = await c.query(
        "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
        [FN],
      );
      assert.match(
        h.rows[0].prosrc,
        /posterior/,
        "sobrescreveu o corpo de outra migration",
      );
    });
  },
);

prova(
  "(8c) rollback: devolve o corpo da 20261197000000 byte a byte, sem mexer em outra função; aplicar -> desfazer -> aplicar volta idêntico",
  async (c) => {
    await emTx(c, async () => {
      const def0 = await defDaFuncao(c);
      const f0 = await impressao(c);

      await c.query(SQL_ROLLBACK);
      const dRb = await defDaFuncao(c);
      assert.equal(dRb.hash, HASH_97, "o rollback não devolveu o corpo da 97");
      assert.equal(dRb.acl, def0.acl, "o rollback mexeu na ACL");
      assert.equal(dRb.comentario, def0.comentario);
      assert.equal(dRb.cfg, def0.cfg);
      assert.deepEqual(
        await impressao(c),
        f0,
        "o rollback mexeu em outra função",
      );

      // O corpo restaurado é, byte a byte, o do arquivo da 20261197000000.
      const ini97 = SQL_97.indexOf(CAB_FN);
      const corpo97 = SQL_97.slice(
        SQL_97.indexOf("AS $$", ini97) + "AS $$".length,
        SQL_97.indexOf("$$;", ini97),
      );
      const vivo = await c.query(
        "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
        [FN],
      );
      assert.equal(vivo.rows[0].prosrc, corpo97);

      // Rollback repetido é idempotente.
      await c.query(SQL_ROLLBACK);
      assert.equal((await defDaFuncao(c)).hash, HASH_97);

      await c.query(SQL_MIGRATION);
      assert.deepEqual(
        await defDaFuncao(c),
        def0,
        "reaplicar não voltou ao estado idêntico",
      );
      assert.deepEqual(await impressao(c), f0);
    });
  },
);

prova(
  "(8d) rollback recusa corpo de OUTRA migration e não derruba",
  async (c) => {
    await emTx(c, async () => {
      await c.query(
        `CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(p_order_id uuid, p_recebido boolean)
         RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
         AS $$ BEGIN RETURN '{"posterior":true}'::jsonb; END; $$`,
      );
      const r = await tentarSql(c, SQL_ROLLBACK);
      assert.equal(r.ok, false);
      assert.match(r.message, /B1_BASELINE_DIVERGENT.*redefinição posterior/);
      const h = await c.query(
        "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
        [FN],
      );
      assert.match(
        h.rows[0].prosrc,
        /posterior/,
        "derrubou o corpo de outra migration",
      );
    });
  },
);

prova(
  "(8e) CONTROLE: sem a migration (corpo da 97) o defeito existe — a venda some do Financeiro com a devolução viva",
  async (c) => {
    await emTx(c, async () => {
      await c.query(SQL_ROLLBACK);
      const id = await vender(c);
      await devolucao(c, id, "aprovada");
      const fin0 = await financeiro(c, id);
      assert.ok(fin0.some((l) => ENTRADA_DA_VENDA.test(l)));
      const r = await registrar(c, "admin", id, false);
      assert.ok(r.ok, `o corpo antigo devia deixar desfazer: ${r.message}`);
      const fin1 = await financeiro(c, id);
      assert.ok(
        !fin1.some((l) => ENTRADA_DA_VENDA.test(l)),
        `a venda devia sumir do Financeiro no corpo antigo (${fin1.join(",")})`,
      );
    });
  },
);

// ------------------------------------------------------------------- mutantes

async function mutar(c, rotulo, buscar, trocar, proveCom) {
  let mutada;
  if (typeof buscar === "function") {
    mutada = buscar(SQL_FUNCAO);
  } else {
    assert.equal(
      SQL_FUNCAO.split(buscar).length - 1,
      1,
      `mutante "${rotulo}": o trecho a trocar tem de aparecer UMA vez na função`,
    );
    mutada = SQL_FUNCAO.replace(buscar, () => trocar);
  }
  assert.notEqual(mutada, SQL_FUNCAO);
  await c.query(mutada);
  let sobreviveu = false;
  let morreuCom = null;
  try {
    for (const p of proveCom) {
      try {
        await p(c);
      } catch (e) {
        if (e instanceof assert.AssertionError || e.code === "ERR_ASSERTION") {
          morreuCom = e.message.split("\n")[0].slice(0, 110);
          break;
        }
        throw e;
      }
    }
    if (morreuCom === null) sobreviveu = true;
  } finally {
    await c.query(SQL_FUNCAO); // restaura a função verdadeira
  }
  assert.equal(sobreviveu, false, `MUTANTE SOBREVIVEU: ${rotulo}`);
  console.log(`      mutante morto: ${rotulo}  <-  ${morreuCom}`);
}

const BLOCO_CHECAGEM = `            IF EXISTS (
                SELECT 1 FROM public.devolucoes d
                 WHERE d.order_id = p_order_id
                   AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')
            ) THEN
                RAISE EXCEPTION '${MSG_DEVOLUCAO}';
            END IF;
`;

prova(
  "(9) mutantes: tirar cada peça da checagem deixa a prova certa vermelha",
  async (c) => {
    const antes = (await defDaFuncao(c)).def;
    await mutar(c, "sem a checagem", BLOCO_CHECAGEM, "", [
      recusaComDevolucaoViva,
    ]);
    await mutar(
      c,
      "recusa SÓ a devolução concluída (as abertas passam)",
      "AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')",
      "AND d.status = 'concluida'",
      [recusaComDevolucaoViva],
    );
    await mutar(
      c,
      "recusa QUALQUER devolução (as mortas também)",
      "AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')",
      "AND true",
      [permiteComDevolucaoMorta],
    );
    await mutar(
      c,
      "'reprovada' deixa de liberar (o critério da anulação é outro)",
      "AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')",
      "AND d.status NOT IN ('recusada', 'cancelada')",
      [permiteComDevolucaoMorta],
    );
    await mutar(
      c,
      "devolução de QUALQUER pedido bloqueia (sem o filtro do pedido)",
      "WHERE d.order_id = p_order_id",
      "WHERE true",
      [bordas],
    );
    await mutar(
      c,
      "mensagem trocada",
      `RAISE EXCEPTION '${MSG_DEVOLUCAO}';`,
      "RAISE EXCEPTION 'Devolução em aberto.';",
      [recusaComDevolucaoViva],
    );
    // A checagem passa a valer também no desfazer que já é no-op (fora do ramo que ESCREVE).
    const NO_RAMO_DO_NOOP =
      "        IF v_payment_status IS DISTINCT FROM 'recebido_na_entrega' THEN";
    await mutar(
      c,
      "a checagem vale também no desfazer que já é no-op (fora do ramo que escreve)",
      (fn) => {
        assert.equal(fn.split(NO_RAMO_DO_NOOP).length - 1, 1);
        return fn
          .replace(BLOCO_CHECAGEM, "")
          .replace(NO_RAMO_DO_NOOP, () => BLOCO_CHECAGEM + NO_RAMO_DO_NOOP);
      },
      null,
      [oQueNaoMuda],
    );
    // A checagem vaza para o ramo do "Recebi" (p_recebido = true): marcar recebido passa a recusar.
    const RAMO_RECEBI = "    IF p_recebido THEN\n";
    await mutar(
      c,
      'a checagem vale também no "Recebi" (p_recebido = true)',
      (fn) => {
        assert.equal(fn.split(RAMO_RECEBI).length - 1, 1);
        return fn
          .replace(BLOCO_CHECAGEM, "")
          .replace(RAMO_RECEBI, () => RAMO_RECEBI + BLOCO_CHECAGEM);
      },
      null,
      [oQueNaoMuda],
    );
    // O mutante que tira a TRAVA do pedido: sem FOR UPDATE a devolução que chega primeiro não é vista.
    assert.equal(
      SQL_FUNCAO.split("     WHERE id = p_order_id\n     FOR UPDATE;").length -
        1,
      1,
      "a trava do pedido tem de aparecer uma vez",
    );
    await mutar(
      c,
      "sem a trava do pedido (FOR UPDATE) — a corrida volta",
      "     WHERE id = p_order_id\n     FOR UPDATE;",
      "     WHERE id = p_order_id;",
      [corrida],
    );
    assert.equal(
      (await defDaFuncao(c)).def,
      antes,
      "a função não foi restaurada",
    );
  },
);

// -------------------------------------------------------------------- runner

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  const resultados = [];
  try {
    const existe = await c.query("SELECT to_regprocedure($1) AS f", [FN]);
    if (!existe.rows[0].f) {
      falhar("FALHOU", `${FN} não existe: as migrations não foram aplicadas.`);
    }
    for (const { nome, corpo } of PROVAS) {
      const t0 = Date.now();
      try {
        await corpo(c);
        resultados.push({ nome, ok: true });
        console.log(`  ok   ${nome} (${Date.now() - t0} ms)`);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        await c.query("RESET ROLE").catch(() => {});
        resultados.push({ nome, ok: false, erro: e.stack || String(e) });
        console.log(`  FAIL ${nome}\n${e.stack || e}`);
      }
    }
  } finally {
    await c.end();
  }
  const falhas = resultados.filter((r) => !r.ok);
  const resumo = `${resultados.length - falhas.length}/${resultados.length} provas do desfazer-recebimento verdes.`;
  console.log(`\n[desfazer-recebimento] ${resumo}`);
  anexarAoSummary(
    "Prova viva: desfazer recebimento recusa devolução viva (20261243000000)",
    falhas.length
      ? `**${falhas.length} falha(s)**:\n\n${falhas.map((f) => `- ${f.nome}`).join("\n")}`
      : `**${resumo}**`,
  );
  if (falhas.length) process.exit(1);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));

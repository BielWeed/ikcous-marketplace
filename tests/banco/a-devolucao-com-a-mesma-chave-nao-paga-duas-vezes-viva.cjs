"use strict";

/**
 * Prova VIVA da migration 20261640000000 (a devolucao com a mesma chave nao paga duas vezes): a coluna nova
 * `order_refunds.chave_da_solicitacao`, o indice unico parcial dela e a funcao nova
 * `solicitar_estorno_com_chave(p_order_id, p_amount, p_motivo, p_chave)`. So Postgres EFEMERO, num CLONE proprio
 * (rodar-isolado.cjs): nunca banco de loja.
 *
 * O DEFEITO (controle): pedido de R$ 200 cancelado; a lojista devolve R$ 50, a tela desiste em 20 s mas o servidor grava
 * depois; a releitura (feita antes) mostra R$ 200 e ela devolve R$ 50 de novo. `solicitar_estorno` nao sabe que e' a
 * mesma intencao: cria DUAS linhas de R$ 50 (o cliente recebe R$ 100). Aqui o caminho antigo, no mesmo cenario, cria
 * duas; o novo, com a MESMA chave, cria UMA e a segunda chamada devolve `ja_registrada: true` com o MESMO refund_id.
 *
 * PROVAS (cada uma pelo nome na saida):
 *   1. controle do defeito com o caminho antigo (duas linhas de R$ 50);
 *   2. mesma chave duas vezes (sequencial) = 1 linha; a chave fica na linha; motivo; saldo 150;
 *   3. chave diferente = 2 linhas (duas devolucoes parciais de verdade);
 *   4. DUAS CONEXOES REAIS com a mesma chave no mesmo pedido (a segunda espera a trava e devolve a mesma linha);
 *   5. DUAS CONEXOES REAIS com a mesma chave em pedidos diferentes (a segunda espera o indice e recusa, sem gravar);
 *   6. a repeticao nao roda as recusas de novo (devolveu tudo: o saldo zero nao recusa a mesma intencao);
 *   7. chave repetida com outro valor ou outro pedido recusa sem gravar;
 *   8. sem chave: a funcao nova recusa; o caminho antigo segue igual (nova linha a cada chamada);
 *   9. bordas: recusas sem escrever nada, e a chave recusada continua usavel;
 *  10. permissao: anon, service_role, cliente e admin rebaixado recusados;
 *  11. coluna e indice: linhas sem chave convivem, a mesma chave nunca duas vezes nem pelo superusuario;
 *  12. nada existente mudou (corpos, ACL, fichas 43a e 143a);
 *  13. mutantes (cada um na guarda certa), restaurando o corpo exato depois;
 *  14. reaplicar, pre-voo, rollback comum (mantem as chaves), destrutivo (so com o dono);
 *  15. atomicidade (conexao SEM BEGIN com conferencia sabotada), dado que ja existia antes do apply, 200a/200b.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (migration, rollbacks e fichas), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const NOME =
  "20261640000000_a_devolucao_com_a_mesma_chave_nao_paga_duas_vezes.sql";
const norm = (s) => s.replace(/\r\n/g, "\n");
const lerMigration = (n) =>
  norm(fs.readFileSync(path.join(RAIZ, "supabase", "migrations", n), "utf8"));
const lerConsulta = (n) =>
  fs.readFileSync(
    path.join(RAIZ, "scripts", "publicacao", "consultas", `${n}.sql`),
    "utf8",
  );
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

const MIGRATION = lerMigration(NOME);
const ROLLBACK = lerMigration(`rollback-manual-${NOME}`);
const DESTRUTIVO = lerMigration(`rollback-manual-destrutivo-${NOME}`);
const FICHA_A = lerConsulta(
  "200a-conferir-a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-aplicado",
);
const FICHA_B = lerConsulta(
  "200b-antes-a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-ausente",
);
const FICHA_43A = lerConsulta("43a-conferir-reembolso-em-duvida-aplicado");
const FICHA_143A = lerConsulta(
  "143a-conferir-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-aplicado",
);

const HASH_FN = "2021a69d46d49d227e4f1f206eb8df02";
const SIG = "public.solicitar_estorno_com_chave(uuid,numeric,text,uuid)";
const CONFIRMA_DESTRUTIVO =
  "SET LOCAL app.confirmo_apagar_chave_da_solicitacao = 'APAGAR';";

const ADMIN = "7e7e1640-0000-4000-8000-0000000000a1";
const REBAIXADO = "7e7e1640-0000-4000-8000-0000000000a2";
const CLIENTE = "7e7e1640-0000-4000-8000-0000000000c1";
const CLAIMS_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const CLAIMS_CLIENTE = JSON.stringify({ role: "authenticated" });

let C;
let D;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

// ---------------------------------------------------------------------------
// Fixture e chamadas
// ---------------------------------------------------------------------------
async function semearPessoas() {
  for (const [id, meta, papel] of [
    [ADMIN, '{"role":"admin"}', "admin"],
    // Rebaixado: o JWT ainda diz admin, mas o profiles ja diz customer (is_admin_atual recusa).
    [REBAIXADO, '{"role":"admin"}', "customer"],
    [CLIENTE, "{}", "customer"],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@r1640.invalid', $2::jsonb)`,
      [id, meta],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa ficticia R1640', $2)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [id, papel],
    );
  }
}

async function pedido(
  c = C,
  {
    pagamento = "pago",
    status = "cancelled",
    total = 200,
    enviado = false,
    retornou = false,
  } = {},
) {
  const id = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping,
        status, canal, payment_method, payment_status, paid_at,
        gateway_payment_id, valor_estornado, cancelled_after_shipping, returned_to_seller_at)
     VALUES ($1, $2, 'Pessoa ficticia R1640', '{}'::jsonb, $8, $8, 0,
             $3, 'online', 'online', $4,
             CASE WHEN $4 IN ('pago', 'pago_apos_expirar') THEN now() END,
             $5, 0, $6, CASE WHEN $7 THEN now() END)`,
    [
      id,
      CLIENTE,
      status,
      pagamento,
      `ORD-R1640-${id}`,
      enviado,
      retornou,
      total,
    ],
  );
  return id;
}

/** O erro volta ao savepoint e nao derruba a transacao da prova. */
async function chamar(
  conn,
  sql,
  params = [],
  { papel = "authenticated", uid = ADMIN, claims = CLAIMS_ADMIN } = {},
) {
  await conn.query("SAVEPOINT tentativa");
  try {
    await conn.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [uid ?? "", claims],
    );
    await conn.query(`SET LOCAL ROLE ${papel}`);
    const r = await conn.query(sql, params);
    await conn.query("RESET ROLE");
    await conn.query("RELEASE SAVEPOINT tentativa");
    return { linhas: r.rows };
  } catch (e) {
    await conn.query("ROLLBACK TO SAVEPOINT tentativa");
    await conn.query("RESET ROLE");
    await conn.query("RELEASE SAVEPOINT tentativa");
    return { erro: e.message, codigo: e.code };
  }
}

const devolver = (conn, orderId, amount, chave, motivo, opcoes) =>
  chamar(
    conn,
    "SELECT public.solicitar_estorno_com_chave($1::uuid, $2::numeric, $3::text, $4::uuid) AS r",
    [orderId, amount, motivo ?? null, chave],
    opcoes,
  );

/** Roda SQL qualquer (superusuario) sem derrubar a transacao. */
async function tentarSql(sql) {
  await C.query("SAVEPOINT tentar_sql");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT tentar_sql");
    return {};
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentar_sql");
    await C.query("RELEASE SAVEPOINT tentar_sql");
    return { erro: e.message, codigo: e.code };
  }
}

async function emTransacao(corpo) {
  await C.query("BEGIN");
  try {
    await corpo();
  } finally {
    await C.query("ROLLBACK");
  }
}

const linhas = async (orderId, c = C) =>
  (
    await c.query(
      `SELECT id, amount, status, solicitado_por, motivo, chave_da_solicitacao AS chave
         FROM public.order_refunds WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId],
    )
  ).rows;
const saldo = async (orderId, c = C) =>
  Number(
    (
      await c.query("SELECT public.pedido__saldo_a_estornar($1) AS s", [
        orderId,
      ])
    ).rows[0].s,
  );
const resposta = (r) => {
  assert.equal(r.erro, undefined, `a devolucao foi recusada: ${r.erro}`);
  return r.linhas[0].r;
};

/** Observa a espera REAL da RPC de D pela transacao de C, nao um sleep otimista. */
async function esperandoTrava(pidD, pidC, terminou) {
  for (let i = 0; i < 200; i++) {
    const r = await C.query(
      `SELECT wait_event_type = 'Lock' AND $2::int = ANY(pg_blocking_pids(pid)) AS espera
         FROM pg_stat_activity WHERE pid = $1`,
      [pidD, pidC],
    );
    if (r.rows[0]?.espera) return true;
    if (terminou()) return false;
    await new Promise((resolver) => setTimeout(resolver, 25));
  }
  return false;
}

// ---------------------------------------------------------------------------
// As provas (cada uma e' uma funcao: os mutantes as reusam como sonda)
// ---------------------------------------------------------------------------
async function controleDoDefeito() {
  await emTransacao(async () => {
    const orderId = await pedido();
    // O CAMINHO ANTIGO (solicitar_estorno): a mesma intencao, enviada duas vezes, vira duas linhas.
    for (let i = 0; i < 2; i++) {
      const r = await chamar(
        C,
        "SELECT public.solicitar_estorno($1::uuid, 50, 'devolvi 50') AS r",
        [orderId],
      );
      assert.equal(r.erro, undefined, r.erro);
    }
    const todas = await linhas(orderId);
    assert.deepEqual(
      todas.map((l) => [l.amount, l.status, l.chave]),
      [
        ["50.00", "solicitado", null],
        ["50.00", "solicitado", null],
      ],
      "CONTROLE: o caminho antigo deveria criar DUAS linhas de R$ 50 (o defeito)",
    );
    assert.equal(await saldo(orderId), 100, "R$ 100 podem sair do MP");
  });
}

async function mesmaChaveDuasVezes() {
  await emTransacao(async () => {
    const orderId = await pedido();
    const chave = crypto.randomUUID();
    const r1 = resposta(await devolver(C, orderId, 50, chave, "devolvi 50"));
    assert.equal(r1.ja_registrada, false);
    assert.equal(Number(r1.amount), 50);
    for (let i = 0; i < 3; i++) {
      const rn = resposta(await devolver(C, orderId, 50, chave, "de novo"));
      assert.equal(rn.ja_registrada, true, "a mesma intencao e' no-op");
      assert.equal(rn.refund_id, r1.refund_id, "a MESMA linha, nunca outra");
      assert.equal(Number(rn.amount), 50);
      assert.deepEqual(
        Object.keys(rn).sort(),
        ["amount", "ja_registrada", "refund_id"],
        "a resposta tem a mesma forma da primeira",
      );
    }
    // 50,00 escrito de outro jeito e' o mesmo valor
    const r50 = resposta(await devolver(C, orderId, "50.00", chave));
    assert.equal(r50.refund_id, r1.refund_id);
    const todas = await linhas(orderId);
    assert.deepEqual(
      todas.map((l) => [l.id, l.amount, l.status, l.solicitado_por, l.chave]),
      [[r1.refund_id, "50.00", "solicitado", "lojista", chave]],
      "uma linha so, com a chave gravada",
    );
    assert.equal(todas[0].motivo, "devolvi 50", "o motivo e' o da primeira");
    assert.equal(await saldo(orderId), 150, "so R$ 50 reservados");
  });
}

async function chaveDiferenteSaoDuas() {
  await emTransacao(async () => {
    const orderId = await pedido();
    const a = resposta(await devolver(C, orderId, 50, crypto.randomUUID()));
    const b = resposta(await devolver(C, orderId, 50, crypto.randomUUID()));
    assert.equal(a.ja_registrada, false);
    assert.equal(b.ja_registrada, false);
    assert.notEqual(a.refund_id, b.refund_id);
    assert.equal((await linhas(orderId)).length, 2);
    assert.equal(await saldo(orderId), 100, "duas devolucoes de verdade");
    // centavos: 33,33 com chave nova entra exato
    const c3 = resposta(await devolver(C, orderId, 33.33, crypto.randomUUID()));
    assert.equal(Number(c3.amount), 33.33);
    assert.equal(await saldo(orderId), 66.67);
  });
}

async function duasConexoesMesmoPedido() {
  const orderId = await pedido(C);
  const chave = crypto.randomUUID();
  const pidC = (await C.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  const pidD = (await D.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  assert.notEqual(pidC, pidD, "a corrida precisa de duas conexoes reais");
  let abertaC = false;
  let abertaD = false;
  let pendente;
  let terminou = false;
  try {
    await C.query("BEGIN");
    abertaC = true;
    // A primeira chamada GRAVOU mas ainda nao confirmou (o servidor lento do defeito).
    const r1 = resposta(await devolver(C, orderId, 50, chave));
    assert.equal(r1.ja_registrada, false);
    await D.query("BEGIN");
    abertaD = true;
    pendente = devolver(D, orderId, 50, chave).then(
      (r) => {
        terminou = true;
        return r;
      },
      (e) => {
        terminou = true;
        throw e;
      },
    );
    pendente.catch(() => {});
    const esperou = await esperandoTrava(pidD, pidC, () => terminou);
    await C.query("COMMIT");
    abertaC = false;
    const segunda = await pendente;
    await D.query("COMMIT");
    abertaD = false;
    // O dinheiro primeiro (a guarda que importa), a espera depois.
    assert.deepEqual(
      (await linhas(orderId)).map((l) => [l.id, l.amount]),
      [[r1.refund_id, "50.00"]],
      "DOIS pedidos de R$ 50 ao Mercado Pago: so UM pode existir",
    );
    const r2 = resposta(segunda);
    assert.equal(r2.ja_registrada, true, "a segunda ve a linha da primeira");
    assert.equal(r2.refund_id, r1.refund_id);
    assert.equal(await saldo(orderId), 150);
    assert.ok(esperou, "TRAVA: a segunda chamada nao esperou a primeira");
  } finally {
    if (abertaC) await C.query("ROLLBACK");
    if (pendente) await pendente.catch(() => {});
    if (abertaD) await D.query("ROLLBACK");
  }
}

async function duasConexoesPedidosDiferentes() {
  const pedidoA = await pedido(C);
  const pedidoB = await pedido(C);
  const chave = crypto.randomUUID();
  const pidC = (await C.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  const pidD = (await D.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  let abertaC = false;
  let abertaD = false;
  let pendente;
  let terminou = false;
  try {
    await C.query("BEGIN");
    abertaC = true;
    resposta(await devolver(C, pedidoA, 50, chave));
    await D.query("BEGIN");
    abertaD = true;
    pendente = devolver(D, pedidoB, 50, chave).then(
      (r) => {
        terminou = true;
        return r;
      },
      (e) => {
        terminou = true;
        throw e;
      },
    );
    pendente.catch(() => {});
    const esperou = await esperandoTrava(pidD, pidC, () => terminou);
    await C.query("COMMIT");
    abertaC = false;
    const segunda = await pendente;
    await D.query("COMMIT");
    abertaD = false;
    assert.ok(esperou, "o indice unico faz a segunda esperar a primeira");
    assert.equal(segunda.codigo, "P0001", segunda.erro ?? "passou");
    assert.match(segunda.erro, /Esta chave já foi usada em outra devolução/);
    assert.equal((await linhas(pedidoA)).length, 1);
    assert.deepEqual(await linhas(pedidoB), [], "o pedido B nao ganhou linha");
  } finally {
    if (abertaC) await C.query("ROLLBACK");
    if (pendente) await pendente.catch(() => {});
    if (abertaD) await D.query("ROLLBACK");
  }
}

async function repeticaoNaoRodaAsRecusas() {
  await emTransacao(async () => {
    const orderId = await pedido();
    const chave = crypto.randomUUID();
    const r1 = resposta(await devolver(C, orderId, 200, chave));
    assert.equal(await saldo(orderId), 0);
    // A mesma intencao: o saldo zero NAO a recusa (ela ja esta registrada).
    const r2 = resposta(await devolver(C, orderId, 200, chave));
    assert.equal(r2.ja_registrada, true);
    assert.equal(r2.refund_id, r1.refund_id);
    // Uma intencao NOVA e' que esbarra no saldo.
    const nova = await devolver(C, orderId, 1, crypto.randomUUID());
    assert.match(nova.erro ?? "", /maior que o valor disponível/);
    // O pedido mudou depois da primeira (ex.: alguem o tirou de cancelado): a resposta ainda e' a da primeira.
    await C.query(
      "UPDATE public.marketplace_orders SET status = 'delivered' WHERE id = $1",
      [orderId],
    );
    const r3 = resposta(await devolver(C, orderId, 200, chave));
    assert.equal(r3.refund_id, r1.refund_id);
    assert.equal((await linhas(orderId)).length, 1);
  });
}

async function chaveRepetidaComOutroConteudo() {
  await emTransacao(async () => {
    const pedidoA = await pedido();
    const pedidoB = await pedido();
    const chave = crypto.randomUUID();
    resposta(await devolver(C, pedidoA, 50, chave));
    for (const [nome, ordem, valor] of [
      ["outro valor", pedidoA, 60],
      ["um centavo a mais", pedidoA, 50.01],
      ["outro pedido", pedidoB, 50],
      ["valor nulo", pedidoA, null],
    ]) {
      const r = await devolver(C, ordem, valor, chave);
      assert.equal(r.codigo, "P0001", `${nome}: ${r.erro ?? "passou"}`);
      assert.match(r.erro, /Esta chave já foi usada em outra devolução/, nome);
    }
    assert.equal((await linhas(pedidoA)).length, 1);
    assert.deepEqual(await linhas(pedidoB), []);
  });
}

async function semChave() {
  await emTransacao(async () => {
    const orderId = await pedido();
    const r = await devolver(C, orderId, 50, null);
    assert.equal(r.codigo, "P0001", r.erro ?? "passou");
    assert.match(r.erro, /Informe a chave desta devolução/);
    assert.deepEqual(await linhas(orderId), []);
    // o caminho antigo segue igual: sem chave, uma linha nova por chamada, chave NULL
    for (let i = 0; i < 2; i++) {
      const v = await chamar(
        C,
        "SELECT public.solicitar_estorno($1::uuid, 10, NULL::text) AS r",
        [orderId],
      );
      assert.equal(v.erro, undefined, v.erro);
    }
    assert.deepEqual(
      (await linhas(orderId)).map((l) => [l.amount, l.chave]),
      [
        ["10.00", null],
        ["10.00", null],
      ],
    );
  });
}

const RECUSAS = [
  {
    nome: "pedido nao pago",
    pedido: { pagamento: "aguardando" },
    frase: /não está pago/,
  },
  {
    nome: "pedido nao cancelado",
    pedido: { status: "processing" },
    frase: /Cancele o pedido antes/,
  },
  {
    nome: "produto ainda nao voltou",
    pedido: { enviado: true, retornou: false },
    frase: /ainda não voltou para a loja/,
  },
  { nome: "valor zero", valor: 0, frase: /maior que zero/ },
  { nome: "valor negativo", valor: -5, frase: /maior que zero/ },
  {
    nome: "valor maior que o saldo",
    valor: 200.01,
    frase: /maior que o valor disponível/,
  },
  {
    nome: "pedido inexistente",
    inexistente: true,
    frase: /Pedido não encontrado/,
  },
];

async function recusasSemEscreverNada(filtro = () => true) {
  const casos = RECUSAS.filter(filtro);
  assert.ok(casos.length > 0, "nenhum caso de recusa selecionado");
  for (const caso of casos) {
    await emTransacao(async () => {
      const orderId = caso.inexistente
        ? crypto.randomUUID()
        : await pedido(C, caso.pedido ?? {});
      const chave = crypto.randomUUID();
      const r = await devolver(C, orderId, caso.valor ?? 50, chave);
      assert.ok(r.erro, `${caso.nome}: passou sem recusar`);
      assert.match(r.erro, caso.frase, `${caso.nome}: ${r.erro}`);
      const comChave = await C.query(
        "SELECT count(*)::int AS n FROM public.order_refunds WHERE chave_da_solicitacao = $1",
        [chave],
      );
      assert.equal(comChave.rows[0].n, 0, `${caso.nome}: gravou linha`);
      if (!caso.inexistente) {
        assert.deepEqual(await linhas(orderId), [], `${caso.nome}: gravou`);
        // A recusa nao queima a chave: corrigido o pedido, a MESMA chave grava.
        await C.query(
          `UPDATE public.marketplace_orders
              SET payment_status = 'pago', paid_at = now(), status = 'cancelled', returned_to_seller_at = now()
            WHERE id = $1`,
          [orderId],
        );
        const ok = resposta(await devolver(C, orderId, 50, chave));
        assert.equal(ok.ja_registrada, false, caso.nome);
      }
    });
  }
}

async function permissao() {
  await emTransacao(async () => {
    const ordem = await pedido();
    for (const [nome, opcoes, codigo, frase] of [
      [
        "anon",
        { papel: "anon", uid: null, claims: "{}" },
        "42501",
        /permission denied/,
      ],
      [
        "service_role",
        { papel: "service_role", uid: null, claims: "{}" },
        "42501",
        /permission denied/,
      ],
      [
        "cliente logado",
        { uid: CLIENTE, claims: CLAIMS_CLIENTE },
        "42501",
        /Somente a loja pede a devolução/,
      ],
      [
        "admin rebaixado (JWT ainda diz admin)",
        { uid: REBAIXADO, claims: CLAIMS_ADMIN },
        "42501",
        /Somente a loja pede a devolução/,
      ],
    ]) {
      const r = await devolver(C, ordem, 50, crypto.randomUUID(), null, opcoes);
      assert.equal(r.codigo, codigo, `${nome}: ${r.erro ?? "passou"}`);
      assert.match(r.erro, frase, nome);
      assert.deepEqual(await linhas(ordem), [], `${nome}: criou linha`);
    }
    // o admin de agora passa
    assert.equal(
      resposta(await devolver(C, ordem, 50, crypto.randomUUID())).ja_registrada,
      false,
    );
  });
}

async function colunaEIndice() {
  await emTransacao(async () => {
    const ordem = await pedido();
    // linhas sem chave (as de antes e as das outras portas) convivem, quantas forem
    for (let i = 0; i < 3; i++) {
      await C.query(
        "INSERT INTO public.order_refunds (order_id, amount, solicitado_por) VALUES ($1, 1, 'sistema')",
        [ordem],
      );
    }
    const chave = crypto.randomUUID();
    resposta(await devolver(C, ordem, 10, chave));
    // nem o superusuario grava a mesma chave duas vezes
    const dup = await tentarSql(
      `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, chave_da_solicitacao)
       VALUES ('${ordem}', 10, 'lojista', '${chave}')`,
    );
    assert.equal(dup.codigo, "23505", dup.erro ?? "passou");
    // o cliente le a coluna junto (SELECT de tabela inteira), mas nao escreve nela
    const r = await chamar(
      C,
      "UPDATE public.order_refunds SET chave_da_solicitacao = NULL WHERE order_id = $1",
      [ordem],
      { uid: CLIENTE, claims: CLAIMS_CLIENTE },
    );
    assert.equal(r.codigo, "42501", r.erro ?? "passou");
    assert.equal(
      (await linhas(ordem)).filter((l) => l.chave === chave).length,
      1,
    );
  });
}

async function nadaExistenteMudou() {
  const corpo = async (assinatura) =>
    (
      await C.query(
        "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [assinatura],
      )
    ).rows[0].h;
  assert.equal(
    await corpo("public.solicitar_estorno(uuid,numeric,text)"),
    "840de50f44958fe43b55f5222691df9b",
  );
  assert.equal(
    await corpo("public.solicitar_estorno_repetindo(uuid,text)"),
    "018d9480bacfc4776b6f3424d303a3ee",
  );
  assert.equal(
    await corpo("public.pedido__saldo_a_estornar(uuid)"),
    "99741b4cdbf1e8d8340f80440e6da094",
  );
  const acl = (
    await C.query(
      `SELECT has_function_privilege('anon', to_regprocedure('public.solicitar_estorno(uuid,numeric,text)'), 'EXECUTE') AS anon,
              has_function_privilege('authenticated', to_regprocedure('public.solicitar_estorno(uuid,numeric,text)'), 'EXECUTE') AS auth,
              (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'solicitar_estorno') AS sobrecargas`,
    )
  ).rows[0];
  assert.deepEqual(acl, { anon: false, auth: true, sobrecargas: 1 });
  for (const [nome, ficha] of [
    ["43a", FICHA_43A],
    ["143a", FICHA_143A],
  ]) {
    const r = await C.query(ficha);
    const ruins = r.rows.filter((l) => l.ok !== true).map((l) => l.item);
    assert.deepEqual(
      ruins,
      [],
      `a ${nome} ficou vermelha: ${ruins.join("; ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Mutantes: o corpo e' trocado NO CLONE e restaurado byte a byte no fim
// ---------------------------------------------------------------------------
const INICIO_FN =
  "CREATE OR REPLACE FUNCTION public.solicitar_estorno_com_chave(";
function definicaoOriginal() {
  const ini = MIGRATION.indexOf(INICIO_FN);
  const fim = MIGRATION.indexOf("$function$;", ini) + "$function$;".length;
  assert.ok(ini >= 0 && fim > ini);
  return MIGRATION.slice(ini, fim);
}
async function corpoVivo() {
  return (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    )
  ).rows[0]?.h;
}

const TRAVA = [
  "     WHERE id = p_order_id\n       FOR UPDATE;",
  "     WHERE id = p_order_id;",
];
const MUTANTES = [
  {
    nome: "sem o desvio da mesma chave (a segunda chamada tenta gravar de novo)",
    de: "    IF FOUND THEN\n        IF v_existente.order_id",
    para: "    IF FOUND AND false THEN\n        IF v_existente.order_id",
    sonda: mesmaChaveDuasVezes,
  },
  {
    nome: "a chave nao e' gravada na linha (a segunda chamada nao a acha)",
    de: "'lojista', p_chave)",
    para: "'lojista', NULL)",
    sonda: mesmaChaveDuasVezes,
  },
  {
    nome: "sem conferir pedido e valor da chave repetida",
    de: "        IF v_existente.order_id IS DISTINCT FROM p_order_id\n           OR v_existente.amount IS DISTINCT FROM round(p_amount, 2) THEN",
    para: "        IF false THEN",
    sonda: chaveRepetidaComOutroConteudo,
  },
  {
    nome: "sem exigir a chave",
    de: "IF p_chave IS NULL THEN",
    para: "IF false THEN",
    sonda: semChave,
  },
  {
    nome: "o conflito do indice devolve linha vazia em vez de recusar",
    de: "    IF v_refund_id IS NULL THEN",
    para: "    IF false THEN",
    sonda: duasConexoesPedidosDiferentes,
  },
  {
    nome: "SEM A TRAVA do pedido (o indice segura, mas a segunda aba toma erro em vez da mesma linha)",
    de: [TRAVA],
    sonda: duasConexoesMesmoPedido,
  },
  {
    nome: "SEM A TRAVA E SEM O INDICE (o defeito de volta: duas linhas de R$ 50)",
    de: [
      TRAVA,
      [
        "    ON CONFLICT (chave_da_solicitacao) WHERE chave_da_solicitacao IS NOT NULL DO NOTHING\n",
        "",
      ],
    ],
    semIndice: true,
    sonda: duasConexoesMesmoPedido,
  },
  {
    nome: "sem a conta de saldo",
    de: "IF p_amount > v_saldo THEN",
    para: "IF false THEN",
    sonda: () => recusasSemEscreverNada((c) => /saldo/.test(c.nome)),
  },
  {
    nome: "sem recusar valor zero ou negativo",
    de: "IF p_amount IS NULL OR p_amount <= 0 THEN",
    para: "IF false THEN",
    sonda: () =>
      recusasSemEscreverNada((c) => /valor (zero|negativo)/.test(c.nome)),
  },
  {
    nome: "sem recusar pedido nao pago",
    de: "OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN",
    para: "OR false THEN",
    sonda: () => recusasSemEscreverNada((c) => /nao pago/.test(c.nome)),
  },
  {
    nome: "sem recusar pedido nao cancelado",
    de: "IF v_status IS DISTINCT FROM 'cancelled' THEN",
    para: "IF false THEN",
    sonda: () => recusasSemEscreverNada((c) => /nao cancelado/.test(c.nome)),
  },
  {
    nome: "sem esperar o produto voltar",
    de: "IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN",
    para: "IF false THEN",
    sonda: () => recusasSemEscreverNada((c) => /ainda nao voltou/.test(c.nome)),
  },
  {
    nome: "sem a porta do admin ATUAL (admin rebaixado devolve)",
    de: "IF NOT public.is_admin_atual() THEN",
    para: "IF false THEN",
    sonda: permissao,
  },
  {
    // is_admin() e' subsumida por is_admin_atual() (defesa em profundidade, igual a solicitar_estorno): o que importa e'
    // que sem NENHUMA das duas o cliente logado devolve.
    nome: "sem NENHUMA porta de admin (cliente logado devolve)",
    de: [
      ["IF NOT public.is_admin() THEN", "IF false THEN"],
      ["IF NOT public.is_admin_atual() THEN", "IF false THEN"],
    ],
    sonda: permissao,
  },
];

async function aplicarMutante(m) {
  let def = definicaoOriginal();
  const trocas = Array.isArray(m.de) ? m.de : [[m.de, m.para]];
  for (const [de, para] of trocas) {
    assert.equal(
      def.split(de).length - 1,
      1,
      `mutante "${m.nome}": o trecho a trocar tem de aparecer UMA vez no corpo`,
    );
    def = def.replace(de, () => para);
  }
  assert.notEqual(md5(def), md5(definicaoOriginal()));
  await C.query(def);
}

const DEF_INDICE =
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_order_refunds_chave_da_solicitacao ON public.order_refunds (chave_da_solicitacao) WHERE chave_da_solicitacao IS NOT NULL";

async function provarMutante(m) {
  let morreu = null;
  try {
    if (m.semIndice) {
      await C.query("DROP INDEX public.uq_order_refunds_chave_da_solicitacao");
    }
    await aplicarMutante(m);
    try {
      await m.sonda();
    } catch (e) {
      morreu = e;
    }
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await D.query("ROLLBACK").catch(() => {});
    await C.query(definicaoOriginal());
    if (m.semIndice) {
      // O mutante deixou chaves repetidas COMMITADAS de proposito: as linhas do clone saem antes de o indice voltar.
      await C.query(
        `DELETE FROM public.order_refunds
          WHERE chave_da_solicitacao IN (SELECT chave_da_solicitacao FROM public.order_refunds
                                          WHERE chave_da_solicitacao IS NOT NULL
                                          GROUP BY 1 HAVING count(*) > 1)`,
      );
      await C.query(DEF_INDICE);
    }
  }
  assert.equal(await corpoVivo(), HASH_FN, "o corpo nao voltou ao original");
  assert.ok(
    (
      await C.query(
        "SELECT to_regclass('public.uq_order_refunds_chave_da_solicitacao') IS NOT NULL AS i",
      )
    ).rows[0].i,
    "o indice nao voltou",
  );
  assert.ok(morreu, `MUTANTE SOBREVIVEU: ${m.nome}`);
  return morreu;
}

// ---------------------------------------------------------------------------
// Reaplicar, pre-voo, rollback, destrutivo, atomicidade e fichas
// ---------------------------------------------------------------------------
const estado = async () =>
  (
    await C.query(
      `SELECT to_regprocedure($1) IS NOT NULL AS fn,
              EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.order_refunds')
                       AND attname = 'chave_da_solicitacao' AND NOT attisdropped) AS col,
              to_regclass('public.uq_order_refunds_chave_da_solicitacao') IS NOT NULL AS idx`,
      [SIG],
    )
  ).rows[0];
const emCRLF = (s) => s.replace(/\n/g, "\r\n");
const ruinsDa = async (sql) =>
  (await C.query(sql)).rows.filter((l) => !l.ok).map((l) => l.item);
const LINHA_OBJETOS_200B =
  "solicitar_estorno_com_chave, order_refunds.chave_da_solicitacao e uq_order_refunds_chave_da_solicitacao: ainda NAO existem";

async function reaplicarPreVooRollbackEDestrutivo() {
  // reaplicar (LF e CRLF) e' no-op
  await emTransacao(async () => {
    for (const sql of [MIGRATION, emCRLF(MIGRATION)]) {
      const r = await tentarSql(sql);
      assert.equal(r.erro, undefined, r.erro);
      assert.equal(await corpoVivo(), HASH_FN);
    }
    assert.equal((await C.query(FICHA_A)).rows.length, 5);
    assert.deepEqual(await ruinsDa(FICHA_A), []);
  });
  // pre-voo: cada estado desconhecido RECUSA sem escrever
  const preVoo = [
    [
      "corpo da funcao redefinido por outra mao",
      `CREATE OR REPLACE FUNCTION public.solicitar_estorno_com_chave(p_order_id uuid, p_amount numeric, p_motivo text, p_chave uuid)
         RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
      /corpo desconhecido/,
    ],
    [
      "sobrecarga da funcao nova",
      "CREATE FUNCTION public.solicitar_estorno_com_chave(p uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
      /sobrecarga/,
    ],
    [
      "coluna com padrao",
      "ALTER TABLE public.order_refunds ALTER COLUMN chave_da_solicitacao SET DEFAULT gen_random_uuid()",
      /chave_da_solicitacao já existe com outra forma/,
    ],
    [
      "indice com outra definicao (sem o WHERE)",
      "DROP INDEX public.uq_order_refunds_chave_da_solicitacao; CREATE UNIQUE INDEX uq_order_refunds_chave_da_solicitacao ON public.order_refunds (chave_da_solicitacao)",
      /outra definição/,
    ],
    [
      "outro indice usando a coluna",
      "CREATE INDEX idx_prova_r1640 ON public.order_refunds (order_id, chave_da_solicitacao)",
      /outro índice de order_refunds já usa chave_da_solicitacao/,
    ],
    [
      "pedido__saldo_a_estornar com outro corpo",
      "CREATE OR REPLACE FUNCTION public.pedido__saldo_a_estornar(p_order_id uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 1000::numeric $$",
      /pedido__saldo_a_estornar\(uuid\) com corpo desconhecido/,
    ],
  ];
  for (const [nome, sabotagem, frase] of preVoo) {
    await emTransacao(async () => {
      const s = await tentarSql(sabotagem);
      assert.equal(
        s.erro,
        undefined,
        `${nome}: a sabotagem nao rodou (${s.erro})`,
      );
      const antes = await estado();
      const r = await tentarSql(MIGRATION);
      assert.ok(r.erro, `${nome}: a migration NAO recusou`);
      assert.match(r.erro, /B1_BASELINE_DIVERGENT/, nome);
      assert.match(r.erro, frase, nome);
      assert.deepEqual(await estado(), antes, `${nome}: escreveu algo`);
    });
  }
  // rollback COMUM: tira a funcao, MANTEM coluna, indice e as chaves; 2x no-op; reaplicar devolve a funcao e a
  // chave gravada antes do rollback continua valendo
  await emTransacao(async () => {
    const ordem = await pedido();
    const chave = crypto.randomUUID();
    const r1 = resposta(await devolver(C, ordem, 50, chave));
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    assert.deepEqual(await estado(), { fn: false, col: true, idx: true });
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined, "rollback 2x");
    assert.deepEqual(
      (await linhas(ordem)).map((l) => l.chave),
      [chave],
      "o rollback comum nao apaga chave",
    );
    assert.ok(
      (await ruinsDa(FICHA_A)).length > 0,
      "200a negativa sem a funcao",
    );
    assert.deepEqual(await ruinsDa(FICHA_B), [LINHA_OBJETOS_200B]);
    assert.equal((await tentarSql(MIGRATION)).erro, undefined, "reaplicar");
    assert.deepEqual(await estado(), { fn: true, col: true, idx: true });
    const r2 = resposta(await devolver(C, ordem, 50, chave));
    assert.equal(r2.ja_registrada, true);
    assert.equal(r2.refund_id, r1.refund_id);
    // corpo redefinido: o rollback recusa sem apagar
    await C.query(
      `CREATE OR REPLACE FUNCTION public.solicitar_estorno_com_chave(p_order_id uuid, p_amount numeric, p_motivo text, p_chave uuid)
         RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    );
    const r3 = await tentarSql(ROLLBACK);
    assert.match(r3.erro ?? "", /não é o da 20261640000000/);
    assert.equal((await estado()).fn, true);
  });
  // DESTRUTIVO: so com a confirmacao, so depois do comum, nunca com funcao citando a coluna
  await emTransacao(async () => {
    const ordem = await pedido();
    resposta(await devolver(C, ordem, 50, crypto.randomUUID()));
    const semConfirmar = await tentarSql(DESTRUTIVO);
    assert.match(semConfirmar.erro ?? "", /CHAVE_DA_SOLICITACAO_SO_COM_O_DONO/);
    assert.equal((await tentarSql(CONFIRMA_DESTRUTIVO)).erro, undefined);
    const comFuncao = await tentarSql(DESTRUTIVO);
    assert.match(
      comFuncao.erro ?? "",
      /CHAVE_DA_SOLICITACAO_ROLLBACK_COMUM_PRIMEIRO/,
    );
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    await C.query(
      "CREATE FUNCTION public.prova_r1640_cita() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT count(chave_da_solicitacao) FROM public.order_refunds); END $$",
    );
    const citada = await tentarSql(DESTRUTIVO);
    assert.match(citada.erro ?? "", /CHAVE_DA_SOLICITACAO_AINDA_CITADA/);
    await C.query("DROP FUNCTION public.prova_r1640_cita()");
    assert.deepEqual(await estado(), { fn: false, col: true, idx: true });
    const n = Number(
      (await C.query("SELECT count(*) AS n FROM public.order_refunds")).rows[0]
        .n,
    );
    assert.equal((await tentarSql(DESTRUTIVO)).erro, undefined);
    assert.deepEqual(await estado(), { fn: false, col: false, idx: false });
    assert.equal(
      Number(
        (await C.query("SELECT count(*) AS n FROM public.order_refunds"))
          .rows[0].n,
      ),
      n,
      "o destrutivo nao apaga linha de devolucao",
    );
    assert.equal((await tentarSql(DESTRUTIVO)).erro, undefined, "2x no-op");
    assert.deepEqual(
      await ruinsDa(FICHA_B),
      [],
      "200b positiva antes do apply",
    );
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.deepEqual(await estado(), { fn: true, col: true, idx: true });
    assert.deepEqual(await ruinsDa(FICHA_A), []);
  });
}

/** Conexao SEM BEGIN (cada arquivo e' UM lote): conferencia sabotada nao deixa nada; dado de antes intacto. */
async function atomicidadeDadoDeAntesEFichas() {
  // volta ao estado de ANTES da migration, COMMITADO (o comum e o destrutivo, cada um num lote so)
  await C.query(ROLLBACK);
  await C.query(`${CONFIRMA_DESTRUTIVO}\n${DESTRUTIVO}`);
  assert.deepEqual(await estado(), { fn: false, col: false, idx: false });
  assert.ok((await ruinsDa(FICHA_A)).length > 0, "200a negativa antes");
  assert.deepEqual(await ruinsDa(FICHA_B), []);
  // dado que ja existia antes da migration
  const ordem = await pedido(C);
  await C.query(
    `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
     VALUES ($1, 20, 'linha de antes', 'lojista', 'concluido'), ($1, 5, NULL, 'cliente', 'falhou')`,
    [ordem],
  );
  const foto = async () =>
    (
      await C.query(
        "SELECT to_jsonb(r) - 'chave_da_solicitacao' AS j FROM public.order_refunds r WHERE order_id = $1 ORDER BY id",
        [ordem],
      )
    ).rows.map((l) => l.j);
  const antes = await foto();
  // conferencia final sabotada: o arquivo inteiro cai, nada fica
  const iConf = MIGRATION.indexOf("DO $conferencia_20261640000000$");
  const sabotada =
    MIGRATION.slice(0, iConf) +
    MIGRATION.slice(iConf).replace(
      `IF v_hash IS DISTINCT FROM '${HASH_FN}' THEN`,
      "IF v_hash IS DISTINCT FROM 'sabotada' THEN",
    );
  assert.notEqual(sabotada, MIGRATION);
  let caiu = null;
  try {
    await C.query(sabotada);
  } catch (e) {
    caiu = e;
  }
  assert.ok(caiu, "a conferencia sabotada tem de derrubar o arquivo");
  assert.match(caiu.message, /conferencia 20261640000000/);
  assert.deepEqual(
    await estado(),
    { fn: false, col: false, idx: false },
    "ATOMICIDADE: a falha da conferencia deixou meia migration (coluna ou indice sem a funcao)",
  );
  // o apply de verdade
  await C.query(MIGRATION);
  assert.deepEqual(await estado(), { fn: true, col: true, idx: true });
  assert.deepEqual(await foto(), antes, "as linhas de antes nao mudaram");
  assert.deepEqual(
    (
      await C.query(
        "SELECT chave_da_solicitacao AS c FROM public.order_refunds WHERE order_id = $1",
        [ordem],
      )
    ).rows.map((l) => l.c),
    [null, null],
    "as linhas de antes ficam sem chave",
  );
  assert.deepEqual(await ruinsDa(FICHA_A), [], "200a depois do apply");
  assert.deepEqual(
    await ruinsDa(FICHA_B),
    [LINHA_OBJETOS_200B],
    "200b depois do apply: so a linha dos objetos novos fica 'nao'",
  );
  // um apply que roda de novo em cima de um clone ja migrado e' no-op
  await C.query(MIGRATION);
  assert.equal(await corpoVivo(), HASH_FN);
}

// ---------------------------------------------------------------------------
// Ordem de execucao e roteiro
// ---------------------------------------------------------------------------
prova(
  "1. CONTROLE: o caminho antigo cria DUAS linhas de R$ 50 para a mesma intencao (o defeito)",
  controleDoDefeito,
);
prova(
  "2. mesma chave 4x: UMA linha (ja_registrada), chave gravada, motivo da primeira, saldo 150",
  mesmaChaveDuasVezes,
);
prova(
  "3. chave diferente = duas devolucoes de verdade (e centavos exatos)",
  chaveDiferenteSaoDuas,
);
prova(
  "4. DUAS CONEXOES REAIS, mesma chave, mesmo pedido: a segunda espera a trava e devolve a mesma linha",
  duasConexoesMesmoPedido,
);
prova(
  "5. DUAS CONEXOES REAIS, mesma chave, pedidos diferentes: a segunda espera o indice e recusa sem gravar",
  duasConexoesPedidosDiferentes,
);
prova(
  "6. a mesma intencao nao roda as recusas de novo (saldo zero, pedido mudou)",
  repeticaoNaoRodaAsRecusas,
);
prova(
  "7. chave repetida com outro valor, outro pedido ou valor nulo recusa sem gravar",
  chaveRepetidaComOutroConteudo,
);
prova(
  "8. sem chave: a funcao nova recusa; o caminho antigo segue igual",
  semChave,
);
prova(
  "9. bordas: recusas sem escrever nada e a chave recusada continua usavel",
  () => recusasSemEscreverNada(),
);
prova(
  "10. permissao: anon, service_role, cliente e admin rebaixado recusados; o admin de agora devolve",
  permissao,
);
prova(
  "11. coluna e indice: linhas sem chave convivem; a mesma chave nunca duas vezes; cliente nao escreve",
  colunaEIndice,
);
prova(
  "12. nada existente mudou: corpos, ACL e as fichas 43a e 143a",
  nadaExistenteMudou,
);
for (const m of MUTANTES) {
  prova(`13. mutante morre: ${m.nome}`, async () => {
    const morreu = await provarMutante(m);
    console.log(
      `     (caiu por: ${String(morreu.message).split("\n")[0].slice(0, 150)})`,
    );
  });
}
prova(
  "14. reaplicar (LF e CRLF), pre-voo, rollback comum (mantem as chaves) e destrutivo (so com o dono)",
  reaplicarPreVooRollbackEDestrutivo,
);
prova(
  "15. atomicidade (conexao SEM BEGIN, conferencia sabotada), dado de antes intacto e fichas 200a/200b",
  atomicidadeDadoDeAntesEFichas,
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url, statement_timeout: 15000 });
  D = new Client({ connectionString: url, statement_timeout: 15000 });
  const falhas = [];
  try {
    await C.connect();
    const db = (await C.query("SELECT current_database() AS d")).rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    await D.connect();
    assert.equal(
      await corpoVivo(),
      HASH_FN,
      "a migration 20261640000000 nao esta no banco efemero",
    );
    await semearPessoas();
    for (const p of PROVAS) {
      try {
        await p.corpo();
        console.log(`PASSOU  ${p.nome}`);
      } catch (e) {
        await C.query("ROLLBACK").catch(() => {});
        await D.query("ROLLBACK").catch(() => {});
        falhas.push(`${p.nome}\n   ${e.stack ?? e}`);
        console.log(`FALHOU  ${p.nome}`);
      }
    }
  } finally {
    await C.end().catch(() => {});
    await D.end().catch(() => {});
  }
  if (falhas.length > 0) {
    falhar(
      "DEVOLUCAO-COM-CHAVE",
      `${falhas.length} prova(s) falharam:\n${falhas.join("\n")}`,
    );
  }
  console.log(
    `\na-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-viva: ${PROVAS.length} provas, ${MUTANTES.length} mutantes mortos`,
  );
}

main().catch((erro) =>
  falhar("DEVOLUCAO-COM-CHAVE", erro.stack ?? String(erro)),
);

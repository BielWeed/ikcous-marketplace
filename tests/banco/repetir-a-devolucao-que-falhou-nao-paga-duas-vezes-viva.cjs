"use strict";

/**
 * Prova VIVA da migration 20261399991000 (repetir a devolucao que falhou nao paga duas vezes): a funcao nova
 * `solicitar_estorno_repetindo(p_refund_id, p_motivo)` e a tabela nova `order_refund_repeticao` ("esta linha falhada ja
 * foi repetida por esta outra"). So Postgres EFEMERO, num CLONE proprio (rodar-isolado.cjs): nunca banco de loja.
 *
 * O DEFEITO (controle): "Tentar de novo" chamava `solicitar_estorno(pedido, valor, texto)`, que nao sabe QUAL linha
 * falhada esta sendo repetida; cada chamada cria uma linha NOVA, a trava de saldo (100 - 30 reservados = 70) deixa as
 * duas passarem e o Mercado Pago recebe DOIS pedidos de R$ 30 com chaves de idempotencia diferentes (a chave e o id da
 * linha). Aqui o corpo ANTIGO, no mesmo cenario, cria duas linhas; o corpo NOVO cria UMA e a segunda chamada devolve
 * `ja_repetida: true` com o MESMO refund_id.
 *
 * PROVAS (cada uma pelo nome na saida):
 *   1. controle do defeito com o caminho antigo (duas linhas de R$ 30 para a mesma falhada);
 *   2. repetir uma vez so (sequencial), valor e centavos exatos, motivo, marca;
 *   3. DUAS CONEXOES REAIS repetindo a MESMA falhada (a segunda espera a trava e devolve a mesma linha);
 *   4. o botao que sobra depois do sucesso (a falhada antiga nao repete o que ja foi pago);
 *   5. cadeia (a repeticao que tambem falha se repete uma vez, e a falhada original aponta para ela);
 *   6. bordas: recusas sem escrever nada (linha viva, concluida, de sistema, pode ter saido, por fora, ligada a
 *      devolucao de produto, pedido nao pago/nao cancelado/produto nao voltou, saldo insuficiente, id nulo/inexistente);
 *   7. permissao: anon, service_role, cliente e admin rebaixado recusados; so o admin de agora repete;
 *   8. tabela so do servidor + restricoes (PK, UNIQUE, CHECK, CASCADE);
 *   9. nada existente mudou (corpos, ACL, fichas 43a);
 *  10. mutantes (cada um na guarda certa), restaurando o corpo exato depois;
 *  11. reaplicar, pre-voo, rollback (recusa com marca) e atomicidade (conexao SEM BEGIN com conferencia sabotada), 143a/143b.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (migration, rollback e fichas), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const NOME =
  "20261399991000_repetir_a_devolucao_que_falhou_nao_paga_duas_vezes.sql";
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
const FICHA_A = lerConsulta(
  "143a-conferir-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-aplicado",
);
const FICHA_B = lerConsulta(
  "143b-antes-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-ausente",
);
const FICHA_43A = lerConsulta("43a-conferir-reembolso-em-duvida-aplicado");

const HASH_FN = "018d9480bacfc4776b6f3424d303a3ee";
const SIG = "public.solicitar_estorno_repetindo(uuid,text)";
const IDENTIDADE_DA_FN = "public.solicitar_estorno_repetindo(uuid, text)";

const ADMIN = "7e7e9399-0000-4000-8000-0000000000a1";
const REBAIXADO = "7e7e9399-0000-4000-8000-0000000000a2";
const CLIENTE = "7e7e9399-0000-4000-8000-0000000000c1";
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
       VALUES ($1::uuid, $1::text || '@r99.invalid', $2::jsonb)`,
      [id, meta],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa ficticia R99', $2)
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
    total = 100,
    estornado = 0,
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
     VALUES ($1, $2, 'Pessoa ficticia R99', '{}'::jsonb, $8, $8, 0,
             $3, 'online', 'online', $4,
             CASE WHEN $4 IN ('pago', 'pago_apos_expirar') THEN now() END,
             $5, $9, $6, CASE WHEN $7 THEN now() END)`,
    [
      id,
      CLIENTE,
      status,
      pagamento,
      `ORD-R99-${id}`,
      enviado,
      retornou,
      total,
      estornado,
    ],
  );
  return id;
}

/**
 * Uma linha parada. tipo:
 *  - nada_saiu:        recusado sem POST autorizado (o MP nunca recebeu nada)      -> pode_ter_saido = false
 *  - nada_saiu_falhou: falhou com diagnostico "insufficient_money_for_refund"       -> pode_ter_saido = false
 *  - pode_ter_saido:   falhou sem diagnostico (o lado seguro)                       -> true
 *  - com_mp_id:        falhou com id do reembolso no MP                              -> true
 *  - post_incerto:     falhou com diagnostico "nada saiu" mas POST incerto           -> true
 *  - solicitado | em_processamento | concluido: linha viva ou concluida
 */
async function falhada(
  orderId,
  { tipo = "nada_saiu", amount = 30, por = "lojista", c = C } = {},
) {
  const id = crypto.randomUUID();
  const status =
    new Map([
      ["nada_saiu", "recusado"],
      ["nada_saiu_falhou", "falhou"],
      ["pode_ter_saido", "falhou"],
      ["com_mp_id", "falhou"],
      ["post_incerto", "falhou"],
    ]).get(tipo) ?? tipo;
  await c.query(
    `INSERT INTO public.order_refunds
       (id, order_id, amount, motivo, solicitado_por, status, mp_refund_id, ultimo_erro, concluido_em)
     VALUES ($1, $2, $3, 'Prova R99', $4, $5, $6, 'erro de prova',
             CASE WHEN $5 = 'concluido' THEN now() END)`,
    [id, orderId, amount, por, status, tipo === "com_mp_id" ? "MPREF-X" : null],
  );
  if (tipo === "nada_saiu_falhou" || tipo === "post_incerto") {
    await c.query(
      `INSERT INTO public.order_refund_diagnostico (refund_id, mp_codigo, post_incerto_em)
       VALUES ($1, 'insufficient_money_for_refund', CASE WHEN $2 THEN now() END)`,
      [id, tipo === "post_incerto"],
    );
  }
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

const repetir = (conn, id, motivo, opcoes) =>
  chamar(
    conn,
    "SELECT public.solicitar_estorno_repetindo($1::uuid, $2::text) AS r",
    [id, motivo ?? null],
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
      "SELECT id, amount, status, solicitado_por, motivo FROM public.order_refunds WHERE order_id = $1 ORDER BY id",
      [orderId],
    )
  ).rows;
const marcas = async (orderId, c = C) =>
  (
    await c.query(
      `SELECT rp.refund_id, rp.nova_refund_id
         FROM public.order_refund_repeticao rp
         JOIN public.order_refunds r ON r.id = rp.refund_id
        WHERE r.order_id = $1`,
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
  assert.equal(r.erro, undefined, `a repeticao foi recusada: ${r.erro}`);
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
    await falhada(orderId, { tipo: "nada_saiu", amount: 30 });
    // O CAMINHO ANTIGO (solicitar_estorno): nao sabe qual linha esta repetindo.
    for (let i = 0; i < 2; i++) {
      const r = await chamar(
        C,
        "SELECT public.solicitar_estorno($1::uuid, 30, '') AS r",
        [orderId],
      );
      assert.equal(r.erro, undefined, r.erro);
    }
    const vivas = (await linhas(orderId)).filter(
      (l) => l.status === "solicitado",
    );
    assert.equal(
      vivas.length,
      2,
      "CONTROLE: o corpo antigo deveria criar DUAS linhas de R$ 30 (o defeito)",
    );
    assert.deepEqual(
      vivas.map((l) => l.amount),
      ["30.00", "30.00"],
    );
    assert.equal(
      await saldo(orderId),
      40,
      "duas reservas de R$ 30: R$ 60 podem sair do Mercado Pago",
    );
  });
}

async function repetirUmaVezSo() {
  await emTransacao(async () => {
    const orderId = await pedido();
    const x = await falhada(orderId, { tipo: "nada_saiu", amount: 30 });
    const r1 = resposta(await repetir(C, x, "tentei de novo"));
    assert.equal(r1.ja_repetida, false);
    assert.equal(Number(r1.amount), 30);
    assert.equal(r1.refund_anterior, x);
    for (let i = 0; i < 3; i++) {
      const rn = resposta(await repetir(C, x));
      assert.equal(
        rn.ja_repetida,
        true,
        "a repeticao seguinte tem de ser no-op",
      );
      assert.equal(rn.refund_id, r1.refund_id, "a MESMA linha, nunca outra");
      assert.equal(rn.status, "solicitado");
      assert.equal(Number(rn.amount), 30);
    }
    const todas = await linhas(orderId);
    assert.equal(todas.length, 2, "a falhada e UMA repeticao, nada alem");
    const nova = todas.find((l) => l.id === r1.refund_id);
    assert.equal(nova.status, "solicitado");
    assert.equal(nova.amount, "30.00");
    assert.equal(nova.solicitado_por, "lojista");
    assert.equal(nova.motivo, "tentei de novo");
    assert.deepEqual(await marcas(orderId), [
      { refund_id: x, nova_refund_id: r1.refund_id },
    ]);
    assert.equal(await saldo(orderId), 70, "so R$ 30 reservados");
  });
}

async function valorVemDaLinhaEmCentavos() {
  await emTransacao(async () => {
    const orderId = await pedido();
    const x = await falhada(orderId, {
      tipo: "nada_saiu_falhou",
      amount: 33.33,
    });
    const r = resposta(await repetir(C, x));
    assert.equal(Number(r.amount), 33.33);
    const nova = (await linhas(orderId)).find((l) => l.id === r.refund_id);
    assert.equal(nova.amount, "33.33", "o valor sai da linha, em numeric");
    // sem motivo novo, herda o da linha falhada
    assert.equal(nova.motivo, "Prova R99");
    assert.equal(await saldo(orderId), 66.67);
    // a linha 'cliente' (cancelamento) tambem repete; a nova nasce 'lojista'
    const y = await falhada(orderId, {
      tipo: "nada_saiu",
      amount: 10,
      por: "cliente",
    });
    const ry = resposta(await repetir(C, y));
    assert.equal(
      (await linhas(orderId)).find((l) => l.id === ry.refund_id).solicitado_por,
      "lojista",
    );
  });
}

async function duasConexoesReais() {
  const orderId = await pedido(C);
  const x = await falhada(orderId, { tipo: "nada_saiu", amount: 30 });
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
    const primeira = await repetir(C, x);
    const r1 = resposta(primeira);
    assert.equal(r1.ja_repetida, false);
    await D.query("BEGIN");
    abertaD = true;
    pendente = repetir(D, x).then(
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
    assert.ok(esperou, "TRAVA: a segunda repeticao nao esperou a primeira");
    const r2 = resposta(segunda);
    assert.equal(
      r2.ja_repetida,
      true,
      "a segunda aba tem de ver 'ja repetida'",
    );
    assert.equal(r2.refund_id, r1.refund_id, "as duas abas veem a MESMA linha");
    const vivas = (await linhas(orderId)).filter(
      (l) => l.status === "solicitado",
    );
    assert.deepEqual(
      vivas.map((l) => [l.id, l.amount]),
      [[r1.refund_id, "30.00"]],
      "DOIS pedidos de R$ 30 ao Mercado Pago: so UM pode existir",
    );
    assert.equal((await marcas(orderId)).length, 1);
    assert.equal(await saldo(orderId), 70);
  } finally {
    if (abertaC) await C.query("ROLLBACK");
    if (pendente) await pendente.catch(() => {});
    if (abertaD) await D.query("ROLLBACK");
  }
}

async function botaoQueSobrouDepoisDoSucesso() {
  await emTransacao(async () => {
    const orderId = await pedido();
    const x = await falhada(orderId, { tipo: "nada_saiu", amount: 30 });
    const r1 = resposta(await repetir(C, x));
    // O Mercado Pago confirma a repeticao (o caminho real: concluir_estorno).
    await C.query(
      "UPDATE public.order_refunds SET status = 'em_processamento' WHERE id = $1",
      [r1.refund_id],
    );
    await C.query(
      "SELECT public.concluir_estorno($1::uuid, 'MPREF-R99', 'approved', NULL)",
      [r1.refund_id],
    );
    assert.equal(await saldo(orderId), 70, "R$ 30 ja devolvidos");
    // A falhada antiga segue 'falhou' na tela e o botao dela ainda aparece: o toque NAO paga de novo.
    const outra = resposta(await repetir(C, x));
    assert.equal(outra.ja_repetida, true);
    assert.equal(outra.refund_id, r1.refund_id);
    assert.equal(outra.status, "concluido");
    const todas = await linhas(orderId);
    assert.equal(todas.length, 2, "nenhuma linha nova depois do sucesso");
    assert.equal(
      (
        await C.query(
          "SELECT valor_estornado FROM public.marketplace_orders WHERE id = $1",
          [orderId],
        )
      ).rows[0].valor_estornado,
      "30.00",
    );
    assert.equal(await saldo(orderId), 70);
  });
}

async function cadeiaDeRepeticoes() {
  await emTransacao(async () => {
    const orderId = await pedido();
    const x = await falhada(orderId, { tipo: "nada_saiu", amount: 30 });
    const r1 = resposta(await repetir(C, x));
    // A repeticao tambem falha, sem nada ter saido.
    await C.query(
      "UPDATE public.order_refunds SET status = 'recusado' WHERE id = $1",
      [r1.refund_id],
    );
    // A falhada ORIGINAL aponta para a repeticao (e diz o status dela); quem repete e' a mais nova.
    const volta = resposta(await repetir(C, x));
    assert.equal(volta.ja_repetida, true);
    assert.equal(volta.refund_id, r1.refund_id);
    assert.equal(volta.status, "recusado");
    const r2 = resposta(await repetir(C, r1.refund_id));
    assert.equal(r2.ja_repetida, false);
    assert.equal(r2.refund_anterior, r1.refund_id);
    assert.equal((await marcas(orderId)).length, 2);
    assert.equal(
      (await linhas(orderId)).filter((l) => l.status === "solicitado").length,
      1,
      "uma so viva no fim da cadeia",
    );
    assert.equal(await saldo(orderId), 70);
  });
}

const RECUSAS = [
  {
    nome: "id nulo",
    frase: /Informe qual devolução repetir/,
    montar: async () => ({ id: null, ordem: await pedido() }),
  },
  {
    nome: "id inexistente",
    frase: /Devolução não encontrada/,
    montar: async () => ({ id: crypto.randomUUID(), ordem: await pedido() }),
  },
  {
    nome: "linha de sistema",
    frase: /registro de uma devolução feita fora do app/,
    montar: async () => {
      const ordem = await pedido();
      return {
        id: await falhada(ordem, { tipo: "nada_saiu", por: "sistema" }),
        ordem,
      };
    },
  },
  {
    nome: "linha concluida",
    frase: /já foi concluída/,
    montar: async () => {
      const ordem = await pedido();
      return { id: await falhada(ordem, { tipo: "concluido" }), ordem };
    },
  },
  {
    nome: "linha solicitada (em andamento)",
    frase: /ainda está em andamento/,
    montar: async () => {
      const ordem = await pedido();
      return { id: await falhada(ordem, { tipo: "solicitado" }), ordem };
    },
  },
  {
    nome: "linha em_processamento (em andamento)",
    frase: /ainda está em andamento/,
    montar: async () => {
      const ordem = await pedido();
      return { id: await falhada(ordem, { tipo: "em_processamento" }), ordem };
    },
  },
  {
    nome: "falhou sem diagnostico (pode ter saido)",
    frase: /confirmando esta devolução com o Mercado Pago, não repita/,
    montar: async () => {
      const ordem = await pedido();
      return { id: await falhada(ordem, { tipo: "pode_ter_saido" }), ordem };
    },
  },
  {
    nome: "falhou com id do reembolso no MP (pode ter saido)",
    frase: /confirmando esta devolução com o Mercado Pago, não repita/,
    montar: async () => {
      const ordem = await pedido();
      return { id: await falhada(ordem, { tipo: "com_mp_id" }), ordem };
    },
  },
  {
    nome: "falhou com POST incerto (pode ter saido)",
    frase: /confirmando esta devolução com o Mercado Pago, não repita/,
    montar: async () => {
      const ordem = await pedido();
      return { id: await falhada(ordem, { tipo: "post_incerto" }), ordem };
    },
  },
  {
    nome: "substituida por reembolso manual",
    frase: /já foi resolvida por fora/,
    montar: async () => {
      const ordem = await pedido();
      const id = await falhada(ordem, { tipo: "nada_saiu" });
      await C.query(
        "INSERT INTO public.order_refund_prova (refund_id, substituida_por_manual_em) VALUES ($1, now())",
        [id],
      );
      return { id, ordem };
    },
  },
  {
    nome: "liberada por fora depois dos 7 dias",
    frase: /já foi resolvida por fora/,
    montar: async () => {
      const ordem = await pedido();
      const id = await falhada(ordem, { tipo: "nada_saiu" });
      await C.query(
        "INSERT INTO public.order_refund_prova (refund_id, por_fora_liberado_em) VALUES ($1, now())",
        [id],
      );
      return { id, ordem };
    },
  },
  {
    nome: "ligada a uma devolucao de produto",
    frase: /faz parte de uma devolução de produto/,
    montar: async () => {
      const ordem = await pedido();
      const id = await falhada(ordem, { tipo: "nada_saiu" });
      await C.query(
        `INSERT INTO public.devolucoes
           (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno,
            status, valor_itens, valor_frete_ida, prazo_ate, politica, refund_id)
         VALUES ($1::uuid, 'DEV-99-' || substr($1::text, 1, 8), $2::uuid, $3::uuid, 'arrependimento', 'desisti', 'reembolso',
                 'nacional', 'envio_proprio', 'concluida', 30, 0, current_date + 7, '{}'::jsonb, $4::uuid)`,
        [crypto.randomUUID(), ordem, CLIENTE, id],
      );
      return { id, ordem };
    },
  },
  {
    nome: "pedido nao pago",
    frase: /não está pago: não há dinheiro do Mercado Pago para devolver/,
    montar: async () => {
      const ordem = await pedido(C, { pagamento: "aguardando" });
      return { id: await falhada(ordem, { tipo: "nada_saiu" }), ordem };
    },
  },
  {
    nome: "pedido nao cancelado",
    frase: /Cancele o pedido antes de devolver o dinheiro/,
    montar: async () => {
      const ordem = await pedido(C, { status: "delivered" });
      return { id: await falhada(ordem, { tipo: "nada_saiu" }), ordem };
    },
  },
  {
    nome: "produto enviado que ainda nao voltou",
    frase: /A devolução espera o produto: ele ainda não voltou para a loja/,
    montar: async () => {
      const ordem = await pedido(C, { enviado: true });
      return { id: await falhada(ordem, { tipo: "nada_saiu" }), ordem };
    },
  },
  {
    nome: "saldo menor que o valor da linha (ja devolvido)",
    frase: /maior que o valor disponível para devolver/,
    montar: async () => {
      const ordem = await pedido(C, { estornado: 80 });
      return {
        id: await falhada(ordem, { tipo: "nada_saiu", amount: 30 }),
        ordem,
      };
    },
  },
  {
    nome: "saldo menor que o valor da linha (outra reserva em voo)",
    frase: /maior que o valor disponível para devolver/,
    montar: async () => {
      const ordem = await pedido();
      await falhada(ordem, { tipo: "solicitado", amount: 80 });
      return {
        id: await falhada(ordem, { tipo: "nada_saiu", amount: 30 }),
        ordem,
      };
    },
  },
];

async function recusasSemEscreverNada(filtro = () => true) {
  for (const caso of RECUSAS.filter(filtro)) {
    await emTransacao(async () => {
      const { id, ordem } = await caso.montar();
      const antes = await linhas(ordem);
      const r = await repetir(C, id);
      assert.equal(
        r.codigo,
        "P0001",
        `${caso.nome}: faltou a recusa (${r.erro ?? "passou"})`,
      );
      assert.match(r.erro, caso.frase, `${caso.nome}: frase errada`);
      assert.deepEqual(
        await linhas(ordem),
        antes,
        `${caso.nome}: escreveu linha ao recusar`,
      );
      assert.deepEqual(
        await marcas(ordem),
        [],
        `${caso.nome}: gravou marca ao recusar`,
      );
    });
  }
  // contraponto: a mesma borda do lado que PASSA (nada_saiu e falhou+diagnostico, produto de volta, pago_apos_expirar)
  await emTransacao(async () => {
    for (const opcoes of [
      { enviado: true, retornou: true },
      { pagamento: "pago_apos_expirar" },
      { estornado: 70 },
    ]) {
      const ordem = await pedido(C, opcoes);
      const id = await falhada(ordem, { tipo: "nada_saiu_falhou", amount: 30 });
      assert.equal(resposta(await repetir(C, id)).ja_repetida, false);
    }
  });
}

async function permissao() {
  await emTransacao(async () => {
    const ordem = await pedido();
    const x = await falhada(ordem, { tipo: "nada_saiu" });
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
      const r = await repetir(C, x, null, opcoes);
      assert.equal(r.codigo, codigo, `${nome}: ${r.erro ?? "passou"}`);
      assert.match(r.erro, frase, nome);
      assert.deepEqual(await marcas(ordem), [], `${nome}: gravou marca`);
      assert.equal((await linhas(ordem)).length, 1, `${nome}: criou linha`);
    }
    // o admin de agora passa
    assert.equal(resposta(await repetir(C, x)).ja_repetida, false);
  });
}

async function tabelaSoDoServidor() {
  await emTransacao(async () => {
    const ordem = await pedido();
    const x = await falhada(ordem, { tipo: "nada_saiu" });
    const nova = resposta(await repetir(C, x)).refund_id;
    for (const papel of ["anon", "authenticated", "service_role"]) {
      for (const sql of [
        "SELECT count(*) FROM public.order_refund_repeticao",
        `INSERT INTO public.order_refund_repeticao (refund_id, nova_refund_id) VALUES ('${x}', '${nova}')`,
        "DELETE FROM public.order_refund_repeticao",
      ]) {
        const r = await chamar(C, sql, [], { papel, uid: ADMIN });
        assert.equal(
          r.codigo,
          "42501",
          `${papel}: ${sql}: ${r.erro ?? "passou"}`,
        );
      }
    }
    // restricoes (superusuario)
    const dup = await tentarSql(
      `INSERT INTO public.order_refund_repeticao (refund_id, nova_refund_id) VALUES ('${x}', '${crypto.randomUUID()}')`,
    );
    assert.ok(
      dup.codigo === "23503" || dup.codigo === "23505",
      `PK/FK: ${dup.erro}`,
    );
    const y = await falhada(ordem, { tipo: "nada_saiu" });
    const mesmaNova = await tentarSql(
      `INSERT INTO public.order_refund_repeticao (refund_id, nova_refund_id) VALUES ('${y}', '${nova}')`,
    );
    assert.equal(
      mesmaNova.codigo,
      "23505",
      "a mesma nova linha nao repete duas falhadas",
    );
    const mesma = await tentarSql(
      `INSERT INTO public.order_refund_repeticao (refund_id, nova_refund_id) VALUES ('${y}', '${y}')`,
    );
    assert.equal(mesma.codigo, "23514", "uma linha nao repete a si mesma");
    // apagar a linha falhada leva a marca junto (CASCADE), e a repeticao viva segue
    await C.query("DELETE FROM public.order_refunds WHERE id = $1", [x]);
    assert.deepEqual(await marcas(ordem), []);
    assert.equal(
      (
        await C.query(
          "SELECT count(*)::int AS n FROM public.order_refund_repeticao WHERE refund_id = $1",
          [x],
        )
      ).rows[0].n,
      0,
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
    await corpo("public.pedido__saldo_a_estornar(uuid)"),
    "99741b4cdbf1e8d8340f80440e6da094",
  );
  assert.equal(
    await corpo("public.order_refund__pode_ter_saido(uuid)"),
    "bdbb28b3d91588c8b10283d57bfb73d6",
  );
  assert.equal(
    await corpo("public.autorizar_post_do_estorno(uuid,numeric)"),
    "c73e48294c08f34240abc3843aa7d1f1",
  );
  const acl = (
    await C.query(
      `SELECT has_function_privilege('anon', to_regprocedure('public.solicitar_estorno(uuid,numeric,text)'), 'EXECUTE') AS anon,
              has_function_privilege('authenticated', to_regprocedure('public.solicitar_estorno(uuid,numeric,text)'), 'EXECUTE') AS auth`,
    )
  ).rows[0];
  assert.deepEqual(acl, { anon: false, auth: true });
  const colunasProva = (
    await C.query(
      `SELECT string_agg(attname, ',' ORDER BY attname) AS c FROM pg_attribute
        WHERE attrelid = to_regclass('public.order_refund_prova') AND attnum > 0 AND NOT attisdropped`,
    )
  ).rows[0].c;
  assert.equal(
    colunasProva,
    "por_fora_liberado_em,refund_id,substituida_por_manual_em",
  );
  // a ficha 43a (o reembolso em duvida) segue verde com a migration nova no ar
  const f43 = await C.query(FICHA_43A);
  const ruins = f43.rows.filter((l) => l.ok !== true).map((l) => l.item);
  assert.deepEqual(ruins, [], `a 43a ficou vermelha: ${ruins.join("; ")}`);
}

// ---------------------------------------------------------------------------
// Mutantes: o corpo e' trocado NO CLONE e restaurado byte a byte no fim
// ---------------------------------------------------------------------------
const INICIO_FN =
  "CREATE OR REPLACE FUNCTION public.solicitar_estorno_repetindo(";
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
  ).rows[0].h;
}

const MUTANTES = [
  {
    nome: "sem o desvio 'ja repetida' (a segunda chamada tenta criar de novo)",
    de: "    IF FOUND THEN\n        SELECT status INTO v_status_da_nova",
    para: "    IF FOUND AND false THEN\n        SELECT status INTO v_status_da_nova",
    sonda: repetirUmaVezSo,
  },
  {
    nome: "sem recusar linha em andamento",
    de: "IF v_r.status IN ('solicitado', 'em_processamento') THEN",
    para: "IF false THEN",
    sonda: () => recusasSemEscreverNada((c) => /andamento/.test(c.nome)),
  },
  {
    nome: "sem recusar linha concluida",
    de: "IF v_r.status = 'concluido' THEN",
    para: "IF false THEN",
    sonda: () => recusasSemEscreverNada((c) => /concluida/.test(c.nome)),
  },
  {
    nome: "sem recusar linha de sistema",
    de: "IF v_r.solicitado_por = 'sistema' THEN",
    para: "IF false THEN",
    sonda: () => recusasSemEscreverNada((c) => /sistema/.test(c.nome)),
  },
  {
    nome: "sem a regra unica 'pode ter saido' (repetiria dinheiro que pode ter saido)",
    de: "IF public.order_refund__pode_ter_saido(v_r.id) THEN",
    para: "IF false THEN",
    sonda: () => recusasSemEscreverNada((c) => /pode ter saido/.test(c.nome)),
  },
  {
    nome: "sem as marcas 'por fora' (substituida por manual / liberada por fora)",
    de: "AND (pv.substituida_por_manual_em IS NOT NULL OR pv.por_fora_liberado_em IS NOT NULL)) THEN",
    para: "AND false) THEN",
    sonda: () => recusasSemEscreverNada((c) => /por fora|manual/.test(c.nome)),
  },
  {
    nome: "sem recusar a linha ligada a devolucao de produto",
    de: "IF EXISTS (SELECT 1 FROM public.devolucoes d WHERE d.refund_id = v_r.id) THEN",
    para: "IF false THEN",
    sonda: () =>
      recusasSemEscreverNada((c) => /devolucao de produto/.test(c.nome)),
  },
  {
    nome: "sem a conta de saldo",
    de: "IF v_r.amount > v_saldo THEN",
    para: "IF false THEN",
    sonda: () => recusasSemEscreverNada((c) => /saldo/.test(c.nome)),
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
    nome: "sem a porta do admin ATUAL (admin rebaixado repete)",
    de: "IF NOT public.is_admin_atual() THEN",
    para: "IF false THEN",
    sonda: permissao,
  },
  {
    // is_admin() cai para auth.users quando o JWT nao diz admin, e is_admin_atual() exige auth.users E profiles: a
    // primeira porta e' subsumida pela segunda (defesa em profundidade, igual a solicitar_estorno). Tirar SO ela nao
    // muda nenhum comportamento observavel; o que importa e' que sem NENHUMA das duas o cliente logado repete.
    nome: "sem NENHUMA porta de admin (cliente logado repete)",
    de: [
      ["IF NOT public.is_admin() THEN", "IF false THEN"],
      ["IF NOT public.is_admin_atual() THEN", "IF false THEN"],
    ],
    sonda: permissao,
  },
  {
    nome: "SEM AS TRAVAS (a ordem global some; a PK segura, mas a segunda aba toma erro em vez de 'ja repetida')",
    de: [
      ["      ORDER BY r.id\n        FOR UPDATE;", "      ORDER BY r.id;"],
      [
        "     WHERE id = v_order_id\n       FOR UPDATE;",
        "     WHERE id = v_order_id;",
      ],
    ],
    sonda: duasConexoesReais,
  },
  {
    nome: "SEM AS TRAVAS E SEM A PK/UNIQUE (o defeito de volta: duas linhas de R$ 30)",
    de: [
      ["      ORDER BY r.id\n        FOR UPDATE;", "      ORDER BY r.id;"],
      [
        "     WHERE id = v_order_id\n       FOR UPDATE;",
        "     WHERE id = v_order_id;",
      ],
    ],
    semRestricoes: true,
    sonda: duasConexoesReais,
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

async function provarMutante(m) {
  let morreu = null;
  try {
    if (m.semRestricoes) {
      await C.query(
        "ALTER TABLE public.order_refund_repeticao DROP CONSTRAINT order_refund_repeticao_pkey, DROP CONSTRAINT order_refund_repeticao_nova_refund_id_key",
      );
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
    if (m.semRestricoes) {
      // O mutante deixou marcas repetidas de proposito: as do clone saem antes de a PK voltar.
      await C.query("DELETE FROM public.order_refund_repeticao");
      await C.query(
        "ALTER TABLE public.order_refund_repeticao ADD CONSTRAINT order_refund_repeticao_pkey PRIMARY KEY (refund_id), ADD CONSTRAINT order_refund_repeticao_nova_refund_id_key UNIQUE (nova_refund_id)",
      );
    }
  }
  assert.equal(await corpoVivo(), HASH_FN, "o corpo nao voltou ao original");
  assert.ok(morreu, `MUTANTE SOBREVIVEU: ${m.nome}`);
  return morreu;
}

// ---------------------------------------------------------------------------
// Reaplicar, pre-voo, rollback, atomicidade e fichas
// ---------------------------------------------------------------------------
const objetosExistem = async () =>
  (
    await C.query(
      `SELECT to_regprocedure($1) IS NOT NULL AS fn, to_regclass('public.order_refund_repeticao') IS NOT NULL AS tab`,
      [SIG],
    )
  ).rows[0];
const emCRLF = (s) => s.replace(/\n/g, "\r\n");
const fichaOk = async (sql) => (await C.query(sql)).rows;

async function reaplicarPreVooERollback() {
  // reaplicar (LF e CRLF) e' no-op
  await emTransacao(async () => {
    for (const sql of [MIGRATION, emCRLF(MIGRATION)]) {
      const r = await tentarSql(sql);
      assert.equal(r.erro, undefined, r.erro);
      assert.equal(await corpoVivo(), HASH_FN);
    }
    const ficha = await fichaOk(FICHA_A);
    assert.equal(ficha.length, 5);
    assert.deepEqual(
      ficha.filter((l) => !l.ok).map((l) => l.item),
      [],
    );
  });
  // pre-voo: cada estado desconhecido RECUSA sem escrever
  const preVoo = [
    [
      "corpo da funcao redefinido por outra mao",
      `CREATE OR REPLACE FUNCTION public.solicitar_estorno_repetindo(p_refund_id uuid, p_motivo text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
      /corpo desconhecido/,
    ],
    [
      "tabela com coluna a mais",
      "ALTER TABLE public.order_refund_repeticao ADD COLUMN extra text",
      /colunas diferentes/,
    ],
    [
      "order_refund__pode_ter_saido com outro corpo",
      "CREATE OR REPLACE FUNCTION public.order_refund__pode_ter_saido(p_refund_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$",
      /order_refund__pode_ter_saido\(uuid\) com corpo desconhecido/,
    ],
    [
      "pedido__saldo_a_estornar com outro corpo",
      "CREATE OR REPLACE FUNCTION public.pedido__saldo_a_estornar(p_order_id uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 1000::numeric $$",
      /pedido__saldo_a_estornar\(uuid\) com corpo desconhecido/,
    ],
    [
      "sobrecarga da funcao nova",
      "CREATE FUNCTION public.solicitar_estorno_repetindo(p uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
      /sobrecarga/,
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
      const r = await tentarSql(MIGRATION);
      assert.ok(r.erro, `${nome}: a migration NAO recusou`);
      assert.match(r.erro, /B1_BASELINE_DIVERGENT/, nome);
      assert.match(r.erro, frase, nome);
    });
  }
  // pre-voo da migration sobre a base ANTES dela (sem nada): a falta de uma dependencia recusa
  await emTransacao(async () => {
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    const s = await tentarSql(
      "ALTER TABLE public.order_refund_prova RENAME TO order_refund_prova_x",
    );
    assert.equal(s.erro, undefined);
    const r = await tentarSql(MIGRATION);
    assert.match(r.erro ?? "", /B1_BASELINE_DIVERGENT.*order_refund_prova/);
  });
  // rollback: com marca recusa e nao apaga nada; sem marca apaga; 2x e no-op; reaplicar restaura
  await emTransacao(async () => {
    const ordem = await pedido();
    const x = await falhada(ordem, { tipo: "nada_saiu" });
    resposta(await repetir(C, x));
    const r = await tentarSql(ROLLBACK);
    assert.ok(r.erro, "o rollback tem de RECUSAR com marca");
    assert.match(r.erro, /B1_BASELINE_DIVERGENT.*1 marca/);
    assert.deepEqual(await objetosExistem(), { fn: true, tab: true });
    assert.equal(
      (await marcas(ordem)).length,
      1,
      "a marca sobreviveu a recusa",
    );
    // corpo redefinido: tambem recusa
    await C.query("DELETE FROM public.order_refund_repeticao");
    await C.query(
      `CREATE OR REPLACE FUNCTION public.solicitar_estorno_repetindo(p_refund_id uuid, p_motivo text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    );
    const r2 = await tentarSql(ROLLBACK);
    assert.match(r2.erro ?? "", /não é o da 20261399991000/);
    await C.query(definicaoOriginal());
    // sem marca: apaga os dois; repetir o rollback e' no-op; reaplicar restaura
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    assert.deepEqual(await objetosExistem(), { fn: false, tab: false });
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined, "rollback 2x");
    const b = await fichaOk(FICHA_B);
    assert.deepEqual(
      b.filter((l) => !l.ok).map((l) => l.item),
      [],
      "143b antes do apply",
    );
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.deepEqual(await objetosExistem(), { fn: true, tab: true });
    assert.equal(await corpoVivo(), HASH_FN);
  });
}

/** Conexao SEM BEGIN (o arquivo inteiro e' UM lote): conferencia sabotada nao deixa nada. */
async function atomicidadeEFichas() {
  await C.query("DELETE FROM public.order_refund_repeticao");
  await C.query(ROLLBACK); // rollback COMMITADO (autocommit, um lote so)
  assert.deepEqual(await objetosExistem(), { fn: false, tab: false });
  const antesA = await fichaOk(FICHA_A);
  assert.ok(
    antesA.some((l) => !l.ok),
    "143a negativa antes do apply",
  );
  assert.deepEqual(
    (await fichaOk(FICHA_B)).filter((l) => !l.ok).map((l) => l.item),
    [],
  );
  // conferencia final sabotada: o arquivo inteiro cai, nada fica
  const iConf = MIGRATION.indexOf("DO $conferencia_20261399991000$");
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
  assert.match(caiu.message, /conferencia 20261399991000/);
  assert.deepEqual(
    await objetosExistem(),
    { fn: false, tab: false },
    "ATOMICIDADE: a falha da conferencia deixou meia migration",
  );
  // o apply de verdade
  await C.query(MIGRATION);
  assert.deepEqual(await objetosExistem(), { fn: true, tab: true });
  const a = await fichaOk(FICHA_A);
  assert.deepEqual(
    a.filter((l) => !l.ok).map((l) => l.item),
    [],
    "143a depois do apply",
  );
  const b = await fichaOk(FICHA_B);
  assert.deepEqual(
    b.filter((l) => !l.ok).map((l) => l.item),
    ["solicitar_estorno_repetindo e order_refund_repeticao: ainda NAO existem"],
    "143b depois do apply: so a linha dos objetos novos fica 'nao'",
  );
  // um apply que roda de novo em cima de um clone ja migrado e' no-op
  await C.query(MIGRATION);
  assert.equal(await corpoVivo(), HASH_FN);
}

// ---------------------------------------------------------------------------
// Ordem de execucao e roteiro
// ---------------------------------------------------------------------------
prova(
  "1. CONTROLE: o caminho antigo cria DUAS linhas de R$ 30 para a mesma falhada (o defeito)",
  controleDoDefeito,
);
prova(
  "2. repetir uma vez so: a 2a, 3a e 4a chamadas devolvem a MESMA linha (ja_repetida), uma marca, saldo 70",
  repetirUmaVezSo,
);
prova(
  "2b. o valor sai da linha (centavos exatos), motivo herdado, linha de cliente repete como lojista",
  valorVemDaLinhaEmCentavos,
);
prova(
  "3. DUAS CONEXOES REAIS repetindo a MESMA falhada: a segunda espera a trava e devolve a mesma linha",
  duasConexoesReais,
);
prova(
  "4. o botao que sobra depois do sucesso nao paga de novo",
  botaoQueSobrouDepoisDoSucesso,
);
prova(
  "5. cadeia: a repeticao que tambem falha se repete uma vez; a original aponta para ela",
  cadeiaDeRepeticoes,
);
prova("6. bordas: 17 recusas sem escrever nada e os lados que passam", () =>
  recusasSemEscreverNada(),
);
prova(
  "7. permissao: anon, service_role, cliente e admin rebaixado recusados; o admin de agora repete",
  permissao,
);
prova(
  "8. tabela so do servidor + PK, UNIQUE, CHECK e CASCADE",
  tabelaSoDoServidor,
);
prova(
  "9. nada existente mudou: corpos, ACL, order_refund_prova e a ficha 43a",
  nadaExistenteMudou,
);
for (const m of MUTANTES) {
  prova(`10. mutante morre: ${m.nome}`, async () => {
    const morreu = await provarMutante(m);
    console.log(
      `     (caiu por: ${String(morreu.message).split("\n")[0].slice(0, 150)})`,
    );
  });
}
prova(
  "11. reaplicar (LF e CRLF), pre-voo, rollback com marca e sem marca",
  reaplicarPreVooERollback,
);
prova(
  "12. atomicidade (conexao SEM BEGIN, conferencia sabotada) e fichas 143a/143b",
  atomicidadeEFichas,
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
      "a migration 20261399991000 nao esta no banco efemero",
    );
    assert.equal(IDENTIDADE_DA_FN.length > 0, true);
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
      "REPETIR-DEVOLUCAO",
      `${falhas.length} prova(s) falharam:\n${falhas.join("\n")}`,
    );
  }
  console.log(
    `\nrepetir-a-devolucao-que-falhou-nao-paga-duas-vezes-viva: ${PROVAS.length} provas, ${MUTANTES.length} mutantes mortos`,
  );
}

main().catch((erro) => falhar("REPETIR-DEVOLUCAO", erro.stack ?? String(erro)));

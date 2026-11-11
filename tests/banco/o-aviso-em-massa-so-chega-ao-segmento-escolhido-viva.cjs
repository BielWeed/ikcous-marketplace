"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, rótulos
 * de conta) ou das linhas devolvidas pelo Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) de QUEM RECEBE o
 * aviso em massa (push) em cada segmento, contra o Postgres EFÊMERO com as
 * migrations aplicadas do zero (rpc-ci). Corpo vigente das duas funções:
 * 20261199000000_portas_do_painel_exigem_admin_atual.sql
 *   - public.get_segmented_push_targets(text, numeric, integer)  (quem recebe)
 *   - public.get_segmented_push_count(text, numeric, integer)    (o número do botão)
 * (a 20261218 só mexe nos grants de get_segmented_push_count.)
 *
 * Medido COMO ADMIN ATUAL (auth.users e profiles dizem admin; auth.uid() desta
 * suíte lê app.rpc.user_id), contas fixture com UMA inscrição push cada
 * (exceto o cenário UUID, que dá 2 aparelhos a uma conta). Parâmetros sempre
 * explícitos: p_min_ltv = 150, p_days_inactive = 30.
 *
 * CENÁRIOS (cada um numa transação aninhada DESFEITA; o now() é o da transação,
 * o mesmo das RPCs, então as datas relativas são exatas):
 *   V  'vip' = soma de pedidos que NÃO são cancelled/returned e COM pagamento
 *      reconhecido (pago, pago_apos_expirar, recebido_na_entrega) >= 150:
 *      pago 200 ENTRA; aguardando 200, cancelled+pago 200 e returned+pago 200
 *      ficam de FORA; pago 100 + aguardando 100 não cruzam 150; pago 150 exato
 *      ENTRA; pago 149.99 fica de fora; pago 100 + pago 50 (dois pedidos) ENTRA.
 *      NOTA: o CHECK marketplace_orders_status_check de hoje não aceita
 *      'returned' (o filtro do corpo é defesa de um status ainda inalcançável).
 *      Para provar o filtro mesmo assim, o cenário V derruba esse CHECK, só
 *      dentro do SAVEPOINT desfeito dele (nada disso sobrevive ao ROLLBACK).
 *   I  'inactive' = ÚLTIMO pedido há mais de 30 dias OU conta com mais de 30
 *      dias que nunca pediu: pedido de 1 dia fora; último pedido de 40 dias
 *      entra; conta de 40 dias sem pedido entra; conta de 1 dia sem pedido fora;
 *      pedidos de 40 e de 1 dia (o ÚLTIMO manda) fora.
 *   N  'new' = perfil criado nos últimos 7 dias: conta de 6 dias entra, de 8 e
 *      de 100 dias ficam de fora.
 *   U  UUID = só os aparelhos DAQUELA conta (com outra conta presente; com o
 *      UUID em maiúsculas; conta sem aparelho = 0).
 *   T  'all' = todas as inscrições (o ramo que devolve todo mundo).
 * Em TODA chamada: get_segmented_push_count = número de linhas de
 * get_segmented_push_targets.
 *
 * O Achado 1 do território (segmento desconhecido/NULL cair no ELSE e virar
 * "todos") NÃO é desta prova: ela só afirma 'all'; não afirma nem muda o ELSE.
 *
 * A prova mede a loja inteira: a transação começa apagando (sem gatilho, e
 * DESFEITA no fim) as inscrições push que o clone já traga.
 *
 * MUTANTES: MUTANTE_R112A=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha no cenário que o nome promete.
 * O trecho aparece 1x em cada função; a troca vai nas DUAS (targets e count,
 * que espelham o filtro), salvo o mutante que diz "so-a-contagem". Nome
 * desconhecido é ERRO. Sem MUTANTE_R112A a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-aviso-em-massa-so-chega-ao-segmento-escolhido-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: o aviso em massa só chega ao segmento escolhido (rpc-ci)";
const TARGETS = "public.get_segmented_push_targets(text,numeric,integer)";
const COUNT = "public.get_segmented_push_count(text,numeric,integer)";
const U_ADMIN = "c1125000-0000-4000-8000-0000000000a1";
const MIN_LTV = 150;
const DIAS_INATIVO = 30;

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x em CADA função onde é aplicado. `espera` = cenário(s) onde a
// prova TEM de ficar vermelha.
const STATUS_E = "o.status NOT IN ('cancelled', 'returned')\n            AND ";
const PAGAMENTO_E =
  "\n            AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))";
const LIMITE = "HAVING SUM(o.total::numeric) >= p_min_ltv";
const JANELA_NEW = "p.created_at >= NOW() - INTERVAL '7 days'";

const MUTANTES = {
  "vip-sem-filtro-de-status": {
    espera: ["V"],
    funcoes: [TARGETS, COUNT],
    de: STATUS_E,
    para: "",
  },
  "vip-sem-filtro-de-pagamento": {
    espera: ["V"],
    funcoes: [TARGETS, COUNT],
    de: PAGAMENTO_E,
    para: "",
  },
  "vip-limite-maior-que": {
    espera: ["V"],
    funcoes: [TARGETS, COUNT],
    de: LIMITE,
    para: "HAVING SUM(o.total::numeric) > p_min_ltv",
  },
  "new-janela-de-14-dias": {
    espera: ["N"],
    funcoes: [TARGETS, COUNT],
    de: JANELA_NEW,
    para: "p.created_at >= NOW() - INTERVAL '14 days'",
  },
  // Extra (além do brief): só o 'returned' sai da lista de status excluídos.
  "vip-status-sem-returned": {
    espera: ["V"],
    funcoes: [TARGETS, COUNT],
    de: "o.status NOT IN ('cancelled', 'returned')",
    para: "o.status NOT IN ('cancelled')",
  },
  // Extras (além do brief): o segmento 'inactive'.
  "inactive-pelo-pedido-mais-antigo": {
    espera: ["I"],
    funcoes: [TARGETS, COUNT],
    de: "HAVING MAX(o.created_at)",
    para: "HAVING MIN(o.created_at)",
  },
  "inactive-conta-velha-que-pediu-tambem-entra": {
    espera: ["I"],
    funcoes: [TARGETS, COUNT],
    de: "AND o.id IS NULL",
    para: "AND o.id IS NOT NULL",
  },
  // Extra (além do brief): a contagem do botão diverge do que o envio alcança.
  "so-a-contagem-vip-sem-filtro-de-status": {
    espera: ["V"],
    funcoes: [COUNT],
    de: STATUS_E,
    para: "",
  },
};

// ------------------------------------------------------------------ semente

const idConta = (n) => `c1125000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Rótulo legível de cada conta de um cenário (user_id -> rótulo). */
function novoCenario() {
  return { contas: new Map(), proximo: 1 };
}

/**
 * Cria a conta (auth.users + profiles com created_at = now() - diasPerfil) e
 * `aparelhos` inscrições push. Devolve o id.
 */
async function conta(c, cen, rotulo, { diasPerfil, aparelhos = 1 }) {
  const id = idConta(cen.proximo++);
  cen.contas.set(id, rotulo);
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, $2, '{}'::jsonb)`,
    [id, `conta${id.slice(-3)}@aviso112a.fixture.invalid`],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role, created_at)
     VALUES ($1, $2, 'customer', now() - make_interval(days => $3::int))`,
    [id, `Fixture ${rotulo}`, diasPerfil],
  );
  // O controle da própria semente: a idade do perfil é a que o cenário diz.
  const idade = (
    await c.query(
      `SELECT (now() - created_at) = make_interval(days => $2::int) AS ok
         FROM public.profiles WHERE id = $1`,
      [id, diasPerfil],
    )
  ).rows[0];
  assert.strictEqual(
    idade.ok,
    true,
    `semente: o perfil '${rotulo}' não ficou com ${diasPerfil} dias`,
  );
  for (let i = 0; i < aparelhos; i++) {
    await c.query(
      `INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id)
       VALUES ($1, 'p256dh-fixture', 'auth-fixture', $2)`,
      [`https://push.aviso112a.fixture.invalid/${rotulo}/${i}`, id],
    );
  }
  return id;
}

/** Um pedido com created_at = now() - `dias` dias. */
async function pedido(c, userId, { total, status, pagamento, dias = 1 }) {
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at, created_at)
     VALUES ($1, 'Cliente aviso', '{}'::jsonb, $2, $2, $3, 'online', 'online', $4,
             CASE WHEN $4 = 'aguardando' THEN NULL ELSE now() - make_interval(days => $5::int) END,
             now() - make_interval(days => $5::int))`,
    [userId, total, status, pagamento, dias],
  );
}

const pago = (total, dias = 1) => ({
  total,
  status: "delivered",
  pagamento: "pago",
  dias,
});
const aguardando = (total, dias = 1) => ({
  total,
  status: "pending",
  pagamento: "aguardando",
  dias,
});
const canceladoPago = (total, dias = 1) => ({
  total,
  status: "cancelled",
  pagamento: "pago",
  dias,
});

/**
 * Chama as DUAS RPCs como admin atual. Devolve o que o envio alcança (rótulos
 * das contas, endpoints) e o número que o botão promete.
 */
async function alcance(c, cen, segmento) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
  const alvos = (
    await c.query(
      `SELECT user_id::text AS user_id, endpoint
         FROM public.get_segmented_push_targets($1, $2::numeric, $3::int)
        ORDER BY endpoint`,
      [segmento, MIN_LTV, DIAS_INATIVO],
    )
  ).rows;
  const contagem = Number(
    (
      await c.query(
        "SELECT public.get_segmented_push_count($1, $2::numeric, $3::int) AS n",
        [segmento, MIN_LTV, DIAS_INATIVO],
      )
    ).rows[0].n,
  );
  const rotulos = new Set(
    alvos.map((a) => cen.contas.get(a.user_id) ?? `DESCONHECIDA:${a.user_id}`),
  );
  return {
    segmento,
    linhas: alvos.length,
    rotulos,
    endpoints: alvos.map((a) => a.endpoint),
    contagem,
  };
}

function entra(cod, r, rotulo, porque) {
  assert.ok(
    r.rotulos.has(rotulo),
    `[${cod}] '${rotulo}' tem de RECEBER o aviso: ${porque} (receberam: ${[...r.rotulos].sort().join(", ") || "ninguém"})`,
  );
}
function fica(cod, r, rotulo, porque) {
  assert.ok(
    !r.rotulos.has(rotulo),
    `[${cod}] '${rotulo}' NÃO pode receber o aviso: ${porque}`,
  );
}
function soEstes(cod, r, esperados) {
  assert.deepStrictEqual(
    [...r.rotulos].sort(),
    [...esperados].sort(),
    `[${cod}] o público do segmento '${r.segmento}' é exatamente este`,
  );
}
function contagemBate(cod, r) {
  assert.strictEqual(
    r.contagem,
    r.linhas,
    `[${cod}] o número do botão (get_segmented_push_count) é igual ao que o envio alcança (linhas de get_segmented_push_targets) no segmento '${r.segmento}'`,
  );
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

CENARIOS.push({
  id: "V",
  nome: "V: vip = só dinheiro reconhecido de pedido não cancelado, >= 150 (200 entra; aguardando/cancelado fora; 100+100 aguardando não cruza; 150 exato entra; 149.99 fora; 100+50 entra)",
  corpo: async (c, cen) => {
    const A = { diasPerfil: 100 };
    const pago200 = await conta(c, cen, "pago-200", A);
    const aguard200 = await conta(c, cen, "aguardando-200", A);
    const canc200 = await conta(c, cen, "cancelado-pago-200", A);
    const dev200 = await conta(c, cen, "devolvido-pago-200", A);
    const mix = await conta(c, cen, "pago-100-mais-aguardando-100", A);
    const borda = await conta(c, cen, "pago-150-exato", A);
    const abaixo = await conta(c, cen, "pago-149-99", A);
    const doisPagos = await conta(c, cen, "pago-100-mais-pago-50", A);
    const semPedido = await conta(c, cen, "sem-pedido", A);
    await pedido(c, pago200, pago(200));
    await pedido(c, aguard200, aguardando(200));
    await pedido(c, canc200, canceladoPago(200));
    // 'returned' não cabe no CHECK de hoje: derrubado SÓ neste savepoint.
    await c.query(
      "ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_status_check",
    );
    await pedido(c, dev200, {
      total: 200,
      status: "returned",
      pagamento: "pago",
    });
    await pedido(c, mix, pago(100));
    await pedido(c, mix, aguardando(100));
    await pedido(c, borda, pago(150));
    await pedido(c, abaixo, pago(149.99));
    await pedido(c, doisPagos, pago(100));
    await pedido(c, doisPagos, pago(50));
    void semPedido;

    const r = await alcance(c, cen, "vip");
    entra("V", r, "pago-200", "pago 200 >= 150");
    fica(
      "V",
      r,
      "aguardando-200",
      "pedido aguardando pagamento não é dinheiro reconhecido",
    );
    fica(
      "V",
      r,
      "cancelado-pago-200",
      "pedido cancelado não conta, mesmo pago",
    );
    fica(
      "V",
      r,
      "devolvido-pago-200",
      "pedido devolvido não conta, mesmo pago",
    );
    fica(
      "V",
      r,
      "pago-100-mais-aguardando-100",
      "só o pago (100) conta e 100 < 150",
    );
    entra("V", r, "pago-150-exato", "a borda 150 é inclusiva (>=)");
    fica("V", r, "pago-149-99", "149.99 < 150");
    entra(
      "V",
      r,
      "pago-100-mais-pago-50",
      "a soma dos pedidos pagos (150) cruza o limite",
    );
    fica("V", r, "sem-pedido", "quem nunca pagou nada não é VIP");
    soEstes("V", r, ["pago-200", "pago-150-exato", "pago-100-mais-pago-50"]);
    contagemBate("V", r);
  },
});

CENARIOS.push({
  id: "I",
  nome: "I: inactive = último pedido há mais de 30 dias OU conta com mais de 30 dias sem pedido (pedido de 1 dia fora; 40 dias entra; sem pedido 40 dias entra; sem pedido 1 dia fora; 40d + 1d fora)",
  corpo: async (c, cen) => {
    const velha = { diasPerfil: 100 };
    const pediuOntem = await conta(c, cen, "pedido-de-1-dia", velha);
    const pediu40 = await conta(c, cen, "ultimo-pedido-de-40-dias", velha);
    const pediu40e1 = await conta(c, cen, "pedidos-de-40-e-de-1-dia", velha);
    const semPedido40 = await conta(c, cen, "conta-de-40-dias-sem-pedido", {
      diasPerfil: 40,
    });
    await conta(c, cen, "conta-de-1-dia-sem-pedido", { diasPerfil: 1 });
    await pedido(c, pediuOntem, pago(80, 1));
    await pedido(c, pediu40, pago(80, 40));
    await pedido(c, pediu40e1, pago(80, 40));
    await pedido(c, pediu40e1, aguardando(80, 1));
    void semPedido40;

    const r = await alcance(c, cen, "inactive");
    fica("I", r, "pedido-de-1-dia", "pediu ontem");
    entra("I", r, "ultimo-pedido-de-40-dias", "o último pedido é de 40 dias");
    entra(
      "I",
      r,
      "conta-de-40-dias-sem-pedido",
      "conta com mais de 30 dias que nunca pediu",
    );
    fica(
      "I",
      r,
      "conta-de-1-dia-sem-pedido",
      "conta nova (1 dia) ainda não é inativa",
    );
    fica(
      "I",
      r,
      "pedidos-de-40-e-de-1-dia",
      "o ÚLTIMO pedido (1 dia) é que conta, não o mais antigo",
    );
    soEstes("I", r, [
      "ultimo-pedido-de-40-dias",
      "conta-de-40-dias-sem-pedido",
    ]);
    contagemBate("I", r);
  },
});

CENARIOS.push({
  id: "N",
  nome: "N: new = perfil criado nos últimos 7 dias (6 dias entra; 8 e 100 dias ficam de fora)",
  corpo: async (c, cen) => {
    await conta(c, cen, "conta-de-6-dias", { diasPerfil: 6 });
    await conta(c, cen, "conta-de-8-dias", { diasPerfil: 8 });
    await conta(c, cen, "conta-de-100-dias", { diasPerfil: 100 });

    const r = await alcance(c, cen, "new");
    entra("N", r, "conta-de-6-dias", "criada há 6 dias, dentro dos 7");
    fica("N", r, "conta-de-8-dias", "criada há 8 dias, fora dos 7");
    fica("N", r, "conta-de-100-dias", "conta antiga");
    soEstes("N", r, ["conta-de-6-dias"]);
    contagemBate("N", r);
  },
});

CENARIOS.push({
  id: "U",
  nome: "U: UUID = só os aparelhos daquela conta (2 aparelhos, outra conta presente, UUID em maiúsculas, conta sem aparelho = 0)",
  corpo: async (c, cen) => {
    const alvo = await conta(c, cen, "alvo", { diasPerfil: 10, aparelhos: 2 });
    await conta(c, cen, "outra", { diasPerfil: 10, aparelhos: 1 });
    const semAparelho = await conta(c, cen, "sem-aparelho", {
      diasPerfil: 10,
      aparelhos: 0,
    });

    const r = await alcance(c, cen, alvo);
    assert.deepStrictEqual(
      r.endpoints,
      [
        "https://push.aviso112a.fixture.invalid/alvo/0",
        "https://push.aviso112a.fixture.invalid/alvo/1",
      ],
      "[U] o UUID devolve os 2 aparelhos da conta e só eles",
    );
    fica("U", r, "outra", "é outra conta");
    contagemBate("U", r);
    assert.strictEqual(r.contagem, 2, "[U] a contagem do UUID é 2");

    const maiuscula = await alcance(c, cen, alvo.toUpperCase());
    assert.deepStrictEqual(
      maiuscula.endpoints,
      r.endpoints,
      "[U] o UUID em maiúsculas alcança os mesmos aparelhos",
    );
    contagemBate("U", maiuscula);

    const vazio = await alcance(c, cen, semAparelho);
    assert.strictEqual(vazio.linhas, 0, "[U] conta sem aparelho: 0 linhas");
    contagemBate("U", vazio);
  },
});

CENARIOS.push({
  id: "T",
  nome: "T: 'all' = todas as inscrições (3 contas, 3 aparelhos)",
  corpo: async (c, cen) => {
    await conta(c, cen, "a", { diasPerfil: 1 });
    await conta(c, cen, "b", { diasPerfil: 50 });
    await conta(c, cen, "c", { diasPerfil: 200 });

    const r = await alcance(c, cen, "all");
    soEstes("T", r, ["a", "b", "c"]);
    assert.strictEqual(r.linhas, 3, "[T] 'all' devolve as 3 inscrições");
    contagemBate("T", r);
  },
});

// ------------------------------------------------------------------ rodada

async function def(c, regproc) {
  return (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [regproc])
  ).rows[0].d.replace(/\r/g, "");
}

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R112A='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  for (const regproc of m.funcoes) {
    const antes = await def(c, regproc);
    const ocorrencias = antes.split(m.de).length - 1;
    assert.strictEqual(
      ocorrencias,
      1,
      `mutante ${nome}: o trecho tem de aparecer 1x em ${regproc} (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
    );
    const mutado = antes.replace(m.de, () => m.para);
    assert.notStrictEqual(mutado, antes, "mutante não alterou nada");
    await c.query(mutado);
    assert.strictEqual(
      await def(c, regproc),
      mutado,
      "o banco não instalou exatamente o mutante",
    );
  }
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), admin atual, loja sem inscrição
 * push, e cada cenário num SAVEPOINT. Devolve {passou:[ids], falhou:[...]}.
 * Erro que não é de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin@aviso112a.fixture.invalid', '{"role":"admin"}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Admin Aviso 112a', 'admin')
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN],
    );
    // Controle da identidade: é ADMIN ATUAL nas duas fontes (senão a RPC recusa
    // e o teste mediria a recusa, não o segmento).
    await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
    const atual = (await c.query("SELECT public.is_admin_atual() AS r")).rows[0]
      .r;
    assert.strictEqual(atual, true, "a prova parte de um admin ATUAL");

    // Números absolutos da loja inteira: limpa as inscrições que o clone já
    // traga. Sem gatilho (replica) e DESFEITO no ROLLBACK.
    const antes = (
      await c.query("SELECT count(*)::int AS n FROM public.push_subscriptions")
    ).rows[0].n;
    if (antes > 0) {
      console.log(
        `    (clone com ${antes} inscrição(ões) push: apagadas só nesta transação)`,
      );
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("DELETE FROM public.push_subscriptions");
      await c.query("SET LOCAL session_replication_role = origin");
    }
    const limpa = (
      await c.query("SELECT count(*)::int AS n FROM public.push_subscriptions")
    ).rows[0].n;
    assert.strictEqual(limpa, 0, "a prova parte da loja SEM inscrição push");

    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c, novoCenario());
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT cenario");
        await c.query("RELEASE SAVEPOINT cenario");
      }
    }
    return resultado;
  } finally {
    await c.query("ROLLBACK");
  }
}

const linha = (e) =>
  `${e.message.split("\n")[0]} (visto ${JSON.stringify(e.actual)}, esperado ${JSON.stringify(e.expected)})`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R112A || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R112A='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    const r = await rodar(cliente, nomeMutante);
    for (const id of r.passou) console.log(`  PASSOU ${id}`);
    for (const f of r.falhou) {
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
    }

    if (nomeMutante) {
      console.log(
        `  MUTANTE ${nomeMutante}: vermelho em [${r.falhou.map((f) => f.id).join(", ")}], verde em [${r.passou.join(", ")}]`,
      );
      if (r.falhou.length === 0) {
        falhar(
          "SOBREVIVEU",
          `o mutante ${nomeMutante} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (id) => !r.falhou.some((f) => f.id === id),
      );
      if (faltou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho, mas NÃO em [${faltou.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
        );
      }
      falhar(
        "VERMELHO",
        `mutante ${nomeMutante} pego, como esperado, em [${r.mutante.espera.join(", ")}]`,
      );
    }

    if (r.falhou.length > 0) {
      anexarAoSummary(
        TITULO,
        r.falhou
          .map(
            (f) => `- ❌ ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
          )
          .join("\n"),
      );
      falhar(
        "FALHOU",
        "O aviso em massa alcançou um público diferente do segmento escolhido — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[o-aviso-em-massa] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();

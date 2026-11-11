"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) de duas leituras
 * de dinheiro do painel em public.get_admin_analytics_v2 (corpo vigente desde
 * 20261251000000_o_lucro_do_estoque_usa_o_preco_da_variante.sql), contra o
 * Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci):
 *
 *  (1) "crescimento vs 30 dias" (`growth`, repetido em `month.revenueTrend`):
 *      janela atual = created_at >= now() - 30 dias; janela anterior =
 *      created_at >= now() - 60 dias E < now() - 30 dias; as DUAS só contam
 *      pedido com status fora de cancelled/returned E pagamento reconhecido
 *      (pago, pago_apos_expirar, recebido_na_entrega);
 *      trend = (atual - anterior) / anterior * 100; sem anterior: 100 se há
 *      receita atual, 0 se não há.
 *  (2) os dois contadores do bloco 6: `deliveredTotal` (status = 'delivered')
 *      e `paidOnCancelled` (pagamento reconhecido E status = 'cancelled').
 *
 * CENÁRIOS (cada um numa transação aninhada DESFEITA; created_at = now() -
 * N dias, e o now() da transação é o MESMO da RPC, então a borda é exata):
 *   A  pago 100 há 10d; pago 50, aguardando 900 e cancelado-pago 300 há 40d; pago 999 há 70d
 *      (+ iscas na janela atual: aguardando 700 e cancelado-pago 400 há 5d)
 *      -> month.revenue 100, growth 100 (= (100-50)/50*100)
 *   B  o mesmo SEM o pago de 50 -> anterior 0 e atual > 0: growth 100
 *   C  só iscas (nada reconhecido em janela nenhuma) -> growth 0
 *   D  contadores: cancelados com pago / pago_apos_expirar / recebido_na_entrega
 *      (3), 1 entregue pago, cancelado+aguardando, cancelado+expirado
 *      -> paidOnCancelled 3, deliveredTotal 1
 *   E  a BORDA exata: pago 20 em now()-30d conta no mês (>=) e NÃO no anterior
 *      (<); pago 8 em now()-60d conta no anterior (>=); pago 1000 há 61d fora
 *      de ambos -> growth 150 (= (20-8)/8*100)
 *   F  queda: pago 60 há 3d, pago 80 há 45d -> growth -25 (valor que não é 0
 *      nem 100: um anterior ignorado ou um "sem anterior" por engano não passa)
 *
 * A prova mede números absolutos da loja inteira: a transação começa apagando
 * (sem gatilho, e DESFEITA no fim) qualquer pedido que o clone já traga.
 *
 * MUTANTES: MUTANTE_R108B=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha no cenário que o nome promete.
 * Nome desconhecido é ERRO. Sem MUTANTE_R108B a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-painel-de-numeros-cresce-e-conta-cancelados-pagos-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: crescimento do painel e contadores de cancelados pagos (rpc-ci)";
const ANALYTICS = "public.get_admin_analytics_v2(integer)";
const U_ADMIN = "c1085000-0000-4000-8000-0000000000b1";

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x. `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const ATUAL = "created_at >= now() - interval '30 days'\n";
const ANTERIOR_FIM = "AND created_at < now() - interval '30 days'\n";
const FILTRO_STATUS = "    AND status NOT IN ('cancelled', 'returned')\n";
const FILTRO_PAGAMENTO =
  "    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));";
const CANCELADOS_PAGOS =
  "FROM public.marketplace_orders\n    WHERE payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled';";

const MUTANTES = {
  "anterior-sem-filtro-de-pagamento": {
    espera: ["A"],
    de: `${ANTERIOR_FIM}${FILTRO_STATUS}${FILTRO_PAGAMENTO}`,
    para: `${ANTERIOR_FIM}    AND status NOT IN ('cancelled', 'returned');`,
  },
  "anterior-sem-filtro-de-status": {
    espera: ["A"],
    de: `${ANTERIOR_FIM}${FILTRO_STATUS}${FILTRO_PAGAMENTO}`,
    para: `${ANTERIOR_FIM}${FILTRO_PAGAMENTO}`,
  },
  "atual-sem-filtro-de-pagamento": {
    espera: ["A"],
    de: `WHERE ${ATUAL}${FILTRO_STATUS}${FILTRO_PAGAMENTO}`,
    para: `WHERE ${ATUAL}    AND status NOT IN ('cancelled', 'returned');`,
  },
  "atual-sem-filtro-de-status": {
    espera: ["A"],
    de: `WHERE ${ATUAL}${FILTRO_STATUS}${FILTRO_PAGAMENTO}`,
    para: `WHERE ${ATUAL}${FILTRO_PAGAMENTO}`,
  },
  "janela-60-vira-90": {
    espera: ["A"],
    de: "created_at >= now() - interval '60 days'",
    para: "created_at >= now() - interval '90 days'",
  },
  "janela-30-vira-45": {
    espera: ["A"],
    de: "created_at >= now() - interval '30 days'",
    para: "created_at >= now() - interval '45 days'",
  },
  "limite-do-mes-sem-igual": {
    espera: ["E"],
    de: "created_at >= now() - interval '30 days'",
    para: "created_at > now() - interval '30 days'",
  },
  "limite-do-anterior-sem-igual": {
    espera: ["E"],
    de: "created_at >= now() - interval '60 days'",
    para: "created_at > now() - interval '60 days'",
  },
  "sem-anterior-vira-zero": {
    espera: ["B"],
    de: "WHEN month_revenue > 0 THEN 100 ELSE 0",
    para: "WHEN month_revenue > 0 THEN 0 ELSE 0",
  },
  "ambos-zero-vira-100": {
    espera: ["C"],
    de: "WHEN month_revenue > 0 THEN 100 ELSE 0",
    para: "WHEN month_revenue > 0 THEN 100 ELSE 100",
  },
  "paid-on-cancelled-sem-status": {
    espera: ["D"],
    de: CANCELADOS_PAGOS,
    para: "FROM public.marketplace_orders\n    WHERE payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega');",
  },
  "paid-on-cancelled-sem-recebido-na-entrega": {
    espera: ["D"],
    de: CANCELADOS_PAGOS,
    para: "FROM public.marketplace_orders\n    WHERE payment_status IN ('pago', 'pago_apos_expirar') AND status = 'cancelled';",
  },
  "paid-on-cancelled-sem-pago-apos-expirar": {
    espera: ["D"],
    de: CANCELADOS_PAGOS,
    para: "FROM public.marketplace_orders\n    WHERE payment_status IN ('pago', 'recebido_na_entrega') AND status = 'cancelled';",
  },
  "delivered-total-sem-status": {
    espera: ["D"],
    de: "FROM public.marketplace_orders\n    WHERE status = 'delivered';",
    para: "FROM public.marketplace_orders;",
  },
};

// ------------------------------------------------------------------ semente

/** Um pedido com created_at = now() - `dias` dias (o now() é o da transação, o mesmo da RPC). */
async function pedido(c, { total, status, pagamento, dias }) {
  await c.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ('Cliente painel', '{}'::jsonb, $1, $1, $2, 'online', 'online', $3,
             CASE WHEN $3 = 'aguardando' THEN NULL ELSE now() - make_interval(days => $4::int) END,
             now() - make_interval(days => $4::int))`,
    [total, status, pagamento, dias],
  );
}

const pago = (total, dias) => ({
  total,
  status: "delivered",
  pagamento: "pago",
  dias,
});
const aguardando = (total, dias) => ({
  total,
  status: "pending",
  pagamento: "aguardando",
  dias,
});
const canceladoPago = (total, dias) => ({
  total,
  status: "cancelled",
  pagamento: "pago",
  dias,
});

/** Iscas que NUNCA podem contar na receita, nas duas janelas. */
async function iscas(c, { anterior }) {
  await pedido(c, aguardando(700, 5));
  await pedido(c, canceladoPago(400, 5));
  if (anterior) {
    await pedido(c, aguardando(900, 40));
    await pedido(c, canceladoPago(300, 40));
  }
}

async function analytics(c) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
  const r = await c.query("SELECT public.get_admin_analytics_v2(30) AS r");
  return r.rows[0].r;
}

const n = (v) => Number(v);

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

CENARIOS.push({
  id: "A",
  nome: "A: pago 100 (10d) vs pago 50 (40d) com iscas e pago 999 (70d) fora -> month.revenue 100, growth 100",
  corpo: async (c) => {
    await pedido(c, pago(100, 10));
    await pedido(c, pago(50, 40));
    await pedido(c, pago(999, 70));
    await iscas(c, { anterior: true });
    const json = await analytics(c);
    assert.strictEqual(
      n(json.month.revenue),
      100,
      "[A] month.revenue: só o pago de 10 dias (aguardando, cancelado e os de 40/70 dias ficam de fora)",
    );
    assert.strictEqual(n(json.month.count), 1, "[A] month.count");
    assert.strictEqual(
      n(json.growth),
      100,
      "[A] growth = (100 - 50) / 50 * 100 (anterior = só o pago de 50; sem aguardando 900, cancelado 300 nem o de 70 dias)",
    );
    assert.strictEqual(
      n(json.month.revenueTrend),
      n(json.growth),
      "[A] month.revenueTrend repete growth",
    );
  },
});

CENARIOS.push({
  id: "B",
  nome: "B: sem o pago de 50 (anterior sem nada reconhecido) e atual > 0 -> growth 100",
  corpo: async (c) => {
    await pedido(c, pago(100, 10));
    await pedido(c, pago(999, 70));
    await iscas(c, { anterior: true });
    const json = await analytics(c);
    assert.strictEqual(n(json.month.revenue), 100, "[B] month.revenue");
    assert.strictEqual(
      n(json.growth),
      100,
      "[B] growth: anterior 0 e atual > 0 vale 100 (nunca divisão por zero)",
    );
  },
});

CENARIOS.push({
  id: "C",
  nome: "C: nada reconhecido em janela nenhuma (só iscas e o de 70 dias) -> month.revenue 0, growth 0",
  corpo: async (c) => {
    await pedido(c, pago(999, 70));
    await iscas(c, { anterior: true });
    const json = await analytics(c);
    assert.strictEqual(n(json.month.revenue), 0, "[C] month.revenue");
    assert.strictEqual(
      n(json.growth),
      0,
      "[C] growth: anterior 0 e atual 0 vale 0",
    );
    assert.strictEqual(n(json.month.revenueTrend), 0, "[C] month.revenueTrend");
  },
});

CENARIOS.push({
  id: "D",
  nome: "D: 3 cancelados com pagamento reconhecido, 1 entregue pago, cancelado+aguardando, cancelado+expirado -> paidOnCancelled 3, deliveredTotal 1",
  corpo: async (c) => {
    const cancelado = (pagamento, total) => ({
      total,
      status: "cancelled",
      pagamento,
      dias: 0,
    });
    await pedido(c, cancelado("pago", 10));
    await pedido(c, cancelado("pago_apos_expirar", 20));
    await pedido(c, cancelado("recebido_na_entrega", 30));
    await pedido(c, pago(40, 0));
    await pedido(c, cancelado("aguardando", 50));
    await pedido(c, cancelado("expirado", 60));
    const json = await analytics(c);
    assert.strictEqual(
      n(json.paidOnCancelled),
      3,
      "[D] paidOnCancelled: só cancelado COM pagamento reconhecido (pago, pago_apos_expirar, recebido_na_entrega); o entregue pago, o aguardando e o expirado ficam de fora",
    );
    assert.strictEqual(
      n(json.deliveredTotal),
      1,
      "[D] deliveredTotal: só status 'delivered'",
    );
  },
});

CENARIOS.push({
  id: "E",
  nome: "E: a borda exata — now()-30d conta no mês e não no anterior; now()-60d conta no anterior; 61d fora -> growth 150",
  corpo: async (c) => {
    await pedido(c, pago(20, 30));
    await pedido(c, pago(8, 60));
    await pedido(c, pago(1000, 61));
    const json = await analytics(c);
    assert.strictEqual(
      n(json.month.revenue),
      20,
      "[E] month.revenue: o pedido de exatamente 30 dias entra no mês (>=)",
    );
    assert.strictEqual(
      n(json.growth),
      150,
      "[E] growth = (20 - 8) / 8 * 100: o de 30 dias fica fora do anterior (<), o de 60 dias entra (>=), o de 61 dias fica fora",
    );
  },
});

CENARIOS.push({
  id: "F",
  nome: "F: queda — pago 60 (3d) vs pago 80 (45d) -> growth -25",
  corpo: async (c) => {
    await pedido(c, pago(60, 3));
    await pedido(c, pago(80, 45));
    await iscas(c, { anterior: true });
    const json = await analytics(c);
    assert.strictEqual(n(json.month.revenue), 60, "[F] month.revenue");
    assert.strictEqual(
      n(json.growth),
      -25,
      "[F] growth = (60 - 80) / 80 * 100 (negativo, e diferente de 0 e de 100)",
    );
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R108B='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const def = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      ANALYTICS,
    ])
  ).rows[0].d.replace(/\r/g, "");
  const ocorrencias = def.split(m.de).length - 1;
  assert.strictEqual(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      ANALYTICS,
    ])
  ).rows[0].d.replace(/\r/g, "");
  assert.strictEqual(
    depois,
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), admin, loja limpa, e cada
 * cenário num SAVEPOINT. Devolve {passou:[ids], falhou:[{id, nome, erro}]}.
 * Erro que não é de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin@painel108b.teste', '{"role":"admin"}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Admin Painel 108b', 'admin')
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN],
    );
    // Números absolutos da loja inteira: limpa o que o clone já traga. Sem
    // gatilho nem FK (replica) e DESFEITO no ROLLBACK; o que se insere depois
    // volta ao papel normal, com os gatilhos de produção.
    const antes = (
      await c.query("SELECT count(*)::int AS n FROM public.marketplace_orders")
    ).rows[0].n;
    if (antes > 0) {
      console.log(
        `    (clone com ${antes} pedido(s): apagados só nesta transação)`,
      );
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("DELETE FROM public.marketplace_orders");
      await c.query("SET LOCAL session_replication_role = origin");
    }
    const limpa = (
      await c.query("SELECT count(*)::int AS n FROM public.marketplace_orders")
    ).rows[0].n;
    assert.strictEqual(limpa, 0, "a prova parte da loja SEM pedido");

    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
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
  const nomeMutante = process.env.MUTANTE_R108B || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R108B='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
        "O crescimento do painel ou os contadores de cancelados pagos divergiram — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[o-painel-de-numeros] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
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

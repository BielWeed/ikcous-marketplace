"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) do KPI "taxa de
 * devolução" do CRM: public.crm_visao(date,date)->'kpis'->'taxa_devolucao',
 * corpo vigente desde 20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql,
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * A taxa só pode somar DINHEIRO QUE DE FATO VOLTOU ao cliente:
 *   - linha de order_refunds só entra com status = 'concluido' (o estorno
 *     solicitado, em processamento, que falhou ou foi recusado NÃO voltou);
 *   - devolução (devolucoes) só entra com status = 'concluida' E
 *     reembolso_manual (devolução aprovada, recebida, em trânsito etc. ainda
 *     está em andamento; devolução concluída SEM reembolso manual não é dinheiro
 *     devolvido na mão — o dinheiro dela, se houve, está no ledger).
 * A prova vizinha (numeros-do-painel-viva.cjs) só enxerga linhas que TERMINAM
 * 'concluido'/'concluida'; apagar qualquer um dos dois filtros deixava tudo
 * verde. Aqui cada status que não é dinheiro devolvido tem o seu cenário.
 *
 * CENÁRIOS (cada um num SAVEPOINT desfeito; um dia de 2025 sem outro pedido;
 * pedido pago de R$ 100, taxa = devolvido / 100):
 *   ledger-<status>     refund de 50 em solicitado | em_processamento | falhou |
 *                       recusado                                    -> 0
 *   ledger-misto        refund 50 concluido + refund 50 falhou      -> 0.5
 *   devolucao-<status>  devolução manual de 40 em solicitada | aprovada |
 *                       em_transito | recebida | recusada | cancelada |
 *                       reprovada                                   -> 0
 *   devolucao-misto     refund 30 concluido + devolução aprovada 40 -> 0.3
 *   controle-*          refund 50 concluido -> 0.5; devolução concluida manual
 *                       40 -> 0.4; os dois -> 0.9; devolução concluida SEM
 *                       reembolso manual de 40 -> 0
 *
 * MUTANTES: MUTANTE_R119A=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha EXATAMENTE nos cenários que o nome
 * promete (os controles ficam verdes). Nome desconhecido é ERRO. Sem
 * MUTANTE_R119A a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-taxa-de-devolucao-do-crm-so-conta-o-que-voltou-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: a taxa de devolução do CRM só conta o que voltou (rpc-ci)";
const CRM = "public.crm_visao(date,date)";
const U_ADMIN = "d0d11900-0000-4000-8000-0000000000a1";
const U_CLIENTE = "d0d11900-0000-4000-8000-0000000000a2";

// Um dia de 2025, longe de qualquer pedido do clone; o fuso da loja é -03:00 o ano todo.
const DIA = "2025-05-14";
const AS_12H = `${DIA}T12:00:00-03:00`;

const STATUS_LEDGER_SEM_DINHEIRO = [
  "solicitado",
  "em_processamento",
  "falhou",
  "recusado",
];
const STATUS_DEVOLUCAO_SEM_DINHEIRO = [
  "solicitada",
  "aprovada",
  "em_transito",
  "recebida",
  "recusada",
  "cancelada",
  "reprovada",
];

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x. `espera` = os cenários EXATOS onde a prova TEM de ficar
// vermelha (e só eles: o resto, inclusive os controles, fica verde).
const MUTANTES = {
  "taxa-sem-filtro-do-ledger": {
    espera: [
      ...STATUS_LEDGER_SEM_DINHEIRO.map((s) => `ledger-${s}`),
      "ledger-misto",
    ],
    de: " AND r.status = 'concluido'",
    para: "",
  },
  "taxa-sem-filtro-da-devolucao": {
    espera: [
      ...STATUS_DEVOLUCAO_SEM_DINHEIRO.map((s) => `devolucao-${s}`),
      "devolucao-misto",
    ],
    de: " AND d.status = 'concluida'",
    para: "",
  },
  "taxa-sem-a-marca-de-reembolso-manual": {
    espera: ["controle-devolucao-concluida-sem-reembolso-manual"],
    de: " AND d.reembolso_manual)",
    para: ")",
  },
};

// ------------------------------------------------------------------ semente

/** Pedido pago (online) de `total`, pago em AS_12H. Devolve o id. */
async function pedidoPago(c, total) {
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES (NULL, 'Cliente taxa 119a', '{}'::jsonb, $1, $1, 'delivered', 'online', 'online',
             'pago', $2::timestamptz, $2::timestamptz)
     RETURNING id`,
    [total, AS_12H],
  );
  return r.rows[0].id;
}

/** Linha do ledger de estorno no status pedido (insert direto: o status é o que se prova). */
async function refund(c, orderId, valor, status) {
  await c.query(
    `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, concluido_em)
     VALUES ($1, $2, 'lojista', $3,
             CASE WHEN $3 = 'concluido' THEN $4::timestamptz END)`,
    [orderId, valor, status, AS_12H],
  );
}

let protocolo = 0;
/** Devolução de `valor` no status pedido, com ou sem reembolso manual. */
async function devolucao(c, orderId, valor, status, manual = true) {
  protocolo += 1;
  await c.query(
    `INSERT INTO public.devolucoes
       (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final, modalidade,
        metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual, prazo_ate, politica,
        concluida_em)
     VALUES ($1, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'reembolso', 'local',
             'entrega_na_loja', $4, $5, $5, $6, current_date, '{}'::jsonb,
             CASE WHEN $4 = 'concluida' THEN $7::timestamptz END)`,
    [`R119A-${protocolo}`, orderId, U_CLIENTE, status, valor, manual, AS_12H],
  );
}

async function visao(c) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
  const r = await c.query("SELECT public.crm_visao($1::date, $1::date) AS r", [
    DIA,
  ]);
  return r.rows[0].r;
}

async function taxa(c) {
  return Number((await visao(c)).kpis.taxa_devolucao);
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

for (const status of STATUS_LEDGER_SEM_DINHEIRO) {
  CENARIOS.push({
    id: `ledger-${status}`,
    nome: `ledger-${status}: pedido pago de 100 com estorno de 50 '${status}' -> taxa 0 (o dinheiro não voltou)`,
    corpo: async (c) => {
      const o = await pedidoPago(c, 100);
      await refund(c, o, 50, status);
      assert.strictEqual(
        await taxa(c),
        0,
        `[ledger-${status}] estorno '${status}' não é dinheiro devolvido: taxa tem de ser 0`,
      );
    },
  });
}

CENARIOS.push({
  id: "ledger-misto",
  nome: "ledger-misto: pedido pago de 100 com estorno de 50 concluido e outro de 50 falhou -> taxa 0.5 (só o concluído)",
  corpo: async (c) => {
    const o = await pedidoPago(c, 100);
    await refund(c, o, 50, "concluido");
    await refund(c, o, 50, "falhou");
    assert.strictEqual(
      await taxa(c),
      0.5,
      "[ledger-misto] só os 50 concluídos contam; o estorno que falhou não soma",
    );
  },
});

for (const status of STATUS_DEVOLUCAO_SEM_DINHEIRO) {
  CENARIOS.push({
    id: `devolucao-${status}`,
    nome: `devolucao-${status}: pedido pago de 100 com devolução '${status}' (reembolso manual, 40) -> taxa 0 (devolução ainda não concluída)`,
    corpo: async (c) => {
      const o = await pedidoPago(c, 100);
      await devolucao(c, o, 40, status, true);
      assert.strictEqual(
        await taxa(c),
        0,
        `[devolucao-${status}] devolução '${status}' não é dinheiro devolvido: taxa tem de ser 0`,
      );
    },
  });
}

CENARIOS.push({
  id: "devolucao-misto",
  nome: "devolucao-misto: estorno concluido de 30 + devolução aprovada de 40 (reembolso manual) no mesmo pedido de 100 -> taxa 0.3",
  corpo: async (c) => {
    const o = await pedidoPago(c, 100);
    await refund(c, o, 30, "concluido");
    await devolucao(c, o, 40, "aprovada", true);
    assert.strictEqual(
      await taxa(c),
      0.3,
      "[devolucao-misto] só os 30 do ledger concluído contam; a devolução aprovada ainda não devolveu nada",
    );
  },
});

CENARIOS.push({
  id: "controle-ledger-concluido",
  nome: "controle-ledger-concluido: estorno concluido de 50 num pedido de 100 -> taxa 0.5",
  corpo: async (c) => {
    const o = await pedidoPago(c, 100);
    await refund(c, o, 50, "concluido");
    assert.strictEqual(
      await taxa(c),
      0.5,
      "[controle-ledger-concluido] 50 de 100",
    );
  },
});

CENARIOS.push({
  id: "controle-devolucao-concluida",
  nome: "controle-devolucao-concluida: devolução concluida com reembolso manual de 40 num pedido de 100 -> taxa 0.4",
  corpo: async (c) => {
    const o = await pedidoPago(c, 100);
    await devolucao(c, o, 40, "concluida", true);
    assert.strictEqual(
      await taxa(c),
      0.4,
      "[controle-devolucao-concluida] 40 de 100",
    );
  },
});

CENARIOS.push({
  id: "controle-ledger-mais-devolucao",
  nome: "controle-ledger-mais-devolucao: estorno concluido de 50 + devolução concluida manual de 40 num pedido de 100 -> taxa 0.9",
  corpo: async (c) => {
    const o = await pedidoPago(c, 100);
    await refund(c, o, 50, "concluido");
    await devolucao(c, o, 40, "concluida", true);
    assert.strictEqual(
      await taxa(c),
      0.9,
      "[controle-ledger-mais-devolucao] 50 + 40 de 100",
    );
  },
});

CENARIOS.push({
  id: "controle-devolucao-concluida-sem-reembolso-manual",
  nome: "controle-devolucao-concluida-sem-reembolso-manual: devolução concluida de 40 SEM reembolso manual -> taxa 0 (o dinheiro dela, se houve, está no ledger)",
  corpo: async (c) => {
    const o = await pedidoPago(c, 100);
    await devolucao(c, o, 40, "concluida", false);
    assert.strictEqual(
      await taxa(c),
      0,
      "[controle-devolucao-concluida-sem-reembolso-manual] sem reembolso manual não soma",
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
      `MUTANTE_R119A='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const def = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [CRM])
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
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [CRM])
  ).rows[0].d.replace(/\r/g, "");
  assert.strictEqual(
    depois,
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), admin, dia vazio, e cada
 * cenário num SAVEPOINT. Devolve {passou:[ids], falhou:[{id, nome, erro}]}.
 * Erro que não é de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@taxa119a.fixture.invalid', '{"role":"admin"}'::jsonb),
         ($2, 'cliente@taxa119a.fixture.invalid', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN, U_CLIENTE],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Taxa 119a', 'admin'), ($2, 'Cliente Taxa 119a', 'customer')
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN, U_CLIENTE],
    );
    // O dia da prova precisa estar VAZIO: senão a taxa mediria pedido que não é nosso.
    const vazio = await visao(c);
    assert.strictEqual(
      Number(vazio.kpis.pedidos),
      0,
      `o dia ${DIA} já tem pedido pago no clone: a prova mede só os seus`,
    );

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
  const nomeMutante = process.env.MUTANTE_R119A || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R119A='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
      const demais = r.falhou
        .map((f) => f.id)
        .filter((id) => !r.mutante.espera.includes(id));
      if (faltou.length > 0 || demais.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho em lugar diferente do prometido: faltou [${faltou.join(", ")}], a mais [${demais.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
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
        "A taxa de devolução do CRM contou dinheiro que não voltou (ou deixou de contar o que voltou) — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[a-taxa-de-devolucao-do-crm] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
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

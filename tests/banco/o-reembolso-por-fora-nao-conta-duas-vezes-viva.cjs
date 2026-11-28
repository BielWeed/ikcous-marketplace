"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices vem de listas fechadas deste arquivo
 * (itens do cenario, cenarios), nunca de entrada de rede. */
/**
 * 1664 no Postgres efêmero do CI, em clone próprio (rodar-isolado.cjs).
 * Exercita os dois fluxos reais, a escolha explícita, o saldo, o extrato e o lucro,
 * a recusa de papel/pedido errado, o catálogo, a reaplicação e o rollback.
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME = "20261664000000_o_reembolso_por_fora_nao_conta_duas_vezes.sql";
const NOME_ANTERIOR =
  "20261391200000_o_financeiro_descreve_a_venda_do_balcao_como_o_app_mostra.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const rollbackAnterior = ler(
  `supabase/migrations/rollback-manual-${NOME_ANTERIOR}`,
);
const emCRLF = (s) => s.replace(/\n/g, "\r\n");
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.fin__movimentos\(p_inicio date, p_fim date\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_NOVO = corpoDe(migration);
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_ANTERIOR}`));
const HASH_NOVO = "17127ad84b6eb71e8cd1714d47855a68";
const HASH_ANTES = "26473edd94ad6547d95de43433088304";
const ASSINATURA = "public.fin__movimentos(date,date)";
const C220A =
  "220a-conferir-o-reembolso-por-fora-nao-conta-duas-vezes-aplicado";
const C220B =
  "220b-antes-o-reembolso-por-fora-nao-conta-duas-vezes-base-vigente";
const C100A = "100a-conferir-o-financeiro-descreve-a-venda-do-balcao-aplicado";
const C100B = "100b-antes-o-financeiro-descreve-a-venda-do-balcao-base-vigente";
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));

const ADMIN = "5e166400-0000-4000-8000-000000000001";
const CLIENTE = "5e166400-0000-4000-8000-000000000002";
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  sub: ADMIN,
  app_metadata: { role: "admin" },
});
const cent = (v) => Math.round(Number(v) * 100);

// ---------------------------------------------------------------- infraestrutura
async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso1664");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso1664");
    await c.query("RELEASE SAVEPOINT caso1664");
  }
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa1664");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa1664");
    await c.query("RELEASE SAVEPOINT recusa1664");
  }
}
const CABECALHO_DA_FUNCAO = migration.match(
  /CREATE OR REPLACE FUNCTION public\.fin__movimentos\(p_inicio date, p_fim date\)[\s\S]*?\nAS \$\$/,
)[0];
const trocarCorpo = (c, corpo) => c.query(`${CABECALHO_DA_FUNCAO}${corpo}$$;`);
const comoAdmin = (c) =>
  c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
// Retrato dos dados numa reaplicação: nenhum pedido, reembolso ou lançamento é reescrito.
async function retrato(c) {
  return (
    await c.query(`SELECT md5(concat_ws('|',
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.marketplace_orders x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.order_refunds x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucoes x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucao_itens x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.fin_lancamentos x))) AS h`)
  ).rows[0].h;
}
// O extrato inteiro, ordenado: a comparacao "nada mais muda" entre o corpo novo e o anterior.
async function extrato(c) {
  return (
    await c.query(
      `SELECT to_jsonb(m) AS l FROM public.fin__movimentos(NULL, NULL) m
        WHERE m.pedido_id IS NULL OR m.pedido_id NOT IN (
          -- os pedidos onde a regra age: reembolso por fora e linha 'sistema' concluida no mesmo pedido
          SELECT d.order_id FROM public.devolucoes d JOIN public.order_refunds r ON r.order_id = d.order_id
           WHERE d.reembolso_manual AND r.solicitado_por = 'sistema' AND r.status = 'concluido')
        ORDER BY m.id`,
    )
  ).rows.map((r) => r.l);
}
/** O que o extrato mostra de saida realizada do pedido: soma, as linhas por origem, e as que sairam com valor <= 0. */
async function saidas(c, pedidoId) {
  const rs = (
    await c.query(
      `SELECT origem, valor::numeric AS valor FROM public.fin__movimentos(NULL, NULL)
        WHERE pedido_id = $1 AND tipo = 'saida' AND status = 'realizado' ORDER BY origem, valor`,
      [pedidoId],
    )
  ).rows;
  return {
    soma: rs.reduce((s, r) => s + cent(r.valor), 0),
    linhas: rs.map((r) => `${r.origem}:${cent(r.valor)}`),
    zeradas: rs.filter((r) => Number(r.valor) <= 0).length,
  };
}

// ---------------------------------------------------------------- fixture (a do ranking, tests/banco/o-lucro-do-ranking-casa-com-o-financeiro-viva.cjs)
const analytics = async (c) =>
  (await c.query("SELECT public.get_admin_analytics_v2(30) AS r")).rows[0].r;
const lucroBrutoFin = async (c) =>
  Number(
    (
      await c.query(
        "SELECT (public.fin_dre(current_date - 10, current_date + 1) ->> 'lucro_bruto')::numeric AS v",
      )
    ).rows[0].v,
  );

async function produto(c, nome, preco, custo) {
  const id = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
     VALUES ($1, $2, $3, $4, 1000, true, false)`,
    [id, nome, preco, custo],
  );
  return id;
}
async function pedido(c, itens) {
  const subtotal = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, discount, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ('Cliente 1664', '{}'::jsonb, $1, $1, 0, 'delivered', 'online', 'online', 'pago',
             now() - interval '3 days', now() - interval '3 days')
     RETURNING id`,
    [subtotal],
  );
  const ids = [];
  for (const i of itens) {
    ids.push(
      (
        await c.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
           VALUES ($1, $2, 'item 1664', $3, $4) RETURNING id`,
          [r.rows[0].id, i.produto, i.qtd, i.preco],
        )
      ).rows[0].id,
    );
  }
  return {
    id: r.rows[0].id,
    itens: ids,
    unitario: itens.map((i) => i.preco),
    estornado: 0,
    total: subtotal,
  };
}
// Linha do ledger. `por` = quem pediu ('sistema' = o aviso do MP do que a lojista fez no painel do MP); `minutos` = quando nasceu
// em relacao a agora (a conclusao das devolucoes da fixture e' agora); `contestacao` = linha de chargeback (mp_chargeback_id).
async function estorno(
  c,
  ped,
  amount,
  {
    por = "lojista",
    minutos = 0,
    status = "concluido",
    contestacao = false,
  } = {},
) {
  if (status === "concluido") ped.estornado += amount;
  return (
    await c.query(
      `INSERT INTO public.order_refunds
         (order_id, amount, motivo, solicitado_por, status, concluido_em, created_at, mp_chargeback_id)
       VALUES ($1, $2, 'fixture 1664', $4, $3, CASE WHEN $3 = 'concluido' THEN now() END,
               now() + ($5::text || ' minutes')::interval, $6)
       RETURNING id`,
      [
        ped.id,
        amount,
        status,
        por,
        minutos,
        contestacao ? `CBK-1664-${crypto.randomUUID().slice(0, 8)}` : null,
      ],
    )
  ).rows[0].id;
}
// UMA devolucao concluida com reembolso, de UM item, peca avariada (nao volta a prateleira). `via`: 'mp' (linha do ledger ligada em
// refund_id, concluida) ou 'manual' ("resolvido por fora": refund_id solto, reembolso_manual). `linhaDoMp` (so no 'manual') = o aviso
// do MP do MESMO dinheiro, gravado 5 minutos depois da conclusao.
let sequencia = 0;
async function devolucao(
  c,
  ped,
  { item = 0, reembolso, via = "manual", linhaDoMp = false },
) {
  const dev = crypto.randomUUID();
  let refundId = null;
  if (via === "mp") refundId = await estorno(c, ped, reembolso);
  if (via === "manual" && linhaDoMp)
    await estorno(c, ped, reembolso, { por: "sistema", minutos: 5 });
  const unit = ped.unitario[item];
  await c.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_frete_ida, valor_reembolso, refund_id, reembolso_manual,
       prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'reembolso', 'reembolso', 'local', 'entrega_na_loja', 'concluida',
       $5::numeric, 0, $6, $7, $8, current_date + 7, '{}'::jsonb, now())`,
    [
      dev,
      `P1664-${++sequencia}-${crypto.randomUUID().slice(0, 8)}`,
      ped.id,
      CLIENTE,
      unit,
      reembolso,
      refundId,
      via === "manual",
    ],
  );
  await c.query(
    `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, condicao, reestocar, reestocado_em)
     VALUES ($1, $2, (SELECT product_id FROM public.marketplace_order_items WHERE id = $2), 1, $3, 'danificada', false, NULL)`,
    [dev, ped.itens[item], unit],
  );
  return dev;
}

const VESTIDO = { preco: 100, custo: 40 };
const BLUSA = { preco: 50, custo: 20 };

/**
 * Monta o cenario e devolve o que o Financeiro e o ranking dizem DESTE pedido. `jaEstornei` = a lojista marca o pedido como
 * estornado por fora do app depois (o "Ja estornei": payment_status 'estornado' com o carimbo), como registrar_estorno_manual faz.
 */
async function rodar(c, { itens = ["v"], montar, jaEstornei = false }) {
  const finAntes = await lucroBrutoFin(c);
  const v = await produto(c, "Vestido 1664", VESTIDO.preco, VESTIDO.custo);
  const b = await produto(c, "Blusa 1664", BLUSA.preco, BLUSA.custo);
  const lista = [];
  if (itens.includes("v"))
    lista.push({ produto: v, qtd: 1, preco: VESTIDO.preco });
  if (itens.includes("b"))
    lista.push({ produto: b, qtd: 1, preco: BLUSA.preco });
  const ped = await pedido(c, lista);
  await montar(c, ped);
  await c.query(
    `UPDATE public.marketplace_orders
        SET valor_estornado = $2::numeric,
            payment_status = CASE WHEN $3 OR ($2::numeric > 0 AND $2::numeric >= total) THEN 'estornado' ELSE payment_status END,
            estorno_manual_registrado_em = CASE WHEN $3 THEN now() ELSE estorno_manual_registrado_em END
      WHERE id = $1`,
    [ped.id, ped.estornado, jaEstornei],
  );
  const r = await analytics(c);
  const ranking = r.topProducts
    .filter((p) => p.id === v || p.id === b)
    .reduce((s, p) => s + cent(p.total), 0);
  return {
    ranking,
    financeiro: cent((await lucroBrutoFin(c)) - finAntes),
    saidas: await saidas(c, ped.id),
  };
}

// O extrato (centavos) sem vínculo preserva todas as saídas, assim como o corpo anterior.
const CENARIOS = [
  {
    nome: "(D1) por fora R$ 30 e MP R$ 30: sem confirmação, duas saídas",
    montar: (c, ped) =>
      devolucao(c, ped, { reembolso: 30, via: "manual", linhaDoMp: true }),
    novo: 6000,
    antes: 6000,
    lucro: 0,
  },
  {
    nome: "(D2) dois reembolsos diferentes: devolucao de R$ 30 pelo app + R$ 70 pelo painel do MP: os dois saem",
    montar: async (c, ped) => {
      await devolucao(c, ped, { reembolso: 30, via: "mp" });
      await estorno(c, ped, 70, { por: "sistema", minutos: 5 });
    },
    novo: 10000,
    antes: 10000,
    lucro: -4000,
  },
  {
    nome: "(D3) R$ 70 pelo painel do MP ANTES da conclusao + R$ 30 resolvido por fora: os dois saem",
    montar: async (c, ped) => {
      await estorno(c, ped, 70, { por: "sistema", minutos: -60 });
      await devolucao(c, ped, { reembolso: 30, via: "manual" });
    },
    novo: 10000,
    antes: 10000,
    lucro: -4000,
  },
  {
    nome: "(D4) so o reembolso por fora de R$ 30 (sem aviso do MP): sai R$ 30, como antes",
    montar: (c, ped) => devolucao(c, ped, { reembolso: 30, via: "manual" }),
    novo: 3000,
    antes: 3000,
    lucro: 3000,
  },
  {
    nome: "(D5) so o MP: R$ 30 devolvidos pelo painel do MP, sem devolucao: sai R$ 30, como antes",
    montar: (c, ped) => estorno(c, ped, 30, { por: "sistema", minutos: 5 }),
    novo: 3000,
    antes: 3000,
    lucro: 3000,
  },
  {
    nome: "(D6) por fora R$ 30 + o MP confirma os R$ 30 + 'Ja estornei' o resto: sai o pedido inteiro (R$ 100), nem mais nem menos",
    montar: (c, ped) =>
      devolucao(c, ped, { reembolso: 30, via: "manual", linhaDoMp: true }),
    jaEstornei: true,
    novo: 10000,
    antes: 10000,
    lucro: -4000,
  },
  {
    nome: "(D7) por fora R$ 30 + duas linhas do MP de R$ 20: nenhuma é abatida automaticamente",
    montar: async (c, ped) => {
      await devolucao(c, ped, { reembolso: 30, via: "manual" });
      await estorno(c, ped, 20, { por: "sistema", minutos: 5 });
      await estorno(c, ped, 20, { por: "sistema", minutos: 6 });
    },
    novo: 7000,
    antes: 7000,
    lucro: -1000,
  },
  {
    nome: "(D8) por fora R$ 30 + uma CONTESTACAO de R$ 30 (chargeback) depois: a contestacao nao e' o reembolso, as duas saem",
    montar: async (c, ped) => {
      await devolucao(c, ped, { reembolso: 30, via: "manual" });
      await estorno(c, ped, 30, {
        por: "sistema",
        minutos: 5,
        contestacao: true,
      });
    },
    novo: 6000,
    antes: 6000,
    lucro: 0,
  },
  {
    nome: "(D9) duas devoluções manuais (R$ 20 + R$ 10) e linha do MP de R$ 30 sem vínculo: saem R$ 60",
    itens: ["v", "b"],
    montar: async (c, ped) => {
      await devolucao(c, ped, { item: 0, reembolso: 20, via: "manual" });
      await devolucao(c, ped, { item: 1, reembolso: 10, via: "manual" });
      await estorno(c, ped, 30, { por: "sistema", minutos: 5 });
    },
    novo: 6000,
    antes: 6000,
    lucro: 3000,
  },
  {
    nome: "(D10) mesmo dinheiro confirmado: R$ 30 saem uma vez",
    montar: async (c, ped) => {
      const d = await devolucao(c, ped, { reembolso: 30 });
      const r = await estorno(c, ped, 30, { por: "sistema", minutos: 5 });
      await mesmo(c, d, r);
    },
    novo: 3000,
    lucro: 3000,
  },
  {
    nome: "(D11) mesmo dinheiro com valores distintos: a diferença não some",
    montar: async (c, ped) => {
      const d = await devolucao(c, ped, { reembolso: 20 });
      const r = await estorno(c, ped, 30, { por: "sistema", minutos: 5 });
      await mesmo(c, d, r);
    },
    novo: 3000,
    lucro: 3000,
  },
  {
    nome: "(D12) vínculo confirmado e estorno também registrado no pedido: não come o restante",
    montar: async (c, ped) => {
      const d = await devolucao(c, ped, { reembolso: 30 });
      const r = await estorno(c, ped, 30, { por: "sistema", minutos: 5 });
      await mesmo(c, d, r);
    },
    jaEstornei: true,
    novo: 10000,
    lucro: -4000,
  },
];

/** Roda todos os cenarios no corpo vivo e devolve a lista de desvios (vazia = verde). `qual` escolhe a coluna esperada. */
async function desvios(c, qual) {
  const erros = [];
  for (const cen of CENARIOS) {
    if (qual === "antes" && cen.antes === undefined) continue;
    const m = await isolado(c, () =>
      rodar(c, {
        itens: cen.itens,
        montar: cen.montar,
        jaEstornei: cen.jaEstornei,
      }),
    );
    const esperado = cen[qual];
    if (m.saidas.soma !== esperado)
      erros.push(
        `${cen.nome}: extrato ${m.saidas.soma} (${m.saidas.linhas.join(", ")}), esperado ${esperado}`,
      );
    if (m.saidas.zeradas > 0)
      erros.push(
        `${cen.nome}: ${m.saidas.zeradas} linha(s) de saida com valor <= 0 (${m.saidas.linhas.join(", ")})`,
      );
    if (
      qual === "novo" &&
      (m.ranking !== cen.lucro || m.financeiro !== cen.lucro)
    ) {
      erros.push(
        `${cen.nome}: ranking ${m.ranking}, Financeiro ${m.financeiro}, esperado ${cen.lucro}`,
      );
    }
  }
  return erros;
}

// ---------------------------------------------------------------- (R0) o caminho real, pelas RPCs de verdade
async function caminhoReal(c, pedidoExistente, valor = 100) {
  const ped =
    pedidoExistente ??
    (
      await c.query(
        `INSERT INTO public.marketplace_orders
         (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status,
          paid_at, created_at, valor_estornado)
       VALUES ($1, 'Cliente 1664', '{}'::jsonb, 300, 300, 'delivered', 'online', 'online', 'pago',
               now() - interval '3 days', now() - interval '3 days', 0)
       RETURNING id`,
        [CLIENTE],
      )
    ).rows[0].id;
  // O reembolso da devolucao pelo app falhou (a linha ligada fica 'falhou').
  const linhaDoApp = (
    await c.query(
      `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status, tentativas, ultimo_erro)
       VALUES ($1, $2, 'fixture 1664 R0', 'lojista', 'falhou', 1, 'recusado pelo MP') RETURNING id`,
      [ped, valor],
    )
  ).rows[0].id;
  const dev = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_frete_ida, valor_reembolso, refund_id, reembolso_manual,
       prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'reembolso', 'reembolso', 'local', 'entrega_na_loja', 'concluida',
       $6, 0, $6, $5, false, current_date + 7, '{}'::jsonb, now())`,
    [
      dev,
      `P1664-R0-${crypto.randomUUID().slice(0, 8)}`,
      ped,
      CLIENTE,
      linhaDoApp,
      valor,
    ],
  );
  // A lojista devolve os R$ 100 no painel do MP e marca "resolvido por fora do app" (a RPC de verdade, como admin logada).
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [ADMIN, JWT_ADMIN],
  );
  await c.query("SET LOCAL ROLE authenticated");
  let porFora;
  try {
    porFora = (
      await c.query(
        "SELECT public.admin_devolucao_reembolso_por_fora($1, $2) AS r",
        [dev, linhaDoApp],
      )
    ).rows[0].r;
  } finally {
    await c.query("RESET ROLE");
  }
  assert.equal(porFora.resultado, "combinado", JSON.stringify(porFora));
  // now() é fixo na transação do teste; a ação por fora precede a linha do MP.
  await c.query(
    "UPDATE public.devolucao_eventos SET created_at = now() - interval '1 minute' WHERE devolucao_id = $1",
    [dev],
  );
  const codigoMp = `MP-A-1664-${crypto.randomUUID().slice(0, 8)}`;
  // O aviso do MP chega (a RPC de verdade, que o webhook chama com a service_role): ela grava a linha 'sistema' do MESMO dinheiro.
  const aviso = (
    await c.query(
      "SELECT public.registrar_estorno_externo_do_mp($1, $2, $3, 'approved', 'partially_refunded') AS r",
      [ped, codigoMp, valor],
    )
  ).rows[0].r;
  assert.equal(aviso.resultado, "inserido", JSON.stringify(aviso));
  await comoAdmin(c);
  const saldo = Number(
    (await c.query("SELECT public.pedido__saldo_a_estornar($1) AS s", [ped]))
      .rows[0].s,
  );
  const refund = (
    await c.query(
      "SELECT id FROM public.order_refunds WHERE order_id = $1 AND mp_refund_id = $2",
      [ped, codigoMp],
    )
  ).rows[0].id;
  return { ped, dev, refund, saldo };
}

// As decisões não deslocam dinheiro no MP: só conciliam a leitura do pedido e do extrato.
async function comoPapel(c, papel, pessoa, acao) {
  const claims = {
    role: papel,
    ...(pessoa ? { sub: pessoa } : {}),
    app_metadata: pessoa === ADMIN ? { role: "admin" } : {},
  };
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [pessoa ?? "", JSON.stringify(claims)],
  );
  await c.query(
    papel === "anon" ? "SET LOCAL ROLE anon" : "SET LOCAL ROLE authenticated",
  );
  // Se a ação for recusada, o ROLLBACK TO SAVEPOINT também restaura o papel.
  const r = await acao();
  await c.query("RESET ROLE");
  return r;
}

const lerSaldo = async (c, ped) =>
  (await c.query("SELECT public.pedido_reembolsos_e_saldo($1) AS r", [ped]))
    .rows[0].r;
const mesmo = (c, dev, refund) =>
  comoPapel(c, "authenticated", ADMIN, () =>
    c.query("SELECT public.admin_devolucao_confirmar_mesmo_dinheiro($1, $2)", [
      dev,
      refund,
    ]),
  );
const dois = (c, ped, refund) =>
  comoPapel(c, "authenticated", ADMIN, () =>
    c.query("SELECT public.admin_devolucao_confirmar_dois_reembolsos($1, $2)", [
      ped,
      refund,
    ]),
  );

async function estadoDoPedido(c, ped, saiu, avisos) {
  const saldo = await lerSaldo(c, ped);
  assert.equal(Number(saldo.disponivel), 300 - saiu);
  assert.equal(
    Number(
      (await c.query("SELECT public.pedido__saldo_a_estornar($1) AS v", [ped]))
        .rows[0].v,
    ),
    300 - saiu,
  );
  assert.equal((await saidas(c, ped)).soma, saiu * 100);
  assert.deepEqual(
    saldo.possivel_dobro.map(({ caminho }) => caminho).sort(),
    avisos,
  );
  return saldo.possivel_dobro;
}

async function pendentePorFora(c, ped, { antiga = false, antes = false } = {}) {
  const refund = (
    await c.query(
      `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status, created_at)
       VALUES ($1, 100, 'fixture 1664 B', 'lojista', 'em_processamento', now() - interval '8 days')
       RETURNING id`,
      [ped],
    )
  ).rows[0].id;
  const dev = (
    await c.query(
      `INSERT INTO public.devolucoes (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
          modalidade, metodo_retorno, status, valor_itens, valor_frete_ida, valor_reembolso, refund_id, reembolso_manual,
          prazo_ate, politica, concluida_em)
       VALUES ($1, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'reembolso', 'local', 'entrega_na_loja', 'concluida',
          100, 0, 100, $4, false, current_date + 7, '{}'::jsonb, now() - interval '2 days') RETURNING id`,
      [`P1664-B-${crypto.randomUUID().slice(0, 8)}`, ped, CLIENTE, refund],
    )
  ).rows[0].id;
  const r = await comoPapel(c, "authenticated", ADMIN, () =>
    c.query(
      "SELECT public.admin_devolucao_reembolso_por_fora_apos_espera($1, $2, 'DEVOLVI POR FORA') AS r",
      [dev, refund],
    ),
  );
  assert.equal(r.rows[0].r.resultado, "combinado");
  const prova = (
    await c.query(
      "SELECT devolucao_id FROM public.order_refund_prova WHERE refund_id = $1",
      [refund],
    )
  ).rows[0];
  assert.equal(
    prova.devolucao_id,
    dev,
    "a ação real preserva a ligação da devolução",
  );
  // now() é fixo dentro da transação de teste. Reproduz a ordem das duas transações reais.
  await c.query(
    `UPDATE public.order_refund_prova SET por_fora_liberado_em = now() - interval '1 hour',
      substituida_por_manual_em = now() - interval '1 hour', devolucao_id = CASE WHEN $2 THEN NULL ELSE devolucao_id END
      WHERE refund_id = $1`,
    [refund, antiga],
  );
  await c.query("SELECT public.concluir_estorno($1, $2, 'approved', NULL)", [
    refund,
    `MP-B-1664-${crypto.randomUUID().slice(0, 8)}`,
  ]);
  if (antes) {
    await c.query(
      "UPDATE public.order_refunds SET concluido_em = now() - interval '2 hours' WHERE id = $1",
      [refund],
    );
  }
  return { dev, refund };
}

async function pedidoDaConferencia(c) {
  return (
    await c.query(
      `INSERT INTO public.marketplace_orders (user_id, customer_name, customer_data, total, subtotal, status,
            canal, payment_method, payment_status, paid_at, created_at)
       VALUES ($1, 'Ficticio 1664 B', '{}'::jsonb, 300, 300, 'delivered', 'online', 'online', 'pago',
            now() - interval '3 days', now() - interval '3 days') RETURNING id`,
      [CLIENTE],
    )
  ).rows[0].id;
}

async function provasDaConferencia(c) {
  await isolado(c, async () => {
    const { ped, dev, refund } = await caminhoReal(c);
    const [aviso] = await estadoDoPedido(c, ped, 200, ["A"]);
    assert.equal(aviso.refund_id, refund);
    assert.deepEqual(
      aviso.candidatos.map(({ id }) => id),
      [dev],
    );
    await mesmo(c, dev, refund);
    await estadoDoPedido(c, ped, 100, []);
    await recusa(c, rollback, /CONFERENCIA_DE_REEMBOLSO_NAO_SE_APAGA/);
  });
  await isolado(c, async () => {
    const ped = await pedidoDaConferencia(c);
    const b = await pendentePorFora(c, ped);
    const a = await caminhoReal(c, ped, 50);
    await estadoDoPedido(c, ped, 300, ["A", "B"]);
    await mesmo(c, b.dev, b.refund);
    await estadoDoPedido(c, ped, 200, ["A"]);
    await mesmo(c, a.dev, a.refund);
    await estadoDoPedido(c, ped, 150, []);
  });
  await isolado(c, async () => {
    const a = await caminhoReal(c);
    const b = await caminhoReal(c);
    await assert.rejects(() => isolado(c, () => mesmo(c, b.dev, a.refund)), {
      code: "22023",
    });
    for (const [papel, pessoa] of [
      ["authenticated", CLIENTE],
      ["anon", null],
    ]) {
      await assert.rejects(
        () =>
          isolado(c, () =>
            comoPapel(c, papel, pessoa, () =>
              c.query(
                "SELECT public.admin_devolucao_confirmar_mesmo_dinheiro($1, $2)",
                [a.dev, a.refund],
              ),
            ),
          ),
        { code: "42501" },
      );
    }
    await comoAdmin(c);
    await estadoDoPedido(c, a.ped, 200, ["A"]);
  });
  await isolado(c, async () => {
    const ped = await pedidoDaConferencia(c);
    const { dev, refund } = await pendentePorFora(c, ped);
    const [aviso] = await estadoDoPedido(c, ped, 200, ["B"]);
    assert.equal(aviso.refund_id, refund);
    assert.deepEqual(
      aviso.candidatos.map(({ id }) => id),
      [dev],
    );
    await mesmo(c, dev, refund);
    await mesmo(c, dev, refund);
    await estadoDoPedido(c, ped, 100, []);
  });
  await isolado(c, async () => {
    const ped = await pedidoDaConferencia(c);
    const { refund } = await pendentePorFora(c, ped);
    await dois(c, ped, refund);
    await dois(c, ped, refund);
    await estadoDoPedido(c, ped, 200, []);
  });
  await isolado(c, async () => {
    const ped = await pedidoDaConferencia(c);
    await pendentePorFora(c, ped, { antes: true });
    await estadoDoPedido(c, ped, 200, []);
  });
  await isolado(c, async () => {
    const ped = await pedidoDaConferencia(c);
    const { refund } = await pendentePorFora(c, ped, { antiga: true });
    const [aviso] = await estadoDoPedido(c, ped, 200, ["B"]);
    assert.deepEqual(
      aviso.candidatos,
      [],
      "histórico sem vínculo só aparece no pedido",
    );
    await dois(c, ped, refund);
    await estadoDoPedido(c, ped, 200, []);
  });
}

// ---------------------------------------------------------------- prova
async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o da 20261391200000. ----
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o da 20261664000000",
    );
    assert.equal(md5(CORPO_NOVO), HASH_NOVO, "o corpo novo nao e o pinado");
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o anterior nao e o da 20261391200000",
    );
    console.log(
      "  PASSOU o topo instalado e o corpo desta migration (md5 conhecido)",
    );

    for (const [id, papel, meta] of [
      [ADMIN, "admin", { role: "admin" }],
      [CLIENTE, "customer", {}],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@porfora1664.invalid', $2::jsonb) ON CONFLICT (id) DO NOTHING`,
        [id, JSON.stringify(meta)],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 1664', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );
    }
    await comoAdmin(c);

    // ---- (N) Com o que ja existia no clone, o extrato fora dos pedidos da regra e' identico nos dois corpos. ----
    const extratoNovo = await extrato(c);
    const extratoAnterior = await isolado(c, async () => {
      await c.query(rollback);
      return extrato(c);
    });
    assert.deepEqual(
      extratoNovo,
      extratoAnterior,
      "o extrato mudou fora dos pedidos de reembolso por fora + linha do MP",
    );
    console.log(
      `  PASSOU (N) ${extratoNovo.length} linhas do extrato que ja existiam iguais nos dois corpos`,
    );

    await provasDaConferencia(c);
    console.log(
      "  PASSOU as conferências A e B, os dois valores e os pedidos/papéis recusados",
    );

    // As vendas que já existiam não entram no oráculo de lucro por pedido (só neste clone/transação).
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query("UPDATE public.marketplace_orders SET status = 'cancelled'");
    await c.query("SET LOCAL session_replication_role = origin");
    const verde = await desvios(c, "novo");
    assert.deepEqual(verde, [], verde.join("\n"));
    const controle = await isolado(c, async () => {
      await c.query(rollback);
      return desvios(c, "antes");
    });
    assert.deepEqual(controle, [], controle.join("\n"));
    console.log(
      "  PASSOU extrato e ranking (padrão, vínculo, diferença e resto) e controle anterior",
    );

    const mutantes = [
      [
        "abatimento sem uma confirmação",
        "(D1)",
        (s) =>
          s.replace(
            "d.id = r.cobre_devolucao_id AND d.order_id = r.order_id",
            "d.order_id = r.order_id",
          ),
      ],
      [
        "o estorno confirmado sai cheio",
        "(D10)",
        (s) =>
          s.replace(
            "(r.amount - COALESCE(jc.valor, 0))::numeric,",
            "r.amount::numeric,",
          ),
      ],
      [
        "o estorno externo perde o restante",
        "(D12)",
        (s) =>
          s.replace(
            " - COALESCE((SELECT sum(jc.valor) FROM ja_coberto jc WHERE jc.order_id = v.id), 0)",
            "",
          ),
      ],
      [
        "a linha zerada permanece no extrato",
        "(D10)",
        (s) => s.replace("\n       AND r.amount > COALESCE(jc.valor, 0)", ""),
      ],
    ];
    for (const [nome, cenarioAlvo, mutar] of mutantes) {
      const corpo = mutar(CORPO_NOVO);
      assert.notEqual(
        corpo,
        CORPO_NOVO,
        `o mutante "${nome}" não mudou o código`,
      );
      const erros = await isolado(c, async () => {
        await trocarCorpo(c, corpo);
        return desvios(c, "novo");
      });
      assert.ok(
        erros.some((e) => e.startsWith(cenarioAlvo)),
        `o mutante "${nome}" devia reprovar ${cenarioAlvo}: ${erros.join(" | ")}`,
      );
    }

    // ---- (A) Reaplicar 2x e CRLF, rollback byte a byte, segundo rollback recusa, o da 1391200 recusa com esta no ar. ----
    await isolado(c, async () => {
      const dadosAntes = await retrato(c);
      await c.query(migration);
      await c.query(migration);
      await c.query(emCRLF(migration));
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar 2x (e em CRLF) mudou OID, dono, ACL, atributos ou texto",
      );
      await recusa(c, rollbackAnterior, /B1_BASELINE_DIVERGENT/);
      await c.query(rollback);
      const volta = await funcao(c);
      assert.equal(
        volta.prosrc,
        CORPO_ANTES,
        "o rollback nao devolveu o corpo da 20261391200000 byte a byte",
      );
      assert.deepEqual(
        { ...volta, prosrc: null },
        { ...topo, prosrc: null },
        "o rollback mexeu em atributo, dono ou ACL",
      );
      await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
      assert.equal(
        await retrato(c),
        dadosAntes,
        "aplicar ou desfazer escreveu em dado",
      );
    });
    console.log(
      "  PASSOU reaplicar 2x e CRLF, rollback byte a byte, segundo rollback recusa, rollback da 1391200 recusa, dado intacto",
    );

    // ---- Pre-voo recusa sem escrever. ----
    const sabotagens = [
      [
        "corpo desconhecido",
        () => trocarCorpo(c, CORPO_NOVO.replace("'Pedido #'", "'Pedido nº'")),
      ],
      [
        "ACL aberta para authenticated",
        () =>
          c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated`),
      ],
      [
        "SECURITY DEFINER",
        () => c.query(`ALTER FUNCTION ${ASSINATURA} SECURITY DEFINER`),
      ],
      ["VOLATILE", () => c.query(`ALTER FUNCTION ${ASSINATURA} VOLATILE`)],
      [
        "sobrecarga",
        () =>
          c.query(
            "CREATE FUNCTION public.fin__movimentos(p_inicio date) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
          ),
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await sabotar();
        const antes = await funcao(c);
        await recusa(c, migration, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await funcao(c),
          antes,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
      });
    }
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens)`,
    );

    // ---- Consultas 220a/220b nos dois sentidos (rol fechado), 100a aceita a sucessora, 1b e db-apply no corpo vivo. ----
    const consulta = async (nome) => {
      const rows = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows.filter((r) => r.ok !== true).map((r) => r.item);
    };
    const MD5 = "fin__movimentos: corpo exato (md5)";
    assert.deepEqual(await consulta(C220A), []);
    assert.ok((await consulta(C220B)).includes(MD5));
    assert.deepEqual(await consulta(C100A), [], "a 100a reprova a sucessora");
    assert.deepEqual(await consulta(C100B), [MD5]);
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C220B), []);
      assert.ok((await consulta(C220A)).includes(MD5));
      assert.deepEqual(await consulta(C100A), []);
      // Corpo estranho: nem a 220a, nem a 220b, nem a 100a o aceitam.
      await trocarCorpo(c, CORPO_NOVO.replace("'Pedido #'", "'Pedido nº'"));
      assert.ok((await consulta(C220A)).includes(MD5));
      assert.deepEqual(await consulta(C220B), [MD5]);
      assert.deepEqual(await consulta(C100A), [MD5]);
    });
    const marcadores1b = (
      await c.query(
        ler("scripts/publicacao/consultas/1b-conferir-marcadores.sql"),
      )
    ).rows.filter((r) => r.funcao === "fin__movimentos");
    assert.equal(marcadores1b.length, 2);
    assert.ok(
      marcadores1b.every((r) => r.ok === true),
      JSON.stringify(marcadores1b),
    );
    const {
      VERIFICACOES,
      avaliarChecagem,
    } = require("../../scripts/db-apply.cjs");
    for (const nome of [NOME, NOME_ANTERIOR]) {
      for (const checagem of [VERIFICACOES[nome]].flat()) {
        const rows = (
          await c.query(
            "SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace",
            [checagem.funcao],
          )
        ).rows;
        assert.equal(rows.length, 1, checagem.funcao);
        assert.equal(
          avaliarChecagem(rows[0].d, checagem).situacao,
          "verificada",
          `db-apply ${nome}: ${checagem.funcao}`,
        );
      }
    }
    console.log(
      "  PASSOU consultas 220a/220b nos dois sentidos, 100a aceita a sucessora, 1b e db-apply (1664 e 1391200) no corpo vivo",
    );

    console.log(
      "\n[o-reembolso-por-fora-nao-conta-duas-vezes] todas as provas passaram.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices vem de listas fechadas deste arquivo
 * (itens do cenario, cenarios), nunca de entrada de rede. */
/**
 * PROVA VIVA da migration 20261664000000_o_reembolso_por_fora_nao_conta_duas_vezes.sql (public.fin__movimentos) contra o
 * Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci, job do dinheiro, CLONE proprio pelo rodar-isolado.cjs). Nunca
 * banco de loja.
 *
 * O DEFEITO: o reembolso de devolucao resolvido POR FORA do app (admin_devolucao_reembolso_por_fora) e a linha 'sistema' que o
 * aviso do Mercado Pago grava depois para o MESMO dinheiro (registrar_estorno_externo_do_mp) saiam as duas no Financeiro: venda de
 * R$ 100, custo R$ 40, R$ 30 devolvidos = lucro bruto R$ 0 em vez de R$ 30, e o Financeiro discordava do ranking de lucro.
 *
 * O que prova:
 *  (R0) o CAMINHO REAL: devolucao concluida com a linha do app 'falhou', a lojista marca "resolvido por fora" pela RPC de verdade e
 *       o aviso do MP chega pela RPC de verdade. Corpo novo: R$ 100 sai uma vez; corpo anterior (o rollback): R$ 200 (o controle).
 *  (D1..D9) cenarios pedido a pedido em que o oraculo e' o ranking de lucro (get_admin_analytics_v2, a mesma regra "ja devolvi por
 *       fora"): o lucro bruto que o Financeiro (fin_dre) atribui ao pedido e' IGUAL a soma do ranking. Cada um diz quanto sai no
 *       extrato com o corpo novo e com o anterior; o anterior fica vermelho EXATAMENTE nos cenarios do defeito (D1, D7, D9).
 *       Nenhuma linha do extrato sai com valor zero ou negativo.
 *  (N)  o resto do extrato (pedidos sem reembolso por fora seguido de linha do MP) e' identico no corpo novo e no anterior.
 *  (M)  mutantes (sem o "depois da conclusao", sem a contestacao fora, sem o resto na saida estornado fora do app, linha cheia,
 *       sem a ordem de chegada, linha zerada que fica) derrubam a prova no cenario certo.
 *  (A)  reaplicar 2x e em CRLF, pre-voo que recusa sem escrever, rollback byte a byte (corpo da 20261391200000) que repetido recusa,
 *       o rollback da 20261391200000 recusa com esta no ar, dado que ja existia intacto, consultas 220a/220b nos dois sentidos, a
 *       100a positiva com esta (sucessora), os marcadores da 1b e o db-apply verificado no corpo vivo.
 * Tambem MEDE (sem afirmar: fora do escopo desta migration) o saldo a estornar do caminho real, para o relatorio.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-reembolso-por-fora-nao-conta-duas-vezes-viva.cjs
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
const HASH_NOVO = "04fc43fd9e3e7f4b44cb9e4c2a866ae3";
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
// Retrato dos dados: nada disso pode mudar ao aplicar ou desfazer (a migration so troca o corpo de uma funcao de leitura).
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

// Cada cenario: o que sai no extrato (centavos) com o corpo NOVO e com o ANTERIOR. `defeito` = o anterior discorda do ranking.
const CENARIOS = [
  {
    nome: "(D1) resolvido por fora R$ 30 e o MP confirma os MESMOS R$ 30 depois: sai uma vez (lucro R$ 30, nao R$ 0)",
    montar: (c, ped) =>
      devolucao(c, ped, { reembolso: 30, via: "manual", linhaDoMp: true }),
    novo: 3000,
    antes: 6000,
    lucro: 3000,
    defeito: true,
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
    nome: "(D7) por fora R$ 30 + DUAS linhas do MP de R$ 20 depois: as linhas consomem os R$ 30 em ordem e sobram R$ 10",
    montar: async (c, ped) => {
      await devolucao(c, ped, { reembolso: 30, via: "manual" });
      await estorno(c, ped, 20, { por: "sistema", minutos: 5 });
      await estorno(c, ped, 20, { por: "sistema", minutos: 6 });
    },
    novo: 4000,
    antes: 7000,
    lucro: 2000,
    defeito: true,
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
    nome: "(D9) DUAS devolucoes por fora (R$ 20 do vestido + R$ 10 da blusa) + o MP confirma R$ 30 depois: sai R$ 30",
    itens: ["v", "b"],
    montar: async (c, ped) => {
      await devolucao(c, ped, { item: 0, reembolso: 20, via: "manual" });
      await devolucao(c, ped, { item: 1, reembolso: 10, via: "manual" });
      await estorno(c, ped, 30, { por: "sistema", minutos: 5 });
    },
    novo: 3000,
    antes: 6000,
    lucro: 6000,
    defeito: true,
  },
];

/** Roda todos os cenarios no corpo vivo e devolve a lista de desvios (vazia = verde). `qual` escolhe a coluna esperada. */
async function desvios(c, qual) {
  const erros = [];
  for (const cen of CENARIOS) {
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
    // O ranking nao depende do corpo do Financeiro: e' sempre a regra "ja devolvi por fora".
    if (m.ranking !== cen.lucro)
      erros.push(
        `${cen.nome}: o ranking soma ${m.ranking}, esperado ${cen.lucro}`,
      );
    const casa = m.financeiro === m.ranking;
    if (qual === "novo" && !casa)
      erros.push(
        `${cen.nome}: o Financeiro diz ${m.financeiro} e o ranking ${m.ranking}`,
      );
    if (qual === "antes" && casa === Boolean(cen.defeito))
      erros.push(
        `${cen.nome}: no corpo anterior o Financeiro (${m.financeiro}) ${casa ? "casa" : "nao casa"} com o ranking (${m.ranking})`,
      );
  }
  return erros;
}

// ---------------------------------------------------------------- (R0) o caminho real, pelas RPCs de verdade
async function caminhoReal(c) {
  const ped = (
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
       VALUES ($1, 100, 'fixture 1664 R0', 'lojista', 'falhou', 1, 'recusado pelo MP') RETURNING id`,
      [ped],
    )
  ).rows[0].id;
  const dev = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_frete_ida, valor_reembolso, refund_id, reembolso_manual,
       prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'reembolso', 'reembolso', 'local', 'entrega_na_loja', 'concluida',
       100, 0, 100, $5, false, current_date + 7, '{}'::jsonb, now())`,
    [
      dev,
      `P1664-R0-${crypto.randomUUID().slice(0, 8)}`,
      ped,
      CLIENTE,
      linhaDoApp,
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
  // O aviso do MP chega (a RPC de verdade, que o webhook chama com a service_role): ela grava a linha 'sistema' do MESMO dinheiro.
  const aviso = (
    await c.query(
      "SELECT public.registrar_estorno_externo_do_mp($1, 'MP-R0-1664', 100, 'approved', 'partially_refunded') AS r",
      [ped],
    )
  ).rows[0].r;
  assert.equal(aviso.resultado, "inserido", JSON.stringify(aviso));
  await comoAdmin(c);
  const saldo = Number(
    (await c.query("SELECT public.pedido__saldo_a_estornar($1) AS s", [ped]))
      .rows[0].s,
  );
  return { ped, saldo };
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

    // ---- (R0) o caminho real. ----
    const r0 = await isolado(c, async () => {
      const { ped, saldo } = await caminhoReal(c);
      const novo = await saidas(c, ped);
      const anterior = await isolado(c, async () => {
        await c.query(rollback);
        return saidas(c, ped);
      });
      return { novo, anterior, saldo };
    });
    assert.deepEqual(
      r0.novo.linhas,
      ["devolucao:10000"],
      `R0: o extrato devia mostrar so o reembolso por fora (${r0.novo.linhas.join(", ")})`,
    );
    assert.equal(
      r0.anterior.soma,
      20000,
      `CONTROLE R0: o corpo anterior devia contar R$ 200 (${r0.anterior.linhas.join(", ")})`,
    );
    console.log(
      `  PASSOU (R0) caminho real (falhou -> resolvido por fora -> aviso do MP): sai R$ 100 uma vez; o corpo anterior mostrava ${r0.anterior.linhas.join(" + ")}`,
    );
    console.log(
      `  MEDIDO (fora do escopo) pedido__saldo_a_estornar no R0: ${r0.saldo} (pedido de 300 com 100 devolvidos uma vez)`,
    );

    // ---- (D) Financeiro x ranking, pedido a pedido. Vendas que ja existiam saem da conta do ranking (so nesta transacao). ----
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query("UPDATE public.marketplace_orders SET status = 'cancelled'");
    await c.query("SET LOCAL session_replication_role = origin");
    const verde = await desvios(c, "novo");
    assert.deepEqual(verde, [], verde.join("\n"));
    console.log(
      `  PASSOU (D1..D9) ${CENARIOS.length} cenarios: o Financeiro casa com o ranking e o extrato sai certo, sem linha zerada`,
    );

    // CONTROLE: o corpo anterior (o rollback) fica vermelho exatamente nos cenarios do defeito.
    const controle = await isolado(c, async () => {
      await c.query(rollback);
      return desvios(c, "antes");
    });
    assert.deepEqual(controle, [], controle.join("\n"));
    console.log(
      `  PASSOU controle: o corpo anterior conta duas vezes em ${CENARIOS.filter(
        (x) => x.defeito,
      )
        .map((x) => x.nome.slice(0, 4))
        .join(", ")} e so neles`,
    );

    // ---- (M) Mutantes: cada um derruba a prova (no cenario que ele estraga). ----
    const mutantes = [
      [
        "sem o 'depois da conclusao' (a linha do MP de antes vira o mesmo dinheiro)",
        "(D3)",
        (s) => s.replace("\n       AND sp.created_at >= pf.desde", ""),
      ],
      [
        "sem tirar a contestacao",
        "(D8)",
        (s) => s.replace("\n       AND sp.mp_chargeback_id IS NULL", ""),
      ],
      [
        "a saida estornado fora do app desconta o reembolso por fora inteiro",
        "(D6)",
        (s) =>
          s.replace(
            "\n               - COALESCE((SELECT sum(jc.valor) FROM ja_coberto jc WHERE jc.order_id = v.id), 0) AS valor",
            " AS valor",
          ),
      ],
      [
        "a linha do MP sai cheia",
        "(D1)",
        (s) =>
          s.replace(
            "(r.amount - COALESCE(jc.valor, 0))::numeric,",
            "r.amount::numeric,",
          ),
      ],
      [
        "sem a ordem de chegada (cada linha consome o reembolso por fora inteiro)",
        "(D7)",
        (s) =>
          s.replace(
            "pf.valor - COALESCE(sum(sp.amount) OVER (\n             PARTITION BY sp.order_id ORDER BY sp.created_at, sp.id\n             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)",
            "pf.valor",
          ),
      ],
      [
        "a linha zerada fica no extrato",
        "(D1)",
        (s) => s.replace("\n       AND r.amount > COALESCE(jc.valor, 0)", ""),
      ],
    ];
    for (const [nome, cenarioAlvo, mutar] of mutantes) {
      const corpo = mutar(CORPO_NOVO);
      assert.notEqual(corpo, CORPO_NOVO, `o mutante "${nome}" nao mudou nada`);
      const erros = await isolado(c, async () => {
        await trocarCorpo(c, corpo);
        return desvios(c, "novo");
      });
      assert.ok(
        erros.some((e) => e.startsWith(cenarioAlvo)),
        `o mutante "${nome}" devia reprovar ${cenarioAlvo}; reprovou: ${erros.join(" | ") || "nada"}`,
      );
    }
    console.log(
      `  PASSOU ${mutantes.length} mutantes reprovam no cenario certo`,
    );

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
    assert.deepEqual(await consulta(C220B), [MD5]);
    assert.deepEqual(await consulta(C100A), [], "a 100a reprova a sucessora");
    assert.deepEqual(await consulta(C100B), [MD5]);
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C220B), []);
      assert.deepEqual(await consulta(C220A), [MD5]);
      assert.deepEqual(await consulta(C100A), []);
      // Corpo estranho: nem a 220a, nem a 220b, nem a 100a o aceitam.
      await trocarCorpo(c, CORPO_NOVO.replace("'Pedido #'", "'Pedido nº'"));
      assert.deepEqual(await consulta(C220A), [MD5]);
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
    const def = (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        ASSINATURA,
      ])
    ).rows[0].d;
    for (const nome of [NOME, NOME_ANTERIOR]) {
      const lista = [VERIFICACOES[nome]].flat();
      for (const checagem of lista)
        assert.equal(
          avaliarChecagem(def, checagem).situacao,
          "verificada",
          `db-apply ${nome}: ${checagem.funcao}`,
        );
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

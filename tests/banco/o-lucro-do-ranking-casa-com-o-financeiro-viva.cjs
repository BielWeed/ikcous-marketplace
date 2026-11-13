"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices vem de contadores e de listas fechadas
 * deste arquivo (itens do cenario, dias do grafico), nunca de entrada de rede. */
// Migration 20261399995000 (o lucro do ranking CASA COM O FINANCEIRO, pedido a pedido): somente Postgres descartavel do rpc-ci,
// nunca banco de loja. A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: get_admin_analytics_v2 (o cartao "Produtos que mais dao lucro", topProducts, e o lucro do grafico diario,
// revenueHistory[].profit) calcula, por item e por pedido,
//   lucro = q x (pago - custo) + custo x reestocadas - dinheiro devolvido a cliente
// (pago = preco menos o rateio do cupom; reestocadas = as pecas que voltaram a PRATELEIRA; dinheiro devolvido = o da devolucao,
// do estorno direto e do que o lojista devolveu pelo site do Mercado Pago, SEM o frete), e que pedido de pagamento 'estornado' ENTRA.
// O oraculo e o proprio Financeiro: em cada cenario a soma do lucro dos produtos do pedido e IGUAL a variacao de
// fin_dre(...).lucro_bruto causada por aquele pedido (menos o frete, que o ranking nao conta).
//
// Os 6 casos que o dono de produto decidiu: (M1) "Nao veio" reembolsada inteira = -40; (M2) reembolso de 30 com a peca de volta = +70;
// (M3) a mesma peca avariada = +30; (M4) estorno integral sem devolucao = -40; (M5) devolucao de 30 + 70 pelo site, todas as pecas
// de volta = 0 (nao +70); (M6) pedido sem devolucao = numero IGUAL ao do corpo anterior (JSON inteiro). Cada caso confere ranking E grafico.
//
// FIXTURE: cada cenario nasce e some dentro de um SAVEPOINT. Vestido R$100 (custo 40) + Blusa R$50 (custo 20), pedido de 3 dias
// atras; as vendas que ja existiam no clone saem da conta DENTRO da transacao (volta no fim).
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/o-lucro-do-ranking-casa-com-o-financeiro-viva.cjs

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261399995000_o_lucro_do_ranking_casa_com_o_financeiro_pedido_a_pedido.sql";
const NOME_3994 =
  "20261399994000_o_item_que_nao_veio_fica_com_a_cliente_no_ranking_de_lucro.sql";
const NOME_3997 = "20261399970000_o_ranking_de_lucro_desconta_a_devolucao.sql";
const NOME_251 =
  "20261251000000_o_lucro_do_estoque_usa_o_preco_da_variante.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.get_admin_analytics_v2\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_NOVO = corpoDe(migration);
const CORPO_3994 = corpoDe(ler(`supabase/migrations/${NOME_3994}`));
const CORPO_3997 = corpoDe(ler(`supabase/migrations/${NOME_3997}`));
const CORPO_251 = corpoDe(ler(`supabase/migrations/${NOME_251}`));
const HASH_NOVO = "4f8fb94f6cb0018e10d0ef71541f1cbf";
const HASH_3994 = "de8648a7783c12f1be7abd7986c8a2fc";
const HASH_3997 = "0ea0841208f326971e4f92241929e088";
const HASH_251 = "060c9ab5b1505dc375b41e4436e9d3a8";

const ADMIN = "5e399995-0000-4000-8000-000000000001";
const CLIENTE = "5e399995-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399995-0000-4000-8000-000000000003";
const FN = "public.get_admin_analytics_v2(integer)";
const cent = (v) => Math.round(Number(v) * 100);

// ---------------------------------------------------------------- infraestrutura
const funcao = async (c) => {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${FN}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
};
const instalar = (c, corpo) =>
  c.query(`CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
     RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
     AS $corpo$${corpo}$corpo$`);
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso3995");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3995");
    await c.query("RELEASE SAVEPOINT caso3995");
  }
}
// Retrato dos dados que ja existiam antes da migration: nada disso pode mudar ao aplicar ou desfazer.
async function retrato(c) {
  return (
    await c.query(`SELECT md5(concat_ws('|',
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.marketplace_orders x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.marketplace_order_items x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.item_id), '[]')::text FROM public.marketplace_order_item_custo x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.order_refunds x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucoes x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucao_itens x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.produtos x))) AS h`)
  ).rows[0].h;
}
const analytics = async (c) =>
  (await c.query("SELECT public.get_admin_analytics_v2(30) AS r")).rows[0].r;
// O Financeiro: o lucro bruto do periodo (receita liquida menos o custo das mercadorias) que cobre a venda (3 dias atras) e o dinheiro de hoje.
const lucroBrutoFin = async (c) =>
  Number(
    (
      await c.query(
        "SELECT (public.fin_dre(current_date - 10, current_date + 1) ->> 'lucro_bruto')::numeric AS v",
      )
    ).rows[0].v,
  );

// ---------------------------------------------------------------- fixture
async function pedido(
  c,
  {
    dias,
    itens,
    desconto = 0,
    frete = 0,
    pagamento = "pago",
    status = "delivered",
    estoqueDeVolta = false,
  },
) {
  const subtotal = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, discount, status, canal, payment_method,
        payment_status, paid_at, created_at, stock_returned_at)
     VALUES ('Cliente 3995', '{}'::jsonb, $1, $2, $3, $6, 'online', 'online', $4,
             now() - ($5 || ' days')::interval, now() - ($5 || ' days')::interval,
             CASE WHEN $7 THEN now() END)
     RETURNING id, to_char((created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS dia`,
    [
      subtotal - desconto + frete,
      subtotal,
      desconto,
      pagamento,
      String(dias),
      status,
      estoqueDeVolta,
    ],
  );
  const ids = [];
  for (const i of itens) {
    ids.push(
      (
        await c.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
           VALUES ($1, $2, 'item 3995', $3, $4) RETURNING id`,
          [r.rows[0].id, i.produto, i.qtd, i.preco],
        )
      ).rows[0].id,
    );
  }
  // valor_unitario da devolucao = o preco do item ja com o rateio do cupom (como solicitar_devolucao grava).
  const fator = subtotal > 0 ? (subtotal - desconto) / subtotal : 1;
  return {
    id: r.rows[0].id,
    dia: r.rows[0].dia,
    itens: ids,
    unitario: itens.map((i) => Math.round(i.preco * fator * 100) / 100),
    estornado: 0,
    total: subtotal - desconto + frete,
  };
}
async function produto(c, nome, preco, custo) {
  const id = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
     VALUES ($1, $2, $3, $4, 1000, true, false)`,
    [id, nome, preco, custo],
  );
  return id;
}
// Linha do ledger. A devolucao a que ela pertence aponta para ela (devolucoes.refund_id); sem isso, e estorno SEM devolucao.
// `por` = quem pediu ('sistema' = o webhook do MP registrando devolucao feita pelo painel do MP); `minutos` = quando nasceu
// em relacao a agora. O acumulado confirmado do pedido (valor_estornado) segue a soma das linhas 'concluido'.
async function estorno(
  c,
  ped,
  amount,
  status = "concluido",
  { por = "lojista", minutos = 0 } = {},
) {
  if (status === "concluido") ped.estornado += amount;
  return (
    await c.query(
      `INSERT INTO public.order_refunds
         (order_id, amount, motivo, solicitado_por, status, concluido_em, created_at)
       VALUES ($1, $2, 'fixture 3995', $4, $3, CASE WHEN $3 = 'concluido' THEN now() END,
               now() + ($5::text || ' minutes')::interval)
       RETURNING id`,
      [ped.id, amount, status, por, minutos],
    )
  ).rows[0].id;
}
// Uma linha de devolucao: item i do pedido, quantidade, condicao marcada ao concluir e se voltou a prateleira.
const L = (i, qtd, condicao = null, reestocada = false) => ({
  i,
  qtd,
  condicao,
  reestocada,
});
// UMA devolucao com varias linhas. final: reembolso | vale | troca; status: concluida | recebida; `reembolso` = valor_reembolso
// (null = devolucao de antes do valor existir, sem dinheiro no ledger); `frete` = valor_frete_ida; `via`: 'mp' (linha do ledger ligada
// em refund_id) ou 'manual' ("ja devolvi por fora": refund_id solto e a linha 'sistema' que o webhook grava depois);
// `unitario` troca o valor_unitario gravado nas linhas (devolucao antiga, a preco cheio).
async function devolucao(
  c,
  ped,
  {
    linhas,
    final = "reembolso",
    status = "concluida",
    reembolso = null,
    frete = 0,
    via = "mp",
    protocolo,
    unitario = null,
  },
) {
  const dev = crypto.randomUUID();
  const concluida = status === "concluida";
  const comDinheiro = final === "reembolso" && concluida && reembolso !== null;
  let refundId = null;
  if (comDinheiro && via === "mp") refundId = await estorno(c, ped, reembolso);
  if (comDinheiro && via === "manual")
    await estorno(c, ped, reembolso, "concluido", {
      por: "sistema",
      minutos: 5,
    });
  const unit = (l) => (unitario ? unitario[l.i] : ped.unitario[l.i]);
  const valorItens = linhas.reduce((s, l) => s + l.qtd * unit(l), 0);
  await c.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_frete_ida, valor_reembolso, refund_id, reembolso_manual,
       prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, $4, $5, 'desisti', $6, $7, 'local', 'entrega_na_loja', $8, $9::numeric, $10::numeric, $11, $12, $13,
       current_date + 7, '{}'::jsonb, CASE WHEN $14 THEN now() END)`,
    [
      dev,
      protocolo,
      ped.id,
      CLIENTE,
      final === "troca" ? "troca" : "arrependimento",
      final,
      final,
      status,
      valorItens,
      frete,
      reembolso,
      refundId,
      comDinheiro && via === "manual",
      concluida,
    ],
  );
  for (const l of linhas)
    await c.query(
      `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, condicao, reestocar, reestocado_em)
       VALUES ($1, $2, (SELECT product_id FROM public.marketplace_order_items WHERE id = $2), $3, $4, $5, $6,
               CASE WHEN $6 THEN now() END)`,
      [dev, ped.itens[l.i], l.qtd, unit(l), l.condicao, l.reestocada],
    );
  return dev;
}

const VESTIDO = { preco: 100, custo: 40 };
const BLUSA = { preco: 50, custo: 20 };
let sequencia = 0;
const protocolo = () =>
  `P3995-${++sequencia}-${crypto.randomUUID().slice(0, 8)}`;
// Atalho: `montar` recebe (c, ped) e chama devolucao(c, ped, {...}).
const com = (opts) => async (c, ped) => {
  await devolucao(c, ped, { protocolo: protocolo(), ...opts });
};
const cortesia = (valor) => async (c, ped) => {
  await estorno(c, ped, valor);
};
const seq =
  (...passos) =>
  async (c, ped) => {
    for (const passo of passos) await passo(c, ped);
  };

/**
 * Monta o cenario e devolve o que a tela mostra: por produto, a quantidade e o lucro do ranking, e o dia no grafico.
 * `itens` = quais produtos o pedido tem ("v" = vestido, o indice 0; "b" = blusa, o proximo). O valor_estornado do pedido e a soma do ledger
 * concluido e, como o Mercado Pago faz, o pagamento vira 'estornado' quando o devolvido chega ao total.
 */
async function rodar(
  c,
  {
    itens = ["v", "b"],
    qtd = {},
    desconto = 0,
    frete = 0,
    pagamento = "pago",
    status = "delivered",
    estoqueDeVolta = false,
    montar = async () => 0,
  },
) {
  const finAntes = await lucroBrutoFin(c);
  const v = await produto(c, "Vestido 3995", VESTIDO.preco, VESTIDO.custo);
  const b = await produto(c, "Blusa 3995", BLUSA.preco, BLUSA.custo);
  const lista = [];
  if (itens.includes("v"))
    lista.push({ produto: v, qtd: qtd.v ?? 1, preco: VESTIDO.preco });
  if (itens.includes("b"))
    lista.push({ produto: b, qtd: qtd.b ?? 1, preco: BLUSA.preco });
  const ped = await pedido(c, {
    dias: 3,
    desconto,
    frete,
    pagamento,
    status,
    estoqueDeVolta,
    itens: lista,
  });
  await montar(c, ped, v, b);
  await c.query(
    `UPDATE public.marketplace_orders
        SET valor_estornado = $2::numeric,
            payment_status = CASE WHEN $2::numeric > 0 AND $2::numeric >= total THEN 'estornado' ELSE payment_status END
      WHERE id = $1`,
    [ped.id, ped.estornado],
  );
  const r = await analytics(c);
  const top = new Map(
    r.topProducts.map((p) => [
      p.id,
      { quantity: p.quantity, total: cent(p.total), exato: Number(p.total) },
    ]),
  );
  const dia = r.revenueHistory.find((d) => d.date === ped.dia);
  const finDepois = await lucroBrutoFin(c);
  const soma = [...top.values()].reduce((s, x) => s + x.exato, 0);
  return {
    v: top.has(v)
      ? { quantity: top.get(v).quantity, total: top.get(v).total }
      : undefined,
    b: top.has(b)
      ? { quantity: top.get(b).quantity, total: top.get(b).total }
      : undefined,
    dia: dia
      ? {
          profit: Number(dia.profit),
          revenue: Number(dia.revenue),
          orders: dia.orders,
          cost_sold: Number(dia.cost_sold),
        }
      : null,
    soma,
    // O que o Financeiro diz que ESTE pedido deixou de lucro bruto, sem o frete (o ranking e sem frete).
    lucroDoFinanceiro: finDepois - finAntes - frete,
    json: r,
  };
}

// Cada cenario: nome, como montar, o que o corpo NOVO mostra e o que o corpo ANTERIOR (3994) mostrava, em [quantidade, lucro em centavos].
// `undefined` = o produto nao aparece no ranking (pedido fora da conta). Sem `antes`, os dois corpos mostram o mesmo.
// `fin: false` = o Financeiro conta este caso de outro jeito (vale e troca nao tem dinheiro; o frete de ida; teto do item) e nao e oraculo aqui.
// `exato: true` = o JSON INTEIRO sai igual nos dois corpos (pedido sem devolucao nem estorno).
const CENARIOS = [
  // ---- os 6 casos do dono de produto ----
  {
    nome: "(M1) 'Nao veio' reembolsada por inteiro: -R$ 40 (antes: o pedido 'estornado' nem aparecia)",
    opts: {
      itens: ["v"],
      montar: com({ linhas: [L(0, 1, "ausente")], reembolso: 100 }),
    },
    novo: { v: [1, -4000] },
    antes: { v: undefined },
  },
  {
    nome: "(M2) reembolso de R$ 30 e a peca volta a prateleira: +R$ 70 (antes: R$ 0, tirava a margem pela quantidade)",
    opts: {
      itens: ["v"],
      montar: com({ linhas: [L(0, 1, "nova", true)], reembolso: 30 }),
    },
    novo: { v: [0, 7000] },
    antes: { v: [0, 0] },
  },
  {
    nome: "(M3) o mesmo reembolso de R$ 30 com a peca avariada (nao volta): +R$ 30",
    opts: {
      itens: ["v"],
      montar: com({ linhas: [L(0, 1, "danificada")], reembolso: 30 }),
    },
    novo: { v: [0, 3000] },
    antes: { v: [0, -4000] },
  },
  {
    nome: "(M4) estorno integral sem devolucao: -R$ 40 (antes: o pedido 'estornado' nem aparecia)",
    opts: { itens: ["v"], montar: cortesia(100) },
    novo: { v: [1, -4000] },
    antes: { v: undefined },
  },
  {
    nome: "(M5) devolucao de R$ 30 + R$ 70 pelo site do Mercado Pago, a peca voltou: R$ 0 (nunca +R$ 70)",
    opts: {
      itens: ["v"],
      montar: seq(
        com({ linhas: [L(0, 1, "nova", true)], reembolso: 30 }),
        (c, ped) =>
          estorno(c, ped, 70, "concluido", { por: "sistema", minutos: 5 }),
      ),
    },
    novo: { v: [0, 0] },
    antes: { v: undefined },
  },
  {
    nome: "(M5b) o mesmo com frete de R$ 10 no pedido (nao fica 'estornado': a conta passa pelo rateio, nao pelo atalho do estornado): R$ 0",
    opts: {
      itens: ["v"],
      frete: 10,
      montar: seq(
        com({ linhas: [L(0, 1, "nova", true)], reembolso: 30 }),
        (c, ped) =>
          estorno(c, ped, 70, "concluido", { por: "sistema", minutos: 5 }),
      ),
    },
    novo: { v: [0, 0] },
  },
  {
    nome: "(M5c) o mesmo num pedido com a blusa: os R$ 70 se repartem pelo que cada peca ainda pagou (vestido 70 e blusa 50); o pedido todo fecha em R$ 30 como o Financeiro",
    opts: {
      montar: seq(
        com({ linhas: [L(0, 1, "nova", true)], reembolso: 30 }),
        (c, ped) =>
          estorno(c, ped, 70, "concluido", { por: "sistema", minutos: 5 }),
      ),
    },
    novo: { v: [0, 2917], b: [1, 83] },
    antes: { v: [0, 0], b: [1, -2000] },
  },
  {
    nome: "(M6a) pedido sem devolucao: numero IGUAL ao do corpo anterior",
    opts: {},
    novo: { v: [1, 6000], b: [1, 3000] },
    exato: true,
  },
  {
    nome: "(M6b) pedido sem devolucao com cupom de R$ 15: igual",
    opts: { desconto: 15 },
    novo: { v: [1, 5000], b: [1, 2500] },
    exato: true,
  },
  {
    nome: "(M6c) pedido sem devolucao com estorno direto de R$ 15 (cortesia): igual",
    opts: { montar: cortesia(15) },
    novo: { v: [1, 5000], b: [1, 2500] },
  },
  {
    nome: "(M6d) cupom de R$ 15 e cortesia de R$ 15: igual",
    opts: { desconto: 15, montar: cortesia(15) },
    novo: { v: [1, 4000], b: [1, 2000] },
  },
  {
    nome: "(M6e) pedido sem devolucao com 2 vestidos e 2 blusas: igual",
    opts: { qtd: { v: 2, b: 2 } },
    novo: { v: [2, 12000], b: [2, 6000] },
    exato: true,
  },
  // ---- o que o corpo anterior ja fazia e continua igual ----
  {
    nome: "blusa devolvida nova e reestocada, reembolso de R$ 50: sai do lucro e da quantidade",
    opts: { montar: com({ linhas: [L(1, 1, "nova", true)], reembolso: 50 }) },
    novo: { v: [1, 6000], b: [0, 0] },
  },
  {
    nome: "blusa 'danificada' e nao reestocada: o custo vira perda",
    opts: { montar: com({ linhas: [L(1, 1, "danificada")], reembolso: 50 }) },
    novo: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "devolucao concluida de ANTES da marcacao existir (condicao nula) e nao reestocada: continua perda",
    opts: { montar: com({ linhas: [L(1, 1, null)], reembolso: 50 }) },
    novo: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "cupom de R$ 15 + blusa 'nova' devolvida com o estorno de R$ 45 ligado",
    opts: {
      desconto: 15,
      montar: com({ linhas: [L(1, 1, "nova", true)], reembolso: 45 }),
    },
    novo: { v: [1, 5000], b: [0, 0] },
  },
  {
    nome: "vestido 'Nao veio' sem reembolso da peca (so a blusa que voltou foi reembolsada): o vestido fica com a cliente, +R$ 60",
    opts: {
      montar: com({
        linhas: [L(0, 1, "ausente"), L(1, 1, "nova", true)],
        reembolso: 50,
      }),
    },
    novo: { v: [1, 6000], b: [0, 0] },
  },
  {
    nome: "blusa 'Nao veio' e so o vestido que voltou reembolsado: a blusa fica com a cliente, +R$ 30",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 100,
      }),
    },
    novo: { v: [0, 0], b: [1, 3000] },
  },
  {
    nome: "blusa 'Nao veio' e reembolso cheio de R$ 150 (pedido 'estornado'): -R$ 20 (antes: o pedido nem aparecia)",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 150,
      }),
    },
    novo: { v: [0, 0], b: [1, -2000] },
    antes: { v: undefined, b: undefined },
  },
  {
    nome: "blusa 'Nao veio' com reembolso parcial dela (R$ 125 no total): a blusa mostra +R$ 5",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 125,
      }),
    },
    novo: { v: [0, 0], b: [1, 500] },
  },
  {
    nome: "reembolso de R$ 130 para um vestido de R$ 100 (valor escolhido pela lojista): os R$ 30 a mais saem da blusa",
    opts: {
      montar: com({ linhas: [L(0, 1, "nova", true)], reembolso: 130 }),
    },
    novo: { v: [0, 0], b: [1, 0] },
    antes: { v: [0, 0], b: [1, 3000] },
  },
  {
    nome: "frete de ida de R$ 10 dentro do reembolso: o frete nao e dinheiro de produto",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        reembolso: 110,
        frete: 10,
      }),
    },
    novo: { v: [0, 0], b: [1, 3000] },
    fin: false,
  },
  {
    nome: "vale-troca com o vestido de volta: conta como devolvido (credito), como sempre",
    opts: { montar: com({ linhas: [L(0, 1, "nova", true)], final: "vale" }) },
    novo: { v: [0, 0], b: [1, 3000] },
    fin: false,
  },
  {
    nome: "devolucao do tipo troca (sem dinheiro): igual ao corpo anterior",
    opts: { montar: com({ linhas: [L(1, 1, "nova", true)], final: "troca" }) },
    novo: { v: [1, 6000], b: [1, 3000] },
    fin: false,
  },
  {
    nome: "devolucao ainda 'recebida' (nao concluida): igual ao corpo anterior",
    opts: {
      montar: com({ linhas: [L(1, 1, "nova", true)], status: "recebida" }),
    },
    novo: { v: [1, 6000], b: [1, 3000] },
    fin: false,
  },
  {
    nome: "devolucao concluida de reembolso SEM valor gravado (dado antigo): vale o das pecas que voltaram, como era",
    opts: {
      montar: com({ linhas: [L(0, 1, "nova", true)], reembolso: null }),
    },
    novo: { v: [0, 0], b: [1, 3000] },
    fin: false,
  },
  {
    nome: "reembolso de R$ 30 com o vestido avariado + estorno direto de R$ 20: o pedido todo fecha em R$ 40 como o Financeiro",
    opts: {
      montar: seq(
        com({ linhas: [L(0, 1, "danificada")], reembolso: 30 }),
        cortesia(20),
      ),
    },
    novo: { v: [0, 1833], b: [1, 2167] },
    antes: { v: [0, -4000], b: [1, 1000] },
  },
  {
    nome: "vestido x2 em duas devolucoes: 1 de volta com R$ 100 e 1 avariada com R$ 40 (200 pagos - 140 devolvidos - 40 de custo perdido = R$ 20)",
    opts: {
      itens: ["v"],
      qtd: { v: 2 },
      montar: seq(
        com({ linhas: [L(0, 1, "nova", true)], reembolso: 100 }),
        com({ linhas: [L(0, 1, "danificada")], reembolso: 40 }),
      ),
    },
    novo: { v: [0, 2000] },
    antes: { v: [0, -4000] },
  },
  {
    nome: "estorno 'ja devolvi' por fora, sem linha no ledger (pagamento 'estornado', valor_estornado 0): -R$ 40",
    opts: { itens: ["v"], pagamento: "estornado" },
    novo: { v: [1, -4000] },
    antes: { v: undefined },
  },
  {
    nome: "cupom de R$ 10 e estorno integral (R$ 90): -R$ 40, o cupom nao e descontado duas vezes",
    opts: { itens: ["v"], desconto: 10, montar: cortesia(90) },
    novo: { v: [1, -4000] },
    antes: { v: undefined },
  },
  {
    nome: "devolucao com o vestido avariado e reembolso integral (pedido 'estornado'): -R$ 40",
    opts: {
      itens: ["v"],
      montar: com({ linhas: [L(0, 1, "danificada")], reembolso: 100 }),
    },
    novo: { v: [0, -4000] },
    antes: { v: undefined },
  },
  {
    nome: "pedido CANCELADO com o estoque de volta e o dinheiro devolvido: continua fora (o Financeiro tambem fecha em zero)",
    opts: {
      itens: ["v"],
      status: "cancelled",
      estoqueDeVolta: true,
      montar: cortesia(100),
    },
    novo: { v: undefined },
  },
  {
    nome: "devolucao antiga com o valor da peca a preco cheio e cupom: o dinheiro nunca passa do que o item pagou",
    opts: {
      desconto: 15,
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        reembolso: 100,
        unitario: [100, 50],
      }),
    },
    novo: { v: [0, 0], b: [1, 2500] },
    fin: false,
  },
];
const alvo = (par) =>
  par === undefined ? undefined : { quantity: par[0], total: par[1] };
const cenario = (inicio) => {
  const achados = CENARIOS.filter((x) => x.nome.startsWith(inicio));
  assert.equal(achados.length >= 1, true, `cenario "${inicio}" nao existe`);
  return achados[0];
};

/** O comportamento que a migration promete, sobre todos os cenarios. Lanca no primeiro desvio. */
async function conferir(c, qual = "novo") {
  for (const cen of CENARIOS) {
    await isolado(c, async () => {
      const m = await rodar(c, cen.opts);
      const esperado = qual === "novo" ? cen.novo : (cen.antes ?? cen.novo);
      assert.deepEqual(m.v, alvo(esperado.v), `${cen.nome}: vestido (${qual})`);
      assert.deepEqual(m.b, alvo(esperado.b), `${cen.nome}: blusa (${qual})`);
      // O grafico diario fecha com o ranking: dois cartoes da mesma tela nao podem discordar.
      assert.equal(
        Math.abs((m.dia?.profit ?? 0) - m.soma) < 1e-6,
        true,
        `${cen.nome}: o lucro do dia no grafico (${qual}) nao fecha com o ranking (${m.dia?.profit} x ${m.soma})`,
      );
      // O oraculo: o Financeiro, pedido a pedido (so no corpo novo).
      if (qual === "novo" && cen.fin !== false)
        assert.equal(
          Math.abs(m.lucroDoFinanceiro - m.soma) < 0.005,
          true,
          `${cen.nome}: o Financeiro diz ${m.lucroDoFinanceiro} para este pedido e o ranking soma ${m.soma}`,
        );
    });
  }
}
// O que NAO pode mudar: tudo menos topProducts e o lucro por dia. Compara o corpo novo com o da 3994 na MESMA fixture.
const semLucro = (j) => ({
  ...j,
  topProducts: undefined,
  revenueHistory: j.revenueHistory.map((d) => ({ ...d, profit: undefined })),
});
async function comparar(c) {
  for (const cen of CENARIOS) {
    const novo = await isolado(c, () => rodar(c, cen.opts));
    const antigo = await isolado(c, async () => {
      await instalar(c, CORPO_3994);
      return rodar(c, cen.opts);
    });
    // fora do lucro: faturamento, pedidos, custo vendido do dia, hoje, mes, estoque... byte a byte (ids e datas novos a cada rodada, mas o JSON nao os carrega)
    assert.deepEqual(
      semLucro(novo.json),
      semLucro(antigo.json),
      `${cen.nome}: algo alem do lucro mudou no JSON`,
    );
    if (cen.exato)
      assert.deepEqual(
        { ...novo.json, topProducts: undefined },
        { ...antigo.json, topProducts: undefined },
        `${cen.nome}: pedido sem devolucao nem estorno tem de sair IGUAL no JSON inteiro`,
      );
    if (cen.exato)
      assert.deepEqual(
        [novo.v, novo.b],
        [antigo.v, antigo.b],
        `${cen.nome}: igual ao corpo anterior`,
      );
  }
}

// ---------------------------------------------------------------- prova
async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    // O topo instalado pelo CI (todas as migrations do zero) e o desta migration.
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o corpo da 3995",
    );
    assert.equal(md5(CORPO_NOVO), HASH_NOVO, "o corpo novo nao e o pinado");
    assert.equal(
      md5(CORPO_3994),
      HASH_3994,
      "o corpo anterior nao e o da 3994",
    );
    assert.equal(md5(CORPO_3997), HASH_3997, "o corpo da 3997 mudou");
    assert.equal(md5(CORPO_251), HASH_251, "o corpo da 251 mudou");
    // Fora dos blocos 4 (grafico diario) e 5 (ranking) o corpo e o da 3994 byte a byte: cabeca, estoque, hoje, 5b, 6 e o JSON final.
    const [cabeca, ,] = CORPO_NOVO.split("    -- 4. Revenue");
    assert.equal(cabeca, CORPO_3994.split("    -- 4. Revenue")[0]);
    assert.equal(
      CORPO_NOVO.slice(CORPO_NOVO.indexOf("    -- 5b. Produtos vendidos")),
      CORPO_3994.slice(CORPO_3994.indexOf("    -- 5b. Produtos vendidos")),
    );

    for (const [id, papel, metaAdmin] of [
      [ADMIN, "admin", true],
      [CLIENTE, "customer", false],
      // Ex-admin: ainda admin no auth.users (JWT velho), mas ja customer em profiles.
      [EX_ADMIN, "customer", true],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@rank3995.invalid', $2::jsonb)`,
        [id, JSON.stringify(metaAdmin ? { role: "admin" } : {})],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 3995', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );
    }
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
    // Vendas que ja existiam no clone saem da conta (so nesta transacao): o top 5 e o dia medem so a fixture.
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query("UPDATE public.marketplace_orders SET status = 'cancelled'");
    await c.query("SET LOCAL session_replication_role = origin");
    const dadosAntes = await retrato(c);

    // CONTROLE: com o corpo ANTERIOR (o rollback desta migration) o defeito aparece nesta mesma fixture.
    // Sem isto o resto da prova poderia passar por acaso.
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(
      anterior.prosrc,
      CORPO_3994,
      "o rollback nao devolveu o corpo da 3994 byte a byte",
    );
    assert.equal(md5(anterior.prosrc), HASH_3994);
    assert.deepEqual(
      { ...anterior, prosrc: null },
      { ...topo, prosrc: null },
      "o rollback mudou OID, dono, ACL ou atributo",
    );
    // O corpo anterior mostrava exatamente o que o `antes` de cada cenario diz.
    await conferir(c, "antes");
    const controle = await isolado(c, () => rodar(c, cenario("(M2)").opts));
    assert.deepEqual(
      [controle.v.quantity, controle.v.total],
      [0, 0],
      "controle: o corpo anterior tirava a margem inteira pela quantidade mesmo com o reembolso de so R$ 30",
    );
    const semPedido = await isolado(c, () => rodar(c, cenario("(M1)").opts));
    assert.equal(
      semPedido.v,
      undefined,
      "controle: o corpo anterior deixava o pedido 'estornado' fora do ranking",
    );
    // E a conferencia do comportamento novo REPROVA no corpo anterior (o teste falha pelo motivo certo).
    await assert.rejects(
      () => conferir(c, "novo"),
      (e) => e.code === "ERR_ASSERTION" && /\(M1\)/.test(e.message),
    );
    console.log(
      "  PASSOU controle: o corpo anterior (3994) tira a margem inteira pela quantidade (M2: R$ 0 em vez de +70), deixa o pedido 'estornado' fora (M1, M4, M5) e perde o dinheiro devolvido depois da devolucao (M5c); a conferencia nova reprova nele",
    );

    // A migration, sobre a fixture que ja existia.
    await c.query(migration);
    assert.deepEqual(
      await funcao(c),
      topo,
      "apply nao reproduziu o topo instalado pelo CI",
    );
    assert.equal(
      await retrato(c),
      dadosAntes,
      "apply alterou dado que ja existia",
    );
    await conferir(c, "novo");
    console.log(
      `  PASSOU ${CENARIOS.length} cenarios, ranking E grafico diario, cada um contra o Financeiro (fin_dre): os 6 casos (Nao veio reembolsada -40, reembolso 30 com a peca de volta +70, avariada +30, estorno integral -40, 30 + 70 pelo site = 0, sem devolucao igual) e as bordas (cupom, cortesia, vale, troca, frete, valor antigo, dado sem valor, cancelado)`,
    );

    // 1. O que NAO mudou: o resto do JSON e igual ao do corpo anterior, em todos os cenarios; sem devolucao nem estorno, o JSON todo.
    await comparar(c);
    console.log(
      "  PASSOU em todos os cenarios o JSON fora de topProducts e do lucro por dia e igual ao da 3994 (faturamento, pedidos, custo vendido do dia, hoje, mes, estoque); sem devolucao nem estorno o JSON INTEIRO e a quantidade/lucro sao iguais",
    );

    // 1b. Base mista (varios pedidos no mesmo dia): a soma do grafico fecha com o ranking e o dia nao perde nem repete pedido.
    await isolado(c, async () => {
      const v = await produto(c, "Vestido 3995", 100, 40);
      const b = await produto(c, "Blusa 3995", 50, 20);
      const p1 = await pedido(c, {
        dias: 3,
        itens: [{ produto: v, qtd: 1, preco: 100 }],
      });
      const p2 = await pedido(c, {
        dias: 3,
        itens: [{ produto: v, qtd: 1, preco: 100 }],
      });
      const p3 = await pedido(c, {
        dias: 3,
        itens: [{ produto: b, qtd: 2, preco: 50 }],
      });
      await devolucao(c, p1, {
        linhas: [L(0, 1, "nova", true)],
        reembolso: 30,
        protocolo: protocolo(),
      });
      await estorno(c, p2, 100); // estorno integral sem devolucao
      await c.query(
        `UPDATE public.marketplace_orders SET valor_estornado = CASE id WHEN $1 THEN $3::numeric WHEN $2 THEN $4::numeric END,
           payment_status = CASE WHEN id = $2 THEN 'estornado' ELSE payment_status END
         WHERE id IN ($1, $2)`,
        [p1.id, p2.id, p1.estornado, p2.estornado],
      );
      const r = await analytics(c);
      const total = (id) =>
        r.topProducts.find((x) => x.id === id) &&
        cent(r.topProducts.find((x) => x.id === id).total);
      // vestido: p1 (+70) + p2 (-40) = +30; blusa x2 sem nada: +60
      assert.equal(total(v), 3000);
      assert.equal(total(b), 6000);
      const dia = r.revenueHistory.find((d) => d.date === p1.dia);
      assert.equal(cent(dia.profit), 9000);
      // so os dois pedidos nao estornados entram no faturamento e na contagem (a linha de faturamento nao mudou)
      assert.equal(dia.orders, 2);
      assert.equal(Number(dia.revenue), 200);
      assert.equal(Number(dia.cost_sold), 40 + 40);
      assert.ok(p3.id);
    });
    console.log(
      "  PASSOU base mista no mesmo dia: vestido +70 (devolucao) e -40 (estorno integral) = +30, blusa +60, dia +90; faturamento e pedidos do dia contam so os dois pedidos pagos",
    );

    // 2. Porta e permissoes: nada de ACL mudou; quem nao e admin atual continua barrado.
    const priv = async (papel) =>
      (
        await c.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS x", [
          papel,
          FN,
        ])
      ).rows[0].x;
    assert.equal(await priv("anon"), false);
    assert.equal(await priv("authenticated"), true);
    assert.equal(await priv("service_role"), true);
    assert.equal(
      (
        await c.query(`SELECT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
        WHERE p.oid = '${FN}'::regprocedure AND g.grantee = 0 AND g.privilege_type = 'EXECUTE') AS x`)
      ).rows[0].x,
      false,
    );
    for (const quem of [CLIENTE, EX_ADMIN]) {
      await isolado(c, async () => {
        await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [quem]);
        await assert.rejects(() => analytics(c), /Acesso negado/);
      });
    }
    console.log(
      "  PASSOU anon/PUBLIC sem EXECUTE, authenticated e service_role com; cliente comum e ex-admin recebem 'Acesso negado'",
    );

    // 3. Reaplicar e inofensivo (LF e CRLF); o pre-voo recusa o desconhecido SEM escrever.
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    await c.query(migration.replace(/\n/g, "\r\n"));
    assert.equal(
      md5((await funcao(c)).prosrc),
      HASH_NOVO,
      "o hash e' o do corpo sem CR mesmo aplicado em CRLF",
    );
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    const estranhos = [
      [
        "corpo desconhecido",
        async () => instalar(c, "BEGIN RETURN '{}'::json; END;"),
      ],
      [
        "o corpo da 3997 (loja que ainda nao recebeu a 3994)",
        async () => instalar(c, CORPO_3997),
      ],
      ["o corpo da 251 (pulou a 3997)", async () => instalar(c, CORPO_251)],
      [
        "atributo diferente (STABLE)",
        async () => {
          await instalar(c, CORPO_3994);
          await c.query(`ALTER FUNCTION ${FN} STABLE`);
        },
      ],
      [
        "anon com EXECUTE",
        async () => {
          await instalar(c, CORPO_3994);
          await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
        },
      ],
      [
        "PUBLIC com EXECUTE",
        async () => {
          await instalar(c, CORPO_3994);
          await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`);
        },
      ],
      [
        "authenticated sem EXECUTE",
        async () => {
          await instalar(c, CORPO_3994);
          await c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`);
        },
      ],
      [
        "sobrecarga em public",
        async () => {
          await instalar(c, CORPO_3994);
          await c.query(
            `CREATE FUNCTION public.get_admin_analytics_v2(a integer, b integer) RETURNS json LANGUAGE sql AS $$ SELECT '{}'::json $$`,
          );
        },
      ],
      ...[
        ["devolucao_itens", "condicao"],
        ["devolucao_itens", "valor_unitario"],
        ["devolucoes", "valor_frete_ida"],
        ["devolucoes", "valor_reembolso"],
        ["devolucoes", "resolucao_final"],
        ["devolucao_itens", "reestocado_em"],
        ["marketplace_orders", "payment_status"],
        ["marketplace_orders", "valor_estornado"],
      ].map(([tabela, coluna]) => [
        `coluna da conta ausente (${tabela}.${coluna})`,
        async () => {
          await instalar(c, CORPO_3994);
          await c.query(
            `ALTER TABLE public.${tabela} RENAME COLUMN ${coluna} TO ${coluna}_x`,
          );
        },
      ]),
    ];
    for (const [rotulo, preparar] of estranhos) {
      await isolado(c, async () => {
        await preparar();
        const estranho = await funcao(c);
        await c.query("SAVEPOINT recusa3995");
        await assert.rejects(
          () => c.query(migration),
          /B1_BASELINE_DIVERGENT/,
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa3995");
        assert.deepEqual(
          await funcao(c),
          estranho,
          `${rotulo}: a recusa gravou algo`,
        );
      });
    }
    // Sem controle de transacao no arquivo: o aplicador fornece a transacao inteira (AGENTS.md).
    assert.equal(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(migration), false);
    assert.equal(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(rollback), false);
    assert.match(migration, /SET LOCAL lock_timeout = '5s';/);
    assert.match(rollback, /SET LOCAL lock_timeout = '5s';/);
    // Nenhum grant novo: nem GRANT nem REVOKE nem objeto novo no arquivo.
    assert.equal(
      /^\s*(GRANT|REVOKE|CREATE (TABLE|INDEX|POLICY|TRIGGER|SCHEMA))\b/im.test(
        migration,
      ),
      false,
    );
    // Falha DEPOIS do CREATE OR REPLACE (o pos-voo): nada fica. Aqui, uma conferencia que nao bate.
    await isolado(c, async () => {
      await assert.rejects(() =>
        c.query(
          `${migration}\nDO $x$ BEGIN RAISE EXCEPTION 'falha depois da troca'; END $x$;`,
        ),
      );
    });
    assert.deepEqual(
      await funcao(c),
      topo,
      "a falha no fim deixou o corpo trocado",
    );
    console.log(
      "  PASSOU reaplicar (LF e CRLF) nao muda nada; corpo desconhecido, 3997, 251, atributo, ACL, sobrecarga e coluna ausente derrubam a migration sem gravar; sem BEGIN/COMMIT nem grant novo",
    );

    // 4. Mutantes: cada regra nova, quebrada de proposito no corpo, e reprovada pela conferencia (ranking, grafico e Financeiro).
    //    `onde`: 'tudo' (as duas copias), 'grafico' (so o bloco 4) ou 'ranking' (so o bloco 5).
    const MARCA_5 = "    -- 5. Top Products";
    const mutar = (corpo, de, para, onde = "tudo") => {
      const [b4, b5] = [
        corpo.slice(0, corpo.indexOf(MARCA_5)),
        corpo.slice(corpo.indexOf(MARCA_5)),
      ];
      const trocar = (t) => t.split(de).join(para);
      const novo =
        onde === "grafico"
          ? trocar(b4) + b5
          : onde === "ranking"
            ? b4 + trocar(b5)
            : trocar(corpo);
      assert.notEqual(novo, corpo, `o mutante nao aplicou: ${de}`);
      return novo;
    };
    const PAGAMENTO_COM = "'recebido_na_entrega', 'estornado')";
    const PAGAMENTO_SEM = "'recebido_na_entrega')";
    const CUSTO_VOLTA = "COALESCE(oic.custo, p.custo) * pc.reestocadas";
    const mutantes = [
      [
        "o pedido 'estornado' fora de novo (nas duas copias)",
        (t) => mutar(t, PAGAMENTO_COM, PAGAMENTO_SEM),
      ],
      [
        "'estornado' fora so do grafico (o ranking mostra, o grafico nao)",
        (t) => mutar(t, PAGAMENTO_COM, PAGAMENTO_SEM, "grafico"),
      ],
      [
        "'estornado' fora so do ranking",
        (t) => mutar(t, PAGAMENTO_COM, PAGAMENTO_SEM, "ranking"),
      ],
      [
        "ignora o dinheiro devolvido sem devolucao (estorno direto e o do site do Mercado Pago)",
        (t) => mutar(t, "(t.residual + t.excesso)", "t.excesso"),
      ],
      [
        "o grafico esquece o dinheiro devolvido sem devolucao (so o ranking tem)",
        (t) => mutar(t, "(t.residual + t.excesso)", "t.excesso", "grafico"),
      ],
      [
        "o ranking esquece o dinheiro devolvido sem devolucao (so o grafico tem)",
        (t) => mutar(t, "(t.residual + t.excesso)", "t.excesso", "ranking"),
      ],
      [
        "nao cobra o custo da peca que nao voltou a prateleira",
        (t) => mutar(t, CUSTO_VOLTA, "COALESCE(oic.custo, p.custo) * pc.q"),
      ],
      [
        "devolve o custo de toda peca devolvida, mesmo a que nao voltou (reestocadas = devolvidas)",
        (t) =>
          mutar(
            t,
            "FILTER (WHERE di.reestocado_em IS NOT NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0) AS reestocadas",
            "FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0) AS reestocadas",
          ),
      ],
      [
        "tira a margem pela quantidade (o dinheiro da peca que voltou e sempre o valor cheio)",
        (t) =>
          mutar(
            t,
            "CASE WHEN x.vv > 0 THEN LEAST(m.pm, x.vv) / x.vv ELSE 0 END AS fv",
            "CASE WHEN x.vv > 0 THEN 1 ELSE 0 END AS fv",
          ),
      ],
      [
        "o 'Nao veio' nao recebe dinheiro devolvido",
        (t) =>
          mutar(
            t,
            "CASE WHEN x.va > 0 THEN LEAST(GREATEST(m.pm - x.vv, 0), x.va) / x.va ELSE 0 END AS fa",
            "0 AS fa",
          ),
      ],
      [
        "pedido 'estornado' sem o atalho de tudo devolvido",
        (t) =>
          mutar(t, "CASE WHEN t.estornado THEN 1", "CASE WHEN false THEN 1"),
      ],
      [
        "perde o excesso da devolucao sobre o valor das pecas",
        (t) =>
          mutar(
            t,
            "GREATEST(0, m.pm - x.vv - x.va) AS excesso",
            "0 AS excesso",
          ),
      ],
      [
        "sem o teto do que o item pagou",
        (t) =>
          mutar(
            t,
            "LEAST(oi.quantity * pg.pago, COALESCE(dv.dinheiro, 0)) AS dinheiro_dev",
            "COALESCE(dv.dinheiro, 0) AS dinheiro_dev",
          ),
      ],
      [
        "vale sem credito (a venda da peca do vale volta ao lucro)",
        (t) =>
          mutar(
            t,
            "ELSE x.vv END AS pm",
            "ELSE CASE WHEN dv.resolucao_final = 'vale' THEN 0 ELSE x.vv END END AS pm",
          ),
      ],
      [
        "devolucao de reembolso sem valor gravado conta como zero",
        (t) => mutar(t, "AND dv.valor_reembolso IS NOT NULL", "AND true"),
      ],
      [
        "o frete de ida conta como dinheiro de produto",
        (t) =>
          mutar(
            t,
            "GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))",
            "GREATEST(0, dv.valor_reembolso)",
          ),
      ],
      [
        "o 'Nao veio' conta como peca devolvida na quantidade",
        (t) =>
          mutar(
            t,
            "COALESCE(SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0) AS devolvidas",
            "COALESCE(SUM(di.quantidade) FILTER (WHERE true), 0) AS devolvidas",
          ),
      ],
      [
        "o custo vendido do dia passa a contar o pedido 'estornado'",
        (t) => mutar(t, " FILTER (WHERE pc.pst <> 'estornado')", ""),
      ],
      [
        "o cancelado entra (sem o filtro de status)",
        (t) =>
          mutar(
            t,
            "o.status NOT IN ('cancelled', 'returned')",
            "o.status IS NOT NULL",
            "ranking",
          ),
      ],
    ];
    for (const [rotulo, fazer] of mutantes) {
      await isolado(c, async () => {
        await instalar(c, fazer(CORPO_NOVO));
        await assert.rejects(
          async () => {
            await conferir(c, "novo");
            await comparar(c);
          },
          (e) => {
            // MOSTRAR_MORTE=1: diz qual cenario derrubou cada mutante (so para quem le a prova).
            if (process.env.MOSTRAR_MORTE === "1")
              console.log(
                `    morto: ${rotulo} => ${String(e.message).split(/\r?\n/)[0].slice(0, 150)}`,
              );
            return e.code === "ERR_ASSERTION";
          },
          `mutante SOBREVIVEU: ${rotulo}`,
        );
      });
    }
    console.log(
      `  PASSOU ${mutantes.length} mutantes reprovam (estornado fora de novo, nas duas copias e so em uma, sem o dinheiro devolvido por fora, em uma ou nas duas, sem o custo da peca que nao voltou, por quantidade, 'Nao veio' sem dinheiro, sem atalho do estornado, sem excesso, sem teto, vale, dado sem valor, frete de ida, quantidade do Nao veio, custo vendido do dia, cancelado dentro)`,
    );

    // 5. Rollback: devolve o corpo da 3994 byte a byte; repetir e inofensivo; corpo desconhecido recusa; a ida e volta nao toca nos dados.
    await c.query(rollback);
    assert.equal((await funcao(c)).prosrc, CORPO_3994);
    assert.equal(md5((await funcao(c)).prosrc), HASH_3994);
    await c.query(rollback);
    assert.equal(
      (await funcao(c)).prosrc,
      CORPO_3994,
      "segundo rollback (idempotente) mexeu no corpo",
    );
    await conferir(c, "antes");
    await isolado(c, async () => {
      await instalar(c, "BEGIN RETURN '{}'::json; END;");
      await c.query("SAVEPOINT rbrecusa3995");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3995");
    });
    await isolado(c, async () => {
      await instalar(c, CORPO_3997);
      await c.query("SAVEPOINT rbrecusa3995b");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3995b");
    });
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    await conferir(c, "novo");
    assert.equal(await retrato(c), dadosAntes, "ida e volta alterou dado");
    console.log(
      "  PASSOU rollback devolve a 3994 byte a byte (o lucro volta a ser por quantidade), repetir e inofensivo, corpo desconhecido e o da 3997 recusam, e a ida e volta nao toca nos dados",
    );

    // 6. Os portoes de publicacao que fixam o hash de get_admin_analytics_v2 aceitam o corpo novo como SUCESSOR;
    //    a 147a o espera, a 147b espera o anterior (o da 3994), a 146a (da propria 3994) e a 135a (da 3997) aceitam os sucessores.
    //    Corpo estranho reprova so a linha do analytics.
    // eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
    const CONF = require(
      path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
    );
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
    const A147 =
      "147a-conferir-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-aplicado";
    const B147 =
      "147b-antes-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-base-vigente";
    const A146 =
      "146a-conferir-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-aplicado";
    const B146 =
      "146b-antes-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-base-vigente";
    const A135 =
      "135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado";
    const B135 =
      "135b-antes-o-ranking-de-lucro-desconta-a-devolucao-base-vigente";
    const PORTOES = [
      ["8e-conferir-92-a-202-aplicado", /^corpo final get_admin_analytics_v2/],
      [
        "35a-conferir-lucro-so-com-custo-aplicado",
        /^get_admin_analytics_v2: corpo e o da 20261234000000/,
      ],
      [
        "45a-conferir-custo-do-dia-aplicado",
        /^get_admin_analytics_v2: corpo e o da 20261242000000/,
      ],
      [
        "48a-conferir-lucro-com-desconto-aplicado",
        /^get_admin_analytics_v2: corpo e o da 20261245000000/,
      ],
      [
        "53a-conferir-faturamento-potencial-aplicado",
        /^get_admin_analytics_v2: corpo e o da 20261250000000/,
      ],
      [
        "54a-conferir-lucro-do-estoque-aplicado",
        /^get_admin_analytics_v2: corpo e o da 20261251000000/,
      ],
      [A135, /^get_admin_analytics_v2: corpo exato/],
      [B135, /^get_admin_analytics_v2: corpo exato/],
      [A146, /^get_admin_analytics_v2: corpo exato/],
      [B146, /^get_admin_analytics_v2: corpo exato/],
      [A147, /^get_admin_analytics_v2: corpo exato/],
      [B147, /^get_admin_analytics_v2: corpo exato/],
    ];
    const rodarPortao = async ([nome, linha]) => {
      const rows = (await c.query(consulta(nome))).rows;
      const dela = rows.filter((r) => linha.test(r.item));
      assert.equal(
        dela.length,
        1,
        `${nome}: a linha do analytics sumiu ou duplicou`,
      );
      return { dela: dela[0], resto: rows.filter((r) => r !== dela[0]), rows };
    };
    const ROL = [A147, B147, A146, B146, A135, B135];
    const noEstado = async (estado, espera) => {
      for (const portao of PORTOES) {
        const r = await rodarPortao(portao);
        assert.equal(
          r.dela.ok,
          espera.get(portao[0]),
          `${portao[0]} com ${estado}: linha do analytics`,
        );
        // O resto da consulta (outras funcoes, atributos, ACL) tem de estar sempre ok.
        const reprovadas = r.resto.filter((x) => !x.ok).map((x) => x.item);
        assert.deepEqual(
          reprovadas,
          [],
          `${portao[0]} com ${estado}: outra linha reprovou`,
        );
        // Rol fechado das consultas desta migration e das anteriores (o conferir-banco recusa linha a mais ou a menos).
        if (ROL.includes(portao[0]))
          assert.deepEqual(
            r.rows.map((x) => x.item).sort(),
            [...CONF.ROL_FECHADO_POR_CONSULTA[portao[0]]].sort(),
            `${portao[0]}: o rol fechado do conferir-banco`,
          );
      }
    };
    // `a135`/`b135`/`a146`/`b146`/`a147`/`b147`: o que cada consulta de catalogo diz em cada estado.
    const ESPERA = (a135, b135, a146, b146, a147, b147) =>
      new Map(
        PORTOES.map(([nome]) => [
          nome,
          {
            [A135]: a135,
            [B135]: b135,
            [A146]: a146,
            [B146]: b146,
            [A147]: a147,
            [B147]: b147,
          }[nome] ?? true,
        ]),
      );
    // (a) corpo novo no ar
    await noEstado(
      "o corpo da 3995",
      ESPERA(true, false, true, false, true, false),
    );
    // (b) corpo da 3994 no ar (loja que ainda nao recebeu a 3995)
    await isolado(c, async () => {
      await c.query(rollback);
      await noEstado(
        "o corpo da 3994",
        ESPERA(true, false, true, false, false, true),
      );
    });
    // (c) corpo da 3997 no ar (loja que ainda nao recebeu nem a 3994)
    await isolado(c, async () => {
      await c.query(rollback);
      await c.query(ler(`supabase/migrations/rollback-manual-${NOME_3994}`));
      await noEstado(
        "o corpo da 3997",
        ESPERA(true, false, false, true, false, false),
      );
    });
    // (d) corpo da 251 no ar (loja que ainda nao recebeu nem a 3997)
    await isolado(c, async () => {
      await c.query(rollback);
      await c.query(ler(`supabase/migrations/rollback-manual-${NOME_3994}`));
      await c.query(ler(`supabase/migrations/rollback-manual-${NOME_3997}`));
      await noEstado(
        "o corpo da 251",
        ESPERA(false, true, false, false, false, false),
      );
    });
    // (e) corpo estranho no ar: reprova a linha do analytics, so ela, em TODAS as consultas
    await isolado(c, async () => {
      await instalar(c, `${CORPO_NOVO}\n-- estranho`);
      await noEstado(
        "um corpo estranho",
        new Map(PORTOES.map(([nome]) => [nome, false])),
      );
    });
    console.log(
      "  PASSOU 8e, 35a, 45a, 48a, 53a, 54a, 135a e 146a aceitam o corpo novo; a 147a o espera e a 147b o anterior (o da 3994); com a 3994, a 3997 ou a 251 no ar cada consulta diz o que e verdade; corpo estranho reprova so a linha do analytics; rol fechado conferido",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  // 7. Conexao SEM BEGIN (o clone ja tem o corpo novo, gravado): uma conferencia que falha no fim do arquivo nao grava
  //    NADA, porque o arquivo inteiro e uma transacao so (o aplicador a fornece). Estado de partida: corpo da 3994.
  const d = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await d.connect();
  try {
    await d.query(rollback);
    assert.equal(
      md5((await funcao(d)).prosrc),
      HASH_3994,
      "partida: o rollback devia ter gravado o corpo da 3994",
    );
    const antes = await funcao(d);
    await assert.rejects(
      () =>
        d.query(
          `${migration}\nDO $x$ BEGIN RAISE EXCEPTION 'conferencia sabotada'; END $x$;`,
        ),
      /conferencia sabotada/,
    );
    assert.deepEqual(
      await funcao(d),
      antes,
      "sem BEGIN, a conferencia sabotada gravou o corpo novo",
    );
    // A conferencia FINAL do proprio arquivo sabotada (o hash esperado trocado): o arquivo inteiro cai, nada e gravado.
    const sabotada = migration.replace(
      `IF v_hash IS DISTINCT FROM '${HASH_NOVO}' THEN`,
      "IF v_hash IS DISTINCT FROM '00000000000000000000000000000000' THEN",
    );
    assert.notEqual(sabotada, migration, "a sabotagem nao aplicou no texto");
    await assert.rejects(() => d.query(sabotada), /B1_BASELINE_DIVERGENT/);
    assert.deepEqual(
      await funcao(d),
      antes,
      "sem BEGIN, a conferencia final sabotada gravou o corpo novo",
    );
    // Pre-voo recusando (corpo estranho gravado): o arquivo inteiro cai e nada e escrito.
    await d.query(`CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
      RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $corpo$BEGIN RETURN '{}'::json; END;$corpo$`);
    const estranho = await funcao(d);
    await assert.rejects(() => d.query(migration), /B1_BASELINE_DIVERGENT/);
    assert.deepEqual(
      await funcao(d),
      estranho,
      "sem BEGIN, o pre-voo recusou mas algo foi gravado",
    );
    // Caminho feliz sem BEGIN: de volta ao corpo da 3994, o arquivo inteiro grava (e so entao).
    await instalar(d, CORPO_3994);
    await d.query(migration);
    assert.equal(md5((await funcao(d)).prosrc), HASH_NOVO);
    console.log(
      "  PASSOU conexao sem BEGIN: a conferencia sabotada e o pre-voo que recusa nao gravam nada; sem sabotagem o arquivo inteiro grava o corpo novo",
    );
  } finally {
    // Deixa o clone como o CI o montou: com o corpo novo.
    await instalar(d, CORPO_NOVO).catch(() => {});
    await d.end();
  }
  console.log(
    "[o-lucro-do-ranking-casa-com-o-financeiro] prova viva concluida (20261399995000).",
  );
}

main().catch((erro) => {
  console.error(
    `[o-lucro-do-ranking-casa-com-o-financeiro] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});

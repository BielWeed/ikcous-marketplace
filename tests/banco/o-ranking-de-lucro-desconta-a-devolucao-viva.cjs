"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// Lote 135 / 20261399970000: somente Postgres descartavel do rpc-ci, nunca banco de loja.
// A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: o cartao "Produtos que mais dao lucro" (topProducts) e o lucro do grafico diario
// (revenueHistory[].profit) de get_admin_analytics_v2 descontam a devolucao e o estorno:
//   lucro do item = (q - d) x (preco - custo - cupom - cortesia) - n x custo
//   d = pecas de devolucao CONCLUIDA com reembolso ou vale (troca NAO conta); n = as que nao voltaram a prateleira;
//   cortesia = valor_estornado do pedido menos o que foi devolvido POR devolucao (linha de order_refunds ligada em
//   devolucoes.refund_id), nunca abaixo de zero, repartida pelo valor das pecas que ficaram.
// O corpo anterior (o da 20261251000000) conta o lucro cheio da peca devolvida: o controle desta prova o reproduz
// na MESMA fixture.
//
// FIXTURE: cada cenario nasce e some dentro de um SAVEPOINT. Vestido R$100 (custo 40) + Blusa R$50 (custo 20), pedido
// 'pago' de 3 dias atras; as vendas que ja existiam no clone sao postas como canceladas DENTRO da transacao (volta no fim).
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/o-ranking-de-lucro-desconta-a-devolucao-viva.cjs
/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo (itens do cenario, dias do grafico), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  desfazerItemQueNaoVeioNoLucroNaTransacao: desfazerItemQueNaoVeio,
  ITEM_NAO_VEIO_NO_LUCRO,
} = require("./o-item-que-nao-veio-nao-vira-perda-posterior.cjs");

const NOME = "20261399970000_o_ranking_de_lucro_desconta_a_devolucao.sql";
const NOME_251 =
  "20261251000000_o_lucro_do_estoque_usa_o_preco_da_variante.sql";
const NOME_250 =
  "20261250000000_o_faturamento_potencial_conta_todo_o_estoque.sql";
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
const CORPO_251 = corpoDe(ler(`supabase/migrations/${NOME_251}`));
const CORPO_250 = corpoDe(ler(`supabase/migrations/${NOME_250}`));
const HASH_NOVO = "0ea0841208f326971e4f92241929e088";
const HASH_251 = "060c9ab5b1505dc375b41e4436e9d3a8";
const HASH_250 = "5746d8a1df216ca4a5569901c45a2a07";

const ADMIN = "5e399997-0000-4000-8000-000000000001";
const CLIENTE = "5e399997-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399997-0000-4000-8000-000000000003";
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
  await c.query("SAVEPOINT caso3997");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3997");
    await c.query("RELEASE SAVEPOINT caso3997");
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

// ---------------------------------------------------------------- fixture
async function pedido(c, { dias, itens, desconto = 0, pagamento = "pago" }) {
  const subtotal = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, discount, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ('Cliente 3997', '{}'::jsonb, $1, $2, $3, 'delivered', 'online', 'online', $4,
             now() - ($5 || ' days')::interval, now() - ($5 || ' days')::interval)
     RETURNING id, to_char((created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS dia`,
    [subtotal - desconto, subtotal, desconto, pagamento, String(dias)],
  );
  const ids = [];
  for (const i of itens) {
    ids.push(
      (
        await c.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
           VALUES ($1, $2, 'item 3997', $3, $4) RETURNING id`,
          [r.rows[0].id, i.produto, i.qtd, i.preco],
        )
      ).rows[0].id,
    );
  }
  return { id: r.rows[0].id, dia: r.rows[0].dia, itens: ids };
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
// `por` = quem pediu ('sistema' = o webhook do MP registrando devolucao feita pelo painel do MP); `minutos` = quando
// nasceu em relacao a agora (a devolucao conclui "agora"); `contestacao` = id da contestacao (chargeback), se for o caso.
async function estorno(
  c,
  ped,
  amount,
  status = "concluido",
  { por = "lojista", minutos = 0, contestacao = null } = {},
) {
  return (
    await c.query(
      `INSERT INTO public.order_refunds
         (order_id, amount, motivo, solicitado_por, status, concluido_em, created_at, mp_chargeback_id)
       VALUES ($1, $2, 'fixture 3997', $4, $3, CASE WHEN $3 = 'concluido' THEN now() END,
               now() + ($5::text || ' minutes')::interval, $6) RETURNING id`,
      [ped.id, amount, status, por, minutos, contestacao],
    )
  ).rows[0].id;
}
// Devolucao do item i do pedido. final: reembolso | vale | troca; status: concluida | recebida.
async function devolver(
  c,
  ped,
  i,
  {
    qtd,
    preco,
    final = "reembolso",
    status = "concluida",
    reestocada = true,
    refundId = null,
    protocolo,
  },
) {
  const dev = crypto.randomUUID();
  const concluida = status === "concluida";
  await c.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_reembolso, refund_id, reembolso_manual, prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, $4, $5, 'desisti', $6, $7, 'local', 'entrega_na_loja', $8, $9::numeric, $10, $11, $12,
       current_date + 7, '{}'::jsonb, CASE WHEN $13 THEN now() END)`,
    [
      dev,
      protocolo,
      ped.id,
      CLIENTE,
      final === "troca" ? "troca" : "arrependimento",
      final,
      final,
      status,
      qtd * preco,
      final === "reembolso" && concluida ? qtd * preco : null,
      refundId,
      final === "reembolso" && concluida && refundId === null,
      concluida,
    ],
  );
  await c.query(
    `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, reestocado_em)
     VALUES ($1, $2, (SELECT product_id FROM public.marketplace_order_items WHERE id = $2), $3, $4,
             CASE WHEN $5 THEN now() END)`,
    [dev, ped.itens[i], qtd, preco, reestocada],
  );
  return dev;
}

// Estorno SEM devolucao por tras (cortesia): a linha concluida do ledger e o acumulado do pedido.
const cortesia = (valor) => async (c, ped) => {
  await estorno(c, ped, valor);
  return valor;
};
const VESTIDO = { preco: 100, custo: 40 };
const BLUSA = { preco: 50, custo: 20 };
let sequencia = 0;
const protocolo = () =>
  `P3997-${++sequencia}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Monta o cenario e devolve o que a tela mostra: por produto, a quantidade e o lucro do ranking, e o lucro do
 * dia no grafico. `montar` recebe (c, ped, v, b) e cria devolucoes/estornos; `valorEstornado` grava o acumulado do pedido.
 */
async function rodar(
  c,
  { desconto = 0, qtdBlusa = 1, pagamento = "pago", montar = async () => 0 },
) {
  const v = await produto(c, "Vestido 3997", VESTIDO.preco, VESTIDO.custo);
  const b = await produto(c, "Blusa 3997", BLUSA.preco, BLUSA.custo);
  const ped = await pedido(c, {
    dias: 3,
    desconto,
    pagamento,
    itens: [
      { produto: v, qtd: 1, preco: VESTIDO.preco },
      { produto: b, qtd: qtdBlusa, preco: BLUSA.preco },
    ],
  });
  const valorEstornado = await montar(c, ped, v, b);
  if (valorEstornado !== undefined && valorEstornado !== null)
    await c.query(
      "UPDATE public.marketplace_orders SET valor_estornado = $2 WHERE id = $1",
      [ped.id, valorEstornado],
    );
  const r = await analytics(c);
  const top = new Map(
    r.topProducts.map((p) => [
      p.id,
      { quantity: p.quantity, total: cent(p.total) },
    ]),
  );
  const dia = r.revenueHistory.find((d) => d.date === ped.dia);
  return {
    v: top.get(v),
    b: top.get(b),
    dia: dia ? cent(dia.profit) : null,
    somaDoRanking: [...top.values()].reduce((s, x) => s + x.total, 0),
    json: r,
  };
}

// Cada cenario: nome, como montar, e o que o NOVO corpo mostra / o que o corpo da 251 mostrava.
// `undefined` = o produto nao aparece no ranking (pedido fora da conta).
const CENARIOS = [
  {
    nome: "sem devolucao nem estorno",
    opts: {},
    novo: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "devolucao da blusa concluida (reembolso, reestocada) com o estorno de R$ 50 ligado a ela",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50);
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        return 50;
      },
    },
    novo: { v: [1, 6000], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "so cortesia de R$ 15, sem devolucao",
    opts: { montar: cortesia(15) },
    novo: { v: [1, 5000], b: [1, 2500] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "blusa devolvida e NAO reestocada: o custo dela vira perda",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50);
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          reestocada: false,
          refundId: r,
          protocolo: protocolo(),
        });
        return 50;
      },
    },
    novo: { v: [1, 6000], b: [0, -2000] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "devolucao do tipo troca (reestocada, sem estorno): igual ao corpo anterior",
    opts: {
      montar: async (c, ped) => {
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          final: "troca",
          protocolo: protocolo(),
        });
        return 0;
      },
    },
    novo: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "devolucao ainda 'recebida' (nao concluida): igual ao corpo anterior",
    opts: {
      montar: async (c, ped) => {
        // resolucao_final preenchida de proposito: so o status 'concluida' pode liberar a conta.
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          status: "recebida",
          protocolo: protocolo(),
        });
        return 0;
      },
    },
    novo: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "vale-troca (reestocada, sem dinheiro): conta como devolvida",
    opts: {
      montar: async (c, ped) => {
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          final: "vale",
          protocolo: protocolo(),
        });
        return 0;
      },
    },
    novo: { v: [1, 6000], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "cupom de R$ 15 no pedido, sem devolucao: o rateio do cupom segue igual",
    opts: { desconto: 15 },
    novo: { v: [1, 5000], b: [1, 2500] },
  },
  {
    nome: "cupom de R$ 15 + cortesia de R$ 15: o cupom e a cortesia saem uma vez cada",
    opts: {
      desconto: 15,
      montar: cortesia(15),
    },
    novo: { v: [1, 4000], b: [1, 2000] },
    antes: { v: [1, 5000], b: [1, 2500] },
  },
  {
    nome: "cupom de R$ 15 + devolucao da blusa com o estorno de R$ 45 ligado: o estorno ligado NAO desconta de novo",
    opts: {
      desconto: 15,
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 45);
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        return 45;
      },
    },
    novo: { v: [1, 5000], b: [0, 0] },
    antes: { v: [1, 5000], b: [1, 2500] },
  },
  {
    nome: "devolucao da blusa (estorno de R$ 50 ligado) + cortesia de R$ 15: a cortesia cai so na peca que ficou",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50);
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 15);
        return 65;
      },
    },
    novo: { v: [1, 4500], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "blusa x4: duas devolvidas e reestocadas, uma devolvida e perdida (tres devolucoes pelo mesmo item)",
    opts: {
      qtdBlusa: 4,
      montar: async (c, ped) => {
        const r1 = await estorno(c, ped, 100);
        await devolver(c, ped, 1, {
          qtd: 2,
          preco: 50,
          refundId: r1,
          protocolo: protocolo(),
        });
        const r2 = await estorno(c, ped, 50);
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          reestocada: false,
          refundId: r2,
          protocolo: protocolo(),
        });
        return 150;
      },
    },
    novo: { v: [1, 6000], b: [1, 1000] },
    antes: { v: [1, 6000], b: [4, 12000] },
  },
  {
    nome: "dado inconsistente: devolve 5 de uma blusa vendida (a quantidade nunca fica negativa)",
    opts: {
      montar: async (c, ped) => {
        await devolver(c, ped, 1, {
          qtd: 5,
          preco: 50,
          final: "vale",
          protocolo: protocolo(),
        });
        return 0;
      },
    },
    novo: { v: [1, 6000], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "dado inconsistente: estorno ligado maior que valor_estornado (a cortesia nunca fica abaixo de zero)",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50);
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        return 0;
      },
    },
    novo: { v: [1, 6000], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "estorno ligado ainda 'solicitado' (o dinheiro nao saiu) + cortesia de R$ 15: so a cortesia confirmada desconta",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50, "solicitado");
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 15);
        return 15;
      },
    },
    novo: { v: [1, 4500], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "cortesia maior que o pedido: cada peca perde no maximo o proprio preco",
    opts: { montar: cortesia(200) },
    novo: { v: [1, -4000], b: [1, -2000] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "reembolso da devolucao FALHOU e a lojista devolveu R$ 50 pelo painel do MP (linha 'sistema' depois da conclusao): nao conta de novo como cortesia",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50, "falhou");
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 50, "concluido", { por: "sistema", minutos: 5 });
        return 50;
      },
    },
    novo: { v: [1, 6000], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "o mesmo, mas a lojista marcou 'ja devolvi por fora' (a devolucao solta a linha que falhou): tambem nao conta de novo",
    opts: {
      montar: async (c, ped) => {
        await estorno(c, ped, 50, "falhou");
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 50, "concluido", { por: "sistema", minutos: 5 });
        return 50;
      },
    },
    novo: { v: [1, 6000], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "linha 'sistema' ANTERIOR a conclusao da devolucao (a linha ligada falhou): e outro dinheiro, continua cortesia",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50, "falhou");
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 50, "concluido", {
          por: "sistema",
          minutos: -60,
        });
        return 50;
      },
    },
    novo: { v: [1, 1000], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "painel do MP devolveu R$ 50 pela devolucao e a lojista deu mais R$ 15 de cortesia: so os R$ 15 descontam da peca que ficou",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50, "falhou");
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 50, "concluido", { por: "sistema", minutos: 5 });
        await estorno(c, ped, 15);
        return 65;
      },
    },
    novo: { v: [1, 4500], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "painel do MP devolveu so R$ 20 de uma devolucao de R$ 50 + cortesia de R$ 15: o abatimento nao passa do que o painel devolveu",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50, "falhou");
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 20, "concluido", { por: "sistema", minutos: 5 });
        await estorno(c, ped, 15);
        return 35;
      },
    },
    novo: { v: [1, 4500], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "a linha 'sistema' e uma contestacao (chargeback): nao e devolucao pelo painel, continua cortesia",
    opts: {
      montar: async (c, ped) => {
        const r = await estorno(c, ped, 50, "falhou");
        await devolver(c, ped, 1, {
          qtd: 1,
          preco: 50,
          refundId: r,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 50, "concluido", {
          por: "sistema",
          minutos: 5,
          contestacao: "cb-3997",
        });
        return 50;
      },
    },
    novo: { v: [1, 1000], b: [0, 0] },
    antes: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "pedido estornado por inteiro: fora do ranking, como antes",
    opts: {
      pagamento: "estornado",
      montar: cortesia(150),
    },
    novo: { v: undefined, b: undefined },
  },
];
const alvo = (par) =>
  par === undefined ? undefined : { quantity: par[0], total: par[1] };

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
        m.dia ?? 0,
        m.v === undefined ? 0 : m.somaDoRanking,
        `${cen.nome}: o lucro do dia no grafico (${qual}) nao fecha com o ranking`,
      );
    });
  }
}

// ---------------------------------------------------------------- prova
async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    // A 20261399994000 (o item "Nao veio" nao vira perda) sucede esta: cai antes, na transacao, e o topo volta a ser o desta migration.
    await desfazerItemQueNaoVeio(c);
    // O topo instalado pelo CI (todas as migrations do zero, menos a 3994 desfeita acima) e o desta migration.
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o corpo da 3997",
    );
    assert.equal(md5(CORPO_NOVO), HASH_NOVO, "o corpo novo nao e o pinado");
    assert.equal(md5(CORPO_251), HASH_251, "o corpo anterior nao e o da 251");
    assert.equal(md5(CORPO_250), HASH_250, "o corpo da 250 mudou");

    for (const [id, papel, metaAdmin] of [
      [ADMIN, "admin", true],
      [CLIENTE, "customer", false],
      // Ex-admin: ainda admin no auth.users (JWT velho), mas ja customer em profiles.
      [EX_ADMIN, "customer", true],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@rank3997.invalid', $2::jsonb)`,
        [id, JSON.stringify(metaAdmin ? { role: "admin" } : {})],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 3997', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
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
      CORPO_251,
      "o rollback nao devolveu o corpo da 251 byte a byte",
    );
    assert.equal(md5(anterior.prosrc), HASH_251);
    assert.deepEqual(
      { ...anterior, prosrc: null },
      { ...topo, prosrc: null },
      "o rollback mudou OID, dono, ACL ou atributo",
    );
    await conferir(c, "antes");
    const controle = await isolado(c, () => rodar(c, CENARIOS[1].opts));
    assert.equal(controle.b.quantity, 1);
    assert.equal(
      controle.b.total,
      3000,
      "controle: o corpo anterior contava o lucro cheio da blusa devolvida",
    );
    // E a conferencia do comportamento novo REPROVA no corpo anterior (o teste falha pelo motivo certo).
    await assert.rejects(
      () => conferir(c, "novo"),
      (e) =>
        e.code === "ERR_ASSERTION" &&
        /devolucao da blusa concluida/.test(e.message),
    );
    console.log(
      "  PASSOU controle: o corpo anterior mostrava a blusa devolvida com lucro 30,00 e quantidade 1 (devia ser 0 e 0) e nao descontava a cortesia",
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
      `  PASSOU ${CENARIOS.length} cenarios: devolucao (reembolso e vale) sai do lucro e da quantidade; troca e devolucao nao concluida nao; peca nao reestocada vira perda; cortesia sai uma vez so; estorno ligado a devolucao nao desconta de novo (com e sem cupom); grafico diario fecha com o ranking`,
    );

    // 1. O resto do JSON e' IGUAL ao do corpo da 251 na MESMA base.
    //    (a) base sem devolucao nem estorno: o JSON inteiro e' igual.
    await isolado(c, async () => {
      const v = await produto(c, "Vestido 3997", 100, 40);
      const b = await produto(c, "Blusa 3997", 50, 20);
      await pedido(c, {
        dias: 5,
        itens: [
          { produto: v, qtd: 2, preco: 100 },
          { produto: b, qtd: 1, preco: 50 },
        ],
      });
      await pedido(c, {
        dias: 2,
        desconto: 15,
        itens: [
          { produto: v, qtd: 1, preco: 100 },
          { produto: b, qtd: 1, preco: 50 },
        ],
      });
      const novo = await analytics(c);
      await instalar(c, CORPO_251);
      const velho = await analytics(c);
      assert.deepEqual(
        novo,
        velho,
        "sem devolucao nem estorno o JSON inteiro tem de ser igual ao da 251",
      );
      assert.ok(
        novo.topProducts.length === 2 &&
          novo.revenueHistory.some((d) => d.orders > 0),
      );
    });
    //    (b) base com devolucao e cortesia: so topProducts e o profit dos dias afetados mudam.
    const mista = async () => {
      const v = await produto(c, "Vestido 3997", 100, 40);
      const b = await produto(c, "Blusa 3997", 50, 20);
      await pedido(c, { dias: 6, itens: [{ produto: v, qtd: 1, preco: 100 }] });
      const p1 = await pedido(c, {
        dias: 4,
        itens: [
          { produto: v, qtd: 1, preco: 100 },
          { produto: b, qtd: 1, preco: 50 },
        ],
      });
      const r = await estorno(c, p1, 50);
      await devolver(c, p1, 1, {
        qtd: 1,
        preco: 50,
        refundId: r,
        protocolo: protocolo(),
      });
      await c.query(
        "UPDATE public.marketplace_orders SET valor_estornado = 50 WHERE id = $1",
        [p1.id],
      );
      const p2 = await pedido(c, {
        dias: 2,
        itens: [{ produto: v, qtd: 1, preco: 100 }],
      });
      await estorno(c, p2, 20);
      await c.query(
        "UPDATE public.marketplace_orders SET valor_estornado = 20 WHERE id = $1",
        [p2.id],
      );
      return [p1.dia, p2.dia];
    };
    await isolado(c, async () => {
      const [dia1, dia2] = await mista();
      const novo = await analytics(c);
      await instalar(c, CORPO_251);
      const velho = await analytics(c);
      const chaves = (a, b) =>
        Object.keys(a)
          .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
          .sort();
      assert.deepEqual(chaves(novo, velho), ["revenueHistory", "topProducts"]);
      assert.equal(novo.revenueHistory.length, velho.revenueHistory.length);
      const diasQueMudam = [];
      novo.revenueHistory.forEach((d, i) => {
        const dv = velho.revenueHistory[i];
        assert.deepEqual(
          { ...d, profit: null },
          { ...dv, profit: null },
          `${d.date}: so o profit do grafico pode mudar (receita, pedidos e cost_sold ficam)`,
        );
        if (cent(d.profit) !== cent(dv.profit)) diasQueMudam.push(d.date);
      });
      assert.deepEqual(
        diasQueMudam,
        [dia1, dia2].sort(),
        "so os dias das vendas com devolucao ou estorno mudam",
      );
      // dia1: vestido 60 + blusa devolvida 0 = 60 (antes 90); dia2: 60 - 20 = 40 (antes 60).
      const por = new Map(
        novo.revenueHistory.map((d) => [d.date, cent(d.profit)]),
      );
      assert.equal(por.get(dia1), 6000);
      assert.equal(por.get(dia2), 4000);
      assert.equal(novo.topProducts.length, 2);
    });
    console.log(
      "  PASSOU base sem devolucao nem estorno: o JSON inteiro e' igual ao da 251; base com devolucao e cortesia: so topProducts e o profit dos dias dessas vendas mudam (receita, pedidos, cost_sold, estoque e o resto ficam)",
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
      ["o corpo da 250 (pulou a 251)", async () => instalar(c, CORPO_250)],
      [
        "atributo diferente (STABLE)",
        async () => {
          await instalar(c, CORPO_251);
          await c.query(`ALTER FUNCTION ${FN} STABLE`);
        },
      ],
      [
        "anon com EXECUTE",
        async () => {
          await instalar(c, CORPO_251);
          await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
        },
      ],
      [
        "PUBLIC com EXECUTE",
        async () => {
          await instalar(c, CORPO_251);
          await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`);
        },
      ],
      [
        "authenticated sem EXECUTE",
        async () => {
          await instalar(c, CORPO_251);
          await c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`);
        },
      ],
      [
        "sobrecarga em public",
        async () => {
          await instalar(c, CORPO_251);
          await c.query(
            `CREATE FUNCTION public.get_admin_analytics_v2(a integer, b integer) RETURNS json LANGUAGE sql AS $$ SELECT '{}'::json $$`,
          );
        },
      ],
      [
        "coluna da conta ausente (devolucoes.resolucao_final)",
        async () => {
          await instalar(c, CORPO_251);
          await c.query(
            "ALTER TABLE public.devolucoes RENAME COLUMN resolucao_final TO resolucao_final_x",
          );
        },
      ],
      [
        "coluna da conta ausente (marketplace_orders.valor_estornado)",
        async () => {
          await instalar(c, CORPO_251);
          await c.query(
            "ALTER TABLE public.marketplace_orders RENAME COLUMN valor_estornado TO valor_estornado_x",
          );
        },
      ],
    ];
    for (const [rotulo, preparar] of estranhos) {
      await isolado(c, async () => {
        await preparar();
        const estranho = await funcao(c);
        await c.query("SAVEPOINT recusa3997");
        await assert.rejects(
          () => c.query(migration),
          /B1_BASELINE_DIVERGENT/,
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa3997");
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
      "  PASSOU reaplicar (LF e CRLF) nao muda nada; corpo desconhecido, 250, atributo, ACL, sobrecarga e coluna ausente derrubam a migration sem gravar; sem BEGIN/COMMIT nem grant novo",
    );

    // 4. MUTANTES: cada um deixa a conferencia do comportamento VERMELHA.
    const mutantes = [
      [
        "ignora devolucao_itens",
        (s) =>
          s
            .split("WHERE di.order_item_id = oi.id")
            .join("WHERE false AND di.order_item_id = oi.id"),
        2,
      ],
      [
        "nao abate do residual o estorno ligado a devolucao (desconta duas vezes)",
        (s) =>
          s
            .split("AND EXISTS (SELECT 1 FROM public.devolucoes dv_lig")
            .join(
              "AND false AND EXISTS (SELECT 1 FROM public.devolucoes dv_lig",
            ),
        2,
      ],
      [
        "conta a troca como devolvida",
        (s) =>
          s
            .split("resolucao_final IN ('reembolso', 'vale')")
            .join("resolucao_final IN ('reembolso', 'vale', 'troca')"),
        4,
      ],
      [
        "o vale nao conta",
        (s) =>
          s
            .split("resolucao_final IN ('reembolso', 'vale')")
            .join("resolucao_final IN ('reembolso')"),
        4,
      ],
      [
        "nao lanca a perda do nao reestocado",
        (s) =>
          s
            .split("- dev.perdidas * COALESCE(oic.custo, p.custo)")
            .join("- 0 * COALESCE(oic.custo, p.custo)"),
        2,
      ],
      [
        "nao filtra devolucoes.status = 'concluida'",
        (s) => s.replace(/AND r?dv\.status = 'concluida'/g, "AND true"),
        4,
      ],
      [
        "sem a cortesia",
        (s) =>
          s
            .split("WHEN COALESCE(s.residual, 0) <= 0 THEN 0")
            .join("WHEN true THEN 0"),
        2,
      ],
      [
        "cortesia sem teto por peca",
        (s) =>
          s
            .split("LEAST(1, COALESCE(s.residual")
            .join("LEAST(1000000, COALESCE(s.residual"),
        2,
      ],
      [
        "a quantidade nao desconta as devolvidas",
        (s) =>
          s
            .split("SUM(oi.quantity - dev.devolvidas)::int")
            .join("SUM(oi.quantity)::int"),
        1,
      ],
      [
        "o grafico diario nao desconta a devolucao",
        (s) =>
          s
            .split("COALESCE(SUM((oi.quantity - dev.devolvidas) * (")
            .join("COALESCE(SUM(oi.quantity * ("),
        1,
      ],
      [
        "o estorno pendente conta como concluido",
        (s) =>
          s
            .split("AND rf.status = 'concluido'")
            .join("AND rf.status IN ('concluido', 'solicitado')"),
        2,
      ],
      [
        "devolvidas sem teto na quantidade vendida",
        (s) =>
          s
            .split(
              "LEAST(oi.quantity, COALESCE(SUM(di.quantidade), 0))::int AS devolvidas",
            )
            .join("COALESCE(SUM(di.quantidade), 0)::int AS devolvidas"),
        2,
      ],
      [
        "o painel do MP nao abate do residual (so a linha ligada abate)",
        (s) =>
          s
            .split("AND sp.solicitado_por = 'sistema'")
            .join("AND false AND sp.solicitado_por = 'sistema'"),
        2,
      ],
      [
        "abate o valor da devolucao sem limite pelo que o painel devolveu",
        (s) =>
          s
            .split("SELECT LEAST(g.valor, COALESCE((")
            .join("SELECT LEAST(g.valor, 1000000 + COALESCE(("),
        2,
      ],
      [
        "a linha do painel anterior a conclusao da devolucao tambem abate",
        (s) => s.split("AND sp.created_at >= g.desde").join("AND true"),
        2,
      ],
      [
        "a contestacao (chargeback) conta como devolucao pelo painel",
        (s) => s.split("AND sp.mp_chargeback_id IS NULL").join("AND true"),
        2,
      ],
      [
        "a devolucao resolvida por fora (refund_id solto) nao abate",
        (s) =>
          s
            .split("(dvp.refund_id IS NULL AND dvp.reembolso_manual)")
            .join("(false AND dvp.reembolso_manual)"),
        2,
      ],
    ];
    for (const [rotulo, mutar, vezes] of mutantes) {
      await isolado(c, async () => {
        const mutado = mutar(CORPO_NOVO);
        assert.notEqual(
          mutado,
          CORPO_NOVO,
          `mutante "${rotulo}": o trecho nao existe no corpo`,
        );
        const linhasAntes = CORPO_NOVO.split("\n");
        const linhasDepois = mutado.split("\n");
        assert.equal(linhasDepois.length, linhasAntes.length);
        const n = linhasAntes.filter((l, i) => l !== linhasDepois[i]).length;
        assert.equal(
          n,
          vezes,
          `mutante "${rotulo}": mexeu em ${n} linhas, esperado ${vezes}`,
        );
        await instalar(c, mutado);
        await assert.rejects(
          () => conferir(c, "novo"),
          // Reprova por EXPECTATIVA nao cumprida, nunca por erro de SQL do mutante.
          (e) => e.code === "ERR_ASSERTION",
          `mutante "${rotulo}" sobreviveu`,
        );
      });
    }
    // O mutante nao deixou nada: o corpo novo continua intacto.
    assert.deepEqual(await funcao(c), topo);
    console.log(
      `  PASSOU ${mutantes.length} mutantes reprovam (ignorar devolucao_itens, desconto em dobro do estorno ligado, contar troca, vale fora, sem perda do nao reestocado, sem filtro de concluida, sem cortesia, cortesia sem teto, quantidade cheia, grafico sem a conta, estorno pendente, devolvidas sem teto, painel do MP sem abater, sem limite, linha anterior, contestacao, devolucao por fora)`,
    );

    // 5. Rollback: devolve o corpo da 251 byte a byte; repetir e inofensivo; corpo desconhecido recusa; a ida e volta nao toca nos dados.
    await c.query(rollback);
    assert.equal((await funcao(c)).prosrc, CORPO_251);
    assert.equal(md5((await funcao(c)).prosrc), HASH_251);
    await c.query(rollback);
    assert.equal(
      (await funcao(c)).prosrc,
      CORPO_251,
      "segundo rollback (idempotente) mexeu no corpo",
    );
    await conferir(c, "antes");
    await isolado(c, async () => {
      await instalar(c, "BEGIN RETURN '{}'::json; END;");
      await c.query("SAVEPOINT rbrecusa3997");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3997");
    });
    await isolado(c, async () => {
      await instalar(c, CORPO_250);
      await c.query("SAVEPOINT rbrecusa3997b");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3997b");
    });
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    await conferir(c, "novo");
    assert.equal(await retrato(c), dadosAntes, "ida e volta alterou dado");
    console.log(
      "  PASSOU rollback devolve a 251 byte a byte (o lucro cheio volta), repetir e inofensivo, corpo desconhecido e o da 250 recusam, e a ida e volta nao toca nos dados",
    );

    // 6. Os portoes de publicacao que fixam o hash de get_admin_analytics_v2 aceitam o corpo novo como SUCESSOR;
    //    a 135a o espera e a 135b espera o anterior (o da 251). Corpo estranho reprova so a linha do analytics.
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
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
    ];
    const rodarPortao = async ([nome, linha]) => {
      const rows = (await c.query(consulta(nome))).rows;
      const dela = rows.filter((r) => linha.test(r.item));
      assert.equal(
        dela.length,
        1,
        `${nome}: a linha do analytics sumiu ou duplicou`,
      );
      return { dela: dela[0], resto: rows.filter((r) => r !== dela[0]) };
    };
    const noEstado = async (estado, espera) => {
      for (const portao of PORTOES) {
        const r = await rodarPortao(portao);
        assert.equal(
          r.dela.ok,
          espera.get(portao[0]),
          `${portao[0]} com ${estado}: linha do analytics`,
        );
        // O resto da consulta (outras funcoes, atributos, ACL) tem de estar sempre ok, salvo o rol do proprio 8e que
        // so olha a funcao.
        const reprovadas = r.resto.filter((x) => !x.ok).map((x) => x.item);
        assert.deepEqual(
          reprovadas,
          [],
          `${portao[0]} com ${estado}: outra linha reprovou`,
        );
      }
    };
    const ESPERA = (novo, de251) =>
      new Map(
        PORTOES.map(([nome]) => [
          nome,
          nome === A135 ? novo : nome === B135 ? de251 : true,
        ]),
      );
    // (a) corpo novo no ar
    await noEstado("o corpo da 3997", ESPERA(true, false));
    // (b) corpo da 251 no ar (loja que ainda nao recebeu a 3997)
    await isolado(c, async () => {
      await c.query(rollback);
      await noEstado("o corpo da 251", ESPERA(false, true));
    });
    // (c) corpo estranho no ar: reprova a linha do analytics, so ela, em TODAS as consultas
    await isolado(c, async () => {
      await instalar(c, `${CORPO_NOVO}\n-- estranho`);
      await noEstado(
        "um corpo estranho",
        new Map(PORTOES.map(([nome]) => [nome, false])),
      );
    });
    console.log(
      "  PASSOU 8e, 35a, 45a, 48a, 53a e 54a aceitam o corpo novo (e o da 251); a 135a espera o novo e a 135b o anterior; corpo estranho reprova so a linha do analytics",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  // 7. Conexao SEM BEGIN (o clone ja tem o corpo novo, gravado): uma conferencia que falha no fim do arquivo nao grava
  //    NADA, porque o arquivo inteiro e' uma transacao so (o aplicador a fornece). Estado de partida: corpo da 251.
  const d = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await d.connect();
  try {
    // A 3994 (sem BEGIN, gravada) cai antes: o rollback desta migration so aceita o corpo desta ou o da 251.
    await desfazerItemQueNaoVeio(d);
    await d.query(rollback);
    assert.equal(
      md5((await funcao(d)).prosrc),
      HASH_251,
      "partida: o rollback devia ter gravado o corpo da 251",
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
    // Caminho feliz sem BEGIN: de volta ao corpo da 251, o arquivo inteiro grava (e so entao).
    await d.query(
      `CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
       RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
       AS $corpo$${CORPO_251}$corpo$`,
    );
    await d.query(migration);
    assert.equal(md5((await funcao(d)).prosrc), HASH_NOVO);
    console.log(
      "  PASSOU conexao sem BEGIN: a conferencia sabotada e o pre-voo que recusa nao gravam nada; sem sabotagem o arquivo inteiro grava o corpo novo",
    );
  } finally {
    // Deixa o clone como o CI o montou: com o corpo da 3997 e, por cima, o da 20261399994000 (a ultima da cadeia).
    await d
      .query(
        `CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
       RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
       AS $corpo$${CORPO_NOVO}$corpo$`,
      )
      .catch(() => {});
    await d
      .query(ler(`supabase/migrations/${ITEM_NAO_VEIO_NO_LUCRO.nome}`))
      .catch(() => {});
    await d.end();
  }
  console.log(
    "[o-ranking-de-lucro-desconta-a-devolucao] prova viva concluida (20261399970000).",
  );
}

main().catch((erro) => {
  console.error(
    `[o-ranking-de-lucro-desconta-a-devolucao] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});

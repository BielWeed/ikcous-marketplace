"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices vem de contadores e de listas fechadas
 * deste arquivo (itens do cenario, dias do grafico), nunca de entrada de rede. */
// Migration 20261399994000 (o item que a lojista marcou "Nao veio" fica com a cliente no ranking de lucro): somente Postgres
// descartavel do rpc-ci, nunca banco de loja. A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: get_admin_analytics_v2 (o cartao "Produtos que mais dao lucro", topProducts, e o lucro do grafico diario,
// revenueHistory[].profit) trata a peca marcada "Nao veio" (devolucao_itens.condicao = 'ausente') como peca que FICOU com a
// cliente (decisao de produto da 20261399992000): a venda vale, ela nao e devolvida nem perdida. O dinheiro que a loja
// devolveu ALEM do valor das pecas que voltaram vira perda desse item, proporcional ao que foi devolvido.
//   lucro do item = (q - d) x (preco - custo - cupom - cortesia) - n x custo - r
//   d = pecas de devolucao CONCLUIDA com reembolso ou vale (troca NAO conta), SEM as 'ausente';
//   n = as de d que NAO voltaram a prateleira (reestocado_em vazio) (condicao NULL conta, como antes);
//   r = reembolso_sem_peca = LEAST(q x preco, soma das linhas 'ausente' qtd x valor_unitario x f), com
//       f = LEAST(1, GREATEST(0, valor_reembolso - vv - valor_frete_ida) / va) quando resolucao_final = 'reembolso' e va > 0, senao 0
//       (vv = valor das linhas que nao sao 'ausente' da devolucao; va = valor das linhas 'ausente').
// O corpo anterior (o da 3997, devolvido pelo rollback desta migration) tratava o "Nao veio" como devolvida e perdida: o
// controle desta prova o reproduz na MESMA fixture; um pedido SEM "Nao veio" mostra numeros IDENTICOS nos dois corpos.
//
// FIXTURE: cada cenario nasce e some dentro de um SAVEPOINT. Vestido R$100 (custo 40) + Blusa R$50 (custo 20), pedido 'pago' de
// 3 dias atras; as vendas que ja existiam no clone sao postas como canceladas DENTRO da transacao (volta no fim).
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-viva.cjs

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  desfazerLucroCasaComOFinanceiroNaTransacao: desfazerLucroCasa,
  LUCRO_CASA_COM_O_FINANCEIRO,
} = require("./o-lucro-do-ranking-casa-com-o-financeiro-posterior.cjs");

const NOME =
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
const CORPO_3997 = corpoDe(ler(`supabase/migrations/${NOME_3997}`));
const CORPO_251 = corpoDe(ler(`supabase/migrations/${NOME_251}`));
const HASH_NOVO = "de8648a7783c12f1be7abd7986c8a2fc";
const HASH_3997 = "0ea0841208f326971e4f92241929e088";
const HASH_251 = "060c9ab5b1505dc375b41e4436e9d3a8";
const FILTRO_3997 = "FILTER (WHERE di.reestocado_em IS NULL)";
const FILTRO_NOVO =
  "FILTER (WHERE di.reestocado_em IS NULL AND di.condicao IS DISTINCT FROM 'ausente')";

const ADMIN = "5e399994-0000-4000-8000-000000000001";
const CLIENTE = "5e399994-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399994-0000-4000-8000-000000000003";
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
  await c.query("SAVEPOINT caso3994");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3994");
    await c.query("RELEASE SAVEPOINT caso3994");
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
     VALUES ('Cliente 3994', '{}'::jsonb, $1, $2, $3, 'delivered', 'online', 'online', $4,
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
           VALUES ($1, $2, 'item 3994', $3, $4) RETURNING id`,
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
       VALUES ($1, $2, 'fixture 3994', $4, $3, CASE WHEN $3 = 'concluido' THEN now() END,
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
// UMA devolucao com varias linhas. final: reembolso | vale | troca; status: concluida | recebida; `reembolso` = valor_reembolso;
// `frete` = valor_frete_ida; `via`: 'mp' (linha do ledger ligada em refund_id) ou 'manual' ("ja devolvi por fora": refund_id solto e a
// linha 'sistema' que o webhook grava depois). O item 'ausente' NAO tem reembolso por padrao: o dinheiro e o que `reembolso` disser.
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
  const valorItens = linhas.reduce((s, l) => s + l.qtd * ped.unitario[l.i], 0);
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
      [dev, ped.itens[l.i], l.qtd, ped.unitario[l.i], l.condicao, l.reestocada],
    );
  return dev;
}

const VESTIDO = { preco: 100, custo: 40 };
const BLUSA = { preco: 50, custo: 20 };
let sequencia = 0;
const protocolo = () =>
  `P3994-${++sequencia}-${crypto.randomUUID().slice(0, 8)}`;
// Atalho: `montar` recebe (c, ped) e chama devolucao(c, ped, {...}).
const com = (opts) => async (c, ped) => {
  await devolucao(c, ped, { protocolo: protocolo(), ...opts });
};
const cortesia = (valor) => async (c, ped) => {
  await estorno(c, ped, valor);
};

/**
 * Monta o cenario e devolve o que a tela mostra: por produto, a quantidade e o lucro do ranking, e o lucro do dia no
 * grafico. `montar` recebe (c, ped, v, b) e cria devolucoes e estornos; o valor_estornado do pedido e a soma do ledger concluido.
 */
async function rodar(
  c,
  { desconto = 0, qtdBlusa = 1, pagamento = "pago", montar = async () => 0 },
) {
  const v = await produto(c, "Vestido 3994", VESTIDO.preco, VESTIDO.custo);
  const b = await produto(c, "Blusa 3994", BLUSA.preco, BLUSA.custo);
  const ped = await pedido(c, {
    dias: 3,
    desconto,
    pagamento,
    itens: [
      { produto: v, qtd: 1, preco: VESTIDO.preco },
      { produto: b, qtd: qtdBlusa, preco: BLUSA.preco },
    ],
  });
  await montar(c, ped, v, b);
  await c.query(
    "UPDATE public.marketplace_orders SET valor_estornado = $2 WHERE id = $1",
    [ped.id, ped.estornado],
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

// Cada cenario: nome, como montar, o que o corpo NOVO mostra e o que o corpo ANTERIOR (3997) mostrava, em [quantidade, lucro em centavos].
// `undefined` = o produto nao aparece no ranking (pedido fora da conta). Sem `antes`, os dois corpos mostram o mesmo.
// O item 'ausente' ("Nao veio") NAO tem reembolso por padrao: so o que `reembolso` disser (devolucao.valor_reembolso).
const CENARIOS = [
  // ---- controle: pedido SEM item 'ausente' mostra os MESMOS numeros nos dois corpos ----
  { nome: "sem devolucao", opts: {}, novo: { v: [1, 6000], b: [1, 3000] } },
  {
    nome: "blusa devolvida nova e reestocada, reembolso de R$ 50: sai do lucro e da quantidade",
    opts: {
      montar: com({ linhas: [L(1, 1, "nova", true)], reembolso: 50 }),
    },
    novo: { v: [1, 6000], b: [0, 0] },
  },
  {
    nome: "blusa 'danificada' e nao reestocada: o custo vira perda",
    opts: {
      montar: com({ linhas: [L(1, 1, "danificada")], reembolso: 50 }),
    },
    novo: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "blusa 'usada' e nao reestocada: o custo vira perda",
    opts: { montar: com({ linhas: [L(1, 1, "usada")], reembolso: 50 }) },
    novo: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "devolucao concluida de ANTES da marcacao existir (condicao nula) e nao reestocada: continua perda",
    opts: { montar: com({ linhas: [L(1, 1, null)], reembolso: 50 }) },
    novo: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "so cortesia de R$ 15, sem devolucao",
    opts: { montar: cortesia(15) },
    novo: { v: [1, 5000], b: [1, 2500] },
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
    nome: "devolucao do tipo troca (sem dinheiro): igual ao corpo anterior",
    opts: { montar: com({ linhas: [L(1, 1, "nova", true)], final: "troca" }) },
    novo: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "devolucao ainda 'recebida' (nao concluida): igual ao corpo anterior",
    opts: {
      montar: com({ linhas: [L(1, 1, "nova", true)], status: "recebida" }),
    },
    novo: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "vale-troca com blusa 'nova': conta como devolvida",
    opts: { montar: com({ linhas: [L(1, 1, "nova", true)], final: "vale" }) },
    novo: { v: [1, 6000], b: [0, 0] },
  },
  {
    nome: "blusa x4: tres devolvidas ('nova' x2 e 'danificada' x1) em duas devolucoes",
    opts: {
      qtdBlusa: 4,
      montar: async (c, ped) => {
        await devolucao(c, ped, {
          linhas: [L(1, 2, "nova", true)],
          reembolso: 100,
          protocolo: protocolo(),
        });
        await devolucao(c, ped, {
          linhas: [L(1, 1, "danificada")],
          reembolso: 50,
          protocolo: protocolo(),
        });
      },
    },
    novo: { v: [1, 6000], b: [1, 1000] },
  },
  // ---- 'Nao veio': a peca FICOU com a cliente; so o dinheiro devolvido alem das pecas que voltaram vira perda ----
  {
    nome: "(A) o 'Nao veio' fica com a cliente e a lojista reembolsou so o que voltou: a blusa mostra preco - custo",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 100,
      }),
    },
    novo: { v: [0, 0], b: [1, 3000] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "so a blusa 'Nao veio', em vale-troca (sem dinheiro): a venda vale, nada e perda",
    opts: { montar: com({ linhas: [L(1, 1, "ausente")], final: "vale" }) },
    novo: { v: [1, 6000], b: [1, 3000] },
    antes: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "(B) so a blusa 'Nao veio' e a lojista reembolsou o valor cheio dela pelo Mercado Pago: perde o custo",
    opts: { montar: com({ linhas: [L(1, 1, "ausente")], reembolso: 50 }) },
    novo: { v: [1, 6000], b: [1, -2000] },
    antes: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "(B) o mesmo pelo caminho manual ('ja devolvi por fora': refund_id solto e linha 'sistema' do webhook)",
    opts: {
      montar: com({
        linhas: [L(1, 1, "ausente")],
        reembolso: 50,
        via: "manual",
      }),
    },
    novo: { v: [1, 6000], b: [1, -2000] },
    antes: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "reembolso parcial: R$ 125 por vestido (R$ 100) e blusa 'Nao veio' (R$ 50): metade da blusa foi devolvida",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 125,
      }),
    },
    novo: { v: [0, 0], b: [1, 500] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "reembolso MENOR que as pecas que voltaram (R$ 60 por um vestido de R$ 100): o 'Nao veio' nao ganha dinheiro negativo",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 60,
      }),
    },
    novo: { v: [0, 0], b: [1, 3000] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "frete de ida de R$ 10 no reembolso de R$ 110: o frete nao e dinheiro da peca 'Nao veio'",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 110,
        frete: 10,
      }),
    },
    novo: { v: [0, 0], b: [1, 3000] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "frete de ida de R$ 10 e reembolso cheio de R$ 160 (o padrao do sistema): perde o custo da blusa",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 160,
        frete: 10,
      }),
    },
    novo: { v: [0, 0], b: [1, -2000] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "cupom de R$ 15 e reembolso cheio de R$ 135 (vestido R$ 90 + blusa R$ 45): o cupom e o reembolso saem uma vez cada",
    opts: {
      desconto: 15,
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 135,
      }),
    },
    novo: { v: [0, 0], b: [1, -2000] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "cupom de R$ 15 e reembolso so do vestido (R$ 90): a blusa 'Nao veio' mostra preco - custo - cupom",
    opts: {
      desconto: 15,
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 90,
      }),
    },
    novo: { v: [0, 0], b: [1, 2500] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "(A) + cortesia de R$ 15: a cortesia se reparte tambem sobre a peca 'Nao veio' (ela ficou)",
    opts: {
      montar: async (c, ped) => {
        await devolucao(c, ped, {
          linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
          reembolso: 100,
          protocolo: protocolo(),
        });
        await estorno(c, ped, 15);
      },
    },
    novo: { v: [0, 0], b: [1, 1500] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "vale-troca com vestido 'nova' e blusa 'Nao veio': sem dinheiro, a blusa fica e vale a venda",
    opts: {
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        final: "vale",
      }),
    },
    novo: { v: [0, 0], b: [1, 3000] },
    antes: { v: [0, 0], b: [0, -2000] },
  },
  {
    nome: "vale-troca com 'Nao veio' e valor_reembolso preenchido por engano (R$ 50): vale nunca tem dinheiro, f = 0",
    opts: {
      montar: async (c, ped) => {
        await devolucao(c, ped, {
          linhas: [L(1, 1, "ausente")],
          final: "vale",
          protocolo: protocolo(),
        });
        await c.query(
          "UPDATE public.devolucoes SET valor_reembolso = 50 WHERE order_id = $1",
          [ped.id],
        );
      },
    },
    novo: { v: [1, 6000], b: [1, 3000] },
    antes: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "troca com 'Nao veio': a troca nao conta como devolvida, igual ao corpo anterior",
    opts: { montar: com({ linhas: [L(1, 1, "ausente")], final: "troca" }) },
    novo: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "devolucao ainda 'recebida' com item 'Nao veio': fora da conta, igual ao corpo anterior",
    opts: {
      montar: com({ linhas: [L(1, 1, "ausente")], status: "recebida" }),
    },
    novo: { v: [1, 6000], b: [1, 3000] },
  },
  {
    nome: "peca pedida de novo: a 1a devolucao 'Nao veio' sem reembolso (vale) e a 2a devolve a blusa, reestoca e reembolsa: lucro 0",
    opts: {
      montar: async (c, ped) => {
        await devolucao(c, ped, {
          linhas: [L(1, 1, "ausente")],
          final: "vale",
          protocolo: protocolo(),
        });
        await devolucao(c, ped, {
          linhas: [L(1, 1, "nova", true)],
          reembolso: 50,
          protocolo: protocolo(),
        });
      },
    },
    novo: { v: [1, 6000], b: [0, 0] },
    antes: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "peca pedida de novo e dessa vez 'danificada': so a segunda devolucao e perda (uma peca)",
    opts: {
      montar: async (c, ped) => {
        await devolucao(c, ped, {
          linhas: [L(1, 1, "ausente")],
          final: "vale",
          protocolo: protocolo(),
        });
        await devolucao(c, ped, {
          linhas: [L(1, 1, "danificada")],
          reembolso: 50,
          protocolo: protocolo(),
        });
      },
    },
    novo: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "blusa x2: uma peca 'Nao veio' reembolsada (R$ 50) e a outra devolvida 'nova' e reembolsada (R$ 50): -custo da que ficou",
    opts: {
      qtdBlusa: 2,
      montar: async (c, ped) => {
        await devolucao(c, ped, {
          linhas: [L(1, 1, "ausente")],
          reembolso: 50,
          protocolo: protocolo(),
        });
        await devolucao(c, ped, {
          linhas: [L(1, 1, "nova", true)],
          reembolso: 50,
          protocolo: protocolo(),
        });
      },
    },
    novo: { v: [1, 6000], b: [1, -2000] },
    antes: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "LIMITACAO CONHECIDA (regra do socio): a 1a devolucao reembolsou o 'Nao veio' (R$ 50) e a 2a, do mesmo item, devolve a peca num vale-troca: o dinheiro da 1a segue como perda (-R$ 50), embora a peca tenha voltado",
    opts: {
      montar: async (c, ped) => {
        await devolucao(c, ped, {
          linhas: [L(1, 1, "ausente")],
          reembolso: 50,
          protocolo: protocolo(),
        });
        await devolucao(c, ped, {
          linhas: [L(1, 1, "nova", true)],
          final: "vale",
          protocolo: protocolo(),
        });
      },
    },
    novo: { v: [1, 6000], b: [0, -5000] },
    antes: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "reembolso maior que o valor das pecas (R$ 200 por R$ 150): o fator nunca passa de 1",
    opts: {
      qtdBlusa: 2,
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 200,
      }),
    },
    novo: { v: [0, 0], b: [2, 1000] },
    antes: { v: [0, 0], b: [1, 1000] },
  },
  {
    nome: "dado inconsistente: 5 pecas 'Nao veio' de uma blusa vendida, com R$ 250 reembolsados: o prejuizo e limitado ao que o item vendeu",
    opts: { montar: com({ linhas: [L(1, 5, "ausente")], reembolso: 250 }) },
    novo: { v: [1, 6000], b: [1, -2000] },
    antes: { v: [1, 6000], b: [0, -2000] },
  },
  {
    nome: "vestido 'Nao veio' (o item mais caro) e blusa 'danificada', reembolso so da blusa (R$ 50): o vestido fica e vale a venda",
    opts: {
      montar: com({
        linhas: [L(0, 1, "ausente"), L(1, 1, "danificada")],
        reembolso: 50,
      }),
    },
    novo: { v: [1, 6000], b: [0, -2000] },
    antes: { v: [0, -4000], b: [0, -2000] },
  },
  {
    nome: "pedido estornado por inteiro com item 'Nao veio': fora do ranking, como antes",
    opts: {
      pagamento: "estornado",
      montar: async (c, ped) => {
        await devolucao(c, ped, {
          linhas: [L(1, 1, "ausente")],
          final: "vale",
          protocolo: protocolo(),
        });
        await estorno(c, ped, 150);
      },
    },
    novo: { v: undefined, b: undefined },
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
    // A 20261399995000 (o lucro do ranking casa com o Financeiro) sucede esta: cai antes, na transacao, e o topo volta a ser o desta migration.
    await desfazerLucroCasa(c);
    // O topo instalado pelo CI (todas as migrations do zero, menos a 3995 desfeita acima) e o desta migration.
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o corpo da 3994",
    );
    assert.equal(md5(CORPO_NOVO), HASH_NOVO, "o corpo novo nao e o pinado");
    assert.equal(
      md5(CORPO_3997),
      HASH_3997,
      "o corpo anterior nao e o da 3997",
    );
    assert.equal(md5(CORPO_251), HASH_251, "o corpo da 251 mudou");
    // Fora o que esta migration muda, o corpo e o da 3997 byte a byte: desfazendo cada trecho novo, volta-se ao da 3997.
    assert.equal(CORPO_NOVO.split(FILTRO_NOVO).length - 1, 2);
    assert.equal(CORPO_3997.split(FILTRO_3997).length - 1, 2);
    const LATERAL_FR =
      /\n *LEFT JOIN LATERAL \(\n *SELECT CASE WHEN dv\.resolucao_final[\s\S]*?WHERE dx\.devolucao_id = dv\.id\) x\) fr ON true/g;
    assert.equal(
      CORPO_NOVO.match(LATERAL_FR).length,
      2,
      "a conta do fator f entra uma vez em cada bloco",
    );
    const desfeito = CORPO_NOVO.split("\n")
      .filter(
        (l) =>
          !/^ *-- ('Nao veio' \(condicao|reembolso_sem_peca =|pecas 'Nao veio' de cada)/.test(
            l,
          ),
      )
      .join("\n")
      .replace(LATERAL_FR, "")
      .split(" FILTER (WHERE rdi.condicao IS DISTINCT FROM 'ausente')")
      .join("")
      .split(
        "SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0))::int AS devolvidas",
      )
      .join("SUM(di.quantidade), 0))::int AS devolvidas")
      .split(FILTRO_NOVO)
      .join(FILTRO_3997)
      .replace(
        /::int AS perdidas,\n *LEAST\(oi\.quantity \* oi\.price, COALESCE\([^\n]*AS reembolso_sem_peca/g,
        "::int AS perdidas",
      )
      .replace(
        /(- dev\.perdidas \* COALESCE\(oic\.custo, p\.custo\))\n *- dev\.reembolso_sem_peca\)/g,
        "$1)",
      );
    assert.equal(
      desfeito,
      CORPO_3997,
      "fora das mudancas desta migration (excecao do 'Nao veio', reembolso_sem_peca e o fator f), o corpo tem de ser o da 3997",
    );

    for (const [id, papel, metaAdmin] of [
      [ADMIN, "admin", true],
      [CLIENTE, "customer", false],
      // Ex-admin: ainda admin no auth.users (JWT velho), mas ja customer em profiles.
      [EX_ADMIN, "customer", true],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@rank3994.invalid', $2::jsonb)`,
        [id, JSON.stringify(metaAdmin ? { role: "admin" } : {})],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 3994', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
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
      CORPO_3997,
      "o rollback nao devolveu o corpo da 3997 byte a byte",
    );
    assert.equal(md5(anterior.prosrc), HASH_3997);
    assert.deepEqual(
      { ...anterior, prosrc: null },
      { ...topo, prosrc: null },
      "o rollback mudou OID, dono, ACL ou atributo",
    );
    await conferir(c, "antes");
    // O controle de verdade: os pedidos SEM item 'Nao veio' mostram os MESMOS numeros nos dois corpos (so os cenarios com
    // 'Nao veio' tem `antes` diferente de `novo`).
    const semAusente = CENARIOS.filter((x) => x.antes === undefined);
    const comAusente = CENARIOS.filter((x) => x.antes !== undefined);
    assert.equal(semAusente.length >= 12 && comAusente.length >= 15, true);
    const controle = await isolado(c, () => rodar(c, cenario("(A)").opts));
    assert.equal(controle.b.quantity, 0);
    assert.equal(
      controle.b.total,
      -2000,
      "controle: o corpo anterior mostrava a blusa 'Nao veio' como devolvida e perdida (-custo), mesmo sem reembolso da peca",
    );
    assert.equal(
      controle.dia,
      controle.somaDoRanking,
      "controle: o grafico diario tambem mostrava assim",
    );
    // E a conferencia do comportamento novo REPROVA no corpo anterior (o teste falha pelo motivo certo).
    await assert.rejects(
      () => conferir(c, "novo"),
      (e) => e.code === "ERR_ASSERTION" && /Nao veio/.test(e.message),
    );
    console.log(
      `  PASSOU controle: o corpo anterior mostrava a blusa 'Nao veio' (so o vestido reembolsado) com lucro -20,00 e quantidade 0; o novo mostra +30,00 e quantidade 1; os ${semAusente.length} cenarios sem 'Nao veio' sao IDENTICOS nos dois corpos`,
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
      `  PASSOU ${CENARIOS.length} cenarios: o 'Nao veio' fica com a cliente (a venda vale) e so o dinheiro devolvido alem das pecas que voltaram vira perda (so o que voltou, reembolso cheio pelo MP e pelo caminho manual, parcial, frete, cupom, cortesia, pedida de novo, vale/troca); danificada, usada e condicao nula continuam perda; nova reestocada, troca, devolucao nao concluida e pedido estornado como antes; grafico diario fecha com o ranking`,
    );

    // 1. O resto do JSON e' IGUAL ao do corpo da 3997 na MESMA base.
    //    (a) base com devolucao, perda e cortesia mas SEM item 'Nao veio': o JSON inteiro e' igual.
    //    (b) a mesma base com a blusa 'Nao veio' num vale-troca (sem dinheiro): so topProducts e o profit do dia daquela venda mudam.
    const base = async (comAusente) => {
      const v = await produto(c, "Vestido 3994", 100, 40);
      const b = await produto(c, "Blusa 3994", 50, 20);
      await pedido(c, { dias: 6, itens: [{ produto: v, qtd: 1, preco: 100 }] });
      const p1 = await pedido(c, {
        dias: 4,
        itens: [
          { produto: v, qtd: 1, preco: 100 },
          { produto: b, qtd: 1, preco: 50 },
        ],
      });
      await devolucao(c, p1, {
        linhas: [L(1, 1, comAusente ? "ausente" : "danificada")],
        final: comAusente ? "vale" : "reembolso",
        reembolso: comAusente ? null : 50,
        protocolo: protocolo(),
      });
      await c.query(
        "UPDATE public.marketplace_orders SET valor_estornado = $2 WHERE id = $1",
        [p1.id, p1.estornado],
      );
      const p2 = await pedido(c, {
        dias: 2,
        itens: [{ produto: v, qtd: 1, preco: 100 }],
      });
      await estorno(c, p2, 20);
      await c.query(
        "UPDATE public.marketplace_orders SET valor_estornado = $2 WHERE id = $1",
        [p2.id, p2.estornado],
      );
      return [p1.dia, p2.dia];
    };
    await isolado(c, async () => {
      await base(false);
      const novo = await analytics(c);
      await instalar(c, CORPO_3997);
      const velho = await analytics(c);
      assert.deepEqual(
        novo,
        velho,
        "sem item 'Nao veio' o JSON inteiro tem de ser igual ao da 3997",
      );
      assert.ok(
        novo.topProducts.length === 2 &&
          novo.revenueHistory.some((d) => d.orders > 0),
        "a base da comparacao ficou vazia",
      );
    });
    await isolado(c, async () => {
      const [dia1] = await base(true);
      const novo = await analytics(c);
      await instalar(c, CORPO_3997);
      const velho = await analytics(c);
      const chaves = (a, b) =>
        Object.keys(a)
          .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
          .sort();
      assert.deepEqual(chaves(novo, velho), ["revenueHistory", "topProducts"]);
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
        [dia1],
        "so o dia da venda com o item 'Nao veio' muda",
      );
      const por = (a) =>
        new Map(a.revenueHistory.map((d) => [d.date, cent(d.profit)]));
      // 3997: a blusa 'Nao veio' saia da venda e ainda cobrava o custo (-20,00); agora a venda vale (+30,00): +50,00.
      assert.equal(por(novo).get(dia1) - por(velho).get(dia1), 5000);
      const total = (a) => a.topProducts.reduce((s, p) => s + cent(p.total), 0);
      assert.equal(total(novo) - total(velho), 5000);
    });
    console.log(
      "  PASSOU base sem item 'Nao veio': o JSON inteiro e' igual ao da 3997; base com ele (vale-troca, sem dinheiro): so topProducts e o profit do dia daquela venda mudam, em R$ 50,00 (a venda da blusa que ficou com a cliente, de -20,00 para +30,00)",
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
      ["o corpo da 251 (pulou a 3997)", async () => instalar(c, CORPO_251)],
      [
        "atributo diferente (STABLE)",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(`ALTER FUNCTION ${FN} STABLE`);
        },
      ],
      [
        "anon com EXECUTE",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
        },
      ],
      [
        "PUBLIC com EXECUTE",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`);
        },
      ],
      [
        "authenticated sem EXECUTE",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`);
        },
      ],
      [
        "sobrecarga em public",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(
            `CREATE FUNCTION public.get_admin_analytics_v2(a integer, b integer) RETURNS json LANGUAGE sql AS $$ SELECT '{}'::json $$`,
          );
        },
      ],
      [
        "coluna da conta ausente (devolucao_itens.condicao)",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(
            "ALTER TABLE public.devolucao_itens RENAME COLUMN condicao TO condicao_x",
          );
        },
      ],
      [
        "coluna da conta ausente (devolucao_itens.valor_unitario)",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(
            "ALTER TABLE public.devolucao_itens RENAME COLUMN valor_unitario TO valor_unitario_x",
          );
        },
      ],
      [
        "coluna da conta ausente (devolucoes.valor_frete_ida)",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(
            "ALTER TABLE public.devolucoes RENAME COLUMN valor_frete_ida TO valor_frete_ida_x",
          );
        },
      ],
      [
        "coluna da conta ausente (devolucoes.valor_reembolso)",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(
            "ALTER TABLE public.devolucoes RENAME COLUMN valor_reembolso TO valor_reembolso_x",
          );
        },
      ],
      [
        "coluna da conta ausente (devolucoes.resolucao_final)",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(
            "ALTER TABLE public.devolucoes RENAME COLUMN resolucao_final TO resolucao_final_x",
          );
        },
      ],
      [
        "coluna da conta ausente (devolucao_itens.reestocado_em)",
        async () => {
          await instalar(c, CORPO_3997);
          await c.query(
            "ALTER TABLE public.devolucao_itens RENAME COLUMN reestocado_em TO reestocado_em_x",
          );
        },
      ],
    ];
    for (const [rotulo, preparar] of estranhos) {
      await isolado(c, async () => {
        await preparar();
        const estranho = await funcao(c);
        await c.query("SAVEPOINT recusa3994");
        await assert.rejects(
          () => c.query(migration),
          /B1_BASELINE_DIVERGENT/,
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa3994");
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
      "  PASSOU reaplicar (LF e CRLF) nao muda nada; corpo desconhecido, 251, atributo, ACL, sobrecarga e coluna ausente derrubam a migration sem gravar; sem BEGIN/COMMIT nem grant novo",
    );

    // 4. MUTANTES: cada um deixa a conferencia do comportamento VERMELHA.
    // [rotulo, como mutar, quantas LINHAS do corpo mudam (null = corpo inteiro trocado)]
    const AUSENTE_FORA = "di.condicao IS DISTINCT FROM 'ausente'";
    const mutantes = [
      ["o corpo da 3997 de volta (sem a regra nova)", () => CORPO_3997, null],
      [
        "o 'Nao veio' volta a ser perdida (a excecao some do filtro das perdidas)",
        (x) => x.split(FILTRO_NOVO).join(FILTRO_3997),
        2,
      ],
      [
        "a excecao das perdidas vale so no ranking (o grafico diario ainda cobra)",
        (x) => {
          const i = x.indexOf(FILTRO_NOVO);
          return x.slice(0, i) + FILTRO_3997 + x.slice(i + FILTRO_NOVO.length);
        },
        1,
      ],
      [
        "a excecao das perdidas vale so no grafico diario (o ranking ainda cobra)",
        (x) => {
          const i = x.lastIndexOf(FILTRO_NOVO);
          return x.slice(0, i) + FILTRO_3997 + x.slice(i + FILTRO_NOVO.length);
        },
        1,
      ],
      [
        "o 'Nao veio' volta a contar como devolvida (a venda dele sai do lucro e da quantidade)",
        (x) =>
          x
            .split(
              `SUM(di.quantidade) FILTER (WHERE ${AUSENTE_FORA}), 0))::int AS devolvidas`,
            )
            .join("SUM(di.quantidade), 0))::int AS devolvidas"),
        2,
      ],
      [
        "o 'Nao veio' continua devolvido no resto da cortesia (CTE sobra)",
        (x) =>
          x
            .split(" FILTER (WHERE rdi.condicao IS DISTINCT FROM 'ausente')")
            .join(""),
        2,
      ],
      [
        "invertida: so o 'Nao veio' conta como devolvido e perdido",
        (x) => x.split(AUSENTE_FORA).join("di.condicao = 'ausente'"),
        6,
      ],
      [
        "'<>' no lugar de 'IS DISTINCT FROM': a condicao nula (devolucao de antes) deixa de contar",
        (x) => x.split(AUSENTE_FORA).join("di.condicao <> 'ausente'"),
        6,
      ],
      [
        "a 'danificada' tambem deixa de ser perda",
        (x) =>
          x
            .split(`di.reestocado_em IS NULL AND ${AUSENTE_FORA}`)
            .join(
              `di.reestocado_em IS NULL AND ${AUSENTE_FORA} AND di.condicao IS DISTINCT FROM 'danificada'`,
            ),
        2,
      ],
      [
        "a 'usada' tambem deixa de ser perda",
        (x) =>
          x
            .split(`di.reestocado_em IS NULL AND ${AUSENTE_FORA}`)
            .join(
              `di.reestocado_em IS NULL AND ${AUSENTE_FORA} AND di.condicao IS DISTINCT FROM 'usada'`,
            ),
        2,
      ],
      [
        "perde o filtro da prateleira (a peca reestocada vira perda)",
        (x) =>
          x
            .split("FILTER (WHERE di.reestocado_em IS NULL AND ")
            .join("FILTER (WHERE "),
        2,
      ],
      [
        "nao lanca a perda de ninguem",
        (x) =>
          x
            .split("- dev.perdidas * COALESCE(oic.custo, p.custo)")
            .join("- 0 * COALESCE(oic.custo, p.custo)"),
        2,
      ],
      [
        "o dinheiro devolvido sem a peca nao sai do ranking",
        (x) =>
          x.split("- dev.reembolso_sem_peca) as total").join("- 0) as total"),
        1,
      ],
      [
        "o dinheiro devolvido sem a peca nao sai do grafico diario",
        (x) => x.split("- dev.reembolso_sem_peca) FILTER").join("- 0) FILTER"),
        1,
      ],
      [
        "o fator passa de 1 (reembolso maior que as pecas vira prejuizo maior)",
        (x) =>
          x
            .split("THEN LEAST(1, GREATEST(0, ")
            .join("THEN LEAST(2, GREATEST(0, "),
        2,
      ],
      [
        "o fator fica negativo (reembolso menor que as pecas que voltaram ganha dinheiro)",
        (x) =>
          x
            .split("GREATEST(0, COALESCE(dv.valor_reembolso")
            .join("GREATEST(-1000000, COALESCE(dv.valor_reembolso"),
        2,
      ],
      [
        "o frete de ida conta como dinheiro da peca 'Nao veio'",
        (x) => x.split(" - COALESCE(dv.valor_frete_ida, 0)").join(" - 0"),
        2,
      ],
      [
        "o valor das pecas que voltaram nao e descontado do reembolso",
        (x) => x.split(" - x.vv - ").join(" - 0 - "),
        2,
      ],
      [
        "vale e troca tambem tem dinheiro (a resolucao final nao e olhada)",
        (x) =>
          x
            .split("WHEN dv.resolucao_final = 'reembolso' AND x.va > 0")
            .join("WHEN x.va > 0"),
        2,
      ],
      [
        "o prejuizo do item nao tem teto (quantidade x preco do item vendido)",
        (x) =>
          x
            .split("LEAST(oi.quantity * oi.price, COALESCE(")
            .join("LEAST(oi.quantity * oi.price * 1000, COALESCE("),
        2,
      ],
      [
        "o dinheiro devolvido tambem e atribuido as linhas que nao sao 'Nao veio'",
        (x) =>
          x
            .split("* fr.f) FILTER (WHERE di.condicao = 'ausente'), 0))")
            .join("* fr.f), 0))"),
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
        if (vezes !== null) {
          const linhasAntes = CORPO_NOVO.split("\n");
          const linhasDepois = mutado.split("\n");
          assert.equal(linhasDepois.length, linhasAntes.length);
          const n = linhasAntes.filter((l, i) => l !== linhasDepois[i]).length;
          assert.equal(
            n,
            vezes,
            `mutante "${rotulo}": mexeu em ${n} linhas, esperado ${vezes}`,
          );
        }
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
      `  PASSOU ${mutantes.length} mutantes reprovam (3997 de volta, 'Nao veio' perdido ou devolvido de novo, so no ranking ou so no grafico, invertida, '<>' sem o nulo, danificada ou usada fora, sem o filtro da prateleira, sem perda, reembolso sem peca fora do ranking ou do grafico, fator acima de 1 ou negativo, frete contado, pecas que voltaram nao descontadas, vale com dinheiro, sem teto, outras linhas com dinheiro)`,
    );

    // 5. Rollback: devolve o corpo da 3997 byte a byte; repetir e inofensivo; corpo desconhecido recusa; a ida e volta nao toca nos dados.
    await c.query(rollback);
    assert.equal((await funcao(c)).prosrc, CORPO_3997);
    assert.equal(md5((await funcao(c)).prosrc), HASH_3997);
    await c.query(rollback);
    assert.equal(
      (await funcao(c)).prosrc,
      CORPO_3997,
      "segundo rollback (idempotente) mexeu no corpo",
    );
    await conferir(c, "antes");
    await isolado(c, async () => {
      await instalar(c, "BEGIN RETURN '{}'::json; END;");
      await c.query("SAVEPOINT rbrecusa3994");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3994");
    });
    await isolado(c, async () => {
      await instalar(c, CORPO_251);
      await c.query("SAVEPOINT rbrecusa3994b");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3994b");
    });
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    await conferir(c, "novo");
    assert.equal(await retrato(c), dadosAntes, "ida e volta alterou dado");
    console.log(
      "  PASSOU rollback devolve a 3997 byte a byte (o custo da peca ausente volta a ser cobrado), repetir e inofensivo, corpo desconhecido e o da 251 recusam, e a ida e volta nao toca nos dados",
    );

    // 6. Os portoes de publicacao que fixam o hash de get_admin_analytics_v2 aceitam o corpo novo como SUCESSOR;
    //    a 146a o espera, a 146b espera o anterior (o da 3997) e a 135a (o da propria 3997) aceita os dois.
    //    Corpo estranho reprova so a linha do analytics.
    // eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
    const CONF = require(
      path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
    );
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
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
        // Rol fechado das consultas desta migration e da 3997 (o conferir-banco recusa linha a mais ou a menos).
        if ([A146, B146, A135, B135].includes(portao[0]))
          assert.deepEqual(
            r.rows.map((x) => x.item).sort(),
            [...CONF.ROL_FECHADO_POR_CONSULTA[portao[0]]].sort(),
            `${portao[0]}: o rol fechado do conferir-banco`,
          );
      }
    };
    // `a135`/`b135`/`a146`/`b146`: o que cada consulta de catalogo diz em cada estado.
    const ESPERA = (a135, b135, a146, b146) =>
      new Map(
        PORTOES.map(([nome]) => [
          nome,
          nome === A135
            ? a135
            : nome === B135
              ? b135
              : nome === A146
                ? a146
                : nome === B146
                  ? b146
                  : true,
        ]),
      );
    // (a) corpo novo no ar
    await noEstado("o corpo da 3994", ESPERA(true, false, true, false));
    // (b) corpo da 3997 no ar (loja que ainda nao recebeu a 3994)
    await isolado(c, async () => {
      await c.query(rollback);
      await noEstado("o corpo da 3997", ESPERA(true, false, false, true));
    });
    // (c) corpo da 251 no ar (loja que ainda nao recebeu nem a 3997)
    await isolado(c, async () => {
      await c.query(rollback);
      await c.query(ler(`supabase/migrations/rollback-manual-${NOME_3997}`));
      await noEstado("o corpo da 251", ESPERA(false, true, false, false));
    });
    // (d) corpo estranho no ar: reprova a linha do analytics, so ela, em TODAS as consultas
    await isolado(c, async () => {
      await instalar(c, `${CORPO_NOVO}\n-- estranho`);
      await noEstado(
        "um corpo estranho",
        new Map(PORTOES.map(([nome]) => [nome, false])),
      );
    });
    console.log(
      "  PASSOU 8e, 35a, 45a, 48a, 53a, 54a e 135a aceitam o corpo novo; a 146a o espera e a 146b o anterior (o da 3997); com a 3997 ou a 251 no ar cada consulta diz o que e verdade; corpo estranho reprova so a linha do analytics; rol fechado conferido",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  // 7. Conexao SEM BEGIN (o clone ja tem o corpo novo, gravado): uma conferencia que falha no fim do arquivo nao grava
  //    NADA, porque o arquivo inteiro e' uma transacao so (o aplicador a fornece). Estado de partida: corpo da 3997.
  const d = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await d.connect();
  try {
    // A 3995 (sem BEGIN, gravada) cai antes: o rollback desta migration so aceita o corpo desta ou o da 3997.
    await desfazerLucroCasa(d);
    await d.query(rollback);
    assert.equal(
      md5((await funcao(d)).prosrc),
      HASH_3997,
      "partida: o rollback devia ter gravado o corpo da 3997",
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
    // Caminho feliz sem BEGIN: de volta ao corpo da 3997, o arquivo inteiro grava (e so entao).
    await instalar(d, CORPO_3997);
    await d.query(migration);
    assert.equal(md5((await funcao(d)).prosrc), HASH_NOVO);
    console.log(
      "  PASSOU conexao sem BEGIN: a conferencia sabotada e o pre-voo que recusa nao gravam nada; sem sabotagem o arquivo inteiro grava o corpo novo",
    );
  } finally {
    // Deixa o clone como o CI o montou: com o corpo desta migration e, por cima, o da 20261399995000 (a ultima da cadeia).
    await instalar(d, CORPO_NOVO).catch(() => {});
    await d
      .query(ler(`supabase/migrations/${LUCRO_CASA_COM_O_FINANCEIRO.nome}`))
      .catch(() => {});
    await d.end();
  }
  console.log(
    "[o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro] prova viva concluida (20261399994000).",
  );
}

main().catch((erro) => {
  console.error(
    `[o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});

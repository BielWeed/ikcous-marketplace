"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados, nunca de entrada de rede. */

/**
 * Prova VIVA da migration 20261662000000 (o lucro do ranking so desconta o reembolso que SAIU, e o frete de ida so quando foi
 * devolvido). So Postgres EFEMERO, num CLONE proprio (rodar-isolado.cjs): nunca banco de loja.
 *
 * OS DEFEITOS (controle, com o corpo da 20261659000000 aplicado dentro da transacao pelo rollback desta):
 *   (b) o reembolso pendente ('solicitado' / 'em_processamento'), o que falhou e o recusado ja saiam do lucro; o Financeiro so deduz o
 *       que saiu (peca de R$ 100, custo 40, avariada, R$ 30 pendente: o ranking dava +R$ 30, o Financeiro +R$ 60);
 *   (a) o frete de ida gravado saia do dinheiro devolvido mesmo quando o reembolso nao o pagou (vestido R$ 100 + blusa R$ 50 + frete
 *       R$ 25, a blusa 'Nao veio', reembolso de R$ 100: o vestido de volta mostrava +R$ 25 que nao existe).
 *
 * O ORACULO e' o Financeiro (fin_dre), pedido a pedido: a soma do lucro dos produtos do pedido e' a variacao do lucro bruto do fin_dre
 * causada por ele, menos o frete cobrado (o ranking e' sem frete), mais o frete que o reembolso devolveu (o Financeiro o deduz junto
 * com o reembolso). O grafico do dia fecha com o ranking em todo cenario.
 *
 * PROVAS: os cenarios (novo) x o corpo da 1659 (controle: os que mudam mostram o defeito e a conferencia nova reprova nele); fora do
 * lucro o JSON e' igual nos dois corpos, e sem devolucao o JSON INTEIRO; mutantes (cada um na guarda certa); reaplicar (LF e CRLF),
 * pre-voo, atomicidade, rollback (byte a byte, OID/dono/ACL, dado intacto, o rollback da 1659 recusa por baixo desta), consultas
 * 218a/218b e as fichas antigas que aceitam esta como sucessora.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-frete-de-ida-so-sai-do-lucro-viva.cjs
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  FRETE_SO_QUANDO_DEVOLVIDO,
  HASH_ANALYTICS_DESTA,
  HASH_ANALYTICS_1659,
} = require("./o-frete-de-ida-so-sai-do-lucro-posterior.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const NOME = FRETE_SO_QUANDO_DEVOLVIDO.nome;
const lerMigration = (n) =>
  fs
    .readFileSync(path.join(RAIZ, "supabase", "migrations", n), "utf8")
    .replace(/\r\n/g, "\n");
const lerConsulta = (n) =>
  fs.readFileSync(
    path.join(RAIZ, "scripts", "publicacao", "consultas", `${n}.sql`),
    "utf8",
  );
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

const MIGRATION = lerMigration(NOME);
const ROLLBACK = lerMigration(`rollback-manual-${NOME}`);
const ROLLBACK_1659 = lerMigration(
  "rollback-manual-20261659000000_a_peca_de_produto_excluido_fica_fora_e_o_vale_nao_e_dinheiro.sql",
);
const FICHA_A = lerConsulta(
  "218a-conferir-o-frete-de-ida-so-sai-do-lucro-quando-foi-devolvido-aplicado",
);
const FICHA_B = lerConsulta(
  "218b-antes-o-frete-de-ida-so-sai-do-lucro-quando-foi-devolvido-base-vigente",
);
// As fichas antigas que conferem o corpo do analytics e aceitam o desta como SUCESSORA: com esta no ar elas dizem EXATAMENTE o mesmo
// que com o corpo da 1659 (linha a linha).
const FICHAS_SUCESSORAS = [
  "8e-conferir-92-a-202-aplicado",
  "17a-conferir-estoque-do-painel-aplicado",
  "35a-conferir-lucro-so-com-custo-aplicado",
  "45a-conferir-custo-do-dia-aplicado",
  "48a-conferir-lucro-com-desconto-aplicado",
  "53a-conferir-faturamento-potencial-aplicado",
  "54a-conferir-lucro-do-estoque-aplicado",
  "135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado",
  "146a-conferir-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-aplicado",
  "147a-conferir-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-aplicado",
  "215a-conferir-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-aplicado",
].map((nome) => ({ nome, sql: lerConsulta(nome) }));

const blocoDe = (sql, inicio, fim) => {
  const i = sql.indexOf(inicio);
  assert.ok(i >= 0, `bloco ausente: ${inicio}`);
  assert.equal(sql.indexOf(inicio, i + 1), -1, `bloco repetido: ${inicio}`);
  return sql.slice(i, sql.indexOf(fim, i) + fim.length);
};
const corpoDe = (bloco) => {
  const a = bloco.indexOf("AS $$") + "AS $$".length;
  return bloco.slice(a, bloco.indexOf("$$", a));
};
const CAB =
  "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)";
const ANALYTICS = blocoDe(MIGRATION, CAB, "\n$$;");
const ANALYTICS_1659 = blocoDe(ROLLBACK, CAB, "\n$$;");
const FN = "public.get_admin_analytics_v2(integer)";

const ADMIN = "7e7e1662-0000-4000-8000-0000000000a1";
const CLIENTE = "7e7e1662-0000-4000-8000-0000000000c1";
const cent = (v) => Math.round(Number(v) * 100);

let C;

// ---------------------------------------------------------------- infraestrutura
const um = async (sql, params = []) => (await C.query(sql, params)).rows[0];
const hashVivo = async () =>
  (
    await um(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  )?.h ?? null;
/** OID, dono, ACL e todos os atributos (sem o texto). */
const fotografia = async () =>
  (
    await um(
      "SELECT to_jsonb(p) - 'prosrc' AS f FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
      [FN],
    )
  ).f;
let nSavepoint = 0;
/** Roda `acao` num SAVEPOINT e desfaz tudo (dado e DDL) no fim. */
async function isolado(acao) {
  const nome = `caso1662_${++nSavepoint}`;
  await C.query(`SAVEPOINT ${nome}`);
  try {
    return await acao();
  } finally {
    await C.query(`ROLLBACK TO SAVEPOINT ${nome}`);
    await C.query(`RELEASE SAVEPOINT ${nome}`);
  }
}
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
/** O dado que ja existia: nada disso muda ao aplicar ou desfazer. */
const retrato = async () =>
  (
    await um(`SELECT md5(concat_ws('|',
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.marketplace_orders x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.marketplace_order_items x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.order_refunds x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucoes x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.devolucao_itens x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.produtos x))) AS h`)
  ).h;
const analytics = async () =>
  (await C.query("SELECT public.get_admin_analytics_v2(30) AS r")).rows[0].r;
// O Financeiro: o lucro bruto do periodo que cobre a venda (3 dias atras) e o dinheiro de hoje.
const lucroBrutoFin = async () =>
  Number(
    (
      await C.query(
        "SELECT (public.fin_dre(current_date - 10, current_date + 1) ->> 'lucro_bruto')::numeric AS v",
      )
    ).rows[0].v,
  );

// ---------------------------------------------------------------- fixture (a mesma da prova viva da 3995)
async function produto(nome, preco, custo) {
  const id = crypto.randomUUID();
  await C.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
     VALUES ($1, $2, $3, $4, 1000, true, false)`,
    [id, nome, preco, custo],
  );
  return id;
}
async function pedido({ dias, itens, frete }) {
  const subtotal = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const r = await C.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, discount, shipping, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ('Cliente R1662', '{}'::jsonb, $1, $2, 0, $3, 'delivered', 'online', 'online', 'pago',
             now() - ($4 || ' days')::interval, now() - ($4 || ' days')::interval)
     RETURNING id, to_char((created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS dia`,
    [subtotal + frete, subtotal, frete, String(dias)],
  );
  const ids = [];
  for (const i of itens)
    ids.push(
      (
        await C.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
           VALUES ($1, $2, 'item R1662', $3, $4) RETURNING id`,
          [r.rows[0].id, i.produto, i.qtd, i.preco],
        )
      ).rows[0].id,
    );
  return {
    id: r.rows[0].id,
    dia: r.rows[0].dia,
    itens: ids,
    unitario: itens.map((i) => i.preco),
    estornado: 0,
    total: subtotal + frete,
  };
}
/** Linha do ledger; o acumulado confirmado do pedido (valor_estornado) segue a soma das linhas 'concluido'. */
async function estorno(
  ped,
  amount,
  status = "concluido",
  { por = "lojista", minutos = 0 } = {},
) {
  if (status === "concluido") ped.estornado += amount;
  return (
    await C.query(
      `INSERT INTO public.order_refunds
         (order_id, amount, motivo, solicitado_por, status, concluido_em, created_at)
       VALUES ($1, $2, 'fixture 1662', $4, $3, CASE WHEN $3 = 'concluido' THEN now() END,
               now() + ($5::text || ' minutes')::interval)
       RETURNING id`,
      [ped.id, amount, status, por, minutos],
    )
  ).rows[0].id;
}
const L = (i, qtd, condicao = null, reestocada = false) => ({
  i,
  qtd,
  condicao,
  reestocada,
});
/**
 * UMA devolucao concluida. final: reembolso | vale | troca; `reembolso` = valor_reembolso (null = dado antigo, sem ledger);
 * `frete` = valor_frete_ida gravado; `via`: 'mp' (linha do ledger ligada em refund_id, com a `situacao` dela) ou 'manual' (a loja
 * devolveu fora do app: refund_id solto e reembolso_manual, sem linha no ledger).
 */
async function devolucao(
  ped,
  {
    linhas,
    final = "reembolso",
    reembolso = null,
    frete = 0,
    via = "mp",
    situacao = "concluido",
  },
) {
  const dev = crypto.randomUUID();
  const comDinheiro = final === "reembolso" && reembolso !== null;
  let refundId = null;
  if (comDinheiro && via === "mp")
    refundId = await estorno(ped, reembolso, situacao);
  const valorItens = linhas.reduce((s, l) => s + l.qtd * ped.unitario[l.i], 0);
  await C.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_frete_ida, valor_reembolso, refund_id, reembolso_manual,
       prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, $4, $5, 'desisti', $6, $6, 'local', 'entrega_na_loja', 'concluida', $7::numeric, $8::numeric, $9, $10, $11,
       current_date + 7, '{}'::jsonb, now())`,
    [
      dev,
      `P1662-${dev.slice(0, 8)}`,
      ped.id,
      CLIENTE,
      final === "troca" ? "troca" : "arrependimento",
      final,
      valorItens,
      frete,
      reembolso,
      refundId,
      comDinheiro && via === "manual",
    ],
  );
  for (const l of linhas)
    await C.query(
      `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, condicao, reestocar, reestocado_em)
       VALUES ($1, $2, (SELECT product_id FROM public.marketplace_order_items WHERE id = $2), $3, $4, $5, $6,
               CASE WHEN $6 THEN now() END)`,
      [dev, ped.itens[l.i], l.qtd, ped.unitario[l.i], l.condicao, l.reestocada],
    );
}
const com = (opts) => (ped) => devolucao(ped, opts);
const painelDoMp = (valor) => (ped) =>
  estorno(ped, valor, "concluido", { por: "sistema", minutos: 5 });
const seq =
  (...passos) =>
  async (ped) => {
    for (const p of passos) await p(ped);
  };

const VESTIDO = { preco: 100, custo: 40 };
const BLUSA = { preco: 50, custo: 20 };

/** Monta o cenario e devolve o que a tela mostra: por produto [quantidade, lucro em centavos], o dia do grafico e o Financeiro. */
async function rodar({
  itens = ["v", "b"],
  frete = 0,
  montar = async () => {},
}) {
  const finAntes = await lucroBrutoFin();
  const v = await produto("Vestido R1662", VESTIDO.preco, VESTIDO.custo);
  const b = await produto("Blusa R1662", BLUSA.preco, BLUSA.custo);
  const lista = [];
  if (itens.includes("v"))
    lista.push({ produto: v, qtd: 1, preco: VESTIDO.preco });
  if (itens.includes("b"))
    lista.push({ produto: b, qtd: 1, preco: BLUSA.preco });
  const ped = await pedido({ dias: 3, itens: lista, frete });
  await montar(ped);
  await C.query(
    `UPDATE public.marketplace_orders
        SET valor_estornado = $2::numeric,
            payment_status = CASE WHEN $2::numeric > 0 AND $2::numeric >= total THEN 'estornado' ELSE payment_status END
      WHERE id = $1`,
    [ped.id, ped.estornado],
  );
  const r = await analytics();
  const top = new Map(r.topProducts.map((p) => [p.id, p]));
  const dia = r.revenueHistory.find((d) => d.date === ped.dia);
  const soma = [...top.values()].reduce((s, p) => s + Number(p.total), 0);
  const par = (id) =>
    top.has(id) ? [top.get(id).quantity, cent(top.get(id).total)] : undefined;
  return {
    v: par(v),
    b: par(b),
    soma,
    profitDoDia: dia ? Number(dia.profit) : 0,
    finDelta: (await lucroBrutoFin()) - finAntes,
    json: r,
  };
}

// Cada cenario: o que o corpo NOVO mostra e o que o corpo da 1659 mostrava (`antes`; sem ele, igual), em [quantidade, lucro em
// centavos]. `freteDevolvido` = o frete que o reembolso de fato devolveu (o oraculo: Financeiro - frete cobrado + frete devolvido).
// `fin: false` = o Financeiro conta este caso de outro jeito (troca; dado antigo sem ledger) e nao e oraculo aqui.
const CENARIOS = [
  // ---- (b) so o reembolso que SAIU conta ----
  {
    nome: "(R1) reembolso de R$ 30 PENDENTE ('solicitado') do vestido avariado: +R$ 60 como o Financeiro (antes: +R$ 30)",
    opts: {
      itens: ["v"],
      montar: com({
        linhas: [L(0, 1, "danificada")],
        reembolso: 30,
        situacao: "solicitado",
      }),
    },
    novo: { v: [0, 6000] },
    antes: { v: [0, 3000] },
  },
  {
    nome: "(R2) o mesmo 'em_processamento': +R$ 60 (antes: +R$ 30)",
    opts: {
      itens: ["v"],
      montar: com({
        linhas: [L(0, 1, "danificada")],
        reembolso: 30,
        situacao: "em_processamento",
      }),
    },
    novo: { v: [0, 6000] },
    antes: { v: [0, 3000] },
  },
  {
    nome: "(R3) o mesmo com o reembolso que FALHOU: +R$ 60 (antes: +R$ 30)",
    opts: {
      itens: ["v"],
      montar: com({
        linhas: [L(0, 1, "danificada")],
        reembolso: 30,
        situacao: "falhou",
      }),
    },
    novo: { v: [0, 6000] },
    antes: { v: [0, 3000] },
  },
  {
    nome: "(R4) o mesmo com o reembolso RECUSADO: +R$ 60 (antes: +R$ 30)",
    opts: {
      itens: ["v"],
      montar: com({
        linhas: [L(0, 1, "danificada")],
        reembolso: 30,
        situacao: "recusado",
      }),
    },
    novo: { v: [0, 6000] },
    antes: { v: [0, 3000] },
  },
  {
    nome: "(R5) o mesmo com o reembolso CONCLUIDO: +R$ 30, igual",
    opts: {
      itens: ["v"],
      montar: com({ linhas: [L(0, 1, "danificada")], reembolso: 30 }),
    },
    novo: { v: [0, 3000] },
  },
  {
    nome: "(R6) o mesmo devolvido pela loja FORA do app (reembolso_manual): +R$ 30, igual",
    opts: {
      itens: ["v"],
      montar: com({
        linhas: [L(0, 1, "danificada")],
        reembolso: 30,
        via: "manual",
      }),
    },
    novo: { v: [0, 3000] },
  },
  {
    nome: "(R7) a linha ligada FALHOU e a lojista devolveu R$ 100 pelo painel do Mercado Pago: o dinheiro nao some, o pedido fecha em R$ 30 como o Financeiro",
    opts: {
      montar: seq(
        com({
          linhas: [L(0, 1, "nova", true)],
          reembolso: 100,
          situacao: "falhou",
        }),
        painelDoMp(100),
      ),
    },
    // O reembolso ligado nao saiu (pm 0); os R$ 100 do painel sao residual, rateados pelo que cada peca ainda pagou (100 e 50).
    novo: { v: [0, 3333], b: [1, -333] },
    antes: { v: [0, 0], b: [1, 3000] },
  },
  {
    nome: "(R8) reembolso PENDENTE de R$ 125 com o frete de ida gravado (pedido so com o vestido): nada sai, +R$ 100 (antes: R$ 0)",
    opts: {
      itens: ["v"],
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        reembolso: 125,
        frete: 25,
        situacao: "solicitado",
      }),
    },
    novo: { v: [0, 10000] },
    antes: { v: [0, 0] },
    freteDevolvido: 0,
  },
  // ---- (a) o frete de ida so quando foi devolvido ----
  {
    nome: "(F1) reembolso SEM o frete: a blusa 'Nao veio', so o vestido reembolsado (R$ 100), frete gravado R$ 25: o vestido da R$ 0 (antes: +R$ 25)",
    opts: {
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 100,
        frete: 25,
      }),
    },
    novo: { v: [0, 0], b: [1, 3000] },
    antes: { v: [0, 2500], b: [1, 3000] },
    freteDevolvido: 0,
  },
  {
    nome: "(F2) reembolso SEM o frete com tudo de volta (a lojista corrigiu o valor): R$ 100 de R$ 125, o vestido da R$ 0 (antes: +R$ 25)",
    opts: {
      itens: ["v"],
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        reembolso: 100,
        frete: 25,
      }),
    },
    novo: { v: [0, 0] },
    antes: { v: [0, 2500] },
    freteDevolvido: 0,
  },
  {
    nome: "(F3) reembolso COM o frete sai UMA vez: a blusa avariada com R$ 30 antes, o vestido com R$ 125 (100 + 25): R$ 0 nos dois",
    opts: {
      frete: 25,
      montar: seq(
        com({ linhas: [L(1, 1, "danificada")], reembolso: 30 }),
        com({ linhas: [L(0, 1, "nova", true)], reembolso: 125, frete: 25 }),
      ),
    },
    novo: { v: [0, 0], b: [0, 0] },
    freteDevolvido: 25,
  },
  {
    nome: "(F4) parte do frete: R$ 110 pelo vestido de R$ 100 com frete gravado R$ 25: so R$ 10 de frete sai, o vestido da R$ 0 (antes: +R$ 15)",
    opts: {
      itens: ["v"],
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        reembolso: 110,
        frete: 25,
      }),
    },
    novo: { v: [0, 0] },
    antes: { v: [0, 1500] },
    freteDevolvido: 10,
  },
  {
    nome: "(F5) frete gravado 0 e reembolso de R$ 125 pelo vestido (pedido com a blusa): sem frete gravado os R$ 25 se repartem no pedido, igual a 1659",
    opts: {
      frete: 25,
      montar: com({ linhas: [L(0, 1, "nova", true)], reembolso: 125 }),
    },
    novo: { v: [0, 0], b: [1, 500] },
    freteDevolvido: 0,
  },
  {
    nome: "(F6) reembolso acima das pecas E do frete (R$ 130 = 100 + 25 + 5): o frete sai inteiro e os R$ 5 se repartem, igual",
    opts: {
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        reembolso: 130,
        frete: 25,
      }),
    },
    novo: { v: [0, 0], b: [1, 2500] },
    freteDevolvido: 25,
  },
  {
    nome: "(F7) 'Nao veio' reembolsada inteira sem o frete (R$ 150, frete gravado R$ 25): as pecas vem antes do frete, a blusa da -R$ 20 (antes: +R$ 5)",
    opts: {
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true), L(1, 1, "ausente")],
        reembolso: 150,
        frete: 25,
      }),
    },
    novo: { v: [0, 0], b: [1, -2000] },
    antes: { v: [0, 0], b: [1, 500] },
    freteDevolvido: 0,
  },
  {
    nome: "(F8) pedido inteiro devolvido com o frete (R$ 125, pedido 'estornado'): R$ 0, igual",
    opts: {
      itens: ["v"],
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        reembolso: 125,
        frete: 25,
      }),
    },
    novo: { v: [0, 0] },
    freteDevolvido: 25,
  },
  // ---- o que a 1659 deixou e continua igual ----
  {
    nome: "(V1) vale-troca do vestido com frete gravado R$ 25: o vale nao e dinheiro (+R$ 100), igual a 1659",
    opts: {
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        final: "vale",
        frete: 25,
      }),
    },
    novo: { v: [0, 10000], b: [1, 3000] },
    freteDevolvido: 0,
  },
  {
    nome: "(V2) troca do vestido com frete gravado R$ 25: fora da conta, igual a 1659",
    opts: {
      frete: 25,
      montar: com({
        linhas: [L(0, 1, "nova", true)],
        final: "troca",
        frete: 25,
      }),
    },
    novo: { v: [1, 6000], b: [1, 3000] },
    fin: false,
  },
  {
    nome: "(V3) devolucao de reembolso SEM valor gravado (dado antigo, sem ledger): vale o das pecas que voltaram, igual",
    opts: { montar: com({ linhas: [L(0, 1, "nova", true)], reembolso: null }) },
    novo: { v: [0, 0], b: [1, 3000] },
    fin: false,
  },
  {
    nome: "(V4) pedido com frete e sem devolucao: igual (o JSON inteiro)",
    opts: { frete: 25 },
    novo: { v: [1, 6000], b: [1, 3000] },
    freteDevolvido: 0,
    exato: true,
  },
];

/** O comportamento prometido, cenario a cenario. Lanca no primeiro desvio, com o nome do cenario. */
async function conferir(qual) {
  for (const cen of CENARIOS) {
    await isolado(async () => {
      const m = await rodar(cen.opts);
      const esperado = qual === "novo" ? cen.novo : (cen.antes ?? cen.novo);
      assert.deepEqual(m.v, esperado.v, `${cen.nome}: vestido (${qual})`);
      assert.deepEqual(m.b, esperado.b, `${cen.nome}: blusa (${qual})`);
      assert.ok(
        Math.abs(m.profitDoDia - m.soma) < 1e-6,
        `${cen.nome}: o lucro do dia no grafico (${qual}) nao fecha com o ranking (${m.profitDoDia} x ${m.soma})`,
      );
      if (qual === "novo" && cen.fin !== false) {
        const oraculo =
          m.finDelta - (cen.opts.frete ?? 0) + (cen.freteDevolvido ?? 0);
        assert.ok(
          Math.abs(oraculo - m.soma) < 0.005,
          `${cen.nome}: o Financeiro diz ${oraculo} para este pedido (sem o frete que ficou) e o ranking soma ${m.soma}`,
        );
      }
    });
  }
}
const instalar = (corpoBloco) => C.query(corpoBloco);
const semLucro = (j) => ({
  ...j,
  topProducts: undefined,
  revenueHistory: j.revenueHistory.map((d) => ({ ...d, profit: undefined })),
});
/** Fora do lucro, o JSON e' o mesmo nos dois corpos; sem devolucao, o JSON INTEIRO. */
async function comparar() {
  for (const cen of CENARIOS) {
    const novo = await isolado(() => rodar(cen.opts));
    const antigo = await isolado(async () => {
      await instalar(ANALYTICS_1659);
      return rodar(cen.opts);
    });
    assert.deepEqual(
      semLucro(novo.json),
      semLucro(antigo.json),
      `${cen.nome}: algo alem do lucro mudou no JSON`,
    );
    if (cen.exato) {
      assert.deepEqual(
        { ...novo.json, topProducts: undefined },
        { ...antigo.json, topProducts: undefined },
        `${cen.nome}: sem devolucao o JSON inteiro e' igual`,
      );
      assert.deepEqual([novo.v, novo.b], [antigo.v, antigo.b]);
    }
  }
}

// ---------------------------------------------------------------- mutantes
const troca = (bloco, de, para, vezes = 2) => {
  assert.equal(
    bloco.split(de).length - 1,
    vezes,
    `mutante: ${de.slice(0, 70)}`,
  );
  return bloco.split(de).join(para);
};
const trocaPrimeira = (bloco, de, para) => {
  assert.equal(bloco.split(de).length - 1, 2, `mutante: ${de.slice(0, 70)}`);
  return bloco.replace(de, () => para);
};
const FORMULA =
  "THEN GREATEST(0, dv.valor_reembolso - LEAST(COALESCE(dv.valor_frete_ida, 0), GREATEST(dv.valor_reembolso - x.vv - x.va, 0)))";
const FORMULA_1659 =
  "THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))";
const NAO_SAIU = "AND NOT (dv.reembolso_manual\n";
const CONCLUIDO = "rq.status = 'concluido'))";
const RESIDUAL = "AND dvp.refund_id IS NULL AND dvp.reembolso_manual) g";
const MUTANTES = [
  {
    nome: "o frete sai de todo reembolso (a formula da 1659) nas duas copias",
    sql: troca(ANALYTICS, FORMULA, FORMULA_1659),
  },
  {
    nome: "a formula nova so no ranking (o grafico com a da 1659)",
    sql: trocaPrimeira(ANALYTICS, FORMULA, FORMULA_1659),
  },
  {
    nome: "o frete nunca sai (pm = reembolso)",
    sql: troca(ANALYTICS, FORMULA, "THEN GREATEST(0, dv.valor_reembolso)"),
  },
  {
    nome: "o frete antes das pecas 'Nao veio' (so vv)",
    sql: troca(ANALYTICS, "x.vv - x.va, 0)))", "x.vv, 0)))"),
  },
  {
    nome: "sem o teto do frete gravado (todo o excesso vira frete)",
    sql: troca(
      ANALYTICS,
      "LEAST(COALESCE(dv.valor_frete_ida, 0), GREATEST(dv.valor_reembolso - x.vv - x.va, 0))",
      "GREATEST(dv.valor_reembolso - x.vv - x.va, 0)",
    ),
  },
  {
    nome: "o reembolso que nao saiu volta a contar (sem o ramo 'nao saiu = 0')",
    sql: troca(ANALYTICS, NAO_SAIU, "AND false AND NOT (dv.reembolso_manual\n"),
  },
  {
    nome: "o ramo 'nao saiu = 0' so no ranking (o grafico ainda conta o pendente)",
    sql: trocaPrimeira(
      ANALYTICS,
      NAO_SAIU,
      "AND false AND NOT (dv.reembolso_manual\n",
    ),
  },
  {
    nome: "o reembolso que falhou ou foi recusado conta como saido",
    sql: troca(
      ANALYTICS,
      CONCLUIDO,
      "rq.status IN ('concluido', 'falhou', 'recusado')))",
    ),
  },
  {
    nome: "o pendente conta como saido",
    sql: troca(
      ANALYTICS,
      CONCLUIDO,
      "rq.status IN ('concluido', 'solicitado', 'em_processamento')))",
    ),
  },
  {
    nome: "a devolucao manual nao conta",
    sql: troca(ANALYTICS, NAO_SAIU, "AND NOT (false\n"),
  },
  {
    nome: "o residual ainda desconta o painel do MP da devolucao cuja linha falhou (o dinheiro some)",
    sql: troca(
      ANALYTICS,
      RESIDUAL,
      "AND ((dvp.refund_id IS NULL AND dvp.reembolso_manual) OR EXISTS (SELECT 1 FROM public.order_refunds rlp WHERE rlp.id = dvp.refund_id AND rlp.status IN ('falhou', 'recusado')))) g",
    ),
  },
];

// ---------------------------------------------------------------- fichas
async function linhasDaFicha(sql) {
  const r = await C.query(sql);
  const linhas = Array.isArray(r) ? r[r.length - 1].rows : r.rows;
  return linhas
    .map((l) => JSON.stringify(l))
    .sort()
    .map((l) => JSON.parse(l));
}
async function fichaSoSim(sql, rotulo) {
  const linhas = await linhasDaFicha(sql);
  assert.equal(linhas.length, 6, `${rotulo}: rol de 6`);
  for (const l of linhas)
    assert.equal(l.ok, true, `${rotulo}: ${JSON.stringify(l)}`);
}
async function fichaTemNao(sql, rotulo) {
  const linhas = await linhasDaFicha(sql);
  assert.ok(
    linhas.some((l) => l.ok !== true),
    `${rotulo}: devia acusar algo`,
  );
}
async function fichasSucessoras() {
  const out = {};
  for (const f of FICHAS_SUCESSORAS) out[f.nome] = await linhasDaFicha(f.sql);
  return out;
}

// ---------------------------------------------------------------- as provas
async function provaDoComportamento() {
  await conferir("novo");
  console.log(
    `PASSOU  ${CENARIOS.length} cenarios, ranking E grafico, cada um contra o Financeiro (fin_dre): pendente, em processamento, falhou e recusado nao descontam; concluido e manual descontam; o painel do MP depois da falha nao some; frete sem, com, parte, gravado 0, acima, 'Nao veio' antes do frete, pedido inteiro; vale, troca, dado antigo e sem devolucao iguais`,
  );
}
async function provaDoControle() {
  await isolado(async () => {
    await C.query(ROLLBACK);
    assert.equal(await hashVivo(), HASH_ANALYTICS_1659);
    await conferir("antes");
    // A conferencia nova REPROVA no corpo da 1659, pelo primeiro cenario que o defeito muda.
    await assert.rejects(
      () => conferir("novo"),
      (e) => e.code === "ERR_ASSERTION" && /\(R1\)/.test(e.message),
    );
  });
  console.log(
    "PASSOU  controle: o corpo da 1659 desconta o reembolso pendente/falho/recusado (R1-R4, R8), tira o frete do reembolso que nao o pagou (F1, F2, F4), poe o frete antes da 'Nao veio' (F7) e a conferencia nova reprova nele",
  );
}
async function provaDaComparacao() {
  await comparar();
  console.log(
    "PASSOU  fora do lucro o JSON e' o mesmo nos dois corpos; sem devolucao, o JSON inteiro",
  );
}
async function provaDosMutantes() {
  for (const m of MUTANTES) {
    let morreu = null;
    await isolado(async () => {
      await instalar(m.sql);
      try {
        await conferir("novo");
      } catch (e) {
        morreu = e;
      }
    });
    assert.equal(await hashVivo(), HASH_ANALYTICS_DESTA, "o mutante ficou");
    assert.ok(morreu, `o mutante sobreviveu: ${m.nome}`);
    console.log(
      `PASSOU  mutante morre: ${m.nome} (caiu por: ${String(morreu.message).split("\n")[0].slice(0, 140)})`,
    );
  }
}
async function provaDaMigration() {
  await isolado(async () => {
    const dados = await retrato();
    const foto = await fotografia();
    await fichaSoSim(FICHA_A, "218a depois do apply");
    await fichaSoSim(
      FICHA_B,
      "218b depois do apply (reaplicar e' idempotente)",
    );
    const comEsta = await fichasSucessoras();

    // Reaplicar (LF e CRLF): mesmo estado, nada de dado tocado.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(
      (await tentarSql(MIGRATION.replace(/\n/g, "\r\n"))).erro,
      undefined,
    );
    assert.equal(await hashVivo(), HASH_ANALYTICS_DESTA);
    assert.deepEqual(
      await fotografia(),
      foto,
      "OID, dono, ACL e atributos iguais",
    );
    assert.equal(await retrato(), dados, "reaplicar nao toca dado");

    // O rollback da 1659 recusa por baixo desta (ordem).
    assert.match(
      String((await tentarSql(ROLLBACK_1659)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.equal(await hashVivo(), HASH_ANALYTICS_DESTA);

    // Rollback: o corpo da 1659 byte a byte, sem tocar dado; repetir e' no-op.
    assert.equal((await tentarSql(ROLLBACK)).erro, undefined);
    assert.equal(await hashVivo(), HASH_ANALYTICS_1659);
    assert.deepEqual(
      await fotografia(),
      foto,
      "o rollback preserva OID, dono, ACL e atributos",
    );
    assert.equal(await retrato(), dados, "o rollback nao toca dado");
    await fichaSoSim(FICHA_B, "218b antes do apply");
    await fichaTemNao(FICHA_A, "218a antes do apply");
    assert.deepEqual(
      await fichasSucessoras(),
      comEsta,
      "as fichas antigas dizem o mesmo com esta e com o corpo da 1659",
    );
    assert.equal(
      (await tentarSql(ROLLBACK)).erro,
      undefined,
      "repetir e' no-op",
    );
    assert.equal(await hashVivo(), HASH_ANALYTICS_1659);

    // Atomicidade: a migration que falha no fim nao deixa nada gravado.
    const sabotada = `${MIGRATION}\nDO $x$ BEGIN RAISE EXCEPTION 'sabotada no fim'; END $x$;`;
    assert.match(String((await tentarSql(sabotada)).erro), /sabotada no fim/);
    assert.equal(await hashVivo(), HASH_ANALYTICS_1659, "nada gravado");

    // Apply sobre o dado que ja existia: so o corpo muda.
    assert.equal((await tentarSql(MIGRATION)).erro, undefined);
    assert.equal(await hashVivo(), HASH_ANALYTICS_DESTA);
    assert.deepEqual(await fotografia(), foto);
    assert.equal(await retrato(), dados, "o apply nao toca dado");

    // Pre-voo: corpo estranho recusa a migration e o rollback, sem trocar nada (troca por FUNCAO: "$$" numa string de troca vira "$").
    await C.query(ANALYTICS.replace("\n$$;", () => "\n-- estranho\n$$;"));
    const estranho = await hashVivo();
    assert.notEqual(estranho, HASH_ANALYTICS_DESTA);
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.match(
      String((await tentarSql(ROLLBACK)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    assert.equal(await hashVivo(), estranho, "nada trocado");
    await fichaTemNao(FICHA_A, "218a com corpo estranho");
    await fichaTemNao(FICHA_B, "218b com corpo estranho");
    await C.query(ANALYTICS);
    // EXECUTE aberto ao anon: o pre-voo recusa e as fichas acusam.
    await C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
    assert.match(
      String((await tentarSql(MIGRATION)).erro),
      /B1_BASELINE_DIVERGENT/,
    );
    await fichaTemNao(FICHA_A, "218a com EXECUTE do anon");
  });
  console.log(
    "PASSOU  reaplicar (LF e CRLF), pre-voo (corpo estranho, EXECUTE do anon), atomicidade, rollback (byte a byte, OID/dono/ACL, dado intacto, repetido no-op, o da 1659 recusa por baixo desta), 218a/218b nas duas pontas e as fichas sucessoras iguais",
  );
}

async function main() {
  C = new Client({
    connectionString: lerDatabaseUrlEfemera(),
    statement_timeout: 30000,
  });
  await C.connect();
  try {
    const db = (await um("SELECT current_database() AS d")).d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    // O md5 pinado no modulo posterior e' o do corpo que o arquivo carrega; o do rollback e' o da 1659.
    assert.equal(md5(corpoDe(ANALYTICS)), HASH_ANALYTICS_DESTA);
    assert.equal(md5(corpoDe(ANALYTICS_1659)), HASH_ANALYTICS_1659);
    assert.equal(
      await hashVivo(),
      HASH_ANALYTICS_DESTA,
      "a migration 20261662000000 nao esta no banco efemero",
    );
    await C.query("BEGIN");
    for (const [id, papel, meta] of [
      [ADMIN, "admin", { role: "admin" }],
      [CLIENTE, "customer", {}],
    ]) {
      await C.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@r1662.invalid', $2::jsonb)`,
        [id, JSON.stringify(meta)],
      );
      await C.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Pessoa ficticia R1662', $2) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
        [id, papel],
      );
    }
    await C.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
    // As vendas que ja existiam no clone saem da conta (so nesta transacao): o top 5 e o dia medem so a fixture.
    await C.query("SET LOCAL session_replication_role = replica");
    await C.query("UPDATE public.marketplace_orders SET status = 'cancelled'");
    await C.query("SET LOCAL session_replication_role = origin");

    await provaDoComportamento();
    await provaDoControle();
    await provaDaComparacao();
    await provaDosMutantes();
    await provaDaMigration();
    await C.query("ROLLBACK");
  } finally {
    await C.end().catch(() => {});
  }
  console.log(
    `\no-frete-de-ida-so-sai-do-lucro-viva: ${CENARIOS.length} cenarios, ${MUTANTES.length} mutantes mortos (20261662000000)`,
  );
}

main().catch((erro) => falhar("FRETE-DE-IDA-1662", erro.stack ?? String(erro)));

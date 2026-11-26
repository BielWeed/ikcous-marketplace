"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Um arquivo SQL local do repositorio, com nome literal fechado. */
/**
 * MEDICAO (nao e portao de tempo) do Financeiro e do Inicio numa loja de 5 anos, contra o Postgres EFEMERO
 * com as migrations aplicadas do zero (rpc-ci, job do dinheiro, CLONE proprio pelo rodar-isolado). Nunca
 * banco de loja; todo dado aqui e inventado.
 *
 * Por que existe: o CTE `vendas` de public.fin__movimentos (corpo vigente: 20261391200000, linhas 164-280)
 * e MATERIALIZADO (usado 2x) e le TODOS os pedidos pagos, com fin__dia por pedido, em toda chamada — mesmo
 * quando a tela pede so o mes. Antes de mexer no corpo, esta prova mede quanto isso custa de verdade:
 *
 *  (1) Semente em SQL (generate_series), SO neste clone e com session_replication_role = replica (sem
 *      gatilhos nem chaves estrangeiras durante a carga; volta a origin antes de medir): 50.000 pedidos em
 *      5 anos (70% online pago, 20% recebido na entrega, 10% balcao), 3% com order_refunds (metade concluida
 *      no mes seguinte, 10% pendentes), 1% estornado fora do app (metade sem estorno_manual_registrado_em),
 *      1% com devolucao concluida e reembolso manual, 3.000 lancamentos variados, 1 item por pedido e o
 *      historico 'recebido' dos pedidos pagos na entrega/balcao. VACUUM ANALYZE no fim (estatistica viva).
 *  (2) Mediana de 3, como admin ATUAL (auth.users + profiles, app.rpc.user_id): painel_inicio(),
 *      fin_resumo(mes), fin_resumo(ano), fin_extrato(30d), fin_extrato(ano), fin_dre(mes),
 *      fin_previstos('saida'); por dentro fin__movimentos(NULL,NULL), fin__movimentos(mes), crm__vendas(now()).
 *  (3) Variantes no MESMO banco, cada uma numa transacao DESFEITA (ROLLBACK) depois de medir:
 *      B = corpo vigente com `vendas AS NOT MATERIALIZED` + rede larga na coluna crua (±1 dia em UTC, trava
 *          1900/9999); o filtro exato final continua o mesmo;
 *      C = B + fin__dia / fin__conta_da_forma / fin__forma_do_pedido colados no corpo (texto VIVO de cada
 *          ajudante, lido do pg_proc).
 *      Cada variante devolve as MESMAS linhas que o corpo vigente nas janelas medidas (md5 das linhas), senao a
 *      prova sai vermelha no fim — numero de uma variante errada nao serve para decidir nada.
 *  (4) EXPLAIN (ANALYZE, BUFFERS) de fin__movimentos(mes): a chamada e o corpo com plano GENERICO (como a
 *      funcao SQL nao-inlinada planeja: parametros como $1/$2), para o corpo vigente, B e C.
 *
 * Saida para ler: `gh run view <id> --log` e procurar `ESCALA` (tabela funcao x atual/B/C em ms) e `PORTAO:`.
 * Nao falha por tempo; so aborta se UMA consulta passar de 60 s (statement_timeout), com mensagem clara.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-financeiro-em-escala-medida.cjs
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, anexarAoSummary } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME_VIGENTE =
  "20261391200000_o_financeiro_descreve_a_venda_do_balcao_como_o_app_mostra.sql";
const migrationVigente = fs
  .readFileSync(path.join(RAIZ, "supabase", "migrations", NOME_VIGENTE), "utf8")
  .replace(/\r/g, "");
const CORPO_VIGENTE = migrationVigente.match(
  /CREATE OR REPLACE FUNCTION public\.fin__movimentos\(p_inicio date, p_fim date\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
)[1];
const CABECALHO = migrationVigente.match(
  /CREATE OR REPLACE FUNCTION public\.fin__movimentos\(p_inicio date, p_fim date\)[\s\S]*?\nAS \$\$/,
)[0];
const HASH_VIGENTE = "26473edd94ad6547d95de43433088304";
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

const U_ADMIN = "5ca1e000-0000-4000-8000-000000000001";
const PEDIDOS = 50000;
const LANCAMENTOS = 3000;
const TETO_MS = 60000;
// Orcamento da medicao inteira: o job do dinheiro tem teto de 30 min e roda outras ~300 provas. Passou disto,
// a variante seguinte e pulada (e a tabela diz isso) em vez de derrubar o job por timeout.
const ORCAMENTO_MS = 10 * 60 * 1000;

class Lenta extends Error {}

// ---------------------------------------------------------------------------------------------------------
// Variantes do corpo (texto). Cada troca exige achar o trecho EXATAMENTE uma vez.
// ---------------------------------------------------------------------------------------------------------
function trocarUma(texto, de, para) {
  const partes = texto.split(de);
  if (partes.length !== 2)
    throw new Error(
      `variante: o trecho ${JSON.stringify(de.slice(0, 60))} aparece ${partes.length - 1}x no corpo vigente (esperado 1)`,
    );
  return partes.join(para);
}

// Rede larga na coluna CRUA: o dia de Sao Paulo D cobre instantes de D 00:00 a D+1 00:00 no fuso da loja, e o
// fuso de Sao Paulo de 1900 a 9999 fica entre UTC-2 e UTC-3:06 (hora local de 1914) — entao [D-1, D+2) em UTC
// contem o dia D inteiro. Fora de 1900..9999 a rede se abre (-infinity/infinity) em vez de calcular data fora
// da faixa do timestamp. NULL nos limites continua "sem limite". O filtro exato (t.data) segue no fim do corpo.
const rede = (
  coluna,
) => `(p_inicio IS NULL OR ${coluna} >= CASE WHEN p_inicio < DATE '1900-01-02'
         THEN '-infinity'::timestamptz ELSE ((p_inicio - 1)::timestamp AT TIME ZONE 'UTC') END)
       AND (p_fim IS NULL OR ${coluna} < CASE WHEN p_fim > DATE '9999-12-29'
         THEN 'infinity'::timestamptz ELSE ((p_fim + 2)::timestamp AT TIME ZONE 'UTC') END)`;

function varianteB(corpo) {
  let b = trocarUma(
    corpo,
    "WITH vendas AS (",
    "WITH vendas AS NOT MATERIALIZED (",
  );
  b = trocarUma(
    b,
    "      FROM vendas v\n    UNION ALL\n    SELECT 'estorno:'",
    `      FROM vendas v\n     WHERE ${rede("COALESCE(v.pagamento_recebido_em, v.paid_at)")}\n    UNION ALL\n    SELECT 'estorno:'`,
  );
  b = trocarUma(
    b,
    "     WHERE v.payment_status = 'estornado'\n",
    `     WHERE v.payment_status = 'estornado'\n       AND ${rede("COALESCE(v.estorno_manual_registrado_em, v.updated_at)")}\n`,
  );
  return b;
}

/** Divide os argumentos de uma chamada no nivel de cima (respeita parenteses e texto entre aspas simples). */
function lerChamada(texto, inicio) {
  // `inicio` aponta para o "(" da chamada. Devolve { args, fim } com fim = indice depois do ")".
  const args = [];
  let nivel = 0;
  let aspas = false;
  let atual = "";
  for (let i = inicio; i < texto.length; i += 1) {
    const ch = texto.charAt(i);
    if (aspas) {
      atual += ch;
      if (ch === "'") aspas = false;
      continue;
    }
    if (ch === "'") {
      aspas = true;
      atual += ch;
    } else if (ch === "(") {
      nivel += 1;
      if (nivel > 1) atual += ch;
    } else if (ch === ")") {
      nivel -= 1;
      if (nivel === 0) {
        args.push(atual.trim());
        return { args, fim: i + 1 };
      }
      atual += ch;
    } else if (ch === "," && nivel === 1) {
      args.push(atual.trim());
      atual = "";
    } else {
      atual += ch;
    }
  }
  throw new Error("variante C: chamada sem fechar parentese");
}

/** Cola o corpo VIVO de um ajudante SQL (`SELECT <expr>`) no lugar de cada `public.<nome>(...)`. */
function colarAjudante(corpo, ajudante) {
  const chamada = `public.${ajudante.nome}(`;
  const expr = ajudante.prosrc
    .replace(/\r/g, "")
    .trim()
    .replace(/^SELECT\s+/i, "")
    .replace(/;\s*$/, "");
  let saida = "";
  let resto = corpo;
  let trocas = 0;
  for (;;) {
    const onde = resto.indexOf(chamada);
    if (onde < 0) break;
    const { args, fim } = lerChamada(resto, onde + chamada.length - 1);
    if (args.length !== ajudante.parametros.length)
      throw new Error(
        `variante C: ${ajudante.nome} chamado com ${args.length} argumentos`,
      );
    const porNome = new Map(ajudante.parametros.map((p, k) => [p, args.at(k)]));
    const colado = expr.replace(/\b[a-z_][a-z0-9_]*\b/gi, (palavra) =>
      porNome.has(palavra) ? `(${porNome.get(palavra)})` : palavra,
    );
    saida += `${resto.slice(0, onde)}(${colado})`;
    resto = resto.slice(fim);
    trocas += 1;
  }
  if (trocas === 0)
    throw new Error(`variante C: ${ajudante.nome} nao aparece no corpo`);
  return { corpo: saida + resto, trocas };
}

// ---------------------------------------------------------------------------------------------------------
// Semente (so neste clone). Ids com prefixo proprio: 5ca1a = pedido, 5ca1b = estorno, 5ca1c = cliente,
// 5ca1d = devolucao, 5ca1e = admin.
// ---------------------------------------------------------------------------------------------------------
const UUID = (prefixo, expr) =>
  `('${prefixo}-0000-4000-8000-' || lpad(to_hex(${expr}), 12, '0'))::uuid`;

const SEMENTE = [
  [
    "admin atual e 2.000 clientes",
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ('${U_ADMIN}', 'admin@escala.teste', '{"role":"admin"}'::jsonb);
     INSERT INTO auth.users (id, email)
       SELECT ${UUID("5ca1c000", "k")}, 'cliente' || k || '@escala.teste' FROM generate_series(1, 2000) AS k;
     INSERT INTO public.profiles (id, full_name, role) VALUES ('${U_ADMIN}', 'Admin Escala', 'admin')
       ON CONFLICT (id) DO UPDATE SET role = 'admin';`,
  ],
  [
    "50.000 pedidos em 5 anos",
    // tipo por i % 10: 0-6 online pago (70%), 7-8 recebido na entrega (20%), 9 balcao (10%).
    // Estornado fora do app: i % 200 em (21, 179) = 1% (online e balcao); metade sem o carimbo (i / 200 par).
    `SELECT setseed(0.42);
     WITH s AS MATERIALIZED (
       SELECT i,
              ${UUID("5ca1a000", "i")} AS id,
              CASE WHEN i % 10 <= 6 THEN 'online' WHEN i % 10 <= 8 THEN 'entrega' ELSE 'balcao' END AS tipo,
              i % 200 IN (21, 179) AS estornado_fora,
              now() - random() * interval '1826 days' AS instante,
              round((20 + random() * 480)::numeric, 2) AS total,
              i % 5000 AS k
         FROM generate_series(1, ${PEDIDOS}) AS i
     )
     INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, metodo_online,
        payment_status, paid_at, pagamento_recebido_em, valor_estornado, estorno_manual_registrado_em,
        created_at, updated_at)
     SELECT s.id,
            CASE WHEN s.tipo = 'online' AND s.i % 2 = 0 THEN ${UUID("5ca1c000", "s.i % 2000 + 1")} END,
            CASE WHEN s.tipo = 'balcao' AND s.i % 3 = 0 THEN 'Venda no balcão' ELSE 'Cliente fictício ' || s.k END,
            CASE WHEN s.tipo = 'balcao' AND s.i % 3 = 0 THEN '{}'::jsonb
                 ELSE jsonb_build_object('whatsapp', '(34) 9' || lpad(s.k::text, 4, '0') || '-' || lpad((s.k % 97)::text, 4, '0'),
                                         'email', 'cliente' || s.k || '@escala.teste') END,
            s.total, s.total,
            CASE WHEN s.estornado_fora THEN 'cancelled'
                 WHEN s.instante > now() - interval '2 days' THEN 'processing' ELSE 'delivered' END,
            CASE WHEN s.tipo = 'balcao' THEN 'presencial' ELSE 'online' END,
            CASE WHEN s.tipo = 'online' THEN 'online' ELSE (ARRAY['cash', 'pix', 'card'])[(s.i / 10) % 3 + 1] END,
            CASE WHEN s.tipo = 'online' THEN (ARRAY['pix', 'credito', 'debito'])[(s.i / 10) % 3 + 1] END,
            CASE WHEN s.estornado_fora THEN 'estornado' WHEN s.tipo = 'online' THEN 'pago' ELSE 'recebido_na_entrega' END,
            CASE WHEN s.tipo = 'online' THEN s.instante END,
            CASE WHEN s.tipo <> 'online' THEN s.instante END,
            0,
            CASE WHEN s.estornado_fora AND (s.i / 200) % 2 = 0 THEN LEAST(s.instante + interval '3 days', now()) END,
            s.instante - interval '5 minutes',
            LEAST(s.instante + CASE WHEN s.estornado_fora THEN interval '5 days' ELSE interval '1 minute' END, now())
       FROM s;`,
  ],
  [
    "3% com estorno do app (10% pendentes; metade das concluidas no mes seguinte)",
    `INSERT INTO public.order_refunds
       (id, order_id, amount, motivo, solicitado_por, status, created_at, updated_at, concluido_em)
     SELECT ${UUID("5ca1b000", "i")}, o.id, round(o.total * 0.5, 2), 'arrependimento', 'lojista',
            CASE WHEN i % 1000 IN (11, 12) THEN 'solicitado' WHEN i % 1000 = 13 THEN 'em_processamento'
                 ELSE 'concluido' END,
            LEAST(o.paid_at + interval '1 hour', now()), LEAST(o.paid_at + interval '1 hour', now()),
            CASE WHEN i % 1000 IN (11, 12, 13) THEN NULL
                 WHEN (i / 100) % 2 = 0 THEN LEAST(date_trunc('month', o.paid_at) + interval '1 month 3 days', now())
                 ELSE LEAST(o.paid_at + interval '1 day', now()) END
       FROM generate_series(1, ${PEDIDOS}) AS i
       JOIN public.marketplace_orders o ON o.id = ${UUID("5ca1a000", "i")}
      WHERE i % 100 IN (11, 12, 13);
     UPDATE public.marketplace_orders o SET valor_estornado = r.amount
       FROM public.order_refunds r
      WHERE r.order_id = o.id AND r.status = 'concluido' AND r.id::text LIKE '5ca1b000-%';`,
  ],
  [
    "1% com devolucao concluida e reembolso manual",
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, valor_itens,
        prazo_ate, politica, status, reembolso_manual, valor_reembolso, created_at, concluida_em)
     SELECT ${UUID("5ca1d000", "i")}, 'DVESC' || i, o.id,
            COALESCE(o.user_id, ${UUID("5ca1c000", "1")}),
            'vicio', 'defeito', 'reembolso', 'local', 'entrega_na_loja', round(o.total * 0.4, 2),
            (o.paid_at + interval '30 days')::date, '{}'::jsonb, 'concluida', true, round(o.total * 0.4, 2),
            LEAST(o.paid_at + interval '2 days', now()), LEAST(o.paid_at + interval '10 days', now())
       FROM generate_series(1, ${PEDIDOS}) AS i
       JOIN public.marketplace_orders o ON o.id = ${UUID("5ca1a000", "i")}
      WHERE i % 100 = 33;`,
  ],
  [
    "1 item por pedido e o historico 'recebido' dos pagos na entrega/balcao",
    `INSERT INTO public.marketplace_order_items (order_id, product_name, quantity, price, created_at)
     SELECT o.id, 'Produto fictício', 1, o.total, o.created_at
       FROM public.marketplace_orders o WHERE o.id::text LIKE '5ca1a000-%';
     INSERT INTO public.marketplace_order_payment_history
       (order_id, acao, payment_status_antes, payment_status_depois, created_at)
     SELECT o.id, 'recebido', NULL, 'recebido_na_entrega', o.pagamento_recebido_em
       FROM public.marketplace_orders o
      WHERE o.id::text LIKE '5ca1a000-%' AND o.pagamento_recebido_em IS NOT NULL;`,
  ],
  [
    "3.000 lancamentos (saida/entrada/transferencia; realizado/previsto/cancelado)",
    `INSERT INTO public.fin_lancamentos
       (tipo, status, valor, conta_id, conta_destino_id, categoria_id, descricao, forma_pagamento,
        data_competencia, data_vencimento, data_realizacao)
     SELECT l.tipo, l.status, l.valor, l.conta,
            CASE WHEN l.tipo = 'transferencia' THEN l.destino END,
            CASE WHEN l.tipo <> 'transferencia' THEN l.categoria END,
            'Lançamento fictício ' || l.k, l.forma,
            l.dia, CASE WHEN l.status = 'previsto' THEN l.dia END, CASE WHEN l.status = 'realizado' THEN l.dia END
       FROM (
         SELECT k,
                CASE WHEN k % 10 < 6 THEN 'saida' WHEN k % 10 < 9 THEN 'entrada' ELSE 'transferencia' END AS tipo,
                CASE WHEN k % 23 = 0 THEN 'cancelado' WHEN k % 7 = 0 THEN 'previsto' ELSE 'realizado' END AS status,
                round((10 + (k * 37) % 2000 + (k % 100) / 100.0)::numeric, 2) AS valor,
                (ARRAY['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002',
                       'f1000000-0000-4000-8000-000000000003'])[k % 3 + 1]::uuid AS conta,
                (ARRAY['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002',
                       'f1000000-0000-4000-8000-000000000003'])[(k + 1) % 3 + 1]::uuid AS destino,
                CASE WHEN k % 10 < 6
                     THEN (ARRAY['f2000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000012',
                                 'f2000000-0000-4000-8000-000000000013', 'f2000000-0000-4000-8000-000000000014',
                                 'f2000000-0000-4000-8000-000000000020', 'f2000000-0000-4000-8000-000000000021',
                                 'f2000000-0000-4000-8000-000000000022', 'f2000000-0000-4000-8000-000000000023',
                                 'f2000000-0000-4000-8000-000000000024', 'f2000000-0000-4000-8000-000000000025',
                                 'f2000000-0000-4000-8000-000000000030', 'f2000000-0000-4000-8000-000000000040'])
                          [k % 12 + 1]::uuid
                     ELSE (ARRAY['f2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000003',
                                 'f2000000-0000-4000-8000-000000000004'])[k % 3 + 1]::uuid END AS categoria,
                (ARRAY['pix', 'dinheiro', 'cartao', 'boleto', 'transferencia'])[k % 5 + 1] AS forma,
                -- Previsto: de 30 dias atras a 90 dias na frente (o a pagar/receber de verdade); o resto em 5 anos.
                CASE WHEN k % 7 = 0 AND k % 23 <> 0 THEN public.fin__hoje() - 30 + (k % 120)
                     ELSE public.fin__hoje() - 1826 + (k * 1826 / ${LANCAMENTOS}) END AS dia
           FROM generate_series(1, ${LANCAMENTOS}) AS k
       ) l;`,
  ],
];

async function semear(c) {
  await c.query("SET session_replication_role = replica");
  try {
    for (const [nome, sql] of SEMENTE) {
      const t0 = Date.now();
      await c.query(sql);
      console.log(`  semente: ${nome} (${Date.now() - t0} ms)`);
    }
  } finally {
    await c.query("SET session_replication_role = origin");
  }
  await c.query(
    `VACUUM (ANALYZE) public.marketplace_orders, public.order_refunds, public.devolucoes, public.fin_lancamentos,
       public.marketplace_order_items, public.marketplace_order_payment_history, public.profiles, auth.users`,
  );
  const conta = (
    await c.query(
      `SELECT (SELECT count(*) FROM public.marketplace_orders WHERE id::text LIKE '5ca1a000-%')::int AS pedidos,
              (SELECT count(*) FROM public.order_refunds WHERE id::text LIKE '5ca1b000-%')::int AS estornos,
              (SELECT count(*) FROM public.order_refunds
                WHERE id::text LIKE '5ca1b000-%' AND status <> 'concluido')::int AS estornos_pendentes,
              (SELECT count(*) FROM public.marketplace_orders
                WHERE id::text LIKE '5ca1a000-%' AND payment_status = 'estornado')::int AS estornados_fora,
              (SELECT count(*) FROM public.marketplace_orders
                WHERE id::text LIKE '5ca1a000-%' AND payment_status = 'estornado'
                  AND estorno_manual_registrado_em IS NULL)::int AS estornados_sem_carimbo,
              (SELECT count(*) FROM public.devolucoes WHERE id::text LIKE '5ca1d000-%')::int AS devolucoes,
              (SELECT count(*) FROM public.fin_lancamentos WHERE descricao LIKE 'Lançamento fictício %')::int
                AS lancamentos,
              (SELECT min(COALESCE(pagamento_recebido_em, paid_at))::date::text FROM public.marketplace_orders
                WHERE id::text LIKE '5ca1a000-%') AS primeiro,
              (SELECT max(COALESCE(pagamento_recebido_em, paid_at))::date::text FROM public.marketplace_orders
                WHERE id::text LIKE '5ca1a000-%') AS ultimo`,
    )
  ).rows[0];
  const esperado = {
    pedidos: PEDIDOS,
    estornos: 1500,
    estornos_pendentes: 150,
    estornados_fora: 500,
    estornados_sem_carimbo: 250,
    devolucoes: 500,
    lancamentos: LANCAMENTOS,
  };
  for (const [chave, valor] of Object.entries(esperado)) {
    const lido = new Map(Object.entries(conta)).get(chave);
    if (lido !== valor)
      throw new Error(`semente: ${chave} = ${lido} (esperado ${valor})`);
  }
  console.log(
    `  SEMENTE ok: ${JSON.stringify(conta)} (as contagens batem com o desenho)`,
  );
}

// ---------------------------------------------------------------------------------------------------------
// Medicao
// ---------------------------------------------------------------------------------------------------------
async function cronometrar(c, rotulo, sql, params) {
  const t0 = process.hrtime.bigint();
  try {
    await c.query(sql, params);
  } catch (e) {
    if (e.code === "57014")
      throw new Lenta(
        `${rotulo} passou de ${TETO_MS / 1000} s (statement_timeout) — o Financeiro nesta escala nem responde`,
      );
    throw e;
  }
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

async function mediana3(c, rotulo, sql, params) {
  const tempos = [];
  for (let k = 0; k < 3; k += 1)
    tempos.push(await cronometrar(c, rotulo, sql, params));
  const [, meio] = [...tempos].sort((a, b) => a - b);
  return { meio, tempos };
}

function consultas(d) {
  // [rotulo, sql, params, papel]: "admin" = funcao do app (como admin atual); "dono" = ajudante interno.
  const json = (f) => `SELECT octet_length((${f})::text) AS n`;
  return [
    ["painel_inicio()", json("public.painel_inicio()"), [], "admin"],
    [
      "fin_resumo(mes)",
      json("public.fin_resumo($1::date, $2::date)"),
      [d.mes_ini, d.mes_fim],
      "admin",
    ],
    [
      "fin_resumo(ano)",
      json("public.fin_resumo($1::date, $2::date)"),
      [d.ano_ini, d.hoje],
      "admin",
    ],
    [
      "fin_extrato(30d)",
      json("public.fin_extrato($1::date, $2::date)"),
      [d.d30_ini, d.hoje],
      "admin",
    ],
    [
      "fin_extrato(ano)",
      json("public.fin_extrato($1::date, $2::date)"),
      [d.ano_ini, d.hoje],
      "admin",
    ],
    [
      "fin_dre(mes)",
      json("public.fin_dre($1::date, $2::date)"),
      [d.mes_ini, d.mes_fim],
      "admin",
    ],
    [
      "fin_previstos('saida')",
      json("public.fin_previstos('saida')"),
      [],
      "admin",
    ],
    [
      "fin__movimentos(NULL,NULL)",
      "SELECT count(*) FROM public.fin__movimentos(NULL, NULL)",
      [],
      "dono",
    ],
    [
      "fin__movimentos(mes)",
      "SELECT count(*) FROM public.fin__movimentos($1::date, $2::date)",
      [d.mes_ini, d.mes_fim],
      "dono",
    ],
    [
      "crm__vendas(now())",
      "SELECT count(*) FROM public.crm__vendas(now())",
      [],
      "dono",
    ],
  ];
}

async function papel(c, qual) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    qual === "admin" ? U_ADMIN : "",
  ]);
}

// Impressao das linhas de cada janela: a variante tem de devolver exatamente o mesmo conjunto.
async function impressoes(c, d) {
  const janelas = [
    ["NULL,NULL", null, null],
    ["mes", d.mes_ini, d.mes_fim],
    ["30d", d.d30_ini, d.hoje],
    ["ano", d.ano_ini, d.hoje],
  ];
  const saida = new Map();
  for (const [nome, ini, fim] of janelas) {
    const r = (
      await c.query(
        `SELECT count(*)::int AS n, md5(COALESCE(string_agg(m::text, E'\\n' ORDER BY m::text), '')) AS h
           FROM public.fin__movimentos($1::date, $2::date) m`,
        [ini, fim],
      )
    ).rows[0];
    saida.set(nome, `${r.n} linhas, md5 ${r.h}`);
  }
  return saida;
}

async function explicar(c, rotulo, corpo, d) {
  const plano = async (sql) =>
    (await c.query(sql)).rows.map((r) => `  | ${r["QUERY PLAN"]}`).join("\n");
  // EXPLAIN EXECUTE nao aceita parametro de bind: as datas entram como literal, e so depois de conferir o formato
  // (vem do proprio banco, fin__hoje()::text).
  for (const data of [d.mes_ini, d.mes_fim])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data))
      throw new Error(`data fora do formato: ${data}`);
  const mes = `DATE '${d.mes_ini}', DATE '${d.mes_fim}'`;
  console.log(
    `\n--- EXPLAIN (ANALYZE, BUFFERS) fin__movimentos(mes) [${rotulo}] — a chamada ---`,
  );
  console.log(
    await plano(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM public.fin__movimentos(${mes})`,
    ),
  );
  // O corpo como a funcao SQL nao-inlinada o planeja: parametros como $1/$2 e plano generico.
  // (substituicao por funcao: "$1" como texto de troca seria lido como grupo de captura)
  const comParametros = corpo
    .replace(/\bp_inicio\b/g, () => "$1")
    .replace(/\bp_fim\b/g, () => "$2");
  await c.query("SET plan_cache_mode = force_generic_plan");
  await c.query(`PREPARE fin_mov_escala(date, date) AS ${comParametros}`);
  try {
    console.log(
      `--- EXPLAIN (ANALYZE, BUFFERS) fin__movimentos(mes) [${rotulo}] — o corpo, plano generico ---`,
    );
    console.log(
      await plano(`EXPLAIN (ANALYZE, BUFFERS) EXECUTE fin_mov_escala(${mes})`),
    );
  } finally {
    await c.query("DEALLOCATE fin_mov_escala");
    await c.query("RESET plan_cache_mode");
  }
}

async function medirVariante(c, rotulo, corpo, d, referencia) {
  await c.query("BEGIN");
  try {
    if (corpo !== CORPO_VIGENTE) await c.query(`${CABECALHO}${corpo}$$;`);
    const vivo = (
      await c.query(
        "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = 'public.fin__movimentos(date,date)'::regprocedure",
      )
    ).rows[0].h;
    if (vivo !== md5(corpo))
      throw new Error(`[${rotulo}] o corpo instalado nao e o da variante`);
    const tempos = new Map();
    for (const [nome, sql, params, quem] of consultas(d)) {
      await papel(c, quem);
      const { meio, tempos: brutos } = await mediana3(
        c,
        `[${rotulo}] ${nome}`,
        sql,
        params,
      );
      tempos.set(nome, meio);
      console.log(
        `  [${rotulo}] ${nome}: mediana ${meio.toFixed(1)} ms (${brutos.map((t) => t.toFixed(1)).join(" / ")})`,
      );
    }
    await papel(c, "dono");
    const linhas = await impressoes(c, d);
    const divergencias = [];
    if (referencia)
      for (const [janela, impressao] of linhas)
        if (referencia.get(janela) !== impressao)
          divergencias.push(
            `${janela}: ${impressao} (vigente: ${referencia.get(janela)})`,
          );
    for (const [janela, impressao] of linhas)
      console.log(`  [${rotulo}] linhas ${janela}: ${impressao}`);
    await explicar(c, rotulo, corpo, d);
    return { tempos, linhas, divergencias };
  } finally {
    await c.query("ROLLBACK");
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  const inicio = Date.now();
  try {
    // ---- 0. O corpo vivo e o da 20261391200000 (nenhuma migration posterior o recriou). ----
    const vivo = (
      await c.query(
        "SELECT replace(prosrc, E'\\r', '') AS s FROM pg_proc WHERE oid = 'public.fin__movimentos(date,date)'::regprocedure",
      )
    ).rows[0].s;
    if (md5(vivo) !== HASH_VIGENTE || vivo !== CORPO_VIGENTE)
      throw new Error(
        `o corpo vivo de fin__movimentos (md5 ${md5(vivo)}) nao e o da ${NOME_VIGENTE} — uma migration posterior o recriou; refaca as variantes sobre ele`,
      );
    const ambiente = (
      await c.query(
        `SELECT current_setting('server_version') AS versao, current_setting('jit') AS jit,
                current_setting('work_mem') AS work_mem, current_setting('shared_buffers') AS shared_buffers,
                current_setting('TimeZone') AS fuso`,
      )
    ).rows[0];
    console.log(
      `[o-financeiro-em-escala] Postgres ${ambiente.versao}, jit=${ambiente.jit}, work_mem=${ambiente.work_mem}, shared_buffers=${ambiente.shared_buffers}, TimeZone=${ambiente.fuso}`,
    );

    // ---- 1. Semente. ----
    await semear(c);

    // ---- 2. As variantes (texto) e o texto VIVO dos ajudantes. ----
    const corpoB = varianteB(CORPO_VIGENTE);
    let corpoC = corpoB;
    const ajudantes = (
      await c.query(
        `SELECT p.proname AS nome, p.prosrc, p.proargnames AS parametros
           FROM pg_proc p
          WHERE p.oid IN ('public.fin__dia(timestamptz)'::regprocedure,
                          'public.fin__conta_da_forma(text)'::regprocedure,
                          'public.fin__forma_do_pedido(text,text)'::regprocedure)
          ORDER BY p.proname`,
      )
    ).rows;
    for (const ajudante of ajudantes) {
      const { corpo, trocas } = colarAjudante(corpoC, ajudante);
      corpoC = corpo;
      console.log(
        `  variante C: ${ajudante.nome} colado em ${trocas} lugares (${ajudante.prosrc.trim().replace(/\s+/g, " ")})`,
      );
    }
    if (/public\.fin__(dia|conta_da_forma|forma_do_pedido)\(/.test(corpoC))
      throw new Error("variante C: sobrou chamada de ajudante no corpo");

    const d = (
      await c.query(
        `SELECT public.fin__hoje()::text AS hoje,
                date_trunc('month', public.fin__hoje())::date::text AS mes_ini,
                ((date_trunc('month', public.fin__hoje()) + interval '1 month')::date - 1)::text AS mes_fim,
                (public.fin__hoje() - 29)::text AS d30_ini,
                (public.fin__hoje() - 364)::text AS ano_ini`,
      )
    ).rows[0];
    console.log(
      `  janelas: hoje=${d.hoje} mes=${d.mes_ini}..${d.mes_fim} 30d=${d.d30_ini}..${d.hoje} ano=${d.ano_ini}..${d.hoje}`,
    );

    // ---- 3. Medir atual, B e C (cada uma numa transacao desfeita). ----
    await c.query(`SET statement_timeout = '${TETO_MS}ms'`);
    const resultados = new Map();
    const pulos = [];
    let referencia = null;
    for (const [rotulo, corpo] of [
      ["atual", CORPO_VIGENTE],
      ["B", corpoB],
      ["C", corpoC],
    ]) {
      if (rotulo !== "atual" && Date.now() - inicio > ORCAMENTO_MS) {
        pulos.push(rotulo);
        console.log(
          `  [${rotulo}] PULADA: a medicao passou do orcamento de ${ORCAMENTO_MS / 60000} min`,
        );
        continue;
      }
      console.log(`\n== medindo [${rotulo}] ==`);
      const r = await medirVariante(c, rotulo, corpo, d, referencia);
      if (!referencia) referencia = r.linhas;
      resultados.set(rotulo, r);
    }
    await c.query("RESET statement_timeout");

    // ---- 4. A tabela ESCALA e a linha do portao. ----
    const ms = (rotulo, nome) => {
      const r = resultados.get(rotulo);
      return r ? r.tempos.get(nome) : undefined;
    };
    const fmt = (v) => (v === undefined ? "-" : v.toFixed(1));
    const pct = (novo, velho) =>
      novo === undefined || velho === undefined || velho === 0
        ? "-"
        : `${(((velho - novo) / velho) * 100).toFixed(0)}%`;
    const nomes = consultas(d).map(([nome]) => nome);
    const cab = `${"funcao".padEnd(28)}${"atual".padStart(11)}${"B".padStart(11)}${"C".padStart(11)}${"B vs atual".padStart(12)}${"C vs B".padStart(9)}`;
    const linhasTabela = nomes.map(
      (nome) =>
        `${nome.padEnd(28)}${fmt(ms("atual", nome)).padStart(11)}${fmt(ms("B", nome)).padStart(11)}${fmt(ms("C", nome)).padStart(11)}${pct(ms("B", nome), ms("atual", nome)).padStart(12)}${pct(ms("C", nome), ms("B", nome)).padStart(9)}`,
    );
    console.log(
      `\nESCALA — mediana de 3 em ms; ${PEDIDOS} pedidos em 5 anos, ${LANCAMENTOS} lancamentos ("B vs atual" e "C vs B" = quanto caiu)`,
    );
    console.log(`ESCALA | ${cab}`);
    for (const l of linhasTabela) console.log(`ESCALA | ${l}`);
    if (pulos.length)
      console.log(
        `ESCALA | variantes puladas pelo orcamento: ${pulos.join(", ")}`,
      );

    const painel = ms("atual", "painel_inicio()");
    const crm = ms("atual", "crm__vendas(now())");
    const portao = `PORTAO: atual painel_inicio=${fmt(painel)} ms, fin_resumo(ano)=${fmt(ms("atual", "fin_resumo(ano)"))}, fin_extrato(ano)=${fmt(ms("atual", "fin_extrato(ano)"))}; crm__vendas=${fmt(crm)} (${((crm / painel) * 100).toFixed(0)}% do painel_inicio)`;
    console.log(portao);

    const divergencias = [];
    for (const [rotulo, r] of resultados)
      for (const dv of r.divergencias) divergencias.push(`[${rotulo}] ${dv}`);
    anexarAoSummary(
      "Financeiro em escala (medicao, nao e portao)",
      [
        `${PEDIDOS} pedidos em 5 anos, ${LANCAMENTOS} lancamentos; mediana de 3 em ms.`,
        "",
        "| funcao | atual | B | C | B vs atual | C vs B |",
        "|---|---:|---:|---:|---:|---:|",
        ...nomes.map(
          (nome) =>
            `| ${nome} | ${fmt(ms("atual", nome))} | ${fmt(ms("B", nome))} | ${fmt(ms("C", nome))} | ${pct(ms("B", nome), ms("atual", nome))} | ${pct(ms("C", nome), ms("B", nome))} |`,
        ),
        "",
        `\`${portao}\``,
        divergencias.length
          ? `\n**DIVERGENCIA**: ${divergencias.join("; ")}`
          : "",
      ].join("\n"),
    );

    // Variante que devolve outras linhas: os numeros dela nao valem — vermelho (nao e tempo, e conjunto errado).
    if (divergencias.length) {
      console.error(
        `\nDIVERGENCIA: a variante devolveu outro conjunto de linhas:\n  ${divergencias.join("\n  ")}`,
      );
      process.exitCode = 1;
      return;
    }
    const medidas = [...resultados.keys()].filter((r) => r !== "atual");
    console.log(
      `\n[o-financeiro-em-escala] medicao concluida em ${((Date.now() - inicio) / 1000).toFixed(0)} s; variantes medidas (${medidas.join(", ") || "nenhuma"}) devolvem as mesmas linhas do corpo vigente nas 4 janelas.`,
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

main().catch((e) => {
  if (e instanceof Lenta) console.error(`\n[LENTA] ${e.message}\n`);
  else console.error(e);
  process.exit(1);
});

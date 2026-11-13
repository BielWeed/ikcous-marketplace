"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices de objeto vem de listas fechadas do proprio arquivo. */
/**
 * PROVA VIVA da migration 20261399980000_as_listas_do_painel_nao_repetem_nem_escondem_ninguem_entre_as_paginas.sql
 * (get_admin_products_paged, get_admin_orders_paged e get_admin_orders_cancelados_recentes: desempate pelo id no fim do
 * ORDER BY) contra o Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de loja.
 * Roda num CLONE (rodar-isolado.cjs): a fixture e as trocas de corpo sao COMMITADAS, porque a prova usa varias conexoes
 * (o pool do PostgREST), cada uma com o planejador empurrado para um lado.
 *
 * O que prova:
 *  (1) Com 100 registros de MESMA data por lista (mais 2 mais novos e 3 mais antigos), as paginas lidas em tamanhos de 10, 12
 *      e 20 devolvem cada registro UMA vez, na mesma ordem (a escolhida primeiro, depois o id crescente), por qualquer mistura
 *      de conexoes e planos. Produtos, Pedidos (inclusive o pedido do numero digitado na frente) e Cancelados.
 *  (2) CONTROLE: os tres corpos anteriores (pelo rollback-manual) repetem e escondem registros no plano que ordena (o defeito).
 *  (3) MUTANTES (sem desempate, campo que nao e unico, id invertido, id antes da data, id antes do numero digitado) reprovam
 *      as MESMAS asserções.
 *  (4) So a ordem muda: para varios filtros, o conjunto de linhas, o JSON de cada linha, o total_count e o fora_da_janela sao
 *      iguais no corpo novo e no anterior; lista vazia e pagina alem do fim.
 *  (5) A guarda de admin ficou: cliente comum recusado, anon sem EXECUTE, admin le.
 *  (6) Reaplicar 2x deixa OID, dono, ACL, atributos e texto iguais; o rollback devolve os tres corpos byte a byte; rollback
 *      de novo e estado misto recusam sem escrever; reaplicar depois do rollback (e sobre estado misto) volta.
 *  (7) Pre-voo recusa sem escrever: corpo desconhecido, ACL aberta para anon, sobrecarga, id sem chave primaria. A migration
 *      inteira, mandada numa conexao SEM BEGIN com a conferencia final sabotada, nao deixa nada gravado.
 *  (8) Consultas 140a/140b leem o estado certo nos dois sentidos, com o rol fechado do conferir-banco; as vizinhas (8e, 9a, 85a,
 *      86a, 90a, 92a, 119a, 125a) aceitam o corpo novo e o anterior e reprovam corpo estranho.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/as-listas-do-painel-nao-repetem-ninguem-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261399980000_as_listas_do_painel_nao_repetem_nem_escondem_ninguem_entre_as_paginas.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

// As tres funcoes: a migration anterior (o corpo vigente), os md5 e o par (trecho antigo -> trecho novo) que a migration troca.
const FUNCOES = {
  produtos: {
    nome: "get_admin_products_paged",
    assinatura:
      "public.get_admin_products_paged(text,text,text,text,integer,integer)",
    anterior:
      "20261399200000_a_busca_de_produtos_do_painel_acha_por_palavras.sql",
    hVigente: "346063e900b8b7b63dfbeffe5070eedc",
    hNovo: "0f153b653338f6570da399493093cfae",
    de: "        ORDER BY p.data_cadastro DESC\n        LIMIT p_page_size\n",
    para:
      "        ORDER BY p.data_cadastro DESC,\n" +
      "            -- Desempate pelo id (unico): produtos cadastrados no mesmo instante (importacao, duplicar, grade) saiam numa\n" +
      "            -- ordem que podia mudar de uma pagina para outra, e a paginacao por OFFSET repetia um e escondia outro\n" +
      "            -- (20261399980000). A ordem escolhida continua mandando.\n" +
      "            p.id\n" +
      "        LIMIT p_page_size\n",
  },
  pedidos: {
    nome: "get_admin_orders_paged",
    assinatura:
      "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)",
    anterior:
      "20261399900000_a_busca_de_pedidos_acha_o_telefone_colado_com_o_55.sql",
    hVigente: "bf08545275eaa451a65e15feceb0ed8d",
    hNovo: "b404a8397a6490c86fb192d85fd5b6c9",
    de: "            END,\n            o.created_at DESC\n        LIMIT p_page_size\n",
    para:
      "            END,\n" +
      "            o.created_at DESC,\n" +
      "            -- Desempate pelo id (unico): pedidos do mesmo instante (importacao, balcao, lote) saiam numa ordem que podia\n" +
      "            -- mudar de uma pagina para outra, e a paginacao por OFFSET repetia um e escondia outro (20261399980000).\n" +
      "            -- O pedido do numero digitado continua primeiro e a data continua mandando.\n" +
      "            o.id\n" +
      "        LIMIT p_page_size\n",
  },
  cancelados: {
    nome: "get_admin_orders_cancelados_recentes",
    assinatura:
      "public.get_admin_orders_cancelados_recentes(integer,integer,integer)",
    anterior:
      "20261380000000_o_aviso_de_cancelados_antigos_conta_so_pendencia_real.sql",
    hVigente: "9567454f17698f3f0624cca0b06458cd",
    hNovo: "80ec13f92e224b21d5308a063e88fb6e",
    de:
      "             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC\n" +
      "             LIMIT p_page_size\n",
    para:
      "             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC,\n" +
      "                      -- Desempate pelo id (unico): cancelamentos do mesmo instante (cancelar em lote) saiam numa ordem que\n" +
      "                      -- podia mudar de uma pagina para outra, e a paginacao por OFFSET repetia um e escondia outro\n" +
      "                      -- (20261399980000). A ordem de atencao do cancelamento continua mandando.\n" +
      "                      o.id\n" +
      "             LIMIT p_page_size\n",
  },
};
const CHAVES = Object.keys(FUNCOES);

/** O CREATE OR REPLACE inteiro (cabecalho + corpo) de UMA funcao de um arquivo, e o corpo (prosrc) entre as aspas de dolar. */
function definicaoDe(sql, nome) {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assert.equal(
    sql.split(marca).length - 1,
    1,
    `${nome}: uma definicao por arquivo`,
  );
  const ini = sql.indexOf(marca);
  const m = /\nAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  const fecha = sql.indexOf(`${m[1]};`, abre);
  return {
    cabecalho: sql.slice(ini, abre),
    corpo: sql.slice(abre, fecha),
    delim: m[1],
  };
}
for (const k of CHAVES) {
  const f = FUNCOES[k];
  const ant = definicaoDe(ler(`supabase/migrations/${f.anterior}`), f.nome);
  const nov = definicaoDe(migration, f.nome);
  const rb = definicaoDe(rollback, f.nome);
  f.cabecalho = nov.cabecalho;
  f.delim = nov.delim;
  f.corpoVigente = ant.corpo;
  f.corpoNovo = nov.corpo;
  assert.equal(
    ant.cabecalho,
    nov.cabecalho,
    `${f.nome}: cabecalho igual ao da anterior`,
  );
  assert.equal(
    rb.corpo,
    ant.corpo,
    `${f.nome}: o rollback devolve o corpo da anterior byte a byte`,
  );
}
const trocarCorpo = (c, f, corpo) =>
  c.query(`${f.cabecalho}${corpo}${f.delim};`);

// Ids FIXOS (a ordem de hash e a de id ficam as mesmas em todo run). O heap NAO esta na ordem do id: o id e um md5.
const uuidDe = (semente) => {
  const h = crypto.createHash("md5").update(semente).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const ADMIN = "e3998000-1399-4000-8000-000000000001";
const CLIENTE = "e3998000-1399-4000-8000-000000000002";
const N_EMPATADOS = 100;
const TAMANHOS = [10, 12, 20];
const idsEmpatados = (rotulo) =>
  Array.from({ length: N_EMPATADOS }, (_, i) => uuidDe(`${rotulo}-${i}`));
const porId = (ids) => [...ids].sort();
const NOVOS = (rotulo) => [
  uuidDe(`${rotulo}-novo-a`),
  uuidDe(`${rotulo}-novo-b`),
]; // mais novo primeiro
const ANTIGOS = (rotulo) => [
  uuidDe(`${rotulo}-antigo-a`),
  uuidDe(`${rotulo}-antigo-b`),
  uuidDe(`${rotulo}-antigo-c`),
]; // mais novo primeiro
const TOTAL = N_EMPATADOS + 2 + 3;

// Datas explicitas (o padrao das colunas e o now() da transacao, que empata tudo; aqui o empate e escolhido).
const agora = Date.now();
const DIA = 86400000;
const iso = (diasAtras, minutos = 0) =>
  new Date(agora - diasAtras * DIA + minutos * 60000).toISOString();
const T_EMPATE = iso(20);
const T_PROD = {
  novos: [iso(10), iso(11)],
  empate: T_EMPATE,
  antigos: [iso(30), iso(31), iso(32)],
};
const T_PEDIDO = T_PROD; // pedidos 'pending' seguem as mesmas datas
const T_CANCELADO = {
  novos: [iso(3), iso(4)], // updated_at (a data do cancelamento sem historico)
  empate: iso(5),
  antigos: [iso(40), iso(41), iso(42)], // ainda dentro da janela de 90 dias
};

const ESPERADO = {};
// Produtos: novos (data desc), empatados (id asc), antigos (data desc).
ESPERADO.produtos = [
  ...NOVOS("prod"),
  ...porId(idsEmpatados("prod")),
  ...ANTIGOS("prod"),
];
ESPERADO.pedidos = [
  ...NOVOS("ped"),
  ...porId(idsEmpatados("ped")),
  ...ANTIGOS("ped"),
];
ESPERADO.cancelados = [
  ...NOVOS("can"),
  ...porId(idsEmpatados("can")),
  ...ANTIGOS("can"),
];
// O pedido do numero digitado: o ULTIMO id dos empatados (o que nao seria o primeiro por id). Os empatados tem o final do id no nome.
const PEDIDO_DO_NUMERO = porId(idsEmpatados("ped")).at(-1);
const NUMERO = PEDIDO_DO_NUMERO.slice(-6).toUpperCase();
const ESPERADO_BUSCA = [
  PEDIDO_DO_NUMERO,
  ...porId(idsEmpatados("ped")).filter((id) => id !== PEDIDO_DO_NUMERO),
];

async function funcao(c, f) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${f.assinatura}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
const todas = async (c) => {
  const out = {};
  for (const k of CHAVES) out[k] = await funcao(c, FUNCOES[k]);
  return out;
};
async function hashes(c) {
  const t = await todas(c);
  return Object.fromEntries(CHAVES.map((k) => [k, md5(t[k].prosrc)]));
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa3998");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa3998");
    await c.query("RELEASE SAVEPOINT recusa3998");
  }
}
async function isolado(c, acao) {
  await c.query("BEGIN");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK");
  }
}

async function fixture(c) {
  await c.query("BEGIN");
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@listas3998.teste', '{"role":"admin"}'), ($2, 'cliente@listas3998.teste', '{}')`,
    [ADMIN, CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Listas', 'admin'), ($2, 'Cliente Listas', 'customer')",
    [ADMIN, CLIENTE],
  );
  // Produtos: nome igual entre os empatados (um desempate por nome nao serve), datas explicitas.
  const produto = (id, nome, quando, extra = "NULL") =>
    c.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, ativo, data_cadastro, ultima_atualizacao, deleted_at)
       VALUES ($1, $2, 10, true, $3, $3, ${extra})`,
      [id, nome, quando],
    );
  for (const [i, id] of NOVOS("prod").entries())
    await produto(id, `Produto novo ${i}`, T_PROD.novos[i]);
  for (const id of idsEmpatados("prod"))
    await produto(id, "Produto empatado", T_PROD.empate);
  for (const [i, id] of ANTIGOS("prod").entries())
    await produto(id, `Produto antigo ${i}`, T_PROD.antigos[i]);
  // Um produto APAGADO empatado: nunca aparece em nenhuma pagina.
  await produto(
    uuidDe("prod-apagado"),
    "Produto empatado",
    T_PROD.empate,
    "now()",
  );
  // Pedidos: sem gatilho (session_replication_role = replica), datas explicitas. Os empatados tem o numero digitado no nome.
  await c.query("SET LOCAL session_replication_role = replica");
  const pedido = (id, nome, status, quando, atualizado, pagamento = "NULL") =>
    c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, created_at, updated_at)
       VALUES ($1, $2, $3, '{}'::jsonb, 50, 50, $4, 'online', 'online', ${pagamento}, $5, $6)`,
      [id, CLIENTE, nome, status, quando, atualizado],
    );
  for (const [i, id] of NOVOS("ped").entries())
    await pedido(
      id,
      `Pedido novo ${i}`,
      "pending",
      T_PEDIDO.novos[i],
      T_PEDIDO.novos[i],
    );
  for (const id of idsEmpatados("ped"))
    await pedido(
      id,
      `Pedido empatado ${NUMERO}`,
      "pending",
      T_PEDIDO.empate,
      T_PEDIDO.empate,
    );
  for (const [i, id] of ANTIGOS("ped").entries())
    await pedido(
      id,
      `Pedido antigo ${i}`,
      "pending",
      T_PEDIDO.antigos[i],
      T_PEDIDO.antigos[i],
    );
  // Cancelados: created_at e updated_at empatados (a data do cancelamento sem historico e o updated_at).
  for (const [i, id] of NOVOS("can").entries())
    await pedido(
      id,
      `Cancelado novo ${i}`,
      "cancelled",
      iso(60),
      T_CANCELADO.novos[i],
    );
  for (const id of idsEmpatados("can"))
    await pedido(
      id,
      "Cancelado empatado",
      "cancelled",
      iso(60),
      T_CANCELADO.empate,
    );
  for (const [i, id] of ANTIGOS("can").entries())
    await pedido(
      id,
      `Cancelado antigo ${i}`,
      "cancelled",
      iso(60),
      T_CANCELADO.antigos[i],
    );
  // Tres cancelados de ha 200 dias, PAGOS e nao estornados: ficam FORA da janela e contam em fora_da_janela (so o conjunto muda de lugar).
  for (let i = 0; i < 3; i++)
    await pedido(
      uuidDe(`can-fora-${i}`),
      `Cancelado fora ${i}`,
      "cancelled",
      iso(210),
      iso(200),
      "'pago'",
    );
  await c.query("COMMIT");
}

/** Uma conexao do "pool", logada como admin, com o planejador empurrado para um lado. */
async function conexao(url, ajustes) {
  const c = new Client({ connectionString: url });
  await c.connect();
  for (const a of ajustes) await c.query(a);
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [ADMIN]);
  return c;
}
// Os argumentos de uma chamada de CADA lista (pagina 0, 10 por pagina).
const ARGS = {
  produtos: "'', 'all', 'all', 'all', 0, 10",
  pedidos: "'', 'all', '', '', 0, 10, 'all', 'all'",
  cancelados: "90, 0, 10",
};
// Chamada de CADA lista (devolve o JSON da pagina).
const CHAMADAS = {
  produtos: (c, pagina, tam) =>
    c.query(
      "SELECT public.get_admin_products_paged('', 'all', 'all', 'all', $1, $2) AS r",
      [pagina, tam],
    ),
  pedidos: (c, pagina, tam, busca = "") =>
    c.query(
      "SELECT public.get_admin_orders_paged($1, $2, '', '', $3, $4, 'all', 'all') AS r",
      [busca, busca ? "pending" : "pending", pagina, tam],
    ),
  cancelados: (c, pagina, tam) =>
    c.query(
      "SELECT public.get_admin_orders_cancelados_recentes(90, $1, $2) AS r",
      [pagina, tam],
    ),
};
/** Le a lista inteira, pagina a pagina, cada pagina pela conexao da vez. Devolve os ids na ordem em que a tela os mostraria. */
async function lerLista(chave, quem, tam, busca) {
  const ids = [];
  let total = null;
  for (let n = 0; ; n++) {
    const conn = quem[n % quem.length];
    const r = (await CHAMADAS[chave](conn, n, tam, busca)).rows[0].r;
    if (total === null) total = Number(r.total_count);
    assert.equal(
      Number(r.total_count),
      total,
      `${chave}: total_count mudou entre paginas`,
    );
    ids.push(...r.data.map((l) => l.id));
    if (r.data.length < tam || ids.length >= total + tam) break;
  }
  return { ids, total };
}
// O que a prova assere sobre UMA lista num corpo: o total, a ordem exata e nenhum repetido, por todas as misturas de conexoes e tamanhos.
async function verificar(chave, conns) {
  const { plano, ordena, sem_incremental: semInc, seq } = conns;
  const misturas = [
    ["so o plano de sempre", [plano]],
    ["so o que ordena (sem indice)", [ordena]],
    ["so sem incremental sort", [semInc]],
    ["so seqscan desligado", [seq]],
    [
      "misturadas (plano, ordena, sem incremental, seq)",
      [plano, ordena, semInc, seq],
    ],
    ["misturadas (ordena, plano)", [ordena, plano]],
  ];
  for (const tam of TAMANHOS)
    for (const [rotulo, quem] of misturas) {
      const { ids, total } = await lerLista(chave, quem, tam);
      assert.equal(
        total,
        TOTAL,
        `${chave} (${rotulo}, ${tam}/pagina): total_count`,
      );
      assert.equal(
        new Set(ids).size,
        ids.length,
        `${chave} (${rotulo}, ${tam}/pagina): alguem apareceu mais de uma vez`,
      );
      assert.deepEqual(
        ids,
        ESPERADO[chave],
        `${chave} (${rotulo}, ${tam}/pagina): a ordem tem de ser a escolhida e, entre empatados, o id crescente`,
      );
    }
  if (chave === "pedidos")
    for (const tam of TAMANHOS)
      for (const quem of [[plano], [ordena], [ordena, plano, semInc]]) {
        const { ids } = await lerLista("pedidos", quem, tam, NUMERO);
        assert.deepEqual(
          ids,
          ESPERADO_BUSCA,
          `pedidos: o numero digitado vai na frente e os demais por id (${tam}/pagina)`,
        );
      }
}
/** Quantos registros somem, no total, nas leituras do plano que ORDENA (o defeito: o desempate esta no plano, nao no corpo). */
async function sumidos(chave, conns) {
  let perdidos = 0;
  for (const tam of TAMANHOS)
    for (const quem of [[conns.ordena], [conns.seq]]) {
      const { ids } = await lerLista(chave, quem, tam);
      perdidos += Math.max(TOTAL - new Set(ids).size, 0);
    }
  return perdidos;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  const abertas = [c];
  try {
    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o das tres migrations anteriores. ----
    const topo = await todas(c);
    for (const k of CHAVES) {
      const f = FUNCOES[k];
      assert.equal(
        topo[k].prosrc,
        f.corpoNovo,
        `${f.nome}: o topo instalado nao e o da 20261399980000`,
      );
      assert.equal(md5(topo[k].prosrc), f.hNovo);
      assert.equal(
        md5(f.corpoVigente),
        f.hVigente,
        `${f.nome}: o anterior nao e o da ${f.anterior}`,
      );
      assert.equal(
        f.corpoVigente.split(f.de).length - 1,
        1,
        `${f.nome}: o trecho antigo existe UMA vez`,
      );
      assert.equal(
        f.corpoVigente.replace(f.de, () => f.para),
        f.corpoNovo,
        `${f.nome}: o corpo novo tem de ser o anterior mais o desempate, e nada mais`,
      );
    }
    console.log(
      "  PASSOU o topo instalado e os tres corpos desta migration (md5 conhecido; so o desempate mudou)",
    );

    await fixture(c);
    // Quatro conexoes com planos diferentes para a MESMA chamada: no PostgREST cada pagina pode cair numa conexao diferente do pool.
    const conns = {
      plano: await conexao(url, []),
      ordena: await conexao(url, [
        "SET enable_indexscan = off",
        "SET enable_bitmapscan = off",
        "SET enable_indexonlyscan = off",
      ]),
      sem_incremental: await conexao(url, [
        "SET enable_incremental_sort = off",
      ]),
      seq: await conexao(url, ["SET enable_seqscan = off"]),
    };
    abertas.push(...Object.values(conns));

    // ---- 1. Corpo novo: cada registro UMA vez, a mesma ordem por qualquer combinacao de conexoes e tamanhos de pagina. ----
    for (const k of CHAVES) await verificar(k, conns);
    console.log(
      `  PASSOU as tres listas (${TOTAL} registros, ${N_EMPATADOS} de mesma data) em paginas de ${TAMANHOS.join(", ")} devolvem cada registro uma vez, na mesma ordem, por 4 conexoes/planos e misturas; o numero digitado vai na frente`,
    );

    // ---- 2. CONTROLE: os tres corpos anteriores repetem e escondem registros. ----
    await c.query(rollback);
    assert.deepEqual(
      await hashes(c),
      Object.fromEntries(CHAVES.map((k) => [k, FUNCOES[k].hVigente])),
    );
    const defeito = {};
    for (const k of CHAVES) {
      defeito[k] = await sumidos(k, conns);
      assert.ok(
        defeito[k] > 0,
        `${k}: o corpo anterior deveria esconder registros no plano que ordena (o defeito medido)`,
      );
    }
    console.log(
      `  PASSOU controle: os corpos anteriores escondem registros nas mesmas paginas (produtos ${defeito.produtos}, pedidos ${defeito.pedidos}, cancelados ${defeito.cancelados})`,
    );
    // ---- 3. MUTANTES: cada um tem de reprovar as MESMAS asserções (o plano que ordena, ou a ordem exata). ----
    const mutantes = {
      produtos: [
        ["sem desempate", (f) => f.corpoVigente],
        [
          "desempate por campo que nao e unico (nome)",
          (f) =>
            f.corpoNovo.replace("            p.id\n", "            p.nome\n"),
        ],
        [
          "desempate por outro carimbo igual (ultima_atualizacao)",
          (f) =>
            f.corpoNovo.replace(
              "            p.id\n",
              "            p.ultima_atualizacao\n",
            ),
        ],
        [
          "id invertido",
          (f) =>
            f.corpoNovo.replace(
              "            p.id\n",
              "            p.id DESC\n",
            ),
        ],
        [
          "id antes da data",
          (f) =>
            f.corpoVigente.replace(
              f.de,
              () =>
                "        ORDER BY p.id,\n            p.data_cadastro DESC\n        LIMIT p_page_size\n",
            ),
        ],
      ],
      pedidos: [
        ["sem desempate", (f) => f.corpoVigente],
        [
          "desempate por campo que nao e unico (customer_name)",
          (f) =>
            f.corpoNovo.replace(
              "            o.id\n",
              "            o.customer_name\n",
            ),
        ],
        [
          "desempate por outro carimbo igual (updated_at)",
          (f) =>
            f.corpoNovo.replace(
              "            o.id\n",
              "            o.updated_at\n",
            ),
        ],
        [
          "id invertido",
          (f) =>
            f.corpoNovo.replace(
              "            o.id\n",
              "            o.id DESC\n",
            ),
        ],
        [
          "id antes da data",
          (f) =>
            f.corpoVigente.replace(
              f.de,
              () =>
                "            END,\n            o.id,\n            o.created_at DESC\n        LIMIT p_page_size\n",
            ),
        ],
        [
          "id antes do numero digitado",
          (f) =>
            f.corpoNovo.replace(
              "        ORDER BY\n            CASE\n",
              "        ORDER BY\n            o.id,\n            CASE\n",
            ),
        ],
      ],
      cancelados: [
        ["sem desempate", (f) => f.corpoVigente],
        [
          "desempate por campo que nao e unico (customer_name)",
          (f) =>
            f.corpoNovo.replace(
              "                      o.id\n",
              "                      o.customer_name\n",
            ),
        ],
        [
          "desempate por outro carimbo igual (o.created_at de novo)",
          (f) =>
            f.corpoNovo.replace(
              "                      o.id\n",
              "                      o.created_at\n",
            ),
        ],
        [
          "id invertido",
          (f) =>
            f.corpoNovo.replace(
              "                      o.id\n",
              "                      o.id DESC\n",
            ),
        ],
        [
          "id antes da data",
          (f) =>
            f.corpoVigente.replace(
              f.de,
              () =>
                "             ORDER BY o.id, COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC\n             LIMIT p_page_size\n",
            ),
        ],
      ],
    };
    let totalMutantes = 0;
    for (const k of CHAVES)
      for (const [rotulo, fazer] of mutantes[k]) {
        const f = FUNCOES[k];
        const corpo = fazer(f);
        if (rotulo !== "sem desempate")
          assert.notEqual(
            corpo,
            f.corpoNovo,
            `${k}/${rotulo}: o mutante nao mudou nada`,
          );
        await trocarCorpo(c, f, corpo);
        // Tem de reprovar por ASSERCAO (a ordem ou o total errados), nunca por erro de SQL do mutante.
        await assert.rejects(
          () => verificar(k, conns),
          (e) => {
            assert.equal(
              e.code,
              "ERR_ASSERTION",
              `${k}: o mutante "${rotulo}" falhou por outro motivo: ${e.message}`,
            );
            return true;
          },
          `${k}: o mutante "${rotulo}" passou pelas asserções`,
        );
        totalMutantes += 1;
        await trocarCorpo(c, f, f.corpoVigente);
      }
    console.log(
      `  PASSOU ${totalMutantes} mutantes reprovam as mesmas asserções (sem desempate, campo que nao e unico, outro carimbo igual, id invertido, id antes da data, id antes do numero digitado)`,
    );

    // ---- 4. So a ordem muda: o conjunto, o JSON de cada linha, o total e o fora_da_janela sao os mesmos. ----
    const foto = async () => {
      const out = {};
      const lerTudo = async (rotulo, sql, params) => {
        const r = (await conns.plano.query(sql, params)).rows[0].r;
        out[rotulo] = {
          total: r.total_count,
          fora: r.fora_da_janela ?? null,
          linhas: [...r.data].sort((a, b) => (a.id < b.id ? -1 : 1)),
        };
      };
      for (const [nome, cat, status, estoque, busca] of [
        ["todos", "all", "all", "all", ""],
        ["so ativos", "all", "active", "all", ""],
        ["so inativos", "all", "inactive", "all", ""],
        ["estoque baixo", "all", "all", "low", ""],
        ["categoria que nao existe", "nao-existe", "all", "all", ""],
        ["busca 'empatado'", "all", "all", "all", "empatado"],
        ["busca sem resultado", "all", "all", "all", "zzzqq"],
      ])
        await lerTudo(
          `produtos/${nome}`,
          "SELECT public.get_admin_products_paged($1, $2, $3, $4, 0, 1000) AS r",
          [busca, cat, status, estoque],
        );
      for (const [nome, busca, status, pag, canal, ini, fim] of [
        ["todos", "", "all", "all", "all", "", ""],
        ["pendentes", "", "pending", "all", "all", "", ""],
        ["cancelados", "", "cancelled", "all", "all", "", ""],
        ["em aberto", "", "open", "all", "all", "", ""],
        ["pagos", "", "all", "pago", "all", "", ""],
        ["sem cobranca", "", "all", "sem_cobranca", "all", "", ""],
        ["canal presencial", "", "all", "all", "presencial", "", ""],
        ["periodo", "", "all", "all", "all", iso(25), iso(15)],
        ["busca por nome", "empatado", "all", "all", "all", "", ""],
        ["busca pelo numero", NUMERO, "all", "all", "all", "", ""],
        ["busca sem resultado", "zzzqq", "all", "all", "all", "", ""],
      ])
        await lerTudo(
          `pedidos/${nome}`,
          "SELECT public.get_admin_orders_paged($1, $2, $3, $4, 0, 1000, $5, $6) AS r",
          [busca, status, ini, fim, pag, canal],
        );
      for (const dias of [90, 365, 1, null])
        await lerTudo(
          `cancelados/${dias}`,
          "SELECT public.get_admin_orders_cancelados_recentes($1, 0, 1000) AS r",
          [dias],
        );
      // pagina alem do fim: lista vazia e o mesmo total
      out["produtos/alem do fim"] = (
        await conns.plano.query(
          "SELECT public.get_admin_products_paged('', 'all', 'all', 'all', 50, 10) AS r",
        )
      ).rows[0].r;
      out["pedidos/alem do fim"] = (
        await conns.plano.query(
          "SELECT public.get_admin_orders_paged('', 'all', '', '', 50, 10, 'all', 'all') AS r",
        )
      ).rows[0].r;
      out["cancelados/alem do fim"] = (
        await conns.plano.query(
          "SELECT public.get_admin_orders_cancelados_recentes(90, 50, 10) AS r",
        )
      ).rows[0].r;
      return out;
    };
    const antigo = await foto();
    await c.query(migration);
    assert.deepEqual(
      await hashes(c),
      Object.fromEntries(CHAVES.map((k) => [k, FUNCOES[k].hNovo])),
    );
    const novo = await foto();
    assert.deepEqual(Object.keys(novo), Object.keys(antigo));
    for (const chave of Object.keys(antigo))
      assert.deepEqual(
        novo[chave],
        antigo[chave],
        `${chave}: o conjunto, o JSON das linhas, o total ou o fora_da_janela mudou`,
      );
    // as fotos tem conteudo: a lista vazia e' vazia de verdade e a de cancelados fora da janela conta os 3 de 200 dias
    assert.equal(novo["produtos/busca sem resultado"].linhas.length, 0);
    assert.equal(Number(novo["produtos/busca sem resultado"].total), 0);
    assert.equal(novo["pedidos/busca sem resultado"].linhas.length, 0);
    assert.equal(novo["produtos/alem do fim"].data.length, 0);
    assert.equal(Number(novo["produtos/alem do fim"].total_count), TOTAL);
    assert.equal(novo["pedidos/alem do fim"].data.length, 0);
    assert.equal(novo["cancelados/alem do fim"].data.length, 0);
    assert.ok(
      Number(novo["cancelados/90"].fora) >= 3,
      "o fora_da_janela deveria contar os 3 cancelados pagos de 200 dias",
    );
    assert.equal(
      novo["cancelados/null"].linhas.length,
      novo["cancelados/null"].total,
      "p_dias NULL: sem janela, todos dentro",
    );
    assert.equal(novo["cancelados/null"].fora, 0);
    console.log(
      `  PASSOU o conjunto achado, o JSON de cada linha, o total e o fora_da_janela sao os mesmos do corpo anterior (${Object.keys(novo).length} chamadas; lista vazia e pagina alem do fim incluidas)`,
    );

    // ---- 5. A guarda de admin ficou: cliente comum recusado, anon sem EXECUTE, admin le. ----
    await isolado(c, async () => {
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [
        CLIENTE,
      ]);
      for (const k of CHAVES) {
        const f = FUNCOES[k];
        await recusa(c, `SELECT public.${f.nome}(${ARGS[k]})`, /Acesso negado/);
      }
      await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
      for (const k of CHAVES) {
        const r = (await CHAMADAS[k](c, 0, 10)).rows[0].r;
        assert.equal(
          r.data.length,
          10,
          `${k}: o admin tem de ler a primeira pagina`,
        );
      }
      await c.query("RESET ROLE");
      await c.query("SET LOCAL ROLE anon");
      for (const k of CHAVES)
        await recusa(
          c,
          `SELECT public.${FUNCOES[k].nome}(${ARGS[k]})`,
          /permission denied/,
        );
    });
    console.log(
      "  PASSOU a guarda de admin: cliente comum recusado ('Acesso negado'), anon sem EXECUTE, admin le",
    );

    // ---- 6. Reaplicar, rollback byte a byte, rollback de novo, estado misto, reaplicar depois do rollback. ----
    await isolado(c, async () => {
      await c.query(migration);
      await c.query(migration);
      assert.deepEqual(
        await todas(c),
        topo,
        "reaplicar 2x mudou OID, dono, ACL, atributos ou texto",
      );
      await c.query(rollback);
      const volta = await todas(c);
      for (const k of CHAVES) {
        assert.equal(
          volta[k].prosrc,
          FUNCOES[k].corpoVigente,
          `${k}: o rollback nao devolveu o corpo anterior byte a byte`,
        );
        assert.deepEqual(
          { ...volta[k], prosrc: null },
          { ...topo[k], prosrc: null },
          `${k}: o rollback mexeu em atributo, dono ou ACL`,
        );
      }
      // segundo rollback: recusa (as tres ja estao no corpo anterior) e nada muda
      await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      assert.deepEqual(
        await todas(c),
        volta,
        "o segundo rollback escreveu antes de recusar",
      );
      await c.query(migration);
      assert.deepEqual(
        await todas(c),
        topo,
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
    });
    await isolado(c, async () => {
      // estado MISTO: so produtos volta ao anterior. O rollback recusa (nao e o corpo desta migration) e nada muda; a migration aceita e completa.
      await trocarCorpo(c, FUNCOES.produtos, FUNCOES.produtos.corpoVigente);
      const misto = await todas(c);
      await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      assert.deepEqual(
        await todas(c),
        misto,
        "o rollback sobre estado misto escreveu antes de recusar",
      );
      await c.query(migration);
      assert.deepEqual(
        await todas(c),
        topo,
        "a migration sobre estado misto nao completou as tres",
      );
    });
    console.log(
      "  PASSOU reaplicar 2x, rollback byte a byte nas tres, rollback 2x e estado misto recusam sem escrever, reaplicar completa",
    );

    // ---- 7. Pre-voo recusa sem escrever; a conferencia que falha desfaz o arquivo inteiro. ----
    const sabotagens = [
      [
        "corpo desconhecido (produtos)",
        () =>
          trocarCorpo(
            c,
            FUNCOES.produtos,
            FUNCOES.produtos.corpoNovo.replace("-- Desempate", "-- desempate"),
          ),
      ],
      [
        "corpo desconhecido (cancelados)",
        () =>
          trocarCorpo(
            c,
            FUNCOES.cancelados,
            `${FUNCOES.cancelados.corpoNovo} `,
          ),
      ],
      [
        "ACL aberta para anon (pedidos)",
        () =>
          c.query(
            `GRANT EXECUTE ON FUNCTION ${FUNCOES.pedidos.assinatura} TO anon`,
          ),
      ],
      [
        "ACL aberta para PUBLIC (produtos)",
        () =>
          c.query(
            `GRANT EXECUTE ON FUNCTION ${FUNCOES.produtos.assinatura} TO PUBLIC`,
          ),
      ],
      [
        "sobrecarga (cancelados)",
        () =>
          c.query(
            "CREATE FUNCTION public.get_admin_orders_cancelados_recentes(p_x text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
          ),
      ],
      [
        "id de produtos sem chave primaria",
        async () => {
          const pk = (
            await c.query(
              "SELECT conname FROM pg_constraint WHERE conrelid = 'public.produtos'::regclass AND contype = 'p'",
            )
          ).rows[0].conname;
          await c.query(
            `ALTER TABLE public.produtos DROP CONSTRAINT ${pk} CASCADE`,
          );
        },
      ],
    ];
    for (const [nome, sabotar] of sabotagens)
      await isolado(c, async () => {
        await sabotar();
        const antes = await todas(c);
        await recusa(c, migration, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await todas(c),
          antes,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
        if (nome.startsWith("corpo desconhecido"))
          await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      });
    // Sem BEGIN: o estado de partida e o anterior; a conferencia sabotada derruba o arquivo inteiro (nenhuma das tres fica gravada).
    await c.query(rollback);
    const conferenciaSabotada = migration.replace(
      "AND md5(replace(p.prosrc, E'\\r', '')) = r.hash\n        AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.listas3998_' || r.chave)::jsonb",
      "AND md5(replace(p.prosrc, E'\\r', '')) = 'nao-e-este'\n        AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.listas3998_' || r.chave)::jsonb",
    );
    assert.notEqual(conferenciaSabotada, migration);
    await assert.rejects(
      () => c.query(conferenciaSabotada),
      /conferencia 20261399980000/,
    );
    assert.deepEqual(
      await hashes(c),
      Object.fromEntries(CHAVES.map((k) => [k, FUNCOES[k].hVigente])),
      "a migration que falhou na conferencia deixou algum corpo novo gravado",
    );
    await c.query(migration);
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens) e a conferencia que falha nao deixa nada (conexao sem BEGIN)`,
    );

    // ---- 8. Consultas 140a/140b nos dois sentidos, com o rol fechado; as vizinhas aceitam os dois corpos. ----
    const C140A =
      "140a-conferir-as-listas-do-painel-nao-repetem-ninguem-aplicado";
    const C140B =
      "140b-antes-as-listas-do-painel-nao-repetem-ninguem-base-vigente";
    const consulta = async (nome) => {
      const rows = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item)
        .sort();
    };
    assert.deepEqual(await consulta(C140A), []);
    assert.deepEqual(
      await consulta(C140B),
      CHAVES.map((k) => `${FUNCOES[k].nome}: corpo exato (md5)`).sort(),
    );
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C140B), []);
      assert.deepEqual(
        await consulta(C140A),
        CHAVES.map((k) => `${FUNCOES[k].nome}: corpo exato (md5)`).sort(),
      );
    });
    // Estado misto: a 140a aponta so as que ainda estao no corpo anterior.
    await isolado(c, async () => {
      await trocarCorpo(c, FUNCOES.pedidos, FUNCOES.pedidos.corpoVigente);
      assert.deepEqual(await consulta(C140A), [
        "get_admin_orders_paged: corpo exato (md5)",
      ]);
    });
    const reprovadasDe = async (nome) =>
      (await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))).rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item);
    const VIZINHAS = [
      "8e-conferir-92-a-202-aplicado",
      "9a-conferir-60-a-66-aplicado",
      "85a-conferir-aviso-de-cancelados-antigos-aplicado",
      "86a-conferir-ex-admin-no-resto-do-painel-aplicado",
      "90a-conferir-busca-do-painel-por-codigo-aplicado",
      "92a-conferir-a-busca-de-pedido-pelo-numero-aplicado",
      "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado",
      "125a-conferir-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-aplicado",
    ];
    for (const v of VIZINHAS)
      assert.deepEqual(
        await reprovadasDe(v),
        [],
        `${v}: reprovou o corpo da 3998`,
      );
    await isolado(c, async () => {
      await c.query(rollback);
      for (const v of VIZINHAS)
        assert.deepEqual(
          await reprovadasDe(v),
          [],
          `${v}: reprovou o corpo anterior`,
        );
    });
    await isolado(c, async () => {
      for (const k of CHAVES)
        await trocarCorpo(c, FUNCOES[k], `${FUNCOES[k].corpoNovo} `);
      for (const v of VIZINHAS)
        assert.ok(
          (await reprovadasDe(v)).length > 0,
          `${v}: aceitou um corpo estranho`,
        );
    });
    console.log(
      "  PASSOU consultas 140a/140b nos dois sentidos (e no estado misto), rol fechado; as 8 vizinhas aceitam o corpo anterior e o da 3998 e reprovam corpo estranho",
    );

    console.log(
      "\n[as-listas-do-painel-nao-repetem-ninguem] todas as provas passaram.",
    );
  } finally {
    for (const x of abertas) await x.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

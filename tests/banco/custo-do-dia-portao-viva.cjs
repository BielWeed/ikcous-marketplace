"use strict";

/**
 * Prova VIVA do PORTÃO do lote 20261242000000 (o lucro usa o custo do dia da venda): as consultas
 * 45a-conferir-custo-do-dia-aplicado (DEPOIS, 13 linhas) e 45b-antes-custo-do-dia-base-vigente (ANTES, 6 linhas),
 * mais a medição 45m (rol aberto), executadas num Postgres EFÊMERO como papel de LEITURA (BYPASSRLS +
 * pg_read_all_data, transação somente leitura) e levadas até o veredito (`conferir-banco.cjs`) e ao portão
 * (`evidenciaDaProva`, de publicar-release.mjs).
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 45a é POSITIVA com o rol EXATO de ROL_DA_45A, rol=ok; a 45b NEGATIVA reprovando
 *       EXATAMENTE as três linhas que mudam (os dois corpos e a ausência do gatilho).
 *   (2) ANTES (o rollback-manual aplicado: a TABELA FICA, o gatilho e a função saem): a 45b é POSITIVA com o rol EXATO
 *       de ROL_DA_45B; a 45a NEGATIVA reprovando EXATAMENTE as linhas que dependem do que saiu.
 *   (3) UM NEGATIVO POR LINHA da 45a (cada defeito reprova a SUA linha e leva o portão a NEGATIVA): corpo +1 byte nas
 *       três funções, atributo trocado, EXECUTE aberto a PUBLIC/anon e fechado a authenticated nos relatórios, EXECUTE
 *       aberto na função do gatilho (PUBLIC, authenticated, service_role), a tabela aberta (GRANT a anon, sem RLS, com
 *       política), coluna a mais, sem chave primária, chave estrangeira sem cascata, gatilho desligado ou por instrução,
 *       o fin_dre sem o custo do dia (corpo e marcador), a tabela no realtime, função e tabela AUSENTES.
 *   (4) A 45b: sobrecarga, corpo +1 byte, atributo trocado, função ausente, gatilho e função presentes, coluna ausente.
 *   (5) A 45m (medição, rol aberto): como leitor com BYPASSRLS conta os itens depois do apply, os que têm linha e os que
 *       NÃO têm apesar de o produto ter custo; como leitor SEM BYPASSRLS a RLS vale e a resposta é INCONCLUSIVA (nunca
 *       um zero que engana); nenhuma linha traz id, nome de produto, valor de custo ou dado de cliente.
 *   (6) MUTANTES do texto das consultas: cada um deixa um positivo reprovar ou um negativo passar.
 *   (7) rol FECHADO: resposta parcial ou o rol de outra consulta nunca é POSITIVA.
 *
 * Nada sai da máquina e nenhuma loja é tocada. A prova diz que as consultas DECIDEM certo, não em que estado a
 * IKCOUS ou a Savy estão (isso só o run da consulta contra o ref).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/custo-do-dia-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório; as chaves de objeto, de constantes deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const A = "45a-conferir-custo-do-dia-aplicado";
const B = "45b-antes-custo-do-dia-base-vigente";
const M = "45m-medir-itens-sem-custo-do-dia";
const SQL_A = fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8");
const SQL_B = fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8");
const SQL_M = fs.readFileSync(path.join(CONSULTAS, `${M}.sql`), "utf8");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const E8 = "8e-conferir-92-a-202-aplicado";
const SQL_E8 = fs.readFileSync(path.join(CONSULTAS, `${E8}.sql`), "utf8");
const ROL = {
  [A]: CONF.ROL_DA_45A,
  [B]: CONF.ROL_DA_45B,
  [E8]: CONF.ROL_DA_8E,
};

const NOME = "20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const RB = ler(`rollback-manual-${NOME}`);
const ANALYTICS = "public.get_admin_analytics_v2(integer)";
const DRE = "public.fin_dre(date,date)";
const GATILHO = "public.marketplace_order_item__guarda_o_custo_do_dia()";
const TABELA = "public.marketplace_order_item_custo";

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p45_ro_${SUF}`;
const NB = `p45_nb_${SUF}`;

let resultados = 0;
const ok = (msg) => {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
};
let C;
let PORTAO;

/** BEGIN; `montar` (dono da conexão); SET LOCAL ROLE só-leitura; as consultas; ROLLBACK. */
async function noEstado(montar, consultas = [A, B], papel = RO) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    await C.query(`SET LOCAL ROLE ${papel}`);
    await C.query("SET LOCAL transaction_read_only = on");
    const saidas = {};
    for (const nome of consultas) {
      const sql =
        nome === A
          ? SQL_A
          : nome === B
            ? SQL_B
            : nome === M
              ? SQL_M
              : nome === E8
                ? SQL_E8
                : nome;
      assert.equal(CONF.contarStatements(sql), 1, "exatamente 1 statement");
      const r = await C.query(sql);
      if (nome === M) {
        assert.deepEqual(
          r.fields.map((f) => f.name),
          ["tipo", "objeto", "detalhe"],
        );
      } else {
        assert.deepEqual(
          r.fields.map((f) => f.name),
          ["item", "esperado", "vivo", "ok"],
        );
      }
      saidas[nome] = r.rows;
    }
    return saidas;
  } finally {
    await C.query("ROLLBACK");
  }
}

const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
const veredito = (consulta, rows) =>
  CONF.veredictoDaConsulta({ consulta, ref: REF, sha: SHA40, linhas: rows });
let relogio = Date.parse("2026-10-15T12:00:00Z");
async function estadoNoPortao(consulta, rows) {
  relogio += 1000;
  const linha = veredito(consulta, rows);
  return (
    await PORTAO.evidenciaDaProva({
      consulta,
      projeto: "savy",
      ref: REF,
      sha: SHA40,
      topo: SHA40,
      validadeHoras: 6,
      agora: relogio + 60000,
      deps: {
        listarRuns: async (wf) =>
          wf === "conferir-banco-da-loja.yml"
            ? [
                {
                  databaseId: 1,
                  displayTitle: `conferir ${consulta} em savy`,
                  headSha: SHA40,
                  createdAt: new Date(relogio).toISOString(),
                  conclusion: "success",
                  status: "completed",
                },
              ]
            : [],
        logDoRun: async () => `saida do job\n${linha ?? ""}\n`,
        arvoreIgual: async () => true,
      },
    })
  ).estado;
}

function exigirFormato(consulta, rotulo, rows) {
  assert.equal(rows.length, ROL[consulta].length, `${rotulo}: nº de linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, ROL[consulta]),
    null,
    `${rotulo}: o rol fechado do código tem de ser EXATAMENTE o que a consulta devolveu`,
  );
  for (const r of rows) {
    assert.equal(typeof r.ok, "boolean", `${rotulo}: ok não booleano`);
    assert.deepEqual(
      [typeof r.item, typeof r.esperado, typeof r.vivo],
      ["string", "string", "string"],
    );
  }
  const oks = rows.map((r) => r.ok);
  assert.deepEqual(
    oks,
    [...oks].sort((a, b) => Number(a) - Number(b)),
    `${rotulo}: ok=false primeiro`,
  );
}
async function exigirPositiva(consulta, rotulo, rows) {
  exigirFormato(consulta, rotulo, rows);
  assert.deepEqual(reprovadas(rows), [], `${rotulo}: nada podia reprovar`);
  assert.ok(
    veredito(consulta, rows).endsWith(
      `linhas=${rows.length} ok_false=0 ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${veredito(consulta, rows)}`,
  );
  assert.equal(await estadoNoPortao(consulta, rows), "POSITIVA", rotulo);
}
async function exigirReprovadas(consulta, rotulo, rows, esperadas) {
  exigirFormato(consulta, rotulo, rows);
  assert.deepEqual(
    reprovadas(rows),
    [...esperadas].sort(),
    `${rotulo}: reprovou ${JSON.stringify(reprovadas(rows))}, esperava ${JSON.stringify(esperadas)}`,
  );
  assert.ok(
    veredito(consulta, rows).endsWith(
      `linhas=${rows.length} ok_false=${esperadas.length} ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${veredito(consulta, rows)}`,
  );
  assert.equal(await estadoNoPortao(consulta, rows), "NEGATIVA", rotulo);
}

// --- as montagens -----------------------------------------------------------
const DEPOIS = async (c) => {
  await require("./lucro-com-desconto-posterior.cjs").desfazerLucroComDescontoNaTransacao(c);
  // O clone sai das migrations aplicadas do zero: a 20261242 está no ar.
  const r = await c.query(
    "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
    [ANALYTICS],
  );
  assert.equal(
    r.rows[0].h,
    "dceb62881ebf8fa404ba3ac295041691",
    "o clone tem de estar com a 20261242000000 no ar",
  );
};
const ANTES = async (c) => {
  await DEPOIS(c);
  await c.query(RB);
  const r = await c.query(
    "SELECT to_regclass($1) IS NOT NULL AS tabela, to_regprocedure($2) IS NOT NULL AS funcao",
    [TABELA, GATILHO],
  );
  assert.deepEqual(
    r.rows[0],
    { tabela: true, funcao: false },
    "o rollback comum deixa a tabela e tira a função",
  );
};
const em =
  (...passos) =>
  async (c) => {
    for (const p of passos) await p(c);
  };
const sql = (texto) => (c) => c.query(texto);
const defDe = async (c, assinatura) =>
  (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
      assinatura,
    ])
  ).rows[0].d;
const maisUmByte = (assinatura, de) => async (c) => {
  const def = await defDe(c, assinatura);
  const novo = def.replace(de, `${de} `);
  assert.notEqual(novo, def, `o trecho ${de} não existe em ${assinatura}`);
  await c.query(novo);
};

function trocar(texto, de, para) {
  assert.ok(texto.includes(de), `o trecho a mutar não existe: ${de}`);
  return texto.replace(de, () => para);
}

async function provar() {
  const L = (trecho) => {
    const achadas = ROL[A].filter((i) => i.includes(trecho));
    assert.equal(
      achadas.length,
      1,
      `a linha "${trecho}" tem de ser única no rol da 45a (achei ${achadas.length})`,
    );
    return achadas[0];
  };
  const LB = (trecho) => {
    const achadas = ROL[B].filter((i) => i.includes(trecho));
    assert.equal(
      achadas.length,
      1,
      `a linha "${trecho}" tem de ser única no rol da 45b (achei ${achadas.length})`,
    );
    return achadas[0];
  };
  const ANALYTICS_MD5 = L("get_admin_analytics_v2: corpo");
  const DRE_MD5 = L("fin_dre: corpo");
  const GATILHO_MD5 = L("guarda_o_custo_do_dia: corpo");
  const ATRIBUTOS = L("as tres funcoes: atributos");
  const EXEC_RELATORIOS = L("EXECUTE so do authenticated");
  const EXEC_GATILHO = L("guarda_o_custo_do_dia: EXECUTE fechado");
  const TABELA_SERVIDOR = L("so do servidor");
  const COLUNAS = L("as tres colunas");
  const CHAVES = L("chave primaria");
  const LIGADO = L("tr_marketplace_order_items_guarda_o_custo_do_dia: ligado");
  const MARCADOR = L("leem o custo do dia");
  const REALTIME = L("fora da publicacao do realtime");
  const B_AUSENTES = LB("ainda NAO existem");
  const B_ANALYTICS = LB("get_admin_analytics_v2: corpo");
  const B_DRE = LB("fin_dre: corpo");
  const B_ATRIBUTOS = LB("uma assinatura so");
  const B_COLUNAS = LB("12 colunas");

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "45a depois", s[A]);
    await exigirReprovadas(B, "45b depois", s[B], [
      B_AUSENTES,
      B_ANALYTICS,
      B_DRE,
    ]);
  }
  ok(
    "DEPOIS (a 20261242 no ar): 45a POSITIVA (13 linhas, rol=ok, portão POSITIVA); 45b NEGATIVA só nas 3 linhas que mudam (ausência do gatilho e os dois corpos)",
  );

  // (2) ANTES: o rollback comum DEIXA a tabela
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "45b antes", s[B]);
    await exigirReprovadas(A, "45a antes", s[A], [
      ANALYTICS_MD5,
      DRE_MD5,
      GATILHO_MD5,
      ATRIBUTOS,
      EXEC_GATILHO,
      LIGADO,
      MARCADOR,
    ]);
  }
  ok(
    "ANTES (rollback-manual aplicado, a tabela FICA): 45b POSITIVA; 45a NEGATIVA só nas 7 linhas que dependem do que saiu (3 corpos, atributos, EXECUTE do gatilho, gatilho ligado, marcador); as linhas da tabela seguem verdadeiras",
  );

  // (3) um negativo por linha da 45a
  const negativosA = [
    [
      "analytics com 1 byte a mais",
      maisUmByte(ANALYTICS, "-- 0. Security Check"),
      [ANALYTICS_MD5],
    ],
    [
      "fin_dre com 1 byte a mais",
      maisUmByte(DRE, "-- Competência:"),
      [DRE_MD5],
    ],
    [
      "gatilho com 1 byte a mais",
      maisUmByte(GATILHO, "-- Item sem produto"),
      [GATILHO_MD5],
    ],
    [
      "analytics SECURITY INVOKER",
      sql(`ALTER FUNCTION ${ANALYTICS} SECURITY INVOKER`),
      [ATRIBUTOS],
    ],
    [
      "gatilho com search_path aberto",
      sql(`ALTER FUNCTION ${GATILHO} RESET search_path`),
      [ATRIBUTOS],
    ],
    [
      "sobrecarga do analytics",
      sql(
        "CREATE FUNCTION public.get_admin_analytics_v2(p_isca_45 text) RETURNS json LANGUAGE sql AS $$ SELECT NULL::json $$",
      ),
      [ATRIBUTOS],
    ],
    [
      "EXECUTE do fin_dre aberto a PUBLIC",
      sql(`GRANT EXECUTE ON FUNCTION ${DRE} TO PUBLIC`),
      [EXEC_RELATORIOS],
    ],
    [
      "EXECUTE do analytics aberto a anon",
      sql(`GRANT EXECUTE ON FUNCTION ${ANALYTICS} TO anon`),
      [EXEC_RELATORIOS],
    ],
    [
      "EXECUTE do analytics fechado a authenticated",
      sql(`REVOKE EXECUTE ON FUNCTION ${ANALYTICS} FROM authenticated`),
      [EXEC_RELATORIOS],
    ],
    [
      "EXECUTE da função do gatilho aberto a PUBLIC",
      sql(`GRANT EXECUTE ON FUNCTION ${GATILHO} TO PUBLIC`),
      [EXEC_GATILHO],
    ],
    [
      "EXECUTE da função do gatilho aberto a authenticated",
      sql(`GRANT EXECUTE ON FUNCTION ${GATILHO} TO authenticated`),
      [EXEC_GATILHO],
    ],
    [
      "EXECUTE da função do gatilho aberto a service_role",
      sql(`GRANT EXECUTE ON FUNCTION ${GATILHO} TO service_role`),
      [EXEC_GATILHO],
    ],
    [
      "tabela com SELECT para anon",
      sql(`GRANT SELECT ON ${TABELA} TO anon`),
      [TABELA_SERVIDOR],
    ],
    [
      "tabela com INSERT para service_role",
      sql(`GRANT INSERT ON ${TABELA} TO service_role`),
      [TABELA_SERVIDOR],
    ],
    [
      "tabela SEM RLS",
      sql(`ALTER TABLE ${TABELA} DISABLE ROW LEVEL SECURITY`),
      [TABELA_SERVIDOR],
    ],
    [
      "tabela com uma política",
      sql(
        `CREATE POLICY p45 ON ${TABELA} FOR SELECT TO authenticated USING (true)`,
      ),
      [TABELA_SERVIDOR],
    ],
    [
      "tabela com uma coluna a mais",
      sql(`ALTER TABLE ${TABELA} ADD COLUMN extra int`),
      [COLUNAS],
    ],
    [
      "tabela sem a chave primária",
      sql(
        `ALTER TABLE ${TABELA} DROP CONSTRAINT marketplace_order_item_custo_pkey`,
      ),
      [CHAVES],
    ],
    [
      "chave estrangeira SEM cascata",
      em(
        sql(
          `ALTER TABLE ${TABELA} DROP CONSTRAINT marketplace_order_item_custo_item_id_fkey`,
        ),
        sql(
          `ALTER TABLE ${TABELA} ADD CONSTRAINT fk45 FOREIGN KEY (item_id) REFERENCES public.marketplace_order_items (id)`,
        ),
      ),
      [CHAVES],
    ],
    [
      "gatilho DESLIGADO",
      sql(
        "ALTER TABLE public.marketplace_order_items DISABLE TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia",
      ),
      [LIGADO],
    ],
    [
      "gatilho por INSTRUÇÃO (não por linha)",
      em(
        sql(
          "DROP TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia ON public.marketplace_order_items",
        ),
        sql(`CREATE TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia AFTER INSERT ON public.marketplace_order_items
               REFERENCING NEW TABLE AS novos FOR EACH STATEMENT EXECUTE FUNCTION ${GATILHO}`),
      ),
      [LIGADO],
    ],
    [
      "fin_dre sem o custo do dia (corpo e marcador)",
      async (c) => {
        const def = await defDe(c, DRE);
        const novo = def
          .split("COALESCE(oic.custo, p.custo, 0)")
          .join("COALESCE(p.custo, 0)");
        assert.notEqual(novo, def);
        await c.query(novo);
      },
      [DRE_MD5, MARCADOR],
    ],
    [
      "tabela na publicação do realtime",
      sql(`CREATE PUBLICATION p45_pub FOR TABLE ${TABELA}`),
      [REALTIME],
    ],
    [
      "fin_dre AUSENTE",
      sql(`DROP FUNCTION ${DRE}`),
      [DRE_MD5, ATRIBUTOS, EXEC_RELATORIOS, MARCADOR],
    ],
    [
      "gatilho e função do gatilho AUSENTES",
      em(
        sql(
          "DROP TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia ON public.marketplace_order_items",
        ),
        sql(`DROP FUNCTION ${GATILHO}`),
      ),
      [GATILHO_MD5, ATRIBUTOS, EXEC_GATILHO, LIGADO],
    ],
    [
      "tabela AUSENTE",
      sql(`DROP TABLE ${TABELA}`),
      [TABELA_SERVIDOR, COLUNAS, CHAVES, REALTIME],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosA) {
    const s = await noEstado(em(DEPOIS, defeito), [A]);
    await exigirReprovadas(A, `45a com ${rotulo}`, s[A], esperadas);
  }
  ok(
    `45a: ${negativosA.length} negativos (corpo +1 byte nas três funções, atributos, EXECUTE por papel nos relatórios e na função do gatilho, tabela aberta de quatro jeitos, coluna a mais, sem chave primária, FK sem cascata, gatilho desligado ou por instrução, fin_dre sem o custo do dia, realtime, função e tabela AUSENTES) — cada defeito reprova a SUA linha e leva o portão a NEGATIVA (a linha de controle não tem negativo local: o catálogo é legível por todo papel)`,
  );

  // (4) a 45b
  const negativosB = [
    [
      "sobrecarga do analytics",
      sql(
        "CREATE FUNCTION public.get_admin_analytics_v2(p_isca_45 text) RETURNS json LANGUAGE sql AS $$ SELECT NULL::json $$",
      ),
      [B_ATRIBUTOS],
    ],
    [
      "analytics com 1 byte a mais",
      maisUmByte(ANALYTICS, "-- 0. Security Check"),
      [B_ANALYTICS],
    ],
    ["fin_dre com 1 byte a mais", maisUmByte(DRE, "-- Competência:"), [B_DRE]],
    [
      "fin_dre SECURITY INVOKER",
      sql(`ALTER FUNCTION ${DRE} SECURITY INVOKER`),
      [B_ATRIBUTOS],
    ],
    ["fin_dre AUSENTE", sql(`DROP FUNCTION ${DRE}`), [B_DRE, B_ATRIBUTOS]],
    [
      "a função do gatilho JÁ existe",
      sql(
        "CREATE FUNCTION public.marketplace_order_item__guarda_o_custo_do_dia() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$",
      ),
      [B_AUSENTES],
    ],
    [
      "o gatilho JÁ existe",
      em(
        sql(
          "CREATE FUNCTION public.fn_isca_45() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$",
        ),
        sql(`CREATE TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia AFTER INSERT ON public.marketplace_order_items
               FOR EACH ROW EXECUTE FUNCTION public.fn_isca_45()`),
      ),
      [B_AUSENTES],
    ],
    [
      "produtos.custo renomeada (coluna ausente)",
      sql("ALTER TABLE public.produtos RENAME COLUMN custo TO custo_isca_45"),
      [B_COLUNAS],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosB) {
    const s = await noEstado(em(ANTES, defeito), [B]);
    await exigirReprovadas(B, `45b com ${rotulo}`, s[B], esperadas);
  }
  ok(
    `45b: ${negativosB.length} negativos (sobrecarga, corpo +1 byte nos dois relatórios, atributo, função ausente, função do gatilho e gatilho presentes, coluna ausente) reprovam a linha delas e levam o portão a NEGATIVA`,
  );

  // (5) a 45m
  {
    const montarComVenda = async (c, { semLinha = false } = {}) => {
      await DEPOIS(c);
      const prod = (
        await c.query(
          `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
         VALUES (gen_random_uuid(), 'Produto 45m', 30, 7, 100, true, false) RETURNING id`,
        )
      ).rows[0].id;
      const sempedido = (
        await c.query(
          `INSERT INTO public.marketplace_orders (customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at)
         VALUES ('Cliente 45m', '{}'::jsonb, 30, 30, 'delivered', 'online', 'online', 'pago', now()) RETURNING id`,
        )
      ).rows[0].id;
      for (let i = 0; i < 2; i += 1) {
        await c.query(
          "INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, 'item 45m', 1, 30)",
          [sempedido, prod],
        );
      }
      if (semLinha) {
        // Simula o gatilho que falhou em silêncio: o item nasceu e ficou sem a linha lateral.
        await c.query(
          `DELETE FROM ${TABELA} WHERE item_id = (SELECT id FROM public.marketplace_order_items WHERE order_id = $1 LIMIT 1)`,
          [sempedido],
        );
      }
    };
    const detalhe = (rows, objeto) => {
      const l = rows.filter((r) => r.objeto.includes(objeto));
      assert.equal(
        l.length,
        1,
        `a linha "${objeto}" da 45m tem de ser única (achei ${l.length})`,
      );
      return l[0].detalhe;
    };
    // loja sem nenhuma venda depois do apply: sem registro
    let s = await noEstado(DEPOIS, [M]);
    assert.match(
      detalhe(s[M], "itens nascidos depois do primeiro registro"),
      /^sem_registro$/,
    );
    assert.match(
      detalhe(s[M], "linhas da tabela lateral"),
      /^total=0\|primeiro=sem_registro\|ultimo=sem_registro$/,
    );
    // com 2 itens vendidos e as duas linhas gravadas pelo gatilho: 2, 2, 0
    s = await noEstado((c) => montarComVenda(c), [M]);
    assert.equal(
      detalhe(s[M], "itens nascidos depois do primeiro registro"),
      "total=2",
    );
    assert.equal(detalhe(s[M], "desses, com a linha lateral"), "total=2");
    assert.equal(detalhe(s[M], "SEM a linha lateral"), "total=0");
    assert.match(
      detalhe(s[M], "quem leu"),
      /^superusuario=.*\|bypassrls=true\|rls_vale_em_itens=false\|rls_vale_no_custo_do_dia=false$/,
    );
    // um item que ficou SEM a linha (gatilho falhando em silêncio): a medição o vê
    s = await noEstado((c) => montarComVenda(c, { semLinha: true }), [M]);
    assert.equal(
      detalhe(s[M], "itens nascidos depois do primeiro registro"),
      "total=2",
    );
    assert.equal(detalhe(s[M], "desses, com a linha lateral"), "total=1");
    assert.equal(
      detalhe(s[M], "SEM a linha lateral"),
      "total=1",
      "o item sem linha, de produto com custo, é o que precisa ser ~0",
    );
    // leitor SEM BYPASSRLS: a RLS vale, a resposta é INCONCLUSIVA (nunca um zero que engana)
    s = await noEstado(
      async (c) => {
        await montarComVenda(c, { semLinha: true });
        // As políticas de RLS chamam funções (is_admin, auth.uid...): o leitor sem BYPASSRLS precisa poder executá-las para
        // que a consulta rode e a RLS decida o que ele vê (sem isso ela falharia alto com permission denied, o que também é seguro).
        await c.query(`GRANT USAGE ON SCHEMA public, auth TO ${NB}`);
        await c.query(
          `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO ${NB}`,
        );
      },
      [M],
      NB,
    );
    for (const objeto of [
      "linhas da tabela lateral",
      "itens nascidos depois do primeiro registro",
      "desses, com a linha lateral",
      "SEM a linha lateral",
    ]) {
      assert.match(
        detalhe(s[M], objeto),
        /^INCONCLUSIVO/,
        `${objeto}: a RLS esconde as linhas de quem leu`,
      );
    }
    assert.match(
      detalhe(s[M], "quem leu"),
      /bypassrls=false\|rls_vale_em_itens=true\|rls_vale_no_custo_do_dia=true$/,
    );
    // nenhum dado pessoal nem valor de custo na saída
    s = await noEstado((c) => montarComVenda(c, { semLinha: true }), [M]);
    const texto = JSON.stringify(s[M]);
    assert.ok(
      !/Produto 45m|Cliente 45m|item 45m/.test(texto),
      "a 45m devolveu nome de produto ou de cliente",
    );
    assert.ok(
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(
        texto,
      ),
      "a 45m devolveu um id",
    );
  }
  ok(
    "45m: conta os itens depois do apply, os que têm linha e os que ficaram SEM linha apesar de o produto ter custo (1 quando o gatilho falhou em silêncio); com leitor sem BYPASSRLS responde INCONCLUSIVO em vez de um zero; nenhum id, nome ou valor na saída",
  );

  // (6) mutantes do texto
  const mutantes = [
    [
      "45a com o md5 do analytics trocado",
      A,
      trocar(
        SQL_A,
        "'dceb62881ebf8fa404ba3ac295041691'",
        `'${"0".repeat(32)}'`,
      ),
      DEPOIS,
      "positivo",
    ],
    [
      "45b com o md5 vigente do fin_dre trocado",
      B,
      trocar(
        SQL_B,
        "'e58ac49d3881a459b929064a3acb470a'",
        `'${"0".repeat(32)}'`,
      ),
      ANTES,
      "positivo",
    ],
    [
      "45a com o realtime sempre 'fora'",
      A,
      trocar(
        SQL_A,
        "THEN 'dentro' ELSE 'fora' END",
        "THEN 'fora' ELSE 'fora' END",
      ),
      em(DEPOIS, sql(`CREATE PUBLICATION p45_pub FOR TABLE ${TABELA}`)),
      "negativo",
    ],
    [
      "45a cega ao EXECUTE de service_role na função do gatilho",
      A,
      trocar(
        SQL_A,
        "' service_role=' || CASE WHEN f.svc_exec THEN 'sim' ELSE 'nao' END",
        "' service_role=nao'",
      ),
      em(DEPOIS, sql(`GRANT EXECUTE ON FUNCTION ${GATILHO} TO service_role`)),
      "negativo",
    ],
    [
      "45a sem olhar a política (contagem sempre 0)",
      A,
      trocar(
        SQL_A,
        "(SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid) AS politicas",
        "0 AS politicas",
      ),
      em(
        DEPOIS,
        sql(
          `CREATE POLICY p45 ON ${TABELA} FOR SELECT TO authenticated USING (true)`,
        ),
      ),
      "negativo",
    ],
  ];
  for (const [rotulo, consulta, sqlMutante, montar, tipo] of mutantes) {
    const s = await noEstado(montar, [consulta, sqlMutante]);
    const real = s[consulta];
    const mutante = s[sqlMutante];
    let pego = false;
    try {
      if (tipo === "positivo") {
        await exigirPositiva(consulta, `mutante ${rotulo}`, mutante);
      } else {
        assert.deepEqual(
          reprovadas(mutante),
          reprovadas(real),
          `mutante ${rotulo}`,
        );
      }
    } catch (e) {
      pego = true;
      assert.ok(e instanceof assert.AssertionError, String(e));
    }
    assert.ok(pego, `MUTANTE SOBREVIVEU: ${rotulo}`);
    if (tipo === "negativo")
      assert.ok(
        reprovadas(mutante).length < reprovadas(real).length,
        `${rotulo}: o mutante não afrouxou nada`,
      );
  }
  ok(
    "MUTANTES do texto das consultas: md5 do analytics trocado (45a), md5 vigente do fin_dre trocado (45b), realtime sempre 'fora', EXECUTE de service_role cego na função do gatilho e política não contada — todos pegos",
  );

  // (8) a 8e (lote 92-202), a 35a (lote 35) e a 17a (lote 17) seguem POSITIVAS depois do apply e antes dele: aceitam o corpo
  // novo de get_admin_analytics_v2 e, a 8e, o de fin_dre como SUCESSOR; corpo estranho reprova só a linha da função.
  {
    const linhaE8 = (rows, fn) => {
      const l = rows.filter((r) => r.item === `corpo final ${fn}`);
      assert.equal(
        l.length,
        1,
        `a 8e tem de ter UMA linha "corpo final ${fn}"`,
      );
      return l[0];
    };
    let s = await noEstado(DEPOIS, [E8]);
    await exigirPositiva(E8, "8e com a 42 no ar", s[E8]);
    assert.equal(
      linhaE8(s[E8], "fin_dre").vivo,
      "e58ac49d3881a459b929064a3acb470a",
      "o `vivo` mostra o corpo da 99 (o esperado), aceito o da 42",
    );
    s = await noEstado(ANTES, [E8]);
    await exigirPositiva(E8, "8e com a 42 desfeita", s[E8]);
    for (const [fn, assinatura, ancora] of [
      ["get_admin_analytics_v2", ANALYTICS, "-- 0. Security Check"],
      ["fin_dre", DRE, "-- Competência:"],
    ]) {
      s = await noEstado(em(DEPOIS, maisUmByte(assinatura, ancora)), [E8]);
      await exigirReprovadas(E8, `8e com ${fn} de corpo estranho`, s[E8], [
        `corpo final ${fn}`,
      ]);
    }
    // a 35a e a 17a: o corpo da 42 é aceito ao lado do da 34 / 14 (os negativos de cada uma estão nas provas dos lotes 35 e 17)
    const consulta = (nome) =>
      fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
    const SQL_35A = consulta("35a-conferir-lucro-so-com-custo-aplicado");
    const SQL_17A = consulta("17a-conferir-estoque-do-painel-aplicado");
    s = await noEstado(DEPOIS, [SQL_35A, SQL_17A]);
    assert.deepEqual(
      s[SQL_35A].filter((r) => r.ok !== true),
      [],
      "35a: nada podia reprovar com a 42 no ar",
    );
    assert.deepEqual(
      s[SQL_17A].filter((r) => r.ok !== true),
      [],
      "17a: nada podia reprovar com a 42 no ar",
    );
  }
  ok(
    "8e, 35a e 17a seguem POSITIVAS com a 42 no ar (aceitam o corpo novo como SUCESSOR) e a 8e também com ela desfeita; corpo estranho de get_admin_analytics_v2 ou de fin_dre reprova SÓ a linha da função",
  );

  // (7) rol fechado
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 45b julgadas pelo rol da 45a",
    );
  }
  ok(
    "rol FECHADO: resposta parcial ou o rol da outra consulta tem rol=invalido e o portão nunca a trata como POSITIVA",
  );
}

async function main() {
  PORTAO = await import(
    pathToFileURL(path.join(REPO, "scripts", "frota", "publicar-release.mjs"))
      .href
  );
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  await C.query(`CREATE ROLE ${RO} NOLOGIN BYPASSRLS`);
  await C.query(`CREATE ROLE ${NB} NOLOGIN`);
  try {
    await C.query(`GRANT pg_read_all_data TO ${RO}`);
    // Leitor SEM BYPASSRLS, mas que lê tudo (pg_read_all_data): a RLS vale para ele e a 45m tem de dizer INCONCLUSIVO.
    await C.query(`GRANT pg_read_all_data TO ${NB}`);
    await provar();
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${NB}`).catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  console.log(`\ncusto-do-dia-portao-viva: ${resultados} ok`);
}

main().catch((erro) =>
  falhar("PORTAO-45", erro?.stack ? erro.stack : String(erro)),
);

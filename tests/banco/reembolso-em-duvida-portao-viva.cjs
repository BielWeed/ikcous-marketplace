"use strict";

/**
 * Prova VIVA do PORTÃO do lote 20261241000000 (o reembolso em dúvida prende o saldo): as consultas
 * 43a-conferir-reembolso-em-duvida-aplicado (DEPOIS, 21 linhas) e 43b-antes-reembolso-em-duvida-base-vigente
 * (ANTES, 14 linhas), executadas num Postgres EFÊMERO como papel de LEITURA (BYPASSRLS + pg_read_all_data,
 * transação somente leitura) e levadas até o veredito (`conferir-banco.cjs`) e ao portão (`evidenciaDaProva`, de
 * publicar-release.mjs). E as consultas dos lotes que esta migration SUCEDE (28a, 29a e 8e), que têm de seguir
 * POSITIVAS antes e depois do apply.
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 43a é POSITIVA com o rol EXATO de ROL_DA_43A, rol=ok; a 43b NEGATIVA
 *       reprovando EXATAMENTE a linha dos objetos novos e as sete linhas dos corpos.
 *   (2) ANTES (o rollback-manual aplicado): a 43b é POSITIVA com o rol EXATO; a 43a NEGATIVA em tudo menos o controle.
 *   (3) UM NEGATIVO POR LINHA da 43a: cada um dos doze corpos com 1 byte a mais reprova SÓ a linha dele; atributo
 *       trocado; EXECUTE aberto (regra do servidor ao service_role e ao logado, porta nova ao anon, a antiga ao
 *       logado) e fechado (porta nova sem o logado); a tabela com policy, com grant, sem RLS, com coluna a mais; a
 *       espera AUSENTE; um corpo do painel que não lê a espera.
 *   (4) A 43b: cada um dos sete corpos com 1 byte a mais, atributo trocado, sobrecarga extra, função nova ou tabela
 *       nova já presentes, a função chamada com corpo estranho, a antiga ausente e o gatilho desligado reprovam a
 *       linha deles.
 *   (5) SUCESSORAS: a 28a, a 29a e a 8e seguem POSITIVAS (rol exato, portão POSITIVA) com a 20261241000000 no ar e
 *       depois do rollback dela; um corpo estranho no lugar do sucessor reprova a linha do corpo na 28a e na 29a.
 *   (6) MUTANTES do texto das consultas (cada md5 novo da 43a, cada md5 vigente da 43b, os marcadores sempre 'sim',
 *       os objetos novos sempre 'ausentes'): cada um deixa um positivo reprovar ou um negativo passar.
 *   (7) rol FECHADO: resposta parcial ou o rol da outra consulta nunca é POSITIVA.
 *
 * Nada sai da máquina e nenhuma loja é tocada. A prova diz que as consultas DECIDEM certo, não em que estado a
 * IKCOUS ou a Savy estão (isso só o run da consulta contra o ref).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/reembolso-em-duvida-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-non-literal-regexp --
 * Os caminhos vêm do próprio repositório; as chaves de objeto, de constantes deste arquivo; as RegExp montadas
 * só de assinaturas e nomes fixos deste arquivo (escapados), nunca de entrada externa. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  desfazerPagamentoAdiantadoNaTransacao,
} = require("./pagamento-adiantado-posterior.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const A = "43a-conferir-reembolso-em-duvida-aplicado";
const B = "43b-antes-reembolso-em-duvida-base-vigente";
const S28 = "28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro";
const S29 = "29a-conferir-reemissao-do-reembolso-consulta-o-mp-antes";
const S8E = "8e-conferir-92-a-202-aplicado";
const lerConsulta = (n) =>
  fs.readFileSync(path.join(CONSULTAS, `${n}.sql`), "utf8");
const SQL = Object.fromEntries(
  [A, B, S28, S29, S8E].map((n) => [n, lerConsulta(n)]),
);
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const ROL = (consulta) => {
  const r = CONF.ROL_FECHADO_POR_CONSULTA[consulta];
  assert.ok(Array.isArray(r), `${consulta} sem rol fechado`);
  return r;
};

const NOME = "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const MIGRACAO = ler(NOME);
const RB = ler(`rollback-manual-${NOME}`);

// As doze funções que a 43a mede, com o md5 lido do ARQUIVO da migration (a conferência final dela).
const SIG = {
  pode: "public.order_refund__pode_ter_saido(uuid)",
  espera: "public.order_refund__liberavel_apos_espera(uuid)",
  saldo: "public.pedido__saldo_a_estornar(uuid)",
  solicitar: "public.solicitar_estorno(uuid,numeric,text)",
  concluir: "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)",
  autorizar: "public.autorizar_post_do_estorno(uuid,numeric)",
  reemitir: "public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)",
  porfora: "public.admin_devolucao_reembolso_por_fora(uuid,uuid)",
  avisa: "public.devolucao_avisa_o_cliente()",
  esperadev:
    "public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)",
  esperaped: "public.registrar_estorno_manual_apos_espera(uuid,uuid,text)",
  painel: "public.pedido_reembolsos_e_saldo(uuid)",
};
const REESCRITAS = [
  "saldo",
  "solicitar",
  "concluir",
  "autorizar",
  "reemitir",
  "porfora",
  "avisa",
];
const NOVAS = ["pode", "espera", "esperadev", "esperaped", "painel"];
const NOME_DA = (k) => SIG[k].slice("public.".length, SIG[k].indexOf("("));

/** Os hashes desta migration: os da CONFERÊNCIA FINAL ('sig', 'lingua', 'vol', 'md5'). */
function hashDesta(k) {
  const m = new RegExp(
    `\\('${SIG[k].replace(/[().]/g, "\\$&")}', '[a-z]+', '[a-z]', '([0-9a-f]{32})'\\)`,
  ).exec(MIGRACAO);
  assert.ok(m, `conferência final sem o md5 de ${k}`);
  return m[1];
}
/** Os hashes VIGENTES: os do pré-voo ('nome', 'sig', 'lingua', 'vol', 'ret', 'vigente', 'desta'). */
function hashVigente(k) {
  const m = new RegExp(
    `'${SIG[k].replace(/[().]/g, "\\$&")}', '[a-z]+', '[a-z]', '[a-z]+', '([0-9a-f]{32})', '([0-9a-f]{32})'\\)`,
  ).exec(MIGRACAO);
  assert.ok(m, `pré-voo sem o par de ${k}`);
  assert.equal(m[2], hashDesta(k), `${k}: pré-voo e conferência discordam`);
  return m[1];
}
const H = Object.fromEntries(Object.keys(SIG).map((k) => [k, hashDesta(k)]));
const V = Object.fromEntries(REESCRITAS.map((k) => [k, hashVigente(k)]));

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "f".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p43_ro_${SUF}`;

let resultados = 0;
const ok = (msg) => {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
};
let C;
let PORTAO;

/** BEGIN; `montar` (dono da conexão); SET LOCAL ROLE só-leitura; as consultas; ROLLBACK. */
async function noEstado(montar, consultas = [A, B]) {
  await C.query("BEGIN");
  try {
    await desfazerPagamentoAdiantadoNaTransacao(C);
    if (montar) await montar(C);
    await C.query(`SET LOCAL ROLE ${RO}`);
    await C.query("SET LOCAL transaction_read_only = on");
    const saidas = {};
    for (const nome of consultas) {
      const sql = SQL[nome] ?? nome;
      assert.equal(CONF.contarStatements(sql), 1, "exatamente 1 statement");
      const r = await C.query(sql);
      assert.deepEqual(
        r.fields.map((f) => f.name),
        ["item", "esperado", "vivo", "ok"],
      );
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
  assert.equal(rows.length, ROL(consulta).length, `${rotulo}: nº de linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, ROL(consulta)),
    null,
    `${rotulo}: o rol fechado do código tem de ser EXATAMENTE o que a consulta devolveu`,
  );
  for (const r of rows) {
    assert.equal(typeof r.ok, "boolean", `${rotulo}: ok não booleano`);
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
  assert.deepEqual(
    reprovadas(rows),
    [],
    `${rotulo}: nada podia reprovar (${JSON.stringify(rows.filter((r) => !r.ok))})`,
  );
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
const hashVivo = async (c, sig) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.h ?? null;
const DEPOIS = async (c) => {
  for (const k of Object.keys(SIG))
    assert.equal(
      await hashVivo(c, SIG[k]),
      H[k],
      `o clone tem de estar com a 20261241000000 no ar (${k})`,
    );
};
const ANTES = async (c) => {
  await DEPOIS(c);
  await c.query(RB);
  for (const k of REESCRITAS)
    assert.equal(
      await hashVivo(c, SIG[k]),
      V[k],
      `o rollback não voltou (${k})`,
    );
  for (const k of NOVAS) assert.equal(await hashVivo(c, SIG[k]), null);
};
/** Acrescenta uma linha de comentário ao FIM do corpo vivo (1 linha a mais: o md5 muda, o comportamento não). */
const corpoMaisUmaLinha = (sig) => async (c) => {
  const antes = await hashVivo(c, sig);
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [sig])
  ).rows[0].d;
  const m = /AS (\$[A-Za-z_]*\$)/.exec(def);
  assert.ok(m, `${sig}: sem AS $tag$`);
  const fim = def.lastIndexOf(m[1]);
  await c.query(`${def.slice(0, fim)}-- +1\n${def.slice(fim)}`);
  assert.notEqual(await hashVivo(c, sig), antes, `o corpo de ${sig} não mudou`);
};
/** Troca um trecho no corpo vivo. */
const mexerNoCorpo = (sig, de, para) => async (c) => {
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [sig])
  ).rows[0].d;
  assert.ok(def.includes(de), `o trecho a trocar não existe em ${sig}: ${de}`);
  await c.query(def.split(de).join(para));
};
const em =
  (...passos) =>
  async (c) => {
    for (const p of passos) await p(c);
  };
function trocar(sql, de, para, vezes = 1) {
  const n = sql.split(de).length - 1;
  assert.equal(n, vezes, `o trecho a mutar casou ${n}x: ${de}`);
  return sql.split(de).join(para);
}

// --- as linhas dos róis ------------------------------------------------------
const linhaA = (prefixo) => {
  const achadas = ROL(A).filter((i) => i.startsWith(prefixo));
  assert.equal(achadas.length, 1, `43a: linha "${prefixo}"`);
  return achadas[0];
};
const linhaB = (prefixo) => {
  const achadas = ROL(B).filter((i) => i.startsWith(prefixo));
  assert.equal(achadas.length, 1, `43b: linha "${prefixo}"`);
  return achadas[0];
};
const CORPO_A = (k) => linhaA(`${NOME_DA(k)}: corpo e o da 20261241000000`);
const CORPO_B = (k) => linhaB(`${NOME_DA(k)}: corpo e o vigente`);
const ATRIB_A = linhaA("as doze funcoes: atributos");
const REGRAS_A = linhaA("as duas regras do servidor");
const PORTAS_A = linhaA("as tres portas novas");
const ANTIGA_A = linhaA("admin_devolucao_reemitir_reembolso: EXECUTE");
const TABELA_A = linhaA("order_refund_prova: so do servidor");
const COLUNAS_A = linhaA("order_refund_prova: as tres colunas");
const SALDO_A = linhaA("pedido__saldo_a_estornar: desconta");
const ESPERA_A = linhaA("as duas saidas dos 7 dias e o painel");
const NOVOS_B = linhaB("order_refund_prova e as cinco funcoes novas");
const ATRIB_B = linhaB("as sete funcoes");
const CONCLUIR_B = linhaB("concluir_estorno:");
const AVISAR_B = linhaB("devolucao__avisar_reembolso:");
const ANTIGA_B = linhaB("admin_devolucao_reemitir_reembolso(");
const GATILHO_B = linhaB("tr_devolucao_avisa_o_cliente");

async function provar() {
  // os md5 das consultas são os do arquivo da migration
  for (const k of Object.keys(SIG)) {
    assert.equal(SQL[A].split(`'${H[k]}'`).length - 1, 2, `43a: md5 de ${k}`);
    assert.ok(!SQL[B].includes(H[k]), `43b cita o md5 novo de ${k}`);
  }
  for (const k of REESCRITAS) {
    assert.equal(SQL[B].split(`'${V[k]}'`).length - 1, 1, `43b: md5 de ${k}`);
    assert.ok(!SQL[A].includes(V[k]), `43a cita o md5 vigente de ${k}`);
  }

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "43a depois", s[A]);
    await exigirReprovadas(B, "43b depois", s[B], [
      NOVOS_B,
      ...REESCRITAS.map(CORPO_B),
    ]);
  }
  ok(
    "DEPOIS (a 20261241 no ar): 43a POSITIVA (rol exato, rol=ok, portão POSITIVA); 43b NEGATIVA só nos objetos novos e nos sete corpos",
  );

  // (2) ANTES
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "43b antes", s[B]);
    await exigirReprovadas(
      A,
      "43a antes",
      s[A],
      ROL(A).filter((i) => !i.startsWith("controle")),
    );
  }
  ok(
    "ANTES (o rollback-manual aplicado): 43b POSITIVA; 43a NEGATIVA em todas as linhas menos o controle",
  );

  // (3) um negativo por linha da 43a
  const negativosA = [
    ...Object.keys(SIG).map((k) => [
      `corpo de ${k} com uma linha a mais`,
      corpoMaisUmaLinha(SIG[k]),
      [CORPO_A(k)],
    ]),
    [
      "atributo trocado (SECURITY INVOKER) na leitura do painel",
      (c) => c.query(`ALTER FUNCTION ${SIG.painel} SECURITY INVOKER`),
      [ATRIB_A],
    ],
    [
      "regra unica aberta ao service_role",
      (c) => c.query(`GRANT EXECUTE ON FUNCTION ${SIG.pode} TO service_role`),
      [REGRAS_A],
    ],
    [
      "espera aberta ao logado",
      (c) =>
        c.query(`GRANT EXECUTE ON FUNCTION ${SIG.espera} TO authenticated`),
      [REGRAS_A],
    ],
    [
      "espera aberta a PUBLIC",
      (c) => c.query(`GRANT EXECUTE ON FUNCTION ${SIG.espera} TO PUBLIC`),
      [REGRAS_A],
    ],
    [
      "porta nova aberta ao anon",
      (c) => c.query(`GRANT EXECUTE ON FUNCTION ${SIG.esperadev} TO anon`),
      [PORTAS_A],
    ],
    [
      "porta nova fechada ao logado",
      (c) =>
        c.query(`REVOKE EXECUTE ON FUNCTION ${SIG.painel} FROM authenticated`),
      [PORTAS_A],
    ],
    [
      "a antiga aberta de novo ao logado",
      (c) =>
        c.query(
          "GRANT EXECUTE ON FUNCTION public.admin_devolucao_reemitir_reembolso(uuid,boolean) TO authenticated",
        ),
      [ANTIGA_A],
    ],
    [
      "tabela com uma policy",
      (c) =>
        c.query(
          "CREATE POLICY p43 ON public.order_refund_prova FOR SELECT TO authenticated USING (true)",
        ),
      [TABELA_A],
    ],
    [
      "tabela legivel pelo logado",
      (c) =>
        c.query("GRANT SELECT ON public.order_refund_prova TO authenticated"),
      [TABELA_A],
    ],
    [
      "tabela legivel pelo service_role",
      (c) =>
        c.query("GRANT SELECT ON public.order_refund_prova TO service_role"),
      [TABELA_A],
    ],
    [
      "tabela sem RLS",
      (c) =>
        c.query(
          "ALTER TABLE public.order_refund_prova DISABLE ROW LEVEL SECURITY",
        ),
      [TABELA_A],
    ],
    [
      "tabela com coluna a mais",
      (c) =>
        c.query("ALTER TABLE public.order_refund_prova ADD COLUMN x43 text"),
      [COLUNAS_A],
    ],
    [
      "a espera AUSENTE",
      (c) => c.query(`DROP FUNCTION ${SIG.espera}`),
      [CORPO_A("espera"), ATRIB_A, REGRAS_A],
    ],
    [
      "o painel deixa de ler a espera",
      mexerNoCorpo(
        SIG.painel,
        "public.order_refund__liberavel_apos_espera(r.id)",
        "false",
      ),
      [CORPO_A("painel"), ESPERA_A],
    ],
    [
      "o saldo deixa de respeitar a substituida",
      mexerNoCorpo(
        SIG.saldo,
        "AND pv.substituida_por_manual_em IS NOT NULL)",
        "AND pv.por_fora_liberado_em IS NOT NULL)",
      ),
      [CORPO_A("saldo"), SALDO_A],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosA) {
    const s = await noEstado(em(DEPOIS, defeito), [A]);
    await exigirReprovadas(A, `43a com ${rotulo}`, s[A], esperadas);
  }
  ok(
    `43a: ${negativosA.length} negativos (cada um dos doze corpos +1 linha, atributo, EXECUTE aberto e fechado por papel, a antiga reaberta, tabela com policy/grant/sem RLS/coluna a mais, a espera ausente, o painel e o saldo sem o marcador) — cada defeito reprova SÓ a sua linha e leva o portão a NEGATIVA`,
  );

  // (4) a 43b
  const negativosB = [
    ...REESCRITAS.map((k) => [
      `corpo vigente de ${k} com uma linha a mais`,
      corpoMaisUmaLinha(SIG[k]),
      [CORPO_B(k)],
    ]),
    [
      "atributo trocado (SECURITY INVOKER) no saldo",
      (c) => c.query(`ALTER FUNCTION ${SIG.saldo} SECURITY INVOKER`),
      [ATRIB_B],
    ],
    [
      "sobrecarga extra de solicitar_estorno",
      (c) =>
        c.query(
          "CREATE FUNCTION public.solicitar_estorno(p_isca_43 text) RETURNS void LANGUAGE sql AS $$ SELECT $$",
        ),
      [ATRIB_B],
    ],
    [
      "a regra unica ja existe",
      (c) =>
        c.query(
          "CREATE FUNCTION public.order_refund__pode_ter_saido(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$",
        ),
      [NOVOS_B],
    ],
    [
      "a tabela de marcas ja existe",
      (c) => c.query("CREATE TABLE public.order_refund_prova (refund_id uuid)"),
      [NOVOS_B],
    ],
    [
      "concluir_estorno com corpo estranho",
      corpoMaisUmaLinha("public.concluir_estorno(uuid,text,text,text)"),
      [CONCLUIR_B],
    ],
    [
      "devolucao__avisar_reembolso com corpo estranho",
      corpoMaisUmaLinha(
        "public.devolucao__avisar_reembolso(uuid,text,text,text,text)",
      ),
      [AVISAR_B],
    ],
    [
      "a antiga ausente",
      (c) =>
        c.query(
          "DROP FUNCTION public.admin_devolucao_reemitir_reembolso(uuid,boolean)",
        ),
      [ANTIGA_B],
    ],
    [
      "o gatilho do aviso desligado",
      (c) =>
        c.query(
          "ALTER TABLE public.devolucoes DISABLE TRIGGER tr_devolucao_avisa_o_cliente",
        ),
      [GATILHO_B],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosB) {
    const s = await noEstado(em(ANTES, defeito), [B]);
    await exigirReprovadas(B, `43b com ${rotulo}`, s[B], esperadas);
  }
  ok(
    `43b: ${negativosB.length} negativos (cada um dos sete corpos vigentes +1 linha, atributo, sobrecarga, função ou tabela nova já presente, função chamada estranha, a antiga ausente, o gatilho desligado) — cada um reprova SÓ a sua linha`,
  );

  // (5) as consultas que esta migration SUCEDE seguem positivas antes e depois
  for (const [rotulo, montar] of [
    ["com a 20261241 no ar", DEPOIS],
    ["depois do rollback da 20261241", ANTES],
  ]) {
    const s = await noEstado(montar, [S28, S29, S8E]);
    await exigirPositiva(S28, `28a ${rotulo}`, s[S28]);
    await exigirPositiva(S29, `29a ${rotulo}`, s[S29]);
    await exigirPositiva(S8E, `8e ${rotulo}`, s[S8E]);
  }
  {
    const r28 = ROL(S28).find((i) =>
      i.startsWith("devolucao_avisa_o_cliente: corpo"),
    );
    const r29 = ROL(S29).find((i) =>
      i.startsWith("reemitir_reembolso_da_devolucao: corpo"),
    );
    const s = await noEstado(
      em(DEPOIS, corpoMaisUmaLinha(SIG.avisa), corpoMaisUmaLinha(SIG.reemitir)),
      [S28, S29],
    );
    await exigirReprovadas(S28, "28a com o sucessor estranho", s[S28], [r28]);
    await exigirReprovadas(S29, "29a com o sucessor estranho", s[S29], [r29]);
  }
  ok(
    "SUCESSORAS: 28a, 29a e 8e POSITIVAS com a 20261241 no ar e depois do rollback dela; um corpo estranho no lugar do sucessor reprova a linha do corpo na 28a e na 29a",
  );

  // (6) mutantes do texto
  const zeros = "0".repeat(32);
  const mutantes = [
    ...Object.keys(SIG).map((k) => [
      `43a com o md5 de ${k} trocado`,
      A,
      trocar(SQL[A], `'${H[k]}'`, `'${zeros}'`, 2),
      DEPOIS,
      "positivo",
    ]),
    ...REESCRITAS.map((k) => [
      `43b com o md5 vigente de ${k} trocado`,
      B,
      trocar(SQL[B], `'${V[k]}'`, `'${zeros}'`),
      ANTES,
      "positivo",
    ]),
    [
      "43a com o marcador do saldo sempre 'sim'",
      A,
      trocar(
        SQL[A],
        "AND position('pv.substituida_por_manual_em IS NOT NULL' IN f.prosrc) > 0\n                               THEN 'sim' ELSE 'nao' END",
        "AND position('pv.substituida_por_manual_em IS NOT NULL' IN f.prosrc) > 0\n                               THEN 'sim' ELSE 'sim' END",
      ),
      ANTES,
      "negativo",
    ],
    [
      "43a com o marcador da espera sempre 'sim'",
      A,
      trocar(
        SQL[A],
        "              THEN 'sim' ELSE 'nao' END\n)",
        "              THEN 'sim' ELSE 'sim' END\n)",
      ),
      em(
        DEPOIS,
        mexerNoCorpo(
          SIG.painel,
          "public.order_refund__liberavel_apos_espera(r.id)",
          "false",
        ),
      ),
      "negativo",
    ],
    [
      "43b com os objetos novos sempre 'ausentes'",
      B,
      trocar(
        SQL[B],
        "CASE WHEN (SELECT n.ausentes FROM novos n) THEN 'ausentes' ELSE 'presentes' END",
        "'ausentes'",
      ),
      DEPOIS,
      "negativo",
    ],
    [
      "43a com o EXECUTE da antiga ignorando o logado",
      A,
      trocar(
        SQL[A],
        "|| ' authenticated=' || CASE WHEN a.auth_exec THEN 'sim' ELSE 'nao' END",
        "|| ' authenticated=nao'",
      ),
      em(DEPOIS, (c) =>
        c.query(
          "GRANT EXECUTE ON FUNCTION public.admin_devolucao_reemitir_reembolso(uuid,boolean) TO authenticated",
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
    `MUTANTES do texto das consultas (${mutantes.length}): cada md5 novo da 43a, cada md5 vigente da 43b, os marcadores sempre 'sim', os objetos novos sempre 'ausentes' e o EXECUTE da antiga ignorando o logado — todos pegos`,
  );

  // (7) rol fechado
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 43b julgadas pelo rol da 43a",
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
  try {
    await C.query(`GRANT pg_read_all_data TO ${RO}`);
    await provar();
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  console.log(`\nreembolso-em-duvida-portao-viva: ${resultados} ok`);
}

main().catch((erro) =>
  falhar("PORTAO-43", erro?.stack ? erro.stack : String(erro)),
);

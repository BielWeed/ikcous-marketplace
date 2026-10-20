"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 19 (a politica de devolucao nao
 * mostra quem a editou, achado L) -- a migration 20261215000000, que troca o SELECT da tabela
 * `public.politica_devolucao` inteira por SELECT em 15 das 16 colunas para anon e authenticated --,
 * num Postgres EFEMERO local, nada de rede, nada de loja:
 *   19a-conferir-politica-devolucao-aplicado.sql        (DEPOIS do apply: 9 linhas)
 *   19b-antes-politica-devolucao-grant-de-tabela.sql    (ANTES do apply: 9 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois
 * (isso so o run da consulta contra o ref de cada loja diz).
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada: a 20261215
 * aplicada = o DEPOIS). Cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que
 * termina em ROLLBACK; as consultas rodam nela como um papel de LEITURA nao superusuario (BYPASSRLS +
 * pg_read_all_data, imita o supabase_read_only_user), com `SET LOCAL ROLE` e a transacao ja somente
 * leitura. O ANTES e' o DEPOIS com o rollback-manual da migration executado na transacao.
 *
 * CASOS (o veredito de cada um e' conferido linha a linha):
 *  ROL        as 9 linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_19A e
 *             ROL_DA_19B), sem repetir nem faltar, em qualquer estado.
 *  ESTADOS    depois (a arvore): 19a POSITIVA e 19b NEGATIVA nas 6 linhas de grant; antes (rollback): o
 *             inverso; depois de aplicar a migration DE NOVO: 19a POSITIVA (idempotencia).
 *  NEGATIVOS  (19a sobre o depois; cada um reprova EXATAMENTE as linhas previstas, toda mutacao com
 *             guarda): GRANT SELECT da tabela a anon -> as 3 linhas de anon; GRANT SELECT (updated_by)
 *             a authenticated -> a linha de updated_by e a de colunas legiveis; REVOKE SELECT de
 *             service_role -> a linha do service_role; RLS desligada e politica apagada -> a linha da
 *             RLS; tabela renomeada -> as 9 linhas com `AUSENTE`.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo de
 *             leitura, e rodam com a transacao somente leitura.
 *
 * LIMITES DECLARADOS: (1) o Postgres e' o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user) e a ACL real das lojas NAO foram medidos aqui. (2) Nao ha mutantes do
 * TEXTO do .sql (como ha nos lotes 16 e 17): a prova cobre o comportamento da consulta em cada
 * estado, nao cada clausula dela. (3) Estas consultas provam OBJETOS e privilegios; o comportamento do
 * PostgREST (select=* negado a anon) e' de tests/banco/devolucoes-viva.cjs, prova "(achado L)".
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/politica-devolucao-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas e as migrations), nunca de entrada
 * de rede; as chaves de objeto vem de constantes e mapas fechados deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "19a-conferir-politica-devolucao-aplicado";
const B = "19b-antes-politica-devolucao-grant-de-tabela";
const ARQ =
  "20261215000000_a_politica_de_devolucao_nao_mostra_quem_a_editou.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_19A, [B]: CONF.ROL_DA_19B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);

// As 6 linhas que mudam entre o antes e o depois (as 3 outras valem nos dois estados).
const LINHAS_DE_GRANT = [
  "anon: SELECT da tabela inteira",
  "anon: SELECT em updated_by",
  "anon: colunas legiveis",
  "authenticated: SELECT da tabela inteira",
  "authenticated: SELECT em updated_by",
  "authenticated: colunas legiveis",
];
const LINHA_CONTROLE =
  "controle: colunas de politica_devolucao visiveis a este papel";
const LINHA_RLS =
  "politica_devolucao: RLS ligada com a politica publica de SELECT";
const LINHA_SERVICE = "service_role: SELECT da tabela inteira";

const PAPEL_RO = `portao19_ro_${process.pid}`;
let C;

/** Monta o estado dentro de uma transacao, roda as consultas como o papel de leitura e desfaz tudo. */
async function noEstado(montar, consultas, { comoDono = false } = {}) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    if (!comoDono) {
      await C.query(`SET LOCAL ROLE ${PAPEL_RO}`);
      await C.query("SET LOCAL transaction_read_only = on");
      assert.equal(
        (await C.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
    }
    const saidas = {};
    for (const nome of consultas) {
      const r = await C.query(SQL[nome]);
      assert.deepEqual(
        r.fields.map((x) => x.name),
        ["item", "esperado", "vivo", "ok"],
        "colunas item/esperado/vivo/ok",
      );
      saidas[nome] = r.rows;
    }
    return saidas;
  } finally {
    await C.query("ROLLBACK");
  }
}

const reprovadas = (linhas) =>
  linhas
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();

/** O rol da consulta: as linhas sao exatamente o contrato, cada uma UMA vez. */
function confereRol(nome, linhas) {
  assert.deepEqual(
    linhas.map((l) => l.item).sort(),
    [...ROL[nome]].sort(),
    `${nome}: as linhas nao sao exatamente o rol`,
  );
  assert.equal(new Set(linhas.map((l) => l.item)).size, linhas.length);
  for (const l of linhas)
    assert.equal(
      typeof l.ok,
      "boolean",
      `${nome}: ok nao booleano em ${l.item}`,
    );
}

/** Guarda: a mutacao tem de ter aplicado; sem ela um mutante que nao faz nada vira falso verde. */
async function guarda(sql) {
  const r = await C.query(sql);
  assert.equal(r.rows[0].aplicou, true, `a mutacao nao aplicou: ${sql}`);
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova(
  "ROL: as 9 linhas de cada consulta sao exatamente o rol, nos dois estados",
  async () => {
    const depois = await noEstado(null, [A, B]);
    confereRol(A, depois[A]);
    confereRol(B, depois[B]);
    const antes = await noEstado((c) => c.query(ROLLBACK), [A, B]);
    confereRol(A, antes[A]);
    confereRol(B, antes[B]);
    assert.equal(ROL[A].length, 9);
    assert.equal(ROL[B].length, 9);
  },
);

prova(
  "DEPOIS (a arvore): 19a POSITIVA; 19b reprova SO as 6 linhas de grant",
  async () => {
    const s = await noEstado(null, [A, B]);
    assert.deepEqual(
      reprovadas(s[A]),
      [],
      "19a tem de estar toda ok no depois",
    );
    assert.deepEqual(reprovadas(s[B]), [...LINHAS_DE_GRANT].sort());
    const vivo = Object.fromEntries(s[A].map((l) => [l.item, l.vivo]));
    assert.equal(vivo[LINHA_CONTROLE], "16");
    assert.equal(vivo["anon: colunas legiveis"], "15 de 16");
    assert.equal(vivo["authenticated: colunas legiveis"], "15 de 16");
    assert.equal(vivo["anon: SELECT em updated_by"], "nao");
  },
);

prova(
  "ANTES (rollback na transacao): 19b POSITIVA; 19a reprova SO as 6 linhas de grant",
  async () => {
    const s = await noEstado((c) => c.query(ROLLBACK), [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "19b tem de estar toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), [...LINHAS_DE_GRANT].sort());
    const vivo = Object.fromEntries(s[B].map((l) => [l.item, l.vivo]));
    assert.equal(vivo["anon: colunas legiveis"], "16 de 16");
    assert.equal(vivo["authenticated: SELECT em updated_by"], "sim");
  },
);

prova(
  "IDEMPOTENCIA: aplicar a migration de novo deixa a 19a POSITIVA",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query(MIGRATION);
        await c.query(MIGRATION);
      },
      [A, B],
    );
    assert.deepEqual(reprovadas(s[A]), []);
    assert.deepEqual(reprovadas(s[B]), [...LINHAS_DE_GRANT].sort());
  },
);

prova(
  "IDA E VOLTA: rollback e depois a migration de novo volta ao depois",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query(ROLLBACK);
        await c.query(MIGRATION);
      },
      [A, B],
    );
    assert.deepEqual(reprovadas(s[A]), []);
  },
);

prova(
  "PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado",
  async () => {
    for (const montar of [null, (c) => c.query(ROLLBACK)]) {
      const comoDono = await noEstado(montar, [A, B], { comoDono: true });
      const comoLeitura = await noEstado(montar, [A, B]);
      assert.deepEqual(comoLeitura[A], comoDono[A]);
      assert.deepEqual(comoLeitura[B], comoDono[B]);
    }
  },
);

prova(
  "NEGATIVO: GRANT SELECT da tabela a anon reprova as 3 linhas de anon",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query("GRANT SELECT ON public.politica_devolucao TO anon");
        await guarda(
          "SELECT has_table_privilege('anon', 'public.politica_devolucao', 'SELECT') AS aplicou",
        );
      },
      [A],
    );
    assert.deepEqual(
      reprovadas(s[A]),
      [
        "anon: SELECT da tabela inteira",
        "anon: SELECT em updated_by",
        "anon: colunas legiveis",
      ].sort(),
    );
  },
);

prova(
  "NEGATIVO: GRANT SELECT (updated_by) a authenticated reprova updated_by e as colunas legiveis",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query(
          "GRANT SELECT (updated_by) ON public.politica_devolucao TO authenticated",
        );
        await guarda(
          "SELECT has_column_privilege('authenticated', 'public.politica_devolucao', 'updated_by', 'SELECT') AS aplicou",
        );
      },
      [A],
    );
    assert.deepEqual(
      reprovadas(s[A]),
      [
        "authenticated: SELECT em updated_by",
        "authenticated: colunas legiveis",
      ].sort(),
    );
    const vivo = Object.fromEntries(s[A].map((l) => [l.item, l.vivo]));
    assert.equal(vivo["authenticated: colunas legiveis"], "16 de 16");
    assert.equal(vivo["authenticated: SELECT da tabela inteira"], "nao");
  },
);

prova(
  "NEGATIVO: REVOKE SELECT de service_role reprova a linha do service_role",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query(
          "REVOKE SELECT ON public.politica_devolucao FROM service_role",
        );
        await guarda(
          "SELECT NOT has_table_privilege('service_role', 'public.politica_devolucao', 'SELECT') AS aplicou",
        );
      },
      [A],
    );
    assert.deepEqual(reprovadas(s[A]), [LINHA_SERVICE]);
  },
);

prova(
  "NEGATIVO: RLS desligada reprova a linha da RLS; sem a politica publica tambem",
  async () => {
    const semRls = await noEstado(
      async (c) => {
        await c.query(
          "ALTER TABLE public.politica_devolucao DISABLE ROW LEVEL SECURITY",
        );
        await guarda(
          "SELECT NOT relrowsecurity AS aplicou FROM pg_class WHERE oid = 'public.politica_devolucao'::regclass",
        );
      },
      [A],
    );
    assert.deepEqual(reprovadas(semRls[A]), [LINHA_RLS]);
    const semPolitica = await noEstado(
      async (c) => {
        await c.query(
          "DROP POLICY politica_devolucao_publica_select_policy ON public.politica_devolucao",
        );
        await guarda(
          "SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'politica_devolucao') AS aplicou",
        );
      },
      [A],
    );
    assert.deepEqual(reprovadas(semPolitica[A]), [LINHA_RLS]);
  },
);

prova(
  "NEGATIVO: tabela ausente deixa as 9 linhas com AUSENTE (nenhuma some) nas duas consultas",
  async () => {
    const s = await noEstado(
      async (c) => {
        await c.query(
          "ALTER TABLE public.politica_devolucao RENAME TO politica_devolucao_x",
        );
        await guarda(
          "SELECT to_regclass('public.politica_devolucao') IS NULL AS aplicou",
        );
      },
      [A, B],
    );
    for (const nome of [A, B]) {
      confereRol(nome, s[nome]);
      assert.equal(reprovadas(s[nome]).length, 9, `${nome}: todas reprovam`);
      for (const l of s[nome])
        assert.equal(l.vivo, "AUSENTE", `${nome}: ${l.item}`);
    }
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  const falhas = [];
  try {
    await C.query(`CREATE ROLE ${PAPEL_RO} NOLOGIN NOSUPERUSER BYPASSRLS`);
    await C.query(`GRANT pg_read_all_data TO ${PAPEL_RO}`);
    // O papel de leitura precisa enxergar o schema `public` para resolver `to_regclass`.
    await C.query(`GRANT USAGE ON SCHEMA public TO ${PAPEL_RO}`);
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${e.message.split("\n").join("\n    ")}`,
        );
      }
    }
  } finally {
    await C.query(`DROP OWNED BY ${PAPEL_RO}`).catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${PAPEL_RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do portao 19 falharam.`,
    );
  }
  console.log(
    `\n[politica-devolucao-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

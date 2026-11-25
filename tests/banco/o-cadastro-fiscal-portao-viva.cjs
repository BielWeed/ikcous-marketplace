"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Caminhos, nomes de objeto e chaves sao constantes da prova ou do catalogo do Postgres efemero; nunca entrada de rede. */
/**
 * Prova VIVA das consultas 180a/180b (o portao da publicacao da 20261440000000, a loja guarda o cadastro fiscal), contra o
 * Postgres EFEMERO do rpc-ci com todas as migrations ja aplicadas (a prova roda num CLONE proprio, via rodar-isolado.cjs).
 *
 * POR QUE EXISTE: os testes unitarios (tests/ci_conferir_banco_test.ts) so medem o TEXTO dos .sql; nada as executava num
 * Postgres. Uma 180a com o md5 de um corpo antigo da funcao e uma 180b exigindo o fin_dre que a migration nao confere mais
 * passaram batidas por isso: o aplicador e o portao da publicacao teriam travado numa loja boa.
 *
 * O QUE SE PROVA (cada item no estado real do banco, nao no texto):
 *   (1) DEPOIS da migration: a 180a devolve o rol fechado de 9 itens, todos ok (POSITIVA no portao da release); a 180b
 *       reprova exatamente "a funcao ainda nao existe" e "as tabelas ainda nao existem" (o resto da base segue de pe);
 *   (2) SABOTAGEM por item: cada defeito plantado no estado de depois (INSERT/UPDATE/DELETE/TRUNCATE direto ao authenticated,
 *       ao service_role, por tabela e POR COLUNA, SELECT ao anon ou a PUBLIC, RLS desligada ou FORCE, politica `true`/para PUBLIC/
 *       de outro comando/extra/removida, corpo da funcao diferente, SECURITY INVOKER, sem search_path fixo, STABLE, STRICT,
 *       EXECUTE aberto ao anon/PUBLIC/service_role ou tirado do authenticated, sobrecarga, USAGE na sequencia, coluna que
 *       aceita nulo, CHECK removido) vira "nao" EXATAMENTE no item que cobre aquilo e em nenhum outro, e a 180a volta a
 *       POSITIVA quando o defeito sai;
 *   (3) ANTES da migration (rollback comum + destrutivo, dentro da transacao): a 180b e POSITIVA e a 180a reprova os 8 itens
 *       de objeto (so o controle fica ok); sabotagem da base que o pre-voo exige (porta do admin atual, EXECUTE do
 *       rls_admin_atual, dono_da_loja sem RLS, politica de fin_lancamentos ausente) reprova so o item dela; um objeto novo
 *       pela metade (so o log, ou uma sobrecarga da funcao) reprova a linha de ausencia;
 *   (4) o fin_dre NAO e pre-condicao: com o fin_dre sumido a 180b segue POSITIVA, a migration aplica e a 180a fica POSITIVA
 *       (e a 180b ANTIGA, com a assinatura do fin_dre, reprovaria uma loja que a migration aceita: a contradicao que o
 *       diretor achou);
 *   (5) DADO QUE JA EXISTIA: com uma linha no cadastro e uma na trilha, reaplicar a migration nao as toca e a 180a segue
 *       POSITIVA; o rollback comum as preserva e a 180b so reprova a linha das tabelas (de proposito);
 *   (6) o corpo da funcao com fim de linha CRLF (checkout de Windows) continua POSITIVA: o md5 e sem CR, como no pre-voo;
 *   (7) as consultas sao SO CATALOGO: rodam num papel SEM nenhum privilegio de tabela e em transacao somente leitura (ler
 *       linha de qualquer tabela falharia com "permission denied"), e esse papel de fato nao le as tabelas fiscais;
 *   (8) CONTROLES (mutantes da CONSULTA): sem a guarda da RLS, sem a guarda de escrita por coluna e com o md5 do corpo antigo
 *       a consulta mutante fica cega (ou reprova um banco bom) onde a consulta real acerta.
 *
 * Nao prova lojas reais nem o PostgREST: so o Postgres efemero do CI. As consultas rodam como o papel do conferir-banco-da-loja
 * rodaria (somente leitura); o portao da release e exercitado com a evidencia sintetica do mesmo VEREDITO que o workflow imprime.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-cadastro-fiscal-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const VERSAO = "20261440000000";
const NOME = `${VERSAO}_a_loja_guarda_o_cadastro_fiscal.sql`;
const ler = (...partes) => fs.readFileSync(path.join(...partes), "utf8");
const MIGRATION = ler(MIGRATIONS, NOME);
const ROLLBACK = ler(MIGRATIONS, `rollback-manual-${NOME}`);
const DESTRUTIVO = ler(MIGRATIONS, `rollback-manual-destrutivo-${NOME}`);
const A = "180a-conferir-o-cadastro-fiscal-aplicado";
const B = "180b-antes-o-cadastro-fiscal-ausente";
const SQL = Object.fromEntries(
  [A, B].map((nome) => [
    nome,
    ler(ROOT, "scripts", "publicacao", "consultas", `${nome}.sql`),
  ]),
);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36)}`;
const RO = `p180_ro_${SUF}`;
const REF = "abcdefghijklmnopqrst";
const SHA = "a".repeat(40);
// Fixtures inventadas (repositorio publico): nenhum id, nome ou e-mail de pessoa ou loja real.
const U_FIXTURE = "f1800000-0000-4000-8000-000000000001";
let PORTAO;
const passou = [];
function marcar(msg) {
  passou.push(msg);
  console.log(`PASSOU ${msg}`);
}

// O rol fechado vem do proprio conferir-banco.cjs (a mesma lista que o veredito do workflow confere); o rotulo de cada item
// e achado por trecho e tem de ser UNICO, para a prova nao apontar o item errado em silencio.
const ROL = {
  [A]: CONF.ROL_FECHADO_POR_CONSULTA[A],
  [B]: CONF.ROL_FECHADO_POR_CONSULTA[B],
};
function rotulo(nome, re) {
  const achados = ROL[nome].filter((i) => re.test(i));
  assert.equal(achados.length, 1, `${nome}: ${re} acha ${achados.length}`);
  return achados[0];
}
const IA = {
  controle: rotulo(A, /^controle:/),
  corpo: rotulo(A, /uma so, com o corpo/),
  atributos: rotulo(A, /atributos de sempre/),
  execute: rotulo(A, /EXECUTE so para authenticated/),
  rls: rotulo(A, /RLS ligada sem FORCE/),
  privilegios: rotulo(A, /so SELECT para authenticated e service_role/),
  colunas: rotulo(A, /colunas com o tipo e a nulidade/),
  chaves: rotulo(A, /no maximo uma linha por banco/),
  sequencia: rotulo(A, /sequencia do identity/),
};
const IB = {
  funcao: rotulo(B, /fiscal_cadastro_salvar: ainda NAO existe/),
  tabelas: rotulo(B, /ainda NAO existem/),
  portas: rotulo(B, /as portas do admin atual/),
  dono: rotulo(B, /^dono_da_loja existe/),
  politica: rotulo(B, /fin_lancamentos_admin_select_policy/),
};
const OBJETOS_DA_A = Object.values(IA).filter((i) => i !== IA.controle);
assert.equal(Object.keys(IA).length, 9, "a 180a tem 9 itens");
assert.equal(Object.keys(IB).length, 5, "a 180b tem 5 itens alem do controle");
assert.equal(ROL[B].length, 6, "a 180b tem 6 itens (sem o fin_dre)");

// O CREATE OR REPLACE da funcao, recortado da migration (para os mutantes de corpo).
const INICIO_FN = MIGRATION.indexOf(
  "CREATE OR REPLACE FUNCTION public.fiscal_cadastro_salvar(",
);
const FIM_FN =
  MIGRATION.indexOf("$function$;", INICIO_FN) + "$function$;".length;
assert.ok(
  INICIO_FN > 0 && FIM_FN > INICIO_FN,
  "funcao nao achada na migration",
);
const CRIA_FUNCAO = MIGRATION.slice(INICIO_FN, FIM_FN);
const GUARDA_DO_DONO =
  " OR NOT EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = v_quem)";
assert.ok(CRIA_FUNCAO.includes(GUARDA_DO_DONO), "guarda do dono nao achada");

async function emTransacao(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
async function isolado(c, fn) {
  await c.query("SAVEPOINT caso");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso");
    await c.query("RELEASE SAVEPOINT caso");
  }
}
async function evidencia(nome, linhas) {
  const quando = Date.parse("2026-11-25T12:00:00Z");
  return PORTAO.evidenciaDaProva({
    consulta: nome,
    projeto: "fixture",
    ref: REF,
    sha: SHA,
    topo: SHA,
    validadeHoras: 6,
    agora: quando + 60000,
    deps: {
      listarRuns: async (wf) =>
        wf === "conferir-banco-da-loja.yml"
          ? [
              {
                databaseId: 1,
                displayTitle: `conferir ${nome} em fixture`,
                headSha: SHA,
                createdAt: new Date(quando).toISOString(),
                conclusion: "success",
                status: "completed",
              },
            ]
          : [],
      logDoRun: async () =>
        CONF.veredictoDaConsulta({
          consulta: nome,
          ref: REF,
          sha: SHA,
          linhas,
        }),
      arvoreIgual: async () => true,
    },
  });
}
// Roda UM texto de consulta como papel sem privilegio de tabela, em transacao somente leitura; o SAVEPOINT desfaz o papel.
async function rodarSql(c, sql) {
  return isolado(c, async () => {
    await c.query(`SET LOCAL ROLE ${RO}`);
    await c.query("SET LOCAL transaction_read_only = on");
    assert.equal(CONF.contarStatements(sql), 1);
    return (await c.query(sql)).rows;
  });
}
// Roda a consulta DO ARQUIVO e confere: colunas, rol fechado exato, so as `reprovadas` com ok=false e o estado no portao.
async function consulta(c, nome, reprovadas = []) {
  const rows = await rodarSql(c, SQL[nome]);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, ROL[nome]),
    null,
    `${nome}: rol fechado`,
  );
  for (const linha of rows) assert.equal(typeof linha.ok, "boolean");
  const oks = rows.map((l) => l.ok);
  assert.deepEqual(
    oks,
    [...oks].sort((a, b) => Number(a) - Number(b)),
    "reprovadas primeiro",
  );
  assert.deepEqual(
    rows
      .filter((l) => !l.ok)
      .map((l) => l.item)
      .sort(),
    [...reprovadas].sort(),
    `${nome}: itens reprovados`,
  );
  const e = await evidencia(nome, rows);
  assert.equal(
    e.estado,
    reprovadas.length ? "NEGATIVA" : "POSITIVA",
    `${nome}: portao`,
  );
  return rows;
}
const reprovaItens = async (c, nome, itens) => consulta(c, nome, itens);
// Diz QUAL defeito plantado fez a asserção falhar (a mensagem do assert so fala do item).
async function comRotulo(rotuloDoDefeito, fn) {
  try {
    return await fn();
  } catch (erro) {
    erro.message = `[defeito: ${rotuloDoDefeito}] ${erro.message}`;
    throw erro;
  }
}

async function main() {
  const urlBase = lerDatabaseUrlEfemera();
  PORTAO = await import(
    pathToFileURL(path.join(ROOT, "scripts/frota/publicar-release.mjs")).href
  );
  const lote = PORTAO.lerCanais().provasDeObjetos.find((l) => l.consulta === A);
  assert.deepEqual(lote.versoes, [VERSAO]);
  assert.equal(lote.ausenciaConfirmadaPor, B);
  const c = new Client({ connectionString: urlBase });
  await c.connect();
  // Papel SEM privilegio de tabela nenhum (nem pg_read_all_data): se uma consulta lesse linha, falharia.
  await c.query(`CREATE ROLE ${RO} NOLOGIN`);
  try {
    // ---- (7) o instrumento: o papel da prova nao le linha das tabelas fiscais (senao "so catalogo" seria vacuo) ----
    await emTransacao(c, async () => {
      await c.query(`SET LOCAL ROLE ${RO}`);
      for (const t of [
        "fiscal_cadastro",
        "fiscal_cadastro_log",
        "dono_da_loja",
      ]) {
        await assert.rejects(
          c.query(`SELECT 1 FROM public.${t}`),
          /permission denied/,
          `o papel da prova nao pode ler ${t}`,
        );
        await c.query("ROLLBACK");
        await c.query("BEGIN");
        await c.query(`SET LOCAL ROLE ${RO}`);
      }
    });
    marcar(
      "o papel de leitura da prova nao le nenhuma linha das tabelas fiscais nem a do dono (as consultas rodam so com catalogo)",
    );

    await emTransacao(c, async () => {
      // ---- (1) DEPOIS: o clone ja vem com a migration aplicada ----
      const sequencia = (
        await c.query(
          "SELECT pg_get_serial_sequence('public.fiscal_cadastro_log', 'id') AS s",
        )
      ).rows[0].s;
      assert.ok(sequencia, "o log tem sequencia de identity");
      await consulta(c, A);
      await consulta(c, B, [IB.funcao, IB.tabelas]);
      marcar(
        "DEPOIS da migration: a 180a devolve os 9 itens todos ok (POSITIVA) e a 180b reprova so 'funcao' e 'tabelas' ainda nao existem",
      );

      // ---- (2) sabotagem por item ----
      const F = "public.fiscal_cadastro";
      const L = "public.fiscal_cadastro_log";
      const FN = "public.fiscal_cadastro_salvar(jsonb)";
      const sabotagens = [
        // privilegios (tabela e coluna)
        [
          "INSERT direto ao authenticated",
          `GRANT INSERT ON ${F} TO authenticated`,
          [IA.privilegios],
        ],
        [
          "UPDATE direto ao authenticated",
          `GRANT UPDATE ON ${F} TO authenticated`,
          [IA.privilegios],
        ],
        [
          "DELETE no log ao service_role",
          `GRANT DELETE ON ${L} TO service_role`,
          [IA.privilegios],
        ],
        [
          "TRUNCATE ao authenticated",
          `GRANT TRUNCATE ON ${F} TO authenticated`,
          [IA.privilegios],
        ],
        [
          "UPDATE por COLUNA (regime) ao authenticated",
          `GRANT UPDATE (regime) ON ${F} TO authenticated`,
          [IA.privilegios],
        ],
        [
          "INSERT por COLUNA no log ao service_role",
          `GRANT INSERT (quem, depois) ON ${L} TO service_role`,
          [IA.privilegios],
        ],
        [
          "SELECT no log ao anon",
          `GRANT SELECT ON ${L} TO anon`,
          [IA.privilegios],
        ],
        [
          "SELECT por COLUNA ao anon",
          `GRANT SELECT (regime) ON ${F} TO anon`,
          [IA.privilegios],
        ],
        ["tudo a PUBLIC", `GRANT ALL ON ${F} TO PUBLIC`, [IA.privilegios]],
        [
          "SELECT tirado do authenticated",
          `REVOKE SELECT ON ${F} FROM authenticated`,
          [IA.privilegios],
        ],
        [
          "SELECT tirado do service_role no log",
          `REVOKE SELECT ON ${L} FROM service_role`,
          [IA.privilegios],
        ],
        // RLS e politicas
        [
          "RLS desligada no cadastro",
          `ALTER TABLE ${F} DISABLE ROW LEVEL SECURITY`,
          [IA.rls],
        ],
        [
          "RLS desligada no log",
          `ALTER TABLE ${L} DISABLE ROW LEVEL SECURITY`,
          [IA.rls],
        ],
        [
          "FORCE RLS no cadastro",
          `ALTER TABLE ${F} FORCE ROW LEVEL SECURITY`,
          [IA.rls],
        ],
        [
          "politica de leitura trocada por USING (true)",
          `DROP POLICY fiscal_cadastro_select_policy ON ${F}; CREATE POLICY fiscal_cadastro_select_policy ON ${F} FOR SELECT TO authenticated USING (true)`,
          [IA.rls],
        ],
        [
          "politica que confia no JWT (is_admin) em vez do admin atual",
          `DROP POLICY fiscal_cadastro_log_select_policy ON ${L}; CREATE POLICY fiscal_cadastro_log_select_policy ON ${L} FOR SELECT TO authenticated USING ((SELECT public.is_admin()))`,
          [IA.rls],
        ],
        [
          "politica de leitura para PUBLIC",
          `DROP POLICY fiscal_cadastro_select_policy ON ${F}; CREATE POLICY fiscal_cadastro_select_policy ON ${F} FOR SELECT TO public USING ((SELECT public.rls_admin_atual()))`,
          [IA.rls],
        ],
        [
          "politica que vale para todos os comandos",
          `DROP POLICY fiscal_cadastro_select_policy ON ${F}; CREATE POLICY fiscal_cadastro_select_policy ON ${F} FOR ALL TO authenticated USING ((SELECT public.rls_admin_atual()))`,
          [IA.rls],
        ],
        [
          "segunda politica (INSERT livre) no log",
          `CREATE POLICY fiscal_cadastro_log_extra ON ${L} FOR INSERT TO authenticated WITH CHECK (true)`,
          [IA.rls],
        ],
        [
          "politica de leitura removida",
          `DROP POLICY fiscal_cadastro_log_select_policy ON ${L}`,
          [IA.rls],
        ],
        // a funcao
        [
          "corpo sem a conferencia do dono",
          CRIA_FUNCAO.replace(GUARDA_DO_DONO, ""),
          [IA.corpo],
        ],
        [
          "corpo com um espaco a mais",
          CRIA_FUNCAO.replace("DECLARE", "DECLARE "),
          [IA.corpo],
        ],
        [
          "SECURITY INVOKER",
          `ALTER FUNCTION ${FN} SECURITY INVOKER`,
          [IA.atributos],
        ],
        [
          "sem search_path fixo",
          `ALTER FUNCTION ${FN} RESET search_path`,
          [IA.atributos],
        ],
        [
          "search_path com pg_temp",
          `ALTER FUNCTION ${FN} SET search_path = public, pg_temp`,
          [IA.atributos],
        ],
        ["STABLE", `ALTER FUNCTION ${FN} STABLE`, [IA.atributos]],
        ["STRICT", `ALTER FUNCTION ${FN} STRICT`, [IA.atributos]],
        [
          "EXECUTE ao anon",
          `GRANT EXECUTE ON FUNCTION ${FN} TO anon`,
          [IA.execute],
        ],
        [
          "EXECUTE a PUBLIC",
          `GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`,
          [IA.execute],
        ],
        [
          "EXECUTE ao service_role",
          `GRANT EXECUTE ON FUNCTION ${FN} TO service_role`,
          [IA.execute],
        ],
        [
          "EXECUTE tirado do authenticated",
          `REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`,
          [IA.execute],
        ],
        [
          "sobrecarga da funcao",
          "CREATE FUNCTION public.fiscal_cadastro_salvar(p jsonb, q integer) RETURNS jsonb LANGUAGE sql AS $s$ SELECT p $s$",
          [IA.corpo],
        ],
        // a sequencia do identity do log
        [
          "USAGE na sequencia ao authenticated",
          `GRANT USAGE ON SEQUENCE ${sequencia} TO authenticated`,
          [IA.sequencia],
        ],
        // colunas e chaves
        [
          "regime aceita nulo",
          `ALTER TABLE ${F} ALTER COLUMN regime DROP NOT NULL`,
          [IA.colunas],
        ],
        [
          "atualizado_por aceita nulo",
          `ALTER TABLE ${F} ALTER COLUMN atualizado_por DROP NOT NULL`,
          [IA.colunas],
        ],
        [
          "coluna a mais (cnpj)",
          `ALTER TABLE ${F} ADD COLUMN cnpj text`,
          [IA.colunas],
        ],
        [
          "log.depois aceita nulo",
          `ALTER TABLE ${L} ALTER COLUMN depois DROP NOT NULL`,
          [IA.colunas],
        ],
        [
          "log.id deixa de ser identity (a sequencia sai junto)",
          `ALTER TABLE ${L} ALTER COLUMN id DROP IDENTITY`,
          [IA.colunas, IA.sequencia],
        ],
        [
          "CHECK de regime removido",
          `ALTER TABLE ${F} DROP CONSTRAINT fiscal_cadastro_regime_check`,
          [IA.chaves],
        ],
        [
          "CHECK de uma linha so removido",
          `ALTER TABLE ${F} DROP CONSTRAINT fiscal_cadastro_uma_so_check`,
          [IA.chaves],
        ],
        [
          "CHECK do dia 1 removido",
          `ALTER TABLE ${F} DROP CONSTRAINT fiscal_cadastro_vende_dia_1_check`,
          [IA.chaves],
        ],
      ];
      for (const [rotuloDoDefeito, ddl, itens] of sabotagens) {
        await comRotulo(rotuloDoDefeito, () =>
          isolado(c, async () => {
            await c.query(ddl);
            await reprovaItens(c, A, itens);
          }),
        );
        // O defeito saiu (savepoint desfeito): a 180a volta a POSITIVA.
        await consulta(c, A);
      }
      marcar(
        `SABOTAGEM por item: ${sabotagens.length} defeitos plantados (grants por tabela e por coluna, RLS, politicas, corpo, atributos, EXECUTE, sobrecarga, sequencia, colunas, CHECKs) reprovam EXATAMENTE o item certo da 180a e ela volta POSITIVA quando o defeito sai`,
      );

      // ---- (6) CRLF no corpo (checkout de Windows): o md5 e sem CR, continua POSITIVA ----
      await isolado(c, async () => {
        await c.query(CRIA_FUNCAO.replace(/\n/g, "\r\n"));
        const cr = (
          await c.query(
            `SELECT position(chr(13) in prosrc) > 0 AS tem_cr FROM pg_proc WHERE oid = '${FN}'::regprocedure`,
          )
        ).rows[0].tem_cr;
        assert.equal(cr, true, "o corpo gravado tem CR");
        await consulta(c, A);
      });
      marcar("corpo da funcao com CRLF continua POSITIVA (md5 sem CR)");

      // ---- (5) dado que ja existia: reaplicar nao toca as linhas e a 180a segue POSITIVA ----
      await isolado(c, async () => {
        await c.query(
          `INSERT INTO ${F} (regime, atividade, aberta_em, vende_no_app_desde, atualizado_por)
           VALUES ('simples', 'comercio', DATE '2020-03-10', DATE '2021-01-01', $1)`,
          [U_FIXTURE],
        );
        await c.query(
          `INSERT INTO ${L} (quem, antes, depois) VALUES ($1, NULL, '{"regime":"simples"}'::jsonb)`,
          [U_FIXTURE],
        );
        const foto = async () =>
          (
            await c.query(
              `SELECT (SELECT to_jsonb(f) FROM ${F} f) AS cadastro, (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM ${L} l) AS trilha`,
            )
          ).rows[0];
        const antes = await foto();
        assert.equal(antes.cadastro.regime, "simples");
        assert.equal(antes.trilha.length, 1);
        await c.query(MIGRATION);
        await c.query(MIGRATION);
        assert.deepEqual(await foto(), antes, "reaplicar mexeu nas linhas");
        await consulta(c, A);
        // Rollback comum com linhas: as tabelas e as linhas ficam, a funcao e as politicas saem.
        await c.query(ROLLBACK);
        assert.deepEqual(
          await foto(),
          antes,
          "o rollback comum mexeu nas linhas",
        );
        await consulta(c, B, [IB.tabelas]);
        await consulta(c, A, [IA.corpo, IA.atributos, IA.execute, IA.rls]);
        // Voltar: reaplicar sobre as linhas que ficaram devolve a 180a POSITIVA, sem tocar nas linhas.
        await c.query(MIGRATION);
        assert.deepEqual(
          await foto(),
          antes,
          "reaplicar depois do rollback mexeu nas linhas",
        );
        await consulta(c, A);
      });
      marcar(
        "DADO QUE JA EXISTIA: reaplicar 2x nao toca a linha do cadastro nem a da trilha; o rollback comum as preserva (180b so reprova a linha das tabelas, de proposito; 180a reprova funcao e politicas); reaplicar volta a 180a POSITIVA",
      );

      // ---- (8) controles: a consulta MUTANTE fica cega onde a real acerta ----
      const mutantes = [
        [
          "sem a guarda da RLS",
          SQL[A].replace(
            "t.relrowsecurity AND NOT t.relforcerowsecurity",
            "true",
          ),
          `ALTER TABLE ${F} DISABLE ROW LEVEL SECURITY`,
          [IA.rls],
        ],
        [
          "sem a guarda de escrita POR COLUNA do authenticated",
          SQL[A].replace(
            "AND NOT has_any_column_privilege('authenticated', t.oid, 'INSERT, UPDATE, REFERENCES')",
            "",
          ),
          `GRANT UPDATE (regime) ON ${F} TO authenticated`,
          [IA.privilegios],
        ],
        [
          "sem a guarda do EXECUTE do anon",
          SQL[A].replace(
            "AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')",
            "",
          ),
          `GRANT EXECUTE ON FUNCTION ${FN} TO anon`,
          [IA.execute],
        ],
      ];
      for (const [nome, sqlMutante, ddl, itens] of mutantes) {
        assert.notEqual(
          sqlMutante,
          SQL[A],
          `o mutante '${nome}' nao mudou a consulta`,
        );
        await isolado(c, async () => {
          await c.query(ddl);
          const cega = await rodarSql(c, sqlMutante);
          assert.deepEqual(
            cega.filter((l) => !l.ok).map((l) => l.item),
            [],
            `mutante '${nome}' deveria ficar cego ao defeito`,
          );
          await reprovaItens(c, A, itens);
        });
      }
      // O defeito original: a 180a com o md5 do corpo ANTIGO reprova um banco BOM (travaria a publicacao numa loja boa).
      const velha = SQL[A].replace(
        "198c24062f62dd29aae1f96fcaed6603",
        "0e76c24e09699b4aba53600bf4061c67",
      );
      assert.notEqual(velha, SQL[A]);
      assert.deepEqual(
        (await rodarSql(c, velha)).filter((l) => !l.ok).map((l) => l.item),
        [IA.corpo],
        "a 180a com o md5 antigo tem de reprovar o corpo vigente",
      );
      marcar(
        "CONTROLES: a consulta mutante (sem a guarda da RLS, sem a guarda por coluna, sem a do EXECUTE do anon) fica cega ao defeito plantado onde a real o acusa; com o md5 antigo a 180a reprovaria o banco bom",
      );

      // ---- (3) ANTES: rollback comum + destrutivo; a 180b e POSITIVA, a 180a reprova os 8 itens de objeto ----
      await c.query(ROLLBACK);
      await c.query("SET LOCAL app.confirmo_apagar_cadastro_fiscal = 'APAGAR'");
      await c.query(DESTRUTIVO);
      await consulta(c, B);
      await consulta(c, A, OBJETOS_DA_A);
      marcar(
        "ANTES da migration (rollback comum + destrutivo): a 180b e POSITIVA (6 itens ok) e a 180a reprova os 8 itens de objeto, so o controle fica ok",
      );
      const baseDoPreVoo = [
        [
          "porta do admin atual com outro corpo",
          "CREATE OR REPLACE FUNCTION public.is_admin_atual() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $s$ SELECT true $s$",
          [IB.portas],
        ],
        [
          "rls_admin_atual sem EXECUTE para o authenticated",
          "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
          [IB.portas],
        ],
        [
          "rls_admin_atual executavel pelo anon",
          "GRANT EXECUTE ON FUNCTION public.rls_admin_atual() TO anon",
          [IB.portas],
        ],
        [
          "dono_da_loja sem RLS",
          "ALTER TABLE public.dono_da_loja DISABLE ROW LEVEL SECURITY",
          [IB.dono],
        ],
        [
          "dono_da_loja com coluna a mais",
          "ALTER TABLE public.dono_da_loja ADD COLUMN extra text",
          [IB.dono],
        ],
        [
          "politica de fin_lancamentos ausente",
          "DROP POLICY fin_lancamentos_admin_select_policy ON public.fin_lancamentos",
          [IB.politica],
        ],
        [
          "so o log ja criado (objeto novo pela metade)",
          "CREATE TABLE public.fiscal_cadastro_log (id integer)",
          [IB.tabelas],
        ],
        [
          "so o cadastro ja criado (objeto novo pela metade)",
          "CREATE TABLE public.fiscal_cadastro (id integer)",
          [IB.tabelas],
        ],
        [
          "a funcao ja criada com outra assinatura",
          "CREATE FUNCTION public.fiscal_cadastro_salvar(p text) RETURNS text LANGUAGE sql AS $s$ SELECT p $s$",
          [IB.funcao],
        ],
      ];
      for (const [nome, ddl, itens] of baseDoPreVoo) {
        await comRotulo(nome, () =>
          isolado(c, async () => {
            await c.query(ddl);
            await reprovaItens(c, B, itens);
          }),
        );
      }
      await consulta(c, B);
      marcar(
        `ANTES: ${baseDoPreVoo.length} defeitos na base que o pre-voo exige (porta, EXECUTE, dono_da_loja, politica de fin_lancamentos) e no 'pela metade' reprovam so a linha da 180b que cobre cada um; restaurada volta POSITIVA`,
      );

      // ---- (4) o fin_dre NAO e pre-condicao ----
      await isolado(c, async () => {
        await c.query(
          "ALTER FUNCTION public.fin_dre(date, date) RENAME TO fin_dre_ausente_na_prova",
        );
        assert.equal(
          (
            await c.query(
              "SELECT to_regprocedure('public.fin_dre(date,date)') IS NULL AS some",
            )
          ).rows[0].some,
          true,
        );
        await consulta(c, B);
        // A 180b ANTIGA (com a assinatura do fin_dre) reprovaria esta loja, que a migration aceita sem reclamar.
        const antiga = SQL[B].replace(
          "\n)\nSELECT item",
          `\n  UNION ALL SELECT 'fin_dre existe com o corpo vigente (md5)', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fin_dre(date,date)') AND md5(replace(p.prosrc, chr(13), '')) = 'a27c9649621b3ac1502f458576120259') THEN 'sim' ELSE 'nao' END\n)\nSELECT item`,
        );
        assert.notEqual(antiga, SQL[B]);
        assert.deepEqual(
          (await rodarSql(c, antiga)).filter((l) => !l.ok).map((l) => l.item),
          ["fin_dre existe com o corpo vigente (md5)"],
        );
        await c.query(MIGRATION);
        await consulta(c, A);
        await consulta(c, B, [IB.funcao, IB.tabelas]);
      });
      marcar(
        "fin_dre NAO e pre-condicao: com ele sumido a 180b segue POSITIVA, a migration aplica e a 180a fica POSITIVA; a 180b antiga reprovaria essa loja",
      );

      // ---- por fim, aplicar do estado de antes (as tabelas nascem vazias): 180a POSITIVA, sem linha nenhuma ----
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.equal(
        (
          await c.query(
            `SELECT (SELECT count(*) FROM ${F}) + (SELECT count(*) FROM ${L}) AS n`,
          )
        ).rows[0].n,
        "0",
        "as tabelas nascem vazias",
      );
      marcar(
        "aplicar do estado de antes: as duas tabelas nascem vazias e a 180a fica POSITIVA",
      );
    });
  } finally {
    await c.query(`DROP ROLE IF EXISTS ${RO}`).catch(() => {});
    await c.end().catch(() => {});
  }
  anexarAoSummary(
    "Portao do cadastro fiscal (180a/180b)",
    passou.map((s) => `- ${s}`).join("\n"),
  );
  console.log(`\no-cadastro-fiscal-portao-viva: ${passou.length} ok`);
}
main().catch((erro) => falhar("PORTAO-180", erro.stack || String(erro)));

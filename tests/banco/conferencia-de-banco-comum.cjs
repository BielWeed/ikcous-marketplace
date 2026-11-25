"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Caminhos, nomes de banco e chaves sao constantes das provas; so PG efemero. */
/**
 * Esqueleto compartilhado das provas VIVAS das consultas de conferencia "a" (aplicado) e "b" (antes) do rol fechado
 * (scripts/publicacao/consultas/*.sql), as que a ferramenta de publicacao roda no banco de CADA loja para decidir se uma
 * migration "entrou certa". Nao e' uma prova por si: cada `*-viva.cjs` traz as sabotagens e o que espera delas; isto traz o
 * que e' igual em todas (o mesmo molde de motivo-da-recusa-portao-viva.cjs, a prova da 56a/56b):
 *
 *  - a BASE nasce do zero (provisionar.cjs + aplicar-migrations.cjs) com SO as migrations ANTERIORES a da prova: e' o estado
 *    em que a loja esta quando a "b" roda; a migration real e' aplicada por cima (numa transacao desfeita) e e' o estado em
 *    que a "a" roda. Nao e' o banco inteiro de hoje: migrations posteriores podem trocar os corpos que a "a" confere;
 *  - `consulta()` roda o .sql REAL do repositorio, como papel de leitura, numa transacao somente leitura, confere o rol
 *    fechado (estrutura, ordem, tipos) e a lista EXATA de itens reprovados, e passa o resultado pelo portao da ferramenta
 *    (evidenciaDaProva: POSITIVA so sem nenhum `nao`); depois repete como papel SEM nenhum privilegio de tabela para provar
 *    que ela le so catalogo (nunca dado de cliente) e que as linhas sao as mesmas;
 *  - `sabotar()` aplica UM estrago dentro de um savepoint e exige que SO os itens declarados virem `nao`; o savepoint volta
 *    e a consulta limpa volta a ser POSITIVA (um estrago nao contamina o seguinte);
 *  - `trocarCorpo()` muda so o TEXTO do corpo de uma funcao (um comentario no fim), preservando atributos, dono e ACL:
 *    o unico item que pode notar e' o do md5.
 *
 * Somente Postgres EFEMERO (efemero.cjs recusa qualquer outro alvo). Nunca conecta em loja.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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
const REF = "abcdefghijklmnopqrst";
const SHA = "a".repeat(40);

/**
 * @param {{prefixo: string, arquivo: string, a: string, b: string, titulo: string}} cfg
 *   prefixo: curto, vira parte do nome dos bancos/papeis; arquivo: nome da migration da prova;
 *   a/b: nomes das consultas (sem .sql); titulo: o do resumo do job.
 */
function criarBancada(cfg) {
  const { prefixo, arquivo, a, b, titulo } = cfg;
  const versao = arquivo.split("_")[0];
  const SUF = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  const RO = `${prefixo}_ro_${SUF}`;
  const MIN = `${prefixo}_min_${SUF}`;
  const BANCOS = [];
  const passou = [];
  const avisos = [];
  const SQL = Object.fromEntries(
    [a, b].map((nome) => [
      nome,
      fs.readFileSync(
        path.join(ROOT, "scripts", "publicacao", "consultas", `${nome}.sql`),
        "utf8",
      ),
    ]),
  );
  const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, arquivo), "utf8");
  let urlBase;
  let PORTAO;

  function marcar(msg) {
    passou.push(msg);
    console.log(`PASSOU ${msg}`);
  }
  function urlDe(db) {
    const u = new URL(urlBase);
    u.pathname = `/${db}`;
    return u.toString();
  }
  async function usar(db, fn) {
    const c = new Client({ connectionString: urlDe(db) });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }
  async function criar(rotulo, molde) {
    const nome = `${prefixo}_${SUF}_${rotulo}`;
    await usar("template1", (c) =>
      c.query(
        molde
          ? `CREATE DATABASE "${nome}" TEMPLATE "${molde}"`
          : `CREATE DATABASE "${nome}" TEMPLATE template0`,
      ),
    );
    BANCOS.push(nome);
    return nome;
  }
  function rodarScriptNode(argv, db) {
    const r = spawnSync(process.execPath, argv, {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: urlDe(db) },
      encoding: "utf8",
    });
    assert.equal(
      r.status,
      0,
      `${path.basename(argv[0])} falhou:\n${r.stdout || ""}\n${r.stderr || ""}`,
    );
  }
  /** O banco como a loja esta ANTES da migration: so as migrations anteriores a ela. */
  async function montarBase() {
    const db = await criar("antes");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefixo}-`));
    try {
      const nomes = fs
        .readdirSync(MIGRATIONS, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".sql"))
        .map((e) => e.name)
        // Mesma regra do aplicar-migrations.cjs: rollback-manual nao e migration
        // e a ordem e a do nome (duas migrations antigas tem versao de 13 digitos).
        .filter((n) => !n.startsWith("rollback-") && n < arquivo)
        .sort();
      assert.ok(nomes.length > 0, "base anterior nao pode estar vazia");
      for (const n of nomes) {
        fs.copyFileSync(path.join(MIGRATIONS, n), path.join(dir, n));
      }
      rodarScriptNode([path.join(__dirname, "provisionar.cjs")], db);
      rodarScriptNode(
        [path.join(__dirname, "aplicar-migrations.cjs"), dir],
        db,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // O papel "minimo" so enxerga o catalogo: USAGE nos esquemas e mais nada (nenhum privilegio de tabela).
    await usar(db, (c) =>
      c.query(`GRANT USAGE ON SCHEMA public, auth TO ${MIN}`),
    );
    return db;
  }
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
    const quando = Date.parse("2026-10-20T12:00:00Z");
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
  async function rodar(c, papel, nome) {
    // SAVEPOINT restaura o papel e transaction_read_only sem desfazer o cenario.
    return isolado(c, async () => {
      await c.query(`SET LOCAL ROLE ${papel}`);
      await c.query("SET LOCAL transaction_read_only = on");
      assert.equal(CONF.contarStatements(SQL[nome]), 1);
      const r = await c.query(SQL[nome]);
      return r;
    });
  }
  /** Roda a consulta e exige EXATAMENTE `reprovadas` como itens `nao` (o resto `sim`). Devolve as linhas. */
  async function consulta(c, nome, reprovadas = []) {
    const r = await rodar(c, RO, nome);
    assert.deepEqual(
      r.fields.map((f) => f.name),
      ["item", "esperado", "vivo", "ok"],
    );
    assert.equal(
      CONF.estruturaDoRolFechado(r.rows, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
      null,
      nome,
    );
    for (const linha of r.rows) assert.equal(typeof linha.ok, "boolean");
    const oks = r.rows.map((l) => l.ok);
    assert.deepEqual(
      oks,
      [...oks].sort((x, y) => Number(x) - Number(y)),
      `${nome}: reprovadas primeiro`,
    );
    assert.deepEqual(
      r.rows
        .filter((l) => !l.ok)
        .map((l) => l.item)
        .sort(),
      [...reprovadas].sort(),
      `${nome}: itens reprovados`,
    );
    const e = await evidencia(nome, r.rows);
    assert.equal(e.estado, reprovadas.length ? "NEGATIVA" : "POSITIVA", nome);
    // So catalogo: sem nenhum privilegio de tabela, a resposta e' a mesma (se a consulta lesse a tabela, daria permission denied).
    const m = await rodar(c, MIN, nome);
    assert.deepEqual(m.rows, r.rows, `${nome}: so catalogo (papel minimo)`);
    return r.rows;
  }
  /** O item do rol cujo texto comeca com `inicio` (exatamente um). */
  function item(nome, inicio) {
    const rol = CONF.ROL_FECHADO_POR_CONSULTA[nome];
    const achados = rol.filter((i) => i.startsWith(inicio));
    assert.equal(
      achados.length,
      1,
      `${nome}: item "${inicio}" -> ${achados.length}`,
    );
    return achados[0];
  }
  /** Um estrago por vez: so os itens `reprovadas` viram `nao`; limpo, volta a ser POSITIVO. */
  async function sabotar(c, rotulo, nome, sql, reprovadas, linhasBase = []) {
    await isolado(c, async () => {
      for (const s of Array.isArray(sql) ? sql : [sql]) {
        if (typeof s === "function") await s(c);
        else await c.query(s);
      }
      await consulta(c, nome, reprovadas);
    });
    await consulta(c, nome, linhasBase);
    marcar(`${nome.split("-")[0]}: ${rotulo}`);
  }
  /** Troca SO o texto do corpo (um comentario no fim): atributos, dono e ACL ficam; so o md5 muda. */
  async function trocarCorpo(c, assinatura) {
    const def = (
      await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
        assinatura,
      ])
    ).rows[0].d;
    const i = def.lastIndexOf("$function$");
    assert.ok(i > 0, `corpo de ${assinatura} sem $function$`);
    await c.query(`${def.slice(0, i)}\n-- sabotagem\n${def.slice(i)}`);
  }
  /** Roda `sql` COMO `papel` num savepoint e devolve o codigo do erro (ex.: 42501) ou null se passou. */
  async function tentar(c, papel, sql, params = []) {
    return isolado(c, async () => {
      await c.query(`SET LOCAL ROLE ${papel}`);
      try {
        await c.query(sql, params);
        return null;
      } catch (erro) {
        assert.ok(erro.code, `erro sem codigo: ${erro.message}`);
        return erro.code;
      }
    });
  }
  async function iniciar() {
    urlBase = lerDatabaseUrlEfemera();
    PORTAO = await import(
      pathToFileURL(path.join(ROOT, "scripts/frota/publicar-release.mjs")).href
    );
    const lote = PORTAO.lerCanais().provasDeObjetos.find(
      (l) => l.consulta === a,
    );
    if (lote) {
      assert.deepEqual(lote.versoes, [versao]);
      assert.equal(lote.ausenciaConfirmadaPor, b);
    } else {
      // Lacuna da CONFIGURACAO da ferramenta, nao da consulta: o lote desta migration nao esta declarado em
      // scripts/frota/canais-de-backend.json. A prova segue (mede a consulta), mas o aviso fica no log e no resumo.
      avisos.push(
        `${a} NAO esta declarada em canais-de-backend.json (provasDeObjetos): a ferramenta aponta "migration nova ${versao} sem prova de objetos declarada"`,
      );
      console.log(`AVISO ${avisos[avisos.length - 1]}`);
    }
    await usar("template1", async (c) => {
      await c.query(`CREATE ROLE ${RO} NOLOGIN BYPASSRLS`);
      await c.query(`GRANT pg_read_all_data TO ${RO}`);
      await c.query(`CREATE ROLE ${MIN} NOLOGIN`);
    });
  }
  async function encerrar() {
    for (const db of [...BANCOS].reverse()) {
      await usar("template1", (c) =>
        c.query(`DROP DATABASE IF EXISTS "${db}"`),
      );
    }
    await usar("template1", async (c) => {
      await c.query(`DROP ROLE IF EXISTS ${RO}`);
      await c.query(`DROP ROLE IF EXISTS ${MIN}`);
    });
  }
  function resumir() {
    anexarAoSummary(
      titulo,
      [
        ...passou.map((s) => `- ${s}`),
        ...avisos.map((s) => `- AVISO: ${s}`),
      ].join("\n"),
    );
    console.log(`\n${prefixo}: ${passou.length} ok`);
  }
  async function rodarProva(corpo) {
    try {
      await iniciar();
      await corpo({
        MIGRATION,
        SQL,
        a,
        b,
        usar,
        criar,
        montarBase,
        emTransacao,
        isolado,
        consulta,
        item,
        sabotar,
        trocarCorpo,
        tentar,
        marcar,
      });
    } finally {
      await encerrar();
    }
    resumir();
  }
  return {
    rodarProva: (corpo) =>
      rodarProva(corpo).catch((erro) =>
        falhar(`PORTAO-${prefixo}`, erro.stack || String(erro)),
      ),
  };
}

module.exports = { criarBancada };

"use strict";

/**
 * Prova VIVA da faixa histórica 20261160..20261166 da CAF (consulta 9a e backfill
 * do ledger 60-66), num Postgres EFÊMERO local — nada de rede, nada de loja.
 *
 * O QUE RODA (cada cenário num banco clonado, `CREATE DATABASE … TEMPLATE`, que
 * some no fim; a 9a sempre como papel SÓ-LEITURA: pg_read_all_data + transação
 * somente leitura, o mesmo desenho do item (j) de impressao-digital-viva.cjs):
 *
 *  (a) POSITIVO = a ÁRVORE FINAL inteira aplicada: a 9a devolve EXATAMENTE o rol
 *      fechado do código (ROL_DA_9A), cada item uma vez, todos ok=true. A 8e (rol
 *      da faixa 92-202) idem. O DISCRIMINANTE da prova não é este caso nem o (b):
 *      são os defeitos isolados de (c) e as ACLs de (d).
 *  (b) CONTROLE NEGATIVO "omitido" = o estado ANTERIOR à 20261160 (só as
 *      migrations < 20261160 aplicadas): a 9a reprova NOMEANDO os objetos
 *      ausentes. Não é o discriminante: uma árvore com 60..66 omitidas e o
 *      resto aplicado não existe (a 67 tem preflight do hash da 65, a 99 exige
 *      `registrar_venda_presencial`).
 *  (c) DEFEITOS ISOLADOS sobre a árvore final, um por clone (DROP, índice com
 *      outro predicado, índice inválido, CHECK diferente, NOT VALID, homônima
 *      noutra tabela, gatilho desabilitado/removido/em outra tabela, default,
 *      tipo, FK, UNIQUE com outras colunas, corpo antigo da 62/63, corpo
 *      alterado, vista alterada, overload de 7 argumentos): cada um reprova
 *      EXATAMENTE a linha certa (e as que dependem dela), nenhuma outra.
 *      Também os METADADOS de função com o prosrc INTACTO (SECURITY, search_path,
 *      volatilidade, STRICT, dono, argumentos, retorno, linguagem), os atributos
 *      de restrição/FK/índice (adiável, update/match, collation/opclass, NULLS NOT
 *      DISTINCT) e o privilégio de coluna x tabela (inclusive o herdado).
 *  (d) ACL (o que só 61..64 deixam): GRANT EXECUTE … TO PUBLIC / TO anon e
 *      REVOKE do authenticated em CADA uma das 4 funções, mais o service_role da
 *      `registrar_venda_presencial` — cada uma reprova a linha `acl <fn>`.
 *  (e) O LEDGER, num banco com `supabase_migrations.schema_migrations` montado
 *      como a CAF (150 e 167, sem 160..166 = a lacuna): a 9a dá a MESMA resposta
 *      antes e depois do INSERT guardado (não olha o ledger); o INSERT grava 0 → 7
 *      linhas; rodar de novo grava 0; com a 150 ou a 167 ausente grava 0; com uma
 *      versão da faixa já presente grava 0.
 *  (f) PONTA A PONTA: `conferir-banco.cjs` (processo filho, de verdade) falando
 *      HTTP com um servidor local que executa as consultas neste Postgres (leitura
 *      como papel só-leitura, escrita como dono): lacuna → grava e confere as 7;
 *      já registrado → "nada a gravar", ZERO escritas; objeto sabotado → recusa
 *      sem escrever; ledger parcial → recusa sem escrever.
 *
 * LIMITE DECLARADO: o Postgres é o 17 LOCAL; a versão e o papel de leitura reais
 * da CAF (supabase_read_only_user) não foram medidos aqui — a Management API real
 * não é tocada. O transporte HTTP de (f) é um servidor de teste, não a API.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/lote-60-66-viva.cjs
 *      (ou direto com node tests/banco/lote-60-66-viva.cjs)
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vêm do próprio repositório (supabase/migrations e a pasta de
 * consultas), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do próprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const PAPEL_RO = "l66_ro_prova";
const PAPEL_DONO = "l66_dono_prova";
const NOME_FULL = "l66_base_full";
const NOME_PRE60 = "l66_base_pre60";

const urlBase = lerDatabaseUrlEfemera();
const urlDe = (db) => {
  const u = new URL(urlBase);
  u.pathname = `/${db}`;
  return u.toString();
};
async function usar(db, fn) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}
const clones = [];
async function clonar(molde, novo) {
  await usar("template1", async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${novo}"`);
    await a.query(`CREATE DATABASE "${novo}" TEMPLATE "${molde}"`);
  });
  clones.push(novo);
  return novo;
}

let resultados = 0;
function ok(msg) {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
}

/** Monta um banco-base: provisiona um banco NOVO e aplica as migrations que
 * passam no filtro, pelos mesmos scripts que o rpc-ci.yml usa. */
async function montarBase(nome, filtro) {
  await usar("template1", async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  clones.push(nome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l66-"));
  try {
    for (const e of fs.readdirSync(MIGRATIONS, { withFileTypes: true })) {
      const f = e.name;
      if (
        e.isFile() &&
        f.endsWith(".sql") &&
        !f.startsWith("rollback-") &&
        filtro(f)
      ) {
        fs.copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
      }
    }
    const env = { ...process.env, DATABASE_URL: urlDe(nome) };
    for (const argv of [
      [path.join(__dirname, "provisionar.cjs")],
      [path.join(__dirname, "aplicar-migrations.cjs"), dir],
    ]) {
      const r = spawnSync(process.execPath, argv, { env, encoding: "utf8" });
      assert.equal(
        r.status,
        0,
        `${path.basename(argv[0])} falhou ao montar ${nome}:\n${(r.stdout || "").slice(-600)}\n${(r.stderr || "").slice(-600)}`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const sqlDe = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");

/** Roda uma consulta do menu como o papel só-leitura (pg_read_all_data +
 * transação somente leitura por padrão). */
async function comoLeitor(db, nome) {
  const sql = sqlDe(nome);
  assert.equal(
    CONF.contarStatements(sql),
    1,
    `${nome}: exatamente 1 statement`,
  );
  return usar(db, async (c) => {
    await c.query(`SET ROLE ${PAPEL_RO}`);
    await c.query("SET default_transaction_read_only = on");
    try {
      assert.equal(
        (await c.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
      const r = await c.query(sql);
      assert.deepEqual(
        r.fields.map((f) => f.name),
        ["item", "esperado", "vivo", "ok"],
        `${nome}: colunas item/esperado/vivo/ok`,
      );
      return r.rows;
    } finally {
      await c.query("RESET ROLE");
    }
  });
}
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
const nove = (db) => comoLeitor(db, "9a-conferir-60-a-66-aplicado");

/** Cada sabotagem é aplicada num clone da árvore FINAL e a 9a tem de reprovar
 * EXATAMENTE as linhas esperadas. */
async function sabotagem(rotulo, sql, esperadas, { semOutras = true } = {}) {
  const db = await clonar(NOME_FULL, `l66_s_${clones.length}`);
  await usar(db, (c) => c.query(sql));
  const rows = await nove(db);
  const falhas = reprovadas(rows);
  assert.deepEqual(
    falhas,
    [...esperadas].sort(),
    `${rotulo}: reprovou ${JSON.stringify(falhas)}, esperava ${JSON.stringify(esperadas)}`,
  );
  assert.equal(rows.length, CONF.ROL_DA_9A.length);
  void semOutras;
  ok(
    `${rotulo} → reprova ${esperadas.map((e) => `"${e}"`).join(" + ")} e só ela(s)`,
  );
  return rows;
}

/** O CREATE de uma função, copiado do arquivo da migration (do CREATE OR REPLACE até o `$function$;`). */
function criarDaMigration(arquivoPrefixo, assinaturaInicio) {
  const arq = fs
    .readdirSync(MIGRATIONS)
    .find(
      (f) =>
        f.startsWith(arquivoPrefixo) &&
        f.endsWith(".sql") &&
        !f.startsWith("rollback"),
    );
  const texto = fs.readFileSync(path.join(MIGRATIONS, arq), "utf8");
  const ini = texto.indexOf(`\n${assinaturaInicio}`) + 1; // ancorado no começo da linha: o nome também aparece em comentário
  assert.ok(ini >= 1, `${arq}: não achei ${assinaturaInicio}`);
  const fim = texto.indexOf(
    "$function$;",
    texto.indexOf("$function$", ini) + 10,
  );
  assert.ok(fim > ini);
  return texto.slice(ini, fim + "$function$;".length);
}

// ---------------------------------------------------------------------------
// (f) o servidor de teste que faz o papel da Management API contra um clone
// ---------------------------------------------------------------------------
function subirApi() {
  const estado = { db: null, escritas: 0, leituras: 0, corpoDeEscrita: [] };
  const srv = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", async () => {
      const apenasLeitura = req.url.endsWith("/database/query/read-only");
      const query = JSON.parse(corpo).query;
      try {
        const c = new Client({ connectionString: urlDe(estado.db) });
        await c.connect();
        try {
          if (apenasLeitura) {
            estado.leituras += 1;
            await c.query(`SET ROLE ${PAPEL_RO}`);
            await c.query("SET default_transaction_read_only = on");
          } else {
            estado.escritas += 1;
            estado.corpoDeEscrita.push(query);
          }
          const r = await c.query(query);
          res.writeHead(201, {
            "content-type": "application/json",
            connection: "close",
          });
          res.end(JSON.stringify(r.rows ?? []));
        } finally {
          await c.end().catch(() => {});
        }
      } catch (erro) {
        res.writeHead(400, {
          "content-type": "application/json",
          connection: "close",
        });
        res.end(JSON.stringify({ message: String(erro.message) }));
      }
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () =>
      resolve({
        estado,
        base: `http://127.0.0.1:${srv.address().port}`,
        parar: () => new Promise((r) => srv.close(r)),
      }),
    ),
  );
}
function rodarScript(env) {
  return new Promise((resolve) => {
    const filho = spawn(
      process.execPath,
      [path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs")],
      {
        env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: "", ...env },
      },
    );
    let saida = "";
    filho.stdout.on("data", (d) => (saida += d));
    filho.stderr.on("data", (d) => (saida += d));
    filho.on("close", (codigo) => resolve({ codigo, saida }));
  });
}

async function main() {
  // O papel só-leitura é do CLUSTER; a prova o cria e o remove.
  await usar("template1", async (a) => {
    await a.query(`DROP ROLE IF EXISTS ${PAPEL_RO}`).catch(() => {});
    await a.query(`CREATE ROLE ${PAPEL_RO} NOLOGIN BYPASSRLS`);
    await a.query(`GRANT pg_read_all_data TO ${PAPEL_RO}`);
    await a.query(`DROP ROLE IF EXISTS ${PAPEL_DONO}`).catch(() => {});
    await a.query(`CREATE ROLE ${PAPEL_DONO} NOLOGIN`);
  });

  await montarBase(NOME_FULL, () => true);
  await montarBase(NOME_PRE60, (f) => f < "20261160");
  ok("bases montadas: árvore FINAL inteira e o estado ANTERIOR à 20261160");

  // ----------------------------------------------------------- (a) positivo
  {
    const rows = await nove(NOME_FULL);
    assert.deepEqual(reprovadas(rows), [], "9a na árvore final: tudo ok");
    assert.deepEqual(
      rows.map((r) => r.item).sort(),
      [...CONF.ROL_DA_9A].sort(),
      "o conjunto de itens que a 9a devolve é EXATAMENTE o ROL_DA_9A do código (cada um uma vez)",
    );
    assert.equal(new Set(rows.map((r) => r.item)).size, rows.length);
    for (const r of rows) assert.equal(typeof r.ok, "boolean");
    // o rol fechado do código aceita a resposta REAL (com os tipos reais)
    CONF.conferirRolFechado({
      faixa: "60-66",
      nomeConsulta: "9a",
      linhas: rows,
      rol: CONF.ROL_DA_9A,
    });
    ok(
      `(a) positivo: a 9a na árvore final devolve os ${rows.length} itens do rol, todos ok=true, e o rol fechado do código a aceita`,
    );
    const e8 = await comoLeitor(NOME_FULL, "8e-conferir-92-a-202-aplicado");
    assert.deepEqual(reprovadas(e8), []);
    assert.deepEqual(e8.map((r) => r.item).sort(), [...CONF.ROL_DA_8E].sort());
    CONF.conferirRolFechado({
      faixa: "92-202",
      nomeConsulta: "8e",
      linhas: e8,
      rol: CONF.ROL_DA_8E,
    });
    ok(
      `(a) a 8e na árvore final devolve EXATAMENTE os ${e8.length} itens do ROL_DA_8E, todos ok=true`,
    );
    // O texto dos itens que mudam com a versão do Postgres sai na linha: o dono vê o vivo.
    for (const r of rows)
      assert.ok(
        r.vivo !== null && r.vivo !== undefined && r.vivo !== "",
        r.item,
      );
  }

  // ------------------------------------------------ (b) controle: omitido
  {
    const rows = await nove(NOME_PRE60);
    const falhas = reprovadas(rows);
    for (const item of [
      "coluna produtos.codigo_barras",
      "coluna product_variants.codigo_barras",
      "coluna marketplace_orders.canal",
      "coluna marketplace_orders.vendedor_id",
      "indice produtos_codigo_barras_unico",
      "indice product_variants_codigo_barras_unico",
      "indice idx_marketplace_orders_presencial",
      "indice shipping_quotes_cache_created_at_idx",
      "restricao marketplace_orders_canal_check",
      "restricao shipping_quotes_cache_chave_unica",
      "fk marketplace_orders.vendedor_id",
      "gatilho shipping_quotes_cache_limpa_ao_gravar",
      "corpo final buscar_por_codigo_barras",
      "corpo final limpar_cotacoes_fora_da_janela",
      "acl buscar_por_codigo_barras",
      "acl registrar_venda_presencial",
      "default de store_config.free_shipping_min",
      "privilegio authenticated le produtos.codigo_barras",
    ]) {
      assert.ok(
        falhas.includes(item),
        `omitido: a 9a devia reprovar "${item}" e reprovou ${JSON.stringify(falhas)}`,
      );
    }
    const ausentes = rows
      .filter((r) => r.vivo === "AUSENTE")
      .map((r) => r.item);
    assert.ok(
      ausentes.includes("coluna produtos.codigo_barras") &&
        ausentes.includes("restricao shipping_quotes_cache_chave_unica"),
    );
    assert.throws(
      () =>
        CONF.conferirRolFechado({
          faixa: "60-66",
          nomeConsulta: "9a",
          linhas: rows,
          rol: CONF.ROL_DA_9A,
        }),
      /pré-checagem do ledger 60-66 falhou/,
    );
    ok(
      `(b) controle negativo (estado anterior à 20261160): ${falhas.length} linhas reprovam, nomeando os objetos AUSENTES; o rol fechado recusa`,
    );
  }

  // ----------------------------------------- (c) defeitos isolados na final
  await sabotagem(
    "índice único de produtos DROPADO",
    "DROP INDEX public.produtos_codigo_barras_unico",
    ["indice produtos_codigo_barras_unico"],
  );
  await sabotagem(
    "índice único de produtos com OUTRO predicado",
    "DROP INDEX public.produtos_codigo_barras_unico; CREATE UNIQUE INDEX produtos_codigo_barras_unico ON public.produtos (codigo_barras) WHERE codigo_barras IS NOT NULL",
    ["indice produtos_codigo_barras_unico"],
  );
  await sabotagem(
    "índice único de produtos NÃO único",
    "DROP INDEX public.produtos_codigo_barras_unico; CREATE INDEX produtos_codigo_barras_unico ON public.produtos (codigo_barras) WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL",
    ["indice produtos_codigo_barras_unico"],
  );
  await sabotagem(
    "índice marcado INVÁLIDO (indisvalid=false, como um CREATE INDEX CONCURRENTLY que falhou)",
    "UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.product_variants_codigo_barras_unico'::regclass",
    ["indice product_variants_codigo_barras_unico"],
  );
  await sabotagem(
    "índice marcado NÃO PRONTO (indisready=false)",
    "UPDATE pg_index SET indisready = false WHERE indexrelid = 'public.shipping_quotes_cache_created_at_idx'::regclass",
    ["indice shipping_quotes_cache_created_at_idx"],
  );
  await sabotagem(
    "índice do balcão com a coluna sem DESC",
    "DROP INDEX public.idx_marketplace_orders_presencial; CREATE INDEX idx_marketplace_orders_presencial ON public.marketplace_orders (created_at) WHERE canal = 'presencial'",
    ["indice idx_marketplace_orders_presencial"],
  );
  await sabotagem(
    "índice HOMÔNIMO noutra tabela, o da tabela certa removido",
    "DROP INDEX public.idx_marketplace_orders_presencial; CREATE TABLE public.l66_outra (created_at timestamptz, canal text); CREATE INDEX idx_marketplace_orders_presencial ON public.l66_outra (created_at DESC) WHERE canal = 'presencial'",
    ["indice idx_marketplace_orders_presencial"],
  );
  await sabotagem(
    "CHECK do canal com OUTROS valores",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_canal_check; ALTER TABLE public.marketplace_orders ADD CONSTRAINT marketplace_orders_canal_check CHECK (canal IN ('online','presencial','delivery'))",
    ["restricao marketplace_orders_canal_check"],
  );
  await sabotagem(
    "CHECK do canal REMOVIDO",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_canal_check",
    ["restricao marketplace_orders_canal_check"],
  );
  await sabotagem(
    "CHECK do canal NOT VALID (convalidated=false), mesma definição",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_canal_check; ALTER TABLE public.marketplace_orders ADD CONSTRAINT marketplace_orders_canal_check CHECK (canal IN ('online','presencial')) NOT VALID",
    ["restricao marketplace_orders_canal_check"],
  );
  await sabotagem(
    "CHECK HOMÔNIMO de MESMA definição noutra tabela, o da tabela certa removido",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_canal_check; CREATE TABLE public.l66_outra2 (canal text, CONSTRAINT marketplace_orders_canal_check CHECK (canal IN ('online','presencial')))",
    ["restricao marketplace_orders_canal_check"],
  );
  await sabotagem(
    "UNIQUE do cache com OUTRAS colunas",
    "ALTER TABLE public.shipping_quotes_cache DROP CONSTRAINT shipping_quotes_cache_chave_unica; ALTER TABLE public.shipping_quotes_cache ADD CONSTRAINT shipping_quotes_cache_chave_unica UNIQUE (origin_cep, destination_cep)",
    ["restricao shipping_quotes_cache_chave_unica"],
  );
  await sabotagem(
    "UNIQUE do cache com as colunas em OUTRA ordem",
    "ALTER TABLE public.shipping_quotes_cache DROP CONSTRAINT shipping_quotes_cache_chave_unica; ALTER TABLE public.shipping_quotes_cache ADD CONSTRAINT shipping_quotes_cache_chave_unica UNIQUE (destination_cep, origin_cep, cart_hash)",
    ["restricao shipping_quotes_cache_chave_unica"],
  );
  await sabotagem(
    "UNIQUE HOMÔNIMA de MESMA definição noutra tabela, a da tabela certa removida",
    "ALTER TABLE public.shipping_quotes_cache DROP CONSTRAINT shipping_quotes_cache_chave_unica; CREATE TABLE public.l66_outra3 (origin_cep text, destination_cep text, cart_hash text, CONSTRAINT shipping_quotes_cache_chave_unica UNIQUE (origin_cep, destination_cep, cart_hash))",
    ["restricao shipping_quotes_cache_chave_unica"],
  );
  await sabotagem(
    "FK de vendedor_id REMOVIDA",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_vendedor_id_fkey",
    ["fk marketplace_orders.vendedor_id"],
  );
  await sabotagem(
    "FK de vendedor_id NOT VALID",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_vendedor_id_fkey; ALTER TABLE public.marketplace_orders ADD CONSTRAINT marketplace_orders_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES auth.users(id) NOT VALID",
    ["fk marketplace_orders.vendedor_id"],
  );
  await sabotagem(
    "FK de vendedor_id com ON DELETE CASCADE",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_vendedor_id_fkey; ALTER TABLE public.marketplace_orders ADD CONSTRAINT marketplace_orders_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES auth.users(id) ON DELETE CASCADE",
    ["fk marketplace_orders.vendedor_id"],
  );
  await sabotagem(
    "gatilho do cache DESABILITADO",
    "ALTER TABLE public.shipping_quotes_cache DISABLE TRIGGER shipping_quotes_cache_limpa_ao_gravar",
    ["gatilho shipping_quotes_cache_limpa_ao_gravar"],
  );
  await sabotagem(
    "gatilho do cache REMOVIDO",
    "DROP TRIGGER shipping_quotes_cache_limpa_ao_gravar ON public.shipping_quotes_cache",
    ["gatilho shipping_quotes_cache_limpa_ao_gravar"],
  );
  await sabotagem(
    "gatilho do cache com EVENTO diferente (só INSERT)",
    "DROP TRIGGER shipping_quotes_cache_limpa_ao_gravar ON public.shipping_quotes_cache; CREATE TRIGGER shipping_quotes_cache_limpa_ao_gravar AFTER INSERT ON public.shipping_quotes_cache FOR EACH STATEMENT EXECUTE FUNCTION public.limpar_cotacoes_fora_da_janela()",
    ["gatilho shipping_quotes_cache_limpa_ao_gravar"],
  );
  await sabotagem(
    "gatilho do cache FOR EACH ROW",
    "DROP TRIGGER shipping_quotes_cache_limpa_ao_gravar ON public.shipping_quotes_cache; CREATE TRIGGER shipping_quotes_cache_limpa_ao_gravar AFTER INSERT OR UPDATE ON public.shipping_quotes_cache FOR EACH ROW EXECUTE FUNCTION public.limpar_cotacoes_fora_da_janela()",
    ["gatilho shipping_quotes_cache_limpa_ao_gravar"],
  );
  await sabotagem(
    "gatilho do cache chamando OUTRA função",
    "CREATE FUNCTION public.l66_outra_funcao() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$; DROP TRIGGER shipping_quotes_cache_limpa_ao_gravar ON public.shipping_quotes_cache; CREATE TRIGGER shipping_quotes_cache_limpa_ao_gravar AFTER INSERT OR UPDATE ON public.shipping_quotes_cache FOR EACH STATEMENT EXECUTE FUNCTION public.l66_outra_funcao()",
    ["gatilho shipping_quotes_cache_limpa_ao_gravar"],
  );
  await sabotagem(
    "gatilho HOMÔNIMO noutra tabela, o do cache removido",
    "DROP TRIGGER shipping_quotes_cache_limpa_ao_gravar ON public.shipping_quotes_cache; CREATE TABLE public.l66_outra4 (x int); CREATE TRIGGER shipping_quotes_cache_limpa_ao_gravar AFTER INSERT OR UPDATE ON public.l66_outra4 FOR EACH STATEMENT EXECUTE FUNCTION public.limpar_cotacoes_fora_da_janela()",
    ["gatilho shipping_quotes_cache_limpa_ao_gravar"],
  );
  await sabotagem(
    "canal com DEFAULT diferente",
    "ALTER TABLE public.marketplace_orders ALTER COLUMN canal SET DEFAULT 'balcao'",
    ["coluna marketplace_orders.canal"],
  );
  await sabotagem(
    "canal sem NOT NULL",
    "ALTER TABLE public.marketplace_orders ALTER COLUMN canal DROP NOT NULL",
    ["coluna marketplace_orders.canal"],
  );
  await sabotagem(
    "product_variants.codigo_barras com TIPO diferente",
    "DROP INDEX public.product_variants_codigo_barras_unico; ALTER TABLE public.product_variants ALTER COLUMN codigo_barras TYPE varchar(20); CREATE UNIQUE INDEX product_variants_codigo_barras_unico ON public.product_variants (codigo_barras) WHERE codigo_barras IS NOT NULL",
    ["coluna product_variants.codigo_barras"],
  );
  for (const padrao of ["0.00", "0::numeric", "(0)::numeric(10,2)"]) {
    const db = await clonar(NOME_FULL, `l66_c_${clones.length}`);
    await usar(db, (c) =>
      c.query(
        `ALTER TABLE public.store_config ALTER COLUMN free_shipping_min SET DEFAULT ${padrao}`,
      ),
    );
    assert.deepEqual(
      reprovadas(await nove(db)),
      [],
      `default ${padrao} é o MESMO valor`,
    );
  }
  ok(
    "controle: o default 0 comparado pelo VALOR — 0.00, 0::numeric e (0)::numeric(10,2) NÃO reprovam",
  );
  await sabotagem(
    "get_admin_orders_paged com o corpo ANTIGO da 63 (a regressão que reaplicar causaria)",
    criarDaMigration(
      "20261163",
      "CREATE OR REPLACE FUNCTION public.get_admin_orders_paged",
    ),
    ["corpo final get_admin_orders_paged"],
  );
  await sabotagem(
    "registrar_venda_presencial com o corpo ANTIGO da 62",
    criarDaMigration(
      "20261162",
      "CREATE OR REPLACE FUNCTION public.registrar_venda_presencial",
    ),
    ["corpo final registrar_venda_presencial"],
  );
  await sabotagem(
    "limpar_cotacoes_fora_da_janela com o corpo alterado",
    "CREATE OR REPLACE FUNCTION public.limpar_cotacoes_fora_da_janela() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN DELETE FROM public.shipping_quotes_cache WHERE created_at < now() - interval '1 hour'; RETURN NULL; END; $f$",
    ["corpo final limpar_cotacoes_fora_da_janela"],
  );
  await sabotagem(
    "OVERLOAD de 7 argumentos de get_admin_orders_paged recriado ao lado da de 8 (o DROP da 63 desfeito)",
    "CREATE FUNCTION public.get_admin_orders_paged(p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$",
    [
      "acl get_admin_orders_paged",
      "assinatura get_admin_orders_paged",
      "atributos get_admin_orders_paged",
      "corpo final get_admin_orders_paged",
      "sobrecargas get_admin_orders_paged",
    ],
  );
  await sabotagem(
    "buscar_por_codigo_barras DROPADA",
    "DROP FUNCTION public.buscar_por_codigo_barras(text)",
    [
      "acl buscar_por_codigo_barras",
      "atributos buscar_por_codigo_barras",
      "corpo final buscar_por_codigo_barras",
      "sobrecargas buscar_por_codigo_barras",
    ],
  );
  await sabotagem(
    "vw_produtos_admin sem a opção CASCADED CHECK OPTION",
    "ALTER VIEW public.vw_produtos_admin RESET (check_option)",
    ["vista vw_produtos_admin opcoes"],
  );
  await sabotagem(
    "vw_produtos_public RECRIADA sem a coluna codigo_barras",
    "DROP VIEW public.vw_produtos_public; CREATE VIEW public.vw_produtos_public AS SELECT id, nome, descricao, preco_venda, preco_original, estoque, imagem_url, imagem_urls, categoria, ativo, data_cadastro, tags, meta_title, meta_description, is_bestseller, frete_gratis, sold, calculated_points, codigo, ultima_atualizacao, rating, review_count, peso_kg, largura_cm, altura_cm, comprimento_cm FROM public.produtos WHERE ativo = true AND deleted_at IS NULL",
    ["vista vw_produtos_public colunas", "vista vw_produtos_public definicao"],
  );
  await sabotagem(
    "GRANT de coluna codigo_barras REVOGADO do authenticated",
    "REVOKE SELECT (codigo_barras) ON public.produtos FROM authenticated",
    ["privilegio authenticated le produtos.codigo_barras"],
  );

  // --- (c2) CHECK por lista fechada: a coleta de literais aceitava estes ---
  for (const [rotulo, expr] of [
    [
      "CHECK do canal com `OR true` (tem os dois literais e não nega: a coleta antiga aceitava)",
      "canal IN ('online','presencial') OR true",
    ],
    [
      "CHECK do canal com `AND false` (idem)",
      "canal IN ('online','presencial') AND false",
    ],
    [
      "CHECK do canal com um TERCEIRO valor aceito",
      "canal IN ('online','presencial','balcao')",
    ],
    ["CHECK do canal com um valor FALTANDO", "canal IN ('online')"],
    [
      "CHECK do canal em OUTRA forma equivalente (= ANY de ARRAY com a ordem trocada)",
      "canal = ANY (ARRAY['presencial','online'])",
    ],
  ]) {
    await sabotagem(
      rotulo,
      `ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_canal_check; ALTER TABLE public.marketplace_orders ADD CONSTRAINT marketplace_orders_canal_check CHECK (${expr})`,
      ["restricao marketplace_orders_canal_check"],
    );
  }
  // --- (c3) defaults por lista fechada: o parser de prefixo aceitava estes ---
  await sabotagem(
    "free_shipping_min com DEFAULT 0 + 100 (o prefixo `0` passava)",
    "ALTER TABLE public.store_config ALTER COLUMN free_shipping_min SET DEFAULT 0 + 100",
    ["default de store_config.free_shipping_min"],
  );
  await sabotagem(
    "canal com DEFAULT 'online'::text || 'x' (o prefixo `online` passava)",
    "ALTER TABLE public.marketplace_orders ALTER COLUMN canal SET DEFAULT 'online'::text || 'x'",
    ["coluna marketplace_orders.canal"],
  );
  await sabotagem(
    "free_shipping_min com DEFAULT 100",
    "ALTER TABLE public.store_config ALTER COLUMN free_shipping_min SET DEFAULT 100",
    ["default de store_config.free_shipping_min"],
  );
  // --- (c4) vistas: mesmas colunas e opções, definição diferente ---
  await sabotagem(
    "vw_produtos_public com `NULL::text AS codigo_barras` (mesmas colunas, mesma ordem, mesmas opções)",
    "CREATE OR REPLACE VIEW public.vw_produtos_public AS SELECT id, nome, descricao, preco_venda, preco_original, estoque, imagem_url, imagem_urls, categoria, ativo, data_cadastro, tags, meta_title, meta_description, is_bestseller, frete_gratis, sold, calculated_points, codigo, ultima_atualizacao, rating, review_count, peso_kg, largura_cm, altura_cm, comprimento_cm, NULL::text AS codigo_barras FROM public.produtos WHERE ativo = true AND deleted_at IS NULL",
    ["vista vw_produtos_public definicao"],
  );
  await sabotagem(
    "vw_produtos_public SEM o filtro de deleted_at (mesmas colunas)",
    "CREATE OR REPLACE VIEW public.vw_produtos_public AS SELECT id, nome, descricao, preco_venda, preco_original, estoque, imagem_url, imagem_urls, categoria, ativo, data_cadastro, tags, meta_title, meta_description, is_bestseller, frete_gratis, sold, calculated_points, codigo, ultima_atualizacao, rating, review_count, peso_kg, largura_cm, altura_cm, comprimento_cm, codigo_barras FROM public.produtos WHERE ativo = true",
    ["vista vw_produtos_public definicao"],
  );
  await sabotagem(
    "vw_produtos_public SEM o filtro de ativo (mesmas colunas)",
    "CREATE OR REPLACE VIEW public.vw_produtos_public AS SELECT id, nome, descricao, preco_venda, preco_original, estoque, imagem_url, imagem_urls, categoria, ativo, data_cadastro, tags, meta_title, meta_description, is_bestseller, frete_gratis, sold, calculated_points, codigo, ultima_atualizacao, rating, review_count, peso_kg, largura_cm, altura_cm, comprimento_cm, codigo_barras FROM public.produtos WHERE deleted_at IS NULL",
    ["vista vw_produtos_public definicao"],
  );
  await sabotagem(
    "vw_produtos_admin com `NULL::text AS codigo_barras`",
    "CREATE OR REPLACE VIEW public.vw_produtos_admin WITH (check_option=cascaded) AS SELECT id, nome, descricao, categoria, codigo, custo, preco_venda, estoque, estoque_minimo, fornecedor_id, ativo, tags, data_cadastro, ultima_atualizacao, imagem_url, meta_title, meta_description, imagem_urls, preco_original, is_bestseller, frete_gratis, sold, deleted_at, calculated_points, rating, review_count, peso_kg, largura_cm, altura_cm, comprimento_cm, NULL::text AS codigo_barras FROM public.produtos WHERE is_admin()",
    ["vista vw_produtos_admin definicao"],
  );
  await sabotagem(
    "vw_produtos_admin SEM o is_admin() (a vista passa a vazar para todo mundo)",
    "CREATE OR REPLACE VIEW public.vw_produtos_admin WITH (check_option=cascaded) AS SELECT id, nome, descricao, categoria, codigo, custo, preco_venda, estoque, estoque_minimo, fornecedor_id, ativo, tags, data_cadastro, ultima_atualizacao, imagem_url, meta_title, meta_description, imagem_urls, preco_original, is_bestseller, frete_gratis, sold, deleted_at, calculated_points, rating, review_count, peso_kg, largura_cm, altura_cm, comprimento_cm, codigo_barras FROM public.produtos",
    ["vista vw_produtos_admin definicao"],
  );

  // --- (c5) A1: METADADOS de função com o prosrc INTACTO (o achado bloqueante do
  // revisor): cada caso reprova EXATAMENTE `atributos <fn>`, e uma guarda
  // (DO + RAISE EXCEPTION) aborta o cenário se a mutação NÃO foi aplicada. ---
  const guarda = (assinatura, condicao) =>
    `DO $g$ BEGIN IF NOT (SELECT ${condicao} FROM pg_proc WHERE oid = 'public.${assinatura}'::regprocedure) THEN RAISE EXCEPTION 'mutacao nao aplicada: ${assinatura}'; END IF; END $g$`;
  const sig = {
    buscar: "buscar_por_codigo_barras(text)",
    venda:
      "registrar_venda_presencial(jsonb, text, uuid, text, text, numeric, text, uuid)",
    paged:
      "get_admin_orders_paged(text, text, text, text, integer, integer, text, text)",
    cancelados:
      "get_admin_orders_cancelados_recentes(integer, integer, integer)",
    recs: "get_product_recommendations(uuid, integer)",
    limpar: "limpar_cotacoes_fora_da_janela()",
    upsert: "upsert_store_config(jsonb)",
  };
  const nomeDe = (a) => a.slice(0, a.indexOf("("));
  const casosAtributos = [
    [
      "SECURITY INVOKER em buscar_por_codigo_barras",
      "buscar",
      "ALTER FUNCTION public.%S SECURITY INVOKER",
      "NOT prosecdef",
    ],
    [
      "SECURITY INVOKER em registrar_venda_presencial",
      "venda",
      "ALTER FUNCTION public.%S SECURITY INVOKER",
      "NOT prosecdef",
    ],
    [
      "SECURITY INVOKER em get_admin_orders_paged",
      "paged",
      "ALTER FUNCTION public.%S SECURITY INVOKER",
      "NOT prosecdef",
    ],
    [
      "SECURITY INVOKER em get_product_recommendations",
      "recs",
      "ALTER FUNCTION public.%S SECURITY INVOKER",
      "NOT prosecdef",
    ],
    [
      "SECURITY DEFINER em limpar_cotacoes_fora_da_janela (o inverso: era INVOKER)",
      "limpar",
      "ALTER FUNCTION public.%S SECURITY DEFINER",
      "prosecdef",
    ],
    [
      "RESET search_path em buscar_por_codigo_barras",
      "buscar",
      "ALTER FUNCTION public.%S RESET search_path",
      "proconfig IS NULL",
    ],
    [
      "RESET search_path em registrar_venda_presencial",
      "venda",
      "ALTER FUNCTION public.%S RESET search_path",
      "proconfig IS NULL",
    ],
    [
      "RESET search_path em upsert_store_config",
      "upsert",
      "ALTER FUNCTION public.%S RESET search_path",
      "proconfig IS NULL",
    ],
    [
      "RESET ALL em get_admin_orders_cancelados_recentes",
      "cancelados",
      "ALTER FUNCTION public.%S RESET ALL",
      "proconfig IS NULL",
    ],
    [
      "search_path de registrar_venda_presencial trocado para public, pg_catalog",
      "venda",
      "ALTER FUNCTION public.%S SET search_path = public, pg_catalog",
      "proconfig::text LIKE '%public, pg_catalog%'",
    ],
    [
      "search_path de buscar_por_codigo_barras com um schema a mais (pg_catalog, pg_temp, public)",
      "buscar",
      "ALTER FUNCTION public.%S SET search_path = pg_catalog, pg_temp, public",
      "proconfig::text LIKE '%pg_temp, public%'",
    ],
    [
      "search_path de buscar_por_codigo_barras em ORDEM invertida (pg_temp, pg_catalog)",
      "buscar",
      "ALTER FUNCTION public.%S SET search_path = pg_temp, pg_catalog",
      "proconfig::text LIKE '%pg_temp, pg_catalog%'",
    ],
    [
      "buscar_por_codigo_barras de STABLE para VOLATILE",
      "buscar",
      "ALTER FUNCTION public.%S VOLATILE",
      "provolatile = 'v'",
    ],
    [
      "registrar_venda_presencial de VOLATILE para STABLE (o inverso)",
      "venda",
      "ALTER FUNCTION public.%S STABLE",
      "provolatile = 's'",
    ],
    [
      "registrar_venda_presencial passa a STRICT",
      "venda",
      "ALTER FUNCTION public.%S STRICT",
      "proisstrict",
    ],
    [
      "DONO de get_admin_orders_paged trocado para outro papel",
      "paged",
      `GRANT CREATE ON SCHEMA public TO ${PAPEL_DONO}; ALTER FUNCTION public.%S OWNER TO ${PAPEL_DONO}`,
      `pg_get_userbyid(proowner) = '${PAPEL_DONO}'`,
    ],
    [
      "DONO de buscar_por_codigo_barras trocado para authenticated",
      "buscar",
      "GRANT CREATE ON SCHEMA public TO authenticated; ALTER FUNCTION public.%S OWNER TO authenticated",
      "pg_get_userbyid(proowner) = 'authenticated'",
    ],
  ];
  for (const [rotulo, chave, ddl, condicao] of casosAtributos) {
    // eslint-disable-next-line security/detect-object-injection -- chave vinda de lista fixa do próprio teste
    const a = sig[chave];
    await sabotagem(
      `${rotulo} (prosrc intacto)`,
      `${ddl.replaceAll("%S", a)}; ${guarda(a, condicao)}`,
      [`atributos ${nomeDe(a)}`],
    );
  }
  // CREATE OR REPLACE com o MESMO prosrc, sem SECURITY DEFINER e sem SET search_path
  // (o cenário do revisor: o corpo é igual, a função é insegura)
  for (const [chave, retorno] of [
    ["venda", "jsonb"],
    ["buscar", "jsonb"],
  ]) {
    // eslint-disable-next-line security/detect-object-injection -- chave vinda de lista fixa do próprio teste
    const a = sig[chave];
    await sabotagem(
      `CREATE OR REPLACE de ${nomeDe(a)} com o MESMO corpo, sem SECURITY DEFINER e sem SET search_path`,
      `DO $m$ DECLARE p pg_proc%ROWTYPE; BEGIN
         SELECT * INTO p FROM pg_proc WHERE oid = 'public.${a}'::regprocedure;
         EXECUTE format('CREATE OR REPLACE FUNCTION public.%s(%s) RETURNS ${retorno} LANGUAGE plpgsql AS %L', p.proname, pg_get_function_arguments(p.oid), p.prosrc);
       END $m$; ${guarda(a, "NOT prosecdef AND proconfig IS NULL")}`,
      [`atributos ${nomeDe(a)}`],
    );
  }
  // tipo de ARGUMENTO: upsert_store_config(jsonb) recriada como (text), mesmo corpo
  await sabotagem(
    "ARGUMENTO: upsert_store_config(jsonb) recriada como (text) com o mesmo corpo e GRANT PUBLIC",
    `DO $m$ DECLARE p pg_proc%ROWTYPE; BEGIN
       SELECT * INTO p FROM pg_proc WHERE oid = 'public.${sig.upsert}'::regprocedure;
       DROP FUNCTION public.${sig.upsert};
       EXECUTE format('CREATE FUNCTION public.upsert_store_config(config_json text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS %L', p.prosrc);
       GRANT EXECUTE ON FUNCTION public.upsert_store_config(text) TO PUBLIC;
     END $m$; ${guarda("upsert_store_config(text)", "prosecdef")}`,
    ["atributos upsert_store_config"],
  );
  // RETORNO: get_product_recommendations com outro RETURNS, mesmo corpo
  await sabotagem(
    "RETORNO: get_product_recommendations recriada com outro RETURNS (SETOF product_variants) e o mesmo corpo",
    `DO $m$ DECLARE p pg_proc%ROWTYPE; BEGIN
       SELECT * INTO p FROM pg_proc WHERE oid = 'public.${sig.recs}'::regprocedure;
       DROP FUNCTION public.${sig.recs};
       EXECUTE format('CREATE FUNCTION public.get_product_recommendations(p_product_id uuid, p_limit integer DEFAULT 4) RETURNS SETOF public.product_variants LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS %L', p.prosrc);
     END $m$; ${guarda(sig.recs, "pg_get_function_result(oid) = 'SETOF product_variants'")}`,
    ["atributos get_product_recommendations"],
  );

  // LINGUAGEM: buscar_por_codigo_barras recriada em `sql` com o MESMO prosrc (o
  // corpo plpgsql não é SQL válido: só passa com check_function_bodies desligado,
  // dentro do próprio DO). Mesmo SECURITY, search_path e volatilidade: só a
  // linguagem muda.
  await sabotagem(
    "LINGUAGEM: buscar_por_codigo_barras recriada em sql (era plpgsql) com o MESMO prosrc",
    `DO $m$ DECLARE p pg_proc%ROWTYPE; BEGIN
       SELECT * INTO p FROM pg_proc WHERE oid = 'public.${sig.buscar}'::regprocedure;
       PERFORM set_config('check_function_bodies', 'off', true);
       EXECUTE format('CREATE OR REPLACE FUNCTION public.%s(%s) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS %L', p.proname, pg_get_function_arguments(p.oid), p.prosrc);
     END $m$; ${guarda(sig.buscar, "prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'sql')")}`,
    ["atributos buscar_por_codigo_barras"],
  );

  // --- (c6) A2: atributos de restrição, FK e índice que a 9a antes não lia ---
  await sabotagem(
    "UNIQUE do cache DEFERRABLE INITIALLY DEFERRED (o ON CONFLICT do upsert da edge calculate-shipping deixa de funcionar)",
    "ALTER TABLE public.shipping_quotes_cache DROP CONSTRAINT shipping_quotes_cache_chave_unica; ALTER TABLE public.shipping_quotes_cache ADD CONSTRAINT shipping_quotes_cache_chave_unica UNIQUE (origin_cep, destination_cep, cart_hash) DEFERRABLE INITIALLY DEFERRED",
    ["restricao shipping_quotes_cache_chave_unica"],
  );
  await sabotagem(
    "UNIQUE do cache DEFERRABLE INITIALLY IMMEDIATE",
    "ALTER TABLE public.shipping_quotes_cache DROP CONSTRAINT shipping_quotes_cache_chave_unica; ALTER TABLE public.shipping_quotes_cache ADD CONSTRAINT shipping_quotes_cache_chave_unica UNIQUE (origin_cep, destination_cep, cart_hash) DEFERRABLE INITIALLY IMMEDIATE",
    ["restricao shipping_quotes_cache_chave_unica"],
  );
  await sabotagem(
    "FK de vendedor_id com ON UPDATE CASCADE DEFERRABLE",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_vendedor_id_fkey; ALTER TABLE public.marketplace_orders ADD CONSTRAINT marketplace_orders_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES auth.users(id) ON UPDATE CASCADE DEFERRABLE",
    ["fk marketplace_orders.vendedor_id"],
  );
  await sabotagem(
    "FK de vendedor_id com MATCH FULL",
    "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_vendedor_id_fkey; ALTER TABLE public.marketplace_orders ADD CONSTRAINT marketplace_orders_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES auth.users(id) MATCH FULL",
    ["fk marketplace_orders.vendedor_id"],
  );
  await sabotagem(
    'índice único de produtos com COLLATE "C"',
    'DROP INDEX public.produtos_codigo_barras_unico; CREATE UNIQUE INDEX produtos_codigo_barras_unico ON public.produtos (codigo_barras COLLATE "C") WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL',
    ["indice produtos_codigo_barras_unico"],
  );
  await sabotagem(
    "índice único de produtos com text_pattern_ops (outra opclass)",
    "DROP INDEX public.produtos_codigo_barras_unico; CREATE UNIQUE INDEX produtos_codigo_barras_unico ON public.produtos (codigo_barras text_pattern_ops) WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL",
    ["indice produtos_codigo_barras_unico"],
  );
  await sabotagem(
    "índice único de produtos NULLS NOT DISTINCT",
    "DROP INDEX public.produtos_codigo_barras_unico; CREATE UNIQUE INDEX produtos_codigo_barras_unico ON public.produtos (codigo_barras) NULLS NOT DISTINCT WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL",
    ["indice produtos_codigo_barras_unico"],
  );

  // Objeto de MESMO NOME em outro schema (a comparação sem o schema era um falso
  // positivo provado antes da correção): collation e opclass `public.*` copiadas
  // das do catálogo; a guarda aborta o cenário se o índice não aponta para elas.
  await sabotagem(
    'índice único de produtos com COLLATE public."default" (cópia da "C", mesmo nome da default do catálogo)',
    `CREATE COLLATION public."default" FROM pg_catalog."C"; DROP INDEX public.produtos_codigo_barras_unico; CREATE UNIQUE INDEX produtos_codigo_barras_unico ON public.produtos (codigo_barras COLLATE public."default") WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL; DO $g$ BEGIN IF NOT (SELECT i.indcollation[0] = (SELECT c.oid FROM pg_collation c WHERE c.collname = 'default' AND c.collnamespace = 'public'::regnamespace) FROM pg_index i WHERE i.indexrelid = 'public.produtos_codigo_barras_unico'::regclass) THEN RAISE EXCEPTION 'mutacao nao aplicada: collation public.default'; END IF; END $g$`,
    ["indice produtos_codigo_barras_unico"],
  );
  await sabotagem(
    "índice único de produtos com a opclass public.text_ops (mesmo nome da text_ops do catálogo)",
    `CREATE OPERATOR CLASS public.text_ops FOR TYPE text USING btree AS OPERATOR 1 <(text,text), OPERATOR 2 <=(text,text), OPERATOR 3 =(text,text), OPERATOR 4 >=(text,text), OPERATOR 5 >(text,text), FUNCTION 1 bttextcmp(text,text); DROP INDEX public.produtos_codigo_barras_unico; CREATE UNIQUE INDEX produtos_codigo_barras_unico ON public.produtos (codigo_barras public.text_ops) WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL; DO $g$ BEGIN IF NOT (SELECT i.indclass[0] = (SELECT o.oid FROM pg_opclass o WHERE o.opcname = 'text_ops' AND o.opcnamespace = 'public'::regnamespace) FROM pg_index i WHERE i.indexrelid = 'public.produtos_codigo_barras_unico'::regclass) THEN RAISE EXCEPTION 'mutacao nao aplicada: opclass public.text_ops'; END IF; END $g$`,
    ["indice produtos_codigo_barras_unico"],
  );

  // --- (c7) A5: GRANT de tabela expõe custo e as demais colunas ---
  await sabotagem(
    "REVOKE SELECT (codigo_barras) do authenticated + GRANT SELECT ON produtos ao authenticated",
    "REVOKE SELECT (codigo_barras) ON public.produtos FROM authenticated; GRANT SELECT ON public.produtos TO authenticated",
    ["privilegio authenticated le produtos.codigo_barras"],
  );
  await sabotagem(
    "GRANT SELECT ON produtos ao authenticated COM o GRANT de coluna mantido",
    "GRANT SELECT ON public.produtos TO authenticated",
    ["privilegio authenticated le produtos.codigo_barras"],
  );
  await sabotagem(
    "GRANT SELECT ON produtos a PUBLIC com o GRANT de coluna mantido",
    "GRANT SELECT ON public.produtos TO PUBLIC",
    ["privilegio authenticated le produtos.codigo_barras"],
  );

  // --- (c8) A5: SELECT na tabela HERDADO de outro papel (o relacl direto não vê) ---
  {
    const db = await clonar(NOME_FULL, `l66_s_${clones.length}`);
    const hhmmss = new Date().toISOString().slice(11, 19).replaceAll(":", "");
    const herdado = `l66_tmp_${hhmmss}`;
    try {
      await usar(db, (c) =>
        c.query(
          `CREATE ROLE ${herdado} NOLOGIN; GRANT SELECT ON public.produtos TO ${herdado}; GRANT ${herdado} TO authenticated; DO $g$ BEGIN IF NOT has_table_privilege('authenticated', 'public.produtos', 'SELECT') THEN RAISE EXCEPTION 'mutacao nao aplicada: SELECT herdado'; END IF; END $g$`,
        ),
      );
      const rows = await nove(db);
      assert.deepEqual(
        reprovadas(rows),
        ["privilegio authenticated le produtos.codigo_barras"],
        "o SELECT herdado reprova só o item de privilégio",
      );
      const linha = rows.find(
        (r) => r.item === "privilegio authenticated le produtos.codigo_barras",
      );
      assert.match(
        linha.vivo,
        /tabela_authenticated=false/,
        "o relacl direto NÃO enxerga o herdado",
      );
      assert.match(
        linha.vivo,
        /tabela_efetivo=true/,
        "o has_table_privilege enxerga",
      );
      ok(
        "A5 herdado: papel temporário com SELECT na tabela concedido ao authenticated → reprova SÓ o item de privilégio (relacl direto continua false, efetivo true)",
      );
    } finally {
      // só o MEU papel temporário: nada de papel existente
      await usar(db, async (c) => {
        await c
          .query(`REVOKE SELECT ON public.produtos FROM ${herdado}`)
          .catch(() => {});
        await c.query(`REVOKE ${herdado} FROM authenticated`).catch(() => {});
        await c.query(`DROP ROLE IF EXISTS ${herdado}`).catch(() => {});
      }).catch(() => {});
    }
  }

  // ------------------------------------------------------ (d) ACL das 61..64
  const QUATRO = [
    "buscar_por_codigo_barras(text)",
    "get_admin_orders_cancelados_recentes(integer, integer, integer)",
    "get_admin_orders_paged(text, text, text, text, integer, integer, text, text)",
    "registrar_venda_presencial(jsonb, text, uuid, text, text, numeric, text, uuid)",
  ];
  for (const assinatura of QUATRO) {
    const fn = assinatura.slice(0, assinatura.indexOf("("));
    const item = `acl ${fn}`;
    await sabotagem(
      `ACL: GRANT EXECUTE em ${fn} TO PUBLIC`,
      `GRANT EXECUTE ON FUNCTION public.${assinatura} TO PUBLIC`,
      [item],
    );
    await sabotagem(
      `ACL: GRANT EXECUTE em ${fn} TO anon`,
      `GRANT EXECUTE ON FUNCTION public.${assinatura} TO anon`,
      [item],
    );
    await sabotagem(
      `ACL: REVOKE EXECUTE em ${fn} do authenticated`,
      `REVOKE EXECUTE ON FUNCTION public.${assinatura} FROM authenticated`,
      [item],
    );
  }
  await sabotagem(
    "ACL: GRANT EXECUTE em registrar_venda_presencial TO service_role (a 62 revoga e não devolve)",
    `GRANT EXECUTE ON FUNCTION public.${QUATRO[3]} TO service_role`,
    ["acl registrar_venda_presencial"],
  );
  await sabotagem(
    "ACL: REVOKE EXECUTE em buscar_por_codigo_barras do service_role",
    `REVOKE EXECUTE ON FUNCTION public.${QUATRO[0]} FROM service_role`,
    ["acl buscar_por_codigo_barras"],
  );
  await sabotagem(
    "ACL: proacl NULL (o padrão do Postgres = PUBLIC executa) em get_admin_orders_cancelados_recentes",
    `UPDATE pg_proc SET proacl = NULL WHERE oid = 'public.${QUATRO[1]}'::regprocedure`,
    ["acl get_admin_orders_cancelados_recentes"],
  );

  // -------------------------------------- (e) o ledger e o INSERT guardado
  {
    const preparar = async (nome, linhas) => {
      const db = await clonar(NOME_FULL, nome);
      await usar(db, async (c) => {
        await c.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations");
        await c.query(
          "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)",
        );
        for (const [v, n] of linhas)
          await c.query(
            "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)",
            [v, n],
          );
      });
      return db;
    };
    const G150 = [
      "20261150000000",
      "a_loja_declara_a_sua_configuracao_publica",
    ];
    const G167 = ["20261167000000", "sobre_a_loja_ganha_endereco_e_descricao"];
    const insert = fs.readFileSync(
      path.join(CONSULTAS, "ledger-60-66.sql"),
      "utf8",
    );
    const esperadas = CONF.versoesDoInsert(insert);
    assert.equal(esperadas.length, 7);
    const contar = (db) =>
      usar(
        db,
        async (c) =>
          (
            await c.query(
              "SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations",
            )
          ).rows[0].n,
      );
    const lerFaixa = (db) =>
      usar(
        db,
        async (c) =>
          (
            await c.query(
              "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version >= '20261160000000' AND version < '20261167000000' ORDER BY version",
            )
          ).rows,
      );

    // A lacuna: 150 e 167 no ledger, nenhuma da faixa
    const lacuna = await preparar("l66_e_lacuna", [G150, G167]);
    const antes = await nove(lacuna);
    assert.deepEqual(reprovadas(antes), [], "lacuna: a 9a dá toda ok");
    const r1 = await usar(lacuna, (c) => c.query(insert));
    assert.equal(r1.rowCount, 7, "o INSERT guardado grava 0 → 7 linhas");
    assert.deepEqual(
      await lerFaixa(lacuna),
      esperadas.map((e) => ({ version: e.version, name: e.name })),
    );
    assert.equal(await contar(lacuna), 9);
    const depois = await nove(lacuna);
    assert.deepEqual(
      depois,
      antes,
      "a 9a dá a MESMA resposta (linha por linha) antes e depois do backfill: não olha o ledger",
    );
    ok(
      "(e) lacuna: 9a toda ok → INSERT grava 7 linhas com os nomes dos arquivos → 9a idêntica depois",
    );
    const r2 = await usar(lacuna, (c) => c.query(insert));
    assert.equal(r2.rowCount, 0, "rodar de novo grava 0 linhas e não dá erro");
    assert.equal(await contar(lacuna), 9);
    ok(
      "(e) idempotência: rodar o ledger-60-66.sql de novo dá 0 linhas inseridas, as mesmas 7 na faixa, nenhum erro",
    );
    // a guarda (clone próprio de cada)
    for (const [rotulo, linhas] of [
      ["sem a 20261150", [G167]],
      ["sem a 20261167", [G150]],
      [
        "com UMA versão da faixa já registrada",
        [G150, G167, [esperadas[2].version, esperadas[2].name]],
      ],
      [
        "com uma versão extra DENTRO da faixa",
        [G150, G167, ["20261163500000", "x"]],
      ],
      ["ledger vazio", []],
    ]) {
      const db = await preparar(`l66_e_${clones.length}`, linhas);
      const r = await usar(db, (c) => c.query(insert));
      assert.equal(r.rowCount, 0, `guarda: ${rotulo} → 0 linhas gravadas`);
      assert.equal(
        await contar(db),
        linhas.length,
        `guarda: ${rotulo} → nada mudou`,
      );
    }
    ok(
      "(e) a GUARDA do INSERT: sem a 150, sem a 167, com versão da faixa já presente (uma só ou extra) ou ledger vazio → grava 0 linhas",
    );
    // classificação da leitura real do banco (os mesmos objetos que a leitura prévia vê)
    const leitura = (db) =>
      usar(
        db,
        async (c) =>
          (
            await c.query(
              "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20261150000000' AND '20261167999999' ORDER BY version",
            )
          ).rows,
      );
    assert.equal(
      CONF.classificarLedgerDa60a66(
        await leitura(await preparar("l66_e_cl1", [G150, G167])),
        esperadas,
      ).estado,
      "LACUNA",
    );
    assert.equal(
      CONF.classificarLedgerDa60a66(await leitura(lacuna), esperadas).estado,
      "JA_REGISTRADO",
    );
    ok(
      "(e) classificarLedgerDa60a66 sobre linhas REAIS do banco: lacuna → LACUNA; depois do INSERT → JA_REGISTRADO",
    );
  }

  // --------------------------------------------- (f) ponta a ponta com HTTP
  {
    const api = await subirApi();
    const preparar = async (nome, linhas) => {
      const db = await clonar(NOME_FULL, nome);
      await usar(db, async (c) => {
        await c.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations");
        await c.query(
          "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)",
        );
        for (const [v, n] of linhas)
          await c.query(
            "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)",
            [v, n],
          );
      });
      return db;
    };
    const G150 = ["20261150000000", "a"];
    const G167 = ["20261167000000", "b"];
    const rodar = async (db) => {
      api.estado.db = db;
      api.estado.escritas = 0;
      api.estado.leituras = 0;
      api.estado.corpoDeEscrita = [];
      return rodarScript({
        CONFERIR_BANCO_API_BASE: api.base,
        PROJETO: "ikcous-publicada",
        LEDGER: "60-66",
        SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-teste",
      });
    };
    const faixaNo = (db) =>
      usar(
        db,
        async (c) =>
          (
            await c.query(
              "SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations WHERE version >= '20261160000000' AND version < '20261167000000'",
            )
          ).rows[0].n,
      );
    try {
      const lacuna = await preparar("l66_f_lacuna", [G150, G167]);
      const r = await rodar(lacuna);
      assert.equal(r.codigo, 0, r.saida);
      assert.equal(api.estado.escritas, 1, "UMA escrita");
      assert.equal(await faixaNo(lacuna), 7);
      assert.match(r.saida, /Leitura pós-gravação OK/);
      ok(
        "(f) ponta a ponta, lacuna: conferir-banco.cjs lê o ledger, roda a 9a (rol fechado), grava UMA vez e a releitura confere as 7",
      );
      const de_novo = await rodar(lacuna);
      assert.equal(de_novo.codigo, 0, de_novo.saida);
      assert.match(de_novo.saida, /ledger 60-66 já registrado: nada a gravar/);
      assert.equal(api.estado.escritas, 0, "já registrado: ZERO escritas");
      assert.equal(
        api.estado.leituras,
        1,
        "já registrado: só a leitura prévia (nem a 9a roda)",
      );
      ok(
        "(f) ponta a ponta, 2ª execução: 'já registrado: nada a gravar', saída 0, ZERO escritas",
      );
      // objeto sabotado: a 9a reprova, o script recusa e NADA é gravado
      const sab = await preparar("l66_f_sab", [G150, G167]);
      await usar(sab, (c) =>
        c.query("DROP INDEX public.produtos_codigo_barras_unico"),
      );
      const rs = await rodar(sab);
      assert.equal(rs.codigo, 1, rs.saida);
      assert.match(rs.saida, /pré-checagem do ledger 60-66 falhou/);
      assert.match(rs.saida, /indice produtos_codigo_barras_unico/);
      assert.equal(api.estado.escritas, 0);
      assert.equal(await faixaNo(sab), 0);
      ok(
        "(f) ponta a ponta, índice dropado: a pré-checagem recusa nomeando o objeto, ZERO escritas, ledger intacto",
      );
      // ACL aberta: a lacuna que só a ACL prova
      const acl = await preparar("l66_f_acl", [G150, G167]);
      await usar(acl, (c) =>
        c.query(
          "GRANT EXECUTE ON FUNCTION public.buscar_por_codigo_barras(text) TO PUBLIC",
        ),
      );
      const ra = await rodar(acl);
      assert.equal(ra.codigo, 1, ra.saida);
      assert.match(ra.saida, /acl buscar_por_codigo_barras/);
      assert.equal(api.estado.escritas, 0);
      ok(
        "(f) ponta a ponta, GRANT PUBLIC numa função da 61: recusa, ZERO escritas",
      );
      // ledger parcial
      const parcial = await preparar("l66_f_parcial", [
        G150,
        G167,
        ["20261160000000", "o_codigo_de_barras_e_o_canal_nascem_no_banco"],
      ]);
      const rp = await rodar(parcial);
      assert.equal(rp.codigo, 1, rp.saida);
      assert.match(rp.saida, /forma inesperada/);
      assert.equal(api.estado.escritas, 0);
      assert.equal(await faixaNo(parcial), 1);
      ok(
        "(f) ponta a ponta, ledger PARCIAL (1 de 7): PARA, ZERO escritas, nada mudou",
      );
      // ledger sem a 150
      const sem150 = await preparar("l66_f_sem150", [G167]);
      const r150 = await rodar(sem150);
      assert.equal(r150.codigo, 1, r150.saida);
      assert.equal(api.estado.escritas, 0);
      ok("(f) ponta a ponta, ledger sem a 20261150: PARA, ZERO escritas");
    } finally {
      await api.parar();
    }
  }

  console.log(`\n[lote-60-66-viva] ${resultados} provas ok`);
}

main()
  .catch((erro) => {
    console.error("\n[FALHOU]", erro?.stack ? erro.stack : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const n of clones) {
      await usar("template1", (a) =>
        a.query(`DROP DATABASE IF EXISTS "${n}"`),
      ).catch(() => {});
    }
    await usar("template1", (a) =>
      a.query(`DROP ROLE IF EXISTS ${PAPEL_RO}`),
    ).catch(() => {});
    await usar("template1", (a) =>
      a.query(`DROP ROLE IF EXISTS ${PAPEL_DONO}`),
    ).catch(() => {});
  });

// `falhar` fica importado para o caso de a trava de efemero recusar antes.
void falhar;

#!/usr/bin/env node
/**
 * Reconcilia o ledger de migrations com o disco e com o banco vivo
 * (BANCO-050 #42 / BANCO-030 #112).
 *
 * NAO ALTERA NADA. Só SELECT em catálogo e leitura de arquivo.
 *
 * POR QUE ELE EXISTE:
 *   As duas issues foram escritas em 30/07/2026 com numeros medidos naquele dia
 *   — 121 linhas de ledger, 41 versoes locais fora dele, 28 versoes sem arquivo.
 *   Desde entao cinco migrations entraram (BANCO-010, AUTH-010, PEDIDO-010,
 *   BANCO-020, AUTH-020). Decidir o rumo com os numeros velhos e decidir sobre
 *   um banco que nao existe mais.
 *
 *   Neste repositorio documento envelhece em dias. Entao o insumo da decisao
 *   tem que ser gerado na hora, nao lido.
 *
 * O QUE ELE RESPONDE:
 *   1. Quantas versoes casam, quantas so existem em disco, quantas so no ledger.
 *   2. Das que so existem em disco, quais ja estao aplicadas DE FATO — o teste e
 *      comparar o corpo da funcao no arquivo com `pg_get_functiondef` da funcao
 *      viva. Corpo identico prova que o arquivo ja rodou, sob outro timestamp.
 *   3. Qual o saldo de policies se a fila fosse aplicada (DROP vs CREATE).
 *   4. Se o bloqueador conhecido continua bloqueando: 20260708150000 faz
 *      CREATE OR REPLACE de generate_order_otp_v1 RETURNS TEXT enquanto a viva
 *      RETURNS boolean, e o Postgres recusa mudar tipo de retorno sem DROP.
 *
 * USO:
 *   node scripts/db-reconcilia-ledger.cjs                    relatorio completo
 *   node scripts/db-reconcilia-ledger.cjs --listar-pendentes  so os nomes, um por
 *                                                             linha, para pipe
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIR_MIGRATIONS = path.join(PROJECT_ROOT, "supabase", "migrations");

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

const titulo = (t) => console.log(`\n=== ${t} ===`);

/** Normaliza SQL para comparar corpo de funcao: espaco, caixa e aspas. */
const normalizar = (sql) =>
  String(sql || "")
    .replace(/\s+/g, " ")
    .replace(/"/g, "")
    .trim()
    .toLowerCase();

/**
 * Extrai os corpos entre delimitadores dollar-quoted ($$, $function$, $body$).
 *
 * Comparar o ARQUIVO INTEIRO com o corpo da funcao viva nao funciona: o arquivo
 * tem cabecalho, comentario, GRANT e as vezes varias funcoes. O que da para
 * comparar com honestidade e corpo contra corpo.
 */
function corposDollarQuoted(sql) {
  const corpos = [];
  const rx = /\$(\w*)\$([\s\S]*?)\$\1\$/g;
  for (const m of String(sql || "").matchAll(rx)) {
    const corpo = normalizar(m[2]);
    if (corpo.length > 60) corpos.push(corpo);
  }
  return corpos;
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // --- 1. Ledger x disco ---------------------------------------------
    const ledger = await client.query(
      "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
    );
    const versoesLedger = new Set(ledger.rows.map((r) => String(r.version)));

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const arquivos = fs
      .readdirSync(DIR_MIGRATIONS)
      .filter((n) => n.endsWith(".sql"));

    const porVersao = new Map();
    for (const nome of arquivos) {
      const v = (nome.match(/^(\d+)/) || [])[1];
      if (!v) continue;
      if (!porVersao.has(v)) porVersao.set(v, []);
      porVersao.get(v).push(nome);
    }

    const versoesDisco = new Set(porVersao.keys());
    const soNoDisco = [...versoesDisco]
      .filter((v) => !versoesLedger.has(v))
      .sort();
    const soNoLedger = [...versoesLedger]
      .filter((v) => !versoesDisco.has(v))
      .sort();
    const casadas = [...versoesDisco].filter((v) => versoesLedger.has(v));

    // Modo lista: só os nomes de arquivo, um por linha, para alimentar o passo
    // de arquivamento sem ninguém digitar 41 nomes na mão.
    if (process.argv.includes("--listar-pendentes")) {
      for (const v of soNoDisco) {
        for (const nome of porVersao.get(v).sort()) console.log(nome);
      }
      return;
    }

    titulo("1. Ledger x disco");
    console.log(`  linhas no ledger .......... ${ledger.rowCount}`);
    console.log(`  arquivos .sql no disco .... ${arquivos.length}`);
    console.log(`  versoes distintas no disco  ${versoesDisco.size}`);
    console.log(`  CASADAS ................... ${casadas.length}`);
    console.log(`  so no DISCO (pendentes) ... ${soNoDisco.length}`);
    console.log(`  so no LEDGER (sem arquivo)  ${soNoLedger.length}`);

    const duplicados = [...porVersao.entries()].filter(([, l]) => l.length > 1);
    if (duplicados.length > 0) {
      console.log(`  PREFIXO DUPLICADO ......... ${duplicados.length}`);
      for (const [v, lista] of duplicados)
        console.log(`    ${v}: ${lista.join(" | ")}`);
    }

    // --- 2. Pendentes que JA estao aplicadas de fato ---------------------
    const vivas = await client.query(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    `);
    // Corpos vivos, por nome de funcao.
    const corposVivos = new Map();
    for (const f of vivas.rows) {
      if (!corposVivos.has(f.proname)) corposVivos.set(f.proname, []);
      corposVivos.get(f.proname).push(...corposDollarQuoted(f.def));
    }

    let semFuncao = 0;
    let identicas = 0;
    let divergentes = 0;
    let ausentes = 0;
    const detalheDivergente = [];

    // Contagem em PARES funcao/arquivo, alem da contagem por ARQUIVO. O
    // levantamento de 30/07 reportou "24 pares identicos" e um arquivo com 5
    // funcoes vale 1 por arquivo e 5 por par — sem separar as unidades, os dois
    // numeros parecem se contradizer sem se contradizer.
    let paresTotal = 0;
    let paresIdenticos = 0;

    for (const v of soNoDisco) {
      const nome = porVersao.get(v)[0];
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sql = fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
      const funcoes = [
        ...sql.matchAll(
          /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)/gi,
        ),
      ].map((m) => m[1]);

      if (funcoes.length === 0) {
        semFuncao++;
        continue;
      }

      const doArquivo = corposDollarQuoted(sql);
      let bate = 0;
      let naoExiste = 0;

      for (const fn of funcoes) {
        paresTotal++;
        const vivos = corposVivos.get(fn);
        if (!vivos || vivos.length === 0) {
          naoExiste++;
          continue;
        }
        if (vivos.some((cv) => doArquivo.includes(cv))) {
          bate++;
          paresIdenticos++;
        }
      }

      if (naoExiste === funcoes.length) ausentes++;
      else if (bate === funcoes.length) identicas++;
      else {
        divergentes++;
        detalheDivergente.push(`${v} (${funcoes.join(", ")})`);
      }
    }

    titulo(`2. Das ${soNoDisco.length} pendentes, o que ja esta vivo`);
    console.log(`  sem CREATE OR REPLACE FUNCTION ........ ${semFuncao}`);
    console.log(`  corpo IDENTICO ao vivo (ja rodou) ..... ${identicas}`);
    console.log(`  a funcao NEM EXISTE no banco .......... ${ausentes}`);
    console.log(`  existe mas o corpo DIVERGE ............ ${divergentes}`);
    console.log(
      `\n  Em PARES funcao/arquivo: ${paresIdenticos} identicos de ${paresTotal}.`,
    );
    console.log(
      "  (O levantamento de 30/07 reportou 24 pares identicos. Unidade diferente",
    );
    console.log("   da contagem por arquivo acima — comparar par com par.)");
    console.log(
      "\n  Corpo identico e prova de que o arquivo ja foi aplicado sob outro",
    );
    console.log(
      "  timestamp — ou seja, a fila de 'pendentes' nao e fila de deploy.",
    );

    // --- 3. Saldo de policies da fila ------------------------------------
    let drops = 0;
    let creates = 0;
    let revokes = 0;
    for (const v of soNoDisco) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sql = fs.readFileSync(
        path.join(DIR_MIGRATIONS, porVersao.get(v)[0]),
        "utf8",
      );
      drops += (sql.match(/drop\s+policy/gi) || []).length;
      creates += (sql.match(/create\s+policy/gi) || []).length;
      revokes += (sql.match(/\brevoke\b/gi) || []).length;
    }
    const policiesVivas = await client.query(
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'",
    );

    titulo("3. Saldo de policies se a fila fosse aplicada");
    console.log(`  DROP POLICY nos pendentes ... ${drops}`);
    console.log(`  CREATE POLICY nos pendentes . ${creates}`);
    console.log(`  REVOKE nos pendentes ........ ${revokes}`);
    console.log(`  policies VIVAS hoje ......... ${policiesVivas.rows[0].n}`);
    console.log(`  saldo ....................... ${creates - drops}`);

    // --- 4. O bloqueador conhecido ---------------------------------------
    const otp = await client.query(`
      SELECT pg_get_function_result(p.oid) AS retorno
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'generate_order_otp_v1'
    `);

    titulo("4. O bloqueador 20260708150000");
    const bloqueador = [...versoesDisco].includes("20260708150000");
    const pendente = soNoDisco.includes("20260708150000");
    console.log(`  arquivo existe no disco ..... ${bloqueador}`);
    console.log(`  esta na fila de pendentes ... ${pendente}`);
    console.log(
      `  generate_order_otp_v1 VIVA retorna: ${otp.rows.map((r) => r.retorno).join(" | ") || "(nao existe)"}`,
    );
    console.log(
      "  o arquivo faz CREATE OR REPLACE ... RETURNS TEXT — se a viva nao for text,",
    );
    console.log(
      "  o Postgres recusa com 'cannot change return type' e o push aborta ali.",
    );

    // --- 5. As versoes do ledger sem arquivo ------------------------------
    titulo("5. Versoes no ledger sem arquivo no disco");
    console.log(`  total: ${soNoLedger.length}`);
    console.log(`  ${soNoLedger.join(", ") || "(nenhuma)"}`);
    console.log(
      "\n  Nao ha como ler o que elas fizeram: o SQL nao esta em lugar nenhum.",
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

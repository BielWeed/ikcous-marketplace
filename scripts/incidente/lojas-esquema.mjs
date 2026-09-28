// Temporário (28/09/2026): aplica o esquema INTEIRO (todas as migrations da
// versão em produção) no banco VAZIO de cada loja nova de cliente, arquivo a
// arquivo, na ordem, com o ledger supabase_migrations.schema_migrations — a
// mesma receita do CI Banco ("migrations do zero"). Idempotente: o que já está
// no ledger é pulado. Para no primeiro erro, sem tentar de novo às cegas.
//
// Trava: só mexe em projeto cujo nome está em lojas-novas.json e começa com
// "loja-"; os bancos em produção (IKCOUS, Savy e o antigo) são recusados.
import fs from "node:fs";

const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const PASTA = "/tmp/super/supabase/migrations";
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));
// 13 OU 14 dígitos, como o CI (scripts/ci/banco/util.cjs): o par do estorno
// (2026110000000_*, 2026110000100_*) tem 13 e cria a order_refunds.
const arquivos = fs.readdirSync(PASTA).filter((n) => /^\d{13,14}_.+\.sql$/.test(n)).sort();
const versaoDe = (n) => n.split("_")[0];
console.log(`Migrations da versão em produção: ${arquivos.length} (última ${arquivos.at(-1)})`);

async function api(token, metodo, caminho, corpo) {
  const r = await fetch(`https://api.supabase.com/v1${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${texto.slice(0, 900)}`);
  return texto === "" ? null : JSON.parse(texto);
}

let falhou = false;
for (const loja of lojas) {
  const token = (process.env[loja.conta] ?? "").trim();
  console.log(`\n==================== ${loja.projeto} ====================`);
  if (token === "" || !loja.projeto.startsWith("loja-")) {
    console.log("::warning::sem token (ou nome fora do padrão); pulando.");
    continue;
  }
  const projeto = (await api(token, "GET", "/projects")).find((p) => p.name === loja.projeto);
  if (!projeto) {
    console.log("::warning::projeto ainda não existe; pulando.");
    continue;
  }
  if (PROIBIDOS.has(projeto.id)) throw new Error(`RECUSADO: ${projeto.id} é banco em produção.`);
  if (projeto.status !== "ACTIVE_HEALTHY") {
    console.log(`::warning::projeto ${projeto.id} está ${projeto.status}; pulando.`);
    continue;
  }
  const sql = (query) => api(token, "POST", `/projects/${projeto.id}/database/query`, { query });
  await sql(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations
      (version text PRIMARY KEY, statements text[], name text)`);
  const noLedger = new Set((await sql("SELECT version FROM supabase_migrations.schema_migrations")).map((x) => x.version));
  const pendentes = arquivos.filter((n) => !noLedger.has(versaoDe(n)));
  console.log(`${projeto.id}: ${noLedger.size} no ledger, ${pendentes.length} pendentes`);
  let feitas = 0;
  for (const nome of pendentes) {
    const corpo = fs.readFileSync(`${PASTA}/${nome}`, "utf8");
    const t0 = Date.now();
    try {
      await sql(`SET search_path = "$user", public, extensions;\n${corpo}`);
    } catch (erro) {
      console.log(`::error::${loja.projeto}: FALHOU em ${nome} (após ${feitas} aplicadas): ${erro.message}`);
      falhou = true;
      break;
    }
    const versao = versaoDe(nome);
    const rotulo = nome.slice(versao.length + 1, -4).replaceAll("'", "''");
    await sql(`INSERT INTO supabase_migrations.schema_migrations (version, name)
               VALUES ('${versao}', '${rotulo}') ON CONFLICT (version) DO NOTHING`);
    feitas++;
    console.log(`  ok ${nome} (${Date.now() - t0} ms)`);
  }
  console.log(`${loja.projeto}: ${feitas} aplicadas nesta rodada.`);
  const conta = await sql(`SELECT
      (SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tabelas,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS funcoes,
      (SELECT count(*)::int FROM storage.buckets) AS buckets`);
  console.log("Resumo:", JSON.stringify(conta[0]));
}
if (falhou) process.exit(1);

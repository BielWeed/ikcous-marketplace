// Temporário (28/09/2026): compara as migrations da branch da Super atualização
// (lista em /tmp/migracoes.txt) com o ledger do banco novo, para saber se a
// publicação da 1.5.10 depende de alguma migration ainda não aplicada.
import fs from "node:fs";

const REF = "dekxabvqdsuukijblazl";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const arquivos = fs
  .readFileSync("/tmp/migracoes.txt", "utf8")
  .split("\n")
  .map((l) => l.trim().split("/").pop())
  .filter((n) => /^\d{14}_.+\.sql$/.test(n));

const resposta = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version" }),
});
if (!resposta.ok) {
  console.error(`::error::ledger: HTTP ${resposta.status} ${(await resposta.text()).slice(0, 200)}`);
  process.exit(1);
}
const noBanco = new Set((await resposta.json()).map((r) => r.version));
const faltam = arquivos.filter((n) => !noBanco.has(n.slice(0, 14)));
console.log(`Migrations na branch: ${arquivos.length} · no ledger do banco novo: ${noBanco.size}`);
console.log(`Últimas 6 do ledger: ${[...noBanco].slice(-6).join(", ")}`);
console.log(faltam.length ? `FALTAM no banco (${faltam.length}):\n  ${faltam.join("\n  ")}` : "Nenhuma migration da branch falta no banco.");

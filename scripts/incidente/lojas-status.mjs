// Temporário (28/09/2026): SÓ LEITURA. Quantas migrations cada loja nova já
// tem no ledger, a última aplicada e o que está rodando no banco agora.
import fs from "node:fs";

const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));
for (const loja of lojas) {
  const token = (process.env[loja.conta] ?? "").trim();
  if (!token) continue;
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const projetos = await (await fetch("https://api.supabase.com/v1/projects", { headers: h })).json();
  const p = projetos.find((x) => x.name === loja.projeto);
  if (!p) continue;
  const q = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${p.id}/database/query`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ query }),
    });
    return r.ok ? r.json() : `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
  };
  console.log(`\n== ${loja.nome} (${p.id})`);
  console.log(JSON.stringify(await q(`SELECT count(*)::int AS ledger, max(version) AS ultima FROM supabase_migrations.schema_migrations`)));
  console.log(JSON.stringify(await q(`SELECT pid, state, now() - query_start AS ha, left(query, 120) AS consulta
    FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()`)));
}

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

// As 60–66 vieram da develop pelo workflow que não grava o ledger: confere os
// OBJETOS delas direto no catálogo.
const objetos = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `SELECT o.nome, o.existe FROM (VALUES
      ('60 coluna codigo_barras', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND column_name='codigo_barras')),
      ('60 coluna canal', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND column_name='canal')),
      ('60 coluna vendedor_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND column_name='vendedor_id')),
      ('61 buscar_por_codigo_barras', EXISTS (SELECT 1 FROM pg_proc WHERE proname='buscar_por_codigo_barras')),
      ('62 registrar_venda_presencial', EXISTS (SELECT 1 FROM pg_proc WHERE proname='registrar_venda_presencial')),
      ('63 get_admin_orders_paged', EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_admin_orders_paged')),
      ('64 get_admin_orders_cancelados_recentes', EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_admin_orders_cancelados_recentes')),
      ('65 upsert_store_config', EXISTS (SELECT 1 FROM pg_proc WHERE proname='upsert_store_config')),
      ('66 limpar_cotacoes_fora_da_janela', EXISTS (SELECT 1 FROM pg_proc WHERE proname='limpar_cotacoes_fora_da_janela')),
      ('66 idx shipping_quotes_cache_created_at_idx', to_regclass('public.shipping_quotes_cache_created_at_idx') IS NOT NULL)
    ) AS o(nome, existe)`,
  }),
});
console.log("\n== Objetos das migrations 60–66 no banco novo ==");
console.table(await objetos.json());

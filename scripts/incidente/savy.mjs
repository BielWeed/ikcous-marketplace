// Temporário (28/09/2026): diagnóstico SÓ DE LEITURA do banco da Savy
// (gnjsrucsmjkajijrakzr, conta antiga) antes de propagar a 1.5.10. O token vem
// do segredo SUPABASE_ACCESS_TOKEN_SAVY e nunca é impresso. Nenhuma escrita.
import fs from "node:fs";

const REF = "gnjsrucsmjkajijrakzr";
const token = (process.env.SUPABASE_ACCESS_TOKEN_SAVY ?? "").trim();
if (token === "") {
  console.error("::error::Falta o segredo SUPABASE_ACCESS_TOKEN_SAVY no GitHub.");
  process.exit(1);
}

async function api(metodo, caminho, corpo) {
  for (let tentativa = 1; ; tentativa++) {
    const resposta = await fetch(`https://api.supabase.com/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    if (resposta.ok) return texto === "" ? null : JSON.parse(texto);
    if (resposta.status >= 500 && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 3000 * tentativa));
      continue;
    }
    throw new Error(`${metodo} ${caminho} → HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
}
const sql = (query) => api("POST", `/projects/${REF}/database/query`, { query, read_only: true });
function mostrar(titulo, linhas) {
  console.log(`\n== ${titulo} ==`);
  if (!Array.isArray(linhas) || linhas.length === 0) console.log("(nenhuma linha)");
  else console.table(linhas);
}

const projetos = await api("GET", "/projects");
mostrar("Projetos que o token da Savy enxerga", projetos.map((p) => ({ ref: p.id, nome: p.name, status: p.status, regiao: p.region, pg: p.database?.version })));
if (!projetos.some((p) => p.id === REF)) {
  console.error(`::error::O token não enxerga o projeto da Savy (${REF}).`);
  process.exit(1);
}

mostrar("Fingerprint (só contagem)", await sql(
  "SELECT (SELECT count(*)::int FROM marketplace_orders) AS pedidos, (SELECT count(*)::int FROM produtos) AS produtos",
));

// Migrations da branch da Super atualização (lista em /tmp/migracoes.txt).
const arquivos = fs.readFileSync("/tmp/migracoes.txt", "utf8").split("\n")
  .map((l) => l.trim().split("/").pop()).filter((n) => /^\d{14}_.+\.sql$/.test(n));
const ledger = new Set((await sql("SELECT version FROM supabase_migrations.schema_migrations")).map((r) => r.version));
const faltam = arquivos.filter((n) => !ledger.has(n.slice(0, 14)));
console.log(`\nMigrations na branch: ${arquivos.length} · no ledger da Savy: ${ledger.size}`);
console.log(`Últimas do ledger: ${[...ledger].sort().slice(-5).join(", ")}`);
console.log(`Fora do ledger (${faltam.length}):\n  ${faltam.join("\n  ")}`);

// Objetos-chave (o ledger não é confiável: o workflow de aplicar não grava nele).
mostrar("Objetos-chave no banco da Savy", await sql(`SELECT o.migration, o.objeto, o.existe FROM (VALUES
  ('60', 'coluna produtos.codigo_barras', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='produtos' AND column_name='codigo_barras')),
  ('62', 'registrar_venda_presencial', EXISTS (SELECT 1 FROM pg_proc WHERE proname='registrar_venda_presencial')),
  ('66', 'limpar_cotacoes_fora_da_janela', EXISTS (SELECT 1 FROM pg_proc WHERE proname='limpar_cotacoes_fora_da_janela')),
  ('74', 'config_pagamento_cartao', to_regclass('public.config_pagamento_cartao') IS NOT NULL),
  ('75', 'tabela devolucoes', to_regclass('public.devolucoes') IS NOT NULL),
  ('75', 'politica_devolucao', to_regclass('public.politica_devolucao') IS NOT NULL),
  ('75', 'devolucao_elegibilidade', EXISTS (SELECT 1 FROM pg_proc WHERE proname='devolucao_elegibilidade')),
  ('77', 'fin_resumo', EXISTS (SELECT 1 FROM pg_proc WHERE proname='fin_resumo')),
  ('78', 'painel_inicio', EXISTS (SELECT 1 FROM pg_proc WHERE proname='painel_inicio')),
  ('78', 'crm_visao', EXISTS (SELECT 1 FROM pg_proc WHERE proname='crm_visao')),
  ('frota', 'store_config.dominio_publico', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_config' AND column_name='dominio_publico'))
) AS o(migration, objeto, existe)`));

const funcoes = await api("GET", `/projects/${REF}/functions`);
mostrar("Edge functions da Savy", funcoes.map((f) => ({ nome: f.slug, versao: f.version, estado: f.status, verify_jwt: f.verify_jwt, atualizada: new Date(f.updated_at).toISOString().slice(0, 16) })).sort((a, b) => a.nome.localeCompare(b.nome)));
mostrar("Segredos das functions da Savy (só nomes)", (await api("GET", `/projects/${REF}/secrets`)).map((s) => ({ nome: s.name })).filter((s) => !s.nome.startsWith("SUPABASE_")));
const chaves = await api("GET", `/projects/${REF}/config/auth/signing-keys`).catch((e) => ({ erro: e.message.slice(0, 120) }));
console.log("\nChaves que assinam o login:", JSON.stringify(Array.isArray(chaves) ? chaves.map((k) => `${k.algorithm}:${k.status}`) : (chaves?.keys ?? chaves)).slice(0, 300));

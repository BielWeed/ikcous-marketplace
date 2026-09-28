// Temporário (28/09/2026): propaga ao banco da Savy (gnjsrucsmjkajijrakzr) as
// 10 migrations da 1.5.10 (74–83), autorizado pelo dono no chat e aprovado por
// ele no modo "Perguntar". Ordem: confere que faltam EXATAMENTE essas 10 →
// prova das 10 juntas em BEGIN/ROLLBACK → só então, uma a uma: prova
// individual, apply, linha no ledger → verificação. Arquivos em /tmp/mig/.
import fs from "node:fs";

const REF = "gnjsrucsmjkajijrakzr";
const ESPERADAS = [
  "20261174000000_formas_de_pagamento_por_loja.sql",
  "20261175000000_a_devolucao_nasce_no_pedido.sql",
  "20261176000000_o_cartao_online_nasce.sql",
  "20261177000000_o_financeiro_da_loja_nasce.sql",
  "20261178000000_o_crm_e_o_inicio_leem_a_loja.sql",
  "20261179000000_cancelar_devolucao_barra_compra_em_voo.sql",
  "20261180000000_cliente_nao_cancela_com_cartao_vivo.sql",
  "20261181000000_pedido_por_whatsapp_fecha_para_anon.sql",
  "20261182000000_o_cpf_da_janela_sai_do_endereco.sql",
  "20261183000000_o_crm_ve_todo_mundo.sql",
];
const token = (process.env.SUPABASE_ACCESS_TOKEN_SAVY ?? "").trim();
if (token === "") throw new Error("Falta o segredo SUPABASE_ACCESS_TOKEN_SAVY.");

async function sql(titulo, query) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const corpo = await r.text();
    if (r.ok) return corpo === "" ? null : JSON.parse(corpo);
    // Só as provas (BEGIN/ROLLBACK) são repetidas num 5xx do gateway; um apply
    // nunca é repetido às cegas.
    if (r.status >= 500 && tentativa < 3 && titulo.startsWith("prova")) {
      await new Promise((res) => setTimeout(res, 4000 * tentativa));
      continue;
    }
    throw new Error(`${titulo} → HTTP ${r.status}: ${corpo.slice(0, 600)}`);
  }
}

const noLedger = new Set(
  (await sql("ledger", "SELECT version FROM supabase_migrations.schema_migrations")).map((x) => x.version),
);
const pendentes = fs.readdirSync("/tmp/mig").filter((n) => /^\d{14}_.+\.sql$/.test(n)).sort()
  .filter((n) => !noLedger.has(n.slice(0, 14)));
if (JSON.stringify(pendentes) !== JSON.stringify(ESPERADAS)) {
  console.error("::error::As pendentes não são exatamente as 10 esperadas:", pendentes);
  process.exit(1);
}
console.log("Pendentes conferidas: exatamente as 10 da 1.5.10.");
console.log("Fingerprint antes:", JSON.stringify(await sql("fingerprint",
  "SELECT (SELECT count(*)::int FROM marketplace_orders) AS pedidos, (SELECT count(*)::int FROM produtos) AS produtos")));

const corpos = ESPERADAS.map((n) => fs.readFileSync(`/tmp/mig/${n}`, "utf8"));
for (const [i, c] of corpos.entries()) {
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(c)) {
    throw new Error(`${ESPERADAS[i]} tem BEGIN/COMMIT solto — a prova não seria confiável.`);
  }
}

console.log("\n=== PROVA DAS 10 JUNTAS (BEGIN … ROLLBACK) ===");
await sql("prova conjunta", `BEGIN;\n${corpos.join("\n;\n")}\n;\nROLLBACK;`);
console.log("Prova conjunta passou: nada foi gravado.");

for (const [i, nome] of ESPERADAS.entries()) {
  console.log(`\n=== ${nome} ===`);
  await sql(`prova ${nome}`, `BEGIN;\n${corpos[i]}\n;\nROLLBACK;`);
  console.log("prova individual ok");
  await sql(`apply ${nome}`, corpos[i]);
  const versao = nome.slice(0, 14);
  const rotulo = nome.slice(15, -4).replaceAll("'", "''");
  await sql(`ledger ${nome}`,
    `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${versao}', '${rotulo}') ON CONFLICT (version) DO NOTHING`);
  console.log("APLICADA e registrada no ledger");
}

console.log("\nVerificação:", JSON.stringify(await sql("verificação", `SELECT
  to_regclass('public.config_pagamento_cartao') IS NOT NULL AS config_cartao,
  to_regclass('public.devolucoes') IS NOT NULL AS devolucoes,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname='devolucao_elegibilidade') AS elegibilidade,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname='fin_resumo') AS fin_resumo,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname='painel_inicio') AS painel_inicio,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname='crm_visao') AS crm_visao,
  (SELECT count(*)::int FROM marketplace_orders) AS pedidos,
  (SELECT count(*)::int FROM produtos) AS produtos`)));
console.log("FIM: 10 migrations aplicadas no banco da Savy.");

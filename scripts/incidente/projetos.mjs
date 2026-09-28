// Temporário (28/09/2026): SÓ LEITURA. Lista organizações e projetos que cada
// token do Supabase enxerga — a conta nova (SUPABASE_ACCESS_TOKEN) e a antiga,
// com fatura em aberto (SUPABASE_ACCESS_TOKEN_SAVY) — para conferir o projeto
// novo que o dono criou na conta antiga. Nenhum token é impresso; nenhuma
// escrita.
const contas = [
  ["conta nova (SUPABASE_ACCESS_TOKEN)", process.env.SUPABASE_ACCESS_TOKEN],
  ["conta antiga (SUPABASE_ACCESS_TOKEN_SAVY)", process.env.SUPABASE_ACCESS_TOKEN_SAVY],
];

async function api(token, caminho) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(`https://api.supabase.com/v1${caminho}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const texto = await r.text();
    if (r.ok) return texto === "" ? null : JSON.parse(texto);
    if (r.status >= 500 && tentativa < 4) {
      await new Promise((res) => setTimeout(res, 3000 * tentativa));
      continue;
    }
    return { erro: `HTTP ${r.status}: ${texto.slice(0, 200)}` };
  }
}

for (const [nome, bruto] of contas) {
  const token = (bruto ?? "").trim();
  console.log(`\n==================== ${nome} ====================`);
  if (token === "") {
    console.log("(segredo ausente)");
    continue;
  }
  const orgs = await api(token, "/organizations");
  console.log("Organizações:");
  console.table(Array.isArray(orgs) ? orgs.map((o) => ({ id: o.id, nome: o.name })) : [orgs]);
  if (Array.isArray(orgs)) {
    for (const o of orgs) {
      const detalhe = await api(token, `/organizations/${o.id}`);
      console.log(`  ${o.name}: plano=${detalhe?.plan ?? "?"} opt_in=${JSON.stringify(detalhe?.opt_in_tags ?? [])}`);
    }
  }
  const projetos = await api(token, "/projects");
  console.log("Projetos:");
  console.table(
    Array.isArray(projetos)
      ? projetos.map((p) => ({
          ref: p.id,
          nome: p.name,
          org: p.organization_id,
          status: p.status,
          regiao: p.region,
          criado: p.created_at,
          pg: p.database?.version,
        }))
      : [projetos],
  );
  if (Array.isArray(projetos)) {
    for (const p of projetos) {
      const saude = await api(token, `/projects/${p.id}/health?services=db,auth,rest,storage`);
      const resumo = Array.isArray(saude)
        ? saude.map((s) => `${s.name}:${s.status}`).join(" ")
        : JSON.stringify(saude).slice(0, 160);
      console.log(`  saúde ${p.id} (${p.name}): ${resumo}`);
    }
  }
}

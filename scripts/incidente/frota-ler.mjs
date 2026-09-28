// Temporário (28/09/2026): SÓ LEITURA. Mostra a caderneta da frota
// (frota_lojas) do banco da loja IKCOUS — o porteiro resolve cada domínio por
// ela — e os domínios do projeto na Vercel, para plugar as lojas novas.
const REF = "dekxabvqdsuukijblazl";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `SELECT id, nome, dominio_publico, project_ref, supabase_url,
                   left(publishable_key, 16) || '…' AS chave, ativa
              FROM public.frota_lojas ORDER BY id`,
  }),
});
console.log(`frota_lojas: HTTP ${r.status}`);
console.table(JSON.parse(await r.text()));
const cols = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `SELECT column_name, data_type, is_nullable, column_default
              FROM information_schema.columns
             WHERE table_schema='public' AND table_name='frota_lojas' ORDER BY ordinal_position`,
  }),
});
console.table(JSON.parse(await cols.text()));

const vt = (process.env.VERCEL_TOKEN ?? "").trim();
if (vt) {
  const { teams = [] } = await (await fetch("https://api.vercel.com/v2/teams", { headers: { Authorization: `Bearer ${vt}` } })).json();
  for (const escopo of [...teams.map((t) => t.id), ""]) {
    const q = escopo ? `?teamId=${escopo}` : "";
    const d = await fetch(`https://api.vercel.com/v9/projects/ickous-marketplace/domains${q}`, { headers: { Authorization: `Bearer ${vt}` } });
    if (d.status !== 200) continue;
    const { domains = [] } = await d.json();
    console.log(`Domínios na Vercel (escopo ${escopo || "pessoal"}):`);
    console.table(domains.map((x) => ({ nome: x.name, verificado: x.verified, redirect: x.redirect ?? "" })));
    break;
  }
}

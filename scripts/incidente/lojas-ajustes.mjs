// Temporário (28/09/2026): pedidos do dono para a apresentação — endereço da
// loja na tela "Sobre" (store_address) e o mesmo endereço cadastrado no
// perfil do admin, para testar carrinho → entrega. Só grava o que veio do
// perfil público do Instagram; o que falta (cidade/CEP) fica sem cadastro.
import fs from "node:fs";

const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));
const lit = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);

for (const loja of lojas) {
  console.log(`\n==================== ${loja.nome} ====================`);
  const token = (process.env[loja.conta] ?? "").trim();
  if (!token || !loja.endereco) continue;
  const api = async (metodo, caminho, corpo) => {
    const r = await fetch(`https://api.supabase.com/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${caminho} → HTTP ${r.status}: ${t.slice(0, 400)}`);
    return t ? JSON.parse(t) : null;
  };
  const projeto = (await api("GET", "/projects")).find((p) => p.name === loja.projeto);
  if (!projeto || PROIBIDOS.has(projeto.id)) throw new Error("projeto inválido");
  const sql = (query) => api("POST", `/projects/${projeto.id}/database/query`, { query });
  const e = loja.endereco;
  await sql(`UPDATE public.store_config SET store_address = ${lit(e.texto)}
      ${e.cidade ? `, store_city = ${lit(e.cidade)}, store_state = ${lit(e.uf)}` : ""}, updated_at = now() WHERE id = 1`);
  console.log("Sobre:", JSON.stringify(await sql("SELECT store_name, store_address, store_city, store_state FROM public.store_config")));
  if (!e.cidade || !e.cep) {
    console.log("::warning::sem cidade/CEP confirmados; endereço de teste do admin fica para depois.");
    continue;
  }
  const admin = await sql(`SELECT id FROM auth.users WHERE email = ${lit(loja.admin_email)}`);
  if (!admin[0]) throw new Error("admin não encontrado");
  await sql(`DELETE FROM public.user_addresses WHERE user_id = ${lit(admin[0].id)} AND name = 'Loja (teste)'`);
  await sql(`INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default)
      VALUES (${lit(admin[0].id)}, 'Loja (teste)', ${lit(loja.nome)}, ${lit(e.cep)}, ${lit(e.rua)}, ${lit(e.numero)},
        ${lit(e.bairro)}, ${lit(e.cidade)}, ${lit(e.uf)}, true)`);
  console.log("Endereço de teste do admin:", JSON.stringify(await sql(`SELECT name, street, number, city, state, cep, is_default
      FROM public.user_addresses WHERE user_id = ${lit(admin[0].id)}`)));
}

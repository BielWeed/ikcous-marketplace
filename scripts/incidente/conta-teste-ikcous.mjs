// Temporário (29/09/2026), pedido do dono: conta de CLIENTE de teste na loja
// IKCOUS (projeto de desenvolvimento dekxabvqdsuukijblazl) para ele testar o
// Pix. Cria (ou só confirma, se já existir) o usuário com e-mail confirmado.
// A senha vem do segredo LOJAS_ADMIN_SENHA com um prefixo — nunca é
// impressa nem gravada no repositório. Nenhuma outra escrita.

const REF = "dekxabvqdsuukijblazl";
const EMAIL = "ikcous.imports+clienteteste@gmail.com";
const NOME = "Cliente Teste";
const PREFIXO = "clienteteste";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const senhaBase = (process.env.LOJAS_ADMIN_SENHA ?? "").trim();
if (!token || !senhaBase) {
  console.error("::error::Faltam os segredos SUPABASE_ACCESS_TOKEN ou LOJAS_ADMIN_SENHA.");
  process.exit(1);
}
async function chamar(url, { metodo = "GET", headers = {}, corpo } = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...headers },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const t = await r.text();
  let json = null;
  try {
    json = t ? JSON.parse(t) : null;
  } catch {}
  return { ok: r.ok, status: r.status, json, texto: t };
}
const chaves = (await chamar(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${token}` },
})).json ?? [];
const servico = chaves.find((c) => c.name === "service_role")?.api_key ?? chaves.find((c) => c.type === "secret")?.api_key;
if (!servico) throw new Error("chave de serviço não encontrada");
console.log(`::add-mask::${servico}`);
const h = { apikey: servico, ...(servico.startsWith("eyJ") ? { Authorization: `Bearer ${servico}` } : {}) };
const base = `https://${REF}.supabase.co/auth/v1/admin/users`;
const senha = `${PREFIXO}${senhaBase}`;

// Procura pelo e-mail (a lista é paginada; a loja de desenvolvimento é pequena).
let existente = null;
for (let pagina = 1; pagina <= 20 && !existente; pagina++) {
  const r = await chamar(`${base}?page=${pagina}&per_page=200`, { headers: h });
  const usuarios = r.json?.users ?? [];
  existente = usuarios.find((u) => (u.email ?? "").toLowerCase() === EMAIL.toLowerCase()) ?? null;
  if (usuarios.length < 200) break;
}
const dados = { password: senha, email_confirm: true, user_metadata: { name: NOME, full_name: NOME } };
const r = existente
  ? await chamar(`${base}/${existente.id}`, { metodo: "PUT", headers: h, corpo: dados })
  : await chamar(base, { metodo: "POST", headers: h, corpo: { email: EMAIL, ...dados } });
if (!r.ok) throw new Error(`auth → HTTP ${r.status}: ${r.texto.slice(0, 300)}`);
console.log(`${existente ? "Conta já existia (senha e confirmação acertadas)" : "Conta criada"}: e-mail confirmado = ${Boolean(r.json?.email_confirmed_at)}`);

// Confere o login de verdade com a chave pública (sem imprimir token).
const pub = chaves.find((c) => c.type === "publishable")?.api_key ?? chaves.find((c) => c.name === "anon")?.api_key;
const login = await chamar(`https://${REF}.supabase.co/auth/v1/token?grant_type=password`, {
  metodo: "POST",
  headers: { apikey: pub },
  corpo: { email: EMAIL, password: senha },
});
console.log(`Login de teste: ${login.ok ? "OK" : `FALHOU (HTTP ${login.status})`}`);

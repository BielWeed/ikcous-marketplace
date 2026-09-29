// Temporário (29/09/2026): DESLIGA o modo sandbox da loja IKCOUS. O dono
// voltou às credenciais REAIS do Mercado Pago; com MP_SANDBOX_PAYER_EMAIL
// presente, a criar-pagamento trocaria o e-mail do pagador real pelo de teste
// (e poria "APRO" no nome). Apaga o segredo e confere que sumiu.

const REF = "dekxabvqdsuukijblazl";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
if (!token) {
  console.error("::error::Falta SUPABASE_ACCESS_TOKEN.");
  process.exit(1);
}
const api = async (metodo, caminho, corpo) => {
  const r = await fetch(`https://api.supabase.com/v1${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, texto: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
};
const nomes = async () => new Set(((await api("GET", `/projects/${REF}/secrets`)).json ?? []).map((s) => s.name));
if ((await nomes()).has("MP_SANDBOX_PAYER_EMAIL")) {
  const r = await api("DELETE", `/projects/${REF}/secrets`, ["MP_SANDBOX_PAYER_EMAIL"]);
  console.log(`apagar MP_SANDBOX_PAYER_EMAIL → HTTP ${r.status}`);
}
const presente = (await nomes()).has("MP_SANDBOX_PAYER_EMAIL");
console.log(presente ? "::error::MP_SANDBOX_PAYER_EMAIL AINDA presente" : "Modo sandbox DESLIGADO (MP_SANDBOX_PAYER_EMAIL ausente).");
if (presente) process.exit(1);

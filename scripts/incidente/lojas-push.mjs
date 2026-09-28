// Temporário (28/09/2026): notificações nas lojas novas (achado do dono: o
// "Quero receber!" dava "Não foi possível ativar as notificações"). Cada loja
// precisa do PRÓPRIO par VAPID: a pública em store_config.vapid_public_key (o
// porteiro a põe na ficha e o app assina o push com ela) e o par nos segredos
// das funções (send-push, notify-new-order etc. leem VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY e VAPID_SUBJECT). Idempotente: loja que já tem a pública
// no banco E o par nos segredos fica como está — trocar a chave invalidaria
// as inscrições já feitas. A chave privada nunca é impressa.
import crypto from "node:crypto";
import fs from "node:fs";

const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

// Par P-256 no formato do `web-push` (base64url cru): pública = ponto sem
// compressão (65 bytes, 0x04‖x‖y), privada = escalar d (32 bytes). É o
// formato que `carregarChavesVapid` (supabase/functions/_shared/webpush.ts)
// e o front (applicationServerKey) esperam.
function novoParVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwkPub = publicKey.export({ format: "jwk" });
  const jwkPriv = privateKey.export({ format: "jwk" });
  const b = (s) => Buffer.from(s, "base64url");
  const publica = Buffer.concat([Buffer.from([4]), b(jwkPub.x), b(jwkPub.y)]);
  if (publica.length !== 65 || b(jwkPriv.d).length !== 32) throw new Error("par VAPID fora do formato");
  return { publica: publica.toString("base64url"), privada: jwkPriv.d };
}

for (const loja of lojas) {
  console.log(`\n==================== ${loja.nome} ====================`);
  const token = (process.env[loja.conta] ?? "").trim();
  if (!token) continue;
  const api = async (metodo, caminho, corpo) => {
    const r = await fetch(`https://api.supabase.com/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${caminho} → HTTP ${r.status}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };
  const projeto = (await api("GET", "/projects")).find((p) => p.name === loja.projeto);
  if (!projeto || PROIBIDOS.has(projeto.id)) throw new Error("projeto inválido");
  const ref = projeto.id;
  const sql = (query) => api("POST", `/projects/${ref}/database/query`, { query });

  const [cfg] = await sql("SELECT vapid_public_key FROM public.store_config WHERE id = 1");
  const nomes = new Set(((await api("GET", `/projects/${ref}/secrets`)) ?? []).map((s) => s.name));
  const temSegredos = nomes.has("VAPID_PUBLIC_KEY") && nomes.has("VAPID_PRIVATE_KEY");
  if (cfg?.vapid_public_key && temSegredos) {
    console.log("Já configurada (chave no banco e nos segredos); nada muda.");
    continue;
  }

  const par = novoParVapid();
  console.log(`::add-mask::${par.privada}`);
  await api("POST", `/projects/${ref}/secrets`, [
    { name: "VAPID_PUBLIC_KEY", value: par.publica },
    { name: "VAPID_PRIVATE_KEY", value: par.privada },
    { name: "VAPID_SUBJECT", value: `mailto:${loja.admin_email}` },
  ]);
  await sql(`UPDATE public.store_config SET vapid_public_key = ${lit(par.publica)}, updated_at = now() WHERE id = 1`);

  const [depois] = await sql("SELECT vapid_public_key FROM public.store_config WHERE id = 1");
  const nomesDepois = new Set(((await api("GET", `/projects/${ref}/secrets`)) ?? []).map((s) => s.name));
  console.log(
    `Chave pública no banco: ${depois?.vapid_public_key === par.publica ? "SIM" : "NÃO"} · segredos: ${["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"].map((n) => `${n}=${nomesDepois.has(n) ? "ok" : "FALTA"}`).join(" ")}`,
  );
}

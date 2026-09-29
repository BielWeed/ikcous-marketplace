// Temporário (29/09/2026), pedido do dono: teste de ponta a ponta do Pix na
// loja IKCOUS (projeto de DESENVOLVIMENTO dekxabvqdsuukijblazl), que agora
// está com as credenciais de TESTE do Mercado Pago cadastradas pelo dono.
//
// 1. Liga o modo sandbox da criar-pagamento: segredo MP_SANDBOX_PAYER_EMAIL
//    (e-mail de comprador de teste; com ele a function manda payer.first_name
//    = "APRO", que faz o MP aprovar a order de teste sozinho — DEPLOYMENT.md
//    §5.2). Para voltar ao dinheiro real: APAGAR esse segredo.
// 2. Entra com a conta de cliente de teste e faz o MESMO pedido do teste do
//    dono (mesmo produto, 1 unidade, retirada na loja, Pix online) pela
//    mesma RPC do app (create_marketplace_order_v24).
// 3. Gera a cobrança pela criar-pagamento, como o app.
// 4. Acompanha o pedido até virar pago (webhook na hora ou reconciliação a
//    cada 10 min).
// Nada de dado pessoal no log; nenhum segredo impresso.
import crypto from "node:crypto";

const REF = "dekxabvqdsuukijblazl";
const BASE = `https://${REF}.supabase.co`;
const EMAIL_TESTE = "ikcous.imports+clienteteste@gmail.com";
const PAGADOR_SANDBOX = "test@testuser.com";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const senhaBase = (process.env.LOJAS_ADMIN_SENHA ?? "").trim();
if (!token || !senhaBase) {
  console.error("::error::Faltam SUPABASE_ACCESS_TOKEN ou LOJAS_ADMIN_SENHA.");
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
const mgmt = (metodo, caminho, corpo) =>
  chamar(`https://api.supabase.com/v1${caminho}`, { metodo, headers: { Authorization: `Bearer ${token}` }, corpo });
async function sql(query) {
  const r = await mgmt("POST", `/projects/${REF}/database/query`, { query });
  if (!r.ok) throw new Error(`SQL → HTTP ${r.status}: ${r.texto.slice(0, 300)}`);
  return r.json;
}
const passo = (t) => console.log(`\n== ${t} ==`);
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// 0. A credencial cadastrada na loja é mesmo a de teste? (só metadados)
passo("Credencial do Mercado Pago na loja");
console.log(JSON.stringify(await sql(`SELECT key, updated_at FROM public.app_settings WHERE key = 'pagamentos_mercado_pago'`)));
console.log(JSON.stringify(await sql(`SELECT pagamento_online, (mp_public_key IS NOT NULL) AS tem_public_key FROM public.store_config WHERE id = 1`)));

// 1. Modo sandbox.
passo("Modo sandbox (MP_SANDBOX_PAYER_EMAIL)");
const nomes = new Set(((await mgmt("GET", `/projects/${REF}/secrets`)).json ?? []).map((s) => s.name));
if (!nomes.has("MP_SANDBOX_PAYER_EMAIL")) {
  const r = await mgmt("POST", `/projects/${REF}/secrets`, [{ name: "MP_SANDBOX_PAYER_EMAIL", value: PAGADOR_SANDBOX }]);
  console.log(r.ok ? "gravado" : `FALHOU: HTTP ${r.status} ${r.texto.slice(0, 200)}`);
  await espera(15_000); // as functions pegam o segredo na próxima execução
} else {
  console.log("já estava gravado");
}

// 2. Login do cliente de teste.
const chaves = (await mgmt("GET", `/projects/${REF}/api-keys?reveal=true`)).json ?? [];
const pub = chaves.find((c) => c.type === "publishable")?.api_key ?? chaves.find((c) => c.name === "anon")?.api_key;
const login = await chamar(`${BASE}/auth/v1/token?grant_type=password`, {
  metodo: "POST",
  headers: { apikey: pub },
  corpo: { email: EMAIL_TESTE, password: `clienteteste${senhaBase}` },
});
if (!login.ok) throw new Error(`login do cliente de teste → HTTP ${login.status}`);
const jwt = login.json.access_token;
console.log(`::add-mask::${jwt}`);
const hUser = { apikey: pub, Authorization: `Bearer ${jwt}` };
passo("Login do cliente de teste: OK");

// 3. Mesmo produto do teste do dono (pedido 1bba1c18).
const [item] = await sql(`SELECT i.product_id, i.variant_id, i.quantity FROM public.marketplace_order_items i
  JOIN public.marketplace_orders o ON o.id = i.order_id WHERE left(o.id::text, 8) = '1bba1c18' LIMIT 1`);
const [pedidoRef] = await sql(`SELECT total FROM public.marketplace_orders WHERE left(id::text, 8) = '1bba1c18'`);
passo(`Produto do teste: ${String(item.product_id).slice(0, 8)} (variante ${item.variant_id ? "sim" : "não"}), total ${pedidoRef.total}`);

const rpc = await chamar(`${BASE}/rest/v1/rpc/create_marketplace_order_v24`, {
  metodo: "POST",
  headers: hUser,
  corpo: {
    p_items: [{ product_id: item.product_id, variant_id: item.variant_id ?? null, quantity: 1 }],
    p_total_amount: Number(pedidoRef.total),
    p_shipping_cost: 0,
    p_payment_method: "online",
    p_address_id: null,
    p_coupon_code: null,
    p_customer_name: "Cliente Teste",
    p_customer_phone: "34999990000",
    p_observation: "Teste automático do Pix (robô, sandbox) — pode ignorar",
    p_address_data: null,
    p_destination_cep: null,
    p_shipping_option_id: "store-pickup",
    p_idempotency_key: crypto.randomUUID(),
  },
});
passo(`Pedido pela RPC v24: HTTP ${rpc.status}`);
if (!rpc.ok) {
  console.log(rpc.texto.slice(0, 500));
  process.exit(1);
}
const orderId = typeof rpc.json === "string" ? rpc.json : (rpc.json?.id ?? rpc.json?.order_id ?? rpc.json?.[0]?.id);
console.log(`pedido ${String(orderId).slice(0, 8)} criado`);

// 4. Cobrança Pix, como o app.
const pag = await chamar(`${BASE}/functions/v1/criar-pagamento`, {
  metodo: "POST",
  headers: hUser,
  corpo: { orderId, metodo: "pix" },
});
passo(`criar-pagamento: HTTP ${pag.status}`);
const j = pag.json ?? {};
console.log(JSON.stringify({
  statusPagamento: j.statusPagamento,
  temQr: Boolean(j.qrCode || j.qr_code || j.copiaECola || j.qrCodeBase64),
  ticketUrl: j.ticketUrl ? new URL(j.ticketUrl).host + new URL(j.ticketUrl).pathname.slice(0, 20) : null,
  erro: j.error ?? j.erro ?? null,
  terminal: j.terminal ?? null,
}));
if (!pag.ok) process.exit(1);

// 5. Acompanha até pagar (webhook = segundos; reconciliação = até 10 min).
passo("Acompanhando o pedido");
const inicio = Date.now();
let ultimo = "";
for (let i = 0; i < 26; i++) {
  const [p] = await sql(`SELECT status, payment_status, paid_at, gateway_payment_id IS NOT NULL AS tem_cobranca
    FROM public.marketplace_orders WHERE id = '${orderId}'`);
  const estado = `${p.status}/${p.payment_status}`;
  if (estado !== ultimo) {
    console.log(`+${Math.round((Date.now() - inicio) / 1000)}s  ${estado}  cobrança=${p.tem_cobranca}  paid_at=${p.paid_at ?? "-"}`);
    ultimo = estado;
  }
  if (p.payment_status === "pago" || p.payment_status === "pago_apos_expirar") {
    console.log(`\nPAGO em ${Math.round((Date.now() - inicio) / 1000)}s — ${Date.now() - inicio < 90_000 ? "pelo aviso do Mercado Pago (webhook)" : "pela conferência automática (reconciliação)"}`);
    process.exit(0);
  }
  await espera(30_000);
}
console.log("\n::warning::Não virou pago em 13 min.");

// Temporário (28/09/2026): SÓ LEITURA. O dono pagou um Pix real de R$ 1
// (retirada na loja) e o pedido ficou aguardando confirmação. Mostra os
// pedidos das últimas 6 horas das lojas novas — só colunas de estado,
// pagamento e entrega (nada de nome, telefone, e-mail, CPF ou endereço) — e
// a configuração de pagamento de cada loja, para saber por qual caminho o Pix
// passou.
import fs from "node:fs";

const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));
const PII = /name|nome|phone|telefone|whats|email|cpf|document|address|endereco|cep|street|rua|bairro|neighborhood|complement|lat|lng|ip|user_agent|notes|observ|customer/i;
const INTERESSA = /^(id|created_at|updated_at|status|total|subtotal|shipping_cost|frete|discount)$|status|method|metodo|payment|pagamento|pix|mp_|mercado|entrega|delivery|pickup|retir|paid|pago|confirm|expira|expires|external/i;

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
    return r.ok ? JSON.parse(t) : { ERRO: r.status, detalhe: t.slice(0, 300) };
  };
  const projeto = (await api("GET", "/projects")).find((p) => p.name === loja.projeto);
  if (!projeto || PROIBIDOS.has(projeto.id)) throw new Error("projeto inválido");
  const sql = (query) => api("POST", `/projects/${projeto.id}/database/query`, { query });

  const cols = (await sql(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='marketplace_orders' ORDER BY ordinal_position`)).map((c) => c.column_name);
  const escolhidas = cols.filter((c) => INTERESSA.test(c) && !PII.test(c) && !/payload|qr_code|copia|brcode|emv|ticket/i.test(c));
  console.log(`colunas lidas: ${escolhidas.join(", ")}`);
  const lista = escolhidas.map((c) => `"${c}"`).join(", ");
  const pedidos = await sql(`SELECT ${lista} FROM public.marketplace_orders WHERE created_at > now() - interval '6 hours' ORDER BY created_at DESC LIMIT 10`);
  console.log(`pedidos (6h): ${JSON.stringify(pedidos)}`);

  const cfgCols = (await sql(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='store_config' ORDER BY ordinal_position`)).map((c) => c.column_name);
  const cfgEscolhidas = cfgCols.filter((c) => /pagamento|payment|pix|mp_|mercado|retir|pickup|forma/i.test(c) && !/token|secret|segredo|access/i.test(c));
  const cfg = await sql(`SELECT ${cfgEscolhidas.map((c) => `"${c}"`).join(", ")} FROM public.store_config WHERE id = 1`);
  // A chave Pix da loja é dado de contato do lojista: mostra só se existe.
  const mascarado = (cfg[0] ? Object.fromEntries(Object.entries(cfg[0]).map(([k, v]) => [k, /chave|key/i.test(k) && typeof v === "string" && v ? `(preenchida, ${v.length} caracteres)` : v])) : cfg);
  console.log(`config de pagamento: ${JSON.stringify(mascarado)}`);
}

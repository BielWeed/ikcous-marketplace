// Temporário (28/09/2026): SÓ LEITURA na loja principal. O Pix de R$ 1 do
// dono (23:07 UTC) ficou "aguardando". Rodada 3: o pg_cron não roda desde
// 03:20 UTC (hora da troca de banco no incidente) — confere a numeração
// interna do pg_cron contra o histórico restaurado (suspeita: runid_seq atrás
// do max(runid) → o agendador bate em chave duplicada e não registra/roda),
// e tenta de novo os logs (webhook do MP e erros do Postgres) pelo endpoint
// atual. Nada escreve; nenhum segredo é impresso.

const REF = "dekxabvqdsuukijblazl";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
if (token === "") {
  console.error("::error::Falta o segredo SUPABASE_ACCESS_TOKEN no GitHub.");
  process.exit(1);
}
async function api(metodo, caminho, corpo) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(`https://api.supabase.com/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const t = await r.text();
    if (r.ok) return t === "" ? null : JSON.parse(t);
    if (r.status >= 500 && tentativa < 4) {
      await new Promise((ok) => setTimeout(ok, 3000 * tentativa));
      continue;
    }
    return { ERRO: r.status, detalhe: t.slice(0, 400) };
  }
}
const sql = (query) => api("POST", `/projects/${REF}/database/query`, { query });
const mostra = (titulo, v) => console.log(`\n== ${titulo} ==\n${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`);

mostra("Os dois pedidos de R$ 1: mesmo cliente? como nasceram?", await sql(`WITH p AS (
    SELECT * FROM public.marketplace_orders WHERE left(id::text, 8) IN ('1bba1c18', 'c3dc3350'))
  SELECT left(id::text, 8) AS id, created_at, status, payment_status, paid_at,
    (SELECT count(DISTINCT user_id) FROM p) AS clientes_distintos,
    (SELECT count(*) FROM public.marketplace_order_items i WHERE i.order_id = p.id) AS itens,
    left(gateway_payment_id, 12) || '…' || right(gateway_payment_id, 4) AS gateway
  FROM p ORDER BY created_at`));
mostra("Colunas de marketplace_orders (para achar vínculo entre pedidos)", (await sql(`SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) AS colunas
  FROM information_schema.columns WHERE table_schema='public' AND table_name='marketplace_orders'`)));
mostra("Histórico dos dois pedidos", await sql(`SELECT left(order_id::text, 8) AS pedido, created_at,
  (SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_name='marketplace_order_history') AS cols
  FROM public.marketplace_order_history WHERE left(order_id::text, 8) IN ('1bba1c18', 'c3dc3350') ORDER BY created_at LIMIT 1`));

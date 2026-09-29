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

mostra("Pedidos com Pix online ainda 'aguardando' e vencidos", await sql(`SELECT left(id::text, 8) AS id, status, payment_status,
  metodo_online, created_at, expires_at,
  CASE WHEN gateway_payment_id IS NULL THEN null ELSE left(gateway_payment_id, 3) || '… (' || length(gateway_payment_id) || ')' END AS gateway
  FROM public.marketplace_orders WHERE payment_status = 'aguardando' AND expires_at < now() ORDER BY created_at DESC LIMIT 10`));
mostra("Execuções do pg_cron desde a correção", await sql(`SELECT j.jobname, d.status, d.start_time, left(d.return_message, 100) AS msg
  FROM cron.job_run_details d JOIN cron.job j USING (jobid) ORDER BY d.start_time DESC LIMIT 8`));
mostra("Respostas do pg_net (reconciliação)", await sql(`SELECT status_code, created,
  left(regexp_replace(coalesce(content::text, error_msg, ''), '\\s+', ' ', 'g'), 300) AS resumo
  FROM net._http_response ORDER BY created DESC LIMIT 4`));

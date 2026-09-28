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

mostra("Numeração do pg_cron × histórico", await sql(`SELECT
  (SELECT last_value FROM cron.runid_seq) AS runid_seq_last_value,
  (SELECT is_called FROM cron.runid_seq) AS runid_seq_is_called,
  (SELECT max(runid) FROM cron.job_run_details) AS max_runid_no_historico,
  (SELECT last_value FROM cron.jobid_seq) AS jobid_seq_last_value,
  (SELECT max(jobid) FROM cron.job) AS max_jobid`));
mostra("Execuções recentes por job (qualquer data, últimas 6)", await sql(`SELECT jobid, runid, status, start_time, left(return_message, 120) AS msg
  FROM cron.job_run_details ORDER BY runid DESC LIMIT 6`));
mostra("O pedido de R$ 1 agora", await sql(`SELECT left(id::text, 8) AS id, status, payment_status, expires_at, paid_at, updated_at
  FROM public.marketplace_orders WHERE created_at > now() - interval '8 hours' AND total = 1.00`));
mostra("Processo do agendador", await sql(`SELECT pid, backend_type, backend_start, state, wait_event
  FROM pg_stat_activity WHERE backend_type ILIKE '%cron%'`));

// Logs pelo endpoint atual (/analytics/endpoints/logs). Testa as tabelas
// uma a uma com uma consulta mínima, e filtra as de interesse.
const fim = new Date();
const inicio = new Date(fim.getTime() - 3 * 60 * 60 * 1000);
async function logs(titulo, consulta) {
  const q = new URLSearchParams({ sql: consulta, iso_timestamp_start: inicio.toISOString(), iso_timestamp_end: fim.toISOString() });
  const r = await api("GET", `/projects/${REF}/analytics/endpoints/logs?${q}`);
  console.log(`\n== ${titulo} ==`);
  if (r?.ERRO || r?.error) return console.log(JSON.stringify(r?.ERRO ? r : r.error).slice(0, 400));
  const linhas = r?.result ?? [];
  if (linhas.length === 0) return console.log("(nada nas últimas 3 h)");
  for (const l of linhas) {
    const quando = l.timestamp ? new Date(Number(l.timestamp) / 1000).toISOString().slice(11, 19) : "?";
    console.log(`${quando}  ${String(l.event_message ?? JSON.stringify(l)).replace(/\s+/g, " ").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>").slice(0, 320)}`);
  }
}
await logs("Postgres: erros e cron (3 h)", `select timestamp, event_message from postgres_logs
  where regexp_contains(event_message, '(?i)cron|duplicate key|job_run_details|runid')
  order by timestamp desc limit 25`);
await logs("Borda: chamadas às functions de pagamento (3 h)", `select timestamp, event_message from edge_logs
  where regexp_contains(event_message, 'webhook-mercadopago|reconciliar-pagamentos|criar-pagamento')
  order by timestamp desc limit 30`);
await logs("Functions: chamadas (3 h)", `select timestamp, event_message from function_edge_logs
  where regexp_contains(event_message, 'webhook-mercadopago|reconciliar-pagamentos|criar-pagamento')
  order by timestamp desc limit 30`);
await logs("Functions: mensagens (3 h)", `select timestamp, event_message from function_logs
  order by timestamp desc limit 40`);

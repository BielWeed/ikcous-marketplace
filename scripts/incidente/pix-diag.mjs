// Temporário (28/09/2026): SÓ LEITURA na loja principal. O dono pagou um Pix
// real de R$ 1 (retirada na loja, "Pagar agora com PIX" no app) e o pedido
// ficou aguardando confirmação. Mostra, sem dado pessoal e sem valor secreto:
// os pedidos das últimas 6 h (estado, pagamento, entrega), as chamadas e
// mensagens das functions de pagamento nas últimas 3 h, os jobs do pg_cron e
// suas execuções, as respostas do pg_net, se o Vault tem as entradas da
// reconciliação, se a credencial do lojista existe, e os NOMES dos segredos.
// Nenhum comando escreve.

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
    return { ERRO: r.status, detalhe: t.slice(0, 300) };
  }
}
const sql = (query) => api("POST", `/projects/${REF}/database/query`, { query });
const mostra = (titulo, v) => console.log(`\n== ${titulo} ==\n${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`);

// 1. Pedidos das últimas 6 h — só colunas de estado/pagamento/entrega.
const PII = /name|nome|phone|telefone|whats|email|cpf|document|address|endereco|cep|street|rua|bairro|neighborhood|complement|lat|lng|ip|user_agent|notes|observ|customer|user_id/i;
const INTERESSA = /^(id|created_at|updated_at|status|total|subtotal)$|status|method|metodo|payment|pagamento|pix|mp_|gateway|entrega|delivery|pickup|retir|shipping_type|tipo|paid|pago|confirm|expira|expires|tentativa/i;
const cols = (await sql(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='marketplace_orders' ORDER BY ordinal_position`)).map((c) => c.column_name);
const escolhidas = cols.filter((c) => INTERESSA.test(c) && !PII.test(c) && !/payload|qr|copia|brcode|emv|ticket|url/i.test(c));
const pedidos = await sql(`SELECT ${escolhidas.map((c) => `"${c}"`).join(", ")}
  FROM public.marketplace_orders WHERE created_at > now() - interval '6 hours' ORDER BY created_at DESC LIMIT 10`);
// O id do pagamento no MP só aparece como prefixo (tipo ORD/PAY) e tamanho.
const semId = Array.isArray(pedidos)
  ? pedidos.map((p) => ({
      ...p,
      id: String(p.id).slice(0, 8),
      gateway_payment_id: p.gateway_payment_id ? `${String(p.gateway_payment_id).slice(0, 3)}… (${String(p.gateway_payment_id).length})` : null,
    }))
  : pedidos;
mostra("Pedidos das últimas 6 h", semId);

// 2. Configuração de pagamento da loja (sem valores de chave).
const cfg = await sql(`SELECT pagamento_online, (mp_public_key IS NOT NULL) AS tem_mp_public_key,
  formas_pagamento_entrega FROM public.store_config WHERE id = 1`);
mostra("store_config", cfg);
mostra("Credencial do lojista em app_settings (só se existe e quando mudou)",
  await sql(`SELECT key, updated_at FROM public.app_settings WHERE key ILIKE '%mercado%' OR key ILIKE '%pagamento%'`));

// 3. pg_cron: jobs e execuções das últimas 3 h.
mostra("Jobs do pg_cron", await sql("SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid"));
mostra("Execuções do pg_cron (3 h)", await sql(`SELECT j.jobname, d.status, d.start_time, left(d.return_message, 160) AS msg
  FROM cron.job_run_details d JOIN cron.job j USING (jobid)
  WHERE d.start_time > now() - interval '3 hours' ORDER BY d.start_time DESC LIMIT 25`));
mostra("Respostas do pg_net (as chamadas do cron às functions)", await sql(`SELECT id, status_code, created,
  left(regexp_replace(coalesce(content::text, error_msg, ''), '\\s+', ' ', 'g'), 220) AS resumo
  FROM net._http_response ORDER BY created DESC LIMIT 12`));

// 4. Vault: só se as entradas existem.
mostra("Vault (nomes)", await sql(`SELECT name, updated_at FROM vault.secrets
  WHERE name IN ('reconciliacao_url', 'reconciliacao_secret')`));

// 5. Segredos das functions: só os nomes que o Pix usa.
const segredos = await api("GET", `/projects/${REF}/secrets`);
const nomes = new Set(Array.isArray(segredos) ? segredos.map((s) => s.name) : []);
mostra("Segredos das functions (presença)", Object.fromEntries(
  ["MP_CHAVES_ENCRYPTION_KEY", "MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "RECONCILIACAO_SECRET", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"]
    .map((n) => [n, nomes.has(n) ? "ok" : "FALTA"]),
));
const funcoes = await api("GET", `/projects/${REF}/functions`);
mostra("Functions de pagamento publicadas", Array.isArray(funcoes)
  ? funcoes.filter((f) => /pagamento|mercado|webhook|reconcili/.test(f.slug)).map((f) => ({ slug: f.slug, versao: f.version, status: f.status, jwt: f.verify_jwt, atualizada: f.updated_at }))
  : funcoes);

// 6. Logs das functions de pagamento nas últimas 3 h (o código não loga segredo).
const fim = new Date();
const inicio = new Date(fim.getTime() - 3 * 60 * 60 * 1000);
async function logs(titulo, consulta) {
  const q = new URLSearchParams({ sql: consulta, iso_timestamp_start: inicio.toISOString(), iso_timestamp_end: fim.toISOString() });
  const r = await api("GET", `/projects/${REF}/analytics/endpoints/logs.all?${q}`);
  console.log(`\n== ${titulo} ==`);
  if (r?.ERRO || r?.error) return console.log(JSON.stringify(r.ERRO ? r : r.error).slice(0, 400));
  const linhas = r?.result ?? [];
  if (linhas.length === 0) return console.log("(nada nas últimas 3 h)");
  for (const l of linhas) {
    const quando = new Date(Number(l.timestamp) / 1000).toISOString().slice(11, 19);
    const extra = l.status_code !== undefined ? `  [${l.status_code}, ${l.execution_time_ms ?? "?"}ms]` : "";
    console.log(`${quando}  ${String(l.event_message ?? "").replace(/\s+/g, " ").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>").slice(0, 320)}${extra}`);
  }
}
await logs("Chamadas às functions de pagamento (3 h)", `select timestamp, event_message, r.status_code, m.execution_time_ms
  from function_edge_logs cross join unnest(metadata) as m cross join unnest(m.response) as r
  where regexp_contains(event_message, 'criar-pagamento|webhook-mercadopago|reconciliar-pagamentos|credenciais-mercado-pago')
  order by timestamp desc limit 60`);
await logs("Mensagens das functions (3 h)", `select timestamp, event_message from function_logs
  order by timestamp desc limit 80`);

// 7. Por que o pg_cron não roda: onde os jobs apontam, se o agendador existe,
// e o que o Postgres registrou sobre ele.
mostra("Jobs (banco/usuário/nó)", await sql("SELECT jobid, jobname, database, username, nodename, nodeport, active FROM cron.job ORDER BY jobid"));
mostra("Histórico total do pg_cron", await sql("SELECT count(*) AS execucoes, max(start_time) AS ultima FROM cron.job_run_details"));
mostra("Configuração do pg_cron", await sql(`SELECT current_database() AS banco_atual,
  current_setting('cron.database_name', true) AS cron_database_name,
  current_setting('cron.use_background_workers', true) AS background_workers,
  current_setting('cron.log_run', true) AS log_run,
  current_setting('cron.host', true) AS cron_host`));
mostra("Extensões", await sql("SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net', 'supabase_vault')"));
mostra("Processo do agendador (pg_stat_activity)", await sql(`SELECT pid, backend_type, application_name, state, backend_start
  FROM pg_stat_activity WHERE backend_type ILIKE '%cron%' OR application_name ILIKE '%cron%' OR backend_type ILIKE '%pg_net%'`));
mostra("O pedido de R$ 1 agora", await sql(`SELECT left(id::text, 8) AS id, status, payment_status, expires_at, paid_at, updated_at
  FROM public.marketplace_orders WHERE created_at > now() - interval '6 hours' AND total = 1.00`));
await logs("Postgres: mensagens do cron/pg_net (3 h)", `select timestamp, event_message from postgres_logs
  where regexp_contains(event_message, '(?i)cron|pg_net|scheduler')
  order by timestamp desc limit 30`);
await logs("Borda: chamadas ao webhook do MP (3 h)", `select timestamp, event_message from edge_logs
  where regexp_contains(event_message, 'webhook-mercadopago|reconciliar-pagamentos|criar-pagamento')
  order by timestamp desc limit 40`);

// Temporário (28-29/09/2026, check-in das 11:40 UTC): SÓ LEITURA na loja principal. Rodada 4
// (check-in de 29/09): depois de destravar o pg_cron, confere que a
// reconciliação, a expiração e a devolução de cupons seguem rodando, que as
// chamadas do pg_net voltam 2xx, que nenhum Pix ficou preso em "aguardando"
// depois de vencer e que o modo sandbox (MP_SANDBOX_PAYER_EMAIL) continua
// desligado. Nada escreve; nenhum segredo nem dado pessoal é impresso.

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

mostra("Jobs do pg_cron nas últimas 2 h", await sql(`SELECT j.jobname, j.schedule, j.active,
    count(d.runid) FILTER (WHERE d.status = 'succeeded') AS ok,
    count(d.runid) FILTER (WHERE d.status <> 'succeeded') AS falhas,
    max(d.start_time) AS ultima,
    (SELECT left(x.return_message, 160) FROM cron.job_run_details x
      WHERE x.jobid = j.jobid AND x.status <> 'succeeded' ORDER BY x.start_time DESC LIMIT 1) AS ultima_falha
  FROM cron.job j
  LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid AND d.start_time > now() - interval '2 hours'
  GROUP BY j.jobid, j.jobname, j.schedule, j.active ORDER BY j.jobname`));
mostra("Respostas do pg_net nas últimas 2 h (por código)", await sql(`SELECT status_code, count(*) AS n,
    max(created) AS ultima FROM net._http_response
  WHERE created > now() - interval '2 hours' GROUP BY status_code ORDER BY status_code`));
mostra("Pedidos online das últimas 24 h (por situação do pagamento)", await sql(`SELECT payment_status, count(*) AS n,
    max(created_at) AS mais_recente
  FROM public.marketplace_orders
  WHERE created_at > now() - interval '24 hours' AND gateway_payment_id IS NOT NULL
  GROUP BY payment_status ORDER BY payment_status`));
mostra("Pix presos: 'aguardando' com prazo vencido há mais de 10 min (esperado: 0)", await sql(`SELECT count(*) AS presos,
    min(expires_at) AS mais_antigo
  FROM public.marketplace_orders
  WHERE payment_status = 'aguardando' AND expires_at < now() - interval '10 minutes'`));

mostra("Os presos: situação do pedido (sem dado pessoal)", await sql(`SELECT left(id::text, 8) AS pedido, status,
    payment_status, created_at, expires_at, gateway_payment_id IS NOT NULL AS tem_cobranca
  FROM public.marketplace_orders
  WHERE payment_status = 'aguardando' AND expires_at < now() - interval '10 minutes'
  ORDER BY created_at`));
mostra("Regra do job de expiração (corpo do comando)", await sql(`SELECT jobname, left(command, 400) AS comando
  FROM cron.job WHERE jobname = 'expirar-pedidos-vencidos'`));

const nomes = await api("GET", `/projects/${REF}/secrets`);
const sandbox = Array.isArray(nomes) && nomes.some((s) => s.name === "MP_SANDBOX_PAYER_EMAIL");
mostra("Modo sandbox do Pix", Array.isArray(nomes)
  ? (sandbox ? "ATENÇÃO: MP_SANDBOX_PAYER_EMAIL PRESENTE" : "desligado (MP_SANDBOX_PAYER_EMAIL ausente)")
  : nomes);
if (sandbox) console.log("::error::MP_SANDBOX_PAYER_EMAIL presente com credenciais reais.");

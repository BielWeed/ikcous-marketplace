// Temporário (28-29/09/2026), autorizado pelo dono: destrava o pg_cron da loja
// principal. Na troca de banco do incidente, o histórico `cron.job_run_details`
// veio restaurado (runid até 25857), mas o `cron.runid_seq` recomeçou (214):
// cada execução nova batia em chave duplicada e o agendador reiniciava, então
// reconciliação do Pix, expiração e devolução de cupons pararam às 03:20 UTC.
// ÚNICA escrita: `setval` do `cron.runid_seq` para o máximo do histórico (não
// apaga nada, não mexe em pedido). Depois só lê: acompanha as execuções novas
// e o pedido de R$ 1 até a reconciliação passar (jobs a cada 5/10/15 min).

const REF = "dekxabvqdsuukijblazl";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
if (token === "") {
  console.error("::error::Falta o segredo SUPABASE_ACCESS_TOKEN no GitHub.");
  process.exit(1);
}
async function sql(query) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (r.ok) return JSON.parse(t);
    if (r.status >= 500 && tentativa < 4) {
      await new Promise((ok) => setTimeout(ok, 3000 * tentativa));
      continue;
    }
    throw new Error(`SQL → HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
}
const mostra = (titulo, v) => console.log(`\n== ${titulo} ==\n${JSON.stringify(v, null, 1)}`);
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

const [antes] = await sql(`SELECT (SELECT last_value FROM cron.runid_seq) AS seq,
  (SELECT max(runid) FROM cron.job_run_details) AS max_runid, now() AS agora`);
mostra("Antes", antes);
if (Number(antes.seq) < Number(antes.max_runid)) {
  const [depois] = await sql("SELECT setval('cron.runid_seq', (SELECT max(runid) FROM cron.job_run_details)) AS seq_novo");
  mostra("setval aplicado", depois);
} else {
  console.log("\nA sequência já está à frente do histórico; nada a aplicar.");
}
const marco = antes.agora;

// Acompanha até 16 min: execuções novas dos jobs, resposta do pg_net e o pedido.
let reconciliou = false;
for (let minuto = 1; minuto <= 16; minuto++) {
  await espera(60_000);
  const execucoes = await sql(`SELECT j.jobname, d.status, d.start_time, left(d.return_message, 120) AS msg
    FROM cron.job_run_details d JOIN cron.job j USING (jobid)
    WHERE d.start_time > '${marco}' ORDER BY d.start_time DESC LIMIT 10`);
  const pedido = await sql(`SELECT left(id::text, 8) AS id, status, payment_status, paid_at, updated_at
    FROM public.marketplace_orders WHERE created_at > now() - interval '8 hours' AND total = 1.00`);
  console.log(`\n--- minuto ${minuto}: ${execucoes.length} execução(ões) nova(s); pedido ${JSON.stringify(pedido)}`);
  for (const e of execucoes) console.log(`   ${e.start_time} ${e.jobname} ${e.status} ${e.msg ?? ""}`);
  if (execucoes.some((e) => e.jobname === "reconciliar-pagamentos")) {
    reconciliou = true;
    await espera(45_000); // a function roda depois do net.http_post
    break;
  }
}
mostra("Respostas do pg_net depois da correção", await sql(`SELECT status_code, created,
  left(regexp_replace(coalesce(content::text, error_msg, ''), '\\s+', ' ', 'g'), 300) AS resumo
  FROM net._http_response WHERE created > '${marco}' ORDER BY created DESC LIMIT 5`));
mostra("Pedido de R$ 1 no fim", await sql(`SELECT left(id::text, 8) AS id, status, payment_status, paid_at, updated_at
  FROM public.marketplace_orders WHERE created_at > now() - interval '8 hours' AND total = 1.00`));
mostra("Pedidos online ainda aguardando e já vencidos (contagem)", await sql(`SELECT count(*) AS n FROM public.marketplace_orders
  WHERE payment_status = 'aguardando' AND expires_at < now()`));
if (!reconciliou) console.log("\n::warning::A reconciliação não rodou em 16 min — conferir o agendador.");

// Temporário (incidente 28/09/2026): depois das edge functions publicadas no
// projeto novo, recria o que o backup não trouxe — segredo e URL da reconciliação
// no Vault (o Vault é cifrado por projeto), o mesmo segredo no ambiente da
// function e os três jobs do pg_cron — e confere endereço do Auth, functions e
// segredos. Nenhum valor secreto é impresso; só nomes.

import { randomBytes } from "node:crypto";

const REF = "dekxabvqdsuukijblazl";
const SITE = "https://ickous-marketplace.vercel.app";
const REDIRECTS = [`${SITE}/**`, "https://*-gabriels-projects-5a19f6ee.vercel.app/**"];
const URL_RECONCILIACAO = `https://${REF}.supabase.co/functions/v1/reconciliar-pagamentos`;
const SEGREDOS_DE_FORA = [
  ["SMTP_USER", "e-mails de pedido e código de acesso"],
  ["SMTP_PASSWORD", "e-mails de pedido e código de acesso"],
  ["VAPID_PUBLIC_KEY", "notificações no celular"],
  ["VAPID_PRIVATE_KEY", "notificações no celular"],
  ["VAPID_SUBJECT", "notificações no celular"],
  ["MP_CHAVES_ENCRYPTION_KEY", "ler as chaves do Mercado Pago salvas pelo lojista"],
  ["MP_ACCESS_TOKEN", "PIX quando o lojista não cadastrou chave própria"],
  ["MP_WEBHOOK_SECRET", "confirmação automática do PIX quando o lojista não cadastrou chave própria"],
];
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();

function parar(mensagem) {
  console.error(`\n::error::${mensagem}`);
  process.exit(1);
}
if (token === "") parar("Falta o segredo SUPABASE_ACCESS_TOKEN no GitHub.");

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(`https://api.supabase.com/v1${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    // Nunca ecoa o corpo enviado (pode ter segredo); só a resposta.
    throw new Error(`${metodo} ${caminho} → HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  return texto === "" ? null : JSON.parse(texto);
}
const sql = (query) => api("POST", `/projects/${REF}/database/query`, { query });
const literal = (valor) => `'${String(valor).replaceAll("'", "''")}'`;

function mostrar(titulo, linhas) {
  console.log(`\n== ${titulo} ==`);
  if (!Array.isArray(linhas) || linhas.length === 0) console.log("(nenhuma linha)");
  else console.table(linhas);
}

// 1. Vault: segredo e URL da reconciliação.
const vault = await sql(
  "SELECT id, name FROM vault.secrets WHERE name IN ('reconciliacao_secret', 'reconciliacao_url')",
);
const idDe = (nome) => vault.find((v) => v.name === nome)?.id;
if (!idDe("reconciliacao_secret")) {
  const novo = randomBytes(32).toString("hex");
  await sql(`SELECT vault.create_secret(${literal(novo)}, 'reconciliacao_secret',
             'Header x-reconciliacao-secret do job reconciliar-pagamentos')`);
  console.log("Vault: reconciliacao_secret criado.");
}
if (idDe("reconciliacao_url")) {
  await sql(`SELECT vault.update_secret(${literal(idDe("reconciliacao_url"))}::uuid, ${literal(URL_RECONCILIACAO)})`);
  console.log("Vault: reconciliacao_url atualizado.");
} else {
  await sql(`SELECT vault.create_secret(${literal(URL_RECONCILIACAO)}, 'reconciliacao_url',
             'URL da edge function reconciliar-pagamentos')`);
  console.log("Vault: reconciliacao_url criado.");
}

// 2. O mesmo segredo no ambiente da function (lido do Vault, nunca impresso).
const [{ valor }] = await sql(
  "SELECT decrypted_secret AS valor FROM vault.decrypted_secrets WHERE name = 'reconciliacao_secret'",
);
if (!valor) parar("reconciliacao_secret não decifrou no Vault.");
await api("POST", `/projects/${REF}/secrets`, [{ name: "RECONCILIACAO_SECRET", value: valor }]);
console.log("Function: RECONCILIACAO_SECRET gravado igual ao Vault.");

// 3. Jobs do pg_cron (mesmo conteúdo de scripts/migracao/recriar-cron-jobs.sql).
await sql("CREATE EXTENSION IF NOT EXISTS pg_net");
const jobs = [
  ["expirar-pedidos-vencidos", "*/5 * * * *", "SELECT public.expirar_pedidos_vencidos();", "expirar_pedidos_vencidos"],
  [
    "reconciliar-pagamentos",
    "*/10 * * * *",
    `SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reconciliacao_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-reconciliacao-secret',
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reconciliacao_secret')
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 120000
    ) AS request_id;`,
    null,
  ],
  [
    "devolver-cupons-de-pedidos-mortos",
    "*/15 * * * *",
    "SELECT public.devolver_cupons_de_pedidos_mortos();",
    "devolver_cupons_de_pedidos_mortos",
  ],
];
for (const [nome, agenda, comando, funcao] of jobs) {
  if (funcao) {
    const [{ existe }] = await sql(
      `SELECT to_regprocedure(${literal(`public.${funcao}()`)}) IS NOT NULL AS existe`,
    );
    if (!existe) {
      console.log(`::warning::cron ${nome}: public.${funcao}() não existe no banco novo — job não criado.`);
      continue;
    }
  }
  await sql(`SELECT cron.unschedule(${literal(nome)})
              WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = ${literal(nome)})`);
  await sql(`SELECT cron.schedule(${literal(nome)}, ${literal(agenda)}, $cron$ ${comando} $cron$)`);
}
mostrar("Jobs do pg_cron", await sql("SELECT jobname, schedule, active FROM cron.job ORDER BY jobname"));

// 4. Endereços do Auth (links de e-mail e volta do login).
const auth = await api("GET", `/projects/${REF}/config/auth`);
const listaAtual = (auth.uri_allow_list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const faltam = REDIRECTS.filter((r) => !listaAtual.includes(r));
if (auth.site_url !== SITE || faltam.length > 0) {
  await api("PATCH", `/projects/${REF}/config/auth`, {
    site_url: SITE,
    uri_allow_list: [...listaAtual, ...faltam].join(","),
  });
  console.log(`\nAuth: site_url e redirects acertados (${faltam.length} redirect(s) incluído(s)).`);
} else {
  console.log("\nAuth: site_url e redirects já estavam certos.");
}

// 5. Chave que cifra as chaves do Mercado Pago do lojista. A antiga ficou no projeto
// pausado; com uma nova, o lojista recadastra as chaves no painel e o PIX volta.
// Se um dia a antiga aparecer, basta gravá-la por cima ANTES do recadastro.
const antes = new Set((await api("GET", `/projects/${REF}/secrets`)).map((s) => s.name));
if (!antes.has("MP_CHAVES_ENCRYPTION_KEY")) {
  await api("POST", `/projects/${REF}/secrets`, [
    { name: "MP_CHAVES_ENCRYPTION_KEY", value: randomBytes(32).toString("base64") },
  ]);
  console.log("\nFunction: MP_CHAVES_ENCRYPTION_KEY nova gravada (o lojista precisa recadastrar as chaves do MP).");
}

// 6. Conferência.
const funcoes = await api("GET", `/projects/${REF}/functions`);
mostrar(
  "Edge functions no projeto novo",
  funcoes
    .map((f) => ({ nome: f.slug, versao: f.version, estado: f.status, verify_jwt: f.verify_jwt }))
    .sort((a, b) => a.nome.localeCompare(b.nome)),
);
const nomes = new Set((await api("GET", `/projects/${REF}/secrets`)).map((s) => s.name));
mostrar(
  "Segredos das functions que só o dono tem",
  SEGREDOS_DE_FORA.map(([nome, para]) => ({ nome, situacao: nomes.has(nome) ? "ok" : "FALTA", para })),
);
const [{ lojista }] = await sql(
  "SELECT count(*)::int AS lojista FROM public.app_settings WHERE key = 'pagamentos_mercado_pago'",
);
console.log(
  lojista > 0
    ? "Mercado Pago: o lojista tem chave própria salva (precisa da MP_CHAVES_ENCRYPTION_KEY antiga, ou recadastrar no painel)."
    : "Mercado Pago: nenhuma chave de lojista salva — o PIX usa MP_ACCESS_TOKEN da plataforma.",
);

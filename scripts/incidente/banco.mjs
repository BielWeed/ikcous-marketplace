// Temporário (incidente 28/09/2026): grava a publishable key do projeto novo na
// caderneta da frota (`frota_lojas`) pela Management API do Supabase e confere o
// que ainda falta no banco novo. Roda só no GitHub Actions — o token vem do
// segredo SUPABASE_ACCESS_TOKEN e nunca é impresso.

const REF = "dekxabvqdsuukijblazl";
const REF_ANTIGO = "cafkrminfnokvgjqtkle";
const CHAVE_PUBLICA = "sb_publishable_07V7N2KcNA3Kk7e4sxQVLA_dlOKUf14";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();

function parar(mensagem) {
  console.error(`\n::error::${mensagem}`);
  process.exit(1);
}

if (token === "") parar("Falta o segredo SUPABASE_ACCESS_TOKEN no GitHub.");

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(`https://api.supabase.com/v1${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`${metodo} ${caminho} → HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  return texto === "" ? null : JSON.parse(texto);
}

const sql = (query) => api("POST", `/projects/${REF}/database/query`, { query });

function mostrar(titulo, linhas) {
  console.log(`\n== ${titulo} ==`);
  if (!Array.isArray(linhas) || linhas.length === 0) console.log("(nenhuma linha)");
  else console.table(linhas);
}

const projetos = await api("GET", "/projects");
mostrar(
  "Projetos que o token enxerga",
  projetos.map((p) => ({ ref: p.id, nome: p.name, status: p.status, regiao: p.region })),
);
if (!projetos.some((p) => p.id === REF)) {
  parar(
    `O token não enxerga o projeto novo (${REF}). O SUPABASE_ACCESS_TOKEN do GitHub ainda é da conta antiga?`,
  );
}

const FROTA = `SELECT id, nome, dominio_publico, project_ref, supabase_url,
       left(publishable_key, 16) || '…' AS chave, ativa
  FROM public.frota_lojas ORDER BY id`;

mostrar("Frota antes", await sql(FROTA));
mostrar(
  "Linhas da frota atualizadas",
  await sql(`UPDATE public.frota_lojas
     SET publishable_key = '${CHAVE_PUBLICA}', updated_at = now()
   WHERE project_ref = '${REF}'
     AND publishable_key IS DISTINCT FROM '${CHAVE_PUBLICA}'
  RETURNING id, dominio_publico`),
);
mostrar("Frota depois", await sql(FROTA));

mostrar(
  "pgcrypto (a caderneta confere a senha da frota com ele)",
  await sql(`SELECT extname, extnamespace::regnamespace::text AS schema
               FROM pg_extension WHERE extname = 'pgcrypto'`),
);
mostrar(
  "Senha da frota veio no backup (tem que ser 1)",
  await sql("SELECT count(*)::int AS senhas FROM public.frota_segredo"),
);
mostrar(
  "Funções que ainda citam o projeto antigo (o ideal é nenhuma)",
  await sql(`SELECT n.nspname AS schema, p.proname AS funcao
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.prosrc LIKE '%${REF_ANTIGO}%' ORDER BY 1, 2`),
);
mostrar(
  "Segredos do Vault (só os nomes)",
  await sql("SELECT name FROM vault.secrets ORDER BY name"),
);
mostrar(
  "Tarefas agendadas (pg_cron)",
  await sql("SELECT jobname, schedule, active FROM cron.job ORDER BY jobname"),
);

const frota = await sql(
  `SELECT count(*)::int AS velhas FROM public.frota_lojas
    WHERE project_ref = '${REF}' AND publishable_key <> '${CHAVE_PUBLICA}'`,
);
if (frota[0]?.velhas !== 0) parar("Ainda há loja do projeto novo com a chave antiga na frota.");
console.log("\nFrota conferida: toda loja do projeto novo está com a chave nova.");

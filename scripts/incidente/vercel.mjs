// Temporário (incidente 28/09/2026): aponta as variáveis do projeto da Vercel
// para o projeto novo do Supabase, faz o redeploy de produção e testa os
// domínios. Roda só no GitHub Actions — o token vem do segredo VERCEL_TOKEN e
// nunca é impresso. Só valores PÚBLICOS são gravados (URL e publishable key);
// IKCOUS_FROTA_CHAVE (a senha da frota) não é lida nem alterada.

const PROJETO = (process.env.VERCEL_PROJETO ?? "").trim() || "ickous-marketplace";
const URL_NOVA = "https://dekxabvqdsuukijblazl.supabase.co";
const CHAVE_PUBLICA = "sb_publishable_07V7N2KcNA3Kk7e4sxQVLA_dlOKUf14";
const DESEJADAS = {
  VITE_SUPABASE_URL: URL_NOVA,
  VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE_PUBLICA,
  IKCOUS_FROTA_URL: URL_NOVA,
  IKCOUS_FROTA_APIKEY: CHAVE_PUBLICA,
};
// A anon legada do projeto antigo não vale no novo; sem ela o app usa a publishable.
const APAGAR = ["VITE_SUPABASE_ANON_KEY"];
const OBSERVAR = [...Object.keys(DESEJADAS), ...APAGAR, "IKCOUS_FROTA_CHAVE", "VITE_APP_URL", "IKCOUS_IDENTITY_MODE"];
const token = (process.env.VERCEL_TOKEN ?? "").trim();

function parar(mensagem) {
  console.error(`\n::error::${mensagem}`);
  process.exit(1);
}

if (token === "") parar("Falta o segredo VERCEL_TOKEN no GitHub.");

let escopo = "";

async function api(metodo, caminho, corpo, { tolerar404 = false } = {}) {
  const separador = caminho.includes("?") ? "&" : "?";
  const url = `https://api.vercel.com${caminho}${escopo ? `${separador}teamId=${escopo}` : ""}`;
  const resposta = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (tolerar404 && resposta.status === 404) return null;
  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`${metodo} ${caminho} → HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  return texto === "" ? null : JSON.parse(texto);
}

const alvos = (env) => [].concat(env.target ?? []);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Acha o projeto: primeiro nos times, depois na conta pessoal.
const { teams = [] } = (await api("GET", "/v2/teams")) ?? {};
console.log(`Times que o token enxerga: ${teams.map((t) => t.slug).join(", ") || "(nenhum)"}`);
let projeto = null;
for (const candidato of [...teams.map((t) => t.id), ""]) {
  escopo = candidato;
  projeto = await api("GET", `/v9/projects/${encodeURIComponent(PROJETO)}`, undefined, { tolerar404: true });
  if (projeto) break;
}
if (!projeto) parar(`Projeto "${PROJETO}" não encontrado com esse token (confira o Scope do token).`);
console.log(`Projeto: ${projeto.name} (${projeto.id}) no escopo ${escopo || "pessoal"}`);

async function listarVariaveis(titulo) {
  const { envs = [] } = await api("GET", `/v10/projects/${projeto.id}/env`);
  console.log(`\n== ${titulo} ==`);
  console.table(
    envs
      .filter((e) => OBSERVAR.includes(e.key))
      .map((e) => ({ nome: e.key, ambientes: alvos(e).join(","), branch: e.gitBranch ?? "", tipo: e.type }))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
  );
  return envs;
}

// 2. Variáveis.
const envs = await listarVariaveis("Variáveis antes (sem valores)");
for (const [nome, valor] of Object.entries(DESEJADAS)) {
  const existentes = envs.filter((e) => e.key === nome);
  for (const e of existentes) {
    await api("PATCH", `/v9/projects/${projeto.id}/env/${e.id}`, { value: valor });
    console.log(`atualizada: ${nome} [${alvos(e).join(",")}${e.gitBranch ? ` @${e.gitBranch}` : ""}]`);
  }
  for (const ambiente of ["production", "preview"]) {
    const coberto = existentes.some((e) => !e.gitBranch && alvos(e).includes(ambiente));
    if (coberto) continue;
    await api("POST", `/v10/projects/${projeto.id}/env?upsert=true`, {
      key: nome,
      value: valor,
      type: "encrypted",
      target: [ambiente],
    });
    console.log(`criada: ${nome} [${ambiente}]`);
  }
}
for (const nome of APAGAR) {
  for (const e of envs.filter((x) => x.key === nome)) {
    await api("DELETE", `/v9/projects/${projeto.id}/env/${e.id}`);
    console.log(`apagada: ${nome} [${alvos(e).join(",")}]`);
  }
}
const depois = await listarVariaveis("Variáveis depois (sem valores)");
const frota = ["IKCOUS_FROTA_URL", "IKCOUS_FROTA_APIKEY", "IKCOUS_FROTA_CHAVE"].map((n) =>
  depois.some((e) => e.key === n && alvos(e).includes("production")),
);
console.log(
  frota.every(Boolean)
    ? "Caderneta da frota: as três variáveis existem em produção."
    : "::warning::Caderneta da frota incompleta em produção (falta IKCOUS_FROTA_CHAVE?) — o porteiro usa só o banco do próprio projeto.",
);

// 3. Redeploy do último deploy de produção vindo do Git.
const { deployments = [] } = await api(
  "GET",
  `/v6/deployments?projectId=${projeto.id}&target=production&limit=8`,
);
console.log("\n== Últimos deploys de produção ==");
console.table(
  deployments.map((d) => ({
    id: d.uid,
    estado: d.state,
    criado: new Date(d.created).toISOString(),
    branch: d.meta?.githubCommitRef ?? "",
    commit: (d.meta?.githubCommitSha ?? "").slice(0, 8),
  })),
);
// As releases 1.5.x subiram pela CLI, e o código enviado por ela não passa mais no
// build contra o projeto novo. Por isso o deploy nasce do GitHub, no commit que
// estava no ar antes do incidente (DEPLOY_SHA, da branch DEPLOY_REF).
const sha = (process.env.DEPLOY_SHA ?? "").trim();
const ref = (process.env.DEPLOY_REF ?? "").trim();
if (!sha || !ref) parar("Faltou DEPLOY_SHA/DEPLOY_REF no workflow.");
if (projeto.link?.type !== "github" || !projeto.link?.repoId) {
  parar("O projeto da Vercel não está ligado a um repositório do GitHub.");
}
console.log(`Deploy de produção a partir do GitHub: ${ref} @ ${sha.slice(0, 8)}`);
const novo = await api("POST", "/v13/deployments?forceNew=1", {
  name: projeto.name,
  project: projeto.id,
  target: "production",
  gitSource: { type: "github", repoId: projeto.link.repoId, ref, sha },
});
console.log(`Novo deploy: ${novo.id} https://${novo.url}`);

let estado = novo.readyState;
const limite = Date.now() + 30 * 60 * 1000;
while (!["READY", "ERROR", "CANCELED"].includes(estado)) {
  if (Date.now() > limite) parar("O deploy passou de 30 minutos sem terminar.");
  await esperar(15000);
  const atual = await api("GET", `/v13/deployments/${novo.id}`);
  if (atual.readyState !== estado) console.log(`estado: ${atual.readyState}`);
  estado = atual.readyState;
}

if (estado !== "READY") {
  const eventos = (await api("GET", `/v3/deployments/${novo.id}/events?builds=1&limit=-1`)) ?? [];
  const linhas = eventos.map((e) => e.payload?.text ?? e.text ?? "").filter(Boolean);
  console.log("\n== Fim do log do build ==");
  console.log(linhas.slice(-80).join("\n"));
  parar(`O deploy terminou em ${estado}.`);
}
console.log("Deploy pronto.");

// 4. Testa os domínios de produção.
await esperar(10000);
const { domains = [] } = (await api("GET", `/v9/projects/${projeto.id}/domains`)) ?? {};
const nomes = domains.filter((d) => !d.redirect && !d.gitBranch).map((d) => d.name);
console.log("\n== Domínios de produção ==");
let falhas = 0;
let naoCadastrados = 0;
for (const nome of nomes) {
  try {
    const resposta = await fetch(`https://${nome}/`, { redirect: "manual" });
    const cabecalhos = [...resposta.headers.entries()]
      .filter(([k]) => k.startsWith("x-ikcous"))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    // Domínio fora da caderneta da frota fica fechado de propósito (porteiro).
    const foraDaFrota =
      resposta.headers.get("x-ikcous-caderneta") === "miss" &&
      resposta.headers.get("x-ikcous-porteiro") === "sem-loja";
    if (foraDaFrota) naoCadastrados++;
    else if (resposta.status >= 500) falhas++;
    console.log(`${resposta.status} ${nome} ${cabecalhos}${foraDaFrota ? " (fora da frota)" : ""}`);
  } catch (erro) {
    falhas++;
    console.log(`ERRO ${nome}: ${erro.message}`);
  }
}
for (const nome of ["ickous-marketplace.vercel.app", "savycollection.vercel.app"]) {
  try {
    const resposta = await fetch(`https://${nome}/version.json`, { cache: "no-store" });
    console.log(`version.json de ${nome}: ${(await resposta.text()).slice(0, 400)}`);
  } catch (erro) {
    console.log(`version.json de ${nome}: ${erro.message}`);
  }
}
if (naoCadastrados > 0) console.log(`${naoCadastrados} domínio(s) fora da frota, fechados de propósito.`);
if (falhas > 0) parar(`${falhas} domínio(s) da frota ainda respondendo erro.`);
console.log("Todos os domínios da frota responderam sem erro de servidor.");
// release 1.5.10 (28/09/2026): deploy do merge do PR #670

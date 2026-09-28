// Temporário (incidente 28/09/2026): mostra as últimas chamadas às edge
// functions do projeto novo (status HTTP) e as mensagens que as próprias
// functions escreveram no log (o código nunca loga segredo), mais o tipo da
// chave que assina o login — para diagnosticar "Salvar chaves" do Mercado Pago.

const REF = "dekxabvqdsuukijblazl";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
if (token === "") {
  console.error("::error::Falta o segredo SUPABASE_ACCESS_TOKEN no GitHub.");
  process.exit(1);
}

async function api(caminho) {
  for (let tentativa = 1; ; tentativa++) {
    const resposta = await fetch(`https://api.supabase.com/v1${caminho}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const texto = await resposta.text();
    if (resposta.ok) return texto === "" ? null : JSON.parse(texto);
    if (resposta.status >= 500 && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 3000 * tentativa));
      continue;
    }
    return { erro: `HTTP ${resposta.status}: ${texto.slice(0, 200)}` };
  }
}

const fim = new Date();
const inicio = new Date(fim.getTime() - 60 * 60 * 1000);
async function logs(titulo, sql) {
  const q = new URLSearchParams({
    sql,
    iso_timestamp_start: inicio.toISOString(),
    iso_timestamp_end: fim.toISOString(),
  });
  const r = await api(`/projects/${REF}/analytics/endpoints/logs.all?${q}`);
  console.log(`\n== ${titulo} ==`);
  if (r?.erro || r?.error) return console.log(JSON.stringify(r.erro ?? r.error).slice(0, 400));
  const linhas = r?.result ?? [];
  if (linhas.length === 0) return console.log("(nada na última hora)");
  for (const l of linhas) {
    const quando = new Date(Number(l.timestamp) / 1000).toISOString().slice(11, 19);
    console.log(`${quando}  ${String(l.event_message ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

await logs(
  "Chamadas às functions (última hora, mais recentes primeiro)",
  "select timestamp, event_message from function_edge_logs order by timestamp desc limit 40",
);
await logs(
  "Mensagens das functions (última hora)",
  "select timestamp, event_message from function_logs order by timestamp desc limit 60",
);

const chaves = await api(`/projects/${REF}/config/auth/signing-keys`);
console.log("\n== Chaves que assinam o login ==");
const lista = Array.isArray(chaves) ? chaves : (chaves?.keys ?? chaves);
console.log(
  JSON.stringify(
    Array.isArray(lista) ? lista.map((k) => ({ algoritmo: k.algorithm, status: k.status })) : lista,
  ).slice(0, 400),
);

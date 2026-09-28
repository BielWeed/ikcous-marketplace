// Temporário (incidente 28/09/2026): confere, SEM imprimir valor nenhum, se os
// segredos que o dono cadastrou no painel existem e se a VAPID_PUBLIC_KEY é a
// mesma chave pública que a loja entrega ao navegador (store_config). A API do
// Supabase devolve só o SHA-256 de cada segredo; a comparação é por ele.

const REF = "dekxabvqdsuukijblazl";
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
if (token === "") {
  console.error("::error::Falta o segredo SUPABASE_ACCESS_TOKEN no GitHub.");
  process.exit(1);
}

async function api(metodo, caminho, corpo) {
  for (let tentativa = 1; ; tentativa++) {
    const resposta = await fetch(`https://api.supabase.com/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    if (resposta.ok) return texto === "" ? null : JSON.parse(texto);
    if (resposta.status >= 500 && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 3000 * tentativa));
      continue;
    }
    throw new Error(`${metodo} ${caminho} → HTTP ${resposta.status}: ${texto.slice(0, 200)}`);
  }
}

const segredos = await api("GET", `/projects/${REF}/secrets`);
const porNome = new Map(segredos.map((s) => [s.name, s]));
const esperados = ["SMTP_USER", "SMTP_PASSWORD", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
console.log("\n== Segredos cadastrados pelo dono ==");
console.table(
  esperados.map((nome) => ({
    nome,
    situacao: porNome.has(nome) ? "ok" : "FALTA",
    atualizado: porNome.get(nome)?.updated_at ?? "",
  })),
);

const [loja] = await api("POST", `/projects/${REF}/database/query`, {
  query: `SELECT vapid_public_key IS NOT NULL AS tem,
                 length(trim(vapid_public_key)) AS tamanho,
                 encode(sha256(convert_to(trim(vapid_public_key), 'UTF8')), 'hex') AS digest
            FROM public.store_config LIMIT 1`,
});
const digestSegredo = String(porNome.get("VAPID_PUBLIC_KEY")?.value ?? "").toLowerCase();
console.log(`\nChave pública VAPID na loja (store_config): ${loja?.tem ? `sim, ${loja.tamanho} caracteres` : "NÃO"}`);
if (!porNome.has("VAPID_PUBLIC_KEY")) {
  console.log("VAPID_PUBLIC_KEY: não cadastrada.");
} else if (!/^[0-9a-f]{64}$/.test(digestSegredo)) {
  console.log("VAPID_PUBLIC_KEY: a API não devolveu o SHA-256; não dá para comparar daqui.");
} else if (loja?.tem && digestSegredo === loja.digest) {
  console.log("VAPID_PUBLIC_KEY: BATE com a chave pública da loja. Notificações com o mesmo par de antes.");
} else {
  console.log("::warning::VAPID_PUBLIC_KEY: NÃO bate com a chave pública da loja (par diferente, ou espaço/aspas a mais ao colar).");
}

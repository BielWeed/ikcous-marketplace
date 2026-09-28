// Temporário (28/09/2026): cria o projeto Supabase de cada loja nova de cliente
// (pedido do dono: "te dou só o token, o resto você faz"). Idempotente: se o
// projeto com o mesmo nome já existe na conta, só espera ficar saudável.
// Imprime apenas ref, status e a chave PUBLICÁVEL (que vai no front de
// qualquer forma). A senha do banco é aleatória, nunca impressa; o dono pode
// trocá-la no painel quando quiser.
import crypto from "node:crypto";
import fs from "node:fs";

const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));

async function api(token, metodo, caminho, corpo) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(`https://api.supabase.com/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    if (r.ok) return texto === "" ? null : JSON.parse(texto);
    if (r.status >= 500 && metodo === "GET" && tentativa < 4) {
      await new Promise((res) => setTimeout(res, 3000 * tentativa));
      continue;
    }
    throw new Error(`${metodo} ${caminho} → HTTP ${r.status}: ${texto.slice(0, 400)}`);
  }
}

let falhou = false;
for (const loja of lojas) {
  console.log(`\n==================== ${loja.projeto} (@${loja.perfil}) ====================`);
  const token = (process.env[loja.conta] ?? "").trim();
  if (token === "") {
    console.log(`::warning::Falta o segredo ${loja.conta}; pulando.`);
    continue;
  }
  try {
    const projetos = await api(token, "GET", "/projects");
    let projeto = projetos.find((p) => p.name === loja.projeto);
    if (projeto) {
      console.log(`Já existe: ${projeto.id} (${projeto.status})`);
    } else {
      const orgs = await api(token, "GET", "/organizations");
      const org = loja.organizacao ?? orgs[0]?.id;
      console.log(`Criando na organização ${org} (${orgs.find((o) => o.id === org)?.name ?? "?"}), região sa-east-1…`);
      projeto = await api(token, "POST", "/projects", {
        name: loja.projeto,
        organization_id: org,
        region: "sa-east-1",
        db_pass: crypto.randomBytes(24).toString("base64url"),
      });
      console.log(`Criado: ${projeto.id}`);
    }
    for (let i = 0; i < 60; i++) {
      const p = await api(token, "GET", `/projects/${projeto.id}`);
      if (p.status === "ACTIVE_HEALTHY") break;
      if (i % 6 === 0) console.log(`  status ${p.status}…`);
      await new Promise((res) => setTimeout(res, 10000));
    }
    const saude = await api(token, "GET", `/projects/${projeto.id}/health?services=db,auth,rest,storage`);
    console.log("Saúde:", saude.map((s) => `${s.name}:${s.status}`).join(" "));
    const chaves = await api(token, "GET", `/projects/${projeto.id}/api-keys?reveal=false`);
    const publicavel = chaves.find((c) => c.type === "publishable")?.api_key;
    console.log(`REF=${projeto.id}`);
    console.log(`URL=https://${projeto.id}.supabase.co`);
    console.log(`PUBLICAVEL=${publicavel ?? "(sem chave publicável)"}`);
  } catch (erro) {
    falhou = true;
    console.log(`::error::${loja.projeto}: ${erro.message}`);
  }
}
if (falhou) process.exit(1);

// Temporário (28/09/2026): liga cada loja nova de cliente ao site, autorizado
// pelo dono no chat ("pode ligar as lojas"). Para cada loja de lojas-novas.json:
//   1. escolhe o endereço <slug>.vercel.app (o primeiro livre) e o põe no
//      projeto da Vercel (só ACRESCENTA domínio; os existentes não mudam);
//   2. grava nome e domínio público na store_config da loja nova;
//   3. ajusta o Auth da loja nova (site_url e redirects) para o endereço;
//   4. cria/atualiza o admin (e-mail da loja, senha do segredo
//      LOJAS_ADMIN_SENHA, app_metadata.role = admin);
//   5. ACRESCENTA a loja na caderneta da frota (frota_lojas) do banco
//      principal — só as linhas das lojas novas (ids cliente-02..04).
// Nada secreto é impresso: chaves de serviço ficam em memória e mascaradas.
import fs from "node:fs";

const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const IDS_PERMITIDOS = new Set(["cliente-02", "cliente-03", "cliente-04"]);
const PRINCIPAL = "dekxabvqdsuukijblazl";
const VERCEL_PROJETO = "ickous-marketplace";
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));
const senhaAdmin = (process.env.LOJAS_ADMIN_SENHA ?? "").trim();
const vercel = (process.env.VERCEL_TOKEN ?? "").trim();
const tokenPrincipal = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();

async function chamar(url, { metodo = "GET", headers = {}, corpo } = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...headers },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto === "" ? null : JSON.parse(texto);
  } catch {}
  return { ok: r.ok, status: r.status, json, texto };
}
const supa = (token, metodo, caminho, corpo) =>
  chamar(`https://api.supabase.com/v1${caminho}`, { metodo, headers: { Authorization: `Bearer ${token}` }, corpo });
async function sqlEm(token, ref, query) {
  const r = await supa(token, "POST", `/projects/${ref}/database/query`, { query });
  if (!r.ok) throw new Error(`SQL em ${ref} → HTTP ${r.status}: ${r.texto.slice(0, 500)}`);
  return r.json;
}
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);

let escopo = "";
if (vercel) {
  const times = (await chamar("https://api.vercel.com/v2/teams", { headers: { Authorization: `Bearer ${vercel}` } })).json?.teams ?? [];
  for (const t of [...times.map((x) => x.id), ""]) {
    const r = await chamar(`https://api.vercel.com/v9/projects/${VERCEL_PROJETO}${t ? `?teamId=${t}` : ""}`, {
      headers: { Authorization: `Bearer ${vercel}` },
    });
    if (r.ok) {
      escopo = t;
      break;
    }
  }
}
const vq = (extra = "") => {
  const partes = [escopo ? `teamId=${escopo}` : "", extra].filter(Boolean);
  return partes.length ? `?${partes.join("&")}` : "";
};
const dominiosNaVercel = vercel
  ? ((await chamar(`https://api.vercel.com/v9/projects/${VERCEL_PROJETO}/domains${vq("limit=100")}`, {
      headers: { Authorization: `Bearer ${vercel}` },
    })).json?.domains ?? []).map((d) => d.name)
  : [];

let falhou = false;
for (const loja of lojas) {
  console.log(`\n==================== ${loja.nome} (${loja.projeto}) ====================`);
  const token = (process.env[loja.conta] ?? "").trim();
  if (!token) {
    console.log("::warning::sem token; pulando.");
    continue;
  }
  try {
    if (!IDS_PERMITIDOS.has(loja.frota_id)) throw new Error(`frota_id ${loja.frota_id} fora dos permitidos`);
    const projeto = (await supa(token, "GET", "/projects")).json.find((p) => p.name === loja.projeto);
    if (!projeto) throw new Error("projeto não existe");
    if (PROIBIDOS.has(projeto.id)) throw new Error(`RECUSADO: ${projeto.id} é banco em produção`);
    const ref = projeto.id;
    const ledger = await sqlEm(token, ref, "SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations").catch(() => [{ n: 0 }]);
    if ((ledger[0]?.n ?? 0) < 100) throw new Error(`esquema incompleto (${ledger[0]?.n ?? 0} no ledger); rode o esquema antes`);

    // 1. Endereço na Vercel.
    const candidatos = [`${loja.slug}.vercel.app`, `${loja.slug}-ikcous.vercel.app`, `loja-${loja.slug}.vercel.app`];
    let dominio = candidatos.find((d) => dominiosNaVercel.includes(d)) ?? null;
    if (!dominio && vercel) {
      for (const c of candidatos) {
        const r = await chamar(`https://api.vercel.com/v10/projects/${VERCEL_PROJETO}/domains${vq()}`, {
          metodo: "POST",
          headers: { Authorization: `Bearer ${vercel}` },
          corpo: { name: c },
        });
        if (r.ok) {
          dominio = c;
          console.log(`Endereço criado na Vercel: ${c}`);
          break;
        }
        console.log(`  ${c} indisponível (HTTP ${r.status}: ${r.json?.error?.code ?? r.texto.slice(0, 120)})`);
      }
    }
    if (!dominio) throw new Error("nenhum endereço .vercel.app disponível");
    console.log(`Endereço: https://${dominio}`);

    // 2. Nome e domínio público na store_config (linha única id = 1).
    await sqlEm(token, ref, `INSERT INTO public.store_config (id, store_name, dominio_publico, share_text)
      VALUES (1, ${lit(loja.nome)}, ${lit(dominio)}, ${lit(`Confira os produtos da ${loja.nome}!`)})
      ON CONFLICT (id) DO UPDATE SET store_name = EXCLUDED.store_name,
        dominio_publico = EXCLUDED.dominio_publico, share_text = EXCLUDED.share_text, updated_at = now()`);
    console.log("store_config:", JSON.stringify(await sqlEm(token, ref, "SELECT id, store_name, dominio_publico FROM public.store_config")));

    // 3. Auth da loja nova.
    const auth = await supa(token, "PATCH", `/projects/${ref}/config/auth`, {
      site_url: `https://${dominio}`,
      uri_allow_list: `https://${dominio}/**`,
    });
    console.log(`Auth site_url: HTTP ${auth.status}${auth.ok ? "" : ` ${auth.texto.slice(0, 200)}`}`);

    // 4. Admin.
    if (senhaAdmin) {
      const chaves = (await supa(token, "GET", `/projects/${ref}/api-keys?reveal=true`)).json ?? [];
      const servico = chaves.find((c) => c.name === "service_role")?.api_key ?? chaves.find((c) => c.type === "secret")?.api_key;
      if (!servico) throw new Error("sem chave de serviço");
      console.log(`::add-mask::${servico}`);
      const base = `https://${ref}.supabase.co/auth/v1/admin/users`;
      const h = { apikey: servico, ...(servico.startsWith("eyJ") ? { Authorization: `Bearer ${servico}` } : {}) };
      const corpo = {
        email: loja.admin_email,
        // Pedido do dono (28/09): senha de cada loja = nome da loja (minúsculo, sem
        // espaço + a senha do segredo LOJAS_ADMIN_SENHA.
        password: `${loja.prefixo_senha ?? ""}${senhaAdmin}`,
        email_confirm: true,
        app_metadata: { role: "admin" },
        user_metadata: { name: loja.nome, full_name: loja.nome },
      };
      let r = await chamar(base, { metodo: "POST", headers: h, corpo });
      if (!r.ok && [400, 409, 422].includes(r.status)) {
        const lista = await chamar(`${base}?per_page=200`, { headers: h });
        const existente = lista.json?.users?.find((u) => u.email === loja.admin_email);
        if (existente) r = await chamar(`${base}/${existente.id}`, { metodo: "PUT", headers: h, corpo });
      }
      console.log(`Admin ${loja.admin_email}: HTTP ${r.status}${r.ok ? "" : ` ${r.texto.slice(0, 200)}`}`);
      if (!r.ok) throw new Error("admin não criado");
    } else {
      console.log("::warning::sem LOJAS_ADMIN_SENHA; admin fica para a próxima rodada.");
    }

    // 5. Caderneta da frota no banco principal (só as linhas novas).
    const publicavel = ((await supa(token, "GET", `/projects/${ref}/api-keys?reveal=false`)).json ?? []).find(
      (c) => c.type === "publishable",
    )?.api_key;
    if (!publicavel) throw new Error("sem chave publicável");
    await sqlEm(tokenPrincipal, PRINCIPAL, `INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa)
      VALUES (${lit(loja.frota_id)}, ${lit(loja.nome)}, ${lit(dominio)}, ${lit(ref)}, ${lit(`https://${ref}.supabase.co`)}, ${lit(publicavel)}, true)
      ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, dominio_publico = EXCLUDED.dominio_publico,
        project_ref = EXCLUDED.project_ref, supabase_url = EXCLUDED.supabase_url,
        publishable_key = EXCLUDED.publishable_key, ativa = true, updated_at = now()
      WHERE frota_lojas.id IN ('cliente-02', 'cliente-03', 'cliente-04')`);
    console.log(`Frota: ${loja.frota_id} → ${dominio} → ${ref}`);
  } catch (erro) {
    falhou = true;
    console.log(`::error::${loja.nome}: ${erro.message}`);
  }
}
console.log("\nFrota agora:");
console.table(await sqlEm(tokenPrincipal, PRINCIPAL, "SELECT id, nome, dominio_publico, project_ref, ativa FROM public.frota_lojas ORDER BY id"));
if (falhou) process.exit(1);

// Temporário (28/09/2026): importa o catálogo curado de cada loja nova
// (scripts/incidente/catalogos/<perfil>.json, montado a partir do Instagram
// público do cliente). Baixa cada foto, converte para JPEG ≤1200px, sobe no
// bucket público `products` e grava produtos e categorias. Idempotente: os
// produtos marcados com a tag `importado-instagram` são trocados a cada rodada
// (loja nova, sem pedidos). Também grava cidade/UF/WhatsApp/descrição da loja.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

const sharp = createRequire("/tmp/ferr/")("sharp");
const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const TAG = "importado-instagram";
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));
const lit = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "NULL" : Number(v).toFixed(2));
const slug = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function chamar(url, { metodo = "GET", headers = {}, corpo, bruto } = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: bruto ? headers : { "Content-Type": "application/json", ...headers },
    body: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto === "" ? null : JSON.parse(texto);
  } catch {}
  return { ok: r.ok, status: r.status, json, texto };
}

let falhou = false;
for (const loja of lojas) {
  const arquivo = `scripts/incidente/catalogos/${loja.perfil}.json`;
  if (!fs.existsSync(arquivo)) continue;
  const cat = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  console.log(`\n==================== ${loja.nome}: ${cat.produtos.length} produtos ====================`);
  const token = (process.env[loja.conta] ?? "").trim();
  const api = (metodo, caminho, corpo) =>
    chamar(`https://api.supabase.com/v1${caminho}`, { metodo, headers: { Authorization: `Bearer ${token}` }, corpo });
  const projeto = (await api("GET", "/projects")).json.find((p) => p.name === loja.projeto);
  if (!projeto || PROIBIDOS.has(projeto.id)) throw new Error(`projeto inválido para ${loja.nome}`);
  const ref = projeto.id;
  const sql = async (query) => {
    const r = await api("POST", `/projects/${ref}/database/query`, { query });
    if (!r.ok) throw new Error(`SQL → HTTP ${r.status}: ${r.texto.slice(0, 500)}`);
    return r.json;
  };
  const chaves = (await api("GET", `/projects/${ref}/api-keys?reveal=true`)).json ?? [];
  const servico = chaves.find((c) => c.name === "service_role")?.api_key ?? chaves.find((c) => c.type === "secret")?.api_key;
  console.log(`::add-mask::${servico}`);
  const hServ = { apikey: servico, ...(servico.startsWith("eyJ") ? { Authorization: `Bearer ${servico}` } : {}) };

  // Dados da loja (só o que veio do perfil público; nada inventado).
  const sets = [];
  if (cat.loja?.cidade) sets.push(`store_city = ${lit(cat.loja.cidade)}`);
  if (cat.loja?.uf) sets.push(`store_state = ${lit(cat.loja.uf)}`);
  if (cat.loja?.whatsapp) sets.push(`whatsapp_number = ${lit(cat.loja.whatsapp)}`);
  if (cat.loja?.descricao) sets.push(`store_description = ${lit(cat.loja.descricao)}`);
  if (sets.length) await sql(`UPDATE public.store_config SET ${sets.join(", ")}, updated_at = now() WHERE id = 1`);

  // Categorias.
  const categorias = [...new Set(cat.produtos.map((p) => p.categoria).filter(Boolean))];
  for (const c of categorias) {
    await sql(`INSERT INTO public.categorias (nome, slug) VALUES (${lit(c)}, ${lit(slug(c))}) ON CONFLICT DO NOTHING`);
  }

  // Troca os importados da rodada anterior.
  const antes = await sql(`SELECT count(*)::int AS n FROM public.produtos WHERE ${lit(TAG)} = ANY(tags)`);
  await sql(`DELETE FROM public.produtos WHERE ${lit(TAG)} = ANY(tags)`);
  console.log(`Removidos da rodada anterior: ${antes[0].n}`);

  let ok = 0;
  for (const [i, p] of cat.produtos.entries()) {
    const urls = [];
    for (const fonte of p.fotos.slice(0, 6)) {
      try {
        const r = await fetch(fonte, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) {
          console.log(`  foto HTTP ${r.status}`);
          continue;
        }
        const jpg = await sharp(Buffer.from(await r.arrayBuffer()))
          .rotate()
          .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        const nome = `${crypto.randomUUID()}.jpg`;
        const up = await chamar(`https://${ref}.supabase.co/storage/v1/object/products/${nome}`, {
          metodo: "POST",
          headers: { ...hServ, "Content-Type": "image/jpeg", "x-upsert": "true" },
          bruto: jpg,
        });
        if (!up.ok) {
          console.log(`  upload HTTP ${up.status}: ${up.texto.slice(0, 120)}`);
          continue;
        }
        urls.push(`https://${ref}.supabase.co/storage/v1/object/public/products/${nome}`);
      } catch (erro) {
        console.log(`  foto falhou: ${erro.message}`);
      }
    }
    if (urls.length === 0) {
      console.log(`- ${p.nome}: sem foto, pulado`);
      continue;
    }
    // data_cadastro escalonada para a vitrine manter a ordem do Instagram
    // (mais recente primeiro).
    await sql(`INSERT INTO public.produtos (nome, descricao, categoria, preco_venda, preco_original, custo, estoque,
        ativo, tags, imagem_url, imagem_urls, data_cadastro)
      VALUES (${lit(p.nome)}, ${lit(p.descricao)}, ${lit(p.categoria)}, ${num(p.preco)}, ${num(p.preco_original)}, NULL,
        ${Number.isInteger(p.estoque) ? p.estoque : 10}, true, ARRAY[${lit(TAG)}], ${lit(urls[0])},
        ARRAY[${urls.map(lit).join(",")}]::text[], now() - interval '${i} minutes')`);
    ok++;
    console.log(`+ ${p.nome} · R$ ${num(p.preco)} · ${urls.length} foto(s)`);
  }
  console.log(`${loja.nome}: ${ok}/${cat.produtos.length} produtos importados.`);
  if (ok === 0) falhou = true;
  console.log(JSON.stringify(await sql(`SELECT (SELECT count(*)::int FROM public.produtos WHERE ativo) AS ativos,
      (SELECT count(*)::int FROM public.categorias) AS categorias,
      (SELECT count(*)::int FROM public.vw_produtos_public) AS na_vitrine`)));
}
if (falhou) process.exit(1);

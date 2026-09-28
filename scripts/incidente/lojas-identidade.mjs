// Temporário (28/09/2026): identidade de cada loja nova (o porteiro só abre a
// loja com nome, 3 cores #RRGGBB e branding_assets completo). Gera os PNG
// exigidos (192, 180, 512, maskable 512, og 1200x630) a partir da logo do
// perfil (loja.logo_fonte, quando houver) ou, até ela chegar, das iniciais da
// loja; sobe no bucket público `branding` em v1/<sha256>/<nome> e grava
// cores, logo_url e branding_assets na store_config. Nada secreto é impresso.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

const sharp = createRequire("/tmp/ferr/")("sharp");
const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));

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
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
const escaparXml = (s) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n) => n.toString(16).padStart(2, "0");

function iniciais(nome) {
  const palavras = nome.split(/\s+/).filter((p) => !/^(da|de|do|dos|das|e)$/i.test(p));
  return (palavras[0]?.[0] ?? "L").toUpperCase() + (palavras.at(-1)?.[0] ?? "").toUpperCase();
}

async function corDominante(buffer) {
  const { dominant } = await sharp(buffer).stats();
  const { r, g, b } = dominant;
  const luz = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luz > 0.88 || luz < 0.06) return null; // branco ou preto puro: fica a neutra
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

for (const loja of lojas) {
  console.log(`\n==================== ${loja.nome} ====================`);
  const token = (process.env[loja.conta] ?? "").trim();
  if (!token) continue;
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

  // Fonte da logo: a foto do perfil (quando já baixada) ou as iniciais.
  let logo = null;
  if (loja.logo_fonte) {
    // O CDN do Instagram recusa pedido sem cara de navegador (403).
    const r = await fetch(loja.logo_fonte, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
        Referer: "https://www.instagram.com/",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (r.ok) logo = Buffer.from(await r.arrayBuffer());
    console.log(`Logo do perfil: HTTP ${r.status} (${logo?.length ?? 0} bytes)`);
  }
  if (loja.logo_fonte && !logo) {
    console.log("::warning::logo do perfil não baixou; identidade atual mantida.");
    continue;
  }
  const primaria = loja.cor ?? (logo ? await corDominante(logo) : null) ?? "#27272A";
  const secundaria = loja.cor2 ?? "#18181B";
  const acento = loja.acento ?? "#F59E0B";
  console.log(`Cores: ${primaria} / ${secundaria} / ${acento} · logo: ${logo ? "perfil" : "iniciais"}`);

  const svgIniciais = (lado, fundo) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}">
      <rect width="100%" height="100%" fill="${fundo}"/>
      <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="DejaVu Sans, sans-serif"
        font-weight="700" font-size="${Math.round(lado * 0.38)}" fill="#FFFFFF">${escaparXml(iniciais(loja.nome))}</text></svg>`);
  const quadrado = async (lado, margem) => {
    if (!logo) return sharp(svgIniciais(lado, primaria)).png().toBuffer();
    const miolo = Math.round(lado * (1 - 2 * margem));
    const img = await sharp(logo).resize(miolo, miolo, { fit: "contain", background: "#FFFFFF" }).png().toBuffer();
    return sharp({ create: { width: lado, height: lado, channels: 4, background: margem > 0 ? primaria : "#FFFFFF" } })
      .composite([{ input: img, gravity: "center" }])
      .png()
      .toBuffer();
  };
  const og = async () => {
    const marca = logo
      ? await sharp(logo).resize(360, 360, { fit: "contain", background: "#FFFFFF" }).png().toBuffer()
      : await sharp(svgIniciais(360, secundaria)).png().toBuffer();
    const texto = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="200">
      <text x="0" y="120" font-family="DejaVu Sans, sans-serif" font-weight="700" font-size="72" fill="#FFFFFF">${escaparXml(loja.nome)}</text></svg>`);
    return sharp({ create: { width: 1200, height: 630, channels: 4, background: primaria } })
      .composite([
        { input: marca, left: 90, top: 135 },
        { input: texto, left: 500, top: 215 },
      ])
      .png()
      .toBuffer();
  };

  const arquivos = {
    logo192: [await quadrado(192, 0), 192, 192],
    apple180: [await quadrado(180, 0.12), 180, 180],
    icon512: [await quadrado(512, 0), 512, 512],
    maskable512: [await quadrado(512, 0.2), 512, 512],
    og: [await og(), 1200, 630],
  };
  const desc = {};
  for (const [nome, [buf, w, h]] of Object.entries(arquivos)) {
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const caminho = `v1/${sha}/${nome}.png`;
    const up = await chamar(`https://${ref}.supabase.co/storage/v1/object/branding/${caminho}`, {
      metodo: "POST",
      headers: { ...hServ, "Content-Type": "image/png", "x-upsert": "true" },
      bruto: buf,
    });
    if (!up.ok) throw new Error(`upload ${nome} → HTTP ${up.status}: ${up.texto.slice(0, 200)}`);
    desc[nome] = { path: caminho, sha256: sha, media_type: "image/png", bytes: buf.length, width: w, height: h };
  }
  const assets = {
    version: 1,
    originals: [desc.logo192],
    header: desc.logo192,
    loader: desc.logo192,
    favicon: desc.logo192,
    apple_touch: desc.apple180,
    icon_192: desc.logo192,
    icon_512: desc.icon512,
    maskable_512: desc.maskable512,
    og: desc.og,
  };
  const logoUrl = `https://${ref}.supabase.co/storage/v1/object/public/branding/${desc.logo192.path}`;
  await sql(`UPDATE public.store_config SET
      primary_color = ${lit(primaria)}, secondary_color = ${lit(secundaria)}, accent_color = ${lit(acento)},
      logo_url = ${lit(logoUrl)}, branding_assets = ${lit(JSON.stringify(assets))}::jsonb,
      formas_pagamento_entrega = ARRAY['pix','cash']::text[], pagamento_online = false, updated_at = now()
    WHERE id = 1`);
  console.log("store_config:", JSON.stringify(await sql(`SELECT store_name, primary_color, dominio_publico,
      branding_assets IS NOT NULL AS identidade, formas_pagamento_entrega, pagamento_online FROM public.store_config`)));
}

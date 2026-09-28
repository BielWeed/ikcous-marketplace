// Temporário (28/09/2026): logos das lojas novas redesenhadas em SVG a partir
// dos prints da foto de perfil do Instagram (pedido do dono). Texto vira
// caminho (opentype.js + fontes livres do Google Fonts), então o SVG não
// depende de fonte instalada. Gera: logo do topo (fundo transparente),
// círculo da marca (ícones, favicon, og), sobe no bucket `branding` e grava
// cores + branding_assets na store_config. Prévias vão para /tmp/logos.
// A cor secundária (cor2) é a de DESTAQUE: o aviso de notificações pinta as
// palavras realçadas com ela sobre fundo quase preto, então tem de ser clara
// (achado do dono no Space, 28/09: secundária escura sumia no aviso).
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

const req = createRequire("/tmp/ferr/");
const sharp = req("sharp");
const opentype = req("opentype.js");
const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));
fs.mkdirSync("/tmp/logos", { recursive: true });

const FONTES = {
  anton: "ofl/anton/Anton-Regular.ttf",
  marker: "apache/permanentmarker/PermanentMarker-Regular.ttf",
  black: "ofl/poppins/Poppins-Black.ttf",
  semi: "ofl/poppins/Poppins-SemiBold.ttf",
  medium: "ofl/poppins/Poppins-Medium.ttf",
  josefin: "ofl/josefinsans/JosefinSans[wght].ttf",
};
const fonte = {};
for (const [k, caminho] of Object.entries(FONTES)) {
  const r = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${caminho}`);
  if (!r.ok) throw new Error(`fonte ${k} → HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  fonte[k] = opentype.parse(ab);
}

// Texto → caminho, com espaçamento extra (tracking, em unidades do viewBox).
function texto(f, str, { tam, x = 0, y = 0, tracking = 0, largura, centro }) {
  let t = tam;
  const medir = (tt) => [...str].reduce((s, c) => s + f.charToGlyph(c).advanceWidth * (tt / f.unitsPerEm) + tracking, -tracking);
  if (largura) t = tam * (largura / medir(tam));
  const w = medir(t);
  let cx = centro !== undefined ? centro - w / 2 : x;
  const partes = [];
  for (const c of str) {
    const g = f.charToGlyph(c);
    partes.push(g.getPath(cx, y, t).toPathData(2));
    cx += g.advanceWidth * (t / f.unitsPerEm) + tracking;
  }
  return { d: partes.join(" "), w, t };
}
const caixa = (d) => {
  const nums = [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

// ---------- Almeida Store: losango duplo, ALMEIDA condensada, STORE pichada.
function almeida() {
  const nome = texto(fonte.anton, "ALMEIDA", { tam: 200, centro: 500, y: 575, largura: 660, tracking: 4 });
  const store = texto(fonte.marker, "STORE", { tam: 100, centro: 560, y: 655, largura: 290, tracking: 6 });
  const losango = `<path d="M500 175 L825 500 L500 825 L175 500 Z" fill="none" stroke="#FFFFFF" stroke-width="7"/>
    <path d="M500 215 L785 500 L500 785 L215 500 Z" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-dasharray="1 13" stroke-linecap="round"/>`;
  const marca = (cor, contorno) => `<path d="${nome.d}" fill="${cor}"/>
    <g transform="rotate(-5 560 630)"><path d="${store.d}" fill="${cor}" stroke="${contorno}" stroke-width="14" stroke-linejoin="round" paint-order="stroke"/></g>`;
  const circulo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="500" fill="#0B0B0B"/>${losango}${marca("#FFFFFF", "#0B0B0B")}</svg>`;
  // Topo: a logo como ela é (fundo preto, losango e letras brancas) num selo
  // retangular — o topo do site é claro e a marca da Almeida é o preto.
  const [x0, , x1] = caixa(`${nome.d} ${store.d}`);
  const bx = x0 - 50;
  const bw = x1 - x0 + 100;
  const topo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} 330 ${bw} 380">
    <defs><clipPath id="selo"><rect x="${bx}" y="330" width="${bw}" height="380" rx="46"/></clipPath></defs>
    <g clip-path="url(#selo)"><rect x="${bx}" y="330" width="${bw}" height="380" fill="#0B0B0B"/>${losango}${marca("#FFFFFF", "#0B0B0B")}</g></svg>`;
  return { circulo, topo, fundo: "#0B0B0B" };
}

// Almeida vetorizada da arte original (print de perto enviado pelo dono,
// 28/09): camadas do potrace — linhas do losango, degradê, ALMEIDA e STORE
// separado, com a sombra escura em volta do STORE como no original.
// Coordenadas do JSON = pixels do print × escala.
function almeidaVetorizada() {
  const v = JSON.parse(fs.readFileSync("scripts/incidente/logos/almeidastoremc.json", "utf8"));
  const E = v.escala;
  const k = Object.fromEntries(v.camadas.map((c) => [c.nome, c]));
  const miolo = (id) => `<defs><filter id="${id}s" x="-25%" y="-70%" width="150%" height="240%"><feGaussianBlur stdDeviation="${11 * E}"/></filter></defs>
    <path d="${k.linhas.d}" fill="${k.linhas.cor}" fill-rule="evenodd"/><path d="${k.degrade.d}" fill="${k.degrade.cor}" fill-rule="evenodd"/>
    <path d="${k.almeida.d}" fill="#FFFFFF" fill-rule="evenodd"/>
    <path d="${k.store.d}" fill="#000000" stroke="#000000" stroke-width="${40 * E}" stroke-linejoin="round" filter="url(#${id}s)"/>
    <path d="${k.store.d}" fill="#000000" stroke="#000000" stroke-width="${10 * E}" stroke-linejoin="round"/>
    <path d="${k.store.d}" fill="#FFFFFF" fill-rule="evenodd"/>`;
  // Círculo (ícones, favicon, foto do perfil): a arte inteira, centrada no
  // miolo do texto, com escala que deixa as pontas do ALMEIDA dentro do círculo.
  const s = 880 / v.largura;
  const [cx, cy] = [559 * E, 468 * E];
  const circulo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="500" fill="#000000"/><g transform="translate(${500 - cx * s} ${500 - cy * s}) scale(${s})">${miolo("c")}</g></svg>`;
  // Topo: o recorte da faixa do ALMEIDA/STORE (com o losango passando atrás)
  // num selo preto — o topo do site é claro e a marca da Almeida é o preto.
  const [x0, y0, x1, y1] = [13, 290, 1073, 740].map((n) => n * E);
  const topo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}">
    <defs><clipPath id="selo"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${50 * E}"/></clipPath></defs>
    <g clip-path="url(#selo)"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#000000"/>${miolo("t")}</g></svg>`;
  return { circulo, topo, fundo: "#000000" };
}

// ---------- Space: fênix preta, "A LOJA DOS KIT", SPACE geométrica pesada.
function space() {
  // Fênix heráldica: asas abertas para cima com penas, cabeça virada para a
  // esquerda com crista, corpo e cauda em chama (como no perfil).
  const fenix = `<g transform="translate(546 330) scale(0.8)" fill="#0B0B0B">
    <path d="M96 78 L60 84 L28 70 L6 48 L-18 10 L4 16 L-6 -16 L18 4 L10 -30 L34 -2 L32 -38 L52 -6 L56 -36 L68 0 L78 -22 L84 20 L92 50 Z" stroke="#0B0B0B" stroke-width="3" stroke-linejoin="round"/>
    <path d="M104 78 L140 84 L172 70 L194 48 L218 10 L196 16 L206 -16 L182 4 L190 -30 L166 -2 L168 -38 L148 -6 L144 -36 L132 0 L122 -22 L116 20 L108 50 Z" stroke="#0B0B0B" stroke-width="3" stroke-linejoin="round"/>
    <path d="M102 64 C90 64 84 56 84 46 L70 42 L84 34 C86 24 94 18 104 18 L110 2 L112 16 L126 4 L118 24 C122 34 120 52 110 60 Z"/>
    <path d="M88 66 C84 94 88 120 101 142 C114 120 118 94 114 66 Z"/>
    <path d="M94 134 C88 152 80 164 68 174 C82 172 92 164 96 154 C96 166 98 178 101 188 C104 178 106 166 106 154 C110 164 120 172 134 174 C122 164 114 152 108 134 Z"/></g>`;
  const loja = texto(fonte.semi, "A LOJA DOS KIT", { tam: 44, x: 232, y: 470, tracking: 2 });
  const nome = texto(fonte.black, "SPACE", { tam: 150, x: 226, y: 590, largura: 548, tracking: 18 });
  const marca = `${fenix}<path d="${loja.d}" fill="#0B0B0B"/><path d="${nome.d}" fill="#0B0B0B"/>`;
  const circulo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="500" fill="#FFFFFF"/>${marca}</svg>`;
  const topo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="214 250 572 360">${marca}</svg>`;
  return { circulo, topo, fundo: "#FFFFFF" };
}

// ---------- Meliz: monograma M com "i" de losango, MELIZ em volta.
function meliz() {
  const ouro = "#D6BC93";
  const mono = (cor) => `<g fill="${cor}">
    <rect x="250" y="432" width="13" height="306" rx="6"/>
    <path d="M236 352 C252 344 272 342 288 348 L506 724 C503 730 496 731 492 727 Z"/>
    <path d="M494 722 L726 356 C730 352 736 354 736 360 L506 728 Z"/>
    <path d="M724 354 C744 344 764 348 764 362 L758 732 C756 744 742 746 739 736 L736 420 C735 396 730 372 724 354 Z"/>
    <rect x="494" y="440" width="12" height="158" rx="6"/>
    <path d="M500 368 L516 390 L500 412 L484 390 Z"/></g>`;
  let anel = "";
  const unidade = "MELIZ";
  const passo = 360 / 36;
  let k = 0;
  for (let rep = 0; rep < 6; rep++) {
    for (const c of unidade) {
      const ang = k * passo;
      const g = fonte.medium.charToGlyph(c);
      const t = 50;
      const w = g.advanceWidth * (t / fonte.medium.unitsPerEm);
      anel += `<g transform="rotate(${ang} 500 500)"><path d="${g.getPath(500 - w / 2, 118, t).toPathData(2)}"/></g>`;
      k++;
    }
    k++;
  }
  const circulo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="500" fill="#F7F3EE"/>
    <g fill="${ouro}">${anel}</g>${mono(ouro)}</svg>`;
  const escrita = texto(fonte.medium, "MELIZ", { tam: 190, x: 840, y: 700, tracking: 40 });
  const topo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="220 330 ${840 + escrita.w - 200} 430">${mono("#B8955F")}<path d="${escrita.d}" fill="#B8955F"/></svg>`;
  return { circulo, topo, fundo: "#F7F3EE" };
}

// Logo vetorizada da arte original enviada pelo dono (potrace, 28/09):
// substitui o desenho à mão quando existe scripts/incidente/logos/<perfil>.svg.
function vetorizada(perfil, fundo, largura = 640) {
  const topo = fs.readFileSync(`scripts/incidente/logos/${perfil}.svg`, "utf8");
  const [, , , vw, vh] = topo.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/).map(Number);
  const altura = (largura * vh) / vw;
  const interno = topo.replace("<svg ", `<svg x="${(1000 - largura) / 2}" y="${(1000 - altura) / 2}" width="${largura}" height="${altura}" preserveAspectRatio="xMidYMid meet" `);
  const circulo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="500" fill="${fundo}"/>${interno.replace(' xmlns="http://www.w3.org/2000/svg"', "")}</svg>`;
  return { circulo, topo, fundo };
}

const DESENHOS = {
  almeidastoremc: () => (fs.existsSync("scripts/incidente/logos/almeidastoremc.json") ? almeidaVetorizada() : almeida()),
  brand_meliz: () => {
    if (!fs.existsSync("scripts/incidente/logos/brand_meliz.json")) return meliz();
    // Vetorizada da arte original (print de perto enviado pelo dono).
    const v = JSON.parse(fs.readFileSync("scripts/incidente/logos/brand_meliz.json", "utf8"));
    const circulo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v.lado} ${v.lado}"><circle cx="${v.lado / 2}" cy="${v.lado / 2}" r="${v.lado / 2}" fill="${v.fundo}"/><path d="${v.d}" fill="${v.cor}" fill-rule="evenodd"/></svg>`;
    // No topo (fundo claro), só o monograma, num dourado mais escuro.
    // Topo: o monograma É o "M" — completa com "eliz" para ler "Meliz"
    // (pedido do dono: não repetir o M).
    const eliz = texto(fonte.josefin, "eliz", { tam: 900, x: 1880, y: 1702, tracking: 40 });
    const [vx, vy, , vh] = v.viewbox_topo.split(" ").map(Number);
    const largura = 1880 + eliz.w + 60 - vx;
    const topo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${largura} ${vh}"><g fill="${v.cor_topo}"><path d="${v.d_topo}" fill-rule="evenodd"/><path d="${eliz.d}" stroke="${v.cor_topo}" stroke-width="26" stroke-linejoin="round"/></g></svg>`;
    return { circulo, topo, fundo: v.fundo };
  },
  space_lojadoskit: () =>
    fs.existsSync("scripts/incidente/logos/space_lojadoskit.svg") ? vetorizada("space_lojadoskit", "#FFFFFF") : space(),
};

async function chamar(url, { metodo = "GET", headers = {}, corpo, bruto } = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: bruto ? headers : { "Content-Type": "application/json", ...headers },
    body: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)),
  });
  const texto_ = await r.text();
  let json = null;
  try {
    json = texto_ === "" ? null : JSON.parse(texto_);
  } catch {}
  return { ok: r.ok, status: r.status, json, texto: texto_ };
}
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

for (const loja of lojas) {
  const desenho = DESENHOS[loja.perfil];
  if (!desenho) continue;
  console.log(`\n==================== ${loja.nome} ====================`);
  const { circulo, topo: topoJusto, fundo } = desenho();
  // O topo do site recorta a logo com cantos arredondados (rounded-[8px] numa
  // caixa de 32px): margem interna de 14% da altura em volta, para nenhuma
  // letra encostar no canto (achado do dono: S, E e a asa cortados).
  const topo = topoJusto.replace(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/, (_, x, y, w, h) => {
    const m = Number(h) * 0.14;
    return `viewBox="${Number(x) - m} ${Number(y) - m} ${Number(w) + 2 * m} ${Number(h) + 2 * m}"`;
  });
  const quadrado = circulo.replace(/<circle cx="500" cy="500" r="500" fill="([^"]+)"\/>/, '<rect width="1000" height="1000" fill="$1"/>');
  const png = (svg, lado) => sharp(Buffer.from(svg), { density: 200 }).resize(lado, lado).png().toBuffer();
  const og = await sharp({ create: { width: 1200, height: 630, channels: 4, background: fundo } })
    .composite([{ input: await png(circulo, 540), gravity: "center" }])
    .png()
    .toBuffer();
  const maskable = await sharp({ create: { width: 512, height: 512, channels: 4, background: fundo } })
    .composite([{ input: await png(quadrado, 400), gravity: "center" }])
    .png()
    .toBuffer();
  const arquivos = {
    "logo.svg": [Buffer.from(topo), "image/svg+xml"],
    "logo-circulo.svg": [Buffer.from(circulo), "image/svg+xml"],
    "icon192.png": [await png(quadrado, 192), "image/png", 192, 192],
    "apple180.png": [await png(quadrado, 180), "image/png", 180, 180],
    "icon512.png": [await png(quadrado, 512), "image/png", 512, 512],
    "maskable512.png": [maskable, "image/png", 512, 512],
    "og.png": [og, "image/png", 1200, 630],
  };
  // Prévias para conferência (o topo sobre fundo branco, como no site).
  fs.writeFileSync(`/tmp/logos/${loja.perfil}-topo.svg`, topo);
  fs.writeFileSync(`/tmp/logos/${loja.perfil}-circulo.svg`, circulo);
  const previaTopo = await sharp(Buffer.from(topo), { density: 200 }).resize({ height: 160 }).png().toBuffer();
  await sharp({ create: { width: 1400, height: 560, channels: 3, background: "#FFFFFF" } })
    .composite([
      { input: await png(circulo, 500), left: 20, top: 30 },
      { input: previaTopo, left: 560, top: 60 },
      { input: await sharp(await png(quadrado, 192)).png().toBuffer(), left: 560, top: 300 },
      { input: maskable.length ? await sharp(maskable).resize(192).png().toBuffer() : maskable, left: 800, top: 300 },
    ])
    .png()
    .toFile(`/tmp/logos/${loja.perfil}-previa.png`);

  const token = (process.env[loja.conta] ?? "").trim();
  const api = (metodo, caminho, corpo) =>
    chamar(`https://api.supabase.com/v1${caminho}`, { metodo, headers: { Authorization: `Bearer ${token}` }, corpo });
  const projeto = (await api("GET", "/projects")).json.find((p) => p.name === loja.projeto);
  if (!projeto || PROIBIDOS.has(projeto.id)) throw new Error("projeto inválido");
  const ref = projeto.id;
  const chaves = (await api("GET", `/projects/${ref}/api-keys?reveal=true`)).json ?? [];
  const servico = chaves.find((c) => c.name === "service_role")?.api_key ?? chaves.find((c) => c.type === "secret")?.api_key;
  console.log(`::add-mask::${servico}`);
  const hServ = { apikey: servico, ...(servico.startsWith("eyJ") ? { Authorization: `Bearer ${servico}` } : {}) };
  const desc = {};
  for (const [nome, [buf, tipo, w, h]] of Object.entries(arquivos)) {
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const caminho = `v1/${sha}/${nome}`;
    const up = await chamar(`https://${ref}.supabase.co/storage/v1/object/branding/${caminho}`, {
      metodo: "POST",
      headers: { ...hServ, "Content-Type": tipo, "x-upsert": "true" },
      bruto: buf,
    });
    if (!up.ok) throw new Error(`upload ${nome} → HTTP ${up.status}: ${up.texto.slice(0, 200)}`);
    desc[nome] = { path: caminho, sha256: sha, media_type: tipo, bytes: buf.length, ...(w ? { width: w, height: h } : {}) };
  }
  const assets = {
    version: 1,
    originals: [desc["logo.svg"], desc["logo-circulo.svg"]],
    header: desc["logo.svg"],
    loader: desc["logo-circulo.svg"],
    favicon: desc["logo-circulo.svg"],
    apple_touch: desc["apple180.png"],
    icon_192: desc["icon192.png"],
    icon_512: desc["icon512.png"],
    maskable_512: desc["maskable512.png"],
    og: desc["og.png"],
  };
  const logoUrl = `https://${ref}.supabase.co/storage/v1/object/public/branding/${desc["logo.svg"].path}`;
  const q = await api("POST", `/projects/${ref}/database/query`, {
    query: `UPDATE public.store_config SET primary_color = ${lit(loja.cor)}, secondary_color = ${lit(loja.cor2)},
      accent_color = ${lit(loja.acento)}, logo_url = ${lit(logoUrl)},
      branding_assets = ${lit(JSON.stringify(assets))}::jsonb, updated_at = now() WHERE id = 1
      RETURNING store_name, primary_color`,
  });
  if (!q.ok) throw new Error(`store_config → HTTP ${q.status}: ${q.texto.slice(0, 500)}`);
  console.log("store_config:", JSON.stringify(q.json));
}

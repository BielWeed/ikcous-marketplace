// Temporário (28/09/2026): folha de contato das fotos de cada catálogo do
// Instagram (miniaturas numeradas post.foto) para a curadoria de quais posts
// são produto. Também baixa a foto do perfil. Grava os PNG em contatos/.
import fs from "node:fs";
import { createRequire } from "node:module";

const sharp = createRequire("/tmp/ferr/")("sharp");
fs.mkdirSync("contatos", { recursive: true });
for (const arq of fs.readdirSync("/tmp/cat").filter((n) => n.endsWith(".json"))) {
  const perfil = arq.replace(/^catalogo-|\.json$/g, "");
  const d = JSON.parse(fs.readFileSync(`/tmp/cat/${arq}`, "utf8"));
  const pic = d.perfil?.foto_perfil_hd;
  if (pic) {
    const r = await fetch(pic);
    console.log(`${perfil} foto do perfil: HTTP ${r.status}`);
    if (r.ok) fs.writeFileSync(`contatos/${perfil}-perfil.jpg`, Buffer.from(await r.arrayBuffer()));
  }
  const miniaturas = [];
  let falhas = 0;
  for (const [i, post] of d.posts.entries()) {
    for (const [j, url] of (post.imagens ?? []).slice(0, 4).entries()) {
      try {
        const r = await fetch(url);
        if (!r.ok) {
          falhas++;
          continue;
        }
        const rotulo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="34">
          <rect width="100%" height="100%" fill="#000" opacity="0.75"/>
          <text x="8" y="25" font-family="DejaVu Sans" font-weight="700" font-size="22" fill="#FF0">${i}.${j}</text></svg>`);
        const img = await sharp(Buffer.from(await r.arrayBuffer()))
          .resize(240, 300, { fit: "cover" })
          .composite([{ input: rotulo, gravity: "north" }])
          .png()
          .toBuffer();
        miniaturas.push(img);
      } catch {
        falhas++;
      }
    }
  }
  console.log(`${perfil}: ${miniaturas.length} miniaturas, ${falhas} falhas`);
  const COL = 8;
  const POR_FOLHA = 48;
  for (let f = 0; f * POR_FOLHA < miniaturas.length; f++) {
    const lote = miniaturas.slice(f * POR_FOLHA, (f + 1) * POR_FOLHA);
    const linhas = Math.ceil(lote.length / COL);
    await sharp({ create: { width: COL * 240, height: linhas * 300, channels: 3, background: "#222" } })
      .composite(lote.map((input, k) => ({ input, left: (k % COL) * 240, top: Math.floor(k / COL) * 300 })))
      .jpeg({ quality: 70 })
      .toFile(`contatos/${perfil}-${f + 1}.jpg`);
  }
}

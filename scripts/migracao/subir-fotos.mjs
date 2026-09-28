/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- script de migração de uso único: caminhos e extensões vêm do backup do dono, nunca de rede. */
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2];
const url = process.env.NOVO_SUPABASE_URL;
const chave = process.env.NOVO_SECRET_KEY;
if (!base || !url || !chave) {
  console.error("Faltou a pasta, NOVO_SUPABASE_URL ou NOVO_SECRET_KEY.");
  process.exit(1);
}
const buckets = ["produtos", "banners", "products", "branding", "devolucoes"];
const tipos = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  json: "application/json",
};

function acharBuckets(dir, achados = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (buckets.includes(e.name)) achados.push({ bucket: e.name, raiz: p });
    else acharBuckets(p, achados);
  }
  return achados;
}

function listar(dir, rel = "", lista = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listar(path.join(dir, e.name), r, lista);
    else if (e.isFile() && e.name !== ".emptyFolderPlaceholder") lista.push(r);
  }
  return lista;
}

const raizes = acharBuckets(base);
if (raizes.length === 0) {
  console.error("Nenhuma pasta com nome de bucket encontrada dentro de", base);
  process.exit(1);
}
let total = 0;
let falhas = 0;
for (const { bucket, raiz } of raizes) {
  for (const caminho of listar(raiz)) {
    total++;
    const ext = caminho.split(".").pop().toLowerCase();
    const destino = `${url}/storage/v1/object/${bucket}/${caminho.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const resp = await fetch(destino, {
        method: "POST",
        headers: {
          apikey: chave,
          Authorization: `Bearer ${chave}`,
          "x-upsert": "true",
          "Content-Type": tipos[ext] ?? "application/octet-stream",
        },
        body: fs.readFileSync(path.join(raiz, ...caminho.split("/"))),
      });
      if (resp.ok) console.log(`[ok]     ${bucket}/${caminho}`);
      else {
        falhas++;
        console.log(
          `[falhou] ${bucket}/${caminho}: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`,
        );
      }
    } catch (erro) {
      falhas++;
      console.log(`[falhou] ${bucket}/${caminho}: ${erro.message}`);
    }
  }
}
console.log(`\n${total} arquivo(s), ${falhas} falha(s).`);

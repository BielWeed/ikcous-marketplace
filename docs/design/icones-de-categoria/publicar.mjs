#!/usr/bin/env node
// Copia o catalogo aprovado para o arquivo que o painel serve (public/icons/categorias.json), sem
// espacos. Roda a validacao antes. Uso: node docs/design/icones-de-categoria/publicar.mjs
// O teste tests/front/catalogo-de-icones-publicado.test.ts reprova se as duas copias divergirem.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const origem = path.join(aqui, "catalogo.json");
const destino = path.resolve(aqui, "../../../public/icons/categorias.json");

const validacao = spawnSync(
  process.execPath,
  [path.join(aqui, "validar.mjs"), origem],
  { stdio: "inherit" },
);
if (validacao.status !== 0) process.exit(1);

const lista = JSON.parse(fs.readFileSync(origem, "utf8"));
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, `${JSON.stringify(lista)}\n`);
console.log(`Publicado: ${path.relative(process.cwd(), destino)}`);

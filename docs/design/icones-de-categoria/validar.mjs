#!/usr/bin/env node
// Valida catalogo.json. Uso: node docs/design/icones-de-categoria/validar.mjs
// Sai com codigo 1 se qualquer regra falhar.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const arquivo = process.argv[2] ?? path.join(aqui, "catalogo.json");
const GRUPOS = [
  "Roupas",
  "Roupas íntimas e praia",
  "Calçados",
  "Bolsas e acessórios",
  "Joias e relógios",
  "Beleza e perfumaria",
  "Infantil",
  "Casa e decoração",
  "Tecnologia",
  "Esporte e lazer",
  "Outros",
];
// Igual ao da CHECK categorias_icone_forma_check (migration 20261351000000): sem "+" nem expoente.
const ALFABETO = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\- ]+$/;
// eslint-disable-next-line security/detect-unsafe-regex -- grupos curtos separados por "-" literal, sem sobreposicao (linear); entrada e o catalogo local
const CHAVE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_D = 360;
const MIN_ICONES = 90;

const erros = [];
const erro = (chave, msg) => erros.push(`${chave}: ${msg}`);

let lista;
try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho dado por quem roda a ferramenta local
  lista = JSON.parse(fs.readFileSync(arquivo, "utf8"));
} catch (e) {
  console.error(`FALHA: nao leu ${arquivo}: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(lista)) {
  console.error("FALHA: o catalogo precisa ser uma lista");
  process.exit(1);
}

const vistas = new Set();
const porGrupo = new Map();
for (const [i, ic] of lista.entries()) {
  const id = ic?.chave ?? `#${i}`;
  if (typeof ic?.chave !== "string" || !CHAVE.test(ic.chave))
    erro(id, "chave invalida (kebab-case ascii)");
  else if (vistas.has(ic.chave)) erro(id, "chave duplicada");
  else vistas.add(ic.chave);
  if (typeof ic?.nome !== "string" || !ic.nome.trim()) erro(id, "nome vazio");
  if (!GRUPOS.includes(ic?.grupo))
    erro(id, `grupo ausente ou desconhecido: ${ic?.grupo}`);
  else porGrupo.set(ic.grupo, (porGrupo.get(ic.grupo) ?? 0) + 1);
  if (
    !Array.isArray(ic?.palavras) ||
    ic.palavras.length === 0 ||
    ic.palavras.some((p) => typeof p !== "string" || !/^[a-z0-9 ]+$/.test(p))
  )
    erro(id, "palavras: lista nao vazia de termos minusculos, sem acento");
  const d = ic?.d;
  if (typeof d !== "string" || !d.trim()) erro(id, "d vazio");
  else {
    if (d.length > MAX_D)
      erro(id, `d com ${d.length} caracteres (maximo ${MAX_D})`);
    if (!ALFABETO.test(d)) erro(id, "d com caractere fora do alfabeto de path");
    if (!/^[Mm]/.test(d.trim())) erro(id, "d precisa comecar com M");
    if (/\d\.\d{2,}/.test(d)) erro(id, "numero com mais de 1 casa decimal");
  }
}
for (const g of GRUPOS) if (!porGrupo.get(g)) erro(g, "grupo sem nenhum icone");
if (lista.length < MIN_ICONES)
  erro("catalogo", `${lista.length} icones (minimo ${MIN_ICONES})`);

if (erros.length) {
  console.error(`REPROVADO: ${erros.length} problema(s)`);
  for (const e of erros) console.error(` - ${e}`);
  process.exit(1);
}
const maior = Math.max(...lista.map((x) => x.d.length));
console.log(
  `OK: ${lista.length} icones, ${porGrupo.size} grupos, maior d = ${maior} caracteres`,
);
for (const g of GRUPOS) console.log(`  ${g}: ${porGrupo.get(g)}`);

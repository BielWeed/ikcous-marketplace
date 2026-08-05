#!/usr/bin/env node
/**
 * Verificador de link relativo quebrado nos .md do repositório.
 *
 * Por que existe: a documentação deste projeto envelhece em dias, não em meses.
 * A `DOC-050` (#64) nasceu porque três arquivos eram linkados sem existir; em
 * cinco dias o defeito INVERTEU — os arquivos passaram a existir e o texto
 * continuou anunciando que não existiam. Nos dois sentidos, o custo é o mesmo:
 * quem chega segue o link, bate em nada e para de confiar no resto do material.
 *
 * Um aviso escrito na mão não sobrevive a isso. Um comando, sim.
 *
 * O que ele NÃO faz, de propósito:
 *
 * - Não valida URL externa. Isso exige rede, fica vermelho por instabilidade
 *   alheia e treina a dupla a ignorar o job — o mesmo raciocínio da catraca de
 *   lint em `lint-ratchet.mjs`.
 * - Não valida âncora (`#secao`). Daria falso positivo com heading acentuado, e
 *   o estrago de uma âncora errada é rolar a página, não bater em 404.
 * - Não trata `arquivo.ts:13` como caminho. Este repositório escreve referência
 *   de código como `caminho:linha` — e o `AUDITORIA_2026-07-29.md` sozinho tem
 *   10 delas. Sem essa regra, o verificador nasceria com 10 falsos positivos e
 *   seria desligado na primeira semana.
 *
 * Uso: npm run lint:links
 * Sai com 1 se achar link quebrado, 0 se estiver limpo.
 */

/*
 * Sobre o disable abaixo: `security/detect-non-literal-fs-filename` existe para
 * pegar caminho vindo de entrada do usuário. Aqui todo caminho é montado a
 * partir do próprio repositório, e ler caminho calculado em runtime é
 * literalmente o trabalho deste script — sem isso ele não anda um diretório.
 * Suprimir no arquivo, com o motivo escrito, é mais honesto do que subir o teto
 * da catraca por causa de 4 falsos positivos.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- ver acima */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Onde procurar .md. A raiz entra sem recursão; `docs/` entra inteira. */
const ALVOS = ["docs"];
const IGNORAR = new Set(["node_modules", "dist", ".git", ".vite-pwa"]);

/** `[texto](destino)` — o destino para no primeiro espaço ou parêntese. */
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
/** Link externo ou âncora pura: fora do escopo. */
const EXTERNO = /^(https?:|mailto:|tel:|#)/;

function coletarMarkdown(dir, recursivo = true) {
  const achados = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const completo = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (recursivo) achados.push(...coletarMarkdown(completo));
    } else if (item.name.toLowerCase().endsWith(".md")) {
      achados.push(completo);
    }
  }
  return achados;
}

/** Só dígitos. Simples de propósito: nada de quantificador aninhado aqui. */
const SO_DIGITOS = /^\d+$/;

/**
 * `arquivo.ts:13` e `arquivo.ts:13:5` viram `arquivo.ts`.
 *
 * Feito com split em vez de `/:\d+(:\d+)?$/` porque o eslint marca aquela
 * forma como `security/detect-unsafe-regex`, e a versão sem regex composta é
 * mais barata de ler do que a discussão sobre se o backtracking é real.
 */
function tirarSufixoDeLinha(caminho) {
  const partes = caminho.split(":");
  while (partes.length > 1 && SO_DIGITOS.test(partes[partes.length - 1])) {
    partes.pop();
  }
  return partes.join(":");
}

const arquivos = [
  ...coletarMarkdown(RAIZ, false),
  ...ALVOS.flatMap((alvo) => {
    const dir = path.join(RAIZ, alvo);
    return fs.existsSync(dir) ? coletarMarkdown(dir) : [];
  }),
];

const quebrados = [];
let verificados = 0;

for (const arquivo of arquivos) {
  const texto = fs.readFileSync(arquivo, "utf8");
  const dir = path.dirname(arquivo);

  for (const achado of texto.matchAll(LINK)) {
    const destino = achado[1];
    if (EXTERNO.test(destino)) continue;

    // Corta a âncora, desfaz o %20 de caminho com espaço e tira o sufixo
    // `:linha` / `:linha:coluna` das referências de código.
    const semAncora = tirarSufixoDeLinha(decodeURI(destino.split("#")[0]));
    if (!semAncora) continue;

    verificados++;
    if (!fs.existsSync(path.resolve(dir, semAncora))) {
      const linha = texto.slice(0, achado.index).split("\n").length;
      quebrados.push({
        onde: `${path.relative(RAIZ, arquivo).replace(/\\/g, "/")}:${linha}`,
        destino,
      });
    }
  }
}

console.log(
  `Links relativos verificados: ${verificados} em ${arquivos.length} arquivos.`,
);

if (quebrados.length === 0) {
  console.log("Nenhum link quebrado.");
  process.exit(0);
}

console.error(`\nLinks quebrados: ${quebrados.length}\n`);
for (const { onde, destino } of quebrados) {
  console.error(`  ${onde}  ->  ${destino}`);
}
console.error(
  "\nO alvo não existe no disco. Corrija o caminho ou crie o arquivo —\n" +
    "e se o arquivo ainda vai existir, diga isso no texto em vez de linkar.",
);
process.exit(1);

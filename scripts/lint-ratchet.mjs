#!/usr/bin/env node
/**
 * Catraca de lint.
 *
 * Roda eslint e biome, conta erros e warnings, e compara com os tetos de
 * `.lint-baseline.json`. Reprova só se algum número SUBIR.
 *
 * Por que não é só `eslint .` no CI: este repositório entrou na dupla com
 * dívida pré-existente (7 erros e 553 warnings de eslint, 31 erros de biome,
 * medidos no CI em 30/07/2026). Um job que reprova por causa dela ficaria
 * vermelho em todo PR desde o primeiro dia, e o resultado conhecido disso é
 * a equipe aprender a ignorar o CI inteiro — inclusive os jobs que importam.
 *
 * Por que não é `continue-on-error: true`: aquilo deixa um X vermelho
 * permanente no PR, com o mesmo efeito de treinar a dupla a ignorar X
 * vermelho. E um job que nunca pode falhar não vale nada.
 *
 * A catraca resolve os dois: nasce verde e bloqueia dívida nova.
 *
 * Uso: npm run lint:ratchet
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = JSON.parse(
  fs.readFileSync(path.join(RAIZ, ".lint-baseline.json"), "utf8"),
);

const NO_CI = Boolean(process.env.CI);

/**
 * Roda um comando e devolve a saída, mesmo quando o processo sai com erro
 * (eslint e biome saem com 1 quando acham algo — que é o caso normal aqui).
 *
 * O maxBuffer alto não é exagero: o JSON do eslint deste repositório passa de
 * 1,1 MB, e o padrão do Node é 1 MB. Com o padrão, a saída chega truncada no
 * meio de uma string e o JSON.parse estoura com "Unterminated string" — um
 * erro que parece bug do eslint e não é.
 */
function rodar(comando) {
  const maxBuffer = 256 * 1024 * 1024;
  try {
    return execSync(comando, {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer,
    });
  } catch (e) {
    if (e.code === "ENOBUFS") {
      throw new Error(
        `A saída de \`${comando}\` estourou ${maxBuffer} bytes. Aumente o maxBuffer aqui.`,
      );
    }
    return `${e.stdout || ""}${e.stderr || ""}`;
  }
}

function contarEslint() {
  const saida = rodar("npx eslint . --format json");
  const inicio = saida.indexOf("[");
  if (inicio === -1) {
    throw new Error(`eslint não devolveu JSON:\n${saida.slice(0, 800)}`);
  }
  let errors = 0;
  let warnings = 0;
  for (const arquivo of JSON.parse(saida.slice(inicio))) {
    errors += arquivo.errorCount;
    warnings += arquivo.warningCount;
  }
  return { errors, warnings };
}

function contarBiome() {
  const saida = rodar("npx biome check .");
  const erros = saida.match(/Found (\d+) errors?\./);
  const avisos = saida.match(/Found (\d+) warnings?\./);
  return {
    errors: erros ? Number(erros[1]) : 0,
    warnings: avisos ? Number(avisos[1]) : 0,
  };
}

const medido = { eslint: contarEslint(), biome: contarBiome() };

/**
 * O Biome só é COBRADO no CI.
 *
 * Motivo medido: no Linux do CI ele acha 31 erros; na máquina Windows do
 * Gabriel, 100. A diferença não é código, é fim de linha — o repositório está
 * em CRLF no disco e o Biome formata em LF por padrão, então no Windows ele
 * reclama de arquivos que no CI passam. Cobrar isso localmente reprovaria
 * qualquer commit feito no Windows, o que é pior do que não cobrar.
 *
 * A correção de verdade é normalizar fim de linha (`.gitattributes` com
 * `eol=lf`), que é uma mudança grande e vai junto com a INFRA-220.
 */
// Acesso estático de propriedade, não `objeto[variavel]`: indexação dinâmica
// dispara security/detect-object-injection, e este script não pode ser o
// primeiro a furar a própria catraca que instala.
const comparacoes = [
  {
    ferramenta: "eslint",
    tipo: "errors",
    agora: medido.eslint.errors,
    teto: BASE.eslint.errors,
    cobra: true,
  },
  {
    ferramenta: "eslint",
    tipo: "warnings",
    agora: medido.eslint.warnings,
    teto: BASE.eslint.warnings,
    cobra: true,
  },
  {
    ferramenta: "biome",
    tipo: "errors",
    agora: medido.biome.errors,
    teto: BASE.biome.errors,
    cobra: NO_CI,
  },
  {
    ferramenta: "biome",
    tipo: "warnings",
    agora: medido.biome.warnings,
    teto: BASE.biome.warnings,
    cobra: NO_CI,
  },
];

const linhas = [];
let subiu = false;
let baixou = false;

for (const { ferramenta, tipo, agora, teto, cobra } of comparacoes) {
  const delta = agora - teto;

  let situacao = "ok";
  if (delta > 0) {
    situacao = cobra
      ? `SUBIU +${delta}`
      : `subiu +${delta} (não cobrado fora do CI)`;
    if (cobra) subiu = true;
  } else if (delta < 0) {
    situacao = `baixou ${delta} — abaixe o teto`;
    if (cobra) baixou = true;
  }

  linhas.push({ ferramenta, tipo, agora, teto, situacao });
}

const col = (s) => String(s).padEnd(11);
console.log(
  [
    `${col("ferramenta")}${col("tipo")}${col("agora")}${col("teto")}situação`,
    "".padEnd(72, "-"),
    ...linhas.map(
      (l) =>
        `${col(l.ferramenta)}${col(l.tipo)}${col(l.agora)}${col(l.teto)}${l.situacao}`,
    ),
  ].join("\n"),
);

if (!NO_CI) {
  console.log(
    "\nFora do CI o Biome não é cobrado: no Windows ele conta erro de CRLF que\n" +
      "no Linux do CI não existe. Quem cobra Biome é o CI.",
  );
}

const resumo = process.env.GITHUB_STEP_SUMMARY;
if (resumo) {
  const md = [
    "## Catraca de lint",
    "",
    "| ferramenta | tipo | agora | teto | situação |",
    "| --- | --- | --- | --- | --- |",
    ...linhas.map(
      (l) =>
        `| ${l.ferramenta} | ${l.tipo} | ${l.agora} | ${l.teto} | ${l.situacao} |`,
    ),
    "",
    subiu
      ? "**Reprovado.** Alguma contagem subiu. Corrija o que este PR introduziu, ou justifique e suba o teto em `.lint-baseline.json` explicitamente."
      : baixou
        ? "Aprovado — e alguma contagem **caiu**. Abaixe o teto em `.lint-baseline.json` neste mesmo PR, senão a dívida volta sem ninguém perceber."
        : "Aprovado. Nada subiu.",
    "",
  ].join("\n");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem do runner do GitHub Actions, não de entrada de usuário
  fs.appendFileSync(resumo, md);
}

if (subiu) {
  console.error(
    "\nReprovado: a dívida de lint aumentou.\n" +
      "Rode `npx eslint .` e corrija o que o seu PR introduziu.\n" +
      "Se o aumento for intencional, suba o teto em .lint-baseline.json e explique no PR.",
  );
  process.exit(1);
}

if (baixou) {
  console.log(
    "\nAlguma contagem caiu. Abaixe o teto em .lint-baseline.json neste PR,\n" +
      "senão a dívida pode voltar sem o CI reclamar.",
  );
}

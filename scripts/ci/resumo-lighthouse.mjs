// RESUMO DO LIGHTHOUSE — frente CI-SAÚDE (14/09/2026).
//
// Lê o relatório que o `lhci collect` deixou em .lighthouseci/ e publica os
// scores e as métricas centrais no summary do run.
//
// HONESTIDADE DO NÚMERO (vale mais que check verde): o que roda aqui é
// FUMAÇA — 1 rodada, cache frio, sobre o BUILD FIXTURE (identidade fictícia,
// sem loja de verdade). E a lição de 14/09 (recado da sessão expansão-ci): o
// service worker do fixture sobe EnvGuard por não ter env POR DESENHO — esse
// erro vive no SW e pode derrubar "Best Practices" sem ser defeito da página.
// Tendência entre runs vale mais que o valor absoluto de um deles.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const pasta = path.join(process.cwd(), ".lighthouseci");

// Pasta fixa do próprio lhci, criada pelo passo anterior do workflow.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do repo
if (!fs.existsSync(pasta)) {
  console.log(
    "### 🚦 Lighthouse\n\n::warning::`.lighthouseci/` não existe — o `lhci collect` não rodou ou morreu antes. Conferir o log.",
  );
  process.exit(0);
}

// eslint-disable-next-line security/detect-non-literal-fs-filename -- pasta fixa do lhci, criada pelo passo anterior
const nomes = fs.readdirSync(pasta);
// NOME REAL do relatório que o `lhci collect` grava: `lhr-<timestamp>.json`
// (montado em @lhci/utils/src/saved-reports.js: `lhr-${Date.now()}` — o filtro
// antigo, `lighthouse-*.report.json`, não casa com NENHUM arquivo e o resumo
// publicava warning sem número com o job verde). O padrão do CLI do lighthouse
// standalone fica como fallback, caso a receita do workflow mude um dia.
const ehRelatorio = (nome) =>
  (nome.startsWith("lhr-") && nome.endsWith(".json")) ||
  (nome.startsWith("lighthouse-") && nome.endsWith(".report.json"));
const relatorios = nomes
  .filter(ehRelatorio)
  .map((nome) => ({
    nome,
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome vem do readdir imediatamente acima
    mtime: fs.statSync(path.join(pasta, nome)).mtimeMs,
  }))
  .sort((a, b) => a.mtime - b.mtime);

if (relatorios.length === 0) {
  // Diagnóstico: "não achei" precisa dizer o que esperava e o que havia —
  // fumaça sem relatório é fumaça não feita, e o aviso tem de dar o caminho.
  const amostra = nomes.slice(0, 5).join(", ");
  const total =
    nomes.length > 5
      ? `${nomes.length} arquivos (amostra: ${amostra}…)`
      : amostra || "pasta vazia";
  console.log(
    `### 🚦 Lighthouse\n\n::warning::Nenhum relatório Lighthouse em \`.lighthouseci/\` — esperava \`lhr-<timestamp>.json\` (o que o \`lhci collect\` grava) ou \`lighthouse-*.report.json\`. Fumaça sem relatório é fumaça não feita. Havia: ${total}.`,
  );
  process.exit(0);
}

const caminhoRelatorio = path.join(pasta, relatorios.at(-1).nome);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de pasta fixa do lhci e nome saído do readdir
const relatorio = JSON.parse(fs.readFileSync(caminhoRelatorio, "utf8"));

const score = (categorias, chave) => {
  // `chave` é literal nos 4 pontos de chamada; categorias vem do relatório do lhci.
  // eslint-disable-next-line security/detect-object-injection -- chave literal
  const valor = categorias?.[chave]?.score;
  return valor === null || valor === undefined
    ? "—"
    : `${Math.round(valor * 100)}`;
};
const ms = (auditorias, chave) => {
  // eslint-disable-next-line security/detect-object-injection -- chave literal
  const valor = auditorias?.[chave]?.numericValue;
  return valor === undefined ? "—" : `${Math.round(valor)} ms`;
};

const categorias = relatorio.categories ?? {};
const auditorias = relatorio.audits ?? {};

console.log("### 🚦 Lighthouse fumaça (1 rodada, build fixture)\n");
console.log("| Performance | Acessibilidade | Boas práticas | SEO |");
console.log("|---|---|---|---|");
console.log(
  `| **${score(categorias, "performance")}** | ${score(categorias, "accessibility")} | ${score(categorias, "best-practices")} | ${score(categorias, "seo")} |\n`,
);
console.log("| FCP | LCP | TBT | CLS | Speed Index |");
console.log("|---|---|---|---|---|");
console.log(
  `| ${ms(auditorias, "first-contentful-paint")} | ${ms(auditorias, "largest-contentful-paint")} | ${ms(auditorias, "total-blocking-time")} | ${auditorias["cumulative-layout-shift"]?.numericValue?.toFixed(3) ?? "—"} | ${ms(auditorias, "speed-index")} |\n`,
);
console.log(
  "> Leitura honesta: build fixture (sem loja real), 1 rodada, cache frio. O erro do EnvGuard no service worker é DE DESENHO no fixture e pode pesar em “Boas práticas” — não é defeito da página. Compare RUNS entre si, não o número de um dia isolado.",
);
process.exit(0);

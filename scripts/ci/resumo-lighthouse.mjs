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

if (!fs.existsSync(pasta)) {
  console.log("### 🚦 Lighthouse\n\n::warning::`.lighthouseci/` não existe — o `lhci collect` não rodou ou morreu antes. Conferir o log.");
  process.exit(0);
}

const relatorios = fs
  .readdirSync(pasta)
  .filter((nome) => nome.startsWith("lighthouse-") && nome.endsWith(".report.json"))
  .map((nome) => ({ nome, mtime: fs.statSync(path.join(pasta, nome)).mtimeMs }))
  .sort((a, b) => a.mtime - b.mtime);

if (relatorios.length === 0) {
  console.log("### 🚦 Lighthouse\n\n::warning::Nenhum `lighthouse-*.report.json` em `.lighthouseci/` — fumaça sem relatório é fumaça não feita.");
  process.exit(0);
}

const relatorio = JSON.parse(fs.readFileSync(path.join(pasta, relatorios.at(-1).nome), "utf8"));

const score = (categorias, chave) => {
  const valor = categorias?.[chave]?.score;
  return valor === null || valor === undefined ? "—" : `${Math.round(valor * 100)}`;
};
const ms = (auditorias, chave) => {
  const valor = auditorias?.[chave]?.numericValue;
  return valor === undefined ? "—" : `${Math.round(valor)} ms`;
};

const categorias = relatorio.categories ?? {};
const auditorias = relatorio.audits ?? {};

console.log("### 🚦 Lighthouse fumaça (1 rodada, build fixture)\n");
console.log("| Performance | Acessibilidade | Boas práticas | SEO |");
console.log("|---|---|---|---|");
console.log(`| **${score(categorias, "performance")}** | ${score(categorias, "accessibility")} | ${score(categorias, "best-practices")} | ${score(categorias, "seo")} |\n`);
console.log("| FCP | LCP | TBT | CLS | Speed Index |");
console.log("|---|---|---|---|---|");
console.log(
  `| ${ms(auditorias, "first-contentful-paint")} | ${ms(auditorias, "largest-contentful-paint")} | ${ms(auditorias, "total-blocking-time")} | ${auditorias["cumulative-layout-shift"]?.numericValue?.toFixed(3) ?? "—"} | ${ms(auditorias, "speed-index")} |\n`,
);
console.log(
  "> Leitura honesta: build fixture (sem loja real), 1 rodada, cache frio. O erro do EnvGuard no service worker é DE DESENHO no fixture e pode pesar em “Boas práticas” — não é defeito da página. Compare RUNS entre si, não o número de um dia isolado.",
);
process.exit(0);

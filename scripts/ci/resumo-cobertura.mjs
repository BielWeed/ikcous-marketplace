// RESUMO DE COBERTURA — frente CI-SAÚDE (14/09/2026).
//
// Lê coverage/coverage-summary.json (produzido pelo vitest com o reporter
// json-summary no job de cobertura) e publica no summary do run uma tabela
// POR DIRETÓRIO: % de linhas ponderado (cobertas/total), nunca média simples
// de porcentagens — média de porcentagem esconde arquivo grande sem teste.
//
// O piso mínimo de cobertura NÃO é decidido aqui: é proposta ao dono
// (criterion 2 da frente). Este script só mede e publica.

import fs from "node:fs";
import process from "node:process";

const ARQUIVO = "coverage/coverage-summary.json";

if (!fs.existsSync(ARQUIVO)) {
  console.log("### 🧪 Cobertura\n\n::warning::O vitest não produziu `coverage-summary.json` — sem número para publicar.");
  process.exit(0);
}

const resumo = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));

// Agrupa por diretório de primeiro nível sob src/ (src/lib, src/components...).
// As chaves vêm com caminho ABSOLUTO do runner; o corte pelo "/src/" remove o
// prefixo da máquina e sobra o que interessa.
const grupos = new Map();
for (const [caminho, dados] of Object.entries(resumo)) {
  if (caminho === "total") continue;
  const corte = caminho.indexOf("/src/");
  const relativo = corte >= 0 ? caminho.slice(corte + 1) : caminho;
  const pasta = relativo.includes("/") ? relativo.slice(0, relativo.lastIndexOf("/")) : "(raiz de src)";
  const atual = grupos.get(pasta) ?? { cobertas: 0, total: 0, branches: 0, branchesTotal: 0, funcoes: 0, funcoesTotal: 0 };
  atual.cobertas += dados.lines.covered;
  atual.total += dados.lines.total;
  atual.branches += dados.branches.covered;
  atual.branchesTotal += dados.branches.total;
  atual.funcoes += dados.functions.covered;
  atual.funcoesTotal += dados.functions.total;
  grupos.set(pasta, atual);
}

const pct = (cobertas, total) => (total > 0 ? `${((cobertas / total) * 100).toFixed(1)}%` : "—");

const linhas = [...grupos.entries()]
  .map(([pasta, g]) => ({ pasta, ...g }))
  .sort((a, b) => a.cobertas / (a.total || 1) - b.cobertas / (b.total || 1));

const total = resumo.total ?? {
  lines: { covered: linhas.reduce((s, l) => s + l.cobertas, 0), total: linhas.reduce((s, l) => s + l.total, 0) },
  branches: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
};

console.log("### 🧪 Cobertura de testes (suíte do front sobre `src/**`)\n");
console.log("| Diretório | Linhas cobertas/total | % Linhas | % Branches | % Funções |");
console.log("|---|---|---|---|---|");
for (const l of linhas) {
  console.log(`| \`${l.pasta}\` | ${l.cobertas}/${l.total} | ${pct(l.cobertas, l.total)} | ${pct(l.branches, l.branchesTotal)} | ${pct(l.funcoes, l.funcoesTotal)} |`);
}
console.log(
  `| **TOTAL** | **${total.lines.covered}/${total.lines.total}** | **${pct(total.lines.covered, total.lines.total)}** | ${pct(total.branches.covered, total.branches.total)} | ${pct(total.functions.covered, total.functions.total)} |`,
);
console.log(
  `\nFonte: vitest + provedor v8, arquivos NUNCA tocados por teste entram com 0% (denominador honesto).\nPiso mínimo de cobertura: **PROPOSTA ao dono — não há número definido ainda.**`,
);
process.exit(0);

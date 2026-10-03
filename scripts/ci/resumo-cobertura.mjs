// RESUMO DE COBERTURA — frente CI-SAÚDE (14/09/2026).
//
// Lê coverage/coverage-summary.json (produzido pelo vitest com o reporter
// json-summary no job de cobertura) e publica no summary do run uma tabela
// POR DIRETÓRIO: % de linhas ponderado (cobertas/total), nunca média simples
// de porcentagens — média de porcentagem esconde arquivo grande sem teste.
//
// Argumento opcional argv[2]: o resultados-vitest.json (reporter json). Com
// ele, o resumo também diz quantos testes passaram/falharam. A suíte aqui
// roda sob instrumentação de cobertura e fica MUITO mais lenta (medido no
// primeiro run: 314 s contra ~84 s do ci.yml) — teste sensível a tempo pode
// falhar AQUI e passar lá; por isso este job mede e publica, e o GATE de
// correção continua sendo o job "Testes" do ci.yml, no mesmo commit.
//
// O piso mínimo de cobertura NÃO é decidido aqui: é proposta ao dono
// (critério 2 da frente). Este script só mede e publica.

import fs from "node:fs";
import process from "node:process";

const ARQUIVO = "coverage/coverage-summary.json";
const resultadosPath = process.argv[2];

// Estado da suíte, quando o vitest chegou a escrever o relatório json.
let linhaSuite =
  "> Estado da suíte: indisponível (o vitest não chegou a escrever o relatório).";
// Caminho vem do próprio workflow (${{ runner.temp }}), não de entrada externa.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho do próprio workflow
if (resultadosPath && fs.existsSync(resultadosPath)) {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho do próprio workflow
    const resultados = JSON.parse(fs.readFileSync(resultadosPath, "utf8"));
    const falhas = resultados.numFailedTests ?? 0;
    linhaSuite = `> Estado da suíte (sob instrumentação): **${resultados.numTotalTests} testes** — ${resultados.numPassedTests} ✅, ${falhas} ❌.${
      falhas > 0
        ? " Falha sob cobertura pode ser lentidão da instrumentação, não defeito — o gate de verdade é o job `Testes` do ci.yml no MESMO commit. Ver a lista no log do passo."
        : ""
    }`;
    if (falhas > 0) {
      console.log(
        `::warning::Suíte com ${falhas} teste(s) falhando SOB COBERTURA (instrumentação ~3,7x mais lenta). Conferir o job "Testes" do ci.yml no mesmo commit antes de culpar o código.`,
      );
    }
  } catch {
    linhaSuite = "> Estado da suíte: relatório ilegível.";
  }
}

if (!fs.existsSync(ARQUIVO)) {
  console.log(
    "### 🧪 Cobertura\n\n::warning::O vitest não produziu `coverage-summary.json` — sem número para publicar.",
  );
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
  const pasta = relativo.includes("/")
    ? relativo.slice(0, relativo.lastIndexOf("/"))
    : "(raiz de src)";
  const atual = grupos.get(pasta) ?? {
    cobertas: 0,
    total: 0,
    branches: 0,
    branchesTotal: 0,
    funcoes: 0,
    funcoesTotal: 0,
  };
  atual.cobertas += dados.lines.covered;
  atual.total += dados.lines.total;
  atual.branches += dados.branches.covered;
  atual.branchesTotal += dados.branches.total;
  atual.funcoes += dados.functions.covered;
  atual.funcoesTotal += dados.functions.total;
  grupos.set(pasta, atual);
}

const pct = (cobertas, total) =>
  total > 0 ? `${((cobertas / total) * 100).toFixed(1)}%` : "—";

const linhas = [...grupos.entries()]
  .map(([pasta, g]) => ({ pasta, ...g }))
  .sort((a, b) => a.cobertas / (a.total || 1) - b.cobertas / (b.total || 1));

const total = resumo.total ?? {
  lines: {
    covered: linhas.reduce((s, l) => s + l.cobertas, 0),
    total: linhas.reduce((s, l) => s + l.total, 0),
  },
  branches: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
};

console.log("### 🧪 Cobertura de testes (suíte do front sobre `src/**`)\n");
console.log(`${linhaSuite}\n`);
console.log(
  "| Diretório | Linhas cobertas/total | % Linhas | % Branches | % Funções |",
);
console.log("|---|---|---|---|---|");
for (const l of linhas) {
  console.log(
    `| \`${l.pasta}\` | ${l.cobertas}/${l.total} | ${pct(l.cobertas, l.total)} | ${pct(l.branches, l.branchesTotal)} | ${pct(l.funcoes, l.funcoesTotal)} |`,
  );
}
console.log(
  `| **TOTAL** | **${total.lines.covered}/${total.lines.total}** | **${pct(total.lines.covered, total.lines.total)}** | ${pct(total.branches.covered, total.branches.total)} | ${pct(total.functions.covered, total.functions.total)} |`,
);
console.log(
  "\nFonte: vitest + provedor v8, arquivos NUNCA tocados por teste entram com 0% (denominador honesto).\nPiso mínimo de cobertura: **PROPOSTA ao dono — não há número definido ainda.**",
);
process.exit(0);

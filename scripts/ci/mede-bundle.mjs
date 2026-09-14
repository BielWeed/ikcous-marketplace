// ORÇAMENTO DE BUNDLE — frente CI-SAÚDE (14/09/2026).
//
// Mede o que o build fixture (receita provada do ci.yml) deixou em
// dist-test/assets/ e compara com a fotografia travada em
// scripts/ci/orcamento-bundle.json. ACIMA do orçamento = AVISO no summary,
// nunca falha: este script é detector, não porteiro.
//
// O orçamento é POR CATEGORIA (total JS, maior arquivo JS, total CSS) e não
// por nome de arquivo: o Vite assa hash no nome (index-Ab3dE.js) e a foto por
// nome envelheceria na primeira build.
//
// `--autoteste`: roda a comparação de novo com um orçamento falsificado
// 1 byte ABAIXO do medido e afirma que o aviso disparou — prova viva, no
// próprio run, de que o detector fala. Custa menos de 1 segundo.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const raiz = process.cwd();
const ORCAMENTO = path.join(raiz, "scripts/ci/orcamento-bundle.json");

const argv = process.argv.slice(2);
const autoteste = argv.includes("--autoteste");
const indiceDist = argv.indexOf("--dist");
const dist = indiceDist >= 0 ? argv[indiceDist + 1] : "dist-test";

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

function medir(pastaDist) {
  const pastaAssets = path.join(raiz, pastaDist, "assets");
  // Caminho montado de raiz fixa do repositório; `pastaDist` só assume os dois
  // valores da receita do próprio CI (dist-test no fixture, dist na produção).
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- pasta vem da receita do CI, não de entrada externa
  if (!fs.existsSync(pastaAssets)) {
    console.error(
      `ORCAMENTO_BUNDLE: ${pastaAssets} não existe — o build rodou antes deste passo?`,
    );
    process.exit(1);
  }
  const js = [];
  const css = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem: pasta da receita do CI
  for (const nome of fs.readdirSync(pastaAssets)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome vem do readdir imediatamente acima
    const bytes = fs.statSync(path.join(pastaAssets, nome)).size;
    if (nome.endsWith(".js")) js.push({ nome, bytes });
    if (nome.endsWith(".css")) css.push({ nome, bytes });
  }
  if (js.length === 0) {
    console.error(
      "ORCAMENTO_BUNDLE: nenhum .js em assets/ — build suspeito, medindo nada.",
    );
    process.exit(1);
  }
  const totalJs = js.reduce((s, a) => s + a.bytes, 0);
  const totalCss = css.reduce((s, a) => s + a.bytes, 0);
  const maior = js.reduce((m, a) => (a.bytes > m.bytes ? a : m), js[0]);
  const top = [...js].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  return {
    totalJs,
    totalCss,
    maior,
    top,
    qtdJs: js.length,
    qtdCss: css.length,
  };
}

// Devolve { chave: { medido, orcamento } } da categoria falsificada no
// autoteste ou das três categorias na comparação normal.
function comparar(medicao, orcamento) {
  const linhas = [
    ["total_js_bytes", "Total dos .js", medicao.totalJs],
    ["maior_js_bytes", "Maior arquivo .js", medicao.maior.bytes],
    ["total_css_bytes", "Total dos .css", medicao.totalCss],
  ];
  return linhas.map(([chave, rotulo, valor]) => ({
    chave,
    rotulo,
    medido: valor,
    // `chave` nasce de lista LITERAL três linhas acima, nunca de entrada externa.
    // eslint-disable-next-line security/detect-object-injection -- chave de lista literal
    orcamento: orcamento[chave],
  }));
}

const medicao = medir(dist);

// ---- Modo fotografia: não há orçamento ainda ------------------------------
// eslint-disable-next-line security/detect-non-literal-fs-filename -- ORCAMENTO é constante montada de raiz fixa do repo
if (!autoteste && !fs.existsSync(ORCAMENTO)) {
  const fotografia = {
    medido_em: new Date().toISOString().slice(0, 10),
    fonte: "fotografia do primeiro run do workflow Saúde",
    total_js_bytes: medicao.totalJs,
    maior_js_bytes: medicao.maior.bytes,
    total_css_bytes: medicao.totalCss,
  };
  // Fotografia EXATA (bytes, sem arredondar kB) gravada no checkout do run e
  // publicada como artefato: quem comitar o orçamento baixa o artefato e não
  // transcreve número de summary arredondado.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de raiz fixa do repo
  fs.mkdirSync(path.dirname(path.join(raiz, "scripts/ci/fotografia-bundle.json")), {
    recursive: true,
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de raiz fixa do repo
  fs.writeFileSync(
    path.join(raiz, "scripts/ci/fotografia-bundle.json"),
    `${JSON.stringify(fotografia, null, 2)}\n`,
  );
  console.log("### 📦 Bundle — FOTOGRAFIA INICIAL (ainda não há orçamento)\n");
  console.log(
    "Medido AGORA no CI (receita fixture do ci.yml). O JSON exato saiu como",
  );
  console.log(
    "artefato `fotografia-do-bundle`; comitado como `scripts/ci/orcamento-bundle.json`,",
  );
  console.log("a rodada seguinte já compara:\n");
  console.log("```json");
  console.log(JSON.stringify(fotografia, null, 2));
  console.log("```\n");
  console.log(
    `Arquivos: ${medicao.qtdJs} .js, ${medicao.qtdCss} .css. Os 3 maiores .js:`,
  );
  for (const arquivo of medicao.top)
    console.log(`- \`${arquivo.nome}\` — ${kb(arquivo.bytes)}`);
  process.exit(0);
}

// ---- Comparação (e autoteste com orçamento falsificado) -------------------
const orcamento = autoteste
  ? {
      total_js_bytes: medicao.totalJs - 1,
      maior_js_bytes: medicao.maior.bytes,
      total_css_bytes: medicao.totalCss,
    }
  : // eslint-disable-next-line security/detect-non-literal-fs-filename -- ORCAMENTO é constante montada de raiz fixa do repo
    JSON.parse(fs.readFileSync(ORCAMENTO, "utf8"));

const linhas = comparar(medicao, orcamento);
const estouradas = linhas.filter(
  (l) => Number.isFinite(l.orcamento) && l.medido > l.orcamento,
);

if (autoteste) {
  if (estouradas.length !== 1 || estouradas[0].chave !== "total_js_bytes") {
    console.error(
      "AUTOTESTE FALHOU: o aviso não disparou com orçamento 1 byte abaixo do medido.",
    );
    process.exit(1);
  }
  console.log(
    `AUTOTESTE OK: aviso disparou com orçamento falsificado (${kb(medicao.totalJs - 1)} < ${kb(medicao.totalJs)}). O detector fala.`,
  );
  process.exit(0);
}

console.log("### 📦 Bundle — medido x orçamento\n");
console.log("| Medida | Medido agora | Orçamento | Estado |");
console.log("|---|---|---|---|");
for (const linha of linhas) {
  const estado = !Number.isFinite(linha.orcamento)
    ? "sem orçamento"
    : linha.medido > linha.orcamento
      ? "⚠️ **acima do orçamento**"
      : `✅ folga de ${kb(linha.orcamento - linha.medido)}`;
  console.log(
    `| ${linha.rotulo} | ${kb(linha.medido)} | ${Number.isFinite(linha.orcamento) ? kb(linha.orcamento) : "—"} | ${estado} |`,
  );
}
console.log(
  `\nArquivos: ${medicao.qtdJs} .js, ${medicao.qtdCss} .css. Os 3 maiores .js:`,
);
for (const arquivo of medicao.top)
  console.log(`- \`${arquivo.nome}\` — ${kb(arquivo.bytes)}`);

for (const linha of estouradas) {
  console.log(
    `\n::warning::Bundle acima do orçamento: ${linha.rotulo} mediu ${kb(linha.medido)}, orçamento ${kb(linha.orcamento)}.`,
  );
}
process.exit(0);

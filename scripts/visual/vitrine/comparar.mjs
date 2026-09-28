#!/usr/bin/env node
// Diff pixel a pixel entre dois diretórios de prints do harness da vitrine
// (scripts/visual/vitrine/rodar.mjs).
//
// Uso:
//   node scripts/visual/vitrine/comparar.mjs <dirBaseline> <dirCandidato> [--larguras 360,375,390,414]
//
// Para cada arquivo `<tela>__<largura>.png` presente nos DOIS diretórios (na
// interseção — telas exclusivas de um lado são listadas à parte, não contam
// como diff): decodifica os dois PNGs (pngjs, dependência transitiva já
// travada no package-lock.json — ver README), compara dimensão e, se
// baterem, cada pixel RGBA. Escreve um PNG de diff (vermelho nos pixels
// diferentes, baseline esmaecido no resto) ao lado do relatório. Sai com
// código ≠ 0 se QUALQUER diff > 0 em alguma das LARGURAS DE CELULAR (o
// argumento --larguras, default as 4 primeiras do harness). Diferença de
// ALTURA da página também conta como diff. Não usa pixelmatch: não está
// nas dependências deste repositório; a comparação acima é a nossa.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const LARGURAS_CELULAR_PADRAO = [360, 375, 390, 414];

function lerArgumentos(argv) {
  const posicionais = [];
  let larguraCelular = LARGURAS_CELULAR_PADRAO;
  for (let i = 0; i < argv.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- `i` é o contador do próprio `for`, nunca entrada externa indexando um objeto.
    const item = argv[i];
    if (item === "--larguras") {
      larguraCelular = argv[++i]
        .split(",")
        .map((n) => Number.parseInt(n.trim(), 10));
    } else if (item.startsWith("--larguras=")) {
      larguraCelular = item
        .slice("--larguras=".length)
        .split(",")
        .map((n) => Number.parseInt(n.trim(), 10));
    } else {
      posicionais.push(item);
    }
  }
  const [dirBaseline, dirCandidato] = posicionais;
  if (!dirBaseline || !dirCandidato) {
    console.error(
      "uso: node scripts/visual/vitrine/comparar.mjs <dirBaseline> <dirCandidato> [--larguras 360,375,390,414]",
    );
    process.exit(1);
  }
  return {
    dirBaseline: path.resolve(process.cwd(), dirBaseline),
    dirCandidato: path.resolve(process.cwd(), dirCandidato),
    larguraCelular,
  };
}

/** Nomes de arquivo `.png` num diretório — `dir` vem de argv do operador (CLI local), nunca de entrada web. */
function pngsEm(dir) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ver docstring acima.
  return fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
}

function decodificarPng(caminho) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `caminho` vem de `fs.readdirSync` do próprio diretório informado pelo operador.
  return PNG.sync.read(fs.readFileSync(caminho));
}

function larguraDoNome(nomeArquivo) {
  const m = /__(\d+)\.png$/.exec(nomeArquivo);
  return m ? Number.parseInt(m[1], 10) : null;
}

function compararUmPar(baselinePng, candidatoPng, caminhoSaidaDiff) {
  if (
    baselinePng.width !== candidatoPng.width ||
    baselinePng.height !== candidatoPng.height
  ) {
    return {
      pixelsDiferentes: Math.max(
        baselinePng.width * baselinePng.height,
        candidatoPng.width * candidatoPng.height,
      ),
      motivo: `dimensão diferente: baseline ${baselinePng.width}x${baselinePng.height} vs candidato ${candidatoPng.width}x${candidatoPng.height}`,
    };
  }

  const { width, height } = baselinePng;
  const diffPng = new PNG({ width, height });
  let pixelsDiferentes = 0;
  const a = baselinePng.data;
  const b = candidatoPng.data;
  // `i` é sempre o contador do próprio `for` abaixo (passo 4, byte a byte do
  // buffer RGBA), nunca entrada externa — o bloco inteiro indexa só por ele.
  /* eslint-disable security/detect-object-injection */
  for (let i = 0; i < a.length; i += 4) {
    const igual =
      a[i] === b[i] &&
      a[i + 1] === b[i + 1] &&
      a[i + 2] === b[i + 2] &&
      a[i + 3] === b[i + 3];
    if (igual) {
      // Esmaece o baseline (preto e branco, mais claro) onde não há diff.
      const cinza = Math.round((a[i] + a[i + 1] + a[i + 2]) / 3);
      const claro = Math.round(255 - (255 - cinza) * 0.25);
      diffPng.data[i] = claro;
      diffPng.data[i + 1] = claro;
      diffPng.data[i + 2] = claro;
      diffPng.data[i + 3] = 255;
    } else {
      pixelsDiferentes++;
      diffPng.data[i] = 255;
      diffPng.data[i + 1] = 0;
      diffPng.data[i + 2] = 0;
      diffPng.data[i + 3] = 255;
    }
  }
  /* eslint-enable security/detect-object-injection */
  if (pixelsDiferentes > 0) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `caminhoSaidaDiff` é montado a partir do diretório de diff do próprio harness.
    fs.writeFileSync(caminhoSaidaDiff, PNG.sync.write(diffPng));
  }
  return { pixelsDiferentes, motivo: null };
}

/** Devolve `{ ok, totalComDiff, qualquerDiffCelular, dirDiff }` — `ok` é
 * `false` quando há diff>0 numa largura de celular OU a cobertura de telas
 * diverge entre os dois diretórios. Não chama `process.exit`: quem decide o
 * código de saída é o `main()` do CLI, para este núcleo poder ser importado
 * (e testado) sem matar o processo do chamador. */
export function compararDiretorios(
  dirBaseline,
  dirCandidato,
  larguraCelular = LARGURAS_CELULAR_PADRAO,
) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `dirBaseline`/`dirCandidato` vêm de argv do operador (CLI local), nunca de entrada web.
  if (!fs.existsSync(dirBaseline))
    throw new Error(`Diretório baseline não existe: ${dirBaseline}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- mesma garantia acima.
  if (!fs.existsSync(dirCandidato))
    throw new Error(`Diretório candidato não existe: ${dirCandidato}`);

  const arquivosBaseline = new Set(pngsEm(dirBaseline));
  const arquivosCandidato = new Set(pngsEm(dirCandidato));

  const soNoBaseline = [...arquivosBaseline].filter(
    (f) => !arquivosCandidato.has(f),
  );
  const soNoCandidato = [...arquivosCandidato].filter(
    (f) => !arquivosBaseline.has(f),
  );
  const emComum = [...arquivosBaseline]
    .filter((f) => arquivosCandidato.has(f))
    .sort();

  const dirDiff = path.join(
    dirCandidato,
    "..",
    `diff-${path.basename(dirCandidato)}`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `dirDiff` é derivado de `dirCandidato` (argv do operador), nunca de entrada web.
  fs.mkdirSync(dirDiff, { recursive: true });

  const linhasRelatorio = [];
  let qualquerDiffCelular = false;
  let totalComDiff = 0;

  for (const nome of emComum) {
    const largura = larguraDoNome(nome);
    const baselinePng = decodificarPng(path.join(dirBaseline, nome));
    const candidatoPng = decodificarPng(path.join(dirCandidato, nome));
    const caminhoDiff = path.join(dirDiff, nome);
    const { pixelsDiferentes, motivo } = compararUmPar(
      baselinePng,
      candidatoPng,
      caminhoDiff,
    );

    if (pixelsDiferentes > 0) totalComDiff++;
    const ehCelular = largura !== null && larguraCelular.includes(largura);
    if (ehCelular && pixelsDiferentes > 0) qualquerDiffCelular = true;

    linhasRelatorio.push(
      `${nome}\t${pixelsDiferentes} px diferentes${motivo ? `\t(${motivo})` : ""}${ehCelular ? "\t[CELULAR]" : ""}`,
    );
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `dirDiff` é derivado de `dirCandidato` (argv do operador), nunca de entrada web.
  fs.writeFileSync(
    path.join(dirDiff, "relatorio.txt"),
    [
      `baseline: ${dirBaseline}`,
      `candidato: ${dirCandidato}`,
      "",
      ...linhasRelatorio,
      "",
      `só no baseline: ${soNoBaseline.join(", ") || "(nenhum)"}`,
      `só no candidato: ${soNoCandidato.join(", ") || "(nenhum)"}`,
    ].join("\n"),
    "utf8",
  );

  return {
    ok:
      !qualquerDiffCelular &&
      soNoBaseline.length === 0 &&
      soNoCandidato.length === 0,
    qualquerDiffCelular,
    totalComDiff,
    totalComparado: emComum.length,
    soNoBaseline,
    soNoCandidato,
    dirDiff,
    linhasRelatorio,
  };
}

function main() {
  const { dirBaseline, dirCandidato, larguraCelular } = lerArgumentos(
    process.argv.slice(2),
  );
  const resultado = compararDiretorios(
    dirBaseline,
    dirCandidato,
    larguraCelular,
  );

  console.log(`Comparados: ${resultado.totalComparado} arquivo(s) em comum.`);
  console.log(resultado.linhasRelatorio.join("\n"));
  if (resultado.soNoBaseline.length > 0) {
    console.log(`\nSó no baseline (${resultado.soNoBaseline.length}):`);
    console.log(resultado.soNoBaseline.sort().join("\n"));
  }
  if (resultado.soNoCandidato.length > 0) {
    console.log(`\nSó no candidato (${resultado.soNoCandidato.length}):`);
    console.log(resultado.soNoCandidato.sort().join("\n"));
  }
  console.log(
    `\nTotal com diff > 0: ${resultado.totalComDiff} de ${resultado.totalComparado}.`,
  );
  console.log(`Diff PNGs (quando houver) em: ${resultado.dirDiff}`);

  if (resultado.qualquerDiffCelular) {
    console.error(
      "\nFALHOU: diff > 0 pixels em pelo menos uma largura de celular.",
    );
    process.exit(1);
  }
  if (resultado.soNoBaseline.length > 0 || resultado.soNoCandidato.length > 0) {
    console.error(
      "\nFALHOU: cobertura de telas divergente entre baseline e candidato.",
    );
    process.exit(1);
  }
  console.log("\nOK: 0 px de diferença em todas as larguras de celular.");
}

const ehCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehCli) main();

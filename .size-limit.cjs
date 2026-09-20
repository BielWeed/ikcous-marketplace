const fs = require("node:fs");
const path = require("node:path");

const mode = process.env.IKCOUS_IDENTITY_MODE ?? "database";
if (!["database", "fixture"].includes(mode)) throw new Error("IDENTITY_MODE");
const output = mode === "fixture" ? "dist-test" : "dist";
// Measure only a completed delivery of the explicitly selected source.
const version = JSON.parse(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Output comes only from the closed database/fixture mode selection above.
  fs.readFileSync(path.join(__dirname, output, "version.json"), "utf8"),
);
if (version.source !== mode || version.promotable !== (mode === "database"))
  throw new Error("IDENTITY_OUTPUT: fonte do artefato diverge do modo");

module.exports = [
  {
    // size-limit-16 (A12.2): `webpack: false` é o que faz o checker somar a
    // compressão brotli de CADA arquivo casado — que é o que o CDN entrega
    // (respostas independentes, dicionários próprios). Sem ele, o preset
    // big-lib jogava os ~107 chunks num projeto webpack vazio, re-minificava
    // e comprimia UMA vez: media 606 kB onde a entrega real somava ~777 kB —
    // 170 kB de folga que não existiam, e o portão aprovava no papel uma
    // biblioteca que estouraria o teto na entrega. Medido no fixture build
    // de 19/09/2026: 777 kB por arquivo, dentro do teto de 800 (D8: teto
    // não muda; o número novo não é comparável ao "515 kB" do comentário
    // histórico do ci.yml, que media outra coisa).
    //
    // C2.5 (20/09/2026): o chunk `leitor-zxing-*.js` (glue Emscripten da
    // zxing-wasm) fica FORA desta conta — é carga sob demanda (só quando
    // falta BarcodeDetector nativo, Safari iOS) e tem medida própria abaixo,
    // junto do WASM. Sem a exclusão, o teto do boot pagava ~35 kB que o
    // Android nunca baixa.
    path: [`${output}/assets/*.js`, `!${output}/assets/leitor-zxing-*.js`],
    limit: "800 kB",
    webpack: false,
    // Sem `running: false` o preset tenta MEDIR TEMPO rodando o bundle em
    // Chrome headless — inútil para app de navegador e quebra em runner sem
    // Chrome. O portão é o TAMANHO da entrega, não o tempo de execução.
    running: false,
  },
  { path: `${output}/assets/*.css`, limit: "100 kB", webpack: false },
  {
    // C2.5 (fila do bastão 19/09): o leitor de código de barras do balcão
    // tem medida PRÓPRIA — o glue JS (chunk `leitor-zxing-*.js`, nome
    // garantido pelo manualChunks do vite.config) SOMADO ao binário WASM
    // que o vite emite do export do pacote. Os dois só viajam juntos e só
    // para quem não tem leitor nativo; medido na 3.1.4: 332.45 kB (glue
    // ~34 kB + wasm brotli) — o limite deixa folga mínima para reposição
    // de versão do pacote que não mude o contrato; subir além é decisão
    // consciente, como qualquer teto daqui. O nome previsível do chunk é o
    // que permite excluí-lo da conta do boot acima.
    path: [`${output}/assets/leitor-zxing-*.js`, `${output}/assets/*.wasm`],
    limit: "400 kB",
    webpack: false,
    running: false,
  },
];

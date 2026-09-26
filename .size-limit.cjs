const fs = require("node:fs");
const path = require("node:path");
const {
  validarClassificacaoContraDisco,
} = require("./scripts/validarPortaoDeTamanho.cjs");

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

const ARQUIVO_DO_LEITOR_ZXING = /^leitor-zxing-.*\.js$/;

// Portão de tamanho DIVIDIDO (decisão do dono Gabriel, 26/09/2026, respondendo
// "o portão de tamanho soma TODO o JS… como resolver?"): a soma única estourava
// porque JS só do painel (Financeiro, CRM, Devoluções — PR #666) entrava na
// MESMA conta do que qualquer visitante baixa. `scripts/portaoDividido.ts`
// classifica os chunks a partir do grafo REAL do Rollup (`generateBundle`,
// nunca por nome de arquivo) e grava `${output}` fora da entrega; aqui a
// leitura é FAIL-CLOSED: falta o arquivo, versão de esquema errada, ou o
// conjunto de `assets/*.js` do disco (sem o leitor zxing) diferente da união
// cliente∪painel — qualquer um desses aborta `npm run size` em vez de deixar
// um chunk sem contar em teto nenhum.
const classificacaoPath = path.join(
  __dirname,
  ".portao-tamanho",
  `${output}.json`,
);
let classificacaoBruta;
try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminho fechado: raiz + ".portao-tamanho" + saída "dist"/"dist-test" validada acima.
  classificacaoBruta = fs.readFileSync(classificacaoPath, "utf8");
} catch (error) {
  throw new Error(
    `PORTAO_TAMANHO: ${classificacaoPath} ausente — rode \`npm run build\` (o plugin portaoDividido grava esse arquivo em generateBundle) antes de \`npm run size\`. Causa original: ${error.message}`,
  );
}
const classificacao = JSON.parse(classificacaoBruta);

const assetsDir = path.join(__dirname, output, "assets");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Mesmo caminho fechado acima, só descendo para o subdiretório fixo "assets".
const arquivosJs = fs
  .readdirSync(assetsDir)
  .filter((nome) => nome.endsWith(".js") && !ARQUIVO_DO_LEITOR_ZXING.test(nome))
  .map((nome) => `assets/${nome}`);

const { cliente, painel } = validarClassificacaoContraDisco(
  classificacao,
  arquivosJs,
);

module.exports = [
  {
    // D8 (herdado): teto do que QUALQUER visitante da loja pode baixar —
    // nunca inclui o que só existe atrás do `is_admin` do servidor (ver
    // `scripts/portaoDividido.ts`). Antes desta divisão o mesmo teto de
    // 800 kB somava também o painel; o número não mudou, só o que ele mede.
    //
    // size-limit-16 (A12.2, preservado): `webpack: false` é o que faz o
    // checker somar a compressão brotli de CADA arquivo casado — que é o
    // que o CDN entrega (respostas independentes, dicionários próprios).
    // Sem ele, o preset big-lib jogava os chunks num projeto webpack vazio,
    // re-minificava e comprimia UMA vez, criando folga que não existe na
    // entrega real.
    path: cliente.map((arquivo) => `${output}/${arquivo}`),
    limit: "800 kB",
    webpack: false,
    // Sem `running: false` o preset tenta MEDIR TEMPO rodando o bundle em
    // Chrome headless — inútil para app de navegador e quebra em runner sem
    // Chrome. O portão é o TAMANHO da entrega, não o tempo de execução.
    running: false,
  },
  {
    // Painel (novo, 26/09/2026): só o que fica atrás do portão do admin
    // (`AdminAreaGate` -> `AdminArea.tsx` -> `src/views/admin/**`) — o lojista
    // baixa depois de o servidor confirmar `is_admin`, nunca um visitante da
    // loja. O teto de 350 kB é a decisão do dono, não uma medida que já
    // fecha: no fixture build de 26/09/2026 (HEAD 03f3eb76, antes desta
    // tarefa tocar qualquer tela) o painel já media 402,44 kB — 52,44 kB
    // ACIMA do teto. É dívida herdada (Financeiro, CRM, Devoluções do PR
    // #666, ~78 kB), não introduzida por esta divisão; o portão dividido só
    // parou de escondê-la debaixo do teto único de cliente. Resolver é
    // decisão do dono: subir o teto ou cortar peso do painel.
    path: painel.map((arquivo) => `${output}/${arquivo}`),
    limit: "350 kB",
    webpack: false,
    running: false,
  },
  { path: `${output}/assets/*.css`, limit: "100 kB", webpack: false },
  {
    // C2.5 (fila do bastão 19/09, preservado): o leitor de código de barras
    // do balcão tem medida PRÓPRIA — o glue JS (chunk `leitor-zxing-*.js`,
    // nome garantido pelo manualChunks do vite.config) SOMADO ao binário WASM
    // que o vite emite do export do pacote. Os dois só viajam juntos e só
    // para quem não tem leitor nativo; medido na 3.1.4: 332.45 kB (glue
    // ~34 kB + wasm brotli) — o limite deixa folga mínima para reposição
    // de versão do pacote que não mude o contrato; subir além é decisão
    // consciente, como qualquer teto daqui. O nome previsível do chunk é o
    // que permite excluí-lo da conta de cliente/painel acima.
    path: [`${output}/assets/leitor-zxing-*.js`, `${output}/assets/*.wasm`],
    limit: "400 kB",
    webpack: false,
    running: false,
  },
];

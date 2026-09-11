// Ensaio OPT-IN (fora do CI): sobe o Wrangler 4.130.0 congelado do A7a2 sobre
// um `dist-test` REAL (a entrega gerada por scripts/hospedagem.mjs /
// scripts/buildStore.mjs) e mede o comportamento observável do adaptador de
// hospedagem Cloudflare Pages. Ver README.md para o que isto prova e o que
// NÃO prova.
//
// Sem IKCOUS_PAGES_RUNTIME e IKCOUS_PAGES_DIST: HOSPEDAGEM_PAGES_SKIPPED,
// saída 0 — é o padrão fora de uma execução deliberada.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import fs from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import path from "node:path";

const RUNTIME = process.env.IKCOUS_PAGES_RUNTIME;
const DIST = process.env.IKCOUS_PAGES_DIST;

if (!RUNTIME || !DIST) {
  console.log("HOSPEDAGEM_PAGES_SKIPPED");
  process.exit(0);
}

// Node embarcado que o A7a3 usou para provar o mesmo runtime congelado
// (Wrangler 4.130.0 / workerd 1.20260908.1). Se não existir nesta máquina,
// cai para o node que está rodando este próprio script (registrado em
// ambiente.json, nunca escondido).
const NODE_CONGELADO =
  "C:/Users/Gabriel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe";
// Mesma data usada pelo A7a3 contra este runtime congelado (o par
// Wrangler/workerd é vintage; datas mais novas não existem para ele).
const DATA_DE_COMPATIBILIDADE = "2026-09-08";
const CENTRAL =
  "C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous/controle";
const UA_NAO_ROBO = "ikcous-hospedagem-pages-bench/1.0";
const UA_ROBO = "WhatsApp/2.24.1.78 A";
// UUID sintético só para exercitar idValido(); a conexão do fixture é
// `kind:"none"`, então nenhum id chega a ser usado numa consulta real.
const ID_UUID_FIXTURE = "11111111-1111-1111-1111-111111111111";
const QUERIES = [
  "/product-detail?id=produto-a%2Fb&origem=teste",
  "/product-detail/?id=produto-a",
  "/auth?type=recovery&amostra=a%2Bb",
  "/admin/orders/?id=pedido-a",
  "/?source=pwa",
];
const CAMINHOS_AUSENTES = [
  "/missing.js",
  "/assets/missing.js",
  "/store-identity/v1/inexistente/logo.svg",
];
const CAMINHOS_DESCONHECIDOS = [
  "/catalogo/rota-profunda",
  "/product-detail-extra",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function gerarRunId() {
  const carimbo = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "");
  return `${carimbo}-${randomBytes(2).toString("hex")}`;
}

function portoLivre() {
  return new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.on("error", reject);
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      servidor.close((erro) => (erro ? reject(erro) : resolve(port)));
    });
  });
}

function portaFechada(porta) {
  return new Promise((resolve) => {
    const soquete = createConnection({
      host: "127.0.0.1",
      port: porta,
      timeout: 1000,
    });
    const concluir = (fechada) => {
      soquete.removeAllListeners();
      soquete.destroy();
      resolve(fechada);
    };
    soquete.once("connect", () => concluir(false));
    soquete.once("timeout", () => concluir(true));
    soquete.once("error", () => concluir(true));
  });
}

async function montarAmbiente(controlDir, pastaDoNode) {
  const perfil = path.join(controlDir, "profile");
  const config = path.join(controlDir, "config");
  const cache = path.join(controlDir, "cache");
  const temp = path.join(controlDir, "temp");
  const logsWrangler = path.join(controlDir, "logs", "wrangler");
  const npmCache = path.join(controlDir, "npm-cache");
  const pastas = {
    USERPROFILE: perfil,
    APPDATA: path.join(perfil, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(perfil, "AppData", "Local"),
    TEMP: temp,
    TMP: temp,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    WRANGLER_CACHE_DIR: path.join(cache, "wrangler"),
    WRANGLER_LOG_PATH: logsWrangler,
  };
  for (const pasta of Object.values(pastas)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- pasta vem só de controlDir, criado por este processo com runId próprio.
    await fs.mkdir(pasta, { recursive: true });
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- npmCache vem só de controlDir, criado por este processo com runId próprio.
  await fs.mkdir(npmCache, { recursive: true });
  const npmrcUsuario = path.join(config, "user.npmrc");
  const npmrcGlobal = path.join(config, "global.npmrc");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- npmrcUsuario vem só de controlDir, criado por este processo com runId próprio.
  await fs.writeFile(npmrcUsuario, "");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- npmrcGlobal vem só de controlDir, criado por este processo com runId próprio.
  await fs.writeFile(npmrcGlobal, "");
  return {
    SystemRoot: "C:\\Windows",
    WINDIR: "C:\\Windows",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    PATH: `${pastaDoNode};C:\\Windows\\System32;C:\\Windows`,
    ...pastas,
    NPM_CONFIG_USERCONFIG: npmrcUsuario,
    NPM_CONFIG_GLOBALCONFIG: npmrcGlobal,
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    // Lista permitida do A7a3 (molde): sem token, sem métrica, sem update.
    WRANGLER_SEND_METRICS: "false",
    DO_NOT_TRACK: "1",
    WRANGLER_SEND_ERROR_REPORTS: "false",
    WRANGLER_HIDE_BANNER: "true",
    WRANGLER_NO_SKILLS_UPDATE_PROMPTS: "true",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    CI: "true",
    TERM: "dumb",
    NO_COLOR: "1",
  };
}

// Espelha os arquivos reais gravados por scripts/hospedagem.mjs; nunca
// reescreve a lista de telas na mão (isso seria uma segunda cópia divergente
// da entrega real, o oposto do que este ensaio existe para provar).
async function lerFormasDeEntrada(distDir) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- distDir vem só de IKCOUS_PAGES_DIST, variável do próprio ensaio.
  const bruto = await fs.readFile(path.join(distDir, "_redirects"), "utf8");
  return bruto
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => linha.split(" ")[0]);
}

async function escolherAssetJs(distDir) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- distDir vem só de IKCOUS_PAGES_DIST, variável do próprio ensaio.
  const arquivos = await fs.readdir(path.join(distDir, "assets"));
  const js = arquivos.find((nome) => nome.endsWith(".js"));
  if (!js) throw new Error("HOSPEDAGEM_PAGES_SEM_ASSET_JS");
  return `/assets/${js}`;
}

async function escolherIdentidadeReal(distDir) {
  const raiz = path.join(distDir, "store-identity", "v1");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- distDir vem só de IKCOUS_PAGES_DIST, variável do próprio ensaio.
  const revisoes = await fs.readdir(raiz);
  if (revisoes.length === 0) throw new Error("HOSPEDAGEM_PAGES_SEM_IDENTIDADE");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- revisoes[0] vem da listagem acima do próprio dist-test, não de entrada externa.
  const arquivos = await fs.readdir(path.join(raiz, revisoes[0]));
  return `/store-identity/v1/${revisoes[0]}/${arquivos[0]}`;
}

async function pedir(porta, caminho, { metodo = "GET", cabecalhos = {} } = {}) {
  const resposta = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    redirect: "manual",
  });
  const bruto =
    metodo === "HEAD"
      ? new Uint8Array(0)
      : new Uint8Array(await resposta.arrayBuffer());
  return {
    caminho,
    metodo,
    status: resposta.status,
    cabecalhos: [...resposta.headers.entries()],
    corpoSha256: sha256(bruto),
    bytes: bruto.byteLength,
  };
}

function cabecalho(row, nome) {
  const alvo = nome.toLowerCase();
  const achado = row.cabecalhos.find(([chave]) => chave.toLowerCase() === alvo);
  return achado ? achado[1] : null;
}

// Um único avaliador para toda a matriz: rota estática, query, ausente,
// desconhecida, asset e robô diferem só nos VALORES esperados, nunca na
// lógica de conferência.
function conferirResposta(row, esperado) {
  const erros = [];
  if (row.status !== esperado.status) erros.push("STATUS");
  if (cabecalho(row, "location") !== null) erros.push("REDIRECT");
  const invocada = cabecalho(row, "x-ikcous-og") !== null;
  if (invocada !== esperado.funcao) erros.push("INVOCATION");
  if (
    esperado.motivo !== undefined &&
    cabecalho(row, "x-ikcous-og") !== esperado.motivo
  )
    erros.push("OG_MOTIVO");
  if (row.metodo === "HEAD") {
    if (row.bytes !== 0) erros.push("HEAD_BODY");
  } else if (row.corpoSha256 !== esperado.corpoSha256) {
    erros.push("BODY_HASH");
  }
  if (esperado.cacheInclui) {
    const cc = (cabecalho(row, "cache-control") ?? "").toLowerCase();
    for (const trecho of esperado.cacheInclui)
      if (!cc.includes(trecho)) erros.push("CACHE_CONTROL");
  }
  return erros;
}

const rotaEhFuncao = (caminho) =>
  caminho === "/product-detail" || caminho === "/product-detail/";

async function esperarPronto(processo, porta, registrar) {
  const prazo = Date.now() + 45000;
  for (;;) {
    if (processo.exitCode !== null)
      throw new Error(
        `HOSPEDAGEM_PAGES_SERVIDOR_SAIU exit=${processo.exitCode}`,
      );
    try {
      const row = await pedir(porta, "/", {
        cabecalhos: { "User-Agent": UA_NAO_ROBO },
      });
      if (row.status === 200) {
        await registrar("pronto", row);
        return;
      }
    } catch {
      // Servidor ainda não aceita conexão; tenta de novo até o prazo.
    }
    if (Date.now() > prazo) throw new Error("HOSPEDAGEM_PAGES_TIMEOUT_READY");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function encerrarProcesso(processo, registro, porta, inspetor) {
  if (processo.exitCode === null) {
    const fim = spawnSync(
      "C:/Windows/System32/taskkill.exe",
      ["/PID", String(processo.pid), "/T", "/F"],
      { windowsHide: true, encoding: "utf8" },
    );
    registro.taskkillCodigo = fim.status;
    registro.taskkillStdout = fim.stdout;
    registro.taskkillStderr = fim.stderr;
    await new Promise((resolve) => processo.once("exit", resolve));
  }
  registro.codigoDeSaida = processo.exitCode;
  await new Promise((resolve) => setTimeout(resolve, 300));
  registro.portaFechada = await portaFechada(porta);
  registro.inspetorFechada = await portaFechada(inspetor);
}

async function main() {
  const runId = gerarRunId();
  const controlDir = path.join(CENTRAL, `tarefa-A7c-${runId}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- controlDir é CENTRAL + runId gerado por este processo, nunca entrada externa.
  await fs.mkdir(controlDir, { recursive: true });

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST vem só de IKCOUS_PAGES_DIST, variável do próprio ensaio.
  assert(existsSync(DIST), `HOSPEDAGEM_PAGES_DIST_AUSENTE ${DIST}`);
  const wranglerJs = path.join(
    RUNTIME,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  assert(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- wranglerJs vem só de IKCOUS_PAGES_RUNTIME, variável do próprio ensaio.
    existsSync(wranglerJs),
    `HOSPEDAGEM_PAGES_WRANGLER_AUSENTE ${wranglerJs}`,
  );

  const nodeCongeladoExiste = existsSync(NODE_CONGELADO);
  const nodeBin = nodeCongeladoExiste ? NODE_CONGELADO : process.execPath;
  const origemDoNode = nodeCongeladoExiste
    ? "congelado-a7a2-a7a3"
    : `path-fallback:${process.execPath}`;
  const ambiente = await montarAmbiente(controlDir, path.dirname(nodeBin));
  const versaoNode = spawnSync(nodeBin, ["--version"], {
    env: ambiente,
    encoding: "utf8",
  }).stdout.trim();

  const respostasPath = path.join(controlDir, "responses.json");
  const checksPath = path.join(controlDir, "checks.json");
  const processesPath = path.join(controlDir, "processes.json");
  const RESPOSTAS = [];
  const CHECKS = [];
  const PROCESSOS = [];
  const salvar = async (caminho, valor) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- os três caminhos vêm só de controlDir, criado por este processo com runId próprio.
    fs.writeFile(caminho, `${JSON.stringify(valor, null, 2)}\n`);

  await salvar(path.join(controlDir, "ambiente.json"), {
    ...ambiente,
    nodeBin,
    origemDoNode,
    versaoNode,
    runtime: RUNTIME,
    dist: DIST,
  });

  const registrarResposta = async (rotulo, row) => {
    RESPOSTAS.push({ rotulo, ...row });
    await salvar(respostasPath, RESPOSTAS);
  };
  const registrarCheck = async (rotulo, caminho, esperado, row) => {
    const erros = conferirResposta(row, esperado);
    CHECKS.push({
      rotulo,
      caminho,
      metodo: row.metodo,
      status: row.status,
      erros,
    });
    await salvar(checksPath, CHECKS);
    return erros;
  };
  const varrerPar = async (
    porta,
    caminho,
    rotulo,
    esperado,
    cabecalhosExtra,
  ) => {
    for (const metodo of ["GET", "HEAD"]) {
      const row = await pedir(porta, caminho, {
        metodo,
        cabecalhos: cabecalhosExtra,
      });
      await registrarResposta(rotulo, row);
      await registrarCheck(rotulo, caminho, esperado, row);
    }
  };

  const formasDeEntrada = ["/", ...(await lerFormasDeEntrada(DIST))];
  assert.strictEqual(
    formasDeEntrada.length,
    109,
    `HOSPEDAGEM_PAGES_INVENTARIO_INESPERADO ${formasDeEntrada.length}`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST vem só de IKCOUS_PAGES_DIST, variável do próprio ensaio.
  const indexHtml = await fs.readFile(path.join(DIST, "index.html"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST vem só de IKCOUS_PAGES_DIST, variável do próprio ensaio.
  const doc404 = await fs.readFile(path.join(DIST, "404.html"));
  const shaIndex = sha256(indexHtml);
  assert.strictEqual(
    sha256(doc404),
    shaIndex,
    "HOSPEDAGEM_PAGES_404_DIVERGENTE",
  );

  const assetJsCaminho = await escolherAssetJs(DIST);
  const identidadeCaminho = await escolherIdentidadeReal(DIST);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- assetJsCaminho vem da listagem do próprio dist-test, não de entrada externa.
  const assetJsBytes = await fs.readFile(
    path.join(DIST, assetJsCaminho.slice(1)),
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- identidadeCaminho vem da listagem do próprio dist-test, não de entrada externa.
  const identidadeBytes = await fs.readFile(
    path.join(DIST, identidadeCaminho.slice(1)),
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST vem só de IKCOUS_PAGES_DIST, variável do próprio ensaio.
  const versionJsonBytes = await fs.readFile(path.join(DIST, "version.json"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST vem só de IKCOUS_PAGES_DIST, variável do próprio ensaio.
  const swJsBytes = await fs.readFile(path.join(DIST, "sw.js"));

  const porta = await portoLivre();
  let inspetor = await portoLivre();
  while (inspetor === porta) inspetor = await portoLivre();
  const stateDir = path.join(controlDir, "state");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- stateDir vem só de controlDir, criado por este processo com runId próprio.
  await fs.mkdir(stateDir, { recursive: true });
  const logDir = path.join(controlDir, "logs");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- logDir vem só de controlDir, criado por este processo com runId próprio.
  await fs.mkdir(logDir, { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- logDir vem só de controlDir, criado por este processo com runId próprio.
  const stdoutFd = openSync(path.join(logDir, "wrangler.stdout"), "w");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- logDir vem só de controlDir, criado por este processo com runId próprio.
  const stderrFd = openSync(path.join(logDir, "wrangler.stderr"), "w");

  const args = [
    wranglerJs,
    "pages",
    "dev",
    DIST,
    "--ip",
    "127.0.0.1",
    "--port",
    String(porta),
    "--inspector-port",
    String(inspetor),
    "--compatibility-date",
    DATA_DE_COMPATIBILIDADE,
    "--local-protocol",
    "http",
    "--persist-to",
    stateDir,
    "--show-interactive-dev-session=false",
    "--install-skills=false",
    "--log-level",
    "info",
  ];
  const processo = spawn(nodeBin, args, {
    cwd: controlDir,
    env: ambiente,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
  });
  const registro = {
    rotulo: "wrangler-pages-dev",
    pid: processo.pid,
    porta,
    inspetor,
    comando: args,
    nodeBin,
    cwd: controlDir,
  };
  PROCESSOS.push(registro);
  await salvar(processesPath, PROCESSOS);

  // Ctrl+C no meio do ensaio: sem isto o Node sai sem passar pelo finally e o
  // wrangler/workerd ficam órfãos segurando a porta numa máquina de pouca RAM.
  const aoSinal = (sinal) => {
    if (processo.exitCode === null) {
      spawnSync(
        "C:/Windows/System32/taskkill.exe",
        ["/PID", String(processo.pid), "/T", "/F"],
        { windowsHide: true },
      );
    }
    console.error(`HOSPEDAGEM_PAGES_INTERROMPIDO ${sinal}`);
    process.exit(130);
  };
  process.once("SIGINT", aoSinal);
  process.once("SIGTERM", aoSinal);

  try {
    try {
      await esperarPronto(processo, porta, registrarResposta);

      for (const caminho of formasDeEntrada) {
        const funcao = rotaEhFuncao(caminho);
        await varrerPar(
          porta,
          caminho,
          "entrada",
          {
            status: 200,
            funcao,
            motivo: funcao ? "passa" : undefined,
            corpoSha256: shaIndex,
          },
          { "User-Agent": UA_NAO_ROBO },
        );
      }
      for (const consulta of QUERIES) {
        const semQuery = consulta.split("?")[0];
        const funcao = rotaEhFuncao(semQuery);
        await varrerPar(
          porta,
          consulta,
          "query",
          {
            status: 200,
            funcao,
            motivo: funcao ? "passa" : undefined,
            corpoSha256: shaIndex,
          },
          { "User-Agent": UA_NAO_ROBO },
        );
      }
      for (const caminho of CAMINHOS_AUSENTES) {
        await varrerPar(
          porta,
          caminho,
          "ausente",
          {
            status: 404,
            funcao: false,
            corpoSha256: shaIndex,
            cacheInclui: ["no-store"],
          },
          { "User-Agent": UA_NAO_ROBO },
        );
      }
      for (const caminho of CAMINHOS_DESCONHECIDOS) {
        await varrerPar(
          porta,
          caminho,
          "desconhecida",
          { status: 404, funcao: false, corpoSha256: shaIndex },
          { "User-Agent": UA_NAO_ROBO },
        );
      }
      const ativos = [
        {
          caminho: "/version.json",
          bytes: versionJsonBytes,
          cacheInclui: ["no-store"],
        },
        { caminho: "/sw.js", bytes: swJsBytes },
        {
          caminho: assetJsCaminho,
          bytes: assetJsBytes,
          cacheInclui: ["immutable", "max-age=31536000"],
        },
        { caminho: identidadeCaminho, bytes: identidadeBytes },
      ];
      for (const ativo of ativos) {
        await varrerPar(
          porta,
          ativo.caminho,
          "estatico",
          {
            status: 200,
            funcao: false,
            corpoSha256: sha256(ativo.bytes),
            cacheInclui: ativo.cacheInclui,
          },
          { "User-Agent": UA_NAO_ROBO },
        );
      }

      const roboCaminho = `/product-detail?id=${ID_UUID_FIXTURE}`;
      const roboRow = await pedir(porta, roboCaminho, {
        cabecalhos: { "User-Agent": UA_ROBO },
      });
      await registrarResposta("robo", roboRow);
      await registrarCheck(
        "robo",
        roboCaminho,
        {
          status: 200,
          funcao: true,
          motivo: "sem-produto",
          corpoSha256: shaIndex,
        },
        roboRow,
      );
    } finally {
      await encerrarProcesso(processo, registro, porta, inspetor);
      process.off("SIGINT", aoSinal);
      process.off("SIGTERM", aoSinal);
      await salvar(processesPath, PROCESSOS);
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
  } catch (erro) {
    await salvar(path.join(controlDir, "failure.json"), {
      erro: String(erro?.stack ?? erro),
      responses: RESPOSTAS.length,
      checks: CHECKS.length,
    });
    throw erro;
  }

  const rejeicoes = CHECKS.filter((item) => item.erros.length > 0);
  await salvar(path.join(controlDir, "result.json"), {
    runId,
    controlDir,
    dist: DIST,
    runtime: RUNTIME,
    checks: CHECKS.length,
    rejections: rejeicoes.length,
    processoEncerrado: registro.portaFechada && registro.inspetorFechada,
  });
  console.log(`pasta de controle: ${controlDir}`);
  if (rejeicoes.length > 0) {
    console.log(`HOSPEDAGEM_PAGES_REJECTIONS ${JSON.stringify(rejeicoes)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`HOSPEDAGEM_PAGES_PASS checks=${CHECKS.length} rejections=0`);
}

main().catch((erro) => {
  console.error("HOSPEDAGEM_PAGES_ERRO", erro?.stack ?? String(erro));
  process.exitCode = 1;
});

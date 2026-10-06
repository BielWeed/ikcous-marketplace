// SERVIDOR DE PREVIEW DAS JORNADAS COM REGISTRO EM ARQUIVO (04/10/2026).
//
// Sobe o MESMO `vite preview` de antes (127.0.0.1:4173, porta estrita) e
// grava tudo o que ele diz — com hora — num arquivo POR RODADA:
// `test-results/preview-logs/preview-<rodada>.log`. Motivo: uma rodada das
// jornadas de pagamento ficou vermelha sem deixar log; a hipótese mais forte
// (servidor morto no meio) só se prova com a hora em que ele parou. Por isso:
//
//  - cada linha do vite sai com hora;
//  - um BATIMENTO a cada 10 s grava a memória livre da máquina — se o arquivo
//    parar de bater, o processo foi morto de fora (o `exit` nem chega);
//  - a saída do vite (código/sinal) e os sinais recebidos são gravados.
//
// O que NÃO entra: variáveis de ambiente, argumentos com chave, corpo de
// requisição. O vite preview só imprime os endereços em que escuta.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "../..");
const rodada = (process.env.IKCOUS_E2E_RODADA ?? "sem-rodada").replace(
  /[^\w.-]/g,
  "_",
);
const pasta = path.join(raiz, "test-results", "preview-logs");
fs.mkdirSync(pasta, { recursive: true });
const arquivo = path.join(pasta, `preview-${rodada}.log`);

function registrar(texto) {
  const linha = `${new Date().toISOString()} ${texto}\n`;
  // Síncrono de propósito: se o processo for morto logo depois, a linha já
  // está no disco.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado aqui mesmo (raiz do repo + rodada saneada), nunca entrada de usuário.
  fs.appendFileSync(arquivo, linha);
  process.stdout.write(linha);
}

const memoriaLivreMb = () => Math.round(os.freemem() / 1024 / 1024);

registrar(
  `[registro] subindo vite preview (pid do registro ${process.pid}, memória livre ${memoriaLivreMb()} MB)`,
);

const vite = spawn(
  process.execPath,
  [
    path.join(raiz, "node_modules", "vite", "bin", "vite.js"),
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ],
  { cwd: raiz, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
registrar(`[registro] vite preview pid ${vite.pid}`);

for (const [nome, fluxo] of [
  ["stdout", vite.stdout],
  ["stderr", vite.stderr],
]) {
  let resto = "";
  fluxo.on("data", (pedaco) => {
    resto += pedaco.toString("utf8");
    const linhas = resto.split(/\r?\n/);
    resto = linhas.pop() ?? "";
    for (const linha of linhas)
      if (linha.trim()) registrar(`[${nome}] ${linha}`);
  });
}

const batimento = setInterval(() => {
  registrar(`[batimento] vivo; memória livre ${memoriaLivreMb()} MB`);
}, 10_000);

vite.on("exit", (codigo, sinal) => {
  clearInterval(batimento);
  registrar(
    `[registro] vite preview ENCERROU: código ${codigo}, sinal ${sinal ?? "nenhum"}`,
  );
  process.exit(codigo ?? 1);
});

for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => {
    registrar(`[registro] sinal ${sinal} recebido; encerrando o vite preview`);
    vite.kill();
  });
}

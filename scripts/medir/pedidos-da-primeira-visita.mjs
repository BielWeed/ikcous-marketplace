#!/usr/bin/env node
/**
 * Mede quantos pedidos a PRIMEIRA visita de uma loja faz à rede (plano "a
 * primeira visita deixa de baixar o app inteiro", 26/11/2026). Cada pedido que
 * chega ao CDN é um "CDN Request" da Vercel; o grosso da primeira visita é o
 * service worker baixando o app inteiro no `install` (precache).
 *
 * Uso:
 *   node scripts/medir/pedidos-da-primeira-visita.mjs <url> [--segunda-visita] [--prazo=<segundos>]
 *
 * - Perfil temporário LIMPO (sem cache, sem service worker), Chrome do
 *   puppeteer sem janela, agente de celular (Pixel 5).
 * - Abre a URL, espera o service worker ficar ativo (ou o prazo, 60 s por
 *   padrão) e mais 3 s sem nenhum pedido novo, e imprime o resumo.
 * - `--segunda-visita`: fecha o navegador e reabre NO MESMO perfil, para medir
 *   a volta (cache e service worker já instalados).
 *
 * A conta (o que é rede e o que é cache) é `classificarPedidos.mjs`, testada em
 * `tests/front/medir-pedidos-separa-rede-de-cache.test.ts`.
 *
 * Por que o service worker é anexado à mão: o puppeteer se desanexa dos
 * service workers e os deixa rodar antes de avisar que existem; anexar depois
 * perderia o começo do `install`, que é justamente o que se quer contar. Aqui
 * uma sessão no alvo do navegador pede `Target.setAutoAttach` com
 * `waitForDebuggerOnStart`: o service worker nasce PARADO, a medição liga o
 * domínio Network nele e só então o deixa rodar.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer, { KnownDevices } from "puppeteer";
import { classificarPedidos } from "./classificarPedidos.mjs";

const CELULAR = KnownDevices["Pixel 5"];
const PRAZO_PADRAO_S = 60;
const SILENCIO_MS = 3000;
const FECHAR_EM_MS = 10_000;
const METODOS = [
  "Network.requestWillBeSent",
  "Network.responseReceived",
  "Network.requestServedFromCache",
  "Network.loadingFailed",
  "Network.loadingFinished",
];

function lerArgumentos(argv) {
  const opcoes = { url: null, segundaVisita: false, prazoS: PRAZO_PADRAO_S };
  for (const arg of argv) {
    if (arg === "--segunda-visita") opcoes.segundaVisita = true;
    else if (arg.startsWith("--prazo=")) {
      const s = Number(arg.slice("--prazo=".length));
      if (!Number.isFinite(s) || s <= 0)
        throw new Error(`--prazo inválido: ${arg}`);
      opcoes.prazoS = s;
    } else if (arg.startsWith("--"))
      throw new Error(`opção desconhecida: ${arg}`);
    else if (opcoes.url === null) opcoes.url = arg;
    else throw new Error(`argumento a mais: ${arg}`);
  }
  if (!opcoes.url) throw new Error("falta a URL");
  const url = new URL(opcoes.url);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(`só http(s): ${opcoes.url}`);
  opcoes.url = url.href;
  return opcoes;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fecha o navegador; se travar, mata pelo PID (nunca por nome). */
async function fechar(navegador) {
  const pid = navegador.process()?.pid;
  const fechou = await Promise.race([
    navegador.close().then(
      () => true,
      () => false,
    ),
    esperar(FECHAR_EM_MS).then(() => false),
  ]);
  if (!fechou && pid) {
    try {
      process.kill(pid);
    } catch {
      // já saiu
    }
  }
}

async function medirUmaVisita(perfil, url, prazoS) {
  const fimDoPrazo = Date.now() + prazoS * 1000;
  const eventos = [];
  let ultimoEvento = Date.now();
  const anotar = (origem, method) => (params) => {
    eventos.push({ origem, method, params });
    ultimoEvento = Date.now();
  };
  const problemas = [];

  const navegador = await puppeteer.launch({
    headless: true,
    userDataDir: perfil,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  try {
    const raiz = await navegador.target().createCDPSession();
    raiz.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
      const sessao = raiz.connection()?.session(sessionId);
      if (!sessao) {
        problemas.push(`sem sessão para ${targetInfo.url}`);
        return;
      }
      for (const m of METODOS) sessao.on(m, anotar("sw", m));
      sessao
        .send("Network.enable")
        .catch((e) => problemas.push(`Network.enable no SW: ${e.message}`))
        .finally(() =>
          sessao
            .send("Runtime.runIfWaitingForDebugger")
            .catch((e) => problemas.push(`soltar o SW: ${e.message}`)),
        );
    });
    await raiz.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "service_worker" }, { exclude: true }],
    });

    const pagina = await navegador.newPage();
    await pagina.emulate(CELULAR);
    const sessaoDaPagina = await pagina.createCDPSession();
    for (const m of METODOS) sessaoDaPagina.on(m, anotar("pagina", m));
    await sessaoDaPagina.send("Network.enable");

    await pagina.goto(url, {
      waitUntil: "load",
      timeout: Math.max(1000, fimDoPrazo - Date.now()),
    });

    const estadoDoSW = await pagina
      .evaluate(
        async (ms) => {
          if (!("serviceWorker" in navigator)) return "sem suporte";
          const prazo = new Promise((r) => setTimeout(() => r("prazo"), ms));
          const ativo = navigator.serviceWorker.ready.then(async (registro) => {
            const sw = registro.active;
            if (sw && sw.state !== "activated")
              await new Promise((r) =>
                sw.addEventListener("statechange", () => {
                  if (sw.state === "activated") r(undefined);
                }),
              );
            return "ativo";
          });
          return Promise.race([ativo, prazo]);
        },
        Math.max(0, fimDoPrazo - Date.now()),
      )
      .catch((e) => `erro: ${e.message}`);

    // O activate pode reparar o precache depois de "ativo": espera a rede calar.
    while (Date.now() < fimDoPrazo && Date.now() - ultimoEvento < SILENCIO_MS)
      await esperar(250);
    const calou = Date.now() - ultimoEvento >= SILENCIO_MS;

    return {
      estadoDoSW,
      calou,
      problemas,
      resumo: classificarPedidos(eventos),
    };
  } finally {
    await fechar(navegador);
  }
}

function caminhoCurto(url, base) {
  const u = new URL(url);
  return u.origin === base.origin ? `${u.pathname}${u.search}` : url;
}

function contarPorEndereco(urls) {
  const contagem = new Map();
  for (const u of urls) {
    const host = new URL(u).host;
    contagem.set(host, (contagem.get(host) ?? 0) + 1);
  }
  return [...contagem].sort((a, b) => b[1] - a[1]);
}

function imprimir(titulo, url, medicao) {
  const base = new URL(url);
  const { resumo } = medicao;
  const linhas = [
    `${titulo} — ${url}`,
    `  service worker: ${medicao.estadoDoSW}${medicao.calou ? "" : " (a rede NÃO calou até o prazo: número pode estar baixo)"}`,
    `  PEDIDOS À REDE: ${resumo.rede} (página ${resumo.pagina.rede}, service worker ${resumo.sw.rede})`,
    `  página: rede ${resumo.pagina.rede} · cache ${resumo.pagina.cache} · atendidos pelo SW ${resumo.pagina.servidosPeloSW} · falhas ${resumo.pagina.falhas} · sem resposta ${resumo.pagina.semResposta}`,
    `  service worker: rede ${resumo.sw.rede} · cache ${resumo.sw.cache} · falhas ${resumo.sw.falhas} · sem resposta ${resumo.sw.semResposta}`,
  ];
  // Só o que vai ao próprio endereço é "CDN Request" da Vercel; banco, fontes e
  // imagens de outro endereço aparecem separados.
  const proprio = resumo.pagina.urls
    .concat(resumo.sw.urls)
    .filter((u) => new URL(u).host === base.host).length;
  linhas.push(`  ao próprio endereço (${base.host}): ${proprio}`);
  const outros = contarPorEndereco(
    resumo.pagina.urls
      .concat(resumo.sw.urls)
      .filter((u) => new URL(u).host !== base.host),
  );
  if (outros.length > 0)
    linhas.push(
      `  a outros endereços: ${outros.map(([host, n]) => `${host} ${n}`).join(" · ")}`,
    );
  for (const p of medicao.problemas) linhas.push(`  PROBLEMA: ${p}`);
  if (resumo.sw.urls.length > 0) {
    linhas.push(
      `  o que o service worker buscou na rede (${resumo.sw.urls.length}):`,
    );
    for (const u of resumo.sw.urls) linhas.push(`    ${caminhoCurto(u, base)}`);
  }
  console.log(linhas.join("\n"));
}

async function principal() {
  let opcoes;
  try {
    opcoes = lerArgumentos(process.argv.slice(2));
  } catch (e) {
    console.error(
      `${e.message}\nuso: node scripts/medir/pedidos-da-primeira-visita.mjs <url> [--segunda-visita] [--prazo=<segundos>]`,
    );
    process.exitCode = 2;
    return;
  }
  const perfil = await fs.mkdtemp(path.join(os.tmpdir(), "medir-visita-"));
  try {
    const primeira = await medirUmaVisita(perfil, opcoes.url, opcoes.prazoS);
    imprimir("1ª visita (perfil limpo)", opcoes.url, primeira);
    if (opcoes.segundaVisita) {
      const segunda = await medirUmaVisita(perfil, opcoes.url, opcoes.prazoS);
      console.log("");
      imprimir(
        "2ª visita (mesmo perfil, navegador reaberto)",
        opcoes.url,
        segunda,
      );
    }
  } finally {
    await fs
      .rm(perfil, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      })
      .catch(() =>
        console.error(`aviso: não consegui apagar o perfil ${perfil}`),
      );
  }
}

principal().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exitCode = 1;
});

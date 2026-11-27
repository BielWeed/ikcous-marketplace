/* eslint-disable security/detect-non-literal-fs-filename -- grava só na pasta de saída que quem roda a bancada passa na linha de comando. */
// Fotos da bancada da lista de escolha (tarefa 0.16 do plano da lista premium).
//
// O plano pedia Playwright, que não está nas dependências do projeto; este
// script fala com o Chrome instalado direto pelo protocolo de depuração (CDP),
// sem dependência nova. Fora do build, do tsconfig do app e do knip.
//
// Uso (com a bancada no ar: `npx vite --config e2e/lista-premium.vite.config.ts`):
//   node e2e/lista-premium-fotos.mjs <pasta-de-saida> [endereco-base] [chrome]
//
// Para cada tamanho (390×844, 1440×900), tema (Escuro, Claro, Confortável) e
// folha-mãe (FolhaDoPainel, FolhaFinanceira): abre a bancada com a lista
// aberta, mede o z-index COMPUTADO da lista e da folha-mãe e quem está por
// cima no meio da lista (`elementFromPoint`), e salva a foto. 12 fotos.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const saida = process.argv[2];
const base = process.argv[3] ?? "http://127.0.0.1:5199";
const chrome =
  process.argv[4] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!saida) {
  console.error("uso: node e2e/lista-premium-fotos.mjs <pasta-de-saida>");
  process.exit(2);
}
mkdirSync(saida, { recursive: true });

const PORTA = 9333;
const TAMANHOS = [
  { nome: "390x844", width: 390, height: 844, mobile: true },
  { nome: "1440x900", width: 1440, height: 900, mobile: false },
];
const TEMAS = ["escuro", "claro", "confortavel"];
const MAES = [
  { mae: "painel", abrir: "bancada-parcelas" },
  { mae: "financeiro", abrir: "bancada-uf" },
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const perfil = join(tmpdir(), `lista-premium-fotos-${process.pid}`);
const navegador = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${perfil}`,
    `--remote-debugging-port=${PORTA}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function alvo() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}/json/list`);
      const lista = await r.json();
      const pagina = lista.find((t) => t.type === "page");
      if (pagina) return pagina.webSocketDebuggerUrl;
    } catch {
      // o Chrome ainda está subindo
    }
    await esperar(200);
  }
  throw new Error("o Chrome não abriu a porta de depuração");
}

function conectar(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pendentes = new Map();
  const ouvintes = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pendentes.has(msg.id)) {
      const { ok, erro } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      if (msg.error) erro(new Error(JSON.stringify(msg.error)));
      else ok(msg.result);
    } else if (msg.method && ouvintes.has(msg.method)) {
      ouvintes.get(msg.method)(msg.params);
      ouvintes.delete(msg.method);
    }
  };
  const pronto = new Promise((r) => {
    ws.onopen = r;
  });
  return {
    pronto,
    enviar(method, params = {}) {
      id += 1;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((ok, erro) => pendentes.set(id, { ok, erro }));
    },
    uma(method) {
      return new Promise((r) => ouvintes.set(method, r));
    },
    fechar() {
      ws.close();
    },
  };
}

// Roda na página: z-index computado da lista e da folha-mãe, e quem está por
// cima no meio da lista.
const MEDIR = `(() => {
  const lista = document.querySelector('[data-lista-de-escolha="folha"], [data-lista-de-escolha="popover"]');
  const embrulho = lista?.closest('[data-radix-popper-content-wrapper]');
  const mae = [...document.querySelectorAll('[role="dialog"]')].find((d) => !d.hasAttribute('data-lista-de-escolha'));
  const r = lista?.getBoundingClientRect();
  const noMeio = r ? document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 120)) : null;
  return JSON.stringify({
    modo: lista?.dataset.listaDeEscolha ?? null,
    zDaLista: lista ? getComputedStyle(embrulho ?? lista).zIndex : null,
    zDaMae: mae ? getComputedStyle(mae).zIndex : null,
    listaPorCima: !!(noMeio && lista && lista.contains(noMeio)),
    maeAberta: !!mae,
  });
})()`;

const medidas = [];
try {
  const pagina = conectar(await alvo());
  await pagina.pronto;
  await pagina.enviar("Page.enable");
  for (const t of TAMANHOS) {
    await pagina.enviar("Emulation.setDeviceMetricsOverride", {
      width: t.width,
      height: t.height,
      deviceScaleFactor: 2,
      mobile: t.mobile,
    });
    for (const tema of TEMAS) {
      for (const { mae, abrir } of MAES) {
        const url = `${base}/e2e/lista-premium.html?tema=${tema}&mae=${mae}&abrir=${abrir}`;
        const carregou = pagina.uma("Page.loadEventFired");
        await pagina.enviar("Page.navigate", { url });
        await carregou;
        // A bancada abre o campo 400ms depois de montar; a folha anima.
        await esperar(1500);
        const { result } = await pagina.enviar("Runtime.evaluate", {
          expression: MEDIR,
          returnByValue: true,
        });
        const medida = {
          tamanho: t.nome,
          tema,
          mae,
          ...JSON.parse(result.value),
        };
        const { data } = await pagina.enviar("Page.captureScreenshot", {
          format: "png",
        });
        const arquivo = `lista-${t.nome}-${tema}-${mae}.png`;
        writeFileSync(join(saida, arquivo), Buffer.from(data, "base64"));
        medidas.push({ arquivo, ...medida });
        console.log(JSON.stringify({ arquivo, ...medida }));
      }
    }
  }
  pagina.fechar();
  writeFileSync(
    join(saida, "medidas.json"),
    `${JSON.stringify(medidas, null, 2)}\n`,
  );
} finally {
  // Só pelo PID, com a árvore do Chrome junto (no Windows o `kill()` deixa os
  // processos filhos vivos e o script não termina).
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(navegador.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    navegador.kill();
  }
}
process.exit(0);

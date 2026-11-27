/* eslint-disable security/detect-non-literal-fs-filename -- grava só na pasta de saída que quem roda a bancada passa na linha de comando. */
// Fotos da bancada da lista de escolha (tarefas 0.16 e Z.4 do plano da lista
// premium).
//
// O plano pedia Playwright, que não está nas dependências do projeto; este
// script fala com o Chrome instalado direto pelo protocolo de depuração (CDP),
// sem dependência nova. Fora do build, do tsconfig do app e do knip.
//
// Uso (com a bancada no ar: `npx vite --config e2e/lista-premium.vite.config.ts`):
//   node e2e/lista-premium-fotos.mjs <pasta-de-saida> [endereco-base] [chrome] [--maes] [--so=<tela>]
//
// Padrão (Z.4): para cada tela de verdade da bancada (`?tela=`), tamanho
// (390×844, 1440×900) e tema (Escuro, Claro, Confortável), abre a lista PELO
// TECLADO (foco no campo + ↓, como a lojista no computador) — é assim que o
// anel ouro do foco aparece —, digita na busca onde a variante pede, mede e
// salva `<tela>-<tamanho>-<tema>.png`. Com `--maes`: as 12 fotos da 0.16 (a
// lista dentro da FolhaDoPainel e da FolhaFinanceira).
//
// Mede: z-index COMPUTADO da lista e da folha-mãe; quem está por cima em três
// pontos da lista (`elementFromPoint`); se a lista cabe na tela; quem tem o
// foco (campo de texto com foco no celular = teclado subindo por cima da
// lista); o anel ouro; o contraste do texto das opções; o selo da sigla; a
// borda do gatilho aberto; e todo pedido de rede que saiu da bancada.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const soMaes = process.argv.includes("--maes");
// `--so=fornecedor-uf`: só as fotos daquela tela (as variantes com o mesmo começo).
const so = process.argv.find((a) => a.startsWith("--so="))?.slice(5);
const saida = args[0];
const base = args[1] ?? "http://127.0.0.1:5199";
const chrome =
  args[2] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!saida) {
  console.error(
    "uso: node e2e/lista-premium-fotos.mjs <pasta-de-saida> [base] [chrome] [--maes] [--so=<tela>]",
  );
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
// `buscar`: o texto digitado na busca da lista depois de aberta.
const TELAS = [
  { tela: "lancamento-categoria" },
  { tela: "lancamento-sai-de" },
  { tela: "lancamento-entra-em" },
  { tela: "conta-tipo" },
  { tela: "fiscal-regime" },
  { tela: "contador-mes" },
  { tela: "contador-mes", foto: "contador-mes-busca", buscar: "ma" },
  { tela: "cartao-parcelas" },
  { tela: "fornecedor-uf" },
  { tela: "fornecedor-uf", foto: "fornecedor-uf-busca", buscar: "rio" },
  { tela: "banners-combinacoes" },
  { tela: "extrato-chip" },
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
console.log(JSON.stringify({ chromePid: navegador.pid }));

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
  const umaVez = new Map();
  const sempre = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pendentes.has(msg.id)) {
      const { ok, erro } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      if (msg.error) erro(new Error(JSON.stringify(msg.error)));
      else ok(msg.result);
      return;
    }
    if (!msg.method) return;
    sempre.get(msg.method)?.(msg.params);
    if (umaVez.has(msg.method)) {
      umaVez.get(msg.method)(msg.params);
      umaVez.delete(msg.method);
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
      return new Promise((r) => umaVez.set(method, r));
    },
    ouvir(method, fn) {
      sempre.set(method, fn);
    },
    fechar() {
      ws.close();
    },
  };
}

// Roda na página. Lista, folha-mãe, quem está por cima, se cabe, foco, anel,
// contraste, selo e borda do gatilho.
const MEDIR = `(() => {
  const lista = document.querySelector('[data-lista-de-escolha="folha"], [data-lista-de-escolha="popover"]');
  const embrulho = lista?.closest('[data-radix-popper-content-wrapper]');
  const mae = [...document.querySelectorAll('[role="dialog"]')].find((d) => !d.hasAttribute('data-lista-de-escolha') && !lista?.contains(d) && !d.contains(lista));
  const r = lista?.getBoundingClientRect();
  const pontos = r ? [0.15, 0.5, 0.85].map((f) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height * f)) : [];
  const gatilho = document.querySelector('button[aria-haspopup="listbox"][aria-expanded="true"]');
  const rgb = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fundo = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return [255, 255, 255]; };
  const opcao = lista?.querySelector('[role="option"]:not([aria-disabled="true"]):not([aria-selected="true"])');
  let contraste = null;
  if (opcao) { const a = lum(rgb(getComputedStyle(opcao).color)), b = lum(fundo(opcao)); contraste = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; }
  const ativo = document.activeElement;
  const ativa = lista?.querySelector('.lista-de-escolha-ativa');
  const estiloAtivo = ativo ? getComputedStyle(ativo) : null;
  const opcoes = lista ? [...lista.querySelectorAll('[role="option"]')] : [];
  // A dica de teclado do popover: tem de morar dentro da caixa da lista.
  const retangulo = (el) => { if (!el) return null; const q = el.getBoundingClientRect(); return { x: Math.round(q.left), y: Math.round(q.top), direita: Math.round(q.right), baixo: Math.round(q.bottom) }; };
  const dica = lista ? [...lista.querySelectorAll('p')].find((p) => p.textContent.includes('Esc fecha')) : null;
  const caixaDaLista = lista?.querySelector('.rounded-\\\\[20px\\\\]') ?? null;
  const rd = retangulo(dica), rc = retangulo(caixaDaLista);
  let contrasteDaDica = null;
  if (dica) { const a = lum(rgb(getComputedStyle(dica).color)), b = lum(fundo(dica)); contrasteDaDica = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; }
  // A pílula da sigla de uma UF não escolhida, contra o fundo da linha.
  const pilula = lista ? [...lista.querySelectorAll('[role="option"]:not([aria-selected="true"]) span[aria-hidden]')].find((s) => /^[A-Z]{2}$/.test(s.textContent.trim())) ?? null : null;
  return JSON.stringify({
    dica: rd,
    caixaDaLista: rc,
    dicaDentroDaCaixa: rd && rc ? rd.x >= rc.x && rd.y >= rc.y && rd.direita <= rc.direita && rd.baixo <= rc.baixo : null,
    contrasteDaDica,
    fundoDaPilula: pilula ? getComputedStyle(pilula).backgroundColor : null,
    fundoAtrasDaPilula: pilula ? 'rgb(' + fundo(pilula.parentElement).slice(0, 3).join(', ') + ')' : null,
    modo: lista?.dataset.listaDeEscolha ?? null,
    zDaLista: lista ? getComputedStyle(embrulho ?? lista).zIndex : null,
    zDaMae: mae ? getComputedStyle(mae).zIndex : null,
    maeAberta: !!mae,
    listaPorCima: pontos.length === 3 && pontos.every((p) => !!p && lista.contains(p)),
    caixa: r ? { x: Math.round(r.left), y: Math.round(r.top), largura: Math.round(r.width), altura: Math.round(r.height) } : null,
    cabe: r ? r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 : null,
    focoEm: ativo ? ativo.tagName.toLowerCase() + (ativo.getAttribute('role') ? '[' + ativo.getAttribute('role') + ']' : '') : null,
    focoEmCampoDeTexto: !!ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA'),
    contornoDoFoco: estiloAtivo && estiloAtivo.outlineStyle !== 'none' ? estiloAtivo.outlineWidth + ' ' + estiloAtivo.outlineColor : null,
    anelNaOpcao: ativa ? getComputedStyle(ativa).boxShadow : null,
    ouro: getComputedStyle(document.documentElement).getPropertyValue('--lista-ouro').trim(),
    contrasteDaOpcao: contraste,
    opcoes: opcoes.length,
    trechosAchados: lista ? lista.querySelectorAll('mark').length : 0,
    selosNaLista: opcoes.filter((o) => /^[A-Z]{2}/.test(o.textContent.trim())).length,
    gatilhoTexto: gatilho?.textContent.trim() ?? null,
    bordaDoGatilho: gatilho ? getComputedStyle(gatilho).borderTopColor : null,
    gatilhoComClasseAberta: gatilho ? gatilho.classList.contains('lista-de-escolha-aberta') : null,
  });
})()`;

async function avaliar(pagina, expression) {
  const { result, exceptionDetails } = await pagina.enviar("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

async function tecla(pagina, key, code, keyCode) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await pagina.enviar("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }
}

const medidas = [];
let falhou = false;
try {
  const pagina = conectar(await alvo());
  await pagina.pronto;
  await pagina.enviar("Page.enable");
  await pagina.enviar("Runtime.enable");
  await pagina.enviar("Network.enable");
  let erros = [];
  let foraDaBancada = [];
  pagina.ouvir("Runtime.exceptionThrown", (p) =>
    erros.push(
      p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text,
    ),
  );
  pagina.ouvir("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error")
      erros.push(p.args.map((a) => a.value ?? a.description).join(" "));
  });
  pagina.ouvir("Network.requestWillBeSent", (p) => {
    const url = p.request.url;
    if (
      !url.startsWith(base) &&
      !url.startsWith("data:") &&
      !url.startsWith("blob:")
    )
      foraDaBancada.push(url);
  });

  for (const t of TAMANHOS) {
    // Trocar o tamanho com a lista aberta cruza os 1024px: a folha fecha e
    // devolve a entrada do histórico (`history.back()`), o que cancelava o
    // `Page.navigate` seguinte e a carga nunca chegava. Sai da tela antes.
    const emBranco = pagina.uma("Page.loadEventFired");
    await pagina.enviar("Page.navigate", { url: "about:blank" });
    await emBranco;
    await pagina.enviar("Emulation.setDeviceMetricsOverride", {
      width: t.width,
      height: t.height,
      deviceScaleFactor: 2,
      mobile: t.mobile,
    });
    for (const tema of TEMAS) {
      const roteiro = soMaes
        ? MAES.map(({ mae, abrir }) => ({
            url: `${base}/e2e/lista-premium.html?tema=${tema}&mae=${mae}&abrir=${abrir}`,
            arquivo: `lista-${t.nome}-${tema}-${mae}.png`,
            rotulo: { mae },
          }))
        : TELAS.filter(({ tela }) => !so || tela === so).map(
            ({ tela, foto, buscar }) => ({
              url: `${base}/e2e/lista-premium.html?tema=${tema}&tela=${tela}`,
              arquivo: `${foto ?? tela}-${t.nome}-${tema}.png`,
              rotulo: { tela: foto ?? tela },
              buscar,
            }),
          );
      for (const passo of roteiro) {
        erros = [];
        foraDaBancada = [];
        const carregou = pagina.uma("Page.loadEventFired");
        const navegou = await pagina.enviar("Page.navigate", {
          url: passo.url,
        });
        if (navegou.errorText)
          throw new Error(`${passo.url}: ${navegou.errorText}`);
        await carregou;
        let problema = null;
        if (soMaes) {
          // A bancada abre o campo 400ms depois de montar; a folha anima.
          await esperar(1500);
        } else {
          let estado = null;
          for (let i = 0; i < 60 && !estado; i++) {
            await esperar(200);
            estado = await avaliar(
              pagina,
              "JSON.stringify(window.__bancada ?? null)",
            ).then(JSON.parse);
          }
          if (!estado || estado.erro) {
            problema = estado?.erro ?? "a tela não ficou pronta";
          } else {
            await avaliar(
              pagina,
              `document.getElementById(${JSON.stringify(estado.gatilho)}).focus()`,
            );
            await esperar(150);
            await tecla(pagina, "ArrowDown", "ArrowDown", 40);
            // A folha sobe (celular) / o popover aparece (computador).
            await esperar(900);
            if (passo.buscar) {
              // No celular a busca não ganha foco sozinha: a lojista toca nela.
              await avaliar(
                pagina,
                `document.querySelector('[data-lista-de-escolha] input')?.focus()`,
              );
              await pagina.enviar("Input.insertText", { text: passo.buscar });
              await esperar(400);
            }
          }
        }
        const medida = {
          tamanho: t.nome,
          tema,
          ...passo.rotulo,
          ...(passo.buscar ? { buscou: passo.buscar } : {}),
          ...(problema ? { problema } : {}),
          ...JSON.parse(await avaliar(pagina, MEDIR)),
          erros: [...erros],
          foraDaBancada: [...foraDaBancada],
        };
        if (problema || !medida.modo) falhou = true;
        const { data } = await pagina.enviar("Page.captureScreenshot", {
          format: "png",
        });
        writeFileSync(join(saida, passo.arquivo), Buffer.from(data, "base64"));
        medidas.push({ arquivo: passo.arquivo, ...medida });
        console.log(JSON.stringify({ arquivo: passo.arquivo, ...medida }));
      }
    }
  }
  pagina.fechar();
  writeFileSync(
    join(saida, soMaes ? "medidas-maes.json" : "medidas.json"),
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
process.exit(falhou ? 1 : 0);

// @vitest-environment jsdom
//
// A tela "Atualizando o Aplicativo" (componentDidCatch + render, chunk
// error com internet) tinha duas falhas gêmeas medidas em 08/09/2026:
//
//   1) A guarda de auto-reload era uma janela de 10s (`pwa_chunk_reload_time`
//      em sessionStorage). Duas falhas de chunk separadas por mais de 10s
//      recarregavam de novo cada vez — sem limite.
//   2) Quando a guarda negava o reload, o `if` simplesmente terminava: nada
//      de recarga, nada de aviso, e o `render()` ficava preso na rodinha
//      "Atualizando o Aplicativo" para sempre — sem botão, sem prazo, sem
//      fim. A pessoa só saía fechando o app na marra.
//
// O conserto de 08/09 virou a guarda booleana `pwa_chunk_reload_done`; a
// issue #92 (13/09/2026) unificou TUDO na chave `pwa_chunk_recovery` do
// módulo @/lib/recuperacao-chunk: a escada tem DOIS degraus automáticos por
// versão (ciclo do SW, depois purge seletivo) e, gastos os dois, RECUSA —
// quem decide é o usuário. Este arquivo cobre a outra metade do contrato,
// que não mudou: quando a decisão é recusa (espectador), o boundary NÃO
// recarrega sozinho e o prazo finito revela uma saída manual (botão) que só
// recarrega a página — nunca chama handleReset nem limpa storage, então
// carrinho e sessão sobrevivem.
//
// Mesmo contorno dos testes irmãos (offline-honesto, recovery-preserva-*):
// storages com chaves enumeráveis e window.location trocado por cópia com
// reload espionável.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";

// Mesmo valor de PRAZO_SAIDA_CHUNK_MS em
// src/components/ui/custom/GlobalErrorBoundary.tsx. Duplicado de propósito
// (o teste não importa constante privada do componente) — se o prazo do
// componente mudar, este teste quebra e avisa.
const PRAZO_SAIDA_CHUNK_MS = 4000;

// Mesma chave de CHAVE_RECUPERACAO_CHUNK em src/lib/recuperacao-chunk.ts —
// o dono da decisão desde a issue #92. Duplicada de propósito: se o módulo
// mudar a chave, este teste quebra e avisa.
const CHAVE_RECUPERACAO_CHUNK = "pwa_chunk_recovery";

// Mesmo fallback do módulo: `__APP_VERSION__` é undefined no runner
// (setup-build-identity só stuba `__STORE_IDENTITY__`).
const VERSAO_FALLBACK_DO_APP = "0.0.0-dev";

function BombaChunk(): never {
  throw new Error(
    "Failed to fetch dynamically imported module: http://x/assets/Admin-abc.js",
  );
}

function criarStorageComChavesEnumeraveis(): Storage {
  const armazem = new Map<string, string>();
  const store = {} as Record<string, unknown>;

  function metodo(nome: string, fn: (...args: never[]) => unknown) {
    Object.defineProperty(store, nome, {
      value: fn,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  metodo("getItem", ((chave: string) =>
    armazem.has(chave) ? armazem.get(chave)! : null) as never);
  metodo("setItem", ((chave: string, valor: string) => {
    armazem.set(chave, String(valor));
    Object.defineProperty(store, chave, {
      value: String(valor),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }) as never);
  metodo("removeItem", ((chave: string) => {
    armazem.delete(chave);
    Reflect.deleteProperty(store, chave);
  }) as never);
  metodo("clear", (() => {
    for (const chave of armazem.keys()) Reflect.deleteProperty(store, chave);
    armazem.clear();
  }) as never);
  metodo(
    "key",
    ((index: number) => Array.from(armazem.keys()).at(index) ?? null) as never,
  );
  Object.defineProperty(store, "length", {
    get: () => armazem.size,
    enumerable: false,
    configurable: true,
  });

  return store as unknown as Storage;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let onLineOriginal: boolean;

const reloadEspiao = vi.fn();

beforeEach(() => {
  vi.stubGlobal("localStorage", criarStorageComChavesEnumeraveis());
  vi.stubGlobal("sessionStorage", criarStorageComChavesEnumeraveis());
  reloadEspiao.mockClear();
  onLineOriginal = navigator.onLine;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: reloadEspiao },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => onLineOriginal,
  });
  // Rede de segurança: se algum teste esquecer de restaurar os timers reais,
  // o próximo teste da suíte não herda o relógio congelado.
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function definirOnLine(valor: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => valor,
  });
}

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

/** Simula "os dois degraus automáticos desta versão já foram gastos" —
 * `reportarErroChunk()` lê count=2 dentro da janela e devolve recusa
 * (espectador): o boundary não recarrega sozinho e cai direto no cronômetro
 * de saída. É o estado que substitui a velha booleana de sessão. */
function esgotarRecuperacaoDaVersao() {
  localStorage.setItem(
    CHAVE_RECUPERACAO_CHUNK,
    JSON.stringify({
      versao: VERSAO_FALLBACK_DO_APP,
      count: 2,
      lastAt: Date.now(),
    }),
  );
}

describe("GlobalErrorBoundary — chunk sem trava (prazo finito + saída manual)", () => {
  it("a) depois do prazo, a tela de espera mostra o botão de saída; antes do prazo, não mostra", async () => {
    vi.useFakeTimers();
    definirOnLine(true);
    esgotarRecuperacaoDaVersao();

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <BombaChunk />
        </GlobalErrorBoundary>,
      );
    });

    // Peça 22/09: erro de módulo não prova versão nova — a tela fala em
    // RECUPERAÇÃO, nunca em "Atualizando"/"Instalando uma nova versão".
    expect(hospedeiro.textContent).toContain("Recuperando o aplicativo");
    expect(hospedeiro.textContent).not.toContain("Atualizando o Aplicativo");
    expect(hospedeiro.textContent).not.toContain("Instalando uma nova versão");
    expect(botaoPorTexto("Recarregar a página")).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(PRAZO_SAIDA_CHUNK_MS - 1);
    });
    expect(botaoPorTexto("Recarregar a página")).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(botaoPorTexto("Recarregar a página")).toBeDefined();
    expect(hospedeiro.textContent).toContain("A recuperação está demorando");
    expect(hospedeiro.textContent).not.toContain(
      "A atualização está demorando",
    );
  });

  it("b) clicar no botão de saída recarrega a página e não apaga carrinho nem sessão", async () => {
    vi.useFakeTimers();
    definirOnLine(true);
    esgotarRecuperacaoDaVersao();
    localStorage.setItem("sb-projeto-auth-token", "token-de-sessao");
    localStorage.setItem("marketplace_cart_v1", JSON.stringify([{ id: 1 }]));

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <BombaChunk />
        </GlobalErrorBoundary>,
      );
    });

    act(() => {
      vi.advanceTimersByTime(PRAZO_SAIDA_CHUNK_MS);
    });

    const botao = botaoPorTexto("Recarregar a página");
    expect(botao).toBeDefined();
    act(() => {
      botao!.click();
    });

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    // As chaves em si sobrevivem — não é só "não chamou clear()".
    expect(localStorage.getItem("sb-projeto-auth-token")).toBe(
      "token-de-sessao",
    );
    expect(localStorage.getItem("marketplace_cart_v1")).toBe(
      JSON.stringify([{ id: 1 }]),
    );
    // O motivo gravado pelo CLIQUE tem de sobrescrever o "recuperacao-crash"
    // que o log forense do componentDidCatch já gravou ao capturar o erro.
    // Sem isso, quem clica num botão que promete "recarregar a página" cai,
    // depois do boot, no toast de alarme "O aplicativo se recuperou —
    // Ocorreu um erro inesperado" (tom warning) em vez do "Aplicativo
    // recarregado" honesto (tom info) — ver src/lib/motivo-de-recarga.ts.
    expect(localStorage.getItem("pwa_reload_reason")).toBe(
      "recuperacao-erro-modulo",
    );
  });

  it("c) segunda falha de chunk na mesma sessão não recarrega sozinha — cai na tela com botão", async () => {
    vi.useFakeTimers();
    definirOnLine(true);
    esgotarRecuperacaoDaVersao();

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <BombaChunk />
        </GlobalErrorBoundary>,
      );
    });

    // Nenhum reload automático no instante da falha...
    expect(reloadEspiao).not.toHaveBeenCalled();

    // ...nem depois de passado tempo suficiente para o prazo de saída.
    act(() => {
      vi.advanceTimersByTime(PRAZO_SAIDA_CHUNK_MS);
    });

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(botaoPorTexto("Recarregar a página")).toBeDefined();
  });

  it("d) cancela o temporizador de saída quando o componente desmonta", async () => {
    vi.useFakeTimers();
    definirOnLine(true);
    esgotarRecuperacaoDaVersao();

    // Raiz LOCAL (não a `raiz` do beforeEach): este teste desmonta no meio
    // do próprio corpo para poder afirmar o clearTimeout antes do
    // afterEach compartilhado, e um root não pode ser desmontado duas
    // vezes.
    const hospedeiroLocal = document.createElement("div");
    document.body.appendChild(hospedeiroLocal);
    const raizLocal = createRoot(hospedeiroLocal);

    // `globalThis`, não `global`: o tsconfig destes testes não carrega os
    // tipos do Node, e `global` não compila (TS2304).
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await act(async () => {
      raizLocal.render(
        <GlobalErrorBoundary>
          <BombaChunk />
        </GlobalErrorBoundary>,
      );
    });

    const chamadaDoNosso = setTimeoutSpy.mock.calls.findIndex(
      ([, atraso]) => atraso === PRAZO_SAIDA_CHUNK_MS,
    );
    expect(chamadaDoNosso).toBeGreaterThanOrEqual(0);
    // `.at()` em vez de índice computado: o eslint acusa acesso por variável
    // (security/detect-object-injection) e a catraca de lint conta warning.
    const idDoTemporizador =
      setTimeoutSpy.mock.results.at(chamadaDoNosso)!.value;

    act(() => {
      raizLocal.unmount();
    });
    hospedeiroLocal.remove();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(idDoTemporizador);
  });
});

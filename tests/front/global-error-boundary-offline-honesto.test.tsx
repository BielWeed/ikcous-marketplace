// @vitest-environment jsdom
//
// Laudo varredura profunda #2 (P-3): com a máquina SEM internet, um chunk
// error é só a rede caída — o boundary não pode recarregar em loop nem
// mostrar a tela mentirosa "Atualizando o Aplicativo / Instalando uma nova
// versão" (não há versão nenhuma sendo instalada sem sinal). Deve mostrar
// uma tela honesta de offline, sem gravar motivo de recarga. Com internet,
// o auto-reload silencioso de sempre se mantém — agora gravando o motivo
// NOMINAL de recuperação (laudo #2, P-1).
//
// Mesmo contorno dos testes irmãos (recovery-preserva-sessao-e-carrinho):
// storages com chaves enumeráveis e window.location trocado por cópia com
// reload espionável.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";

function BombaChunk(): never {
  throw new Error(
    "Failed to fetch dynamically imported module: http://x/assets/Admin-abc.js",
  );
}

function BombaCrash(): never {
  throw new Error("Cannot read properties of undefined (reading 'x')");
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

describe("GlobalErrorBoundary — offline honesto (laudo #2, P-3 e P-1)", () => {
  it("chunk error SEM internet: não recarrega, não grava motivo de recarga e mostra tela honesta de offline", async () => {
    definirOnLine(false);

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <BombaChunk />
        </GlobalErrorBoundary>,
      );
    });

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(localStorage.getItem("pwa_reload_reason")).toBeNull();
    expect(hospedeiro.textContent).toContain("Você está sem internet");
    // a mentira do laudo nunca aparece offline
    expect(hospedeiro.textContent).not.toContain("Atualizando o Aplicativo");
    expect(hospedeiro.textContent).not.toContain("Instalando uma nova versão");
  });

  it("offline: o botão 'Tentar novamente' recarrega quando o lojista decide", async () => {
    definirOnLine(false);

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <BombaChunk />
        </GlobalErrorBoundary>,
      );
    });

    const botao = botaoPorTexto("Tentar novamente");
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("chunk error COM internet mantém o auto-reload silencioso e grava o motivo NOMINAL de recuperação", async () => {
    definirOnLine(true);

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <BombaChunk />
        </GlobalErrorBoundary>,
      );
    });

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("pwa_reload_reason")).toBe(
      "recuperacao-erro-modulo",
    );
  });

  it("crash de render (não-chunk) grava o motivo nominal de crash e fica na tela de erro fatal", async () => {
    definirOnLine(true);

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <BombaCrash />
        </GlobalErrorBoundary>,
      );
    });

    expect(hospedeiro.textContent).toContain("Erro Fatal Detectado");
    expect(localStorage.getItem("pwa_reload_reason")).toBe("recuperacao-crash");
  });
});

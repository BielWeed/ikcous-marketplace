// @vitest-environment jsdom
//
// GlobalErrorBoundary — três bordas que os testes irmãos não pisavam. O que
// protege:
//   · o laudo `pwa_forensics` guarda no máximo 10 entradas, com o crash mais
//     novo na frente e o motivo nominal de crash gravado; laudo ilegível não
//     derruba a tela de erro (a tela é a última rede de segurança do app);
//   · um SEGUNDO componentDidCatch na mesma instância não arma um segundo
//     cronômetro de saída (o primeiro ficaria sem dono e o unmount só
//     limparia o último);
//   · a pilha do erro (texto técnico) só aparece em desenvolvimento — o
//     cliente da loja nunca lê "Error: ... at ..." na tela de erro.
import { act, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";

// Mesmos literais do componente e do módulo de recuperação, duplicados de
// propósito: se mudarem no fonte, este teste quebra e avisa.
const PRAZO_SAIDA_CHUNK_MS = 4000;
const CHAVE_RECUPERACAO_CHUNK = "pwa_chunk_recovery";
const VERSAO_FALLBACK_DO_APP = "0.0.0-dev";

function QuebraComum(): never {
  throw new Error("falha-tecnica-de-teste");
}

function QuebraChunk(): never {
  throw new Error(
    "Failed to fetch dynamically imported module: http://x/assets/Tela-abc.js",
  );
}

function criarStorage(): Storage {
  const armazem = new Map<string, string>();
  const store = {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
  };
  return store as unknown as Storage;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let onLineOriginal: boolean;

beforeEach(() => {
  vi.stubGlobal("localStorage", criarStorage());
  vi.stubGlobal("sessionStorage", criarStorage());
  onLineOriginal = navigator.onLine;
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Os dois degraus automáticos da versão já foram gastos: o boundary vira
 * espectador (não recarrega nada sozinho) — isola o cronômetro de saída. */
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

describe("GlobalErrorBoundary — laudo forense do crash", () => {
  it("guarda só as 10 entradas mais novas, com o crash na frente e o motivo nominal", async () => {
    const antigas = Array.from({ length: 10 }, (_, i) => ({
      t: `2026-01-01T00:00:0${i}.000Z`,
      m: `ANTIGA_${i}`,
    }));
    localStorage.setItem("pwa_forensics", JSON.stringify(antigas));

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <QuebraComum />
        </GlobalErrorBoundary>,
      );
    });

    const laudo = JSON.parse(
      localStorage.getItem("pwa_forensics") ?? "[]",
    ) as Array<{ m: string; d?: { error?: string; stack?: string } }>;
    expect(laudo).toHaveLength(10);
    expect(laudo[0]?.m).toBe("FATAL_APP_CRASH");
    expect(laudo[0]?.d?.error).toBe("falha-tecnica-de-teste");
    expect(typeof laudo[0]?.d?.stack).toBe("string");
    expect(laudo[9]?.m).toBe("ANTIGA_8");
    expect(localStorage.getItem("pwa_reload_reason")).toBe("recuperacao-crash");
  });

  it("laudo ilegível no storage não derruba a tela de erro nem grava motivo", async () => {
    localStorage.setItem("pwa_forensics", "{isto não é json");

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <QuebraComum />
        </GlobalErrorBoundary>,
      );
    });

    expect(hospedeiro.textContent).toContain("Algo deu errado");
    expect(hospedeiro.textContent).toContain("Recarregar o app");
    expect(localStorage.getItem("pwa_reload_reason")).toBeNull();
  });
});

describe("GlobalErrorBoundary — cronômetro de saída do chunk", () => {
  it("um segundo componentDidCatch na mesma instância não arma outro cronômetro", async () => {
    vi.useFakeTimers();
    esgotarRecuperacaoDaVersao();
    const ref = createRef<GlobalErrorBoundary>();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary ref={ref}>
          <QuebraChunk />
        </GlobalErrorBoundary>,
      );
    });
    act(() => {
      ref.current?.componentDidCatch(
        new Error("Failed to fetch dynamically imported module: /outro.js"),
        { componentStack: "" },
      );
    });

    const armados = setTimeoutSpy.mock.calls.filter(
      ([, atraso]) => atraso === PRAZO_SAIDA_CHUNK_MS,
    );
    expect(armados).toHaveLength(1);
  });
});

describe("GlobalErrorBoundary — a pilha do erro só aparece em desenvolvimento", () => {
  it.each([false, true])("DEV=%s", async (dev) => {
    vi.stubEnv("DEV", dev);

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <QuebraComum />
        </GlobalErrorBoundary>,
      );
    });

    expect(hospedeiro.textContent).toContain("Algo deu errado");
    expect(hospedeiro.textContent?.includes("falha-tecnica-de-teste")).toBe(
      dev,
    );
  });
});

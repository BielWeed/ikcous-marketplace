// @vitest-environment jsdom
//
// O cabeçalho dividia o nome da loja em QUALQUER hífen: "Guarda-Roupa da Lu"
// saía como "Guarda" grande e "ROUPA DA LU" miúdo. Só hífen COM espaços (ou a
// barra vertical) separa nome e subtítulo, e o que sobra é juntado, não
// descartado. A inicial do selo também não pode virar "�" com emoji no começo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";

let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Header — nome da loja com hífen sem espaço e com emoji", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = {};
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  // Renderiza com todas as logos caídas: sobra o nome escrito (nome + subtítulo).
  async function nomeEscrito(storeName: string) {
    mockConfig = { storeName };
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(<Header onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const img = hospedeiro.querySelector("img");
    expect(img).toBeTruthy();
    act(() => {
      img!.dispatchEvent(new Event("error"));
    });
    const principal = hospedeiro.querySelector("span.text-lg");
    const subtitulo = principal?.nextElementSibling ?? null;
    return {
      principal: principal?.textContent ?? "",
      subtitulo: subtitulo?.textContent ?? "",
    };
  }

  it("nome e legenda sem espaços encolhem sem empurrar busca e sino", async () => {
    const nome = "N".repeat(75);
    const legenda = "S".repeat(75);
    await nomeEscrito(`${nome} | ${legenda}`);
    const principal = [...hospedeiro.querySelectorAll("span")].find(
      (el) => el.textContent === nome,
    )!;
    const subtitulo = [...hospedeiro.querySelectorAll("span")].find(
      (el) => el.textContent === legenda,
    )!;
    expect(principal.classList.contains("truncate")).toBe(true);
    expect(subtitulo.classList.contains("truncate")).toBe(true);
    const coluna = principal.parentElement!;
    expect(coluna.classList.contains("min-w-0")).toBe(true);
    const miniatura = coluna.parentElement!;
    expect(miniatura.classList.contains("w-[100px]")).toBe(true);
    expect(miniatura.classList.contains("xs:w-[120px]")).toBe(true);
    expect(miniatura.classList.contains("min-w-0")).toBe(true);
    expect(miniatura.firstElementChild?.classList.contains("shrink-0")).toBe(true);
    const botao = hospedeiro.querySelector('[aria-label="Ir para o Início"]')!;
    expect(botao.classList.contains("shrink-0")).toBe(false);
    expect(botao.classList.contains("min-w-0")).toBe(true);
    expect(botao.parentElement?.classList.contains("shrink-0")).toBe(false);
    expect(botao.parentElement?.classList.contains("min-w-0")).toBe(true);
  });

  it("hífen sem espaço não divide o nome", async () => {
    const { principal, subtitulo } = await nomeEscrito("Guarda-Roupa da Lu");
    expect(principal).toBe("Guarda-Roupa da Lu");
    expect(subtitulo).toBe("");
  });

  it("hífen com espaços continua dividindo nome e subtítulo", async () => {
    const { principal, subtitulo } = await nomeEscrito("Aurora - Presentes");
    expect(principal).toBe("Aurora");
    expect(subtitulo).toBe("Presentes");
  });

  it("barra vertical continua dividindo", async () => {
    const { principal, subtitulo } = await nomeEscrito("Aurora | Presentes");
    expect(principal).toBe("Aurora");
    expect(subtitulo).toBe("Presentes");
  });

  it("três partes não perdem a última: o resto vai junto no subtítulo", async () => {
    const { principal, subtitulo } = await nomeEscrito("A - B - C");
    expect(principal).toBe("A");
    expect(subtitulo).toBe("B - C");
  });

  it("nome começando com emoji não vira losango na inicial", async () => {
    mockConfig = { storeName: "🌸 Flor da Lu" };
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(<Header onNavigate={() => {}} />);
    });
    const img = hospedeiro.querySelector("img");
    act(() => {
      img!.dispatchEvent(new Event("error"));
    });
    expect(hospedeiro.textContent).toContain("🌸");
    expect(hospedeiro.textContent).not.toContain("\uFFFD");
    expect(hospedeiro.textContent).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
  });
});

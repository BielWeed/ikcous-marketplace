// @vitest-environment jsdom

import { IOSInstallGuide } from "@/components/pwa/IOSInstallGuide";
import { deveMostrarGuiaIOS } from "@/lib/ios-install";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React usada pelos testes de componentes deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const iphone = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};

const ipad = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 5,
};

const android = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36",
  platform: "Linux armv8l",
  maxTouchPoints: 5,
};

describe("guia de instalação iOS", () => {
  it("mostra no navegador do iPhone e do iPad, inclusive iPad com UA de desktop", () => {
    expect(deveMostrarGuiaIOS(iphone, false, false)).toBe(true);
    expect(deveMostrarGuiaIOS(ipad, false, false)).toBe(true);
  });

  it("não altera a experiência Android nem mostra no Mac sem toque", () => {
    expect(deveMostrarGuiaIOS(android, false, false)).toBe(false);
    expect(
      deveMostrarGuiaIOS({ ...ipad, maxTouchPoints: 0 }, false, false),
    ).toBe(false);
  });

  it("não mostra se o PWA está instalado por qualquer sinal standalone", () => {
    expect(deveMostrarGuiaIOS(iphone, true, false)).toBe(false);
    expect(deveMostrarGuiaIOS(ipad, false, true)).toBe(false);
  });
});

describe("cartão de instalação iOS", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", { ...iphone, standalone: false });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("ensina o caminho no Safari e não reaparece após dispensar", () => {
    act(() => root.render(<IOSInstallGuide />));
    expect(host.textContent).toContain("Adicionar à Tela de Início");
    expect(host.textContent).toContain("Menu da Página");
    expect(host.textContent).toContain("Abrir como App da Web");
    expect(host.textContent).toContain("Ver Mais");
    expect(host.textContent).toContain("Editar Ações");

    const dismiss = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Não mostrar novamente"),
    );
    expect(dismiss).toBeTruthy();
    act(() => dismiss!.click());
    expect(host.textContent).not.toContain("Adicionar à Tela de Início");

    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<IOSInstallGuide />));
    expect(host.textContent).not.toContain("Adicionar à Tela de Início");
  });
});

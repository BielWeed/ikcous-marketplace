// @vitest-environment jsdom
import { useBehavioralPrefetch } from "@/hooks/useBehavioralPrefetch";
import { useNetworkAdaptive } from "@/hooks/useNetworkAdaptive";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React real, no padrão dos testes de hooks daqui, sem Testing Library instalada.
let raiz: Root;
let hospedeiro: HTMLDivElement;
let armazenamento: HTMLIFrameElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // O global do Node pode ocultar o Storage do jsdom; o iframe tem o nativo.
  armazenamento = document.createElement("iframe");
  document.body.appendChild(armazenamento);
  const storage = armazenamento.contentWindow!.localStorage;
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("Storage", storage.constructor);
  localStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz?.unmount());
  hospedeiro?.remove();
  localStorage.clear();
  armazenamento.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("prefetch só trabalha quando a tela muda", () => {
  it("cinco rerenders com callback novo não repetem as escritas da montagem", async () => {
    const gravar = vi.spyOn(Storage.prototype, "setItem");
    function Tela() {
      useBehavioralPrefetch("home", () => {});
      return null;
    }

    await act(async () => raiz.render(createElement(Tela)));
    const escritasDaMontagem = gravar.mock.calls.length;
    expect(escritasDaMontagem).toBe(1);

    for (let i = 0; i < 5; i++) {
      await act(async () => raiz.render(createElement(Tela)));
    }

    expect(gravar).toHaveBeenCalledTimes(escritasDaMontagem);
    expect(JSON.parse(localStorage.getItem("pwa_nav_history")!)).toEqual([
      "home",
    ]);
  });

  it("home para cart registra uma transição e chama o callback atual", async () => {
    localStorage.setItem("markov_cart", JSON.stringify({ products: 2 }));
    const gravar = vi.spyOn(Storage.prototype, "setItem");
    const anterior = vi.fn();
    const atual = vi.fn();
    function Tela({ path, cb }: { path: string; cb: (view: string) => void }) {
      useBehavioralPrefetch(path, cb);
      return null;
    }

    await act(async () =>
      raiz.render(createElement(Tela, { path: "home", cb: anterior })),
    );
    gravar.mockClear();
    await act(async () =>
      raiz.render(createElement(Tela, { path: "cart", cb: atual })),
    );

    expect(gravar).toHaveBeenCalledTimes(2);
    expect(gravar).toHaveBeenNthCalledWith(
      1,
      "pwa_nav_history",
      JSON.stringify(["home", "cart"]),
    );
    expect(gravar).toHaveBeenNthCalledWith(
      2,
      "markov_home",
      JSON.stringify({ cart: 1 }),
    );
    expect(anterior).not.toHaveBeenCalled();
    expect(atual).toHaveBeenCalledExactlyOnceWith("products");
  });

  it("a previsão efetiva não imprime Omnipotence nem repete trabalho no mesmo path", async () => {
    localStorage.setItem("pwa_nav_history", JSON.stringify(["products"]));
    localStorage.setItem("markov_home", JSON.stringify({ cart: 2 }));
    const gravar = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");
    const prefetch = vi.fn();
    function Tela() {
      useBehavioralPrefetch("home", (view) => prefetch(view));
      return null;
    }

    await act(async () => raiz.render(createElement(Tela)));
    expect(prefetch).toHaveBeenCalledExactlyOnceWith("cart");
    expect(gravar).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 5; i++) {
      await act(async () => raiz.render(createElement(Tela)));
    }

    expect(
      log.mock.calls.flat().some((arg) => String(arg).includes("Omnipotence")),
    ).toBe(false);
    expect(prefetch).toHaveBeenCalledExactlyOnceWith("cart");
    expect(gravar).toHaveBeenCalledTimes(2);
  });

  it("as funções da rede são estáveis e leem offline sem novo render", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    let rede: ReturnType<typeof useNetworkAdaptive> | undefined;
    let renders = 0;
    function Tela() {
      rede = useNetworkAdaptive();
      renders++;
      return null;
    }

    await act(async () => raiz.render(createElement(Tela)));
    const inicial = rede!;
    expect(inicial.isSlow()).toBe(false);
    expect(inicial.getQuality()).toBe("fast");
    await act(async () => raiz.render(createElement(Tela)));

    expect(Object.is(inicial.isSlow, rede!.isSlow)).toBe(true);
    expect(Object.is(inicial.getQuality, rede!.getQuality)).toBe(true);
    expect(Object.is(inicial, rede)).toBe(true);
    expect(renders).toBe(2);

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(renders).toBe(2);
    expect(inicial.isSlow()).toBe(true);
    expect(inicial.getQuality()).toBe("offline");
  });
});

// @vitest-environment jsdom
import { useBehavioralPrefetch } from "@/hooks/useBehavioralPrefetch";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let raiz: Root;
let hospedeiro: HTMLDivElement;
let armazenamento: HTMLIFrameElement;

function Tela({ path, cb }: { path: string; cb: (view: string) => void }) {
  useBehavioralPrefetch(path, cb);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // O iframe fornece o Storage real do jsdom, sem o global do Node.
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

describe("a previsão de navegação ignora a própria tela", () => {
  it("prevê cart mesmo com cem auto-transições antigas de home", async () => {
    localStorage.setItem("markov_home", JSON.stringify({ home: 100, cart: 5 }));
    localStorage.setItem("pwa_nav_history", JSON.stringify(["home"]));
    const prefetch = vi.fn();

    await act(async () =>
      raiz.render(createElement(Tela, { path: "home", cb: prefetch })),
    );

    expect(prefetch).toHaveBeenCalledExactlyOnceWith("cart");
  });

  it("não prevê outra tela quando só existem auto-transições", async () => {
    localStorage.setItem("markov_home", JSON.stringify({ home: 100 }));
    localStorage.setItem("pwa_nav_history", JSON.stringify(["home"]));
    const prefetch = vi.fn();

    await act(async () =>
      raiz.render(createElement(Tela, { path: "home", cb: prefetch })),
    );

    expect(prefetch).not.toHaveBeenCalled();
  });

  it("mantém cart como previsão mais frequente no histórico limpo", async () => {
    localStorage.setItem("markov_home", JSON.stringify({ cart: 3, orders: 1 }));
    const prefetch = vi.fn();

    await act(async () =>
      raiz.render(createElement(Tela, { path: "home", cb: prefetch })),
    );

    expect(prefetch).toHaveBeenCalledExactlyOnceWith("cart");
  });

  it("grava home para cart uma vez mesmo após renderizar cart novamente", async () => {
    const prefetch = vi.fn();
    await act(async () =>
      raiz.render(createElement(Tela, { path: "home", cb: prefetch })),
    );
    const gravar = vi.spyOn(Storage.prototype, "setItem");

    await act(async () =>
      raiz.render(createElement(Tela, { path: "cart", cb: prefetch })),
    );
    await act(async () =>
      raiz.render(createElement(Tela, { path: "cart", cb: vi.fn() })),
    );

    expect(JSON.parse(localStorage.getItem("markov_home")!)).toEqual({
      cart: 1,
    });
    expect(JSON.parse(localStorage.getItem("pwa_nav_history")!)).toEqual([
      "home",
      "cart",
    ]);
    expect(
      gravar.mock.calls.filter(([chave]) => chave === "markov_home"),
    ).toHaveLength(1);
  });

  it("não ignora uma tela diferente que compartilha o prefixo de home", async () => {
    localStorage.setItem(
      "markov_home",
      JSON.stringify({ home: 100, "home-details": 5 }),
    );
    const prefetch = vi.fn();

    await act(async () =>
      raiz.render(createElement(Tela, { path: "home", cb: prefetch })),
    );

    expect(prefetch).toHaveBeenCalledExactlyOnceWith("home-details");
  });

  it("continua exigindo recorrência da próxima tela", async () => {
    localStorage.setItem("markov_home", JSON.stringify({ home: 100, cart: 1 }));
    const prefetch = vi.fn();

    await act(async () =>
      raiz.render(createElement(Tela, { path: "home", cb: prefetch })),
    );

    expect(prefetch).not.toHaveBeenCalled();
  });

  it.each([null, "{JSON corrompido"])(
    "não quebra nem prevê com histórico ausente ou inválido: %s",
    async (historico) => {
      if (historico !== null) localStorage.setItem("markov_home", historico);
      const prefetch = vi.fn();

      await act(async () =>
        raiz.render(createElement(Tela, { path: "home", cb: prefetch })),
      );

      expect(prefetch).not.toHaveBeenCalled();
    },
  );
});

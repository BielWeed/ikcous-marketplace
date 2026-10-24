// @vitest-environment jsdom
//
// O aviso (toast) do painel não pode ficar em cima do cabeçalho no celular.
//
// O QUE ERA: o wrapper `src/components/ui/sonner.tsx` pedia a descida do aviso
// por `--offset`, e o Sonner 2 não lê essa variável. Até 600 px de largura ele
// usa `mobileOffset` (padrão 16 px), então a pílula ficava em y=16 e cobria os
// botões "Perfil", seletor da loja e "Notificações" (cabeçalho: y 0..57) por
// cerca de 2,5 s, medido no Chromium.
//
// O QUE ESTE TESTE PROVA: com o componente REAL renderizado e um aviso REAL
// disparado, o Sonner grava `--mobile-offset-top` com a descida de 64 px
// (+ a área segura do iPhone). NÃO prova a posição na tela (jsdom não faz
// layout): isso é medido no navegador.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "@/components/ui/sonner";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos outros testes de componente.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom não traz matchMedia; o Sonner e o next-themes perguntam por ele.
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Toaster do app — descida no celular", () => {
  it("grava --mobile-offset-top com 64 px + área segura (o aviso fica abaixo do cabeçalho)", async () => {
    const hospedeiro = document.createElement("div");
    document.body.append(hospedeiro);
    const raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(createElement(Toaster));
    });
    await act(async () => {
      toast("Aviso de prova");
      await new Promise((r) => setTimeout(r, 80));
    });

    const lista = document.querySelector("[data-sonner-toaster]");
    expect(lista).not.toBeNull();
    const estilo = (lista as HTMLElement).getAttribute("style") ?? "";
    expect(estilo).toMatch(
      /--mobile-offset-top:\s*calc\(var\(--safe-area-top,\s*0px\)\s*\+\s*64px\)/,
    );

    act(() => raiz.unmount());
  });

  it("controle: sem o mobileOffset o Sonner volta ao padrão de 16 px (o defeito)", async () => {
    const { Toaster: Cru } = await import("sonner");
    const hospedeiro = document.createElement("div");
    document.body.append(hospedeiro);
    const raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(createElement(Cru));
    });
    await act(async () => {
      toast("Aviso de controle");
      await new Promise((r) => setTimeout(r, 80));
    });
    const estilo =
      document.querySelector("[data-sonner-toaster]")?.getAttribute("style") ??
      "";
    expect(estilo).toMatch(/--mobile-offset-top:\s*16px/);
    act(() => raiz.unmount());
  });
});

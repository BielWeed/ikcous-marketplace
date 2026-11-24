// @vitest-environment jsdom
//
// A transição de vista (a foto "voa" da vitrine para a página do produto) só
// pode ter UM dono: a capa, e só enquanto a galeria está na capa. Duas fotos
// com o mesmo `view-transition-name` na mesma página fazem o navegador
// CANCELAR a transição inteira; e a capa que continua com o nome depois de a
// cliente ir para a foto 3 faria a foto 3 "voar" de volta ao sair. Caça por
// mutação, 24/11: nenhum teste olhava esse nome.
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O navegador do teste (jsdom) não tem transição de vista: o dublê liga o recurso.
vi.mock("@/hooks/useViewTransition", () => ({
  isViewTransitionSupported: true,
}));

const FOTOS = [
  "https://cdn.exemplo/a.jpg",
  "https://cdn.exemplo/b.jpg",
  "https://cdn.exemplo/c.jpg",
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

function nomesDeTransicao(indice: number): (string | undefined)[] {
  act(() =>
    raiz.render(
      <GaleriaDoProduto
        fotos={FOTOS}
        nome="Blusa"
        indice={indice}
        onMudarIndice={() => {}}
      />,
    ),
  );
  return [
    ...hospedeiro.querySelectorAll<HTMLImageElement>("img.main-product-image"),
  ].map(
    (img) =>
      (img.style as CSSStyleDeclaration & { viewTransitionName?: string })
        .viewTransitionName || undefined,
  );
}

describe("GaleriaDoProduto — quem carrega o nome da transição de vista", () => {
  it("na capa: só a primeira foto tem o nome", () => {
    expect(nomesDeTransicao(0)).toEqual([
      "product-image",
      undefined,
      undefined,
    ]);
  });

  it("a cliente está na foto 2: ninguém tem o nome (a capa não vira dona de uma saída que não é dela)", () => {
    expect(nomesDeTransicao(1)).toEqual([undefined, undefined, undefined]);
  });

  it("na última foto: ninguém tem o nome", () => {
    expect(nomesDeTransicao(2)).toEqual([undefined, undefined, undefined]);
  });
});

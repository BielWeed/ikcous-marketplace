// @vitest-environment jsdom
//
// O cartão da vitrine com um único produto escolhido dizia "1 escolhidos".
// No singular é "1 escolhido".
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O Reorder do framer-motion precisa de um grupo e de ponteiro de verdade.
vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  return {
    ...real,
    Reorder: {
      Group: (props: { children: React.ReactNode }) =>
        createElement("div", null, props.children),
      Item: (props: { children: React.ReactNode }) =>
        createElement("div", null, props.children),
    },
  };
});

const { CartaoDaVitrine } = await import(
  "@/components/admin/vitrines/CartaoDaVitrine"
);

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
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

async function mostrar(productIds: string[]) {
  await act(async () => {
    raiz.render(
      <CartaoDaVitrine
        secao={{
          id: "custom_1",
          title: "Kits de presente",
          active: true,
          maxItems: 6,
          productIds,
          isCustom: true,
        }}
        indice={0}
        total={1}
        produtosEmExibicao={[]}
        aoAbrir={() => {}}
        aoAlternarAtiva={() => {}}
        aoMover={() => {}}
        aoSoltar={() => {}}
        aoAlterarLayout={() => {}}
        travado={false}
      />,
    );
  });
}

describe("CartaoDaVitrine — produtos escolhidos", () => {
  it("um produto: '1 escolhido'", async () => {
    await mostrar(["p-1"]);
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("1 escolhido");
    expect(texto).not.toContain("1 escolhidos");
  });

  it("vários produtos: plural", async () => {
    await mostrar(["p-1", "p-2", "p-3"]);
    expect(hospedeiro.textContent).toContain("3 escolhidos");
  });
});

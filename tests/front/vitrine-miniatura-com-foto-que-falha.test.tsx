// @vitest-environment jsdom
//
// Miniatura de 42 px no cartao da vitrine (painel): pedia a foto ORIGINAL
// inteira e, se ela falhava, ficava o icone de imagem quebrada do navegador.
// Agora pede a foto pequena, cai para a original se a pequena falha, e so
// depois dos dois erros troca para o icone de etiqueta (o mesmo de produto sem foto).
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const ORIGINAL =
  "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg";

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

async function mostrar(images: string[]) {
  const produto = { id: "p1", name: "Vestido", images } as unknown as Product;
  await act(async () => {
    raiz.render(
      <CartaoDaVitrine
        secao={{
          id: "custom_1",
          title: "Kits",
          active: true,
          maxItems: 6,
          productIds: ["p1"],
          isCustom: true,
        }}
        indice={0}
        total={1}
        produtosEmExibicao={[produto]}
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

const miniaturas = () => hospedeiro.querySelector("[data-miniaturas]");
const foto = () => miniaturas()?.querySelector("img") ?? null;
async function falhar(img: Element | null) {
  expect(img).not.toBeNull();
  await act(async () => {
    img?.dispatchEvent(new Event("error"));
  });
}

describe("CartaoDaVitrine — miniatura do produto", () => {
  it("pede a foto pequena, nao a original inteira", async () => {
    await mostrar([ORIGINAL]);
    const src = foto()?.getAttribute("src") ?? "";
    expect(src).toContain("/render/image/public/products/foto1.jpg");
    expect(src).toContain("width=120");
  });

  it("se a pequena falha, tenta a original antes de desistir", async () => {
    await mostrar([ORIGINAL]);
    await falhar(foto());
    expect(foto()?.getAttribute("src")).toBe(ORIGINAL);
  });

  it("se nem a original carrega, troca para o icone de etiqueta (nada de imagem quebrada)", async () => {
    await mostrar([ORIGINAL]);
    await falhar(foto());
    await falhar(foto());
    expect(foto()).toBeNull();
    expect(miniaturas()?.querySelector(".lucide-tag")).not.toBeNull();
  });

  it("produto sem foto continua com o icone de etiqueta", async () => {
    await mostrar([]);
    expect(foto()).toBeNull();
    expect(miniaturas()?.querySelector(".lucide-tag")).not.toBeNull();
  });
});

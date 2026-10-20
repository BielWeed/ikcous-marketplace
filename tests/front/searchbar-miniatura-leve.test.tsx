// @vitest-environment jsdom
//
// As sugestões da busca desenham um quadradinho de 48 px por produto, mas a
// miniatura usava a foto ORIGINAL: em 3G, cada letra digitada baixava várias
// fotos grandes só para desenhar quadradinhos. Este teste prende o contrato
// novo: a miniatura pede a versão redimensionada (a mesma que o card do
// produto já usa), carrega devagar (lazy, decodificação assíncrona) e, se o
// redimensionamento falhar, volta sozinha para a foto original.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FOTO_ORIGINAL =
  "https://abc123.supabase.co/storage/v1/object/public/products/aliança-grande.jpg";

const catalogo: Product[] = [
  {
    id: "p1",
    name: "Aliança Luxo",
    description: "",
    price: 100,
    images: [FOTO_ORIGINAL],
    category: "Joias",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar — a miniatura da sugestão não baixa a foto original", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function digitarEPegarAMiniatura(): Promise<HTMLImageElement> {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");

    function Involucro() {
      const [valor, setValor] = useState("");
      return <SearchBar value={valor} onChange={setValor} />;
    }

    await act(async () => {
      raiz.render(<Involucro />);
    });

    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    await act(async () => {
      campo.focus();
      setter?.call(campo, "alianca");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const miniatura = hospedeiro.querySelector<HTMLImageElement>(
      'img[alt="Aliança Luxo"]',
    );
    // Âncora: a sugestão apareceu com a miniatura.
    expect(miniatura).not.toBeNull();
    return miniatura as HTMLImageElement;
  }

  it("pede a versão redimensionada, pequena, e não a original", async () => {
    const miniatura = await digitarEPegarAMiniatura();

    const url = new URL(miniatura.src);
    expect(url.pathname).toContain("/storage/v1/render/image/public/");
    expect(url.pathname).not.toContain("/storage/v1/object/public/");
    const largura = Number(url.searchParams.get("width"));
    // O quadradinho tem 48 px: até ~3x de densidade, nunca a foto inteira.
    expect(largura).toBeGreaterThanOrEqual(48);
    expect(largura).toBeLessThanOrEqual(160);
  });

  it("carrega devagar: lazy e decodificação assíncrona", async () => {
    const miniatura = await digitarEPegarAMiniatura();

    expect(miniatura.getAttribute("loading")).toBe("lazy");
    expect(miniatura.getAttribute("decoding")).toBe("async");
  });

  it("se o redimensionamento falhar, volta para a foto original", async () => {
    const miniatura = await digitarEPegarAMiniatura();
    expect(decodeURI(miniatura.src)).not.toBe(decodeURI(FOTO_ORIGINAL));

    await act(async () => {
      miniatura.dispatchEvent(new Event("error"));
    });

    expect(decodeURI(miniatura.src)).toBe(decodeURI(FOTO_ORIGINAL));
  });
});

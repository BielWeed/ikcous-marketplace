// @vitest-environment jsdom
//
// Texto colado na busca do topo so com caractere invisivel (U+200B espaco de
// largura zero, U+2060, U+200E, U+2800 Braille em branco, U+3164 Hangul) abria
// a caixinha dizendo 'Nenhum produto encontrado para ""': o `trim()` do
// JavaScript nao tira esses caracteres. Agora e busca VAZIA, como a busca so
// com espacos: a caixinha nao abre. Texto de verdade (com invisivel colado
// nas pontas) continua achando o produto. Invisiveis escapados (\uXXXX).
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const estado = vi.hoisted(() => ({ catalogo: [] as unknown[] }));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bolsa: Product = {
  id: "p1",
  name: "Bolsa Preta",
  description: "",
  price: 100,
  images: ["https://loja.example.com/foto.jpg"],
  category: "Acessorios",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};

describe("SearchBar — busca só com invisível é busca vazia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.catalogo = [bolsa];
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

  async function digitar(texto: string) {
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
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // `useDeferredValue` empurra o resultado para um render seguinte.
    await act(async () => {
      await Promise.resolve();
    });
  }

  const nomesNaCaixinha = () =>
    Array.from(hospedeiro.querySelectorAll("button img")).map(
      (img) => (img as HTMLImageElement).alt,
    );

  it.each(["\u200B", "\u2060", "\u200E", "\u2800", "\u3164", " \u200B\u3164 "])(
    "busca só com invisível %j: a caixinha não abre",
    async (busca) => {
      await digitar(busca);
      expect(hospedeiro.textContent).not.toContain("Nenhum produto encontrado");
      expect(hospedeiro.textContent).not.toContain("Produtos (");
      expect(nomesNaCaixinha()).toEqual([]);
    },
  );

  it("CONTROLE: texto real abre a caixinha com o produto", async () => {
    await digitar("bolsa");
    expect(nomesNaCaixinha()).toEqual(["Bolsa Preta"]);
  });

  it("CONTROLE: texto real com invisível colado nas pontas ainda acha o produto", async () => {
    await digitar("\u200Bbolsa\u2060");
    expect(nomesNaCaixinha()).toEqual(["Bolsa Preta"]);
  });

  it("CONTROLE: termo sem resultado ainda diz 'Nenhum produto encontrado'", async () => {
    await digitar("vestido");
    expect(hospedeiro.textContent).toContain("Nenhum produto encontrado");
  });
});

// @vitest-environment jsdom
//
// A busca do topo so repassa o texto ao App depois de 150 ms parada. Se a
// cliente acrescenta uma palavra e toca na sugestao de PRODUTO antes disso, o
// produto abre, mas o envio pendente ainda dispara: o App acha a cliente na
// tela do produto, entende que ela buscou algo e a leva de volta a Home. O
// produto abria e fechava sozinho. Agora o texto que ela ja "gastou" ao abrir
// o produto nao e mais enviado; digitar DEPOIS volta a funcionar.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

function produto(nome: string, id: string): Product {
  return {
    id,
    name: nome,
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

const catalogo = [
  produto("Camiseta Azul", "p-azul"),
  produto("Camiseta Verde", "p-verde"),
];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar: tocar na sugestao de produto antes dos 150 ms", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let enviados: string[];
  let produtosAbertos: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    enviados = [];
    produtosAbertos = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  const campo = () =>
    hospedeiro.querySelector("#global-search") as HTMLInputElement;
  const botaoDoProduto = (nome: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(nome),
    ) as HTMLButtonElement;
  // Chip de texto: o botao que so repete a palavra sugerida.
  const chipDeTexto = (palavra: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === palavra,
    ) as HTMLButtonElement;

  async function montar() {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    function Involucro() {
      const [valor, setValor] = useState("");
      return (
        <SearchBar
          value={valor}
          onChange={(v) => {
            enviados.push(v);
            setValor(v);
          }}
          onProductClick={(id) => produtosAbertos.push(id)}
        />
      );
    }
    await act(async () => {
      raiz.render(<Involucro />);
    });
  }

  async function digitar(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      campo().focus();
      setter?.call(campo(), texto);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const avancar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  /** Digita "camiseta", espera o envio (150 ms) e acrescenta " azul" sem esperar. */
  async function digitarEAcrescentar() {
    await montar();
    await digitar("camiseta");
    await avancar(200);
    expect(enviados).toEqual(["camiseta"]);
    await digitar("camiseta azul");
    expect(botaoDoProduto("Camiseta Azul")).toBeTruthy();
  }

  it("o produto abre uma vez e o texto digitado por cima NAO e enviado ao App", async () => {
    await digitarEAcrescentar();

    await act(async () => {
      botaoDoProduto("Camiseta Azul").click();
    });
    await avancar(500);

    expect(produtosAbertos).toEqual(["p-azul"]);
    expect(enviados).toEqual(["camiseta"]);
  });

  it("digitar DEPOIS de abrir o produto volta a enviar o texto novo", async () => {
    await digitarEAcrescentar();
    await act(async () => {
      botaoDoProduto("Camiseta Azul").click();
    });
    await avancar(500);

    await digitar("camiseta verde");
    await avancar(200);

    expect(enviados).toEqual(["camiseta", "camiseta verde"]);
  });

  it("digitar de novo o MESMO texto gasto tambem volta a enviar", async () => {
    await digitarEAcrescentar();
    await act(async () => {
      botaoDoProduto("Camiseta Azul").click();
    });
    await avancar(500);

    await digitar("camiseta azu");
    await digitar("camiseta azul");
    await avancar(200);

    expect(enviados).toEqual(["camiseta", "camiseta azul"]);
  });

  it("controle: tocar numa sugestao de TEXTO envia a sugestao na hora, como antes", async () => {
    await montar();
    await digitar("camis");
    await avancar(200);
    await digitar("camise");
    expect(chipDeTexto("Camiseta")).toBeTruthy();

    await act(async () => {
      chipDeTexto("Camiseta").click();
    });
    await avancar(500);

    expect(produtosAbertos).toEqual([]);
    expect(enviados).toEqual(["camis", "Camiseta"]);
    expect(campo().value).toBe("Camiseta");
  });

  it("controle: sem tocar em nada, o texto digitado segue indo ao App apos 150 ms", async () => {
    await montar();
    await digitar("camiseta");
    await avancar(149);
    expect(enviados).toEqual([]);
    await avancar(5);
    expect(enviados).toEqual(["camiseta"]);
  });

  it("controle: o botao limpar segue esvaziando o campo e avisando o App", async () => {
    await montar();
    await digitar("camiseta");
    await avancar(200);

    const limpar = hospedeiro.querySelector(
      'button[aria-label="Limpar busca"]',
    ) as HTMLButtonElement | null;
    expect(limpar).not.toBeNull();
    await act(async () => {
      limpar?.click();
    });
    await avancar(500);

    expect(campo().value).toBe("");
    expect(enviados).toEqual(["camiseta", ""]);
  });
});

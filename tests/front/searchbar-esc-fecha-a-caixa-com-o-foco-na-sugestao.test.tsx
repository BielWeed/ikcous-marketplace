// @vitest-environment jsdom
//
// Teclado na busca do topo: quem digita, aperta Tab até uma sugestão e depois
// Esc tem de sair da caixa. Antes, o Esc só era tratado no campo de texto e no
// botão invisível "Fechar busca": com o foco numa sugestão o evento subia e
// ninguém o tratava, a caixa seguia aberta cobrindo a tela e o Tab ia para os
// botões escondidos atrás do véu.
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
    category: "Joias",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

const catalogo = [
  produto("Colar Coração", "p1"),
  produto("Colar Pérola", "p2"),
  produto("Blusa Azul", "p3"),
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

describe("SearchBar — Esc fecha a caixa de sugestões de qualquer ponto dela", () => {
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

  const campo = () =>
    hospedeiro.querySelector("#global-search") as HTMLInputElement;
  const caixaAberta = () =>
    hospedeiro.querySelector('button[aria-label="Fechar busca"]') !== null;
  // Botões de sugestão: os da caixa que não são o X nem o véu.
  const sugestoes = () =>
    Array.from(hospedeiro.querySelectorAll("button")).filter(
      (b) => !b.hasAttribute("aria-label"),
    ) as HTMLButtonElement[];

  async function montarEDigitar(texto: string) {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");

    function Involucro() {
      const [valor, setValor] = useState("");
      return <SearchBar value={valor} onChange={setValor} />;
    }

    await act(async () => {
      raiz.render(<Involucro />);
    });

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      campo().focus();
      setter?.call(campo(), texto);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function apertarEsc(alvo: Element) {
    await act(async () => {
      alvo.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
  }

  it("com o foco numa sugestão, Esc fecha a caixa e devolve o foco ao campo", async () => {
    await montarEDigitar("colar");
    expect(caixaAberta()).toBe(true);
    const primeira = sugestoes()[0];
    expect(primeira).toBeTruthy();

    await act(async () => {
      primeira.focus();
    });
    expect(document.activeElement).toBe(primeira);

    await apertarEsc(primeira);

    expect(caixaAberta()).toBe(false);
    expect(document.activeElement).toBe(campo());
  });

  it("devolver o foco ao campo não reabre a caixa (o foco do campo abre quando há texto)", async () => {
    await montarEDigitar("colar");
    const primeira = sugestoes()[0];
    await act(async () => {
      primeira.focus();
    });

    await apertarEsc(primeira);
    await act(async () => {
      await Promise.resolve();
    });

    expect(caixaAberta()).toBe(false);
    // Foco volta ao campo, e um foco NOVO dele (Tab de volta) continua abrindo.
    await act(async () => {
      campo().blur();
    });
    await act(async () => {
      campo().focus();
    });
    expect(caixaAberta()).toBe(true);
  });

  it("controle: Esc no campo continua fechando e tirando o foco dele", async () => {
    await montarEDigitar("colar");
    expect(caixaAberta()).toBe(true);

    await apertarEsc(campo());

    expect(caixaAberta()).toBe(false);
    expect(document.activeElement).not.toBe(campo());
  });

  it("com a caixa fechada, Esc em outro lugar não rouba o foco para a busca", async () => {
    await montarEDigitar("colar");
    await apertarEsc(campo());
    expect(caixaAberta()).toBe(false);

    const outro = document.createElement("button");
    outro.textContent = "outro";
    document.body.appendChild(outro);
    await act(async () => {
      outro.focus();
    });

    await apertarEsc(outro);

    expect(document.activeElement).toBe(outro);
    outro.remove();
  });

  it("Esc vindo de fora da busca com a caixa aberta não a fecha (o véu e o clique fora cuidam disso)", async () => {
    await montarEDigitar("colar");
    expect(caixaAberta()).toBe(true);

    const fora = document.createElement("button");
    document.body.appendChild(fora);
    await apertarEsc(fora);

    // Fora do contêiner da busca o Esc não é da busca: ela segue como estava.
    expect(caixaAberta()).toBe(true);
    fora.remove();
  });
});

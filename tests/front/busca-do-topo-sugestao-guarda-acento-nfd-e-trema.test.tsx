// @vitest-environment jsdom
//
// Busca do topo: a sugestão de termo limpava a palavra com `[^\wÀ-ú]`. Dois
// defeitos dali: (1) nome cadastrado com acento SEPARADO (NFD, comum em texto
// colado) perdia o acento — "Café" virava "Cafe"; (2) "ü" (U+00FC) fica FORA da
// faixa À-ú, então "Lingüiça" virava "Lingiça" (e o termo cortado nem acha o
// produto). Agora a palavra vira NFC e só letra/número de qualquer alfabeto
// fica; pontuação continua saindo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const estado = vi.hoisted(() => ({ catalogo: [] as unknown[] }));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(),
  }),
}));
const semCategorias = vi.hoisted(() => ({ categories: [], isLoading: false }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => semCategorias,
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string, name: string): Product {
  return {
    id,
    name,
    description: "",
    price: 100,
    images: [],
    category: "Outros",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

describe("SearchBar — sugestão guarda acento NFD e trema", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.clearAllMocks();
  });

  async function sugestoesPara(
    busca: string,
    produtos: Product[],
  ): Promise<string[]> {
    estado.catalogo = produtos;
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    await act(async () => {
      raiz.render(<SearchBar value={busca} onChange={() => {}} />);
    });
    const campo = hospedeiro.querySelector("input")!;
    await act(async () => {
      campo.focus();
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    const titulo = Array.from(hospedeiro.querySelectorAll("span")).find(
      (s) => s.textContent === "Sugestões de Busca",
    );
    if (!titulo) return [];
    const fileira = titulo.parentElement!.nextElementSibling!;
    return Array.from(fileira.querySelectorAll("button")).map(
      (b) => b.textContent ?? "",
    );
  }

  it("'Café' cadastrado em NFD sugere 'Café' (NFC), com o acento", async () => {
    const nomeNfd = "Café Especial".normalize("NFD");
    const termos = await sugestoesPara("caf", [produto("1", nomeNfd)]);
    expect(termos).toContain("Café".normalize("NFC"));
    expect(termos).not.toContain("Cafe");
  }, 15000);

  it("'Lingüiça' continua 'Lingüiça' (o ü não é cortado)", async () => {
    const termos = await sugestoesPara("ling", [
      produto("1", "Lingüiça Toscana"),
    ]);
    expect(termos).toContain("Lingüiça");
    expect(termos).not.toContain("Lingiça");
  }, 15000);

  it("pontuação grudada na palavra continua saindo", async () => {
    const termos = await sugestoesPara("bol", [produto("1", "Bolo, Torta!")]);
    expect(termos).toContain("Bolo");
    expect(termos).not.toContain("Bolo,");
  }, 15000);
});

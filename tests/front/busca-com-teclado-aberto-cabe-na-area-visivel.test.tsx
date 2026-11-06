// @vitest-environment jsdom
// Vitrine, celular: com o teclado aberto, o cartão de resultados da busca
// (altura máxima de 72vh da página INTEIRA) passava por baixo do teclado e
// escondia o fim da lista e o botão "Ver todos os resultados". Com teclado, a
// altura máxima passa a ser a da área visível (visualViewport) menos o topo.
// jsdom NÃO calcula layout: aqui se prova o limite que o componente pede; a
// medida em pixels só um navegador real prova.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const teclado = vi.hoisted(() => ({
  estado: { altura: 0, alturaVisivel: 0 },
}));
vi.mock("@/hooks/useAlturaDoTeclado", () => ({
  useAlturaDoTeclado: () => teclado.estado,
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar — teclado aberto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    teclado.estado = { altura: 0, alturaVisivel: 0 };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir() {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    await act(async () => {
      raiz.render(<SearchBar value="bo" onChange={() => {}} />);
    });
    const campo = hospedeiro.querySelector("input")!;
    await act(async () => {
      campo.focus();
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver todos os resultados"),
    );
    expect(botao).toBeDefined();
    // O cartão é o ancestral que tem a rolagem própria.
    return botao!.closest<HTMLElement>(".overflow-y-auto")!;
  }

  it("com teclado, a altura máxima do cartão usa a área visível, não os 72vh da página", async () => {
    teclado.estado = { altura: 300, alturaVisivel: 500 };
    const cartao = await abrir();
    expect(cartao.style.maxHeight).toContain("500px");
    expect(cartao.style.maxHeight).toContain("--header-height");
    // Continua nunca passando de 72vh (tela alta, teclado baixo).
    expect(cartao.style.maxHeight).toContain("72vh");
  }, 15000);

  it("sem teclado, nada muda: segue o limite de 72vh da classe", async () => {
    const cartao = await abrir();
    expect(cartao.style.maxHeight).toBe("");
    expect(cartao.className).toContain("max-h-[72vh]");
  }, 15000);
});

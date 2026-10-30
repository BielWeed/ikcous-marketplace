// @vitest-environment jsdom
//
// Medido em 30/10/2026 (Savy, celular 375px, página de produto): a busca do
// topo, espremida entre o botão Voltar, o logo e o sino, ficava com 143px e o
// texto de apoio aparecia cortado ("Buscar p"). O campo reservava 88px de
// margem interna (48 à esquerda + 40 à direita), mas os 40px da direita só
// servem ao X de limpar, que só existe quando há texto digitado. Agora a
// reserva da direita só vale com texto, a da esquerda acompanha o ícone, e o
// texto de apoio que não couber termina em reticências em vez de ser cortado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { logoUrl: null }, isLoaded: true }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar: a margem interna não rouba a largura do texto de apoio", () => {
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

  async function renderizar(value: string) {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    await act(async () => {
      raiz.render(
        <SearchBar
          value={value}
          onChange={() => {}}
          placeholder="Buscar produtos"
        />,
      );
    });
    return document.getElementById("global-search") as HTMLInputElement;
  }

  it("vazio: sem reserva do X na direita e texto de apoio com reticências", async () => {
    const input = await renderizar("");
    expect(input.classList.contains("pr-3")).toBe(true);
    expect(input.classList.contains("pr-10")).toBe(false);
    expect(input.classList.contains("pl-10")).toBe(true);
    expect(input.classList.contains("placeholder:text-ellipsis")).toBe(true);
  });

  it("com texto: a reserva do X volta, para o texto não ficar embaixo dele", async () => {
    const input = await renderizar("saia");
    expect(input.classList.contains("pr-10")).toBe(true);
    expect(input.classList.contains("pr-3")).toBe(false);
    expect(
      document.querySelector('[aria-label="Limpar busca"]'),
    ).not.toBeNull();
  });
});

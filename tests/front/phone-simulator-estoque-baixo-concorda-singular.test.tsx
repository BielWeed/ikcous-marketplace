// @vitest-environment jsdom
//
// A prévia do painel tem de dizer o MESMO que a loja (src/lib/texto-estoque-
// baixo.ts): com 1 unidade, "Resta apenas 1!"; com 3, "Restam apenas 3!".
// Antes a prévia dizia "Só restam 1" (cartão) e "Apenas 1 un. restantes!"
// (página), concordância errada e texto diferente do que a cliente vê.
// O componente faz createPortal para document.body.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "local" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const formDataBase = {
  name: "Produto de teste",
  description: "Descricao de teste",
  price: "100",
  costPrice: "50",
  originalPrice: "",
  stock: "10",
  category: "geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [],
};

describe("PhoneSimulator — aviso de estoque baixo igual ao da loja", () => {
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

  async function montar(stock: string, previewMode: "card" | "page") {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );
    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={{ ...formDataBase, stock }}
          previewMode={previewMode}
          setPreviewMode={() => {}}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={() => {}}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />,
      );
    });
  }

  for (const modo of ["card", "page"] as const) {
    it(`${modo}, 1 unidade: 'Resta apenas 1!'`, async () => {
      await montar("1", modo);
      expect(document.body.textContent).toContain("Resta apenas 1!");
      expect(document.body.textContent).not.toContain("restam");
      expect(document.body.textContent).not.toContain("restantes");
    });

    it(`${modo}, 3 unidades: 'Restam apenas 3!'`, async () => {
      await montar("3", modo);
      expect(document.body.textContent).toContain("Restam apenas 3!");
    });
  }
});

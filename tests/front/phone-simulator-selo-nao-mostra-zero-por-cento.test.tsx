// @vitest-environment jsdom
//
// Prévia do celular — o selo "% OFF" só aparece quando o desconto, já
// arredondado, é de pelo menos 1%. De R$ 100 por R$ 99,70 é 0,3%: arredonda
// para 0 e o selo dizia "0% OFF". O cartão da loja já esconde esse selo
// (`discount > 0`); a prévia tem de mostrar o mesmo que a loja.
//
// Modelo estrutural: phone-simulator-preco-promocional.test.tsx (mesmo mock do
// StoreContext, componente isolado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, freeShippingMin: 0 },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const formDataBase = {
  name: "Produto de teste",
  description: "Descricao de teste",
  price: "99.7",
  costPrice: "5",
  originalPrice: "100",
  stock: "10",
  category: "geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [],
};

describe("PhoneSimulator — selo '% OFF' não aparece quando o desconto arredonda para 0", () => {
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
    vi.unstubAllGlobals();
  });

  async function montar(
    previewMode: "card" | "page",
    formData: typeof formDataBase,
  ) {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );
    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={formData}
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

  const texto = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

  for (const modo of ["card", "page"] as const) {
    it(`modo '${modo}': De 100 por 99,70 não mostra '0% OFF' (mas o preço continua)`, async () => {
      await montar(modo, formDataBase);
      expect(texto()).not.toContain("0% OFF");
      expect(texto()).toContain("R$ 99,70");
    });

    it(`modo '${modo}': CONTROLE — De 100 por 75 mostra '25% OFF'`, async () => {
      await montar(modo, { ...formDataBase, price: "75" });
      expect(texto()).toContain("25% OFF");
    });
  }
});

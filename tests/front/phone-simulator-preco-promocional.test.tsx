// @vitest-environment jsdom
//
// Lacuna de teste apontada na revisão: `selo-desconto-verde.test.tsx` cobre
// o selo "% OFF" do PhoneSimulator nos dois modos (cartão/página), mas
// nenhum arquivo cobria a cor do PREÇO "Por: R$ ..." em si nos dois modos —
// só o card da vitrine e a página do produto de verdade tinham teste
// (`preco-promocional-verde.test.tsx`, `product-view-barra-fixa-preco-
// promocional.test.tsx`). Este arquivo fecha essa lacuna: modo "cartão"
// (fundo escuro, `CLASSE_PRECO_PROMOCIONAL_FUNDO_ESCURO` = text-emerald-400)
// e modo "página" (fundo claro, `CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO` =
// text-emerald-700).
//
// Modelo estrutural copiado do describe "PhoneSimulator" de
// selo-desconto-verde.test.tsx (mesmo formData, sem mocks — componente
// isolado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PhoneSimulator usa @/contexts/StoreContext (frete grátis) por baixo — sem
// mock, o StoreContext de verdade puxa @/lib/supabase, que explode com
// "[EnvGuard] Variáveis de ambiente ausentes" fora do app de verdade (mesmo
// mock do describe "PhoneSimulator" em selo-desconto-verde.test.tsx).
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, freeShippingMin: 0 },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function encontraPrecoPor(raiz: ParentNode): Element | undefined {
  return Array.from(raiz.querySelectorAll("span")).find((el) =>
    el.textContent?.trim().startsWith("Por:"),
  );
}

describe("PhoneSimulator — preço promocional ('Por:') usa verde, não vermelho (os dois modos)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  const formDataComPromocao = {
    name: "Produto de teste",
    description: "Descricao de teste",
    price: "12.9",
    costPrice: "5",
    originalPrice: "24.9",
    stock: "10",
    category: "geral",
    images: [] as string[],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    variants: [],
  };

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

  it("modo 'cartão' (fundo escuro): o preço usa text-emerald-400, não text-rose-*", async () => {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );

    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={formDataComPromocao}
          previewMode="card"
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

    const preco = encontraPrecoPor(document.body);
    expect(preco).not.toBeUndefined();
    expect(preco?.textContent?.trim()).toBe("Por: R$ 12,90");
    expect(preco?.classList.contains("text-emerald-400")).toBe(true);
    expect(preco?.classList.contains("text-rose-600")).toBe(false);
    expect(preco?.classList.contains("text-rose-500")).toBe(false);
  });

  it("modo 'página' (fundo claro): o preço usa text-emerald-700, não text-rose-*", async () => {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );

    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={formDataComPromocao}
          previewMode="page"
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

    const preco = encontraPrecoPor(document.body);
    expect(preco).not.toBeUndefined();
    expect(preco?.textContent?.trim()).toBe("Por: R$ 12,90");
    expect(preco?.classList.contains("text-emerald-700")).toBe(true);
    expect(preco?.classList.contains("text-rose-600")).toBe(false);
    expect(preco?.classList.contains("text-rose-500")).toBe(false);
  });
});

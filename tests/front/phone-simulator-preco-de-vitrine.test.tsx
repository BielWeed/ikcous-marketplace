// @vitest-environment jsdom
import { PhoneSimulator } from "@/components/admin/PhoneSimulator";
import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product, ProductVariant } from "@/types";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false, freeShippingMin: 0 } }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function tamanho(
  value: string,
  priceOverride?: number,
  stockIncrement = 5,
): ProductVariant {
  return {
    id: value,
    productId: "p1",
    name: "Tamanho",
    value,
    active: true,
    priceOverride,
    stockIncrement,
  };
}

const casos = [
  {
    nome: "escolher G na Página não muda o preço anunciado no Card",
    variants: [tamanho("P", 50), tamanho("G", 60)],
    preco: "50,00",
    faixa: true,
    escolherGNaPagina: true,
  },
  {
    nome: "base de 70 com P a 50 e G a 60 anuncia a partir de R$ 50,00",
    variants: [tamanho("P", 50), tamanho("G", 60)],
    preco: "50,00",
    faixa: true,
  },
  {
    nome: "sem variações anuncia o preço-base",
    variants: [],
    preco: "70,00",
    faixa: false,
  },
  {
    nome: "preços iguais, inclusive o herdado, não formam faixa",
    variants: [tamanho("P"), tamanho("G", 70)],
    preco: "70,00",
    faixa: false,
  },
  {
    nome: "ignora a opção esgotada e calcula a promoção sobre a menor à venda",
    variants: [tamanho("P", 40, 0), tamanho("M", 50), tamanho("G")],
    preco: "50,00",
    faixa: true,
    originalPrice: 100,
  },
];

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

it.each(casos)(
  "prévia e vitrine: $nome",
  async ({ variants, preco, faixa, originalPrice, escolherGNaPagina }) => {
    const produto: Product = {
      id: "p1",
      name: "Camiseta",
      description: "",
      price: 70,
      originalPrice,
      category: "roupas",
      images: [],
      stock: 10,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: "2026-01-01",
      variants,
    };
    function PreviaComAbas() {
      const [modo, setModo] = useState<"card" | "page">("card");
      const [escolhas, setEscolhas] = useState<Record<string, string>>({});
      return (
        <PhoneSimulator
          onClose={() => {}}
          formData={{
            ...produto,
            price: "70",
            stock: "10",
            costPrice: "",
            originalPrice: originalPrice?.toString() ?? "",
            variants,
          }}
          previewMode={modo}
          setPreviewMode={setModo}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={escolhas}
          setPreviewSelectedVariants={setEscolhas}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />
      );
    }

    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    try {
      await act(async () => {
        raiz.render(
          <>
            <ProductCard
              product={produto}
              isFavorite={false}
              onToggleFavorite={() => {}}
              onClick={() => {}}
              onAddToCartWithVariants={() => 1}
              showRating={false}
            />
            <PreviaComAbas />
          </>,
        );
      });
      const previa = document.querySelector('[role="dialog"]');
      expect(previa).not.toBeNull();
      if (!previa) return;
      if (escolherGNaPagina) {
        async function clicarBotao(nome: RegExp) {
          const botao = Array.from(
            previa?.querySelectorAll("button") ?? [],
          ).find((el) => nome.test(el.textContent ?? ""));
          if (!botao) throw new Error(`Botão ausente: ${nome}`);
          await act(async () => botao.click());
        }

        await clicarBotao(/^Página$/);
        await clicarBotao(/^G\(/);
        expect(previa.textContent).toContain("R$ 60,00");
        await clicarBotao(/^Card$/);

        const faixaDePreco = /a partir de\s*r\$\s*([\d.,]+)/i;
        const [, precoDaVitrine] =
          hospedeiro.textContent?.match(faixaDePreco) ?? [];
        const [, precoDaPrevia] = previa.textContent?.match(faixaDePreco) ?? [];
        expect(precoDaVitrine).toBeDefined();
        expect(precoDaPrevia).toBe(precoDaVitrine);
      }
      for (const superficie of [hospedeiro, previa]) {
        const texto = superficie.textContent?.replace(/\s/g, " ") ?? "";
        expect(texto).toContain(`R$ ${preco}`);
        expect(/a partir de/i.test(texto)).toBe(faixa);
        if (originalPrice) {
          expect(
            superficie.querySelector(".line-through")?.textContent,
          ).toMatch(/100,00/);
          expect(superficie.textContent).toContain("50% OFF");
          expect(superficie.textContent).not.toContain("40,00");
        }
      }
    } finally {
      act(() => raiz.unmount());
      hospedeiro.remove();
      vi.unstubAllGlobals();
    }
  },
);

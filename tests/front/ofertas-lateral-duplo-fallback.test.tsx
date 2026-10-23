import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
// @vitest-environment jsdom
//
// Enquanto o módulo do "Lateral em duas fileiras" ainda baixa, a faixa mostra o esqueleto. A página não pode
// pular quando o cartão real chega: com 1 oferta a faixa tem UMA fileira (206px), com 2 ou mais, duas (318px).
// O módulo real é trocado por um import que nunca termina, para o fallback ficar na tela.
import {
  ALTURA_SECAO_DUPLO,
  ALTURA_SECAO_DUPLO_UMA_FILEIRA,
} from "@/components/ui/custom/ofertas-lateral-duplo-altura";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false } }),
}));
vi.mock(
  "@/components/ui/custom/OfertasLateralDuplo",
  () => new Promise(() => {}),
);

const produto = (id: string): Product =>
  ({
    id,
    name: id,
    price: 50,
    originalPrice: 100,
    images: [],
    description: "",
    category: "Teste",
    stock: 20,
    isActive: true,
  }) as unknown as Product;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const montar = async (n: number) => {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={Array.from({ length: n }, (_, i) => produto(`p${i}`))}
        favorites={[]}
        layout="lateral-duplo"
        onProductClick={() => {}}
        onToggleFavorite={() => {}}
      />,
    );
  });
  return host.querySelector<HTMLElement>('[data-testid="esqueleto-ofertas"]');
};

describe("fallback do Lateral em duas fileiras", () => {
  it("1 oferta: esqueleto de UMA fileira (206px), igual à faixa real", async () => {
    const esq = await montar(1);
    expect(esq?.style.minHeight).toBe(`${ALTURA_SECAO_DUPLO_UMA_FILEIRA}px`);
    expect(host.querySelectorAll("[data-cartao-esqueleto]")).toHaveLength(1);
  });

  it.each([2, 3, 6])(
    "%i ofertas: esqueleto de duas fileiras (318px)",
    async (n) => {
      const esq = await montar(n);
      expect(esq?.style.minHeight).toBe(`${ALTURA_SECAO_DUPLO}px`);
      expect(host.querySelectorAll("[data-cartao-esqueleto]")).toHaveLength(4);
    },
  );
});

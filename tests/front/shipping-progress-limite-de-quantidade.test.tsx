// @vitest-environment jsdom
import { ShippingProgress } from "@/components/ui/custom/ShippingProgress";
import { MAX_ITEM_QUANTITY } from "@/lib/limite-de-quantidade";
import type { Product } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it.each([2, MAX_ITEM_QUANTITY + 20])(
  "seletor respeita estoque %s e teto do carrinho",
  (stock) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const produto: Product = {
      id: "p",
      name: "Produto",
      description: "",
      price: 10,
      stock,
      images: [],
      category: "geral",
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: "2026-11-18",
      rating: 0,
      reviewCount: 0,
    };
    const adicionar = vi.fn();
    try {
      act(() =>
        root.render(
          <ShippingProgress
            estado="meta"
            savings={0}
            progressPercent={20}
            amountToFree={30}
            isNearlyThere={false}
            freeShippingProducts={[produto]}
            onAddToCart={adicionar}
          />,
        ),
      );
      const mais = host.querySelector<HTMLButtonElement>(
        '[aria-label="Aumentar quantidade de Produto"]',
      )!;
      const maximo = Math.min(stock, MAX_ITEM_QUANTITY);
      for (let i = 1; i < maximo; i++) act(() => mais.click());
      expect(mais.disabled).toBe(true);
      act(() => mais.click());
      const botao = Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent === "Adicionar",
      )!;
      act(() => botao.click());
      expect(adicionar).toHaveBeenLastCalledWith(produto, maximo);
      const menos = host.querySelector<HTMLButtonElement>(
        '[aria-label="Diminuir quantidade de Produto"]',
      )!;
      act(() => menos.click());
      expect(mais.disabled).toBe(false);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  },
);

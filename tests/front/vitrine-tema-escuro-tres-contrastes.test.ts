import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product } from "@/types";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const fontes = import.meta.glob<string>(
  [
    "/src/views/customer/ProductView.tsx",
    "/src/views/customer/CheckoutView.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);
// As duas telas completas dependem do checkout/carrinho e da carga do produto.
// Aqui a cobertura delas continua estática, mas comentários não satisfazem a guarda.
const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("contraste no tema escuro sem alterar o tema claro", () => {
  it("nome e preço do card têm as classes reais de contraste no DOM", async () => {
    class ObservadorFalso {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    const produto: Product = {
      id: "contraste",
      name: "Camiseta Lisa",
      description: "",
      price: 50,
      images: [],
      category: "roupas",
      stock: 40,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: "2026-11-18",
    };
    try {
      await act(async () =>
        raiz.render(
          createElement(ProductCard, {
            product: produto,
            isFavorite: false,
            onToggleFavorite: () => {},
            onClick: () => {},
            priority: true,
            showRating: false,
          }),
        ),
      );
      const nome = hospedeiro.querySelector("h3 button");
      expect(nome).not.toBeNull();
      expect(nome?.textContent).toBe("Camiseta Lisa");
      for (const classe of [
        "dark:text-foreground",
        "group-hover:text-primary-legivel",
        "dark:group-hover:text-primary-legivel",
      ]) {
        expect(nome?.classList.contains(classe)).toBe(true);
      }
      const preco = [...hospedeiro.querySelectorAll("span")].find(
        (el) => el.textContent?.replace(/\s/g, "") === "R$50,00",
      );
      expect(preco).toBeDefined();
      expect(preco?.classList.contains("dark:text-foreground")).toBe(true);
      expect(preco?.classList.contains("dark:group-hover:text-slate-900")).toBe(
        true,
      );
    } finally {
      act(() => raiz.unmount());
      hospedeiro.remove();
      vi.unstubAllGlobals();
    }
  });

  it("preço sobre o cartão branco no computador (fonte sem comentários)", () => {
    const fonte = semComentarios(fontes["/src/views/customer/ProductView.tsx"]);
    expect(fonte).toContain("lg:bg-white");
    expect(fonte).toContain("tracking-tight text-foreground lg:text-zinc-950");
  });

  it("aviso de retomada (fonte sem comentários)", () => {
    const fonte = semComentarios(
      fontes["/src/views/customer/CheckoutView.tsx"],
    );
    expect(fonte).toMatch(
      /role="alert"\s+className="text-sm font-medium text-red-700 dark:text-red-400"/,
    );
  });
});

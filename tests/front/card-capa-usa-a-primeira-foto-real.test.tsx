// @vitest-environment jsdom
//
// Produto de cadastro antigo guarda `images = [marcador placehold.co, foto
// real]`. A página do produto já pula o marcador (`soFotosReais`) e mostra a
// foto real; o card usava `images[0]` e desenhava o cartão cinza "Sem foto" --
// os dois mostravam capas diferentes do mesmo produto.
//
// Render de verdade (react-dom/client + jsdom), nos dois desenhos do card. O
// que se prova é o que a cliente vê: a foto real, ou o "Sem foto" quando o
// produto não tem nenhuma (o marcador que o mapper devolve segue valendo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MARCADOR = "https://placehold.co/600x600?text=Sem+Imagem";
const FOTO_REAL = "https://fotos.example.com/foto-real.jpg";
const OUTRA_FOTO = "https://fotos.example.com/segunda-foto.jpg";

// A foto só vira <img> quando entra na tela: o observador falso já avisa que sim.
class ObservadorQueVe {
  private readonly aviso: IntersectionObserverCallback;
  constructor(aviso: IntersectionObserverCallback) {
    this.aviso = aviso;
  }
  observe(alvo: Element) {
    this.aviso(
      [{ isIntersecting: true, target: alvo } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function produto(images: string[]): Product {
  return {
    id: "prod-capa",
    name: "Camisa Antiga",
    description: "Descrição de teste",
    price: 80,
    images,
    category: "roupas",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 3,
  };
}

describe("ProductCard — a capa é a primeira foto REAL do produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanho);
    vi.stubGlobal("IntersectionObserver", ObservadorQueVe);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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

  async function renderizar(images: string[], layout: "card" | "linha") {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto(images)}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          showRating={false}
          layout={layout}
        />,
      );
    });
  }

  const fotos = () =>
    Array.from(hospedeiro.querySelectorAll<HTMLImageElement>("img")).map(
      (img) => img.getAttribute("src") ?? "",
    );

  for (const layout of ["card", "linha"] as const) {
    describe(`desenho '${layout}'`, () => {
      it("marcador na frente, foto real depois: mostra a foto real, não o 'Sem foto'", async () => {
        await renderizar([MARCADOR, FOTO_REAL], layout);
        expect(fotos().some((src) => src.includes("foto-real.jpg"))).toBe(true);
        expect(hospedeiro.textContent).not.toContain("Sem foto");
      });

      it("só o marcador (produto sem foto): continua o 'Sem foto' de sempre", async () => {
        await renderizar([MARCADOR], layout);
        expect(hospedeiro.textContent).toContain("Sem foto");
        expect(fotos()).toEqual([]);
      });

      it("só fotos reais: a capa é a primeira", async () => {
        await renderizar([FOTO_REAL, OUTRA_FOTO], layout);
        const srcs = fotos();
        expect(srcs.some((src) => src.includes("foto-real.jpg"))).toBe(true);
        expect(srcs.some((src) => src.includes("segunda-foto.jpg"))).toBe(
          false,
        );
      });
    });
  }
});

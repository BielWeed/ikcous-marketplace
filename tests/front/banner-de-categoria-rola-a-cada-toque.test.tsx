// @vitest-environment jsdom
//
// Tocar num banner com link de categoria SEMPRE leva ao Catálogo, inclusive no
// segundo toque no mesmo banner (a categoria já é a atual). Banner que leva a
// outra tela ou a um site não rola.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rolar } = vi.hoisted(() => ({ rolar: vi.fn() }));
vi.mock("@/lib/rolar-ao-catalogo", () => ({ rolarAoCatalogo: rolar }));
vi.mock("embla-carousel-react", () => ({
  default: () => [
    vi.fn(),
    {
      scrollNext: vi.fn(),
      scrollTo: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      selectedScrollSnap: () => 0,
    },
  ],
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("BannerCarousel: rolagem até o Catálogo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rolar.mockClear();
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    globalThis.history.replaceState({}, "", "/");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.history.replaceState({}, "", "/");
  });

  async function montar(link: string) {
    const banner: Banner = {
      id: "b1",
      imageUrl: "https://example.com/banner.jpg",
      title: "Campanha",
      position: "home_top",
      active: true,
      order: 1,
      link,
    };
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(<BannerCarousel banners={[banner]} autoPlay={false} />);
    });
    return hospedeiro.querySelector<HTMLElement>('[role="button"]');
  }

  it("o segundo toque no mesmo banner de categoria rola de novo", async () => {
    const alvo = await montar("/?category=Vestidos");
    await act(async () => alvo?.click());
    await act(async () => alvo?.click());
    expect(rolar).toHaveBeenCalledTimes(2);
  });

  it.each(["/", "/?category=Vestidos"])(
    "dois toques no endereço atual %s não empilham histórico",
    async (endereco) => {
      globalThis.history.replaceState({ view: "home" }, "", endereco);
      const estadoAntes = globalThis.history.state;
      const tamanhoAntes = globalThis.history.length;
      const empilhar = vi.spyOn(globalThis.history, "pushState");
      const popstate = vi.fn();
      globalThis.addEventListener("popstate", popstate);
      try {
        const alvo = await montar(endereco);
        expect(alvo).not.toBeNull();
        for (let toque = 0; toque < 2; toque++) {
          await act(async () => alvo?.click());
          expect(empilhar).not.toHaveBeenCalled();
          expect(globalThis.history.length).toBe(tamanhoAntes);
          expect(globalThis.history.state).toEqual(estadoAntes);
          expect(popstate).not.toHaveBeenCalled();
        }
        expect(rolar).toHaveBeenCalledTimes(
          endereco.includes("category") ? 2 : 0,
        );
      } finally {
        globalThis.removeEventListener("popstate", popstate);
      }
    },
  );

  it.each(["/?category=Sapatos", "/profile"])(
    "destino diferente %s ainda navega uma vez",
    async (destino) => {
      globalThis.history.replaceState(
        { view: "home" },
        "",
        "/?category=Vestidos",
      );
      const tamanhoAntes = globalThis.history.length;
      const empilhar = vi.spyOn(globalThis.history, "pushState");
      const popstate = vi.fn();
      globalThis.addEventListener("popstate", popstate);
      try {
        const alvo = await montar(destino);
        expect(alvo).not.toBeNull();
        await act(async () => alvo?.click());
        expect(empilhar).toHaveBeenCalledTimes(1);
        expect(globalThis.history.length).toBe(tamanhoAntes + 1);
        expect(globalThis.location.pathname + globalThis.location.search).toBe(
          destino,
        );
        expect(globalThis.history.state).toEqual({
          view: destino === "/profile" ? "profile" : "home",
          id: undefined,
          from: "home",
        });
        expect(popstate).toHaveBeenCalledTimes(1);
        await act(async () => alvo?.click());
        expect(empilhar).toHaveBeenCalledTimes(1);
        expect(globalThis.history.length).toBe(tamanhoAntes + 1);
        expect(popstate).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.removeEventListener("popstate", popstate);
      }
    },
  );

  it("banner que leva a outra tela não rola", async () => {
    const alvo = await montar("/profile");
    await act(async () => alvo?.click());
    expect(rolar).not.toHaveBeenCalled();
  });
});

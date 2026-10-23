// @vitest-environment jsdom
//
// WCAG 2.2.2 (achado loja-ux-a11y-1): a vitrine de ofertas (layout padrão) trocava
// de slide sozinha a cada 6 s e nao deixava pausar. Aqui se prova o COMPORTAMENTO
// por eventos (jsdom nao enxerga CSS): quando gira e quando para.
// O embla e' trocado por um dublê com `scrollNext` espiavel -- o que importa e'
// quando a vitrine PEDE a troca, nao a animacao do embla.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const scrollNext = vi.fn();
vi.mock("embla-carousel-react", () => ({
  default: () => [
    () => {},
    {
      scrollNext,
      scrollTo: () => {},
      selectedScrollSnap: () => 0,
      on: () => {},
      off: () => {},
    },
  ],
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true, freeShippingMin: 0 } }),
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function produto(id: string): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "d",
    price: 80,
    originalPrice: 100,
    images: ["https://example.com/img.png"],
    category: "geral",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
  };
}

let menosMovimento = false;
let ouvintesDeMovimento: Array<(e: { matches: boolean }) => void> = [];
function ocultarAba(oculta: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => oculta,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("vitrine de ofertas pausa a rotacao automatica", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar() {
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produto("a"), produto("b")]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });
    return hospedeiro.firstElementChild as HTMLElement;
  }
  const avancar = (ms: number) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });
  const disparar = (el: Element, tipo: string, extra: EventInit = {}) =>
    act(async () => {
      el.dispatchEvent(new Event(tipo, { bubbles: true, ...extra }));
    });

  beforeEach(() => {
    vi.useFakeTimers();
    scrollNext.mockClear();
    menosMovimento = false;
    ouvintesDeMovimento = [];
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: menosMovimento && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => {
        if (query.includes("prefers-reduced-motion"))
          ouvintesDeMovimento.push(fn);
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    ocultarAba(false);
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
    vi.useRealTimers();
  });

  it("sem interacao, troca de slide a cada 6 s", async () => {
    await montar();
    await avancar(5900);
    expect(scrollNext).not.toHaveBeenCalled();
    await avancar(200);
    expect(scrollNext).toHaveBeenCalledTimes(1);
    await avancar(6000);
    expect(scrollNext).toHaveBeenCalledTimes(2);
  });

  it("para com o mouse em cima e retoma ao sair", async () => {
    const vitrine = await montar();
    await disparar(vitrine, "mouseover");
    await avancar(20000);
    expect(scrollNext).not.toHaveBeenCalled();
    await disparar(vitrine, "mouseout");
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("para com o foco do teclado dentro e retoma quando o foco sai", async () => {
    const vitrine = await montar();
    const botao = vitrine.querySelector("button") as HTMLElement;
    botao.matches = () => true; // foco de teclado
    await disparar(botao, "focusin");
    await avancar(20000);
    expect(scrollNext).not.toHaveBeenCalled();
    await disparar(botao, "focusout");
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("para enquanto o dedo toca/arrasta e retoma depois", async () => {
    const vitrine = await montar();
    await disparar(vitrine, "touchstart");
    await avancar(20000);
    expect(scrollNext).not.toHaveBeenCalled();
    await disparar(vitrine, "touchend");
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("o mouse emulado logo apos o toque nao trava a vitrine parada", async () => {
    const vitrine = await montar();
    await disparar(vitrine, "touchstart");
    await disparar(vitrine, "touchend");
    await disparar(vitrine, "mouseover");
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("nao gira sozinha para quem pediu menos movimento", async () => {
    menosMovimento = true;
    await montar();
    await avancar(30000);
    expect(scrollNext).not.toHaveBeenCalled();
  });

  it("para com a aba escondida e volta quando ela reaparece", async () => {
    await montar();
    await act(async () => ocultarAba(true));
    await avancar(20000);
    expect(scrollNext).not.toHaveBeenCalled();
    await act(async () => ocultarAba(false));
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("mouse sai mas o foco de teclado continua dentro: segue parada", async () => {
    const vitrine = await montar();
    const botao = vitrine.querySelector("button") as HTMLElement;
    botao.matches = () => true; // foco de teclado
    await disparar(vitrine, "mouseover");
    await disparar(botao, "focusin");
    await disparar(vitrine, "mouseout");
    await avancar(20000);
    expect(scrollNext).not.toHaveBeenCalled();
    await disparar(botao, "focusout");
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("foco vindo de clique/toque (nao e :focus-visible) nao pausa", async () => {
    const vitrine = await montar();
    const botao = vitrine.querySelector("button") as HTMLElement;
    botao.matches = () => false;
    await disparar(botao, "focusin");
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("se :focus-visible nao for suportado, o foco conta como teclado", async () => {
    const vitrine = await montar();
    const botao = vitrine.querySelector("button") as HTMLElement;
    botao.matches = () => {
      throw new SyntaxError("seletor invalido");
    };
    await disparar(botao, "focusin");
    await avancar(20000);
    expect(scrollNext).not.toHaveBeenCalled();
  });

  it("mouse real depois da janela do toque pausa", async () => {
    const vitrine = await montar();
    await disparar(vitrine, "touchstart");
    await disparar(vitrine, "touchend");
    await avancar(1100);
    await disparar(vitrine, "mouseover");
    scrollNext.mockClear();
    await avancar(20000);
    expect(scrollNext).not.toHaveBeenCalled();
  });

  it("ligar menos movimento ao vivo para a rotacao", async () => {
    await montar();
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (const fn of ouvintesDeMovimento) fn({ matches: true });
    });
    scrollNext.mockClear();
    await avancar(30000);
    expect(scrollNext).not.toHaveBeenCalled();
  });

  it("remove o ouvinte de visibilitychange ao desmontar", async () => {
    const espiao = vi.spyOn(document, "removeEventListener");
    await montar();
    act(() => {
      raiz.unmount();
    });
    expect(espiao.mock.calls.map((c) => c[0])).toContain("visibilitychange");
    espiao.mockRestore();
    raiz = createRoot(hospedeiro);
  });

  it("limpa o intervalo ao desmontar", async () => {
    await montar();
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
    act(() => {
      raiz.unmount();
    });
    await avancar(30000);
    expect(scrollNext).toHaveBeenCalledTimes(1);
    raiz = createRoot(hospedeiro);
  });
});

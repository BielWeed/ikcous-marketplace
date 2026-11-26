// @vitest-environment jsdom
//
// Caça por mutação nos Favoritos da cliente: o atalho de categoria "tocado"
// (que fica destacado até a rolagem suave acabar) e o cálculo da seção em vista.
// Pontos que nenhum teste vizinho prendia:
//   - TODA tecla de rolagem devolve o comando à rolagem manual (Home, End,
//     PageUp, PageDown, setas para cima/baixo e espaço), e tecla comum não;
//   - sem nenhuma rolagem, o atalho tocado só solta depois de ~300 ms (nem
//     antes) e, com rolagem sem parar, só no teto de ~1 s (nem antes);
//   - girar o aparelho / redimensionar a janela recalcula a seção em vista;
//   - página que rola só 3 px, encostada no fundo, já conta como "fim".
import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false }, products: [] }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ erro: null, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn(), prefetchImage: vi.fn() }),
}));

function produto(id: string, name: string, category: string): Product {
  return {
    id,
    name,
    price: 10,
    category,
    description: "",
    images: [],
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-10-20T12:00:00Z",
    variants: [],
  };
}

const quatro = [
  produto("a", "Bola", "Brinquedos"),
  produto("b", "Bloco", "Papelaria"),
  produto("c", "Camisa", "Roupas"),
  produto("d", "Solto", "Cozinha"),
];

let raiz: Root;
let container: HTMLDivElement;

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("innerHeight", 1000); // 35% = 350 px
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() =>
    raiz.render(
      <FavoritesView
        favorites={quatro}
        onToggleFavorite={vi.fn()}
        onProductClick={vi.fn()}
        onNavigate={vi.fn()}
        isActive
      />,
    ),
  );
});
afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Posiciona o topo de cada seção e a rolagem da janela (sem avisar nada). */
function posicionar(
  topos: number[],
  { scrollTop = 100, altura = 3000, visivel = 800 } = {},
) {
  const secoes = [...container.querySelectorAll("section")];
  secoes.forEach((sec, i) => {
    sec.getBoundingClientRect = () =>
      // eslint-disable-next-line security/detect-object-injection -- índice de uma lista fixa do próprio teste
      ({ top: topos[i], bottom: topos[i] + 100, height: 100 }) as DOMRect;
  });
  const alvo = document.documentElement;
  Object.defineProperty(alvo, "scrollHeight", {
    value: altura,
    configurable: true,
  });
  Object.defineProperty(alvo, "clientHeight", {
    value: visivel,
    configurable: true,
  });
  Object.defineProperty(alvo, "scrollTop", {
    value: scrollTop,
    configurable: true,
  });
}
/** Posiciona e avisa o evento de rolagem. */
function rolar(topos: number[], opcoes?: Parameters<typeof posicionar>[1]) {
  posicionar(topos, opcoes);
  act(() => {
    document.dispatchEvent(new Event("scroll"));
  });
}
const ativo = () =>
  [...container.querySelectorAll('nav[aria-label="Categorias"] button')]
    .filter((b) => b.getAttribute("aria-current") === "true")
    .map((b) => b.textContent);
const tocarRoupas = () => {
  const botao = [...container.querySelectorAll("nav button")].find(
    (b) => b.textContent?.trim() === "Roupas 1",
  ) as HTMLElement;
  act(() => botao.click());
};

// Posições em que, solto, o destaque iria para outra seção que não "Roupas".
const NA_TELA_DA_COZINHA = [-348, -174, 0, 174];
// Meio de uma rolagem suave até "Roupas": a posição anda de um quadro a outro.
const QUADRO_1 = [-50, 124, 410, 584];
const QUADRO_2 = [-60, 114, 400, 574];

describe("Favoritos — atalho tocado: teclas que devolvem o comando", () => {
  it.each(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "])(
    "a tecla %j solta o atalho tocado",
    (tecla) => {
      rolar([0, 174, 348, 522]);
      tocarRoupas();
      rolar(QUADRO_1);
      expect(ativo()).toEqual(["Roupas 1"]);
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: tecla, bubbles: true }),
        );
      });
      rolar(QUADRO_2);
      expect(ativo()).toEqual(["Papelaria 1"]);
    },
  );

  it.each(["a", "Enter", "Tab", "ArrowLeft", "Shift"])(
    "a tecla %j não tem nada a ver com rolagem: o atalho tocado continua",
    (tecla) => {
      rolar([0, 174, 348, 522]);
      tocarRoupas();
      rolar(QUADRO_1);
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: tecla, bubbles: true }),
        );
      });
      rolar(QUADRO_2);
      expect(ativo()).toEqual(["Roupas 1"]);
    },
  );
});

describe("Favoritos — atalho tocado: quanto tempo ele segura", () => {
  it("sem rolagem nenhuma, ainda segura aos 200 ms e solta depois de 300 ms", () => {
    rolar([0, 174, 348, 522]);
    tocarRoupas();
    act(() => vi.advanceTimersByTime(200));
    // O primeiro aviso de rolagem chega aos 200 ms: o atalho ainda é do toque.
    rolar(NA_TELA_DA_COZINHA);
    expect(ativo()).toEqual(["Roupas 1"]);
  });

  it("sem nenhum aviso de rolagem, aos 350 ms o atalho já soltou", () => {
    rolar([0, 174, 348, 522]);
    tocarRoupas();
    act(() => vi.advanceTimersByTime(350));
    rolar(NA_TELA_DA_COZINHA);
    expect(ativo()).toEqual(["Cozinha 1"]);
  });

  it("com rolagem sem parar, aos 600 ms ainda segura (o teto é ~1 s, não menos)", () => {
    rolar([0, 174, 348, 522]);
    tocarRoupas();
    for (let t = 0; t < 6; t++) {
      rolar(t % 2 === 0 ? QUADRO_1 : QUADRO_2);
      act(() => vi.advanceTimersByTime(100));
    }
    rolar(NA_TELA_DA_COZINHA);
    expect(ativo()).toEqual(["Roupas 1"]);
  });

  it("com rolagem sem parar, passado o teto de ~1 s o atalho solta", () => {
    rolar([0, 174, 348, 522]);
    tocarRoupas();
    for (let t = 0; t < 11; t++) {
      rolar(t % 2 === 0 ? QUADRO_1 : QUADRO_2);
      act(() => vi.advanceTimersByTime(100));
    }
    rolar(NA_TELA_DA_COZINHA);
    expect(ativo()).toEqual(["Cozinha 1"]);
  });
});

describe("Favoritos — seção em vista: janela redimensionada e página curta", () => {
  it("redimensionar a janela recalcula a seção em vista, sem precisar rolar", () => {
    rolar([-400, 350, 700, 1000]);
    expect(ativo()).toEqual(["Papelaria 1"]);
    // A tela virou outra (girou o aparelho): as seções mudaram de lugar.
    posicionar([0, 174, 348, 522]);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(ativo()).toEqual(["Roupas 1"]);
  });

  it("página que rola só 3 px, encostada no fundo, já conta como fim: a última seção fica ativa", () => {
    // Fora do fim, com estes topos a ativa seria "Papelaria".
    rolar([-400, 100, 700, 1000], {
      altura: 803,
      visivel: 800,
      scrollTop: 3,
    });
    expect(ativo()).toEqual(["Cozinha 1"]);
  });
});

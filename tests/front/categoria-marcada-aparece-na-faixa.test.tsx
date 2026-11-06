// @vitest-environment jsdom
//
// DEFEITO: categoria aberta por banner ou link (`/?category=Vestidos`) ficava
// marcada FORA da tela: a faixa de categorias rola na horizontal e ninguém a
// levava até o chip marcado. A cliente via a vitrine filtrada, mas a categoria
// que ela tocou estava escondida à direita.
//
// Correção: quando a categoria marcada muda (ou as categorias terminam de
// carregar), a faixa centraliza o chip marcado SÓ na horizontal (`scrollTo` na
// própria faixa; `scrollIntoView` rolaria a página também).
//
// jsdom não tem layout: as medidas são dubladas e o teste confere a conta.
import { CategoryFilter } from "@/components/ui/custom/CategoryFilter";
import type { Category } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({ haptic: { light: vi.fn() } }));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
const root = createRoot(host);

const rolar = vi.fn();
const realRect = HTMLElement.prototype.getBoundingClientRect;

function categoria(name: string): Category {
  return { id: name, name, slug: name, isActive: true, createdAt: "" };
}

const CATEGORIAS = [
  categoria("Vestidos"),
  categoria("Blusas"),
  categoria("Calças"),
  categoria("Saias"),
  categoria("Bolsas"),
  categoria("Sapatos"),
];

// Faixa de 300px de janela; chips de 68px lado a lado (Todas começa em 4px).
const LARGURA_FAIXA = 300;
const LARGURA_CHIP = 68;
const COMECO = 4;

function dublarLayout(rolagemAtual = 0) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      // A faixa é o elemento cujos filhos são os botões dos chips.
      return this.firstElementChild?.tagName === "BUTTON" ? LARGURA_FAIXA : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return this.tagName === "BUTTON" ? LARGURA_CHIP : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
    configurable: true,
    get() {
      return rolagemAtual;
    },
    set() {},
  });
  // A posição na tela de cada chip = começo + posição na fila - rolagem.
  HTMLElement.prototype.getBoundingClientRect = function () {
    const el = this as HTMLElement;
    if (el.tagName === "BUTTON") {
      const irmaos = Array.from(el.parentElement?.children ?? []);
      const posicao = COMECO + irmaos.indexOf(el) * LARGURA_CHIP;
      return { left: posicao - rolagemAtual } as DOMRect;
    }
    return { left: 0 } as DOMRect;
  };
  HTMLElement.prototype.scrollTo = rolar as never;
}

function renderizar(
  selectedCategory: string,
  isLoading = false,
  categories = CATEGORIAS,
) {
  act(() =>
    root.render(
      <CategoryFilter
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={vi.fn()}
        isLoading={isLoading}
      />,
    ),
  );
}

describe("CategoryFilter: o chip marcado aparece na faixa", () => {
  beforeEach(() => {
    rolar.mockClear();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    dublarLayout();
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => root.render(null));
    host.remove();
    vi.unstubAllGlobals();
    HTMLElement.prototype.getBoundingClientRect = realRect;
    // biome-ignore lint/performance/noDelete: restaura o protótipo do jsdom
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  });

  it("centraliza o chip da categoria marcada, só na horizontal", () => {
    renderizar("Todas");
    rolar.mockClear();

    renderizar("Sapatos");

    // Sapatos é o 7º botão (Todas + 6): começa em 4 + 6*68 = 412. Para ficar
    // no meio de 300px: 412 - (300 - 68) / 2 = 296.
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar).toHaveBeenCalledWith({ left: 296, behavior: "smooth" });
  });

  it("soma a rolagem que a faixa já tem (o chip mede em tela, não em fila)", () => {
    dublarLayout(100);
    renderizar("Todas");
    rolar.mockClear();

    renderizar("Sapatos");

    // Mesma fila: a conta absoluta não muda com a rolagem atual.
    expect(rolar).toHaveBeenCalledWith({ left: 296, behavior: "smooth" });
  });

  it("com 'menos movimento' ligado, rola sem animação", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    renderizar("Todas");
    rolar.mockClear();

    renderizar("Sapatos");

    expect(rolar).toHaveBeenCalledWith({ left: 296, behavior: "auto" });
  });

  it("'Todas' marcada nunca pede posição negativa (volta ao começo)", () => {
    renderizar("Sapatos");
    rolar.mockClear();

    renderizar("Todas");

    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar).toHaveBeenCalledWith({ left: 0, behavior: "smooth" });
  });

  it("não rola enquanto as categorias carregam", () => {
    renderizar("Sapatos", true);
    expect(rolar).not.toHaveBeenCalled();
  });

  it("não rola quando nenhum chip está marcado (categoria desconhecida)", () => {
    renderizar("Todas");
    rolar.mockClear();

    renderizar("Categoria que não existe");

    expect(rolar).not.toHaveBeenCalled();
  });

  it("rola quando o carregamento termina com a categoria já marcada", () => {
    renderizar("Sapatos", true);
    rolar.mockClear();

    renderizar("Sapatos", false);
    // A faixa de chips nasceu agora: o efeito roda com o carregamento.
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar).toHaveBeenCalledWith({ left: 296, behavior: "smooth" });
  });

  it("não chama scrollIntoView (ele rolaria a página junto)", () => {
    const intoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = intoView;
    renderizar("Todas");
    renderizar("Sapatos");
    expect(intoView).not.toHaveBeenCalled();
    // biome-ignore lint/performance/noDelete: restaura o protótipo do jsdom
    delete (HTMLElement.prototype as { scrollIntoView?: unknown })
      .scrollIntoView;
  });
});

// @vitest-environment jsdom
//
// DEFEITO (caçada de 14/10/2026): quem usa leitor de tela (TalkBack) aperta
// "Adicionar" no card e fica no silêncio —
//   1. nenhum aviso falado de que entrou no carrinho (remover já era falado);
//   2. durante o "Salvando..." o botão ficava `disabled`: botão desabilitado
//      sai da ordem de foco e o foco cai no BODY;
//   3. o botão do card se chamava só "Carrinho" (18 botões iguais na vitrine);
//   4. a folha de opções (aberta por estado, sem SheetTrigger) não devolvia o
//      foco ao fechar — o Radix só devolve ao TRIGGER, e aqui não há.
//
// O que NÃO pode mudar para quem enxerga: nada visual, e o clique duplo
// continua sendo ignorado (o guard de estado `idle` do componente é o que
// segura — `aria-disabled` não bloqueia clique sozinho).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function criarVariantes(): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: true,
    },
    {
      id: "var-m",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "M",
      stockIncrement: 3,
      active: true,
    },
  ];
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-caderno",
    name: "Caderno Bom",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "papelaria",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

// Nome acessível, como o leitor de tela o calcula neste caso: aria-label
// vence; sem ele, vale o texto (inclusive o `sr-only`, que o leitor lê).
const nomeAcessivel = (el: Element) =>
  (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();

describe("ProductCard — adicionar ao carrinho fala para o leitor de tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
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
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarCard(
    produto: Product,
    props: {
      onAddToCart?: (product: Product, e: React.MouseEvent) => void;
      onAddToCartWithVariants?: (
        product: Product,
        variantId: string | undefined,
        variantNames: string,
        quantity?: number,
      ) => void;
    } = {},
  ) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={vi.fn()}
          showRating={false}
          onAddToCart={props.onAddToCart}
          onAddToCartWithVariants={props.onAddToCartWithVariants}
        />,
      );
    });
  }

  const botaoDeAcao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;
  const ctaDaFolha = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-add"]',
    )!;
  const alcaDaFolha = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-handle"]',
    )!;
  const folha = () =>
    document.querySelector('[data-testid="product-card-options-sheet"]');
  const chip = (texto: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === texto,
    )!;
  // Regiões `role="status"` visíveis ao leitor (Radix põe aria-hidden em tudo
  // que está fora da folha aberta — e leitor de tela ignora o que está lá).
  const avisosFalados = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="status"]'))
      .filter((r) => !r.closest('[aria-hidden="true"]'))
      .map((r) => r.textContent?.trim() ?? "")
      .filter(Boolean);

  async function esperar(ms: number) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  // ── (3)/(e) O nome do botão do card ─────────────────────────────────────

  it("o botão do card leva o NOME DO PRODUTO no nome acessível (não são 18 botões 'Carrinho')", async () => {
    await renderizarCard(criarProduto(), { onAddToCart: vi.fn() });

    expect(nomeAcessivel(botaoDeAcao())).toBe(
      "Adicionar Caderno Bom ao carrinho",
    );
  });

  it("com opções, o botão do card diz de qual produto vai escolher — e o rótulo visível continua dentro do nome", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    expect(nomeAcessivel(botaoDeAcao())).toBe("Escolher opções de Caderno Bom");
    // Rótulo VISÍVEL intocado (quem enxerga não vê mudança).
    expect(botaoDeAcao().textContent).toContain("Escolher opções");
  });

  // ── (2)/(b) Durante o "Salvando..." o botão não pode sumir do foco ──────

  it("durante o 'Salvando...' o botão NÃO é `disabled` (aria-disabled), mantém o nome e o foco", async () => {
    vi.useFakeTimers();
    const onAddToCart = vi.fn();
    await renderizarCard(criarProduto(), { onAddToCart });

    botaoDeAcao().focus();
    await act(async () => {
      botaoDeAcao().click();
    });

    const botao = botaoDeAcao();
    expect(botao.disabled).toBe(false);
    expect(botao.getAttribute("aria-disabled")).toBe("true");
    // O nome não some: continua um botão com texto ("Salvando...").
    expect(nomeAcessivel(botao)).toMatch(/salvando/i);
    expect(document.activeElement).toBe(botao);

    // E quando termina ("Salvo!") e volta ao normal, aria-disabled sai.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(botaoDeAcao().disabled).toBe(false);
    expect(botaoDeAcao().getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(botaoDeAcao().hasAttribute("aria-disabled")).toBe(false);
    expect(nomeAcessivel(botaoDeAcao())).toBe(
      "Adicionar Caderno Bom ao carrinho",
    );
  });

  // O CASO QUE DÓI: aria-disabled NÃO bloqueia clique. Quem bloqueia é o
  // guard de estado — se alguém o tirar, dois toques somam duas unidades.
  it("dois toques seguidos NÃO adicionam duas vezes (o bloqueio sobrevive à troca de disabled por aria-disabled)", async () => {
    vi.useFakeTimers();
    const onAddToCart = vi.fn();
    await renderizarCard(criarProduto(), { onAddToCart });

    await act(async () => {
      botaoDeAcao().click();
    });
    await act(async () => {
      botaoDeAcao().click();
    });
    // Ainda em "Salvando..." e de novo já em "Salvo!".
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      botaoDeAcao().click();
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);

    // Passou o ciclo: um toque NOVO volta a valer (a trava é do ciclo, não
    // do botão para sempre).
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {
      botaoDeAcao().click();
    });
    expect(onAddToCart).toHaveBeenCalledTimes(2);
  });

  it("esgotado NÃO é estado transitório: continua `disabled` de verdade e sem aria-disabled", async () => {
    await renderizarCard(criarProduto({ stock: 0 }), {
      onAddToCart: vi.fn(),
    });

    const botao = botaoDeAcao();
    expect(botao.disabled).toBe(true);
    expect(botao.hasAttribute("aria-disabled")).toBe(false);
    expect(nomeAcessivel(botao)).toBe("Caderno Bom esgotado");
  });

  // ── (1)/(a) O aviso falado ──────────────────────────────────────────────

  it("ao adicionar, uma região `role=status` fala 'Adicionado ao carrinho' com o nome do produto — e antes disso está vazia", async () => {
    vi.useFakeTimers();
    await renderizarCard(criarProduto(), { onAddToCart: vi.fn() });

    // A região existe ANTES do fato (leitor só anuncia mudança em região que
    // já estava na árvore) e está vazia.
    const regiao = hospedeiro.querySelector<HTMLElement>('[role="status"]');
    expect(regiao).not.toBeNull();
    expect(regiao!.textContent).toBe("");

    await act(async () => {
      botaoDeAcao().click();
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(avisosFalados()).toEqual(["Adicionado ao carrinho: Caderno Bom"]);
    // Invisível: quem enxerga não ganha nada na tela.
    expect(regiao!.className).toContain("sr-only");
    expect(regiao!.getAttribute("aria-live")).toBe("polite");

    // Passado o ciclo, a região esvazia (o próximo "Adicionado" é mudança de
    // novo e volta a ser falado).
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(avisosFalados()).toEqual([]);
  });

  // ── Folha de opções (caminho com variação) ──────────────────────────────

  it("na folha: o CTA 'Salvando...' não é `disabled`, dois toques entregam UMA vez, e o aviso é falado DENTRO da folha", async () => {
    vi.useFakeTimers();
    const onAddToCartWithVariants = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants,
    });

    await act(async () => {
      botaoDeAcao().click();
    });
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      ctaDaFolha().click();
    });
    await act(async () => {
      ctaDaFolha().click();
    });

    expect(ctaDaFolha().disabled).toBe(false);
    expect(ctaDaFolha().getAttribute("aria-disabled")).toBe("true");
    expect(nomeAcessivel(ctaDaFolha())).toMatch(/salvando/i);
    expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    // A folha é modal: o Radix esconde o card do leitor. O aviso tem de estar
    // na própria folha para ser ouvido.
    expect(avisosFalados()).toEqual(["Adicionado ao carrinho: Caderno Bom"]);
    const regiaoDaFolha = folha()!.querySelector('[role="status"]');
    expect(regiaoDaFolha).not.toBeNull();
    expect(regiaoDaFolha!.textContent).toBe(
      "Adicionado ao carrinho: Caderno Bom",
    );

    // Toque durante o "Salvo!" também é ignorado.
    await act(async () => {
      ctaDaFolha().click();
    });
    expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);
  });

  it("card COM folha não tem região viva fora dela (o aria-live pouparia o card do aria-hidden da folha modal)", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    expect(hospedeiro.querySelector('[role="status"]')).toBeNull();

    await act(async () => {
      botaoDeAcao().click();
    });
    // A folha modal esconde o card do leitor de tela inteiro.
    expect(hospedeiro.getAttribute("aria-hidden")).toBe("true");
  });

  // ── (4)/(d) Foco ao fechar a folha ──────────────────────────────────────

  it("fechar a folha pela alça DEVOLVE o foco ao botão do card (não cai no body)", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    botaoDeAcao().focus();
    await act(async () => {
      botaoDeAcao().click();
    });
    expect(folha()).not.toBeNull();

    await act(async () => {
      alcaDaFolha().click();
    });
    await esperar(50);

    expect(folha()).toBeNull();
    expect(document.activeElement).toBe(botaoDeAcao());
  });

  it("se o card saiu da tela antes da folha fechar, devolver o foco não quebra nada (botão desconectado)", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await act(async () => {
      botaoDeAcao().click();
    });
    expect(folha()).not.toBeNull();

    // O card desmonta com a folha aberta (vitrine repagina): a folha vai
    // junto, e o handler de foco não pode estourar com ref nula/desconectada.
    const erros: unknown[] = [];
    const aoErro = (e: ErrorEvent) => erros.push(e.error);
    window.addEventListener("error", aoErro);
    await act(async () => {
      raiz.render(<div />);
    });
    await esperar(50);
    window.removeEventListener("error", aoErro);

    expect(erros).toEqual([]);
    expect(folha()).toBeNull();
  });
});

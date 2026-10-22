import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import type { Product } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: () => {} }),
}));
vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation: () => {},
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light() {}, medium() {}, heavy() {} },
}));
vi.mock("@/components/LazyImage", () => ({
  LazyImage: ({
    src,
    alt,
    className,
  }: { src: string; alt: string; className: string }) => (
    <img src={src} alt={alt} className={className} />
  ),
}));

await import("@/components/ui/custom/OfertasCompactas");

const embla = vi.hoisted(() => ({
  selectedScrollSnap: vi.fn(() => 0),
  on: vi.fn(),
  off: vi.fn(),
  scrollNext: vi.fn(),
}));
vi.mock("embla-carousel-react", () => ({
  default: vi.fn(() => [() => {}, embla]),
}));
import useEmblaCarousel from "embla-carousel-react";

const produto = (id: string, ajustes: Partial<Product> = {}): Product =>
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
    ...ajustes,
  }) as Product;
let host: HTMLDivElement;
let root: Root;
const adicionar = vi.fn();
const abrir = vi.fn();
const favoritar = vi.fn();

async function montar(
  products: Product[],
  layout = "compacto",
  favorites: string[] = [],
) {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={products}
        favorites={favorites}
        layout={layout as "compacto"}
        onAddToCart={adicionar}
        onProductClick={abrir}
        onToggleFavorite={favoritar}
        title="Ofertas Imperdíveis"
      />,
    );
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const cartoes = () =>
  Array.from(host.querySelectorAll<HTMLElement>("[data-oferta-compacta]"));
const clicar = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
};

describe("Ofertas Compactas", () => {
  it.each([
    [1, 350, 0],
    [2, 165, 0],
    [3, 165, 2],
    [6, 165, 3],
  ])(
    "%i produtos: reserva mínima de 392 px, cartão de %i px e %i indicadores não interativos",
    async (quantidade, largura, pontos) => {
      await montar(
        Array.from({ length: quantidade }, (_, i) => produto(String(i))),
      );
      expect(
        host.querySelector('[data-testid="ofertas-compactas"]')?.className,
      ).toContain("min-h-[392px]");
      expect(cartoes()).toHaveLength(quantidade);
      for (const card of cartoes()) {
        expect(card.className).toContain("min-h-[290px]");
        expect(card.style.width).toBe(`${largura}px`);
      }
      expect(host.querySelectorAll("[data-pagina-ofertas]")).toHaveLength(
        pontos,
      );
      expect(host.querySelector("[data-pagina-ofertas] button")).toBeNull();
      if (quantidade > 2) {
        expect(useEmblaCarousel).toHaveBeenLastCalledWith(
          expect.objectContaining({
            align: "start",
            containScroll: "trimSnaps",
            slidesToScroll: 2,
            loop: false,
          }),
        );
      }
    },
  );

  it("não troca as ofertas sozinha, e acompanha o gesto pelos eventos do embla", async () => {
    vi.useFakeTimers();
    await montar([produto("a"), produto("b"), produto("c")]);
    await act(async () => vi.advanceTimersByTime(18000));
    expect(embla.scrollNext).not.toHaveBeenCalled();
    const onSelect = embla.on.mock.calls.find(
      ([nome]) => nome === "select",
    )?.[1];
    expect(onSelect).toBeTypeOf("function");
    embla.selectedScrollSnap.mockReturnValueOnce(1);
    await act(async () => onSelect());
    expect(
      host
        .querySelectorAll("[data-pagina-ofertas]")[1]
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("ordena estoque primeiro, desconto depois, preservando empate e os preços atuais", async () => {
    await montar([
      produto("esgotado", { stock: 0, price: 10 }),
      produto("menor", { price: 70 }),
      produto("empate-a"),
      produto("empate-b"),
    ]);
    expect(cartoes().map((el) => el.dataset.ofertaCompacta)).toEqual([
      "empate-a",
      "empate-b",
      "menor",
      "esgotado",
    ]);
    expect(cartoes()[0].textContent).toContain("50% OFF");
    // Etiqueta sobre a foto fica numa pastilha branca: legivel em foto escura.
    const etiqueta = [...cartoes()[0].querySelectorAll("span")].find((el) =>
      el.textContent?.includes("50% OFF"),
    );
    expect(etiqueta?.parentElement?.className).toContain("bg-white/90");
    expect(cartoes()[0].textContent).toContain("50,00");
    expect(cartoes()[0].textContent).toContain("100,00");
  });

  it("o alvo do produto cobre o cartão e não contém coração ou carrinho", async () => {
    await montar([produto("Bola"), produto("Urso")]);
    const alvo = host.querySelector('[aria-label="Ver Bola"]')!;
    expect(alvo).not.toBeNull();
    expect(alvo.className).toContain("inset-0");
    expect(alvo.querySelector("button")).toBeNull();
    await clicar(alvo);
    expect(abrir).toHaveBeenCalledWith("Bola");
    expect(adicionar).not.toHaveBeenCalled();
  });

  it("reutiliza a ação de carrinho e a confirmação verde por 1,5 s, sem abrir o produto", async () => {
    const p = produto("Bola");
    await montar([p, produto("outra")]);
    vi.useFakeTimers();
    const botao = host.querySelector(
      '[aria-label="Adicionar Bola ao carrinho"]',
    )!;
    expect(botao.className).toContain("min-h-11");
    expect(botao.className).toContain("min-w-11");
    expect(botao.textContent).toBe("Adicionar");
    await clicar(botao);
    expect(adicionar).toHaveBeenCalledWith(p);
    expect(abrir).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(600));
    expect(botao.className).toContain("bg-white");
    expect(botao.className).toContain("text-emerald-700");
    expect(botao.textContent).toBe("Adicionado");
    expect(botao.querySelector("svg")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1500));
    expect((botao as HTMLButtonElement).disabled).toBe(false);
  });

  it("variação ativa abre o produto; esgotado bloqueia; coração não abre produto", async () => {
    const variante = produto("opções", {
      variants: [{ id: "v", active: true }] as Product["variants"],
    });
    await montar(
      [variante, produto("fim", { stock: 0 }), produto("favorito")],
      "compacto",
      ["favorito"],
    );
    await clicar(
      host.querySelector('[aria-label="Escolher opções de opções"]')!,
    );
    expect(abrir).toHaveBeenCalledWith("opções");
    expect(adicionar).not.toHaveBeenCalled();
    expect(
      (host.querySelector('[aria-label="Esgotado: fim"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const favorito = cartoes().find(
      (c) => c.dataset.ofertaCompacta === "favorito",
    )!;
    const coracao = favorito.querySelector('[aria-label*="favorit"]')!;
    expect(coracao.className).toContain("size-11");
    await clicar(coracao);
    expect(favoritar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "favorito" }),
    );
    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it("deixa nome e preço alto crescerem sem cortar texto nem inventar urgência", async () => {
    await montar([
      produto("longo ".repeat(30), {
        price: 1299.9,
        originalPrice: 1599.9,
        stock: 1,
      }),
      produto("normal", { stock: 11 }),
      produto("dez", { stock: 10 }),
      produto("simples", { originalPrice: undefined }),
      produto("fim", { stock: 0 }),
    ]);
    expect(host.textContent).toContain("Resta 1!");
    expect(host.textContent).toContain("Restam 10");
    expect(host.textContent).not.toContain("Restam 11");
    expect(host.textContent).toContain("Esgotado");
    expect(host.querySelectorAll("[data-sem-foto]")).toHaveLength(5);
    const longo = cartoes().find((c) =>
      c.dataset.ofertaCompacta?.startsWith("longo"),
    )!;
    expect(longo.querySelector("h3")?.textContent).toBe("longo ".repeat(30));
    for (
      let el: Element | null = longo.querySelector("h3");
      el && el !== host;
      el = el.parentElement
    ) {
      expect(el.className).not.toMatch(
        /truncate|line-clamp|text-overflow|(?:^|\s)h-\[\d+px\]/,
      );
    }
    expect(longo.textContent).not.toContain("Por:");
    const simples = cartoes().find(
      (c) => c.dataset.ofertaCompacta === "simples",
    )!;
    expect(simples.textContent).not.toContain("De:");
    expect(simples.textContent).not.toContain("OFF");
    expect(simples.textContent).not.toContain("Por:");
    expect(host.textContent).not.toContain("Economize");
  });

  it("preço e compra ficam em blocos de fluxo distintos, sem compra absoluta", async () => {
    await montar([produto("a"), produto("b"), produto("c")]);
    for (const card of cartoes()) {
      const compra = card.querySelector(
        '[aria-label^="Adicionar"][aria-label$="ao carrinho"]',
      )!;
      const preco = Array.from(card.querySelectorAll("span")).find(
        (el) => el.textContent === "R$ 50,00",
      )!;
      expect(preco).toBeDefined();
      expect(compra.contains(preco)).toBe(false);
      expect(preco.contains(compra)).toBe(false);
      for (
        let el: Element | null = compra;
        el && el !== card;
        el = el.parentElement
      ) {
        expect(el.className).not.toMatch(/absolute|fixed/);
      }
      expect(compra.textContent).toBe("Adicionar");
      expect(compra.className).toContain("min-h-11");
      expect(compra.className).toContain("min-w-11");
      expect(
        card.querySelector('[aria-label*="favorit"]')?.className,
      ).toContain("size-11");
    }
  });

  it("adicionando bloqueia novo toque, confirma só o produto tocado e volta ao normal", async () => {
    await montar([produto("a"), produto("b")]);
    vi.useFakeTimers();
    const botoes = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '[aria-label^="Adicionar"][aria-label$="ao carrinho"]',
      ),
    );
    await clicar(botoes[0]);
    expect(botoes[0].textContent).toBe("Adicionando");
    expect(botoes[0].disabled).toBe(true);
    expect(botoes[0].querySelector(".animate-spin")).not.toBeNull();
    expect(botoes[1].textContent).toBe("Adicionar");
    expect(botoes[1].disabled).toBe(false);
    await clicar(botoes[0]);
    expect(adicionar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(600));
    expect(botoes[0].textContent).toBe("Adicionado");
    expect(botoes[0].className).toContain("border-zinc-200");
    expect(botoes[0].className).not.toMatch(/bg-emerald|bg-green/);
    expect(abrir).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1500));
    expect(botoes[0].textContent).toBe("Adicionar");
    expect(botoes[0].disabled).toBe(false);
  });

  it("mostra estoque real, opções e cores de significado sem fundos coloridos", async () => {
    await montar([
      produto("poucas", { stock: 3 }),
      produto("ultima", { stock: 1 }),
      produto("fim", { stock: 0 }),
      produto("opções", {
        variants: [{ id: "v", active: true }] as Product["variants"],
      }),
    ]);
    expect(host.textContent).toContain("Restam 3");
    expect(host.textContent).toContain("Resta 1!");
    const fim = cartoes().find(
      (card) => card.dataset.ofertaCompacta === "fim",
    )!;
    const esgotado = fim.querySelector<HTMLButtonElement>(
      "[data-compra-oferta]",
    )!;
    expect(esgotado.textContent).toBe("Esgotado");
    expect(esgotado.disabled).toBe(true);
    await clicar(esgotado);
    expect(adicionar).not.toHaveBeenCalled();
    const opcoes = cartoes().find(
      (card) => card.dataset.ofertaCompacta === "opções",
    )!;
    expect(opcoes.querySelector("[data-compra-oferta]")?.textContent).toBe(
      "Escolher opções",
    );
    expect(host.innerHTML).not.toMatch(/bg-(emerald|green|red|rose)-/);
    expect(fim.querySelector("[data-preco-oferta]")?.className).toContain(
      "text-zinc-950",
    );
  });

  it("uma oferta usa foto e conteúdo lado a lado e preserva a economia verdadeira", async () => {
    await montar([produto("única")]);
    const card = cartoes()[0];
    expect(card.className).toContain("flex-row");
    expect(card.querySelector("[data-foto-oferta]")?.className).toContain(
      "w-[44%]",
    );
    expect(card.textContent).toContain("Economize R$ 50,00");
    await montar([produto("única", { originalPrice: 40 })]);
    expect(card.textContent).not.toContain("Economize");
    expect(card.textContent).not.toContain("De:");
    expect(card.textContent).not.toContain("OFF");
  });

  it("o nome acessível acompanha os estados e a escolha de opções", async () => {
    await montar([
      produto("Bola"),
      produto("camisa", {
        variants: [{ id: "v", active: true }] as Product["variants"],
      }),
      produto("fim", { stock: 0 }),
    ]);
    expect(
      host.querySelector('[aria-label="Escolher opções de camisa"]'),
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="Esgotado: fim"]')).not.toBeNull();
    const botao = host.querySelector<HTMLButtonElement>(
      '[aria-label="Adicionar Bola ao carrinho"]',
    )!;
    vi.useFakeTimers();
    await clicar(botao);
    expect(botao.getAttribute("aria-label")).toBe(
      "Adicionando Bola ao carrinho",
    );
    await act(async () => vi.advanceTimersByTime(600));
    expect(botao.getAttribute("aria-label")).toBe(
      "Adicionado ao carrinho: Bola",
    );
  });

  it.each([undefined, "padrao", "invalido"])(
    "layout %s mantém a vitrine Padrão",
    async (layout) => {
      await montar([produto("p")], layout ?? "padrao");
      expect(
        host.querySelector('[data-testid="ofertas-compactas"]'),
      ).toBeNull();
      expect(host.textContent).toContain("Super Oferta");
      expect(host.textContent).toContain("Comprar");
    },
  );
});

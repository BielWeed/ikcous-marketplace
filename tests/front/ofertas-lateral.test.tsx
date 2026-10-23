// @vitest-environment jsdom
//
// Terceiro desenho das Ofertas ("Lateral"): foto de um lado, informações do outro, carrossel
// horizontal e o botão de comprar só com o ícone do carrinho. As regras de compra são as mesmas
// dos outros desenhos (variação abre a escolha, esgotado não vende).
import { OfertasLateralEsqueleto } from "@/components/ui/custom/OfertasLateralEsqueleto";
import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import { normalizarLayoutDeOfertas } from "@/lib/layout-de-ofertas";
import type { Product } from "@/types";
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
await import("@/components/ui/custom/OfertasLateral");

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
    images: ["https://exemplo.test/a.png"],
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

async function montar(products: Product[], favorites: string[] = []) {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={products}
        favorites={favorites}
        layout="lateral"
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
  Array.from(host.querySelectorAll<HTMLElement>("[data-oferta-lateral]"));
const coluna = (c: HTMLElement) =>
  (c.querySelector("img") as HTMLElement).parentElement
    ?.parentElement as HTMLElement;
const clicar = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
};

describe("valor do layout vindo da config", () => {
  it.each([
    ["lateral", "lateral"],
    ["compacto", "compacto"],
    ["padrao", "padrao"],
    ["xyz", "padrao"],
    [undefined, "padrao"],
    [null, "padrao"],
    [3, "padrao"],
  ])("%s vira %s", (entrada, saida) => {
    expect(normalizarLayoutDeOfertas(entrada)).toBe(saida);
  });
});

describe("Ofertas Lateral", () => {
  it("mostra um cartão por oferta, com a reserva de altura do esqueleto", async () => {
    await montar([produto("a"), produto("b"), produto("c")]);
    expect(cartoes()).toHaveLength(3);
    expect(
      host.querySelector('[data-testid="ofertas-lateral"]')?.className,
    ).toContain("min-h-[286px]");
    for (const c of cartoes()) expect(c.className).toContain("min-h-[184px]");
    expect(useEmblaCarousel).toHaveBeenLastCalledWith(
      expect.objectContaining({ align: "start", loop: false, active: true }),
    );
    expect(host.querySelectorAll("[data-pagina-ofertas]")).toHaveLength(3);
  });

  it("a foto fica fora do fluxo: a proporção dela não define a altura do cartão", async () => {
    await montar([produto("a"), produto("b")]);
    const foto = cartoes()[0].querySelector("img") as HTMLElement;
    expect(foto.parentElement?.className).toContain("absolute");
    expect(foto.parentElement?.className).toContain("inset-0");
  });

  it("a foto sangra até as bordas: coluna de 44%, sem padding nem raio interno; o raio do cartão recorta", async () => {
    await montar([produto("a"), produto("b")]);
    const c = cartoes()[0];
    expect(c.className).toContain("rounded-[26px]");
    expect(c.className).toContain("overflow-hidden");
    expect(c.className).toContain("border-zinc-200");
    expect(c.className).not.toMatch(/(^|\s)p-\d/);
    const coluna = (c.querySelector("img") as HTMLElement).parentElement
      ?.parentElement as HTMLElement;
    expect(coluna.className).toContain("w-[44%]");
    expect(coluna.className).toContain("self-stretch");
    expect(coluna.className).not.toMatch(/(^|\s)p-\d|rounded/);
    expect((c.querySelector("img") as HTMLElement).className).toContain(
      "object-cover",
    );
  });

  it("selo verde sólido de desconto na foto, com texto branco; coração no canto da foto", async () => {
    await montar([produto("a"), produto("b")]);
    const c = cartoes()[0];
    const selo = c.querySelector("[data-selo-desconto]") as HTMLElement;
    expect(selo.textContent).toBe("50% OFF");
    expect(selo.className).toContain("bg-emerald-700");
    expect(selo.className).toContain("left-2.5");
    expect(selo.className).toContain("top-2.5");
    expect(selo.firstElementChild?.className).toContain("text-white");
    expect(selo.firstElementChild?.className).toContain("font-bold");
    const coracao = c.querySelector("[data-botao-favorito]") as HTMLElement;
    expect(coracao.className).toContain("absolute");
    expect(coracao.className).toContain("right-2.5");
    expect(coracao.className).toContain("z-20");
    expect(coluna(c).contains(coracao)).toBe(true);
  });

  it("'Você economiza' mostra a diferença certa e some sem preço antigo", async () => {
    await montar([
      produto("a", { price: 12.9, originalPrice: 24.9 }),
      produto("simples", { originalPrice: undefined }),
    ]);
    const [a, simples] = cartoes();
    const eco = a.querySelector("[data-economia-oferta]") as HTMLElement;
    expect(eco.textContent).toMatch(/^Você economiza R\$\s12,00$/);
    expect(a.textContent).toMatch(/De R\$\s24,90/);
    expect(simples.querySelector("[data-economia-oferta]")).toBeNull();
    expect(simples.textContent).not.toContain("economiza");
  });

  it("preço atual grande, verde quando promocional e escuro quando esgotado", async () => {
    await montar([produto("a"), produto("fim", { stock: 0 })]);
    const preco = (id: string) =>
      cartoes()
        .find((c) => c.dataset.ofertaLateral === id)
        ?.querySelector("[data-preco-oferta]") as HTMLElement;
    expect(preco("a").className).toContain("text-[28px]");
    expect(preco("a").className).toContain("tabular-nums");
    expect(preco("a").className).toContain("text-emerald-700");
    expect(preco("fim").className).toContain("text-zinc-950");
  });

  it("estoque no rodapé com ponto colorido: âmbar para pouco, vermelho para esgotado", async () => {
    await montar([
      produto("pouco", { stock: 8 }),
      produto("fim", { stock: 0 }),
      produto("cheio", { stock: 50 }),
    ]);
    const por = (id: string) =>
      cartoes().find((c) => c.dataset.ofertaLateral === id) as HTMLElement;
    const ponto = (c: HTMLElement) =>
      c.querySelector("span[aria-hidden='true'].rounded-full") as HTMLElement;
    expect(ponto(por("pouco")).className).toContain("bg-amber-600");
    expect(ponto(por("fim")).className).toContain("bg-red-700");
    expect(ponto(por("cheio"))).toBeNull();
    // O ponto vem logo antes do texto, na mesma linha do carrinho.
    const rodape = por("pouco").querySelector("[data-compra-oferta]")
      ?.parentElement as HTMLElement;
    expect(rodape.textContent).toContain("Restam 8");
    expect(rodape.contains(ponto(por("pouco")))).toBe(true);
    expect(rodape.className).toContain("justify-between");
  });

  it("sem foto mantém o bloco 'Sem foto' na mesma coluna", async () => {
    await montar([produto("a", { images: [] }), produto("b")]);
    const sem = cartoes()[0].querySelector("[data-sem-foto]") as HTMLElement;
    expect(sem.textContent).toContain("Sem foto");
    expect(sem.parentElement?.className).toContain("w-[44%]");
  });

  it("o esqueleto tem a mesma altura e a mesma divisão foto/texto do cartão", async () => {
    await act(async () => root.render(<OfertasLateralEsqueleto />));
    const esq = host.querySelector("[data-cartao-esqueleto]") as HTMLElement;
    const secEsq = host.querySelector(
      '[data-testid="esqueleto-ofertas"]',
    ) as HTMLElement;
    expect(esq.className).toContain("min-h-[184px]");
    expect(esq.className).toContain("rounded-[26px]");
    expect(esq.className).toContain("overflow-hidden");
    expect(esq.className).not.toMatch(/(^|\s)p-\d/);
    expect(esq.firstElementChild?.className).toContain("w-[44%]");
    expect(secEsq.className).toContain("min-h-[286px]");
    await montar([produto("a"), produto("b")]);
    expect(
      host.querySelector('[data-testid="ofertas-lateral"]')?.className,
    ).toContain("min-h-[286px]");
  });

  it("esgotado: véu branco sobre a foto", async () => {
    await montar([produto("fim", { stock: 0 }), produto("b")]);
    const veu = cartoes()
      .find((c) => c.dataset.ofertaLateral === "fim")
      ?.querySelector('[class*="bg-white/70"]');
    expect(veu).not.toBeNull();
  });

  it("uma oferta só: sem rolagem e sem indicadores", async () => {
    await montar([produto("a")]);
    expect(useEmblaCarousel).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false }),
    );
    expect(host.querySelectorAll("[data-pagina-ofertas]")).toHaveLength(0);
  });

  it("preço e disponibilidade vêm antes do botão, e o nome é cortado em duas linhas", async () => {
    await montar([produto("Bobbie Goods", { stock: 8 }), produto("b")]);
    const c = cartoes()[0];
    expect(c.querySelector("h3")?.className).toContain("line-clamp-2");
    const texto = c.textContent ?? "";
    expect(texto).toContain("50% OFF");
    expect(texto).toContain("De R$");
    expect(texto).toContain("50,00");
    expect(texto).toContain("Restam 8");
    const preco = c.querySelector("[data-preco-oferta]") as Element;
    const compra = c.querySelector("[data-compra-oferta]") as Element;
    expect(
      preco.compareDocumentPosition(compra) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const restam = [...c.querySelectorAll("span")]
      .filter((s) => s.textContent === "Restam 8")
      .pop() as HTMLElement;
    expect(restam.className).toContain("text-amber-700");
  });

  it("estoque só aparece quando é pouco; último e esgotado têm texto próprio", async () => {
    await montar([
      produto("normal", { stock: 11 }),
      produto("um", { stock: 1 }),
      produto("fim", { stock: 0 }),
    ]);
    expect(host.textContent).not.toContain("Restam 11");
    expect(host.textContent).toContain("Resta 1!");
    const fim = cartoes().find((c) => c.dataset.ofertaLateral === "fim");
    expect(fim?.textContent).toContain("Esgotado");
    expect(
      [...(fim?.querySelectorAll("span") ?? [])]
        .filter((s) => s.textContent === "Esgotado")
        .pop()?.className,
    ).toContain("text-red-800");
  });

  it("sem preço antigo não mostra De nem desconto", async () => {
    await montar([produto("simples", { originalPrice: undefined })]);
    expect(host.textContent).not.toContain("De R$");
    expect(host.textContent).not.toContain("OFF");
  });

  it("o botão de comprar é só o ícone do carrinho, redondo de 48px e neutro escuro, com nome acessível", async () => {
    const p = produto("Bola");
    await montar([p, produto("outra")]);
    const botao = host.querySelector(
      '[aria-label="Adicionar Bola ao carrinho"]',
    ) as HTMLButtonElement;
    expect(botao).not.toBeNull();
    expect(botao.querySelector("svg")).not.toBeNull();
    expect(botao.textContent).not.toContain("Adicionar");
    expect(botao.className).toContain("size-12");
    expect(botao.className).toContain("rounded-full");
    expect(botao.className).toContain("bg-zinc-950");
    expect(botao.className).toContain("text-white");
    expect(botao.className).toContain("focus-visible:ring-2");
    await clicar(botao);
    expect(adicionar).toHaveBeenCalledWith(p);
    expect(abrir).not.toHaveBeenCalled();
  });

  it("adicionando bloqueia novo toque e confirma só o produto tocado, depois volta", async () => {
    await montar([produto("a"), produto("b")]);
    vi.useFakeTimers();
    const botoes = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[data-compra-oferta]"),
    );
    await clicar(botoes[0]);
    expect(botoes[0].disabled).toBe(true);
    expect(botoes[0].querySelector(".animate-spin")).not.toBeNull();
    expect(botoes[1].disabled).toBe(false);
    await clicar(botoes[0]);
    expect(adicionar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(600));
    expect(botoes[0].getAttribute("aria-label")).toBe(
      "Adicionado ao carrinho: a",
    );
    await act(async () => vi.advanceTimersByTime(1500));
    expect(botoes[0].disabled).toBe(false);
    expect(botoes[0].getAttribute("aria-label")).toBe(
      "Adicionar a ao carrinho",
    );
  });

  it("com variação o botão vira 'Escolher opções' (só ícone) e NUNCA adiciona direto", async () => {
    const variante = produto("camisa", {
      variants: [{ id: "v", active: true }] as Product["variants"],
    });
    await montar([variante, produto("b")]);
    const botao = host.querySelector(
      '[aria-label="Escolher opções de camisa"]',
    ) as HTMLButtonElement;
    expect(botao).not.toBeNull();
    expect(botao.textContent).not.toContain("Escolher");
    await clicar(botao);
    expect(abrir).toHaveBeenCalledWith("camisa");
    expect(adicionar).not.toHaveBeenCalled();
  });

  it("esgotado não vende", async () => {
    await montar([produto("fim", { stock: 0 }), produto("b")]);
    const botao = host.querySelector(
      '[aria-label="Esgotado: fim"]',
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await clicar(botao);
    expect(adicionar).not.toHaveBeenCalled();
  });

  it("coração é o BotaoDeFavorito e não abre o produto; o alvo do cartão não contém botões", async () => {
    await montar([produto("Bola"), produto("fav")], ["fav"]);
    const fav = cartoes().find((c) => c.dataset.ofertaLateral === "fav");
    const coracao = fav?.querySelector("[data-botao-favorito]") as Element;
    expect(coracao.className).toContain("size-11");
    await clicar(coracao);
    expect(favoritar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fav" }),
    );
    expect(abrir).not.toHaveBeenCalled();
    const alvo = host.querySelector('[aria-label="Ver Bola"]') as Element;
    expect(alvo.querySelector("button")).toBeNull();
    await clicar(alvo);
    expect(abrir).toHaveBeenCalledWith("Bola");
  });

  it("ordena disponível antes de esgotado e maior desconto primeiro", async () => {
    await montar([
      produto("esgotado", { stock: 0, price: 10 }),
      produto("menor", { price: 70 }),
      produto("maior", { price: 40 }),
    ]);
    expect(cartoes().map((c) => c.dataset.ofertaLateral)).toEqual([
      "maior",
      "menor",
      "esgotado",
    ]);
  });

  it("não usa cor de marca (amarelo/dourado) em fundo, borda ou botão", async () => {
    await montar([produto("a", { stock: 3 }), produto("b")]);
    // O ponto âmbar do estoque baixo é cor com significado, não marca: sai da conta.
    const html = host.innerHTML.replace(
      /<span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-(amber-600|red-700)"><\/span>/g,
      "",
    );
    expect(html).not.toMatch(
      /(bg|border)-(yellow|amber|primary|secondary|admin-gold)/,
    );
  });
});

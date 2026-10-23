import { OfertasLateralDuploEsqueleto } from "@/components/ui/custom/OfertasLateralDuploEsqueleto";
import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
// @vitest-environment jsdom
//
// Quarto desenho das Ofertas ("Lateral em duas fileiras", valor `lateral-duplo`): o mesmo cartão do Lateral
// (foto de um lado, texto do outro), mas cada item do carrossel é uma COLUNA com 2 ofertas, uma sobre a outra,
// e o carrossel rola de dupla em dupla. O Lateral de hoje NÃO muda: aqui só se prova o desenho novo e que as
// ações (comprar, favoritar, abrir) são as mesmas; o `ofertas-lateral.test.tsx` segue passando sem alteração.
import {
  ALTURA_CARTAO_DUPLO,
  ALTURA_SECAO_DUPLO,
  ALTURA_SECAO_DUPLO_UMA_FILEIRA,
  alturaDaSecaoDuplo,
  fileirasDaFaixa,
} from "@/components/ui/custom/ofertas-lateral-duplo-altura";
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
await import("@/components/ui/custom/OfertasLateralDuplo");

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
        layout="lateral-duplo"
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
  Array.from(host.querySelectorAll<HTMLElement>("[data-oferta-lateral-duplo]"));
const colunas = () =>
  Array.from(host.querySelectorAll<HTMLElement>("[data-coluna-ofertas]"));
const por = (id: string) =>
  cartoes().find((c) => c.dataset.ofertaLateralDuplo === id) as HTMLElement;
const preco = (c: HTMLElement) =>
  c.querySelector("[data-preco-oferta]") as HTMLElement;
const clicar = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
};
const secao = () =>
  host.querySelector<HTMLElement>('[data-testid="ofertas-lateral-duplo"]');

describe("valor do layout vindo da config", () => {
  it.each([
    ["lateral-duplo", "lateral-duplo"],
    ["lateral", "lateral"],
    ["compacto", "compacto"],
    ["padrao", "padrao"],
    ["Lateral-Duplo", "padrao"],
    ["lateral-duplo ", "padrao"],
    ["xyz", "padrao"],
    ["", "padrao"],
    [undefined, "padrao"],
    [null, "padrao"],
    [3, "padrao"],
    [["lateral-duplo"], "padrao"],
  ])("%j vira %s", (entrada, saida) => {
    expect(normalizarLayoutDeOfertas(entrada)).toBe(saida);
  });
});

describe("as medidas da seção", () => {
  it("cartão de 104px, seção de 318px com duas fileiras e 206px com uma", () => {
    expect(ALTURA_CARTAO_DUPLO).toBe(104);
    // 2 cartões + 8 entre eles + 102 de moldura (título, respiros e pontinhos).
    expect(ALTURA_SECAO_DUPLO).toBe(2 * 104 + 8 + 102);
    expect(ALTURA_SECAO_DUPLO).toBe(318);
    expect(ALTURA_SECAO_DUPLO_UMA_FILEIRA).toBe(206);
    expect(alturaDaSecaoDuplo(2)).toBe(318);
    expect(alturaDaSecaoDuplo(1)).toBe(206);
  });

  it("só 1 oferta tem uma fileira; 2 ou mais, duas; sem informação, a aposta é duas", () => {
    expect(fileirasDaFaixa(1)).toBe(1);
    expect(fileirasDaFaixa(2)).toBe(2);
    expect(fileirasDaFaixa(9)).toBe(2);
    expect(fileirasDaFaixa(0)).toBe(2);
    expect(fileirasDaFaixa(undefined)).toBe(2);
  });
});

describe("Ofertas Lateral em duas fileiras", () => {
  it("5 ofertas: 3 colunas (2, 2 e 1), a última com um cartão só e vazio embaixo", async () => {
    await montar([
      produto("a"),
      produto("b"),
      produto("c"),
      produto("d"),
      produto("e"),
    ]);
    expect(colunas().map((c) => c.querySelectorAll("article").length)).toEqual([
      2, 2, 1,
    ]);
    expect(cartoes()).toHaveLength(5);
  });

  it("cada coluna é um item do carrossel: 88% de largura, cartões empilhados com 8px entre eles", async () => {
    await montar([produto("a"), produto("b"), produto("c")]);
    for (const col of colunas()) {
      expect(col.className).toContain("basis-[88%]");
      expect(col.className).toContain("shrink-0");
      expect(col.className).toContain("flex-col");
      expect(col.className).toContain("gap-2");
      expect(col.className).not.toContain("w-full");
    }
    const trilho = colunas()[0].parentElement as HTMLElement;
    expect(trilho.className).toContain("gap-2.5");
    const janela = trilho.parentElement as HTMLElement;
    expect(janela.className).toContain("ml-3");
    expect(janela.className).toContain("min-[360px]:ml-5");
    expect(janela.className).toContain("overflow-hidden");
  });

  it("usa o Embla do Lateral (começo alinhado, sem laço), ativo só com 3 ofertas ou mais", async () => {
    await montar([produto("a"), produto("b"), produto("c")]);
    expect(useEmblaCarousel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        align: "start",
        containScroll: "trimSnaps",
        loop: false,
        active: true,
      }),
    );
    await montar([produto("a"), produto("b")]);
    expect(useEmblaCarousel).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false }),
    );
  });

  it("um pontinho por COLUNA (ceil(n/2)), cada um com o rótulo 'Página i de N'", async () => {
    for (const [n, esperado] of [
      [3, 2],
      [4, 2],
      [5, 3],
      [6, 3],
      [7, 4],
    ] as const) {
      await montar(Array.from({ length: n }, (_, i) => produto(`p${i}`)));
      const pontos = Array.from(
        host.querySelectorAll<HTMLElement>("[data-pagina-ofertas]"),
      );
      expect(pontos, `n=${n}`).toHaveLength(esperado);
      expect(pontos.map((p) => p.getAttribute("aria-label"))).toEqual(
        Array.from(
          { length: esperado },
          (_, i) => `Página ${i + 1} de ${esperado}`,
        ),
      );
      expect(pontos[0].getAttribute("aria-current")).toBe("true");
      expect(pontos[1].getAttribute("aria-current")).toBeNull();
    }
  });

  it("1 ou 2 ofertas: uma coluna na largura toda, sem rolagem e sem pontinhos", async () => {
    for (const n of [1, 2]) {
      await montar(Array.from({ length: n }, (_, i) => produto(`p${i}`)));
      expect(colunas(), `n=${n}`).toHaveLength(1);
      expect(colunas()[0].className).toContain("w-full");
      expect(colunas()[0].className).not.toContain("basis-");
      expect(colunas()[0].querySelectorAll("article")).toHaveLength(n);
      expect(host.querySelectorAll("[data-pagina-ofertas]")).toHaveLength(0);
      expect(useEmblaCarousel).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: false }),
      );
      const janela = colunas()[0].parentElement?.parentElement as HTMLElement;
      expect(janela.className).toContain("mr-3");
    }
  });

  it("a seção reserva a altura exata da faixa: 318px (2+ ofertas) e 206px (1 oferta)", async () => {
    await montar([produto("a"), produto("b"), produto("c")]);
    expect(secao()?.style.minHeight).toBe(`${ALTURA_SECAO_DUPLO}px`);
    for (const c of cartoes())
      expect(c.style.height).toBe(`${ALTURA_CARTAO_DUPLO}px`);
    await montar([produto("a"), produto("b")]);
    expect(secao()?.style.minHeight).toBe(`${ALTURA_SECAO_DUPLO}px`);
    await montar([produto("a")]);
    expect(secao()?.style.minHeight).toBe(
      `${ALTURA_SECAO_DUPLO_UMA_FILEIRA}px`,
    );
    expect(cartoes()).toHaveLength(1);
  });

  it("sem ofertas não desenha nada", async () => {
    await montar([]);
    expect(host.innerHTML).toBe("");
  });

  it("o cartão tem a moldura do Lateral: borda, raio de 20px, foto de 104px (88px abaixo de 340px) colada na borda", async () => {
    await montar([produto("a"), produto("b")]);
    const c = por("a");
    for (const t of [
      "rounded-[20px]",
      "overflow-hidden",
      "border-zinc-200",
      "border-solid",
      "bg-white",
    ])
      expect(c.className, t).toContain(t);
    expect(c.className).not.toMatch(/(^|\s)p-\d/);
    const foto = (c.querySelector("img") as HTMLElement).parentElement
      ?.parentElement as HTMLElement;
    expect(foto.className).toContain("w-[104px]");
    expect(foto.className).toContain("max-[339px]:w-[88px]");
    expect(foto.className).toContain("self-stretch");
    expect(foto.className).not.toMatch(/(^|\s)p-\d|rounded/);
    expect((c.querySelector("img") as HTMLElement).className).toContain(
      "object-cover",
    );
    expect(
      (c.querySelector("img") as HTMLElement).parentElement?.className,
    ).toContain("absolute");
  });

  it("a coluna de texto tem as medidas do desenho: pt-2 pb-1 pl-3 pr-2.5 e é um container", async () => {
    await montar([produto("a"), produto("b")]);
    const texto = preco(por("a")).parentElement as HTMLElement;
    for (const t of [
      "pt-2",
      "pb-1",
      "pl-3",
      "pr-2.5",
      "min-w-0",
      "flex-1",
      "flex-col",
      "[container-type:inline-size]",
    ])
      expect(texto.className, t).toContain(t);
  });

  it("nome: 13px semibold, 2 linhas reservadas (h-8, leading-4), cortado com reticências se for longo", async () => {
    const longo =
      "Tênis Casual Couro Branco Edição Limitada Numerada Série Ouro Especial";
    await montar([produto("a", { name: longo }), produto("b")]);
    const h3 = por("a").querySelector("h3") as HTMLElement;
    expect(h3.textContent).toBe(longo);
    for (const t of [
      "line-clamp-2",
      "h-8",
      "text-[13px]",
      "font-semibold",
      "leading-4",
      "break-words",
    ])
      expect(h3.className, t).toContain(t);
    // Nome curto: a altura é a mesma (a reserva não depende do nome).
    expect(por("b").querySelector("h3")?.className).toContain("h-8");
  });

  it("preço: 16 a 20px pela largura REAL da coluna, uma linha só, com a faixa do carrinho (pr-12) reservada", async () => {
    await montar([
      produto("a", { price: 49.9, originalPrice: 99.9 }),
      produto("mil", { price: 1299.9, originalPrice: 1999.9 }),
      produto("caro", { price: 12999.9, originalPrice: 20000 }),
    ]);
    for (const t of [
      "mt-0.5",
      "h-6",
      "pr-12",
      "font-extrabold",
      "leading-6",
      "whitespace-nowrap",
      "tabular-nums",
      "text-[length:var(--fonte-preco)]",
    ])
      expect(preco(por("a")).className, t).toContain(t);
    expect(preco(por("a")).className).not.toContain("break-words");
    const fonte = (id: string) =>
      (
        preco(por(id)).closest("div[style]") as HTMLElement
      ).style.getPropertyValue("--fonte-preco");
    expect(fonte("a")).toMatch(/^clamp\(16px, .*100cqw.*, 20px\)$/);
    // Mais caracteres, conta diferente; a faixa do carrinho (48px) sai da largura disponível.
    expect(fonte("a")).toContain("48px");
    expect(fonte("mil")).not.toBe(fonte("a"));
    expect(fonte("caro")).not.toBe(fonte("mil"));
  });

  it("'Economiza' NÃO existe neste desenho, nem com desconto", async () => {
    await montar([
      produto("a", { price: 12.9, originalPrice: 24.9 }),
      produto("b"),
    ]);
    expect(host.querySelector("[data-economia-oferta]")).toBeNull();
    expect(host.textContent).not.toContain("Economiza");
  });

  it("'De' riscado fica SEMPRE na linha de baixo do preço, nunca ao lado", async () => {
    await montar([
      produto("a", { price: 12.9, originalPrice: 24.9 }),
      produto("caro", { price: 12999.9, originalPrice: 20000 }),
    ]);
    for (const id of ["a", "caro"]) {
      const c = por(id);
      const de = c.querySelector("[data-de-oferta]") as HTMLElement;
      expect(de.textContent).toMatch(/^De R\$\s/);
      for (const t of [
        "h-4",
        "pr-12",
        "text-xs",
        "leading-4",
        "text-zinc-500",
        "line-through",
      ])
        expect(de.className, t).toContain(t);
      // Irmão do preço dentro da coluna de texto, depois dele: linha própria.
      expect(de.parentElement).toBe(preco(c).parentElement);
      expect(preco(c).contains(de)).toBe(false);
      expect(
        preco(c).compareDocumentPosition(de) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(por("a").textContent).toMatch(/De R\$\s24,90/);
    expect(por("caro").textContent).toMatch(/De R\$\s20\.000,00/);
  });

  it("sem preço antigo: sem 'De', sem selo, e o preço é escuro (verde é sinal de promoção)", async () => {
    await montar([produto("simples", { originalPrice: undefined })]);
    expect(host.textContent).not.toContain("De R$");
    expect(host.textContent).not.toContain("OFF");
    expect(host.querySelector("[data-de-oferta]")).toBeNull();
    expect(preco(por("simples")).className).toContain("text-slate-900");
    expect(preco(por("simples")).className).not.toContain("text-emerald");
  });

  it("promocional em verde; esgotado em escuro; 99,99 -> 100 arredonda para 0% e some selo e 'De' continua", async () => {
    await montar([
      produto("a"),
      produto("fim", { stock: 0 }),
      produto("zero", { price: 99.99, originalPrice: 100 }),
    ]);
    expect(preco(por("a")).className).toContain("text-emerald-700");
    expect(preco(por("fim")).className).toContain("text-zinc-950");
    expect(por("zero").querySelector("[data-selo-desconto]")).toBeNull();
  });

  it("selo verde sólido 'N% OFF' no canto de baixo da foto, e coração no de cima, na mesma foto", async () => {
    await montar([produto("a"), produto("b")]);
    const c = por("a");
    const selo = c.querySelector("[data-selo-desconto]") as HTMLElement;
    expect(selo.textContent).toBe("50% OFF");
    expect(selo.className).toContain("bg-emerald-700");
    expect(selo.className).toContain("bottom-2");
    expect(selo.className).toContain("left-2");
    expect(selo.className).not.toContain("top-2");
    expect(selo.firstElementChild?.className).toContain("text-white");
    const coracao = c.querySelector("[data-botao-favorito]") as HTMLElement;
    expect(coracao.className).toContain("top-2");
    expect(coracao.className).toContain("right-2");
    expect(coracao.className).not.toContain("bottom-2");
    const foto = selo.parentElement as HTMLElement;
    expect(foto.contains(coracao)).toBe(true);
  });

  it("estoque âmbar para pouco, vermelho para esgotado, nada quando sobra; linha de 12px bold", async () => {
    await montar([
      produto("pouco", { stock: 8 }),
      produto("fim", { stock: 0 }),
      produto("cheio", { stock: 50 }),
      produto("um", { stock: 1 }),
    ]);
    const estoque = (id: string) =>
      por(id).querySelector("[data-estoque-oferta]") as HTMLElement;
    const ponto = (c: HTMLElement) =>
      c.querySelector("span[aria-hidden='true'].rounded-full") as HTMLElement;
    expect(estoque("pouco").textContent).toBe("Restam 8");
    expect(estoque("pouco").className).toContain("text-amber-700");
    expect(ponto(por("pouco")).className).toContain("bg-amber-600");
    expect(estoque("fim").textContent).toBe("Esgotado");
    expect(estoque("fim").className).toContain("text-red-800");
    expect(ponto(por("fim")).className).toContain("bg-red-700");
    expect(estoque("um").textContent).toBe("Resta 1!");
    expect(por("cheio").querySelector("[data-estoque-oferta]")).toBeNull();
    expect(host.textContent).not.toContain("Restam 50");
    const linha = estoque("pouco").parentElement as HTMLElement;
    for (const t of ["h-4", "pr-12", "text-xs", "font-bold", "leading-4"])
      expect(linha.className, t).toContain(t);
    // A linha existe (altura reservada) mesmo quando não há aviso.
    expect(
      (por("cheio").querySelector("[data-linha-estoque]") as HTMLElement)
        .className,
    ).toContain("h-4");
  });

  it("sem foto: o aviso sobe (justify-start, pt-4) para não bater no selo", async () => {
    await montar([produto("a", { images: [] }), produto("b")]);
    const sem = por("a").querySelector("[data-sem-foto]") as HTMLElement;
    expect(sem.textContent).toContain("Sem foto");
    expect(sem.className).toContain("justify-start");
    expect(sem.className).toContain("pt-4");
    expect(sem.parentElement?.className).toContain("w-[104px]");
    expect(por("a").querySelector("[data-selo-desconto]")).not.toBeNull();
  });

  it("esgotado: véu branco sobre a foto", async () => {
    await montar([produto("fim", { stock: 0 }), produto("b")]);
    expect(por("fim").querySelector('[class*="bg-white/70"]')).not.toBeNull();
  });

  it("o carrinho é um botão preto de 44px no canto de baixo, só com ícone e nome acessível", async () => {
    const p = produto("Bola");
    await montar([p, produto("outra")]);
    const botao = host.querySelector(
      '[aria-label="Adicionar Bola ao carrinho"]',
    ) as HTMLButtonElement;
    for (const t of [
      "size-11",
      "bottom-2",
      "right-2.5",
      "absolute",
      "z-20",
      "rounded-full",
      "bg-zinc-950",
      "text-white",
      "focus-visible:ring-2",
    ])
      expect(botao.className, t).toContain(t);
    expect(botao.querySelector("svg")).not.toBeNull();
    expect(botao.textContent).not.toContain("Adicionar");
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

  it("com variação o botão vira 'Escolher opções' e NUNCA adiciona direto", async () => {
    const variante = produto("camisa", {
      variants: [{ id: "v", active: true }] as Product["variants"],
    });
    await montar([variante, produto("b")]);
    const botao = host.querySelector(
      '[aria-label="Escolher opções de camisa"]',
    ) as HTMLButtonElement;
    expect(botao).not.toBeNull();
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

  it("coração (30px visíveis, toque de 44px dentro da foto) favorita sem abrir; o cartão inteiro abre o produto", async () => {
    await montar([produto("Bola"), produto("fav")], ["fav"]);
    const coracao = por("fav").querySelector(
      "[data-botao-favorito]",
    ) as Element;
    expect(coracao.className).toContain("size-[30px]");
    expect(coracao.className).toContain("after:inset-[-7px]");
    await clicar(coracao);
    expect(favoritar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fav" }),
    );
    expect(abrir).not.toHaveBeenCalled();
    const alvo = host.querySelector('[aria-label="Ver Bola"]') as HTMLElement;
    expect(alvo.querySelector("button")).toBeNull();
    expect(alvo.className).toContain("absolute");
    expect(alvo.className).toContain("inset-0");
    await clicar(alvo);
    expect(abrir).toHaveBeenCalledWith("Bola");
  });

  it("ordena disponível antes de esgotado e maior desconto primeiro, e as colunas seguem essa ordem", async () => {
    await montar([
      produto("esgotado", { stock: 0, price: 10 }),
      produto("menor", { price: 70 }),
      produto("maior", { price: 40 }),
    ]);
    expect(cartoes().map((c) => c.dataset.ofertaLateralDuplo)).toEqual([
      "maior",
      "menor",
      "esgotado",
    ]);
    expect(
      colunas().map((c) =>
        Array.from(c.querySelectorAll<HTMLElement>("article")).map(
          (a) => a.dataset.ofertaLateralDuplo,
        ),
      ),
    ).toEqual([["maior", "menor"], ["esgotado"]]);
  });

  it("não usa cor de marca (amarelo/dourado) em fundo, borda ou botão", async () => {
    await montar([produto("a", { stock: 3 }), produto("b")]);
    const html = host.innerHTML.replace(
      /<span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-(amber-600|red-700)"><\/span>/g,
      "",
    );
    expect(html).not.toMatch(
      /(bg|border)-(yellow|amber|primary|secondary|admin-gold)/,
    );
  });

  it("o Lateral de hoje continua sendo despachado como antes (não vira o duplo)", async () => {
    await act(async () => {
      root.render(
        <PremiumOffers
          products={[produto("a"), produto("b")]}
          favorites={[]}
          layout="lateral"
          onProductClick={abrir}
          onToggleFavorite={favoritar}
        />,
      );
    });
    // O Lateral ainda carrega por import dinâmico: espera o módulo.
    await act(async () => {
      await import("@/components/ui/custom/OfertasLateral");
    });
    expect(host.querySelector("[data-oferta-lateral-duplo]")).toBeNull();
    expect(
      host.querySelector('[data-testid="ofertas-lateral-duplo"]'),
    ).toBeNull();
  });
});

describe("esqueleto do Lateral em duas fileiras", () => {
  it("2 fileiras: cartões de 104px empilhados de dois em dois, seção de 318px, mesma divisão foto/texto", async () => {
    await act(async () => root.render(<OfertasLateralDuploEsqueleto />));
    const esq = host.querySelector(
      '[data-testid="esqueleto-ofertas"]',
    ) as HTMLElement;
    expect(esq.style.minHeight).toBe(`${ALTURA_SECAO_DUPLO}px`);
    const cartaos = Array.from(
      host.querySelectorAll<HTMLElement>("[data-cartao-esqueleto]"),
    );
    expect(cartaos).toHaveLength(4);
    for (const c of cartaos) {
      expect(c.style.height).toBe(`${ALTURA_CARTAO_DUPLO}px`);
      expect(c.className).toContain("rounded-[20px]");
      expect(c.className).toContain("overflow-hidden");
      expect(c.firstElementChild?.className).toContain("w-[104px]");
      expect(c.firstElementChild?.className).toContain("max-[339px]:w-[88px]");
    }
    const colunasEsq = host.querySelectorAll("[data-coluna-esqueleto]");
    expect(colunasEsq).toHaveLength(2);
    for (const col of Array.from(colunasEsq)) {
      expect(col.className).toContain("basis-[88%]");
      expect(col.className).toContain("flex-col");
      expect(col.className).toContain("gap-2");
    }
  });

  it("1 fileira: um cartão na largura toda e seção de 206px (a página não pula com 1 oferta)", async () => {
    await act(async () =>
      root.render(<OfertasLateralDuploEsqueleto fileiras={1} />),
    );
    const esq = host.querySelector(
      '[data-testid="esqueleto-ofertas"]',
    ) as HTMLElement;
    expect(esq.style.minHeight).toBe(`${ALTURA_SECAO_DUPLO_UMA_FILEIRA}px`);
    expect(host.querySelectorAll("[data-cartao-esqueleto]")).toHaveLength(1);
    expect(
      (host.querySelector("[data-coluna-esqueleto]") as HTMLElement).className,
    ).toContain("w-full");
  });

  it("o esqueleto reserva exatamente o que a seção real reserva, 1 ou várias ofertas", async () => {
    for (const [n, fileiras] of [
      [1, 1],
      [2, 2],
      [3, 2],
    ] as const) {
      await act(async () =>
        root.render(<OfertasLateralDuploEsqueleto fileiras={fileiras} />),
      );
      const reservaDoEsqueleto = (
        host.querySelector('[data-testid="esqueleto-ofertas"]') as HTMLElement
      ).style.minHeight;
      await montar(Array.from({ length: n }, (_, i) => produto(`p${i}`)));
      expect(secao()?.style.minHeight, `n=${n}`).toBe(reservaDoEsqueleto);
    }
  });
});

// @vitest-environment jsdom
//
// Dois defeitos da galeria de fotos da página do produto, medidos no código:
//
//  1. Foto que falha no celular (3G, sinal oscilando) ficava quebrada ATÉ A
//     CLIENTE RECARREGAR A PÁGINA: só se tentava a URL original uma vez e
//     depois desistia, sem nova tentativa nem aviso. O LazyImage da vitrine já
//     tenta de novo sozinho; a galeria agora faz o mesmo (até 2 tentativas
//     automáticas, espera crescente, e depois um toque para tentar de novo).
//
//  2. Tocar numa seta/bolinha ENQUANTO a faixa ainda deslizava para a foto
//     anterior deixava a foto e a bolinha em fotos diferentes: o efeito saía
//     cedo porque a faixa "já estava" na foto pedida e o destino antigo
//     seguia valendo.
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LARGURA = 300;
const FOTOS = [
  "https://cdn.exemplo/a.jpg",
  "https://cdn.exemplo/b.jpg",
  "https://cdn.exemplo/c.jpg",
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

function Pai({ fotos = FOTOS }: { fotos?: string[] }) {
  const [indice, setIndice] = useState(0);
  return (
    <GaleriaDoProduto
      fotos={fotos}
      nome="Blusa"
      indice={indice}
      onMudarIndice={setIndice}
    />
  );
}

const fotosDaFaixa = () => [
  ...hospedeiro.querySelectorAll<HTMLImageElement>("img.main-product-image"),
];
const botaoDeNovaTentativa = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    "button[aria-label*='Toque para tentar de novo']",
  );
const bolinhas = () => [
  ...hospedeiro.querySelectorAll<HTMLButtonElement>(
    "button[aria-label^='Foto '][aria-label*=' de ']",
  ),
];
const fotoAtiva = () =>
  bolinhas().findIndex((b) => b.getAttribute("aria-current") === "true") + 1;

function falhar(img: HTMLImageElement | undefined) {
  expect(img).toBeDefined();
  act(() => {
    img?.dispatchEvent(new Event("error"));
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function tocar(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Meio da faixa de variação das esperas (fator 1,0).
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GaleriaDoProduto — foto que falha tenta de novo", () => {
  beforeEach(() => {
    act(() => raiz.render(<Pai />));
  });

  it("falhou: não mostra aviso, espera e pede a foto de novo (elemento novo, URL com marca)", async () => {
    const [primeira] = fotosDaFaixa();
    expect(primeira?.getAttribute("src")).toBe(FOTOS[0]);

    falhar(primeira);
    expect(botaoDeNovaTentativa()).toBeNull();

    await avancar(1_500);

    const [segunda] = fotosDaFaixa();
    expect(segunda).not.toBe(primeira);
    expect(segunda?.getAttribute("src")).toContain("_r=1");
    expect(segunda?.getAttribute("src")).toContain(FOTOS[0] as string);
  });

  it("falhando sempre: 2 novas tentativas (1,5 s e 3 s) e depois PARA, com o toque para tentar de novo", async () => {
    falhar(fotosDaFaixa()[0]);
    await avancar(1_499);
    expect(fotosDaFaixa()[0]?.getAttribute("src")).toBe(FOTOS[0]);
    await avancar(1);
    expect(fotosDaFaixa()[0]?.getAttribute("src")).toContain("_r=1");

    falhar(fotosDaFaixa()[0]);
    await avancar(2_999);
    expect(fotosDaFaixa()[0]?.getAttribute("src")).toContain("_r=1");
    await avancar(1);
    expect(fotosDaFaixa()[0]?.getAttribute("src")).toContain("_r=2");

    expect(botaoDeNovaTentativa()).toBeNull();
    falhar(fotosDaFaixa()[0]);

    const botao = botaoDeNovaTentativa();
    expect(botao).not.toBeNull();
    expect(botao?.getAttribute("type")).toBe("button");
    expect(botao?.getAttribute("aria-label")).toContain("Blusa");
    expect(botao?.textContent).toContain("Toque para tentar de novo");
    // Sem laço: nenhum relógio sobra.
    await avancar(10 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("toque no botão: tenta na hora e ganha novo fôlego; o toque NÃO vaza e z-10 fica por cima", async () => {
    falhar(fotosDaFaixa()[0]);
    await avancar(1_500);
    falhar(fotosDaFaixa()[0]);
    await avancar(3_000);
    falhar(fotosDaFaixa()[0]);

    const botao = botaoDeNovaTentativa();
    expect(botao?.className.split(/\s+/)).toContain("z-10");

    const aoClicarNoCartao = vi.fn();
    document.body.addEventListener("click", aoClicarNoCartao);
    const clique = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      botao?.dispatchEvent(clique);
    });
    document.body.removeEventListener("click", aoClicarNoCartao);
    expect(aoClicarNoCartao).not.toHaveBeenCalled();
    expect(clique.defaultPrevented).toBe(true);

    expect(botaoDeNovaTentativa()).toBeNull();
    const nova = fotosDaFaixa()[0];
    expect(nova?.getAttribute("src")).toContain("_r=3");

    // Novo fôlego: falha de novo e volta a tentar sozinha antes do botão.
    falhar(nova);
    expect(botaoDeNovaTentativa()).toBeNull();
    await avancar(1_500);
    expect(fotosDaFaixa()[0]?.getAttribute("src")).toContain("_r=4");
  });

  it("a miniatura (computador) também tenta de novo sozinha", async () => {
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    vi.stubGlobal(
      "matchMedia",
      (consulta: string) =>
        ({
          matches: consulta.includes("min-width: 1024px"),
          media: consulta,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
        }) as unknown as MediaQueryList,
    );
    act(() => raiz.render(<Pai />));

    const miniaturas = () => [
      ...hospedeiro.querySelectorAll<HTMLImageElement>(
        "div[aria-label='Fotos do produto'] img",
      ),
    ];
    expect(miniaturas()).toHaveLength(3);
    const [primeira] = miniaturas();
    falhar(primeira);
    await avancar(1_500);

    const [segunda] = miniaturas();
    expect(segunda).not.toBe(primeira);
    expect(segunda?.getAttribute("src")).toContain("_r=1");
  });

  it("sair da tela com a nova tentativa pendente cancela o relógio", async () => {
    falhar(fotosDaFaixa()[0]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => raiz.unmount());
    expect(vi.getTimerCount()).toBe(0);
    raiz = createRoot(hospedeiro);
  });
});

describe("GaleriaDoProduto — tocar noutra seta durante o deslize", () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // A faixa "tem" 300 px, mas o pedido de rolagem NÃO move o scrollLeft: é a
    // animação suave ainda perto do começo quando o segundo toque chega.
    scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => LARGURA,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    act(() => raiz.render(<Pai />));
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: tirar o dublê do protótipo.
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    // biome-ignore lint/performance/noDelete: tirar o dublê do protótipo.
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  });

  const seta = (nome: "Foto anterior" | "Próxima foto") =>
    hospedeiro.querySelector(`button[aria-label='${nome}']`);

  it("Próxima e logo Anterior, com a faixa ainda perto de 0: a faixa volta para a foto 1", async () => {
    await tocar(seta("Próxima foto"));
    expect(fotoAtiva()).toBe(2);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: LARGURA }),
    );

    await tocar(seta("Foto anterior"));
    expect(fotoAtiva()).toBe(1);
    // Sem o conserto, o pedido para a foto 2 seguia valendo e a faixa
    // terminava na foto 2 com a bolinha na 1.
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 0 }),
    );
  });

  it("sem destino pendente (a cliente arrastou a faixa), o índice igual ao da faixa não pede rolagem", async () => {
    // Gesto da cliente: a faixa vai para a foto 2 e o índice acompanha.
    const faixa = hospedeiro.querySelector<HTMLElement>(
      "[aria-roledescription='carrossel']",
    ) as HTMLElement;
    Object.defineProperty(faixa, "scrollLeft", {
      configurable: true,
      writable: true,
      value: LARGURA,
    });
    await act(async () => {
      faixa.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(fotoAtiva()).toBe(2);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
//
// Bordas da nova tentativa automática da foto grande da galeria (caça por
// mutação, 24/11). O teste vizinho prova o caminho feliz com o sorteio no meio
// (espera exata de 1,5 s e 3 s); aqui entram o que ele não cobre:
//
//  - a espera varia de -20% a +20% (o navegador não repete em rajada): com o
//    sorteio nas duas pontas a nova tentativa sai em 1,2 s e em 1,8 s -- nem
//    antes, nem depois;
//  - o `error` repetido da MESMA foto (acontece quando a imagem falha de novo
//    na troca do endereço) não gasta duas tentativas nem marca dois relógios;
//  - o aviso "Toque para tentar de novo" que aparece com um relógio ainda
//    pendente: o toque cancela o relógio (senão a foto recarrega uma 2ª vez
//    sozinha, depois de a cliente já ter pedido);
//  - a foto que JÁ carregou e depois falha de novo some outra vez (não fica a
//    imagem quebrada do navegador à mostra).
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO = "https://cdn.exemplo/a.jpg";

let raiz: Root;
let hospedeiro: HTMLDivElement;

const foto = () =>
  hospedeiro.querySelector<HTMLImageElement>("img.main-product-image");
const botao = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    "button[aria-label*='Toque para tentar de novo']",
  );

function falhar(img: HTMLImageElement | null) {
  expect(img).not.toBeNull();
  act(() => {
    img?.dispatchEvent(new Event("error"));
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
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
  act(() =>
    raiz.render(
      <GaleriaDoProduto
        fotos={[FOTO]}
        nome="Blusa"
        indice={0}
        onMudarIndice={() => {}}
      />,
    ),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GaleriaDoProduto — a espera da nova tentativa varia 20% para cada lado", () => {
  it.each([
    ["ponta de baixo (sorteio 0)", 0, 1_200, 2_400],
    ["ponta de cima (sorteio quase 1)", 1, 1_800, 3_600],
  ])(
    "%s: 1ª tentativa em %i ms e 2ª em %i ms",
    async (_n, sorteio, primeira, segunda) => {
      vi.spyOn(Math, "random").mockReturnValue(sorteio);

      falhar(foto());
      await avancar(primeira - 1);
      expect(foto()?.getAttribute("src")).toBe(FOTO);
      await avancar(1);
      expect(foto()?.getAttribute("src")).toBe(`${FOTO}?_r=1`);

      falhar(foto());
      await avancar(segunda - 1);
      expect(foto()?.getAttribute("src")).toBe(`${FOTO}?_r=1`);
      await avancar(1);
      expect(foto()?.getAttribute("src")).toBe(`${FOTO}?_r=2`);
    },
  );
});

describe("GaleriaDoProduto — erro repetido da mesma foto", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("dois `error` seguidos da mesma foto marcam UMA nova tentativa só", async () => {
    const antes = foto();
    falhar(antes);
    falhar(antes);
    expect(vi.getTimerCount()).toBe(1);

    await avancar(1_500);
    expect(foto()?.getAttribute("src")).toBe(`${FOTO}?_r=1`);
    // Nenhum segundo relógio empurra a foto para a tentativa 2 sem falha nova.
    expect(vi.getTimerCount()).toBe(0);
    await avancar(10_000);
    expect(foto()?.getAttribute("src")).toBe(`${FOTO}?_r=1`);
    expect(botao()).toBeNull();
  });

  it("e a falha seguinte ainda tem a segunda tentativa (a repetida não gastou o fôlego)", async () => {
    const antes = foto();
    falhar(antes);
    falhar(antes);
    await avancar(1_500);

    falhar(foto());
    expect(botao()).toBeNull();
    await avancar(3_000);
    expect(foto()?.getAttribute("src")).toBe(`${FOTO}?_r=2`);
  });

  it("o aviso aparece com um relógio pendente: o toque cancela o relógio e pede a foto UMA vez", async () => {
    falhar(foto());
    await avancar(1_500); // tentativa 1
    const ultima = foto();
    falhar(ultima); // agenda a 2ª (3 s)...
    falhar(ultima); // ...e o erro repetido esgota o fôlego com o relógio pendente
    expect(botao()).not.toBeNull();

    act(() => botao()?.click());
    expect(botao()).toBeNull();
    expect(foto()?.getAttribute("src")).toBe(`${FOTO}?_r=2`);

    const pedida = foto();
    await avancar(10_000);
    // O relógio antigo não recarrega a foto de novo por conta própria.
    expect(foto()).toBe(pedida);
    expect(foto()?.getAttribute("src")).toBe(`${FOTO}?_r=2`);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("GaleriaDoProduto — foto que carregou e falhou de novo", () => {
  it("volta a ficar escondida em vez de mostrar a imagem quebrada", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const img = foto() as HTMLImageElement;
    expect(getComputedStyle(img).opacity).toBe("0");

    act(() => img.dispatchEvent(new Event("load")));
    expect(getComputedStyle(img).opacity).not.toBe("0");

    act(() => img.dispatchEvent(new Event("error")));
    expect(getComputedStyle(foto() as HTMLImageElement).opacity).toBe("0");
  });
});

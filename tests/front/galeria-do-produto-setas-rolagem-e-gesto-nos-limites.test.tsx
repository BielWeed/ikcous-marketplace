// @vitest-environment jsdom
//
// Limites da galeria de fotos da página do produto que nenhum teste vigiava
// (caça por mutação, 24/11): a cliente chega na ÚLTIMA foto e toca "Próxima"
// (dá a volta para a primeira, e o inverso na primeira); a rolagem do
// navegador passa das pontas (bounce do iPhone, scrollLeft negativo ou além da
// última foto) e NÃO pode virar escolha; o deslize pedido por seta/bolinha
// passa pelas fotos do meio sem a bolinha piscar; o navegador avisa que a
// rolagem assentou (`scrollend`) ou a cliente pega a faixa (dedo, roda do
// mouse, teclado) e o destino antigo deixa de valer; e a faixa escondida
// (largura 0) não recebe pedido de rolagem que ficaria preso.
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LARGURA = 300;
const FOTOS = [
  "https://cdn.exemplo/a.jpg",
  "https://cdn.exemplo/b.jpg",
  "https://cdn.exemplo/c.jpg",
  "https://cdn.exemplo/d.jpg",
];

let raiz: Root;
let hospedeiro: HTMLDivElement;
let largura: number;
let scrollTo: ReturnType<typeof vi.fn>;
let aoMudar: Mock<(indice: number) => void>;

function Pai({
  fotos = FOTOS,
  inicial = 0,
}: {
  fotos?: string[];
  inicial?: number;
}) {
  const [indice, setIndice] = useState(inicial);
  return (
    <GaleriaDoProduto
      fotos={fotos}
      nome="Blusa"
      indice={indice}
      onMudarIndice={(novo) => {
        aoMudar(novo);
        setIndice(novo);
      }}
    />
  );
}

const faixa = () =>
  hospedeiro.querySelector<HTMLElement>("[aria-roledescription='carrossel']");
const bolinhas = () => [
  ...hospedeiro.querySelectorAll<HTMLButtonElement>(
    "button[aria-label^='Foto '][aria-label*=' de ']",
  ),
];
const fotoAtiva = () =>
  bolinhas().findIndex((b) => b.getAttribute("aria-current") === "true") + 1;
const seta = (nome: "Foto anterior" | "Próxima foto") =>
  hospedeiro.querySelector<HTMLButtonElement>(`button[aria-label='${nome}']`);

async function tocar(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** O navegador rolou a faixa até `scrollLeft` e avisou. */
function rolarPara(scrollLeft: number) {
  const el = faixa() as HTMLElement;
  el.scrollLeft = scrollLeft;
  act(() => {
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

function montar(props: { fotos?: string[]; inicial?: number } = {}) {
  act(() => raiz.render(<Pai {...props} />));
}

beforeEach(() => {
  largura = LARGURA;
  aoMudar = vi.fn<(indice: number) => void>();
  // O pedido de rolagem NÃO move a faixa: é o deslize suave ainda no começo.
  scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => largura,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
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
  // biome-ignore lint/performance/noDelete: tirar o dublê do protótipo.
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  // biome-ignore lint/performance/noDelete: tirar o dublê do protótipo.
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GaleriaDoProduto — as setas dão a volta", () => {
  it("Próxima na última foto volta para a primeira, e a faixa é levada para o começo", async () => {
    montar({ inicial: 3 });
    expect(fotoAtiva()).toBe(4);
    scrollTo.mockClear();

    await tocar(seta("Próxima foto"));

    expect(aoMudar).toHaveBeenLastCalledWith(0);
    expect(fotoAtiva()).toBe(1);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 0 }),
    );
  });

  it("Anterior na primeira foto vai para a última, e a faixa é levada para o fim", async () => {
    montar();
    expect(fotoAtiva()).toBe(1);

    await tocar(seta("Foto anterior"));

    expect(aoMudar).toHaveBeenLastCalledWith(3);
    expect(fotoAtiva()).toBe(4);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 3 * LARGURA }),
    );
  });

  it("no meio da faixa as setas andam uma foto de cada vez", async () => {
    montar({ inicial: 1 });
    await tocar(seta("Próxima foto"));
    expect(fotoAtiva()).toBe(3);
    await tocar(seta("Foto anterior"));
    await tocar(seta("Foto anterior"));
    expect(fotoAtiva()).toBe(1);
    expect(aoMudar.mock.calls.map(([n]) => n)).toEqual([2, 1, 0]);
  });
});

describe("GaleriaDoProduto — a rolagem que passa das pontas não vira escolha", () => {
  it("scrollLeft além da última foto (bounce) não muda a foto", () => {
    montar({ inicial: 3 });
    rolarPara(3 * LARGURA); // chegou na última: destino da montagem liberado
    aoMudar.mockClear();

    rolarPara(4 * LARGURA); // elástico além do fim: atual = 4 = total
    expect(aoMudar).not.toHaveBeenCalled();
    expect(fotoAtiva()).toBe(4);
  });

  it("scrollLeft exatamente igual ao total de fotos também não vale (limite)", () => {
    montar({ fotos: FOTOS.slice(0, 3) });
    rolarPara(3 * LARGURA);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(fotoAtiva()).toBe(1);
  });

  it("scrollLeft negativo (elástico antes da primeira) não muda a foto", () => {
    montar();
    rolarPara(-LARGURA);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(fotoAtiva()).toBe(1);
  });

  it("rolagem que termina na foto que já é a atual não avisa ninguém", () => {
    montar({ inicial: 1 });
    rolarPara(LARGURA); // destino da montagem chega e libera
    aoMudar.mockClear();

    rolarPara(LARGURA + 20); // ainda na foto 2 (arredonda para 1)
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("a cliente arrastando até uma foto válida continua trocando a foto", () => {
    montar();
    rolarPara(2 * LARGURA);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledWith(2);
    expect(fotoAtiva()).toBe(3);
  });
});

describe("GaleriaDoProduto — o deslize pedido por nós", () => {
  it("passando pelas fotos do meio a bolinha ativa não pisca: só a foto pedida vira escolha", async () => {
    montar();
    await tocar(bolinhas()[3]); // pede a foto 4; a faixa ainda está no começo
    expect(fotoAtiva()).toBe(4);
    aoMudar.mockClear();

    rolarPara(LARGURA); // passou pela foto 2
    rolarPara(2 * LARGURA); // passou pela foto 3
    expect(aoMudar).not.toHaveBeenCalled();
    expect(fotoAtiva()).toBe(4);

    rolarPara(3 * LARGURA); // chegou: o destino é liberado
    rolarPara(LARGURA); // e a cliente arrasta de volta para a foto 2
    expect(aoMudar).toHaveBeenCalledWith(1);
    expect(fotoAtiva()).toBe(2);
  });

  it("o navegador avisa que a rolagem assentou antes do destino: a próxima escolha da cliente vale", async () => {
    montar();
    await tocar(bolinhas()[2]); // pede a foto 3
    aoMudar.mockClear();

    // A rolagem parou antes (ex.: a foto 3 saiu da faixa).
    act(() => {
      (faixa() as HTMLElement).dispatchEvent(new Event("scrollend"));
    });
    rolarPara(LARGURA);
    expect(aoMudar).toHaveBeenCalledWith(1);
    expect(fotoAtiva()).toBe(2);
  });

  it("sair da tela solta o ouvinte de `scrollend`", () => {
    montar();
    const el = faixa() as HTMLElement;
    const remover = vi.spyOn(el, "removeEventListener");
    act(() => raiz.unmount());
    expect(remover).toHaveBeenCalledWith("scrollend", expect.any(Function));
    raiz = createRoot(hospedeiro);
  });

  it.each([
    ["dedo", () => new Event("pointerdown", { bubbles: true })],
    ["roda do mouse", () => new Event("wheel", { bubbles: true })],
    ["teclado", () => new KeyboardEvent("keydown", { bubbles: true })],
  ])(
    "quando a cliente pega a faixa (%s) o destino pendente deixa de valer",
    async (_nome, gesto) => {
      montar();
      await tocar(bolinhas()[2]); // pede a foto 3 e a faixa não saiu do lugar
      aoMudar.mockClear();

      act(() => {
        (faixa() as HTMLElement).dispatchEvent(gesto());
      });
      rolarPara(LARGURA); // a cliente leva a faixa para a foto 2
      expect(aoMudar).toHaveBeenCalledWith(1);
      expect(fotoAtiva()).toBe(2);
    },
  );

  it("sem gesto da cliente, o destino pendente segue ignorando o caminho", async () => {
    montar();
    await tocar(bolinhas()[2]);
    aoMudar.mockClear();
    rolarPara(LARGURA);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(fotoAtiva()).toBe(3);
  });
});

describe("GaleriaDoProduto — faixa escondida e movimento reduzido", () => {
  it("com a faixa escondida (largura 0) a troca de foto não pede rolagem que ficaria presa", async () => {
    montar();
    largura = 0;
    await tocar(bolinhas()[2]);
    expect(fotoAtiva()).toBe(3);
    expect(scrollTo).not.toHaveBeenCalled();

    // A galeria reaparece e a cliente arrasta: nada de destino fantasma.
    largura = LARGURA;
    rolarPara(LARGURA);
    expect(aoMudar).toHaveBeenLastCalledWith(1);
    expect(fotoAtiva()).toBe(2);
  });

  it("deslize suave por padrão", async () => {
    montar();
    await tocar(seta("Próxima foto"));
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: LARGURA,
      behavior: "smooth",
    });
  });

  it("quem pediu menos movimento no aparelho recebe a rolagem instantânea", async () => {
    vi.stubGlobal(
      "matchMedia",
      (consulta: string) =>
        ({
          matches: consulta.includes("prefers-reduced-motion"),
          media: consulta,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
        }) as unknown as MediaQueryList,
    );
    montar();
    await tocar(seta("Próxima foto"));
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: LARGURA,
      behavior: "auto",
    });
  });
});

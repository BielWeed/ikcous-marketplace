// @vitest-environment jsdom
//
// Defeito medido em navegador real (loja IKCOUS, 15/11): a galeria de fotos do
// produto TROCAVA DE FOTO quando a largura da janela mudava (redimensionar no
// computador, girar o tablet ou o celular). A 1280 px na foto 3, estreitar para
// 1000 e voltar a 1280 mostrava a foto 4 (índice, bolinhas e miniaturas também
// na 4); descendo de 1030 para 1023 px a foto 3 virava a 2. Causa: ao mudar a
// largura o navegador guarda o scrollLeft em PIXELS e reencaixa na foto mais
// próxima; a galeria só realinhava quando o ÍNDICE mudava e tratava a foto
// errada como escolha da cliente. Agora um ResizeObserver devolve a faixa à foto
// que a cliente estava vendo, e a rolagem causada por isso não vira escolha.
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
/** O dublê do navegador: o `scrollTo` "move" a faixa (rolagem instantânea)? */
let scrollToMove: boolean;
let observadores: DublêDeObservador[];

class DublêDeObservador {
  desconectado = false;
  readonly aoMedir: () => void;
  constructor(aoMedir: () => void) {
    this.aoMedir = aoMedir;
    observadores.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.desconectado = true;
  }
  medir() {
    if (!this.desconectado) this.aoMedir();
  }
}

function Pai({ inicial = 0 }: { inicial?: number }) {
  const [indice, setIndice] = useState(inicial);
  return (
    <GaleriaDoProduto
      fotos={FOTOS}
      nome="Blusa"
      indice={indice}
      onMudarIndice={setIndice}
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

function rolarPara(scrollLeft: number) {
  const el = faixa() as HTMLElement;
  el.scrollLeft = scrollLeft;
  act(() => {
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

/** O navegador estreitou/alargou a janela: a largura muda e o observador avisa. */
function mudarLargura(nova: number) {
  largura = nova;
  act(() => {
    for (const observador of observadores) observador.medir();
  });
}

/** Leva a galeria até a foto `n` (1 = primeira) pelas setas, como a cliente. */
async function irParaFoto(n: number) {
  const proxima = hospedeiro.querySelector<HTMLElement>(
    "button[aria-label='Próxima foto']",
  );
  for (let i = 1; i < n; i++) {
    await act(async () => {
      proxima?.click();
    });
    // O navegador termina o deslize: scroll no destino.
    rolarPara(i * largura);
  }
  expect(fotoAtiva()).toBe(n);
}

beforeEach(() => {
  largura = 300;
  scrollToMove = true;
  observadores = [];
  scrollTo = vi.fn((opcoes: ScrollToOptions) => {
    if (scrollToMove) (faixa() as HTMLElement).scrollLeft = opcoes.left ?? 0;
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => largura,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  vi.stubGlobal("ResizeObserver", DublêDeObservador);
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
  act(() => raiz.render(<Pai />));
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

describe("GaleriaDoProduto — a largura da janela muda", () => {
  it("foto 3, a largura muda e o navegador reencaixa na foto 4: a faixa volta para a 3 e o índice fica 3", async () => {
    await irParaFoto(3);
    scrollTo.mockClear();

    // 300 -> 200: o navegador manteve os mesmos pixels (600), que agora são a foto 4.
    largura = 200;
    (faixa() as HTMLElement).scrollLeft = 600;
    mudarLargura(200);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ left: 2 * 200, behavior: "auto" });
    expect((faixa() as HTMLElement).scrollLeft).toBe(400);
    expect(fotoAtiva()).toBe(3);

    // O aviso de rolagem que o navegador manda por causa disso não troca a foto.
    rolarPara(400);
    expect(fotoAtiva()).toBe(3);
  });

  it("o scroll do reencaixe chega ANTES do observador: não vira escolha, e o observador devolve a foto 3", async () => {
    await irParaFoto(3);
    largura = 200; // o navegador já mudou a largura e reencaixou na foto 4...
    rolarPara(600); // ...e o scroll chega primeiro
    expect(fotoAtiva()).toBe(3);

    act(() => {
      for (const observador of observadores) observador.medir();
    });
    expect((faixa() as HTMLElement).scrollLeft).toBe(400);
    expect(fotoAtiva()).toBe(3);
  });

  it("a galeria que abre numa foto de variação (índice inicial 3) também volta para ela", () => {
    act(() => raiz.unmount());
    observadores = [];
    raiz = createRoot(hospedeiro);
    act(() => raiz.render(<Pai inicial={2} />));
    expect(fotoAtiva()).toBe(3);

    scrollTo.mockClear();
    (faixa() as HTMLElement).scrollLeft = 600; // foto 4 na largura nova
    mudarLargura(200);
    expect(scrollTo).toHaveBeenCalledWith({ left: 400, behavior: "auto" });
    expect(fotoAtiva()).toBe(3);
  });

  it("a rolagem gerada pelo reposicionamento (ainda na foto errada) NÃO vira escolha da cliente", async () => {
    await irParaFoto(3);
    scrollToMove = false; // o scroll chega ANTES de a faixa assentar
    largura = 200;
    (faixa() as HTMLElement).scrollLeft = 600; // foto 4 na largura nova
    mudarLargura(200);

    rolarPara(600);
    expect(fotoAtiva()).toBe(3);
  });

  it("a escolha real da cliente continua trocando a foto depois do reposicionamento", async () => {
    await irParaFoto(3);
    largura = 200;
    (faixa() as HTMLElement).scrollLeft = 600;
    mudarLargura(200);
    rolarPara(400); // assentou na 3

    rolarPara(200); // a cliente arrasta para a foto 2
    expect(fotoAtiva()).toBe(2);
  });

  it("a largura volta ao que era: a foto também se mantém (ida e volta)", async () => {
    await irParaFoto(3);
    for (const nova of [200, 300, 250, 300]) {
      (faixa() as HTMLElement).scrollLeft = 3 * nova; // o navegador erra para a foto 4
      mudarLargura(nova);
      rolarPara((faixa() as HTMLElement).scrollLeft);
      expect(fotoAtiva()).toBe(3);
      expect((faixa() as HTMLElement).scrollLeft).toBe(2 * nova);
    }
  });

  it("a largura mudou mas o navegador já deixou a faixa na foto certa: nada rola", async () => {
    await irParaFoto(3);
    scrollTo.mockClear();
    (faixa() as HTMLElement).scrollLeft = 2 * 200;
    mudarLargura(200);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(fotoAtiva()).toBe(3);
    // E o destino não fica preso: a escolha da cliente segue valendo.
    rolarPara(200);
    expect(fotoAtiva()).toBe(2);
  });

  it("o observador avisa sem a largura ter mudado (primeira medida): nada rola", async () => {
    await irParaFoto(3);
    scrollTo.mockClear();
    // A cliente está no meio de um arraste e só a ALTURA mudou (barra do
    // navegador, teclado virtual): a faixa não pode ser puxada de volta.
    (faixa() as HTMLElement).scrollLeft = 2 * 300 + 40;
    mudarLargura(300);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(fotoAtiva()).toBe(3);
  });

  it("na montagem, a primeira medida do observador não rola a faixa", () => {
    (faixa() as HTMLElement).scrollLeft = 100; // fora do encaixe, sem a largura ter mudado
    act(() => {
      for (const observador of observadores) observador.medir();
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(fotoAtiva()).toBe(1);
  });

  it("largura zero (galeria escondida): não rola para lugar nenhum", async () => {
    await irParaFoto(3);
    scrollTo.mockClear();
    mudarLargura(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("ao sair da tela, desconecta o observador", () => {
    expect(observadores).toHaveLength(1);
    act(() => raiz.unmount());
    expect(observadores.every((o) => o.desconectado)).toBe(true);
    raiz = createRoot(hospedeiro);
  });
});

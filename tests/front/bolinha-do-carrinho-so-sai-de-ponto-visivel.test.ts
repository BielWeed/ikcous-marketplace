// @vitest-environment jsdom
//
// A bolinha que voa até o carrinho só pode sair de um ponto que a cliente
// ENXERGA (14/10/2026). Relato do dono: dentro da folha de escolha ela boiava
// sobre o conteúdo e seguia para um carrinho coberto pela folha. A função
// `pontoDeSaidaVisivel` é o que o card pergunta antes de soltar a bolinha:
// o elemento tem tamanho, o centro dele está dentro da tela, e o que está por
// cima desse centro é do próprio card (não uma barra fixa, não outra folha).
//
// O jsdom não mede layout (tudo zero) e não implementa `elementFromPoint`:
// as medidas e quem está por cima são dadas na mão, em cada caso.
import { afterEach, describe, expect, it, vi } from "vitest";

import { pontoDeSaidaVisivel } from "@/utils/cartAnimation";

function elementoMedido(r: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  const el = document.createElement("div");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...r,
    right: r.left + r.width,
    bottom: r.top + r.height,
    x: r.left,
    y: r.top,
    toJSON: () => ({}),
  });
  return el;
}

function quemEstaPorCima(el: Element | null) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => el,
  });
}

describe("pontoDeSaidaVisivel", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "elementFromPoint");
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("elemento sem tamanho (display:none, fora do DOM) não é ponto de saída", () => {
    const card = document.createElement("div");
    const foto = elementoMedido({ left: 0, top: 0, width: 0, height: 0 });
    card.appendChild(foto);
    expect(pontoDeSaidaVisivel(foto, card)).toBe(false);
  });

  it("centro dentro da tela e card por cima: é ponto de saída", () => {
    const card = document.createElement("div");
    const foto = elementoMedido({
      left: 20,
      top: 100,
      width: 160,
      height: 200,
    });
    card.appendChild(foto);
    quemEstaPorCima(foto);
    expect(pontoDeSaidaVisivel(foto, card)).toBe(true);
  });

  it("centro acima do topo da tela: não é", () => {
    const card = document.createElement("div");
    const foto = elementoMedido({
      left: 20,
      top: -500,
      width: 160,
      height: 200,
    });
    card.appendChild(foto);
    quemEstaPorCima(foto);
    expect(pontoDeSaidaVisivel(foto, card)).toBe(false);
  });

  it("centro abaixo do pé da tela: não é", () => {
    const card = document.createElement("div");
    const foto = elementoMedido({
      left: 20,
      top: window.innerHeight + 10,
      width: 160,
      height: 200,
    });
    card.appendChild(foto);
    quemEstaPorCima(foto);
    expect(pontoDeSaidaVisivel(foto, card)).toBe(false);
  });

  it("coberto por algo de FORA do card (barra fixa, outra folha): não é", () => {
    const card = document.createElement("div");
    const foto = elementoMedido({
      left: 20,
      top: 100,
      width: 160,
      height: 200,
    });
    card.appendChild(foto);
    const barra = document.createElement("nav");
    quemEstaPorCima(barra);
    expect(pontoDeSaidaVisivel(foto, card)).toBe(false);
  });

  it("ninguém por cima (elementFromPoint devolve nulo, ponto fora do documento): não é", () => {
    const card = document.createElement("div");
    const foto = elementoMedido({
      left: 20,
      top: 100,
      width: 160,
      height: 200,
    });
    card.appendChild(foto);
    quemEstaPorCima(null);
    expect(pontoDeSaidaVisivel(foto, card)).toBe(false);
  });

  it("sem elementFromPoint no ambiente, vale só a geometria", () => {
    const card = document.createElement("div");
    const foto = elementoMedido({
      left: 20,
      top: 100,
      width: 160,
      height: 200,
    });
    card.appendChild(foto);
    expect(pontoDeSaidaVisivel(foto, card)).toBe(true);
  });
});

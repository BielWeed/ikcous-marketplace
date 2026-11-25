// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), MarcaDoFrete. Buracos que o teste vizinho
// (marca-do-frete-componentes) deixava passar:
//  - o selo ESCURO do logo de texto branco (Azul Cargo) só vale enquanto o logo está na
//    tela; se a imagem falha e entra o ícone de caminhão (cinza), o selo volta a ser
//    branco (caminhão cinza sobre fundo escuro some);
//  - as medidas do selo: altura = tamanho, largura mínima = tamanho x 1,3 (arredondada),
//    imagem com largura = tamanho x 1,6, ícone de caminhão com 55% do tamanho;
//  - o selo do agregador: logo de 14 x 14 decorativo (alt vazio), e texto "via <nome>".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LogoDaTransportadora,
  SeloDoAgregador,
} from "@/components/shipping/MarcaDoFrete";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let hospedeiro: HTMLDivElement;
let raiz: Root;

async function montar(elemento: React.ReactElement) {
  await act(async () => {
    raiz.render(elemento);
  });
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

const selo = () => hospedeiro.firstElementChild as HTMLElement;

describe("LogoDaTransportadora: selo escuro e medidas", () => {
  it("logo de texto branco falha ao carregar: o selo escuro volta a ser branco, com o caminhão", async () => {
    await montar(<LogoDaTransportadora slug="azul-cargo" nome="Azul Cargo" />);
    expect(selo().className).toContain("bg-zinc-900");
    const img = hospedeiro.querySelector("img");
    expect(img).not.toBeNull();
    await act(async () => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.querySelector("svg")).not.toBeNull();
    expect(selo().className).toContain("bg-white");
    expect(selo().className).not.toContain("bg-zinc-900");
  });

  it("slug que não existe (ou ausente): caminhão em selo branco, sem escuro", async () => {
    await montar(<LogoDaTransportadora slug="nao-existe" nome="Qualquer" />);
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(selo().className).not.toContain("bg-zinc-900");
    await montar(<LogoDaTransportadora slug={null} nome="Qualquer" />);
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(selo().className).not.toContain("bg-zinc-900");
  });

  it("tamanho padrão 32: selo de 32 px de altura e 42 px de largura mínima; imagem 51 x 32", async () => {
    await montar(<LogoDaTransportadora slug="correios" nome="Correios" />);
    expect(selo().style.height).toBe("32px");
    expect(selo().style.minWidth).toBe("42px");
    const img = hospedeiro.querySelector("img");
    expect(img?.getAttribute("width")).toBe("51");
    expect(img?.getAttribute("height")).toBe("32");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("tamanho 40: selo de 40 x 52, imagem 64 x 40 e caminhão de 22 x 22 quando cai no ícone", async () => {
    await montar(
      <LogoDaTransportadora slug="correios" nome="Correios" tamanho={40} />,
    );
    expect(selo().style.height).toBe("40px");
    expect(selo().style.minWidth).toBe("52px");
    const img = hospedeiro.querySelector("img");
    expect(img?.getAttribute("width")).toBe("64");
    expect(img?.getAttribute("height")).toBe("40");

    await montar(
      <LogoDaTransportadora slug="nao-existe" nome="Qualquer" tamanho={40} />,
    );
    const caminhao = hospedeiro.querySelector<SVGElement>("svg");
    expect(caminhao?.style.width).toBe("22px");
    expect(caminhao?.style.height).toBe("22px");
    expect(caminhao?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("SeloDoAgregador: logo decorativo de 14 px e texto", () => {
  it("agregador conhecido: logo 14 x 14 sem alt, carregamento preguiçoso, e 'via <nome>'", async () => {
    await montar(<SeloDoAgregador slug="melhor-envio" nome="Melhor Envio" />);
    const img = hospedeiro.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("width")).toBe("14");
    expect(img?.getAttribute("height")).toBe("14");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(hospedeiro.textContent).toBe("via Melhor Envio");
  });

  it("logo que falha some e o texto continua; agregador sem logo só mostra o texto", async () => {
    await montar(<SeloDoAgregador slug="frenet" nome="Frenet" />);
    await act(async () => {
      hospedeiro.querySelector("img")?.dispatchEvent(new Event("error"));
    });
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.textContent).toBe("via Frenet");

    await montar(<SeloDoAgregador slug="desconhecido" nome="Outro" />);
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.textContent).toBe("via Outro");
  });
});

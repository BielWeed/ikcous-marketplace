// @vitest-environment jsdom
//
// `carrosselPodeGirar` decide se um carrossel da Home pode avançar sozinho. Duas
// perguntas independentes, e as duas têm de ser "sim" para girar:
//
//  1. A aba do NAVEGADOR está visível? Com a cliente em outra aba (ou com a tela
//     do celular apagada) o banner não gira por trás nem gasta bateria, mesmo
//     que a Home ainda seja a tela ativa do app.
//  2. A tela do APP onde o carrossel mora é a ativa? A Home continua montada
//     (só escondida) quando a cliente vai ao carrinho; só a aba ativa leva a
//     classe `active-scroll-container`. Fora de qualquer `.admin-tab-pane`
//     (esqueleto, painel, testes) o carrossel conta como visível.
import { carrosselPodeGirar } from "@/lib/carrossel-visivel";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function carrosselDentroDeUmaAba(classes: string): HTMLElement {
  const aba = document.createElement("div");
  aba.className = `admin-tab-pane ${classes}`.trim();
  const carrossel = document.createElement("section");
  aba.append(carrossel);
  document.body.append(aba);
  return carrossel;
}

describe("a aba do navegador oculta nunca deixa o carrossel girar", () => {
  it("aba oculta: não gira, em qualquer lugar do app", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    expect(carrosselPodeGirar(null)).toBe(false);
    expect(carrosselPodeGirar(undefined)).toBe(false);
    expect(
      carrosselPodeGirar(carrosselDentroDeUmaAba("active-scroll-container")),
    ).toBe(false);
  });

  it("aba visível e fora de qualquer aba do app: gira", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const solto = document.createElement("section");
    document.body.append(solto);

    expect(carrosselPodeGirar(null)).toBe(true);
    expect(carrosselPodeGirar(undefined)).toBe(true);
    expect(carrosselPodeGirar(solto)).toBe(true);
  });
});

describe("a tela do app onde o carrossel mora precisa ser a ativa", () => {
  it("dentro da aba ativa: gira; dentro de uma aba escondida: não gira", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);

    expect(
      carrosselPodeGirar(carrosselDentroDeUmaAba("active-scroll-container")),
    ).toBe(true);
    expect(carrosselPodeGirar(carrosselDentroDeUmaAba(""))).toBe(false);
    expect(carrosselPodeGirar(carrosselDentroDeUmaAba("outra-classe"))).toBe(
      false,
    );
  });
});

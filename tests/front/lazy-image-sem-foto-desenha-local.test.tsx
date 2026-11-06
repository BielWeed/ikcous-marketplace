// @vitest-environment jsdom
//
// Produto sem foto chega à vitrine com a imagem de reserva "Sem Imagem" de um
// site de fora (placehold.co). Sem internet (ou com o site bloqueado) o pedido
// falhava e o LazyImage tratava isso como falha de rede: a cliente via "Toque
// para tentar de novo" num produto que nem tem foto. A reserva agora é desenhada
// aqui mesmo, sem pedir nada à rede, e nunca oferece "tentar de novo".
import { LazyImage } from "@/components/LazyImage";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

function montar(src: string) {
  act(() => {
    raiz.render(<LazyImage src={src} alt="Camisa azul" priority />);
  });
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("LazyImage — foto de reserva desenhada localmente", () => {
  it("a imagem de reserva não pede nada à rede: sem <img>, com 'Sem foto' e sem 'tentar de novo'", () => {
    montar("https://placehold.co/600x400?text=Sem+Imagem");
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.querySelector("button")).toBeNull();
    expect(hospedeiro.textContent).toContain("Sem foto");
    expect(hospedeiro.textContent).not.toContain("tentar de novo");
  });

  it("controle: foto de verdade segue sendo <img> normal", () => {
    montar(
      "https://loja.supabase.co/storage/v1/object/public/produtos/camisa.png",
    );
    expect(hospedeiro.querySelector("img")).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain("Sem foto");
  });

  it("trocar a reserva por foto de verdade passa a pedir a foto", () => {
    montar("https://placehold.co/600x400?text=Sem+Imagem");
    montar("https://loja.test/produto.webp");
    expect(hospedeiro.querySelector("img")).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain("Sem foto");
  });
});

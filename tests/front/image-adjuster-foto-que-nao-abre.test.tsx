// @vitest-environment jsdom
//
// Editor "Ajustar e Cortar": quando a foto não abre (sem internet, arquivo
// apagado do armazenamento), o editor ficava em "Carregando Imagem..." para
// sempre, com o "Salvar Ajuste" desligado e sem dizer por quê. Agora a falha
// vira aviso claro, com "Tentar de novo" (e o Voltar/Cancelar de sempre), e o
// "Salvar Ajuste" continua desligado enquanto não há foto para recortar.
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO = "https://example.com/produto.jpg";
const OUTRA_FOTO = "https://example.com/outra.jpg";

let raiz: Root;
let hospedeiro: HTMLDivElement;

function montar(imageUrl: string) {
  act(() => {
    raiz.render(
      <ImageAdjuster
        isOpen
        onClose={() => {}}
        onConfirm={async () => {}}
        imageUrl={imageUrl}
      />,
    );
  });
}

const imagem = () =>
  document.body.querySelector<HTMLImageElement>('img[alt="Ajuste"]');
const texto = () => document.body.textContent ?? "";
const botao = (nome: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === nome,
  );

function falhar() {
  act(() => {
    imagem()?.dispatchEvent(new Event("error"));
  });
}

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObserverStub);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("ImageAdjuster — foto que não abre", () => {
  it("antes de abrir: mostra 'Carregando Imagem...' e não fala em erro", () => {
    montar(FOTO);
    expect(texto()).toContain("Carregando Imagem...");
    expect(texto()).not.toContain("Não foi possível abrir esta foto");
  });

  it("falhou: tira o 'Carregando', avisa, oferece 'Tentar de novo' e mantém 'Salvar Ajuste' desligado", () => {
    montar(FOTO);
    falhar();
    expect(texto()).not.toContain("Carregando Imagem...");
    expect(texto()).toContain("Não foi possível abrir esta foto");
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(botao("Salvar Ajuste")?.hasAttribute("disabled")).toBe(true);
    // Sair continua possível.
    expect(botao("Cancelar")?.hasAttribute("disabled")).toBe(false);
  });

  it("'Tentar de novo' pede a foto de novo (elemento novo) e, abrindo, libera o 'Salvar Ajuste'", () => {
    montar(FOTO);
    const primeira = imagem();
    falhar();
    act(() => botao("Tentar de novo")!.click());
    const segunda = imagem();
    expect(segunda).not.toBe(primeira);
    expect(texto()).toContain("Carregando Imagem...");
    expect(texto()).not.toContain("Não foi possível abrir esta foto");
    act(() => {
      segunda?.dispatchEvent(new Event("load"));
    });
    expect(texto()).not.toContain("Carregando Imagem...");
    expect(botao("Salvar Ajuste")?.hasAttribute("disabled")).toBe(false);
  });

  it("foto nova depois da falha: o aviso da foto antiga não vale para ela", () => {
    montar(FOTO);
    falhar();
    expect(texto()).toContain("Não foi possível abrir esta foto");
    montar(OUTRA_FOTO);
    expect(texto()).not.toContain("Não foi possível abrir esta foto");
    expect(texto()).toContain("Carregando Imagem...");
  });
});

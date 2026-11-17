// @vitest-environment jsdom
//
// Dois defeitos de acessibilidade no ajuste de imagem do painel:
//  1. O controle deslizante do zoom não tinha nome acessível: "Zoom da Imagem"
//     era um <span> solto, então o leitor de tela anunciava só o valor.
//  2. O interruptor "Simular textos do banner" usava `focus:outline-none` sem
//     substituto, então o foco por teclado ficava invisível.
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

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

function montar() {
  act(() => {
    raiz.render(
      <ImageAdjuster
        isOpen
        onClose={() => {}}
        onConfirm={async () => {}}
        imageUrl="https://example.com/banner.jpg"
        allowedPresets={["2:1"]}
        defaultPreset="2:1"
        bannerPreview={{ title: "Título" }}
      />,
    );
  });
}

describe("ImageAdjuster — acessibilidade do zoom e do interruptor", () => {
  it("reserva o gesto à foto sem bloquear a rolagem fora dela", () => {
    montar();
    const recorte = document.body.querySelector(
      '[role="application"][aria-label="Ajustador de imagem: clique e arraste para posicionar"]',
    );
    expect(recorte).not.toBeNull();
    expect(recorte?.classList.contains("touch-none")).toBe(true);
    const rolavel = recorte?.closest(".overflow-y-auto");
    expect(rolavel).not.toBeNull();
    expect(rolavel?.classList.contains("touch-none")).toBe(false);
  });

  it.each(["Voltar", "Diminuir zoom", "Aumentar zoom"])(
    "o botão %s garante uma área de toque de pelo menos 44 por 44",
    (nome) => {
      montar();
      const botao = Array.from(document.body.querySelectorAll("button")).find(
        (elemento) =>
          (elemento.getAttribute("aria-label") ??
            elemento.textContent?.trim()) === nome,
      );
      expect(botao).toBeDefined();
      expect(botao?.classList.contains("min-h-11")).toBe(true);
      expect(botao?.classList.contains("min-w-11")).toBe(true);
    },
  );

  it("o controle deslizante do zoom é achado pelo nome 'zoom'", () => {
    montar();
    const slider = document.body.querySelector<HTMLInputElement>(
      'input[type="range"]#zoom-slider',
    );
    expect(slider).not.toBeNull();
    const nome =
      slider?.getAttribute("aria-label") ??
      slider?.getAttribute("aria-labelledby");
    expect(nome, "o slider precisa de nome acessível").toBeTruthy();
    expect(nome).toMatch(/zoom/i);
  });

  it("o interruptor 'Simular textos do banner' mostra o foco por teclado", () => {
    montar();
    const chave = document.body.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Simular textos do banner"]',
    );
    expect(chave).not.toBeNull();
    const classes = chave?.className ?? "";
    expect(classes).toMatch(/focus-visible:ring-2/);
    expect(classes).not.toMatch(/(^|\s)focus:outline-none/);
  });
});

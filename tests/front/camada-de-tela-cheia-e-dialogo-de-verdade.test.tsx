// @vitest-environment jsdom
//
// R29: o editor de foto (ImageAdjuster) e o simulador "Ver app"
// (PhoneSimulator) do cadastro de produto são camadas de tela cheia feitas
// com `createPortal` cru: sem role=dialog, sem rótulo, sem foco ao abrir, o
// Esc não fechava e o Tab andava pela tela escondida atrás. Aqui: cada um
// vira diálogo de verdade (role, aria-modal, rótulo), recebe o foco ao abrir,
// fecha no Esc (o do editor respeita o envio em andamento), prende o Tab
// dentro da camada e devolve o foco ao botão que abriu.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, freeShippingMin: 0 },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const formData = {
  name: "Produto de teste",
  description: "Descricao de teste",
  price: "12.9",
  costPrice: "5",
  originalPrice: "24.9",
  stock: "10",
  category: "geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [],
};

const noop = () => {};

// jsdom não tem ResizeObserver (o editor de foto mede o recorte com ele).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("camadas de tela cheia do cadastro de produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let botaoDeOrigem: HTMLButtonElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    botaoDeOrigem = document.createElement("button");
    botaoDeOrigem.textContent = "Abrir";
    document.body.appendChild(botaoDeOrigem);
    botaoDeOrigem.focus();
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    botaoDeOrigem.remove();
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
  });

  async function montarAjustador(
    onClose: () => void,
    isSubmitting = false,
  ): Promise<HTMLElement> {
    const { ImageAdjuster } = await import(
      "@/components/ui/custom/ImageAdjuster"
    );
    act(() => {
      raiz.render(
        <ImageAdjuster
          isOpen
          onClose={onClose}
          onConfirm={async () => {}}
          imageUrl="https://example.com/foto.jpg"
          isSubmitting={isSubmitting}
        />,
      );
    });
    return document.body.querySelector<HTMLElement>('[role="dialog"]')!;
  }

  async function montarSimulador(onClose: () => void): Promise<HTMLElement> {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );
    act(() => {
      raiz.render(
        <PhoneSimulator
          onClose={onClose}
          formData={formData}
          previewMode="card"
          setPreviewMode={noop}
          previewImgIndex={0}
          setPreviewImgIndex={noop}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={noop}
          activeDetailTab="description"
          setActiveDetailTab={noop}
        />,
      );
    });
    return document.body.querySelector<HTMLElement>('[role="dialog"]')!;
  }

  const esc = () =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

  const tab = (shiftKey = false) => {
    const evento = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(evento);
    });
    return evento;
  };

  const focaveis = (dialogo: HTMLElement) =>
    [...dialogo.querySelectorAll<HTMLElement>("button, input, select")].filter(
      (el) => !el.hasAttribute("disabled"),
    );

  describe.each([
    ["ImageAdjuster", "Ajustar imagem", montarAjustador],
    ["PhoneSimulator", "Simulador do aplicativo", montarSimulador],
  ] as const)("%s", (_nome, rotulo, montar) => {
    it("é um diálogo modal com nome", async () => {
      const dialogo = await montar(vi.fn());
      expect(dialogo).not.toBeNull();
      expect(dialogo.getAttribute("aria-modal")).toBe("true");
      expect(dialogo.getAttribute("aria-label")).toBe(rotulo);
    });

    it("recebe o foco ao abrir", async () => {
      const dialogo = await montar(vi.fn());
      expect(dialogo.contains(document.activeElement)).toBe(true);
    });

    it("Esc fecha uma vez e não chega ao ouvinte da janela", async () => {
      const aoFechar = vi.fn();
      const naJanela = vi.fn();
      window.addEventListener("keydown", naJanela);
      try {
        await montar(aoFechar);
        esc();
        expect(aoFechar).toHaveBeenCalledTimes(1);
        expect(naJanela).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("keydown", naJanela);
      }
    });

    it("o Tab não sai da camada, nem para frente nem para trás", async () => {
      const dialogo = await montar(vi.fn());
      const lista = focaveis(dialogo);
      expect(lista.length).toBeGreaterThan(1);
      lista.at(-1)?.focus();
      const evento = tab(false);
      expect(evento.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(lista[0]);
      const volta = tab(true);
      expect(volta.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(lista.at(-1));
    });

    it("com o foco fora da camada, o Tab traz o foco de volta para dentro", async () => {
      const dialogo = await montar(vi.fn());
      botaoDeOrigem.focus();
      tab(false);
      expect(dialogo.contains(document.activeElement)).toBe(true);
    });

    it("ao fechar, devolve o foco ao botão que abriu", async () => {
      const dialogo = await montar(vi.fn());
      // o foco saiu do botão para a camada; só então a volta tem o que provar
      expect(dialogo.contains(document.activeElement)).toBe(true);
      act(() => raiz.render(<span />));
      expect(document.activeElement).toBe(botaoDeOrigem);
    });
  });

  it("ImageAdjuster: Esc durante o envio não fecha (como o botão Voltar desabilitado)", async () => {
    const aoFechar = vi.fn();
    const dialogo = await montarAjustador(aoFechar, true);
    expect(dialogo).not.toBeNull();
    esc();
    expect(aoFechar).not.toHaveBeenCalled();
  });
});

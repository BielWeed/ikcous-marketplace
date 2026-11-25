// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui/custom: o seletor de quantidade
// é o mesmo nas quatro telas de compra e tinha cinco pontos que o teste vigente
// não segurava (plantado o defeito, nada reprovava):
//  - o "−" aparecia como DESLIGADO para o leitor de tela já na quantidade 2,
//    quando ainda dá para diminuir;
//  - o número da quantidade perdia a região que o leitor de tela anuncia;
//  - "reduzir movimento" não parava a animação do número;
//  - cada tamanho (sm, folha, pill, md) trocava de medida de toque sem aviso.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const movimento = vi.hoisted(() => ({ reduzir: false }));

vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  return { ...real, useReducedMotion: () => movimento.reduzir };
});

import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let contedor: HTMLDivElement;

beforeEach(() => {
  movimento.reduzir = false;
  contedor = document.createElement("div");
  document.body.appendChild(contedor);
  raiz = createRoot(contedor);
});

afterEach(() => {
  act(() => raiz.unmount());
  contedor.remove();
});

type Tamanho = "sm" | "md" | "folha" | "pill";

function montar(quantity: number, maxQuantity: number, size?: Tamanho) {
  const onChange = vi.fn();
  act(() => {
    raiz.render(
      <QuantitySelector
        quantity={quantity}
        maxQuantity={maxQuantity}
        onChange={onChange}
        size={size}
      />,
    );
  });
  const menos = contedor.querySelector(
    'button[aria-label="Diminuir quantidade"]',
  ) as HTMLButtonElement;
  const mais = contedor.querySelector(
    'button[aria-label="Aumentar quantidade"]',
  ) as HTMLButtonElement;
  const regiaoViva = contedor.querySelector(
    '[aria-live="polite"]',
  ) as HTMLElement | null;
  return { menos, mais, onChange, regiaoViva };
}

describe("QuantitySelector — o '−' só aparece desligado na quantidade 1", () => {
  it("quantidade 1: desligado para o leitor de tela e o clique não chama onChange", () => {
    const { menos, onChange } = montar(1, 10);
    expect(menos.getAttribute("aria-disabled")).toBe("true");
    act(() => menos.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("quantidade 2: ligado (aria-disabled=false) e o clique diminui para 1", () => {
    const { menos, onChange } = montar(2, 10);
    expect(menos.getAttribute("aria-disabled")).toBe("false");
    act(() => menos.click());
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("quantidade 0 (carrinho com dado antigo): também desligado, não vai para -1", () => {
    const { menos, onChange } = montar(0, 10);
    expect(menos.getAttribute("aria-disabled")).toBe("true");
    act(() => menos.click());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("QuantitySelector — o número é anunciado e respeita 'reduzir movimento'", () => {
  it("o número mora dentro de uma região aria-live educada", () => {
    const { regiaoViva } = montar(3, 10);
    expect(regiaoViva).not.toBeNull();
    expect(regiaoViva?.textContent).toBe("3");
  });

  it("com animação (padrão): o número é o elemento animado, em camada absoluta", () => {
    const { regiaoViva } = montar(4, 10);
    const numero = regiaoViva?.querySelector("span") as HTMLElement;
    expect(numero.textContent).toBe("4");
    expect(numero.classList.contains("absolute")).toBe(true);
  });

  it("'reduzir movimento' ligado: o número vira texto parado (sem camada animada)", () => {
    movimento.reduzir = true;
    const { regiaoViva } = montar(4, 10);
    const numero = regiaoViva?.querySelector("span") as HTMLElement;
    expect(numero.textContent).toBe("4");
    expect(numero.classList.contains("absolute")).toBe(false);
    expect(numero.classList.contains("font-black")).toBe(true);
    expect(numero.classList.contains("text-zinc-800")).toBe(true);
  });

  it("folha: o número nunca anima, nem sem 'reduzir movimento', e tem o estilo da folha", () => {
    const { regiaoViva } = montar(5, 10, "folha");
    const numero = regiaoViva?.querySelector("span") as HTMLElement;
    expect(numero.textContent).toBe("5");
    expect(numero.classList.contains("absolute")).toBe(false);
    expect(numero.classList.contains("font-bold")).toBe(true);
    expect(numero.classList.contains("text-zinc-900")).toBe(true);
  });
});

describe("QuantitySelector — cada tamanho guarda a sua medida de toque", () => {
  function classes(b: HTMLElement) {
    return b.getAttribute("class") ?? "";
  }

  it("sm: botão de 28px com a área de toque invisível que leva a 44px; ícone pequeno", () => {
    const { menos, mais } = montar(2, 10, "sm");
    for (const b of [menos, mais]) {
      expect(classes(b)).toContain("w-7 h-7");
      expect(classes(b)).toContain("before:-inset-2");
      expect(b.querySelector("svg")?.getAttribute("class")).toContain(
        "w-3 h-3",
      );
      expect(b.querySelector("svg")?.getAttribute("class")).not.toContain(
        "w-3.5",
      );
    }
  });

  it("folha: botões de 48x44 em linha, sem borda branca de cartão", () => {
    const { menos, mais } = montar(2, 10, "folha");
    for (const b of [menos, mais]) {
      expect(classes(b)).toContain("h-12 w-11");
      expect(classes(b)).not.toContain("before:-inset-2");
      expect(classes(b)).toContain("focus-visible:outline-2");
      expect(b.querySelector("svg")?.getAttribute("class")).toContain("w-3.5");
    }
  });

  it("pill: botões redondos de 44px", () => {
    const { menos, mais } = montar(2, 10, "pill");
    for (const b of [menos, mais]) {
      expect(classes(b)).toContain("size-11");
      expect(classes(b)).toContain("rounded-full");
      expect(classes(b)).not.toContain("before:-inset-2");
    }
  });

  it("md (padrão): botões de 32px, sem as medidas dos outros tamanhos", () => {
    const { menos, mais } = montar(2, 10);
    for (const b of [menos, mais]) {
      expect(classes(b)).toContain("w-8 h-8");
      expect(classes(b)).not.toContain("size-11");
      expect(classes(b)).not.toContain("h-12 w-11");
      expect(classes(b)).not.toContain("before:-inset-2");
      expect(b.querySelector("svg")?.getAttribute("class")).toContain("w-3.5");
    }
  });
});

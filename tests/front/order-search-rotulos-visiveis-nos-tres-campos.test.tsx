// @vitest-environment jsdom
//
// Rastrear pedido sem conta: os três campos só tinham o texto de dica
// (placeholder), que some assim que a pessoa começa a digitar — quem se
// distrai no meio do preenchimento não lembra mais o que o campo pedia. Cada
// campo agora tem um rótulo VISÍVEL ligado ao input por for/id, e o terceiro
// diz de onde vem o código.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    generateOrderOtp: vi.fn(),
    fetchOrdersByOtp: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("OrderSearch — rótulos visíveis nos três campos do rastreio", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Rastrear sem Conta")
        ?.click();
    });
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  function rotuloDo(input: HTMLInputElement): HTMLLabelElement | undefined {
    return [...host.querySelectorAll("label")].find(
      (l) => l.htmlFor !== "" && l.htmlFor === input.id,
    );
  }

  it("cada um dos três inputs tem um <label> visível ligado por for/id, com o texto certo", () => {
    const campos = [...host.querySelectorAll<HTMLInputElement>("input")];
    expect(campos).toHaveLength(3);
    const [email, zap, fragmento] = campos;

    for (const campo of campos) {
      expect(campo.id).not.toBe("");
    }
    // ids distintos: um label nunca aponta para o campo errado
    expect(new Set(campos.map((c) => c.id)).size).toBe(3);

    expect(rotuloDo(email)?.textContent?.trim()).toBe("E-mail");
    expect(rotuloDo(zap)?.textContent?.trim()).toBe("WhatsApp com DDD");
    expect(rotuloDo(fragmento)?.textContent?.trim()).toBe(
      "6 últimos caracteres do ID do pedido",
    );
  });

  it("o rótulo é visível (não é sr-only) e aparece ANTES do campo", () => {
    const campos = [...host.querySelectorAll<HTMLInputElement>("input")];
    for (const campo of campos) {
      const rotulo = rotuloDo(campo)!;
      expect(rotulo).toBeDefined();
      expect(rotulo.className).not.toMatch(/sr-only/);
      expect(rotulo.className).not.toMatch(/\bhidden\b/);
      // Node.DOCUMENT_POSITION_FOLLOWING (4): o input vem depois do rótulo
      expect(
        rotulo.compareDocumentPosition(campo) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("o rótulo continua na tela depois de digitar (ao contrário do placeholder)", async () => {
    const campos = [...host.querySelectorAll<HTMLInputElement>("input")];
    await act(async () => {
      digitar(campos[0], "cliente@teste.com");
      digitar(campos[1], "34999999999");
      digitar(campos[2], "3884BE");
    });
    expect(campos[0].value).toBe("cliente@teste.com");
    for (const campo of campos) {
      expect(rotuloDo(campo)).toBeDefined();
    }
    expect(host.textContent).toContain("E-mail");
    expect(host.textContent).toContain("WhatsApp com DDD");
  });

  it("o terceiro campo diz de onde vem o código e a dica está ligada ao input", () => {
    const fragmento = host.querySelectorAll<HTMLInputElement>("input")[2];
    const idDaDica = fragmento.getAttribute("aria-describedby");
    expect(idDaDica).toBeTruthy();
    const dica = document.getElementById(idDaDica!);
    expect(dica?.textContent).toMatch(/comprovante da compra/i);
  });

  it("os ícones ficam dentro de um wrapper relative que contém só o input (não descentralizam)", () => {
    const campos = [...host.querySelectorAll<HTMLInputElement>("input")];
    for (const campo of campos) {
      const wrapper = campo.parentElement!;
      expect(wrapper.className).toMatch(/\brelative\b/);
      expect(wrapper.querySelectorAll("input")).toHaveLength(1);
      // o rótulo NÃO está dentro do wrapper do ícone
      expect(wrapper.querySelector("label")).toBeNull();
      expect(wrapper.querySelector("svg")).not.toBeNull();
    }
  });

  it("os placeholders de antes continuam (outros testes localizam o campo por eles)", () => {
    expect(host.querySelector('[placeholder="SEU E-MAIL"]')).not.toBeNull();
    expect(host.querySelector('[placeholder="SEU WHATSAPP"]')).not.toBeNull();
    expect(
      host.querySelector('[placeholder="6 FINAIS DO ID DO PEDIDO"]'),
    ).not.toBeNull();
  });
});

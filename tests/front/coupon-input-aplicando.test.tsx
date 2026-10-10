// @vitest-environment jsdom
//
// Frente B (28/09/2026): o campo de cupom do checkout trava enquanto uma
// validação está em voo (toque duplo não valida duas vezes) e não mente
// "R$ 0,00 aplicado" quando o cupom restaurado ainda está sendo conferido.
import { CouponInput } from "@/components/ui/custom/CouponInput";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function render(props: Parameters<typeof CouponInput>[0]) {
  await act(async () => {
    raiz.render(<CouponInput {...props} />);
  });
}

async function digitar(texto: string) {
  const campo = hospedeiro.querySelector<HTMLInputElement>(
    "#coupon-code-input",
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CouponInput", () => {
  it("aplica o código em maiúsculas e sem espaços", async () => {
    const onApply = vi.fn();
    await render({ onApply, onRemove: vi.fn() });
    await digitar("  promo10 ");
    await act(async () => {
      hospedeiro
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith("PROMO10");
  });

  it("com uma validação em voo, o botão trava e o Enter não valida de novo", async () => {
    const onApply = vi.fn();
    await render({ onApply, onRemove: vi.fn(), aplicando: true });
    await digitar("PROMO10");
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      "button[type=submit]",
    );
    expect(botao?.disabled).toBe(true);
    expect(botao?.textContent).toBe("Aplicando…");
    // Enter no campo dispara o submit do formulário mesmo com o botão travado.
    await act(async () => {
      hospedeiro
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("campo vazio não aplica nada", async () => {
    const onApply = vi.fn();
    await render({ onApply, onRemove: vi.fn() });
    await digitar("   ");
    await act(async () => {
      hospedeiro
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("cupom restaurado com desconto 0 diz que está conferindo (não 'R$ 0,00')", async () => {
    await render({
      onApply: vi.fn(),
      onRemove: vi.fn(),
      appliedCoupon: { code: "PROMO10", discount: 0 },
    });
    expect(hospedeiro.textContent).toContain("PROMO10");
    expect(hospedeiro.textContent).toContain("Conferindo o desconto");
    expect(hospedeiro.textContent).not.toContain("0,00");
  });

  it("cupom aplicado mostra a economia e o botão Remover chama onRemove", async () => {
    const onRemove = vi.fn();
    await render({
      onApply: vi.fn(),
      onRemove,
      appliedCoupon: { code: "PROMO10", discount: 12.5 },
    });
    expect(hospedeiro.textContent).toContain("Você economiza");
    expect(hospedeiro.textContent).toContain("12,50");
    const remover = hospedeiro.querySelector<HTMLButtonElement>(
      "button[aria-label='Remover cupom']",
    );
    await act(async () => {
      remover?.click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

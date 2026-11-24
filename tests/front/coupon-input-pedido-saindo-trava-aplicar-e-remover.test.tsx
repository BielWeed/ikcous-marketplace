// @vitest-environment jsdom
//
// `travado` ("o pedido está saindo") é a trava que impede a cliente de trocar o
// cupom no meio do envio: o desconto que o servidor conferiu é o que ele
// cobra, e aplicar ou remover o cupom nessa janela deixaria a tela dizendo um
// total e o pedido saindo com outro. Achado por mutação, 24/11/2026: tirar o
// `travado` do guarda do submit, do `disabled` do botão Aplicar ou do botão
// Remover passava com a suíte inteira verde (nenhum teste usava a prop).
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

describe("CouponInput com o pedido saindo (travado)", () => {
  it("o campo não aplica (nem por Enter) e o cupom aplicado não pode ser removido", async () => {
    // Campo: o botão Aplicar fica apagado e o submit (Enter) não chama onApply.
    const onApply = vi.fn();
    await render({ onApply, onRemove: vi.fn(), travado: true });
    const campo = hospedeiro.querySelector<HTMLInputElement>(
      "#coupon-code-input",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, "PROMO10");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const aplicar = hospedeiro.querySelector<HTMLButtonElement>(
      "button[type=submit]",
    );
    expect(aplicar?.disabled).toBe(true);
    // "travado" não escreve "Aplicando…": isso é do `aplicando`.
    expect(aplicar?.textContent).toBe("Aplicar");
    await act(async () => {
      hospedeiro
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(onApply).not.toHaveBeenCalled();

    // Cupom já aplicado: o Remover fica apagado e o clique não chama onRemove.
    const onRemove = vi.fn();
    await render({
      onApply,
      onRemove,
      appliedCoupon: { code: "PROMO10", discount: 10 },
      travado: true,
    });
    const remover = hospedeiro.querySelector<HTMLButtonElement>(
      "button[aria-label='Remover cupom']",
    );
    expect(remover?.disabled).toBe(true);
    await act(async () => {
      remover?.click();
    });
    expect(onRemove).not.toHaveBeenCalled();
  });
});

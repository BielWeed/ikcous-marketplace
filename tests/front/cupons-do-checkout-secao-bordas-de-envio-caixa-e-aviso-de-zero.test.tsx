// @vitest-environment jsdom
//
// Bordas da seção "Cupons" do checkout que passavam com a suíte inteira verde
// (achadas por mutação, 24/11/2026):
//  - pedido saindo: os cartões da lista têm de ficar travados também (só o
//    campo de digitar e o "Remover" eram travados nos testes). Sem isso a
//    cliente tocava num cartão com o pedido já a caminho e a tela mostrava um
//    cupom que não foi no pedido;
//  - o cupom aplicado não se repete na lista MESMO que o banco guarde o código
//    em outra caixa (cupom antigo "Vitrine10"; a cliente aplica "VITRINE10");
//  - o aviso falado do leitor de tela só existe com desconto de verdade:
//    "Você economiza R$ 0,00" não é dito;
//  - o botão "Aplicar" do campo fica apagado com o campo vazio ou só de espaços.
// DINHEIRO: valores fictícios.
import { CuponsDoCheckout } from "@/components/checkout/CuponsDoCheckout";
import type { CupomDisponivel } from "@/lib/cupons-do-checkout";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cupom = (extra: Partial<CupomDisponivel>): CupomDisponivel => ({
  codigo: "VITRINE10",
  tipo: "percentage",
  valor: 10,
  minimo: 0,
  validoAte: null,
  exclusivo: false,
  aplica: true,
  falta: 0,
  desconto: 10,
  ...extra,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;

function montar(props: Partial<Parameters<typeof CuponsDoCheckout>[0]> = {}) {
  const onApply = vi.fn();
  act(() => {
    raiz.render(
      <CuponsDoCheckout
        cupons={[cupom({ codigo: "VIP15", tipo: "fixed", valor: 15 })]}
        situacao="pronto"
        onTentarDeNovo={vi.fn()}
        appliedCoupon={null}
        couponError=""
        aplicando={null}
        onApply={onApply}
        onRemove={vi.fn()}
        {...props}
      />,
    );
  });
  return { onApply };
}

const cartoes = () => [
  ...hospedeiro.querySelectorAll('ul[aria-label="Cupons disponíveis"] > li'),
];

async function digitarNoCampo(texto: string) {
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

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("CuponsDoCheckout — bordas", () => {
  it("com o pedido saindo, o cartão da lista fica travado (não aplica cupom no meio do envio)", () => {
    montar({ emEnvio: false });
    const livre = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Aplicar o cupom VIP15"]',
    );
    expect(livre?.disabled).toBe(false);

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    montar({ emEnvio: true });
    const travado = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Aplicar o cupom VIP15"]',
    );
    expect(travado).not.toBeNull();
    expect(travado?.disabled).toBe(true);
  });

  it("o cupom aplicado não se repete na lista, mesmo guardado em outra caixa no banco", () => {
    montar({
      cupons: [
        cupom({ codigo: "Vitrine10" }),
        cupom({ codigo: "VIP15", tipo: "fixed", valor: 15 }),
      ],
      appliedCoupon: { code: "VITRINE10", discount: 10 },
    });
    const textos = cartoes().map((c) => c.textContent ?? "");
    expect(textos).toHaveLength(1);
    expect(textos[0]).toContain("VIP15");
    expect(hospedeiro.textContent).not.toContain("Vitrine10");
    expect(
      hospedeiro.querySelector('[aria-label="Aplicar o cupom Vitrine10"]'),
    ).toBeNull();
  });

  it("o aviso falado do cupom aplicado diz quanto economiza, e fica calado com desconto zero", () => {
    montar({ appliedCoupon: { code: "VIP15", discount: 15 } });
    const aviso = hospedeiro.querySelector('[role="status"]')?.textContent;
    expect(aviso).toMatch(
      /^Cupom VIP15 aplicado\. Você economiza R\$\s15,00\.$/,
    );

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    montar({ appliedCoupon: { code: "VIP15", discount: 0 } });
    expect(hospedeiro.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("'Aplicar' do campo fica apagado com o campo vazio ou só de espaços, e acende com um código", async () => {
    montar();
    const aplicar = () =>
      hospedeiro.querySelector<HTMLButtonElement>(
        '#campo-de-cupom button[type="submit"]',
      ) as HTMLButtonElement;
    expect(aplicar().disabled).toBe(true);

    await digitarNoCampo("   ");
    expect(aplicar().disabled).toBe(true);

    await digitarNoCampo("PROMO10");
    expect(aplicar().disabled).toBe(false);
  });
});

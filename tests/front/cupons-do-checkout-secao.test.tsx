// @vitest-environment jsdom
//
// Frente B (28/09/2026): a seção "Cupons" do checkout — cartões, melhor
// opção, exclusivo, "faltam R$ X", aplicado no topo, carregando/erro e o
// campo de digitar, que continua.
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

const LISTA: CupomDisponivel[] = [
  cupom({
    codigo: "VIP15",
    tipo: "fixed",
    valor: 15,
    desconto: 15,
    exclusivo: true,
  }),
  cupom({ codigo: "VITRINE10" }),
  cupom({
    codigo: "GRANDE30",
    tipo: "fixed",
    valor: 30,
    minimo: 150,
    aplica: false,
    desconto: 0,
    falta: 50,
  }),
  cupom({ codigo: "QUARTO5", tipo: "fixed", valor: 5, desconto: 5 }),
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

function montar(props: Partial<Parameters<typeof CuponsDoCheckout>[0]> = {}) {
  const onApply = vi.fn();
  const onRemove = vi.fn();
  const onTentarDeNovo = vi.fn();
  act(() => {
    raiz.render(
      <CuponsDoCheckout
        cupons={LISTA}
        situacao="pronto"
        onTentarDeNovo={onTentarDeNovo}
        appliedCoupon={null}
        couponError=""
        aplicando={null}
        onApply={onApply}
        onRemove={onRemove}
        {...props}
      />,
    );
  });
  return { onApply, onRemove, onTentarDeNovo };
}

const botao = (rotulo: string) =>
  [...hospedeiro.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === rotulo || b.textContent === rotulo,
  ) as HTMLButtonElement | undefined;

const cartoes = () => [
  ...hospedeiro.querySelectorAll('ul[aria-label="Cupons disponíveis"] > li'),
];

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("CuponsDoCheckout", () => {
  it("mostra os três primeiros cartões, com melhor opção e exclusivo", () => {
    montar();
    expect(hospedeiro.querySelector("h2")?.textContent).toBe("Cupons");
    expect(cartoes()).toHaveLength(3);
    const primeiro = cartoes()[0].textContent ?? "";
    expect(primeiro).toContain("Melhor opção");
    expect(primeiro).toContain("Exclusivo para você");
    expect(primeiro).toContain("R$ 15,00 OFF em qualquer compra");
    expect(primeiro).toContain("Você economiza R$ 15,00");
    // O segundo não é o melhor.
    expect(cartoes()[1].textContent).not.toContain("Melhor opção");
  });

  it("'faltam R$ X' com barra, sem botão de aplicar", () => {
    montar();
    const grande = cartoes()[2];
    expect(grande.textContent).toContain(
      "Faltam R$ 50,00 em produtos para usar",
    );
    expect(grande.querySelector("button")).toBeNull();
    expect(
      grande
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("67");
  });

  it("'Aplicar' com um toque chama onApply com o código", () => {
    const { onApply } = montar();
    act(() => botao("Aplicar o cupom VIP15")!.click());
    expect(onApply).toHaveBeenCalledWith("VIP15");
  });

  it("com uma validação em voo, todos os botões travam e o certo diz Aplicando…", () => {
    montar({ aplicando: "VIP15" });
    const vip = botao("Aplicar o cupom VIP15")!;
    expect(vip.textContent).toBe("Aplicando…");
    expect(vip.disabled).toBe(true);
    expect(botao("Aplicar o cupom VITRINE10")!.disabled).toBe(true);
  });

  it("'Ver mais' mostra o resto", () => {
    montar();
    act(() => botao("Ver mais 1 cupom")!.click());
    expect(cartoes()).toHaveLength(4);
  });

  it("aplicado: bloco no topo com economia e Remover; ele sai da lista", () => {
    const { onRemove } = montar({
      appliedCoupon: { code: "VIP15", discount: 15 },
    });
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a015,00");
    expect(hospedeiro.textContent).toContain("Outros cupons para você");
    expect(cartoes().some((c) => c.textContent?.includes("VIP15"))).toBe(false);
    // O campo de digitar some enquanto há cupom aplicado.
    expect(document.getElementById("coupon-code-input")).toBeNull();
    act(() => botao("Remover cupom")!.click());
    expect(onRemove).toHaveBeenCalled();
    expect(hospedeiro.querySelector('[role="status"]')?.textContent).toBe(
      "Cupom VIP15 aplicado. Você economiza R$ 15,00.",
    );
  });

  it("cupom restaurado (desconto 0) diz que está conferindo, não 'R$ 0,00'", () => {
    montar({ appliedCoupon: { code: "VIP15", discount: 0 } });
    expect(hospedeiro.textContent).toContain("Conferindo o desconto…");
    expect(hospedeiro.textContent).not.toContain("R$ 0,00");
  });

  it("recusa de um cartão com cupom aplicado aparece como alerta", () => {
    montar({
      appliedCoupon: { code: "VIP15", discount: 15 },
      couponError: "Cupom atingiu o limite de uso.",
    });
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "Cupom atingiu o limite de uso.",
    );
  });

  it("carregando: esqueleto aria-busy; campo continua", () => {
    montar({ cupons: [], situacao: "carregando" });
    expect(hospedeiro.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.getElementById("coupon-code-input")).not.toBeNull();
  });

  it("erro: 'Tentar de novo'; campo continua", () => {
    const { onTentarDeNovo } = montar({ cupons: [], situacao: "erro" });
    act(() => botao("Tentar de novo")!.click());
    expect(onTentarDeNovo).toHaveBeenCalled();
    expect(document.getElementById("coupon-code-input")).not.toBeNull();
  });

  it("indisponível (banco sem a RPC): só o campo de digitar, sem aviso", () => {
    montar({ cupons: [], situacao: "indisponivel" });
    expect(cartoes()).toHaveLength(0);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Tentar de novo");
    expect(document.getElementById("coupon-code-input")).not.toBeNull();
    expect(
      hospedeiro.querySelector('label[for="coupon-code-input"]')?.textContent,
    ).toBe("Tem um código de cupom?");
  });
});

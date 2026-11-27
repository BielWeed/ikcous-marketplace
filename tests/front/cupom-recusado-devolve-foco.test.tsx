// @vitest-environment jsdom
//
// Cupom aplicado pelo teclado (27/11/2026): enquanto o cupom é conferido, os
// cartões e o "Aplicar" do campo travavam com `disabled` — inclusive o que
// estava com o foco, e o navegador joga esse foco no `body`. Se o cupom era
// ACEITO, um efeito levava o foco para "Remover cupom"; se era RECUSADO
// (vencido, mínimo, já usado), nada o trazia de volta: o erro era falado, mas
// a cliente ficava "em lugar nenhum". A trava passageira agora é
// `aria-disabled` (o mesmo padrão do "Adicionar ao carrinho" da ficha do
// produto): o controle continua focado e o toque repetido não faz nada.
import { CuponsDoCheckout } from "@/components/checkout/CuponsDoCheckout";
import type { CupomDisponivel } from "@/lib/cupons-do-checkout";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  cupom({ codigo: "VIP15", tipo: "fixed", valor: 15, desconto: 15 }),
  cupom({ codigo: "VITRINE10" }),
];

let raiz: Root;
let hospedeiro: HTMLDivElement;
/** Responde a validação em voo, como o checkout faz. */
let responder: (resposta: "aceito" | "recusado") => void;
let chamadas: string[];

/** O pai de verdade, enxuto: `aplicando` durante a conferência, depois o
 *  cupom aplicado OU a mensagem da recusa (CheckoutView.handleApplyCoupon). */
function Checkout() {
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [aplicado, setAplicado] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [erro, setErro] = useState("");
  return (
    <CuponsDoCheckout
      cupons={LISTA}
      situacao="pronto"
      onTentarDeNovo={() => {}}
      appliedCoupon={aplicado}
      couponError={erro}
      aplicando={aplicando}
      onApply={(codigo) => {
        chamadas.push(codigo);
        setErro("");
        setAplicando(codigo);
        responder = (resposta) => {
          if (resposta === "aceito")
            setAplicado({ code: codigo, discount: 15 });
          else setErro("Cupom atingiu o limite de uso.");
          setAplicando(null);
        };
      }}
      onRemove={() => setAplicado(null)}
    />
  );
}

/**
 * O jsdom não aplica a "regra de correção do foco" do HTML: no navegador, um
 * controle focado que vira `disabled` deixa de ser focável e o foco cai no
 * `body`. Sem imitar isso, o defeito não aparece aqui. Roda depois de cada
 * passo da cliente (`agir`).
 */
function regraDeFocoDoNavegador() {
  const focado = document.activeElement;
  if (!(focado instanceof HTMLElement) || !focado.matches(":disabled")) return;
  // `blur()` do jsdom ignora elemento que já não é focável; um ralo focado e
  // removido deixa o foco no `body`, como o navegador faz.
  const ralo = document.createElement("input");
  document.body.appendChild(ralo);
  ralo.focus();
  ralo.remove();
}

function agir(passo: () => void) {
  act(passo);
  regraDeFocoDoNavegador();
}

const botao = (rotulo: string) =>
  [...hospedeiro.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === rotulo || b.textContent === rotulo,
  ) as HTMLButtonElement | undefined;

const aplicarDoCampo = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    '#campo-de-cupom button[type="submit"]',
  ) as HTMLButtonElement;

function digitarNoCampo(valor: string) {
  const input = document.getElementById(
    "coupon-code-input",
  ) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  chamadas = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  act(() => raiz.render(<Checkout />));
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("cupom aplicado pelo teclado: o foco nunca cai no body", () => {
  it("cartão: durante a conferência o cartão focado trava sem perder o foco, e o toque repetido não valida de novo", () => {
    const cartao = botao("Aplicar o cupom VIP15")!;
    agir(() => cartao.focus());
    agir(() => cartao.click());

    expect(document.activeElement).toBe(cartao);
    // A trava passageira não usa `disabled` (que tira o foco no navegador).
    expect(cartao.disabled).toBe(false);
    expect(cartao.getAttribute("aria-disabled")).toBe("true");
    expect(
      botao("Aplicar o cupom VITRINE10")!.getAttribute("aria-disabled"),
    ).toBe("true");

    agir(() => cartao.click());
    agir(() => botao("Aplicar o cupom VITRINE10")!.click());
    expect(chamadas).toEqual(["VIP15"]);
  });

  it("cartão RECUSADO: o foco continua no cartão que a cliente usou, já destravado", () => {
    const cartao = botao("Aplicar o cupom VIP15")!;
    agir(() => cartao.focus());
    agir(() => cartao.click());
    agir(() => responder("recusado"));

    expect(hospedeiro.textContent).toContain("Cupom atingiu o limite de uso.");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(botao("Aplicar o cupom VIP15"));
    expect(cartao.hasAttribute("aria-disabled")).toBe(false);
  });

  it("cartão ACEITO: o foco continua indo para 'Remover cupom'", () => {
    const cartao = botao("Aplicar o cupom VIP15")!;
    agir(() => cartao.focus());
    agir(() => cartao.click());
    agir(() => responder("aceito"));

    expect(document.activeElement).toBe(botao("Remover cupom"));
  });

  it("'Aplicar' do campo RECUSADO: o botão não perde o foco durante nem depois", () => {
    agir(() =>
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="campo-de-cupom"]',
        )!
        .click(),
    );
    digitarNoCampo("VENCIDO");
    const aplicar = aplicarDoCampo();
    agir(() => aplicar.focus());
    agir(() => aplicar.click());

    expect(chamadas).toEqual(["VENCIDO"]);
    expect(aplicar.textContent).toBe("Aplicando…");
    expect(document.activeElement).toBe(aplicar);
    expect(aplicar.disabled).toBe(false);
    expect(aplicar.getAttribute("aria-disabled")).toBe("true");

    // Toque repetido com a conferência em voo: nada.
    agir(() => aplicar.click());
    expect(chamadas).toEqual(["VENCIDO"]);

    agir(() => responder("recusado"));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(aplicarDoCampo());
  });

  it("'Aplicar' do campo ACEITO: o foco vai para 'Remover cupom'", () => {
    agir(() =>
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="campo-de-cupom"]',
        )!
        .click(),
    );
    digitarNoCampo("VIP15");
    const aplicar = aplicarDoCampo();
    agir(() => aplicar.focus());
    agir(() => aplicar.click());
    agir(() => responder("aceito"));

    expect(document.activeElement).toBe(botao("Remover cupom"));
  });
});

// @vitest-environment jsdom
//
// Relato do Gabriel (02/09, foto da grade de pedidos): o badge de pagamento
// estourava a coluna do card e o corte CSS virava "PAGÃO FORA DO FLUXO —
// PRECIS..." — ilegível e com cara de quebrado.
//
// O CONTRATO: `PaymentStatusBadge` em modo `compact` mostra o rótulo CURTO
// (`shortLabel`) e leva a frase completa para o `title` (hover). Sem
// `compact`, o rótulo longo de sempre — a ficha do pedido não perde nada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PaymentStatusBadge } from "@/components/admin/orders/OrderStatusBadge";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PaymentStatusBadge — rótulo curto no modo compact", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar(props: {
    paymentStatus: Parameters<typeof PaymentStatusBadge>[0]["paymentStatus"];
    orderStatus?: Parameters<typeof PaymentStatusBadge>[0]["orderStatus"];
    compact?: boolean;
  }) {
    await act(async () => {
      raiz.render(<PaymentStatusBadge {...props} />);
    });
  }

  it("pago_apos_expirar compacto: 'Pago fora do fluxo' + frase inteira no title", async () => {
    await renderizar({ paymentStatus: "pago_apos_expirar", compact: true });

    const badge = hospedeiro.querySelector("div[title]")!;
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("title")).toBe(
      "Pago fora do fluxo — precisa de atenção",
    );
    expect(badge.textContent).toBe("Pago fora do fluxo");
  });

  it("sem compact, o rótulo longo de sempre (a ficha não perde nada)", async () => {
    await renderizar({ paymentStatus: "pago_apos_expirar" });

    expect(hospedeiro.textContent).toContain(
      "Pago fora do fluxo — precisa de atenção",
    );
    expect(hospedeiro.querySelector("div[title]")).toBeNull();
  });

  it("estornado compacto: 'Estornado'", async () => {
    await renderizar({ paymentStatus: "estornado", compact: true });

    expect(hospedeiro.textContent).toContain("Estornado");
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
  });

  it("pago + cancelado compacto: 'Pago e cancelado'", async () => {
    await renderizar({
      paymentStatus: "pago",
      orderStatus: "cancelled",
      compact: true,
    });

    expect(hospedeiro.textContent).toBe("Pago e cancelado");
  });
});

// @vitest-environment jsdom
//
// A LOJA NOVA SÓ VENDE O QUE CONFIRMOU (28/11/2026, migration 20261655000000):
// no topo do Início, a loja que ainda não tem como receber pedido NENHUM pelo
// site (sem pagamento pelo app e com o pagamento na entrega pendente, ou sem
// como entregar) vê a faixa "Sua loja ainda não aceita pedidos...". Config
// carregando não afirma nada; loja que recebe não vê nada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const duble = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  isLoaded: true,
  pagamentoPeloApp: false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: duble.config, isLoaded: duble.isLoaded }),
}));
vi.mock("@/lib/pagamento-pelo-app-no-painel", () => ({
  usePagamentoPeloApp: () => duble.pagamentoPeloApp,
}));

import { FaixaLojaNaoAceitaPedidos } from "@/components/admin/inicio/FaixaLojaNaoAceitaPedidos";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE =
  "Sua loja ainda não aceita pedidos. Confirme a entrega e o pagamento abaixo.";

let hospedeiro: HTMLDivElement;
let raiz: Root;

async function montar() {
  await act(async () => {
    raiz.render(<FaixaLojaNaoAceitaPedidos />);
  });
}

beforeEach(() => {
  duble.config = {};
  duble.isLoaded = true;
  duble.pagamentoPeloApp = false;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("Início — faixa da loja que ainda não aceita pedidos", () => {
  it("loja nova sem nada confirmado e sem pagamento pelo app: a faixa aparece, como status", async () => {
    duble.config = {
      entregaLocalLiberada: false,
      pagamentoNaEntregaLiberado: false,
    };
    await montar();
    const faixa = hospedeiro.querySelector('[role="status"]');
    expect(faixa?.textContent).toBe(FRASE);
  });

  it("só o pagamento na entrega pendente, sem pagamento pelo app: não tem como pagar, a faixa aparece", async () => {
    duble.config = {
      entregaLocalLiberada: true,
      pagamentoNaEntregaLiberado: false,
    };
    await montar();
    expect(hospedeiro.textContent).toBe(FRASE);
  });

  it("só a entrega pendente, com retirada na loja ligada: recebe pedido, sem faixa", async () => {
    duble.config = {
      entregaLocalLiberada: false,
      pagamentoNaEntregaLiberado: true,
      enabledShippingMethods: ["store-pickup"],
      storeAddress: "Rua A, 10 - Centro",
    };
    await montar();
    expect(hospedeiro.textContent).toBe("");
  });

  it("pagamento na entrega pendente mas pagamento pelo app ligado (e transportadora possível): sem faixa", async () => {
    duble.pagamentoPeloApp = true;
    duble.config = {
      entregaLocalLiberada: false,
      pagamentoNaEntregaLiberado: false,
      shippingCoverage: "national",
    };
    await montar();
    expect(hospedeiro.textContent).toBe("");
  });

  it("loja confirmada (ou banco sem a migration: campos ausentes): sem faixa", async () => {
    await montar();
    expect(hospedeiro.textContent).toBe("");
  });

  it("config ainda carregando: não afirma nada", async () => {
    duble.isLoaded = false;
    duble.config = {
      entregaLocalLiberada: false,
      pagamentoNaEntregaLiberado: false,
    };
    await montar();
    expect(hospedeiro.textContent).toBe("");
  });
});

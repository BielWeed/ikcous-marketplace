// @vitest-environment jsdom
//
// Caça de leitor de tela (27/11/2026): a "Situação do pagamento" SUBSTITUI a
// tela do cartão quando a cobrança fica em dúvida — o formulário some e o
// foco caía no corpo da página, com o título comum. E a frase "Consultando o
// pagamento com o banco…" nascia JÁ dentro da região falada: o leitor de tela
// só anuncia o que ENTRA numa região que já existia, então ela não era lida.
//
// Mesmo andaime de verificacao-do-pagamento.test.tsx: `act` puro, sem
// @testing-library; `criarPagamento` é o dublê do `useOrders`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VerificacaoDoPagamento } from "@/components/checkout/VerificacaoDoPagamento";

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  // A consulta fica em voo: a tela para em "consultando".
  criarPagamento.mockReset();
  criarPagamento.mockReturnValue(new Promise(() => {}));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.restoreAllMocks();
});

function montar() {
  act(() => {
    raiz.render(
      <VerificacaoDoPagamento
        orderId={PEDIDO}
        onVerMeusPedidos={vi.fn()}
        onRetomadaLiberada={vi.fn()}
      />,
    );
  });
}

describe("VerificacaoDoPagamento — fala com o leitor de tela", () => {
  it("o título recebe o foco quando a tela aparece no lugar do cartão", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    montar();

    const titulo = hospedeiro.querySelector("h1");
    expect(titulo?.textContent).toContain("Situação do pagamento");
    expect(document.activeElement).toBe(titulo);
  });

  it("'Consultando o pagamento com o banco…' ENTRA numa região falada que já existia", async () => {
    const entradas: MutationRecord[] = [];
    const observador = new MutationObserver((registros) => {
      entradas.push(...registros);
    });
    observador.observe(hospedeiro, { childList: true, subtree: true });
    montar();
    // Os registros do observador chegam numa microtarefa.
    await Promise.resolve();
    entradas.push(...observador.takeRecords());
    observador.disconnect();

    const regiao = hospedeiro.querySelector('[role="status"]');
    expect(regiao?.textContent).toContain(
      "Consultando o pagamento com o banco…",
    );
    // A frase entrou DEPOIS, dentro da região já montada — não junto com ela.
    const entrouNaRegiao = entradas.some(
      (registro) =>
        registro.target === regiao &&
        [...registro.addedNodes].some((no) =>
          no.textContent?.includes("Consultando o pagamento com o banco…"),
        ),
    );
    expect(entrouNaRegiao).toBe(true);
  });
});

// @vitest-environment jsdom
//
// RETIRADA NA LOJA × ETIQUETA (release 1.5.3, 22/09/2026).
//
// Pedido de retirada (`shipping_option_id = 'store-pickup'`) não tem envio:
// a cliente busca na loja. A edge `melhor-envio-etiqueta` já recusa, mas a
// tela oferecia "Gerar etiqueta" ativo — convite a gastar um clique (e a
// confirmação de saldo) para ouvir um "não". O que se prova: a lista marca
// "retirada na loja — sem etiqueta" e o botão fica apagado; pedido de
// transportadora segue igual (controle). Status e envio não mudam.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { linhas } = vi.hoisted(() => ({ linhas: [] as any[] }));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => ({
          in: () => ({
            order: () => ({
              range: () => Promise.resolve({ data: linhas, error: null }),
            }),
          }),
        }),
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(over: { id: string } & Record<string, any>) {
  return {
    customer_name: "Cliente",
    status: "processing",
    payment_status: "recebido_na_entrega",
    shipping: 0,
    tracking_code: null,
    shipping_label_id: null,
    created_at: "2026-09-22T10:00:00Z",
    shipping_option_id: "melhor-envio-3",
    ...over,
  };
}

const RETIRADA = pedido({
  id: "55555555-5555-5555-5555-555555555555",
  customer_name: "Bia Retira",
  shipping_option_id: "store-pickup",
});
const TRANSPORTADORA = pedido({
  id: "66666666-6666-6666-6666-666666666666",
  customer_name: "Caio Envio",
  shipping: 24.9,
});

describe("EtiquetasEnvioCard — pedido de retirada na loja não oferece etiqueta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    linhas.length = 0;
    linhas.push(RETIRADA, TRANSPORTADORA);
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

  async function abrirCard() {
    const { EtiquetasEnvioCard } = await import(
      "@/components/admin/shipping/EtiquetasEnvioCard"
    );
    await act(async () => {
      raiz.render(<EtiquetasEnvioCard />);
    });
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  function selecionarPedido(id: string) {
    const el = document.getElementById(
      "pedido-etiqueta-select",
    ) as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(el, id);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const opcao = (nome: string) =>
    [
      ...hospedeiro.querySelectorAll<HTMLOptionElement>(
        "#pedido-etiqueta-select option",
      ),
    ].find((o) => o.textContent?.includes(nome))?.textContent ?? "";

  const botaoGerar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Gerar etiqueta"),
    ) as HTMLButtonElement;

  it("a lista marca 'retirada na loja — sem etiqueta' (e não 'sem serviço do ME')", async () => {
    await abrirCard();
    expect(opcao("Bia Retira")).toContain("retirada na loja — sem etiqueta");
    expect(opcao("Bia Retira")).not.toMatch(/sem serviço do ME/);
    expect(opcao("Caio Envio")).not.toMatch(/retirada/);
  });

  it("selecionado, o pedido de retirada deixa 'Gerar etiqueta' APAGADO; o de transportadora, aceso (controle)", async () => {
    await abrirCard();
    await act(async () => {
      selecionarPedido(RETIRADA.id);
    });
    expect(botaoGerar().disabled).toBe(true);

    await act(async () => {
      selecionarPedido(TRANSPORTADORA.id);
    });
    expect(botaoGerar().disabled).toBe(false);
  });
});

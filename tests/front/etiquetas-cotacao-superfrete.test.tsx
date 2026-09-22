// @vitest-environment jsdom
//
// SUPERFRETE × ETIQUETA (release 1.5.4, 22/09/2026).
//
// A SuperFrete entra SÓ como cotação: a etiqueta de um pedido cotado por ela
// é feita no site da SuperFrete, fora do app. A tela de etiquetas fala com o
// Melhor Envio — para um id `superfrete-*` ela dizia "sem serviço do ME" e
// deixava "Gerar etiqueta" aceso, convite a comprar no Melhor Envio (com o
// saldo da lojista) uma etiqueta de um frete que foi cotado e cobrado em
// OUTRA transportadora. O que se prova: o rótulo diz de onde veio e que a
// etiqueta é fora do app, e o botão de compra fica apagado; pedido do Melhor
// Envio segue igual (controle).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { linhas, invoke } = vi.hoisted(() => ({
  linhas: [] as any[],
  invoke: vi.fn(),
}));

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
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
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
    payment_status: "pago",
    shipping: 18.61,
    tracking_code: null,
    shipping_label_id: null,
    created_at: "2026-09-22T10:00:00Z",
    shipping_option_id: "melhor-envio-3",
    ...over,
  };
}

const COTADO_SUPERFRETE = pedido({
  id: "77777777-7777-7777-7777-777777777777",
  customer_name: "Dora SuperFrete",
  shipping_option_id: "superfrete-1",
});
const COTADO_ME = pedido({
  id: "88888888-8888-8888-8888-888888888888",
  customer_name: "Eva MelhorEnvio",
});

describe("EtiquetasEnvioCard — pedido cotado pela SuperFrete não oferece etiqueta do Melhor Envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    invoke.mockReset();
    linhas.length = 0;
    linhas.push(COTADO_SUPERFRETE, COTADO_ME);
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

  it("a lista diz 'cotado pela SuperFrete — etiqueta fora do app' (e não 'sem serviço do ME')", async () => {
    await abrirCard();
    expect(opcao("Dora SuperFrete")).toContain(
      "cotado pela SuperFrete — etiqueta fora do app",
    );
    expect(opcao("Dora SuperFrete")).not.toMatch(/sem serviço do ME/);
    expect(opcao("Eva MelhorEnvio")).not.toMatch(/SuperFrete/);
  });

  it("selecionado, o pedido da SuperFrete deixa 'Gerar etiqueta' APAGADO e nada é comprado; o do ME, aceso (controle)", async () => {
    await abrirCard();
    await act(async () => {
      selecionarPedido(COTADO_SUPERFRETE.id);
    });
    expect(botaoGerar().disabled).toBe(true);
    await act(async () => {
      botaoGerar().click();
    });
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      selecionarPedido(COTADO_ME.id);
    });
    expect(botaoGerar().disabled).toBe(false);
  });
});

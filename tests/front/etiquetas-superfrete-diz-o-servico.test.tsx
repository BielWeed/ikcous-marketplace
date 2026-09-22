// @vitest-environment jsdom
//
// SUPERFRETE × ETIQUETA — o SERVIÇO que a cliente pagou (release 1.5.6).
//
// Na 1.5.6 a "Entrega econômica" da SuperFrete passou a ser o PAC OU o Mini
// Envios, o que sair mais barato — e a cliente só vê "Entrega econômica".
// A lojista compra a etiqueta no site da SuperFrete: se ela comprar PAC
// (R$ 25,31) para um pedido em que a cliente pagou o Mini (R$ 19,01), perde
// a diferença. O que se prova: na lista de etiquetas, o pedido cotado pela
// SuperFrete diz QUAL serviço foi pago, pelo id que a RPC validou
// (`superfrete-17` = Mini Envios, `superfrete-1` = PAC, `superfrete-2` =
// SEDEX, `superfrete-3` = Jadlog); id sem nome conhecido mantém o rótulo de
// antes, sem inventar serviço.
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

function pedido(id: string, cliente: string, opcao: string) {
  return {
    id,
    customer_name: cliente,
    status: "processing",
    payment_status: "pago",
    shipping: 19.01,
    tracking_code: null,
    shipping_label_id: null,
    created_at: "2026-09-22T10:00:00Z",
    shipping_option_id: opcao,
  };
}

describe("EtiquetasEnvioCard — pedido da SuperFrete diz o serviço pago (1.5.6)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    invoke.mockReset();
    linhas.length = 0;
    linhas.push(
      pedido(
        "11111111-1111-1111-1111-111111111111",
        "Ana Mini",
        "superfrete-17",
      ),
      pedido("22222222-2222-2222-2222-222222222222", "Bia Pac", "superfrete-1"),
      pedido(
        "33333333-3333-3333-3333-333333333333",
        "Cid Sedex",
        "superfrete-2",
      ),
      pedido(
        "44444444-4444-4444-4444-444444444444",
        "Duda Jadlog",
        "superfrete-3",
      ),
      pedido(
        "55555555-5555-5555-5555-555555555555",
        "Eli Loggi",
        "superfrete-31",
      ),
    );
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

  const opcao = (nome: string) =>
    [
      ...hospedeiro.querySelectorAll<HTMLOptionElement>(
        "#pedido-etiqueta-select option",
      ),
    ].find((o) => o.textContent?.includes(nome))?.textContent ?? "";

  it("superfrete-17 diz Mini Envios e superfrete-1 diz PAC — nunca só 'Entrega econômica'", async () => {
    await abrirCard();
    expect(opcao("Ana Mini")).toContain(
      "cotado pela SuperFrete · Mini Envios — etiqueta fora do app",
    );
    expect(opcao("Ana Mini")).not.toMatch(/\bPAC\b/);
    expect(opcao("Bia Pac")).toContain(
      "cotado pela SuperFrete · PAC — etiqueta fora do app",
    );
    expect(opcao("Bia Pac")).not.toMatch(/Mini/);
  });

  it("SEDEX e Jadlog também dizem o serviço; id sem nome conhecido fica com o rótulo de antes", async () => {
    await abrirCard();
    expect(opcao("Cid Sedex")).toContain(
      "cotado pela SuperFrete · SEDEX — etiqueta fora do app",
    );
    expect(opcao("Duda Jadlog")).toContain(
      "cotado pela SuperFrete · Jadlog — etiqueta fora do app",
    );
    expect(opcao("Eli Loggi")).toContain(
      "cotado pela SuperFrete — etiqueta fora do app",
    );
  });
});

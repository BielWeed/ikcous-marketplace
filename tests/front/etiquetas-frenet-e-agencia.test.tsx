// @vitest-environment jsdom
//
// CONTRATO-1.5.7.md A7/R1-6 — EtiquetasEnvioCard:
//   1. `frenet-*` é "etiqueta fora do app" (mesma régua já aplicada a
//      `superfrete-*` desde a 1.5.4), com o nome da transportadora/serviço
//      quando o pedido tiver a nota do checkout, senão o código cru;
//   2. regex ÚNICA `^melhor-envio-(\d+)(-ss)?$` (R1-6) — o sufixo `-ss` não
//      quebra a extração do id numérico nem o rótulo "sem serviço do ME";
//   3. ids que exigem agência (12, 15, 16, 22) mostram o aviso e desabilitam
//      "Gerar etiqueta" ANTES do clique — mesma lista e mesmo texto da edge
//      `melhor-envio-etiqueta` (IDS_QUE_EXIGEM_AGENCIA_DE_COLETA).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pedidos } = vi.hoisted(() => ({
  pedidos: { linhas: [] as any[] },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "marketplace_orders") {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      const consulta: any = Object.assign(
        Promise.resolve({ data: pedidos.linhas, error: null }),
        {
          in: () => consulta,
          order: () => consulta,
          range: () => Promise.resolve({ data: pedidos.linhas, error: null }),
        },
      );
      return { select: () => consulta };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function pedidoBase(overrides: Record<string, unknown>) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    customer_name: "Cliente Teste",
    status: "processing",
    payment_status: "pago",
    shipping: 25.9,
    tracking_code: null,
    shipping_label_id: null,
    notes: null,
    created_at: new Date().toISOString(),
    shipping_option_id: null,
    ...overrides,
  };
}

describe("EtiquetasEnvioCard — Frenet fora do app e ids que exigem agência (1.5.7 v2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    pedidos.linhas = [];
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

  async function abrir() {
    const { EtiquetasEnvioCard } = await import(
      "@/components/admin/shipping/EtiquetasEnvioCard"
    );
    await act(async () => {
      raiz.render(<EtiquetasEnvioCard />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function selecionarPedido(id: string) {
    const select = hospedeiro.querySelector(
      "#pedido-etiqueta-select",
    ) as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(select, id);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("frenet-* SEM nota: rótulo mostra o código e 'etiqueta fora do app'", async () => {
    pedidos.linhas = [
      pedidoBase({ shipping_option_id: "frenet-EXP01", notes: null }),
    ];
    await abrir();
    const select = hospedeiro.querySelector(
      "#pedido-etiqueta-select",
    ) as HTMLSelectElement;
    expect(select.textContent).toMatch(
      /cotado pela Frenet · EXP01 — etiqueta fora do app/,
    );
  });

  it("frenet-* COM nota do checkout: usa o nome 'Transportadora — Serviço' da nota", async () => {
    pedidos.linhas = [
      pedidoBase({
        shipping_option_id: "frenet-EXP01",
        notes: "Frete Escolhido: Jamef — Rodoviário (Prazo: 5 dias)",
      }),
    ];
    await abrir();
    const select = hospedeiro.querySelector(
      "#pedido-etiqueta-select",
    ) as HTMLSelectElement;
    expect(select.textContent).toMatch(
      /cotado pela Frenet · Jamef — Rodoviário — etiqueta fora do app/,
    );
  });

  it("'Gerar etiqueta' fica desabilitado para pedido frenet-*", async () => {
    pedidos.linhas = [pedidoBase({ shipping_option_id: "frenet-EXP01" })];
    await abrir();
    await act(async () => {
      selecionarPedido(pedidos.linhas[0].id);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    const gerar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /Gerar etiqueta/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    expect(gerar.disabled).toBe(true);
  });

  it("regex única com sufixo -ss: melhor-envio-31-ss ainda é reconhecido como opção do ME", async () => {
    pedidos.linhas = [pedidoBase({ shipping_option_id: "melhor-envio-31-ss" })];
    await abrir();
    const select = hospedeiro.querySelector(
      "#pedido-etiqueta-select",
    ) as HTMLSelectElement;
    expect(select.textContent).not.toMatch(/sem serviço do ME/);
  });

  it("ids que exigem agência (12, 15, 16, 22): aviso na tela e botão desabilitado", async () => {
    pedidos.linhas = [pedidoBase({ shipping_option_id: "melhor-envio-12" })];
    await abrir();
    await act(async () => {
      selecionarPedido(pedidos.linhas[0].id);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(hospedeiro.textContent).toContain(
      "Esta transportadora exige agência de coleta — gere esta etiqueta no site do Melhor Envio.",
    );
    const gerar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /Gerar etiqueta/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    expect(gerar.disabled).toBe(true);
  });

  it("controle: id do ME que NÃO exige agência (1) fica habilitado e sem aviso", async () => {
    pedidos.linhas = [pedidoBase({ shipping_option_id: "melhor-envio-1" })];
    await abrir();
    await act(async () => {
      selecionarPedido(pedidos.linhas[0].id);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(hospedeiro.textContent).not.toContain("exige agência de coleta");
    const gerar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /Gerar etiqueta/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    expect(gerar.disabled).toBe(false);
  });

  it("superfrete-* continua etiqueta fora do app (regressão 1.5.4/1.5.6, agora com nota)", async () => {
    pedidos.linhas = [
      pedidoBase({
        shipping_option_id: "superfrete-31",
        notes: "Frete Escolhido: Correios — SEDEX (Prazo: 2 dias)",
      }),
    ];
    await abrir();
    const select = hospedeiro.querySelector(
      "#pedido-etiqueta-select",
    ) as HTMLSelectElement;
    expect(select.textContent).toMatch(
      /cotado pela SuperFrete · Correios — SEDEX — etiqueta fora do app/,
    );
  });
});

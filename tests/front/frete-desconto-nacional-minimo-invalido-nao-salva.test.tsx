// @vitest-environment jsdom
import type { StoreConfig } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loja, updateConfig, sucesso } = vi.hoisted(() => ({
  loja: { atual: {} as StoreConfig },
  updateConfig: vi.fn(),
  sucesso: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: loja.atual, isLoaded: true, updateConfig }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    functions: {
      invoke: vi.fn().mockResolvedValue({
        data: {
          success: true,
          modo: "multi",
          ligados: ["melhor_envio"],
          provedores: {
            melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
          },
        },
        error: null,
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: sucesso, error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Pedido mínimo do desconto nacional — inválido nunca vira sem mínimo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loja.atual = {
      freeShippingMin: 0,
      shippingCoverage: "national",
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"],
      localDeliveryEnabled: true,
      localDeliveryFee: 10,
      localCepRange: "",
      formasPagamentoEntrega: ["pix"],
      nationalShippingStrategy: "desconto_na_mais_barata",
      nationalShippingMin: 100,
      nationalDiscountType: "fixo",
      nationalDiscountValue: 15,
      nationalBenefitScope: "mais_barata",
    } as StoreConfig;
    updateConfig.mockResolvedValue(true);
    Element.prototype.scrollIntoView = vi.fn();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
  }

  function minimo() {
    const campo = hospedeiro.querySelector<HTMLInputElement>(
      "#frete-nacional-minimo",
    );
    if (!campo) throw new Error("Pedido mínimo ausente");
    return campo;
  }

  async function digitar(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(minimo(), texto);
      minimo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function salvar() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^(Salvo|Salvar|Salvando…|Tentar de novo)$/.test(
        b.textContent?.trim() ?? "",
      ),
    );
    if (!botao) throw new Error("Salvar ausente");
    return botao;
  }

  it.each(["-100", "não é dinheiro", "NaN", "Infinity"])(
    "%s fica visível, avisa no campo e não grava zero",
    async (texto) => {
      await montar();
      await digitar(texto);
      expect(minimo().value).toBe(texto);
      expect(minimo().getAttribute("aria-invalid")).toBe("true");
      const aviso = document.getElementById(
        minimo().getAttribute("aria-describedby") ?? "",
      );
      expect(aviso?.textContent).toContain("Informe um pedido mínimo válido");
      await act(async () => salvar().click());
      expect(salvar().disabled).toBe(true);
      expect(updateConfig).not.toHaveBeenCalled();
      expect(sucesso).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["", 0],
    ["0", 0],
    ["0,01", 0.01],
    ["150,50", 150.5],
    ["1.500", 1500],
    ["1.500,00", 1500],
    ["R$ 1500", 1500],
  ])("%s salva explicitamente como %s reais", async (texto, esperado) => {
    await montar();
    await digitar(texto);
    expect(minimo().getAttribute("aria-invalid")).toBe("false");
    await act(async () => salvar().click());
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ nationalShippingMin: esperado }),
      { silentSuccess: true },
    );
  });

  it("corrigir o texto inválido libera o Salvar sem apagar o mínimo", async () => {
    await montar();
    await digitar("inválido");
    await digitar("250,50");
    expect(minimo().value).toBe("250,50");
    expect(minimo().getAttribute("aria-invalid")).toBe("false");
    expect(salvar().disabled).toBe(false);
    await act(async () => salvar().click());
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ nationalShippingMin: 250.5 }),
      { silentSuccess: true },
    );
  });
});

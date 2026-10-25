import type { StoreConfig } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loja, updateConfig, onSetDirty } = vi.hoisted(() => ({
  loja: { atual: {} as StoreConfig },
  updateConfig: vi.fn(),
  onSetDirty: vi.fn(),
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
      invoke: vi
        .fn()
        .mockResolvedValue({ data: { success: false }, error: null }),
    },
  },
}));
const { toastErro } = vi.hoisted(() => ({ toastErro: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastErro } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Frete — valor da entrega negativo avisa em vez de virar grátis", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loja.atual = {
      freeShippingMin: 0,
      freeShippingCardStyle: "completo",
      shippingFee: 15,
      whatsappNumber: "",
      shareText: "",
      businessHours: "",
      enableReviews: true,
      enableCoupons: true,
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"],
      shippingCoverage: "national",
      localDeliveryFee: 10,
      localDeliveryDays: 1,
      localDeliveryEnabled: true,
      localCepRange: "",
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 100,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
      formasPagamentoEntrega: ["pix", "card", "cash"],
    };
    updateConfig.mockResolvedValue(true);
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
      raiz.render(<AdminShippingView active={true} onSetDirty={onSetDirty} />);
    });
  }

  function campo(id: string) {
    const input = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) throw new Error(`Campo ausente: ${id}`);
    return input;
  }

  async function digitar(id: string, texto: string) {
    const input = campo(id);
    expect(input.disabled).toBe(false);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, texto);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function botaoSalvar() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^(Salvo|Salvar|Salvando…|Tentar de novo)$/.test(
        b.textContent?.trim() ?? "",
      ),
    );
    if (!botao) throw new Error("Botão Salvar ausente");
    return botao;
  }

  it("-3 no valor da entrega avisa e NÃO salva (antes gravava 0 = grátis)", async () => {
    await montar();
    await digitar("local-delivery-fee", "-3");
    await act(async () => botaoSalvar().click());

    expect(toastErro).toHaveBeenCalledWith(
      "O valor da entrega não pode ser negativo.",
      expect.objectContaining({
        description: expect.stringContaining("Digite 0 ou mais"),
      }),
    );
    expect(updateConfig).not.toHaveBeenCalled();
    expect(botaoSalvar().textContent).not.toContain("Salvando");
  });

  it.each([
    ["15", 15],
    ["0", 0],
  ])("%s no valor da entrega salva normalmente", async (texto, esperado) => {
    await montar();
    await digitar("local-delivery-fee", texto);
    await act(async () => botaoSalvar().click());

    expect(toastErro).not.toHaveBeenCalled();
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localDeliveryFee: esperado }),
    );
  });
});

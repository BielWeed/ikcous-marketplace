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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Frete — resposta do salvar preserva a edição posterior", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let confirmar: () => void;

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
    confirmar = () => {
      throw new Error("Nenhum salvamento pendente");
    };
    updateConfig.mockImplementation(
      (enviado: Partial<StoreConfig>) =>
        new Promise<boolean>((resolve) => {
          confirmar = () => {
            loja.atual = { ...loja.atual, ...enviado };
            resolve(true);
          };
        }),
    );
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

  it.each([
    ["frete-nacional-minimo", "150", "200", "nationalShippingMin", 150],
    ["frete-nacional-minimo", "150", "100", "nationalShippingMin", 150],
    ["local-delivery-fee", "15", "20", "localDeliveryFee", 15],
    ["local-delivery-fee", "15", "10", "localDeliveryFee", 15],
    ["local-delivery-days", "2", "3", "localDeliveryDays", 2],
  ] as const)(
    "mantém %s editado durante o salvamento e a guarda de saída",
    async (id, enviado, novo, chave, salvo) => {
      await montar();
      await digitar(id, enviado);
      await act(async () => botaoSalvar().click());
      expect(botaoSalvar().textContent).toContain("Salvando");
      await digitar(id, novo);
      await act(async () => confirmar());

      expect(loja.atual).toHaveProperty(chave, salvo);
      expect(campo(id).value).toBe(novo);
      expect(botaoSalvar().textContent?.trim()).toBe("Salvar");
      expect(botaoSalvar().disabled).toBe(false);
      expect(onSetDirty).toHaveBeenLastCalledWith(true);
    },
  );

  it("normaliza os campos nacionais enviados quando não houve nova edição", async () => {
    await montar();
    const sempre = [
      ...hospedeiro.querySelectorAll(
        '#bloco-estrategia-nacional [role="radio"]',
      ),
    ].find((radio) => /Sempre grátis/.test(radio.textContent ?? ""));
    expect(sempre).toBeTruthy();
    await act(async () => (sempre as HTMLElement).click());
    await act(async () => botaoSalvar().click());
    await act(async () => confirmar());

    expect(loja.atual.nationalShippingMin).toBe(0);
    expect(botaoSalvar().textContent?.trim()).toBe("Salvo");
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });
});

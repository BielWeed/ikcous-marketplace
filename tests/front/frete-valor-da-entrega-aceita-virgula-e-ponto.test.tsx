// @vitest-environment jsdom
//
// Caça 10, itens 6 e 8 (lote 228): o valor da entrega local é um campo de
// TEXTO que entende "7,50", "7.50" e "1.234,50" (o Safari do iPhone devolvia
// vazio para o que não entendia como número, e vazio vira 0 = entrega grátis,
// sem aviso). Texto que não é dinheiro NÃO vira grátis: avisa e não salva. O
// que vai para o banco sai arredondado para centavos.
import type { StoreConfig } from "@/types";
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

describe("Frete — valor da entrega local aceita vírgula e ponto e nunca vira grátis por engano", () => {
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

  it("o campo é de texto com teclado decimal (não number: o iPhone devolvia vazio)", async () => {
    await montar();
    const campoValor = campo("local-delivery-fee");
    expect(campoValor.type).toBe("text");
    expect(campoValor.inputMode).toBe("decimal");
  });

  it.each([
    ["7,50", 7.5],
    ["7.50", 7.5],
    ["1.234,50", 1234.5],
    ["12", 12],
    ["0,5", 0.5],
  ])("%s salva %s", async (texto, esperado) => {
    await montar();
    await digitar("local-delivery-fee", texto);
    await act(async () => botaoSalvar().click());

    expect(toastErro).not.toHaveBeenCalled();
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localDeliveryFee: esperado }),
    );
  });

  it("campo apagado continua sendo entrega grátis (a dica do campo diz isso)", async () => {
    await montar();
    await digitar("local-delivery-fee", "");
    await act(async () => botaoSalvar().click());

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localDeliveryFee: 0 }),
    );
  });

  it.each(["abc", "7,5,0", "7,555", "R$ ?", "7,5x"])(
    "%s não é dinheiro: avisa, NÃO salva e não grava 0",
    async (texto) => {
      await montar();
      await digitar("local-delivery-fee", texto);

      // O aviso aparece no próprio campo, antes de salvar.
      expect(
        hospedeiro.querySelector("#erro-valor-da-entrega")?.textContent,
      ).toContain("Escreva só números");
      expect(campo("local-delivery-fee").getAttribute("aria-invalid")).toBe(
        "true",
      );

      await act(async () => botaoSalvar().click());

      expect(toastErro).toHaveBeenCalledWith(
        "Confira o valor da entrega.",
        expect.objectContaining({
          description: expect.stringContaining("7,50"),
        }),
      );
      expect(updateConfig).not.toHaveBeenCalled();
    },
  );

  it("corrigir o texto depois do aviso volta a salvar", async () => {
    await montar();
    await digitar("local-delivery-fee", "abc");
    await digitar("local-delivery-fee", "9,90");

    expect(hospedeiro.querySelector("#erro-valor-da-entrega")).toBeNull();
    await act(async () => botaoSalvar().click());

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localDeliveryFee: 9.9 }),
    );
  });

  it("valor com fração de centavo que já estava na loja sai arredondado para centavos", async () => {
    loja.atual = { ...loja.atual, localDeliveryFee: 7.556 };
    await montar();
    // Outro campo mexido só para o formulário ficar sujo e o Salvar habilitar.
    await digitar("local-delivery-days", "2");
    await act(async () => botaoSalvar().click());

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localDeliveryFee: 7.56 }),
    );
  });

  it('o texto digitado não é reescrito sob o dedo ("7," continua "7,")', async () => {
    await montar();
    await digitar("local-delivery-fee", "7,");
    expect(campo("local-delivery-fee").value).toBe("7,");
  });

  it("o valor já salvo aparece no campo com vírgula", async () => {
    loja.atual = { ...loja.atual, localDeliveryFee: 12.5 };
    await montar();
    expect(campo("local-delivery-fee").value).toBe("12,5");
  });
});

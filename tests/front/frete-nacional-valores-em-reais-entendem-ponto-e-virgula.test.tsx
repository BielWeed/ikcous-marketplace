// @vitest-environment jsdom
// Frete nacional: o mínimo do frete grátis ("A partir de") e o desconto em
// R$ leem dinheiro como a lojista escreve no Brasil. "1.234" é mil duzentos e
// trinta e quatro (não R$ 1,23) e "1.234,50" é aceito. Texto que não é
// dinheiro avisa e não salva; vazio segue sendo zero; o percentual continua
// inteiro simples.
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

const BASE = {
  freeShippingMin: 0,
  shippingCoverage: "national",
  originCep: "38400-000",
  enabledShippingMethods: ["sedex", "pac"],
  localDeliveryEnabled: true,
  localDeliveryFee: 10,
  localCepRange: "",
  formasPagamentoEntrega: ["pix"],
  nationalBenefitScope: "mais_barata",
} as const;

describe("Frete nacional — valores em reais com ponto e vírgula", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function montar(config: Partial<StoreConfig>) {
    loja.atual = { ...BASE, ...config } as StoreConfig;
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
  }

  function campo(id: string) {
    const el = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
    if (!el) throw new Error(`${id} ausente`);
    return el;
  }

  async function digitar(id: string, texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo(id), texto);
      campo(id).dispatchEvent(new Event("input", { bubbles: true }));
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

  function aviso(id: string) {
    const ref = campo(id).getAttribute("aria-describedby");
    return ref ? document.getElementById(ref)?.textContent : undefined;
  }

  describe("mínimo do frete grátis (A partir de)", () => {
    const frete = {
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 100,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
    } as const;

    it.each([
      ["1.234", 1234],
      ["1.234,50", 1234.5],
      ["1234,5", 1234.5],
      ["R$ 1.500", 1500],
      ["199", 199],
      ["79,90", 79.9],
    ])(
      "%s vira %s reais e o campo mostra o que ela escreveu",
      async (texto, esperado) => {
        await montar(frete);
        await digitar("frete-nacional-minimo", texto);
        expect(campo("frete-nacional-minimo").value).toBe(texto);
        expect(
          campo("frete-nacional-minimo").getAttribute("aria-invalid"),
        ).toBe("false");
        await act(async () => salvar().click());
        expect(updateConfig).toHaveBeenCalledWith(
          expect.objectContaining({ nationalShippingMin: esperado }),
          { silentSuccess: true },
        );
      },
    );

    it.each(["1.2.3", "abc", "12,345", "1,2,3"])(
      "%s avisa no campo e não vira valor",
      async (texto) => {
        await montar(frete);
        await digitar("frete-nacional-minimo", texto);
        expect(campo("frete-nacional-minimo").value).toBe(texto);
        expect(
          campo("frete-nacional-minimo").getAttribute("aria-invalid"),
        ).toBe("true");
        expect(aviso("frete-nacional-minimo")).toContain(
          "Escreva o valor em reais",
        );
        expect(salvar().disabled).toBe(true);
        await act(async () => salvar().click());
        expect(updateConfig).not.toHaveBeenCalled();
      },
    );

    it("campo vazio continua valendo zero (sem frete grátis por valor: não salva)", async () => {
      await montar(frete);
      await digitar("frete-nacional-minimo", "");
      expect(salvar().disabled).toBe(true);
      await act(async () => salvar().click());
      expect(updateConfig).not.toHaveBeenCalled();
    });

    it("corrigir o texto inválido libera o Salvar", async () => {
      await montar(frete);
      await digitar("frete-nacional-minimo", "1.2.3");
      await digitar("frete-nacional-minimo", "1.234,50");
      expect(aviso("frete-nacional-minimo")).toBeUndefined();
      expect(salvar().disabled).toBe(false);
    });

    it("o valor salvo aparece de volta no campo, com teclado decimal", async () => {
      await montar(frete);
      expect(campo("frete-nacional-minimo").value).toBe("100");
      expect(campo("frete-nacional-minimo").getAttribute("inputmode")).toBe(
        "decimal",
      );
    });
  });

  describe("desconto em R$", () => {
    const desconto = {
      nationalShippingStrategy: "desconto_na_mais_barata",
      nationalShippingMin: 100,
      nationalDiscountType: "fixo",
      nationalDiscountValue: 15,
    } as const;

    it.each([
      ["1.234,50", 1234.5],
      ["1.234", 1234],
      ["7,5", 7.5],
      ["5", 5],
    ])(
      "%s vira %s reais e o campo mostra o que ela escreveu",
      async (texto, esperado) => {
        await montar(desconto);
        await digitar("frete-nacional-valor-desconto", texto);
        expect(campo("frete-nacional-valor-desconto").value).toBe(texto);
        expect(
          campo("frete-nacional-valor-desconto").getAttribute("aria-invalid"),
        ).toBe("false");
        await act(async () => salvar().click());
        expect(updateConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            nationalDiscountType: "fixo",
            nationalDiscountValue: esperado,
          }),
          { silentSuccess: true },
        );
      },
    );

    it.each(["1.2.3", "abc", "5,555"])(
      "%s avisa no campo e não vira valor",
      async (texto) => {
        await montar(desconto);
        await digitar("frete-nacional-valor-desconto", texto);
        expect(campo("frete-nacional-valor-desconto").value).toBe(texto);
        expect(
          campo("frete-nacional-valor-desconto").getAttribute("aria-invalid"),
        ).toBe("true");
        expect(aviso("frete-nacional-valor-desconto")).toContain(
          "Escreva o valor do desconto em reais",
        );
        expect(salvar().disabled).toBe(true);
        await act(async () => salvar().click());
        expect(updateConfig).not.toHaveBeenCalled();
      },
    );

    it("a prévia continua recebendo número: 1.234,50 não vira prévia quebrada", async () => {
      await montar(desconto);
      await digitar("frete-nacional-valor-desconto", "5,5");
      // R$ 24,90 com R$ 5,50 de desconto.
      expect(hospedeiro.textContent).toContain("R$ 19,40");
      await digitar("frete-nacional-valor-desconto", "abc");
      expect(hospedeiro.textContent).not.toContain("NaN");
      expect(hospedeiro.textContent).not.toContain("Prévia (exemplo)");
    });
  });

  describe("desconto percentual", () => {
    const percentual = {
      nationalShippingStrategy: "desconto_na_mais_barata",
      nationalShippingMin: 0,
      nationalDiscountType: "percentual",
      nationalDiscountValue: 10,
    } as const;

    it("segue inteiro simples, teclado numérico", async () => {
      await montar(percentual);
      const el = campo("frete-nacional-valor-desconto");
      expect(el.getAttribute("inputmode")).toBe("numeric");
      expect(el.type).toBe("number");
      await digitar("frete-nacional-valor-desconto", "15");
      await act(async () => salvar().click());
      expect(updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          nationalDiscountType: "percentual",
          nationalDiscountValue: 15,
        }),
        { silentSuccess: true },
      );
    });

    it("acima de 100 continua bloqueando o Salvar", async () => {
      await montar(percentual);
      await digitar("frete-nacional-valor-desconto", "150");
      expect(salvar().disabled).toBe(true);
    });
  });
});

// @vitest-environment jsdom
//
// Loja em "Só retirada" e sem transportadora não entrega em lugar nenhum — mas
// a regra de frete grátis salva antes (ex.: "acima de R$ 150") não é apagada ao
// trocar o modo, e a Home dizia "Falta pouquinho pro Frete Grátis na Cidade!"
// e "Adicione mais R$ X", e o lembrete do carrinho "Faltam R$ X para o Frete
// Grátis", para uma entrega que a loja não faz (a retirada já é grátis).
//
// O que este arquivo prende:
//   1. só retirada + sem transportadora: nenhum aviso de meta (Home/carrinho)
//      e o lembrete só conta os itens;
//   2. "sem transportadora" = cobertura só local OU lista sem chave de
//      transportadora; com transportadora ligada o aviso de antes continua;
//   3. quem entrega na cidade (entrego / entrego e retiro) não muda nada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  total: 100,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.total }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [{ product: { id: "p1" }, quantity: 1 }],
    cartCount: 1,
    cartTotal: estado.total,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replaceAll(String.fromCharCode(160), " ").replace(/\s+/g, " ");

const SO_RETIRO_SEM_TRANSPORTADORA = {
  freeShippingMin: 150,
  localDeliveryEnabled: false,
  shippingCoverage: "local",
  enabledShippingMethods: ["store-pickup"],
};

describe("frete grátis — loja só com retirada não anuncia meta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.config = { ...SO_RETIRO_SEM_TRANSPORTADORA };
    estado.total = 100;
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

  async function aviso(estilo?: string) {
    if (estilo) estado.config = { ...estado.config, freeShippingCardStyle: estilo };
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(<FreeShippingBlock />);
    });
    return normalizar(hospedeiro.textContent);
  }

  async function lembrete() {
    const { CartReminder } = await import(
      "@/components/ui/custom/CartReminder"
    );
    await act(async () => {
      raiz.render(<CartReminder docked onAction={() => {}} />);
    });
    // Modo acoplado: o lembrete aparece 500 ms depois de haver item.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    return normalizar(hospedeiro.textContent);
  }

  describe("AvisoDeFreteGratis (Home e carrinho)", () => {
    it("só retirada + cobertura local: nada de meta, nem 'faltam R$ X'", async () => {
      const texto = await aviso();
      expect(hospedeiro.innerHTML).toBe("");
      expect(texto).toBe("");
    });

    it.each(["compacto", "premium"])(
      "estilo %s: também não aparece",
      async (estilo) => {
        expect(await aviso(estilo)).toBe("");
      },
    );

    it("preset 'sempre grátis' (R$ 0,01) também não vira 'frete grátis na cidade'", async () => {
      estado.config = { ...estado.config, freeShippingMin: 0.01 };
      expect(await aviso()).toBe("");
    });

    it("só retirada com lista SEM chave de transportadora (cobertura nacional): não aparece", async () => {
      estado.config = {
        ...estado.config,
        shippingCoverage: "national",
        enabledShippingMethods: ["store-pickup"],
      };
      expect(await aviso()).toBe("");
    });

    it("só retirada COM transportadora ligada: o aviso de antes continua", async () => {
      estado.config = {
        ...estado.config,
        shippingCoverage: "national",
        enabledShippingMethods: ["sedex", "pac", "store-pickup"],
      };
      const texto = await aviso();
      expect(texto).toContain("R$ 50,00");
      expect(texto).toContain("Falta pouquinho");
    });

    it.each([
      ["entrego", ["sedex"]],
      ["entrego e retiro", ["sedex", "store-pickup"]],
    ])("modo '%s' (entrega na cidade): o aviso de antes continua", async (_n, metodos) => {
      estado.config = {
        ...estado.config,
        localDeliveryEnabled: true,
        shippingCoverage: "local",
        enabledShippingMethods: metodos,
      };
      const texto = await aviso();
      expect(texto).toContain("R$ 50,00");
      expect(texto).toContain("Falta pouquinho");
    });
  });

  describe("CartReminder (lembrete flutuante)", () => {
    it("só retirada sem transportadora: só conta os itens, sem 'Faltam R$ X'", async () => {
      const texto = await lembrete();
      expect(texto).toContain("1 item no seu carrinho");
      expect(texto).not.toContain("Faltam");
      expect(texto).not.toContain("Frete Gr");
    });

    it("preset 'sempre grátis' sem entrega: também não diz 'frete grátis em toda a loja'", async () => {
      estado.config = { ...estado.config, freeShippingMin: 0.01 };
      const texto = await lembrete();
      expect(texto).toContain("1 item no seu carrinho");
      expect(texto).not.toMatch(/frete gr/i);
    });

    it("entrega na cidade ligada: 'Faltam R$ 50,00 para o Frete Grátis' continua", async () => {
      estado.config = {
        ...estado.config,
        localDeliveryEnabled: true,
        enabledShippingMethods: ["sedex", "store-pickup"],
      };
      const texto = await lembrete();
      expect(texto).toContain("Faltam R$ 50,00");
    });
  });
});

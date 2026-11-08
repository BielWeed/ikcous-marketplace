// @vitest-environment jsdom
//
// Loja em "Só retirada" que mantém uma transportadora para quem é de fora, com
// a regra de frete grátis "na sua região" que sobrou de antes (ex.: grátis
// acima de R$ 150). Não existe entrega local nessa loja: quem é da cidade só
// retira, e a retirada já é grátis. Mesmo assim a Home dizia "Frete grátis na
// cidade ... A partir de R$ 150, na entrega local" e o selo dos produtos
// "Frete grátis na cidade".
//
// O que este arquivo prende:
//   1. `promessasDeFrete`: sem entrega na cidade, a promessa LOCAL é nenhuma,
//      mas a nacional (a da transportadora) segue como a loja configurou;
//   2. o selo dos produtos não usa a regra local sobrada (a barra do CARRINHO
//      é provada com a tela de verdade em
//      frete-gratis-so-retirada-carrinho-sem-meta-na-cidade.test.tsx);
//   3. a Home e o lembrete do carrinho não anunciam "na cidade" nem "entrega
//      local" nessa loja;
//   4. quem entrega na cidade (entrego / entrego e retiro) não muda nada.
import {
  fraseDoSeloDeFreteGratis,
  promessasDeFrete,
} from "@/lib/estrategias-de-frete";
import type { ConfigDeFrete } from "@/lib/estrategias-de-frete";
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

/** Só retirada + transportadora ligada + nacional desligada + regra local sobrada. */
const SO_RETIRADA_COM_TRANSPORTADORA = {
  freeShippingMin: 150,
  localDeliveryEnabled: false,
  shippingCoverage: "national",
  enabledShippingMethods: ["sedex", "store-pickup"],
  nationalShippingStrategy: "desligado",
  nationalShippingMin: 0,
  nationalDiscountType: null,
  nationalDiscountValue: 0,
  nationalBenefitScope: "mais_barata",
} as const satisfies ConfigDeFrete;

describe("promessasDeFrete — só retirada com transportadora", () => {
  it("a regra local que sobrou não vira promessa de entrega na cidade", () => {
    const promessas = promessasDeFrete(SO_RETIRADA_COM_TRANSPORTADORA);
    expect(promessas.local).toEqual({ estrategia: "desligado", minimo: 0 });
    expect(promessas.nacional.estrategia).toBe("desligado");
  });

  it("a promessa da transportadora continua a que a loja configurou", () => {
    const promessas = promessasDeFrete({
      ...SO_RETIRADA_COM_TRANSPORTADORA,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 200,
    });
    expect(promessas.local.estrategia).toBe("desligado");
    expect(promessas.nacional).toEqual({
      estrategia: "acima_de_valor",
      minimo: 200,
    });
  });

  it("transportadora com a MESMA regra (legado sem colunas nacionais): a regra local segue, só não diz 'na cidade'", () => {
    const { nationalShippingStrategy: _a, ...semNacional } =
      SO_RETIRADA_COM_TRANSPORTADORA;
    const promessas = promessasDeFrete(semNacional as unknown as ConfigDeFrete);
    expect(promessas.iguais).toBe(true);
    expect(promessas.local).toEqual({
      estrategia: "acima_de_valor",
      minimo: 150,
    });
  });

  it("selo: 'sempre grátis' sobrado não vira 'Frete grátis na cidade'", () => {
    const promessas = promessasDeFrete({
      ...SO_RETIRADA_COM_TRANSPORTADORA,
      freeShippingMin: 0.01,
    });
    expect(fraseDoSeloDeFreteGratis(promessas, false)).toBeNull();
  });

  it("selo: com a transportadora grátis, só o Brasil é prometido (não a cidade)", () => {
    const promessas = promessasDeFrete({
      ...SO_RETIRADA_COM_TRANSPORTADORA,
      nationalShippingStrategy: "sempre",
    });
    expect(fraseDoSeloDeFreteGratis(promessas, false)).toBe(
      "Frete grátis para todo o Brasil",
    );
  });

  it.each([
    ["entrego", ["sedex"]],
    ["entrego e retiro", ["sedex", "store-pickup"]],
  ])("modo '%s': a promessa local segue valendo", (_nome, metodos) => {
    const promessas = promessasDeFrete({
      ...SO_RETIRADA_COM_TRANSPORTADORA,
      localDeliveryEnabled: true,
      enabledShippingMethods: metodos,
    });
    expect(promessas.local).toEqual({
      estrategia: "acima_de_valor",
      minimo: 150,
    });
  });
});

describe("Home — só retirada com transportadora não anuncia entrega local", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.config = { ...SO_RETIRADA_COM_TRANSPORTADORA };
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
    if (estilo)
      estado.config = { ...estado.config, freeShippingCardStyle: estilo };
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(<FreeShippingBlock />);
    });
    return normalizar(hospedeiro.textContent);
  }

  it("carrinho com R$ 100 de R$ 150: nada de 'na cidade' nem 'Faltam R$ 50'", async () => {
    expect(await aviso()).toBe("");
  });

  it.each(["compacto", "premium"])(
    "estilo %s: também não aparece",
    async (e) => {
      expect(await aviso(e)).toBe("");
    },
  );

  it("carrinho vazio: não promete 'na entrega local'", async () => {
    estado.total = 0;
    expect(await aviso()).toBe("");
  });

  it("'sempre grátis' sobrado também não vira 'Frete grátis na cidade'", async () => {
    estado.config = { ...estado.config, freeShippingMin: 0.01 };
    expect(await aviso()).toBe("");
  });

  it("modo 'entrego': o aviso 'na cidade' continua", async () => {
    estado.config = {
      ...estado.config,
      localDeliveryEnabled: true,
      enabledShippingMethods: ["sedex"],
    };
    const texto = await aviso();
    expect(texto).toContain("Falta pouquinho");
    expect(texto).toContain("R$ 50,00");
    expect(texto).toContain("na Cidade");
  });
});

describe("Lembrete do carrinho — só retirada com transportadora", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.config = { ...SO_RETIRADA_COM_TRANSPORTADORA };
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

  it("regra local sobrada de R$ 150, carrinho de R$ 100: só conta os itens", async () => {
    const texto = await lembrete();
    expect(texto).toContain("1 item no seu carrinho");
    expect(texto).not.toContain("Faltam");
    expect(texto).not.toMatch(/frete gr/i);
  });

  it("'sempre grátis' sobrado: também não diz 'Frete grátis na cidade'", async () => {
    estado.config = { ...estado.config, freeShippingMin: 0.01 };
    const texto = await lembrete();
    expect(texto).toContain("1 item no seu carrinho");
    expect(texto).not.toMatch(/frete gr/i);
  });

  it("modo 'entrego' com a transportadora desligada: 'Faltam R$ 50,00 ... na Cidade' continua", async () => {
    estado.config = {
      ...estado.config,
      localDeliveryEnabled: true,
      enabledShippingMethods: ["sedex"],
    };
    const texto = await lembrete();
    expect(texto).toContain("Faltam R$ 50,00");
    expect(texto).toContain("Frete Grátis na Cidade");
  });

  it("transportadora com a MESMA regra (iguais): o lembrete de antes continua, sem 'na cidade'", async () => {
    // Sem as colunas nacionais a regra nacional espelha a local (legado).
    const { nationalShippingStrategy: _a, ...semNacional } =
      SO_RETIRADA_COM_TRANSPORTADORA;
    estado.config = { ...semNacional };
    const texto = await lembrete();
    expect(texto).toContain("Faltam R$ 50,00");
    expect(texto).not.toContain("Cidade");
  });
});

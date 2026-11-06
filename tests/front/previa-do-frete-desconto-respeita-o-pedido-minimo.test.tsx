// @vitest-environment jsdom
//
// Prévia "Como fica para o cliente": o desconto no frete de fora só vale a
// partir do pedido mínimo configurado (a loja real aplica `subtotal >= mínimo`,
// calculate-shipping/estrategia-nacional.ts). Antes a nota dizia "desconto na
// opção mais barata" em R$ 100 e R$ 150 mesmo com mínimo de R$ 200, porque o
// mínimo é zerado em `promessasDeFrete` para tudo que não é "acima de valor".
import { PreviaDoFrete } from "@/components/admin/shipping/PreviaDoFrete";
import type { StoreConfig } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function configComDesconto(minimo: number | undefined): StoreConfig {
  return {
    originCep: "38400-000",
    localDeliveryEnabled: true,
    localDeliveryFee: 10,
    localDeliveryDays: 1,
    shippingCoverage: "national",
    storeAddress: "Rua A, 10",
    freeShippingMin: 0,
    enabledShippingMethods: [],
    nationalShippingStrategy: "desconto_na_mais_barata",
    nationalShippingMin: minimo,
    nationalDiscountType: "percentual",
    nationalDiscountValue: 10,
    nationalBenefitScope: "mais_barata",
  } as unknown as StoreConfig;
}

describe("prévia do frete: desconto no frete de fora respeita o pedido mínimo", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  function montar(config: StoreConfig) {
    act(() => {
      raiz.render(
        <PreviaDoFrete
          config={config}
          nomesLigados={["Frenet"]}
          pendente={false}
        />,
      );
    });
  }
  async function escolherPedido(valor: number) {
    const botao = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === `R$ ${valor}`,
    );
    expect(botao, `botão R$ ${valor}`).toBeTruthy();
    await act(async () => botao?.click());
  }
  function linhaDeFora(): string {
    const nomes = [...host.querySelectorAll("p")].filter(
      (p) => p.textContent === "Fora da sua região",
    );
    expect(nomes).toHaveLength(1);
    return nomes[0].closest("div.flex")?.textContent ?? "";
  }

  it.each([100, 150])(
    "R$ %s com mínimo de R$ 200: NÃO promete desconto, fica o preço da transportadora",
    async (pedido) => {
      montar(configComDesconto(200));
      await escolherPedido(pedido);
      const linha = linhaDeFora();
      expect(linha).not.toContain("desconto");
      expect(linha).toContain("preço da transportadora");
    },
  );

  it("R$ 250 com mínimo de R$ 200: promete o desconto", async () => {
    montar(configComDesconto(200));
    await escolherPedido(250);
    expect(linhaDeFora()).toContain("desconto na opção mais barata");
  });

  it("borda: pedido exatamente igual ao mínimo já tem o desconto (servidor usa >=)", async () => {
    montar(configComDesconto(150));
    await escolherPedido(150);
    expect(linhaDeFora()).toContain("desconto na opção mais barata");
  });

  it.each([0, undefined])(
    "mínimo %s (desconto sem pedido mínimo): vale em qualquer valor",
    async (minimo) => {
      montar(configComDesconto(minimo));
      await escolherPedido(100);
      expect(linhaDeFora()).toContain("desconto na opção mais barata");
    },
  );

  it("controle: grátis acima de valor segue respeitando o mínimo (sem regressão)", async () => {
    montar({
      ...configComDesconto(200),
      nationalShippingStrategy: "acima_de_valor",
    } as StoreConfig);
    await escolherPedido(100);
    expect(linhaDeFora()).not.toContain("Grátis");
    await escolherPedido(250);
    expect(linhaDeFora()).toContain("Grátis");
  });
});

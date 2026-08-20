// Auditoria de 20/08/2026, achados 2 e 3 — a tela de Frete afirmava duas
// coisas que o app não cumpre:
//
//   1. Com o interruptor de frete grátis desligado, ela dizia "Todos os
//      pedidos terão cobrança de entrega". Se a Taxa Padrão também estiver
//      desligada, `shipping_fee` vale 0 — e zero é uma taxa VÁLIDA, usada de
//      propósito (ver `flatFeeConfigurada` na edge function e o teste que a
//      cobre). O app passa a cotar R$ 0,00 para o Brasil inteiro, e a tela
//      chamava isso de "Sem taxa fixa configurada", como se fosse ausência.
//      Quem vende desliga os dois achando que voltou ao padrão e passa a
//      pagar a entrega de todo pedido.
//
//   2. Com o interruptor ligado, ela dizia "Frete grátis ativo para pedidos a
//      partir de R$ X" — sem dizer que a regra exige o cliente AUTENTICADO.
//      A condição está em três lugares do código (`CartContext`,
//      `StoreContext` e a RPC `create_marketplace_order_v23/v24`, todas com
//      `&& user` / `v_user_id IS NOT NULL`) e em nenhum da tela. Quem compra
//      como convidado passa de R$ 100 e paga frete assim mesmo.
//
// A correção não muda comportamento nenhum: muda o que a tela AFIRMA. Por
// isso as frases saíram do JSX e viraram uma função pura — a decisão estava
// espalhada em condicionais dentro do markup, que é exatamente a forma que
// deixa um estado sem frase correta e ninguém percebe.
//
// O caso que amarra o defeito original é `nenhuma frase promete cobrança que
// o app não vai fazer`: ele varre TODOS os estados e reprova qualquer frase
// que afirme cobrança quando a taxa está em zero.
import { describe, expect, it } from "vitest";

import { frasesDaRegraDeFrete } from "@/utils/regra-de-frete";

const nacionalComTaxaFixa = {
  shippingCoverage: "national",
  shippingProvider: "flat_fee",
} as const;

describe("frasesDaRegraDeFrete — o que a tela de Frete afirma", () => {
  it("frete grátis ligado: diz o valor E que a regra exige entrar na conta", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 100,
      shippingFee: 10,
      ...nacionalComTaxaFixa,
    });

    expect(f.freteGratis).toContain("R$ 100");
    // A condição que a tela escondia. Sem ela o texto volta a prometer frete
    // grátis para quem compra sem entrar na conta, que paga.
    expect(f.freteGratis).toMatch(/entrar na conta|entrou na conta/i);
  });

  it("frete grátis desligado: não afirma que todo pedido paga entrega", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0,
      shippingFee: 10,
      ...nacionalComTaxaFixa,
    });

    expect(f.freteGratis).not.toMatch(/todos os pedidos ter[aã]o cobran[çc]a/i);
    expect(f.freteGratis).toMatch(/nenhuma regra por valor/i);
  });

  it("taxa ligada: diz quanto custa e quando", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 100,
      shippingFee: 10,
      ...nacionalComTaxaFixa,
    });

    expect(f.taxa).toContain("R$ 10");
  });

  it("taxa em zero: diz que é zero, não que está faltando configurar", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 100,
      shippingFee: 0,
      ...nacionalComTaxaFixa,
    });

    expect(f.taxa).toContain("R$ 0");
    expect(f.taxa).not.toMatch(/sem taxa fixa configurada/i);
    expect(f.taxa).toMatch(/sem custo|de gra[çc]a|gr[aá]tis/i);
  });

  it("taxa em zero com cotação nacional pela taxa fixa: avisa que TODO pedido sai de graça", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0,
      shippingFee: 0,
      ...nacionalComTaxaFixa,
    });

    expect(f.avisoDeEntregaGratuita).toBeTruthy();
    expect(f.avisoDeEntregaGratuita).toMatch(/qualquer CEP|todo o Brasil/i);
  });

  it("taxa em zero mas cobertura só local: NÃO avisa (a taxa fixa não é usada aí)", () => {
    // Com `shipping_coverage = 'local'` a edge function devolve "Entrega
    // Local" pela `local_delivery_fee` e retorna antes de olhar a taxa fixa.
    // Avisar aqui seria a tela afirmando um efeito que não acontece.
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0,
      shippingFee: 0,
      shippingCoverage: "local",
      shippingProvider: "flat_fee",
    });

    expect(f.avisoDeEntregaGratuita).toBeNull();
  });

  it("taxa em zero mas cotação por transportadora: NÃO avisa (o preço vem da API)", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0,
      shippingFee: 0,
      shippingCoverage: "national",
      shippingProvider: "melhor_envio",
    });

    expect(f.avisoDeEntregaGratuita).toBeNull();
  });

  it("taxa acima de zero nunca dispara o aviso de entrega gratuita", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0,
      shippingFee: 1,
      ...nacionalComTaxaFixa,
    });

    expect(f.avisoDeEntregaGratuita).toBeNull();
  });

  it("dinheiro com centavos sai com vírgula e duas casas, nunca com ponto", () => {
    // O achado 15 da mesma auditoria é dinheiro exibido arredondado. Não
    // repetir aqui: R$ 49,90 é 49,90, e nunca "49.9" nem "50".
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 49.9,
      shippingFee: 12.5,
      ...nacionalComTaxaFixa,
    });

    expect(f.freteGratis).toContain("R$ 49,90");
    expect(f.freteGratis).not.toContain("49.9");
    expect(f.taxa).toContain("R$ 12,50");
    expect(f.taxa).not.toContain("12.5");
  });

  it("valor redondo sai sem centavos", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 100,
      shippingFee: 10,
      ...nacionalComTaxaFixa,
    });

    expect(f.freteGratis).toContain("R$ 100");
    expect(f.freteGratis).not.toContain("R$ 100,00");
  });

  it("NENHUM estado promete cobrança que o app não vai fazer", () => {
    // A trava do defeito original, varrendo a tabela inteira em vez de um
    // caso. Se alguém acrescentar um estado novo e esquecer a frase dele,
    // este teste é quem grita.
    const coberturas = ["local", "national"] as const;
    const provedores = ["flat_fee", "melhor_envio", "frenet"] as const;
    const minimos = [0, 100];
    const taxas = [0, 10];

    for (const shippingCoverage of coberturas) {
      for (const shippingProvider of provedores) {
        for (const freeShippingMin of minimos) {
          for (const shippingFee of taxas) {
            const f = frasesDaRegraDeFrete({
              freeShippingMin,
              shippingFee,
              shippingCoverage,
              shippingProvider,
            });
            const tudo = `${f.freteGratis} ${f.taxa} ${f.avisoDeEntregaGratuita ?? ""}`;
            const contexto = `min=${freeShippingMin} taxa=${shippingFee} ${shippingCoverage}/${shippingProvider}`;

            // Nenhuma frase pode ficar vazia — estado sem texto é o defeito
            // se repetindo em silêncio.
            expect(f.freteGratis.trim().length, contexto).toBeGreaterThan(0);
            expect(f.taxa.trim().length, contexto).toBeGreaterThan(0);

            // A frase exata que a auditoria pegou, e qualquer parente dela.
            expect(tudo, contexto).not.toMatch(
              /todos os pedidos ter[aã]o cobran[çc]a/i,
            );
            if (shippingFee === 0) {
              expect(tudo, contexto).not.toMatch(/todo pedido paga/i);
            }
          }
        }
      }
    }
  });
});

// O toque no aviso do celular roda no Service Worker de TODAS as clientes e das
// lojistas: um erro ali não se conserta rápido. Bordas que faltavam:
//  - endereço do aviso ilegível não pode derrubar o toque (abre uma janela);
//  - com VÁRIAS janelas da loja abertas, qual delas navega ou é avisada é a
//    PRIMEIRA que serve, e o índice devolvido é o dela (não o de outra);
//  - parâmetro repetido na janela (`?id=1&id=2`) vale se ALGUM deles é o do
//    alvo;
//  - o texto do tipo da mensagem ao painel é contrato entre versões: SW novo +
//    app velho (e o inverso) só se entendem se o texto não mudar.
import {
  TIPO_ABRIR_PEDIDO_DO_AVISO,
  decidirToqueNoAviso,
} from "@/lib/alvo-do-aviso";
import { describe, expect, it } from "vitest";

const LOJA = "https://loja.test";

describe("endereço do aviso ilegível", () => {
  it("abre uma janela nova em vez de lançar erro, mesmo com janelas abertas", () => {
    expect(() =>
      decidirToqueNoAviso("isto não é um endereço", [`${LOJA}/`]),
    ).not.toThrow();
    expect(decidirToqueNoAviso("isto não é um endereço", [`${LOJA}/`])).toEqual(
      { acao: "abrir" },
    );
  });
});

describe("várias janelas da loja abertas", () => {
  it("navega a PRIMEIRA janela da mesma tela em outro pedido", () => {
    expect(
      decidirToqueNoAviso(`${LOJA}/order-details?id=3`, [
        `${LOJA}/search`,
        `${LOJA}/order-details?id=1`,
        `${LOJA}/order-details?id=2`,
      ]),
    ).toEqual({ acao: "navegar", indice: 1 });
  });

  it("no painel, avisa o app da PRIMEIRA janela de pedidos, com o índice dela", () => {
    expect(
      decidirToqueNoAviso(`${LOJA}/admin-orders?id=B`, [
        `${LOJA}/search`,
        `${LOJA}/admin-orders?id=A`,
        `${LOJA}/admin-orders?id=C`,
      ]),
    ).toEqual({ acao: "avisar-app", indice: 1, pedidoId: "B" });
  });

  it("uma janela já no destino ganha da que só está na mesma tela, mesmo vindo depois", () => {
    expect(
      decidirToqueNoAviso(`${LOJA}/order-details?id=2`, [
        `${LOJA}/order-details?id=1`,
        `${LOJA}/order-details?id=2&source=pwa`,
      ]),
    ).toEqual({ acao: "focar", indice: 1 });
  });
});

describe("parâmetro repetido na janela", () => {
  it("vale se algum dos valores é o do alvo", () => {
    expect(
      decidirToqueNoAviso(`${LOJA}/order-details?id=2`, [
        `${LOJA}/order-details?id=1&id=2`,
      ]),
    ).toEqual({ acao: "focar", indice: 0 });
  });

  it("não vale se nenhum dos valores é o do alvo", () => {
    expect(
      decidirToqueNoAviso(`${LOJA}/order-details?id=3`, [
        `${LOJA}/order-details?id=1&id=2`,
      ]),
    ).toEqual({ acao: "navegar", indice: 0 });
  });
});

describe("o contrato da mensagem ao painel", () => {
  it("o tipo é o texto que as duas versões do app e do Service Worker já conhecem", () => {
    expect(TIPO_ABRIR_PEDIDO_DO_AVISO).toBe("ikcous:abrir-pedido-do-aviso");
  });
});

import { arredondarParaCentavos } from "@/lib/utils";
import { describe, expect, it } from "vitest";

/**
 * 20261397000000: no cupom de PORCENTAGEM o servidor passa a devolver o desconto JA arredondado ao centavo
 * (round(subtotal * valor / 100, 2), metade para cima) e a gravar o total a partir dele. A tela le o `discount_value` do
 * servidor (useCoupons) e faz `arredondarParaCentavos(total - discount)` (CheckoutView): com o desconto em centavos
 * inteiros a conta fecha com o que o servidor grava. Estas provas fixam esse lado da conta.
 *
 * ATENCAO: este arquivo exercita so o `arredondarParaCentavos` e o desconto do servidor (a conta e' refeita aqui);
 * NAO exercita o `finalTotal` do CheckoutView. Quem prova o total que a tela mostra (com numeros escritos a mao, e
 * reprova se `total - discount` virar `total + discount`) e' tests/front/checkout-total-nunca-negativo-com-cupom-velho.
 *
 * LIMITE HONESTO: `descontoDoServidorEmCentavos` abaixo e' um MODELO escrito dentro deste teste, nao o servidor. Se o SQL
 * do desconto mudar, este arquivo continua verde. A prova do servidor de verdade (as RPCs `create_marketplace_order_v23`,
 * `create_marketplace_order_v24` e `validate_coupon_secure_v2` num Postgres real) vive em
 * tests/banco/o-desconto-do-cupom-e-arredondado-ao-centavo-viva.cjs, que roda no rpc-ci. Aqui so se prova a aritmetica
 * do lado da tela, dado que o servidor devolve centavos inteiros.
 */

/** O desconto como o servidor o devolve agora: inteiro de centavos, metade para cima (numeric round(.., 2)). */
const descontoDoServidorEmCentavos = (
  subtotalEmCentavos: number,
  pct: number,
) => Math.floor((subtotalEmCentavos * pct + 50) / 100);

describe("aritmética do lado da tela (MODELO do desconto do servidor, não o servidor): arredondarParaCentavos(subtotal - desconto) fecha ao centavo", () => {
  it.each([
    // [subtotal, %, desconto do servidor, total que a ficha tem de fechar]
    [29.95, 10, 3.0, 26.95],
    [49.95, 10, 5.0, 44.95],
    [99.9, 15, 14.99, 84.91],
    [10.0, 15, 1.5, 8.5],
    [19.99, 5, 1.0, 18.99],
  ])(
    "R$ %s com %s%% de desconto: o MODELO do servidor dá R$ %s e arredondarParaCentavos(subtotal - desconto) dá R$ %s",
    (subtotal, pct, descontoDoServidor, totalEsperado) => {
      expect(
        descontoDoServidorEmCentavos(Math.round(subtotal * 100), pct),
      ).toBe(Math.round(descontoDoServidor * 100));
      const totalDaTela = arredondarParaCentavos(subtotal - descontoDoServidor);
      expect(totalDaTela).toBe(totalEsperado);
      // a ficha fecha: subtotal - desconto = total, sem sobrar meio centavo
      expect(
        Math.round(subtotal * 100) - Math.round(descontoDoServidor * 100),
      ).toBe(Math.round(totalDaTela * 100));
    },
  );

  it("o caso da queixa (aritmética pura, sem servidor): R$ 29,95 com 10% era 2,995 de desconto (total 26,96) e com o desconto em centavos inteiros e 3,00 (total 26,95)", () => {
    const antesSemArredondar = (29.95 * 10) / 100; // 2,995 (o que o servidor usava na conta do total)
    const totalDeAntes = arredondarParaCentavos(29.95 - antesSemArredondar);
    expect(totalDeAntes).toBe(26.96);
    const depois = arredondarParaCentavos(29.95 - 3.0);
    expect(depois).toBe(26.95);
  });

  it("varredura: de R$ 0,01 a R$ 200,00 com 1% a 100%, arredondarParaCentavos e o MODELO do servidor fecham no mesmo centavo", () => {
    let conferidos = 0;
    for (let centavos = 1; centavos <= 20_000; centavos += 7) {
      for (const pct of [1, 5, 10, 15, 20, 33, 50, 99, 100]) {
        const descontoCent = descontoDoServidorEmCentavos(centavos, pct);
        // nunca passa do subtotal (o teto do servidor) e nunca e negativo
        expect(descontoCent).toBeGreaterThanOrEqual(0);
        expect(descontoCent).toBeLessThanOrEqual(centavos);
        const totalDaTela = arredondarParaCentavos(
          centavos / 100 - descontoCent / 100,
        );
        expect(totalDaTela).toBe((centavos - descontoCent) / 100);
        conferidos += 1;
      }
    }
    expect(conferidos).toBeGreaterThan(20_000);
  });

  it("cupom de valor fixo e frete nao mudam: o desconto fixo ja e' em centavos e o total e' subtotal - desconto + frete", () => {
    const subtotal = 29.95;
    const fixo = 5;
    const frete = 8.9;
    expect(arredondarParaCentavos(subtotal - fixo + frete)).toBe(33.85);
  });
});

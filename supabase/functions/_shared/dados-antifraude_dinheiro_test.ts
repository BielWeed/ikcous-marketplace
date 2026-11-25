// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `dados-antifraude.ts`, a parte que mexe em
 * DINHEIRO: as linhas `items` que vão ao Mercado Pago e a trava que só deixa
 * mandá-las quando `unit_price × quantity` fecha, ao CENTAVO, com o total do
 * pedido. 55 dos 169 mutantes sobreviviam; os de dinheiro eram arredondamento
 * (`Math.round` virando `ceil`), o teto, o formato do texto de preço e as
 * guardas de forma da soma.
 *
 * Como os de `prova-de-pagamento_centavos_test.ts`, a varredura passa por TODOS
 * os centavos de R$ 0,01 a R$ 30,00 (inclui 0,07, 0,29, 19,99 e outros com
 * ruído de ponto flutuante) contra um oráculo em INTEIROS.
 *
 * Fixtures inventadas.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { itensDaOrder, itensFechamComOTotal } from "./dados-antifraude.ts";

const texto = (c: number): string => (c / 100).toFixed(2);
const linha = (price: unknown, quantity: unknown = 1, product_name: unknown = "Camiseta") => ({ product_name, quantity, price });
// `undefined` explícito (campo ausente) precisa chegar como ausente, não como o padrão acima:
const linhaCom = (campos: Record<string, unknown>) => ({ product_name: "Camiseta", quantity: 1, price: "1.00", ...campos });

// ─── itensDaOrder ────────────────────────────────────────────────────────────

Deno.test("itensDaOrder: o preço de TODO centavo (número ou texto de 2 casas) vira unit_price exato", () => {
  for (let c = 1; c <= 3000; c++) {
    for (const price of [c / 100, texto(c)]) {
      const itens = itensDaOrder([linha(price)], 0);
      assertEquals(itens?.[0]?.unit_price, texto(c), `centavos=${c} (${typeof price})`);
    }
  }
});

Deno.test("itensDaOrder: texto de preço aceita 1 ou 2 casas (e nenhuma); 3 casas, ponto sozinho, vazio ou lixo recusam a lista inteira", () => {
  assertEquals(itensDaOrder([linha("12")], 0)?.[0].unit_price, "12.00");
  assertEquals(itensDaOrder([linha("12.5")], 0)?.[0].unit_price, "12.50");
  assertEquals(itensDaOrder([linha(" 12.50 ")], 0)?.[0].unit_price, "12.50");
  for (const ruim of ["12.345", "12.", ".5", "1.2.3", "abc", "", "  ", "-1", "0", "0.00", 0, -3, NaN, Infinity, null, undefined, {}, true]) {
    assertEquals(itensDaOrder([linha("1.00"), linha(ruim)], 0), undefined, JSON.stringify(ruim));
  }
});

Deno.test("itensDaOrder: número com mais de duas casas (12.345) recusa; o teto de preço é exato (999999999.99 passa, +1 centavo não)", () => {
  assertEquals(itensDaOrder([linha(12.345)], 0), undefined);
  assertEquals(itensDaOrder([linha(999999999.99)], 0)?.[0].unit_price, "999999999.99");
  assertEquals(itensDaOrder([linha(1000000000)], 0), undefined);
  assertEquals(itensDaOrder([linha("9999999999999.99")], 0), undefined);
});

Deno.test("itensDaOrder: quantidade é inteiro de 1 a 9999 (cada borda), senão a lista inteira é recusada", () => {
  assertEquals(itensDaOrder([linha("1.00", 1)], 0)?.[0].quantity, 1);
  assertEquals(itensDaOrder([linha("1.00", 9999)], 0)?.[0].quantity, 9999);
  for (const ruim of [0, -1, 10000, 1.5, "2", null, undefined, NaN]) {
    assertEquals(itensDaOrder([linhaCom({ quantity: ruim })], 0), undefined, JSON.stringify(ruim));
  }
});

Deno.test("itensDaOrder: item que não é objeto, lista vazia ou não-lista -> undefined; título ausente vira 'Produto'", () => {
  for (const linhas of [[], null, undefined, "x", {}, [null], [7], ["x"], [[1]]]) {
    assertEquals(itensDaOrder(linhas, 0), undefined, JSON.stringify(linhas));
  }
  for (const nome of [undefined, null, "", "   ", "\u0001\u0002", 5]) {
    assertEquals(itensDaOrder([linhaCom({ product_name: nome })], 0)?.[0].title, "Produto", JSON.stringify(nome));
  }
});

Deno.test("itensDaOrder: frete positivo entra como linha 'Frete' (1 unidade); zero, ausente ou ilegível não entram", () => {
  const com = itensDaOrder([linha("10.00")], "7.50");
  assertEquals(com?.length, 2);
  assertEquals(com?.[1], { title: "Frete", unit_price: "7.50", quantity: 1, description: "Frete" });
  for (const frete of [0, "0.00", null, undefined, "abc", -5]) {
    assertEquals(itensDaOrder([linha("10.00")], frete)?.length, 1, JSON.stringify(frete));
  }
});

// ─── itensFechamComOTotal ────────────────────────────────────────────────────

Deno.test("varredura: a soma unit_price × quantity só fecha com o total ao CENTAVO (c×q fecha; c×q±1 não)", () => {
  for (let c = 1; c <= 3000; c++) {
    for (const q of [1, 2, 3, 7]) {
      const itens = [{ title: "x", unit_price: texto(c), quantity: q }];
      assertEquals(itensFechamComOTotal(itens, texto(c * q)), true, `c=${c} q=${q}`);
      assertEquals(itensFechamComOTotal(itens, texto(c * q + 1)), false, `c=${c} q=${q} +1`);
      assertEquals(itensFechamComOTotal(itens, texto(c * q - 1 > 0 ? c * q - 1 : c * q + 2)), false, `c=${c} q=${q} -1`);
    }
  }
});

Deno.test("itensFechamComOTotal: várias linhas somam; frete é uma linha como as outras", () => {
  const itens = [
    { unit_price: "10.00", quantity: 2 },
    { unit_price: "0.07", quantity: 3 },
    { unit_price: "7.50", quantity: 1 },
  ];
  assertEquals(itensFechamComOTotal(itens, "27.71"), true);
  assertEquals(itensFechamComOTotal(itens, "27.70"), false);
});

Deno.test("itensFechamComOTotal: forma fora do esperado (total, itens, preço, quantidade) NUNCA fecha, e não lança", () => {
  const ok = [{ unit_price: "10.00", quantity: 1 }];
  assertEquals(itensFechamComOTotal(ok, "10.00"), true, "controle");
  for (const total of ["10.0", "10", 10, "abc", "", null, undefined, "10.001", "-10.00"]) {
    assertEquals(itensFechamComOTotal(ok, total), false, `total=${JSON.stringify(total)}`);
  }
  for (const itens of [[], null, undefined, "x", {}]) {
    assertEquals(itensFechamComOTotal(itens, "10.00"), false, JSON.stringify(itens));
  }
  for (const item of [null, 7, "x", [1], { unit_price: 10, quantity: 1 }, { unit_price: "10.0", quantity: 1 }, { unit_price: "10.00", quantity: 0 }, { unit_price: "10.00", quantity: 1.5 }, { unit_price: "10.00", quantity: "1" }, { unit_price: "10.00" }, { quantity: 1 }]) {
    assertEquals(itensFechamComOTotal([...ok, item], "10.00"), false, JSON.stringify(item));
    assertEquals(itensFechamComOTotal([item, ...ok], "10.00"), false, JSON.stringify(item));
  }
});

Deno.test("itensFechamComOTotal: preço com UMA casa, total com UMA casa ou quantidade quebrada não 'fecham' por coincidência de dígitos", () => {
  // "1.0" lido sem a trava viraria 10 centavos... e "1.00" tem 100: os dígitos coincidem, o dinheiro não.
  assertEquals(itensFechamComOTotal([{ unit_price: "1.0", quantity: 1 }], "0.10"), false, "preço de 1 casa");
  assertEquals(itensFechamComOTotal([{ unit_price: "0.10", quantity: 1 }], "1.0"), false, "total de 1 casa (os dígitos '10' coincidem com 10 centavos)");
  assertEquals(itensFechamComOTotal([{ unit_price: "10.00", quantity: 1.5 }], "15.00"), false, "quantidade fracionada");
  assertEquals(itensFechamComOTotal([{ unit_price: "10.00", quantity: 2 }], "20.00"), true, "o controle");
});

// Laudo caça-bugs 31/08 (item E — reconciliação de CEP): o cliente cota o
// frete no CEP A (a calculadora fica no CARRINHO, com campo próprio), muda
// o endereço para o CEP B no checkout, e o pedido saía com o frete do A
// para entregar no B. A metade SERVIDOR da cura (20261039000000) RECUSA o
// pedido divergente; esta regra pura é a metade TELA: a cotação deixa de
// valer no instante em que o destino muda, a opção cai e o carrinho volta
// a "A calcular" — o cliente re-cota para o CEP certo sem nunca ver a
// recusa.
//
// CONTRATO COM O SERVIDOR (mesma regra, outro arquivo): cotação AUSENTE
// não contradiz destino nenhum (frete grátis sem cotação, taxa fixa sem
// passage pela calculadora) — vale. Destino ausente com cotação presente
// só existe chamando a API direto; a tela sempre tem destino (form do
// convidado exige CEP, logado tem endereço), e o efeito que consome esta
// regra não limpa opção sem destino novo para comparar.

import { cotacaoValeParaDestino, soDigitos } from "@/lib/reconciliacao-de-cep";
import { describe, expect, it } from "vitest";

describe("soDigitos — o CEP chega formatado de três lugares diferentes", () => {
  it("tira máscara e espaços", () => {
    expect(soDigitos("38500-000")).toBe("38500000");
    expect(soDigitos(" 38.500-000 ")).toBe("38500000");
    expect(soDigitos("38500000")).toBe("38500000");
  });
});

describe("cotacaoValeParaDestino — a cotação morre quando o destino muda", () => {
  it("mesmo CEP (ambos limpos): a cotação vale", () => {
    expect(cotacaoValeParaDestino("38500000", "38500000")).toBe(true);
  });

  it("cotação formatada × destino cru: a NORMALIZAÇÃO decide — valem", () => {
    // O assassino de mutantes: sem tirar a máscara, "38500-000" ≠
    // "38500000" e a opção do cliente caía sem motivo a cada render.
    expect(cotacaoValeParaDestino("38500-000", "38500000")).toBe(true);
    expect(cotacaoValeParaDestino("38500000", "38.500-000")).toBe(true);
  });

  it("CEPs diferentes: a cotação NÃO vale mais", () => {
    expect(cotacaoValeParaDestino("38500000", "01310100")).toBe(false);
  });

  it("cotação ausente/vazia não contradiz destino nenhum", () => {
    expect(cotacaoValeParaDestino(null, "38500000")).toBe(true);
    expect(cotacaoValeParaDestino("", "38500000")).toBe(true);
    expect(cotacaoValeParaDestino("   ", "38500000")).toBe(true);
  });

  it("destino ausente: nada a comparar — a regra não decide (a tela nem chega aqui)", () => {
    expect(cotacaoValeParaDestino("38500000", null)).toBe(true);
    expect(cotacaoValeParaDestino("38500000", "")).toBe(true);
  });
});

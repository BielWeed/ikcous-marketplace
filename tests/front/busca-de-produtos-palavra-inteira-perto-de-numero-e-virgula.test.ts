// Protege a guarda "50% nao e palavra inteira dentro de 1,50%" (formaAparece)
// contra dois vazamentos para fora do percentual:
//  1. A guarda so vale para termo de PERCENTUAL. Uma letra solta ("m" de metro)
//     depois de um numero ("Fita 5 m") e palavra inteira: a cliente que digita
//     "m" acha a fita. Se a guarda valesse para qualquer termo, o numero dois
//     caracteres antes escondia o "m".
//  2. Dentro do percentual, a guarda exige DIGITO antes do separador: "1,50%"
//     (parte de outro numero) nao acha "50%", mas "Promo,50% off" (virgula
//     solta, sem numero antes) acha.
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (name: string) => ({
  name,
  category: "Geral",
  description: null,
});

describe("palavra inteira perto de numero e virgula", () => {
  it("uma letra depois de numero e palavra inteira: 'm' acha 'Fita 5 m'", () => {
    expect(produtoCombinaComBusca(produto("Fita 5 m"), "m")).toBe(true);
  });

  it("a mesma letra com numero grudado nao e palavra: 'm' nao acha 'Fita 5m'", () => {
    expect(produtoCombinaComBusca(produto("Fita 5m"), "m")).toBe(false);
  });

  it("virgula solta (sem numero antes) nao esconde o percentual: 50% acha 'Promo,50% off'", () => {
    expect(produtoCombinaComBusca(produto("Promo,50% off"), "50%")).toBe(true);
  });

  it("ponto solta no inicio tambem nao: 50% acha '.50% off'", () => {
    expect(produtoCombinaComBusca(produto(".50% off"), "50%")).toBe(true);
  });

  it("ancora: 50% continua sem achar 1,50% (parte de outro numero)", () => {
    expect(produtoCombinaComBusca(produto("Taxa 1,50% ao mes"), "50%")).toBe(
      false,
    );
  });
});

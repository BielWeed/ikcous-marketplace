// Captura do dono (23/09/2026): a opção marcada tem de ser, com o MESMO
// preço, uma opção da cotação que está na tela antes de o pedido nascer.
import { conferirFreteEscolhidoComACotacao } from "@/lib/guarda-de-frete";
import { describe, expect, it } from "vitest";

const loggi = { id: "melhor-envio-31", price: 10.49, deliveryDays: 3 };
const pac = { id: "superfrete-1", price: 25.31, deliveryDays: 8 };

describe("conferirFreteEscolhidoComACotacao", () => {
  it("mesmo id e mesmo preço: confere", () => {
    expect(conferirFreteEscolhidoComACotacao(pac, [loggi, pac])).toEqual({
      tipo: "confere",
    });
  });

  it("mesmo preço com ruído de ponto flutuante: confere (compara em centavos)", () => {
    expect(
      conferirFreteEscolhidoComACotacao({ ...pac, price: 25.310000001 }, [pac]),
    ).toEqual({ tipo: "confere" });
  });

  it("mesmo id com preço diferente: devolve o objeto FRESCO da cotação", () => {
    const fresco = { ...pac, price: 24.9 };
    const r = conferirFreteEscolhidoComACotacao(pac, [loggi, fresco]);
    expect(r.tipo).toBe("preco-mudou");
    expect(r.tipo === "preco-mudou" && r.fresca).toBe(fresco);
  });

  it("id fora da lista: sumiu", () => {
    expect(conferirFreteEscolhidoComACotacao(pac, [loggi])).toEqual({
      tipo: "sumiu",
    });
  });

  it("preço ilegível na lista: tratado como sumiu (nunca como confere)", () => {
    expect(
      conferirFreteEscolhidoComACotacao(pac, [{ id: pac.id, price: "25.31" }]),
    ).toEqual({ tipo: "sumiu" });
  });

  it("sem lista legível: sem evidência (não bloqueia)", () => {
    for (const bruto of [undefined, null, [], "x", { opcoes: [] }]) {
      expect(conferirFreteEscolhidoComACotacao(pac, bruto)).toEqual({
        tipo: "sem-evidencia",
      });
    }
  });
});

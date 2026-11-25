// A ficha do pedido que espera a lojista só avisa a partir de 3 dias, e a frase
// diz o número REAL de dias parado — não um número fixo que sobrou de um caso
// particular (um pedido de 4 dias nunca pode ler "há 3 dias").
import { describe, expect, it } from "vitest";

import {
  fraseDeEsperaDoPedido,
  idadeDoPedidoPendente,
} from "@/lib/idade-do-pedido-pendente";

describe("fraseDeEsperaDoPedido: cada quantidade de dias diz a sua", () => {
  it.each([
    [3, "Este pedido espera você há 3 dias."],
    [4, "Este pedido espera você há 4 dias."],
    [5, "Este pedido espera você há 5 dias."],
    [10, "Este pedido espera você há 10 dias."],
    [90, "Este pedido espera você há 90 dias."],
  ])("%d dias: %s", (dias, frase) => {
    expect(fraseDeEsperaDoPedido(dias)).toBe(frase);
  });

  it.each([null, 0, 1, 2])("%s: ainda não vale avisar", (dias) => {
    expect(fraseDeEsperaDoPedido(dias)).toBeNull();
  });

  it("a idade calculada alimenta a frase do dia certo (3, 4 e 5 dias cheios)", () => {
    const agora = Date.parse("2026-11-24T12:00:00.000Z");
    const criadoHa = (dias: number, folgaEmMinutos = 0) =>
      new Date(
        agora - dias * 86_400_000 - folgaEmMinutos * 60_000,
      ).toISOString();
    const frase = (dias: number, folga?: number) =>
      fraseDeEsperaDoPedido(
        idadeDoPedidoPendente(criadoHa(dias, folga), "pending", agora),
      );

    expect(frase(3)).toBe("Este pedido espera você há 3 dias.");
    expect(frase(4, 30)).toBe("Este pedido espera você há 4 dias.");
    expect(frase(5, 1439)).toBe("Este pedido espera você há 5 dias.");
    // um minuto antes de completar 3 dias: ainda são 2 dias cheios, sem aviso
    expect(frase(3, -1)).toBeNull();
  });
});

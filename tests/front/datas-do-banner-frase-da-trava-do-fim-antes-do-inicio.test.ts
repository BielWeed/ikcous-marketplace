import {
  MENSAGEM_FIM_ANTES_DO_INICIO,
  problemaDasDatas,
} from "@/lib/datas-do-banner";
import { describe, expect, it } from "vitest";

// A lojista que põe a data de fim antes (ou igual) à de início não consegue
// salvar o banner: a frase que ela lê precisa dizer qual é a regra e o que
// fazer, e a trava precisa ser exatamente a mesma que dispara a frase.
describe("frase da trava 'fim antes do início'", () => {
  it("diz que o fim vem DEPOIS do início e pede o ajuste das datas", () => {
    expect(MENSAGEM_FIM_ANTES_DO_INICIO).toBe(
      "O fim precisa ser depois do início. Ajuste as datas para poder salvar.",
    );
  });

  it("a trava dispara para fim antes do início e para fim igual ao início", () => {
    expect(
      problemaDasDatas(
        "2026-12-10T10:00:00.000Z",
        "2026-12-09T10:00:00.000Z",
        new Date("2026-12-01T00:00:00.000Z"),
      ),
    ).toBe("fim-antes-do-inicio");
    expect(
      problemaDasDatas(
        "2026-12-10T10:00:00.000Z",
        "2026-12-10T10:00:00.000Z",
        new Date("2026-12-01T00:00:00.000Z"),
      ),
    ).toBe("fim-antes-do-inicio");
  });
});

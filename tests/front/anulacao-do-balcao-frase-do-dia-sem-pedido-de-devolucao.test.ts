// A recusa "só no mesmo dia" do banco, quando vem SEM o "registre uma
// devolução" no fim, passa como está: o texto extra (o que resta depois do dia)
// só substitui o pedido impossível, não é acrescentado a toda frase.
// A caça por mutação tirou a guarda `if (!PEDIDO_DE_DEVOLUCAO.test(frase))` e
// nenhum teste caiu.
import { describe, expect, it } from "vitest";

import {
  FRASE_ANULAR_SO_NO_MESMO_DIA,
  mensagemDaFalhaDaAnulacao,
} from "@/lib/anulacao-do-balcao";

describe("mensagemDaFalhaDaAnulacao: frase do dia sem pedido de devolução", () => {
  it("sem o 'registre uma devolução', a frase do banco sai intacta (com e sem cliente)", () => {
    const erro = { code: "22023", message: FRASE_ANULAR_SO_NO_MESMO_DIA };
    expect(mensagemDaFalhaDaAnulacao(erro, true)).toBe(
      FRASE_ANULAR_SO_NO_MESMO_DIA,
    );
    expect(mensagemDaFalhaDaAnulacao(erro, false)).toBe(
      FRASE_ANULAR_SO_NO_MESMO_DIA,
    );
  });

  it("controle: com o 'Para outro dia, registre uma devolução.' a frase ganha o que resta", () => {
    const erro = {
      code: "22023",
      message: `${FRASE_ANULAR_SO_NO_MESMO_DIA} Para outro dia, registre uma devolução.`,
    };
    const frase = mensagemDaFalhaDaAnulacao(erro, true);
    expect(frase.startsWith(FRASE_ANULAR_SO_NO_MESMO_DIA)).toBe(true);
    expect(frase).not.toContain("registre uma devolução");
    expect(frase.length).toBeGreaterThan(FRASE_ANULAR_SO_NO_MESMO_DIA.length);
  });
});

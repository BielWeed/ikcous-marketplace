// Duas bordas da ordem dos avisos de pedido
// (`src/lib/ordem-do-aviso-do-pedido.ts`) que o teste de carimbo inválido não
// pisava:
//   · uma LISTA que por acaso carrega a propriedade `emitidoEm` não é "dados do
//     aviso" (a regra aceita só objeto simples);
//   · aviso SEM carimbo nunca "ganha" a ordem, nem quando o carimbo de quem
//     chegou é negativo (em JavaScript, `null > -1` é verdadeiro — sem a
//     checagem explícita de nulo, o aviso sem carimbo viraria o "mais novo").
import {
  avisoMaisNovoQue,
  carimboDoAviso,
} from "@/lib/ordem-do-aviso-do-pedido";
import { describe, expect, it } from "vitest";

describe("carimboDoAviso — forma dos dados", () => {
  it("lista com a propriedade emitidoEm colada não tem carimbo", () => {
    const lista = Object.assign([1, 2], { emitidoEm: 1_700_000_000_000 });
    expect(carimboDoAviso(lista)).toBeNull();
  });

  it("objeto simples com o mesmo campo tem carimbo (controle do teste acima)", () => {
    expect(carimboDoAviso({ emitidoEm: 1_700_000_000_000 })).toBe(
      1_700_000_000_000,
    );
  });
});

describe("avisoMaisNovoQue — aviso sem carimbo nunca é o mais novo", () => {
  it("com carimbo negativo de quem chegou, o aviso sem carimbo não ganha", () => {
    const semCarimbo = { tag: "a", data: {} };
    const semDados = { tag: "b", data: undefined };
    const comTextoNoCampo = { tag: "c", data: { emitidoEm: "99" } };

    expect(
      avisoMaisNovoQue(-1, [semCarimbo, semDados, comTextoNoCampo]),
    ).toBeNull();
  });

  it("com carimbo zero de quem chegou, o aviso sem carimbo também não ganha", () => {
    expect(avisoMaisNovoQue(0, [{ tag: "a", data: null }])).toBeNull();
  });

  it("entre avisos sem carimbo e um com carimbo maior, ganha o que tem carimbo", () => {
    const velho = { tag: "velho", data: { emitidoEm: 10 } };
    const novo = { tag: "novo", data: { emitidoEm: 30 } };
    const semCarimbo = { tag: "sem", data: {} };

    expect(avisoMaisNovoQue(-5, [semCarimbo, novo, velho])).toBe(novo);
  });
});

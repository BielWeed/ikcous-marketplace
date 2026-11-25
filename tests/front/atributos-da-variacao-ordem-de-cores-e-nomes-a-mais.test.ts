// `src/utils/atributos-da-variacao.ts`: duas bordas que os testes vizinhos
// deixavam passar (caça por mutação).
//
//  - `posicaoDoAtributo`: "Cores" e "Color" (os nomes que a lojista já grava
//    para a cor) vão na mesma posição da "Cor", DEPOIS do tamanho e ANTES de
//    qualquer outro atributo. Sem isso, a cor cairia no fim da fileira;
//  - `dividirEmAtributos`: nome com MAIS partes que o valor ("Cor / Tamanho"
//    contra "Azul") não é desmontado em pares com o tamanho vazio: abre como UM
//    par com o texto bruto (nada se perde). O inverso, mais valores que nomes,
//    já tinha teste.
import {
  dividirEmAtributos,
  posicaoDoAtributo,
} from "@/utils/atributos-da-variacao";
import { describe, expect, it } from "vitest";

describe("posicaoDoAtributo — a cor tem três grafias", () => {
  it.each(["Cor", "cor", "Cores", "CORES", "Color", " color "])(
    "%j vem depois do tamanho e antes dos outros",
    (nome) => {
      expect(posicaoDoAtributo(nome)).toBe(1);
      expect(posicaoDoAtributo(nome)).toBeGreaterThan(
        posicaoDoAtributo("Tamanho"),
      );
      expect(posicaoDoAtributo(nome)).toBeLessThan(
        posicaoDoAtributo("Estampa"),
      );
    },
  );

  it("só o nome INTEIRO conta: 'Cores extras' e 'Color do cabo' são outros atributos", () => {
    expect(posicaoDoAtributo("Cores extras")).toBe(2);
    expect(posicaoDoAtributo("Color do cabo")).toBe(2);
  });

  it("Tamanho, Voltagem e Capacidade vêm primeiro; Material e o resto, por último", () => {
    for (const nome of ["Tamanho", "Voltagem", "Capacidade", "Memória"]) {
      expect(posicaoDoAtributo(nome), nome).toBe(0);
    }
    expect(posicaoDoAtributo("Material")).toBe(2);
    expect(posicaoDoAtributo("Estampa")).toBe(2);
  });
});

describe("dividirEmAtributos — mais nomes que valores", () => {
  it("'Cor / Tamanho' com um valor só abre como um par bruto, sem tamanho vazio", () => {
    expect(dividirEmAtributos("Cor / Tamanho", "Azul")).toEqual([
      { name: "Cor / Tamanho", value: "Azul" },
    ]);
  });

  it("três nomes contra dois valores: idem", () => {
    expect(dividirEmAtributos("Cor / Tamanho / Estampa", "Azul / P")).toEqual([
      { name: "Cor / Tamanho / Estampa", value: "Azul / P" },
    ]);
  });

  it("controle: contagens iguais desmontam em pares", () => {
    expect(dividirEmAtributos("Cor / Tamanho", "Azul / P")).toEqual([
      { name: "Cor", value: "Azul" },
      { name: "Tamanho", value: "P" },
    ]);
  });
});

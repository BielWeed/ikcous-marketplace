// Caça por mutação em `siglaDaUfColada` (colar no campo UF do endereço).
//
// O que protege: a colagem é calculada sobre o texto que o campo TERÁ depois de
// colar — o que já estava antes do cursor + o colado + o que sobra depois da
// seleção. Os testes antigos só colavam em campo VAZIO, então um cálculo que
// ignorasse cursor e seleção passava. Aqui:
//   - cursor no fim de "S" + colar "P" -> "SP" (completa, não substitui);
//   - texto selecionado é SUBSTITUÍDO pelo colado ("XX" inteiro + "mg" -> "MG");
//   - colar que deixaria mais de uma UF no campo ("SP" + "MG") não vira sigla
//     (devolve undefined: o navegador cola normal e o erro "Estado inválido"
//     aparece, em vez de a tela escolher uma UF no lugar da cliente);
//   - campo sem posição de cursor (`selectionStart` nulo) cola no FIM.
import { siglaDaUfColada } from "@/lib/uf-brasileira";
import { describe, expect, it } from "vitest";

function campo(
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
) {
  return { value, selectionStart, selectionEnd } as HTMLInputElement;
}

describe("siglaDaUfColada — cursor e seleção", () => {
  it("cursor no fim de 'S': colar 'P' completa 'SP'", () => {
    expect(siglaDaUfColada(campo("S", 1, 1), "P")).toBe("SP");
  });

  it("cursor no começo de 'P': colar 'S' antes dá 'SP'", () => {
    expect(siglaDaUfColada(campo("P", 0, 0), "S")).toBe("SP");
  });

  it("texto selecionado é substituído pelo colado, não somado a ele", () => {
    expect(siglaDaUfColada(campo("XX", 0, 2), "mg")).toBe("MG");
  });

  it("só a parte selecionada sai: 'SX' com o 'X' selecionado + 'P' dá 'SP'", () => {
    expect(siglaDaUfColada(campo("SX", 1, 2), "P")).toBe("SP");
  });

  it("colar uma UF inteira onde já há outra, sem selecionar, NÃO vira sigla", () => {
    expect(siglaDaUfColada(campo("SP", 2, 2), "MG")).toBeUndefined();
  });

  it("sem posição de cursor (nulo), cola no FIM do texto", () => {
    expect(siglaDaUfColada(campo("S", null, null), "P")).toBe("SP");
    // Se colasse no começo daria "PS", que não é UF.
  });

  it("sem fim de seleção (nulo), a seleção é vazia no início e nada é removido", () => {
    expect(siglaDaUfColada(campo("S", 1, null), "P")).toBe("SP");
  });

  it("colado que não forma sigla nem com o que já está no campo é ignorado", () => {
    expect(siglaDaUfColada(campo("S", 1, 1), "Z")).toBeUndefined();
    expect(siglaDaUfColada(campo("", 0, 0), "12")).toBeUndefined();
  });
});

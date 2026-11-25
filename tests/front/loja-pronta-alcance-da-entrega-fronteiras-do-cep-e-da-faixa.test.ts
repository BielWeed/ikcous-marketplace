// "Alcance por CEP" da entrega própria da loja: a regra real é comparar os 5
// primeiros números do CEP. Estas são as fronteiras que o servidor também usa
// (`is_local_cep`, a edge de frete e `cepEhLocal`): CEP completo tem 8 números;
// o alcance "só perto da loja" é exatamente o prefixo de 5; a região do cliente
// só entra no alcance com 5 números completos e com a loja de CEP válido.
import { describe, expect, it } from "vitest";

import {
  alcanceAoMudarOCepDaLoja,
  alcanceEhSoPertoDaLoja,
  alcanceSemNumeros,
  entregaComAlcanceCurto,
  incluirRegiaoNoAlcance,
  prefixoDoCepDaLoja,
} from "@/lib/loja-pronta";

describe("prefixoDoCepDaLoja", () => {
  it.each([
    ["38400-123", "38400"],
    ["38400123", "38400"],
    ["  38400-123  ", "38400"],
    ["01310-100", "01310"],
  ])("%j tem prefixo %s", (cep, prefixo) => {
    expect(prefixoDoCepDaLoja(cep)).toBe(prefixo);
  });

  it.each([
    "1234",
    "38400-12",
    "384001234",
    "38400-1234",
    "abcde-fgh",
    "",
    "   ",
    null,
    undefined,
  ])("CEP incompleto (%j) não tem prefixo", (cep) => {
    expect(prefixoDoCepDaLoja(cep)).toBeNull();
  });
});

describe("alcanceSemNumeros: texto preenchido que não tem número", () => {
  it.each(["abc", ",,,", "  ,  , ", "todo o bairro"])(
    "%j não alcança ninguém",
    (faixa) => {
      expect(alcanceSemNumeros(faixa)).toBe(true);
    },
  );

  it.each(["", "   ", null, undefined, "38400", "abc, 38400", "38400-000"])(
    "%j é vazio ou tem número",
    (faixa) => {
      expect(alcanceSemNumeros(faixa)).toBe(false);
    },
  );
});

describe("alcanceEhSoPertoDaLoja", () => {
  it("o alcance é só o prefixo de 5 números do CEP da loja", () => {
    expect(alcanceEhSoPertoDaLoja("38400-123", "38400")).toBe(true);
    expect(alcanceEhSoPertoDaLoja("38400123", " 38400 ")).toBe(true);
  });

  it.each([
    ["outro prefixo", "38400-123", "38401"],
    ["dois itens", "38400-123", "38400, 38401"],
    ["dois itens, o da loja repetido", "38400-123", "38400, 38400"],
    ["faixa longa", "38400-123", "38400-000"],
    ["alcance vazio (a lojista ainda não confirmou)", "38400-123", ""],
    ["alcance sem números", "38400-123", "abc"],
    ["loja sem CEP completo", "3840", "38400"],
    ["loja sem CEP", null, "38400"],
  ])("%s: não é 'só perto da loja'", (_nome, cepDaLoja, faixa) => {
    expect(alcanceEhSoPertoDaLoja(cepDaLoja, faixa)).toBe(false);
  });
});

describe("alcanceAoMudarOCepDaLoja", () => {
  it("só acompanha o CEP novo quando era exatamente o prefixo do antigo", () => {
    expect(alcanceAoMudarOCepDaLoja("38400-123", "39000-456", "38400")).toBe(
      "39000",
    );
  });

  it.each([
    ["alcance da lojista (lista)", "38400, 38401"],
    ["alcance vazio", ""],
    ["prefixo de outra região", "38999"],
  ])("%s nunca é tocado", (_nome, faixa) => {
    expect(
      alcanceAoMudarOCepDaLoja("38400-123", "39000-456", faixa),
    ).toBeNull();
  });

  it("CEP novo com o mesmo prefixo ou inválido: nada a regravar", () => {
    expect(
      alcanceAoMudarOCepDaLoja("38400-123", "38400-999", "38400"),
    ).toBeNull();
    expect(alcanceAoMudarOCepDaLoja("38400-123", "3900", "38400")).toBeNull();
  });
});

describe("incluirRegiaoNoAlcance", () => {
  it("acrescenta os 5 primeiros números do CEP do cliente, sem tirar ninguém", () => {
    expect(incluirRegiaoNoAlcance("38400", "38400-123", "38412-345")).toBe(
      "38400, 38412",
    );
    expect(incluirRegiaoNoAlcance("38400", "38400-123", "38412345")).toBe(
      "38400, 38412",
    );
  });

  it("cinco números exatos já bastam", () => {
    expect(incluirRegiaoNoAlcance("38400", "38400-123", "38412")).toBe(
      "38400, 38412",
    );
  });

  it.each(["3841", "384", "", "abc", "3841-"])(
    "CEP do cliente com menos de 5 números (%j): o alcance fica como estava",
    (cepDoCliente) => {
      expect(incluirRegiaoNoAlcance("38400", "38400-123", cepDoCliente)).toBe(
        "38400",
      );
    },
  );

  it("loja sem CEP completo: o alcance fica como estava", () => {
    expect(incluirRegiaoNoAlcance("38400", "3840", "38412-345")).toBe("38400");
    expect(incluirRegiaoNoAlcance("38400", null, "38412-345")).toBe("38400");
  });

  it("alcance vazio quer dizer a região da loja: ela entra junto", () => {
    expect(incluirRegiaoNoAlcance("", "38400-123", "38412-345")).toBe(
      "38400, 38412",
    );
  });

  it("texto sem números não abre a região da loja de carona", () => {
    expect(incluirRegiaoNoAlcance("abc", "38400-123", "39000-111")).toBe(
      "39000",
    );
  });

  it("região que já estava: devolve o texto exatamente como estava", () => {
    expect(
      incluirRegiaoNoAlcance("38400,  38412", "38400-123", "38412-999"),
    ).toBe("38400,  38412");
  });

  it("só vira bloco 'início-fim' quando os DOIS itens são CEP completo (um completo e um prefixo seguem dois itens)", () => {
    expect(
      incluirRegiaoNoAlcance("38400-000, 38499", "38400-123", "39000-111"),
    ).toBe("38400-000, 38499, 39000");
  });

  it("dois CEPs completos (uma faixa) viram o bloco 'início-fim' antes de acrescentar", () => {
    expect(
      incluirRegiaoNoAlcance("38400-000, 38499-999", "38400-123", "39000-111"),
    ).toBe("38400000-38499999, 39000");
  });
});

describe("entregaComAlcanceCurto: o aviso do alcance vazio com CEP de rua", () => {
  it("CEP de rua e alcance vazio: o alcance é curto", () => {
    expect(
      entregaComAlcanceCurto({
        originCep: "38400-123",
        localCepRange: "",
        localDeliveryEnabled: true,
      }),
    ).toBe(true);
    expect(entregaComAlcanceCurto({ originCep: "38400-123" })).toBe(true);
    expect(
      entregaComAlcanceCurto({
        originCep: "38400-123",
        localCepRange: "   ",
      }),
    ).toBe(true);
  });

  it("alcance preenchido nunca é 'curto', mesmo deixando o CEP da loja de fora", () => {
    expect(
      entregaComAlcanceCurto({
        originCep: "38400-123",
        localCepRange: "39000",
      }),
    ).toBe(false);
  });

  it("CEP geral de cidade pequena (termina em 000): sem aviso", () => {
    expect(
      entregaComAlcanceCurto({ originCep: "38500-000", localCepRange: "" }),
    ).toBe(false);
  });

  it("entrega própria desligada ('só retiro') ou CEP incompleto: sem aviso", () => {
    expect(
      entregaComAlcanceCurto({
        originCep: "38400-123",
        localCepRange: "",
        localDeliveryEnabled: false,
      }),
    ).toBe(false);
    expect(
      entregaComAlcanceCurto({ originCep: "3840", localCepRange: "" }),
    ).toBe(false);
    expect(entregaComAlcanceCurto({ localCepRange: "" })).toBe(false);
  });
});

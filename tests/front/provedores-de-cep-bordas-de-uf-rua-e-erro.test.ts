// Caça por mutação em `provedores-de-cep`: bordas que o teste principal não
// pisava, todas com CEP e endereços fictícios.
//   - UF: o provedor pode mandar "sp" (minúscula) — vale como "SP"; "S", "SPA" ou
//     "S1" não são sigla e a resposta é INVÁLIDA (não vira endereço com UF torta).
//   - Texto vem com espaço nas pontas: rua, bairro e cidade saem aparados.
//   - AwesomeAPI: só `code: "not_found"` é "CEP não existe". Qualquer outro
//     `code` (limite de uso, erro do servidor) NÃO pode virar "não encontrado" —
//     a cliente leria "CEP errado" quando o provedor só está com problema.
//   - AwesomeAPI: só um número FINAL da rua é cortado; "12 Fundos" fica, e a
//     vírgula colada no número ("Rua Um,52") também é cortada.
//   - OpenCEP: `erro` (grafia do ViaCEP) também vale como "não existe".
import { PROVEDORES_DE_CEP } from "@/lib/provedores-de-cep";
import { describe, expect, it } from "vitest";

const [viaCep, openCep, awesome] = PROVEDORES_DE_CEP;

describe("UF do provedor", () => {
  it("minúscula ('sp') vira 'SP' nos três provedores", () => {
    expect(
      viaCep.ler({ localidade: "Cidade Exemplo", uf: "sp" }),
    ).toMatchObject({ tipo: "achou", endereco: { uf: "SP" } });
    expect(
      openCep.ler({ localidade: "Cidade Exemplo", uf: "mg" }),
    ).toMatchObject({ tipo: "achou", endereco: { uf: "MG" } });
    expect(awesome.ler({ city: "Cidade Exemplo", state: "ba" })).toMatchObject({
      tipo: "achou",
      endereco: { uf: "BA" },
    });
  });

  it("espaço nas pontas ('  mg ') é aparado antes de valer como sigla", () => {
    expect(
      viaCep.ler({ localidade: "Cidade Exemplo", uf: "  mg " }),
    ).toMatchObject({ tipo: "achou", endereco: { uf: "MG" } });
  });

  it("uma letra, três letras ou letra+dígito NÃO são sigla: inválida", () => {
    for (const uf of ["S", "SPA", "S1", "1S", "S P"]) {
      expect(viaCep.ler({ localidade: "Cidade Exemplo", uf })).toEqual({
        tipo: "invalida",
      });
    }
  });

  it("cidade só de espaços não vale como cidade", () => {
    expect(viaCep.ler({ localidade: "   ", uf: "SP" })).toEqual({
      tipo: "invalida",
    });
  });
});

describe("texto do provedor vem aparado", () => {
  it("rua, bairro e cidade com espaços nas pontas saem sem eles", () => {
    expect(
      viaCep.ler({
        logradouro: "  Rua Exemplo ",
        bairro: " Centro  ",
        localidade: "  Cidade Exemplo ",
        uf: "MG",
      }),
    ).toEqual({
      tipo: "achou",
      endereco: {
        logradouro: "Rua Exemplo",
        bairro: "Centro",
        localidade: "Cidade Exemplo",
        uf: "MG",
      },
    });
  });

  it("campo que não é texto (número, nulo) vira vazio, não 'null' nem '5'", () => {
    expect(
      viaCep.ler({
        logradouro: null,
        bairro: 5,
        localidade: "Cidade Exemplo",
        uf: "MG",
      }),
    ).toEqual({
      tipo: "achou",
      endereco: {
        logradouro: "",
        bairro: "",
        localidade: "Cidade Exemplo",
        uf: "MG",
      },
    });
  });
});

describe("AwesomeAPI — o que NÃO é 'CEP não existe'", () => {
  it("`code` diferente de not_found (limite de uso, erro) é inválida, nunca 'naoEncontrado'", () => {
    for (const code of ["too_many_requests", "internal_error", "invalid"]) {
      expect(awesome.ler({ code, message: "x" })).toEqual({
        tipo: "invalida",
      });
    }
  });

  it("`code` ausente com endereço completo continua sendo 'achou'", () => {
    expect(
      awesome.ler({
        address: "Rua Exemplo",
        city: "Cidade Exemplo",
        state: "MG",
      }),
    ).toMatchObject({ tipo: "achou" });
  });
});

describe("AwesomeAPI — número no fim da rua", () => {
  const rua = (address: string) => {
    const lido = awesome.ler({
      address,
      district: "Centro",
      city: "Cidade Exemplo",
      state: "MG",
    });
    return lido.tipo === "achou" ? lido.endereco.logradouro : null;
  };

  it("vírgula colada no número ('Rua Exemplo,52') também corta", () => {
    expect(rua("Rua Exemplo,52")).toBe("Rua Exemplo");
  });

  it("número seguido de texto ('12 Fundos') NÃO é número final: a rua fica inteira", () => {
    expect(rua("Rua Exemplo, 12 Fundos")).toBe("Rua Exemplo, 12 Fundos");
  });

  it("'S/N' em maiúscula e espaço sobrando depois também cortam", () => {
    expect(rua("Rua Exemplo, S/N")).toBe("Rua Exemplo");
    expect(rua("Rua Exemplo, 52   ")).toBe("Rua Exemplo");
  });

  it("número no MEIO da rua (sem vírgula) não é tocado", () => {
    expect(rua("Rua 7 de Setembro")).toBe("Rua 7 de Setembro");
  });
});

describe("OpenCEP — grafia `erro`", () => {
  it("`{ erro: true }` (grafia do ViaCEP) também é 'não encontrado'", () => {
    expect(openCep.ler({ erro: true })).toEqual({ tipo: "naoEncontrado" });
  });

  it("corpo que não é um registro (lista, texto, nulo) é inválido", () => {
    expect(openCep.ler([])).toEqual({ tipo: "invalida" });
    expect(openCep.ler("texto")).toEqual({ tipo: "invalida" });
    expect(openCep.ler(null)).toEqual({ tipo: "invalida" });
  });
});

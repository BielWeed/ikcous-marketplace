// Traduz a resposta de cada provedor de CEP para a forma única da casa.
//
// Os corpos abaixo são RESPOSTAS REAIS, copiadas das chamadas de 03/10/2026
// (curl nos três hosts) — não formatos presumidos da documentação. Dois
// deles são a prova do defeito que motivou a troca: o CEP 40020-000 (Rua
// Chile, Salvador) existe, o OpenCEP e o AwesomeAPI o devolvem, e o ViaCEP
// responde `{"erro":"true"}` como se a cliente tivesse digitado errado.
import { PROVEDORES_DE_CEP } from "@/lib/provedores-de-cep";
import { describe, expect, it } from "vitest";

const [viaCep, openCep, awesome] = PROVEDORES_DE_CEP;

describe("ordem e endereços dos provedores", () => {
  it("ViaCEP primeiro, OpenCEP depois, AwesomeAPI por último — hosts exatos", () => {
    expect(PROVEDORES_DE_CEP.map((p) => p.url("01310100"))).toEqual([
      "https://viacep.com.br/ws/01310100/json/",
      "https://opencep.com/v1/01310100",
      "https://cep.awesomeapi.com.br/json/01310100",
    ]);
  });
});

describe("ViaCEP", () => {
  it("rua de capital: devolve os quatro campos", () => {
    expect(
      viaCep.ler({
        cep: "01310-100",
        logradouro: "Avenida Paulista",
        complemento: "de 612 a 1510 - lado par",
        unidade: "",
        bairro: "Bela Vista",
        localidade: "São Paulo",
        uf: "SP",
        estado: "São Paulo",
      }),
    ).toEqual({
      tipo: "achou",
      endereco: {
        logradouro: "Avenida Paulista",
        bairro: "Bela Vista",
        localidade: "São Paulo",
        uf: "SP",
      },
    });
  });

  it('`{"erro":"true"}` (string, medido) é "não encontrado"', () => {
    expect(viaCep.ler({ erro: "true" })).toEqual({ tipo: "naoEncontrado" });
  });

  it("`erro: true` (booleano, como a doc do ViaCEP) também", () => {
    expect(viaCep.ler({ erro: true })).toEqual({ tipo: "naoEncontrado" });
  });

  it("CEP único de cidade pequena (38500-000): acha, com rua e bairro vazios", () => {
    expect(
      viaCep.ler({
        cep: "38500-000",
        logradouro: "",
        complemento: "",
        unidade: "",
        bairro: "",
        localidade: "Monte Carmelo",
        uf: "MG",
      }),
    ).toEqual({
      tipo: "achou",
      endereco: {
        logradouro: "",
        bairro: "",
        localidade: "Monte Carmelo",
        uf: "MG",
      },
    });
  });

  it("corpo que não é um endereço (HTML, vazio, lista) é inválido, nunca 'achou'", () => {
    expect(viaCep.ler(null)).toEqual({ tipo: "invalida" });
    expect(viaCep.ler("<html>portal</html>")).toEqual({ tipo: "invalida" });
    expect(viaCep.ler([])).toEqual({ tipo: "invalida" });
    expect(viaCep.ler({})).toEqual({ tipo: "invalida" });
  });

  it("sem UF de 2 letras ou sem cidade não vale como endereço", () => {
    expect(viaCep.ler({ localidade: "São Paulo", uf: "" })).toEqual({
      tipo: "invalida",
    });
    expect(viaCep.ler({ localidade: "São Paulo", uf: "São Paulo" })).toEqual({
      tipo: "invalida",
    });
    expect(viaCep.ler({ localidade: "", uf: "SP" })).toEqual({
      tipo: "invalida",
    });
  });
});

describe("OpenCEP", () => {
  it("40020-000 (Rua Chile, Salvador): o CEP que o ViaCEP não acha", () => {
    expect(
      openCep.ler({
        cep: "40020-000",
        logradouro: "Rua Chile",
        complemento: "",
        bairro: "Centro",
        localidade: "Salvador",
        uf: "BA",
        ibge: "2927408",
      }),
    ).toEqual({
      tipo: "achou",
      endereco: {
        logradouro: "Rua Chile",
        bairro: "Centro",
        localidade: "Salvador",
        uf: "BA",
      },
    });
  });

  it('o 404 `{"error":true}` (medido) é "não encontrado"', () => {
    expect(openCep.ler({ error: true })).toEqual({ tipo: "naoEncontrado" });
  });
});

describe("AwesomeAPI", () => {
  it("CEP novo que só ele acha (Ribeirão Preto): mapeia address/district/city/state", () => {
    expect(
      awesome.ler({
        cep: "14015150",
        address_type: "Rua",
        address_name: "Jose Beschizza",
        address: "Rua Jose Beschizza",
        state: "SP",
        district: "Vila Seixas",
        lat: "-21.1",
        lng: "-47.8",
        city: "Ribeirão Preto",
        city_ibge: "3543402",
        ddd: "16",
      }),
    ).toEqual({
      tipo: "achou",
      endereco: {
        logradouro: "Rua Jose Beschizza",
        bairro: "Vila Seixas",
        localidade: "Ribeirão Preto",
        uf: "SP",
      },
    });
  });

  it('tira o número colado na rua ("Avenida Paulista, 52") — o número é campo à parte', () => {
    const lido = awesome.ler({
      address: "Avenida Paulista, 52",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
    expect(lido).toMatchObject({
      tipo: "achou",
      endereco: { logradouro: "Avenida Paulista" },
    });
  });

  it('tira também o "s/n" e o número com letra', () => {
    const rua = (address: string) => {
      const lido = awesome.ler({
        address,
        district: "Centro",
        city: "Juiz de Fora",
        state: "MG",
      });
      return lido.tipo === "achou" ? lido.endereco.logradouro : null;
    };
    expect(rua("Avenida Minas Gerais, s/n")).toBe("Avenida Minas Gerais");
    expect(rua("Rua Halfeld, 414A")).toBe("Rua Halfeld");
  });

  it("não corta o que não é número final (rua com vírgula no meio, faixa de numeração)", () => {
    const rua = (address: string) => {
      const lido = awesome.ler({
        address,
        district: "Espinheiro",
        city: "Recife",
        state: "PE",
      });
      return lido.tipo === "achou" ? lido.endereco.logradouro : null;
    };
    expect(rua("Rua do Espinheiro - até 468/469")).toBe(
      "Rua do Espinheiro - até 468/469",
    );
  });

  it("CEP único de cidade (38500-000): rua e bairro vazios, cidade e UF presentes", () => {
    expect(
      awesome.ler({
        cep: "38500000",
        address_type: "",
        address_name: "",
        address: "",
        state: "MG",
        district: "",
        city: "Monte Carmelo",
        city_ibge: "3143104",
        ddd: "34",
      }),
    ).toEqual({
      tipo: "achou",
      endereco: {
        logradouro: "",
        bairro: "",
        localidade: "Monte Carmelo",
        uf: "MG",
      },
    });
  });

  it('o 404 `{"code":"not_found"}` (medido) é "não encontrado"', () => {
    expect(
      awesome.ler({
        code: "not_found",
        message: "O CEP 29900000 nao foi encontrado",
      }),
    ).toEqual({ tipo: "naoEncontrado" });
  });

  it("JSON de outro formato (sem city/state) é inválido", () => {
    expect(awesome.ler({ foo: "bar" })).toEqual({ tipo: "invalida" });
  });
});

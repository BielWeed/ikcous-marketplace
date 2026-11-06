// O número da casa entra na busca do mapa SEMPRE, a menos que a rua já termine
// nele. A regra antiga do painel ("a rua contém o número?") perdia o número de
// quem mora na "Rua 15 de Novembro, nº 15" e apontava a rua inteira.
import {
  buscaDoMapaDoEndereco,
  queryMapsDoEndereco,
} from "@/lib/query-maps-do-endereco";
import { describe, expect, it } from "vitest";

const base = { city: "Patos de Minas", state: "MG" };

describe("buscaDoMapaDoEndereco — o número da casa", () => {
  it("rua com o número no MEIO do nome ainda leva o número", () => {
    expect(
      buscaDoMapaDoEndereco({
        ...base,
        street: "Rua 15 de Novembro",
        number: "15",
      }),
    ).toBe("Rua 15 de Novembro, 15, Patos de Minas, MG");
  });

  it("rua que já termina no número não repete o número", () => {
    expect(
      buscaDoMapaDoEndereco({
        ...base,
        street: "Rua das Flores, 123",
        number: "123",
      }),
    ).toBe("Rua das Flores, 123, Patos de Minas, MG");
    expect(
      buscaDoMapaDoEndereco({
        ...base,
        street: "Av. Brasil 100",
        number: "100",
      }),
    ).toBe("Av. Brasil 100, Patos de Minas, MG");
  });

  it("número que só aparece como pedaço de outro ('1' em 'Rua 11') não conta como já escrito", () => {
    expect(
      buscaDoMapaDoEndereco({ ...base, street: "Rua 11", number: "1" }),
    ).toBe("Rua 11, 1, Patos de Minas, MG");
  });

  it("sem rua e sem CEP não há busca (o chamador decide o reserva)", () => {
    expect(buscaDoMapaDoEndereco({ ...base, number: "10" })).toBeNull();
    expect(queryMapsDoEndereco({ ...base, number: "10" })).toBeNull();
  });
});

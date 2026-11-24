// O endereço que o motoboy lê no papel (e a ficha na tela) sai de
// `linhasDoEndereco`. Duas bordas que o teste vizinho (que cobre o controle de
// direção) e o do papel completo não prendiam:
//   - cidade preenchida e ESTADO vazio: sai só "Uberlândia", nunca "Uberlândia/"
//     com a barra pendurada;
//   - espaço nas pontas de CADA campo (rua, bairro, CEP...) não vira espaço duplo
//     nem deixa linha "vazia" no papel.
import { linhasDoEndereco } from "@/lib/linhas-do-endereco-do-pedido";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

function cliente(extra: Partial<Order["customer"]>): Order["customer"] {
  return {
    name: "Pessoa de Teste",
    whatsapp: "",
    address: "Rua de Teste",
    number: "10",
    neighborhood: "Centro",
    ...extra,
  };
}

describe("linhas do endereço do pedido — bordas de texto", () => {
  it.each(["", "   ", undefined])(
    "cidade sem estado (%j) sai sem a barra: 'Uberlândia', não 'Uberlândia/'",
    (estado) => {
      expect(
        linhasDoEndereco(cliente({ city: "Uberlândia", state: estado })),
      ).toEqual(["Rua de Teste, 10", "Centro • Uberlândia"]);
    },
  );

  it("espaço nas pontas de cada campo é aparado, sem espaço duplo nem separador solto", () => {
    expect(
      linhasDoEndereco(
        cliente({
          address: "  Rua de Teste  ",
          number: " 10 ",
          complement: "  bloco B  ",
          neighborhood: "  Centro  ",
          city: "  Uberlândia ",
          state: " MG  ",
          cep: "  38400-000 ",
          reference: " perto da praça  ",
        }),
      ),
    ).toEqual([
      "Rua de Teste, 10 - bloco B",
      "Centro • Uberlândia/MG • CEP: 38400-000 • Ref: perto da praça",
    ]);
  });

  it("CEP só com espaços não imprime 'CEP:' sozinho, e bairro só com espaços não abre a linha", () => {
    expect(
      linhasDoEndereco(
        cliente({
          neighborhood: "   ",
          city: "Uberlândia",
          state: "MG",
          cep: "   ",
        }),
      ),
    ).toEqual(["Rua de Teste, 10", "Uberlândia/MG"]);
  });

  it("rua só com espaços some, e o número fica sozinho sem vírgula na frente", () => {
    expect(
      linhasDoEndereco(
        cliente({ address: "   ", number: "10", neighborhood: "" }),
      ),
    ).toEqual(["10"]);
  });
});

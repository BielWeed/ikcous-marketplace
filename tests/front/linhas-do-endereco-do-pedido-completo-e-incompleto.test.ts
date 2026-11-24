import { linhasDoEndereco } from "@/lib/linhas-do-endereco-do-pedido";
import { describe, expect, it } from "vitest";

import type { Order } from "@/types";

// O endereço do pedido é o que a cliente confere na ficha de "Meus pedidos" e
// o que o motoboy lê no recibo impresso. O teste vizinho só cobre o complemento
// com caractere de controle: trocar o separador " • " ou tirar o "Ref:" da
// segunda linha deixava a suíte inteira verde.
type Cliente = Order["customer"];
const base: Cliente = { name: "Pessoa de Teste", whatsapp: "" };

describe("linhasDoEndereco — endereço completo", () => {
  it("monta a rua, o complemento e a segunda linha na ordem e com os separadores da ficha", () => {
    const cliente: Cliente = {
      ...base,
      address: "Rua de Teste",
      number: "10",
      complement: "Bloco B, apto 302",
      neighborhood: "Centro",
      city: "Uberlândia",
      state: "MG",
      cep: "38400-000",
      reference: "Portão azul",
    };

    expect(linhasDoEndereco(cliente)).toEqual([
      "Rua de Teste, 10 - Bloco B, apto 302",
      "Centro • Uberlândia/MG • CEP: 38400-000 • Ref: Portão azul",
    ]);
  });
});

describe("linhasDoEndereco — campo vazio não deixa rastro", () => {
  it("cidade sem estado não ganha barra solta", () => {
    expect(
      linhasDoEndereco({
        ...base,
        address: "Rua de Teste",
        number: "10",
        city: "Uberlândia",
      }),
    ).toEqual(["Rua de Teste, 10", "Uberlândia"]);
  });

  it("estado sem cidade não aparece sozinho", () => {
    expect(
      linhasDoEndereco({
        ...base,
        address: "Rua de Teste",
        number: "10",
        state: "MG",
      }),
    ).toEqual(["Rua de Teste, 10"]);
  });

  it("só a referência: o rótulo 'Ref:' vem junto, sem separador sobrando", () => {
    expect(
      linhasDoEndereco({
        ...base,
        address: "Rua de Teste",
        reference: "Ao lado da padaria",
      }),
    ).toEqual(["Rua de Teste", "Ref: Ao lado da padaria"]);
  });

  it("só o CEP: o rótulo 'CEP:' vem junto", () => {
    expect(linhasDoEndereco({ ...base, cep: "38400-000" })).toEqual([
      "CEP: 38400-000",
    ]);
  });

  it("rua sem número e sem complemento não ganha vírgula nem hífen", () => {
    expect(linhasDoEndereco({ ...base, address: "Rua de Teste" })).toEqual([
      "Rua de Teste",
    ]);
  });

  it("sem nenhum dado de endereço devolve lista vazia (nada de linha em branco)", () => {
    expect(linhasDoEndereco(base)).toEqual([]);
    expect(
      linhasDoEndereco({ ...base, address: "  ", number: "", city: " " }),
    ).toEqual([]);
  });

  it("espaços nas pontas dos campos são aparados", () => {
    expect(
      linhasDoEndereco({
        ...base,
        address: "  Rua de Teste ",
        number: " 10 ",
        neighborhood: " Centro ",
      }),
    ).toEqual(["Rua de Teste, 10", "Centro"]);
  });
});

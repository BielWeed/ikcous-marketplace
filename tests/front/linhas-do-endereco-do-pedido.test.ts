import { linhasDoEndereco } from "@/lib/linhas-do-endereco-do-pedido";
import { describe, expect, it } from "vitest";

describe("linhas do endereço do pedido", () => {
  it("exibe o complemento gravado sem o controle que inverte os dígitos", () => {
    const cliente = {
      name: "Pessoa de Teste",
      whatsapp: "",
      address: "Rua de Teste",
      number: "10",
      complement: "Apto \u{202E}120",
      reference: "\u{200B} \u{2060}",
    } satisfies Parameters<typeof linhasDoEndereco>[0];

    expect(linhasDoEndereco(cliente)).toEqual(["Rua de Teste, 10 - Apto 120"]);
  });
});

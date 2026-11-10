// @vitest-environment node
import { montarMensagemDeCompartilhar } from "@/lib/mensagem-de-compartilhar";
import { describe, expect, it } from "vitest";

describe("mensagem de compartilhar — marcadores repetidos", () => {
  it("substitui todas as ocorrências de cada marcador do modelo", () => {
    // Tirar a opção global do replace deixaria a segunda ocorrência crua.
    const resultado = montarMensagemDeCompartilhar(
      "[nome] / [nome] — [preco] / [preco] — [link] / [link]",
      {
        nome: "Camisa",
        preco: "R$ 49,90",
        link: "https://loja.exemplo/product-detail?id=produto-inventado",
      },
    );

    const esperado =
      "Camisa / Camisa — R$ 49,90 / R$ 49,90 — https://loja.exemplo/product-detail?id=produto-inventado / https://loja.exemplo/product-detail?id=produto-inventado";
    expect(resultado).toEqual({
      texto: esperado,
      temLink: true,
      completa: esperado,
    });
  });
});

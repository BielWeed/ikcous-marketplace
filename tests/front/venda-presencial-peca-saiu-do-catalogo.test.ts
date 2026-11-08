// Balcão — uma peça do cupom foi desativada ou apagada no catálogo depois de
// entrar na venda. O banco recusa com "Produto não encontrado não disponível."
// (o nome vem vazio porque a peça não é achada). Antes a tela mostrava essa
// frase truncada, travava o botão Registrar e deixava só "Começar uma venda
// nova" (que apaga a venda inteira). Agora a frase diz o que aconteceu e o que
// fazer, e a venda pode ser registrada de novo depois de tirar a peça.
import { mensagemDaFalhaDaVenda } from "@/lib/erro-da-venda-presencial";
import { describe, expect, it } from "vitest";

describe("mensagemDaFalhaDaVenda — peça que saiu do catálogo", () => {
  it("sem o nome da peça: diz que alguma peça saiu do catálogo e o que fazer, sem travar o Registrar", () => {
    const r = mensagemDaFalhaDaVenda({
      code: "22023",
      message: "Produto não encontrado não disponível.",
    });

    expect(r.mensagem).toContain("saiu do catálogo");
    expect(r.mensagem).toContain("tire");
    expect(r.mensagem).toContain("registre de novo");
    // Nada do texto truncado do banco chega à tela.
    expect(r.mensagem).not.toContain("não encontrado não disponível");
    // O botão Registrar não fica preso e a saída NÃO é apagar a venda inteira.
    expect(r.podeTentarDeNovo).toBe(true);
    expect(r.precisaEntrarDeNovo).toBe(false);
  });

  it("com o nome da peça: cita a peça", () => {
    const r = mensagemDaFalhaDaVenda({
      code: "22023",
      message: "Produto Camiseta Lisa não disponível.",
    });

    expect(r.mensagem).toContain("Camiseta Lisa");
    expect(r.mensagem).toContain("saiu do catálogo");
    expect(r.podeTentarDeNovo).toBe(true);
  });

  it("outras recusas 22023 seguem como estavam (frase do banco, sem tentar de novo)", () => {
    expect(
      mensagemDaFalhaDaVenda({
        code: "22023",
        message: "Informe o motivo do desconto.",
      }),
    ).toEqual({
      mensagem: "Informe o motivo do desconto.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: false,
    });
  });

  it("a mesma frase com OUTRO código de erro não é tratada como peça fora do catálogo", () => {
    const r = mensagemDaFalhaDaVenda({
      code: "42501",
      message: "Produto não encontrado não disponível.",
    });
    expect(r.precisaEntrarDeNovo).toBe(true);
    expect(r.mensagem).not.toContain("saiu do catálogo");
  });
});

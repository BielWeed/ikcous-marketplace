// A mensagem que o botão de WhatsApp do painel abre para a cliente. Até a
// 1.5.107 ela dizia só "foi atualizado. Status: Enviado", sem o código de
// rastreio: a lojista tinha de digitar o código à mão, e a cliente que comprou
// como convidada (sem conta, sem sino, sem e-mail) não recebia nada além disso.
//
// Regra travada aqui: o texto é IDÊNTICO ao de antes em todo caso sem rastreio
// (o teste `admin-orders-whatsapp-usa-o-nome-da-loja` já fixa o byte a byte do
// pedido novo); só ganha duas linhas quando o pedido está ENVIADO, é de ENTREGA
// e tem código.
import { describe, expect, it } from "vitest";
import { mensagemDoStatusNoWhatsapp } from "@/lib/mensagem-do-status-no-whatsapp";

const base = {
  nomeDoCliente: "Ana",
  numeroDoPedido: "A1B2C3",
  rotuloDoStatus: "Em Trânsito",
  nomeDaLoja: "Savy",
  status: "shipping" as const,
  retiradaNaLoja: false,
};

describe("mensagemDoStatusNoWhatsapp", () => {
  it("sem rastreio, o texto é o de sempre, byte a byte", () => {
    expect(mensagemDoStatusNoWhatsapp(base)).toBe(
      "Olá Ana!\n\nSeu pedido #A1B2C3 foi atualizado.\nStatus: Em Trânsito\n\nObrigado por comprar na Savy!",
    );
  });

  it("enviado, de entrega e com código: leva o código e o link de rastreio", () => {
    expect(
      mensagemDoStatusNoWhatsapp({ ...base, codigoDeRastreio: "AB123456789BR" }),
    ).toBe(
      "Olá Ana!\n\nSeu pedido #A1B2C3 foi atualizado.\nStatus: Em Trânsito\n" +
        "Código de rastreio: AB123456789BR\n" +
        "Acompanhe a entrega: https://www.melhorrastreio.com.br/rastreio/AB123456789BR\n\n" +
        "Obrigado por comprar na Savy!",
    );
  });

  it("limpa o código como o resto do app: sem espaços e em maiúsculas", () => {
    const msg = mensagemDoStatusNoWhatsapp({
      ...base,
      codigoDeRastreio: " ab 123 456 789 br\n",
    });
    expect(msg).toContain("Código de rastreio: AB123456789BR\n");
    expect(msg).toContain("/rastreio/AB123456789BR\n");
  });

  it("código vazio, só espaços ou nulo não vira linha de rastreio", () => {
    const semRastreio = mensagemDoStatusNoWhatsapp(base);
    for (const codigo of ["", "   ", "\n", null, undefined]) {
      expect(mensagemDoStatusNoWhatsapp({ ...base, codigoDeRastreio: codigo })).toBe(
        semRastreio,
      );
    }
  });

  it("retirada na loja nunca leva rastreio (ninguém está levando nada)", () => {
    const msg = mensagemDoStatusNoWhatsapp({
      ...base,
      rotuloDoStatus: "Pronto para retirar",
      retiradaNaLoja: true,
      codigoDeRastreio: "AB123456789BR",
    });
    expect(msg).not.toContain("rastreio");
    expect(msg).not.toContain("Acompanhe");
  });

  it("fora de 'enviado' não leva rastreio, mesmo com código gravado", () => {
    for (const status of ["pending", "processing", "delivered", "cancelled"] as const) {
      const msg = mensagemDoStatusNoWhatsapp({
        ...base,
        status,
        codigoDeRastreio: "AB123456789BR",
      });
      expect(msg, status).not.toContain("rastreio");
    }
  });

  it("o nome do cliente e da loja entram sem tratamento extra (como antes)", () => {
    const msg = mensagemDoStatusNoWhatsapp({
      ...base,
      nomeDoCliente: "Cliente",
      nomeDaLoja: "Loja & Cia",
    });
    expect(msg.startsWith("Olá Cliente!")).toBe(true);
    expect(msg.endsWith("Obrigado por comprar na Loja & Cia!")).toBe(true);
  });
});

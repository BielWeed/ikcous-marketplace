import {
  mensagemDoStatusNoWhatsapp,
  rotuloDoStatusParaACliente,
} from "@/lib/mensagem-do-status-no-whatsapp";
// A mensagem que o botão de WhatsApp do painel abre para a cliente. Até a
// 1.5.107 ela dizia só "foi atualizado. Status: Enviado", sem o código de
// rastreio: a lojista tinha de digitar o código à mão, e a cliente que comprou
// como convidada (sem conta, sem sino, sem e-mail) não recebia nada além disso.
//
// Só ganha instruções extras para entrega com rastreio ou retirada pronta
// com endereço ou horário disponíveis.
import { describe, expect, it } from "vitest";

const base = {
  nomeDoCliente: "Ana",
  numeroDoPedido: "A1B2C3",
  rotuloDoStatus: "Em Trânsito",
  nomeDaLoja: "Savy",
  status: "shipping" as const,
  retiradaNaLoja: false,
};

const retiradaPronta = {
  ...base,
  retiradaNaLoja: true,
  rotuloDoStatus: "Pronto para retirar",
};
const enderecoDeRetirada = "Rua São José, #42 & Cia";
const horarioDeAtendimento = "Seg a sex, das 9h às 18h";

describe("mensagemDoStatusNoWhatsapp", () => {
  it("diz que o pedido está em separação, não que já foi separado", () => {
    const msg = mensagemDoStatusNoWhatsapp({
      ...base,
      status: "processing",
      rotuloDoStatus: rotuloDoStatusParaACliente("processing"),
    });
    expect(msg).toContain("Status: Em separação\n");
  });

  it.each([
    [
      enderecoDeRetirada,
      horarioDeAtendimento,
      "Retire em: Rua São José, #42 & Cia\nHorário: Seg a sex, das 9h às 18h\n",
    ],
    [enderecoDeRetirada, undefined, "Retire em: Rua São José, #42 & Cia\n"],
    [null, horarioDeAtendimento, "Horário: Seg a sex, das 9h às 18h\n"],
    [undefined, undefined, ""],
    ["  ", "  ", ""],
  ])(
    "retirada pronta com endereço %s e horário %s",
    (endereco, horario, linhas) => {
      const dados = {
        ...retiradaPronta,
        enderecoDeRetirada: endereco,
        horarioDeAtendimento: horario,
      };
      expect(mensagemDoStatusNoWhatsapp(dados)).toBe(
        `Olá Ana!\n\nSeu pedido #A1B2C3 foi atualizado.\nStatus: Pronto para retirar\n${linhas}\nObrigado por comprar na Savy!`,
      );
    },
  );

  it("limita endereço e horário mesmo quando os caracteres ocupam mais na URL", () => {
    const mensagem = mensagemDoStatusNoWhatsapp({
      ...retiradaPronta,
      enderecoDeRetirada: "界".repeat(5000),
      horarioDeAtendimento: "á".repeat(5000),
    });
    const url = `https://wa.me/5534999999999?text=${encodeURIComponent(mensagem)}`;
    expect(url.length).toBeLessThan(2000);
    expect(mensagem).toMatch(/Retire em: 界+…\nHorário: á+…\n/);
    expect(new URL(url).searchParams.get("text")).toBe(mensagem);
  });

  it("entrega a caminho não usa os dados de retirada", () => {
    const dados = {
      ...base,
      rotuloDoStatus: "A caminho",
      enderecoDeRetirada,
      horarioDeAtendimento,
    };
    expect(mensagemDoStatusNoWhatsapp(dados)).toBe(
      "Olá Ana!\n\nSeu pedido #A1B2C3 foi atualizado.\nStatus: A caminho\n\nObrigado por comprar na Savy!",
    );
  });
  it("sem rastreio, o texto é o de sempre, byte a byte", () => {
    expect(mensagemDoStatusNoWhatsapp(base)).toBe(
      "Olá Ana!\n\nSeu pedido #A1B2C3 foi atualizado.\nStatus: Em Trânsito\n\nObrigado por comprar na Savy!",
    );
  });

  it("enviado, de entrega e com código: leva o código e o link de rastreio", () => {
    expect(
      mensagemDoStatusNoWhatsapp({
        ...base,
        codigoDeRastreio: "AB123456789BR",
      }),
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
      expect(
        mensagemDoStatusNoWhatsapp({ ...base, codigoDeRastreio: codigo }),
      ).toBe(semRastreio);
    }
  });

  it("código legado só com pontuação não acrescenta código nem link à mensagem", () => {
    expect(
      mensagemDoStatusNoWhatsapp({ ...base, codigoDeRastreio: ".." }),
    ).toBe(mensagemDoStatusNoWhatsapp(base));
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
    for (const status of [
      "pending",
      "processing",
      "delivered",
      "cancelled",
    ] as const) {
      const msg = mensagemDoStatusNoWhatsapp({
        ...base,
        status,
        codigoDeRastreio: "AB123456789BR",
      });
      expect(msg, status).not.toContain("rastreio");
    }
  });

  it("pedido cancelado não agradece a compra: avisa o cancelamento e abre a conversa", () => {
    const msg = mensagemDoStatusNoWhatsapp({
      ...base,
      status: "cancelled",
      rotuloDoStatus: "Cancelado",
    });
    expect(msg).toBe(
      "Olá Ana!\n\nSeu pedido #A1B2C3 foi atualizado.\nStatus: Cancelado\n\n" +
        "Qualquer dúvida sobre o cancelamento, é só responder esta mensagem.",
    );
    expect(msg).not.toContain("Obrigado");
  });

  it("retirada concluída diz 'Retirado' e mantém o fecho de agradecimento", () => {
    const msg = mensagemDoStatusNoWhatsapp({
      ...base,
      status: "delivered",
      retiradaNaLoja: true,
      rotuloDoStatus: rotuloDoStatusParaACliente("delivered", true),
    });
    expect(msg).toContain("Status: Retirado\n");
    expect(msg).not.toContain("Entregue");
    expect(msg.endsWith("Obrigado por comprar na Savy!")).toBe(true);
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

  // Pedido antigo com o nome só de espaços: o `||` do chamador tomava "   "
  // por nome e a mensagem abria "Olá    !". O nome é tratado aqui, na fonte.
  it.each([
    ["só espaços", "   ", "Olá Cliente!"],
    ["vazio", "", "Olá Cliente!"],
    ["com espaços nas pontas", "  Maria  ", "Olá Maria!"],
    ["com espaços sobrando no meio", "  Maria   Silva ", "Olá Maria Silva!"],
  ])("nome do cliente %s", (_descricao, nomeDoCliente, abertura) => {
    const msg = mensagemDoStatusNoWhatsapp({ ...base, nomeDoCliente });
    expect(
      msg.startsWith(`${abertura}

`),
    ).toBe(true);
  });
});

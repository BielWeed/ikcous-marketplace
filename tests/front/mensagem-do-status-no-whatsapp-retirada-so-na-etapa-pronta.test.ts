// As orientações de retirada ("Retire em: ...", "Horário: ...", "Confirme o
// horário...") só fazem sentido quando o pedido está PRONTO para retirar
// (status `shipping` numa retirada na loja). Em qualquer outra etapa a cliente
// não precisa mais (ou ainda não precisa) delas: um pedido já retirado, ainda
// em separação ou cancelado não manda a loja nem o horário de novo. Caça por
// mutação 25/11/2026: tirar a condição de etapa deixava a mensagem do pedido
// "Retirado" repetir o endereço, e nenhum teste reclamava.
import { mensagemDoStatusNoWhatsapp } from "@/lib/mensagem-do-status-no-whatsapp";
import { describe, expect, it } from "vitest";

const base = {
  nomeDoCliente: "Ana",
  numeroDoPedido: "A1B2C3",
  rotuloDoStatus: "Retirado",
  nomeDaLoja: "Loja Exemplo",
  retiradaNaLoja: true,
  enderecoDeRetirada: "Rua das Flores, 100",
  horarioDeAtendimento: "Seg a sex, 9h às 18h",
};

describe("mensagem do WhatsApp: orientações de retirada só na etapa pronta", () => {
  it.each(["processing", "delivered", "cancelled", "new"])(
    "retirada na loja com status %s não traz endereço, horário nem pedido de confirmação",
    (status) => {
      const mensagem = mensagemDoStatusNoWhatsapp({ ...base, status });

      expect(mensagem).not.toContain("Retire em:");
      expect(mensagem).not.toContain("Rua das Flores");
      expect(mensagem).not.toContain("Horário:");
      expect(mensagem).not.toContain("Confirme o horário");
    },
  );

  it("o mesmo pedido pronto para retirar (shipping) traz endereço e horário", () => {
    const mensagem = mensagemDoStatusNoWhatsapp({
      ...base,
      status: "shipping",
      rotuloDoStatus: "Pronto para retirar",
    });

    expect(mensagem).toContain("Retire em: Rua das Flores, 100\n");
    expect(mensagem).toContain("Horário: Seg a sex, 9h às 18h\n");
  });

  it("pronto para retirar sem endereço nem horário ainda manda confirmar o horário", () => {
    const mensagem = mensagemDoStatusNoWhatsapp({
      ...base,
      status: "shipping",
      rotuloDoStatus: "Pronto para retirar",
      enderecoDeRetirada: null,
      horarioDeAtendimento: undefined,
    });

    expect(mensagem).not.toContain("Retire em:");
    expect(mensagem).toContain(
      "Confirme o horário de retirada com a loja antes de vir.\n",
    );
  });
});

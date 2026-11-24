// O que este teste protege, nas máscaras e mensagens de WhatsApp
// (`@/lib/telefone-br`) — os pontos de virada que os testes vizinhos não pisam:
//  - com 2 e com 7 dígitos a máscara não deixa "(34) " nem "(34) 99999-"
//    pendurados (parênteses, espaço ou hífen sem número depois);
//  - "+55 " com espaço sobrando volta aparado, igual nas duas máscaras;
//  - colar dígitos DEPOIS de um número já completo (13 dígitos) não descarta
//    os 2 últimos em silêncio: a pessoa vê o excesso e a validação recusa;
//  - colagem enorme guarda exatamente 15 dígitos;
//  - a mensagem de erro só diz "DDD inválido" para celular de 11 dígitos com
//    o 9 no lugar certo; fora disso, manda conferir DDD + 9 + 8 dígitos;
//  - número estrangeiro com 12+ dígitos formatado à mão não perde dígito no
//    corte de 15 caracteres do cadastro.
import { describe, expect, it } from "vitest";

import {
  celularBrasileiroCompleto,
  mascaraTelefoneDoCadastro,
  mascaraWhatsappBr,
  mensagemDeWhatsappIncompleto,
} from "@/lib/telefone-br";

const mascaras = [
  ["checkout/busca de pedido", mascaraWhatsappBr],
  ["cadastro", mascaraTelefoneDoCadastro],
] as const;

describe.each(mascaras)(
  "pontos de virada da máscara — %s",
  (_nome, mascara) => {
    it("com 2 dígitos mostra só o DDD, sem parêntese nem espaço pendurado", () => {
      expect(mascara("34", "3")).toBe("34");
    });

    it("com 3 dígitos abre o parêntese do DDD", () => {
      expect(mascara("349", "34")).toBe("(34) 9");
    });

    it("com 7 dígitos ainda não pendura o hífen", () => {
      expect(mascara("3499999", "349999")).toBe("(34) 99999");
    });

    it("com 8 dígitos o hífen entra", () => {
      expect(mascara("34999991", "3499999")).toBe("(34) 99999-1");
    });

    it("'+55 ' com espaço sobrando volta aparado", () => {
      expect(mascara(" +55 ", "")).toBe("+55");
      expect(mascara("+5 ", "")).toBe("+5");
    });

    it("colar 2 dígitos depois de um número completo NÃO descarta os 2 em silêncio", () => {
      const campo = mascara("(11) 98765-432199", "(11) 98765-4321");
      expect(campo.replace(/\D/g, "")).toBe("1198765432199");
      expect(celularBrasileiroCompleto(campo)).toBe(false);
    });

    it("colagem enorme é limitada a exatamente 15 dígitos", () => {
      const campo = mascara("1198765432112345678", "");
      expect(campo.replace(/\D/g, "")).toBe("119876543211234");
      expect(celularBrasileiroCompleto(campo)).toBe(false);
    });
  },
);

describe("mascaraTelefoneDoCadastro — número estrangeiro formatado à mão", () => {
  it("12 dígitos em exatamente 15 caracteres ficam como foram digitados", () => {
    // 12 dígitos + 3 separadores = 15 caracteres: o corte de 15 não pode tirar nada.
    expect(mascaraTelefoneDoCadastro("12 3456 7890 12", "")).toBe(
      "12 3456 7890 12",
    );
  });

  it("texto com mais de 15 caracteres cai para os dígitos, sem perder nenhum", () => {
    const campo = mascaraTelefoneDoCadastro("12 3456 7890 12 34", "");
    expect(campo.replace(/\D/g, "")).toBe("12345678901234");
  });
});

describe("mensagemDeWhatsappIncompleto — qual aviso aparece", () => {
  it("celular de 11 dígitos com DDD que não existe diz 'DDD inválido'", () => {
    expect(mensagemDeWhatsappIncompleto("(10) 99999-1234")).toBe(
      "Confira o WhatsApp: DDD inválido",
    );
  });

  it("11 dígitos com DDD inexistente mas SEM o 9 não é 'DDD inválido': manda conferir o formato", () => {
    expect(mensagemDeWhatsappIncompleto("10888881234")).toBe(
      "Confira o WhatsApp: precisa de DDD + 9 + 8 dígitos",
    );
  });

  it("12 dígitos com DDD inexistente e o 9 no lugar NÃO diz 'DDD inválido'", () => {
    expect(mensagemDeWhatsappIncompleto("109999912345")).toBe(
      "Confira o WhatsApp: precisa de DDD + 9 + 8 dígitos",
    );
  });

  it("10 dígitos diz que faltou um número", () => {
    expect(mensagemDeWhatsappIncompleto("(34) 9888-7777")).toBe(
      "Confira o WhatsApp: faltou um número (DDD + 9 + 8 dígitos)",
    );
  });

  it("9 dígitos não é 'faltou um número': mostra o aviso geral", () => {
    expect(mensagemDeWhatsappIncompleto("349888777")).toBe(
      "Confira o WhatsApp: precisa de DDD + 9 + 8 dígitos",
    );
  });
});

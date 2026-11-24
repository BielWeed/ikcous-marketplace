// Protege duas bordas de src/lib/telefone-br.ts que nenhum teste vizinho olha:
//
// 1) O campo guarda "+", "+5" e "+55" como estão (a pessoa ainda está
//    digitando o código do país). Era `/^\+5{0,2}$/`; ao afrouxar para `{0,3}`
//    o "+555" passava a ficar CRU na tela ("+555") em vez de virar o número
//    que a pessoa começou a digitar ("5") — sem nenhum teste cair. As duas
//    máscaras (cadastro e checkout/busca) têm a mesma guarda.
// 2) `mensagemDeWhatsappIncompleto` só é chamada quando o celular NÃO está
//    completo, mas a função é pública: com um celular completo e DDD válido
//    ela não pode acusar "DDD inválido" (o ramo do DDD exige DDD inexistente).
import {
  celularBrasileiroCompleto,
  mascaraTelefoneDoCadastro,
  mascaraWhatsappBr,
  mensagemDeWhatsappIncompleto,
} from "@/lib/telefone-br";
import { describe, expect, it } from "vitest";

const MASCARAS = [
  ["cadastro", mascaraTelefoneDoCadastro],
  ["checkout e busca de pedido", mascaraWhatsappBr],
] as const;

describe.each(MASCARAS)(
  "máscara do %s: código do país ainda sendo digitado",
  (_nome, mascara) => {
    it.each(["+", "+5", "+55"])("%s fica como está no campo", (texto) => {
      expect(mascara(texto)).toBe(texto);
    });

    it("um terceiro 5 depois do +55 já é número: o + e o código do país saem", () => {
      // "+55" é o país, o terceiro "5" é o primeiro dígito do DDD.
      expect(mascara("+555")).toBe("5");
      expect(mascara("+5555")).toBe("55");
    });

    it("digitar tecla a tecla a partir do +55 não trava o campo em '+555'", () => {
      expect(mascara("+555", "+55")).toBe("5");
      expect(mascara("+5551", "+555")).toBe("51");
    });

    it("espaços em volta do + ainda contam como código do país digitado", () => {
      expect(mascara("  +55  ")).toBe("+55");
      expect(mascara("  +555  ")).toBe("5");
    });
  },
);

describe("mensagemDeWhatsappIncompleto com número que já está completo", () => {
  it("celular completo e DDD válido não é chamado de 'DDD inválido'", () => {
    expect(celularBrasileiroCompleto("(34) 99999-8888")).toBe(true);
    expect(mensagemDeWhatsappIncompleto("(34) 99999-8888")).not.toContain(
      "DDD inválido",
    );
  });

  it("celular com DDD que não existe é o único caso que acusa o DDD", () => {
    expect(mensagemDeWhatsappIncompleto("(10) 99999-8888")).toBe(
      "Confira o WhatsApp: DDD inválido",
    );
  });

  it("fixo de 10 dígitos diz que faltou um número, com DDD válido ou não", () => {
    expect(mensagemDeWhatsappIncompleto("(34) 8888-7777")).toBe(
      "Confira o WhatsApp: faltou um número (DDD + 9 + 8 dígitos)",
    );
    expect(mensagemDeWhatsappIncompleto("(10) 8888-7777")).toBe(
      "Confira o WhatsApp: faltou um número (DDD + 9 + 8 dígitos)",
    );
  });
});

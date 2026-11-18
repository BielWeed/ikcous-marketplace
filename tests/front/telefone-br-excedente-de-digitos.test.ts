// EXCEDENTE DE DÍGITOS NO WHATSAPP (caça de 18/11/2026): a máscara cortava em
// silêncio tudo depois do 11º dígito. "1198765432199" (13 dígitos, colagem de
// lixo) virava "(11) 98765-4321", que passa como celular completo — a cliente
// não via que o número mudou e o pedido saía com outro WhatsApp. Agora o
// excedente fica NA TELA, o número fica inválido e a mensagem de erro que já
// existe aparece. Digitar o 12º dígito no fim de um número completo continua
// sendo ignorado (o número na tela é o mesmo de antes), e o preenchimento
// automático com +55, zero na frente e espaços continua válido.
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

describe.each(mascaras)("excedente de dígitos — %s", (_nome, mascara) => {
  it("colar 13 dígitos sem DDI NÃO vira um celular válido", () => {
    const campo = mascara("1198765432199", "");
    expect(celularBrasileiroCompleto(campo)).toBe(false);
    expect(campo.replace(/\D/g, "")).toBe("1198765432199");
  });

  it("colar o número já com máscara e lixo no fim NÃO vira um celular válido", () => {
    const campo = mascara("(11) 98765-4321 99", "");
    expect(celularBrasileiroCompleto(campo)).toBe(false);
    expect(campo.replace(/\D/g, "")).toBe("1198765432199");
  });

  it("colar +55 com lixo no fim NÃO vira um celular válido", () => {
    const campo = mascara("+55 11 98765-4321 99", "");
    expect(celularBrasileiroCompleto(campo)).toBe(false);
  });

  it("valor que veio de fora (sem `anterior`) também mantém o excedente", () => {
    const campo = mascara("1198765432199");
    expect(celularBrasileiroCompleto(campo)).toBe(false);
  });

  it("a mensagem de erro que já existe aparece para o número com excedente", () => {
    const campo = mascara("1198765432199", "");
    expect(mensagemDeWhatsappIncompleto(campo)).toBe(
      "Confira o WhatsApp: precisa de DDD + 9 + 8 dígitos",
    );
  });

  it("colagem enorme é limitada a 15 dígitos e continua inválida", () => {
    const campo = mascara("119876543211198765432119876543211", "");
    expect(campo.replace(/\D/g, "").length).toBeLessThanOrEqual(15);
    expect(celularBrasileiroCompleto(campo)).toBe(false);
  });

  it("inserir um dígito no MEIO de um número completo não perde o último", () => {
    const campo = mascara("(11) 998765-4321", "(11) 98765-4321");
    expect(campo.replace(/\D/g, "")).toBe("119987654321");
    expect(celularBrasileiroCompleto(campo)).toBe(false);
  });

  it("apagar o excedente, um a um, devolve o celular válido", () => {
    let campo = mascara("1198765432199", "");
    expect(celularBrasileiroCompleto(campo)).toBe(false);
    campo = mascara(campo.slice(0, -1), campo);
    expect(celularBrasileiroCompleto(campo)).toBe(false);
    campo = mascara(campo.slice(0, -1), campo);
    expect(campo).toBe("(11) 98765-4321");
    expect(celularBrasileiroCompleto(campo)).toBe(true);
  });

  it("o 12º dígito digitado no fim de um número completo continua ignorado", () => {
    expect(mascara("(11) 98765-43219", "(11) 98765-4321")).toBe(
      "(11) 98765-4321",
    );
  });

  it.each([
    "+55 (11) 98765-4321",
    "+5511987654321",
    "55 11 98765-4321",
    "011 98765-4321",
    "0055 11 98765-4321",
    "(11) 98765-4321",
    "11987654321",
  ])("preenchimento automático %s continua válido", (texto) => {
    const campo = mascara(texto, "");
    expect(campo).toBe("(11) 98765-4321");
    expect(celularBrasileiroCompleto(campo)).toBe(true);
  });
});

describe("excedente — o número estrangeiro do cadastro segue como estava", () => {
  it("+351 912 345 678 colado mantém o texto (corte em 15)", () => {
    expect(mascaraTelefoneDoCadastro("+351912345678", "")).toBe(
      "+351912345678",
    );
  });
});

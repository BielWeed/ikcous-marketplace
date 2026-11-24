// Caça por mutação em `src/lib/telefone-br.ts` (WhatsApp do checkout e do
// cadastro). Trocas que sobreviviam aos testes que já existem:
//   - colagem de FIXO com operadora ("014 34 3333-1234": 12 dígitos depois do 0);
//   - `ehColagemDeTelefone`: 2 dígitos de uma vez já é colagem; "+" também;
//   - valor que veio de fora (sem `anterior`) conta como colagem;
//   - a lista de DDDs: não pode faltar nem sobrar nenhum dos 67 do Brasil;
//   - colar 2+ dígitos no fim de um celular completo NÃO pode ser engolido
//     (só a tecla extra, de 1 em 1, é ignorada);
//   - o teto de 15 dígitos da colagem enorme.
// Só números fictícios.
import {
  celularBrasileiroCompleto,
  dddBrasileiroValido,
  digitosComExcedenteVisivel,
  digitosDoTelefoneDoCampo,
  ehColagemDeTelefone,
  limparTelefoneBrasileiro,
  mascaraTelefoneDoCadastro,
  mascaraWhatsappBr,
} from "@/lib/telefone-br";
import { describe, expect, it } from "vitest";

describe("limparTelefoneBrasileiro — zero e operadora na colagem", () => {
  it("fixo colado com 0 + operadora + DDD (12 dígitos depois do zero) perde a operadora", () => {
    expect(limparTelefoneBrasileiro("014 34 3333-1234")).toBe("3433331234");
  });

  it("celular colado do mesmo jeito (13 dígitos depois do zero) também", () => {
    expect(limparTelefoneBrasileiro("014 34 99999-1234")).toBe("34999991234");
  });

  it("digitando (sem colagem) só o zero sai: a operadora não é adivinhada", () => {
    expect(
      limparTelefoneBrasileiro("014 34 3333-1234", { colagem: false }),
    ).toBe("143433331234");
  });
});

describe("ehColagemDeTelefone", () => {
  it("2 dígitos de uma vez já é colagem; 1 não é", () => {
    expect(ehColagemDeTelefone("34", "")).toBe(true);
    expect(ehColagemDeTelefone("3", "")).toBe(false);
    expect(ehColagemDeTelefone("(34) 99", "(34) 9")).toBe(false);
    expect(ehColagemDeTelefone("(34) 999", "(34) 9")).toBe(true);
  });

  it("começar por + é colagem mesmo sem dígito nenhum ganho", () => {
    expect(ehColagemDeTelefone("+", "")).toBe(true);
    expect(ehColagemDeTelefone("  +5", "")).toBe(true);
  });

  it("apagar ou ficar igual não é colagem", () => {
    expect(ehColagemDeTelefone("3", "34")).toBe(false);
    expect(ehColagemDeTelefone("34", "34")).toBe(false);
    expect(ehColagemDeTelefone("", "")).toBe(false);
  });
});

describe("digitosDoTelefoneDoCampo — valor que veio de fora", () => {
  it("sem `anterior` (WhatsApp vindo do perfil) o 55 do país é tirado", () => {
    expect(digitosDoTelefoneDoCampo("5534999991234")).toBe("34999991234");
  });

  it("com `anterior` igual (sem ganho de dígitos) é digitação: o 55 fica", () => {
    expect(digitosDoTelefoneDoCampo("5534999991234", "5534999991234")).toBe(
      "5534999991234",
    );
  });
});

// Lista oficial dos 67 códigos de área do Brasil (Anatel), escrita aqui de
// forma independente do código de produção.
const DDDS_DO_BRASIL = new Set([
  ...[11, 12, 13, 14, 15, 16, 17, 18, 19],
  ...[21, 22, 24, 27, 28],
  ...[31, 32, 33, 34, 35, 37, 38],
  ...[41, 42, 43, 44, 45, 46, 47, 48, 49],
  ...[51, 53, 54, 55],
  ...[61, 62, 63, 64, 65, 66, 67, 68, 69],
  ...[71, 73, 74, 75, 77, 79],
  ...[81, 82, 83, 84, 85, 86, 87, 88, 89],
  ...[91, 92, 93, 94, 95, 96, 97, 98, 99],
]);

describe("dddBrasileiroValido — exatamente os 67 DDDs do Brasil", () => {
  it("a lista de referência tem 67", () => {
    expect(DDDS_DO_BRASIL.size).toBe(67);
  });

  it("de 10 a 99, só os DDDs da lista oficial passam", () => {
    for (let ddd = 10; ddd <= 99; ddd += 1) {
      expect(dddBrasileiroValido(`${ddd}999998888`), `DDD ${ddd}`).toBe(
        DDDS_DO_BRASIL.has(ddd),
      );
    }
  });

  it("celular completo com DDD que não existe não passa; com DDD de verdade passa", () => {
    expect(celularBrasileiroCompleto("10999998888")).toBe(false);
    expect(celularBrasileiroCompleto("21999998888")).toBe(true);
  });
});

describe("excedente visível — colar vários dígitos no fim não é engolido", () => {
  it("1 tecla extra no fim de um celular completo é ignorada (o número na tela não muda)", () => {
    expect(digitosComExcedenteVisivel("349999988881", "34999998888")).toBe(
      "34999998888",
    );
  });

  it("colar 2 dígitos no fim de um celular completo fica VISÍVEL (a validação reprova)", () => {
    expect(digitosComExcedenteVisivel("3499999888812", "34999998888")).toBe(
      "3499999888812",
    );
    expect(mascaraWhatsappBr("(34) 99999-888812", "(34) 99999-8888")).toBe(
      "(34) 99999-888812",
    );
    expect(celularBrasileiroCompleto("(34) 99999-888812")).toBe(false);
  });

  it("colagem enorme é limitada a 15 dígitos (nem 14, nem 16)", () => {
    const saida = digitosComExcedenteVisivel("1234567890123456789", undefined);
    expect(saida).toBe("123456789012345");
    expect(saida).toHaveLength(15);
  });

  it("no cadastro, o excedente colado também fica visível (até 15 dígitos)", () => {
    expect(mascaraTelefoneDoCadastro("11987654321999999999", "")).toBe(
      "119876543219999",
    );
  });

  it("no cadastro, número estrangeiro de 15 caracteres mantém o texto colado", () => {
    expect(mascaraTelefoneDoCadastro("+44 7911 123456", "")).toBe(
      "+44 7911 123456",
    );
  });

  it("no cadastro, texto de 16 caracteres é cortado em 15 só se o corte não levar dígito (aqui levaria)", () => {
    expect(mascaraTelefoneDoCadastro("+44 7911 1234567", "")).toBe(
      "4479111234567",
    );
  });

  it("no cadastro, se cortar em 15 caracteres levaria dígito embora, ficam só os dígitos", () => {
    // "(11) 98765-4321 99" tem 18 caracteres: o corte deixaria um celular
    // VÁLIDO no lugar do que foi colado.
    expect(mascaraTelefoneDoCadastro("(11) 98765-4321 99", "")).toBe(
      "1198765432199",
    );
  });

  it("no cadastro, 1 tecla extra no fim de um número completo é ignorada", () => {
    expect(
      mascaraTelefoneDoCadastro("(34) 99999-88881", "(34) 99999-8888"),
    ).toBe("(34) 99999-8888");
  });
});

describe("máscaras do WhatsApp e do cadastro — nenhum hífen ou parêntese pendurado", () => {
  // Dígitos digitados um a um: `anterior` é o texto da tecla anterior.
  const digitandoAteOFim = (
    mascara: (novo: string, anterior?: string) => string,
    digitos: string,
  ) => {
    let campo = "";
    const passos: string[] = [];
    for (const digito of digitos) {
      campo = mascara(`${campo}${digito}`, campo);
      passos.push(campo);
    }
    return passos;
  };

  const ESPERADO = [
    "3",
    "34",
    "(34) 9",
    "(34) 99",
    "(34) 999",
    "(34) 9999",
    "(34) 99999",
    "(34) 99999-8",
    "(34) 99999-88",
    "(34) 99999-888",
    "(34) 99999-8888",
  ];

  it("WhatsApp do checkout: cada tecla gera a máscara certa, sem hífen no meio do caminho", () => {
    const passos = digitandoAteOFim(mascaraWhatsappBr, "34999998888");
    expect(passos).toEqual(ESPERADO);
    for (const passo of passos) expect(passo.endsWith("-")).toBe(false);
  });

  it("telefone do cadastro: o mesmo caminho, tecla a tecla", () => {
    const passos = digitandoAteOFim(mascaraTelefoneDoCadastro, "34999998888");
    expect(passos).toEqual(ESPERADO);
    for (const passo of passos) expect(passo.endsWith("-")).toBe(false);
  });
});

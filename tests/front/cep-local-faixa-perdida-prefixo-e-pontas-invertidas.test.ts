// "Até onde a loja entrega" (faixa de CEP local). Fronteiras de
// `src/lib/cep-local.ts` que passavam despercebidas: a regra dos DOIS CEPs
// completos (que só vira faixa quando são exatamente dois), as pontas ao
// contrário, o fallback dos 5 primeiros dígitos e os três avisos do painel.
// CEPs fictícios.
import {
  cepEhLocal,
  erroDaFaixaDeCepLocal,
  perdeIntervaloDeCepLocal,
  temPrefixoDeSeteDigitos,
} from "@/lib/cep-local";
import { describe, expect, it } from "vitest";

const LOJA = "38500-000";

describe("cepEhLocal: dois CEPs completos viram faixa só quando são EXATAMENTE dois", () => {
  const dois = "38500-000, 38599-999";

  it("dois CEPs completos: tudo entre eles é local, as pontas inclusive", () => {
    expect(cepEhLocal(LOJA, "38550-123", dois)).toBe(true);
    expect(cepEhLocal(LOJA, "38500-000", dois)).toBe(true);
    expect(cepEhLocal(LOJA, "38599-999", dois)).toBe(true);
    expect(cepEhLocal(LOJA, "38499-999", dois)).toBe(false);
    expect(cepEhLocal(LOJA, "38600-000", dois)).toBe(false);
  });

  it("dois CEPs completos escritos de trás para frente valem a mesma faixa", () => {
    const invertido = "38599-999, 38500-000";
    expect(cepEhLocal(LOJA, "38550-123", invertido)).toBe(true);
    expect(cepEhLocal(LOJA, "38600-000", invertido)).toBe(false);
  });

  it("com TRÊS CEPs completos não há faixa: só os três exatos são locais", () => {
    const tres = "38500-000, 38599-999, 38700-000";
    expect(cepEhLocal(LOJA, "38700-000", tres)).toBe(true);
    expect(cepEhLocal(LOJA, "38500-000", tres)).toBe(true);
    expect(cepEhLocal(LOJA, "38599-999", tres)).toBe(true);
    // Entre o primeiro e o segundo NÃO é local: não era uma faixa.
    expect(cepEhLocal(LOJA, "38550-000", tres)).toBe(false);
    expect(cepEhLocal(LOJA, "38650-000", tres)).toBe(false);
  });

  it("o limite de uma faixa explícita é de 6 dígitos em CADA ponta (5 não basta)", () => {
    // 6 + 6: ponta curta completa com 0 (início) e 9 (fim).
    expect(cepEhLocal(LOJA, "38550-000", "385000-385999")).toBe(true);
    expect(cepEhLocal(LOJA, "38600-000", "385000-385999")).toBe(false);
    // 8 + 6 e 6 + 8: cada lado conta por si.
    expect(cepEhLocal(LOJA, "38550-000", "38500000-385999")).toBe(true);
    expect(cepEhLocal(LOJA, "38550-000", "385000-38599999")).toBe(true);
    // 5 + 5 não é faixa: vira um item só, que não casa com nada.
    expect(cepEhLocal(LOJA, "38550-000", "38500-38599")).toBe(false);
    // 6 + 5: a ponta curta derruba a faixa.
    expect(cepEhLocal(LOJA, "38550-000", "385000-38599")).toBe(false);
    expect(cepEhLocal(LOJA, "38550-000", "38500-385999")).toBe(false);
  });

  it("CEP completo da lista casa exato: um CEP de 9 dígitos que só começa igual não casa", () => {
    expect(cepEhLocal(LOJA, "38500-0001", "38500-000")).toBe(false);
    expect(cepEhLocal(LOJA, "38500-000", "38500-000")).toBe(true);
  });

  it("item curto vale como prefixo, de 3 a 7 dígitos", () => {
    expect(cepEhLocal(LOJA, "38599-000", "385")).toBe(true);
    expect(cepEhLocal(LOJA, "38600-000", "385")).toBe(false);
    expect(cepEhLocal(LOJA, "38500-001", "3850000")).toBe(true);
    expect(cepEhLocal(LOJA, "38500-100", "3850000")).toBe(false);
  });
});

describe("cepEhLocal: sem faixa vale a região da loja (5 primeiros dígitos)", () => {
  it("mesmos 5 dígitos é local; o sexto e o quinto dígito diferentes não são", () => {
    expect(cepEhLocal("38500-000", "38500-999")).toBe(true);
    expect(cepEhLocal("38500-000", "38501-000")).toBe(false);
    // Diferem só do sexto dígito em diante: ainda é a mesma região.
    expect(cepEhLocal("38500-000", "38500-900")).toBe(true);
    expect(cepEhLocal("38500-000", "38504-999")).toBe(false);
  });

  it("faixa em branco (só espaços) se comporta como sem faixa", () => {
    expect(cepEhLocal("38500-000", "38500-999", "   ")).toBe(true);
    expect(cepEhLocal("38500-000", "38501-000", "   ")).toBe(false);
    expect(cepEhLocal("38500-000", "38500-999", undefined)).toBe(true);
  });

  it("origem ou destino sem nenhum dígito nunca é local", () => {
    expect(cepEhLocal("", "38500-000")).toBe(false);
    expect(cepEhLocal("38500-000", "")).toBe(false);
    expect(cepEhLocal("abc", "38500-000")).toBe(false);
    expect(cepEhLocal("38500-000", "---", "385")).toBe(false);
  });
});

describe("perdeIntervaloDeCepLocal: o painel avisa quando os dois primeiros CEPs deixam de ser uma faixa", () => {
  it.each([
    ["38500-000, 38599-999, 38700-000", true],
    ["38500000, 38599999, 38700000", true],
    // o terceiro item pode ser qualquer coisa: o que importa é haver mais de dois
    ["38500-000, 38599-999, 38700", true],
    ["38500-000, 38599-999, 38700-000, 38800-000", true],
    // exatamente dois: é a faixa, nada se perde
    ["38500-000, 38599-999", false],
    // o segundo não é um CEP completo
    ["38500-000, 38599, 38700-000", false],
    // o primeiro já é uma faixa explícita
    ["38500000-38505000, 38599-999, 38700-000", false],
    // itens vazios não contam
    ["38500-000, 38599-999,", false],
    [",,38500-000,,38599-999,,", false],
    ["38500-000", false],
    ["", false],
  ])("%j → %s", (faixa, esperado) => {
    expect(perdeIntervaloDeCepLocal(faixa)).toBe(esperado);
  });

  it("itens vazios no meio não escondem o aviso: 3 itens de verdade ainda perdem a faixa", () => {
    expect(perdeIntervaloDeCepLocal("38500-000,, 38599-999, ,38700-000")).toBe(
      true,
    );
  });
});

describe("temPrefixoDeSeteDigitos: item de 7 dígitos é prefixo, não CEP", () => {
  it.each([
    ["3850000", true],
    ["38500-00", true],
    ["38500-000, 3850000", true],
    ["38500000", false],
    ["38500-000", false],
    ["385000", false],
    ["385000000", false],
    // dois blocos longos são faixa, mesmo com 7 dígitos em cada
    ["3850000-3859999", false],
    ["", false],
  ])("%j → %s", (faixa, esperado) => {
    expect(temPrefixoDeSeteDigitos(faixa)).toBe(esperado);
  });
});

describe("erroDaFaixaDeCepLocal: o que o painel recusa ao gravar", () => {
  it("faixa bem escrita não tem erro", () => {
    expect(erroDaFaixaDeCepLocal("38500-000, 38599-999")).toBeNull();
    expect(erroDaFaixaDeCepLocal("38.500-000")).toBeNull();
    expect(erroDaFaixaDeCepLocal("38500000-38505000")).toBeNull();
    expect(erroDaFaixaDeCepLocal("")).toBeNull();
  });

  it("texto livre ('a', 'até') não separa os limites", () => {
    expect(erroDaFaixaDeCepLocal("38500-000 a 38599-999")).toBe("separador");
    expect(erroDaFaixaDeCepLocal("38500-000 até 38599-999")).toBe("separador");
    expect(erroDaFaixaDeCepLocal("38500-000; 38599-999")).toBe("separador");
  });

  it("dois CEPs colados sem vírgula: a dica é a do separador", () => {
    expect(erroDaFaixaDeCepLocal("38500-000 38599-999")).toBe("separador");
  });

  it("um CEP com dígito a mais: dígitos demais", () => {
    expect(erroDaFaixaDeCepLocal("385000000")).toBe("digitos-demais");
    expect(erroDaFaixaDeCepLocal("38500-0000")).toBe("digitos-demais");
    expect(erroDaFaixaDeCepLocal("38500-000, 385000000")).toBe(
      "digitos-demais",
    );
  });

  it("o primeiro item com defeito decide o aviso", () => {
    expect(erroDaFaixaDeCepLocal("385000000, 38500-000 38599-999")).toBe(
      "digitos-demais",
    );
    expect(erroDaFaixaDeCepLocal("38500-000 38599-999, 385000000")).toBe(
      "separador",
    );
  });
});
